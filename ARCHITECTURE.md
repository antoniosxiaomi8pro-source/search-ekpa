# Αρχιτεκτονική — EKPA Smart Finder

## Επισκόπηση

```
                          ┌─────────────────────────────┐
                          │   elearningekpa.gr (PHP CMS) │
                          │   ο πραγματικός ιστότοπος    │
                          └───────────────┬──────────────┘
                                          │ Google Tag Manager
                                          │ (Custom HTML tag)
                                          ▼
                          ┌─────────────────────────────┐
                          │ ekpa-search-widget-gtm-v2.js │
                          │  · πιάνει #qHeroFront input  │
                          │  · GET /api/search live      │
                          │  · στέλνει GA4 events        │
                          └───────────────┬──────────────┘
                                          │ HTTPS
                                          ▼
                    ┌───────────────────────────────────────┐
                    │   Backend (Node.js / Express)          │
                    │   αυτό το repo                         │
                    │                                         │
                    │   GET  /api/search    (δωρεάν, ~5-50ms)│
                    │   GET  /api/programs  (πλήρης κατάλογος)│
                    │   POST /api/chat      (καλεί LLM)      │
                    │   POST /api/track-search, /track-click │
                    │   POST /api/admin/concepts (protected) │
                    │   GET  /api/admin/analytics (protected)│
                    │   GET  /health                         │
                    │                                         │
                    │   Στη μνήμη: programs.json (702),      │
                    │   concepts.json (60 taxonomy entries)  │
                    │   Στο DATA_DIR: concepts.json (live),  │
                    │   analytics.json                       │
                    └───────────────┬─────────────────────────┘
                                    │ HTTPS (μόνο για /api/chat)
                                    ▼
                    ┌───────────────────────────────────────┐
                    │   Anthropic API (ή OpenAI/Gemini)      │
                    │   claude-sonnet-4-6                    │
                    └───────────────────────────────────────┘

    Ξεχωριστό, δεν επικοινωνεί με το backend:
    ┌───────────────────────────────────────┐
    │   GA4 property (G-ZL8304SEHG)          │
    │   δέχεται events απευθείας από τον     │
    │   browser του χρήστη (μέσω gtag.js)    │
    └───────────────────────────────────────┘
```

## Γιατί έτσι (βασικές αποφάσεις σχεδίασης)

**Το widget δεν είναι μέρος του PHP site.** Τρέχει εξ ολοκλήρου μέσα από ένα GTM
Custom HTML tag. Αυτό σημαίνει ότι το ΙΤ μπορεί να ενημερώσει/απενεργοποιήσει το
search widget χωρίς να αγγίξει καθόλου τον κώδικα του CMS — μόνο μέσα από το GTM
dashboard.

**Το backend URL δεν είναι hardcoded στο widget.** Διαβάζεται από ένα GTM Variable
(`EKPA Backend URL`). Αν αλλάξει ο host του backend (π.χ. από Railway σε δικό σας
server), αλλάζεις μόνο αυτή τη μία τιμή στο GTM — τίποτα άλλο.

**Το `/api/chat` δεν εκθέτει ποτέ το API key στον browser.** Ο browser καλεί το
δικό μας `/api/chat`, το backend κάνει τη δική του κλήση στο Anthropic API με το
key που έχει μόνο αυτό (env var). Χωρίς αυτό το proxy layer, οποιοσδήποτε θα
μπορούσε να δει το key στο Network tab και να το χρησιμοποιήσει ο ίδιος.

**Το GA4 δεν περνάει από το backend.** Το widget στέλνει events απευθείας στο
Google Analytics (gtag.js ή dataLayer), όχι μέσω του δικού μας server. Παράλληλα, το
backend κρατάει **δικά του**, απλά στατιστικά (ποιες αναζητήσεις γίνονται, ποιες
φέρνουν 0 αποτελέσματα, ποια προγράμματα κλικάρονται) στο `analytics.json` — χωρίς
προσωπικά δεδομένα, μόνο κείμενο αναζήτησης και μετρητές — ορατά στο admin panel.

**Μία μηχανή αναζήτησης, ένα αρχείο.** Το `public/search-engine.js` φορτώνεται ΚΑΙ
από τον server (require) ΚΑΙ από το `index.html` (`<script src>`). Δεν υπάρχει δεύτερο
αντίγραφο της λογικής scoring. Τα δεδομένα κάθε προγράμματος (normalized κείμενο,
tokens) υπολογίζονται μία φορά και μένουν στη μνήμη.

**Τα προγράμματα αναγνωρίζονται με το `slug`.** Περίπου το 1/3 του καταλόγου έχει
`id: null` στο export, ενώ το `slug` υπάρχει πάντα και είναι μοναδικό — γι' αυτό το
click tracking χρησιμοποιεί slug.

**Τα δεδομένα (`programs.json`, `concepts.json`) ζουν μέσα στο repo, όχι σε
database.** Για 702 προγράμματα αυτό είναι αρκετό — φορτώνονται μία φορά στη
μνήμη στο εκκίνημα του server. Ό,τι αλλάζει στη λειτουργία (taxonomy από το admin,
analytics) γράφεται στο `DATA_DIR`, εκτός κώδικα, ώστε να επιβιώνει σε redeploy /
`git pull`. Αν στο μέλλον χρειαστεί συχνότερη ενημέρωση
(π.χ. αυτόματο sync από το CMS), θα χρειαστεί επανασχεδιασμός αυτού του κομματιού
— δες `HANDOVER-NOTES.md` για το ανοιχτό αυτό θέμα.

## Ροή μιας τυπικής αναζήτησης

1. Χρήστης πληκτρολογεί στο search box του elearningekpa.gr
2. Το widget κάνει `GET {backend}/api/search?q=...`
3. Ο server σκοράρει τα 702 προγράμματα in-memory (χωρίς database query) και
   επιστρέφει τα top αποτελέσματα
4. Το widget ζωγραφίζει τα αποτελέσματα κάτω από το search box
5. Παράλληλα, το widget στέλνει ένα GA4 `search` event απευθείας στο Google
   (ανεξάρτητο από το backend)

## Ροή μιας ερώτησης στον AI βοηθό

1. Χρήστης γράφει ερώτηση στο floating 💬 widget (μέσα στο ίδιο το backend UI,
   *όχι* στο GTM widget — διαφορετικό interface)
2. `POST /api/chat` με το μήνυμα + ιστορικό συνομιλίας
3. Ο server τρέχει την ίδια μηχανή αναζήτησης εσωτερικά για να βρει τα πιο
   σχετικά προγράμματα (retrieval)
4. Στέλνει αυτά τα προγράμματα + το ερώτημα στο Anthropic API ως context
   (retrieval-augmented generation — το μοντέλο απαντάει ΜΟΝΟ με βάση αυτά τα
   προγράμματα, όχι εφευρίσκοντας)
5. Η απάντηση επιστρέφει στον browser σε απλό κείμενο, με τα URLs να γίνονται
   αυτόματα clickable links στο frontend
