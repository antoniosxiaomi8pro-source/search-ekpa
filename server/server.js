// EKPA Smart Finder - backend
//
// The browser NEVER sees an API key. It only talks to this server's /api/chat
// endpoint. This server does the retrieval (same search-engine.js the frontend
// uses for instant search) and then calls whichever LLM provider you configured,
// using a key that lives only in this process's environment variables.
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const EkpaSearch = require("../public/search-engine.js");
const SearchApiContract = require("./search-api-contract.js");
const CatalogSync = require("./catalog-sync.js");
const { isActive } = CatalogSync;
const { CatalogStore } = require("./catalog-store.js");
const RankingDiff = require("./ranking-diff.js");
const { LexiconStore } = require("./lexicon-store.js");
const { previewLexicon } = require("./lexicon-preview.js");

const PUBLIC_DIR = path.join(__dirname, "../public");
// ---- Persistent data directory ----
// Files that CHANGE at runtime (admin taxonomy edits, analytics) must live outside the
// code tree, otherwise:
//  - on Railway they are wiped on every redeploy (container filesystem is ephemeral), and
//  - on a self-hosted server `git pull` conflicts with (or overwrites) the admin's edits.
// Set DATA_DIR to a persistent location (Railway: a mounted Volume, e.g. /data;
// self-hosted: e.g. /var/lib/ekpa-smart-finder). If DATA_DIR is not set, the v3 layout
// is kept (public/concepts.json + server/analytics.json) for backwards compatibility.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;
const SEED_CONCEPTS_PATH = path.join(PUBLIC_DIR, "concepts.json");
const CONCEPTS_PATH = DATA_DIR ? path.join(DATA_DIR, "concepts.json") : SEED_CONCEPTS_PATH;
const ANALYTICS_PATH = DATA_DIR ? path.join(DATA_DIR, "analytics.json") : path.join(__dirname, "analytics.json");
if (DATA_DIR) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONCEPTS_PATH)) {
    // First start with an empty volume: seed the editable taxonomy from the repo copy.
    fs.copyFileSync(SEED_CONCEPTS_PATH, CONCEPTS_PATH);
    console.log(`DATA_DIR: αρχικοποιήθηκε το ${CONCEPTS_PATH} από το public/concepts.json`);
  }
}
let CONCEPTS = JSON.parse(fs.readFileSync(CONCEPTS_PATH, "utf-8"));

// ---- Search lexicon (stopwords, category words, audience, topics) ----
// Same rule as the taxonomy: the package ships a seed (public/lexicon.json), copied to
// DATA_DIR only when DATA_DIR has none, and the live copy is edited by EKPA staff. A broken
// file never stops the server: the engine keeps its built-in tables (server/lexicon-store.js).
const lexiconStore = new LexiconStore({
  seedFile: path.join(PUBLIC_DIR, "lexicon.json"),
  dataDir: DATA_DIR,
  engine: EkpaSearch,
  log: (m) => console.log(m),
});
lexiconStore.load();

// ---- Catalog ----
// Live catalog = the NEWEST check between the package's public/programs.json and the
// admin button's DATA_DIR/programs.json (server/catalog-store.js, B0 §5).
// ALL_PROGRAMS: the full catalog, including programs outside the current cycle
// (status "inactive"). Used only where a hidden program must still be recognised:
// click tracking of old links and the ranking-drift guard (whose fixture was captured
// on the full catalog).
// PROGRAMS: what visitors can find — search, chat, /api/programs. Inactive programs are
// filtered here, BEFORE the search engine, so the validated engine itself is unchanged.
// PROGRAMS_FILE (optional) points at another package catalog - used by the tests.
const PROGRAMS_FILE = process.env.PROGRAMS_FILE
  ? path.resolve(process.env.PROGRAMS_FILE)
  : path.join(PUBLIC_DIR, "programs.json");
const catalogStore = new CatalogStore({ seedFile: PROGRAMS_FILE, dataDir: DATA_DIR, log: (m) => console.log(m) });
// Official category pages of the site (name -> /categories/<slug>), so result cards
// can link EVERY category of a program to a page that exists. The widget used to
// build these URLs itself by transliteration, which gave 404s for 23 of 56
// categories (2026-10-01). Names not on the site (old export names) get no link.
const CATEGORY_URLS = (() => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "categories.json"), "utf-8"));
    return new Map((data.categories || []).map((c) => [c.name, c.url]));
  } catch (e) {
    console.error("categories.json δεν διαβάστηκε - οι κάρτες θα είναι χωρίς links κατηγοριών:", e.message);
    return new Map();
  }
})();
// Primary category first, then the others in catalog order; only categories that
// exist on the site.
function categoryLinks(p) {
  const names = [p.primary_area, ...(Array.isArray(p.areas_of_study) ? p.areas_of_study : [])];
  const seen = new Set();
  const out = [];
  for (const name of names) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const url = CATEGORY_URLS.get(name);
    if (url) out.push({ name, url });
  }
  return out;
}

let ALL_PROGRAMS = [];
let PROGRAMS = [];
let PROGRAMS_BY_KEY = new Map();
// ~1/3 of the original export had `id: null`, so `slug` (always present, unique) is the
// canonical key for click tracking. Numeric ids are still accepted (legacy analytics
// entries / older widget versions), but "null"/"undefined"/"" are always rejected.
function setCatalog(list) {
  ALL_PROGRAMS = list;
  // Visitor-facing copies carry category_links; the stored catalog is not modified.
  PROGRAMS = list.filter(isActive).map((p) => ({ ...p, category_links: categoryLinks(p) }));
  const byKey = new Map();
  list.forEach((p) => { if (p.slug) byKey.set(String(p.slug), p); });
  list.forEach((p) => {
    if (p.id !== null && p.id !== undefined && !byKey.has(String(p.id))) byKey.set(String(p.id), p);
  });
  PROGRAMS_BY_KEY = byKey;
  EkpaSearch.search(PROGRAMS, CONCEPTS, "warmup", 1); // build the index now, not on a visitor's request
}
setCatalog(catalogStore.load());

