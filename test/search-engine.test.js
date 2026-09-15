// Regression test for public/search-engine.js.
//
// WHY THIS EXISTS: every fix made to search-engine.js/concepts.json during the 15/9/2026
// v4 rewrite (and the audit round that followed it) was verified by hand — run a fixed
// set of queries, compare the top-10 results before/after, confirm nothing unrelated
// changed. That process caught two real regressions (a coverage-bonus false-positive,
// and a synonym addition reordering an unrelated query) that would otherwise have shipped
// silently. This test file commits that same check to the repo so it runs for anyone,
// automatically, instead of living only in a scratch script.
//
// HOW TO UPDATE THE FIXTURE: when you deliberately change ranking behaviour (a new
// concept, a scoring tweak, a taxonomy fix) and confirm by hand that the new top-10 for
// the affected queries is correct, regenerate fixtures/search-regression.json with:
//
//   npm run update-fixture
//
// then review the diff like any other code change — a fixture diff IS the changelog of
// what this update did to search ranking. Do not regenerate it to make a failing test
// pass without first understanding WHY the ranking changed.
//
// NOTE: the fixture-regenerating script lives in scripts/, NOT test/ — Node's test
// runner auto-discovers any .js file directly inside a directory named test/, so a
// "test" that overwrites its own expected baseline every run would defeat the whole
// point. Keep it that way.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.join(__dirname, "..");
const Engine = require(path.join(ROOT, "public/search-engine.js"));
const programs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/programs.json"), "utf-8"));
const concepts = JSON.parse(fs.readFileSync(path.join(ROOT, "public/concepts.json"), "utf-8"));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/search-regression.json"), "utf-8"));

test("search-engine.js: known-good top-10 rankings are unchanged", () => {
  const failures = [];
  for (const [query, expectedTop10] of Object.entries(fixture)) {
    const actualTop10 = Engine.rank(programs, concepts, query)
      .slice(0, 10)
      .map((p) => p.slug);
    if (JSON.stringify(actualTop10) !== JSON.stringify(expectedTop10)) {
      failures.push({ query, expected: expectedTop10, actual: actualTop10 });
    }
  }
  if (failures.length) {
    const detail = failures
      .map((f) => `\n  "${f.query}"\n    expected: ${JSON.stringify(f.expected)}\n    actual:   ${JSON.stringify(f.actual)}`)
      .join("\n");
    assert.fail(
      `${failures.length}/${Object.keys(fixture).length} queries changed ranking.${detail}\n\n` +
        `If this change is intentional and you have manually verified the new results are ` +
        `correct, regenerate the fixture with "npm run update-fixture" and commit the diff.`
    );
  }
});

test("search-engine.js: sanity checks that catch data corruption, not just ranking drift", () => {
  assert.ok(programs.length > 0, "programs.json must not be empty");
  const slugs = programs.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length, "every program slug must be unique (click-tracking relies on this)");
  assert.ok(Object.keys(concepts).length > 0, "concepts.json must not be empty");
  for (const [key, terms] of Object.entries(concepts)) {
    assert.ok(Array.isArray(terms) && terms.length > 0, `concept "${key}" must have at least one term`);
  }
});
