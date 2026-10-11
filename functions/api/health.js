// Cloudflare Pages Function: only operational state; no secrets, no account data.
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"},
});
export async function onRequestGet({env}) {
  return json({
    ok: true,
    service: "lux-cloudflare",
    d1Bound: Boolean(env.DB),
    r2Bound: Boolean(env.MEDIA_BUCKET),
    ready: Boolean(env.DB && env.MEDIA_BUCKET),
  });
}
