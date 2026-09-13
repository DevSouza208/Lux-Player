const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Sync-Token",
  "Cache-Control": "no-store"
};

const PROVIDER_ROOT = "provider";
const PROVIDER_MIN_SYNC_MS = 3.5 * 60 * 60 * 1000;
const WORKER_VERSION = "1.6.3-provider-catalog1";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
}

function baseUrl(env) {
  return String(env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
}

async function supabaseFetch(env, path, options = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

async function updateUser(env, username, data) {
  return supabaseFetch(env, `usuarios?usuario=eq.${encodeURIComponent(username)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(data)
  });
}

async function getUserByUsername(env, username) {
  const response = await supabaseFetch(
    env,
    `usuarios?select=usuario,senha,cargo,lista_m3u,userxc,senhaxc,urlxc&usuario=eq.${encodeURIComponent(username)}&limit=1`
  );
  if (!response.ok) throw new Error(`Erro ao consultar usuário: HTTP ${response.status}`);
  const rows = await response.json();
  return rows?.[0] || null;
}

async function authenticateUser(env, username, password) {
  const account = await getUserByUsername(env, username);
  if (!account || String(account.senha || "") !== String(password || "")) {
    throw new Error("Credenciais inválidas.");
  }
  return account;
}

async function authenticateAdmin(env, username, password) {
  const account = await authenticateUser(env, username, password);
  if (String(account.cargo || "").trim().toLowerCase() !== "admin") {
    throw new Error("Apenas administradores podem iniciar a sincronização manual.");
  }
  return account;
}

function normalizeXtreamServer(value) {
  try {
    const url = new URL(String(value || "").trim());
    const pathname = url.pathname.replace(/\/(?:get|player_api)\.php$/i, "").replace(/\/+$/, "");
    return `${url.origin}${pathname}`.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function getXtreamSource(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    const username = url.searchParams.get("username") || url.searchParams.get("user");
    const password = url.searchParams.get("password") || url.searchParams.get("pass");
    if (!username || !password) return null;
    const match = url.pathname.match(/^(.*)\/(?:get|player_api)\.php$/i);
    if (!match) return null;
    return {
      server: `${url.origin}${match[1] || ""}`.replace(/\/+$/, ""),
      username,
      password
    };
  } catch {
    return null;
  }
}

function getXtreamSourceFromUser(user) {
  const explicitServer = normalizeXtreamServer(user?.urlxc);
  const explicitUser = String(user?.userxc || "").trim();
  const explicitPass = String(user?.senhaxc || "").trim();
  if (explicitServer && explicitUser && explicitPass) {
    return { server: explicitServer, username: explicitUser, password: explicitPass };
  }
  return getXtreamSource(String(user?.lista_m3u || "").trim());
}

function xtreamUrl(source, action) {
  return `${source.server}/player_api.php?username=${encodeURIComponent(source.username)}`
    + `&password=${encodeURIComponent(source.password)}`
    + `&action=${encodeURIComponent(action)}`;
}

const catalogParts = [
  ["liveCategories", "get_live_categories", "live-categories.json"],
  ["movieCategories", "get_vod_categories", "movie-categories.json"],
  ["seriesCategories", "get_series_categories", "series-categories.json"],
  ["live", "get_live_streams", "live.json"],
  ["movies", "get_vod_streams", "movies.json"],
  ["series", "get_series", "series.json"]
];

async function fetchWithTimeout(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function r2HttpMetadata(contentType, cacheControl = "no-cache, no-store, max-age=0") {
  return { contentType, cacheControl };
}

async function saveRemoteResponseToR2(env, key, response, contentType, cacheControl) {
  if (!response.body) throw new Error("Fornecedor retornou resposta sem conteúdo.");
  const rawLength = response.headers.get("content-length");
  const contentLength = /^\d+$/.test(String(rawLength || "")) ? Number(rawLength) : 0;
  const options = { httpMetadata: r2HttpMetadata(contentType, cacheControl) };

  if (Number.isSafeInteger(contentLength) && contentLength > 0) {
    const fixed = new FixedLengthStream(contentLength);
    await Promise.all([
      response.body.pipeTo(fixed.writable),
      env.LISTS_BUCKET.put(key, fixed.readable, options)
    ]);
    return contentLength;
  }

  const buffer = await response.arrayBuffer();
  await env.LISTS_BUCKET.put(key, buffer, options);
  return buffer.byteLength;
}

async function readR2Json(env, key) {
  try {
    const object = await env.LISTS_BUCKET.get(key);
    if (!object) return null;
    return JSON.parse(await object.text());
  } catch {
    return null;
  }
}

async function syncCatalogPart(env, source, versionPrefix, part) {
  const [name, action, filename] = part;
  const response = await fetchWithTimeout(
    xtreamUrl(source, action),
    { headers: { "User-Agent": "Lux-Playlist-Sync/1.6" } }
  );
  if (!response.ok) throw new Error(`${action}: fornecedor respondeu HTTP ${response.status}`);

  const key = `${versionPrefix}/${filename}`;
  const bytes = await saveRemoteResponseToR2(
    env,
    key,
    response,
    "application/json; charset=utf-8",
    "public, max-age=31536000, immutable"
  );
  return { name, filename, bytes };
}

async function deleteProviderVersion(env, version) {
  const clean = String(version || "").trim();
  if (!clean) return;
  const prefix = `${PROVIDER_ROOT}/${clean}`;
  await Promise.allSettled([
    env.LISTS_BUCKET.delete(`${prefix}/playlist.m3u`),
    ...catalogParts.map(([, , filename]) => env.LISTS_BUCKET.delete(`${prefix}/${filename}`))
  ]);
}

async function getProviderUser(env) {
  if (env.PROVIDER_USERNAME) {
    const configured = await getUserByUsername(env, String(env.PROVIDER_USERNAME));
    if (configured?.lista_m3u) return configured;
  }

  const adminResponse = await supabaseFetch(
    env,
    "usuarios?select=usuario,senha,cargo,lista_m3u,userxc,senhaxc,urlxc&cargo=eq.admin&lista_m3u=not.is.null&limit=1"
  );
  if (adminResponse.ok) {
    const rows = await adminResponse.json();
    if (rows?.[0]?.lista_m3u) return rows[0];
  }

  const anyResponse = await supabaseFetch(
    env,
    "usuarios?select=usuario,senha,cargo,lista_m3u,userxc,senhaxc,urlxc&lista_m3u=not.is.null&limit=1"
  );
  if (!anyResponse.ok) throw new Error(`Erro ao localizar provedor: HTTP ${anyResponse.status}`);
  const rows = await anyResponse.json();
  if (!rows?.[0]?.lista_m3u) throw new Error("Nenhuma lista de provedor foi encontrada.");
  return rows[0];
}

async function getProviderManifest(env) {
  return readR2Json(env, `${PROVIDER_ROOT}/manifest.json`);
}

function providerManifestIsFresh(manifest) {
  const time = Date.parse(manifest?.syncedAt || "");
  return Number.isFinite(time) && Date.now() - time < PROVIDER_MIN_SYNC_MS;
}

async function syncSharedProviderCatalog(env, { force = false } = {}) {
  const previousManifest = await getProviderManifest(env);
  if (!force && providerManifestIsFresh(previousManifest)) {
    return { status: "current", ...previousManifest };
  }

  const provider = await getProviderUser(env);
  const sourceUrl = String(provider.lista_m3u || "").trim();
  if (!/^https?:\/\//i.test(sourceUrl)) throw new Error("A lista mestre do provedor não é HTTP/HTTPS.");

  const xtreamSource = getXtreamSourceFromUser(provider);
  if (!xtreamSource) throw new Error("Não foi possível obter as credenciais Xtream do provedor.");

  const version = String(Date.now());
  const versionPrefix = `${PROVIDER_ROOT}/${version}`;
  const playlistKey = `${versionPrefix}/playlist.m3u`;

  const playlistResponse = await fetchWithTimeout(
    sourceUrl,
    { headers: { "User-Agent": "Lux-Playlist-Sync/1.6" } },
    120000
  );
  if (!playlistResponse.ok) throw new Error(`Playlist do provedor respondeu HTTP ${playlistResponse.status}`);

  const playlistBytes = await saveRemoteResponseToR2(
    env,
    playlistKey,
    playlistResponse,
    "audio/x-mpegurl; charset=utf-8",
    "public, max-age=31536000, immutable"
  );

  const saved = [];
  try {
    for (const part of catalogParts) {
      saved.push(await syncCatalogPart(env, xtreamSource, versionPrefix, part));
    }
  } catch (error) {
    await deleteProviderVersion(env, version);
    throw error;
  }

  const files = {};
  const bytes = { playlist: playlistBytes };
  saved.forEach(part => {
    files[part.name] = `${baseUrl(env)}/${versionPrefix}/${part.filename}`;
    bytes[part.name] = part.bytes;
  });

  const syncedAt = new Date().toISOString();
  const manifest = {
    schemaVersion: 3,
    scope: "provider",
    version,
    previousVersion: String(previousManifest?.version || ""),
    syncedAt,
    playlist: `${baseUrl(env)}/${playlistKey}`,
    files,
    bytes
  };

  // Publicação atômica: o manifesto só muda depois que playlist + 6 JSONs existem.
  await env.LISTS_BUCKET.put(`${PROVIDER_ROOT}/manifest.json`, JSON.stringify(manifest), {
    httpMetadata: r2HttpMetadata("application/json; charset=utf-8", "no-cache, no-store, max-age=0")
  });

  // Mantém a versão anterior disponível; remove apenas a versão de duas gerações atrás.
  if (previousManifest?.previousVersion) {
    await deleteProviderVersion(env, previousManifest.previousVersion);
  }

  return { status: "success", ...manifest };
}

async function readPreviousCatalogManifest(env, username) {
  return readR2Json(env, `catalogos/${encodeURIComponent(username)}/manifest.json`);
}

async function cleanupOldCatalog(env, username, previousManifest, currentVersion) {
  const oldVersion = String(previousManifest?.version || "");
  if (!oldVersion || oldVersion === currentVersion) return;
  const prefix = `catalogos/${encodeURIComponent(username)}/${oldVersion}`;
  await Promise.allSettled(
    catalogParts.map(([, , filename]) => env.LISTS_BUCKET.delete(`${prefix}/${filename}`))
  );
}

async function syncXtreamCatalog(env, username, source, playlistUrl) {
  const version = String(Date.now());
  const encodedUser = encodeURIComponent(username);
  const versionPrefix = `catalogos/${encodedUser}/${version}`;
  const previousManifest = await readPreviousCatalogManifest(env, username);
  const saved = [];
  for (const part of catalogParts) saved.push(await syncCatalogPart(env, source, versionPrefix, part));

  const files = {};
  const bytes = {};
  saved.forEach(part => {
    files[part.name] = `${baseUrl(env)}/${versionPrefix}/${part.filename}`;
    bytes[part.name] = part.bytes;
  });

  const manifest = {
    schemaVersion: 2,
    version,
    syncedAt: new Date().toISOString(),
    playlist: playlistUrl,
    files,
    bytes
  };

  const manifestKey = `catalogos/${encodedUser}/manifest.json`;
  await env.LISTS_BUCKET.put(manifestKey, JSON.stringify(manifest), {
    httpMetadata: r2HttpMetadata("application/json; charset=utf-8")
  });
  await cleanupOldCatalog(env, username, previousManifest, version);
  return { url: `${baseUrl(env)}/${manifestKey}`, version, files: Object.keys(files), bytes };
}

async function syncPlaylistOnly(env, user) {
  const username = String(user.usuario || "").trim();
  const sourceUrl = String(user.lista_m3u || "").trim();
  if (!username || !/^https?:\/\//i.test(sourceUrl)) {
    return { usuario: username, status: "skipped", message: "Sem URL HTTP/HTTPS válida" };
  }

  try {
    const playlistResponse = await fetchWithTimeout(
      sourceUrl,
      { headers: { "User-Agent": "Lux-Playlist-Sync/1.6" } },
      120000
    );
    if (!playlistResponse.ok) throw new Error(`Fornecedor respondeu HTTP ${playlistResponse.status}`);

    const encodedUser = encodeURIComponent(username);
    const objectKey = `listas/${encodedUser}.m3u`;
    const playlistBytes = await saveRemoteResponseToR2(
      env,
      objectKey,
      playlistResponse,
      "audio/x-mpegurl; charset=utf-8",
      "no-cache, no-store, max-age=0"
    );

    const httpsUrl = `${baseUrl(env)}/${objectKey}`;
    const syncedAt = new Date().toISOString();
    await updateUser(env, username, {
      lista_m3u_https: httpsUrl,
      lista_m3u_sync_at: syncedAt,
      lista_m3u_sync_status: "success",
      lista_m3u_sync_error: null
    });

    return { usuario: username, status: "success", url: httpsUrl, playlistBytes, syncedAt, mode: "playlist-only" };
  } catch (error) {
    await updateUser(env, username, {
      lista_m3u_sync_at: new Date().toISOString(),
      lista_m3u_sync_status: "error",
      lista_m3u_sync_error: error?.message || "Erro desconhecido"
    });
    return { usuario: username, status: "error", message: error?.message || "Erro desconhecido", mode: "playlist-only" };
  }
}

async function syncUser(env, user) {
  const username = String(user.usuario || "").trim();
  const sourceUrl = String(user.lista_m3u || "").trim();
  if (!username || !/^https?:\/\//i.test(sourceUrl)) {
    return { usuario: username, status: "skipped", message: "Sem URL HTTP/HTTPS válida" };
  }

  try {
    const playlistResponse = await fetchWithTimeout(sourceUrl, { headers: { "User-Agent": "Lux-Playlist-Sync/1.6" } }, 120000);
    if (!playlistResponse.ok) throw new Error(`Fornecedor respondeu HTTP ${playlistResponse.status}`);

    const encodedUser = encodeURIComponent(username);
    const objectKey = `listas/${encodedUser}.m3u`;
    const playlistBytes = await saveRemoteResponseToR2(
      env,
      objectKey,
      playlistResponse,
      "audio/x-mpegurl; charset=utf-8",
      "no-cache, no-store, max-age=0"
    );
    const httpsUrl = `${baseUrl(env)}/${objectKey}`;
    const xtreamSource = getXtreamSourceFromUser(user);

    let catalog = null;
    let catalogError = null;
    if (xtreamSource) {
      try {
        catalog = await syncXtreamCatalog(env, username, xtreamSource, httpsUrl);
      } catch (error) {
        catalogError = error?.message || "Falha ao sincronizar catálogo Xtream";
      }
    }

    await updateUser(env, username, {
      lista_m3u_https: httpsUrl,
      lista_m3u_sync_at: new Date().toISOString(),
      lista_m3u_sync_status: catalogError ? "partial" : "success",
      lista_m3u_sync_error: catalogError
    });

    return {
      usuario: username,
      status: catalogError ? "partial" : "success",
      url: httpsUrl,
      playlistBytes,
      catalog: catalog
        ? { status: "success", ...catalog }
        : xtreamSource
          ? { status: "error", message: catalogError }
          : { status: "skipped", message: "A URL não contém credenciais Xtream reconhecíveis" }
    };
  } catch (error) {
    await updateUser(env, username, {
      lista_m3u_sync_at: new Date().toISOString(),
      lista_m3u_sync_status: "error",
      lista_m3u_sync_error: error?.message || "Erro desconhecido"
    });
    return { usuario: username, status: "error", message: error?.message || "Erro desconhecido" };
  }
}

async function syncOneByUsername(env, username) {
  const user = await getUserByUsername(env, username);
  if (!user) throw new Error("Usuário não encontrado.");
  return syncUser(env, user);
}

async function getUsersWithPlaylists(env) {
  const response = await supabaseFetch(env, "usuarios?select=usuario,lista_m3u,userxc,senhaxc,urlxc&lista_m3u=not.is.null");
  if (!response.ok) throw new Error(`Erro ao consultar usuários: HTTP ${response.status}`);
  return response.json();
}

async function syncAll(env) {
  const users = await getUsersWithPlaylists(env);
  const results = [];
  for (const user of users) results.push(await syncUser(env, user));
  return results;
}

async function serveR2Object(request, env) {
  const url = new URL(request.url);
  const objectKey = url.pathname.slice(1);
  const object = await env.LISTS_BUCKET.get(objectKey);
  if (!object) return new Response("Arquivo não encontrado", { status: 404, headers: corsHeaders });

  const headers = new Headers(corsHeaders);
  const isJson = url.pathname.endsWith(".json");
  headers.set("Content-Type", isJson ? "application/json; charset=utf-8" : "audio/x-mpegurl; charset=utf-8");
  const isProviderVersioned = /^\/provider\/\d+\//.test(url.pathname);
  headers.set("Cache-Control", isProviderVersioned ? "public, max-age=31536000, immutable" : "no-cache, no-store, max-age=0");
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
}

async function readJsonBody(request) {
  try { return await request.json(); }
  catch { return {}; }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const manifest = await getProviderManifest(env);
      return json({ ok: true, worker: "lux-playlist-sync", version: WORKER_VERSION, provider: manifest ? { version: manifest.version, syncedAt: manifest.syncedAt } : null });
    }

    if (
      request.method === "GET" &&
      (url.pathname.startsWith("/listas/") || url.pathname.startsWith("/catalogos/") || url.pathname.startsWith("/provider/"))
    ) {
      return serveR2Object(request, env);
    }

    if (request.method === "POST" && url.pathname === "/sync-self") {
      const body = await readJsonBody(request);
      try {
        const account = await authenticateUser(env, body.username, body.password);
        const result = await syncSharedProviderCatalog(env, { force: false });
        await updateUser(env, account.usuario, {
          lista_m3u_sync_at: new Date().toISOString(),
          lista_m3u_sync_status: "success",
          lista_m3u_sync_error: null
        });
        return json({ ok: true, result });
      } catch (error) {
        const message = error?.message || "Falha ao atualizar o provedor.";
        return json({ ok: false, error: message }, /Credenciais/i.test(message) ? 401 : 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/sync-provider") {
      const body = await readJsonBody(request);
      try {
        await authenticateAdmin(env, body.username, body.password);
        const result = await syncSharedProviderCatalog(env, { force: true });
        return json({ ok: true, result });
      } catch (error) {
        const message = error?.message || "Falha ao sincronizar o provedor.";
        return json({ ok: false, error: message }, /Credenciais|administradores/i.test(message) ? 401 : 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/sync-account") {
      const body = await readJsonBody(request);
      try {
        const admin = await authenticateAdmin(env, body.username, body.password);
        const targetUsername = String(body.targetUsername || admin.usuario || "").trim();
        const target = await getUserByUsername(env, targetUsername);
        if (!target) throw new Error("Usuário a sincronizar não encontrado.");
        const result = await syncUser(env, target);
        const ok = result.status !== "error";
        return json({ ok, result }, result.status === "error" ? 502 : 200);
      } catch (error) {
        const message = error?.message || "Falha ao sincronizar conta.";
        return json({ ok: false, error: message }, /Credenciais|administradores/i.test(message) ? 401 : 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/sync") {
      if (request.headers.get("X-Sync-Token") !== env.SYNC_TOKEN) return json({ error: "Não autorizado" }, 401);
      try {
        const body = await readJsonBody(request);
        const result = body.provider === true
          ? await syncSharedProviderCatalog(env, { force: true })
          : body.username
            ? await syncOneByUsername(env, String(body.username))
            : await syncAll(env);
        return json({ ok: true, results: Array.isArray(result) ? result : [result] });
      } catch (error) {
        return json({ ok: false, error: error?.message || "Erro desconhecido" }, 500);
      }
    }

    return json({ ok: true, message: "Lux Playlist Sync ativo", version: WORKER_VERSION });
  },

  async scheduled(controller, env, ctx) {
    // O cron passa a atualizar uma única fonte mestre do provedor.
    ctx.waitUntil(syncSharedProviderCatalog(env, { force: true }));
  }
};