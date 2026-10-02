# EKPA Smart Finder — IT Handover Addendum — 2026-10-02

## Status
New production handoff package:
`ekpa-smart-finder-IT-package-2026-10-02-PRODUCTION.zip`

**It supersedes every earlier package**, including the three of 2026-10-01
(`…2026-10-01-PRODUCTION.zip`, `…-v2-…`, `…-v3-…`). If any of them reached you,
do not install it. Install this one only. If one of them is already installed,
upgrade to this one (same steps, nothing to undo).

## What changed vs. 2026-10-01-v3
| Item | 2026-10-01-v3 | This package (2026-10-02) |
|---|---|---|
| GTM widget | `v30-PRODUCTION` | **identical** (same bytes, same SHA-256) |
| Optional website `<head>` block | `SITE-HEAD-HOLD-2026-10-01.html` | **identical** |
| Search lexicon | words (stopwords, category words, audience, topics) written inside the search engine's source code | **a data file**, `lexicon.json`, that EKPA staff edit in the admin page. See below |
| Admin | taxonomy editor + «📚 Κατάλογος» tab | + **«📖 Λεξικό» tab** and a **«⬇ Εξαγωγή δεδομένων»** button (one file with lexicon, taxonomy and full catalog) |
| New file | — | `ADMIN-LEXICON-GUIDE.md` (guide for EKPA staff) |
| `test/` | 137 tests | **174 tests** |

**What visitors get is unchanged.** The shipped lexicon reproduces the previous
behavior exactly: the ranking of every checked query, category name and taxonomy
term (more than 200 queries, complete rankings, not only the top 10) is identical
to the previous package. Visitors only see a difference when EKPA staff change
the lexicon.

## The lexicon (new)
- Edited in the admin page: `https://smartfinder.elearningekpa.gr/admin-taxonomy.html`
  → unlock with the admin token → tab **📖 Λεξικό**. Same access as the taxonomy
  editor. A guide for EKPA staff is `ADMIN-LEXICON-GUIDE.md`.
- Before every save the page shows **what would change in the search results**
  (computed in a worker thread: it never touches the live lexicon and does not
  slow down visitors). A backup is kept and a one-click rollback exists.
- Files in `DATA_DIR`: `lexicon.json` (live lexicon) and `lexicon-backups/` (last 20).
- **The package never overwrites EKPA's lexicon.** `public/lexicon.json` of the
  package is copied to `DATA_DIR/lexicon.json` **only if it does not exist** (same
  rule as `concepts.json`).
