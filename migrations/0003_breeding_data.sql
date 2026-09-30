-- Breeding data foundation: horses, sires, dams, breeders and their results.
--
-- Sires, dams and dam sires are their own name records. A dam links to her sire (the horse's
-- dam sire), and a horse links to its sire, dam, dam sire and breeder.
-- *_normalised columns hold the matching form of a name (lowercase, no punctuation, single
-- spaces), so "Flex A Bill" and "Flex-a-Bill" are the same record.

-- Events already exist (they feed the public results pages). Add the extra detail.
ALTER TABLE events ADD COLUMN end_date TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN source_notes TEXT NOT NULL DEFAULT '';

CREATE TABLE sires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_normalised TEXT NOT NULL UNIQUE,
  breed_code TEXT NOT NULL DEFAULT '',
  tih_flag INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE dams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_normalised TEXT NOT NULL,
  breed_code TEXT NOT NULL DEFAULT '',
  tih_flag INTEGER NOT NULL DEFAULT 0,
  sire_id INTEGER REFERENCES sires(id),           -- the dam's own sire (the horse's dam sire)
  sire_key INTEGER GENERATED ALWAYS AS (IFNULL(sire_id, 0)) STORED,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Two mares can share a name; the same name with the same sire is one mare.
CREATE UNIQUE INDEX ux_dams_identity ON dams(name_normalised, sire_key);

CREATE TABLE breeders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_normalised TEXT NOT NULL,
  county TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX ux_breeders_identity ON breeders(name_normalised, county);

CREATE TABLE horses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_normalised TEXT NOT NULL,
  birth_year INTEGER,
  sex TEXT NOT NULL DEFAULT '',
  breed_code TEXT NOT NULL DEFAULT '',
  tih_flag INTEGER NOT NULL DEFAULT 0,
  sire_id INTEGER REFERENCES sires(id),
  dam_id INTEGER REFERENCES dams(id),
  damsire_id INTEGER REFERENCES sires(id),
  breeder_id INTEGER REFERENCES breeders(id),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- One horse = name + year of birth + sire + dam. Missing values count as 0 so they still match.
  identity_key TEXT GENERATED ALWAYS AS (
    name_normalised || '|' || IFNULL(birth_year, 0) || '|' || IFNULL(sire_id, 0) || '|' || IFNULL(dam_id, 0)
  ) STORED
);
CREATE UNIQUE INDEX ux_horses_identity ON horses(identity_key);

CREATE TABLE horse_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  former_name TEXT NOT NULL,
  former_name_normalised TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_horse_aliases ON horse_aliases(horse_id, former_name_normalised);

CREATE TABLE results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  horse_id INTEGER NOT NULL REFERENCES horses(id),
  rider_name TEXT NOT NULL DEFAULT '',
  rider_country TEXT NOT NULL DEFAULT '',
  class_name TEXT NOT NULL,
  placing INTEGER,
  dressage TEXT NOT NULL DEFAULT '',
  xc_jumping TEXT NOT NULL DEFAULT '',
  show_jumping TEXT NOT NULL DEFAULT '',
  total REAL,
  week_label TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 1,
  batch_id INTEGER REFERENCES batches(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- A horse appears once per class of an event, so pasting the same week twice adds nothing.
CREATE UNIQUE INDEX ux_results_identity ON results(event_id, class_name, horse_id);

-- Search by horse, former name, sire, dam and breeder, and follow the links.
CREATE INDEX idx_horses_name ON horses(name_normalised);
CREATE INDEX idx_horses_sire ON horses(sire_id);
CREATE INDEX idx_horses_dam ON horses(dam_id);
CREATE INDEX idx_horses_damsire ON horses(damsire_id);
CREATE INDEX idx_horses_breeder ON horses(breeder_id);
CREATE INDEX idx_dams_sire ON dams(sire_id);
CREATE INDEX idx_aliases_name ON horse_aliases(former_name_normalised);
CREATE INDEX idx_results_horse ON results(horse_id);
CREATE INDEX idx_results_event ON results(event_id);
CREATE INDEX idx_results_batch ON results(batch_id);

-- The public results pages read from placings. Link each placing to its result, and stop the
-- same horse being listed twice in one class.
ALTER TABLE placings ADD COLUMN result_id INTEGER REFERENCES results(id);
CREATE UNIQUE INDEX ux_placings_class_horse ON placings(class_id, lower(horse_name));

-- Spellings Charlie has confirmed are the same as an existing record ("Sligo Candyboy" = Sligo Candy Boy),
-- so the same question is not asked again next week. kind is sire, dam, breeder or horse; key is the
-- matching form used by the import.
CREATE TABLE name_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('sire', 'dam', 'breeder', 'horse')),
  match_key TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX ux_name_matches ON name_matches(kind, match_key);
