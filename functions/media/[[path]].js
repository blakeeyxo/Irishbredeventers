// Serves news photos and ad images from R2 at /media/<key> (advert originals kept for re-cropping are in ads/originals/).
export async function onRequestGet({ env, params }) {
  const key = (params.path || []).join('/');
  if (!/^(news|ads|links|ads\/originals)\/[\w.-]+$/.test(key)) return new Response('Not found', { status: 404 });
  // A phone crop that was never made falls back to the photo itself.
  const obj = (await env.MEDIA.get(key)) || (/-phone\.[a-z]+$/.test(key) ? await env.MEDIA.get(key.replace(/-phone(\.[a-z]+)$/, '$1')) : null);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}
