import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { load } from "npm:cheerio@1.0.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store"
};

const PROGRAM_URL = "https://superplacar.com.br/programacao/";
const LIVE_URL = "https://superplacar.com.br/agora/";
const CACHE_KEY = "superplacar-v1";
const CACHE_TTL_MS = 45_000;

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });
const clean = (value: unknown) => String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const normalize = (value: unknown) => clean(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

function htmlLines(html: string) {
  const $ = load(html);
  $("script,style,noscript,svg,iframe").remove();
  $("br,tr,td,th,h1,h2,h3,h4,h5,h6,li,p,section,article,header,footer,a").each((_, el) => {
    $(el).append("\n");
  });
  return $("body").text().split(/\n+/).map(clean).filter(Boolean);
}

function saoPauloParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function parseDateLabel(label: string) {
  const match = label.match(/^(Hoje|Amanh[aã])\s*-\s*(\d{2})\/(\d{2})$/i);
  if (!match) return null;
  const now = saoPauloParts();
  let year = Number(now.year);
  const day = Number(match[2]);
  const month = Number(match[3]);
  if (/amanh/i.test(match[1]) && Number(now.month) === 12 && month === 1) year += 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function kickoffIso(date: string, time: string) {
  return `${date}T${time}:00-03:00`;
}

function gameId(date: string, home: string, away: string) {
  return `${date}:${normalize(home)}:${normalize(away)}`;
}

function parseProgramming(html: string) {
  const lines = htmlLines(html);
  const games: any[] = [];
  let date = "";
  let dateLabel = "";

  for (let i = 0; i < lines.length; i += 1) {
    const possibleDate = parseDateLabel(lines[i]);
    if (possibleDate) {
      date = possibleDate;
      dateLabel = lines[i].split("-")[0].trim();
      continue;
    }
    if (!date || !/^\d{2}:\d{2}$/.test(lines[i])) continue;

    const time = lines[i];
    const competition = clean(lines[i + 1]);
    const home = clean(lines[i + 2]);
    const separator = clean(lines[i + 3]);
    const away = clean(lines[i + 4]);
    const broadcastText = clean(lines[i + 5]);
    if (!competition || !home || !away || !/^x$/i.test(separator)) continue;

    const broadcasters = broadcastText.split(",").map(clean).filter(Boolean);

    games.push({
      id: gameId(date, home, away),
      date,
      date_label: dateLabel,
      time,
      kickoff: kickoffIso(date, time),
      competition,
      home,
      away,
      broadcasters,
      status: "scheduled",
      score_home: null,
      score_away: null,
      source: "Super Placar"
    });
  }

  return games;
}

function parseLive(html: string) {
  const lines = htmlLines(html);
  const games: any[] = [];
  let date = "";
  let competition = "";

  for (let i = 0; i < lines.length; i += 1) {
    const possibleDate = parseDateLabel(lines[i]);
    if (possibleDate) {
      date = possibleDate;
      continue;
    }
    if (!date) continue;

    if (i + 1 < lines.length && /^Em andamento\s*-\s*\d{2}:\d{2}$/i.test(lines[i + 1])) {
      competition = clean(lines[i]).replace(/\s+20\d{2}$/i, "");
      continue;
    }

    const status = lines[i].match(/^Em andamento\s*-\s*(\d{2}:\d{2})$/i);
    if (!status) continue;
    const time = status[1];
    const home = clean(lines[i + 1]);
    const score = clean(lines[i + 2]).match(/^(\d+)\s*-\s*(\d+)$/);
    const away = clean(lines[i + 3]);
    if (!home || !away || !score) continue;

    games.push({
      id: gameId(date, home, away),
      date,
      time,
      kickoff: kickoffIso(date, time),
      competition,
      home,
      away,
      status: "live",
      score_home: Number(score[1]),
      score_away: Number(score[2])
    });
    i += 3;
  }
  return games;
}

function mergeFeeds(programming: any[], live: any[]) {
  const byId = new Map(programming.map(game => [game.id, game]));
  for (const liveGame of live) {
    const existing = byId.get(liveGame.id);
    if (existing) {
      Object.assign(existing, liveGame, {
        broadcasters: existing.broadcasters || [],
        competition: liveGame.competition || existing.competition
      });
    } else {
      byId.set(liveGame.id, { ...liveGame, broadcasters: [], source: "Super Placar" });
    }
  }
  return [...byId.values()].sort((a, b) => {
    if (a.status === "live" && b.status !== "live") return -1;
    if (b.status === "live" && a.status !== "live") return 1;
    return String(a.kickoff).localeCompare(String(b.kickoff));
  });
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "pt-BR,pt;q=0.9",
      "User-Agent": "LuxPlay-Sports/1.0"
    },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`Super Placar HTTP ${response.status}`);
  return await response.text();
}

