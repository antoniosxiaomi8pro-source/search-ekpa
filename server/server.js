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

const PUBLIC_DIR = path.join(__dirname, "../public");
const PROGRAMS = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "programs.json"), "utf-8"));

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

// Atomic write: write to a temp file in the same directory, then rename. A crash or
// full disk mid-write can never leave a half-written (corrupt) JSON file behind.
function writeFileAtomicSync(filePath, content) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

// ---- Program lookup ----
// ~1/3 of the catalog has `id: null` (programs exported without a CMS id), so the id
// cannot be used as a key. `slug` is present and unique for every program, so it is the
// canonical key for click tracking. Numeric ids are still accepted (legacy analytics
// entries / older widget versions), but "null"/"undefined"/"" are always rejected.
const PROGRAMS_BY_KEY = new Map();
PROGRAMS.forEach((p) => { if (p.slug) PROGRAMS_BY_KEY.set(String(p.slug), p); });
PROGRAMS.forEach((p) => {
  if (p.id !== null && p.id !== undefined && !PROGRAMS_BY_KEY.has(String(p.id))) PROGRAMS_BY_KEY.set(String(p.id), p);
});
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

const app = express();
app.set("trust proxy", 1); // behind Railway / nginx — needed for correct rate-limit IPs
app.disable("x-powered-by");
app.use(compression()); // programs.json is ~4.9MB raw, well under 1MB gzipped
app.use(cors(corsDelegate));
app.use(express.json({ limit: "64kb" }));

// Current taxonomy, served from memory (so it is always the latest saved version, also
// when it lives in DATA_DIR rather than in public/). Registered BEFORE express.static.
app.get("/concepts.json", (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.json(CONCEPTS);
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
app.get("/api/search", searchLimiter, (req, res) => {
  const q = String(req.query.q || "");
  const results = EkpaSearch.search(PROGRAMS, CONCEPTS, q, 40);
  trackSearch(req.ip, q, results.length); // visibility only — does not affect ranking
  res.json(results);
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
  res.set("Cache-Control", "public, max-age=300");
  res.json(PROGRAMS);
});

// Healthcheck target (Railway Settings → Healthcheck Path / uptime monitors).
app.get("/health", (req, res) => res.json({ ok: true, programs: PROGRAMS.length }));

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

app.post("/api/admin/concepts", adminLimiter, checkAdminToken, (req, res) => {
  const incoming = req.body;
  if (!isValidConceptsShape(incoming)) {
    return res.status(400).json({ error: "Μη έγκυρη μορφή taxonomy (αναμένεται { concept_key: [\"λέξη\", ...] }, με μη κενές τιμές)." });
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
