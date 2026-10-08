# IBSR database migrations

The showjumping site (IrishBredShowjumpingResults) has its own D1 database, `irishbredshowjumping`, and its own
migrations here. They never run against IBER's database (`migrations/`).

`0001_init.sql` will be written from `schema.sql` (shared horse, result and source tables, discipline =
showjumping, faults and time instead of eventing's three scores) once that file is in the repo, and reviewed
before it is applied.

Apply locally: `npm run db:migrate:local:ibsr`. `npm run deploy:ibsr` applies them to the live IBSR database.
