-- Owner uploads of stallion and breeding data (owner area → Shared stallions & breeding).
--
-- * name_key / alias_key: the matching form of a name (lib/names.js normaliseName), so "Flex A Bill" and
--   "Flex-a-Bill" are one horse. Filled in by the upload code, never typed.
-- * upload: one row per confirmed file, with its source and counts.
-- * upload_change: every field an upload set or changed, with the old value, so any value on a horse can be traced
--   to the upload and source it came from (and an upload can be undone later).

ALTER TABLE horse ADD COLUMN name_key TEXT NOT NULL DEFAULT '';
ALTER TABLE horse ADD COLUMN updated_at TEXT;
CREATE INDEX idx_horse_name_key ON horse (name_key, foaled_year);

ALTER TABLE horse_alias ADD COLUMN alias_key TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_horse_alias_key ON horse_alias (alias_key);

ALTER TABLE party ADD COLUMN name_key TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_party_name_key ON party (name_key, county);

CREATE TABLE upload (
  id            INTEGER PRIMARY KEY,
  source_id     INTEGER NOT NULL REFERENCES source (id),
  label         TEXT NOT NULL DEFAULT '',
  filename      TEXT NOT NULL DEFAULT '',
  row_count     INTEGER NOT NULL DEFAULT 0,
  added         INTEGER NOT NULL DEFAULT 0,      -- new horses (including sires and dams first named in this file)
  updated       INTEGER NOT NULL DEFAULT 0,      -- existing horses given new details
  held          INTEGER NOT NULL DEFAULT 0,      -- rows not saved because they need a decision
  created_by    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE upload_change (
  id          INTEGER PRIMARY KEY,
  upload_id   INTEGER NOT NULL REFERENCES upload (id) ON DELETE CASCADE,
  table_name  TEXT NOT NULL,                     -- 'horse', 'party', 'horse_alias'
  row_id      INTEGER NOT NULL,
  field       TEXT NOT NULL,                     -- '*' = the row was created
  old_value   TEXT,
  new_value   TEXT
);
CREATE INDEX idx_upload_change_row ON upload_change (table_name, row_id);

-- The two sources known so far. FEI stays hidden (nothing stored or shown) until its terms are confirmed.
INSERT INTO source (slug, name, kind, licence_status, can_store, can_display, can_republish_commercially, terms_url, notes)
VALUES
  ('iber', 'IrishBredEventingResults', 'publisher', 'agreed_in_writing', 1, 1, 0, NULL,
   'Our own eventing results service (Charlie Ripman). For merging IBER''s horses and stallions in later.'),
  ('fei', 'FEI Database', 'federation', 'unknown', 0, 0, 0, 'https://data.fei.org/Horse/Search.aspx',
   'Terms of reuse not yet confirmed. Do not upload FEI data until they are.');
