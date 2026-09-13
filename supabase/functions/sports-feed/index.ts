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
const HOME_URL = "https://superplacar.com.br/";
const CACHE_KEY = "superplacar-v4";
const CACHE_TTL_MS = 45_000;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });
const clean = (value: unknown) => String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const normalize = (value: unknown) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function htmlLines(html: string) {
  const $ = load(html);
  $("script,style,noscript,svg,iframe").remove();
  $("br,tr,td,th,h1,h2,h3,h4,h5,h6,li,p,section,article,header,footer,a,div").each((_, el) => $(el).append("\n"));
  return $("body").text().split(/\n+/).map(clean).filter(Boolean);
}

function spParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function todayKey() {
  const p = spParts();
  return `${p.year}-${p.month}-${p.day}`;
}

function dateOffset(days: number) {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + days);
  const p = spParts(base);
  return `${p.year}-${p.month}-${p.day}`;
}

function parseDateText(text: string) {
  const match = clean(text).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!match) return null;
  const now = spParts();
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : Number(now.year);
  if (year < 100) year += 2000;
  if (!match[3]) {
    const currentMonth = Number(now.month);
    if (currentMonth === 12 && month === 1) year += 1;
    else if (currentMonth === 1 && month === 12) year -= 1;
  }
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
function unique<T>(items: T[]) { return [...new Set(items)]; }

function addProgrammingGame(target: any[], seen: Set<string>, date: string, time: string, competition: string, home: string, away: string, broadcast: string) {
  if (!date || !/^\d{2}:\d{2}$/.test(time) || !competition || !home || !away) return;
  const id = gameId(date, home, away);
  if (seen.has(id)) return;
  seen.add(id);
  target.push({
    id, date, time, kickoff: kickoffIso(date, time), competition, home, away,
    broadcasters: clean(broadcast).split(",").map(clean).filter(Boolean),
    status: "scheduled", score_home: null, score_away: null, source: "Super Placar"
  });
}

function parseProgramming(html: string) {
  const $ = load(html);
  const games: any[] = [];
  const seen = new Set<string>();
  let tableNumber = 0;

  $("table").each((_, table) => {
    const headingText = clean($(table).prevAll("h1,h2,h3,h4,h5,h6").first().text());
    const nearbyText = clean($(table).prevAll().slice(0, 5).text());
    const date = parseDateText(headingText) || parseDateText(nearbyText) || dateOffset(tableNumber++);

    $(table).find("tr").each((__, row) => {
      const cells = $(row).find("td");
      if (cells.length < 4) return;
      const time = clean(cells.eq(0).text());
      if (!/^\d{2}:\d{2}$/.test(time)) return;
      const competition = clean(cells.eq(1).text());
      const gameCell = cells.eq(2);
      let teams = gameCell.find("a").map((___, link) => clean($(link).text())).get().filter(Boolean);
      teams = unique(teams).filter(name => !/^x$/i.test(name));
      if (teams.length < 2) teams = splitTeams(gameCell.text());
      if (teams.length < 2) return;
      addProgrammingGame(games, seen, date, time, competition, teams[0], teams[1], clean(cells.eq(3).text()));
    });
  });

  if (games.length) return games;

  const lines = htmlLines(html);
  let date = todayKey();
  for (let i = 0; i < lines.length; i++) {
    const parsedDate = parseDateText(lines[i]);
    if (parsedDate && !/^\d{2}:\d{2}$/.test(lines[i])) {
      date = parsedDate;
      continue;
    }
    if (!/^\d{2}:\d{2}$/.test(lines[i])) continue;
    const time = lines[i];
    const segment = lines.slice(i + 1, i + 12).filter(value => !/^(Horário|Campeonato|Jogo|Transmissão)$/i.test(value));
    const competition = clean(segment[0]);
    if (!competition) continue;
    const xIndex = segment.findIndex((value, index) => index > 0 && /^x$/i.test(value));
    if (xIndex > 1 && segment[xIndex - 1] && segment[xIndex + 1]) {
      addProgrammingGame(games, seen, date, time, competition, segment[xIndex - 1], segment[xIndex + 1], segment[xIndex + 2] || "");
      continue;
    }
    const combinedIndex = segment.findIndex((value, index) => index > 0 && splitTeams(value).length === 2);
    if (combinedIndex > 0) {
      const [home, away] = splitTeams(segment[combinedIndex]);
      addProgrammingGame(games, seen, date, time, competition, home, away, segment[combinedIndex + 1] || "");
    }
  }
  return games;
}

