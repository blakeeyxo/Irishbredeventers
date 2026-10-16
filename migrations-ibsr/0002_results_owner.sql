-- IBSR only (database irishbredshowjumpers). Never runs against IBER's database.
-- Showjumping results files list each horse's owner, often a different person from the breeder and the rider.
-- The owner is kept on the result, like the rider: shown on the results pages, not searchable.
ALTER TABLE results ADD COLUMN owner_name TEXT NOT NULL DEFAULT '';
-- What the file reader wasn't sure of on that line ("1st 2nd" given, a year that isn't a year), in plain words,
-- so the Unverified tab says exactly what to check. Empty when the line read cleanly.
ALTER TABLE results ADD COLUMN parse_issues TEXT NOT NULL DEFAULT '';
