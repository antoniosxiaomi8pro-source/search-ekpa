"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const Engine = require("../public/search-engine.js");

const ROOT = path.join(__dirname, "..");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function sha256(rel) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(ROOT, rel)))
    .digest("hex");
}

const BASELINE = readJson("test/fixtures/protected-search-baseline.json");
const PROGRAMS = readJson("public/programs.json").filter(
  (p) => p.status !== "inactive"
);
const CONCEPTS = readJson("public/concepts.json");
const LEXICON = readJson("public/lexicon.json");

test("protected baseline: validated search results must not drift", () => {
  Engine.setLexicon(LEXICON);

  for (const [query, expected] of Object.entries(
    BASELINE.protected_queries
  )) {
    const actual = Engine.rank(PROGRAMS, CONCEPTS, query);

    assert.equal(
      actual.length,
      expected.total,
      `Protected query "${query}" changed total results`
    );

    const actualTop10 = actual.slice(0, 10).map((r) => ({
      slug: r.slug,
      score: r._score
    }));

    assert.deepEqual(
      actualTop10,
      expected.top10,
      `Protected query "${query}" changed protected top-10 ranking`
    );
  }

  Engine.resetLexicon();
});

test("protected baseline: validated core files must not change silently", () => {
  for (const [file, expectedHash] of Object.entries(
    BASELINE.protected_file_hashes
  )) {
    assert.equal(
      sha256(file),
      expectedHash,
      `Protected file changed without updating the protected baseline: ${file}`
    );
  }
});
