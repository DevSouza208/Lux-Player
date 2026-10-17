[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory,

    [Parameter(Mandatory = $true)]
    [string]$TargetProjectRef,

    [switch]$ApproveRestore
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $ApproveRestore) {
    throw 'Refusing to write to the target. Re-run only after approval with -ApproveRestore.'
}

$backupPath = Resolve-Path -LiteralPath $BackupDirectory -ErrorAction Stop
$requiredFiles = @(
    'public-app.backup',
    'auth-identities-data.backup',
    'storage-metadata-data.backup',
    'SHA256SUMS.json'
)
foreach ($file in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $backupPath $file))) {
        throw "Missing backup file: $file"
    }
}

$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$pgRestore = Join-Path $pgBin 'pg_restore.exe'
$psql = Join-Path $pgBin 'psql.exe'
foreach ($tool in @($pgRestore, $psql)) {
    if (-not (Test-Path -LiteralPath $tool)) {
        throw "PostgreSQL 17 client not found: $tool"
    }
}

$targetHost = "db.$TargetProjectRef.supabase.co"
$restoreList = Join-Path $env:TEMP ("lux-public-restore-" + [guid]::NewGuid().ToString() + '.list')
$securePassword = Read-Host 'Database password for the TARGET project' -AsSecureString
$passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = $null

function Invoke-PgTool {
    param(
        [Parameter(Mandatory = $true)][string]$Tool,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Label
    )

    & $Tool @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE. Stop and inspect the restore log before retrying."
    }
}

try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
    $env:PGPASSWORD = $plainPassword
    $env:PGSSLMODE = 'require'

    # Guardrail: this migration is intentionally allowed only into a clean public schema.
    $publicTableCount = & $psql --host $targetHost --port 5432 --username postgres --dbname postgres `
        --set ON_ERROR_STOP=on --tuples-only --no-align `
        --command "select count(*) from pg_tables where schemaname = 'public';"
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect the target database (exit $LASTEXITCODE)." }
    if ([int]($publicTableCount | Select-Object -Last 1) -ne 0) {
        throw 'Target public schema is not empty. Restore aborted; no target data was changed.'
    }

    # Do not restore full-audit.backup: it contains Supabase-managed schemas for evidence only.
    # public-app includes the Lux data, SQL functions, RLS policies, triggers, sequences, and ACLs.
    # Supabase already creates the public schema, so omit only its CREATE SCHEMA entry.
    & $pgRestore --list (Join-Path $backupPath 'public-app.backup') |
        Where-Object { $_ -notmatch 'SCHEMA - public|DEFAULT ACL' } |
        Set-Content -LiteralPath $restoreList -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "Could not prepare the public restore plan (exit $LASTEXITCODE)." }
    Invoke-PgTool -Tool $pgRestore -Label 'Public application restore' -Arguments @(
        '--host', $targetHost, '--port', '5432', '--username', 'postgres', '--dbname', 'postgres',
        '--no-owner', '--exit-on-error', '--single-transaction', '--use-list', $restoreList, (Join-Path $backupPath 'public-app.backup')
    )

    # Preserve existing account IDs and password hashes, but deliberately do not restore obsolete
    # sessions/refresh tokens because new project signing keys invalidate them.
    Invoke-PgTool -Tool $pgRestore -Label 'Auth identity restore' -Arguments @(
        '--host', $targetHost, '--port', '5432', '--username', 'postgres', '--dbname', 'postgres',
        '--data-only', '--exit-on-error', '--single-transaction', (Join-Path $backupPath 'auth-identities-data.backup')
    )

    # This is metadata only; files are verified separately in R2/Storage.
    Invoke-PgTool -Tool $pgRestore -Label 'Storage metadata restore' -Arguments @(
        '--host', $targetHost, '--port', '5432', '--username', 'postgres', '--dbname', 'postgres',
        '--data-only', '--exit-on-error', '--single-transaction', (Join-Path $backupPath 'storage-metadata-data.backup')
    )

    $validation = & $psql --host $targetHost --port 5432 --username postgres --dbname postgres `
        --set ON_ERROR_STOP=on --tuples-only --no-align --command @'
select 'public_tables=' || count(*) from pg_tables where schemaname = 'public';
select 'auth_users=' || count(*) from auth.users;
select 'auth_identities=' || count(*) from auth.identities;
select 'storage_buckets=' || count(*) from storage.buckets;
'@
    if ($LASTEXITCODE -ne 0) { throw "Post-restore validation failed (exit $LASTEXITCODE)." }
    $validation | Set-Content -LiteralPath (Join-Path $backupPath 'target-restore-validation.txt') -Encoding utf8
    Write-Host 'Restore completed. Validation counts were written beside the local backup.'
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $restoreList -Force -ErrorAction SilentlyContinue
    if ($passwordBstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
    }
    $plainPassword = $null
}
