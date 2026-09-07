# Deploy στο Railway

Αυτό το backend είναι ήδη deployed μέσω Railway (`*.up.railway.app`), οπότε αυτός ο
οδηγός καλύπτει το πραγματικό workflow — setup από την αρχή, πώς ενημερώνεις τα env
vars χωρίς redeploy, και τι να ελέγξεις μετά από κάθε deploy.

---

## 1) Πρώτο deploy

**Επιλογή Α — από GitHub repo (προτεινόμενο):**
1. Push τον κώδικα (χωρίς `.env`, χωρίς `node_modules/` — τα καλύπτει το `.gitignore`).
2. Railway dashboard → **New Project** → **Deploy from GitHub repo** → επίλεξε το repo.
3. Το Railway ανιχνεύει αυτόματα Node.js (βλέπει το `package.json`) και τρέχει
   `npm install` + `npm start`.

**Επιλογή Β — από το CLI, χωρίς GitHub:**
```bash
npm install -g @railway/cli
railway login
cd finder-backend
railway init
railway up
```

---

## 2) Environment variables (Variables tab)

Στο service σου → **Variables** tab, πρόσθεσε (ίδια ονόματα με το `.env.example`):

| Variable | Τιμή |
|---|---|
| `LLM_PROVIDER` | `anthropic` (ή `openai` / `gemini`) |
| `ANTHROPIC_API_KEY` | το key σου (μόνο για τον provider που διάλεξες) |
| `ALLOWED_ORIGINS` | `https://elearningekpa.gr,https://www.elearningekpa.gr` |
| `CHAT_RATE_LIMIT_PER_MIN` | `20` (προαιρετικό, αυτό είναι το default) |
| `SEARCH_RATE_LIMIT_PER_MIN` | `120` (προαιρετικό) |

**Μην ορίσεις `PORT`** — το Railway το θέτει μόνο του, και ο `server.js` το διαβάζει
ήδη από `process.env.PORT`.

Αλλαγή μιας μεταβλητής **δεν χρειάζεται νέο deploy** — το Railway κάνει απλά restart
του container με τις νέες τιμές. Χρήσιμο όταν θες να προσθέσεις γρήγορα ένα νέο
επιτρεπόμενο domain στο `ALLOWED_ORIGINS` χωρίς να αγγίξεις κώδικα.

---

## 3) Public URL

**Settings → Networking → Generate Domain** δίνει ένα URL τύπου
`https://nodejs-production-xxxx.up.railway.app` — αυτό είναι το `BACKEND_URL` που
μπαίνει στο widget.

Αν θες δικό σου subdomain (π.χ. `search-api.elearningekpa.gr`):
1. **Settings → Networking → Custom Domain** → πρόσθεσε το subdomain.
2. Το Railway δίνει ένα CNAME target — πρόσθεσέ το στο DNS του domain σου.
3. HTTPS γίνεται αυτόματα provision (Railway το αναλαμβάνει, δεν χρειάζεται
   certbot/nginx όπως σε VPS).
4. Πρόσθεσε ΚΑΙ αυτό το domain στο `ALLOWED_ORIGINS` αν το widget θα καλεί απευθείας
   αυτό το URL.

---

## 4) Healthcheck

**Settings → Deploy → Healthcheck Path**: βάλε `/health`.
Το `server.js` εκθέτει `GET /health` → `{"ok":true,"programs":702}`. Έτσι το Railway
ξέρει πότε το container είναι πραγματικά έτοιμο πριν στείλει traffic σε νέο deploy
(zero-downtime deploys), και θα κάνει restart αν ο server κολλήσει.

---

## 5) Ενημέρωσε το widget

Στο `ekpa-search-widget-gtm-v2.js` (μέσα στο GTM Custom HTML tag):
```js
var BACKEND_URL = "https://το-railway-url-σου.up.railway.app";
```
ή το custom domain σου αν έκανες βήμα 3.

---

## 6) Επιβεβαίωση μετά από κάθε deploy

```bash
curl "https://το-url/health"
# -> {"ok":true,"programs":702}

curl "https://το-url/api/search?q=ai"
# -> JSON λίστα με προγράμματα

# Το CORS πρέπει να ΜΠΛΟΚΑΡΕΙ άγνωστα origins:
curl -i -H "Origin: https://evil-example.com" "https://το-url/api/search?q=ai"
# -> HTTP/1.1 403 Forbidden
```

## Checklist πριν πεις "έτοιμο"
- [ ] `curl https://το-url/health` επιστρέφει `{"ok":true,...}`
- [ ] `curl https://το-url/api/search?q=ai` επιστρέφει αποτελέσματα
- [ ] Request με άγνωστο `Origin` header γυρνάει 403 (CORS ενεργό, όχι ανοιχτό σε όλους)
- [ ] Variables tab έχει το σωστό API key (και ΔΕΝ υπάρχει `.env` commit-αρισμένο σε git)
- [ ] Healthcheck Path = `/health` στο Railway
- [ ] `BACKEND_URL` στο `ekpa-search-widget-gtm-v2.js` δείχνει στο σωστό Railway/custom URL

---

## Εναλλακτικά: self-hosted VPS

Αν κάποια στιγμή αποφασίσετε να φύγετε από Railway προς δικό σας VPS (π.χ. λόγω
πολιτικής δημόσιου φορέα για self-hosting), τα βήματα Node.js + pm2 + nginx +
certbot παραμένουν ίδια με ένα τυπικό Express deploy — ζήτησέ τα αν χρειαστούν, δεν
τα συμπεριλαμβάνω εδώ για να μη μπερδεύουν το βασικό (Railway) workflow που όντως
χρησιμοποιείτε τώρα.
