// R1 step 1: public/lexicon.json (readable Greek) must be EXACTLY equivalent to the tables
// inside the protected search engine - nothing missing, nothing extra.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { verify, loadEngineTables, SCHEMA_VERSION } = require("../scripts/build-lexicon-seed.js");

const lexicon = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/lexicon.json"), "utf8"));
const { E } = loadEngineTables();

test("lexicon.json: schema version and shape", () => {
  assert.equal(lexicon.schema_version, SCHEMA_VERSION);
  for (const k of ["stopwords", "category_words", "audience_categories", "audience_programs", "topics"]) assert.ok(Array.isArray(lexicon[k]), k);
});

test("lexicon.json: compiles to exactly the engine's tables", () => {
  assert.doesNotThrow(() => verify(lexicon, E));
});

test("lexicon.json: words are real Greek spellings, not folded keys", () => {
  const words = [...lexicon.category_words.map((e) => e.word), ...lexicon.audience_categories.flatMap((g) => g.words)];
  assert.ok(words.includes("δάσκαλος") && words.includes("μάρκετινγκ") && words.includes("ναυτικός"));
  assert.ok(words.some((w) => /[άέήίόύώ]/.test(w)), "accented words expected");
});

test("proof is not vacuous: a changed word, a missing word or an extra word is detected", () => {
  const clone = () => JSON.parse(JSON.stringify(lexicon));
  const changed = clone(); changed.category_words[0].category = "Τουριστικά";
  assert.throws(() => verify(changed, E));
  const missing = clone(); missing.stopwords.pop();
  assert.throws(() => verify(missing, E));
  const extra = clone(); extra.topics[0].words.push("μάγειρας");
  assert.throws(() => verify(extra, E));
});

test("every program the lexicon names exists in the catalog", () => {
  const slugs = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, "../public/programs.json"), "utf8")).map((p) => p.slug));
  [...lexicon.audience_programs, ...lexicon.topics].forEach((g) => g.programs.forEach((s) => assert.ok(slugs.has(s), s)));
});

test("every category the lexicon names exists on the site", () => {
  const cats = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, "../public/categories.json"), "utf8")).categories.map((c) => c.name));
  [...lexicon.category_words.map((e) => e.category), ...lexicon.audience_categories.flatMap((g) => g.categories)]
    .forEach((c) => assert.ok(cats.has(c), c));
});
