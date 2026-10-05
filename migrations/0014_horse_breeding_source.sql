-- Breeding records edited in the owner area: where the details came from (e.g. a sporthorse-data.com link) and when.
ALTER TABLE horses ADD COLUMN breeding_source TEXT NOT NULL DEFAULT '';
ALTER TABLE horses ADD COLUMN breeding_updated_at TEXT;
