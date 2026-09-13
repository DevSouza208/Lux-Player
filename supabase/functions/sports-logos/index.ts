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
const CACHE_KEY = "superplacar-logos-v2";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

const clean = (value: unknown) => String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const normalize = (value: unknown) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });

function spParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
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

function gameId(date: string, home: string, away: string) {
  return `${date}:${normalize(home)}:${normalize(away)}`;
}

function absoluteImage(src: string) {
  const value = clean(src);
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  try { return new URL(value, PROGRAM_URL).href; } catch { return ""; }
}

function imageFrom($: any, element: any) {
  const img = $(element).is("img") ? $(element) : $(element).find("img").first();
  if (!img?.length) return "";
  const src = img.attr("src") || img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || "";
  if (src) return absoluteImage(src);
  const srcset = clean(img.attr("srcset") || img.attr("data-srcset") || "");
  if (!srcset) return "";
  return absoluteImage(srcset.split(",")[0].trim().split(/\s+/)[0]);
}

function parseLogos(html: string) {
  const $ = load(html);
  const rows: any[] = [];
  const seen = new Set<string>();
  let tableNumber = 0;

  $("table").each((_, table) => {
    const headingText = clean($(table).prevAll("h1,h2,h3,h4,h5,h6").first().text());
    const nearbyText = clean($(table).prevAll().slice(0, 5).text());
    const date = parseDateText(headingText) || parseDateText(nearbyText) || dateOffset(tableNumber++);

    $(table).find("tr").each((__, row) => {
      const cells = $(row).find("td");
      if (cells.length < 3) return;
      const gameCell = cells.eq(2);
      const images = gameCell.find("img").toArray();

      const entries: Array<{ name: string; logo: string }> = [];
      gameCell.find("a").each((___, link) => {
        const name = clean($(link).text());
        if (!name || /^x$/i.test(name)) return;
        const logo = imageFrom($, link);
        if (!entries.some(entry => normalize(entry.name) === normalize(name))) entries.push({ name, logo });
      });

      if (entries.length >= 2) {
        if (!entries[0].logo && images[0]) entries[0].logo = imageFrom($, images[0]);
        if (!entries[1].logo && images[1]) entries[1].logo = imageFrom($, images[1]);
      }

      if (entries.length < 2) {
        const rawText = clean(gameCell.text()).replace(/\s+[xX]\s+/, " | ");
        const names = rawText.split("|").map(clean).filter(Boolean);
        if (names.length >= 2) {
          entries.length = 0;
          entries.push({ name: names[0], logo: images[0] ? imageFrom($, images[0]) : "" });
          entries.push({ name: names[1], logo: images[1] ? imageFrom($, images[1]) : "" });
        }
      }

      if (entries.length < 2) return;
      const home = entries[0];
      const away = entries[1];
      const id = gameId(date, home.name, away.name);
      if (seen.has(id)) return;
      seen.add(id);
      rows.push({
        id,
        date,
        home: home.name,
        away: away.name,
        home_logo: home.logo,
        away_logo: away.logo
      });
    });
  });

  return rows.filter(row => row.home_logo || row.away_logo);
}

async function fetchProgram() {
  const response = await fetch(PROGRAM_URL, {
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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Método não permitido." }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  try {
    const { data: cached, error: cacheError } = await db.from("sports_feed_cache").select("payload,fetched_at").eq("cache_key", CACHE_KEY).maybeSingle();
    if (cacheError) throw cacheError;
    const cachedRows = Array.isArray(cached?.payload?.logos) ? cached.payload.logos : [];
    const age = cached?.fetched_at ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;
    if (cachedRows.length && age < CACHE_TTL_MS) return json({ logos: cachedRows, cached: true, fetched_at: cached.fetched_at });

    try {
      const html = await fetchProgram();
      const logos = parseLogos(html);
      if (!logos.length) throw new Error("Nenhum escudo pôde ser interpretado.");
      const fetchedAt = new Date().toISOString();
      const payload = { logos, source: "Super Placar" };
      const { error } = await db.from("sports_feed_cache").upsert({ cache_key: CACHE_KEY, payload, fetched_at: fetchedAt }, { onConflict: "cache_key" });
      if (error) throw error;
      return json({ logos, cached: false, fetched_at: fetchedAt });
    } catch (error) {
      console.error("sports-logos refresh:", error);
      if (cachedRows.length) return json({ logos: cachedRows, cached: true, stale: true, fetched_at: cached.fetched_at });
      throw error;
    }
  } catch (error) {
    console.error("sports-logos:", error);
    return json({ error: "Não foi possível carregar os escudos agora." }, 500);
  }
});