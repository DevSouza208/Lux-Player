import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TABLE = "lux_home_banners";
const BUCKET = "lux-home-banners";
const KINDS = new Set(["sport", "game", "book", "movie", "series", "custom"]);
const CTA_TYPES = new Set(["none", "media", "live", "game", "book", "url"]);

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
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
  if (!account || role !== "admin") throw new Error("Apenas administradores podem alterar os destaques.");
  return account;
}

function text(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function nullableDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error("Data inválida no destaque.");
  return date.toISOString();
}

function cleanChannels(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  return source.slice(0, 12).map((entry) => {
    if (typeof entry === "string") return { label: text(entry, 80), value: "" };
    return {
      label: text((entry as any)?.label, 80),
      value: text((entry as any)?.value, 500),
    };
  }).filter((entry) => entry.label || entry.value);
}

function cleanBanner(input: any, createdBy: string) {
  const kind = KINDS.has(String(input?.kind)) ? String(input.kind) : "custom";
  const ctaType = CTA_TYPES.has(String(input?.cta_type)) ? String(input.cta_type) : "none";
  return {
    kind,
    title: text(input?.title, 160),
    subtitle: text(input?.subtitle, 180),
    description: text(input?.description, 1200),
    badge: text(input?.badge, 80),
    poster_url: text(input?.poster_url, 1500),
    backdrop_url: text(input?.backdrop_url, 1500),
    logo_url: text(input?.logo_url, 1500),
    left_image_url: text(input?.left_image_url, 1500),
    right_image_url: text(input?.right_image_url, 1500),
    competition_name: text(input?.competition_name, 160),
    competition_logo_url: text(input?.competition_logo_url, 1500),
    classic_name: text(input?.classic_name, 160),
    phase: text(input?.phase, 160),
    channels: cleanChannels(input?.channels),
    event_at: nullableDate(input?.event_at),
    cta_label: text(input?.cta_label, 80),
    cta_type: ctaType,
    cta_value: text(input?.cta_value, 1000),
    source_key: text(input?.source_key, 500),
    source_payload: input?.source_payload && typeof input.source_payload === "object" ? input.source_payload : {},
    starts_at: nullableDate(input?.starts_at),
    ends_at: nullableDate(input?.ends_at),
    priority: Math.max(-1000, Math.min(1000, Number(input?.priority) || 0)),
    enabled: input?.enabled !== false,
    created_by: text(input?.created_by || createdBy, 120),
    updated_at: new Date().toISOString(),
  };
}

async function fetchBanners(admin = false) {
  const response = await rest(`${TABLE}?select=*&order=priority.desc,created_at.desc`);
  if (!response.ok) throw new Error(`Falha ao consultar destaques: HTTP ${response.status}`);
  const rows = await response.json();
  if (admin) return rows;
  const now = Date.now();
  return (rows || []).filter((row: any) => {
    if (!row.enabled) return false;
    const start = row.starts_at ? Date.parse(row.starts_at) : NaN;
    const end = row.ends_at ? Date.parse(row.ends_at) : NaN;
    return (!Number.isFinite(start) || start <= now) && (!Number.isFinite(end) || end > now);
  });
}

function mimeExtension(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}

async function uploadImage(body: any, admin: any) {
  const mime = text(body?.content_type, 80).toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)) {
    throw new Error("Formato de imagem não suportado. Use JPG, PNG, WEBP ou GIF.");
  }
  const base64 = String(body?.base64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!base64) throw new Error("Imagem vazia.");
  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (binary.byteLength > 5 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 5 MB.");
  const safeUser = text(admin?.usuario || admin?.user || "admin", 60).replace(/[^a-z0-9_-]+/gi, "-");
  const path = `${safeUser}/${crypto.randomUUID()}.${mimeExtension(mime)}`;
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": mime,
      "x-upsert": "false",
    },
    body: binary,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("[home-banners] upload", response.status, detail);
    throw new Error("Não foi possível enviar a imagem.");
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return respond({ error: "Método não permitido." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "list_public");

    if (action === "list_public") {
      return respond({ banners: await fetchBanners(false) });
    }

    const admin = await resolveAdmin(body?.username, body?.credential ?? body?.password);
    const adminName = String(admin?.usuario || admin?.user || body?.username || "admin");

    if (action === "list_admin") {
      return respond({ banners: await fetchBanners(true) });
    }

    if (action === "upload_image") {
      return respond({ url: await uploadImage(body, admin) });
    }

    if (action === "save") {
      const banner = cleanBanner(body?.banner || {}, adminName);
      if (!banner.title && banner.kind !== "sport") throw new Error("Informe um título para o destaque.");
      const id = text(body?.banner?.id, 80);
      let response: Response;
      if (id) {
        response = await rest(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(banner),
        });
      } else {
        response = await rest(TABLE, {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ ...banner, created_at: new Date().toISOString() }),
        });
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error("[home-banners] save", response.status, detail);
        throw new Error("Não foi possível salvar o destaque.");
      }
      const saved = await response.json();
      return respond({ banner: saved?.[0] || null });
    }

    if (action === "delete") {
      const id = text(body?.id, 80);
      if (!id) throw new Error("Destaque inválido.");
      const response = await rest(`${TABLE}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Não foi possível remover o destaque.");
      return respond({ ok: true });
    }

    return respond({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    console.error("[home-banners]", error);
    return respond({ error: error instanceof Error ? error.message : "Erro inesperado." }, 400);
  }
});
