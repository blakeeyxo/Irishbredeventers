-- A stallion can be edited like any horse in Breeding records: his own sire, dam, dam sire, breeder and year of birth.
ALTER TABLE sires ADD COLUMN birth_year INTEGER;
ALTER TABLE sires ADD COLUMN ped_sire TEXT NOT NULL DEFAULT '';
ALTER TABLE sires ADD COLUMN ped_dam TEXT NOT NULL DEFAULT '';
ALTER TABLE sires ADD COLUMN ped_dam_sire TEXT NOT NULL DEFAULT '';
ALTER TABLE sires ADD COLUMN ped_breeder TEXT NOT NULL DEFAULT '';
