// Serves news photos and ad images from R2 at /media/<key>.
export async function onRequestGet({ env, params }) {
  const key = (params.path || []).join('/');
  if (!/^(news|ads|links)\/[\w.-]+$/.test(key)) return new Response('Not found', { status: 404 });
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}
