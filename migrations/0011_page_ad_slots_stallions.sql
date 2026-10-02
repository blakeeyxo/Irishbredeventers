-- Page-by-page advert slots, stallion listings, owner-area prices, and comments that failed the spam check.
--
-- Every page (home, results, news, stallions, about) has its own advert slots: a pinned top banner and six
-- side boxes (left1-3, right1-3), sold separately. placement is "<page>:<position>", e.g. "results:left2".
-- Adverts from before this change move to the home page: banners to the top banner, side boxes by their old
-- slot number (1-3 left, 4-6 right). Anything else stays unplaced until it is given a slot in the owner area.
ALTER TABLE ads ADD COLUMN placement TEXT;
UPDATE ads SET placement = 'home:top' WHERE tier = 'large';
UPDATE ads SET placement = 'home:left' || slot WHERE tier = 'small' AND slot BETWEEN 1 AND 3;
UPDATE ads SET placement = 'home:right' || (slot - 3) WHERE tier = 'small' AND slot BETWEEN 4 AND 6;
CREATE INDEX idx_ads_placement ON ads(placement);

-- Owner-area settings, e.g. advert prices per slot type (never shown on the public site).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('ad_price_top', '3000'), ('ad_price_side', '600');

-- The six paid stallion listings on the Stallions page. sire_names: the sire's name as written in the
-- results (several spellings separated by commas), used to pull the progeny breakdown.
CREATE TABLE stallions (
  slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 6),
  name TEXT NOT NULL DEFAULT '',
  sire_names TEXT NOT NULL DEFAULT '',
  blurb TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  image_key TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Comments are held for approval anyway, so one whose spam check failed still reaches the queue, marked.
ALTER TABLE comments ADD COLUMN spam_check TEXT NOT NULL DEFAULT 'passed';
