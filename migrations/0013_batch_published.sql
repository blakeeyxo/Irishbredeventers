-- An upload can be taken off the public site without deleting it ("Unpublish"), and put back ("Re-publish").
ALTER TABLE batches ADD COLUMN published INTEGER NOT NULL DEFAULT 1;
