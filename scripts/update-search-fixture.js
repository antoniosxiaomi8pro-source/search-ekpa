// Regenerates test/fixtures/search-regression.json from the CURRENT search-engine.js +
// programs.json + concepts.json — i.e. it captures "whatever the engine returns right now"
// as the new known-good baseline.
//
// Run this ONLY after you have manually verified (by actually searching, not just glancing
// at scores) that the new top-10 results for the queries below are correct. The resulting
// git diff of test/fixtures/search-regression.json is the real changelog of what your
// change did to ranking — read it before committing, the same way you'd read a code diff.
//
// Usage: npm run update-fixture
// To test a NEW query going forward, add it as a key to test/fixtures/search-regression.json
// (any placeholder value) and re-run this script.
"use strict";
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.join(__dirname, "..");
const Engine = require(path.join(ROOT, "public/search-engine.js"));
const programs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/programs.json"), "utf-8"));
const concepts = JSON.parse(fs.readFileSync(path.join(ROOT, "public/concepts.json"), "utf-8"));
const fixturePath = path.join(ROOT, "test/fixtures/search-regression.json");

const existing = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
const QUERIES = Object.keys(existing);

const fixture = {};
for (const q of QUERIES) {
  fixture[q] = Engine.rank(programs, concepts, q)
    .slice(0, 10)
    .map((p) => p.slug);
}
fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n");
console.log(`Wrote ${Object.keys(fixture).length} queries to ${path.relative(ROOT, fixturePath)}`);
console.log("Review the diff (git diff test/fixtures/search-regression.json) before committing.");
