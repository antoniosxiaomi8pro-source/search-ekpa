# EKPA Smart Finder — GTM & GA4 Setup

**Author:** Antonis Papachrisanthou
**Αρχείο widget:** `ekpa-search-widget-gtm-v2.js`
**GA4 property:** Elearning - GA4 (`G-ZL8304SEHG`)
**GTM container:** `GTM-TZJNFCW`

---

## 1. Τι κάνει αυτό το widget

Το `ekpa-search-widget-gtm-v2.js` τρέχει μέσα στο **elearningekpa.gr** ως ένα GTM
**Custom HTML tag**. Πιάνει το υπάρχον search input του site (`#qHeroFront`),
καλεί το backend του EKPA Smart Finder (`/api/search`) για live αποτελέσματα, και
καταγράφει GA4 events για κάθε αναζήτηση και κάθε κλικ πάνω σε αποτέλεσμα.

```
elearningekpa.gr (PHP CMS)
   └── GTM Custom HTML tag → ekpa-search-widget-gtm-v2.js
                                  │
                                  ├── GET {{EKPA Backend URL}}/api/search?q=...
                                  │
                                  └── gtag("event", ...) → GA4 (G-ZL8304SEHG)
```

Δεν χρειάζεται να αγγίξεις τον κώδικα του site — όλα τρέχουν μέσα από το GTM.

---

## 2. Βήμα 1: GTM Variable για το backend URL

Το widget **δεν** έχει πια hardcoded το Railway URL μέσα στον κώδικα — το διαβάζει
από ένα GTM Variable, ώστε να μπορεί να αλλάξει (π.χ. Railway → δικός σας server
στο μέλλον) χωρίς να ξαναπειράξεις καθόλου το script.

**Στο GTM dashboard:**

1. **Variables** → **New** → Variable Configuration → **Constant**
2. Όνομα: `EKPA Backend URL`
3. Τιμή: `https://nodejs-production-5371.up.railway.app` (**χωρίς** `/` στο τέλος)
4. **Save**

> ⚠️ **Στο μέλλον, όταν αλλάξει ο server:** πας μόνο σε αυτό το Variable, αλλάζεις
> την τιμή, **Publish** — τίποτα άλλο δεν χρειάζεται αλλαγή, ούτε στο script ούτε
> στο site.

---

## 3. Βήμα 2: Ανέβασμα του widget στο Custom HTML tag

1. GTM → **Tags** → βρες (ή δημιούργησε) το Custom HTML tag για το search widget
2. Επικόλλησε μέσα ολόκληρο το περιεχόμενο του `ekpa-search-widget-gtm-v2.js`,
   τυλιγμένο σε `<script>...</script>` (το GTM Custom HTML tag θέλει HTML, όχι raw JS)
3. Trigger: **All Pages** (ή συγκεκριμένο trigger αν το search box υπάρχει μόνο σε
   ορισμένες σελίδες)
4. **Save** → **Submit** → **Publish**

**Επιβεβαίωση ότι δουλεύει:** GTM → **Preview** mode, άνοιξε το site, δες στο
tag assistant ότι το Custom HTML tag πυροδοτήθηκε χωρίς σφάλματα στο Console.

---

## 4. Βήμα 3: Custom Dimensions στο GA4

Το widget στέλνει custom event parameters που το GA4 **δεν** δείχνει αυτόματα σε
τυπικά reports/explorations μέχρι να τα καταχωρήσεις ρητά ως Custom Dimensions.
(Θα τα βλέπεις ήδη στο DebugView/Realtime χωρίς αυτό το βήμα — απλά όχι σε
ιστορικά reports/tables.)

**Στο GA4 dashboard:**

Admin (κάτω αριστερά, γρανάζι) → στήλη **Property** → **Custom definitions** →
**Custom dimensions** → **Create custom dimension**

**Dimension #1:**
| Πεδίο | Τιμή |
|---|---|
| Dimension name | `Search term` |
| Scope | `Event` |
| Event parameter | `search_term` |

**Dimension #2:**
| Πεδίο | Τιμή |
|---|---|
| Dimension name | `Clicked program title` |
| Scope | `Event` |
| Event parameter | `content_id` |

> ℹ️ Τα `content_type` και `item_id` (μέσα στο `select_content` event) **δεν**
> χρειάζονται custom dimension — είναι standard parameters ενός GA4 recommended
> event και αναγνωρίζονται ήδη αυτόματα.

> ⏳ Οι νέες custom dimensions ισχύουν **μόνο για δεδομένα από εδώ και πέρα** —
> δεν εμφανίζουν αναδρομικά ιστορικά events. Δώσε 24–48 ώρες μετά τη δημιουργία
> πριν εμφανιστούν καθαρά σε reports.

