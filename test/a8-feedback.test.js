const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const Engine = require("../public/search-engine.js");

const programs = JSON.parse(
  fs.readFileSync("./public/programs.json", "utf8")
).filter((p) => p.status !== "inactive");

const concepts = JSON.parse(
  fs.readFileSync("./public/concepts.json", "utf8")
);

const lexicon = JSON.parse(
  fs.readFileSync("./public/lexicon.json", "utf8")
);

const CATEGORY = "Κινηματογράφος - Θέατρο";

test("A8 feedback: σινεμα resolves to the official Κινηματογράφος - Θέατρο category", () => {
  Engine.setLexicon(lexicon);

  assert.equal(
    Engine.resolveCategoryIntent(programs, "σινεμα"),
    CATEGORY
  );

  const expected = programs
    .filter(
      (p) =>
        p.primary_area === CATEGORY ||
        (p.areas_of_study || []).includes(CATEGORY)
    )
    .map((p) => p.slug)
    .sort();

  const actual = Engine.rank(programs, concepts, "σινεμα")
    .map((p) => p.slug)
    .sort();

  assert.deepEqual(actual, expected);
  assert.equal(actual.length, 21);

  Engine.resetLexicon();
});
