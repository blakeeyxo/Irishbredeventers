-- FEI and SporthorseData both agreed (by email, October 2026, per Emer) that the site may read their pages
-- automatically, at most 1000 horses a day each. Keep both emails on file.
UPDATE source
SET notes = 'FEI agreed by email (October 2026) that results for Irish-bred horses may be reused on the sites, and that the site may read the FEI database automatically, at most 1000 horses a day. Keep the FEI emails on file.'
WHERE slug = 'fei';

INSERT INTO source (slug, name, kind, licence_status, can_store, can_display, can_republish_commercially, terms_url, notes)
VALUES ('sporthorse-data', 'SporthorseData', 'other', 'agreed_in_writing', 1, 1, 0, 'https://sporthorse-data.com/',
  'SporthorseData agreed by email (October 2026) that its pedigrees and breeders may be used to fill in breeding on the sites, and that the site may read its pages automatically, at most 1000 horses a day. Keep the email on file.');

-- The automatic readers, one row per source: off until the owner switches them on in the owner area.
-- daily_limit is the owner's choice; it can never go above max_daily (what the source agreed to).
CREATE TABLE auto_reader (
  slug         TEXT PRIMARY KEY REFERENCES source (slug),
  enabled      INTEGER NOT NULL DEFAULT 0,
  daily_limit  INTEGER NOT NULL DEFAULT 300,
  max_daily    INTEGER NOT NULL,
  updated_at   TEXT,
  updated_by   TEXT
);
INSERT INTO auto_reader (slug, enabled, daily_limit, max_daily) VALUES ('fei', 0, 300, 1000), ('sporthorse-data', 0, 300, 1000);

-- Every horse an automatic reader looked at, so the daily limit counts horses and the owner can see what happened.
CREATE TABLE auto_read (
  id         INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL,
  day        TEXT NOT NULL,                       -- YYYY-MM-DD (UTC)
  horse      TEXT NOT NULL,                       -- name, as read
  fei_id     TEXT,
  outcome    TEXT NOT NULL,                       -- 'saved', 'nothing_new', 'not_found', 'failed', 'held'
  detail     TEXT NOT NULL DEFAULT '',
  read_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_auto_read_day ON auto_read (slug, day);

-- Breeding looked up on SporthorseData, one row per shared horse, so a horse isn't looked up again and again.
CREATE TABLE breeding_lookup (
  horse_id      INTEGER PRIMARY KEY REFERENCES horse (id) ON DELETE CASCADE,
  url           TEXT,                              -- the SporthorseData page used
  outcome       TEXT NOT NULL,                     -- 'saved', 'nothing_new', 'not_found', 'failed', 'held'
  looked_up_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
