// Only keys intentionally placed under public/ are accessible anonymously.
// Never expose private ROMs, saves, playlists or arbitrary R2 object paths.
export async function onRequestGet({env,params}) {
  if (!env.MEDIA_BUCKET) return new Response("R2 unavailable",{status:503});
  const value = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  let key;
  try { key = decodeURIComponent(value); } catch (_) { return new Response("Not found",{status:404}); }
  if (!/^public\/[A-Za-z0-9_.\/-]{1,240}$/.test(key)
      || key.includes("..") || key.includes("//") || key.endsWith("/")) {
    return new Response("Not found",{status:404});
  }
  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) return new Response("Not found",{status:404});
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag",object.httpEtag);
  headers.set("Cache-Control","public, max-age=3600");
  headers.set("X-Content-Type-Options","nosniff");
  if (!headers.has("Content-Type")) headers.set("Content-Type","application/octet-stream");
  return new Response(object.body,{status:200,headers});
}
