// Serves For Sale photos from the shared bucket (LISTING_MEDIA) at /listing-media/listings/<file>.
export async function onRequestGet({ env, params }) {
  const key = (params.path || []).join('/');
  if (!env.LISTING_MEDIA || !/^listings\/[\w-]+\.(jpg|png|webp|gif)$/.test(key)) return new Response('Not found', { status: 404 });
  const obj = await env.LISTING_MEDIA.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}
