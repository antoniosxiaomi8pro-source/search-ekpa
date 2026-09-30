// Focused tests for Checkpoint B (audience / profession / need intent) in
// public/search-engine.js. Deliberately separate from test/category-intent.test.js
// (Checkpoint A) and test/search-engine.test.js (the ranking-drift fixture) - this
// file tests the NEW audience/profession/need-intent mechanisms directly against
// the real catalog, and never touches/regenerates the fixture.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.join(__dirname, "..");
const Engine = require(path.join(ROOT, "public/search-engine.js"));
const programs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/programs.json"), "utf-8"));
const concepts = JSON.parse(fs.readFileSync(path.join(ROOT, "public/concepts.json"), "utf-8"));

const PAIDAGOGIKA = "Παιδαγωγικά"; // Παιδαγωγικά
const MORIODOTOUMENA =
  "Μοριοδοτούμενα Προγράμματα Παιδαγωγικών & Ειδικής Αγωγής"; // Μοριοδοτούμενα Προγράμματα Παιδαγωγικών & Ειδικής Αγωγής
const NAUTILIAKA = "Ναυτιλιακά"; // Ναυτιλιακά
const THEATRO = "Κινηματογράφος - Θέατρο"; // Κινηματογράφος - Θέατρο

function officialMembers(categoryName) {
  return programs.filter((p) => Engine.programBelongsToCategory(p, categoryName));
}

// ---- Type A (single official category): ναυτικός / ηθοποιός clusters ----

test("ναυτικός/ναυτικοί/ναυτικούς/ναυτικού/ναυτικών all resolve to the official Ναυτιλιακά category", () => {
  for (const w of ["ναυτικός", "ναυτικοί", "ναυτικούς", "ναυτικού", "ναυτικών"]) {
    assert.equal(Engine.resolveCategoryIntent(programs, w), NAUTILIAKA, `"${w}" should resolve to Ναυτιλιακά`);
  }
});

test("\"προγράμματα για ναυτικούς\" resolves to Ναυτιλιακά and returns exactly its official members", () => {
  const results = Engine.rank(programs, concepts, "προγράμματα για ναυτικούς");
  const officialSlugs = officialMembers(NAUTILIAKA).map((p) => p.slug).sort();
  assert.deepEqual(results.map((p) => p.slug).sort(), officialSlugs);
  assert.ok(results.length > 0);
});

test("ηθοποιός/ηθοποιοί/ηθοποιούς/ηθοποιού/ηθοποιών all resolve to the official Κινηματογράφος - Θέατρο category", () => {
  for (const w of ["ηθοποιός", "ηθοποιοί", "ηθοποιούς", "ηθοποιού", "ηθοποιών"]) {
    assert.equal(Engine.resolveCategoryIntent(programs, w), THEATRO, `"${w}" should resolve to Θέατρο`);
  }
});

test("\"προγράμματα για ηθοποιούς\" resolves to Κινηματογράφος - Θέατρο and returns exactly its official members", () => {
  const results = Engine.rank(programs, concepts, "προγράμματα για ηθοποιούς");
  const officialSlugs = officialMembers(THEATRO).map((p) => p.slug).sort();
  assert.deepEqual(results.map((p) => p.slug).sort(), officialSlugs);
  assert.ok(results.length > 0);
});

// ---- Type A, multi-category: δάσκαλος / εκπαιδευτικός clusters ----

test("δάσκαλος/δασκάλα/δάσκαλοι/δασκάλες/δασκάλους/δασκάλου resolve to the combined Παιδαγωγικά + Μοριοδοτούμενα set", () => {
  const expected = [PAIDAGOGIKA, MORIODOTOUMENA];
  for (const w of ["δάσκαλος", "δασκάλα", "δάσκαλοι", "δασκάλες", "δασκάλους", "δασκάλου"]) {
    const got = Engine.resolveAudienceMultiCategoryIntent(programs, w);
    assert.deepEqual([...got].sort(), [...expected].sort(), `"${w}" should resolve to both Παιδαγωγικά and Μοριοδοτούμενα`);
  }
});