function parseBoard(html: string) {
  const lines = htmlLines(html);
  const games: any[] = [];
  const seen = new Set<string>();
  let date = todayKey();
  let competition = "";

  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i]);
    const maybeDate = parseDateText(line);
    if (maybeDate && /Hoje|Amanh|Ontem|\d{1,2}\/\d{1,2}/i.test(line)) date = maybeDate;

    const nearby = lines.slice(i + 1, i + 6);
    if (/\s20\d{2}(?:\/20\d{2})?$/.test(line) && nearby.some(value => /^(Em andamento|Intervalo|Encerrado|Finalizado|Fim|Em breve)/i.test(value))) {
      competition = line.replace(/\s+20\d{2}(?:\/20\d{2})?$/i, "").trim();
      continue;
    }

    const statusMatch = line.match(/^(Em andamento|Intervalo|Encerrado|Finalizado|Fim|Em breve)(?:\s*-\s*(\d{2}:\d{2}))?/i);
    if (!statusMatch) continue;
    const label = normalize(statusMatch[1]);
    const status = ["encerrado", "finalizado", "fim"].includes(label) ? "finished" : ["em andamento", "intervalo"].includes(label) ? "live" : "scheduled";
    const time = statusMatch[2] || "00:00";
    const segment = lines.slice(i + 1, i + 14);
    const scoreIndex = segment.findIndex(value => /^\d+\s*-\s*\d+$/.test(value));
    const dashIndex = segment.findIndex(value => /^[-–]$/.test(value));
    const markerIndex = scoreIndex >= 0 ? scoreIndex : dashIndex;
    if (markerIndex < 1 || !segment[markerIndex + 1]) continue;
    const home = clean(segment[markerIndex - 1]);
    const away = clean(segment[markerIndex + 1]);
    if (!home || !away) continue;
    const id = gameId(date, home, away);
    if (seen.has(id)) continue;
    seen.add(id);
    let scoreHome: number | null = null, scoreAway: number | null = null;
    if (scoreIndex >= 0) {
      const score = segment[scoreIndex].match(/^(\d+)\s*-\s*(\d+)$/);
      if (score) { scoreHome = Number(score[1]); scoreAway = Number(score[2]); }
    }
    games.push({
      id, date, time, kickoff: time === "00:00" ? "" : kickoffIso(date, time), competition,
      home, away, status, score_home: scoreHome, score_away: scoreAway,
      broadcasters: [], source: "Super Placar"
    });
  }
  return games;
}

function mergeFeeds(programming: any[], boards: any[][]) {
  const byId = new Map(programming.map(game => [game.id, game]));
  const rank: Record<string, number> = { scheduled: 1, finished: 2, live: 3 };
  for (const board of boards) {
    for (const incoming of board) {
      const current = byId.get(incoming.id);
      if (!current) { byId.set(incoming.id, incoming); continue; }
      const incomingWins = (rank[incoming.status] || 0) >= (rank[current.status] || 0);
      byId.set(incoming.id, {
        ...current,
        ...(incomingWins ? incoming : {}),
        time: incoming.time && incoming.time !== "00:00" ? incoming.time : current.time,
        kickoff: incoming.kickoff || current.kickoff,
        competition: incoming.competition || current.competition,
        broadcasters: current.broadcasters?.length ? current.broadcasters : incoming.broadcasters || []
      });
    }
  }
  return [...byId.values()].sort((a, b) => String(a.kickoff || "").localeCompare(String(b.kickoff || "")));
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "User-Agent": BROWSER_UA
    },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`Super Placar HTTP ${response.status}`);
  const html = await response.text();
  if (html.length < 800) throw new Error("Resposta vazia do Super Placar.");
  return html;
}

