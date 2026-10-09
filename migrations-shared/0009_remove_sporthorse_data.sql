-- SporthorseData is NOT a permitted source. Its pages say "All rights reserved, data is protected by database right",
-- and copying its pedigrees into our database would infringe that right under EU law. The automatic reader and the
-- saved-page upload are removed from the code; this switches the reader off, records the source as refused, and
-- removes everything that came from it: field changes are put back, and horses and breeders it added are deleted.
-- (Breeding comes instead from Horse Sport Ireland under licence, owners and breeders, and our own records.)

DELETE FROM auto_reader WHERE slug = 'sporthorse-data';

UPDATE source
SET licence_status = 'refused', can_store = 0, can_display = 0, can_republish_commercially = 0,
    notes = 'Not a permitted source: SporthorseData''s data is protected by database right. Do not copy from it. Everything taken from it was removed in October 2026.'
WHERE slug = 'sporthorse-data';
-- 1. Put back every horse field it changed, to the value before its first change (from the upload log).
UPDATE horse SET sire_id = (SELECT CAST(c.old_value AS INTEGER) FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'sire_id'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)) c WHERE c.row_id = horse.id)
  WHERE id IN (SELECT row_id FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'sire_id'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)));
UPDATE horse SET dam_id = (SELECT CAST(c.old_value AS INTEGER) FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'dam_id'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)) c WHERE c.row_id = horse.id)
  WHERE id IN (SELECT row_id FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'dam_id'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)));
UPDATE horse SET breeder_id = (SELECT CAST(c.old_value AS INTEGER) FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'breeder_id'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)) c WHERE c.row_id = horse.id)
  WHERE id IN (SELECT row_id FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'breeder_id'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)));
UPDATE horse SET ueln = (SELECT c.old_value FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'ueln'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)) c WHERE c.row_id = horse.id)
  WHERE id IN (SELECT row_id FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'ueln'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)));
UPDATE horse SET colour = (SELECT c.old_value FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'colour'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)) c WHERE c.row_id = horse.id)
  WHERE id IN (SELECT row_id FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'colour'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)));
UPDATE horse SET studbook = (SELECT c.old_value FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'studbook'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)) c WHERE c.row_id = horse.id)
  WHERE id IN (SELECT row_id FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'studbook'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)));
UPDATE horse SET foaled_year = (SELECT CAST(c.old_value AS INTEGER) FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'foaled_year'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)) c WHERE c.row_id = horse.id)
  WHERE id IN (SELECT row_id FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'foaled_year'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)));
UPDATE horse SET sex = (SELECT COALESCE(c.old_value, 'unknown') FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'sex'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)) c WHERE c.row_id = horse.id)
  WHERE id IN (SELECT row_id FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'sex'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)));
UPDATE horse SET fei_id = (SELECT c.old_value FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'fei_id'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)) c WHERE c.row_id = horse.id)
  WHERE id IN (SELECT row_id FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'fei_id'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)));
UPDATE horse SET irish_bred = (SELECT COALESCE(CAST(c.old_value AS INTEGER), 0) FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'irish_bred'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)) c WHERE c.row_id = horse.id)
  WHERE id IN (SELECT row_id FROM (SELECT uc.row_id, uc.old_value FROM upload_change uc JOIN upload u ON u.id = uc.upload_id
    WHERE u.source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data') AND uc.table_name = 'horse' AND uc.field = 'irish_bred'
      AND uc.id = (SELECT MIN(c2.id) FROM upload_change c2 JOIN upload u2 ON u2.id = c2.upload_id
                   WHERE u2.source_id = u.source_id AND c2.table_name = 'horse' AND c2.row_id = uc.row_id AND c2.field = uc.field)));

-- 2. Delete the horses and breeders it added, unlinking them first. (Any with results or an ad would be kept; none are
--    expected, as results come from FEI.)
UPDATE horse SET sire_id = NULL WHERE sire_id IN (SELECT id FROM horse WHERE source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data')
    AND id NOT IN (SELECT horse_id FROM result) AND id NOT IN (SELECT horse_id FROM listing WHERE horse_id IS NOT NULL));
UPDATE horse SET dam_id = NULL WHERE dam_id IN (SELECT id FROM horse WHERE source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data')
    AND id NOT IN (SELECT horse_id FROM result) AND id NOT IN (SELECT horse_id FROM listing WHERE horse_id IS NOT NULL));
DELETE FROM horse_match_candidate WHERE horse_a_id IN (SELECT id FROM horse WHERE source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data')
    AND id NOT IN (SELECT horse_id FROM result) AND id NOT IN (SELECT horse_id FROM listing WHERE horse_id IS NOT NULL)) OR horse_b_id IN (SELECT id FROM horse WHERE source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data')
    AND id NOT IN (SELECT horse_id FROM result) AND id NOT IN (SELECT horse_id FROM listing WHERE horse_id IS NOT NULL));
DELETE FROM horse_alias WHERE source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data');
DELETE FROM horse WHERE id IN (SELECT id FROM horse WHERE source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data')
    AND id NOT IN (SELECT horse_id FROM result) AND id NOT IN (SELECT horse_id FROM listing WHERE horse_id IS NOT NULL));
UPDATE horse SET breeder_id = NULL WHERE breeder_id IN (SELECT id FROM party WHERE source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data')
    AND id NOT IN (SELECT seller_id FROM listing) AND id NOT IN (SELECT rider_id FROM result WHERE rider_id IS NOT NULL)
    AND id NOT IN (SELECT owner_id FROM result WHERE owner_id IS NOT NULL));
DELETE FROM party WHERE id IN (SELECT id FROM party WHERE source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data')
    AND id NOT IN (SELECT seller_id FROM listing) AND id NOT IN (SELECT rider_id FROM result WHERE rider_id IS NOT NULL)
    AND id NOT IN (SELECT owner_id FROM result WHERE owner_id IS NOT NULL));

-- 3. Its lookups and log.
DELETE FROM breeding_lookup;
DELETE FROM auto_read WHERE slug = 'sporthorse-data';
