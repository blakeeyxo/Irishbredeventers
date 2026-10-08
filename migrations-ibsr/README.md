# IBSR site database migrations

The showjumping site (IrishBredShowjumpingResults) has its own D1 database, `irishbredshowjumping`, for the things
that belong to that site only (news, ads, comments, subscribers). Its migrations go here and never run against
IBER's database (`migrations/`). None yet.

Horses, stallions, pedigree, breeders and showjumping results are in the shared horse database instead:
`migrations-shared/` (D1 `irishbredhorses`, binding `SHARED`), which both sites read.
