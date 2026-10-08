"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const Engine = require(path.join(ROOT, "public/search-engine.js"));

const programs = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/programs.json"), "utf8")
).filter((p) => p.status !== "inactive");

const concepts = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/concepts.json"), "utf8")
);

const lexicon = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/lexicon.json"), "utf8")
);

Engine.setLexicon(lexicon);

const CATEGORY = "Ειδική Αγωγή";

function officialMembers() {
  return programs
    .filter(
      (p) =>
        p.primary_area === CATEGORY ||
        (Array.isArray(p.areas_of_study) &&
          p.areas_of_study.includes(CATEGORY))
    )
    .map((p) => p.slug)
    .sort();
}

test("exact official category query resolves Ειδική Αγωγή strictly", () => {
  const expected = officialMembers();

  assert.equal(expected.length, 22);

  assert.equal(
    Engine.resolveCategoryIntent(programs, "ειδικη αγωγη"),
    CATEGORY
  );

  const actual = Engine.rank(programs, concepts, "ειδικη αγωγη")
    .map((p) => p.slug)
    .sort();

  assert.deepEqual(actual, expected);
});

test("concatenated ειδικηαγωγη resolves to the same strict official category", () => {
  const expected = officialMembers();

  const actual = Engine.rank(programs, concepts, "ειδικηαγωγη")
    .map((p) => p.slug)
    .sort();

  assert.deepEqual(actual, expected);
});

test("ambiguous single words remain unresolved", () => {
  assert.equal(Engine.resolveCategoryIntent(programs, "ειδικη"), null);
  assert.equal(Engine.resolveCategoryIntent(programs, "αγωγη"), null);
});
