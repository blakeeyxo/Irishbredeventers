-- For Sale → Looking for: buyers say what horse they're looking for; sellers who have one answer through a form.
-- New tables only; nothing existing changes.
--
-- How a "looking for" post moves (status):
--   draft     sent in by a buyer, waiting for the owner to review it
--   live      approved, on the site until expires_at (the For Sale "Days an ad stays live" setting)
--   found     the buyer found a horse; taken off the site
--   removed   taken down by the owner
--   rejected  not accepted; the buyer is told why
-- Only live posts that haven't run out are shown. The buyer's contact details are never shown: a seller's answer
-- is emailed on to the buyer, who replies directly.

CREATE TABLE wanted (
  id                INTEGER PRIMARY KEY,
  submitted_site    TEXT NOT NULL DEFAULT '',            -- 'iber' or 'ibsr': where the buyer sent it in
  title             TEXT NOT NULL,                       -- e.g. "Looking for a 1.20m schoolmaster for a teenager"
  description       TEXT,
  sex               TEXT,                                -- mare, gelding, stallion, or empty for any
  age_min           INTEGER,
  age_max           INTEGER,
  height_min        REAL,                                -- hands, e.g. 15.2
  height_max        REAL,
  budget_cents      INTEGER,                             -- up to; empty when the buyer didn't say
  level             TEXT,                                -- e.g. "Jumping 1.20m", "Ready to event"
  location          TEXT,                                -- where the buyer would buy from, e.g. "Ireland or UK"
  buyer_name        TEXT NOT NULL,
  buyer_email       TEXT NOT NULL,
  buyer_phone       TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'found', 'removed', 'rejected')),
  reject_reason     TEXT,
  owner_note        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  published_at      TEXT,
  expires_at        TEXT,
  updated_at        TEXT
);
CREATE INDEX idx_wanted_status ON wanted (status, published_at);

-- Which sites show it: its own always, the other one when "Also show on" is ticked (as for ads).
CREATE TABLE wanted_discipline (
  wanted_id        INTEGER NOT NULL REFERENCES wanted (id) ON DELETE CASCADE,
  discipline_code  TEXT NOT NULL REFERENCES discipline (code),
  PRIMARY KEY (wanted_id, discipline_code)
);

-- Sellers' answers, emailed on to the buyer and kept for the owner area.
CREATE TABLE wanted_reply (
  id          INTEGER PRIMARY KEY,
  wanted_id   INTEGER NOT NULL REFERENCES wanted (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT,
  message     TEXT NOT NULL,
  emailed     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_wanted_reply ON wanted_reply (wanted_id);