async function assertAdmin(db: any, username: unknown, password: unknown) {
  if (typeof username !== "string" || !username || typeof password !== "string" || !password) {
    return { ok: false, status: 401, error: "Login de administrador necessário." };
  }
  const { data, error } = await db
    .from("usuarios")
    .select("cargo")
    .eq("usuario", username)
    .eq("senha", password)
    .maybeSingle();
  if (error) throw error;
  if (!data || String(data.cargo || "").trim().toLowerCase() !== "admin") {
    return { ok: false, status: 403, error: "Acesso exclusivo de administrador." };
  }
  return { ok: true };
}

async function loadMappings(db: any) {
  const { data, error } = await db
    .from("sports_channel_mappings")
    .select("broadcaster_key,broadcaster_name,channel_hint,updated_at")
    .order("broadcaster_name", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getFeed(db: any, force = false) {
  const { data: cached, error: cacheError } = await db
    .from("sports_feed_cache")
    .select("payload,fetched_at")
    .eq("cache_key", CACHE_KEY)
    .maybeSingle();
  if (cacheError) throw cacheError;

  const age = cached?.fetched_at ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;
  if (!force && cached?.payload && age < CACHE_TTL_MS) {
    return { ...cached.payload, cached: true, fetched_at: cached.fetched_at };
  }

  try {
    const [programHtml, liveHtml] = await Promise.all([fetchHtml(PROGRAM_URL), fetchHtml(LIVE_URL)]);
    const programming = parseProgramming(programHtml);
    const live = parseLive(liveHtml);
    const games = mergeFeeds(programming, live);
    const payload = {
      games,
      stats: { programming: programming.length, live: live.length },
      source: "Super Placar",
      source_url: PROGRAM_URL
    };
    const fetchedAt = new Date().toISOString();
    const { error } = await db.from("sports_feed_cache").upsert({
      cache_key: CACHE_KEY,
      payload,
      fetched_at: fetchedAt
    }, { onConflict: "cache_key" });
    if (error) throw error;
    return { ...payload, cached: false, fetched_at: fetchedAt };
  } catch (error) {
    console.error("sports-feed refresh:", error);
    if (cached?.payload) {
      return { ...cached.payload, cached: true, stale: true, fetched_at: cached.fetched_at };
    }
    throw error;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Método não permitido." }, 405);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  try {
    let body: any = {};
    if (request.method === "POST") {
      try { body = await request.json(); } catch { body = {}; }
    }
    const url = new URL(request.url);
    const action = body.action || url.searchParams.get("action") || "feed";

    if (action === "feed") {
      const [feed, mappings] = await Promise.all([getFeed(db, false), loadMappings(db)]);
      return json({ ...feed, mappings });
    }

    if (action === "refresh") {
      const admin = await assertAdmin(db, body.username, body.password);
      if (!admin.ok) return json({ error: admin.error }, admin.status);
      const [feed, mappings] = await Promise.all([getFeed(db, true), loadMappings(db)]);
      return json({ ...feed, mappings });
    }

    if (action === "save_mapping") {
      const admin = await assertAdmin(db, body.username, body.password);
      if (!admin.ok) return json({ error: admin.error }, admin.status);
      const broadcasterName = clean(body.broadcaster_name);
      const channelHint = clean(body.channel_hint);
      const broadcasterKey = normalize(broadcasterName);
      if (!broadcasterKey || !channelHint || broadcasterName.length > 120 || channelHint.length > 240) {
        return json({ error: "Mapeamento inválido." }, 400);
      }
      const { error } = await db.from("sports_channel_mappings").upsert({
        broadcaster_key: broadcasterKey,
        broadcaster_name: broadcasterName,
        channel_hint: channelHint,
        updated_by: body.username,
        updated_at: new Date().toISOString()
      }, { onConflict: "broadcaster_key" });
      if (error) throw error;
      return json({ ok: true, mappings: await loadMappings(db) });
    }

    if (action === "delete_mapping") {
      const admin = await assertAdmin(db, body.username, body.password);
      if (!admin.ok) return json({ error: admin.error }, admin.status);
      const broadcasterKey = normalize(body.broadcaster_name || body.broadcaster_key);
      if (!broadcasterKey) return json({ error: "Emissora inválida." }, 400);
      const { error } = await db.from("sports_channel_mappings").delete().eq("broadcaster_key", broadcasterKey);
      if (error) throw error;
      return json({ ok: true, mappings: await loadMappings(db) });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (error) {
    console.error("sports-feed:", error);
    return json({ error: "Não foi possível carregar os dados esportivos agora." }, 500);
  }
});
