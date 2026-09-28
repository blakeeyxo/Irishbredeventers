// Unsubscribe link in every email. Deletes the address outright (we keep nothing else).
async function remove(env, request) {
  const token = new URL(request.url).searchParams.get('token') || '';
  await env.DB.prepare('DELETE FROM subscribers WHERE token = ?').bind(token).run();
}

export async function onRequestGet({ env, request }) {
  await remove(env, request);
  return Response.redirect(new URL('/?subscribe=removed', request.url).toString(), 303);
}

// One-click unsubscribe from mail apps (List-Unsubscribe-Post).
export async function onRequestPost({ env, request }) {
  await remove(env, request);
  return new Response('Unsubscribed', { status: 200 });
}
