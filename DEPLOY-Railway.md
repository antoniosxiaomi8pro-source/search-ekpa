# Deploy στο Railway

Αυτό το backend είναι ήδη deployed μέσω Railway (`*.up.railway.app`), οπότε αυτός ο
οδηγός καλύπτει το πραγματικό workflow — setup από την αρχή, πώς ενημερώνεις τα env
vars χωρίς redeploy, και τι να ελέγξεις μετά από κάθε deploy.

> Για εγκατάσταση σε δικό σας Linux server (χωρίς Railway) δες `DEPLOY-SelfHosted.md`.

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
cd search-ekpa
railway init
railway up
```

---

## 2) Volume για μόνιμα δεδομένα (ΑΠΑΡΑΙΤΗΤΟ)

Το filesystem ενός Railway container **σβήνεται σε κάθε redeploy**. Χωρίς Volume, σε
κάθε deploy χάνονται:
- οι αλλαγές που έγιναν στο taxonomy από το admin panel (`concepts.json`)
- όλα τα analytics (`analytics.json`)

1. Service → **Settings → Volumes → Add Volume** (ή δεξί κλικ στο service → *Attach Volume*)
2. Mount path: `/data`
3. Στο **Variables** tab: `DATA_DIR=/data`

Στο πρώτο ξεκίνημα με άδειο volume, ο server αντιγράφει αυτόματα το
`public/concepts.json` στο `/data/concepts.json`. Από εκεί και πέρα, το αρχείο στο
volume είναι το "ζωντανό" — ένα νέο deploy του κώδικα **δεν** το αντικαθιστά.

> ℹ️ Αν αλλάξετε το `public/concepts.json` στο git και θέλετε να ισχύσει, πρέπει είτε να
> το περάσετε από το admin panel, είτε να σβήσετε το `/data/concepts.json` ώστε να
> ξαναγίνει αντιγραφή στο επόμενο ξεκίνημα.

---

## 3) Environment variables (Variables tab)

Στο service σου → **Variables** tab, πρόσθεσε (ίδια ονόματα με το `.env.example`):

| Variable | Τιμή |
|---|---|
| `LLM_PROVIDER` | `anthropic` (ή `openai` / `gemini`) |
| `ANTHROPIC_API_KEY` | το key σου (μόνο για τον provider που διάλεξες) |
| `ALLOWED_ORIGINS` | `https://elearningekpa.gr,https://www.elearningekpa.gr` |
| `ADMIN_TOKEN` | μεγάλο τυχαίο string (`openssl rand -hex 24`) — χωρίς αυτό το admin panel είναι κλειδωμένο |
| `DATA_DIR` | `/data` (βλ. §2) |
| `CHAT_RATE_LIMIT_PER_MIN` | `20` (προαιρετικό, αυτό είναι το default) |
| `SEARCH_RATE_LIMIT_PER_MIN` | `120` (προαιρετικό) |

**Μην ορίσεις `PORT`** — το Railway το θέτει μόνο του, και ο `server.js` το διαβάζει
ήδη από `process.env.PORT`.

Το `ALLOWED_ORIGINS` αφορά μόνο **άλλα** sites (π.χ. το GTM widget στο
elearningekpa.gr). Οι σελίδες του ίδιου του backend (`index.html`, admin panel)
επιτρέπονται πάντα αυτόματα.

Αλλαγή μιας μεταβλητής **δεν χρειάζεται νέο deploy** — το Railway κάνει απλά restart
του container με τις νέες τιμές.

---

## 4) Public URL

**Settings → Networking → Generate Domain** δίνει ένα URL τύπου
`https://nodejs-production-xxxx.up.railway.app`.

Αν θες δικό σου subdomain (π.χ. `search-api.elearningekpa.gr`):
1. **Settings → Networking → Custom Domain** → πρόσθεσε το subdomain.
2. Το Railway δίνει ένα CNAME target — πρόσθεσέ το στο DNS του domain σου.
3. HTTPS γίνεται αυτόματα provision (δεν χρειάζεται certbot/nginx όπως σε VPS).

---

## 5) Healthcheck

**Settings → Deploy → Healthcheck Path**: βάλε `/health`.
Το `server.js` εκθέτει `GET /health` → `{"ok":true,"programs":702}`.

---

## 6) Ενημέρωσε το widget

Το URL του backend **δεν** μπαίνει μέσα στο script — ορίζεται στο GTM Variable
`EKPA Backend URL` (βλ. `GTMREADME.md` §2). Αν άλλαξε το URL: άλλαξε μόνο την τιμή
του Variable → **Publish**.

---

## 7) Επιβεβαίωση μετά από κάθε deploy

```bash
curl "https://το-url/health"
# -> {"ok":true,"programs":702}

curl "https://το-url/api/search?q=ai"
# -> JSON λίστα με προγράμματα (απάντηση σε λίγα ms, όχι δευτερόλεπτα)

# Το CORS πρέπει να ΜΠΛΟΚΑΡΕΙ άγνωστα origins:
curl -i -H "Origin: https://evil-example.com" "https://το-url/api/search?q=ai"
# -> HTTP/1.1 403 Forbidden
```

Στα logs του deploy πρέπει να δεις τη γραμμή
`Data: concepts=/data/concepts.json analytics=/data/analytics.json`.
Αν γράφει `public/concepts.json` → το `DATA_DIR` δεν έχει οριστεί.

## Checklist πριν πεις "έτοιμο"
- [ ] `curl https://το-url/health` επιστρέφει `{"ok":true,...}`
- [ ] `curl https://το-url/api/search?q=ai` επιστρέφει αποτελέσματα
- [ ] Request με άγνωστο `Origin` header γυρνάει 403
- [ ] Volume mounted στο `/data` και `DATA_DIR=/data` (βλ. log γραμμή `Data:`)
- [ ] `ADMIN_TOKEN` ορισμένο
- [ ] Variables tab έχει το σωστό API key (και ΔΕΝ υπάρχει `.env` commit-αρισμένο σε git)
- [ ] Healthcheck Path = `/health`
- [ ] GTM Variable `EKPA Backend URL` δείχνει στο σωστό Railway/custom URL
