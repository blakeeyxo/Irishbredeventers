-- Each checklist horse's own FEI results page (the "Performance.aspx?p=…" link on the FEI horse list), read from a
-- saved FEI list page, so the owner area can open it in one click.
ALTER TABLE fei_checklist ADD COLUMN fei_url TEXT;
