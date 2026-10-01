-- Advert crop tool. The owner crops the image in the browser and the cropped picture is saved as the
-- advert's image (image_key). The untouched upload (orig_key) and the crop (crop: JSON with x, y, w, h as
-- fractions of the original, and the shape used) are kept so the advert can be re-cropped later.
-- bg: background colour shown around the image when fit = 'contain' (whole image, no cropping).
ALTER TABLE ads ADD COLUMN orig_key TEXT;
ALTER TABLE ads ADD COLUMN crop TEXT NOT NULL DEFAULT '';
ALTER TABLE ads ADD COLUMN bg TEXT NOT NULL DEFAULT '#ffffff';
