# IBSR site database migrations

The showjumping site (IrishBredShowjumpingResults) has its own D1 database, `irishbredshowjumpers`. Its migrations go
here and never run against IBER's database (`migrations/`).

`0001_site_tables.sql` is IBER's table structure with none of IBER's content, so every IBSR page works (empty)
from the start. It is generated: `node scripts/build-ibsr-site-schema.mjs`.

`0002_results_owner.sql` adds what only showjumping results have: the owner on each result (`owner_name`), and what
the file reader wasn't sure of on the line (`parse_issues`, for the Unverified tab).

`0003_result_notes.sql` adds `public_note` (the reader's best guess, shown with the result on the site), the same
column as IBER's `migrations/0022`. If `0001` is ever regenerated from IBER's migrations, drop `0003` at the same time.

Since October 2026 IBSR's results come from Charlie's results files, uploaded in the owner area (Results tab) and
read by `lib/parser-sj.js`, then saved by the same import as IBER (`lib/import.js`) into this database.

The shared horse database (`migrations-shared/`, D1 `irishbredhorses`, binding `SHARED`) stays the store of horses,
stallions, pedigrees and breeders both sites can fill gaps from (owner area → Horses), and keeps the owners' submissions.