test("εκπαιδευτικός/εκπαιδευτικού/εκπαιδευτικοί/εκπαιδευτικούς/εκπαιδευτικών resolve to the combined Παιδαγωγικά + Μοριοδοτούμενα set", () => {
  const expected = [PAIDAGOGIKA, MORIODOTOUMENA];
  for (const w of ["εκπαιδευτικός", "εκπαιδευτικού", "εκπαιδευτικοί", "εκπαιδευτικούς", "εκπαιδευτικών"]) {
    const got = Engine.resolveAudienceMultiCategoryIntent(programs, w);
    assert.deepEqual([...got].sort(), [...expected].sort(), `"${w}" should resolve to both Παιδαγωγικά and Μοριοδοτούμενα`);
  }
});

test("\"πρόγραμμα για δασκάλους\" and \"προγράμματα για εκπαιδευτικούς\" return the union of Παιδαγωγικά + Μοριοδοτούμενα members, deduplicated", () => {
  const unionSlugs = new Set([...officialMembers(PAIDAGOGIKA), ...officialMembers(MORIODOTOUMENA)].map((p) => p.slug));
  for (const q of ["πρόγραμμα για δασκάλους", "προγράμματα για εκπαιδευτικούς"]) {
    const results = Engine.rank(programs, concepts, q);
    const resultSlugs = results.map((p) => p.slug);
    assert.equal(new Set(resultSlugs).size, resultSlugs.length, `"${q}": no duplicate programs`);
    assert.deepEqual(new Set(resultSlugs), unionSlugs, `"${q}" should return exactly the deduplicated union`);
  }
});

test("adjectival/neuter forms of εκπαιδευτικός are deliberately NOT wired to the audience alias (avoids firing on a bare adjective)", () => {
  for (const w of ["εκπαιδευτικό", "εκπαιδευτικά"]) {
    assert.equal(Engine.resolveAudienceMultiCategoryIntent(programs, w), null);
  }
});

// ---- φιλόλογος: REJECTED - zero data support anywhere in the catalog ----

test("φιλόλογος/φιλολόγους have no data-justified mapping and correctly resolve nothing (fall through to normal search, which itself has zero genuine matches - not an intent-resolution artifact)", () => {
  for (const w of ["φιλόλογος", "φιλολόγους"]) {
    assert.equal(Engine.resolveCategoryIntent(programs, w), null);
    assert.equal(Engine.resolveAudienceMultiCategoryIntent(programs, w), null);
    assert.equal(Engine.resolveTopicIntent(programs, w), null);
  }
});

// ---- Type B (controlled topic set): chef / σεφ / μαγειρική ----

const COOKING_SLUGS = ["epaggelmatikh-mageirikh-sugxronh-kouzina", "epaggelmatikh-mageirikh-ellhnikh-kouzina"];

test("chef / σεφ / μαγειρική / μαγειρικής all resolve to the exact same 2-program controlled topic set", () => {
  for (const q of ["chef", "σεφ", "μαγειρική", "μαγειρικής"]) {
    const topic = Engine.resolveTopicIntent(programs, q);
    assert.deepEqual([...topic].sort(), [...COOKING_SLUGS].sort(), `"${q}" should resolve to the cooking topic set`);
  }
});

test("chef / σεφ return ONLY the 2 controlled-topic programs (they match nothing via ordinary scoring)", () => {
  for (const q of ["chef", "σεφ"]) {
    const results = Engine.rank(programs, concepts, q);
    assert.deepEqual(results.map((p) => p.slug).sort(), [...COOKING_SLUGS].sort(), `"${q}"`);
  }
});

test("μαγειρική already found these 2 programs via ordinary title matching; the topic set gives the identical result set", () => {
  const results = Engine.rank(programs, concepts, "μαγειρική");
  assert.deepEqual(results.map((p) => p.slug).sort(), [...COOKING_SLUGS].sort());
});

// ---- Type C (concept expansion): ΔΕΠΥ / μαθητής με ΔΕΠΥ ----