async function assertAdmin(db: any, username: unknown, password: unknown) {
  if (typeof username !== "string" || !username || typeof password !== "string" || !password) return { ok: false, status: 401, error: "Login de administrador necessário." };
  const { data, error } = await db.from("usuarios").select("cargo").eq("usuario", username).eq("senha", password).maybeSingle();
  if (error) throw error;
  if (!data || String(data.cargo || "").trim().toLowerCase() !== "admin") return { ok: false, status: 403, error: "Acesso exclusivo de administrador." };
  return { ok: true };
}

async function loadMappings(db: any) {
  const { data, error } = await db.from("sports_channel_mappings").select("broadcaster_key,broadcaster_name,channel_hint,updated_at").order("broadcaster_name", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fallbackPayload(db: any) {
  const { data } = await db.from("sports_feed_cache").select("payload,fetched_at,cache_key").like("cache_key", "superplacar-%").order("fetched_at", { ascending: false }).limit(8);
  return (data || []).find((row: any) => Array.isArray(row?.payload?.games) && row.payload.games.length > 0) || null;
}

async function getFeed(db: any, force = false) {
  const { data: cached, error: cacheError } = await db.from("sports_feed_cache").select("payload,fetched_at").eq("cache_key", CACHE_KEY).maybeSingle();
  if (cacheError) throw cacheError;
  const cachedGames = Array.isArray(cached?.payload?.games) ? cached.payload.games : [];
  const age = cached?.fetched_at ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;
  if (!force && cachedGames.length && age < CACHE_TTL_MS) return { ...cached.payload, cached: true, fetched_at: cached.fetched_at };

  try {
    const [programHtml, liveHtml, homeHtml] = await Promise.all([fetchHtml(PROGRAM_URL), fetchHtml(LIVE_URL), fetchHtml(HOME_URL)]);
    const programming = parseProgramming(programHtml);
    const liveBoard = parseBoard(liveHtml);
    const homeBoard = parseBoard(homeHtml);
    const games = mergeFeeds(programming, [homeBoard, liveBoard]);
    if (!games.length) throw new Error("O Super Placar respondeu, mas nenhum jogo pôde ser interpretado.");
    const payload = {
      games,
      stats: {
        programming: programming.length,
        live: games.filter(game => game.status === "live").length,
        finished: games.filter(game => game.status === "finished").length,
        upcoming: games.filter(game => game.status === "scheduled").length
      },
      source: "Super Placar",
      source_url: PROGRAM_URL
    };
    const fetchedAt = new Date().toISOString();
    const { error } = await db.from("sports_feed_cache").upsert({ cache_key: CACHE_KEY, payload, fetched_at: fetchedAt }, { onConflict: "cache_key" });
    if (error) throw error;
    return { ...payload, cached: false, fetched_at: fetchedAt };
  } catch (error) {
    console.error("sports-feed refresh:", error);
    if (cachedGames.length) return { ...cached.payload, cached: true, stale: true, fetched_at: cached.fetched_at };
    const fallback = await fallbackPayload(db);
    if (fallback) return { ...fallback.payload, cached: true, stale: true, fetched_at: fallback.fetched_at };
    throw error;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Método não permitido." }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    let body: any = {};
    if (request.method === "POST") { try { body = await request.json(); } catch { body = {}; } }
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
      const broadcasterName = clean(body.broadcaster_name), channelHint = clean(body.channel_hint), broadcasterKey = normalize(broadcasterName);
      if (!broadcasterKey || !channelHint || broadcasterName.length > 120 || channelHint.length > 240) return json({ error: "Mapeamento inválido." }, 400);
      const { error } = await db.from("sports_channel_mappings").upsert({ broadcaster_key: broadcasterKey, broadcaster_name: broadcasterName, channel_hint: channelHint, updated_by: body.username, updated_at: new Date().toISOString() }, { onConflict: "broadcaster_key" });
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