"use strict";
// Runs in a worker thread (its own copy of the search engine), so comparing two lexicons never
// changes the lexicon visitors are being served and never blocks their searches.
const { parentPort, workerData } = require("node:worker_threads");
const Engine = require("../public/search-engine.js");

const { programs, concepts, queries, current, candidate, shadowProbes } = workerData;

function runAll(lexicon) {
  if (lexicon) Engine.setLexicon(lexicon); else Engine.resetLexicon();
  const out = {};
  for (const q of queries) {
    const r = Engine.rank(programs, concepts, q);
    out[q] = { total: r.length, top: r.slice(0, 10).map((p) => p.slug) };
  }
  return out;
}

try {
  const before = runAll(current);
  const after = runAll(candidate);
  // Words placed in an audience/topic group that the engine already reads as a CATEGORY: the
  // category rule runs first, so the rule would never apply.
  const shadow = {};
  for (const word of shadowProbes) {
    const cat = Engine.resolveCategoryIntent(programs, word);
    if (cat) shadow[word] = cat;
  }
  parentPort.postMessage({ ok: true, before, after, shadow });
} catch (e) {
  parentPort.postMessage({ ok: false, error: e.message });
}
