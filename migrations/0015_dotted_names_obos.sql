-- Dotted initials are the same name without the dots ("O.B.O.S." = "OBOS", "P.S. I Love You" = "PS I Love You").
-- Records already saved with dotted names get the new matching key, so the next upload finds them. Names are
-- matched exactly; "OR IGNORE" leaves a record alone if the undotted spelling is already on file (join them in
-- the owner area). Any "O.B.O.S" written in the results is stored as OBOS; the site shows the owner's chosen spelling.

UPDATE OR IGNORE dams SET name_normalised = 'ebony as kwpn by sorento' WHERE name = 'Ebony A.S (KWPN).by Sorento';
UPDATE OR IGNORE breeders SET name_normalised = 'ghs' WHERE name = 'G.H.S';
UPDATE OR IGNORE breeders SET name_normalised = 'jw rosbotham' WHERE name = 'J.W. Rosbotham';
UPDATE OR IGNORE breeders SET name_normalised = 'jgne van dooren' WHERE name = 'J.G.N.E. Van Dooren';
UPDATE OR IGNORE breeders SET name_normalised = 'ghs' WHERE name = 'G.H.S.';
UPDATE OR IGNORE horses SET name_normalised = 'ps i love you' WHERE name = 'P.S. I Love You';
UPDATE OR IGNORE horses SET name_normalised = 'ps i love you 2' WHERE name = 'P.S. I Love You 2';

UPDATE OR IGNORE sires SET name = REPLACE(REPLACE(name, 'O.B.O.S.', 'OBOS'), 'O.B.O.S', 'OBOS') WHERE name LIKE '%O.B.O.S%';
UPDATE OR IGNORE dams SET name = REPLACE(REPLACE(name, 'O.B.O.S.', 'OBOS'), 'O.B.O.S', 'OBOS') WHERE name LIKE '%O.B.O.S%';
UPDATE OR IGNORE horses SET name = REPLACE(REPLACE(name, 'O.B.O.S.', 'OBOS'), 'O.B.O.S', 'OBOS') WHERE name LIKE '%O.B.O.S%';
UPDATE placings SET horse_name = REPLACE(REPLACE(horse_name, 'O.B.O.S.', 'OBOS'), 'O.B.O.S', 'OBOS') WHERE horse_name LIKE '%O.B.O.S%';
UPDATE placings SET sire = REPLACE(REPLACE(sire, 'O.B.O.S.', 'OBOS'), 'O.B.O.S', 'OBOS') WHERE sire LIKE '%O.B.O.S%';
UPDATE placings SET dam = REPLACE(REPLACE(dam, 'O.B.O.S.', 'OBOS'), 'O.B.O.S', 'OBOS') WHERE dam LIKE '%O.B.O.S%';
UPDATE placings SET dam_sire = REPLACE(REPLACE(dam_sire, 'O.B.O.S.', 'OBOS'), 'O.B.O.S', 'OBOS') WHERE dam_sire LIKE '%O.B.O.S%';

-- How the site writes it: 'OBOS' (default) or 'O.B.O.S.'
INSERT OR IGNORE INTO settings (key, value) VALUES ('obos_spelling', 'OBOS');
