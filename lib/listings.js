/*
 * For Sale: horse ads in the shared database (migrations-shared/0003_listings.sql), shown on every site whose
 * discipline the ad is tagged with.
 *
 * A seller sends an ad in with "I want to sell" (status draft). The owner approves it and the seller is emailed the
 * fee and how to pay (pending_payment). Once paid the owner publishes it (live) for the number of days in the
 * settings. Only live and sold ads that haven't run out are shown, and never the seller's contact details.
 */
import { normaliseName } from './names.js';
import { SITES } from './sites.js';

/**
 * An ad belongs to the site it was sent in on (or added on): it shows there, and is managed in that site's owner
 * area. Ticking "Also show on the other site" shares it there too. Returns the ad's disciplines.
 */
export function siteDisciplines(siteId, share) {
  const home = SITES[siteId] ? SITES[siteId].discipline : null;
  if (!home) return [];
  const others = Object.values(SITES).map(s => s.discipline).filter(d => d !== home);
  return share ? [home, ...others] : [home];
}
const ticked = v => v === true || ['1', 'on', 'true'].includes(String(v));

export const SEXES = ['mare', 'gelding', 'stallion', 'colt', 'filly'];
export const SELLER_TYPES = ['private', 'breeder', 'dealer'];
export const DISCIPLINES = ['eventing', 'showjumping'];
export const MAX_PHOTOS = 8;
const STATUSES = ['draft', 'pending_payment', 'live', 'sold', 'expired', 'removed', 'rejected'];

