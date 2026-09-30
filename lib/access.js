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

/** Returns { email } for a valid owner login, or null. */
export async function verifyAccess(request, env) {
  if (isDevMode(env) && ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname)) {
    return { email: 'dev@localhost' };
  }
  const team = (env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!team || !env.ACCESS_AUD) return null;
  const token = readToken(request);
  if (!token) return null;

  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  let header, payload;
  try { header = b64urlJson(h); payload = b64urlJson(p); } catch { return null; }
  if (header.alg !== 'RS256') return null;

  const keys = await getKeys(team);
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (payload.exp && payload.exp < now) return null;
  if (payload.iss && payload.iss !== `https://${team}`) return null;

  const email = String(payload.email || '').toLowerCase();
  const allowed = (env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(email)) return null;
  return { email };
}