---

## 5. ⚠️ Εκκρεμής απόφαση: όνομα του "search" event

Αυτό είναι το **μόνο σημείο που χρειάζεται δική σου απόφαση** πριν κλειδώσει η
τεκμηρίωση — δεν το άλλαξα ακόμα στον κώδικα.

Το GA4 έχει ένα **built-in recommended event** που λέγεται `view_search_results`
(όχι `search`). Αν το widget έστελνε το event με αυτό το όνομα, θα έπαιρνες
**αυτόματα** το έτοιμο GA4 report "Search terms" χωρίς κανένα επιπλέον setup.

| Επιλογή | Πλεονέκτημα | Μειονέκτημα |
|---|---|---|
| **Α) Μετονομασία σε `view_search_results`** | Αυτόματο, έτοιμο GA4 report "Search terms" | Ελαφρώς ανακριβές σημασιολογικά — πυροδοτείται σε κάθε keystroke (debounced), όχι μόνο όταν ο χρήστης βλέπει πραγματικά μια σελίδα αποτελεσμάτων |
| **Β) Παραμονή στο `search`** (τρέχουσα κατάσταση) | Πιο ακριβές ως προς το τι πραγματικά συμβαίνει (live-search input, όχι πλοήγηση σε σελίδα) | Χρειάζεται το custom dimension `Search term` (βλ. Βήμα 4) για να φανεί οπουδήποτε πέρα από DebugView |

**Πρόταση:** Β) — κράτα το `search` όπως είναι, μια που το custom dimension
`Search term` το καλύπτει πλήρως. Αν αλλάξεις γνώμη αργότερα, η αλλαγή γίνεται σε
μία γραμμή μέσα στο widget (`ga4("search", ...)` → `ga4("view_search_results", ...)`).

---

## 6. Reference: όλα τα events που στέλνει το widget

| Event name | Πότε πυροδοτείται | Parameters |
|---|---|---|
| `search` | Ο χρήστης σταματά να πληκτρολογεί (debounce 600ms) ή κάνει submit, με νέο (όχι επαναλαμβανόμενο) query | `search_term` |
| `search_no_results` | Μια αναζήτηση επιστρέφει 0 αποτελέσματα | `search_term` |
| `select_content` | Ο χρήστης κάνει κλικ σε ένα αποτέλεσμα | `content_type` (πάντα `"course"`), `item_id` (slug/url), `content_id` (τίτλος), `search_term` |

Και τα τρία events στέλνονται με `send_to: G-ZL8304SEHG`, ώστε να πηγαίνουν
συγκεκριμένα σε αυτό το property ακόμα κι αν το GTM container στέλνει σε
περισσότερα από ένα GA4 properties. Το `search_no_results` στέλνεται μία φορά ανά
query, και **όχι** όταν απλώς απέτυχε το δίκτυο.

### 6.1 Αν το site ΔΕΝ έχει `gtag()` (GA4 μόνο μέσα από GTM)

Το widget ελέγχει αν υπάρχει `window.gtag`. Αν το GA4 είναι ρυθμισμένο **μόνο** ως
Google Tag μέσα στο GTM, η `gtag()` συνήθως δεν υπάρχει στη σελίδα — στη v3 τα events
χάνονταν σιωπηλά. Από τη v4 μπαίνουν στο `dataLayer` ως:

| dataLayer `event` | Parameters |
|---|---|
| `ekpa_search` | `search_term` |
| `ekpa_search_no_results` | `search_term` |
| `ekpa_select_content` | `content_type`, `item_id`, `content_id`, `search_term` |

**Έλεγχος:** GTM Preview → πληκτρολόγησε στο search box. Αν στο Tag Assistant βλέπεις
events `ekpa_search` κ.λπ., τότε η `gtag()` λείπει και χρειάζεται (μία φορά):
1. **Triggers → New → Custom Event**, Event name: `ekpa_(search|search_no_results|select_content)`, ✔ Use regex matching
2. **Variables → New → Data Layer Variable** για κάθε parameter (`search_term`, `content_type`, `item_id`, `content_id`)
3. **Tags → New → Google Analytics: GA4 Event** — τρία tags, ένα ανά event:
   Measurement ID `G-ZL8304SEHG`, Event name `search` / `search_no_results` /
   `select_content`, Event parameters από τα παραπάνω Data Layer Variables, και
   trigger ένα Custom Event με το αντίστοιχο όνομα (`ekpa_search` κ.λπ.).
   (Στο βήμα 1 φτιάξε τότε τρία triggers αντί για ένα regex.)

