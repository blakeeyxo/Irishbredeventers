// Results-email sign-up, step 2: the link in the confirm email.
export async function onRequestGet({ env, request }) {
  const token = new URL(request.url).searchParams.get('token') || '';
  const res = await env.DB.prepare('UPDATE subscribers SET confirmed = 1 WHERE token = ?').bind(token).run();
  const status = res.meta.changes ? 'confirmed' : 'invalid';
  return Response.redirect(new URL(`/?subscribe=${status}`, request.url).toString(), 303);
}
