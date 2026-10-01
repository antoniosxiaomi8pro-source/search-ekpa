# EKPA Smart Finder — IT Handover Addendum — 2026-10-01 (v3)

## Status
New production handoff package:
`ekpa-smart-finder-IT-package-2026-10-01-v3-PRODUCTION.zip`

**It supersedes every earlier package, including
`ekpa-smart-finder-IT-package-2026-10-01-PRODUCTION.zip` (v1) and
`ekpa-smart-finder-IT-package-2026-10-01-v2-PRODUCTION.zip` (v2).** If v1 or v2
reached you, do not install them. Install this v3 only. If one of them is
already installed, upgrade to v3 (same steps, nothing to undo).

The backend is identical to v2. What changed is the GTM widget and one new,
optional file for the website `<head>`.

## What changed vs. v2
| Item | v2 | v3 (this package) |
|---|---|---|
| GTM widget | `v26-PRODUCTION` | **`v30-PRODUCTION`** |
| Website's own results flash before ours appear | yes | hidden as soon as the tag runs; **fully avoidable** with the optional `<head>` snippet (below) |
| Empty gap above the results | ~250px of white space | removed |
| Result card | small picture (250px, max 175px high) | picture ≈38% of the row, 16:9 like the website's own pictures; description limited to 5 lines; categories / related programs in 14px |
| Backend (`search-ekpa/`) | commit `04d3b34` | same code, same catalog, same tests |
| New file | — | `SITE-HEAD-HOLD-2026-10-01.html` (optional) |

Widget history v26 → v30 is in the header comment of the widget file. Search
requests, ranking, analytics events and click tracking are **unchanged**.

## Production GTM artifact
- File: `ekpa-search-widget-gtm-v30-PRODUCTION.txt`
- SHA-256: see `RELEASE-MANIFEST-2026-10-01-v3.txt`
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
Unchanged from the 2026-10-01 (v2) addendum, repeated here so that this one
document is enough:
- `npm ci` (or `npm install`). No new dependencies.
- Optional but recommended: `npm test` → expect `tests 137 / pass 137 / fail 0`.
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

## Validation of this package (Brandery, 2026-10-01)
Run automatically by the package build script on this package's own
`search-ekpa/` folder, started for real:
- `npm test`: 137/137 pass.
- `/health` as above; `/api/programs`: 693 programs, all with `category_links`, none hidden.
- Typeahead contract, paged relevance and `price_asc`, typo recovery, CORS (allowed origin echoed, unknown origin → 403).
- Admin catalog endpoint answers with the token and refuses without it; the admin page contains the Κατάλογος tab.
- Widget: production backend inside, ES5 only; the `<head>` block is
  self-contained, has the 3-second safety net, and the widget removes its class.
- The 60 category URLs served by the backend were opened one by one on
  `elearningekpa.gr`: all return HTTP 200.

## Known, planned later (not in this package)
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
