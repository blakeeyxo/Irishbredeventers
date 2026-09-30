-- News articles gain a manual order and an optional link to the original source.
ALTER TABLE news ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE news ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE news ADD COLUMN source_name TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_news_order ON news(sort_order, published_at DESC);

-- External link cards for the right-hand column (e.g. Charlie's articles on other sites).
CREATE TABLE link_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  teaser TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT '',
  image_key TEXT,
  card_date TEXT NOT NULL DEFAULT '',          -- YYYY-MM-DD, shown on the card
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_link_cards_order ON link_cards(sort_order, card_date DESC);

-- Side-box ads can be booked into a numbered slot in the right-hand column (1 = top),
-- and can start on a date. Ads without a slot fill the highest free slots.
ALTER TABLE ads ADD COLUMN slot INTEGER;
ALTER TABLE ads ADD COLUMN starts_on TEXT;