const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const longText = (v, max = 5000) => String(v ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const isEmail = v => /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/.test(v);

// What visitors can see: live or sold, not past its end date, and tagged with this site's discipline.
const SHOWN = `l.status IN ('live', 'sold') AND (l.expires_at IS NULL OR l.expires_at > datetime('now'))`;
const ON_SITE = 'EXISTS (SELECT 1 FROM listing_discipline ld WHERE ld.listing_id = l.id AND ld.discipline_code = ?)';

/** Form fields → { values, disciplines, seller, errors }. Used for a seller's ad and the owner's edits. */
export function readListing(f, { owner = false } = {}) {
  const errors = [];
  const year = Number(clean(f.foaled_year, 4));
  const thisYear = new Date().getUTCFullYear();
  const height = clean(f.height_hh, 6).replace(',', '.');
  const price = clean(f.price, 12).replace(/[€,\s]/g, '');
  const values = {
    title: clean(f.title, 100),
    horse_name: clean(f.horse_name, 80) || null,
    sex: SEXES.includes(clean(f.sex).toLowerCase()) ? clean(f.sex).toLowerCase() : null,
    foaled_year: Number.isInteger(year) && year >= thisYear - 40 && year <= thisYear ? year : null,
    height_hh: /^\d{2}(\.[0-3])?$/.test(height) && Number(height) >= 10 && Number(height) <= 19 ? Number(height) : null,
    colour: clean(f.colour, 40) || null,
    studbook: clean(f.studbook, 20).toUpperCase() || null,
    sire: clean(f.sire, 80) || null,
    dam: clean(f.dam, 80) || null,
    dam_sire: clean(f.dam_sire, 80) || null,
    level: clean(f.level, 120) || null,
    description: longText(f.description) || null,
    price_on_request: f.price_on_request === true || ['1', 'on', 'true'].includes(String(f.price_on_request)) ? 1 : 0,
    price_cents: null,
    county: clean(f.county, 40) || null,
    country: clean(f.country, 40) || 'Ireland',
    video_url: clean(f.video_url, 300) || null,
    seller_type: SELLER_TYPES.includes(clean(f.seller_type)) ? clean(f.seller_type) : 'private'
  };
  if (!values.price_on_request) {
    if (/^\d{1,7}(\.\d{1,2})?$/.test(price) && Number(price) > 0) values.price_cents = Math.round(Number(price) * 100);
    else errors.push('Add a price in euro, or tick "Price on request".');
  }
  if (!values.title) errors.push('Give the ad a title, e.g. "Talented 7yo ISH gelding, jumping 1.30m".');
  if (!values.sex) errors.push('Choose the horse\'s sex.');
  if (clean(f.foaled_year) && !values.foaled_year) errors.push('The year of birth doesn\'t look right.');
  if (height && !values.height_hh) errors.push('Height should be in hands, e.g. 16.2.');
  if (values.video_url && !/^https:\/\//i.test(values.video_url)) errors.push('The video link should start with https://');
  const raw = Array.isArray(f.disciplines) ? f.disciplines : String(f.disciplines || '').split(',');
  const disciplines = [...new Set(raw.map(d => clean(d)).filter(d => DISCIPLINES.includes(d)))];
  if (!disciplines.length) errors.push('Choose which site the ad is for.');
  const seller = { name: clean(f.seller_name, 80), email: clean(f.seller_email, 200).toLowerCase(), phone: clean(f.seller_phone, 40) };
  if (!owner) {
    if (!seller.name) errors.push('Add your name.');
    if (!isEmail(seller.email)) errors.push('Add an email address we can reach you on.');
  } else if (owner === 'create') {
    // An ad the owner puts up for a seller who phoned in: a name and a way to reach them, email or phone.
    if (!seller.name) errors.push("Add the seller's name.");
    if (seller.email && !isEmail(seller.email)) errors.push("The seller's email doesn't look right.");
    if (!seller.email && !seller.phone) errors.push("Add the seller's email or phone, so buyers' messages can reach them.");
  }
  return { values, disciplines, seller, errors };
}

/* ---------- Sellers send an ad in ---------- */

export async function createListing(db, { values, disciplines, seller }, { photoKeys, site }) {
  const source = await db.prepare("SELECT id FROM source WHERE slug = 'sellers'").first();
  // One seller record per email address, kept up to date with their latest name and phone (a seller with no email,
  // added by the owner, gets a record of their own).
  let party = seller.email ? await db.prepare(`SELECT id FROM party WHERE email = ? AND source_id = ?`).bind(seller.email, source.id).first() : null;
  if (party) {
    await db.prepare('UPDATE party SET name = ?, name_key = ?, phone = ? WHERE id = ?').bind(seller.name, normaliseName(seller.name), seller.phone || null, party.id).run();
  } else {
    party = await db.prepare(`INSERT INTO party (name, name_key, kind, email, phone, source_id) VALUES (?, ?, 'person', ?, ?, ?) RETURNING id`)
      .bind(seller.name, normaliseName(seller.name), seller.email || null, seller.phone || null, source.id).first();
  }
  const cols = Object.keys(values);
  const row = await db.prepare(`INSERT INTO listing (seller_id, submitted_site, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')}) RETURNING id`)
    .bind(party.id, site, ...cols.map(c => values[c])).first();
  await db.batch([
    ...disciplines.map(d => db.prepare('INSERT INTO listing_discipline (listing_id, discipline_code) VALUES (?, ?)').bind(row.id, d)),
    ...photoKeys.map((k, i) => db.prepare('INSERT INTO listing_photo (listing_id, image_key, position) VALUES (?, ?, ?)').bind(row.id, k, i))
  ]);
  return row.id;
}

/* ---------- What visitors see ---------- */

const PUBLIC_COLS = `l.id, l.title, l.horse_name, l.sex, l.foaled_year, l.height_hh, l.colour, l.studbook, l.sire, l.dam, l.dam_sire,
  l.level, l.price_cents, l.currency, l.price_on_request, l.county, l.country, l.seller_type, l.status, l.published_at, l.horse_id`;

/** Ads on one site, with filters: sex, min/max age, min/max height, min/max price (euro), county, q, sort, page. */
export async function listPublic(db, discipline, p = {}) {
  const where = [SHOWN, ON_SITE], binds = [discipline];
  const year = new Date().getUTCFullYear();
  const num = v => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  if (SEXES.includes(p.sex)) { where.push('l.sex = ?'); binds.push(p.sex); }
  if (num(p.age_min) !== null) { where.push('l.foaled_year <= ?'); binds.push(year - num(p.age_min)); }
  if (num(p.age_max) !== null) { where.push('l.foaled_year >= ?'); binds.push(year - num(p.age_max)); }
  if (num(p.height_min) !== null) { where.push('l.height_hh >= ?'); binds.push(num(p.height_min)); }
  if (num(p.height_max) !== null) { where.push('l.height_hh <= ?'); binds.push(num(p.height_max)); }
  if (num(p.price_min) !== null) { where.push('l.price_on_request = 0 AND l.price_cents >= ?'); binds.push(num(p.price_min) * 100); }
  if (num(p.price_max) !== null) { where.push('l.price_on_request = 0 AND l.price_cents <= ?'); binds.push(num(p.price_max) * 100); }
  if (p.county) { where.push('l.county = ?'); binds.push(clean(p.county, 40)); }
  const q = clean(p.q, 80);
  if (q) { where.push('(l.title LIKE ? OR l.horse_name LIKE ? OR l.sire LIKE ? OR l.dam_sire LIKE ? OR l.level LIKE ?)'); binds.push(...Array(5).fill(`%${q}%`)); }
  const ORDER = {
    newest: "l.status = 'sold', l.published_at DESC",
    price_low: "l.status = 'sold', l.price_on_request, l.price_cents ASC",
    price_high: "l.status = 'sold', l.price_on_request, l.price_cents DESC",
    youngest: "l.status = 'sold', l.foaled_year DESC",
    oldest: "l.status = 'sold', l.foaled_year IS NULL, l.foaled_year ASC",
    tallest: "l.status = 'sold', l.height_hh IS NULL, l.height_hh DESC"
  };
  const order = ORDER[p.sort] || ORDER.newest;
  const per = 24, page = Math.max(1, Math.min(200, Number(p.page) || 1));
  const [rows, total, counties] = await db.batch([
    db.prepare(`SELECT ${PUBLIC_COLS}, (SELECT image_key FROM listing_photo ph WHERE ph.listing_id = l.id ORDER BY position LIMIT 1) AS photo,
        (SELECT COUNT(*) FROM listing_photo ph WHERE ph.listing_id = l.id) AS photos
      FROM listing l WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...binds, per, (page - 1) * per),
    db.prepare(`SELECT COUNT(*) AS n FROM listing l WHERE ${where.join(' AND ')}`).bind(...binds),
    db.prepare(`SELECT l.county, COUNT(*) AS n FROM listing l WHERE ${SHOWN} AND ${ON_SITE} AND l.county IS NOT NULL GROUP BY l.county ORDER BY l.county`).bind(discipline)
  ]);
  return { listings: rows.results, total: total.results[0].n, page, pages: Math.max(1, Math.ceil(total.results[0].n / per)), counties: counties.results };
}

/** One ad as visitors see it (no seller details), or null. */
export async function getPublic(db, id, discipline) {
  const l = await db.prepare(`SELECT ${PUBLIC_COLS}, l.description, l.video_url FROM listing l WHERE l.id = ? AND ${SHOWN} AND ${ON_SITE}`)
    .bind(id, discipline).first();
  if (!l) return null;
  const [photos, disc] = await db.batch([
    db.prepare('SELECT image_key FROM listing_photo WHERE listing_id = ? ORDER BY position, id').bind(id),
    db.prepare('SELECT discipline_code FROM listing_discipline WHERE listing_id = ?').bind(id)
  ]);
  return { ...l, photos: photos.results.map(p => p.image_key), disciplines: disc.results.map(d => d.discipline_code) };
}

/* ---------- Buyers ask about an ad ---------- */

export function readEnquiry(f) {
  const e = { name: clean(f.name, 80), email: clean(f.email, 200).toLowerCase(), phone: clean(f.phone, 40), message: longText(f.message, 3000) };
  const errors = [];
  if (!e.name) errors.push('Add your name.');
  if (!isEmail(e.email)) errors.push('Add your email so the seller can reply.');
  if (!e.message) errors.push('Write a message to the seller.');
  return { enquiry: e, errors };
}

/** Saves an enquiry on a visible ad; returns the ad and its seller for the email, or null if the ad isn't shown. */
export async function addEnquiry(db, id, discipline, e) {
  const l = await db.prepare(`SELECT l.id, l.title, p.name AS seller_name, p.email AS seller_email, p.phone AS seller_phone FROM listing l JOIN party p ON p.id = l.seller_id
    WHERE l.id = ? AND l.status = 'live' AND (l.expires_at IS NULL OR l.expires_at > datetime('now')) AND ${ON_SITE}`).bind(id, discipline).first();
  if (!l) return null;
  const row = await db.prepare('INSERT INTO listing_enquiry (listing_id, name, email, phone, message) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(id, e.name, e.email, e.phone || null, e.message).first();
  return { listing: l, enquiryId: row.id };
}

/* ---------- Owner area ---------- */

export async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM setting').all();
  const s = Object.fromEntries(results.map(r => [r.key, r.value]));
  return { listing_days: Number(s.listing_days) || 60, listing_fee_cents: s.listing_fee_cents ? Number(s.listing_fee_cents) : null, payment_instructions: s.payment_instructions || '' };
}

export async function saveSettings(db, f) {
  const days = Math.max(7, Math.min(365, Number(f.listing_days) || 60));
  const fee = clean(f.listing_fee, 10).replace(/[€,\s]/g, '');
  const feeCents = /^\d{1,5}(\.\d{1,2})?$/.test(fee) ? String(Math.round(Number(fee) * 100)) : '';
  const put = (k, v) => db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v);
  await db.batch([put('listing_days', String(days)), put('listing_fee_cents', feeCents), put('payment_instructions', longText(f.payment_instructions, 2000))]);
  return getSettings(db);
}

/** The queue: counts by status, and the ads in one status (with photos, seller and enquiries). */
export async function listForOwner(db, status, siteId) {
  const st = STATUSES.includes(status) ? status : 'draft';
  // A live ad past its end date shows under Expired.
  const filter = st === 'live' ? `l.status = 'live' AND (l.expires_at IS NULL OR l.expires_at > datetime('now'))`
    : st === 'expired' ? `(l.status = 'expired' OR (l.status = 'live' AND l.expires_at <= datetime('now')))` : 'l.status = ?';
  const binds = st === 'live' || st === 'expired' ? [] : [st];
  // Each site's owner area manages the ads sent in (or added) on that site only.
  const own = siteId ? 'submitted_site = ?' : '1 = 1', ownL = siteId ? 'l.submitted_site = ?' : '1 = 1';
  const ownBind = siteId ? [siteId] : [];
  const [counts, rows] = await db.batch([
    db.prepare(`SELECT CASE WHEN status = 'live' AND expires_at <= datetime('now') THEN 'expired' ELSE status END AS s, COUNT(*) AS n
      FROM listing WHERE ${own} GROUP BY s`).bind(...ownBind),
    db.prepare(`SELECT l.*, p.name AS seller_name, p.email AS seller_email, p.phone AS seller_phone, h.name AS horse_link_name,
        (SELECT COUNT(*) FROM listing_enquiry e WHERE e.listing_id = l.id) AS enquiries,
        (SELECT group_concat(discipline_code) FROM listing_discipline d WHERE d.listing_id = l.id) AS disciplines,
        (SELECT json_group_array(json_object('id', ph.id, 'key', ph.image_key)) FROM (SELECT * FROM listing_photo WHERE listing_id = l.id ORDER BY position, id) ph) AS photos
      FROM listing l JOIN party p ON p.id = l.seller_id LEFT JOIN horse h ON h.id = l.horse_id
      WHERE ${filter} AND ${ownL} ORDER BY l.created_at DESC LIMIT 200`).bind(...binds, ...ownBind)
  ]);
  return {
    counts: Object.fromEntries(counts.results.map(c => [c.s, c.n])),
    listings: rows.results.map(r => ({ ...r, disciplines: (r.disciplines || '').split(',').filter(Boolean), photos: JSON.parse(r.photos || '[]') }))
  };
}

export async function enquiriesFor(db, id) {
  const { results } = await db.prepare('SELECT id, name, email, phone, message, emailed, created_at FROM listing_enquiry WHERE listing_id = ? ORDER BY id DESC').bind(id).all();
  return results;
}

export async function getForOwner(db, id) {
  return db.prepare(`SELECT l.*, p.name AS seller_name, p.email AS seller_email, p.phone AS seller_phone,
      (SELECT group_concat(discipline_code) FROM listing_discipline d WHERE d.listing_id = l.id) AS disciplines
    FROM listing l JOIN party p ON p.id = l.seller_id WHERE l.id = ?`).bind(id).first();
}

/** Links the ad to the horse in the shared database when exactly one horse has its name (and year, if given). */
export async function linkHorse(db, id) {
  const l = await db.prepare('SELECT horse_name, foaled_year FROM listing WHERE id = ?').bind(id).first();
  if (!l || !l.horse_name) return null;
  const { results } = await db.prepare(`SELECT id FROM horse WHERE (name_key = ?1 OR id IN (SELECT horse_id FROM horse_alias WHERE alias_key = ?1))
      AND (?2 IS NULL OR foaled_year IS NULL OR foaled_year = ?2) LIMIT 2`).bind(normaliseName(l.horse_name), l.foaled_year).all();
  if (results.length !== 1) return null;
  await db.prepare('UPDATE listing SET horse_id = ? WHERE id = ?').bind(results[0].id, id).run();
  return results[0].id;
}

/**
 * One owner action on an ad. Returns { listing, email } where email names the message to send the seller
 * ('approved', 'live', 'rejected'), if any.
 *   save      edit the ad's details and disciplines
 *   approve   { fee } → pending_payment, emails the payment request (also "send it again")
 *   publish   → live for the settings' number of days, from today (also renews an expired ad)
 *   extend    adds the settings' number of days to the end date
 *   sold | remove | reject { reason } | note { note }
 */
export async function ownerAction(db, id, action, f = {}) {
  const l = await getForOwner(db, id);
  if (!l) throw new Error('That ad no longer exists.');
  const settings = await getSettings(db);
  const set = fields => db.prepare(`UPDATE listing SET ${Object.keys(fields).map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...Object.values(fields), id);
  let email = null;
  if (action === 'save') {
    // Its own site always; the other site only when "Also show on" is ticked.
    if (l.submitted_site && SITES[l.submitted_site]) f = { ...f, disciplines: siteDisciplines(l.submitted_site, ticked(f.share_other)) };
    const { values, disciplines, errors } = readListing(f, { owner: true });
    if (errors.length) throw new Error(errors.join(' '));
    await db.batch([
      set(values),
      db.prepare('DELETE FROM listing_discipline WHERE listing_id = ?').bind(id),
      ...disciplines.map(d => db.prepare('INSERT INTO listing_discipline (listing_id, discipline_code) VALUES (?, ?)').bind(id, d))
    ]);
  } else if (action === 'approve') {
    const fee = clean(f.fee, 10).replace(/[€,\s]/g, '');
    const cents = /^\d{1,5}(\.\d{1,2})?$/.test(fee) ? Math.round(Number(fee) * 100) : settings.listing_fee_cents;
    if (!cents && cents !== 0) throw new Error('Enter the fee for this ad (or set a default fee in For Sale settings).');
    if (!['draft', 'pending_payment', 'rejected'].includes(l.status)) throw new Error('Only an ad waiting for review or payment can be sent a payment request.');
    await set({ status: 'pending_payment', listing_fee_cents: cents, approved_at: l.approved_at || new Date().toISOString().slice(0, 19).replace('T', ' ') }).run();
    email = 'approved';
  } else if (action === 'publish') {
    await db.prepare(`UPDATE listing SET status = 'live', paid_at = IFNULL(paid_at, datetime('now')), published_at = datetime('now'),
        expires_at = datetime('now', ?), updated_at = datetime('now') WHERE id = ?`).bind(`+${settings.listing_days} days`, id).run();
    if (!l.horse_id) await linkHorse(db, id);
    email = l.status === 'live' ? null : 'live';
  } else if (action === 'extend') {
    await db.prepare(`UPDATE listing SET expires_at = datetime(MAX(IFNULL(expires_at, datetime('now')), datetime('now')), ?), updated_at = datetime('now') WHERE id = ?`)
      .bind(`+${settings.listing_days} days`, id).run();
  } else if (action === 'sold') {
    await db.prepare(`UPDATE listing SET status = 'sold', sold_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(id).run();
  } else if (action === 'remove') {
    await set({ status: 'removed' }).run();
  } else if (action === 'reject') {
    await set({ status: 'rejected', reject_reason: longText(f.reason, 1000) || null }).run();
    email = 'rejected';
  } else if (action === 'note') {
    await set({ owner_note: longText(f.note, 2000) || null }).run();
  } else if (action === 'unlink') {
    await set({ horse_id: null }).run();
  } else {
    throw new Error('Unknown action.');
  }
  return { listing: await getForOwner(db, id), email, settings };
}

/** Deletes an ad for good. Returns the photo keys to remove from storage. */
export async function deleteListing(db, id) {
  const { results } = await db.prepare('SELECT image_key FROM listing_photo WHERE listing_id = ?').bind(id).all();
  await db.prepare('DELETE FROM listing WHERE id = ?').bind(id).run();
  return results.map(r => r.image_key);
}

export async function deletePhoto(db, photoId) {
  return db.prepare('DELETE FROM listing_photo WHERE id = ? RETURNING image_key').bind(photoId).first();
}

export const euro = cents => (cents === null || cents === undefined ? '' : `€${(cents / 100).toLocaleString('en-IE', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`);