// Atomic write: write to a temp file in the same directory, then rename. A crash or
// full disk mid-write can never leave a half-written (corrupt) JSON file behind.
function writeFileAtomicSync(filePath, content) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

// ---- Program lookup ----
function resolveProgram(key) {
  const k = String(key == null ? "" : key).trim();
  if (!k || k === "null" || k === "undefined") return null;
  return PROGRAMS_BY_KEY.get(k) || null;
}

// ---- Analytics: search & click visibility (Phase 1 — reporting only, does NOT
// affect /api/search ranking yet; see HANDOVER-NOTES.md for the planned Phase 2). ----
// Stored as a flat JSON file, same pattern as concepts.json — no database needed at
// this scale. Kept in memory for speed, flushed to disk periodically (not on every
// request) so normal traffic doesn't hammer the filesystem.
const ANALYTICS_MAX_QUERIES = Number(process.env.ANALYTICS_MAX_QUERIES || 2000); // bounds file size
const ANALYTICS_FLUSH_MS = 30 * 1000;
let analyticsQueries = {};
try {
  analyticsQueries = JSON.parse(fs.readFileSync(ANALYTICS_PATH, "utf-8"));
} catch (e) {
  analyticsQueries = {}; // first run, or file doesn't exist yet — start fresh
}
let analyticsDirty = false;

function normalizeAnalyticsQuery(q) {
  return String(q || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

function getOrCreateQueryEntry(q) {
  if (analyticsQueries[q]) return analyticsQueries[q];
  const keys = Object.keys(analyticsQueries);
  if (keys.length >= ANALYTICS_MAX_QUERIES) {
    // Evict the least-searched entry; among equals, the one not seen for the longest.
    // (v3 evicted by count only, so once full every new query evicted the previous NEW
    // query — rare queries could never accumulate. Tie-breaking on age evicts stale
    // one-off queries first and lets recent ones survive.)
    let worstKey = null;
    let worst = null;
    for (const k of keys) {
      const e = analyticsQueries[k];
      if (!worst || e.count < worst.count || (e.count === worst.count && String(e.last_seen || "") < String(worst.last_seen || ""))) {
        worst = e;
        worstKey = k;
      }
    }
    if (worstKey !== null) delete analyticsQueries[worstKey];
  }
  analyticsQueries[q] = { count: 0, zero_result: 0, clicks: {}, last_seen: null };
  return analyticsQueries[q];
}

function commitSearch(q, resultCount) {
  if (!q) return;
  const entry = getOrCreateQueryEntry(q);
  entry.count += 1;
  if (resultCount === 0) entry.zero_result += 1;
  entry.last_seen = new Date().toISOString();
  analyticsDirty = true;
}

// Live search fires a request per (debounced) keystroke: "ψ", "ψυ", "ψυχ", "ψυχολογια".
// Counting each of those would flood the stats with prefixes and fake zero-result
// queries. Instead, per client we keep ONE pending query and only commit it when the
// user moves on to an unrelated query, clicks a result, or stops typing for a few seconds.
const PENDING_TTL_MS = 4000;
const PENDING_MAX_CLIENTS = 5000;
const pendingSearches = new Map(); // clientKey -> { q, resultCount, ts }

function trackSearch(clientKey, rawQuery, resultCount) {
  const q = normalizeAnalyticsQuery(rawQuery);
  if (q.length < 2) return;
  const now = Date.now();
  const prev = pendingSearches.get(clientKey);
  if (prev && now - prev.ts < PENDING_TTL_MS && (q.startsWith(prev.q) || prev.q.startsWith(q))) {
    prev.q = q; // still refining the same query (typing or backspacing)
    prev.resultCount = resultCount;
    prev.ts = now;
    return;
  }
  if (prev) commitSearch(prev.q, prev.resultCount);
  pendingSearches.delete(clientKey);
  pendingSearches.set(clientKey, { q, resultCount, ts: now });
  if (pendingSearches.size > PENDING_MAX_CLIENTS) {
    const [oldestKey, oldest] = pendingSearches.entries().next().value;
    commitSearch(oldest.q, oldest.resultCount);
    pendingSearches.delete(oldestKey);
  }
}

function commitPendingFor(clientKey) {
  const prev = pendingSearches.get(clientKey);
  if (!prev) return null;
  commitSearch(prev.q, prev.resultCount);
  pendingSearches.delete(clientKey);
  return prev.q;
}

function commitExpiredPending(force) {
  const now = Date.now();
  for (const [key, p] of pendingSearches) {
    if (force || now - p.ts >= PENDING_TTL_MS) {
      commitSearch(p.q, p.resultCount);
      pendingSearches.delete(key);
    }
  }
}

function trackClick(clientKey, rawQuery, programKey) {
  // A click means the query the user typed is final — commit it first.
  const pendingQ = commitPendingFor(clientKey);
  const q = normalizeAnalyticsQuery(rawQuery) || pendingQ || "(χωρίς query)";
  const entry = getOrCreateQueryEntry(q);
  entry.clicks[programKey] = (entry.clicks[programKey] || 0) + 1;
  entry.last_seen = new Date().toISOString();
  analyticsDirty = true;
}

function flushAnalytics() {
  if (!analyticsDirty) return;
  analyticsDirty = false;
  try {
    // Synchronous on purpose: this also runs from the SIGTERM/SIGINT handler right
    // before process.exit(), where an async writeFile would race the exit.
    writeFileAtomicSync(ANALYTICS_PATH, JSON.stringify(analyticsQueries));
  } catch (err) {
    analyticsDirty = true; // retry on next interval
    console.error("Αποτυχία αποθήκευσης analytics.json:", err);
  }
}
setInterval(() => commitExpiredPending(false), 2000).unref();
setInterval(flushAnalytics, ANALYTICS_FLUSH_MS).unref();
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => { commitExpiredPending(true); flushAnalytics(); process.exit(0); });
}

