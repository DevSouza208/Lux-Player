import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TABLE = "lux_home_rail_items";
const RAILS = new Set(["movies", "series", "games", "books"]);
const MAX_ITEMS = 12;
const IMDB_CACHE_MS = 20 * 60 * 1000;
let imdbCache: { year: number; at: number; items: any[] } = { year: 0, at: 0, items: [] };

function respond(data: unknown, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache },
  });
}

async function rest(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function resolveAdmin(username: unknown, credential: unknown) {
  const user = String(username || "").trim();
  const token = String(credential || "");
  if (!user || !token) throw new Error("Sessão administrativa ausente.");
  const response = await rest("rpc/lux_auth_resolve", {
    method: "POST",
    body: JSON.stringify({ p_username: user, p_credential: token }),
  });
  if (!response.ok) throw new Error("Não foi possível validar a sessão administrativa.");
  const raw = await response.json().catch(() => null);
  const account = Array.isArray(raw) ? raw[0] : raw;
  const role = String(account?.cargo || account?.role || "").trim().toLowerCase();
  if (!account || role !== "admin") throw new Error("Apenas administradores podem alterar as faixas da Home.");
  return account;
}

function text(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanPayload(value: unknown) {
  try {
    const json = JSON.stringify(value && typeof value === "object" ? value : {});
    if (json.length > 30000) return {};
    return JSON.parse(json);
  } catch (_) {
    return {};
  }
}

function cleanSelection(item: any, position: number, createdBy: string, rail: string) {
  const sourceKey = text(item?.source_key || item?.key, 1000);
  if (!sourceKey) throw new Error("Um dos itens selecionados não possui identificador.");
  return {
    rail,
    source_key: sourceKey,
    title: text(item?.title, 500),
    subtitle: text(item?.subtitle, 500),
    image_url: text(item?.image_url || item?.image, 3000),
    payload: cleanPayload(item?.payload),
    position,
    enabled: true,
    created_by: createdBy,
    updated_at: new Date().toISOString(),
  };
}

function htmlEntityDecode(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function candidateFromObject(input: any, rank = 0) {
  const item = input?.item && typeof input.item === "object" ? input.item : input;
  if (!item || typeof item !== "object") return null;

  const rawUrl = text(item.url || item.canonicalUrl || input?.url, 2000);
  const idValue = text(item.id || item.titleId || item?.title?.id || input?.id, 80);
  const id = /^tt\d+$/i.test(idValue)
    ? idValue
    : (rawUrl.match(/\/title\/(tt\d+)/i)?.[1] || "");
  const title = text(item.name || item.titleText?.text || item?.title?.titleText?.text || item.originalTitleText?.text, 300);
  if (!id || !title) return null;

  const imageValue = item.image || item.primaryImage || item?.title?.primaryImage || {};
  const image = text(
    typeof imageValue === "string" ? imageValue : imageValue?.url || imageValue?.imageUrl,
    3000,
  );
  const description = text(
    item.description || item.plot?.plotText?.plainText || item.plotText?.plainText || item?.title?.plot?.plotText?.plainText,
    1200,
  );
  const year = Number(
    item.releaseYear?.year || item.releaseDate?.year || item?.title?.releaseYear?.year ||
    (typeof item.dateCreated === "string" ? item.dateCreated.slice(0, 4) : 0),
  ) || null;
  const rating = Number(
    item.aggregateRating?.ratingValue || item.ratingsSummary?.aggregateRating || item?.title?.ratingsSummary?.aggregateRating,
  ) || null;
  return {
    id,
    title: htmlEntityDecode(title),
    image,
    description: htmlEntityDecode(description),
    year,
    rating,
    rank: Number(input?.position || rank) || rank || null,
    url: rawUrl || `https://www.imdb.com/title/${id}/`,
  };
}

function extractLdJson(html: string) {
  const results: any[] = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const blocks = Array.isArray(parsed) ? parsed : [parsed];
      for (const block of blocks) {
        if (Array.isArray(block?.itemListElement)) {
          block.itemListElement.forEach((entry: any, index: number) => {
            const candidate = candidateFromObject(entry, index + 1);
            if (candidate) results.push(candidate);
          });
        } else {
          const candidate = candidateFromObject(block);
          if (candidate) results.push(candidate);
        }
      }
    } catch (_) {}
  }
  return results;
}

function extractHydratedJson(html: string) {
  const results: any[] = [];
  const scripts = [
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i,
  ];
  for (const expression of scripts) {
    const match = html.match(expression);
    if (!match) continue;
    let root: any;
    try { root = JSON.parse(match[1].trim()); } catch (_) { continue; }
    const stack = [root];
    let inspected = 0;
    while (stack.length && inspected < 250000) {
      const node = stack.pop();
      inspected += 1;
      if (!node || typeof node !== "object") continue;
      const candidate = candidateFromObject(node);
      if (candidate) results.push(candidate);
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      } else {
        for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
      }
    }
    if (results.length >= MAX_ITEMS) break;
  }
  return results;
}

