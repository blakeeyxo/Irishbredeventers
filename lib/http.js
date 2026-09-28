// Small helpers shared by the Pages Functions.

export function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export const bad = (message, status = 400) => json({ error: message }, { status });

export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

export const str = (v, max = 500) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const text = (v, max = 20000) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
export const isEmail = v => /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/.test(v);
export const isDevMode = env => env.DEV_MODE === 'true';

/** Cloudflare Turnstile check for the public forms. Fails closed when not configured. */
export async function verifyTurnstile(env, token, request) {
  if (isDevMode(env)) return true;
  if (!env.TURNSTILE_SECRET || !token) return false;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) body.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const out = await res.json().catch(() => ({}));
  return out.success === true;
}

export const siteUrl = (env, request) => (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');

export function randomToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

export const today = () => new Date().toISOString().slice(0, 10);
