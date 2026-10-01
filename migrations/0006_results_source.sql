-- Where each result came from, so imported results can be traced and checked.
--
-- events.article_url / article_date: the latest Horse Sport Ireland article that reported the event.
-- results.raw_line: the result line exactly as written. parse_ok = 0 when the line could not be read
-- cleanly; it is still saved (and shown as unverified) so nothing goes missing.
-- Riders stay in results.rider_name / rider_country only. They are shown on the results pages but are
-- never part of the search index (placings_fts), which covers horse, former names, sire, dam, dam sire
-- and breeder.
ALTER TABLE events ADD COLUMN article_url TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN article_date TEXT NOT NULL DEFAULT '';
ALTER TABLE results ADD COLUMN article_url TEXT NOT NULL DEFAULT '';
ALTER TABLE results ADD COLUMN article_date TEXT NOT NULL DEFAULT '';
ALTER TABLE results ADD COLUMN raw_line TEXT NOT NULL DEFAULT '';
ALTER TABLE results ADD COLUMN parse_ok INTEGER NOT NULL DEFAULT 1;
CREATE INDEX idx_results_parse_ok ON results(parse_ok);
