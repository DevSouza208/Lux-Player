// Lux R2 Gateway v3
// Extends the current gateway and adds a published games JSON catalog.
// Deploy with Wrangler/module bundling so ./lux-r2-gateway.js is included.
import baseGateway from './lux-r2-gateway.js';

const SUPABASE_URL = 'https://fvcvshppvxihhttwyyvr.supabase.co';
const GAME_CATALOG_KEY = 'games-catalog.json';
const PUBLIC_GAME_STATUSES = new Set(['approved', 'published']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range',
};

function response(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: { ...CORS, ...(init.headers || {}) },
  });
}

function json(data, status = 200) {
  return response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function supabaseHeaders(env, extra = {}) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada.');
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function supabaseRequest(env, path, options = {}) {
  const result = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: supabaseHeaders(env, options.headers || {}),
  });
  const text = await result.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = text; }
  }
  if (!result.ok) throw new Error(data?.message || data?.error || `Supabase HTTP ${result.status}`);
  return data;
}

function firstRow(value) {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === 'object' ? value : null;
}

async function resolveLuxAccount(env, username, credential) {
  return firstRow(await supabaseRequest(env, '/rest/v1/rpc/lux_auth_resolve', {
    method: 'POST',
    body: JSON.stringify({ p_username: username, p_credential: credential }),
  }));
}

function isExpired(account) {
  const expiry = String(account?.vencimento || '').split('/');
  if (expiry.length !== 3) return false;
  const timestamp = new Date(`${expiry[2]}-${String(expiry[1]).padStart(2, '0')}-${String(expiry[0]).padStart(2, '0')}T23:59:59-03:00`).getTime();
  return Number.isFinite(timestamp) && Date.now() > timestamp;
}

async function requireAdmin(env, body) {
  const username = body?.username;
  const credential = body?.password;
  if (typeof username !== 'string' || !username || typeof credential !== 'string' || !credential) {
    return { error: json({ error: 'Login necessário.' }, 401) };
  }
  const account = await resolveLuxAccount(env, username, credential);
  if (!account) return { error: json({ error: 'Credencial inválida ou sessão expirada.' }, 401) };
  if (isExpired(account)) return { error: json({ error: 'Acesso vencido.' }, 403) };
  if (String(account.cargo || '').trim().toLowerCase() !== 'admin') {
    return { error: json({ error: 'Apenas administradores podem publicar o catálogo.' }, 403) };
  }
  return { account };
}

async function loadPublishedGames(env) {
  const games = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const page = await supabaseRequest(
      env,
      `/rest/v1/games?select=*&order=id.asc&limit=${pageSize}&offset=${offset}`,
      { method: 'GET' },
    );
    const rows = Array.isArray(page) ? page : [];
    games.push(...rows.filter(game => PUBLIC_GAME_STATUSES.has(String(game?.status || '').trim().toLowerCase())));
    if (rows.length < pageSize) break;
    offset += rows.length;
  }

  return games;
}

async function publishGameCatalog(request, env) {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  if (!env.CATALOG) return json({ error: 'Binding CATALOG indisponível.' }, 500);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Catálogo ainda não configurado.' }, 503);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON inválido.' }, 400); }

  const auth = await requireAdmin(env, body);
  if (auth.error) return auth.error;

  const games = await loadPublishedGames(env);
  const generatedAt = new Date().toISOString();
  const catalog = {
    version: 1,
    generatedAt,
    count: games.length,
    games,
  };

  await env.CATALOG.put(GAME_CATALOG_KEY, JSON.stringify(catalog), {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'public, max-age=60, must-revalidate',
    },
    customMetadata: {
      generatedAt,
      count: String(games.length),
      source: 'supabase-games',
    },
  });

  return json({
    ok: true,
    count: games.length,
    generatedAt,
    key: GAME_CATALOG_KEY,
    publicPath: `/r2/catalog/${GAME_CATALOG_KEY}`,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/games/catalog/publish') {
      if (request.method === 'OPTIONS') return response(null, { status: 204 });
      try {
        return await publishGameCatalog(request, env);
      } catch (error) {
        console.error('[Lux Games Catalog]', error);
        return json({ error: error?.message || 'Erro ao publicar catálogo.' }, 500);
      }
    }

    return baseGateway.fetch(request, env, ctx);
  },
};
