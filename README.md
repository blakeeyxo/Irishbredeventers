# IrishBredEventers

A permanent, searchable home for Charlie Ripman's weekly Irish Bred Eventing Results.

- **Hosting:** Cloudflare Workers with static assets (pages in `public/`, server code routed by `src/worker.js`)
- **Database:** Cloudflare D1 (SQLite, with FTS5 full-text search)
- **Images:** Cloudflare R2 (news photos, ad images)
- **Owner login:** Cloudflare Access with an emailed one-time code
- **Spam:** Cloudflare Turnstile on comments, corrections and sign-up
- **Email:** Resend or Brevo (set with `MAIL_PROVIDER`)

The approved design is `reference/irishbredeventers-mockup-v2.html` and the brief is `reference/build-brief.md`.

---

## What's in the repo

```
public/               The website (served as static files)
  index.html          Home, Results, Search, News, About (one page, real URLs)
  admin/              Owner area (/admin): page, admin.js, admin.css. The Worker serves it only
                      to a logged-in owner; everyone else gets a plain 404
  css/site.css        Styles from the approved mockup
  js/app.js           Public site behaviour
src/worker.js         Worker entry: sends /api/* and /media/* to the handlers in functions/, and hides
                      /admin and /api/admin (404) from anyone without the owner login
functions/            Server code, one file per URL
  api/…               Public API: results, search, news, ads, comments, corrections, sign-up
  api/admin/…         Owner API: read, check and import results, verify, news, ads, comments, corrections, enquiries
  media/[[path]].js   Serves R2 images at /media/…
lib/
  parser.js           Reads Charlie's results text (2026 style, 2010 archive style) into rows
  names.js            Name matching: normalising, near-matches, (ISH)/[TIH]/[was …] tags, counties
  import-plan.js      Works out what an import will add and which names need a same/different answer
  import.js           Saves an import into the breeding tables and the results pages (safe to repeat)
  docx.js             Gets the text out of a Word .docx (no packages needed)
  hsi.js              Reads Charlie's weekly Horse Sport Ireland articles and merges the weeks into one set of results
  results.js          Queries for the public results pages; removes a whole upload
  access.js           Checks the Cloudflare Access login on owner pages and API calls
  mail.js             Sends email through Resend or Brevo
migrations/           D1 database tables
seed/
  sample-results-2-weeks.txt   Two fictional weeks in Charlie's format, covering every variation
  example-ads/                 Example ad images (invented businesses, marked "Example ad")
  starter-content.json         Link cards (and articles, once supplied) for the local site
scripts/
  parse-file.mjs      Test the parser on one of Charlie's files: npm run parse -- file.docx
  import-file.mjs     Import a file into the LOCAL site: npm run import:local -- file.txt
  load-example-ads.mjs  Load the example ads into the LOCAL site: npm run ads:local
  build-content-sql.mjs  Builds seed/starter-content.sql for npm run content:local / content:remote
  scrape-hsi.mjs      Downloads the 2026 Irish-Bred Results articles from horsesportireland.ie into .cache/hsi
  build-hsi-migration.mjs  Turns those articles into migrations/0007_hsi_2026_results.sql and the review lists
  sql-dump.mjs        Shared helpers for the migration builders (rows linked by name, not internal ids)
reports/              Review lists from the Horse Sport Ireland import (open in Excel or Google Sheets)
tests/                npm test
```

---

## Run it on your computer

Needs Node.js 20 or newer.

```bash
npm install
cp .dev.vars.example .dev.vars        # local settings: skips login and spam check on localhost
npm run db:migrate:local              # create the tables (LOCAL database only)
npm run dev                           # http://localhost:8787  (owner area: /admin/)
# in a second terminal, while dev is running:
npm run import:local -- seed/sample-results-2-weeks.txt   # two fictional weeks (asks about near-matches;
                                                          #   add --same sire,dam to answer "same" for those)
npm run ads:local                     # example ads: 2 banners + side boxes booked into slots 2, 5 and 8 (--all for all 8)
npm run content:local                 # articles and link cards from seed/starter-content.json (content:remote loads them on the live site)
npm test                              # parser, matching, Word reader, search and login tests
```

