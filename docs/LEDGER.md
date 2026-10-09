# EKPA Smart Finder — Progress Ledger

Κανόνας: κανένα βήμα δεν γίνεται CLOSED χωρίς αποδεικτικά tests. Αποφάσεις: [B0-architecture-decisions.md](B0-architecture-decisions.md).
**Η «Τρέχουσα κατάσταση» ενημερώνεται σε κάθε commit, push ή πακέτο IT.**

## Τρέχουσα κατάσταση — 02/10/2026

| | |
|---|---|
| **Railway (Brandery testing)** | backend `dda57d3` (R1 + R3.1, λεξικό στο admin) · έως τώρα: v26 backend (`d45adaf` + ledger) · 693 ενεργά / 9 κρυμμένα · `DATA_DIR=/data` ✅ · κουμπί καταλόγου επαληθεύτηκε (0 αλλαγές) · category links: 693/693 προγράμματα, 60/60 URLs → 200 στο site ✅ |
| **IT production** (`smartfinder.elearningekpa.gr`) | Backend πριν το v25 · το πακέτο 01/10 (v1) **δεν έχει εγκατασταθεί ακόμα** |
| **Τελευταίο πακέτο IT** | **`…2026-10-02-PRODUCTION.zip`** (έτοιμο, **δεν έχει σταλεί**) · commit `c141798` · R1 + R3.1 (λεξικό) + widget v30 + snippet `<head>` + `ADMIN-LEXICON-GUIDE.md` · 174 tests · 693/702. Αντικαθιστά όλα τα προηγούμενα (`2026-10-01`, `-v2`, `-v3`, που δεν άλλαξαν και **δεν στέλνονται**) |
| **GTM widget** | **v26 έτοιμο** (`release/gtm/`): VALIDATED → Railway `cd7622ee…` · PRODUCTION → IT `76c3acea…` · ES5 ✅. **Στο GTM τρέχει ακόμα v25**: το tag `SmartFinder - TESTING2` πρέπει να ενημερωθεί με το v26-VALIDATED |
| **Tests** | 137/137 |

**Σε αναμονή**
- Γιάννης (IT): επιβεβαίωση εγκατάστασης 01/10 · feed · μοντέλο δικαιωμάτων admin
- Αντώνης: push v26 στο Railway → ενημέρωση tag `SmartFinder - TESTING2` με το v26-VALIDATED → δοκιμή · GA4 manual

**Επόμενα**
1. Αντώνης: ενημέρωση tag `SmartFinder - TESTING2` με `v26-VALIDATED` → δοκιμή (όλες οι κατηγορίες ως links, 8 σχετικά).
2. Αποστολή του πακέτου **2026-10-02** στον Γιάννη (email στο chat). Τα 2026-10-01, -v2 και -v3 ΔΕΝ στέλνονται. Πριν: δοκιμή v30 στο TESTING2. Αν η δοκιμή v26 στο Railway βρει πρόβλημα → νέο πακέτο v3, το v2 δεν αλλάζει.
3. R1 → R3 (λεξικό + «Προτάσεις»), **μαζί** με ενεργοποίηση της ευθυγράμμισης κύριας κατηγορίας.

### Πρόοδος

```
Validated Search Core (search-engine.js, API contract v25) — 🔒 PROTECTED
Baseline: commit 101ab80 · 84 tests · GTM v25

B0    Αποφάσεις αρχιτεκτονικής                ✅ γραμμένο (προς τελική έγκριση)
—     Κατάλογος: ενεργά + τιμές (quick win)   ✅ 916ff09
R0    Script πακέτου IT                       ✅ 916ff09 · f7ada54 · 04d3b34
—     Συμπλήρωση κενών + νέα προγράμματα       ✅ a8b91bd
R1/R2 Κατάλογος: DATA_DIR + κουμπί admin      ✅ d1374d8 · ca49c91
R1    Taxonomy/λεξικό στο DATA_DIR + export   ✅ (R1.1 · R1.2 · R1.3) — το λεξικό επεξεργάζεται από τη σελίδα στο R3.1
R3    Σελίδα λεξικού + «Προτάσεις»            🔶 R3.1 σελίδα λεξικού ✅ · R3.3 ποιότητα/ευθυγράμμιση ⬜ · R3.2 Προτάσεις ⬜
R4    Αναφορά GA4                             ⬜
R5    Πηγή feed IT                            ⬜ (αναμονή Γιάννη)
```

### Ιστορικό εκδόσεων

| Ημερομηνία | Commit | Τι | Railway | Πακέτο IT |
|---|---|---|---|---|
| 30/09 | `101ab80` | Ταξινόμηση + typo recovery (G5) | ✅ | 01/10 |
| 01/10 | `916ff09` | Απόκρυψη εκτός κύκλου, τιμές, script πακέτου | ✅ | — |
| 01/10 | `a8b91bd` | Συμπλήρωση κενών, νέα προγράμματα | ✅ | — |
| 01/10 | `d1374d8` · `f7ada54` | Κατάλογος στο πακέτο + κουμπί admin | ✅ | — |
| 01/10 | `ca49c91` | Διορθώσεις καρτέλας Κατάλογος | ✅ | — |
| 01/10 | `d389a28` | Ledger: τρέχουσα κατάσταση | ✅ | — |
| 01/10 | `9931c75` | Ανάγνωση «Κατεύθυνσης» από link · κανόνας ευθυγράμμισης έτοιμος, ανενεργός | ✅ | — |
| 01/10 | `d45adaf` | Widget v26: όλες οι κατηγορίες ως σωστά links, 8 σχετικά · Vary/no-cache για CORS | ✅ | — |
| 01/10 | (v30) | Widget v30: αφαιρέθηκε το κενό πάνω από τα αποτελέσματα (ο τίτλος του site κρυβόταν με visibility, κρατούσε ύψος· τώρα display none). Και στο site-head snippet. **Δεν δοκιμάστηκε ακόμα** | ✅ | — |
| 01/10 | (v29) | Widget v29: μεγαλύτερη εικόνα (≈38%, 16:9, χωρίς όριο ύψους), περιγραφή 5 γραμμές, μικρότερη γραμματοσειρά σε κατηγορίες/σχετικά. v28: συνεργασία με snippet `<head>` (`release/site-head/`). **Μόνο διάταξη. Δεν δοκιμάστηκε ακόμα. Το πακέτο v2 έχει v26** | ✅ | — |
| 01/10 | (v27) | Widget v27: το native αποτέλεσμα του site κρύβεται αμέσως στο `/search?q=`, όχι μετά την απάντηση του backend. Αρχεία `release/gtm/…v27-*`. **Δεν δοκιμάστηκε ακόμα από τον Αντώνη. Το πακέτο v2 έχει ακόμα v26** | ✅ (backend αμετάβλητο) | — |
| 02/10 | `c141798` | Πακέτο 02/10 (R1 + R3.1 + v30) + addendum | ✅ | **02/10** (έτοιμο, όχι σταλμένο) |
| 02/10 | R3.1 | Καρτέλα «📖 Λεξικό»: φόρμες, προεπισκόπηση κατάταξης (worker thread), προειδοποιήσεις, αποθήκευση με έλεγχο έκδοσης, επαναφορά, `ADMIN-LEXICON-GUIDE.md`. 10 νέα tests | — | — |
| 02/10 | R1.3 | Server: `DATA_DIR/lexicon.json` (seed μόνο αν λείπει), `/lexicon.json`, `/api/admin/lexicon`, `/api/admin/export`, κουμπί «Εξαγωγή δεδομένων», index.html, `server/lexicon-store.js` (save/backup/rollback), smoke test πακέτου. 13 νέα tests | — | — |
| 02/10 | R1.2 | Η μηχανή δέχεται λεξικό: `setLexicon/resetLexicon/compileLexicon`, ακύρωση 3 caches, γενικός κανόνας «κοινό → προγράμματα» (`scan_terms`). 8 νέα tests, parity πλήρους κατάταξης σε 200+ ερωτήματα | — | — |
| 02/10 | R1.1 | `public/lexicon.json` (86 καταχωρίσεις σε κανονικά ελληνικά) + `scripts/build-lexicon-seed.js` + 6 tests. Η μηχανή δεν άλλαξε | — | — |
| 01/10 | `b1307d9` | Script πακέτου: widget v30 + snippet `<head>` στο πακέτο, έλεγχοι | ✅ | **01/10-v3** (έτοιμο, όχι σταλμένο) |
| 01/10 | `04d3b34` | Script πακέτου: αναθεώρηση `--rev`, βαθύτερος smoke test, το addendum πρέπει να γράφει τους πραγματικούς αριθμούς | ✅ | **01/10-v2** (έτοιμο, όχι σταλμένο) |

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

**Commit:** `916ff09` · push στο Railway, live έλεγχος: 693 ενεργά, κανένα κρυμμένο σε αναζήτηση ή `/api/programs`, 0 χωρίς τιμή, σωστή αύξουσα ταξινόμηση.

## 2026-10-01 — R0: Script πακέτου IT

**Αρχεία**
- `scripts/build-it-package.js` (νέο): `npm run package:it -- --date YYYY-MM-DD [--ref <commit>] [--out <φάκελος>]`
- `release/gtm/`: παγωμένα widgets `v25-PRODUCTION` (`7b8101fa…`) και `v25-VALIDATED` (`efeb1a6f…`)
- `release/it-docs/`: addenda IT 23/09, 25/09, 30/09, 01/10

