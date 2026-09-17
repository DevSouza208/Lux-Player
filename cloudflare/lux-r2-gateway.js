const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type, ETag, Accept-Ranges',
};

const PUBLIC_BUCKETS = {
  roms: 'ROMS',
  playlists: 'PLAYLISTS',
  catalog: 'CATALOG',
  banners: 'BANNERS',
  vod: 'VOD',
};

const MAX_SAVE_BYTES = 6 * 1024 * 1024;
const SUPABASE_URL = 'https://fvcvshppvxihhttwyyvr.supabase.co';

function response(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: {
      ...CORS,
      ...(init.headers || {}),
    },
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

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunkSize)));
  }
  return btoa(binary);
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
  if (!result.ok) {
    const message = data?.message || data?.error || `Supabase HTTP ${result.status}`;
    const error = new Error(message);
    error.status = result.status;
    throw error;
  }
  return data;
}

function firstRow(value) {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === 'object' ? value : null;
}

async function resolveLuxAccount(env, username, credential) {
  const data = await supabaseRequest(env, '/rest/v1/rpc/lux_auth_resolve', {
    method: 'POST',
    body: JSON.stringify({ p_username: username, p_credential: credential }),
  });
  return firstRow(data);
}

function isExpired(account) {
  const expiry = String(account?.vencimento || '').split('/');
  if (expiry.length !== 3) return false;
  const timestamp = new Date(`${expiry[2]}-${String(expiry[1]).padStart(2, '0')}-${String(expiry[0]).padStart(2, '0')}T23:59:59-03:00`).getTime();
  return Number.isFinite(timestamp) && Date.now() > timestamp;
}

async function getProfile(env, userName, profileSlot) {
  const path = '/rest/v1/account_profiles?select=slot,data_key'
    + `&user_name=eq.${encodeURIComponent(userName)}`
    + `&slot=eq.${encodeURIComponent(profileSlot)}`
    + '&limit=1';
  return firstRow(await supabaseRequest(env, path, { method: 'GET' }));
}

async function authenticateSaveRequest(env, body) {
  const username = body?.username;
  const credential = body?.password;
  if (typeof username !== 'string' || !username || username.length > 256
      || typeof credential !== 'string' || !credential || credential.length > 1024) {
    return { error: json({ error: 'Login necessário.' }, 401) };
  }

  const requestedGameKey = body?.gameKey;
  const slot = Number(body?.slot);
  if (typeof requestedGameKey !== 'string' || !requestedGameKey || requestedGameKey.length > 500
      || ![0, 1, 2, 3].includes(slot) || requestedGameKey.startsWith('profile:')) {
    return { error: json({ error: 'Dados do save inválidos.' }, 400) };
  }

  const account = await resolveLuxAccount(env, username, credential);
  if (!account) return { error: json({ error: 'Credencial inválida ou sessão expirada.' }, 401) };
  if (isExpired(account)) return { error: json({ error: 'Acesso vencido.' }, 403) };

  const userName = String(account.usuario || username);
  const profileSlot = Number(body.profileSlot ?? 1);
  if (![1, 2, 3, 4].includes(profileSlot)) return { error: json({ error: 'Perfil inválido.' }, 400) };

  const profile = await getProfile(env, userName, profileSlot);
  if (!profile || String(profile.data_key || '') !== String(body.profileKey || '')) {
    return { error: json({ error: 'Perfil alterado. Selecione o perfil novamente.' }, 403) };
  }

  const prefix = profile.data_key
    ? `profile:${profile.data_key}:`
    : profileSlot === 1 ? '' : `profile:${profileSlot}:`;

  return {
    userName,
    gameKey: `${prefix}${requestedGameKey}`,
    slot,
  };
}

async function getSaveRow(env, userName, gameKey, slot) {
  const path = '/rest/v1/user_game_saves?select=storage_path,state_format,client_updated_at'
    + `&user_name=eq.${encodeURIComponent(userName)}`
    + `&game_key=eq.${encodeURIComponent(gameKey)}`
    + `&slot=eq.${encodeURIComponent(slot)}`
    + '&limit=1';
  return firstRow(await supabaseRequest(env, path, { method: 'GET' }));
}

async function listSaveRows(env, userName, gameKey) {
  const path = '/rest/v1/user_game_saves?select=slot,client_updated_at'
    + `&user_name=eq.${encodeURIComponent(userName)}`
    + `&game_key=eq.${encodeURIComponent(gameKey)}`;
  const rows = await supabaseRequest(env, path, { method: 'GET' });
  return Array.isArray(rows) ? rows : [];
}

