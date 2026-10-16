// Owner area: is this site's spam check (Cloudflare Turnstile) set up, and does Cloudflare accept its secret key?
import { json, spamCheckStatus } from '../../../lib/http.js';

export const onRequestGet = async ({ env }) => json(await spamCheckStatus(env));
