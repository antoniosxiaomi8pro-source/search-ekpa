const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Engine = require("../public/search-engine.js");
const Contract = require("../server/search-api-contract.js");

const programs = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../public/programs.json"), "utf8")
);
const concepts = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../public/concepts.json"), "utf8")
);

function slugs(items) {
  return items.map((p) => p.slug);
}

test("Checkpoint G: omitted sort preserves exact relevance order", () => {
  const ranked = Engine.rank(programs, concepts, "ψυχολογία");

  const actual = Contract.sortResults(ranked, undefined);

  assert.deepEqual(slugs(actual), slugs(ranked));
});

test("Checkpoint G: explicit relevance preserves exact relevance order", () => {
  const ranked = Engine.rank(programs, concepts, "ψυχολογία");

  const actual = Contract.sortResults(ranked, "relevance");

  assert.deepEqual(slugs(actual), slugs(ranked));
});

test("Checkpoint G: relevance sorting does not mutate ranked input", () => {
  const ranked = Engine.rank(programs, concepts, "ψυχολογία");
  const before = slugs(ranked);

  Contract.sortResults(ranked, "relevance");

  assert.deepEqual(slugs(ranked), before);
});

test("Checkpoint G: price_asc sorts priced results ascending and puts missing prices last", () => {
  const ranked = Engine.rank(programs, concepts, "ψυχολογία");

  const sorted = Contract.sortResults(ranked, "price_asc");

  let reachedMissingPrice = false;
  let previousPrice = -Infinity;

  for (const p of sorted) {
    const hasPrice =
      p.price !== null &&
      p.price !== undefined &&
      p.price !== "";

    if (!hasPrice) {
      reachedMissingPrice = true;
      continue;
    }

    assert.equal(
      reachedMissingPrice,
      false,
      "priced result appeared after a result without price"
    );

    const price = Number(p.price);
    assert.equal(Number.isFinite(price), true);
    assert.ok(
      price >= previousPrice,
      "prices are not in ascending order"
    );

    previousPrice = price;
  }
});

test("Checkpoint G: price_asc preserves relevance order when prices are equal", () => {
  const ranked = Engine.rank(programs, concepts, "ψυχολογία");

  const sorted = Contract.sortResults(ranked, "price_asc");

  const relevancePosition = new Map(
    ranked.map((p, i) => [p.slug, i])
  );

  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];

    if (
      a.price !== null &&
      a.price !== undefined &&
      a.price !== "" &&
      b.price !== null &&
      b.price !== undefined &&
      b.price !== "" &&
      Number(a.price) === Number(b.price)
    ) {
      assert.ok(
        relevancePosition.get(a.slug) < relevancePosition.get(b.slug),
        "equal-price results lost their relevance order"
      );
    }
  }
});

test("Checkpoint G: price_asc does not mutate original relevance ranking", () => {
  const ranked = Engine.rank(programs, concepts, "ψυχολογία");
  const before = slugs(ranked);

  Contract.sortResults(ranked, "price_asc");

  assert.deepEqual(slugs(ranked), before);
});

test("Checkpoint G: price-sorted pagination traverses complete result set exactly once", () => {
  const ranked = Engine.rank(programs, concepts, "ψυχολογία");
  const sorted = Contract.sortResults(ranked, "price_asc");

  const totalPages = Math.ceil(sorted.length / 40);
  const pages = [];

  for (let page = 1; page <= totalPages; page++) {
    const response = Contract.buildPagedResponse(sorted, {
      page: String(page),
      page_size: "40"
    });

    pages.push(...response.results);
  }

  assert.equal(pages.length, sorted.length);
  assert.deepEqual(slugs(pages), slugs(sorted));
  assert.equal(
    new Set(slugs(pages)).size,
    sorted.length,
    "duplicate or missing results across price-sorted pages"
  );
});

test("Checkpoint G: unknown sort safely falls back to relevance order", () => {
  const ranked = Engine.rank(programs, concepts, "ψυχολογία");

  const actual = Contract.sortResults(ranked, "something_invalid");

  assert.deepEqual(slugs(actual), slugs(ranked));
});
