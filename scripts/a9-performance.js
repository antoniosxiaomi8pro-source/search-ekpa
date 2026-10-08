"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const ROOT = path.join(__dirname, "..");
const Engine = require(path.join(ROOT, "public/search-engine.js"));

const RAW_PROGRAMS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/programs.json"), "utf8")
).filter((p) => p.status !== "inactive");

const CONCEPTS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/concepts.json"), "utf8")
);

const LEXICON = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/lexicon.json"), "utf8")
);

Engine.setLexicon(LEXICON);

const CASES = [
  ["baseline", "αθλητική ψυχολογία"],
  ["phrase", "Τρίτη ηλικία"],
  ["concatenated", "ειδικηαγωγη"],
  ["acronym", "HRM"],
  ["token-safety-1", "άνοια"],
  ["token-safety-2", "εικαστικά"],
  ["multi-term", "ειδικός απορριμάτων"],
  ["typo", "ψυχολογιαα"],
  ["greeklish", "tourismos"],
  ["category-alias", "σινεμα"],
  ["high-result", "ψυχολογία"],
];

const STARTUP_RUNS = 10;
const UNCACHED_RUNS = 50;
const WARM_RUNS = 200;

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

function stats(values) {
  return {
    median: percentile(values, 50),
    p95: percentile(values, 95),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function clonePrograms() {
  return structuredClone(RAW_PROGRAMS);
}

function measureStartup(query) {
  const times = [];
  const counts = [];

  for (let i = 0; i < STARTUP_RUNS; i += 1) {
    const programs = clonePrograms();

    const t0 = performance.now();
    const results = Engine.rank(programs, CONCEPTS, query);
    const t1 = performance.now();

    times.push(t1 - t0);
    counts.push(results.length);
  }

  return { times, counts, stats: stats(times) };
}

function measureUncached(query) {
  const programs = RAW_PROGRAMS;

  // Build and warm the program/index structures first.
  Engine.rank(programs, CONCEPTS, "__a9_index_warmup__");

  const times = [];
  const counts = [];

  for (let i = 0; i < UNCACHED_RUNS; i += 1) {
    // Different raw cache key, same normalized semantic query.
    const uncachedQuery = query + " ".repeat(i + 1);

    const t0 = performance.now();
    const results = Engine.rank(programs, CONCEPTS, uncachedQuery);
    const t1 = performance.now();

    times.push(t1 - t0);
    counts.push(results.length);
  }

  return { times, counts, stats: stats(times) };
}

function measureWarm(query) {
  const programs = RAW_PROGRAMS;

  Engine.rank(programs, CONCEPTS, query);

  const times = [];
  const counts = [];

  for (let i = 0; i < WARM_RUNS; i += 1) {
    const t0 = performance.now();
    const results = Engine.rank(programs, CONCEPTS, query);
    const t1 = performance.now();

    times.push(t1 - t0);
    counts.push(results.length);
  }

  return { times, counts, stats: stats(times) };
}

function allEqual(values) {
  return values.every((value) => value === values[0]);
}

console.log("A9 Local Performance Characterization");
console.log("Active programs:", RAW_PROGRAMS.length);
console.log("Startup runs/query:", STARTUP_RUNS);
console.log("Uncached runs/query:", UNCACHED_RUNS);
console.log("Warm runs/query:", WARM_RUNS);
console.log("");

let consistencyFailure = false;

for (const [name, query] of CASES) {
  const startup = measureStartup(query);
  const uncached = measureUncached(query);
  const warm = measureWarm(query);

  const countsConsistent =
    allEqual(startup.counts) &&
    allEqual(uncached.counts) &&
    allEqual(warm.counts) &&
    startup.counts[0] === uncached.counts[0] &&
    uncached.counts[0] === warm.counts[0];

  if (!countsConsistent) consistencyFailure = true;

  console.log(
    `${name.padEnd(16)} | ${query.padEnd(24)} | ` +
    `n=${String(warm.counts[0]).padStart(3)} | ` +
    `startup med=${startup.stats.median.toFixed(3)} p95=${startup.stats.p95.toFixed(3)} ms | ` +
    `uncached med=${uncached.stats.median.toFixed(3)} p95=${uncached.stats.p95.toFixed(3)} ms | ` +
    `warm med=${warm.stats.median.toFixed(4)} p95=${warm.stats.p95.toFixed(4)} ms | ` +
    `consistency=${countsConsistent ? "PASS" : "FAIL"}`
  );
}

console.log("");
console.log(
  consistencyFailure
    ? "A9 RESULT CONSISTENCY: FAIL"
    : "A9 RESULT CONSISTENCY: PASS"
);
