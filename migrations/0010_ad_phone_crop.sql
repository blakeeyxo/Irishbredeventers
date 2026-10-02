-- A separate crop of each advert for phones. On a phone the banner and side boxes are a different
-- shape from laptops (the banner is about 4.5 : 1 instead of 11 : 1), so the owner crops the picture
-- twice. phone_key is the phone picture (shown at 720px wide and under); phone_crop holds its crop
-- (JSON, fractions of the original). Without one, phones show the laptop picture.
ALTER TABLE ads ADD COLUMN phone_key TEXT;
ALTER TABLE ads ADD COLUMN phone_crop TEXT NOT NULL DEFAULT '';