async function loadLegacySupabaseSave(env, storagePath) {
  const encodedPath = String(storagePath).split('/').map(encodeURIComponent).join('/');
  const result = await fetch(`${SUPABASE_URL}/storage/v1/object/game-saves/${encodedPath}`, {
    headers: supabaseHeaders(env, { 'Content-Type': 'application/octet-stream' }),
  });
  if (result.status === 404) return null;
  if (!result.ok) throw new Error(`Supabase Storage HTTP ${result.status}`);
  const buffer = await result.arrayBuffer();
  if (buffer.byteLength > MAX_SAVE_BYTES) throw new Error('Save excede o limite permitido.');
  return new Uint8Array(buffer);
}

async function loadSaveBytes(env, storagePath) {
  let object = await env.SAVES.get(storagePath);
  if (object) {
    const buffer = await object.arrayBuffer();
    if (buffer.byteLength > MAX_SAVE_BYTES) throw new Error('Save excede o limite permitido.');
    return new Uint8Array(buffer);
  }

  // Compatibilidade: se um save antigo ainda não estiver no R2, lê uma vez do
  // Storage legado e o migra silenciosamente para a mesma chave em luxsaves.
  const legacy = await loadLegacySupabaseSave(env, storagePath);
  if (!legacy) return null;
  await env.SAVES.put(storagePath, legacy, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { migratedFrom: 'supabase-game-saves' },
  });
  return legacy;
}

async function commitSaveMetadata(env, values) {
  const data = await supabaseRequest(env, '/rest/v1/rpc/commit_game_save_checked', {
    method: 'POST',
    body: JSON.stringify({
      p_user_name: values.userName,
      p_game_key: values.gameKey,
      p_slot: values.slot,
      p_storage_path: values.storagePath,
      p_state_format: values.format,
      p_updated_at: values.updatedAt,
      p_expected_at: values.expectedCloudAt,
    }),
  });
  if (typeof data === 'boolean') return data;
  if (Array.isArray(data)) return Boolean(data[0]);
  return Boolean(data);
}

async function handleSaves(request, env) {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  if (!env.SAVES) return json({ error: 'Binding SAVES indisponível.' }, 500);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Gateway de saves ainda não configurado.' }, 503);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON inválido.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Dados inválidos.' }, 400);

  const auth = await authenticateSaveRequest(env, body);
  if (auth.error) return auth.error;
  const { userName, gameKey, slot } = auth;

  if (body.action === 'list') {
    const rows = await listSaveRows(env, userName, gameKey);
    return json({ slots: rows.map(row => ({ slot: Number(row.slot), updatedAt: Number(row.client_updated_at) })) });
  }

  if (body.action === 'load') {
    const row = await getSaveRow(env, userName, gameKey, slot);
    if (!row) return json({ save: null });
    const bytes = await loadSaveBytes(env, row.storage_path);
    if (!bytes) return json({ error: 'Arquivo de save não encontrado.' }, 404);
    return json({
      save: {
        updatedAt: Number(row.client_updated_at),
        format: row.state_format,
        dataBase64: toBase64(bytes.buffer),
      },
    });
  }

  if (body.action !== 'save') return json({ error: 'Ação inválida.' }, 400);

  const updatedAt = Number(body.updatedAt);
  const expectedCloudAt = body.expectedCloudAt === null || body.expectedCloudAt === undefined
    ? null
    : Number(body.expectedCloudAt);
  const format = body.format;
  const dataBase64 = body.dataBase64;

  if (typeof dataBase64 !== 'string'
      || !Number.isSafeInteger(updatedAt) || updatedAt <= 0 || updatedAt > Date.now() + 300000
      || !['arraybuffer', 'text', 'json', 'uint8array'].includes(format)
      || (expectedCloudAt !== null && (!Number.isSafeInteger(expectedCloudAt) || expectedCloudAt < 0))) {
    return json({ error: 'Dados do save inválidos.' }, 400);
  }

  if (dataBase64.length > Math.ceil(MAX_SAVE_BYTES / 3) * 4 + 16) return json({ error: 'Save excede o limite de 6 MB.' }, 413);

  let bytes;
  try { bytes = fromBase64(dataBase64); }
  catch { return json({ error: 'Save inválido.' }, 400); }
  if (!bytes.byteLength) return json({ error: 'Save vazio.' }, 400);
  if (bytes.byteLength > MAX_SAVE_BYTES) return json({ error: 'Save excede o limite de 6 MB.' }, 413);

  const current = await getSaveRow(env, userName, gameKey, slot);
  if (current && Number(current.client_updated_at) >= updatedAt) return json({ saved: false, newerCloud: true });

  const storagePath = `${encodeURIComponent(userName)}/${encodeURIComponent(gameKey)}/slot-${slot}-${crypto.randomUUID()}.bin`;
  await env.SAVES.put(storagePath, bytes, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: {
      user: userName.slice(0, 256),
      slot: String(slot),
      updatedAt: String(updatedAt),
    },
  });

  let committed = false;
  try {
    committed = await commitSaveMetadata(env, {
      userName,
      gameKey,
      slot,
      storagePath,
      format,
      updatedAt,
      expectedCloudAt,
    });
  } catch (error) {
    await env.SAVES.delete(storagePath).catch(() => {});
    throw error;
  }

  if (!committed) {
    await env.SAVES.delete(storagePath).catch(() => {});
    return json({ saved: false, newerCloud: true, conflict: true });
  }

  return json({ saved: true, newerCloud: false, conflict: false, backend: 'r2' });
}

