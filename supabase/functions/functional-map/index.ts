import { createClient } from 'npm:@supabase/supabase-js@2';

// ============================================================
// [LUX-BACKEND-016] MAPA FUNCIONAL — BACKEND ADMIN
// [LUX-ARCH-023] MAIN / DEVELOP NO MESMO DASHBOARD
// [LUX-BACKEND-017] MAPA NORMALIZADO — 1 FUNCIONALIDADE = 1 LINHA
// ============================================================
// Fonte de verdade atual: public.functional_map_items.
//
// Fluxo:
// - PUT recebe CSV, faz parse no servidor e substitui atomicamente as linhas
//   daquela branch por meio da RPC replace_functional_map_items();
// - GET lê as linhas normalizadas e remonta o CSV só para manter o frontend e
//   o botão "Baixar CSV" compatíveis;
// - functional_map_csv virou apenas fonte LEGADA de migração. Se a nova tabela
//   estiver vazia, um GET importa automaticamente o CSV antigo uma única vez.
//
// Segurança:
// - navegador não acessa functional_map_items diretamente;
// - service role existe somente nesta Edge Function;
// - cada ação revalida usuário/senha e exige cargo=admin;
// - RLS de usuarios permanece DESLIGADO nesta etapa, conforme decisão atual.
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const clean = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max);
type Branch = 'main' | 'develop';
type CsvRow = Record<string, string>;

type MapItem = {
  id: string;
  area: string;
  funcionalidade: string;
  status: string;
  tag: string;
  o_que_faz: string;
  opiniao: string;
  sugestoes_melhoria: string;
  arquivos_modulos: string;
  funcoes_simbolos: string;
  dependencias_fluxo: string;
  position: number;
};

const CSV_HEADERS = [
  'Área', 'Funcionalidade', 'Status', 'Tag', 'O que faz', 'Minha opinião',
  'Sugestões de melhoria', 'ID', 'Arquivos / módulos', 'Funções / símbolos',
  'Dependências / fluxo',
];

async function gunzipBase64(value: string): Promise<string> {
  const raw = atob(value.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

function looksLikeMap(csv: string): boolean {
  const first = String(csv || '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
  return first.includes('Área') && first.includes('Funcionalidade') && first.includes('ID');
}

function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); matrix.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }

  if (field || row.length) { row.push(field); matrix.push(row); }
  const headers = (matrix.shift() || []).map(value => String(value || '').trim());
  const rows = matrix
    .filter(cells => cells.some(value => String(value || '').trim()))
    .map(cells => {
      const item: CsvRow = {};
      headers.forEach((header, index) => { item[header] = String(cells[index] ?? ''); });
      return item;
    });
  return { headers, rows };
}

