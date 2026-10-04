/*
 * Checks the Cloudflare Access login on owner-area API calls.
 *
 * Cloudflare Access guards the sign-in path (/signin) and does the emailed-code login; its
 * CF_Authorization cookie then comes with every request to the site. The Worker checks that
 * signed token on every /admin and /api/admin request and answers a plain 404 without it,
 * so the owner area stays hidden and closed even if the Access policy is ever misconfigured.
 */
import { isDevMode } from './http.js';

let certCache = { at: 0, keys: null, team: '' };

const b64urlToBytes = s => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
};
const b64urlJson = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function getKeys(team) {
  if (certCache.keys && certCache.team === team && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('Could not load Access keys');
  const { keys } = await res.json();
  certCache = { at: Date.now(), keys, team };
  return keys;
}

function readToken(request) {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? m[1] : null;
}

/**
 * Returns { email } for a valid owner login, or null. When it returns null, why.reason says why (for the
 * Worker logs): not-configured, no-token, bad-token, wrong-key, bad-signature, wrong-audience, expired,
 * wrong-issuer or not-allowed.
 */
export async function verifyAccess(request, env, why = {}) {
  const fail = reason => { why.reason = reason; return null; };
  if (isDevMode(env) && ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname)) {
    return { email: 'dev@localhost' };
  }
  const team = (env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!team || !env.ACCESS_AUD) return fail('not-configured');
  const token = readToken(request);
  if (!token) return fail('no-token');

  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return fail('bad-token');
  let header, payload;
  try { header = b64urlJson(h); payload = b64urlJson(p); } catch { return fail('bad-token'); }
  if (header.alg !== 'RS256') return fail('bad-token');

  const keys = await getKeys(team);
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) return fail('wrong-key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return fail('bad-signature');

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return fail('wrong-audience');
  if (payload.exp && payload.exp < now) return fail('expired');
  if (payload.iss && payload.iss !== `https://${team}`) return fail('wrong-issuer');

  const email = String(payload.email || '').toLowerCase();
  const allowed = (env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(email)) return fail('not-allowed');
  return { email };
}
