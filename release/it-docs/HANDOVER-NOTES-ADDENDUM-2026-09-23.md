# Handover Notes — Addendum (23 Σεπτεμβρίου 2026)

Συνέχεια του `HANDOVER-NOTES.md` (15/9/2026). Αφορά αποκλειστικά το GTM Custom
HTML widget script (`ekpa-search-widget-gtm-v2.js`) — δεν αλλάζει κάτι στο
backend (`server/`) πέρα από το να επιβεβαιώνει ότι το production χρειάζεται
το ήδη-γραμμένο v4 deploy.

**Έκδοση widget στο τέλος αυτής της session: v13.** Περνάει το save-time
format check του GTM editor, περνάει "Validate Container", και δοκιμάστηκε
live στο `testing.elearningekpa.gr` (σωστά αποτελέσματα, σωστό styling).

---

## 1) GTM Custom HTML editor: bug με `{{Variable Name}}` (v9)

**Σύμπτωμα:** κάθε προσπάθεια save του tag έδινε `The value is not properly
formatted.` — ανεξάρτητα από μέγεθος αρχείου, ελληνικά, ή `<`/`>` χαρακτήρες
(όλα δοκιμάστηκαν ξεχωριστά και αποκλείστηκαν με empirical bisection).

**Ρίζα του προβλήματος:** το tag editor's client-side validator απορρίπτει
save όποτε το περιεχόμενο περιέχει αναφορά σε GTM Variable με τη μορφή
διπλού άγκιστρου (`{{Variable Name}}`) — επιβεβαιώθηκε άμεσα: το ίδιο ακριβώς
script περνάει save τη στιγμή που η αναφορά αντικαθίσταται με το literal URL,
και ξαναχτυπάει η ίδια αποτυχία τη στιγμή που ξαναμπαίνει η αναφορά.

**Fix:** το `BACKEND_URL` δεν έρχεται πια από τη GTM Variable `EKPA Backend
URL` — είναι hardcoded μέσα στο ίδιο το script (γραμμή `var BACKEND_URL =
"https://smartfinder.elearningekpa.gr";`).

**Trade-off:** αλλαγή backend URL στο μέλλον = edit αυτής της γραμμής +
re-save του tag, όχι πια edit μόνο της GTM Variable. Δεδομένου ότι η GTM
Variable προσέγγιση δεν μπορεί να γίνει save καθόλου σε αυτό το
account/workspace, δεν υπήρχε άλλη επιλογή.

## 2) GTM "Validate Container": block-scoped function declaration (v10)

Ξεχωριστός έλεγχος από το #1 — ο JS compiler του GTM (ξεχωριστό βήμα,
"Validate Container", όχι το save-time check του editor) απέρριψε το tag με:

> Error at line 131: This language feature is only supported for
> ECMASCRIPT_2015 mode or better: block-scoped function declaration.

Το `styleMenu()` ήταν δηλωμένο ως named `function styleMenu() {...}` μέσα σε
`try {}` block — έγκυρο μόνο από ES2015 και μετά. Ο GTM compiler στοχεύει σε
ES5. Fix: `var styleMenu = function () {...};` αντί για named declaration
(function expression σε var είναι πάντα έγκυρο σε ES5, ανεξάρτητα από πού
βρίσκεται). Καμία αλλαγή συμπεριφοράς.

**Για μελλοντικές αλλαγές στο script:** αποφύγετε named `function foo() {}`
μέσα σε `if`/`for`/`while`/`try` blocks — μόνο top-level (μέσα στο IIFE ή
απευθείας μέσα σε άλλη function) ή ως `var foo = function () {}`.

## 3) Λάθος αρχικό BACKEND_URL μετά το fix του #1 (v11)

