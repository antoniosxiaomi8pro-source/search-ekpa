# EKPA Smart Finder — IT Handover Addendum — 2026-10-01

## Status
New production handoff package. **It supersedes the backend contents of
`ekpa-smart-finder-IT-package-2026-09-30-PRODUCTION.zip`.** Please use this
package (`ekpa-smart-finder-IT-package-2026-10-01-PRODUCTION.zip`) for the
production deployment.

## Why a new package
The `search-ekpa/` backend folder in the 2026-09-30 package contained an
**older backend build** (search engine of 2026-09-15, server of 2026-09-23,
program data before the category enrichment). That build does **not**
implement the paged/sort API contract that the v25 GTM widget requires.

If the v25 widget runs against that older backend, typeahead suggestions still
work, but the `/search` results page shows **zero results** (the widget asks
for `format=paged`, the old backend answers with a plain array, and the native
result area is hidden).

As of 2026-10-01, `https://smartfinder.elearningekpa.gr` answers `format=paged`
with a plain array. That means it is still running a pre-v25 backend.

## What changed vs. the 2026-09-30 package
| Item | 2026-09-30 package | This package (2026-10-01) |
|---|---|---|
| GTM widget `ekpa-search-widget-gtm-v25-PRODUCTION.txt` | v25 | **Identical** (same bytes, same SHA-256) |
| `server/server.js` | no `format=paged`, no `sort` | paged + sort contract |
| `server/search-api-contract.js` | missing | included |
| `public/search-engine.js` | 2026-09-15 engine | category/audience intents + controlled typo recovery |
| `public/concepts.json` | 2026-09-15 | updated 2026-09-30 (intent terms) |
| `public/programs.json` | 239 programs without category | official EKPA category enrichment (5 without category) |
| `public/index.html` | no `?q=` deep link | `?q=` deep link |
| `test/` | 1 test file | 9 test files, 84 tests |

Source: Brandery repository commit `101ab80` ("Add search sorting and trusted
typo recovery"), 2026-09-30.

## Production GTM artifact (unchanged)
- File: `ekpa-search-widget-gtm-v25-PRODUCTION.txt`
- SHA-256: `7b8101faa6ee8a52550f1779a7c370c294c35950462d5ad07329ba6fdea470ce`
- Backend: `https://smartfinder.elearningekpa.gr`
- GTM container: `GTM-TZJNFCW`

If the production tag was already prepared from the 2026-09-30 package, it does
not need to change. Only the backend needs to be redeployed.

## IMPORTANT — order of deployment
1. **Backend first.** Deploy `search-ekpa/` from this package to the server
   behind `https://smartfinder.elearningekpa.gr`.
2. Run the backend verification below. **All checks must pass.**
3. **Only then** enable/publish the production GTM tag.

The rule from the 2026-09-30 addendum still applies: do **not** modify,
rename, repurpose or publish `SmartFinder - TESTING2`.

## Backend deployment notes
- `npm ci` (or `npm install`). No new dependencies since the 2026-09-30 package.
- Optional but recommended: `npm test` → expect `tests 84 / pass 84 / fail 0`.
- `.env`: no new variables. `ALLOWED_ORIGINS` must contain the real production
  origins (e.g. `https://elearningekpa.gr,https://www.elearningekpa.gr`).
- **`DATA_DIR` and `concepts.json`:** when `DATA_DIR` is set, the server
  reads the taxonomy from `DATA_DIR/concepts.json`. It copies
  `public/concepts.json` into it **only if the file does not already exist**.
  On a server that was deployed before, the old taxonomy would therefore stay
  active and the new intent terms would be ignored.
  - If **no** taxonomy edits were made through the admin panel on your server:
    back up `DATA_DIR/concepts.json`, then replace it with
    `public/concepts.json` from this package (or delete it so it is re-seeded
    on start).
  - If taxonomy edits **were** made through the admin panel: do not overwrite.
    Send the current `DATA_DIR/concepts.json` to Brandery so the two can be
    merged.
- Restart the service.

## Backend verification (run before enabling the GTM tag)
```bash
curl -s https://smartfinder.elearningekpa.gr/health
```
Expected: `{"ok":true,"programs":702}`

```bash
curl -s -G https://smartfinder.elearningekpa.gr/api/search --data-urlencode "q=ψυχολογία" -d format=paged -d page=1 -d page_size=40 -d sort=relevance
```
Expected: a JSON **object** with `results` (40 items) and
`pagination` (`"total_results":84`, `"has_next":true`). **A JSON array here
means the old backend is still running. Do not enable the tag.**

```bash
curl -s -G https://smartfinder.elearningekpa.gr/api/search --data-urlencode "q=ψυχολογία" -d format=paged -d page_size=3 -d sort=price_asc
```
Expected: an object with `pagination`, results ordered by price.

```bash
curl -s -G https://smartfinder.elearningekpa.gr/api/search --data-urlencode "q=ψυχολοια" -d format=paged -d page_size=3
```
Expected: first result `Ιατρική Ψυχολογία` (typo recovery).

```bash
curl -s -D - -o /dev/null -H "Origin: https://elearningekpa.gr" "https://smartfinder.elearningekpa.gr/api/search?q=hr&limit=6&fields=compact"
```
Expected: `Access-Control-Allow-Origin: https://elearningekpa.gr` and a
`Server-Timing` header.

## Validation of this package (Brandery, 2026-10-01)
Run on this package's own `search-ekpa/` folder, started locally:
- `npm test`: 84/84 pass.
- `/health`: 702 programs.
- Typeahead contract (`limit=6&fields=compact`): array of 6 compact items.
- Paged relevance: 40 results, `total_results` 84, 3 pages, page 3 = 4 results, `has_next=false`.
- Paged `price_asc`: 40 results, same totals.
- Typo recovery `ψυχολογιαα`, `ψυχολοια`, `πσυχολογια` → `Ιατρική Ψυχολογία` first.
- `naftilia` → `Γεωπολιτική, Ναυτική Ισχύς και Ναυτιλιακή Ασφάλεια` first; `ψυχολόγος` unchanged.
- CORS: allowed origin echoed; unknown origin → 403.
- `/api/programs`: HTTP 200, ~0.83 MB gzipped.
- Same behavior as the Brandery TESTING backend (Railway) that the v25 widget was validated against.

## Smoke test and rollback
Unchanged. See `HANDOVER-NOTES-ADDENDUM-2026-09-30.md`, sections "Minimum
production smoke test" and "Rollback". For the backend, keep the previous
deployment (or its git commit) available so it can be restored.
