-- For Sale: each ad belongs to the site it was sent in on (or added on) and always shows there; it shows on the
-- other site only when shared. Ads sent in before this rule keep their site, and stay shared if the other
-- discipline was ticked.
INSERT OR IGNORE INTO listing_discipline (listing_id, discipline_code)
SELECT id, CASE submitted_site WHEN 'ibsr' THEN 'showjumping' ELSE 'eventing' END FROM listing WHERE submitted_site IN ('iber', 'ibsr');