const PORT = process.env.PORT || 8787;
// Choose provider with LLM_PROVIDER=anthropic|openai|gemini in your .env
const PROVIDER = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();

// ---- CORS ----
// ALLOWED_ORIGINS = the sites allowed to call the API from THEIR pages (e.g. the GTM
// widget on elearningekpa.gr). The backend's OWN pages (index.html, admin panel) are
// always allowed automatically (same-origin check below) — in v3 they were only allowed
// on Railway, so on a self-hosted domain the chat and tracking returned 403.
const DEFAULT_ORIGINS = [
  "https://elearningekpa.gr",
  "https://www.elearningekpa.gr",
  "http://localhost:8787",
  "http://localhost:3000",
];
const envOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const ALLOWED_ORIGINS = envOrigins.length ? envOrigins : DEFAULT_ORIGINS;
const RAILWAY_PUBLIC_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : null;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "") || null;

function isSameOrigin(origin, req) {
  // Browsers always send the real target host in the Host header, so a foreign page
  // (Origin: https://evil.example) can never satisfy this check.
  try {
    return new URL(origin).host === req.get("host");
  } catch (e) {
    return false;
  }
}

function corsDelegate(req, callback) {
  const origin = req.get("Origin");
  // Requests with no Origin header (curl, server-to-server health checks, same-origin
  // GETs) are not browser CORS requests — always allowed.
  if (!origin) return callback(null, { origin: false });
  if (
    ALLOWED_ORIGINS.includes(origin) ||
    origin === RAILWAY_PUBLIC_DOMAIN ||
    origin === PUBLIC_BASE_URL ||
    isSameOrigin(origin, req)
  ) {
    return callback(null, { origin: true });
  }
  return callback(new Error(`CORS: origin ${origin} δεν επιτρέπεται`));
}

// ---- Rate limiting ----
function makeLimiter(envName, fallback, message) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env[envName] || fallback),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
}
// /api/chat makes a real (billable) LLM call per request → strictest public limit.
const chatLimiter = makeLimiter("CHAT_RATE_LIMIT_PER_MIN", 20, "Πολλά αιτήματα chat — δοκίμασε ξανά σε λίγο.");
const searchLimiter = makeLimiter("SEARCH_RATE_LIMIT_PER_MIN", 120, "Πολλά αιτήματα αναζήτησης — δοκίμασε ξανά σε λίγο.");
// Brute-force guard for the admin token (a real admin never needs 10 requests/minute).
const adminLimiter = makeLimiter("ADMIN_RATE_LIMIT_PER_MIN", 10, "Πολλά αιτήματα admin — δοκίμασε ξανά σε λίγο.");
const trackLimiter = makeLimiter("TRACK_RATE_LIMIT_PER_MIN", 120, "Πολλά αιτήματα tracking — δοκίμασε ξανά σε λίγο.");
// The admin catalog tab polls progress every few seconds while a check runs.
const catalogStatusLimiter = makeLimiter("CATALOG_STATUS_RATE_LIMIT_PER_MIN", 60, "Πολλά αιτήματα — δοκίμασε ξανά σε λίγο.");

const app = express();
app.set("trust proxy", 1); // behind Railway / nginx — needed for correct rate-limit IPs
app.disable("x-powered-by");
app.use(compression()); // programs.json is ~4.9MB raw, well under 1MB gzipped
// Every response may differ by Origin (CORS headers are added only for allowed
// origins). Without "Vary: Origin" on ALL responses, a cacheable response fetched
// without an Origin (e.g. this backend's own page loading /api/programs) is reused by
// the browser for the widget's cross-origin request - which then fails CORS and the
// related programs silently disappear (found 2026-10-01).
app.use((req, res, next) => { res.vary("Origin"); next(); });
app.use(cors(corsDelegate));
// The lexicon routes read a larger body (a few hundred words), but only AFTER the admin token
// check, so the bigger limit is never available to the public.
const jsonSmall = express.json({ limit: "64kb" });
const jsonLexicon = express.json({ limit: "512kb" });
app.use((req, res, next) => (req.path.startsWith("/api/admin/lexicon/") ? next() : jsonSmall(req, res, next)));

// Current taxonomy, served from memory (so it is always the latest saved version, also
// when it lives in DATA_DIR rather than in public/). Registered BEFORE express.static.
app.get("/concepts.json", (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.json(CONCEPTS);
});
// Current lexicon, from memory (always the latest saved version). Before express.static.
app.get("/lexicon.json", (req, res) => {
  res.set("Cache-Control", "no-cache");
  const lex = lexiconStore.current();
  if (!lex) return res.status(503).json({ error: "Το λεξικό δεν είναι διαθέσιμο." });
  res.json(lex);
});
// The raw file is also reachable as a static asset; serve the same visitor-facing list
// as /api/programs so hidden programs don't leak through it.
app.get("/programs.json", (req, res) => {
  // no-cache = the browser keeps it but revalidates each time (304 via ETag, tiny).
  // A plain max-age let Chrome reuse a copy fetched WITHOUT CORS (this backend's own
  // page) for the widget's cross-origin request, which then failed CORS and the
  // related programs disappeared - "Vary: Origin" alone did not prevent it.
  res.set("Cache-Control", "no-cache");
  res.json(PROGRAMS);
});
app.use(express.static(PUBLIC_DIR));

