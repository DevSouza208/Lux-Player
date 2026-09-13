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
const HOME_URL = "https://superplacar.com.br/";
const CACHE_KEY = "superplacar-v3";
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

function todayKey() {
  const now = saoPauloParts();
  return `${now.year}-${now.month}-${now.day}`;
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

function splitTeams(text: string) {
  const match = clean(text).match(/^(.+?)\s+[xX]\s+(.+)$/);
  return match ? [clean(match[1]), clean(match[2])] : [];
}

function pushProgrammingGame(games: any[], date: string, dateLabel: string, time: string, competition: string, home: string, away: string, broadcastText: string) {
  if (!date || !/^\d{2}:\d{2}$/.test(time) || !competition || !home || !away) return;
  const broadcasters = clean(broadcastText).split(",").map(clean).filter(Boolean);
  games.push({
    id: gameId(date, home, away), date, date_label: dateLabel, time,
    kickoff: kickoffIso(date, time), competition, home, away, broadcasters,
    status: "scheduled", score_home: null, score_away: null, source: "Super Placar"
  });
}

function parseProgramming(html: string) {
  const $ = load(html);
  const games: any[] = [];
  const seen = new Set<string>();

  $("h2").each((_, heading) => {
    const label = clean($(heading).text());
    const date = parseDateLabel(label);
    if (!date) return;
    const dateLabel = label.split("-")[0].trim();
    const table = $(heading).nextAll("table").first();
    if (!table.length) return;

    table.find("tr").each((__, row) => {
      const cells = $(row).find("td");
      if (cells.length < 4) return;
      const time = clean(cells.eq(0).text());
      if (!/^\d{2}:\d{2}$/.test(time)) return;
      const competition = clean(cells.eq(1).text());
      const gameCell = cells.eq(2);
      let teams = gameCell.find("a").map((___, link) => clean($(link).text())).get().filter(Boolean);
      teams = teams.filter((team, index) => teams.indexOf(team) === index);
      if (teams.length < 2) teams = splitTeams(gameCell.text());
      if (teams.length < 2) return;
      const broadcast = clean(cells.eq(3).text());
      const key = gameId(date, teams[0], teams[1]);
      if (seen.has(key)) return;
      seen.add(key);
      pushProgrammingGame(games, date, dateLabel, time, competition, teams[0], teams[1], broadcast);
    });
  });

  if (games.length) return games;

  const lines = htmlLines(html);
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
    const segment = lines.slice(i + 1, i + 10);
    const competition = clean(segment[0]);
    if (!competition || /^(Horário|Campeonato|Jogo|Transmissão)$/i.test(competition)) continue;
    let home = "", away = "", broadcast = "";
    const xIndex = segment.findIndex((line, index) => index > 0 && /^x$/i.test(line));
    if (xIndex > 1 && segment[xIndex - 1] && segment[xIndex + 1]) {
      home = clean(segment[xIndex - 1]);
      away = clean(segment[xIndex + 1]);
      broadcast = clean(segment[xIndex + 2]);
    } else {
      const combinedIndex = segment.findIndex((line, index) => index > 0 && splitTeams(line).length === 2);
      if (combinedIndex > 0) {
        [home, away] = splitTeams(segment[combinedIndex]);
        broadcast = clean(segment[combinedIndex + 1]);
      }
    }
    if (!home || !away) continue;
    const key = gameId(date, home, away);
    if (seen.has(key)) continue;
    seen.add(key);
    pushProgrammingGame(games, date, dateLabel, time, competition, home, away, broadcast);
  }
  return games;
}

function parseTodayBoard(html: string) {
  const lines = htmlLines(html);
  const games: any[] = [];
  const seen = new Set<string>();
  const date = todayKey();
  let competition = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = clean(lines[i]);
    const nearby = lines.slice(i + 1, i + 5);
    if (/\s20\d{2}(?:\/20\d{2})?$/.test(line) && nearby.some(value => /^(Em andamento|Encerrado|Em breve)\s*-\s*\d{2}:\d{2}$/i.test(value))) {
      competition = line.replace(/\s+20\d{2}(?:\/20\d{2})?$/i, "").trim();
      continue;
    }

    const statusMatch = line.match(/^(Em andamento|Encerrado|Em breve)\s*-\s*(\d{2}:\d{2})$/i);
    if (!statusMatch) continue;

    const label = normalize(statusMatch[1]);
    const status = label === "encerrado" ? "finished" : label === "em andamento" ? "live" : "scheduled";
    const time = statusMatch[2];
    const segment = lines.slice(i + 1, i + 12);
    const scoreIndex = segment.findIndex(value => /^\d+\s*-\s*\d+$/.test(value));
    const dashIndex = segment.findIndex(value => /^-$/.test(value));
    const markerIndex = scoreIndex >= 0 ? scoreIndex : dashIndex;
    if (markerIndex < 1 || !segment[markerIndex + 1]) continue;

    const home = clean(segment[markerIndex - 1]);
    const away = clean(segment[markerIndex + 1]);
    if (!home || !away || /^(Image|Agora|Favoritos|Programação)$/i.test(home + away)) continue;

    const id = gameId(date, home, away);
    if (seen.has(id)) continue;
    seen.add(id);

    let scoreHome: number | null = null;
    let scoreAway: number | null = null;
    if (scoreIndex >= 0) {
      const score = segment[scoreIndex].match(/^(\d+)\s*-\s*(\d+)$/);
      if (score) {
        scoreHome = Number(score[1]);
        scoreAway = Number(score[2]);
      }
    }

    games.push({
      id, date, time, kickoff: kickoffIso(date, time), competition,
      home, away, status, score_home: scoreHome, score_away: scoreAway,
      broadcasters: [], source: "Super Placar"
    });
  }

  return games;
}

