import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store"
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });
const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalize = (value: unknown) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function assertAdmin(db: any, username: unknown, password: unknown) {
  if (typeof username !== "string" || !username || typeof password !== "string" || !password) return { ok: false, status: 401, error: "Login de administrador necessário." };
  const { data, error } = await db.from("usuarios").select("cargo").eq("usuario", username).eq("senha", password).maybeSingle();
  if (error) throw error;
  if (!data || String(data.cargo || "").trim().toLowerCase() !== "admin") return { ok: false, status: 403, error: "Acesso exclusivo de administrador." };
  return { ok: true };
}

async function listMappings(db: any) {
  const { data, error } = await db.from("sports_channel_mappings")
    .select("broadcaster_key,broadcaster_name,channel_hint,updated_at")
    .order("broadcaster_name", { ascending: true });
  if (error) throw error;
  return data || [];
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    let body: any = {};
    if (request.method === "POST") { try { body = await request.json(); } catch {} }
    const url = new URL(request.url);
    const action = body.action || url.searchParams.get("action") || "list";

    if (action === "list") return json({ mappings: await listMappings(db) });

    if (action === "save") {
      const admin = await assertAdmin(db, body.username, body.password);
      if (!admin.ok) return json({ error: admin.error }, admin.status);
      const broadcasterName = clean(body.broadcaster_name);
      const channelHint = clean(body.channel_hint);
      const broadcasterKey = normalize(broadcasterName);
      if (!broadcasterKey || !channelHint) return json({ error: "Mapeamento inválido." }, 400);
      const { error } = await db.from("sports_channel_mappings").upsert({
        broadcaster_key: broadcasterKey,
        broadcaster_name: broadcasterName,
        channel_hint: channelHint,
        updated_by: body.username,
        updated_at: new Date().toISOString()
      }, { onConflict: "broadcaster_key" });
      if (error) throw error;
      return json({ ok: true, mappings: await listMappings(db) });
    }

    if (action === "delete") {
      const admin = await assertAdmin(db, body.username, body.password);
      if (!admin.ok) return json({ error: admin.error }, admin.status);
      const key = normalize(body.broadcaster_key || body.broadcaster_name);
      if (!key) return json({ error: "Emissora inválida." }, 400);
      const { error } = await db.from("sports_channel_mappings").delete().eq("broadcaster_key", key);
      if (error) throw error;
      return json({ ok: true, mappings: await listMappings(db) });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (error) {
    console.error("sports-mappings:", error);
    return json({ error: "Não foi possível acessar os mapeamentos de esportes." }, 500);
  }
});