-- Results and breeding sent in by owners, breeders and riders through the sites' "Send in a result" form. Nothing goes
-- on the site until the owner of the site approves it in the owner area; approved data records this source.
INSERT INTO source (slug, name, kind, licence_status, can_store, can_display, can_republish_commercially, notes)
VALUES ('owners', 'Sent in by owners and breeders', 'other', 'agreed_in_writing', 1, 1, 0,
  'Results and breeding sent in through the site by the horse''s owner, breeder or rider, who agree to them being shown. Checked and approved in the owner area before going live. Contact details are never shown.');

CREATE TABLE submission (
  id             INTEGER PRIMARY KEY,
  site           TEXT NOT NULL,                     -- 'ibsr', 'iber'
  kind           TEXT NOT NULL CHECK (kind IN ('missing_result', 'result_correction', 'breeding')),
  horse_name     TEXT NOT NULL,
  fei_id         TEXT NOT NULL DEFAULT '',
  foaled_year    INTEGER,
  result_json    TEXT,                              -- { date, show, country, level, class_name, height_cm, placing, faults, time, score, rider, rider_country }
  breeding_json  TEXT,                              -- { sire, dam, dam_sire, breeder }
  message        TEXT NOT NULL DEFAULT '',
  contact_name   TEXT NOT NULL,                     -- never shown on the site
  contact_email  TEXT NOT NULL,
  relation       TEXT NOT NULL DEFAULT '',          -- owner, breeder, rider, other
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by     TEXT,
  decided_at     TEXT,
  decision_note  TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_submission_status ON submission (site, status, created_at);