- A broken or invalid `DATA_DIR/lexicon.json` does **not** stop the server: it
  starts with the lexicon built into the engine (identical to the package's), the
  problem is shown in the admin tab, and the file is left untouched so it can be fixed.
- Without `DATA_DIR`, the tab shows the lexicon but saving is disabled.
- New endpoints (all with `x-admin-token`, except the first):
  `GET /lexicon.json` (public, like `/concepts.json`), `GET /api/admin/lexicon`,
  `POST /api/admin/lexicon/preview`, `POST /api/admin/lexicon/save`,
  `POST /api/admin/lexicon/rollback`, `GET /api/admin/export`.
- The search engine file `public/search-engine.js` changed: it now accepts a
  lexicon (and the rule "programs that name an audience in their description" is no
  longer specific to one audience). The change is covered by tests that compare
  complete rankings before and after.

## Production GTM artifact
- File: `ekpa-search-widget-gtm-v30-PRODUCTION.txt`
- SHA-256: `cbdb1d365360f6c84a305f938aa361e2031c7302f1ff65894a117ebf30b9e0a8` (also in `RELEASE-MANIFEST-2026-10-02.txt`)
- Backend inside the file: `https://smartfinder.elearningekpa.gr`
- GTM container: `GTM-TZJNFCW`
- Custom HTML, ES5. Paste the whole file as the tag content.
- Recommended trigger for this tag: **Initialization - All Pages** (the earliest
  GTM can run a tag). The tag must still **not** be published before the backend
  is deployed and verified.

If the production tag already contains v25 or v26, replace its content with this
v30 file **after** the backend is deployed and verified.

## Optional: one block in the website `<head>` (removes the flash completely)
A GTM tag can only run after the page has started to render, so for a split
second the website's own result list is visible before the Smart Finder list
replaces it. Only code placed in the site itself can remove that.

- File: `SITE-HEAD-HOLD-2026-10-01.html` (a `<style>` and a `<script>`, about
  600 bytes, no external resources).
- Where: inside `<head>` of **every page** of `elearningekpa.gr`, **above** the
  Google Tag Manager snippet.
- What it does: only on `/search?q=…`, it hides the website's own result list
  and its "N results for…" heading until the Smart Finder has taken over.
  Nothing else on the site is touched.
- Safety: if GTM or the Smart Finder does not load, the website's own list comes
  back by itself after 3 seconds. A visitor never sees an empty page.
- To remove: delete those two blocks. Nothing depends on them.
- It is optional. The widget works without it (v30 then hides the list as soon
  as the tag runs).

## IMPORTANT — order of deployment
1. **Backend first.** Deploy `search-ekpa/` from this package.
2. Run the backend verification below. **All checks must pass.**
3. **Only then** publish the production GTM tag with the v30 file.
4. Optionally add the `<head>` block.

The rule from the 2026-09-30 addendum still applies: do **not** modify,
rename, repurpose or publish `SmartFinder - TESTING2`.

## Backend deployment notes
Repeated here so that this one document is enough:
- `npm ci` (or `npm install`). No new dependencies.
- Optional but recommended: `npm test` → expect `tests 174 / pass 174 / fail 0`.
- `.env`: **no new required variables.** `ALLOWED_ORIGINS` must contain the
  real production origins (e.g. `https://elearningekpa.gr,https://www.elearningekpa.gr`).
- **`DATA_DIR` is required for the catalog button.** Set it to a persistent
  folder outside the code, writable by the service user (see `.env.example`).
  Without it the site works normally, but «Εφαρμογή» in the Κατάλογος tab is
  disabled (the result would be lost on restart).
- `ADMIN_TOKEN` must be set for the admin page (taxonomy and catalog tabs).
- **Network:** the «Έλεγχος καταλόγου» button makes the **server** read
  `https://elearningekpa.gr` (one page every 2 seconds, about 25 minutes for the
  full check). The server needs outbound HTTPS to that domain.
- **Catalog on first start:** the catalog shipped in the package
  (`public/programs.json`, checked 2026-10-01) is copied to
  `DATA_DIR/programs.json`. When a later package arrives, the server keeps
  whichever catalog has the newer check date and saves the other as a backup
  (`DATA_DIR/catalog-backups/`). Nothing of EKPA's work is overwritten.
- **`DATA_DIR` and `lexicon.json`:** see «The lexicon» above. Nothing to do on your side; do not edit it by hand while the service runs.
- **`DATA_DIR` and `concepts.json`:** when `DATA_DIR` is set, the server reads
  the taxonomy from `DATA_DIR/concepts.json` and copies the packaged
  `public/concepts.json` there **only if the file does not already exist**.
  - If this server never ran a package with the 2026-09-30 intent terms and no
    taxonomy edits were made through the admin panel: back up
    `DATA_DIR/concepts.json`, then replace it with `public/concepts.json` from
    this package (or delete it so it is re-seeded on start).
  - If taxonomy edits **were** made through the admin panel: do not overwrite.
    Send the current `DATA_DIR/concepts.json` to Brandery so the two can be
    merged.
- Restart the service.

## Backend verification (run before publishing the GTM tag)
```bash
curl -s https://smartfinder.elearningekpa.gr/health
```
Expected: `{"ok":true,"programs":702,"active_programs":693}`
(`programs` = whole catalog, `active_programs` = what visitors can find.)

```bash
curl -s -G https://smartfinder.elearningekpa.gr/api/search --data-urlencode "q=ψυχολογία" -d format=paged -d page=1 -d page_size=40 -d sort=relevance
```
Expected: a JSON **object** with `results` (40 items) and `pagination`
(`"total_results":83`, `"total_pages":3`, `"has_next":true`), first result
`Ιατρική Ψυχολογία`. **A JSON array here means an old backend is still
running. Do not publish the tag.**

```bash
curl -s -G https://smartfinder.elearningekpa.gr/api/search --data-urlencode "q=ψυχολογία" -d format=paged -d page_size=3 -d sort=price_asc
```
Expected: an object with `pagination`, results ordered by price (cheapest 235, 256, 256).

```bash
curl -s -G https://smartfinder.elearningekpa.gr/api/search --data-urlencode "q=ψυχολοια" -d format=paged -d page_size=3
```
Expected: first result `Ιατρική Ψυχολογία` (typo recovery).

```bash
curl -s -H "Origin: https://elearningekpa.gr" https://smartfinder.elearningekpa.gr/api/programs | head -c 1200
```
Expected: each program has `category_links`, e.g.
`[{"name":"Τουριστικά","url":"/categories/touristika"}, …]`. The list has
693 programs (the 9 hidden ones are not in it).

```bash
curl -s -D - -o /dev/null -H "Origin: https://elearningekpa.gr" "https://smartfinder.elearningekpa.gr/api/search?q=hr&limit=6&fields=compact"
```
Expected: `Access-Control-Allow-Origin: https://elearningekpa.gr`, `Vary: Origin`
and a `Server-Timing` header.

```bash
curl -s https://smartfinder.elearningekpa.gr/lexicon.json | head -c 300
```
Expected: JSON starting with `{"schema_version": 1, "stopwords": [` (the lexicon the search uses).

Admin check, lexicon (needs the admin token): in the tab **📖 Λεξικό** the status line
reads «αποθηκευμένο στον server» and no red message appears. Do **not** save anything
as part of the verification.

Admin check (needs the admin token):
open `https://smartfinder.elearningekpa.gr/admin-taxonomy.html`, unlock, open
the tab **📚 Κατάλογος**. Expected: «ενεργά 693 · κρυμμένα 9», source «από το
πακέτο». Do **not** press «Έλεγχος καταλόγου» as part of the verification.

## Check after the GTM tag is published
Open `https://elearningekpa.gr/search?q=ναυτιλία` in a normal window (not
cached) and check:
1. The list shows one card per program: large picture on the left (on a phone:
   on top), title, short description, **«Κατευθύνσεις»** and
   **«Σχετικά Προγράμματα»**.
2. No empty white gap above the search box.
3. Each category in «Κατευθύνσεις» opens a real page (no 404).
4. The website's own list is not visible (with the `<head>` block: not even for
   a split second).

