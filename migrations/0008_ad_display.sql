-- How an advert image sits in its box (banner, side box, and the same boxes on the home page).
-- fit: 'cover' crops the image to fill the box; 'contain' shows the whole image inside the box.
-- focus: which part of the image stays in view when it is cropped (center, top, bottom, left, right).
ALTER TABLE ads ADD COLUMN fit TEXT NOT NULL DEFAULT 'cover';
ALTER TABLE ads ADD COLUMN focus TEXT NOT NULL DEFAULT 'center';
