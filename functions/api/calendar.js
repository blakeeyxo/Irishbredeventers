// Upcoming events, worked out from the archive: each event that has run before is expected again on the
// same weekday of the same week, one year on (364 days later, or a multiple of that). Only the next 12
// months are listed, and each entry says which past run it is based on. These are expectations, not
// fixtures: the page says to check dates with the organiser.
import { json, today } from '../../lib/http.js';
import { normaliseName } from '../../lib/names.js';

const DAY = 864e5;
const toDay = iso => Date.parse(`${iso}T00:00:00Z`) / DAY;
const toIso = day => new Date(day * DAY).toISOString().slice(0, 10);
const YEAR = 364; // keeps the weekday, so a Saturday–Sunday event stays a weekend

/** past: [{ name, country, start_date, end_date, date_text }] → expected events from `from` for `days` days. */
export function expectedEvents(past, from, days = 365) {
  const start = toDay(from), end = start + days;
  const byVenue = new Map();
  for (const e of past) {
    const s = toDay(e.start_date);
    if (!(s < start) || /^Event heading missing/.test(e.name)) continue;
    const k = Math.max(1, Math.ceil((start - s) / YEAR));
    const expected = s + k * YEAR;
    if (expected >= end) continue;
    const length = e.end_date ? Math.max(0, toDay(e.end_date) - s) : 0;
    const item = {
      name: e.name, country: e.country, expected_start: toIso(expected), expected_end: length ? toIso(expected + length) : '',
      based_on: e.date_text || e.start_date, based_on_date: e.start_date
    };
    // The same event in the same week from several past seasons: keep the most recent run.
    const key = `${normaliseName(e.name)}|${e.country}|${Math.floor(expected / 7)}`;
    const seen = byVenue.get(key);
    if (!seen || seen.based_on_date < item.based_on_date) byVenue.set(key, item);
  }
  return [...byVenue.values()].sort((a, b) => a.expected_start.localeCompare(b.expected_start) || a.name.localeCompare(b.name));
}

export async function onRequestGet({ env }) {
  const from = today();
  const { results } = await env.DB.prepare(
    `SELECT name, country, start_date, end_date, date_text FROM events WHERE start_date <> '' AND start_date < ? ORDER BY start_date`
  ).bind(from).all();
  return json({ from, events: expectedEvents(results, from) }, { headers: { 'cache-control': 'public, max-age=3600' } });
}