## Validation of this package (Brandery, 2026-10-02)
Run automatically by the package build script on this package's own
`search-ekpa/` folder, started for real:
- `npm test`: 174/174 pass.
- `/health` as above; `/api/programs`: 693 programs, all with `category_links`, none hidden.
- Typeahead contract, paged relevance and `price_asc`, typo recovery, CORS (allowed origin echoed, unknown origin → 403).
- Admin catalog endpoint answers with the token and refuses without it; the admin page contains the Κατάλογος and Λεξικό tabs and the export button.
- Lexicon: seeded into `DATA_DIR` on first start, served at `/lexicon.json`, no error reported, and the lexicon preview (worker thread) runs inside the packaged server and reports no change for the unchanged lexicon.
- Widget: production backend inside, ES5 only; the `<head>` block is
  self-contained, has the 3-second safety net, and the widget removes its class.
- The 60 category URLs served by the backend were opened one by one on
  `elearningekpa.gr`: all return HTTP 200.

## Known, planned later (not in this package)
- Data-quality fixes and the alignment below will use the new lexicon page and come in a later package.
- The program's main category is **not yet** aligned with the «Κατεύθυνση» shown
  on the site (147 programs differ). The rule is written and tested but switched
  off. It will ship together with the dictionary (lexicon) work, after a ranking
  review.
- Feed from IT as a catalog source, and the permission model for admin users:
  waiting for IT's answer.

## Smoke test and rollback
See `HANDOVER-NOTES-ADDENDUM-2026-09-30.md`, sections "Minimum production smoke
test" and "Rollback". For the backend, keep the previous deployment (or its git
commit) available so it can be restored. For the widget, keep the previous tag
content so it can be pasted back; the `<head>` block is removed by deleting it.
