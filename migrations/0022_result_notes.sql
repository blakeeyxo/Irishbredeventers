-- A note shown with a result on the site when the results reader made a best guess about a detail (a year written
-- "2105" read as 2015, a class taken from the event's name…), as the Terms of Use and AI Statement say. Empty when the
-- line was read as written. Cleared or changed in the owner area once the result is checked.
ALTER TABLE results ADD COLUMN public_note TEXT NOT NULL DEFAULT '';