`npm run db:reset:local` wipes the local database and applies every migration again.

---

## Put it live on Cloudflare: checklist

Do these once, in order. Everything is on the free plans to start.

### 1. Worker (already connected to GitHub)
- [ ] Cloudflare dashboard → **Workers & Pages** → the `irishbredeventers` Worker → **Settings → Build**
- [ ] Build command: *(leave empty)*. Deploy command: `npm run deploy`. Branch: `main`
  (`npm run deploy` applies any new database migrations to the live D1 database, then deploys the Worker)
- [ ] The Worker name in the dashboard must match `"name"` in `wrangler.jsonc` (`irishbredeventers`)
- [ ] Push to `main` → it deploys. The first deploy also creates the D1 database and the R2 bucket

### 2. Tables and launch content (automatic)
- [ ] Nothing to run by hand: each deploy applies new files in `migrations/` once. (`0006_results_source.sql`,
  `0007_hsi_2026_results.sql` (the 2026 Horse Sport Ireland results) and `0008_ad_display.sql` / `0009_ad_crop.sql` / `0010_ad_phone_crop.sql`
  (advert crop settings) and `0011_page_ad_slots_stallions.sql` (per-page ad slots, stallion listings,
  comment spam flag), `0012_hsi_2025_nov_dec_results.sql` (November–December 2025 results), `0013_batch_published.sql`
  `0014_horse_breeding_source.sql`, `0015_dotted_names_obos.sql`, `0016_analytics.sql` and `0017_news_no_facebook.sql` and `0018_june1_classes.sql` and `0019_stallion_pedigree.sql` apply
  on deploy.) `0005_launch_content.sql`
  loads Charlie's real results (14–16 February 2025 and the week of 6 April 2026), his four articles and
  the three link cards. It never adds example ads or the fictional sample weeks.
- [ ] Open `https://irishbredeventers.<your-subdomain>.workers.dev` and check results show

`0005_launch_content.sql` is generated by `scripts/build-launch-migration.mjs` from a local database that
holds only real content; it matches rows on names and dates, so running it again never duplicates anything.

### 3. Owner login (Cloudflare Access)
- [ ] Dashboard → **Zero Trust** → pick a team name (this gives you `yourteam.cloudflareaccess.com`)
- [ ] **Settings → Authentication** → add **One-time PIN** (the emailed login code)
- [ ] **Access → Applications → Add → Self-hosted**. Add **one** destination: the sign-in path
  - `irishbredeventers.<your-subdomain>.workers.dev/signin`
  - later, the same path on the .ie domain
  - Do **not** add `/admin` or `/api/admin`: Access would show its login page there and give the owner area
    away. The Worker keeps them as a plain 404 for anyone who hasn't logged in through `/signin`.
