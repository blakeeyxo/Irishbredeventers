-- IrishBredEventers schema (Cloudflare D1 / SQLite)
-- Riders are never stored.

CREATE TABLE batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  label TEXT NOT NULL DEFAULT '',
  row_count INTEGER NOT NULL DEFAULT 0,
  unverified_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date_text TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',   -- YYYY-MM-DD, used for sorting
  country TEXT NOT NULL DEFAULT '',
  season INTEGER NOT NULL
);
CREATE INDEX idx_events_season ON events(season, start_date);
CREATE UNIQUE INDEX idx_events_key ON events(name, start_date, country);

CREATE TABLE classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_classes_key ON classes(event_id, name);

CREATE TABLE placings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
  position INTEGER,
  horse_name TEXT NOT NULL DEFAULT '',
  former_name TEXT NOT NULL DEFAULT '',
  breed TEXT NOT NULL DEFAULT '',
  foaled INTEGER,
  sex TEXT NOT NULL DEFAULT '',
  sire TEXT NOT NULL DEFAULT '',
  dam TEXT NOT NULL DEFAULT '',
  dam_sire TEXT NOT NULL DEFAULT '',
  breeder TEXT NOT NULL DEFAULT '',
  dressage TEXT NOT NULL DEFAULT '',
  show_jumping TEXT NOT NULL DEFAULT '',
  cross_country TEXT NOT NULL DEFAULT '',
  score REAL,
  verified INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_placings_class ON placings(class_id, position);
CREATE INDEX idx_placings_batch ON placings(batch_id);
CREATE INDEX idx_placings_name ON placings(horse_name COLLATE NOCASE);
CREATE INDEX idx_placings_verified ON placings(verified);

-- Full-text search over the fields breeders search by.
CREATE VIRTUAL TABLE placings_fts USING fts5(
  horse_name, former_name, sire, dam, dam_sire, breeder,
  content='placings', content_rowid='id',
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TRIGGER placings_ai AFTER INSERT ON placings BEGIN
  INSERT INTO placings_fts(rowid, horse_name, former_name, sire, dam, dam_sire, breeder)
  VALUES (new.id, new.horse_name, new.former_name, new.sire, new.dam, new.dam_sire, new.breeder);
END;
CREATE TRIGGER placings_ad AFTER DELETE ON placings BEGIN
  INSERT INTO placings_fts(placings_fts, rowid, horse_name, former_name, sire, dam, dam_sire, breeder)
  VALUES ('delete', old.id, old.horse_name, old.former_name, old.sire, old.dam, old.dam_sire, old.breeder);
END;
CREATE TRIGGER placings_au AFTER UPDATE ON placings BEGIN
  INSERT INTO placings_fts(placings_fts, rowid, horse_name, former_name, sire, dam, dam_sire, breeder)
  VALUES ('delete', old.id, old.horse_name, old.former_name, old.sire, old.dam, old.dam_sire, old.breeder);
  INSERT INTO placings_fts(rowid, horse_name, former_name, sire, dam, dam_sire, breeder)
  VALUES (new.id, new.horse_name, new.former_name, new.sire, new.dam, new.dam_sire, new.breeder);
END;

CREATE TABLE news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  image_key TEXT,
  published_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_news_published ON news(published_at DESC);

CREATE TABLE ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tier TEXT NOT NULL CHECK (tier IN ('large', 'small')),
  name TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  image_key TEXT,
  ends_on TEXT,                          -- YYYY-MM-DD; the ad stops showing after this day
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL CHECK (scope IN ('results', 'news')),
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_comments_status ON comments(status, scope, created_at);

CREATE TABLE corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_text TEXT NOT NULL,
  message TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  confirmed INTEGER NOT NULL DEFAULT 0,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
