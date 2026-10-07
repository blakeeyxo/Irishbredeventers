// Public settings the browser needs (the Turnstile site key is public by design).
import { json } from '../../lib/http.js';

export const onRequestGet = ({ env }) => json({
  turnstileSiteKey: env.DEV_MODE === 'true' ? '' : (env.TURNSTILE_SITE_KEY || ''),
  currentYear: new Date().getFullYear()
}, { headers: { 'cache-control': 'public, max-age=300' } });
