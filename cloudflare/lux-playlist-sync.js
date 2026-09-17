const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Sync-Token",
  "Cache-Control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
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
    `usuarios?select=usuario,cargo,lista_m3u&usuario=eq.${encodeURIComponent(username)}&limit=1`
  );
  if (!response.ok) throw new Error(`Erro ao consultar usuário: HTTP ${response.status}`);
  const rows = await response.json();
  return rows?.[0] || null;
}

async function resolveLuxAccount(env, username, credential) {
  const cleanUsername = String(username || "").trim();
  const cleanCredential = String(credential || "");
  if (!cleanUsername || !cleanCredential) return null;

  const response = await supabaseFetch(env, "rpc/lux_auth_resolve", {
    method: "POST",
    body: JSON.stringify({
      p_username: cleanUsername,
      p_credential: cleanCredential
    })
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.warn("[Lux Playlist Sync] Falha ao validar sessão no Supabase:", response.status, details);
    throw new Error(`Erro ao validar sessão: HTTP ${response.status}`);
  }

  const account = await response.json().catch(() => null);
  return Array.isArray(account) ? (account[0] || null) : account;
}

async function authenticateAdmin(env, username, credential) {
  const account = await resolveLuxAccount(env, username, credential);
  if (!account || typeof account !== "object") {
    throw new Error("Credenciais inválidas.");
  }
  if (String(account.cargo || "").trim().toLowerCase() !== "admin") {
    throw new Error("Apenas administradores podem iniciar a sincronização manual.");
  }
  return account;
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

async function readPreviousCatalogManifest(env, username) {
  try {
    const key = `catalogos/${encodeURIComponent(username)}/manifest.json`;
    const object = await env.LISTS_BUCKET.get(key);
    if (!object) return null;
    return JSON.parse(await object.text());
  } catch {
    return null;
  }
}

function r2HttpMetadata(contentType) {
  return {
    contentType,
    cacheControl: "no-cache, no-store, max-age=0"
  };
}

async function saveRemoteResponseToR2(env, key, response, contentType) {
  if (!response.body) throw new Error("Fornecedor retornou resposta sem conteúdo.");

  const rawLength = response.headers.get("content-length");
  const contentLength = /^\d+$/.test(String(rawLength || "")) ? Number(rawLength) : 0;
  const options = { httpMetadata: r2HttpMetadata(contentType) };

  // Quando o fornecedor informa o tamanho, mantemos streaming real sem bufferizar.
  if (Number.isSafeInteger(contentLength) && contentLength > 0) {
    const fixed = new FixedLengthStream(contentLength);
    await Promise.all([
      response.body.pipeTo(fixed.writable),
      env.LISTS_BUCKET.put(key, fixed.readable, options)
    ]);
    return contentLength;
  }

  // Alguns servidores Xtream respondem em chunked transfer e não enviam
  // Content-Length. R2 não aceita um ReadableStream de tamanho desconhecido
  // em put(), então neste caso usamos um valor de tamanho fixo (ArrayBuffer).
  const buffer = await response.arrayBuffer();
  await env.LISTS_BUCKET.put(key, buffer, options);
  return buffer.byteLength;
}

async function syncCatalogPart(env, source, versionPrefix, part) {
  const [name, action, filename] = part;
  const response = await fetchWithTimeout(
    xtreamUrl(source, action),
    { headers: { "User-Agent": "Lux-Playlist-Sync/1.6" } }
  );

  if (!response.ok) {
    throw new Error(`${action}: fornecedor respondeu HTTP ${response.status}`);
  }

  const key = `${versionPrefix}/${filename}`;
  const bytes = await saveRemoteResponseToR2(
    env,
    key,
    response,
    "application/json; charset=utf-8"
  );

  return { name, filename, bytes };
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

  // Um endpoint grande por vez. Se o fornecedor vier sem Content-Length,
  // o fallback precisa bufferizar somente aquele arquivo, nunca vários juntos.
  for (const part of catalogParts) {
    saved.push(await syncCatalogPart(env, source, versionPrefix, part));
  }

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

  return {
    url: `${baseUrl(env)}/${manifestKey}`,
    version,
    files: Object.keys(files),
    bytes
  };
}

async function syncUser(env, user, options = {}) {
  const username = String(user.usuario || "").trim();
  const sourceUrl = String(user.lista_m3u || "").trim();

  if (!username || !/^https?:\/\//i.test(sourceUrl)) {
    return { usuario: username, status: "skipped", message: "Sem URL HTTP/HTTPS válida" };
  }

  const syncStartedAt = new Date().toISOString();
  await updateUser(env, username, {
    lista_m3u_sync_at: syncStartedAt,
    lista_m3u_sync_status: "syncing",
    lista_m3u_sync_error: null
  }).catch(() => {});

  try {
    const playlistResponse = await fetchWithTimeout(
      sourceUrl,
      {
        headers: {
          "User-Agent": "Lux-Playlist-Sync/1.6",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache"
        },
        cf: options.force ? { cacheTtl: 0, cacheEverything: false } : undefined
      },
      120000
    );

    if (!playlistResponse.ok) {
      throw new Error(`Fornecedor respondeu HTTP ${playlistResponse.status}`);
    }

    const encodedUser = encodeURIComponent(username);
    const objectKey = `listas/${encodedUser}.m3u`;
    const playlistBytes = await saveRemoteResponseToR2(
      env,
      objectKey,
      playlistResponse,
      "audio/x-mpegurl; charset=utf-8"
    );

    const httpsUrl = `${baseUrl(env)}/${objectKey}`;
    const xtreamSource = getXtreamSource(sourceUrl);

    let catalog = null;
    let catalogError = null;

    if (xtreamSource) {
      try {
        catalog = await syncXtreamCatalog(env, username, xtreamSource, httpsUrl);
      } catch (error) {
        catalogError = error?.message || "Falha ao sincronizar catálogo Xtream";
        console.warn(`[Lux Playlist Sync] Catálogo de ${username}:`, error);
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

    return {
      usuario: username,
      status: "error",
      message: error?.message || "Erro desconhecido"
    };
  }
}

async function syncOneByUsername(env, username) {
  const user = await getUserByUsername(env, username);
  if (!user) throw new Error("Usuário não encontrado.");
  return syncUser(env, user);
}

async function syncAll(env) {
  const response = await supabaseFetch(
    env,
    "usuarios?select=usuario,lista_m3u&lista_m3u=not.is.null"
  );

  if (!response.ok) {
    throw new Error(`Erro ao consultar usuários: HTTP ${response.status}`);
  }

  const users = await response.json();
  const results = [];

  // Cron conservador: uma conta por vez. O catálogo de cada conta já faz
  // bastante I/O e isso evita picos de memória/subrequests no Worker.
  for (const user of users) {
    results.push(await syncUser(env, user));
  }

  return results;
}

async function serveR2Object(request, env) {
  const url = new URL(request.url);
  const objectKey = url.pathname.slice(1);
  const object = await env.LISTS_BUCKET.get(objectKey);

  if (!object) {
    return new Response("Arquivo não encontrado", { status: 404, headers: corsHeaders });
  }

  const headers = new Headers(corsHeaders);
  headers.set(
    "Content-Type",
    url.pathname.endsWith(".json")
      ? "application/json; charset=utf-8"
      : "audio/x-mpegurl; charset=utf-8"
  );
  headers.set("Cache-Control", "no-cache, no-store, max-age=0");
  headers.set("ETag", object.httpEtag);

  return new Response(object.body, { headers });
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, worker: "lux-playlist-sync", version: "1.6.5" });
    }

    if (
      request.method === "GET" &&
      (url.pathname.startsWith("/listas/") || url.pathname.startsWith("/catalogos/"))
    ) {
      return serveR2Object(request, env);
    }

    // Painel Admin: valida senha legada OU sessão luxsess_ e sincroniza a conta escolhida.
    if (request.method === "POST" && url.pathname === "/sync-account") {
      const body = await readJsonBody(request);
      try {
        const credential = body.credential ?? body.password;
        const admin = await authenticateAdmin(env, body.username, credential);
        const targetUsername = String(body.targetUsername || admin.usuario || "").trim();
        const target = await getUserByUsername(env, targetUsername);
        if (!target) throw new Error("Usuário a sincronizar não encontrado.");

        const result = await syncUser(env, target, { force: body.force !== false });
        const ok = result.status !== "error";
        return json({ ok, result }, result.status === "error" ? 502 : 200);
      } catch (error) {
        const message = error?.message || "Falha ao sincronizar conta.";
        const status = /Credenciais|administradores/i.test(message) ? 401 : 500;
        return json({ ok: false, error: message }, status);
      }
    }

    // PowerShell/admin técnico. Com { username } sincroniza uma conta; sem body, todas.
    if (request.method === "POST" && url.pathname === "/sync") {
      if (request.headers.get("X-Sync-Token") !== env.SYNC_TOKEN) {
        return json({ error: "Não autorizado" }, 401);
      }

      try {
        const body = await readJsonBody(request);
        const result = body.username
          ? await syncOneByUsername(env, String(body.username))
          : await syncAll(env);
        return json({ ok: true, results: Array.isArray(result) ? result : [result] });
      } catch (error) {
        return json({ ok: false, error: error?.message || "Erro desconhecido" }, 500);
      }
    }

    return json({
      ok: true,
      message: "Lux Playlist Sync ativo",
      version: "1.6.5"
    });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(syncAll(env));
  }
};
