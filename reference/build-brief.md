# IrishBredEventers: build brief

Hand this file to Claude Code at the start of the project. Put `irishbredeventers-mockup-v2.html` in the repo under `/reference/`. It is the approved design and behaviour, and it is the source of truth for how the site looks and works.

## 1. What we are building

A permanent, searchable home for Charlie Ripman's Irish Bred Eventing Results, a weekly service that has run for about 20 years. It lists Irish-bred horses placed in eventing worldwide, with their breeding and breeder.

- **Client:** Charlie Ripman. He owns all the results data and manages the site himself.
- **Built by:** Emer, SmartScale.
- **Site name:** IrishBredEventers
- **Launch:** November 2026 as a test, to fix problems before full use from New Year. From January 2027 this site is Charlie's only route for posting results.
- **Results stay free for breeders.** There is no donation button. Income is advertising and sponsorship only.
- **Blocker for the archive:** Horse Sport Ireland must confirm free use of the CapallOir database. The archive upload waits for this and for the site to be earning. Charlie gave no deadline for it.

## 2. Decisions already made (do not reopen)

| Topic | Decision |
|---|---|
| Hosting | Cloudflare Pages, with Pages Functions for the server side |
| Database | Cloudflare D1 (SQLite) |
| Images | Cloudflare R2 (news photos, ad images) |
| Domain | Bought through Smarthost, pointed at Cloudflare. Confirm the exact .ie name is available. |
| Menu | Home, Results, News, About. Nothing else in the main menu. |
| Search | One search box on every page: horse (and former names), sire, dam, dam sire, breeder |
| Rider | Not shown anywhere and not searchable. Do not store it. |
| Stallion page | Does not exist. Stallion ads are just ads. |
| Newsletter | No scheduled newsletter. Subscribers get an email with a link when new results are published. |
| Look | Keep the approved mockup's navy, red and gold palette, Fraunces and Inter fonts, and layout |

## 3. Pages and behaviour

Copy the markup, CSS and behaviour from the reference file.

**Every page:** masthead with site name and the four-item menu, a full-width banner ad under it, the search box, and 4 ad slots down each side on screens 1240px wide and over. The footer has contact details and the owner-area link. Below 1240px the side ads are hidden and the ad rows inside the page still show.

**Home**
- Latest commentary headline, taken from the newest news post, with "Read the full commentary".
- 1st place horses from the latest verified results.
- Ad rows filling the page.
- Email sign-up for results notifications.

**Results**
- Default view is "All of 2026" (the current calendar year). Season buttons for earlier years.
- Grouped by country, then event, then class. Each row shows position, horse, former name, breeding, breeder and score. Clicking a horse opens its profile.
- Unverified results always sit at the very end under their own heading.
- After the results, in this order: 8 same-size ad spaces, comments (held for approval), corrections and additions form.

**News:** posts newest first, each opening in a full-article overlay, with a comments box.

**About:** the story, contact details, an "Advertise" block explaining the two ad tiers (no prices shown), and the email sign-up.

**Search results:** matches show the horse, breeding and event. Results from unverified events are marked.

## 4. Owner area (Charlie only)

Route `/admin`, protected by Cloudflare Access with an emailed login code for Charlie and Emer. The reference file shows the layout, and every action must also work on a phone.

**Results upload** (the main weekly job)
1. Charlie chooses his Word file (.docx) or pastes text.
2. The server reads it (see section 6) and shows a check table. Rows it could not read cleanly are highlighted and ticked "Unverified" by default. Charlie can tick or untick any row.
3. "Publish" saves the results and, if ticked, emails subscribers a link to the new results.
4. Each upload is a batch and can be removed whole.
5. Add a "Mark as verified" action so unverified rows can be confirmed later and move up into their class. The demo does not have this yet.

**News:** headline, write-up, optional photo. The newest post becomes the home headline.

**Ads:** two tiers with different pricing.
- *Large business* (feed and tack brands): takes the top banner.
- *Small breeder or business:* rotates through the side and end-of-results slots.
- Each ad has a name, link, image and optional end date. Ads past their end date drop off automatically. Placeholders show when no ad is live.

