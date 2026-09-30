// Focused tests for Checkpoint A (official category intent) in
// public/search-engine.js. Deliberately separate from
// test/search-engine.test.js (the ranking-drift fixture) - this file tests
// the NEW category-intent behavior directly against the real catalog,
// per the task's instruction to use the real programs.json/category names
// wherever practical, and never touches/regenerates the fixture.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.join(__dirname, "..");
const Engine = require(path.join(ROOT, "public/search-engine.js"));
const programs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/programs.json"), "utf-8"));
const concepts = JSON.parse(fs.readFileSync(path.join(ROOT, "public/concepts.json"), "utf-8"));

const MARKETING = "Marketing και Πωλήσεις";

function officialMembers(categoryName) {
  return programs.filter((p) => Engine.programBelongsToCategory(p, categoryName));
}

test("clear category intent ('marketing') resolves to the official Marketing category", () => {
  assert.equal(Engine.resolveCategoryIntent(programs, "marketing"), MARKETING);
});

test("clear category intent returns ONLY official Marketing category members", () => {
  const results = Engine.rank(programs, concepts, "marketing");
  const officialSlugs = new Set(officialMembers(MARKETING).map((p) => p.slug));
  assert.ok(results.length > 0, "expected at least one result");
  for (const r of results) {
    assert.ok(officialSlugs.has(r.slug), `"${r.slug}" is not an official Marketing member but was returned`);
  }
});

test("ALL official Marketing members are returned (not just the ones that already score > 0)", () => {
  const results = Engine.rank(programs, concepts, "marketing");
  const officialSlugs = officialMembers(MARKETING).map((p) => p.slug).sort();
  const returnedSlugs = results.map((p) => p.slug).sort();
  assert.deepEqual(returnedSlugs, officialSlugs);
});

test("a program outside Marketing cannot leak in through tags/description text", () => {
  // business-administration mentions marketing/sales-adjacent terms in its
  // free text but its real taxonomy membership is Business Administration
  // only - the exact false-positive class Checkpoint A exists to prevent
  // (this is the spec's own example).
  const ba = programs.find((p) => p.slug === "business-administration");
  assert.ok(ba, "fixture program business-administration must exist in the real dataset");
  assert.equal(Engine.programBelongsToCategory(ba, MARKETING), false);
  const results = Engine.rank(programs, concepts, "marketing");
  assert.ok(!results.some((p) => p.slug === "business-administration"));
});

test("accentless Greek resolves the same official category as the accented form", () => {
  assert.equal(Engine.resolveCategoryIntent(programs, "μαρκετινγκ") !== null, true);
  assert.equal(
    Engine.resolveCategoryIntent(programs, "μαρκετινγκ"),
    Engine.resolveCategoryIntent(programs, "μάρκετινγκ")
  );
});

test("category matching checks areas_of_study, not only primary_area", () => {
  // ai-marketing's primary_area is "Τεχνητή Νοημοσύνη (AI)" - it belongs to
  // Marketing only via its secondary areas_of_study entry.
  const p = programs.find((x) => x.slug === "ai-marketing");
  assert.ok(p, "fixture program ai-marketing must exist in the real dataset");
  assert.notEqual(p.primary_area, MARKETING);
  assert.ok(p.areas_of_study.includes(MARKETING));
  assert.equal(Engine.programBelongsToCategory(p, MARKETING), true);
  const results = Engine.rank(programs, concepts, "marketing");
  assert.ok(results.some((r) => r.slug === "ai-marketing"));
});

test("normal (non-category) search behaviour is unchanged for a query with no category intent", () => {
  // A query with no resolvable category at all must fall through to the
  // exact same scoring path as before (score > 0 filtering, no category
  // restriction) - verified here by confirming no category is resolved and
  // that results still come purely from positive-score matches.
  const query = "διαχείριση κρίσεων ξενοδοχείου";
  assert.equal(Engine.resolveCategoryIntent(programs, query), null);
  const results = Engine.rank(programs, concepts, query);
  assert.ok(results.every((p) => p._score > 0));
});

test("ambiguous/compound semantic queries are NOT forced into category-only mode", () => {
  const compoundQueries = [
    "marketing ξενοδοχείων",
    "AI για γιατρούς",
    "ψυχολογία παιδιού με ΔΕΠΥ",
    "διαχείριση κρίσεων ξενοδοχείου",
  ];
  for (const q of compoundQueries) {
    assert.equal(Engine.resolveCategoryIntent(programs, q), null, `"${q}" should not resolve to a single category`);
  }
});

test("a category member with original score 0 is still returned", () => {
  // "τουρισμός" (noun) resolves to "Τουριστικά" (adjective) only via the
  // explicit alias - the word itself doesn't appear in every member's own
  // text, so some genuine members score 0 against the raw query and must
  // still be included.
  const results = Engine.rank(programs, concepts, "τουρισμός");
  const zeroScored = results.filter((p) => p._score === 0);
  assert.ok(zeroScored.length > 0, "expected at least one zero-scored-but-included category member");
  for (const p of zeroScored) {
    assert.equal(Engine.programBelongsToCategory(p, "Τουριστικά"), true);
  }
});

test("result ordering is deterministic across repeated calls, including score ties", () => {
  const q1 = Engine.rank(programs, concepts, "marketing").map((p) => p.slug);
  const q2 = Engine.rank(programs, concepts, "marketing").map((p) => p.slug);
  assert.deepEqual(q1, q2);
  const q3 = Engine.rank(programs, concepts, "τουρισμός").map((p) => p.slug);
  const q4 = Engine.rank(programs, concepts, "τουρισμός").map((p) => p.slug);
  assert.deepEqual(q3, q4);
});

test("unsupported category-like queries with no matching official taxonomy entry fall back to normal search", () => {
  for (const q of ["μαγειρική", "chef", "σεφ"]) {
    assert.equal(Engine.resolveCategoryIntent(programs, q), null, `"${q}" has no official category and must not resolve`);
  }
});

test("English acronym embedded in an official category name ('AI') resolves correctly", () => {
  assert.equal(Engine.resolveCategoryIntent(programs, "AI"), "Τεχνητή Νοημοσύνη (AI)");
});

test("Κινηματογράφος - Θέατρο resolves from either half of the compound category name", () => {
  assert.equal(Engine.resolveCategoryIntent(programs, "θέατρο"), "Κινηματογράφος - Θέατρο");
  assert.equal(Engine.resolveCategoryIntent(programs, "κινηματογράφος"), "Κινηματογράφος - Θέατρο");
});
