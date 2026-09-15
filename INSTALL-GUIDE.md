# EKPA Smart Finder — Installation Package

**Ημερομηνία πακέτου:** 15 Σεπτεμβρίου 2026 (v4 — δες `HANDOVER-NOTES.md` → "Αλλαγές v4")
**Κατάσταση:** ✅ Production-ready, live, δοκιμασμένο end-to-end
**Παραδίδεται σε:** ΙΤ τμήμα ΕΚΠΑ, για μεταφορά σε δικό τους server

---

## 📦 Περιεχόμενα αυτού του φακέλου

```
├── INSTALL-GUIDE.md        (αυτό το αρχείο — ξεκίνα από εδώ)
├── ARCHITECTURE.md         (πώς κουμπώνουν όλα μαζί, με διάγραμμα)
├── DEPLOY-SelfHosted.md    (πλήρης οδηγία εγκατάστασης σε δικό σας Linux server)
├── DEPLOY-Railway.md       (εναλλακτικό: αν προτιμήσετε να συνεχίσετε με Railway)
├── API-KEY-SETUP.md        (πώς αποκτάτε το δικό σας Anthropic API key)
├── ADMIN-PANEL-GUIDE.md    (πώς διαχειρίζεστε το taxonomy χωρίς redeploy)
├── GTMREADME.md            (GTM & GA4 setup — tracking widget)
├── HANDOVER-NOTES.md       (τρέχουσα κατάσταση, ανοιχτά θέματα, επικοινωνία)
├── ekpa-search-widget-gtm-v2.js   (το GTM Custom HTML tag — copy-paste ready)
└── search-ekpa/            (πλήρης πηγαίος κώδικας backend, Node.js/Express)
    ├── server/server.js
    ├── public/ (index.html, admin-taxonomy.html, programs.json, concepts.json, search-engine.js)
    ├── package.json
    ├── .env.example
    └── README.md            (τεχνική τεκμηρίωση backend)
```

---

## 🚀 Γρήγορο ξεκίνημα (5 λεπτά, τοπικό τεστ)

```bash
cd search-ekpa
npm install
cp .env.example .env
nano .env   # βάλε το ANTHROPIC_API_KEY σου — δες API-KEY-SETUP.md
node server/server.js
```
Άνοιξε `http://localhost:8787` — αναζήτηση + floating 💬 chat widget.
Άνοιξε `http://localhost:8787/admin-taxonomy.html` — admin panel (χρειάζεται
`ADMIN_TOKEN` στο `.env`, δες `ADMIN-PANEL-GUIDE.md`).

## 🏗️ Πραγματική εγκατάσταση (production)

Διάβασε **`DEPLOY-SelfHosted.md`** για πλήρη οδηγό: Node.js setup, pm2/systemd
process manager, nginx reverse proxy, HTTPS με Let's Encrypt, firewall.

Αν προτιμήσετε προσωρινά να συνεχίσετε στο Railway (πιο γρήγορο ξεκίνημα, όχι
δικός σας server) δες αντ' αυτού `DEPLOY-Railway.md`.

## 🔑 API Key

Χρειάζεστε ένα δικό σας Anthropic API key (ή OpenAI/Gemini). Δες
`API-KEY-SETUP.md` για πλήρη οδηγό απόκτησης + ενδεικτικό κόστος.

## 📊 Tracking (GTM/GA4)

Το search widget στο ίδιο το elearningekpa.gr τρέχει ξεχωριστά, μέσω Google Tag
Manager — δες `GTMREADME.md` για setup βήμα-βήμα και `ekpa-search-widget-gtm-v2.js`
για το ίδιο το script.

## ✅ Τι έχει ήδη δοκιμαστεί (7/9 – 15/9/2026)

| Feature | Κατάσταση |
|---|---|
| Instant search (702 προγράμματα) | ✅ ~5-50ms ανά αναζήτηση, και στο `/api/search` (v4) |
| Floating 💬 AI βοηθός | ✅ Retrieval-augmented, plain-text απαντήσεις με clickable links |
| CORS whitelist | ✅ Μπλοκάρει άγνωστα origins (403) |
| Rate limiting | ✅ chat 20/min, search 120/min, admin 10/min ανά IP |
| Όρια μεγέθους chat | ✅ μήνυμα 700 χαρ., ιστορικό 10 μην./8.000 χαρ., αίτημα 64KB (v4) |
| Μόνιμα δεδομένα (`DATA_DIR`) | ✅ taxonomy/analytics επιβιώνουν σε redeploy & `git pull` (v4) |
| Σύντομα queries (ai/hr/it) | ✅ δεν ταιριάζουν πια σε όλο τον κατάλογο (v4) |
| Admin panel (taxonomy) | ✅ CRUD χωρίς redeploy, fail-closed χωρίς token |
| Query-length cap | ✅ 700 χαρακτήρες (CPU-DoS protection) |
| GTM widget + GA4 events | ✅ search, search_no_results, select_content |
| Search performance | ✅ Διορθώθηκε σοβαρό lag (βλ. HANDOVER-NOTES.md) |
| Analytics (search/click visibility) | ✅ Φάση 1 — νέο tab στο admin panel, δεν επηρεάζει ranking ακόμα |
| Search relevance (false-positive fixes) | ✅ 3 bugs βρέθηκαν+διορθώθηκαν μέσω συστηματικής σάρωσης — βλ. HANDOVER-NOTES.md |
| Tags enrichment | ✅ Αυτόματος εμπλουτισμός από concepts.json (τίτλος+κατηγορία μόνο) |

## 📖 Σειρά ανάγνωσης

Δες **`HANDOVER-NOTES.md` → "Σειρά ανάγνωσης για νέο μέλος ομάδας IT"** για τη
προτεινόμενη σειρά μελέτης αυτών των εγγράφων.

## 🆘 Κάτι δεν δουλεύει;

1. `curl http://localhost:PORT/health` → πρέπει `{"ok":true,"programs":702}`
2. Έλεγξε τα `pm2 logs` (ή `journalctl -u ekpa-smart-finder` αν systemd)
3. Έλεγξε ότι το `.env` έχει σωστές τιμές (ειδικά `ANTHROPIC_API_KEY`,
   `ALLOWED_ORIGINS`)
4. Browser DevTools → Console/Network για σφάλματα frontend