// Tracking beacons are sent as text/plain (a CORS-"simple" content type, so
// navigator.sendBeacon works cross-origin without a preflight). Parse both forms.
const textBody = express.text({ type: "text/plain", limit: "8kb" });
function parseBeaconBody(req) {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return req.body || {};
}

function candidatesToContext(list) {
  return list
    .map(
      (p) =>
        `- ${p.title} | κατεύθυνση: ${p.primary_area || "—"} | τιμή: ${p.price != null ? p.price + "€" : "άγνωστη"} | url: ${p.url} | περιγραφή: ${((p.description_for_matching || p.description_full || "")).slice(0, 300).replace(/\s+/g, " ")}`
    )
    .join("\n");
}

function buildSystemPrompt(candidates) {
  return (
    "Είσαι ο AI Βοηθός Επιλογής Προγράμματος του E-Learning ΕΚΠΑ. Απάντα ΜΟΝΟ με βάση τα προγράμματα της λίστας παρακάτω " +
    "(μην εφευρίσκεις προγράμματα ή τιμές που δεν υπάρχουν εκεί). Απάντα στα Ελληνικά, σύντομα και με σαφήνεια, και ανέφερε " +
    "συγκεκριμένα προγράμματα με το url τους όταν ταιριάζουν στο ερώτημα. Αν δεν βρίσκεις κάτι σχετικό, πες το ειλικρινά.\n\n" +
    "Μορφοποίηση απάντησης: γράψε σε απλό κείμενο, ΧΩΡΙΣ markdown συμβολισμούς (όχι ###, όχι **, όχι - ή * για λίστες). " +
    "Όταν προτείνεις πάνω από ένα πρόγραμμα, άφησε μία κενή γραμμή ανάμεσα σε κάθε πρόγραμμα ώστε να ξεχωρίζουν καθαρά. " +
    "Γράψε κάθε url ολόκληρο και αυτούσιο (π.χ. https://elearningekpa.gr/courses/...) ώστε να μπορεί να μετατραπεί σε ενεργό σύνδεσμο.\n\n" +
    "Πιο σχετικά προγράμματα με το τρέχον ερώτημα:\n" +
    candidatesToContext(candidates)
  );
}

// ---- Provider adapters: each returns a plain string reply ----

async function callAnthropic(system, history) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Λείπει το ANTHROPIC_API_KEY στο .env");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 1000,
      system,
      messages: history,
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n") || "Δεν έλαβα απάντηση.";
}

async function callOpenAI(system, history) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Λείπει το OPENAI_API_KEY στο .env");
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      max_tokens: 1000,
      messages: [{ role: "system", content: system }, ...history],
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI API error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "Δεν έλαβα απάντηση.";
}