function uniqueSeries(items: any[], year: number) {
  const seen = new Set<string>();
  const output: any[] = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    output.push({ ...item, source: "IMDb", release_year: item.year || year });
    if (output.length >= MAX_ITEMS) break;
  }
  return output;
}

async function fetchImdbPage(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.7,en;q=0.6",
      "Cache-Control": "no-cache",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`IMDb respondeu HTTP ${response.status}.`);
  return response.text();
}

async function imdbSeries(year: number) {
  const now = Date.now();
  if (imdbCache.year === year && imdbCache.items.length && now - imdbCache.at < IMDB_CACHE_MS) return imdbCache.items;

  const searchUrl = `https://www.imdb.com/search/title/?title_type=tv_series,tv_miniseries&release_date=${year}-01-01,${year}-12-31&sort=moviemeter,asc`;
  const html = await fetchImdbPage(searchUrl);
  let items = uniqueSeries([...extractLdJson(html), ...extractHydratedJson(html)], year);

  if (items.length < MAX_ITEMS) {
    try {
      const chartHtml = await fetchImdbPage("https://www.imdb.com/chart/tvmeter/");
      const fallback = [...extractLdJson(chartHtml), ...extractHydratedJson(chartHtml)]
        .filter(item => !item.year || item.year === year);
      items = uniqueSeries([...items, ...fallback], year);
    } catch (_) {}
  }

  if (!items.length) throw new Error("O IMDb não retornou lançamentos de séries agora.");
  imdbCache = { year, at: now, items };
  return items;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "Método não permitido." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "list_public");

    if (action === "list_public") {
      const response = await rest(`${TABLE}?select=rail,source_key,title,subtitle,image_url,payload,position&enabled=eq.true&order=rail.asc,position.asc,created_at.asc`);
      if (!response.ok) throw new Error("Não foi possível carregar as seleções da Home.");
      return respond({ items: await response.json() }, 200, "public, max-age=45");
    }

    if (action === "imdb_series") {
      const currentYear = new Date().getUTCFullYear();
      const requested = Number(body?.year || currentYear);
      const year = Number.isInteger(requested) && requested >= 2000 && requested <= currentYear + 1 ? requested : currentYear;
      return respond({ year, source: "IMDb", series: await imdbSeries(year) }, 200, "public, max-age=900");
    }

    const account = await resolveAdmin(body?.username, body?.credential || body?.password);
    const createdBy = text(account?.usuario || body?.username, 200);

    if (action === "list_admin") {
      const response = await rest(`${TABLE}?select=*&order=rail.asc,position.asc,created_at.asc`);
      if (!response.ok) throw new Error("Não foi possível carregar as seleções administrativas.");
      return respond({ items: await response.json() });
    }

    if (action === "replace") {
      const rail = String(body?.rail || "");
      if (!RAILS.has(rail)) throw new Error("Faixa inválida.");
      const incoming = Array.isArray(body?.items) ? body.items.slice(0, MAX_ITEMS) : [];
      const cleaned = incoming.map((item: any, index: number) => cleanSelection(item, index, createdBy, rail));

      const deleteResponse = await rest(`${TABLE}?rail=eq.${encodeURIComponent(rail)}`, { method: "DELETE" });
      if (!deleteResponse.ok) throw new Error("Não foi possível substituir a seleção anterior.");

      if (cleaned.length) {
        const insertResponse = await rest(TABLE, {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(cleaned),
        });
        if (!insertResponse.ok) {
          const detail = await insertResponse.text().catch(() => "");
          throw new Error(`Não foi possível salvar a nova seleção.${detail ? ` ${detail.slice(0, 180)}` : ""}`);
        }
      }
      return respond({ ok: true, rail, count: cleaned.length });
    }

    return respond({ error: "Ação não reconhecida." }, 400);
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "Falha inesperada." }, 400);
  }
});
