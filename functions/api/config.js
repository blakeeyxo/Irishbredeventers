// Public settings the browser needs (the Turnstile site key is public by design).
import { json } from '../../lib/http.js';

export async function onRequestGet({ env }) {
  // How OBOS is written on the site (owner's choice in Breeding records; stored as OBOS).
  const obos = env.DB ? await env.DB.prepare("SELECT value FROM settings WHERE key = 'obos_spelling'").first().catch(() => null) : null;
  return json({
    turnstileSiteKey: env.DEV_MODE === 'true' ? '' : (env.TURNSTILE_SITE_KEY || ''),
    currentYear: new Date().getFullYear(),
    obosSpelling: obos && obos.value === 'O.B.O.S.' ? 'O.B.O.S.' : 'OBOS'
  }, { headers: { 'cache-control': 'public, max-age=300' } });
}
