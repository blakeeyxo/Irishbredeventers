# IBSR database migrations

The showjumping site (IrishBredShowjumpingResults) has its own D1 database, `irishbredshowjumping`, and its own
migrations here. They never run against IBER's database (`migrations/`).

`0001_init.sql` is sections 1 to 4 of `schema.sql` (v0.1 draft): sources, people, horses, events, classes and
results, with faults and time in place of eventing's score. Its header lists every change from `schema.sql`.
NOT APPLIED anywhere yet: waiting for Emer's review.

Apply locally: `npm run db:migrate:local:ibsr`. `npm run deploy:ibsr` applies them to the live IBSR database.
