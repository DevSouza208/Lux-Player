// LUX-IPTV-042/043
// Sincroniza a lista principal, providers e M3Us secundárias para um catálogo
// canônico no Postgres. O navegador deixa de fazer comparações O(n²) entre
// dezenas de milhares de itens; ele apenas recebe um snapshot já normalizado.
//
// A Edge Function implantada no projeto Supabase usa este mesmo contrato:
// options -> begin -> sync_task -> enrich -> finish/status.
// O corpo completo da versão ativa é mantido no deploy do Supabase; este arquivo
// documenta o contrato público usado pelo frontend e serve como ponto de entrada
// para futuras alterações via Supabase CLI.

import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store'
};

const json = (data: unknown, status = 200) => Response.json(data, { status, headers });

// Providers já suportados pelo bridge real do Lux. Outros entram aqui somente
// depois de possuírem adapter testado no frontend/backend.
const PROVIDERS = {
  animefire: { name: 'Anime Fire', priority: 10 },
  dattebayobr: { name: 'Dattebayo BR', priority: 20 }
} as const;

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  // A versão operacional é implantada diretamente no Supabase para não depender
  // do build do app. Este stub versionado evita que o contrato se perca no repo.
  // Consulte js/canonical-catalog-sync.js para o cliente desse fluxo.
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  try {
    const body = await request.json();
    const action = String(body?.action || '').trim().toLowerCase();
    return json({
      error: `Fonte versionada de referência. A ação ${action || '(vazia)'} é atendida pela versão ativa implantada no Supabase.`,
      supportedProviders: Object.keys(PROVIDERS),
      databaseReady: Boolean(db)
    }, 501);
  } catch {
    return json({ error: 'JSON inválido.' }, 400);
  }
});
