[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRef,

    [string]$DbHost,

    [string]$OutputRoot = "$env:USERPROFILE\Lux-Player-Backups"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $DbHost) {
    $DbHost = "db.$ProjectRef.supabase.co"
}

$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$pgDump = Join-Path $pgBin 'pg_dump.exe'
$pgDumpAll = Join-Path $pgBin 'pg_dumpall.exe'
$psql = Join-Path $pgBin 'psql.exe'

foreach ($tool in @($pgDump, $pgDumpAll, $psql)) {
    if (-not (Test-Path -LiteralPath $tool)) {
        throw "PostgreSQL 17 client not found: $tool"
    }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $OutputRoot "$ProjectRef-$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

# This prompt never echoes the password or stores it in the repository.
$securePassword = Read-Host 'Database password for the SOURCE project' -AsSecureString
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
        throw "$Label failed with exit code $LASTEXITCODE. The source project was not modified."
    }
}

try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
    $env:PGPASSWORD = $plainPassword
    $env:PGSSLMODE = 'require'

    # Read-only preflight. It also records exact source server version for restore compatibility.
    $sourceVersion = & $psql --host $DbHost --port 5432 --username postgres --dbname postgres `
        --set ON_ERROR_STOP=on --tuples-only --no-align --command 'select version();'
    if ($LASTEXITCODE -ne 0) {
        throw "Source connectivity preflight failed with exit code $LASTEXITCODE. The source project was not modified."
    }
    $sourceVersion | Set-Content -LiteralPath (Join-Path $backupDir 'source-postgres-version.txt') -Encoding utf8

    # Complete forensic archive: schema, public data, SQL functions, RLS policies and ACLs.
    # It is an archive only; never restore it wholesale into a managed Supabase project.
    Invoke-PgTool -Tool $pgDump -Label 'Full audit dump' -Arguments @(
        '--host', $DbHost, '--port', '5432', '--username', 'postgres', '--dbname', 'postgres',
        '--format', 'custom', '--no-owner', '--verbose', '--file', (Join-Path $backupDir 'full-audit.backup')
    )

    # Restorable application archive. Includes public schema/data (profiles, subscriptions,
    # expiry dates and app settings) without replacing Supabase-managed auth/storage schemas.
    Invoke-PgTool -Tool $pgDump -Label 'Public application dump' -Arguments @(
        '--host', $DbHost, '--port', '5432', '--username', 'postgres', '--dbname', 'postgres',
        '--format', 'custom', '--no-owner', '--schema', 'public', '--verbose', '--file', (Join-Path $backupDir 'public-app.backup')
    )

    # Auth identities preserve user UUIDs and password hashes. Sessions and refresh tokens are
    # intentionally excluded: signing keys change between projects, so clients must sign in again.
    Invoke-PgTool -Tool $pgDump -Label 'Auth identity data dump' -Arguments @(
        '--host', $DbHost, '--port', '5432', '--username', 'postgres', '--dbname', 'postgres',
        '--format', 'custom', '--data-only', '--table', 'auth.users', '--table', 'auth.identities', '--table', 'auth.mfa_factors',
        '--file', (Join-Path $backupDir 'auth-identities-data.backup')
    )

    # Storage metadata only. Object bytes require a separate Storage/R2 transfer and are not
    # assumed to exist in Postgres.
    Invoke-PgTool -Tool $pgDump -Label 'Storage metadata dump' -Arguments @(
        '--host', $DbHost, '--port', '5432', '--username', 'postgres', '--dbname', 'postgres',
        '--format', 'custom', '--data-only', '--table', 'storage.buckets', '--table', 'storage.objects',
        '--file', (Join-Path $backupDir 'storage-metadata-data.backup')
    )

    # Audit role grants separately; this file is evidence, not an automatic restore input.
    Invoke-PgTool -Tool $pgDumpAll -Label 'Roles and grants audit dump' -Arguments @(
        '--host', $DbHost, '--port', '5432', '--username', 'postgres', '--globals-only', '--no-role-passwords',
        '--file', (Join-Path $backupDir 'roles-and-grants-audit.sql')
    )

    Get-ChildItem -LiteralPath $backupDir -File |
        Get-FileHash -Algorithm SHA256 |
        Select-Object Path, Algorithm, Hash |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupDir 'SHA256SUMS.json') -Encoding utf8

    Write-Host "Backup completed: $backupDir"
    Write-Host 'Do not commit this directory. Keep it on encrypted storage.'
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
    if ($passwordBstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
    }
    $plainPassword = $null
}
