-- Showjumping results pasted from FEI horse pages (owner area → FEI results), for IBSR.
-- * competition_class.class_date: the day the class ran (an FEI show runs over several days).
-- * result.score_text: the score as FEI writes it, e.g. "4(4+0)/72.11" (faults, rounds, time) or "EL".
-- * result.upload_id: the paste it came from (in the upload log, with its source).
ALTER TABLE competition_class ADD COLUMN class_date TEXT;
ALTER TABLE result ADD COLUMN score_text TEXT;
ALTER TABLE result ADD COLUMN upload_id INTEGER REFERENCES upload (id);
CREATE INDEX idx_class_event_name ON competition_class (event_id, name, class_date);
CREATE INDEX idx_event_name ON competition_event (discipline_code, name, country, start_date);
