import { createClient } from 'npm:@supabase/supabase-js@2';

// ============================================================
// [LUX-BACKEND-016] MAPA FUNCIONAL — BACKEND ADMIN
// [LUX-ARCH-023] CSV SEPARADO POR BRANCH
// ============================================================
// Entrega ao Painel Admin o CSV de MAIN ou DEVELOP.
//
// Segurança:
// - functional_map_csv tem RLS e não concede acesso ao browser;
// - service role existe somente nesta Edge Function;
// - cada leitura/escrita valida usuário/senha e exige cargo=admin;
// - nenhum dado da tabela usuarios é devolvido além da autorização.
//
// Fonte de verdade:
// - DEVELOP é semeado uma única vez e depois editado diretamente no Supabase;
// - MAIN também possui sua própria linha. No primeiro acesso, se ela estiver vazia,
//   é derivada do DEVELOP removendo itens ainda não promovidos e restaurando os
//   estados de segurança que continuam pendentes em produção.
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const clean = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max);
type Branch = 'main' | 'develop';
type CsvRow = Record<string, string>;

async function gunzipBase64(value: string): Promise<string> {
  const raw = atob(value.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

async function gzipBase64(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < compressed.length; i += step) {
    binary += String.fromCharCode(...compressed.subarray(i, i + step));
  }
  return btoa(binary);
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
  const headers = (matrix.shift() || []).map(v => String(v || '').trim());
  const rows = matrix.filter(cells => cells.some(Boolean)).map(cells => {
    const item: CsvRow = {};
    headers.forEach((header, index) => { item[header] = String(cells[index] ?? ''); });
    return item;
  });
  return { headers, rows };
}

function csvEscape(value: string): string {
  const raw = String(value ?? '');
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function serializeCsv(headers: string[], rows: CsvRow[]): string {
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach(row => lines.push(headers.map(header => csvEscape(row[header] || '')).join(',')));
  return `${lines.join('\n')}\n`;
}

// IDs criados somente no develop após o checkpoint funcional atual da main.
const DEVELOP_ONLY_IDS = new Set([
  'LUX-AUTH-005',
  'LUX-IPTV-033',
  'LUX-IPTV-034',
  'LUX-ADMIN-012',
  'LUX-BACKEND-015',
  'LUX-AUTH-006',
  'LUX-ARCH-022',
  'LUX-ADMIN-013',
  'LUX-BACKEND-016',
  'LUX-ARCH-023',
]);

function deriveMainCsv(developCsv: string): string {
  const { headers, rows } = parseCsv(developCsv);
  const mainRows = rows.filter(row => !DEVELOP_ONLY_IDS.has(row.ID));

  // [LUX-AUTH-001] Em produção o login antigo continua sendo dívida até a promoção.
  const login = mainRows.find(row => row.ID === 'LUX-AUTH-001');
  if (login) {
    login.Status = '✅ Funcional / ⚠️ risco';
    login.Tag = 'PRIORIDADE';
    login['O que faz'] = 'Autentica a conta principal do Lux Play usando usuário e senha e carrega os dados vinculados à conta.';
    login['Minha opinião'] = 'Funciona no produto atual, mas é o maior débito de segurança do projeto porque o fluxo legado depende demais do frontend.';
    login['Sugestões de melhoria'] = 'Migrar para autenticação server-side/sessão revogável, sem entregar a tabela inteira de usuários ao navegador.';
    login['Arquivos / módulos'] = 'js/script.js · supabase/functions/profiles/index.ts';
    login['Funções / símbolos'] = 'handleLogin() · fetchUsersFromSupabase() · parseSupabaseUsers()';
    login['Dependências / fluxo'] = 'Supabase tabela usuarios → autenticação → perfis → startApp';
  }

  // [LUX-ARCH-001] O risco ainda existe na MAIN até o login backend ser promovido.
  const security = mainRows.find(row => row.ID === 'LUX-ARCH-001');
  if (security) {
    security.Status = '🚨 Risco confirmado';
    security.Tag = 'PRIORIDADE';
    security['O que faz'] = 'O fluxo legado depende da leitura de dados de usuários no cliente antes da autenticação.';
    security['Minha opinião'] = 'É o maior risco técnico do sistema atual.';
    security['Sugestões de melhoria'] = 'Migrar autenticação para função/server e restringir RLS da tabela usuarios.';
    security['Arquivos / módulos'] = 'js/script.js · js/runtime-stability-fix.js · js/synced-catalog.js · electron/main.js · supabase/functions/*';
    security['Funções / símbolos'] = 'fluxo transversal; consultar arquivos indicados e Mapa de Código';
    security['Dependências / fluxo'] = 'Transversal: autenticação + DOM + credenciais + módulos globais + deploy';
  }

  return serializeCsv(headers, mainRows);
}

async function decodeRecord(record: any): Promise<string> {
  if (!record?.csv_text) return '';
  const csv = record.encoding === 'gzip-base64'
    ? await gunzipBase64(record.csv_text)
    : String(record.csv_text || '');
  return looksLikeMap(csv) ? csv : '';
}

Deno.serve(async (request) => {
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

    // [LUX-BACKEND-016] Importação administrativa de CSV. É útil para a migração
    // inicial do Excel e também funciona como recuperação manual do mapa. O arquivo
    // é validado antes de substituir a branch escolhida.
    if (action === 'put') {
      const incomingCsv = String(body?.csv || '');
      if (!looksLikeMap(incomingCsv)) {
        return json({ ok: false, error: 'CSV inválido: cabeçalho do mapa funcional não encontrado.' }, 400);
      }
      const encoded = await gzipBase64(incomingCsv);
      const now = new Date().toISOString();
      const { error: saveError } = await admin.from('functional_map_csv').upsert({
        branch,
        csv_text: encoded,
        encoding: 'gzip-base64',
        updated_at: now,
        updated_by: username,
      }, { onConflict: 'branch' });
      if (saveError) throw saveError;
      return json({ ok: true, branch, updatedAt: now });
    }

    const { data: record, error: mapError } = await admin
      .from('functional_map_csv')
      .select('branch,csv_text,encoding,updated_at')
      .eq('branch', branch)
      .maybeSingle();
    if (mapError) throw mapError;

    let csv = await decodeRecord(record);
    let updatedAt = record?.updated_at || null;

    // MAIN nasce de um snapshot do DEVELOP somente se ainda não existir no banco.
    // Depois de criado, cada branch passa a evoluir independentemente.
    if (!csv && branch === 'main') {
      const { data: developRecord, error: developError } = await admin
        .from('functional_map_csv')
        .select('csv_text,encoding,updated_at')
        .eq('branch', 'develop')
        .maybeSingle();
      if (developError) throw developError;
      const developCsv = await decodeRecord(developRecord);
      if (!developCsv) return json({ ok: false, error: 'Mapa DEVELOP ainda não foi inicializado.' }, 503);

      csv = deriveMainCsv(developCsv);
      const encoded = await gzipBase64(csv);
      const now = new Date().toISOString();
      const { error: saveError } = await admin.from('functional_map_csv').upsert({
        branch: 'main', csv_text: encoded, encoding: 'gzip-base64', updated_at: now,
        updated_by: 'functional-map-derived-main',
      }, { onConflict: 'branch' });
      if (saveError) throw saveError;
      updatedAt = now;
    }

    if (!csv) return json({ ok: false, error: `Mapa ${branch.toUpperCase()} ainda não foi inicializado.` }, 503);

    return json({ ok: true, branch, csv, updatedAt: updatedAt || new Date().toISOString() });
  } catch (error) {
    console.error('[functional-map]', error);
    return json({ ok: false, error: 'Não foi possível carregar o mapa funcional.' }, 500);
  }
});
