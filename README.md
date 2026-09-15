# EKPA Smart Finder — backend-secured AI βοηθός

Το frontend (instant search + AI βοηθός) μιλάει ΜΟΝΟ με το δικό μας backend.
Το backend είναι αυτό που κρατάει το πραγματικό API key (Anthropic / OpenAI / Gemini)
και καλεί τον πάροχο LLM. Ο browser δεν βλέπει, δεν στέλνει και δεν αποθηκεύει ποτέ
το κλειδί.

```
[browser: index.html]  --POST /api/chat-->  [server: server.js]  --API call (με key)-->  [Anthropic/OpenAI/Gemini]
```

## Δομή

```
public/
  index.html         το frontend (instant search + chat UI)
  search-engine.js    η μηχανή αναζήτησης (fixed matching, 60 concepts) — το ΜΟΝΑΔΙΚΟ
                       αντίγραφο: το φορτώνει ο server (require) και το index.html (<script src>)
  programs.json        702 προγράμματα (merged AdWords + Facebook feed)
  concepts.json        60 concepts (ένα ανά επίσημη κατεύθυνση του site)
server/
  server.js            Express backend: /api/chat, /api/search, /api/programs, /concepts.json,
                       /api/track-*, /api/admin/*, /health
.env.example            αντίγραψέ το σε .env και βάλε το δικό σου key (τοπικά μόνο —
                         στο Railway τα ίδια ονόματα μπαίνουν στο Variables tab)
package.json
```

## Εγκατάσταση & εκτέλεση

```bash
npm install
cp .env.example .env
# άνοιξε το .env και βάλε το API key σου (μόνο για τον πάροχο που θα χρησιμοποιήσεις)
npm start
# άνοιξε http://localhost:8787
```

## Μόνιμα δεδομένα (`DATA_DIR`)

Το taxonomy που αλλάζει από το admin panel και τα analytics γράφονται στο `DATA_DIR`
(εκτός κώδικα). Σε production **πρέπει** να οριστεί — δες `DEPLOY-Railway.md` §2 ή
`DEPLOY-SelfHosted.md` §3. Τοπικά μπορεί να μείνει κενό.

## Αλλαγή πάροχου LLM

Στο `.env`, το `LLM_PROVIDER` καθορίζει ποιος καλείται:

```
LLM_PROVIDER=anthropic   # ή openai, ή gemini
ANTHROPIC_API_KEY=sk-ant-...
```

Χρειάζεται μόνο το key του πάροχου που επέλεξες — τα υπόλοιπα μπορούν να μείνουν κενά.

## Γιατί έτσι (και όχι απευθείας κλήση από τον browser)

Μια κλήση από τον browser απευθείας στο LLM API θα σήμαινε ότι το API key πρέπει να
είναι μέσα στον κώδικα της σελίδας — ορατό σε οποιονδήποτε ανοίξει το "View Source".
Με αυτή τη δομή:

- Το key μένει μόνο στο process environment του server (`.env`, στο `.gitignore`).
- Ο browser στέλνει μόνο το ερώτημα του χρήστη· το backend κάνει πρώτα retrieval
  (μέσω `search-engine.js`, πάνω στα 702 πραγματικά προγράμματα) και μετά καλεί το LLM
  με το context — retrieval-augmented, όχι "μαντεψιά" του LLM.
- Μπορείς να αλλάξεις πάροχο (Anthropic/OpenAI/Gemini) χωρίς να αλλάξει καθόλου ο κώδικας
  του frontend.
- Το `/api/chat` και το `/api/search` δέχονται requests μόνο από τα origins στο
  `ALLOWED_ORIGINS` (env var) και έχουν rate limiting (`CHAT_RATE_LIMIT_PER_MIN`,
  `SEARCH_RATE_LIMIT_PER_MIN`) — έτσι δεν μπορεί κάποιος τρίτος να ενσωματώσει το API
  σου σε άλλο site και να καίει το budget του LLM provider.

## Deploy στο Railway

Δες το `DEPLOY-Railway.md` για αναλυτικά βήματα. Πολύ σύντομα:

1. Railway → New Project → Deploy from GitHub repo (ή `railway up` από το CLI).
2. Variables tab: βάλε `LLM_PROVIDER`, το αντίστοιχο API key, και `ALLOWED_ORIGINS`.
   Μην ορίζεις `PORT` — το δίνει το Railway μόνο του.
3. Settings → Networking → Generate Domain (δίνει το `*.up.railway.app` URL) ή
   πρόσθεσε custom domain.
4. Settings → Healthcheck Path: `/health`.
5. Volume στο `/data` + `DATA_DIR=/data`.
6. Ενημέρωσε το GTM Variable `EKPA Backend URL` με το URL από το βήμα 3 (όχι το script).

## Παραγωγή (production)

Για το πραγματικό elearningekpa.gr, αυτό το `server.js` αντιστοιχεί στο "Sync & indexing
service" / "Search API" layer που είχαμε σχεδιάσει αρχιτεκτονικά — θα μπει πίσω από το
PHP CMS ως ξεχωριστό service, με το `programs.json` να ενημερώνεται από το πραγματικό
ETL (merge feeds → canonical records) αντί να είναι στατικό αρχείο.
