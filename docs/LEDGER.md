# EKPA Smart Finder — Progress Ledger

Κανόνας: κανένα βήμα δεν γίνεται CLOSED χωρίς αποδεικτικά tests. Αποφάσεις: [B0-architecture-decisions.md](B0-architecture-decisions.md).

```
Validated Search Core (search-engine.js, API contract v25) — 🔒 PROTECTED
Baseline: commit 101ab80 · 84 tests · GTM v25

B0   Αποφάσεις αρχιτεκτονικής               ✅ γραμμένο (προς τελική έγκριση)
—    Κατάλογος: ενεργά + τιμές (quick win)  🟡 IN PROGRESS
R0   Script πακέτου IT                      🟡 υλοποιήθηκε, αναμένει commit
R1   Δεδομένα στο DATA_DIR + export         ⬜
R2   Κουμπί «Έλεγχος καταλόγου» (UI)        ⬜ (ο πυρήνας υπάρχει από το quick win)
R3   Σελίδα λεξικού + «Προτάσεις»           ⬜
R4   Αναφορά GA4                            ⬜
R5   Πηγή feed IT                           ⬜ (αναμονή Γιάννη)
```

---

## 2026-10-01 — Κατάλογος: ενεργά προγράμματα + τιμές

**Στόχος:** κρύβονται τα προγράμματα εκτός «Τρέχοντος Κύκλου», συμπληρώνονται και ενημερώνονται οι τιμές από το JSON-LD του site.

**Αρχεία**
- `server/catalog-sync.js` (νέο): parsers για «Τρέχων Κύκλος» και JSON-LD, `checkCatalog`, `buildCandidate`, δικλείδες ασφαλείας. Είναι ο πυρήνας που θα χρησιμοποιήσει το κουμπί του R2.
- `scripts/catalog-check.js` (νέο): `npm run catalog:check [-- --status-only]`, `npm run catalog:apply -- <φάκελος>`. Τα αποτελέσματα γράφονται στο `data/catalog-check/` (gitignored), με backup πριν από κάθε apply.
- `server/server.js`: `ALL_PROGRAMS` (όλος ο κατάλογος) και `PROGRAMS` (μόνο ενεργά). Τα ανενεργά φιλτράρονται **πριν** τη μηχανή στα search, chat, `/api/programs` και `/programs.json`. Τα click tracking και drift guard χρησιμοποιούν όλο τον κατάλογο. Το `/health` κρατά `programs` = σύνολο και προσθέτει `active_programs`. Προαιρετικό `PROGRAMS_FILE` για τα tests.
- `test/catalog-sync.test.js` (13 tests), `test/inactive-programs-api.test.js` (5 tests, πραγματικός server).

**Δεδομένα programs.json (νέα πεδία):** `status`, `status_source`, `status_checked_at`, `price` (τρέχουσα από JSON-LD), `price_base` (η αρχική βασική, κρατιέται μία φορά), `price_source`, `price_checked_at`, `cycle_start_date`.

**Tests:** 104/104 PASS (84 baseline αμετάβλητα + 20 νέα). Search core: αμετάβλητος κώδικας.

**Έλεγχος κατάστασης (live, 01/10):** 695 ενεργά, 7 κρύβονται (5 «δεν είναι διαθέσιμο» + 2 σελίδες 404). Κανένα νέο. Καμία ελεγμένη αναζήτηση του regression fixture δεν περιέχει τα 7.

**Πλήρης έλεγχος (live, 01/10, 695 σελίδες, 0 αποτυχίες):** κρύβονται 9 (7 εκτός κύκλου + 2 στον κύκλο με λήξη προθεσμίας: Lean Six Sigma Yellow Belt 20/9, Ιδιωτική Ασφάλεια 28/9), ενεργά 693. Τιμές: 260 συμπληρώθηκαν (από 262 χωρίς τιμή, τα 2 είναι κρυμμένα), 435 ενημερώθηκαν (όλες −3,6% έως −6,7%, η έκπτωση του κύκλου), 0 μεγάλες αλλαγές.
**Εφαρμόστηκε** τοπικά στο `public/programs.json` (backup: `data/catalog-check/2026-10-01T09-32-55/programs.before-apply.json`). Tests 104/104 μετά την εφαρμογή.

**Εκκρεμεί:** προσθήκη νέων προγραμμάτων (απόφαση 01/10), δοκιμή στο Railway, commit.

## 2026-10-01 — R0: Script πακέτου IT

**Αρχεία**
- `scripts/build-it-package.js` (νέο): `npm run package:it -- --date YYYY-MM-DD [--ref <commit>] [--out <φάκελος>]`
- `release/gtm/`: παγωμένα widgets `v25-PRODUCTION` (`7b8101fa…`) και `v25-VALIDATED` (`efeb1a6f…`)
- `release/it-docs/`: addenda IT 23/09, 25/09, 30/09, 01/10

**Τι εγγυάται:** κώδικας μόνο από commit (`git archive`), tests του πακέτου, πραγματικό smoke test του API contract του widget (typeahead, paged relevance/price_asc, `/api/programs`, CORS), κανένα `.env`/analytics/data, widget PRODUCTION με backend IT και ES5, υποχρεωτικό addendum της ημερομηνίας, manifest με SHA, **άρνηση αντικατάστασης υπάρχοντος zip**.

**Κριτήρια αποδοχής (B0 §8)**
- ✅ `--ref 101ab80 --date 2026-10-01` → πακέτο ίδιο αρχείο προς αρχείο με το χειροκίνητο πακέτο της 01/10 (διαφέρει μόνο η διατύπωση του manifest).
- ✅ `--ref f1d2fd3` (το backend που μπήκε κατά λάθος στο πακέτο της 30/09) → **απορρίπτεται**: «format=paged… ο backend απάντησε χωρίς {results, pagination}».

**Εκκρεμεί:** commit.
