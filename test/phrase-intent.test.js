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

const BASE_LEXICON = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/lexicon.json"), "utf8")
);

const LEXICON = JSON.parse(JSON.stringify(BASE_LEXICON));
LEXICON.phrase_intents = [
  {
    id: "third_age",
    phrases: ["Τρίτη ηλικία", "Τρίτης ηλικίας"],
    terms: ["Τρίτη ηλικία", "Τρίτης ηλικίας", "άνοια", "Alzheimer"]
  }
];

const ranking = (query) =>
  Engine.rank(PROGRAMS, CONCEPTS, query).map((p) => ({
    slug: p.slug,
    title: p.title,
    score: p._score
  }));

test.beforeEach(() => {
  Engine.resetLexicon();
  Engine.setLexicon(LEXICON);
});

test.afterEach(() => {
  Engine.resetLexicon();
});

test("A3: curated phrase intent is recognized", () => {
  const intent = Engine.resolvePhraseIntent("Τρίτη ηλικία");

  assert.ok(intent);
  assert.equal(intent.id, "third_age");
});

test("A3: phrase intent suppresses loose constituent terms", () => {
  const expanded = Engine.expandQueryDetailed(
    "Τρίτη ηλικία",
    CONCEPTS,
    Engine.getVocabulary(PROGRAMS)
  );

  assert.ok(
    expanded.termsFlat.includes(
      Engine.foldGreek(Engine.normalize("Τρίτη ηλικία"))
    )
  );

  assert.ok(
    !expanded.termsFlat.includes(
      Engine.foldGreek(Engine.normalize("ηλικία"))
    ),
    "ηλικία must not survive as an independent loose relevance term"
  );
});

test("A3: exact third-age programs remain at the top", () => {
  const results = ranking("Τρίτη ηλικία");

  assert.match(results[0].title, /Τρίτης Ηλικίας/i);
  assert.match(results[1].title, /Τρίτης Ηλικίας/i);
});

test("A3: child-age programs are not relevant only because of ηλικία", () => {
  const results = ranking("Τρίτη ηλικία");

  const falsePositive = results.find((p) =>
    /Προσχολικής|Παιδικής|Σχολικής Ηλικίας/i.test(p.title)
  );

  assert.equal(
    falsePositive,
    undefined,
    "child-age programs must not rank from the loose ηλικία token"
  );
});

test("A3: unregistered multi-word queries keep normal expansion", () => {
  const expanded = Engine.expandQueryDetailed(
    "αθλητική ψυχολογία",
    CONCEPTS,
    Engine.getVocabulary(PROGRAMS)
  );

  assert.ok(
    expanded.termsFlat.includes(
      Engine.foldGreek(Engine.normalize("αθλητική"))
    )
  );

  assert.ok(
    expanded.termsFlat.includes(
      Engine.foldGreek(Engine.normalize("ψυχολογία"))
    )
  );
});

test("A3: A1 concatenated-query behavior remains available", () => {
  assert.ok(
    Engine.resolveConcatenatedQuery(
      PROGRAMS,
      CONCEPTS,
      "ειδικηαγωγη"
    )
  );
});

test("A3: A2 curated token aliases remain available", () => {
  assert.equal(
    Engine.resolveCuratedTokenAliases("HRM"),
    Engine.foldGreek(Engine.normalize("human resources"))
  );
});

test("A3: the same phrase cannot belong to two different intents", () => {
  const invalid = JSON.parse(JSON.stringify(BASE_LEXICON));

  invalid.phrase_intents = [
    {
      id: "third_age_a",
      phrases: ["Τρίτη ηλικία"],
      terms: ["άνοια"]
    },
    {
      id: "third_age_b",
      phrases: ["Τρίτη ηλικία"],
      terms: ["Alzheimer"]
    }
  ];

  assert.throws(
    () => Engine.compileLexicon(invalid),
    /phrase|φράσ|δύο|διαφορε/i
  );
});
