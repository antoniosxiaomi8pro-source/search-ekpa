"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const Engine = require("../public/search-engine.js");

const PROGRAMS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/programs.json"), "utf8")
).filter((p) => p.status !== "inactive");

const CONCEPTS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/concepts.json"), "utf8")
);

const LEXICON = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/lexicon.json"), "utf8")
);

const ranking = (query) =>
  Engine.rank(PROGRAMS, CONCEPTS, query).map((p) => ({
    slug: p.slug,
    score: p._score
  }));

test.beforeEach(() => {
  Engine.resetLexicon();
  Engine.setLexicon(LEXICON);
});

test.afterEach(() => {
  Engine.resetLexicon();
});

test("A2: HRM resolves only through the curated token alias", () => {
  const expected = Engine.foldGreek(
    Engine.normalize("human resources")
  );

  for (const q of ["HRM", "hrm", "Hrm"]) {
    assert.equal(
      Engine.resolveCuratedTokenAliases(q),
      expected,
      q
    );
  }
});

test("A2: curated alias works at token level inside larger queries", () => {
  assert.equal(
    Engine.resolveCuratedTokenAliases("courses HRM"),
    Engine.foldGreek(Engine.normalize("courses human resources"))
  );

  assert.equal(
    Engine.resolveCuratedTokenAliases("HRM management"),
    Engine.foldGreek(Engine.normalize("human resources management"))
  );

  assert.equal(
    Engine.resolveCuratedTokenAliases("courses HRM management"),
    Engine.foldGreek(
      Engine.normalize("courses human resources management")
    )
  );
});

test("A2: substring-like forms are not aliases", () => {
  for (const q of ["XHRM", "HRM2026", "myhrm"]) {
    assert.equal(
      Engine.resolveCuratedTokenAliases(q),
      null,
      q
    );
  }
});

test("A2: unknown acronyms are never guessed", () => {
  for (const q of ["ABC", "XYZ", "QWE"]) {
    assert.equal(
      Engine.resolveCuratedTokenAliases(q),
      null,
      q
    );
  }
});

test("A2: HRM has complete ranking parity with human resources", () => {
  const canonical = ranking("human resources");
  const alias = ranking("HRM");

  assert.ok(
    canonical.length > 0,
    "human resources should return results"
  );

  assert.deepEqual(
    alias,
    canonical,
    "HRM must behave exactly as the curated human resources intent"
  );
});

test("A2: token-level HRM query has canonical ranking parity", () => {
  assert.deepEqual(
    ranking("HRM management"),
    ranking("human resources management")
  );
});

test("A2: A1 still owns concatenated-query recognition", () => {
  assert.equal(
    Engine.resolveConcatenatedQuery(PROGRAMS, CONCEPTS, "hrm"),
    null
  );
});
