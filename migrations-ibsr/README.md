# IBSR site database migrations

The showjumping site (IrishBredShowjumpingResults) has its own D1 database, `irishbredshowjumpers`, for the things
that belong to that site only (news, ads, comments, subscribers). Its migrations go here and never run against
IBER's database (`migrations/`).

`0001_site_tables.sql` is IBER's table structure with none of IBER's content, so every IBSR page works (empty)
from the start. It is generated: `node scripts/build-ibsr-site-schema.mjs`.

Horses, stallions, pedigree, breeders and showjumping results are in the shared horse database instead:
`migrations-shared/` (D1 `irishbredhorses`, binding `SHARED`), which both sites read.