Όταν έγινε hardcode το URL (βλ. #1), χρησιμοποιήθηκε αρχικά το URL που ήταν
γραμμένο στο *documentation* του header comment του ίδιου του script
(`https://nodejs-production-5371.up.railway.app` — παλιό production Railway
URL, βλ. `HANDOVER-NOTES.md` "Τρέχον production (Railway...)"), το οποίο
**δεν** είναι το URL που είχε πραγματικά η GTM Variable σε αυτό το workspace.
Αποτέλεσμα: το tag έσωζε κανονικά και έτρεχε, αλλά κάθε αναζήτηση επέστρεφε
"Δεν βρέθηκαν αποτελέσματα" (λάθος backend). Επιβεβαιώθηκε (μέσω
`console.log` στην τιμή που είχε ήδη resolve-άρει η GTM Variable πριν το
fix) ότι το σωστό είναι `https://smartfinder.elearningekpa.gr`. Fix: μία
γραμμή.

## 4) Backend latency — production τρέχει παλιότερη έκδοση από v4

Επιβεβαιώθηκε ζωντανά (browser console, `fetch` στο live `/api/search` με
`fields=compact`): το production backend στο `smartfinder.elearningekpa.gr`
επιστρέφει **όλα** τα πεδία κάθε προγράμματος (`description_full`, `tags`,
`concepts`, `search_text`, ...) αντί για το trimmed compact shape
(`id/slug/title/url/image_url/price`). Δεν υπήρχε καθόλου `Server-Timing`
response header. Και τα δύο υπάρχουν ήδη στο `server/server.js` — άρα το
production backend τρέχει **έκδοση πριν το v4** (πιθανότατα v3, βλ.
`HANDOVER-NOTES.md`), όχι τον τρέχοντα κώδικα αυτού του repo.

Πρακτική συνέπεια: κάθε αναζήτηση από το widget κατεβάζει ~190KB αντί για
~2KB — αυτό είναι η πιο πιθανή αιτία της αισθητής καθυστέρησης που
αναφέρθηκε στο testing. **Χρειάζεται deploy του v4** στο server που
εξυπηρετεί το `smartfinder.elearningekpa.gr` (δες `DEPLOY-SelfHosted.md`,
βήμα 9 αν υπάρχει ήδη git clone εκεί, αλλιώς βήματα 1-8 για πρώτο setup).
Δεν είναι κάτι που διορθώνεται στο widget script.

## 5) Styling: αόρατος τίτλος αποτελέσματος (v12)

Μετά το fix του #3, τα αποτελέσματα εμφανίζονταν (εικόνα + τιμή ορατά) αλλά
ο τίτλος του προγράμματος ήταν αόρατος. Αιτία: το `<div>` του τίτλου δεν
είχε δικό του `color` (σε αντίθεση με το της τιμής, που έχει
`color:#a15c00`) — κληρονομούσε πιθανότατα λευκό/διάφανο χρώμα από το CSS
της σελίδας. Fix: ρητό `color:#17212b` στο title div.

## 6) Styling: κεντραρισμένο κείμενο με μεγάλα κενά (v13)

Η σελίδα έχει ήδη δικό της, προϋπάρχον CSS για τα `.tt-dataset`/
`.tt-suggestion` elements (αυτά είναι στοιχεία που δημιουργεί το ίδιο το
typeahead.js γύρω από κάθε αποτέλεσμά μας, όχι δικά μας) — κεντράρει το
κείμενο και προσθέτει μεγάλο padding/margin. Fix: το `styleMenu()` (ήδη
υπήρχε από το v6 για το `.tt-menu`) τώρα μηδενίζει επιπλέον inline
padding/margin σε κάθε `.tt-dataset`, και επιβάλλει `text-align:left` +
μηδενικό padding/margin σε κάθε `.tt-suggestion`, σε κάθε
`typeahead:render`/`typeahead:open`. Καμία αλλαγή στα δεδομένα, μόνο layout.

---

## Σύνοψη για το IT

1. **Ενημερώστε το GTM Custom HTML tag** (`SmartFinder - TESTING`, μετά
   Production) με το περιεχόμενο του `ekpa-search-widget-gtm-v2.js` (v13) —
   ήδη με `<script>`/`</script>` wrapper μέσα, copy-paste ολόκληρο.
2. **Μην προσπαθήσετε να επαναφέρετε τη GTM Variable `EKPA Backend URL`**
   μέσα στο ίδιο το Custom HTML tag — βλ. §1 παραπάνω, δεν σώζεται. Αν
   αλλάξει ποτέ το backend URL, edit απευθείας τη γραμμή `BACKEND_URL` στο
   script.
3. **Deploy του backend v4** στο server που σερβίρει
   `smartfinder.elearningekpa.gr` (βλ. §4 παραπάνω + `DEPLOY-SelfHosted.md`)
   — αυτό λύνει την αργοπορία στην αναζήτηση.
4. Μετά το deploy, επαληθεύστε: `curl https://smartfinder.elearningekpa.gr/health`
   → `{"ok":true,"programs":702}`, και ότι ένα search response με
   `fields=compact` είναι μικρό (~2KB, όχι ~190KB) και έχει
   `Server-Timing` header.
