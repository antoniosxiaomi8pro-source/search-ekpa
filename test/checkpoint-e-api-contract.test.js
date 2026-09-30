const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Engine = require("../public/search-engine.js");
const Contract = require("../server/search-api-contract.js");

const programs = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/programs.json"), "utf8"));
const concepts = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/concepts.json"), "utf8"));

test("Checkpoint E: legacy search contract remains capped at 40", () => {
  assert.equal(Contract.clampLegacyLimit(undefined), 40);
  assert.equal(Contract.clampLegacyLimit("6"), 6);
  assert.equal(Contract.clampLegacyLimit("999"), 40);
});

test("Checkpoint E: paged contract caps each response at 40 but exposes exact totals", () => {
  const all = Engine.rank(programs, concepts, "ψυχολογία");
  assert.equal(all.length, 84);
  const p1 = Contract.buildPagedResponse(all, { page: "1", page_size: "999" });
  assert.equal(p1.results.length, 40);
  assert.deepEqual(p1.pagination, { page: 1, page_size: 40, total_results: 84, total_pages: 3, has_previous: false, has_next: true });
});

test("Checkpoint E: all 84 psychology results are traversable exactly once in stable order", () => {
  const all = Engine.rank(programs, concepts, "ψυχολογία");
  const pages = [1,2,3].flatMap(page => Contract.buildPagedResponse(all, { page: String(page), page_size: "40" }).results);
  assert.equal(pages.length, 84);
  assert.deepEqual(pages.map(x => x.slug), all.map(x => x.slug));
  assert.equal(new Set(pages.map(x => x.slug)).size, 84);
});

test("Checkpoint E: 81-result teacher audience is complete across three pages", () => {
  const all = Engine.rank(programs, concepts, "πρόγραμμα για δασκάλους");
  assert.equal(all.length, 81);
  const p3 = Contract.buildPagedResponse(all, { page: "3", page_size: "40" });
  assert.equal(p3.results.length, 1);
  assert.equal(p3.pagination.total_results, 81);
  assert.equal(p3.pagination.total_pages, 3);
  assert.equal(p3.pagination.has_next, false);
});

test("Checkpoint E: 52-result scoring-program category is complete across two pages", () => {
  const all = Engine.rank(programs, concepts, "μοριοδοτούμενα");
  assert.equal(all.length, 52);
  const p2 = Contract.buildPagedResponse(all, { page: "2", page_size: "40" });
  assert.equal(p2.results.length, 12);
  assert.equal(p2.pagination.total_pages, 2);
});

test("Checkpoint E: out-of-range page is empty but retains truthful metadata", () => {
  const all = Engine.rank(programs, concepts, "ψυχολογία");
  const p = Contract.buildPagedResponse(all, { page: "99", page_size: "40" });
  assert.equal(p.results.length, 0);
  assert.equal(p.pagination.total_results, 84);
  assert.equal(p.pagination.total_pages, 3);
  assert.equal(p.pagination.has_previous, true);
  assert.equal(p.pagination.has_next, false);
});

test("Checkpoint E: compact paged results contain only the established compact fields", () => {
  const all = Engine.rank(programs, concepts, "ψυχολογία");
  const p = Contract.buildPagedResponse(all, { page: "1", page_size: "2", fields: "compact" });
  assert.equal(p.results.length, 2);
  for (const r of p.results) assert.deepEqual(Object.keys(r), ["id", "slug", "title", "url", "image_url", "price"]);
});

test("Checkpoint E: zero-result pagination is internally consistent", () => {
  const p = Contract.buildPagedResponse([], { page: "1", page_size: "40" });
  assert.equal(p.results.length, 0);
  assert.deepEqual(p.pagination, { page: 1, page_size: 40, total_results: 0, total_pages: 0, has_previous: false, has_next: false });
});
