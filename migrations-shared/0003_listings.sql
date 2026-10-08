-- For Sale: horse ads, shown on every site whose discipline the ad is tagged with (schema.sql section 6).
--
-- How an ad moves (status):
--   draft            sent in by a seller with "I want to sell", waiting for the owner to review it
--   pending_payment  approved; the seller has been emailed the fee and how to pay
--   live             paid and on the sites until expires_at
--   sold             marked sold; still shown with a SOLD badge until expires_at
--   expired          past expires_at (a live ad past its date is treated as expired even before it is marked)
--   removed          taken down by the owner
--   rejected         not accepted; the seller is told why
-- Only live and sold ads are ever shown to visitors. Seller contact details are never shown: buyers use the
-- enquiry form, which is emailed on to the seller.

ALTER TABLE party ADD COLUMN phone TEXT;

CREATE TABLE listing (
  id                 INTEGER PRIMARY KEY,
  seller_id          INTEGER NOT NULL REFERENCES party (id),
  horse_id           INTEGER REFERENCES horse (id),        -- the horse in the shared database, once linked
  title              TEXT NOT NULL,
  description        TEXT,
  price_cents        INTEGER,
  currency           TEXT NOT NULL DEFAULT 'EUR',
  price_on_request   INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                       ('draft', 'pending_payment', 'live', 'sold', 'expired', 'removed', 'rejected')),
  listing_fee_cents  INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at         TEXT,
  -- The horse as the seller describes it (kept as written; horse_id links it to the shared record).
  horse_name         TEXT,
  sex                TEXT,                                 -- mare, gelding, stallion, colt, filly
  foaled_year        INTEGER,
  height_hh          REAL,                                 -- e.g. 16.2
  colour             TEXT,
  studbook           TEXT,
  sire               TEXT,
  dam                TEXT,
  dam_sire           TEXT,
  level              TEXT,                                 -- experience, e.g. "Jumping 1.20m", "Ready to event"
  county             TEXT,
  country            TEXT NOT NULL DEFAULT 'Ireland',
  video_url          TEXT,
  seller_type        TEXT NOT NULL DEFAULT 'private' CHECK (seller_type IN ('private', 'breeder', 'dealer')),
  submitted_site     TEXT NOT NULL DEFAULT '',             -- 'iber' or 'ibsr': where the seller sent it in
  reject_reason      TEXT,
  owner_note         TEXT,                                 -- private notes for the owner area
  approved_at        TEXT,
  paid_at            TEXT,
  published_at       TEXT,
  sold_at            TEXT,
  updated_at         TEXT
);
CREATE INDEX idx_listing_status ON listing (status, published_at);
CREATE INDEX idx_listing_horse ON listing (horse_id);

CREATE TABLE listing_discipline (
  listing_id       INTEGER NOT NULL REFERENCES listing (id) ON DELETE CASCADE,
  discipline_code  TEXT NOT NULL REFERENCES discipline (code),
  PRIMARY KEY (listing_id, discipline_code)
);

CREATE TABLE listing_photo (
  id          INTEGER PRIMARY KEY,
  listing_id  INTEGER NOT NULL REFERENCES listing (id) ON DELETE CASCADE,
  image_key   TEXT NOT NULL,                               -- in the shared LISTING_MEDIA bucket
  position    INTEGER NOT NULL DEFAULT 0                   -- 0 is the main photo
);
CREATE INDEX idx_listing_photo ON listing_photo (listing_id, position);

-- Buyer enquiries, emailed on to the seller and kept for the owner area.
CREATE TABLE listing_enquiry (
  id          INTEGER PRIMARY KEY,
  listing_id  INTEGER NOT NULL REFERENCES listing (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT,
  message     TEXT NOT NULL,
  emailed     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_listing_enquiry ON listing_enquiry (listing_id);

-- Owner-area settings for the shared features (For Sale fee, how long ads run, payment instructions).
CREATE TABLE setting (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
INSERT INTO setting (key, value) VALUES ('listing_days', '60'), ('listing_fee_cents', ''), ('payment_instructions', 'Payment is by phone: please call Charlie on +353 87 216 5442 and quote your ad number.');

-- Sellers are people who sent in an ad themselves.
INSERT INTO source (slug, name, kind, licence_status, can_store, can_display, can_republish_commercially, notes)
VALUES ('sellers', 'For Sale: seller submissions', 'other', 'agreed_in_writing', 1, 1, 0,
        'Ads and contact details sent in by sellers through "I want to sell". Contact details are never shown publicly.');