function mergeFeeds(programming: any[], board: any[]) {
  const byId = new Map(programming.map(game => [game.id, game]));
  for (const boardGame of board) {
    const existing = byId.get(boardGame.id);
    if (existing) {
      Object.assign(existing, boardGame, {
        broadcasters: existing.broadcasters || [],
        competition: boardGame.competition || existing.competition
      });
    } else {
      byId.set(boardGame.id, boardGame);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const rank: Record<string, number> = { live: 0, scheduled: 1, finished: 2 };
    const diff = (rank[a.status] ?? 3) - (rank[b.status] ?? 3);
    if (diff) return diff;
    return String(a.kickoff).localeCompare(String(b.kickoff));
  });
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "pt-BR,pt;q=0.9",
      "User-Agent": "LuxPlay-Sports/1.1"
    },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`Super Placar HTTP ${response.status}`);
  return await response.text();
}

async function assertAdmin(db: any, username: unknown, password: unknown) {
  if (typeof username !== "string" || !username || typeof password !== "string" || !password) return { ok: false, status: 401, error: "Login de administrador necessário." };
  const { data, error } = await db.from("usuarios").select("cargo").eq("usuario", username).eq("senha", password).maybeSingle();
  if (error) throw error;
  if (!data || String(data.cargo || "").trim().toLowerCase() !== "admin") return { ok: false, status: 403, error: "Acesso exclusivo de administrador." };
  return { ok: true };
}

async function loadMappings(db: any) {
  const { data, error } = await db.from("sports_channel_mappings")
    .select("broadcaster_key,broadcaster_name,channel_hint,updated_at")
    .order("broadcaster_name", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getFeed(db: any, force = false) {
  const { data: cached, error: cacheError } = await db.from("sports_feed_cache")
    .select("payload,fetched_at").eq("cache_key", CACHE_KEY).maybeSingle();
  if (cacheError) throw cacheError;

  const age = cached?.fetched_at ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;
  if (!force && cached?.payload && age < CACHE_TTL_MS) return { ...cached.payload, cached: true, fetched_at: cached.fetched_at };

  try {
    const [programHtml, homeHtml] = await Promise.all([fetchHtml(PROGRAM_URL), fetchHtml(HOME_URL)]);
    const programming = parseProgramming(programHtml);
    const board = parseTodayBoard(homeHtml);
    const games = mergeFeeds(programming, board);
    const payload = {
      games,
      stats: {
        programming: programming.length,
        live: board.filter(game => game.status === "live").length,
        finished: board.filter(game => game.status === "finished").length,
        upcoming: games.filter(game => game.status === "scheduled").length
      },
      source: "Super Placar",
      source_url: HOME_URL
    };
    const fetchedAt = new Date().toISOString();
    const { error } = await db.from("sports_feed_cache").upsert({ cache_key: CACHE_KEY, payload, fetched_at: fetchedAt }, { onConflict: "cache_key" });
    if (error) throw error;
    return { ...payload, cached: false, fetched_at: fetchedAt };
  } catch (error) {
    console.error("sports-feed refresh:", error);
    if (cached?.payload) return { ...cached.payload, cached: true, stale: true, fetched_at: cached.fetched_at };
    throw error;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Método não permitido." }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

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
      if (!broadcasterKey || !channelHint || broadcasterName.length > 120 || channelHint.length > 240) return json({ error: "Mapeamento inválido." }, 400);
      const { error } = await db.from("sports_channel_mappings").upsert({
        broadcaster_key: broadcasterKey, broadcaster_name: broadcasterName, channel_hint: channelHint,
        updated_by: body.username, updated_at: new Date().toISOString()
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