**Τι εγγυάται:** κώδικας μόνο από commit (`git archive`), tests του πακέτου, πραγματικό smoke test του API contract του widget (typeahead, paged relevance/price_asc, `/api/programs`, CORS), κανένα `.env`/analytics/data, widget PRODUCTION με backend IT και ES5, υποχρεωτικό addendum της ημερομηνίας, manifest με SHA, **άρνηση αντικατάστασης υπάρχοντος zip**.

**Κριτήρια αποδοχής (B0 §8)**
- ✅ `--ref 101ab80 --date 2026-10-01` → πακέτο ίδιο αρχείο προς αρχείο με το χειροκίνητο πακέτο της 01/10 (διαφέρει μόνο η διατύπωση του manifest).
- ✅ `--ref f1d2fd3` (το backend που μπήκε κατά λάθος στο πακέτο της 30/09) → **απορρίπτεται**: «format=paged… ο backend απάντησε χωρίς {results, pagination}».

**Commit:** `916ff09`.

## 2026-10-01 — Συμπλήρωση κενών + νέα προγράμματα

**Στόχος:** τα ενεργά προγράμματα χωρίς περιγραφή, κατηγορία, έννοιες ή σχετικά προγράμματα να συμπληρώνονται από το site, και τα νέα προγράμματα του κύκλου να προστίθενται ως πλήρεις εγγραφές.

**Αρχεία**
- `server/program-enrich.js` (νέο): `fillFromPage`, `buildNewProgram`, `deriveConcepts`, `deriveTags`, `computeSimilar`. **Συμπληρώνει μόνο κενά πεδία.**
- `server/catalog-sync.js`: ο parser διαβάζει επιπλέον `cms_id` (από `/apply/<id>`), `direction` («Κατεύθυνση»), τίτλο, περιγραφή και εικόνα. Ανοίγουν και οι σελίδες των νέων του κύκλου. Δικλείδες για id που ανήκει ήδη σε άλλο πρόγραμμα και για άγνωστη κατηγορία. Αναφορά διαφορών κατηγορίας (χωρίς αλλαγή).
- `scripts/ranking-diff.js` (νέο): `npm run ranking:diff -- <φάκελος>`, σύγκριση top-10 σε 173 αναζητήσεις (49 fixture + 62 κατηγορίες + 62 έννοιες).
- `test/program-enrich.test.js` (8 tests).

**Κανόνες παραγωγής (μετρημένοι στον υπάρχοντα κατάλογο):** id από `/apply/<id>` (ίδιο με το CMS id όπου υπήρχε). Κύρια κατηγορία = «Κατεύθυνση», μόνο αν είναι γνωστή κατηγορία. Περιγραφή από JSON-LD. Έννοιες από **τίτλο + κύρια κατηγορία** (ακρίβεια 0,95. Με τις δευτερεύουσες κατηγορίες ήταν 0,87 και έδινε λάθη, π.χ. Digital Energy → Cisco). Tags = 6 πρώτοι όροι ανά έννοια. Σχετικά = κοινή κύρια κατηγορία (3) + κοινές έννοιες (2 η καθεμία) + κοινές δευτερεύουσες (1), όριο ≥3, top 10.

**Αποτέλεσμα (live έλεγχος 01/10, 695 σελίδες):** συμπληρώθηκαν κενά σε 235 προγράμματα: id 222, κύρια κατηγορία 152, περιγραφή 111, κατηγορίες 5, έννοιες 55, σχετικά 237. Μένουν κενά μόνο: έννοιες σε 32 (ο τίτλος δεν ταιριάζει με έννοια). Νέα προγράμματα: 0. Συγκρούσεις id: 0. Διαφορές κατηγορίας site/δικής μας: 165 (μόνο αναφορά).

**Αλλαγές κατάταξης (εγκρίθηκαν 01/10):** 93/173 αναζητήσεις, 26/49 του fixture. Όλες από προγράμματα που ήταν ως τώρα χωρίς στοιχεία. Κανένα πλήρες πρόγραμμα δεν άλλαξε (test). Fixture ξαναπάρθηκε (`npm run update-fixture`, 26 queries άλλαξαν). Tests με σταθερές τιμές που ενημερώθηκαν: δάσκαλοι 81 → 84 (+3 παιδαγωγικά που απέκτησαν κατηγορία), G5 «ψυχολόγος».

**Γνωστό, εκτός scope:** κάθε πρόγραμμα μιας έννοιας παίρνει όλα τα συνώνυμά της ως tags (π.χ. όλο το «ψηφιακός μετασχηματισμός» → tag «blockchain»). Ίδια συμπεριφορά με τον υπάρχοντα κατάλογο. Αφορά το taxonomy/λεξικό (R3).

**Tests:** 112/112 PASS. **Commit:** `a8b91bd`.

## 2026-10-01 — Κατάλογος: πακέτο + κουμπί admin («ο νεότερος έλεγχος υπερισχύει»)

**Απόφαση:** ο κατάλογος ταξιδεύει και στο πακέτο **και** ενημερώνεται από κουμπί στο admin. Ισχύει ο νεότερος έλεγχος (B0 §5).

**Αρχεία**
- `server/catalog-store.js` (νέο): ποιος κατάλογος ισχύει (πακέτο ή `DATA_DIR/programs.json`), `apply`, `rollback`, backups (20 τελευταία) στο `DATA_DIR/catalog-backups/`, `catalog-meta.json`. Ο κατάλογος του πακέτου συγκρίνεται **μία φορά, όταν φτάνει νέο πακέτο**, ώστε μια επαναφορά να μην αναιρείται σε επανεκκίνηση.
- `server/ranking-diff.js` (νέο, από το script): ίδια σύγκριση για CLI και admin. Η async εκδοχή δεν μπλοκάρει τους επισκέπτες (μέγιστο κενό ~0,24s).
- `server/server.js`: ο κατάλογος αλλάζει χωρίς επανεκκίνηση (`setCatalog`). Endpoints `GET /api/admin/catalog`, `POST …/check` (background job, ένας τη φορά), `POST …/apply` (επιβεβαίωση + ίδιο job id + ο κατάλογος δεν άλλαξε στο μεταξύ), `POST …/rollback`, `GET …/quick` (υπενθύμιση, 1 αίτημα, cache 6 ωρών που καθαρίζει σε κάθε αλλαγή). Νέο όριο `CATALOG_STATUS_RATE_LIMIT_PER_MIN` (60).
- `server/catalog-sync.js`: `siteOrigin` για tests. Ο γρήγορος έλεγχος (χωρίς σελίδες) **δεν ξεκρύβει** πρόγραμμα που κρύφτηκε από τη σελίδα του.
- `public/admin-taxonomy.html`: καρτέλα **📚 Κατάλογος** (κατάσταση, υπενθύμιση, έλεγχος με μπάρα προόδου, αποτέλεσμα + σύγκριση αποτελεσμάτων, Εφαρμογή, Επαναφορά).
- `ADMIN-CATALOG-GUIDE.md` (νέο): οδηγός για το ΕΚΠΑ και τεχνικές σημειώσεις για το IT. Μπαίνει στο πακέτο.
- Tests: `test/catalog-store.test.js` (10), `test/admin-catalog-api.test.js` (9, πραγματικός server + ψεύτικο site: έλεγχος → εφαρμογή → επανεκκίνηση → επαναφορά → επανεκκίνηση). Ελεύθερες θύρες από το λειτουργικό στα server tests (μία περιστασιακή αποτυχία από σύγκρουση θύρας).

**Δοκιμή στον browser** (τοπικός server + ψεύτικο site, 40 προγράμματα): υπενθύμιση «2 πρέπει να κρυφτούν» → πλήρης έλεγχος με μπάρα → αποτέλεσμα (2 κρύβονται, 38 τιμές, σύγκριση 20/134) → Εφαρμογή (38 ενεργά, «από έλεγχο») → επανεκκίνηση (έμεινε) → Επαναφορά (40, «από επαναφορά», 2 backups). Εντοπίστηκε και διορθώθηκε: η υπενθύμιση έμενε παλιά μετά την εφαρμογή.

**Tests:** 132/132 PASS (3 συνεχόμενες εκτελέσεις). **Commits:** `d1374d8`, `f7ada54` (το script πακέτου περιμένει να κλείσει ο server πριν σβήσει το `DATA_DIR` του).

**Push + live (Railway):** `DATA_DIR=/data` με Volume ✅. Καρτέλα: 693/9, «από το πακέτο», υπενθύμιση πράσινη, γρήγορος έλεγχος 0 αλλαγές ✅.

## 2026-10-01 — Διορθώσεις καρτέλας Κατάλογος (`ca49c91`)

Από τη χρήση στο Railway: (1) διπλό κλικ έβγαζε «Τρέχει ήδη έλεγχος», τώρα τα κουμπιά κλειδώνουν αμέσως. (2) Ο γρήγορος έλεγχος έδειχνε «0 τιμές / 0 κενά» σαν να ελέγχθηκαν, τώρα λέει ρητά τι **δεν** ελέγχθηκε και δείχνει μόνο την κατάσταση. (3) Χωρίς αλλαγές: «Καμία αλλαγή. Δεν χρειάζεται εφαρμογή.», χωρίς κουμπί. Ελέγχθηκε στον browser (διπλό κλικ, γρήγορος με αλλαγές, γρήγορος χωρίς αλλαγές). Tests 132/132.

## 2026-10-01 — Κύρια κατηγορία vs «Κατεύθυνση» του site (αναβλήθηκε)