function csvEscape(value: unknown): string {
  const raw = String(value ?? '');
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function serializeCsv(rows: CsvRow[]): string {
  const lines = [CSV_HEADERS.map(csvEscape).join(',')];
  rows.forEach(row => lines.push(CSV_HEADERS.map(header => csvEscape(row[header] || '')).join(',')));
  return `${lines.join('\n')}\n`;
}

function normalizeCsvRows(rows: CsvRow[]): MapItem[] {
  const seen = new Set<string>();
  const items: MapItem[] = [];

  rows.forEach((row, index) => {
    const id = clean(row.ID, 120);
    if (!id || seen.has(id)) return;
    seen.add(id);
    items.push({
      id,
      area: String(row['Área'] || ''),
      funcionalidade: String(row['Funcionalidade'] || ''),
      status: String(row['Status'] || ''),
      tag: String(row['Tag'] || ''),
      o_que_faz: String(row['O que faz'] || ''),
      opiniao: String(row['Minha opinião'] || ''),
      sugestoes_melhoria: String(row['Sugestões de melhoria'] || ''),
      arquivos_modulos: String(row['Arquivos / módulos'] || ''),
      funcoes_simbolos: String(row['Funções / símbolos'] || ''),
      dependencias_fluxo: String(row['Dependências / fluxo'] || ''),
      position: index + 1,
    });
  });

  return items;
}

function dbRowsToCsvRows(rows: any[]): CsvRow[] {
  return rows.map(row => ({
    'Área': String(row.area || ''),
    'Funcionalidade': String(row.funcionalidade || ''),
    'Status': String(row.status || ''),
    'Tag': String(row.tag || ''),
    'O que faz': String(row.o_que_faz || ''),
    'Minha opinião': String(row.opiniao || ''),
    'Sugestões de melhoria': String(row.sugestoes_melhoria || ''),
    'ID': String(row.id || ''),
    'Arquivos / módulos': String(row.arquivos_modulos || ''),
    'Funções / símbolos': String(row.funcoes_simbolos || ''),
    'Dependências / fluxo': String(row.dependencias_fluxo || ''),
  }));
}

async function replaceBranch(admin: any, branch: Branch, rows: CsvRow[], updatedBy: string) {
  const items = normalizeCsvRows(rows);
  if (!items.length) throw new Error('CSV sem funcionalidades válidas.');
  const { data, error } = await admin.rpc('replace_functional_map_items', {
    p_branch: branch,
    p_rows: items,
    p_updated_by: updatedBy,
  });
  if (error) throw error;
  return Number(data || items.length);
}

async function loadLegacyCsv(admin: any, branch: Branch): Promise<string> {
  const { data: record, error } = await admin
    .from('functional_map_csv')
    .select('csv_text,encoding')
    .eq('branch', branch)
    .maybeSingle();
  if (error || !record?.csv_text) return '';
  try {
    const csv = record.encoding === 'gzip-base64'
      ? await gunzipBase64(record.csv_text)
      : String(record.csv_text || '');
    return looksLikeMap(csv) ? csv : '';
  } catch (error) {
    console.warn('[functional-map] Falha ao ler CSV legado:', branch, error);
    return '';
  }
}

async function ensureMigrated(admin: any, branch: Branch, username: string) {
  const { count, error: countError } = await admin
    .from('functional_map_items')
    .select('id', { count: 'exact', head: true })
    .eq('branch', branch);
  if (countError) throw countError;
  if ((count || 0) > 0) return false;

  const legacyCsv = await loadLegacyCsv(admin, branch);
  if (!legacyCsv) return false;
  const parsed = parseCsv(legacyCsv);
  await replaceBranch(admin, branch, parsed.rows, `${username}:legacy-migration`);
  console.info(`[functional-map] ${branch} migrado do CSV legado para linhas normalizadas.`);
  return true;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ ok: false, error: 'Método não permitido.' }, 405);

  try {
    const body = await request.json().catch(() => ({}));
    const action = clean(body?.action, 30) || 'get';
    const branch: Branch = body?.branch === 'main' ? 'main' : 'develop';
    const username = clean(body?.username, 120);
    const password = clean(body?.password, 300);

    if (!['get', 'put'].includes(action)) return json({ ok: false, error: 'Ação não permitida.' }, 400);
    if (!username || !password) return json({ ok: false, error: 'Credenciais ausentes.' }, 401);

    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) throw new Error('Configuração do backend indisponível.');

    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: account, error: authError } = await admin
      .from('usuarios')
      .select('usuario,cargo')
      .ilike('usuario', username)
      .eq('senha', password)
      .maybeSingle();
    if (authError) throw authError;
    if (!account || String(account.cargo || '').trim().toLowerCase() !== 'admin') {
      return json({ ok: false, error: 'Acesso restrito ao administrador.' }, 403);
    }

    if (action === 'put') {
      const incomingCsv = String(body?.csv || '');
      if (!looksLikeMap(incomingCsv)) {
        return json({ ok: false, error: 'CSV inválido: cabeçalho do mapa funcional não encontrado.' }, 400);
      }
      const parsed = parseCsv(incomingCsv);
      const imported = await replaceBranch(admin, branch, parsed.rows, username);
      const now = new Date().toISOString();
      return json({ ok: true, branch, imported, updatedAt: now, storage: 'functional_map_items' });
    }

    await ensureMigrated(admin, branch, username);

    const { data: rows, error: mapError } = await admin
      .from('functional_map_items')
      .select('id,area,funcionalidade,status,tag,o_que_faz,opiniao,sugestoes_melhoria,arquivos_modulos,funcoes_simbolos,dependencias_fluxo,position,updated_at')
      .eq('branch', branch)
      .order('position', { ascending: true });
    if (mapError) throw mapError;
    if (!rows?.length) return json({ ok: false, error: `Mapa ${branch.toUpperCase()} ainda não foi inicializado.` }, 503);

    const csv = serializeCsv(dbRowsToCsvRows(rows));
    const updatedAt = rows.reduce((latest: string, row: any) => {
      const value = String(row.updated_at || '');
      return value > latest ? value : latest;
    }, '');

    return json({
      ok: true,
      branch,
      csv,
      count: rows.length,
      updatedAt: updatedAt || new Date().toISOString(),
      storage: 'functional_map_items',
    });
  } catch (error) {
    console.error('[functional-map]', error);
    return json({ ok: false, error: 'Não foi possível carregar o mapa funcional.' }, 500);
  }
});