- [ ] Policy: **Allow**, include **Emails**: Charlie's and Emer's addresses
- [ ] Copy the application's **Audience (AUD) tag**
- [ ] In the dashboard, Worker → **Settings → Variables and Secrets** (type: Text), add `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `ADMIN_EMAILS` (Charlie's and Emer's, comma separated).
  Don't put them in `wrangler.jsonc`: it has `keep_vars: true`, so deploys keep dashboard values, but anything
  listed in the file would overwrite them.
- [ ] Test in a private window: `/admin/` → plain "Not found". `/signin` → email-code login → lands on `/admin/`

The Worker checks the signed Access login on every owner page and API call, so they stay closed (and look
like pages that don't exist) even if the Access rule is ever wrong. Nothing on the public site links to them,
and they send `X-Robots-Tag: noindex`. Bookmark `/signin`; the login lasts for the Access session length.

### 4. Spam protection (Turnstile)
- [ ] Dashboard → **Turnstile** → **Add widget** → add the workers.dev hostname (and the .ie later) → mode **Managed**
- [ ] Add the **site key** as `TURNSTILE_SITE_KEY` in Worker → **Settings → Variables and Secrets** (type: Text)
- [ ] Add the **secret key**: Worker → **Settings → Variables and Secrets** → add secret `TURNSTILE_SECRET`
- [ ] Without the secret, the public forms refuse posts (they fail closed)

### 5. Email (results notifications)
- [ ] Choose Resend or Brevo (check current pricing; both have free tiers)
- [ ] Verify the sending domain with them (they give you DNS records to add in Cloudflare)
- [ ] Set `MAIL_PROVIDER` and `MAIL_FROM` in `wrangler.jsonc`, push
- [ ] Add secret `MAIL_API_KEY` in the Worker settings
- [ ] Test: sign up on the site → confirm email arrives → publish a small upload with "Email subscribers" ticked

Until `MAIL_API_KEY` is set, sign-ups are stored but no email is sent (the owner area says "email not set up yet").

### 6. Domain
- [ ] Buy the .ie through Smarthost, then point its nameservers at Cloudflare (add the site in Cloudflare first to get them)
- [ ] Worker → **Settings → Domains & Routes** → add the .ie as a custom domain
- [ ] Update `SITE_URL` in `wrangler.jsonc` (it lives in the file, not the dashboard), add the .ie `/signin` path to the Access application and the Turnstile widget
- [ ] Business mailbox for the contact address: Cloudflare **Email Routing** can forward info@iber.ie to an existing inbox for free, or use a paid mailbox
- [x] Contact email info@iber.ie and phone +353 87 216 5442 are on the About page and in the footer

---

## Sister site: IrishBredShowjumpingResults (IBSR)

One codebase, two Workers. Each site's name, wording, colours, favicon and email look live in `sites/<id>.js`:

- `sites/iber.js` holds exactly what `public/` already serves. `npm test` builds IBER from it and checks the result
  matches `public/` byte for byte, so the eventing site can't change by accident.
- `sites/ibsr.js` is showjumping: navy `#16233F` / `#0D1526` / `#2A3957` from the original demo, highlight blue `#3A8DDE`.
- In the HTML, site-specific spots are marked `data-site="key"` (inner HTML) or `data-site-attr="attr=key"`.
  `npm run build:ibsr` copies `public/` into `dist/ibsr` with IBSR's values (`lib/build-site.js`).
- The Worker knows which site it is from `SITE_ID` (`lib/sites.js`; IBER when unset).

