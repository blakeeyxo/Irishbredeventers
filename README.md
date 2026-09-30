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
  admin/index.html    Owner area (/admin), protected by Cloudflare Access
  css/site.css        Styles from the approved mockup
  js/app.js           Public site behaviour
  js/admin.js         Owner area behaviour
src/worker.js         Worker entry: sends /api/* and /media/* to the handlers in functions/
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
  access.js           Checks the Cloudflare Access login on owner API calls
  mail.js             Sends email through Resend or Brevo
migrations/           D1 database tables
seed/
  sample-results-2-weeks.txt   Two fictional weeks in Charlie's format, covering every variation
  example-ads/                 Example ad images (invented businesses, marked "Example ad")
scripts/
  parse-file.mjs      Test the parser on one of Charlie's files: npm run parse -- file.docx
  import-file.mjs     Import a file into the LOCAL site: npm run import:local -- file.txt
  load-example-ads.mjs  Load the example ads into the LOCAL site: npm run ads:local
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
npm run ads:local                     # example ads
npm test                              # parser, matching, Word reader, search and login tests
```

`npm run db:reset:local` wipes the local database and applies every migration again.

---

## Put it live on Cloudflare: checklist

Do these once, in order. Everything is on the free plans to start.

### 1. Worker (already connected to GitHub)
- [ ] Cloudflare dashboard → **Workers & Pages** → the `irishbredeventers` Worker → **Settings → Build**
- [ ] Build command: *(leave empty)*. Deploy command: `npx wrangler deploy`. Branch: `main`
- [ ] The Worker name in the dashboard must match `"name"` in `wrangler.jsonc` (`irishbredeventers`)
- [ ] Push to `main` → it deploys. The first deploy also creates the D1 database and the R2 bucket

### 2. Create the tables (once, after the first deploy)
- [ ] On your computer: `npx wrangler login`, then `npm run db:migrate:remote`
- [ ] Open `https://irishbredeventers.<your-subdomain>.workers.dev` and check results show

Until the tables exist, the pages load but results and news show an error.

### 3. Owner login (Cloudflare Access)
- [ ] Dashboard → **Zero Trust** → pick a team name (this gives you `yourteam.cloudflareaccess.com`)
- [ ] **Settings → Authentication** → add **One-time PIN** (the emailed login code)
- [ ] **Access → Applications → Add → Self-hosted**. Add these destinations to the **one** application:
  - `irishbredeventers.<your-subdomain>.workers.dev/admin`
  - `irishbredeventers.<your-subdomain>.workers.dev/api/admin`
  - later, the same two paths on the .ie domain
- [ ] Policy: **Allow**, include **Emails**: Charlie's and Emer's addresses
- [ ] Copy the application's **Audience (AUD) tag**
- [ ] In `wrangler.jsonc` set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `ADMIN_EMAILS` (Charlie's and Emer's, comma separated). Push.
- [ ] Test: open `/admin/` in a private window → you should get the email-code login

The owner API checks the Access login itself too, so it stays closed even if the Access rule is ever wrong.

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
- [ ] Update `SITE_URL` in `wrangler.jsonc`, add the .ie paths to the Access application and the Turnstile widget
- [ ] Business mailbox for the contact address: Cloudflare **Email Routing** can forward results@… to an existing inbox for free, or use a paid mailbox
- [ ] Update the contact email and phone in `public/index.html` (About page and footer)

---

## Charlie's weekly job

1. Go to `/admin/` and log in with the emailed code.
2. **Results** tab → paste the week's results exactly as written, or choose the Word file. Press **Read results**.
3. Check the table. Pink rows could not be read cleanly and are ticked **Unverified**; gold rows have a note (no dam sire, no scores, scores that don't add up). Press **Fix** on any row to correct a field.
4. If a name looks like one already on file ("Sligo Candyboy" vs "Sligo Candy Boy", "Guidam" vs "Luidam"), choose **Same** or **Different**. Confirm stays locked until every one is answered. "Same" answers are remembered, so next week isn't asked again.
5. Press **Confirm and save**. The summary shows how many results, horses, sires, dams and breeders were added. Pasting the same week twice adds nothing.

Fix unverified rows later in the **Unverified** tab. A wrong upload can be removed whole under **Published uploads**.

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
