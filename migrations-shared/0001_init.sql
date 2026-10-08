-- Shared horse database (irishbredhorses): stallions, horses, pedigree and breeders, read by IBER and IBSR,
-- and later the BlackType database. Showjumping results live here too, next to the horses they belong to.
-- From schema.sql (Irish Bred Horse Results shared database, v0.1 draft), sections 1 to 4 only:
-- source, party, horse (+ aliases, match candidates), discipline, competition_event, competition_class, result.
-- Sales, listings, black type, the fee ledger and the cross-site views are out of scope for now and not created.
--
-- Changes from schema.sql:
--   * result: eventing's single score is replaced by showjumping faults and time.
--   * Every imported row records its source: source_id is NOT NULL on horse, horse_alias, party,
--     competition_event, competition_class and result (party and competition_class gain the column).
--   * result is unique on (class_id, horse_id): with rider_id empty, SQLite would let the same horse in
--     the same class be saved twice.
--   * The kind and licence_status lists were cut off in the PDF copy of schema.sql; completed here.

PRAGMA foreign_keys = ON;

-- 1. PROVENANCE: every row of imported data points at a source, so licence terms, takedowns and
--    "who gave us this" are traceable.
CREATE TABLE source (
  id                         INTEGER PRIMARY KEY,
  slug                       TEXT NOT NULL UNIQUE,                 -- 'fei', 'hsi', ...
  name                       TEXT NOT NULL,
  kind                       TEXT NOT NULL CHECK (kind IN
                               ('sales_company', 'federation', 'studbook', 'publisher', 'other')),
  licence_status             TEXT NOT NULL DEFAULT 'unknown' CHECK (licence_status IN
                               ('unknown', 'requested', 'agreed_in_writing', 'refused')),
  can_store                  INTEGER NOT NULL DEFAULT 0,           -- allowed to hold the data
  can_display                INTEGER NOT NULL DEFAULT 0,           -- allowed to show it on the site
  can_republish_commercially INTEGER NOT NULL DEFAULT 0,           -- allowed inside paid products
  terms_url                  TEXT,
  contact                    TEXT,
  notes                      TEXT,
  created_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. PEOPLE & ORGS (breeders, owners, riders)
CREATE TABLE party (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'org')),
  county      TEXT,
  country     TEXT,
  email       TEXT,
  source_id   INTEGER NOT NULL REFERENCES source (id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_party_name ON party (name COLLATE NOCASE);

-- 3. HORSES & PEDIGREE: one row per horse.
CREATE TABLE horse (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  sex          TEXT NOT NULL DEFAULT 'unknown' CHECK (sex IN
                 ('stallion', 'mare', 'gelding', 'colt', 'filly', 'unknown')),
  foaled_year  INTEGER,
  colour       TEXT,
  studbook     TEXT,                                               -- 'ISH', 'KWPN', 'HANN', ...
  ueln         TEXT UNIQUE,                                        -- passport / UELN
  fei_id       TEXT UNIQUE,
  sji_id       TEXT,
  sire_id      INTEGER REFERENCES horse (id),
  dam_id       INTEGER REFERENCES horse (id),
  breeder_id   INTEGER REFERENCES party (id),
  irish_bred   INTEGER NOT NULL DEFAULT 0,
  source_id    INTEGER NOT NULL REFERENCES source (id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_horse_sire ON horse (sire_id);
CREATE INDEX idx_horse_dam  ON horse (dam_id);
CREATE INDEX idx_horse_name ON horse (name COLLATE NOCASE, foaled_year);

-- Alternative names ("AKA ..."), prefixes, renamed horses.
CREATE TABLE horse_alias (
  horse_id   INTEGER NOT NULL REFERENCES horse (id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  source_id  INTEGER NOT NULL REFERENCES source (id),
  PRIMARY KEY (horse_id, alias)
);

-- Possible duplicates land here for a person to confirm or reject before anything is merged.
CREATE TABLE horse_match_candidate (
  id           INTEGER PRIMARY KEY,
  horse_a_id   INTEGER NOT NULL REFERENCES horse (id),
  horse_b_id   INTEGER NOT NULL REFERENCES horse (id),
  score        REAL,                                               -- 0..1 match confidence
  reason       TEXT,                                               -- 'same name+year', ...
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'same', 'different')),
  reviewed_at  TEXT,
  CHECK (horse_a_id < horse_b_id),
  UNIQUE (horse_a_id, horse_b_id)
);

-- 4. SPORT RESULTS
CREATE TABLE discipline (
  code  TEXT PRIMARY KEY,                                          -- 'eventing', 'showjumping'
  name  TEXT NOT NULL
);
INSERT INTO discipline (code, name) VALUES ('eventing', 'Eventing'), ('showjumping', 'Showjumping');

CREATE TABLE competition_event (
  id               INTEGER PRIMARY KEY,
  discipline_code  TEXT NOT NULL DEFAULT 'showjumping' REFERENCES discipline (code),
  name             TEXT NOT NULL,
  venue            TEXT,
  country          TEXT,
  start_date       TEXT,                                           -- YYYY-MM-DD; year, month and week filters
  end_date         TEXT,
  source_id        INTEGER NOT NULL REFERENCES source (id)
);
CREATE INDEX idx_event_disc_date ON competition_event (discipline_code, start_date);

CREATE TABLE competition_class (
  id              INTEGER PRIMARY KEY,
  event_id        INTEGER NOT NULL REFERENCES competition_event (id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  level_label     TEXT,                                            -- 'CSI3*', '1.45m', ...; the level filter
  level_rank      INTEGER,                                         -- normalised so levels sort across shows
  spec            TEXT,                                            -- height / format (e.g. 'two phases', 'jump-off')
  prize_amount    INTEGER,
  prize_currency  TEXT,
  source_id       INTEGER NOT NULL REFERENCES source (id)
);
CREATE INDEX idx_class_event ON competition_class (event_id);

-- One horse in one class. Showjumping: faults, then time (fewest faults wins, time separates).
CREATE TABLE result (
  id            INTEGER PRIMARY KEY,
  class_id      INTEGER NOT NULL REFERENCES competition_class (id) ON DELETE CASCADE,
  horse_id      INTEGER NOT NULL REFERENCES horse (id),
  rider_id      INTEGER REFERENCES party (id),
  owner_id      INTEGER REFERENCES party (id),
  placing       INTEGER,                                         -- NULL = unplaced
  faults        REAL,                                            -- total faults in the deciding round
  time_seconds  REAL,                                            -- time in the deciding round
  source_id     INTEGER NOT NULL REFERENCES source (id),
  UNIQUE (class_id, horse_id)
);
CREATE INDEX idx_result_horse ON result (horse_id);