IBSR is `env.ibsr` in `wrangler.jsonc`: Worker `irishbredshowjumpers`, its own D1 database `irishbredshowjumpers`
(migrations in `migrations-ibsr/`, never IBER's), and its own R2 bucket `irishbredshowjumpers-media`.

```bash
npm run dev:ibsr                 # build dist/ibsr, then run it locally
npm run db:migrate:local:ibsr    # IBSR's LOCAL database only
npm run deploy:ibsr              # build, apply shared + IBSR migrations to their live databases, deploy the IBSR Worker
```

To put it live: in Cloudflare, add a second Worker named `irishbredshowjumpers` connected to this repo, with deploy
command `npm run deploy:ibsr`, and set its own Access, Turnstile and email settings (step 3 to 5 above, on the IBSR
Worker). The FEI import waits for FEI's terms.

## Shared horse database (both sites)

One D1 database, `irishbredhorses` (binding `SHARED`, tables in `migrations-shared/`), holds the horses, stallions,
pedigrees and breeders that every site reads: IBER, IBSR, and later the black type pages. It follows `schema.sql`
(sections 1 to 4). Both Workers list it by the same name in `wrangler.jsonc`, so they connect to the one database.
IBER's own database and its Stallions page are unchanged.

- **Upload:** owner area → **Shared stallions**. Choose the source, then a CSV (or paste from Excel), press **Check**,
  then **Save**. Template: `/admin/shared-template.csv`. Matching rules are at the top of `lib/shared.js`.
  Every horse, breeder and alias records its source; every value an upload sets is logged in `upload_change`
  with the old value.
- **Sources:** each has licence fields. A source not ticked "Can show" keeps its horses hidden from visitors.
  `fei` starts hidden (terms not confirmed); `iber` is ours.
- **Read:** `GET /api/shared/stallions?q=` and `GET /api/shared/horse/<id>` on either site.

Set up once (in this order):
1. Cloudflare → **Storage & databases → D1** → **Create**, name `irishbredhorses` (`irishbredshowjumpers` for IBSR is already made).
2. Both deploys (`npm run deploy` for IBER, `npm run deploy:ibsr`) create the shared tables and apply any new ones.
   Both run at once after a merge, so the IBSR deploy waits 45 seconds and tries again if IBER's got there first.
3. Locally: `npm run db:migrate:shared:local`.

## For sale (both sites)

Horse ads live in the shared database (`migrations-shared/0003_listings.sql`, `lib/listings.js`) and their photos in
the shared R2 bucket `irishbredhorses-media` (binding `LISTING_MEDIA`, served at `/listing-media/…`). Each ad belongs
to the site it was sent in on (or added on): it shows there and is managed in that site's owner area only. Ticking
**Also show on** (the sister site) shares it there too.

1. A seller presses **I want to sell** (`/for-sale/sell`): details, 1 to 8 photos (made smaller in the browser),
   their contact details. The ad waits in the owner area → **For sale → Waiting for review**.
2. **Approve and request payment** (fee pre-filled from **For sale settings**) emails the seller the fee and the
   payment instructions from the settings.
3. When they've paid: **Mark paid and publish**. The ad is live for the number of days in the settings, and is linked
   to the horse in the shared database when exactly one horse has its name (and year), so its page shows the breeding.
4. **Mark sold** keeps it up with a SOLD badge until it ends; **Remove** takes it down; **Delete** removes it and its photos.

Buyers never see the seller's email or phone: **Ask the seller** emails the seller (reply goes straight to the buyer)
and keeps a copy under the ad in the owner area. The sell and enquiry forms need Turnstile (`TURNSTILE_SITE_KEY`,
`TURNSTILE_SECRET`) and the emails need `MAIL_API_KEY`, on each Worker.

## 2026 results from Horse Sport Ireland

Charlie's 2026 season so far (37 weekly articles, 12 January to 28 September 2026) comes from the
[Irish-Bred Results](https://www.horsesportireland.ie/category/breeding-production/irish-bred-results/) pages.

```bash
node scripts/scrape-hsi.mjs            # reads ?paged=1, 2, 3… 1.5 s apart, keeps the raw HTML in .cache/hsi (not committed)
node scripts/build-hsi-migration.mjs   # writes migrations/0007_hsi_2026_results.sql and reports/hsi-2026-*.csv
```

November–December 2025 came from five named articles (plus the 12 January 2026 article, checked for December
events; it had none), saved by hand into `.cache/hsi2025/articles` with an `index.json`, and built on top of
everything already in `migrations/`:

```bash
node scripts/build-hsi-migration.mjs --cache .cache/hsi2025 --season 2025 --since 2025-11-01 --until 2025-12-31 \
  --near single --out migrations/0012_hsi_2025_nov_dec_results.sql --report hsi-2025-nov-dec
```

`--since`/`--until` keep only events that start inside those dates (the rest are listed as `outside` in the
review file). `--near single` links a name that looks like exactly one existing record (a typo in the article,
"Touchdownm" for Touchdown); each one is listed in the name-checks file with its decision.

How the weeks are merged (`lib/hsi.js`):
- **One event across weeks.** Same country, overlapping dates and the same first word is one event, so Monday
  classes and late verifications published a week later ("Alnwick International … Late Verification from Last
  week") file under the event they belong to.
- **Latest version wins.** A result is one horse in one class of one event. When a later article repeats it, the
  later details are kept and it counts as confirmed.
- **Verified.** Results Charlie publishes are verified. A line that can't be read cleanly is still saved, with its
  raw line and `parse_ok = 0`, and shows as unverified at the end of its class until it is fixed in the
  **Unverified** tab (which shows the line as written and a link to the article). A class marked "not verified"
  in an article stays unverified until a later article confirms it.
- **Nothing is merged on a guess.** Names that only look like an existing record ("Coolcorran" / "Coolcorron")
  are saved as separate records and listed in `reports/hsi-2026-name-checks.csv`.

`reports/hsi-2026-review.csv` lists every line that needs a person: `failed` (saved, unverified), `conflict`
(the same horse twice in one class; the first is kept, unverified), `check` (read, but something was filled in,
such as a country for a heading with no country code, or a date typo) and `skipped` (a horse line with no
placing, such as a team list; not saved).

The import runs on a fresh local database built from migrations 0001–0006, which already holds the live launch
content, so the migration only adds what is new. The week of 6 April 2026 is already live and matches all 127
results, so it adds nothing there.

## Charlie's weekly job

1. Go to `/signin` (bookmark it) and log in with the emailed code. It opens the owner area.
2. **Results** tab → paste the week's results exactly as written, or choose the Word file. Press **Read results**.
3. Check the table. Pink rows could not be read cleanly and are ticked **Unverified**; gold rows have a note (no dam sire, no scores, scores that don't add up). Press **Fix** on any row to correct a field.
4. If a name looks like one already on file ("Sligo Candyboy" vs "Sligo Candy Boy", "Guidam" vs "Luidam"), choose **Same** or **Different**. Confirm stays locked until every one is answered. "Same" answers are remembered, so next week isn't asked again.
5. Press **Confirm and save**. The summary shows how many results, horses, sires, dams and breeders were added. Pasting the same week twice adds nothing.

Fix unverified rows later in the **Unverified** tab. Under **Published uploads**, **Edit** opens an upload to rename it
and correct or delete any of its results, and **Remove** takes the whole upload off the site.

**Ads tab: slots.** Every page (Home, Results, News, Stallions, About) has its own seven slots, sold separately:
**Top** (a banner pinned to the top of the screen) and six side boxes, **Left 1–3** and **Right 1–3** (1 is the top).
They are named "Home – Top", "Home – Left 1" … "About – Right 3". The tab opens with the slot index: a small drawing of
each page showing who is booked in every slot (or "Available"). Click a slot to book or edit it. Prices are agreed
directly with each advertiser and are not stored on the site.
Horse pages and search use the Results page's slots.

On laptops the side boxes stay in view beside the page (three down each side). Below 1200px wide they sit in a block
under the page content. Nothing rotates. An empty slot shows a small "Advertise here" box linking to the About page's
enquiry form. Every advert carries a small "Advertisement" label in its top-left corner.

**Ads tab: the form.** Choose the slot (a mini page drawing shows where it sits), then the image. The recommended image
sizes are measured from the live site's layout at laptop and phone width each time the tab opens; the recommendation
is twice the on-screen box so images stay sharp.
After choosing an image: **Crop to fill the box** opens the crop tool (drag the picture to move it, zoom with the
slider, − / + or the mouse wheel; the box takes the exact shape of the chosen slot, or **Free shape** lets you drag its
corners), or **Show the whole image** keeps the whole picture with a background colour around it. A warning appears
when the picture or cropped part is smaller than recommended (it still saves, but may look soft). The preview shows
the advert in its real boxes before saving. The crop tool has two tabs: **Laptop & tablet crop** and **Phone crop**,
because phones (720px wide and under) show the banner and boxes in a different shape. The cropped pictures are what
the site shows; the untouched upload and both crops are kept, so **Edit** can re-crop later. **Every advert, by slot**
lists each advert with **Edit** and **Remove**.

**Stallions tab.** Six listings, "Stallions – Listing 1" to "6", shown in that order on the Stallions page. Each has a
name, photo, short blurb, stud website and "Sire name in the results". The progeny breakdown (mentions by level, top-three
finishes, wins and every horse) is counted from the results for horses whose sire matches those names.

Every Stallions number covers a rolling 12 months: the current month and the eleven before it, worked out from
today's date (`rollingWindow` in `lib/stallions.js`), labelled on the page, e.g. "Last 12 months (Nov 2025 – Oct
2026)". A **mention** is any placing, not only a win. Below the six listings, **Sires mentioned most** ranks the
top ten sires in the same window; each links to a search for that sire. List
every spelling used in the results, separated by commas. **Clear** shows the listing as available.

**Breeding records tab.** Find a horse (by name or former name, by a stallion's progeny, or only those with part of
their breeding missing) and fill in or correct its sire, dam, dam sire, breeder, year of birth, sex and breed. Every
result of that horse on the site shows the new details straight away (and the stallion numbers follow). Each horse
has a **View on site** link (its public page). All breeding comes from the submitted results and Charlie's records,
and no breeding source is named anywhere on the site or in the owner area. If the corrected details make it the
same horse as another record (same name, year, sire and dam; usually a typo in an article), the two are joined.
Each stallion listing in the Stallions tab links straight to its progeny here.

**Analytics tab (owner only).** Website visits (one per browser session), page views by page, and clicks on adverts
and link cards, for any date range. Only a daily count is kept (table `analytics`): no cookies, IP addresses or
personal details, and bots are ignored. The site reports to `/api/track`.

**Dots in names.** A full stop never makes a different name: "O.B.O.S.", "O. B. O. S" and "OBOS" are one name, as are
"J. W. Rosbotham" and "JW Rosbotham", "P.S. I Love You" and "PS I Love You", "St. Ghyvan" and "St Ghyvan". This applies to
every sire, dam, breeder and horse name when results are uploaded or edited, so a new spelling joins the existing record
instead of making a second one (the name already on file is kept). OBOS is always written OBOS. There is no setting.

**Unverified tab.** Only real problems are listed, each with what's wrong in plain words. No change, no click: nothing
happens to a row you leave alone. Fix a row (editing ticks it) or tick Verified, then press Done; only ticked rows go
live. In the weekly upload's check table, fixing a row and pressing Done ticks it Verified too.

**Stallions that appear under several spellings.** OBOS Quality 004 is always one record: "OBOS Quality", "OBOB Quality
004", "OBOS Qualitu 004", "OBOS 004" and the dotted forms all link to it, as sire and as dam sire alike (rule and list in
`SIRE_FAMILIES`, `lib/names.js`; nothing may be added in front, so Lagans OBOS Quality and Lagos OBOS Quality, a son,
stay separate and no grandparents are mixed up). New uploads link automatically, and existing spellings are joined the
first time the owner area is opened after a deploy and after every upload.

**Results the article gives no event for.** They are held back from the site and shown at the top of the Unverified tab
with a form to name the event (name, country, dates) for all of them at once; then tick Verified and press Done.

**Weekly upload result.** After saving, the owner area shows "X new · Y duplicates skipped · Z failed" and one row per
event with how many results it now has on the site. A duplicate is the same horse in the same class of the same event
(name, start date and country), so a row from another event or date is never skipped. Failed rows are saved but hidden
until fixed in the Unverified tab.

**Published uploads** are listed newest week first, grouped by season and month, with Edit, Unpublish / Re-publish
(takes an upload off the site without deleting it; 0013_batch_published.sql) and Delete.

**Link cards** live in the Ads tab and only fill side ad spaces that have no advert: on every page the empty spaces
take the link cards in order (top row first), labelled "Read more"; any space still empty shows "Advertise here".

**Every-page adverts.** Tick "Keep this ad in this space across all pages" in the advert form and it is saved
against the space itself (placement `all:left1` etc.). A page's own advert for that space comes first.

**Stallions tab: Sires mentioned most.** The top 20 sires of the last 12 months, plus any other sire by name, each
with a Feature button that puts him into a free listing (or, when all six are taken, the listing you choose).

**Breeding records: stallions are edited like horses.** One search finds a horse or a stallion. A stallion has the same
fields as a horse (his own sire, dam, dam sire, breeder, year of birth, breed, [TIH]), plus his name, and "Join into" for
two spellings of the same stallion (e.g. "Imperial Hights" into "Imperial Heights"): his progeny, mares and results all
move across, and horses that turn out to be the same are joined too. When a stallion's own breeding is filled in it is
shown on his public stallion page.

**Comments.** Every comment goes to the approval queue. If the Turnstile spam check did not pass, the comment is
still queued but marked "Spam check did not pass" so it can be read carefully before approving.

### Breeding data

Every saved result also builds the breeding records: `horses` (with former names in `horse_aliases`), `sires`, `dams` (each linked to her own sire, the dam sire), `breeders` and `results`. Names are matched in a normalised form (lowercase, no punctuation, single spaces), so "Flex A Bill" and "Flex-a-Bill" are one sire. A horse is one record per name + year of birth + sire + dam.

## Testing the parser on Charlie's files

Tested on Charlie's real files: the 6 April 2026 file reads 124 of 127 placings cleanly and the 2 August 2010 archive reads 74 of 80. Every flagged row has something genuinely missing (no breeding given, "out of" twice, breeding not found). To check a new file without touching any database:

```bash
npm run parse -- "path/to/6 April 2026.docx"
npm run parse -- "path/to/2010 archive sample.docx" --year 2010
npm run parse -- "path/to/file.docx" --all       # show every row, not just the flagged ones
```

For each flagged row, decide: is the file unusual (fine, it goes to the check table), or is it a pattern the parser should learn? Add a test in `tests/parser.test.js` for each new pattern, fix `lib/parser.js`, and run `npm test`.

**Don't commit Charlie's real files to this repo** unless he agrees. They may hold private details.

---

## Decisions (from the brief, not to reopen)

- Menu: Home, Results, News, Stallions, About. Search box on every page.
- Riders are shown on the results pages when given (under the horse), and are never searchable: the search index
  covers horse, former names, sire, dam, dam sire and breeder only. They are stored in `results` (rider name and country).
- The home page shows the first-placed horses from the latest week, with its own banner and side boxes around them.
- Horse record: Runs recorded, Wins / Placings (1st / top three), Best dressage, Clear cross country. Form lists every
  class the horse ran in, by month, and each event links to its results.
- Results: year tabs, then all twelve month tabs within every year. Months without results are shown lighter and say
  "Archive for this month coming soon" (or, for months still to come, that results appear once the events have run);
  they fill in by themselves as results are imported. Each event shows its dates, country, number of classes,
  Irish-bred placings. No source is named on the public site: all results are Charlie's.
- Stallions page: six paid listings, each with its progeny breakdown. No donation button. No scheduled newsletter.
- Any sire, dam, dam sire or breeder that isn't recorded shows as "UNK", and a horse with any of its breeding
  (sire, dam or dam sire) unknown is marked "OIO" (Of Irish Origin). That is not a problem: the horse is shown.
- Nothing is marked "Unverified" on the public site. Results with a real problem (misread lines, entries that look
  wrong, the same horse twice in a class, marked not verified in the article) are hidden from the site and listed
  in the owner area's Unverified tab until Charlie fixes them and marks them verified. The rules are in
  `lib/results.js` (OIO_SQL, DOUBT_SQL, PUBLIC_SQL).
- Comments only appear after approval.

## Still open (for Emer)

- Horse Sport Ireland's answer on the CapallOir database (blocks the archive upload)
- Domain and mailbox pricing with Smarthost
- Which mailing service
- Charlie's real sample files for parser testing

## Owner area: result cards and event fixes
Every result card shows its country and event name as a heading. Open "Correct the event" on a card to fix the event name, country or dates for all results in that event, or move just that one result to another event, without re-importing. `tests/guards.test.js` fails if a multi-argument function is passed bare to `.map()` (the cause of "[object Object]"), and `esc()` refuses objects and arrays.
