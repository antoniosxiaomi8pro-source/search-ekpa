"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const E = require("../public/search-engine.js");

const PROGRAMS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/programs.json"), "utf8")
).filter((p) => p.status !== "inactive");

const CONCEPTS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/concepts.json"), "utf8")
);

const LEXICON = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/lexicon.json"), "utf8")
);

const ranked = (q) => E.rank(PROGRAMS, CONCEPTS, q);

test.beforeEach(() => {
  E.resetLexicon();
  E.setLexicon(LEXICON);
});

test.afterEach(() => {
  E.resetLexicon();
});

test("A4: άνοια does not leak into unrelated -ανια words", () => {
  const titles = ranked("άνοια").map((x) => x.title);

  assert.ok(
    titles.includes("Άνοια: Πρόληψη, Διάγνωση και Αντιμετώπιση"),
    "the real dementia program must remain"
  );

  for (const bad of [
    "Μη Εξυπηρετούμενα Δάνεια (NPLs) και Ευρωπαϊκές Τράπεζες",
    "Εισαγωγή στη Νανοϊατρική",
    "Βιομηχανία CO2 - Carbon Capture, Storage & Utilization (CCS & CCU)"
  ]) {
    assert.ok(
      !titles.includes(bad),
      `"${bad}" must not match άνοια through an internal substring`
    );
  }
});

test("A4: εικαστικά does not leak into δικαστική", () => {
  const results = ranked("εικαστικά");
  const titles = results.map((x) => x.title);

  assert.ok(
    titles.includes(
      "Εικαστική Δραστηριότητα στην Παιδική Ηλικία: Σύγχρονες Προσεγγίσεις και Ψηφιακές Δεξιότητες"
    ),
    "the real visual-arts program must remain"
  );

  assert.ok(
    !titles.includes("Δικαστική - Ψυχιατροδικαστική Ψυχολογία"),
    "δικαστική must not match εικαστικά through fuzzy-expanded internal containment"
  );
});

test("A4: legitimate prefix typeahead remains intact", () => {
  const titles = ranked("φιλολο").slice(0, 3).map((x) => x.title);

  assert.deepEqual(titles, [
    "Αρχαία Ελληνικά για Αρχάριους",
    "Διδακτική Νεοελληνικών Κειμένων",
    "Μεθοδολογία και Διδακτική της Ιστορίας"
  ]);
});

test("A4: market still matches marketing by prefix", () => {
  const slugs = ranked("market").slice(0, 10).map((x) => x.slug);

  assert.ok(
    slugs.includes("marketing-kai-texnikes-pwlhsewn"),
    "market must still match marketing as a legitimate prefix"
  );
});

test("A4: A3 phrase intent remains active", () => {
  const results = ranked("Τρίτη ηλικία");

  assert.match(results[0].title, /Τρίτης Ηλικίας/i);
  assert.match(results[1].title, /Τρίτης Ηλικίας/i);
});

test("A5 prerequisite: missing doubled consonant is recovered anywhere after the shared prefix", () => {
  const query = "απορριμάτων";
  const targetSlug = "diaxeirisi-aporrimmaton-eksupni-astiki-diaxeirisi";

  const results = E.rank(PROGRAMS, CONCEPTS, query);
  const target = results.find((p) => p.slug === targetSlug);

  assert.ok(
    target,
    "απορριμάτων must recover Απορριμμάτων despite the missing doubled μ"
  );
  assert.equal(
    results[0].slug,
    targetSlug,
    "the exact waste-management title must rank first for απορριμάτων"
  );
});

test("A5: governed multi-term query resolves the waste-management intent", () => {
  const results = ranked("ειδικός απορριμάτων");
  const targetSlug = "diaxeirisi-aporrimmaton-eksupni-astiki-diaxeirisi";

  assert.ok(results.length > 0);
  assert.equal(
    results[0].slug,
    targetSlug,
    "ειδικός απορριμάτων must resolve to the waste-management program"
  );
});
