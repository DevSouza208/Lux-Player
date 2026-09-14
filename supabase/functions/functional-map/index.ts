import { createClient } from 'npm:@supabase/supabase-js@2';

// ============================================================
// [LUX-BACKEND-016] MAPA FUNCIONAL — BACKEND ADMIN
// [LUX-ARCH-023] CSV SEPARADO POR BRANCH
// ============================================================
// Entrega ao Painel Admin o CSV de MAIN ou DEVELOP.
//
// Segurança:
// - a tabela functional_map_csv possui RLS e não é exposta a anon/authenticated;
// - esta função usa service role SOMENTE no servidor;
// - antes de ler o mapa, valida usuário/senha e exige cargo=admin;
// - não devolve credenciais nem linhas da tabela usuarios.
//
// Bootstrap:
// - os CSVs iniciais acompanham esta função compactados em .b64;
// - se a linha no banco estiver vazia/corrompida, a função restaura a cópia
//   empacotada e passa a usar o Supabase como fonte diária.
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const clean = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max);

type Branch = 'main' | 'develop';

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

async function bundledSeed(branch: Branch): Promise<{ encoded: string; csv: string }> {
  const url = new URL(`./${branch}.b64`, import.meta.url);
  const encoded = (await Deno.readTextFile(url)).trim();
  const csv = await gunzipBase64(encoded);
  if (!looksLikeMap(csv)) throw new Error(`Seed ${branch} inválida.`);
  return { encoded, csv };
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

    if (action !== 'get') return json({ ok: false, error: 'Ação não permitida.' }, 400);
    if (!username || !password) return json({ ok: false, error: 'Credenciais ausentes.' }, 401);

    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) throw new Error('Configuração do backend indisponível.');

    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // [LUX-BACKEND-016] A própria função confirma que quem pediu o mapa é admin.
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

    let { data: record, error: mapError } = await admin
      .from('functional_map_csv')
      .select('branch,csv_text,encoding,updated_at')
      .eq('branch', branch)
      .maybeSingle();

    if (mapError) throw mapError;

    let csv = '';
    let needsBootstrap = !record?.csv_text;
    if (!needsBootstrap) {
      try {
        csv = record.encoding === 'gzip-base64'
          ? await gunzipBase64(record.csv_text)
          : String(record.csv_text || '');
        needsBootstrap = !looksLikeMap(csv);
      } catch (_) {
        needsBootstrap = true;
      }
    }

    // Se o banco ainda não foi semeado (ou recebeu conteúdo incompleto), restaura o
    // CSV empacotado. Depois disso, atualizações futuras acontecem só no Supabase.
    if (needsBootstrap) {
      const seed = await bundledSeed(branch);
      csv = seed.csv;
      const { data: saved, error: saveError } = await admin
        .from('functional_map_csv')
        .upsert({
          branch,
          csv_text: seed.encoded,
          encoding: 'gzip-base64',
          updated_at: new Date().toISOString(),
          updated_by: 'functional-map-bootstrap',
        }, { onConflict: 'branch' })
        .select('branch,csv_text,encoding,updated_at')
        .single();
      if (saveError) throw saveError;
      record = saved;
    }

    return json({
      ok: true,
      branch,
      csv,
      updatedAt: record?.updated_at || new Date().toISOString(),
    });
  } catch (error) {
    console.error('[functional-map]', error);
    return json({ ok: false, error: 'Não foi possível carregar o mapa funcional.' }, 500);
  }
});