Αν αντίθετα βλέπεις τα events κατευθείαν στο GA4 DebugView, η `gtag()` υπάρχει και
δεν χρειάζεται τίποτα από τα παραπάνω.

---

## 7. Πώς να δεις τα "0 αποτελέσματα" queries (zero-result searches)

Αυτό απαντάει άμεσα στο ερώτημα "ποιες αναζητήσεις δεν έφεραν τίποτα":

1. GA4 → **Explore** → **Free form** (νέο exploration)
2. Dimension: `Search term` (το custom dimension από το Βήμα 4)
3. Metric: `Event count`
4. Filter: `Event name` **exactly matches** `search_no_results`
5. Rows: `Search term`

Αυτό σου δίνει λίστα με ό,τι έψαξαν οι χρήστες που δεν βρέθηκε τίποτα —
πολύτιμο για να δεις τι λείπει από το taxonomy/tags (βλ. `admin-taxonomy.html`).

---

## 8. Πώς να δεις ποιο πρόγραμμα κλικάρεται περισσότερο (most-clicked programs)

Ίδιο pattern με το report του §7, μόνο αλλάζει το filter:

1. GA4 → **Explore** → **Free form** (νέο exploration)
2. Dimension: `Clicked program title` (το custom dimension από το Βήμα 4)
3. Metric: `Event count`
4. Filter: `Event name` **exactly matches** `select_content`
5. Rows: `Clicked program title`
6. Ταξινόμηση φθίνουσα στο Event count (κλικ πάνω στη στήλη μετρικής)

Αυτό δίνει άμεση κατάταξη: ποιο πρόγραμμα κλικάρεται πιο συχνά, δεύτερο, τρίτο,
κ.λπ., σε όποιο εύρος ημερομηνιών θες — **χωρίς να χρειάζεται κανένα δικό μας
storage ή αλλαγή στο ranking algorithm.** Αυτό δουλεύει μόνο αν έχεις ήδη κάνει
Publish το ενημερωμένο widget και έχει μαζευτεί πραγματική κίνηση.

> 📌 **Roadmap (σε εκκρεμότητα):** Το επόμενο βήμα θα ήταν να χρησιμοποιήσουμε
> αυτά τα click-δεδομένα ώστε να επηρεάζουν *αυτόματα* το ranking του
> `/api/search` (π.χ. ένα μικρό, log-scaled, capped "popularity boost" ανά
> πρόγραμμα). Αυτό απαιτεί δικό μας μηχανισμό αποθήκευσης clicks στο backend
> (το GA4 δεν μπορεί να τροφοδοτήσει live το scoring), και η επιλογή storage
> (Railway Persistent Volume vs. μικρή DB vs. περιοδική άντληση από GA4) είναι
> ακόμα ανοιχτή. Μέχρι τότε, το exploration report παραπάνω αρκεί για να βλέπεις
> τη δημοτικότητα χειροκίνητα.

---

## 9. Ασφάλεια — τι ελέγξαμε

- Το widget κάνει GET στο `/api/search` και ένα POST στο `/api/track-click` όταν
  γίνει κλικ (μόνο query + slug προγράμματος, κανένα προσωπικό δεδομένο)
- Escaping (`esc()`) σε όλα τα πεδία (title, url, image_url) πριν μπουν σε
  `innerHTML` — προστασία από XSS μέσω κακόβουλων δεδομένων προγράμματος
- Το GA4 Measurement ID (`G-ZL8304SEHG`) είναι δημόσιο by design — εμφανίζεται
  ούτως ή άλλως στο Network tab κάθε site που έχει GA4, δεν είναι μυστικό
- Καμία σχέση με το `ADMIN_TOKEN` του backend (αυτό προστατεύει το
  `/api/admin/concepts` — τελείως ξεχωριστό ζήτημα από αυτό το widget)

---

## 10. Checklist πριν το Publish

- [ ] GTM Variable `EKPA Backend URL` δημιουργήθηκε με το σωστό Railway URL
- [ ] Custom HTML tag ενημερώθηκε με το τελευταίο περιεχόμενο του
      `ekpa-search-widget-gtm-v2.js`
- [ ] Preview mode: το tag πυροδοτείται χωρίς console errors
- [ ] GA4 DebugView: βλέπεις τα events `search` / `select_content` /
      `search_no_results` να φτάνουν σωστά όταν δοκιμάζεις live
      (αν όχι, και στο Tag Assistant εμφανίζονται `ekpa_*` events → δες §6.1)
- [ ] Custom dimensions `Search term` και `Clicked program title` δημιουργήθηκαν
      στο GA4
- [ ] Απόφαση για `search` vs `view_search_results` (βλ. §5) — τρέχουσα
      προεπιλογή: παραμονή σε `search`
- [ ] Publish στο GTM