test("ΔΕΠΥ / δεπυ (any case/accent) prioritize the exact ΔΕΠ-Υ program and remain normal scored search", () => {
  const target = "eidiki-diapaidagogisi-parembasi-stin-diataraxi-elleimatikis-prosoxis-kai-yperkinitikotita-dep-y";
  for (const q of ["ΔΕΠΥ", "δεπυ"]) {
    const results = Engine.rank(programs, concepts, q);
    assert.ok(results.length > 0, `"${q}" should surface meaningful results`);
    assert.equal(results[0].slug, target, `"${q}" should rank the exact ΔΕΠ-Υ program first`);
    assert.equal(Engine.resolveCategoryIntent(programs, q), null);
    assert.equal(Engine.resolveAudienceMultiCategoryIntent(programs, q), null);
    assert.equal(Engine.resolveTopicIntent(programs, q), null);
  }
});

test("\"μαθητής με ΔΕΠΥ\" is NOT collapsed to category-only (μαθητής has no category of its own) and surfaces genuine special-education programs ranked ahead of generic noise", () => {
  const q = "μαθητής με ΔΕΠΥ";
  assert.equal(Engine.resolveCategoryIntent(programs, q), null);
  assert.equal(Engine.resolveAudienceMultiCategoryIntent(programs, q), null);
  assert.equal(Engine.resolveTopicIntent(programs, q), null);
  const results = Engine.rank(programs, concepts, q);
  assert.ok(results.length > 5);
  const top10 = results.slice(0, 10);
  const specialEdInTop10 = top10.filter(
    (p) =>
      Engine.programBelongsToCategory(p, "Ειδική Αγωγή") ||
      Engine.programBelongsToCategory(p, PAIDAGOGIKA)
  ).length;
  assert.ok(specialEdInTop10 >= 5, `expected most of the top 10 to be genuine special-education programs (got ${specialEdInTop10}/10)`);
});

test("the target ΔΕΠ-Υ program itself (whose real title punctuation splits the acronym into two normalize() tokens) is now discoverable for both queries, where before it did not appear at all", () => {
  const target = "eidiki-diapaidagogisi-parembasi-stin-diataraxi-elleimatikis-prosoxis-kai-yperkinitikotita-dep-y";
  assert.ok(programs.some((p) => p.slug === target), "fixture program must exist in the real dataset");
  for (const q of ["ΔΕΠΥ", "μαθητής με ΔΕΠΥ"]) {
    const results = Engine.rank(programs, concepts, q);
    assert.ok(results.some((p) => p.slug === target), `"${q}" should include the target ΔΕΠ-Υ program`);
  }
});

// ---- Negative tests (required): compound queries must NOT collapse to a single category ----

test("\"AI για γιατρούς\" does not collapse to pure AI category results", () => {
  const q = "AI για γιατρούς";
  assert.equal(Engine.resolveCategoryIntent(programs, q), null);
  assert.equal(Engine.resolveAudienceMultiCategoryIntent(programs, q), null);
  assert.equal(Engine.resolveTopicIntent(programs, q), null);
  const results = Engine.rank(programs, concepts, q);
  assert.ok(results.length > 0, "expected some results (not forced to zero)");
  assert.ok(
    !results.every((p) => Engine.programBelongsToCategory(p, "Τεχνητή Νοημοσύνη (AI)")),
    'results must not be restricted to ONLY the AI category'
  );
});

test("\"marketing ξενοδοχείων\" does not collapse to pure Marketing category results", () => {
  const q = "marketing ξενοδοχείων";
  assert.equal(Engine.resolveCategoryIntent(programs, q), null);
  assert.equal(Engine.resolveAudienceMultiCategoryIntent(programs, q), null);
  assert.equal(Engine.resolveTopicIntent(programs, q), null);
  const results = Engine.rank(programs, concepts, q);
  assert.ok(results.length > 0, "expected some results (not forced to zero)");
  assert.ok(
    !results.every((p) => Engine.programBelongsToCategory(p, "Marketing και Πωλήσεις")),
    'results must not be restricted to ONLY the Marketing category'
  );
});

test("intent resolution failing never forces zero results by itself: every query above either resolves confidently or falls through to normal scored search", () => {
  const queries = [
    "AI για γιατρούς",
    "marketing ξενοδοχείων",
    "μαθητής με ΔΕΠΥ",
  ];
  for (const q of queries) {
    const results = Engine.rank(programs, concepts, q);
    assert.ok(results.length > 0, `"${q}" must not silently return zero results`);
  }
});
