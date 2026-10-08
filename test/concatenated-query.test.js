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

const ranking = (query, concepts = CONCEPTS) =>
  Engine.rank(PROGRAMS, concepts, query).map((p) => ({
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

test("joined ειδικηαγωγη resolves to the known Ειδική Αγωγή phrase", () => {
  const expected = Engine.foldGreek(Engine.normalize("Ειδική Αγωγή"));
  assert.equal(
    Engine.resolveConcatenatedQuery(PROGRAMS, CONCEPTS, "ειδικηαγωγη"),
    expected
  );
});

test("joined and spaced Ειδική Αγωγή have identical complete rankings", () => {
  assert.deepEqual(
    ranking("ειδικηαγωγη"),
    ranking("ειδική αγωγή")
  );
});

test("case and accent variants resolve identically", () => {
  const expected = Engine.foldGreek(Engine.normalize("Ειδική Αγωγή"));
  for (const q of ["ΕΙΔΙΚΗΑΓΩΓΗ", "ειδικήαγωγή", "ειδικηαγωγη"]) {
    assert.equal(
      Engine.resolveConcatenatedQuery(PROGRAMS, CONCEPTS, q),
      expected,
      q
    );
  }
});

test("compound recognition works inside a larger query", () => {
  assert.deepEqual(
    ranking("θέλω ειδικηαγωγη"),
    ranking("θέλω ειδική αγωγή")
  );
});

test("the mechanism is generic, not hardcoded to Ειδική Αγωγή", () => {
  const expected = Engine.foldGreek(Engine.normalize("Τεχνητή Νοημοσύνη"));
  assert.equal(
    Engine.resolveConcatenatedQuery(PROGRAMS, CONCEPTS, "τεχνητηνοημοσυνη"),
    expected
  );
});

test("unknown joined text is left untouched", () => {
  assert.equal(
    Engine.resolveConcatenatedQuery(PROGRAMS, CONCEPTS, "τυχαιακολλημενηλεξη"),
    null
  );
});

test("HRM is not treated as a compound phrase", () => {
  assert.equal(
    Engine.resolveConcatenatedQuery(PROGRAMS, CONCEPTS, "hrm"),
    null
  );
});

test("ambiguous joined signatures fail closed", () => {
  const concepts = JSON.parse(JSON.stringify(CONCEPTS));
  concepts.__compound_test_a = ["αβ γδε"];
  concepts.__compound_test_b = ["αβγ δε"];

  assert.equal(
    Engine.resolveConcatenatedQuery(PROGRAMS, concepts, "αβγδε"),
    null
  );
});