**Comments:** a queue of pending comments with approve and delete.

**Corrections and additions:** a queue of submitted corrections with a "done" action.

## 5. Data model (D1)

```
batches(id, created_at, label, row_count, unverified_count)
events(id, name, date_text, start_date, country, season)
classes(id, event_id, name)
placings(id, class_id, batch_id, position, horse_name, former_name,
         breed, foaled, sex, sire, dam, dam_sire, breeder,
         dressage, show_jumping, cross_country, score, verified)
placings_fts   -- FTS5 over horse_name, former_name, sire, dam, dam_sire, breeder
news(id, title, body, snippet, image_key, published_at)
ads(id, tier, name, link, image_key, ends_on, created_at)
comments(id, scope, name, body, status, created_at)   -- status: pending|approved
corrections(id, event_text, message, email, status, created_at)
subscribers(id, email, confirmed, token, created_at)
```

- Season comes from the event's date. Sorting and season buttons use `start_date`.
- Search uses the FTS5 table and must return quickly with about 6,000 horses loaded.
- The archive (about 5,800 horses back to 2006) loads into the same tables later, using the same reader.

## 6. Reading Charlie's Word file

- His file is Word prose with one sentence per placing, not columns. Extract plain text on the server (mammoth works) and parse it.
- The reference file's `parseResults` and `parseEntry` functions are a working first version for this shape:

  `4th Master Smart (was Ballinaclough Satisfied) ISH 2013 gelding by Satisfation 1 (HANN) out of Kilpatrick Pip (ISH)[TIH] by Master Imp (TB). Breeder: Edmond Crotty. [rider] 38.7, 4, 8.8 = 51.5`

- Country lines, event lines with dates and class headings sit above the placings. The parser must ignore the rider text.
- **First task once the project is running:** test the parser against Charlie's real sample files, including the 6 April 2026 file and the 2010 archive sample, and fix it until nearly every entry reads cleanly. Anything unclear must go to the check table, never be guessed.
- Keep his workflow: he writes in Word and uploads. Do not ask him to use Excel.

## 7. Email, spam and privacy

- **Subscribers:** double opt-in, and an unsubscribe link in every email. Store only the email address. Send through a mailing service's API (MailerLite, Brevo or Resend). Emer to choose and confirm current pricing.
- **Spam:** Cloudflare Turnstile on the comment, correction and sign-up forms. Comments never appear until approved.
- **Business email:** a real mailbox for the contact address, on the new domain.
- **Footer:** add a short privacy notice covering the email list and comments.

## 8. Build order

1. Repo, Cloudflare Pages project and D1 database, with a "hello" page live at the Pages address.
2. Public pages ported from the reference file, reading from D1, with sample data.
3. Search (FTS5).
4. Owner area behind Cloudflare Access, then the results upload with the real parser.
5. News, ads, comments and corrections.
6. Subscriber sign-up and the publish email.
7. Domain, business email and DNS.
8. Test with Charlie using real files, then fix.
9. Launch in November.

## 9. Done when

- Charlie can upload a week's Word file, check it and publish it in a few minutes, on his own.
- Searching a horse, sire, dam, dam sire or breeder finds it.
- Unverified results are always last and clearly marked.
- No rider names or donation buttons appear anywhere.
- Comments only appear after approval.
- The site works on phones, with no page scrolling sideways.

## 10. Open items for Emer

- Confirm Horse Sport Ireland's answer on the CapallOir database.
- Confirm current domain and email pricing with Smarthost.
- Choose the mailing service.
- Agree ad prices for the two tiers (not shown on the public site).
- Get Charlie's real sample files to test the parser.
- Check the supplied sample has none of Charlie's private details before sharing it more widely.

## 11. Reference

- Approved design with Charlie's changes and the demo owner area: `reference/irishbredeventers-mockup-v2.html`
- The demo stores data in the browser only. The real site must use D1 and R2.
