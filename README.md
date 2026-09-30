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
- [ ] Nothing to run by hand: each deploy applies new files in `migrations/` once. `0005_launch_content.sql`
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
- [ ] In `wrangler.jsonc` set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `ADMIN_EMAILS` (Charlie's and Emer's, comma separated). Push.
- [ ] Test in a private window: `/admin/` → plain "Not found". `/signin` → email-code login → lands on `/admin/`

The Worker checks the signed Access login on every owner page and API call, so they stay closed (and look
like pages that don't exist) even if the Access rule is ever wrong. Nothing on the public site links to them,
and they send `X-Robots-Tag: noindex`. Bookmark `/signin`; the login lasts for the Access session length.

### 4. Spam protection (Turnstile)
- [ ] Dashboard → **Turnstile** → **Add widget** → add the workers.dev hostname (and the .ie later) → mode **Managed**
- [ ] Put the **site key** in `wrangler.jsonc` as `TURNSTILE_SITE_KEY` and push
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
- [ ] Update `SITE_URL` in `wrangler.jsonc`, add the .ie `/signin` path to the Access application and the Turnstile widget
- [ ] Business mailbox for the contact address: Cloudflare **Email Routing** can forward results@… to an existing inbox for free, or use a paid mailbox
- [ ] Update the contact email and phone in `public/index.html` (About page and footer)

---

## Charlie's weekly job

1. Go to `/signin` (bookmark it) and log in with the emailed code. It opens the owner area.
2. **Results** tab → paste the week's results exactly as written, or choose the Word file. Press **Read results**.
3. Check the table. Pink rows could not be read cleanly and are ticked **Unverified**; gold rows have a note (no dam sire, no scores, scores that don't add up). Press **Fix** on any row to correct a field.
4. If a name looks like one already on file ("Sligo Candyboy" vs "Sligo Candy Boy", "Guidam" vs "Luidam"), choose **Same** or **Different**. Confirm stays locked until every one is answered. "Same" answers are remembered, so next week isn't asked again.
5. Press **Confirm and save**. The summary shows how many results, horses, sires, dams and breeders were added. Pasting the same week twice adds nothing.

Fix unverified rows later in the **Unverified** tab. A wrong upload can be removed whole under **Published uploads**.

### The right-hand column

The column runs the full height of every page. Each slot shows, in this order: the side-box ad booked for that slot (Ads tab: "Slot", 1 = top, with optional start and end dates), otherwise a news article card, otherwise an external link card (Link cards tab). It never shows an empty box. Articles and link cards can be added, edited, deleted and moved up or down in the owner area. Banners only show when a banner ad is booked. "Advertise here" appears only in the Advertise section of the About page.

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

- Menu: Home, Results, News, About. Search box on every page.
- Riders are not shown on the public site and not searchable. Since the breeding-data build they are stored in `results` (rider name and country), as requested.
- No stallion page (stallion ads are just ads). No donation button. No scheduled newsletter.
- Unverified results always sit at the very end under their own heading.
- Comments only appear after approval.

## Still open (for Emer)

- Horse Sport Ireland's answer on the CapallOir database (blocks the archive upload)
- Domain and mailbox pricing with Smarthost
- Which mailing service
- Ad prices for the two tiers (not shown on the site)
- Charlie's real sample files for parser testing
- Real phone number and final contact email for the About page and footer
