// EKPA Smart Finder - backend
//
// The browser NEVER sees an API key. It only talks to this server's /api/chat
// endpoint. This server does the retrieval (same search-engine.js the frontend
// uses for instant search) and then calls whichever LLM provider you configured,
// using a key that lives only in this process's environment variables.
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const EkpaSearch = require("../public/search-engine.js");

const PROGRAMS = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/programs.json"), "utf-8"));
const CONCEPTS = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/concepts.json"), "utf-8"));

const PORT = process.env.PORT || 8787;
// Choose provider with LLM_PROVIDER=anthropic|openai|gemini in your .env
const PROVIDER = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();

const app = express();
app.use(cors());
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

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Λείπει το πεδίο 'message'." });
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
app.get("/api/search", (req, res) => {
  const q = req.query.q || "";
  res.json(EkpaSearch.search(PROGRAMS, CONCEPTS, q, 40));
});

app.listen(PORT, () => {
  console.log(`EKPA Smart Finder backend listening on http://localhost:${PORT}`);
  console.log(`LLM provider: ${PROVIDER} (set LLM_PROVIDER in .env to change: anthropic | openai | gemini)`);
});