async function callGemini(system, history) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Λείπει το GEMINI_API_KEY στο .env");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    // Key in a header rather than the URL query string, so it never ends up in proxy/access logs.
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    }),
  });
  if (!resp.ok) throw new Error(`Gemini API error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "Δεν έλαβα απάντηση.";
}

const PROVIDERS = { anthropic: callAnthropic, openai: callOpenAI, gemini: callGemini };

// ---- Chat input limits ----
// v3 accepted any `history` array up to the 1MB body limit, so a single request could
// push hundreds of thousands of tokens to the (paid) LLM provider. History is now
// sanitized and hard-capped before it ever reaches the provider.
const MAX_MESSAGE_CHARS = 700;
const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_MSG_CHARS = 2000;
const MAX_HISTORY_TOTAL_CHARS = 8000;

function sanitizeConversation(history, message) {
  const raw = Array.isArray(history) ? history.slice(-MAX_HISTORY_MESSAGES * 2) : [];
  let msgs = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_MSG_CHARS) }))
    .slice(-MAX_HISTORY_MESSAGES);
  // Total size budget: drop oldest messages first.
  let total = msgs.reduce((n, m) => n + m.content.length, 0);
  while (msgs.length && total > MAX_HISTORY_TOTAL_CHARS) total -= msgs.shift().content.length;
  msgs.push({ role: "user", content: message });
  // Providers expect the conversation to start with a user turn and to alternate roles.
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  const merged = [];
  for (const m of msgs) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else merged.push({ role: m.role, content: m.content });
  }
  return merged;
}

app.post("/api/chat", chatLimiter, async (req, res) => {
  const { message, history = [] } = req.body || {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Λείπει το πεδίο 'message'." });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({ error: `Το μήνυμα είναι πολύ μεγάλο (μέγιστο ${MAX_MESSAGE_CHARS} χαρακτήρες).` });
  }
  const fn = PROVIDERS[PROVIDER];
  if (!fn) {
    console.error(`Άγνωστος LLM_PROVIDER: ${PROVIDER}`);
    return res.status(500).json({ error: "Ο AI βοηθός δεν έχει ρυθμιστεί σωστά." });
  }
  try {
    const conversation = sanitizeConversation(history, message);
    // Retrieval: the current message first; plus a few results for the user's previous
    // message, so follow-ups ("και πόσο κοστίζει το δεύτερο;") still have the programs
    // under discussion in context.
    const candidates = EkpaSearch.search(PROGRAMS, CONCEPTS, message, 8);
    const prevUser = conversation.slice(0, -1).reverse().find((m) => m.role === "user");
    if (prevUser) {
      const seen = new Set(candidates.map((c) => c.slug));
      EkpaSearch.search(PROGRAMS, CONCEPTS, prevUser.content.slice(0, MAX_MESSAGE_CHARS), 6)
        .filter((c) => !seen.has(c.slug))
        .slice(0, 4)
        .forEach((c) => candidates.push(c));
    }
    const reply = await fn(buildSystemPrompt(candidates), conversation);
    res.json({ reply, candidates_used: candidates.map((c) => c.title) });
  } catch (err) {
    // Full detail goes to the server log only — provider error bodies can contain
    // account/billing details and are not meant for end users.
    console.error("Σφάλμα /api/chat:", err);
    res.status(502).json({ error: "Ο AI βοηθός δεν είναι διαθέσιμος αυτή τη στιγμή. Δοκίμασε ξανά σε λίγο." });
  }
});

// Plain retrieval endpoint (used by the GTM widget on elearningekpa.gr).
//
// Backwards compatibility:
//   GET /api/search?q=...&limit=N keeps the historical ARRAY response and max 40.
//
// Complete-results contract (opt-in):
//   GET /api/search?q=...&format=paged&page=1&page_size=40
// returns { results, pagination }. The engine ranks the COMPLETE matching set first,
// then the API slices that stable ranking into pages. This means official categories
// with 52/81/84 members can be traversed completely without one oversized response.
// `fields=compact` works in both modes. Page size is deliberately capped at 40 to
// preserve the existing payload/rate profile; completeness comes from pagination, not
// from increasing the single-response ceiling.
function hrMs(a, b) {
  return (Number(b - a) / 1e6).toFixed(2);
}
app.get("/api/search", searchLimiter, (req, res) => {
  const t0 = process.hrtime.bigint();
  const q = String(req.query.q || "");
  const paged = req.query.format === "paged";

  let payload;
  let trackedCount;
  if (paged) {
    const allResults = EkpaSearch.rank(PROGRAMS, CONCEPTS, q);
    const sortedResults = SearchApiContract.sortResults(allResults, req.query.sort);
    trackedCount = sortedResults.length;
    payload = SearchApiContract.buildPagedResponse(sortedResults, req.query);
  } else {
    const limit = SearchApiContract.clampLegacyLimit(req.query.limit);
    const results = EkpaSearch.search(PROGRAMS, CONCEPTS, q, limit);
    trackedCount = results.length;
    payload = SearchApiContract.shapeResults(results, req.query.fields);
  }
  const t1 = process.hrtime.bigint();
  trackSearch(req.ip, q, trackedCount);
  const t2 = process.hrtime.bigint();
  const body = JSON.stringify(payload);
  const t3 = process.hrtime.bigint();
  res.set(
    "Server-Timing",
    `scoring;dur=${hrMs(t0, t1)}, shape;dur=${hrMs(t1, t2)}, serialize;dur=${hrMs(t2, t3)}, app_total;dur=${hrMs(t0, t3)}`
  );
  res.type("application/json").send(body);
});

// Called by the backend's own index.html (which searches client-side for speed, so it
// never hits /api/search) so that stats stay consistent regardless of the UI used.
app.post("/api/track-search", trackLimiter, textBody, (req, res) => {
  const { query, result_count } = parseBeaconBody(req);
  trackSearch(req.ip, query, Number(result_count) || 0);
  res.json({ ok: true });
});

// Called by the frontend and the GTM widget when a user clicks a result.
// `program_id` may be the program's slug (preferred — always present) or numeric id.
app.post("/api/track-click", trackLimiter, textBody, (req, res) => {
  const { query, program_id } = parseBeaconBody(req);
  const program = resolveProgram(program_id);
  if (!program) {
    return res.status(400).json({ error: "Άγνωστο ή απόν program_id." });
  }
  trackClick(req.ip, query, String(program.slug));
  res.json({ ok: true });
});

// Full catalog endpoint — served straight from memory (parsed once at startup).
app.get("/api/programs", searchLimiter, (req, res) => {
  // no-cache = the browser keeps it but revalidates each time (304 via ETag, tiny).
  // A plain max-age let Chrome reuse a copy fetched WITHOUT CORS (this backend's own
  // page) for the widget's cross-origin request, which then failed CORS and the
  // related programs disappeared - "Vary: Origin" alone did not prevent it.
  res.set("Cache-Control", "no-cache");
  res.json(PROGRAMS);
});

// Healthcheck target (Railway Settings → Healthcheck Path / uptime monitors).
// `programs` stays the full catalog size (IT's smoke tests expect it); `active_programs`
// is what visitors can actually find.
app.get("/health", (req, res) =>
  res.json({ ok: true, programs: ALL_PROGRAMS.length, active_programs: PROGRAMS.length })
);

// ---- Admin: taxonomy editing ----
// Protected by a shared secret (ADMIN_TOKEN env var), sent as the x-admin-token header.
function tokensEqual(a, b) {
  // Constant-time comparison (hashing first makes lengths equal).
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function checkAdminToken(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    // Fail closed: no token configured → admin endpoints disabled entirely.
    return res.status(503).json({ error: "Το admin panel δεν έχει ρυθμιστεί (λείπει το ADMIN_TOKEN)." });
  }
  const provided = req.get("x-admin-token") || "";
  if (!tokensEqual(provided, expected)) {
    return res.status(401).json({ error: "Λάθος ή απόν admin token." });
  }
  next();
}

// Basic shape validation: an object mapping non-empty string keys to arrays of
// non-empty strings. Rejects anything else before it ever touches the filesystem.
function isValidConceptsShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const keys = Object.keys(data);
  if (keys.length === 0 || keys.length > 500) return false; // sanity bound
  for (const key of keys) {
    if (!key.trim()) return false;
    const terms = data[key];
    if (!Array.isArray(terms) || terms.length === 0 || terms.length > 100) return false;
    for (const t of terms) {
      if (typeof t !== "string" || !t.trim() || t.length > 200) return false;
    }
  }
  return true;
}

// ---- Ranking-drift guard ----
const RANKING_FIXTURE_PATH = path.join(__dirname, "../test/fixtures/search-regression.json");
let RANKING_FIXTURE = null;
try {
  RANKING_FIXTURE = JSON.parse(fs.readFileSync(RANKING_FIXTURE_PATH, "utf-8"));
} catch (e) {
  console.error("Ranking-drift guard: δεν βρέθηκε το test/fixtures/search-regression.json - ο έλεγχος θα παραλείπεται.");
}

function checkRankingDrift(newConcepts) {
  if (!RANKING_FIXTURE) return [];
  const diffs = [];
  for (const [query, expectedTop10] of Object.entries(RANKING_FIXTURE)) {
    const actualTop10 = EkpaSearch.rank(ALL_PROGRAMS, newConcepts, query)
      .slice(0, 10)
      .map((p) => p.slug);
    if (JSON.stringify(actualTop10) !== JSON.stringify(expectedTop10)) {
      diffs.push({ query, expected: expectedTop10, actual: actualTop10 });
    }
  }
  return diffs;
}

app.post("/api/admin/concepts", adminLimiter, checkAdminToken, (req, res) => {
  const incoming = req.body;
  if (!isValidConceptsShape(incoming)) {
    return res.status(400).json({ error: "Μη έγκυρη μορφή taxonomy (αναμένεται { concept_key: [\"λέξη\", ...] }, με μη κενές τιμές)." });
  }
  if (req.get("x-confirm-ranking-changes") !== "true") {
    const rankingChanges = checkRankingDrift(incoming);
    if (rankingChanges.length > 0) {
      return res.status(409).json({
        error: `Αυτή η αλλαγή θα άλλαζε τα αποτελέσματα για ${rankingChanges.length} ελεγμένα queries. Έλεγξε τη διαφορά και ξαναστείλε με το header x-confirm-ranking-changes: true αν είναι σκόπιμη.`,
        ranking_changes: rankingChanges,
      });
    }
  }
  try {
    // Pretty-printed so the file stays hand-editable; atomic so it can never be left half-written.
    writeFileAtomicSync(CONCEPTS_PATH, JSON.stringify(incoming, null, 2) + "\n");
    CONCEPTS = incoming; // update in-memory copy immediately — no redeploy needed
    res.json({ ok: true, concepts_count: Object.keys(CONCEPTS).length });
  } catch (err) {
    console.error("Αποτυχία εγγραφής concepts.json:", err);
    res.status(500).json({ error: "Αποτυχία αποθήκευσης στον server." });
  }
});

// ---- Admin: lexicon status and full data export ----
const lexiconVersion = () => crypto.createHash("sha1").update(JSON.stringify(lexiconStore.current())).digest("hex").slice(0, 16);
app.get("/api/admin/lexicon", catalogStatusLimiter, checkAdminToken, (req, res) => {
  res.json({ ...lexiconStore.status(), version: lexiconVersion(), lexicon: lexiconStore.current(), backup_files: lexiconStore.listBackups().slice(0, 20) });
});
// What would change in the results if this draft were saved? (compares in a worker thread,
// never touching the live lexicon). One at a time.
let lexiconPreviewRunning = false;
app.post("/api/admin/lexicon/preview", adminLimiter, checkAdminToken, jsonLexicon, async (req, res) => {
  const draft = req.body && req.body.lexicon;
  if (!draft) return res.status(400).json({ error: "Λείπει το λεξικό." });
  if (lexiconPreviewRunning) return res.status(409).json({ error: "Τρέχει ήδη μια προεπισκόπηση. Δοκίμασε σε λίγα δευτερόλεπτα." });
  lexiconPreviewRunning = true;
  try {
    const categoryNames = new Set(ALL_PROGRAMS.flatMap((p) => [p.primary_area, ...(p.areas_of_study || [])]).filter(Boolean));
    const result = await previewLexicon({
      programsAll: ALL_PROGRAMS, concepts: CONCEPTS, fixture: RANKING_FIXTURE || {},
      current: lexiconStore.current(), candidate: draft, categoryNames,
    });
    res.json({ ...result, base_version: lexiconVersion() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally { lexiconPreviewRunning = false; }
});
// Saves the draft: validated, previous version backed up, live at once. base_version must be the
// version the editor started from, so two people cannot silently overwrite each other.
app.post("/api/admin/lexicon/save", adminLimiter, checkAdminToken, jsonLexicon, (req, res) => {
  const { lexicon, base_version, confirm } = req.body || {};
  if (confirm !== true) return res.status(400).json({ error: "Χρειάζεται ρητή επιβεβαίωση." });
  if (!lexicon) return res.status(400).json({ error: "Λείπει το λεξικό." });
  if (base_version !== lexiconVersion()) return res.status(409).json({ error: "Το λεξικό άλλαξε στο μεταξύ (από άλλον χρήστη ή επαναφορά). Φόρτωσε ξανά τη σελίδα και ξαναδοκίμασε." });
  try {
    const counts = lexiconStore.save(lexicon, { reason: "before-save" });
    EkpaSearch.search(PROGRAMS, CONCEPTS, "warmup", 1);
    res.json({ ok: true, counts, version: lexiconVersion(), backups: lexiconStore.listBackups().length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/admin/lexicon/rollback", adminLimiter, checkAdminToken, jsonLexicon, (req, res) => {
  try {
    const file = lexiconStore.rollback(req.body && req.body.file);
    EkpaSearch.search(PROGRAMS, CONCEPTS, "warmup", 1);
    res.json({ ok: true, restored_from: file, version: lexiconVersion(), backups: lexiconStore.listBackups().length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
// Everything EKPA edits, in one file: lexicon, taxonomy and the full catalog (also hidden programs).
app.get("/api/admin/export", adminLimiter, checkAdminToken, (req, res) => {
  const day = new Date().toISOString().slice(0, 10);
  res.set("Content-Disposition", `attachment; filename="ekpa-smart-finder-export-${day}.json"`);
  res.json({
    exported_at: new Date().toISOString(),
    format: 1,
    lexicon: lexiconStore.current(),
    lexicon_status: { source: lexiconStore.status().source, error: lexiconStore.status().error },
    concepts: CONCEPTS,
    catalog: { meta: catalogStore.meta, programs: ALL_PROGRAMS },
  });
});

// ---- Admin: analytics visibility (Phase 1 — read-only, see HANDOVER-NOTES.md) ----
app.get("/api/admin/analytics", adminLimiter, checkAdminToken, (req, res) => {
  commitExpiredPending(false);
  const entries = Object.entries(analyticsQueries);
  const titleFor = (key) => {
    const p = resolveProgram(key);
    return p ? p.title : "(άγνωστο πρόγραμμα)";
  };
  // Legacy (v3) click keys may be numeric ids — normalize them to slugs for aggregation.
  const canonicalKey = (key) => {
    const p = resolveProgram(key);
    return p ? String(p.slug) : String(key);
  };

  const topQueries = entries
    .map(([query, e]) => ({
      query,
      count: e.count,
      zero_result: e.zero_result,
      last_seen: e.last_seen,
      clicks: Object.entries(e.clicks).map(([programKey, n]) => ({
        program_id: canonicalKey(programKey),
        title: titleFor(programKey),
        clicks: n,
      })),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 100);

  const zeroResultQueries = entries
    .filter(([, e]) => e.zero_result > 0)
    .map(([query, e]) => ({ query, zero_result: e.zero_result, count: e.count, last_seen: e.last_seen }))
    .sort((a, b) => b.zero_result - a.zero_result)
    .slice(0, 100);

  const clicksByProgram = {};
  entries.forEach(([query, e]) => {
    Object.entries(e.clicks).forEach(([programKey, n]) => {
      const key = canonicalKey(programKey);
      if (!clicksByProgram[key]) {
        clicksByProgram[key] = { program_id: key, title: titleFor(programKey), clicks: 0, from_queries: [] };
      }
      clicksByProgram[key].clicks += n;
      clicksByProgram[key].from_queries.push({ query, clicks: n });
    });
  });
  const topClickedPrograms = Object.values(clicksByProgram)
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 100);

  res.json({
    tracked_queries_total: entries.length,
    top_queries: topQueries,
    zero_result_queries: zeroResultQueries,
    top_clicked_programs: topClickedPrograms,
  });
});

// CORS errors thrown by corsDelegate land here instead of crashing the process.
// ---- Admin: catalog ("Κατάλογος" tab) ----
// One check at a time, run in the background inside this process. A full check reads
// every active program page slowly (~2s apart, the site rate-limits) - about 25 min.
// Nothing changes until an admin reviews the result and presses "Εφαρμογή".
const CATALOG_CHECK_DELAY_MS = Number(process.env.CATALOG_CHECK_DELAY_MS) >= 0 && process.env.CATALOG_CHECK_DELAY_MS !== undefined
  ? Number(process.env.CATALOG_CHECK_DELAY_MS) : CatalogSync.DEFAULTS.delayMs;
const CATALOG_SITE_ORIGIN = process.env.CATALOG_SITE_ORIGIN || undefined; // tests only
let catalogJob = null; // { id, mode, state, started_at, finished_at, progress, error, summary, diff, ranking, candidate, base_checked_at, base_slugs }
let quickCheckCache = null; // { at, result } - cleared whenever the live catalog changes

function liveCatalogInfo() {
  return {
    ...catalogStore.meta,
    total: ALL_PROGRAMS.length,
    active: PROGRAMS.length,
    inactive: ALL_PROGRAMS.length - PROGRAMS.length,
    can_apply_here: !!DATA_DIR,
  };
}

function publicJob(job) {
  if (!job) return null;
  const { candidate, base_slugs, ...rest } = job; // never send the whole catalog to the browser
  return rest;
}

async function runCatalogJob(job) {
  try {
    const base = ALL_PROGRAMS;
    job.base_checked_at = catalogStore.meta && catalogStore.meta.checked_at;
    job.base_slugs = base.map((p) => p.slug);
    const check = await CatalogSync.checkCatalog(base, {
      withPrices: job.mode === "full",
      delayMs: CATALOG_CHECK_DELAY_MS,
      siteOrigin: CATALOG_SITE_ORIGIN,
      onProgress: ({ done, total }) => { job.progress = { done, total }; },
    });
    if (!check.ok) throw new Error(check.error);
    job.state = "comparing";
    const { candidate, diff, summary } = CatalogSync.buildCandidate(base, check, { concepts: CONCEPTS });
    const changed = new Set([...diff.gaps_filled.map((x) => x.slug), ...diff.new_added.map((x) => x.slug)]);
    const ranking = await RankingDiff.compareRankingsAsync(base, candidate, CONCEPTS, RANKING_FIXTURE || {}, changed);
    Object.assign(job, { candidate, diff, summary, ranking, state: "done", finished_at: new Date().toISOString() });
    if (DATA_DIR) {
      const dir = path.join(DATA_DIR, "catalog-check", job.id);
      fs.mkdirSync(dir, { recursive: true });
      writeFileAtomicSync(path.join(dir, "report.json"), JSON.stringify({ summary, diff }, null, 2));
      writeFileAtomicSync(path.join(dir, "RANKING-DIFF.txt"), RankingDiff.toText(ranking));
      writeFileAtomicSync(path.join(dir, "programs.candidate.json"), JSON.stringify(candidate));
    }
  } catch (e) {
    console.error("Έλεγχος καταλόγου απέτυχε:", e);
    Object.assign(job, { state: "failed", error: String(e.message || e), finished_at: new Date().toISOString() });
  }
}

app.get("/api/admin/catalog", catalogStatusLimiter, checkAdminToken, (req, res) => {
  res.json({ live: liveCatalogInfo(), job: publicJob(catalogJob), backups: catalogStore.listBackups().slice(0, 10) });
});

app.post("/api/admin/catalog/check", adminLimiter, checkAdminToken, (req, res) => {
  if (catalogJob && ["running", "comparing"].includes(catalogJob.state)) {
    return res.status(409).json({ error: "Τρέχει ήδη έλεγχος.", job: publicJob(catalogJob) });
  }
  const mode = req.body && req.body.mode === "status" ? "status" : "full";
  catalogJob = {
    id: new Date().toISOString().replace(/[:.]/g, "-"),
    mode,
    state: "running",
    started_at: new Date().toISOString(),
    progress: { done: 0, total: null },
  };
  runCatalogJob(catalogJob); // background - the request returns immediately
  res.status(202).json({ job: publicJob(catalogJob) });
});

app.post("/api/admin/catalog/apply", adminLimiter, checkAdminToken, (req, res) => {
  const job = catalogJob;
  if (!DATA_DIR) return res.status(400).json({ error: "Ο server δεν έχει DATA_DIR - η εφαρμογή από το admin δεν θα διατηρούνταν μετά από επανεκκίνηση." });
  if (!job || job.state !== "done") return res.status(400).json({ error: "Δεν υπάρχει ολοκληρωμένος έλεγχος για εφαρμογή." });
  if (!req.body || req.body.job_id !== job.id) return res.status(409).json({ error: "Ο έλεγχος άλλαξε - ξαναφόρτωσε τη σελίδα." });
  if (!job.summary.can_apply) return res.status(409).json({ error: "Η εφαρμογή είναι μπλοκαρισμένη: " + job.summary.blockers.join(" ") });
  if (req.body.confirm !== true) return res.status(400).json({ error: "Χρειάζεται επιβεβαίωση." });
  // The catalog must not have changed since the check started (e.g. another apply,
  // a rollback or a new package) - otherwise the reviewed diff no longer describes it.
  const sameBase = (catalogStore.meta && catalogStore.meta.checked_at) === job.base_checked_at &&
    job.base_slugs.length === ALL_PROGRAMS.length && job.base_slugs.every((s, i) => ALL_PROGRAMS[i].slug === s);
  if (!sameBase) return res.status(409).json({ error: "Ο κατάλογος άλλαξε μετά τον έλεγχο. Τρέξε νέο έλεγχο." });
  try {
    setCatalog(catalogStore.apply(job.candidate, { job_id: job.id, mode: job.mode }));
    quickCheckCache = null;
    job.state = "applied";
    job.candidate = null;
    res.json({ ok: true, live: liveCatalogInfo() });
  } catch (e) {
    console.error("Εφαρμογή καταλόγου απέτυχε:", e);
    res.status(500).json({ error: "Αποτυχία εφαρμογής στον server." });
  }
});

app.post("/api/admin/catalog/rollback", adminLimiter, checkAdminToken, (req, res) => {
  if (catalogJob && ["running", "comparing"].includes(catalogJob.state)) {
    return res.status(409).json({ error: "Τρέχει έλεγχος - περίμενε να ολοκληρωθεί." });
  }
  try {
    const file = req.body && typeof req.body.file === "string" ? req.body.file : undefined;
    setCatalog(catalogStore.rollback(file));
    quickCheckCache = null;
    if (catalogJob && catalogJob.state === "done") catalogJob.state = "stale";
    res.json({ ok: true, live: liveCatalogInfo() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Lightweight reminder for the admin tab: one request to "Τρέχων Κύκλος", cached 6h.
app.get("/api/admin/catalog/quick", catalogStatusLimiter, checkAdminToken, async (req, res) => {
  if (quickCheckCache && Date.now() - quickCheckCache.at < 6 * 3600 * 1000) return res.json(quickCheckCache.result);
  try {
    const check = await CatalogSync.checkCatalog(ALL_PROGRAMS, { withPrices: false, siteOrigin: CATALOG_SITE_ORIGIN, retryDelaysMs: [2000] });
    if (!check.ok) return res.status(502).json({ error: check.error });
    const { summary, diff } = CatalogSync.buildCandidate(ALL_PROGRAMS, check);
    const result = {
      checked_at: check.finishedAt,
      in_cycle: summary.in_cycle,
      to_hide: diff.deactivated.map((x) => x.title),
      to_show: diff.reactivated.map((x) => x.title),
      new_in_cycle: diff.new_in_cycle.map((x) => x.title),
      needs_check: diff.deactivated.length + diff.reactivated.length + diff.new_in_cycle.length > 0,
    };
    quickCheckCache = { at: Date.now(), result };
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: "Ο γρήγορος έλεγχος απέτυχε." });
  }
});

app.use((err, req, res, next) => {
  if (err && /^CORS:/.test(err.message)) {
    return res.status(403).json({ error: err.message });
  }
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "Το αίτημα είναι πολύ μεγάλο." });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Μη έγκυρο JSON." });
  }
  return next(err);
});

// Warm the search index at startup so the first real user doesn't pay for building it.
EkpaSearch.search(PROGRAMS, CONCEPTS, "warmup", 1);

app.listen(PORT, () => {
  console.log(`EKPA Smart Finder backend listening on http://localhost:${PORT}`);
  console.log(`LLM provider: ${PROVIDER} (set LLM_PROVIDER in .env to change: anthropic | openai | gemini)`);
  console.log(`Allowed CORS origins: ${ALLOWED_ORIGINS.join(", ")}${RAILWAY_PUBLIC_DOMAIN ? " + " + RAILWAY_PUBLIC_DOMAIN : ""}${PUBLIC_BASE_URL ? " + " + PUBLIC_BASE_URL : ""} (+ same-origin)`);
  console.log(`Data: concepts=${CONCEPTS_PATH} analytics=${ANALYTICS_PATH}${DATA_DIR ? "" : " (DATA_DIR δεν έχει οριστεί — δες DEPLOY οδηγούς)"}`);
});
