const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Sync-Token",
  "Cache-Control": "no-store"
};

const WORKER_VERSION = "1.6.3-user-snapshot1";
const USER_SNAPSHOT_SCHEMA = 5;
const SYNC_BATCH_SIZE = 5;
const SYNC_CURSOR_KEY = "_system/user-snapshot-cursor.json";

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
  const response = await supabaseFetch(env, `usuarios?usuario=eq.${encodeURIComponent(username)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error(`Erro ao atualizar usuário: HTTP ${response.status}`);
}

async function getUserByUsername(env, username) {
  const response = await supabaseFetch(
    env,
    `usuarios?select=usuario,senha,cargo,lista_m3u,lista_m3u_https,userxc,senhaxc,urlxc&usuario=eq.${encodeURIComponent(username)}&limit=1`
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
    const url = new URL(String(sourceUrl || "").trim());
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
  return getXtreamSource(user?.lista_m3u);
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
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

function userRoot(username) {
  return `catalogos/${encodeURIComponent(String(username || "").trim())}`;
}

async function readUserManifest(env, username) {
  return readR2Json(env, `${userRoot(username)}/manifest.json`);
}

async function deleteUserSnapshotVersion(env, username, version) {
  const clean = String(version || "").trim();
  if (!clean) return;
  const prefix = `${userRoot(username)}/${clean}`;
  await Promise.allSettled([
    env.LISTS_BUCKET.delete(`${prefix}/playlist.m3u`),
    env.LISTS_BUCKET.delete(`${prefix}/manifest.json`),
    ...catalogParts.map(([, , filename]) => env.LISTS_BUCKET.delete(`${prefix}/${filename}`))
  ]);
}

async function syncCatalogPart(env, source, versionPrefix, part) {
  const [name, action, filename] = part;
  const response = await fetchWithTimeout(
    xtreamUrl(source, action),
    { headers: { "User-Agent": "Lux-Playlist-Sync/1.6" } },
    120000
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

async function syncUserSnapshot(env, user) {
  const username = String(user?.usuario || "").trim();
  const sourceUrl = String(user?.lista_m3u || "").trim();

  if (!username || !/^https?:\/\//i.test(sourceUrl)) {
    return { usuario: username, status: "skipped", message: "Sem URL HTTP/HTTPS válida", mode: "user-snapshot" };
  }

  const previousManifest = await readUserManifest(env, username);
  const version = String(Date.now());
  const root = userRoot(username);
  const versionPrefix = `${root}/${version}`;
  const playlistKey = `${versionPrefix}/playlist.m3u`;
  const playlistUrl = `${baseUrl(env)}/${playlistKey}`;
  const versionManifestKey = `${versionPrefix}/manifest.json`;
  const stableManifestKey = `${root}/manifest.json`;
  const xtreamSource = getXtreamSourceFromUser(user);
  const savedParts = [];

  try {
    const playlistResponse = await fetchWithTimeout(
      sourceUrl,
      { headers: { "User-Agent": "Lux-Playlist-Sync/1.6" } },
      120000
    );
    if (!playlistResponse.ok) throw new Error(`Playlist: fornecedor respondeu HTTP ${playlistResponse.status}`);

    const playlistBytes = await saveRemoteResponseToR2(
      env,
      playlistKey,
      playlistResponse,
      "audio/x-mpegurl; charset=utf-8",
      "public, max-age=31536000, immutable"
    );

    if (xtreamSource) {
      // Intencionalmente sequencial: o servidor trabalha em silêncio sem martelar o provedor.
      for (const part of catalogParts) {
        savedParts.push(await syncCatalogPart(env, xtreamSource, versionPrefix, part));
      }
    }

    const files = {};
    const bytes = { playlist: playlistBytes };
    savedParts.forEach(part => {
      files[part.name] = `${baseUrl(env)}/${versionPrefix}/${part.filename}`;
      bytes[part.name] = part.bytes;
    });

    const syncedAt = new Date().toISOString();
    const manifest = {
      schemaVersion: USER_SNAPSHOT_SCHEMA,
      scope: xtreamSource ? "user-full-snapshot" : "user-playlist-snapshot",
      username,
      version,
      previousVersion: String(previousManifest?.version || ""),
      syncedAt,
      playlist: playlistUrl,
      files,
      bytes
    };

    // 1) grava um manifesto imutável dentro da própria versão;
    // 2) só então troca o ponteiro do usuário no banco;
    // 3) por último publica o alias estável.
    // Assim ninguém vê uma versão pela metade.
    await env.LISTS_BUCKET.put(versionManifestKey, JSON.stringify(manifest), {
      httpMetadata: r2HttpMetadata("application/json; charset=utf-8", "public, max-age=31536000, immutable")
    });

    await updateUser(env, username, {
      lista_m3u_https: playlistUrl,
      lista_m3u_sync_at: syncedAt,
      lista_m3u_sync_status: "success",
      lista_m3u_sync_error: null
    });

    await env.LISTS_BUCKET.put(stableManifestKey, JSON.stringify(manifest), {
      httpMetadata: r2HttpMetadata("application/json; charset=utf-8", "no-cache, no-store, max-age=0")
    });

    // Mantém uma geração anterior como margem para sessões que já estavam abertas.
    // A geração "avó" some apenas depois da troca estar concluída.
    if (previousManifest?.previousVersion) {
      await deleteUserSnapshotVersion(env, username, previousManifest.previousVersion);
    }

    // O arquivo legado só some depois que já existia um snapshot anterior completo.
    if (Number(previousManifest?.schemaVersion || 0) >= USER_SNAPSHOT_SCHEMA) {
      await env.LISTS_BUCKET.delete(`listas/${encodeURIComponent(username)}.m3u`).catch(() => null);
    }

    return {
      usuario: username,
      status: "success",
      mode: manifest.scope,
      url: playlistUrl,
      manifest: `${baseUrl(env)}/${versionManifestKey}`,
      version,
      previousVersion: manifest.previousVersion,
      syncedAt,
      files: Object.keys(files),
      bytes
    };
  } catch (error) {
    await deleteUserSnapshotVersion(env, username, version);
    try {
      await updateUser(env, username, {
        lista_m3u_sync_at: new Date().toISOString(),
        lista_m3u_sync_status: "error",
        lista_m3u_sync_error: error?.message || "Erro desconhecido"
      });
    } catch (_) {}

    return {
      usuario: username,
      status: "error",
      mode: "user-snapshot",
      message: error?.message || "Erro desconhecido"
    };
  }
}

async function getUsersWithPlaylists(env) {
  const response = await supabaseFetch(
    env,
    "usuarios?select=usuario,lista_m3u,lista_m3u_https,userxc,senhaxc,urlxc&lista_m3u=not.is.null"
  );
  if (!response.ok) throw new Error(`Erro ao consultar usuários: HTTP ${response.status}`);
  return response.json();
}

async function syncAllUserSnapshots(env) {
  const users = await getUsersWithPlaylists(env);
  const results = [];

  // Sequencial de propósito: pode levar mais tempo, mas evita picos no provedor
  // e só troca cada usuário depois do snapshot completo.
  for (const user of users) {
    results.push(await syncUserSnapshot(env, user));
  }

  return results;
}

async function syncNextUserBatch(env, limit = SYNC_BATCH_SIZE) {
  const users = (await getUsersWithPlaylists(env))
    .slice()
    .sort((a, b) => String(a?.usuario || "").localeCompare(String(b?.usuario || ""), "pt-BR"));

  if (!users.length) {
    return { results: [], batchSize: 0, total: 0, nextIndex: 0, completedCycle: true };
  }

  const cursor = await readR2Json(env, SYNC_CURSOR_KEY);
  let startIndex = Number(cursor?.nextIndex || 0);
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= users.length) startIndex = 0;

  const safeLimit = Math.max(1, Math.min(Number(limit) || SYNC_BATCH_SIZE, SYNC_BATCH_SIZE));
  const selected = users.slice(startIndex, startIndex + safeLimit);
  const results = [];

  for (const user of selected) {
    results.push(await syncUserSnapshot(env, user));
  }

  const rawNext = startIndex + selected.length;
  const completedCycle = rawNext >= users.length;
  const nextIndex = completedCycle ? 0 : rawNext;

  await env.LISTS_BUCKET.put(SYNC_CURSOR_KEY, JSON.stringify({
    nextIndex,
    total: users.length,
    updatedAt: new Date().toISOString()
  }), {
    httpMetadata: r2HttpMetadata("application/json; charset=utf-8", "no-cache, no-store, max-age=0")
  });

  return {
    results,
    batchSize: selected.length,
    total: users.length,
    startIndex,
    nextIndex,
    completedCycle
  };
}

async function serveR2Object(request, env) {
  const url = new URL(request.url);
  const objectKey = url.pathname.slice(1);
  const object = await env.LISTS_BUCKET.get(objectKey);
  if (!object) return new Response("Arquivo não encontrado", { status: 404, headers: corsHeaders });

  const headers = new Headers(corsHeaders);
  const isJson = url.pathname.endsWith(".json");
  headers.set("Content-Type", isJson ? "application/json; charset=utf-8" : "audio/x-mpegurl; charset=utf-8");

  const immutableVersion =
    /^\/catalogos\/[^/]+\/\d+\//.test(url.pathname) ||
    /^\/provider\/\d+\//.test(url.pathname);
  headers.set("Cache-Control", immutableVersion
    ? "public, max-age=31536000, immutable"
    : "no-cache, no-store, max-age=0"
  );
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
      return json({
        ok: true,
        worker: "lux-playlist-sync",
        version: WORKER_VERSION,
        mode: "per-user-atomic-https-snapshots"
      });
    }

    if (
      request.method === "GET" &&
      (
        url.pathname.startsWith("/listas/") ||
        url.pathname.startsWith("/catalogos/") ||
        url.pathname.startsWith("/provider/")
      )
    ) {
      return serveR2Object(request, env);
    }

    if (request.method === "POST" && url.pathname === "/sync-self") {
      const body = await readJsonBody(request);
      try {
        const account = await authenticateUser(env, body.username, body.password);
        const result = await syncUserSnapshot(env, account);
        return json({ ok: result.status !== "error", result }, result.status === "error" ? 502 : 200);
      } catch (error) {
        const message = error?.message || "Falha ao atualizar a conta.";
        return json({ ok: false, error: message }, /Credenciais/i.test(message) ? 401 : 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/sync-account") {
      const body = await readJsonBody(request);
      try {
        const admin = await authenticateAdmin(env, body.username, body.password);
        const targetUsername = String(body.targetUsername || admin.usuario || "").trim();
        const target = await getUserByUsername(env, targetUsername);
        if (!target) throw new Error("Usuário a sincronizar não encontrado.");
        const result = await syncUserSnapshot(env, target);
        return json({ ok: result.status !== "error", result }, result.status === "error" ? 502 : 200);
      } catch (error) {
        const message = error?.message || "Falha ao sincronizar conta.";
        return json({ ok: false, error: message }, /Credenciais|administradores/i.test(message) ? 401 : 500);
      }
    }

    // Mantém a rota usada pelo painel antigo, mas agora ela processa um lote pequeno.
    if (request.method === "POST" && url.pathname === "/sync-provider") {
      const body = await readJsonBody(request);
      try {
        await authenticateAdmin(env, body.username, body.password);
        const batch = await syncNextUserBatch(env);
        return json({
          ok: !batch.results.some(row => row.status === "error"),
          mode: "user-snapshot-batch",
          ...batch
        });
      } catch (error) {
        const message = error?.message || "Falha ao sincronizar as listas.";
        return json({ ok: false, error: message }, /Credenciais|administradores/i.test(message) ? 401 : 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/sync") {
      if (request.headers.get("X-Sync-Token") !== env.SYNC_TOKEN) {
        return json({ error: "Não autorizado" }, 401);
      }

      try {
        const body = await readJsonBody(request);
        if (body.username) {
          const user = await getUserByUsername(env, String(body.username));
          if (!user) throw new Error("Usuário não encontrado.");
          const result = await syncUserSnapshot(env, user);
          return json({ ok: result.status !== "error", result }, result.status === "error" ? 502 : 200);
        }

        if (body.all === true) {
          const results = await syncAllUserSnapshots(env);
          return json({
            ok: !results.some(row => row.status === "error"),
            mode: "all-user-snapshots",
            results
          });
        }

        const batch = await syncNextUserBatch(env, body.limit);
        return json({
          ok: !batch.results.some(row => row.status === "error"),
          mode: "user-snapshot-batch",
          ...batch
        });
      } catch (error) {
        return json({ ok: false, error: error?.message || "Erro desconhecido" }, 500);
      }
    }

    return json({
      ok: true,
      message: "Lux Playlist Sync ativo",
      version: WORKER_VERSION,
      mode: "per-user-atomic-https-snapshots"
    });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      const batch = await syncNextUserBatch(env);
      const failed = batch.results.filter(row => row.status === "error");
      if (failed.length) {
        console.error("[Lux Sync] Algumas contas do lote falharam:", failed.map(row => ({
          usuario: row.usuario,
          message: row.message
        })));
      }
      console.info("[Lux Sync] Lote concluído.", {
        batchSize: batch.batchSize,
        total: batch.total,
        nextIndex: batch.nextIndex,
        completedCycle: batch.completedCycle
      });
    })());
  }
};