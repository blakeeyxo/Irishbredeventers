# IrishBredEventers

A permanent, searchable home for Charlie Ripman's weekly Irish Bred Eventing Results.

- **Hosting:** Cloudflare Pages (static pages) + Pages Functions (server code)
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
functions/            Server code (Pages Functions). Each file is a URL.
  api/…               Public API: results, search, news, ads, comments, corrections, sign-up
  api/admin/…         Owner API: upload, publish, verify, news, ads, comments, corrections
  media/[[path]].js   Serves R2 images at /media/…
lib/
  parser.js           Reads Charlie's results text into placings (never keeps the rider)
  docx.js             Gets the text out of a Word .docx (no packages needed)
  results.js          Saves an upload as a batch, removes a batch
  access.js           Checks the Cloudflare Access login on owner API calls
  mail.js             Sends email through Resend or Brevo
migrations/           D1 database tables
seed/sample.sql       Sample week from the mockup (127 horses, 6 news posts)
scripts/
  parse-file.mjs      Test the parser on one of Charlie's files: npm run parse -- file.docx
  build-seed.mjs      Rebuilds seed/sample.sql from the mockup
tests/                npm test
```

---

## Run it on your computer

Needs Node.js 20 or newer.

```bash
npm install
cp .dev.vars.example .dev.vars        # local settings: skips login and spam check on localhost
npm run db:migrate:local              # create the tables
npm run db:seed:local                 # load the sample week
npm run dev                           # http://localhost:8788  (owner area: /admin/)
npm test                              # parser, Word reader, search and login tests
```

---

## Put it live on Cloudflare: checklist

Do these once, in order. Everything is on the free plans to start.

### 1. Database and image storage
- [ ] `npx wrangler login`
- [ ] `npx wrangler d1 create irishbredeventers` → copy the `database_id` into `wrangler.toml`
- [ ] `npx wrangler r2 bucket create irishbredeventers-media`
- [ ] `npm run db:migrate:remote` (creates the tables)
- [ ] Optional, for the test launch: `npm run db:seed:remote` (loads the sample week; remove it later from the owner area with "Remove this upload", and delete the sample news posts)
- [ ] Commit and push the `wrangler.toml` change

### 2. Pages project
- [ ] Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick this repo
- [ ] Production branch: `main`. Framework preset: **None**. Build command: *(leave empty)*. Build output directory: `public`
- [ ] Deploy. Bindings (D1 `DB`, R2 `MEDIA`) and variables come from `wrangler.toml`
- [ ] Open `https://irishbredeventers.pages.dev` and check the home page loads

### 3. Owner login (Cloudflare Access)
- [ ] Dashboard → **Zero Trust** → pick a team name (this gives you `yourteam.cloudflareaccess.com`)
- [ ] **Settings → Authentication** → add **One-time PIN** (the emailed login code)
- [ ] **Access → Applications → Add → Self-hosted**. Add these destinations to the **one** application:
  - `irishbredeventers.pages.dev/admin`
  - `irishbredeventers.pages.dev/api/admin`
  - `*.irishbredeventers.pages.dev/admin` and `*.irishbredeventers.pages.dev/api/admin` (preview builds)
  - later, the same two paths on the .ie domain
- [ ] Policy: **Allow**, include **Emails**: Charlie's and Emer's addresses
- [ ] Copy the application's **Audience (AUD) tag**
- [ ] In `wrangler.toml` set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `ADMIN_EMAILS` (Charlie's and Emer's, comma separated). Push.
- [ ] Test: open `/admin/` in a private window → you should get the email-code login

The owner API checks the Access login itself too, so it stays closed even if the Access rule is ever wrong.

### 4. Spam protection (Turnstile)
- [ ] Dashboard → **Turnstile** → **Add widget** → add the pages.dev hostname (and the .ie later) → mode **Managed**
- [ ] Put the **site key** in `wrangler.toml` as `TURNSTILE_SITE_KEY` and push
- [ ] Add the **secret key**: Pages project → **Settings → Variables and Secrets** → add secret `TURNSTILE_SECRET`
- [ ] Without the secret, the public forms refuse posts (they fail closed)

### 5. Email (results notifications)
- [ ] Choose Resend or Brevo (check current pricing; both have free tiers)
- [ ] Verify the sending domain with them (they give you DNS records to add in Cloudflare)
- [ ] Set `MAIL_PROVIDER` and `MAIL_FROM` in `wrangler.toml`, push
- [ ] Add secret `MAIL_API_KEY` in the Pages project settings
- [ ] Test: sign up on the site → confirm email arrives → publish a small upload with "Email subscribers" ticked

Until `MAIL_API_KEY` is set, sign-ups are stored but no email is sent (the owner area says "email not set up yet").

### 6. Domain
- [ ] Buy the .ie through Smarthost, then point its nameservers at Cloudflare (add the site in Cloudflare first to get them)
- [ ] Pages project → **Custom domains** → add the .ie
- [ ] Update `SITE_URL` in `wrangler.toml`, add the .ie paths to the Access application and the Turnstile widget
- [ ] Business mailbox for the contact address: Cloudflare **Email Routing** can forward results@… to an existing inbox for free, or use a paid mailbox
- [ ] Update the contact email and phone in `public/index.html` (About page and footer)

---

## Charlie's weekly job

1. Go to `/admin/` and log in with the emailed code.
2. **Results** tab → choose the Word file (or paste the text) → it reads straight away.
3. Check the table. Pink rows could not be read cleanly and are ticked **Unverified**. Tick or untick any row.
4. Leave "Email subscribers" ticked and press **Publish**.

Fix unverified rows later in the **Unverified** tab: correct the details and press **Save and mark as verified**. The horse moves up into its class. A wrong upload can be removed whole under **Published uploads**.

### How the file should look

```
England
Thoresby International and One Day Event, 3rd – 5th April 2026
CCI 4* Short Sec G
4th Master Smart (was Ballinaclough Satisfied) ISH 2013 gelding by Satisfation 1 (HANN) out of Kilpatrick Pip (ISH)[TIH] by Master Imp (TB). Breeder: Edmond Crotty. Tara Dixon (IRL) 38.7, 4, 8.8 = 51.5
```

- A country on its own line, then the event with its dates, then the class, then one sentence per placing starting with the position.
- The rider is read past and never stored.
- Put a full stop after the breeder's name, otherwise the site can't tell where the breeder ends and the rider starts. That row gets flagged, never guessed.
- A line saying just `Unverified` marks every placing after it as unverified.
- Long paragraphs (commentary) are skipped and listed under "lines not used", so nothing disappears silently.

---

## First job once it's running: test with Charlie's real files

The parser reads the mockup's 127 sample horses with 124 clean and 3 correctly flagged. It still needs Charlie's own files:

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
- Riders are not shown, not searchable and not stored.
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
