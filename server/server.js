// EKPA Smart Finder - backend
//
// The browser NEVER sees an API key. It only talks to this server's /api/chat
// endpoint. This server does the retrieval (same search-engine.js the frontend
// uses for instant search) and then calls whichever LLM provider you configured,
// using a key that lives only in this process's environment variables.
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const EkpaSearch = require("../public/search-engine.js");

const PROGRAMS = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/programs.json"), "utf-8"));
let CONCEPTS = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/concepts.json"), "utf-8"));
const CONCEPTS_PATH = path.join(__dirname, "../public/concepts.json");

const PORT = process.env.PORT || 8787;
// Choose provider with LLM_PROVIDER=anthropic|openai|gemini in your .env
const PROVIDER = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();

// ---- CORS ----
// Στο Railway, όρισε το ALLOWED_ORIGINS ως env var από το dashboard (Variables tab),
// π.χ. "https://elearningekpa.gr,https://www.elearningekpa.gr" — δεν χρειάζεται
// redeploy για να το αλλάξεις, μόνο restart. Αν δεν οριστεί, πέφτει σε ένα λογικό
// default (production domain + localhost dev + το ίδιο το Railway app URL σου).
const DEFAULT_ORIGINS = [
  "https://elearningekpa.gr",
  "https://www.elearningekpa.gr",
  "http://localhost:8787",
  "http://localhost:3000",
];
const envOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = envOrigins.length ? envOrigins : DEFAULT_ORIGINS;
// Railway's own preview/public URL for THIS service (e.g. Custom Domain screen), useful
// while testing the widget straight against the *.up.railway.app URL before DNS is live.
const RAILWAY_PUBLIC_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : null;

function corsOriginCheck(origin, callback) {
  // Requests with no Origin header (curl, server-to-server health checks, Railway's
  // own healthcheck pings) are always allowed — they're not browser CORS requests.
  if (!origin) return callback(null, true);
  if (ALLOWED_ORIGINS.includes(origin) || origin === RAILWAY_PUBLIC_DOMAIN) {
    return callback(null, true);
  }
  return callback(new Error(`CORS: origin ${origin} δεν επιτρέπεται`));
}

// ---- Rate limiting ----
// Το /api/chat κάνει πραγματική (χρεώσιμη) κλήση σε LLM provider ανά request, οπότε
// έχει πιο αυστηριό όριο από το απλό /api/search. Και τα δύο μπορούν να ρυθμιστούν
// από env vars στο Railway χωρίς αλλαγή κώδικα.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.CHAT_RATE_LIMIT_PER_MIN || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Πολλά αιτήματα chat — δοκίμασε ξανά σε λίγο." },
});
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.SEARCH_RATE_LIMIT_PER_MIN || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Πολλά αιτήματα αναζήτησης — δοκίμασε ξανά σε λίγο." },
});
// Strict limit: this endpoint only exists to guard against someone guessing the
// admin token by brute force, so a low ceiling is intentional (a legitimate admin
// saves the taxonomy a handful of times per session, never 10x/minute).
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.ADMIN_RATE_LIMIT_PER_MIN || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Πολλά αιτήματα admin — δοκίμασε ξανά σε λίγο." },
});

const app = express();
app.set("trust proxy", 1); // Railway is behind a reverse proxy — needed for correct rate-limit IPs
app.use(cors({ origin: corsOriginCheck }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "../public")));

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
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

app.post("/api/chat", chatLimiter, async (req, res) => {
  try {
    const { message, history = [] } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Λείπει το πεδίο 'message'." });
    }
    if (message.length > 700) {
      return res.status(400).json({ error: "Το μήνυμα είναι πολύ μεγάλο (μέγιστο 700 χαρακτήρες)." });
    }
    const candidates = EkpaSearch.search(PROGRAMS, CONCEPTS, message, 8);
    const system = buildSystemPrompt(candidates);
    const fn = PROVIDERS[PROVIDER];
    if (!fn) return res.status(500).json({ error: `Άγνωστος LLM_PROVIDER: ${PROVIDER}` });

    const fullHistory = [...history, { role: "user", content: message }];
    const reply = await fn(system, fullHistory);
    res.json({ reply, candidates_used: candidates.map((c) => c.title) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Άγνωστο σφάλμα στον server." });
  }
});

// Plain retrieval endpoint too, in case the frontend ever wants search without chat
app.get("/api/search", searchLimiter, (req, res) => {
  const q = req.query.q || "";
  res.json(EkpaSearch.search(PROGRAMS, CONCEPTS, q, 40));
});

// Full catalog endpoint — PROGRAMS is already parsed once at startup (see top of
// this file), so this just serves it straight from memory, no disk read per request.
// Cache-Control lets the browser skip re-fetching on every page load; bump/remove
// this if programs.json starts changing more often than once every few minutes.
app.get("/api/programs", searchLimiter, (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json(PROGRAMS);
});

// Railway healthcheck target (Settings → Healthcheck Path). Lightweight, no rate limit,
// no CORS concerns since it's server-to-server.
app.get("/health", (req, res) => res.json({ ok: true, programs: PROGRAMS.length }));

// ---- Admin: taxonomy editing ----
// Protected by a shared secret (ADMIN_TOKEN env var), sent as the x-admin-token header.
// Anyone without the correct token gets 401 — no partial info leaked either way.
function checkAdminToken(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    // Fail closed: if no token is configured on the server, admin writes are disabled
    // entirely rather than silently open to anyone.
    return res.status(503).json({ error: "Το admin panel δεν έχει ρυθμιστεί (λείπει το ADMIN_TOKEN)." });
  }
  const provided = req.get("x-admin-token");
  if (provided !== expected) {
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
    // Write pretty-printed so the file stays hand-editable afterwards too.
    fs.writeFileSync(CONCEPTS_PATH, JSON.stringify(incoming, null, 2) + "\n", "utf-8");
    CONCEPTS = incoming; // update in-memory copy immediately — no redeploy needed
    res.json({ ok: true, concepts_count: Object.keys(CONCEPTS).length });
  } catch (err) {
    console.error("Αποτυχία εγγραφής concepts.json:", err);
    res.status(500).json({ error: "Αποτυχία αποθήκευσης στον server." });
  }
});

// CORS errors thrown by corsOriginCheck land here instead of crashing the process.
app.use((err, req, res, next) => {
  if (err && /^CORS:/.test(err.message)) {
    return res.status(403).json({ error: err.message });
  }
  return next(err);
});

app.listen(PORT, () => {
  console.log(`EKPA Smart Finder backend listening on http://localhost:${PORT}`);
  console.log(`LLM provider: ${PROVIDER} (set LLM_PROVIDER in .env to change: anthropic | openai | gemini)`);
  console.log(`Allowed CORS origins: ${ALLOWED_ORIGINS.join(", ")}${RAILWAY_PUBLIC_DOMAIN ? " + " + RAILWAY_PUBLIC_DOMAIN : ""}`);
});
