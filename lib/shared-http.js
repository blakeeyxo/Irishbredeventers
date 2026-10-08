// Shared-database handlers: a clear message when the database isn't connected or set up yet.
import { bad } from './http.js';

export async function withShared(env, fn) {
  if (!env.SHARED) return bad('The shared horse database is not connected to this site yet.', 503);
  try {
    return await fn(env.SHARED);
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) {
      return bad('The shared horse database has no tables yet. Run: npm run db:migrate:shared:remote', 503);
    }
    throw e;
  }
}
