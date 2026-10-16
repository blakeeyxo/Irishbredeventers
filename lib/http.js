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

/**
 * Cloudflare Turnstile check for the public forms. Fails closed when not configured. A refusal is logged with
 * Cloudflare's reason (Worker → Logs), e.g. "invalid-input-secret" when the secret is from a different widget.
 */
export async function verifyTurnstile(env, token, request) {
  if (isDevMode(env)) return true;
  if (!env.TURNSTILE_SECRET) { console.error('Turnstile refused: TURNSTILE_SECRET is not set on this Worker'); return false; }
  if (!token) { console.error('Turnstile refused: the form sent no token'); return false; }
  const out = await siteverify(env.TURNSTILE_SECRET, token, request.headers.get('CF-Connecting-IP'));
  if (out.success !== true) console.error(`Turnstile refused: ${(out['error-codes'] || []).join(', ') || 'no reason given'}${out.hostname ? ` (hostname ${out.hostname})` : ''}`);
  return out.success === true;
}

async function siteverify(secret, token, ip) {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  return res.json().catch(() => ({}));
}

/**
 * For the owner area: is the spam check set up on this Worker, and does Cloudflare accept its secret key?
 * A made-up token is sent: Cloudflare answers "invalid-input-response" when the secret is right (only the token is
 * wrong) and "invalid-input-secret" when the secret itself is wrong.
 */
export async function spamCheckStatus(env) {
  const siteKey = env.TURNSTILE_SITE_KEY || '', hasSecret = Boolean(env.TURNSTILE_SECRET);
  let secretOk = null, codes = [];
  if (hasSecret) {
    const out = await siteverify(env.TURNSTILE_SECRET, 'XXXX.DUMMY.TOKEN.XXXX').catch(() => ({}));
    codes = out['error-codes'] || [];
    secretOk = !codes.includes('invalid-input-secret') && !codes.includes('missing-input-secret');
  }
  return { siteKey: siteKey ? `${siteKey.slice(0, 12)}…` : '', hasSiteKey: Boolean(siteKey), hasSecret, secretOk, codes };
}

export const siteUrl = (env, request) => (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');

export function randomToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

export const today = () => new Date().toISOString().slice(0, 10);
