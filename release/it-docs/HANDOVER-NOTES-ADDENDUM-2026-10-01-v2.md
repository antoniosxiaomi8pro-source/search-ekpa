# EKPA Smart Finder — IT Handover Addendum — 2026-10-01 (v2)

## Status
New production handoff package:
`ekpa-smart-finder-IT-package-2026-10-01-v2-PRODUCTION.zip`

**It supersedes `ekpa-smart-finder-IT-package-2026-10-01-PRODUCTION.zip` (v1)
completely.** Both packages contain a complete backend and the production GTM
artifact, so:
- If v1 was **not installed yet**: install this v2 package instead. Skip v1.
- If v1 **was installed**: upgrade to v2 (same steps, nothing to undo).

Older packages (2026-09-23, 09-25, 09-30) are superseded as before.

## What changed vs. 2026-10-01 (v1)
| Item | v1 | v2 (this package) |
|---|---|---|
| GTM widget | `v25-PRODUCTION` (`7b8101fa…`) | **`v26-PRODUCTION`** (`76c3acea…`) |
| Widget: categories of a program | one category, link built by the widget (23 of 56 category links returned 404) | **all categories, each a working link** (official URLs served by the backend as `category_links`) |
| Widget: related programs | 3 | **8** |
| Programs not accepting applications | shown | **hidden** from suggestions, results page and related programs (9 of 702 hidden). They are kept in the catalog and reappear when they reopen |
| Prices | base prices, 262 programs without price | **current cycle prices** (JSON-LD of the site), all visible programs have a price |
| Missing data (id, category, description, concepts, related programs) | gaps in ~235 programs | **filled** (only empty fields were filled, existing values untouched) |
| Admin | taxonomy editor | taxonomy editor **+ tab «📚 Κατάλογος»** (catalog check button, apply, one-click rollback) |
| Caching | — | `Vary: Origin` on all responses and `Cache-Control: no-cache` (+ETag) on `/api/programs` and `/programs.json` (a cached response without CORS headers made "related programs" disappear in Chrome) |
| New file | — | `ADMIN-CATALOG-GUIDE.md` (guide for EKPA staff) |
| `test/` | 9 test files, 84 tests | 137 tests |

**The search ranking logic (`public/search-engine.js`) is unchanged.** Ranking
differences vs. v1 come only from the completed program data (checked by
Brandery with a ranking comparison before the data was accepted).

Source: Brandery repository commit stated in `RELEASE-MANIFEST-2026-10-01-v2.txt`.

## Production GTM artifact
- File: `ekpa-search-widget-gtm-v26-PRODUCTION.txt`
- SHA-256: `76c3aceaeaec7ec87965848f682e996722c4c5a8642e523d5078aeeeb53246aa`
- Backend inside the file: `https://smartfinder.elearningekpa.gr`
- GTM container: `GTM-TZJNFCW`
- Custom HTML, ES5. Paste the whole file as the tag content.

If the production tag already contains v25 (from v1 or the 2026-09-30
package): replace its content with this v26 file **after** the backend is
deployed and verified. v26 also works against a backend without
`category_links` (it then shows the category names as plain text), but deploy
the backend first anyway.

## IMPORTANT — order of deployment
1. **Backend first.** Deploy `search-ekpa/` from this package.
2. Run the backend verification below. **All checks must pass.**
3. **Only then** publish the production GTM tag with the v26 file.

The rule from the 2026-09-30 addendum still applies: do **not** modify,
rename, repurpose or publish `SmartFinder - TESTING2`.

## Backend deployment notes
- `npm ci` (or `npm install`). No new dependencies.
- Optional but recommended: `npm test` → expect `tests 137 / pass 137 / fail 0`.
- `.env`: **no new required variables.** `ALLOWED_ORIGINS` must contain the
  real production origins (e.g. `https://elearningekpa.gr,https://www.elearningekpa.gr`).
- **`DATA_DIR` is now required for the catalog button.** Set it to a persistent
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
- **`DATA_DIR` and `concepts.json`:** unchanged from the 2026-10-01 (v1)
  addendum. `public/concepts.json` is identical to v1. When `DATA_DIR` is set,
  the server reads the taxonomy from `DATA_DIR/concepts.json` and copies the
  packaged file there **only if it does not already exist**.
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

## Validation of this package (Brandery, 2026-10-01)
Run automatically by the package build script on this package's own
`search-ekpa/` folder, started for real:
- `npm test`: 137/137 pass.
- `/health` as above; `/api/programs`: 693 programs, all with `category_links`, none hidden.
- Typeahead contract (`limit=6&fields=compact`), paged relevance and `price_asc`, typo recovery, CORS (allowed origin echoed, unknown origin → 403).
- Admin catalog endpoint answers with the token and refuses without it; the admin page contains the Κατάλογος tab.
- Same behavior as the Brandery testing backend (Railway).
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
content so it can be pasted back.
