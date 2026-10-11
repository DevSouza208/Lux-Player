// Read-only public catalogue. Private M3U/Xtream credentials are NEVER stored here.
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"},
});
export async function onRequestGet({request, env}) {
  if (!env.DB) return json({ok:false,error:"D1 binding DB is missing"},503);
  const url = new URL(request.url);
  const rawKind = url.searchParams.get("kind") || "all";
  if (!["all","live","movie","series","game","book"].includes(rawKind)) {
    return json({ok:false,error:"Invalid kind"},400);
  }
  const parsedLimit = Number(url.searchParams.get("limit") || 30);
  const limit = Number.isFinite(parsedLimit) ? Math.min(100,Math.max(1,Math.floor(parsedLimit))) : 30;
  try {
    const statement = rawKind === "all"
      ? env.DB.prepare("SELECT id,kind,title,category,poster_key,updated_at FROM public_catalog WHERE published = 1 ORDER BY updated_at DESC LIMIT ?").bind(limit)
      : env.DB.prepare("SELECT id,kind,title,category,poster_key,updated_at FROM public_catalog WHERE published = 1 AND kind = ? ORDER BY updated_at DESC LIMIT ?").bind(rawKind,limit);
    const rows = await statement.all();
    return json({ok:true,items:rows.results || []});
  } catch (_) {
    // Do not expose SQL internals to anonymous visitors.
    return json({ok:false,error:"D1 schema not installed"},503);
  }
}