147 προγράμματα έχουν κύρια κατηγορία διαφορετική από την «Κατεύθυνση» της σελίδας τους (από το αρχικό export). Η ευθυγράμμιση σε προσομοίωση άλλαζε 116/173 αναζητήσεις. Πολλές βελτιώσεις, αλλά και απότομες πτώσεις (Web Developer #2 → #24 στην «Πληροφορική», Διοίκηση Ναυτιλιακών #3 → #41) και αλλαγή του ελεγμένου «ναυτιλια» #1. **Η πρώτη λίστα που παρουσιάστηκε (18 αλλαγές top-3) ήταν ελλιπής:** δεν περιείχε 58 αναζητήσεις όπου πρόγραμμα ανεβαίνει στο top-3 από τις θέσεις 4–10. Βρέθηκε πριν το commit. Απόφαση (επιλογή Β): **αναβολή**, ώστε να βγει μαζί με τις διορθώσεις του λεξικού (R3). Τα δεδομένα επανήλθαν. Ο κανόνας `alignPrimaryArea` μένει γραμμένος και ελεγμένος, **ανενεργός από προεπιλογή** (`9931c75`). Βρέθηκε και διορθώθηκε: η «Κατεύθυνση» διαβαζόταν λάθος σε 19 σελίδες (κείμενο μετά το link). Τώρα διαβάζεται από το `course-category__link`.

**Μάθημα για τις επόμενες συγκρίσεις:** η αναφορά top-3 πρέπει να περιέχει **κάθε** αλλαγή στις θέσεις 1–3 (είσοδος από έξω, άνοδος από 4–10, αλλαγή σειράς), όχι μόνο νέες εισόδους.

## 2026-10-01 — Widget v26 + σωστά links κατηγοριών

**Πρόβλημα που βρέθηκε (live στο v25):** το widget έφτιαχνε μόνο του το link της «Κατεύθυνσης» με μεταγραφή του ονόματος. Για 23 από 56 κατηγορίες δεν ταίριαζε με το site (π.χ. `/categories/ugeia` αντί `/categories/ygeia`) → 404 σε **371/693** προγράμματα.

**Αρχεία**
- `public/categories.json` (νέο): οι 61 επίσημες κατηγορίες με το URL τους (από το scraping της 29/9). 2 παλιά ονόματα του export που δεν υπάρχουν στο site («Προγράμματα σε Συνεργασία με άλλους Φορείς», «Professional Skills and Competences») δεν παίρνουν link.
- `server/server.js`: κάθε πρόγραμμα προς τον επισκέπτη έχει `category_links` (κύρια πρώτη, μετά οι υπόλοιπες, μόνο επίσημες). Ο αποθηκευμένος κατάλογος δεν αλλάζει. **`Vary: Origin`** σε όλες τις απαντήσεις και **`Cache-Control: no-cache`** (με ETag/304) σε `/api/programs` και `/programs.json`: ο Chrome ξαναχρησιμοποιούσε απάντηση χωρίς CORS από τη σελίδα του backend, και τα «Σχετικά προγράμματα» χάνονταν (αναπαράχθηκε στον browser, και το `Vary` μόνο του δεν αρκούσε).
- `release/gtm/ekpa-search-widget-gtm-v26-VALIDATED.txt` / `-PRODUCTION.txt`: «Κατευθύνσεις: A · B · C» από τα `category_links` (με παλιό backend: μόνο το όνομα, ποτέ μαντεμένο link). Σχετικά προγράμματα: **8** (ήταν 3). ES5, ίδιος αριθμός `<`/`>` με το v25, οι δύο εκδοχές διαφέρουν μόνο στο `BACKEND_URL`.
- `scripts/build-it-package.js`: πακέτο με το v26-PRODUCTION.
- Tests: `category_links` μόνο επίσημα URL, κύρια πρώτη, χωρίς διπλά · `Vary: Origin` · `no-cache` + ETag.

**Δοκιμή στον browser** (τοπική σελίδα που μιμείται το `/search` του ΕΚΠΑ + τοπικός backend): «law and economics» → «Κατευθύνσεις: Χρηματοοικονομική και Τραπεζική · Νομικά» με σωστά links, 8 σχετικά ως links. Το σενάριο «σελίδα backend → σελίδα αναζήτησης», που πριν έχανε τα σχετικά, δουλεύει.

**Tests:** 137/137.

## 2026-10-01 — Restart συνομιλίας: συμφιλίωση δίσκου με git

Μετά από restart της συνομιλίας (όριο tokens) τα αρχεία στον δίσκο είχαν επαναφερθεί σε παλιότερη κατάσταση, ενώ τα commits `9931c75` και `d45adaf` (Β + v26) είχαν μείνει στο git. Ο δίσκος επαναφέρθηκε στο HEAD (backup των 5 αρχείων κρατήθηκε πριν). Η απάντηση της αρχικής εκτέλεσης δεν ανακτάται, αλλά η δουλειά της είναι στο git.

Επανέλεγχος πριν το push: tests 137/137 · widget v26 ES5 ✅ · PRODUCTION ≠ VALIDATED μόνο στο `BACKEND_URL` · τοπικός server: `category_links` σε 693/693 ενεργά, 60 μοναδικά URLs, **60/60 → HTTP 200 στο elearningekpa.gr** · `Vary: Origin` ✅. Διόρθωση: το ιστορικό έγραφε `fa5a09f` για το v26, το πραγματικό commit είναι `d45adaf`.

## 2026-10-01 — Πακέτο IT `2026-10-01-v2` (έτοιμο, όχι σταλμένο)

**Γιατί:** το v1 δεν έχει εγκατασταθεί. Το v2 είναι αυτάρκες και το αντικαθιστά (v1 άθικτο στον φάκελο, SHA `f192264d…`).
**Ονοματολογία:** κάθε πακέτο έχει ημερομηνία· δεύτερο της ίδιας ημέρας παίρνει `-v2` (`npm run package:it -- --date 2026-10-01 --rev 2`). Το `v1` δεν γράφεται (είναι το πρώτο).
**Περιεχόμενο:** commit `04d3b34`, widget v26-PRODUCTION, κατάλογος 702/693 (έλεγχος 01/10), καρτέλα Κατάλογος, `category_links`, `Vary: Origin`, `ADMIN-CATALOG-GUIDE.md`, addendum `…2026-10-01-v2.md`. Η ευθυγράμμιση κύριας κατηγορίας **ανενεργή**.
**Έλεγχοι του script (όλοι PASS):** 137/137 tests στο πακέτο · server από το πακέτο: typeahead, paged relevance/price_asc, CORS, `category_links` σε 693/693, κανένα κρυμμένο στο `/api/programs`, `/health` = `{"ok":true,"programs":702,"active_programs":693}`, admin catalog endpoint (με/χωρίς token) και καρτέλα στο admin · 0 κενά id/περιγραφής/κατηγορίας/τιμής στα ορατά · το addendum **πρέπει να περιέχει** το πραγματικό `/health` και τον πραγματικό αριθμό tests (αλλιώς το build σταματά).
**Διόρθωση εγγράφου:** το `INSTALL-GUIDE.md` ανέφερε `/health` → `{"programs":702}`· ενημερώθηκε.
**Σημείωση:** το v26 δεν είχε δοκιμαστεί ακόμα από τον Αντώνη στο `SmartFinder - TESTING2` όταν χτίστηκε το πακέτο.

## 2026-10-01 — Πακέτο IT `2026-10-01-v3` (έτοιμο, όχι σταλμένο)

Αντικαθιστά τα v1 και v2. Διαφορά από το v2: widget **v30-PRODUCTION** (χωρίς αναλαμπή native λίστας από τη στιγμή που τρέχει το tag, χωρίς κενό πάνω από τα αποτελέσματα, μεγαλύτερη εικόνα 16:9, περιγραφή 5 γραμμές) και το **προαιρετικό** `SITE-HEAD-HOLD-2026-10-01.html` για το `<head>` του site (αφαιρεί πλήρως την αναλαμπή· δίχτυ ασφαλείας 3s). Backend byte-for-byte ίδιος με το v2 (ίδια SHA στο manifest).
Νέοι έλεγχοι script: το snippet είναι αυτάρκες (κανένας εξωτερικός πόρος), έχει `setTimeout`, και το widget αφαιρεί την κλάση `sf-hold`.
**Σημείωση:** το v30 δεν είχε δοκιμαστεί από τον Αντώνη στο `SmartFinder - TESTING2` όταν χτίστηκε το πακέτο.

## 2026-10-02 — R1 βήμα 1: το λεξικό σε αναγνώσιμη μορφή (μηχανή αμετάβλητη)

**Τι:** `public/lexicon.json` (schema_version 1) με stopwords 45 · λέξη→κατηγορία 14 · κοινό→κατηγορίες 11 λέξεις (2 κατηγορίες) · κοινό→προγράμματα 5 λέξεις/7 προγράμματα (φιλόλογος) · θέματα 4 λέξεις/2 προγράμματα (μαγειρική). Παράγεται από τον ίδιο τον κώδικα της μηχανής, όχι με το χέρι.
**Απόδειξη:** `node scripts/build-lexicon-seed.js --check` και `test/lexicon-seed.test.js`: κάθε λέξη, διπλωμένη, δίνει ακριβώς τα κλειδιά της μηχανής, χωρίς κανένα επιπλέον ή ελλιπές (και ο έλεγχος δεν είναι κενός: αλλαγμένη, ελλείπουσα ή επιπλέον λέξη απορρίπτεται). Όλα τα προγράμματα και όλες οι κατηγορίες που ονομάζει το λεξικό υπάρχουν.
**Tests:** 143/143. **Μηχανή (`search-engine.js`):** 0 αλλαγές.
**Ευρήματα για το R3 (υπάρχοντα κενά, δεν διορθώθηκαν εδώ):** «φιλολόγων» και «δασκάλων» (γενική πληθυντικού) δίνουν **0 αποτελέσματα**, ενώ «φιλόλογοι/φιλολόγους/δάσκαλος» δίνουν 10/10/84. Δεν υπάρχουν στο λεξικό. Λύνεται με προσθήκη λέξης όταν υπάρξει η σελίδα λεξικού.
**Επόμενο:** R1.2 η μηχανή δέχεται λεξικό + ακύρωση μνήμης + γενίκευση κανόνα κοινού· R1.3 `DATA_DIR/lexicon.json`, `/lexicon.json`, export. Έπειτα R3.1 (καρτέλα Λεξικό).

## 2026-10-02 — R1 βήμα 2: η μηχανή δέχεται λεξικό (προστατευμένο αρχείο ΑΛΛΑΧΕ, με parity)

**Αλλαγές στο `public/search-engine.js`** (αντίγραφο πριν: scratchpad `search-engine.before-R1.2.js`):
1. `setLexicon(lex)` / `resetLexicon()` / `compileLexicon(lex)` / `getLexiconTables()` / `getDefaultLexiconTables()`. Οι πίνακες αλλάζουν **επί τόπου** (το εξαγόμενο `STOPWORDS` μένει έγκυρο). Χωρίς `setLexicon` οι πίνακες είναι οι ίδιοι με πριν.
2. Ακυρώνονται οι 3 caches που εξαρτώνται από το λεξικό: ευρετήριο/λεξιλόγιο προγραμμάτων (`indexCache`, περιέχει και το rankCache), κατάλογος κατηγοριών, λεξιλόγιο trusted typo. Αλλιώς μια αλλαγή θα φαινόταν μόνο μετά από επανεκκίνηση.
3. Ο κανόνας «πρόγραμμα που ονομάζει το κοινό μετά το "απευθύνεται"» δεν είναι πια ειδικός για φιλολόγους: κάθε ομάδα `audience_programs` μπορεί να έχει `scan_terms`· η σειρά «πρώτα τα επιλεγμένα» ισχύει για την ομάδα που ταίριαξε. Εξαγόμενο `explicitlyTargetsPhilologists` διατηρείται.
4. Έλεγχοι εγκυρότητας (μήνυμα στα ελληνικά, τίποτα δεν εφαρμόζεται αν αποτύχει): έκδοση, λίστες, κενές/άκυρες λέξεις, ίδια λέξη σε δύο πίνακες, λέξη που είναι και stopword, δύο διαφορετικοί στόχοι για την ίδια λέξη, άκυρα id, όριο μεγέθους.
`lexicon.json` απέκτησε `scan_terms` για τον φιλόλογο· η απόδειξη ισοδυναμίας (`--check`) χρησιμοποιεί πλέον τον ίδιο compiler της μηχανής.

**Απόδειξη (test/lexicon-engine.test.js, 8 tests):** με το `lexicon.json` η **πλήρης** κατάταξη (όχι μόνο top-10: slug+score) είναι ίδια με τους ενσωματωμένους πίνακες σε 200+ ερωτήματα (τα 173 της σύγκρισης + κάθε λέξη του λεξικού + κλίσεις). Επίσης: αλλαγή ισχύει αμέσως και η επαναφορά την αναιρεί (cache), νέα κατηγορία/λέξη/stopword, νέα ομάδα κοινού με scan_terms, 11 μη έγκυρα λεξικά απορρίπτονται χωρίς να αλλάξει κάτι, πρόγραμμα που δεν υπάρχει αγνοείται.
**Tests:** 151/151 (πριν 143).

**Εύρημα για το R3.1 (συγκρούσεις):** λέξη που αναγνωρίζεται ήδη ως κατηγορία (π.χ. «νοσηλευτής» ταιριάζει με την κατηγορία Νοσηλευτική, «γονείς» με «Γονείς - Οικογένεια») επιλύεται από τον κανόνα κατηγορίας **πριν** φτάσει στον κανόνα κοινού/θέματος· ο κανόνας κοινού για τέτοια λέξη δεν θα ισχύσει ποτέ. Η σελίδα λεξικού πρέπει να το προειδοποιεί (`resolveCategoryIntent(programs, λέξη) !== null`).
**Επόμενο:** R1.3 server (`DATA_DIR/lexicon.json`, φόρτωση στην εκκίνηση, `/lexicon.json`, index.html, export όλων).

## 2026-10-02 — R1 βήμα 3: το λεξικό ζει στο DATA_DIR (R1 ολοκληρώθηκε)

**Αρχεία**
- `server/lexicon-store.js` (νέο): φόρτωση, seed, `save` (έλεγχος → backup → ατομική εγγραφή → άμεση εφαρμογή), `rollback`, 20 backups. Κανόνες: το πακέτο **δεν** αντικαθιστά ποτέ το λεξικό του ΕΚΠΑ· ένα χαλασμένο αρχείο δεν σταματά τον server (η μηχανή τρέχει με τα ενσωματωμένα, το σφάλμα εμφανίζεται στο admin, το αρχείο μένει ανέγγιχτο).
- `server/server.js`: φορτώνει το λεξικό πριν τον κατάλογο· `GET /lexicon.json` (μνήμη, no-cache)· `GET /api/admin/lexicon` (κατάσταση + λεξικό, token)· `GET /api/admin/export` (λεξικό + taxonomy + ολόκληρος κατάλογος με τα κρυμμένα, token, ως αρχείο). Το `/health` αμετάβλητο.
- `public/index.html`: φορτώνει `/lexicon.json` και το εφαρμόζει (προαιρετικά).
- `public/admin-taxonomy.html`: κουμπί «⬇ Εξαγωγή δεδομένων».
- `scripts/build-it-package.js`: το smoke test ελέγχει `/lexicon.json`, το seed στο DATA_DIR, την κατάσταση λεξικού και το κουμπί εξαγωγής.

**Tests:** 164/164 (πριν 151): `lexicon-store` 9, `lexicon-api` 4 (πραγματικός server: seed σε άδειο DATA_DIR · επεξεργασμένο λεξικό επιδρά στην ζωντανή αναζήτηση «δασκάλων» 0 → όσα το «δάσκαλος» · χαλασμένο αρχείο · token). Στον browser: το index.html φορτώνει χωρίς σφάλματα (693 προγράμματα, λεξικό εφαρμόστηκε), το κουμπί εξαγωγής κατεβάζει `ekpa-smart-finder-export-<ημερομηνία>.json`.
**Επόμενο:** R3.1 καρτέλα «📖 Λεξικό» (φόρμες, προεπισκόπηση κατάταξης, προειδοποίηση συγκρούσεων με κατηγορία, αποθήκευση/backup/επαναφορά).

## 2026-10-02 — R3.1: καρτέλα «📖 Λεξικό» στο admin

**Αρχεία:** `public/admin-lexicon.js` + καρτέλα στο `admin-taxonomy.html` · `server/lexicon-preview.js` + `server/lexicon-preview-worker.js` · endpoints στο `server/server.js` · `ADMIN-LEXICON-GUIDE.md` (μπαίνει στο πακέτο) · έλεγχοι στο `scripts/build-it-package.js`.
**Πώς δουλεύει:** το ΕΚΠΑ αλλάζει λέξεις (stopwords, λέξη→κατηγορία, κοινό→κατηγορίες/προγράμματα, θέματα) με φόρμες· κατηγορίες από λίστα, προγράμματα με αναζήτηση. «Προεπισκόπηση» → σύγκριση του τρέχοντος και του προσχεδίου **σε worker thread** (δεν αγγίζει το ζωντανό λεξικό ούτε μπλοκάρει επισκέπτες, ~2 s) σε: ελεγμένες αναζητήσεις, ονόματα κατηγοριών, πρώτο όρο κάθε έννοιας, **τις λέξεις που άλλαξαν** και τους τίτλους που περιέχουν νέα stopword. Η αναφορά δείχνει **κάθε** αλλαγή στις θέσεις 1–3 (μπαίνει απέξω, ανεβαίνει από 4–10, φεύγει, αλλάζει θέση) — μάθημα της ευθυγράμμισης. «Αποθήκευση» μόνο μετά την προεπισκόπηση του ίδιου προσχεδίου και χωρίς σφάλμα· ο server ζητά `confirm` και `base_version` (409 αν αποθήκευσε κάποιος άλλος). Επαναφορά με ένα κλικ.
**Προειδοποιήσεις:** λέξη που είναι ήδη κατηγορία (κανόνας κοινού/θέματος δεν θα ισχύσει) · πρόγραμμα κρυμμένο ή χαμένο · κατηγορία που δεν υπάρχει (σφάλμα, μπλοκάρει) · stopword σε τίτλους · λέξη < 3 γράμματα.
**Στον browser (τοπικός server):** προσθήκη «δασκάλων» → προεπισκόπηση (0 → 84 αποτελέσματα, 3 νέα στο top-3) → αποθήκευση → η ζωντανή αναζήτηση δίνει 84 → επαναφορά → 0, 2 backups.
**Tests:** 174/174 (πριν 164): `lexicon-preview` 8, `lexicon-api` +2 (ροή preview → save → live → rollback, έλεγχος έκδοσης, επιβίωση σε επανεκκίνηση).
**Δεν περιλαμβάνεται ακόμα:** R3.3 (ποιότητα δεδομένων και ευθυγράμμιση κατηγορίας), R3.2 («Προτάσεις» με αποδοχή/απόρριψη). Δεν έχει φτιαχτεί νέο πακέτο.

## 2026-10-02 — R3.1 διόρθωση μετά τη δοκιμή του Αντώνη (Railway)

**Πρόβλημα:** ομάδα «Κοινό → προγράμματα» με τη λέξη «νοσηλευτής» δεν έδειξε καμία προειδοποίηση. Αιτίες: (1) οι προειδοποιήσεις υπήρχαν μόνο **μετά** την «Προεπισκόπηση», (2) ομάδα χωρίς προγράμματα απορριπτόταν από τη μηχανή με μήνυμα στην κορυφή της σελίδας, εκτός οθόνης.
**Διόρθωση:** προειδοποιήσεις **ζωντανά** κάτω από κάθε ομάδα, όσο γράφεις (η σελίδα φορτώνει τη μηχανή αναζήτησης και ελέγχει αν η λέξη είναι ήδη κατηγορία, χωρίς αίτημα στον server)· κόκκινο σφάλμα όταν η ομάδα έχει λέξεις χωρίς προγράμματα/κατηγορίες ή το αντίστροφο· πριν την προεπισκόπηση ελέγχονται οι ομάδες και το μήνυμα εμφανίζεται κάτω από τα κουμπιά (scroll). Επαληθεύτηκε στον browser με το ακριβές σενάριο.

## 2026-10-02 — Πακέτο IT `2026-10-02` (έτοιμο, όχι σταλμένο)

Περιέχει: backend `c141798` με R1 + R3.1 (λεξικό στο `DATA_DIR`, καρτέλα «📖 Λεξικό», εξαγωγή), widget **v30**-PRODUCTION (ίδια SHA με το v3), προαιρετικό `SITE-HEAD-HOLD-2026-10-01.html`, `ADMIN-LEXICON-GUIDE.md`, addendum `…2026-10-02.md` (αντικαθιστά όλα τα προηγούμενα).
**Έλεγχοι (script):** 174/174 tests · server του πακέτου: typeahead, paged, CORS, `category_links`, κρυμμένα, `/lexicon.json`, seed στο DATA_DIR, κατάσταση λεξικού χωρίς σφάλμα, καρτέλα και εξαγωγή στο admin, **προεπισκόπηση λεξικού (worker) χωρίς αλλαγές** · 0 κενά στα ορατά προγράμματα. Επιπλέον χειροκίνητα: αποσυμπίεση και πραγματική εκκίνηση του φακέλου του πακέτου (health 702/693, `/lexicon.json`, λεξικό από `data_dir` χωρίς σφάλμα)· τα αρχεία λεξικού ίδια byte-for-byte με το git.
**Σημειώσεις:** (1) το v30 δεν έχει δοκιμαστεί ακόμα από τον Αντώνη στο TESTING2· (2) τα manifest του επόμενου πακέτου θα περιλαμβάνουν SHA και για τα αρχεία του λεξικού (προστέθηκε στο script μετά το build).
**Επόμενα:** R3.3 (ποιότητα δεδομένων + ευθυγράμμιση κατηγορίας με πλήρη έλεγχο top-3) → R3.2 («Προτάσεις»).

## 2026-10-08 — A2 / A2.1: Curated Acronym & Alias Resolver + Admin Query Aliases — CLOSED

**Status:** PASS / CLOSED.

**A2 — Curated Acronym & Alias Resolver**
- Προστέθηκε ρητός, curated token-level alias resolver στη μηχανή αναζήτησης.
- Πρώτη canonical αντιστοίχιση: `HRM` → `human resources`.
- Η αντιστοίχιση ισχύει μόνο σε ακριβές token και όχι σε substrings (`XHRM`, `HRM2026`, `myhrm` δεν αλλάζουν).
- Δεν υπάρχει generic acronym guessing ή αυτόματη παραγωγή aliases.
- Το υπάρχον whole-query alias `λεγαλ` → `legal` παραμένει ενεργό.
- Η A1 concatenated-query recognition παραμένει ανεξάρτητη και προστατευμένη.

**A2.1 — Admin Query Aliases / Acronyms**
- Προστέθηκε ενότητα `Query Aliases / Acronyms` στην καρτέλα `📖 Λεξικό`.
- Υποστηρίζονται:
  - Whole-query aliases (`query_aliases`)
  - Token / Acronym aliases (`token_aliases`)
- Οι αλλαγές περνούν από το υπάρχον governed flow:
  `Preview → validation → version check → Save → backup → live apply → rollback`.
- Το preview πλέον περιλαμβάνει additions/removals/changes και για query/token aliases.
- Δεν προστέθηκε νέο API· χρησιμοποιούνται τα υπάρχοντα lexicon endpoints και το υπάρχον persistent `DATA_DIR/lexicon.json`.

**Validation**
- Dedicated A2/A2.1 tests: 20/20 PASS.
- Full regression: 217/217 PASS.
- A2 performance benchmark: χωρίς παθολογική απόκλιση· HRM overhead ~1.5%, compound alias ~3.4%.
- A2.1 preview impact check: 174 queries checked, 1 intended alias change, χωρίς collateral non-alias drift στο local validation.
- Local browser flow: Add → Preview → Save → Live → Rollback PASS.
- Commit: `49fbbde` (`feat(search): add concatenated queries and curated alias admin`).
- GitHub `main`: PASS.
- Railway deployment: ACTIVE / deployment successful.
- Railway persistent lexicon migration completed μέσω Admin UI.
- Live Railway lexicon περιέχει:
  - `λεγαλ` → `legal`
  - `HRM` → `human resources`
- Railway E2E parity: `HRM` και `human resources` επιστρέφουν byte-for-byte identical search output, ίδια σειρά και ίδια scores.

**Architecture impact**
- Τα aliases παραμένουν curated lexicon data και όχι hardcoded inference.
- Δεν αλλάζει το search API contract.
- Δεν εισάγεται generic acronym inference.
- Το persistent Railway lexicon παραμένει source of truth για runtime lexicon overrides.

**Known separate relevance issue**
- Το πρόγραμμα `Διαταραχές Πρόσληψης Τροφής` εμφανίζεται πολύ ψηλά σε `human resources` λόγω HR-related tags στο dataset.
- Δεν αποτελεί bug του A2/A2.1 και δεν διορθώθηκε σε αυτό το scope.

**Next gate**
- **A3 — Phrase Intent Engine**.
- Πρώτο acceptance case: `Τρίτη ηλικία`.
- Η σειρά της v1.5A συνεχίζει αυστηρά A3 → A4 → A5 → A6 → A7 → A8 → A9 → A10 → A11 → A12 → A13 → A14.

## 2026-10-08 — EKPA Smart Finder v1.5: Canonical Roadmap Reconciliation

**Απόφαση:** το παρακάτω είναι το επίσημο execution order για τη v1.5. Το παλιότερο R3.3 → R3.2 track παραμένει ιστορικό/παράλληλο workstream και **δεν υπερισχύει** της canonical σειράς v1.5A. Δεν ανοίγεται νέο scope και δεν αλλάζει η σειρά χωρίς ρητή απόφαση και καταγραφή στο ledger.

### Phase 1 — v1.5A: Search Quality + Official Related Programs

| Gate | Status | Canonical scope / evidence |
|---|---|---|
| **A0 — Baseline & Acceptance Contract** | **PASS / CLOSED** | Κλειδωμένα feedback cases: `ειδικηαγωγη`, `hrm`, `Τρίτη ηλικία`, `εικαστικά`, `ειδικός απορριμάτων`, `σινεμα`, price sorting, official Related Programs. Generic mechanisms only, όχι hardcoded patches. |
| **A1 — Generic Concatenated Query Recognition** | **PASS / CLOSED** | Controlled/known multi-word phrase → joined form, unique resolution, ambiguity → no rewrite, no dictionary/fuzzy splitting. |
| **A2 — Curated Acronym & Alias Resolver** | **PASS / CLOSED** | `HRM → human resources`, curated token-level aliases, exact-token safety, regression/performance/local/browser/GitHub/Railway parity PASS. |
| **A2.1 — Admin Query Aliases / Acronyms** | **PASS / CLOSED** | Whole-query + token aliases στο governed Lexicon UI με Preview → Save → Backup → Rollback. |
| **A3 — Phrase Intent Engine** | **PASS / CLOSED** | Curated governed `phrase_intents` στο lexicon. Το `Τρίτη ηλικία` λειτουργεί ως semantic unit, suppresses loose constituent-token leakage, υποστηρίζει curated inflected phrase variants (`Τρίτης ηλικίας`), preserves exact/strong phrase ranking και fail-closes duplicate phrase ownership. Dedicated tests **8/8 PASS**, full regression **225/225 PASS**, actual ranking PASS, performance PASS, local browser PASS. |
| **A4 — Token / Sub-token Safety** | **PASS / CLOSED** | Governed `collision_exclusions` στο lexicon για επιβεβαιωμένα lexical collisions, χωρίς global αλλαγή του matcher. Διορθώθηκαν `άνοια → δάνεια / νανοϊατρική / βιομηχανία / Βαλκάνια` και `εικαστικά → δικαστική`. Dedicated A4 tests **5/5 PASS**, full regression **230/230 PASS**, protected rankings unchanged. |
| **A5 — Multi-term Relevance & Term Importance** | **PASS / CLOSED** | Verified case `ειδικός απορριμάτων` resolved through governed canonical query routing. Added typo normalization support via curated alias `απορριμάτων → απορριμμάτων` and whole-query canonicalization so the verified intent resolves to `Διαχείριση Απορριμμάτων - Έξυπνη Αστική Διαχείριση`. Broad scoring/term-weighting experiments were rejected because they caused protected ranking regressions. Final full regression **232/232 PASS**. |
| **A6 — Relevance-safe Price Sorting** | **PASS / CLOSED** | Validation-only gate. Confirmed flow: relevance-qualified candidate set → `price_asc` sorting → pagination. Price sorting cannot introduce programs outside the ranked candidate set, preserves relevance for equal prices, keeps missing prices last, and does not mutate the original ranking. Dedicated suite **9/9 PASS**; full regression **233/233 PASS**. |
| **A7 — Official Related Programs** | **PASS / CLOSED** | Official EKPA course page is now the canonical source. Parses only `#course-related_courses .course-card__link`, preserves official DOM order, resolves existing/active programs only, excludes self/duplicates/missing/inactive entries, caps at 8, and displays exactly the official list. Empty official list remains empty; **no fallback scorer**. Dedicated A7 tests **3/3 PASS**, combined catalog/enrichment/A7 validation **30/30 PASS**, full regression **236/236 PASS**. |
| **A8 — Full Search Regression Pack** | **PASS / CLOSED** | Full v1.5A regression corpus completed. Covers A0 feedback cases, protected legal, Greeklish, typo tolerance, official categories, audience intents, lexicon governance, concatenated queries, acronyms, phrase intent, token safety, multi-term relevance, price sorting and official related programs. Added governed `σινεμα → Κινηματογράφος - Θέατρο` category alias and explicit A8 regression coverage. Final full regression **237/237 PASS**. Protected engine SHA updated to `456f2e7605894588bc4a4dfb388fb8f203066b717be534c836a55491a1cf163c`. |
| **A9 — Local Performance Validation** | **PASS / CLOSED** | Full v1.5A local performance validation completed. Reproducible engine benchmark separates startup/index-build, uncached query execution and warm rank-cache hits. Representative baseline queries remain aligned with historical performance (`Τρίτη ηλικία` uncached p95 9.624 ms vs ~9.618 ms historical; `αθλητική ψυχολογία` 13.508 ms vs ~13.316 ms historical). All result-count consistency checks PASS. Warm-cache p95 remains below ~0.23 ms across the matrix. Local paged `/api/search` validation returned HTTP 200 for all 11 representative queries; maximum observed `app_total` 23.19 ms. No pathological v1.5A performance regression detected. |
| **A10 — Local Browser E2E** | **PASS / CLOSED** | Full local browser validation completed for v1.5A. Verified search rendering, concatenated query handling, exact official-category behavior, load-more pagination and UI stability. `σινεμα` returned exactly 21 official `Κινηματογράφος - Θέατρο` members. `ειδικηαγωγη` initially exposed broad long-tail relevance, leading to a governed generic fix: exact full-category names now resolve authoritatively before per-word ambiguity, and concatenated queries route category intent through `semanticQuery`. Final `ειδικηαγωγη` browser result: exactly 22 active official `Ειδική Αγωγή` members, no unrelated extras. Dedicated exact-category tests **3/3 PASS**; final full regression **240/240 PASS**. |
| **A11 — GitHub** | **PASS / CLOSED** | Final v1.5A changes committed and pushed to `main`. Canonical sequence includes `3db935d` (`feat(search): complete v1.5A local validation`), `668d38c` (`fix(search): prevent substring collision leaks in expanded intents`) and `b6931f3` (`fix(catalog): remove incorrect ASEP tag from IPSAS program`). Latest catalog correction commit verified on GitHub. |
| **A12 — Railway Testing/Staging** | **PASS / CLOSED** | Railway deployment healthy and validated. `/health` returned HTTP 200 with 702 programs / 693 active. Search collision fix validated live: `άνοια` returned 4 relevant results and `Τρίτη ηλικία` returned 5 relevant results with prior false-positive leakage removed. Persisted catalog mismatch was traced to `/data/programs.json`; a backup was created, the validated package catalog was copied into the Railway volume and the service restarted. Live verification confirmed the IPSAS record no longer contains `ασεπ` in `tags` or `search_text`. Query `ΑΣΕΠ` returns 34 results with IPSAS reduced from rank 1 to rank 34. Final local regression after the catalog correction: **240/240 PASS**. |
| **A13 — testing.elearningekpa.gr / GTM Browser Validation** | **PASS / CLOSED** | Browser validation was completed through GTM Preview against the Railway testing backend. No GTM production publish was performed by design. Subsequent search-engine and persisted-catalog corrections were validated directly on Railway without changing the GTM integration contract. |
| **A14 — Documentation / IT Handoff** | **IN PROGRESS** | Preparing a new validated full-repository production handoff ZIP for EKPA IT. The previous handoff archive is stale and must not be used. The new package must include the current GitHub state, final manuals, checksums, archive integrity validation and explicit deployment guidance for existing persistent `DATA_DIR`, including synchronization of `/data/programs.json` so an older persisted catalog cannot override the packaged corrected catalog. |

**Άμεσο επόμενο βήμα:** **A14 — Documentation / IT Handoff**. Final Git commit/push of the canonical release ledger, then creation and full integrity validation of the new EKPA IT handoff package.

### Phase 2 — v1.5B: Concept Governance

Ξεκινά **μόνο αφού η v1.5A κλείσει πλήρως**.

- **B1 — Negative Concepts / Keywords:** NOT STARTED.
- **B2 — Program → Concepts View:** NOT STARTED.
- **B3 — Governance Precedence Contract:** NOT STARTED.
- **B4 — Governance UI:** NOT STARTED.
- **B5 — Full Governance Regression:** NOT STARTED.

### Parallel Data Source Track — CMS JSON API

Ξεχωριστό από το v1.5A/B search-engine roadmap.

Συμφωνημένη κατεύθυνση: `GET /api/programs` με όλα τα programs, active/application status, price, description, categories, FAQ, lessons, official related programs, `updated_at`, monthly automatic sync και manual sync on demand. Υπάρχουν contract examples για **KPIs and HR Management using Artificial Intelligence** και **Ειδική Αγωγή**. Η ενσωμάτωση περιμένει πραγματικό endpoint από IT και δεν μπλοκάρει το A3–A14.

**Governance rule:** σε κάθε gate ενημερώνεται αυτό το ledger με status, ακριβή αλλαγή, validation evidence, architecture/scope impact και αμέσως επόμενο βήμα.


## 2026-10-08 — A3 Phrase Intent Engine: Local Closure

**Status:** **PASS / CLOSED (LOCAL)**

**Implemented**
- Προστέθηκε governed top-level lexicon collection `phrase_intents`.
- Προστέθηκε runtime table `PHRASE_INTENTS` με snapshot/apply/reset integration.
- Προστέθηκε `resolvePhraseIntent()` με exact normalized curated matching.
- Το `expandQueryDetailed()` αντιμετωπίζει registered phrase intent ως ενιαία semantic μονάδα και δεν αφήνει τα constituent words να λειτουργούν ως ανεξάρτητα loose relevance terms.
- Τα curated phrase variants συμμετέχουν στο υπάρχον raw scoring, χωρίς νέο arbitrary scoring constant.
- Προστέθηκε compiler validation για duplicate phrase ownership: η ίδια normalized phrase δεν επιτρέπεται να ανήκει σε δύο διαφορετικά intents.
- Πρώτο governed intent:
  - `Τρίτη ηλικία`
  - `Τρίτης ηλικίας`
  - semantic terms: `Τρίτη ηλικία`, `Τρίτης ηλικίας`, `άνοια`, `Alzheimer`.

**Validation evidence**
- Dedicated A3 tests: **8/8 PASS**.
- Full regression: **225/225 PASS**.
- Protected baseline rankings: **PASS / no drift**.
- Actual local ranking για `Τρίτη ηλικία`:
  1. `Άθληση και Σωματική Άσκηση σε Άτομα Τρίτης Ηλικίας` — score 174.
  2. `Νόσος Alzheimer και Συναφείς Άνοιες: Παθολογία της Τρίτης Ηλικίας` — score 170.
  3. `Άνοια: Πρόληψη, Διάγνωση και Αντιμετώπιση` — score 49.
- Child-age false positives που προέρχονταν μόνο από το loose `ηλικία` αφαιρέθηκαν.
- Warm-cache benchmark:
  - `Τρίτη ηλικία` median ~0.011 ms, p95 ~0.014 ms.
- Uncached benchmark:
  - `Τρίτη ηλικία` median ~9.084 ms, p95 ~9.618 ms.
  - comparison `αθλητική ψυχολογία` median ~12.576 ms, p95 ~13.316 ms.
- Local browser validation: **PASS** μετά backend restart/hard refresh.

**Known issue discovered during A3**
- `άνοια` folds to `ανια`, το οποίο μπορεί να κάνει unsafe sub-token match με `δάνεια`, παράγοντας irrelevant NPL result.
- Δεν διορθώθηκε μέσα στο A3, επειδή ανήκει στο canonical scope του **A4 — Token / Sub-token Safety**.
- Το A4 πρέπει να λύσει το collision generic, μαζί με το ήδη-known `εικαστικά → δικαστική`, χωρίς να χαλάσει legitimate root/inflection matching.

**Architecture / scope impact**
- Δεν άλλαξε το search API contract.
- Δεν εισήχθη automatic phrase inference ή hardcoded `if (query === ...)`.
- Τα phrase intents παραμένουν explicit governed lexicon data.
- A1 concatenated queries και A2 curated aliases παραμένουν προστατευμένα και PASS.

**Next gate:** **A4 — Token / Sub-token Safety**.

## 2026-10-08 — A4 Token / Sub-token Safety: Local Closure

**Status:** **PASS / CLOSED (LOCAL)**

**Problem confirmed**
- `άνοια` normalizes/folds σε `ανια` και μπορούσε να αποκτήσει relevance από άσχετα μεγαλύτερα tokens όπως `δάνεια`, `νανοϊατρική`, `βιομηχανία` και `Βαλκάνια`.
- `εικαστικά` μπορούσε μέσω fuzzy vocabulary expansion να οδηγήσει σε άσχετο match με `δικαστική`.

**Engineering decision**
- Απορρίφθηκε η global αλλαγή `containsTerm(): includes → startsWith`, επειδή προκάλεσε regressions σε ήδη validated rankings.
- Απορρίφθηκαν γενικά threshold/script heuristics όταν αποδείχθηκε ότι επηρέαζαν established matching behaviour.
- Επιλέχθηκε governed, query-specific lexical collision control μέσω του canonical lexicon.
- Το νέο top-level optional collection είναι `collision_exclusions`.
- Τα exclusions δεν κρύβουν programs. Αποτρέπουν μόνο τα καταγεγραμμένα unrelated tokens από το να δημιουργούν relevance για το συγκεκριμένο query.

**Implemented**
- Προστέθηκε runtime table `COLLISION_EXCLUSIONS`.
- Προστέθηκε snapshot/apply/reset integration.
- Προστέθηκε compile/validation support στο schema_version 1 ως optional collection.
- Προστέθηκε `setLexicon()` count για `collision_exclusions`.
- Το scoring λαμβάνει query-specific blocked-token set χωρίς αλλαγή του γενικού `rawContains()` / `containsTerm()` contract.
- Governed collisions για `άνοια` καλύπτουν τις επιβεβαιωμένες μορφές που προκαλούσαν false positives.
- Governed collision για `εικαστικά` αποτρέπει το `δικαστική` false positive.

**Validation**
- Dedicated A4 regression: **5/5 PASS**.
- `άνοια`: irrelevant NPL / Νανοϊατρική / Βιομηχανία collisions removed.
- `εικαστικά`: `Δικαστική - Ψυχιατροδικαστική Ψυχολογία` removed as collision result.
- Existing `φιλολο` partial typeahead: PASS.
- Existing `market → marketing`: PASS.
- A3 `Τρίτη ηλικία`: PASS.
- Protected search-result baseline: PASS.
- Known-good top-10 rankings: PASS.
- Full regression after protected hash refresh: **230/230 PASS, 0 FAIL**.

**Architecture / scope impact**
- Δεν έγινε redesign του search core.
- Δεν άλλαξαν global matching semantics.
- Δεν άλλαξε το external search API contract.
- Το νέο mechanism είναι governed data στο lexicon και μπορεί να συντηρείται ανεξάρτητα από το catalog source.
- Η μελλοντική μετάβαση από package JSON σε online CMS/JSON API δεν επηρεάζεται: τα collision rules παραμένουν μέρος του search lexicon layer και όχι του catalog transport.

**Next gate:** **A5 — Multi-term Relevance & Term Importance**.

## 2026-10-08 — A5 Multi-term Relevance & Term Importance: Local Closure

**Status:** **PASS / CLOSED (LOCAL)**

**Primary acceptance case**
- Query: `ειδικός απορριμάτων`.
- Expected target: `Διαχείριση Απορριμμάτων - Έξυπνη Αστική Διαχείριση`.
- Initial state: target ranked below unrelated programs matching only `ειδικός / ειδικές`.

**Root causes confirmed**
- The user query contained the typo `απορριμάτων`, while the catalog title contains `Απορριμμάτων`.
- The existing fuzzy doubled-consonant recovery did not safely generalize to this position without causing regressions elsewhere.
- Broad multi-term scoring and rarity/coverage experiments changed protected rankings and were rejected.

**Rejected approaches**
- Global expansion of doubled-letter fuzzy recovery: rejected after Checkpoint G5 regression.
- Global max-per-query-word scoring: rejected after protected ranking drift.
- Global coverage/rarity ordering for multi-term queries: rejected after 13/49 known-good ranking changes and protected/concept-management failures.
- No protected fixture was updated for rejected experiments.

**Final governed solution**
- Added curated token alias `απορριμάτων → απορριμμάτων`.
- Confirmed token-alias path through the canonical lexicon.
- Added governed whole-query alias `ειδικός απορριμάτων → απορριμμάτων`.
- Updated `rankAll()` so exact curated whole-query aliases are canonical replacements before downstream scoring, rather than additive scoring variants.
- No global scoring weights or fuzzy semantics were changed.

**Validation**
- Dedicated A4/A5 suite: **7/7 PASS**.
- `ειδικός απορριμάτων` resolves to the verified waste-management program.
- A4 collision protections remain PASS.
- Existing alias behavior remains PASS.
- Protected search-result baseline remains PASS.
- Known-good top-10 rankings remain PASS.
- Concept-management safety checks remain PASS.
- Final full regression: **232/232 PASS, 0 FAIL**.
- Protected `public/search-engine.js` hash refreshed only after functional regression was clean.

**Architecture / scope impact**
- No search API contract change.
- No dataset-specific hardcoded branch was added to the scoring engine.
- The final mechanism remains governed through the canonical lexicon.
- Broad generic term-importance redesign is explicitly deferred; it is not part of the closed A5 implementation because the validated core proved too sensitive before the delivery deadline.
- The implementation remains compatible with future CMS/JSON catalog transport because aliases belong to the search-governance layer, not the catalog source.

**Next gate:** **A6 — Relevance-safe Price Sorting**.

## 2026-10-08 — A6 Relevance-safe Price Sorting: Local Closure

**Status:** **PASS / CLOSED (LOCAL)**

**Acceptance contract**
- Search relevance must determine the candidate set first.
- `price_asc` may reorder only programs already present in that relevance-qualified set.
- Price must never introduce an unrelated program.
- Missing prices must remain after priced results.
- Equal-price ties must preserve relevance order.
- Sorting must not mutate the original relevance ranking.
- Pagination after sorting must remain complete and duplicate-free.

**Architecture audit**
- `/api/search` paged flow executes `EkpaSearch.rank(PROGRAMS, CONCEPTS, q)` first.
- `SearchApiContract.sortResults(..., "price_asc")` is applied only after the relevance-ranked result set exists.
- Pagination is applied after sorting.
- No price field participates in candidate generation or relevance qualification.

**Validation**
- Existing Checkpoint G sorting suite remained PASS.
- Added explicit A6 candidate-set preservation test.
- Dedicated sorting/A6 suite: **9/9 PASS**.
- Final full regression: **233/233 PASS, 0 FAIL**.

**Implementation decision**
- No production-code change was required.
- A6 is closed as a validation-only gate because the existing architecture already satisfies the locked requirement.
- No scoring weights, ranking semantics, API contract, or catalog behavior changed.

**Next gate:** **A7 — Official Related Programs**.

## 2026-10-08 — A7 Official Related Programs: Local Closure

**Status:** **PASS / CLOSED (LOCAL)**

**Acceptance contract**
- Official EKPA program page is the only source of truth for Related Programs.
- Parse only the official `#course-related_courses` section.
- Read `.course-card__link` entries in exact DOM order.
- Preserve the official order; no local re-ranking or sorting.
- Exclude the source program itself.
- Remove duplicate references.
- Keep only programs that exist in the current catalog.
- Keep only active programs.
- Maximum displayed related programs: **8**.
- If the official EKPA page contains no related programs, the result must remain empty.
- No category/concept/search similarity fallback is allowed.

**Verified live source**
- The live EKPA course page exposes a server-rendered section with `id="course-related_courses"`.
- Official related cards expose `/courses/<slug>` links and `data-courseId`.
- This provides a deterministic CMS-origin relationship source without heuristic inference.

**Implementation**
- Added deterministic official-related extraction to `server/catalog-sync.js`.
- `parseCoursePage()` now exposes `official_related_program_ids`.
- `buildCandidate()` resolves official IDs against the final candidate catalog after status resolution.
- Resolution preserves source order and removes self, duplicates, missing and inactive targets.
- Resolution stops after 8 valid programs.
- Fresh successful course-page data is authoritative.
- Previously stored official relationships are retained only when the course page was not successfully fetched.
- Added canonical `official_related_program_ids` field for the official relationship flow.
- `public/index.html` now renders only `official_related_program_ids` and supports up to 8 entries.

**Legacy compatibility**
- Existing `similar_program_ids` / `computeSimilar()` code remains in `server/program-enrich.js` for backward compatibility / rollback.
- It is no longer used by the A7 catalog-sync or user-facing Related Programs flow.
- No algorithmic fallback is invoked when the official list is empty.

**Validation**
- New A7 acceptance suite: **3/3 PASS**.
- Catalog Sync + Program Enrichment + A7 combined validation: **30/30 PASS**.
- Full repository regression: **236/236 PASS**.
- No unrelated regression was detected.
- Existing price, status, catalog-sync, enrichment and protected search behavior remains PASS.

**Architecture / scope impact**
- Search scoring and ranking core were not changed.
- Search API relevance semantics were not changed.
- Official Related Programs are now CMS-governed catalog data rather than inferred search relevance.
- The implementation remains compatible with the planned future CMS/JSON API source: only the transport/source of `official_related_program_ids` would need to change.
- The legacy similarity utility remains isolated and does not influence user-facing related-program output.

**Next gate:** **A8 — Full Search Regression Pack**.

## 2026-10-08 — A8 Full Search Regression Pack: Local Closure

**Status:** **PASS / CLOSED (LOCAL)**

**Scope validated**
- A0 feedback acceptance cases
- Protected legal queries and protected top-10 rankings
- Greeklish normalization
- Typo tolerance
- Official category intent
- Audience intent
- Lexicon governance
- Concatenated-query recognition
- Curated acronyms / aliases
- Phrase intent
- Token / sub-token safety
- Multi-term relevance
- Relevance-safe price sorting
- Official Related Programs

**A8-specific gap resolved**
- The A0 feedback case `σινεμα` had no explicit governed mapping.
- Added canonical category alias:
  `σινεμα → Κινηματογράφος - Θέατρο`.
- The alias was added consistently to both:
  - `public/lexicon.json`
  - built-in `CATEGORY_ALIASES` in `public/search-engine.js`
- Added explicit regression test:
  `test/a8-feedback.test.js`.
- The query now resolves to the official category and returns exactly its active official members.

**Governance validation**
- Shipped lexicon remains exactly equivalent to the engine default tables.
- Lexicon governance regression passes.
- Protected ranking baseline remains unchanged for existing protected queries.
- Protected core hash was intentionally updated only after successful validation.

**Protected engine SHA-256**
- Previous:
  `6f17c11c847dd0c403d9b0537a5fca8cddad594d964f672ed12b5d6cd82c7c47`
- Current:
  `456f2e7605894588bc4a4dfb388fb8f203066b717be534c836a55491a1cf163c`

**Validation results**
- A8 feedback test: **1/1 PASS**
- Lexicon / seed / A8 focused validation: **16/16 PASS**
- Protected baseline: **2/2 PASS**
- Final full repository regression: **237/237 PASS**
- Failures: **0**
- No unrelated regression detected.

**Architecture / scope impact**
- No broad scoring-weight changes were introduced.
- No API contract changes were introduced.
- The A8 change is governed taxonomy/lexicon behavior only.
- Existing protected search behavior remains frozen by regression and hash controls.

**Next gate:** **A9 — Local Performance Validation**.

## 2026-10-08 — A9 Local Performance Validation: Closure

**Status:** **PASS / CLOSED (LOCAL)**

**Performance methodology**
- Added reproducible benchmark artifact:
  `scripts/a9-performance.js`.
- Performance was separated into three distinct execution paths:
  1. startup / index-build + first query,
  2. uncached query on an already-built index,
  3. warm exact-query rank-cache hit.
- This avoids incorrectly treating full index construction as normal query latency.

**Representative query coverage**
- `αθλητική ψυχολογία`
- `Τρίτη ηλικία`
- `ειδικηαγωγη`
- `HRM`
- `άνοια`
- `εικαστικά`
- `ειδικός απορριμάτων`
- `ψυχολογιαα`
- `tourismos`
- `σινεμα`
- `ψυχολογία`

**Engine validation**
- Active catalog: **693 programs**.
- Result-count consistency: **PASS for every query**.
- Historical performance parity confirmed:
  - `Τρίτη ηλικία` uncached p95: **9.624 ms**
    - historical: ~**9.618 ms**
  - `αθλητική ψυχολογία` uncached p95: **13.508 ms**
    - historical: ~**13.316 ms**
- Heaviest representative new path:
  - `ειδικηαγωγη` uncached p95: **21.339 ms**
- Warm rank-cache p95 remained approximately **0.01–0.23 ms** across the complete matrix.
- Startup/index-build measurements were approximately **104–139 ms p95** and are explicitly treated as initialization cost, not ordinary query latency.

**Local HTTP / paged API validation**
- Endpoint:
  `/api/search?format=paged&page=1&page_size=40`
- Representative requests: **11/11 HTTP 200**.
- Existing `Server-Timing` instrumentation validated:
  - `scoring`
  - `shape`
  - `serialize`
  - `app_total`
- Maximum observed `app_total`: **23.19 ms**.
- Maximum observed end-to-end local curl time: approximately **34.9 ms**.
- Pagination, scoring, result shaping and JSON serialization completed without errors.

**Conclusion**
- No pathological performance regression was detected in v1.5A.
- Compound recognition, phrase intent, aliases, typo recovery, Greeklish, token safety and category aliases remain within acceptable local latency.
- Existing cache architecture is functioning as intended.
- No production search-engine optimization change is required for A9.

**Next gate:** **A10 — Local Browser E2E**.

## 2026-10-08 — A10 Local Browser E2E: Closure

**Status:** **PASS / CLOSED (LOCAL)**

**Browser validation**
- Local application:
  `http://localhost:8787`
- Browser hard refresh performed after search-engine changes.
- Search UI rendered normally with no visible application error.

**Validated cases**
- `σινεμα`
  - **21 results**
  - all 21 displayed
  - strict official `Κινηματογράφος - Θέατρο` category behavior
- `ειδικηαγωγη`
  - concatenated-query recognition validated
  - load-more behavior initially validated: 40 -> 115
  - browser validation exposed broad long-tail semantic results
  - root cause confirmed as category-name ambiguity, not concatenated-query regression
- `ειδικη αγωγη`
  - official category has **22 active members**
  - exact full-category resolution added generically
- final `ειδικηαγωγη`
  - **22 results**
  - all 22 displayed
  - exactly the active official `Ειδική Αγωγή` members
  - no unrelated extra programs
- ambiguous single terms `ειδικη` / `αγωγη` remain unresolved and do not force category intent

**Implementation introduced during A10**
- `resolveCategoryIntent()` now gives precedence to an exact normalized/folded full official category-name match before per-token ambiguity handling.
- `rankAll()` now resolves category intent using `semanticQuery`, allowing concatenated-query canonicalization to participate in official category resolution.
- No global relevance-weight change was introduced.
- No broad cutoff or scoring heuristic was introduced.

**Validation**
- Dedicated exact-category regression: **3/3 PASS**
- Final full repository regression: **240/240 PASS**
- Failures: **0**
- Protected engine baseline intentionally updated after successful validation.

**Current protected engine SHA-256**
- `0be39991ec7faa924b97dbf896c2842dcc368a6e75ef7bda688fc4171f0e0bc4`

**Conclusion**
- v1.5A local browser behavior is validated.
- Search core, category intent, concatenated queries, pagination and official taxonomy behavior are locally ready for release progression.

**Next gate:** **A11 — GitHub**.

## 2026-10-08 — A11 GitHub: Closure

**Status:** **PASS / CLOSED**

- Final v1.5A commit: `3db935d`
- Commit message: `feat(search): complete v1.5A local validation`
- Branch: `main`
- Push to GitHub completed successfully.

## 2026-10-08 — A12 Railway Testing/Staging: Closure

**Status:** **PASS / CLOSED**

- Railway `/health`: HTTP 200
- Catalog: 702 programs / 693 active
- Search engine SHA matched local package.
- Railway runtime lexicon initially differed from packaged `public/lexicon.json`.
- Root cause: persisted `DATA_DIR=/data` lexicon from Railway volume intentionally survived redeploy.
- Backup created: `/data/lexicon.json.bak-2026-10-08-a12`
- Persisted lexicon synchronized with packaged lexicon.
- Final packaged/persisted SHA-256:
  `d11812e62220e3dbf9ed9a78a5ec4e3be89a48e9a71087f25c54e5591283b9aa`
- Service restarted and final Railway smoke test PASS:
  - `σινεμα` → 21
  - `Τρίτη ηλικία` → 6
  - `HRM` → 38
  - `ειδικός απορριμάτων` → 1
  - `ειδικηαγωγη` → 22

**Next gate:** **A13 — testing.elearningekpa.gr / GTM Browser Validation**.

## 2026-10-08 — A13 testing.elearningekpa.gr / GTM Browser Validation: Closure

**Status:** **PASS / CLOSED**

- Validation performed through GTM Preview on `testing.elearningekpa.gr`.
- Testing used the validated Railway backend.
- Final browser validation:
  - `σινεμα` → 21
  - `Τρίτη ηλικία` → 6
  - `HRM` → 38
  - `ειδικός απορριμάτων` → 1
  - `ειδικηαγωγη` → 22
- Results matched the validated Local and Railway behavior.
- No GTM production publish was performed.
- Testing environment remains the testing area; production deployment is delegated to EKPA IT.

**Next gate:** **A14 — Documentation / IT Handoff**.

## 2026-10-09 — v1.5A Release Hardening / Final Validation

**Status:** **PASS / CLOSED before IT packaging**

Post-validation corrections completed after the original A11–A13 closure:

- Search collision hardening committed as `668d38c`:
  `fix(search): prevent substring collision leaks in expanded intents`.
- Live Railway validation after the search fix:
  - `άνοια` → 4 relevant results.
  - `Τρίτη ηλικία` → 5 relevant results.
  - prior unrelated substring leakage removed.
- IPSAS / ASEP catalog correction committed as `b6931f3`:
  `fix(catalog): remove incorrect ASEP tag from IPSAS program`.
- Railway persisted catalog issue identified:
  `/data/programs.json` was overriding the corrected packaged `public/programs.json`.
- Backup created before synchronization:
  `/data/programs.json.bak-asep-2026-10-09`.
- Corrected catalog synchronized to Railway persistent `/data/programs.json`.
- Live verification after restart:
  - IPSAS `ασεπ` in `tags`: false.
  - IPSAS `ασεπ` in `search_text`: false.
  - `ΑΣΕΠ` total results: 34.
  - IPSAS moved from rank 1 to rank 34.
- Final local regression after all current code/catalog corrections:
  **240/240 PASS, 0 failures**.
- Canonical release commits now include:
  - `3db935d` — v1.5A local validation.
  - `668d38c` — expanded-intent collision hardening.
  - `b6931f3` — IPSAS / ASEP catalog correction.
  - current documentation release commit — final ledger / IT handoff preparation.

**Release rule for EKPA IT:** an existing persistent `DATA_DIR` must be checked during deployment. An older `/data/programs.json` must not silently override the corrected packaged catalog.

**Next gate:** creation and integrity validation of the new EKPA IT handoff package.