const GAME_CONSOLES = new Set(['arcade', 'dos', 'gba', 'gb', 'gbc', 'md', 'megadrive', 'ms', 'mastersystem', 'n64', 'nds', 'nes', 'psp', 'snes']);
const GAME_EXTENSIONS = new Set(['gba', 'gb', 'gbc', 'sfc', 'smc', 'zip', 'md', 'gen', 'bin', 'nes', 'sms', 'n64', 'z64', 'v64', 'iso', 'cso', 'pbp', 'nds']);
const GAME_CONSOLE_ALIASES = { md: 'megadrive', ms: 'mastersystem' };

function gameTitleFromKey(key) {
  const fileName = String(key).split('/').pop() || '';
  return fileName.replace(/\.[^.]+$/, '').replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function gameIdentity(title, consoleName) {
  return `${consoleName}:${String(title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

function gameFromR2Object(object, origin) {
  const key = String(object?.key || '').replace(/^\/+/, '');
  const parts = key.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const folder = String(parts[0]).toLowerCase();
  const extension = (parts.at(-1).split('.').pop() || '').toLowerCase();
  if (!GAME_CONSOLES.has(folder) || !GAME_EXTENSIONS.has(extension)) return null;
  const consoleName = GAME_CONSOLE_ALIASES[folder] || folder;
  const title = gameTitleFromKey(key);
  if (!title) return null;
  return {
    key,
    title,
    console: consoleName,
    sourceFileName: parts.at(-1),
    romUrl: `${origin}/r2/roms/${key.split('/').map(encodeURIComponent).join('/')}`,
  };
}

async function requireGameCatalogAdmin(env, body) {
  const username = body?.username;
  const credential = body?.password;
  if (typeof username !== 'string' || !username || typeof credential !== 'string' || !credential) {
    return { error: json({ error: 'Login necessÃ¡rio.' }, 401) };
  }
  const account = await resolveLuxAccount(env, username, credential);
  if (!account) return { error: json({ error: 'Credencial invÃ¡lida ou sessÃ£o expirada.' }, 401) };
  if (isExpired(account)) return { error: json({ error: 'Acesso vencido.' }, 403) };
  if (String(account.cargo || '').trim().toLowerCase() !== 'admin') {
    return { error: json({ error: 'Apenas administradores podem sincronizar ROMs.' }, 403) };
  }
  return { account };
}

async function listR2Games(bucket, origin) {
  const games = [];
  let cursor;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    for (const object of page.objects || []) {
      const game = gameFromR2Object(object, origin);
      if (game) games.push(game);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return games;
}

async function handleGameCatalogSync(request, env, url) {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  if (!env.ROMS) return json({ error: 'Binding ROMS indisponível.' }, 500);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Catálogo ainda não configurado.' }, 503);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON inválido.' }, 400); }

  const auth = await requireGameCatalogAdmin(env, body);
  if (auth.error) return auth.error;

  const cursor = typeof body?.cursor === 'string' && body.cursor ? body.cursor : undefined;
  let page;
  try {
    page = await env.ROMS.list({ cursor, limit: 1 });
  } catch (error) {
    return json({
      mode: 'one-by-one',
      processed: 0,
      created: 0,
      existing: 0,
      skipped: 0,
      failed: 1,
      failure: {
        key: '',
        title: '',
        stage: 'r2-list',
        error: error?.message || 'Falha ao listar o R2.',
      },
      nextCursor: null,
      done: false,
    });
  }

  const object = page.objects?.[0] || null;
  const nextCursor = page.truncated ? page.cursor : null;
  const done = !page.truncated;

  if (!object) {
    return json({
      mode: 'one-by-one',
      processed: 0,
      created: 0,
      existing: 0,
      skipped: 0,
      failed: 0,
      nextCursor,
      done: true,
    });
  }

  const key = String(object.key || '');
  const game = gameFromR2Object(object, url.origin);

  // Modo usado pelo frontend quando uma chamada falha repetidamente:
  // apenas avança o cursor, registra a ROM problemática e não toca no catálogo.
  if (body?.action === 'skip') {
    return json({
      mode: 'one-by-one',
      processed: 1,
      created: 0,
      existing: 0,
      skipped: 0,
      failed: 1,
      failure: {
        key,
        title: game?.title || '',
        stage: 'client-skip',
        error: String(body?.reason || 'Ignorada após falhas repetidas.').slice(0, 500),
      },
      nextCursor,
      done,
    });
  }

  if (!game) {
    return json({
      mode: 'one-by-one',
      processed: 1,
      created: 0,
      existing: 0,
      skipped: 1,
      failed: 0,
      key,
      nextCursor,
      done,
    });
  }

  let existing;
  try {
    existing = firstRow(await supabaseRequest(
      env,
      `/rest/v1/games?select=id,status&rom_path=eq.${encodeURIComponent(game.key)}&limit=1`,
      { method: 'GET' },
    ));
  } catch (error) {
    return json({
      mode: 'one-by-one',
      processed: 1,
      created: 0,
      existing: 0,
      skipped: 0,
      failed: 1,
      failure: {
        key: game.key,
        title: game.title,
        stage: 'catalog-lookup',
        error: error?.message || 'Falha ao consultar o catálogo.',
      },
      nextCursor,
      done,
    });
  }

  // Se a ROM já existe no catálogo, não faz PATCH nem reseta status:
  // apenas informa ao frontend e segue para o próximo objeto.
  if (existing?.id) {
    return json({
      mode: 'one-by-one',
      processed: 1,
      created: 0,
      existing: 1,
      skipped: 0,
      failed: 0,
      key: game.key,
      title: game.title,
      nextCursor,
      done,
    });
  }

  const values = {
    title: game.title,
    console: game.console,
    rom_path: game.key,
    rom_url: game.romUrl,
    source_file_name: game.sourceFileName,
    players: 1,
    genres: [],
    status: 'pending',
  };

  try {
    await supabaseRequest(env, '/rest/v1/games', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(values),
    });
  } catch (error) {
    return json({
      mode: 'one-by-one',
      processed: 1,
      created: 0,
      existing: 0,
      skipped: 0,
      failed: 1,
      failure: {
        key: game.key,
        title: game.title,
        stage: 'catalog-insert',
        error: error?.message || 'Falha ao inserir no catálogo.',
      },
      nextCursor,
      done,
    });
  }

  return json({
    mode: 'one-by-one',
    processed: 1,
    created: 1,
    existing: 0,
    skipped: 0,
    failed: 0,
    key: game.key,
    title: game.title,
    nextCursor,
    done,
  });
}

async function handlePublicR2(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'r2') return null;

  const alias = parts[1];
  const bindingName = PUBLIC_BUCKETS[alias];
  if (!bindingName) return json({ error: 'Bucket não disponível publicamente.' }, 403);

  const key = decodeURIComponent(parts.slice(2).join('/'));
  if (!key) return json({ error: 'Informe a chave do objeto.' }, 400);

  const bucket = env[bindingName];
  if (!bucket) return json({ error: 'Binding R2 não encontrado.' }, 500);

  const object = await bucket.get(key);
  if (!object) return response('Arquivo não encontrado', { status: 404 });

  const headers = new Headers(CORS);
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', alias === 'roms' || alias === 'catalog' || alias === 'banners'
      ? 'public, max-age=3600'
      : 'public, max-age=300');
  }

  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  if (request.method !== 'GET') return response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS' } });
  return new Response(object.body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return response(null, { status: 204 });

    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'Lux R2 Gateway',
        version: 2,
        buckets: {
          roms: true,
          playlists: true,
          catalog: true,
          banners: true,
          vod: true,
          saves: 'authenticated-r2',
          userPlaylists: 'private',
        },
        saveApi: Boolean(env.SAVES && env.SUPABASE_SERVICE_ROLE_KEY),
      });
    }

    if (url.pathname === '/') {
      return json({
        ok: true,
        service: 'Lux R2 Gateway',
        message: 'Gateway ativo. Use /health para diagnÃ³stico ou os endpoints da aplicaÃ§Ã£o.',
        endpoints: {
          roms: '/r2/roms/{console}/{arquivo}',
          saves: '/api/saves',
          gameCatalogSync: '/api/games/sync (POST, administrador)',
        },
      });
    }

    try {
      if (url.pathname === '/api/saves') return await handleSaves(request, env);
      if (url.pathname === '/api/games/sync') return await handleGameCatalogSync(request, env, url);
      const publicResult = await handlePublicR2(request, env, url);
      if (publicResult) return publicResult;
      return response('Not found', { status: 404 });
    } catch (error) {
      console.error('[Lux R2 Gateway]', error);
      return json({
        error: error?.message || 'Erro desconhecido',
        stack: error?.stack || null
      }, 500);
    }
  },
};
