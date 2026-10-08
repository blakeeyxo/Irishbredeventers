-- FEI agreed (by email, October 2026) that Irish-bred results from the FEI database may be reused on the sites.
-- They have no data feed, so results are still pasted in by hand (owner area → FEI results). Keep FEI's email.
UPDATE source
SET licence_status = 'agreed_in_writing', can_store = 1, can_display = 1,
    notes = 'FEI agreed by email (October 2026) that results for Irish-bred horses may be reused on the sites. No data feed: results are pasted in by hand from the FEI database. Keep the FEI email on file.'
WHERE slug = 'fei';

-- The horses to look up on the FEI database: from pasted FEI horse lists (FEI ID, name, studbook …), Irish-bred or
-- unclear only. A horse is ticked off when its results page is pasted (last_pasted_at), so the owner area can show
-- who is done and who is left, oldest first.
CREATE TABLE fei_checklist (
  fei_id          TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  studbook        TEXT NOT NULL DEFAULT '',
  registration    TEXT NOT NULL DEFAULT '',            -- as FEI shows it, e.g. 'S', 'S C'
  sex             TEXT NOT NULL DEFAULT '',
  foaled          TEXT,                                -- YYYY-MM-DD
  nf              TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'to_check' CHECK (status IN ('to_check', 'unclear', 'not_irish', 'skip')),
  last_pasted_at  TEXT,
  results_found   INTEGER NOT NULL DEFAULT 0,          -- results for the chosen year on the last paste
  added_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_fei_checklist_status ON fei_checklist (status, last_pasted_at);
