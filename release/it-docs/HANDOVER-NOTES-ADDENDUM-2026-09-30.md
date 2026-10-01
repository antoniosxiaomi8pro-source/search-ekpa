# EKPA Smart Finder — IT Handover Addendum — 2026-09-30

## Status
Production handoff package for EKPA IT, based on the v25 candidate validated in TESTING.

## Production GTM artifact
- File: `ekpa-search-widget-gtm-v25-PRODUCTION.txt`
- SHA-256: `7b8101faa6ee8a52550f1779a7c370c294c35950462d5ad07329ba6fdea470ce`
- GTM container: `GTM-TZJNFCW`
- Production Smart Finder backend: `https://smartfinder.elearningekpa.gr`

The production artifact is derived from the validated v25 TESTING artifact. The functional code is unchanged except for the backend endpoint, which has been set to EKPA IT's production Smart Finder backend. Because this changes the file bytes, the production artifact has its own SHA-256 above.

## IMPORTANT — preserve the TESTING tag
Do NOT modify, delete, rename, repurpose or publish the existing GTM tag `SmartFinder - TESTING2` as the production tag.

That tag and its TESTING-only trigger must remain available for Brandery's continuing validation of new Smart Finder versions until development is completed.

For production, EKPA IT should use a separate production tag/version and its normal production-only trigger/change-control process.

## Smart Finder inside the eLearning EKPA search-results page
The current version changes the search-results experience: when a visitor searches and reaches `/search?q=...`, Smart Finder renders its results directly inside the existing eLearning EKPA search page. The visitor remains inside the eLearning EKPA website; the Smart Finder result area replaces/hides the native result area without sending the visitor to a separate Smart Finder user interface.

## v25 user-facing changes
1. Search/typeahead remains compact and limited to 6 suggestions.
2. Prices are no longer displayed in typeahead suggestions.
3. Smart Finder results are rendered inside the EKPA `/search` page.
4. Full results support pagination with 40 results per page and `Εμφάνιση περισσότερων`.
5. Results support two sort modes: `relevance` and `price_asc`.
6. Prices remain available in data for sorting but are not displayed on result cards.
7. Duplicate result cards are suppressed during Load More.
8. Request sequencing/AbortController handling prevents stale search or sort responses from replacing newer results.
9. Existing category, related-program, description, analytics and click-tracking behavior is retained.
10. Controlled typo recovery improves common typing-error handling while preserving existing Greeklish and intent behavior.

## Backend/API contract required by v25
Typeahead:
`GET /api/search?q=<query>&limit=6&fields=compact`

Paged relevance results:
`GET /api/search?q=<query>&format=paged&page=1&page_size=40&sort=relevance`

Paged price sorting:
`GET /api/search?q=<query>&format=paged&page=1&page_size=40&sort=price_asc`

Related-program resolution:
`GET /api/programs`

Before enabling the production GTM tag, confirm that `https://smartfinder.elearningekpa.gr` is running the backend version that supports this paged/sort contract and the current typo-recovery behavior.

## Validation completed in TESTING
- Static contract gate: PASS.
- GTM/ES5 syntax guard: PASS.
- Pagination browser E2E: 84 cards / 84 unique keys / 0 duplicates for the tested Psychology query.
- `price_asc` browser E2E: 84 cards / 84 unique keys / 0 duplicates.
- Rapid sort/race test: PASS.
- Tested typo recovery: PASS for `ψυχολογιαα`, `ψυχολοια`, `πσυχολογια`.
- Regression checks for `ναυτιλια` and `ψυχολόγος`: PASS.
- No visible price in the tested typeahead UI: PASS.
- Browser request spot checks observed 166.9 ms, 209.9 ms and 226.3 ms with no request storm.
- Backend functional/CORS/performance validation: PASS in the validation environment.

## Minimum production smoke test
After deployment verify:
1. Production calls go to `https://smartfinder.elearningekpa.gr` and return HTTP 200.
2. Suggestions appear in the EKPA search inputs and show no prices.
3. Enter/search icon keeps the visitor in eLearning EKPA and renders Smart Finder results inside `/search`.
4. A broad query returns up to 40 cards on page 1 and Load More when applicable.
5. Load More appends without duplicates.
6. `Τιμή: χαμηλότερη προς υψηλότερη` resets to page 1 and continues in the same sort mode through Load More.
7. Switching back to `Σχετικότητα` restores relevance mode.
8. Typo/Greeklish/intention searches remain correct.
9. Production CORS permits the actual eLearning EKPA production origin(s).
10. `SmartFinder - TESTING2` remains unchanged and still fires only in TESTING.

## Rollback
Keep the previous production GTM/container version available before publishing. If a production-only regression appears, roll back the production tag/container version. Do not use or alter `SmartFinder - TESTING2` as the rollback mechanism.
