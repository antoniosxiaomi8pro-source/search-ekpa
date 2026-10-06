"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Preview = require("../server/concept-preview.js");
const Engine = require("../public/search-engine.js");

const ROOT = path.join(__dirname, "..");

const read = (rel) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

const PROGRAMS = read("public/programs.json");
const CONCEPTS = read("public/concepts.json");
const FIXTURE = read("test/fixtures/search-regression.json");
const BASELINE = read("test/fixtures/protected-search-baseline.json");
const LEXICON = read("public/lexicon.json");

Engine.setLexicon(LEXICON);

test("concept preview: empty draft changes nothing and protected baseline passes", async () => {
  const r = await Preview.previewConceptDraft({
    programsAll: PROGRAMS,
    concepts: CONCEPTS,
    fixture: FIXTURE,
    protectedBaseline: BASELINE,
    concept: "law",
    changes: []
  });

  assert.equal(r.draft_changes, 0);
  assert.equal(r.blocked, false);
  assert.equal(r.protected_baseline.ok, true);
});

test("concept preview: unknown program is rejected", () => {
  assert.throws(
    () =>
      Preview.applyDraftChanges(PROGRAMS, "law", [{
        slug: "this-program-does-not-exist",
        concept: "law",
        assigned: true,
        assignment_status: "REVIEW",
        source: "test",
        reason: "test"
      }]),
    /Άγνωστο πρόγραμμα/
  );
});

test("concept preview: removing law from a protected top result blocks preview", async () => {
  const slug =
    "paralegal-ekseidikeumeno-prosopiko-sto-xoro-paroxis-nomikon-ypiresion";

  const r = await Preview.previewConceptDraft({
    programsAll: PROGRAMS,
    concepts: CONCEPTS,
    fixture: FIXTURE,
    protectedBaseline: BASELINE,
    concept: "law",
    changes: [{
      slug,
      concept: "law",
      assigned: false,
      assignment_status: "REJECT",
      source: "test-preview",
      reason: "Protected baseline test"
    }]
  });

  assert.equal(r.blocked, true);
  assert.equal(r.protected_baseline.ok, false);
  assert.ok(
    r.protected_baseline.failures.some(
      (x) => ["legal", "λεγαλ", "law"].includes(x.query)
    )
  );
});

test("concept preview: NOT_ASSIGNED + CONFIRMED is rejected", () => {
  assert.throws(
    () => Preview.applyDraftChanges(PROGRAMS, "law", [{
      slug: "paralegal-ekseidikeumeno-prosopiko-sto-xoro-paroxis-nomikon-ypiresion",
      concept: "law",
      assigned: false,
      assignment_status: "CONFIRMED",
      source: "deterministic-audit-v2",
      reason: "test"
    }]),
    /CONFIRMED απαιτεί ενεργό concept assignment/
  );
});

test("concept preview: ASSIGNED + REJECT is rejected", () => {
  assert.throws(
    () => Preview.applyDraftChanges(PROGRAMS, "law", [{
      slug: "digital-marketing",
      concept: "law",
      assigned: true,
      assignment_status: "REJECT",
      source: "test",
      reason: "test"
    }]),
    /REJECT δεν επιτρέπεται μαζί με ενεργό concept assignment/
  );
});

test("concept preview: ASSIGNED + UNCLASSIFIED is rejected", () => {
  assert.throws(
    () => Preview.applyDraftChanges(PROGRAMS, "law", [{
      slug: "agglika-gia-oikonomologous",
      concept: "law",
      assigned: true,
      assignment_status: null,
      source: "",
      reason: ""
    }]),
    /ASSIGNED δεν επιτρέπεται χωρίς governance status/
  );
});

test("concept preview: NOT_ASSIGNED + CURATED remains valid", () => {
  const slug =
    "ekpaideusi-se-themata-ergasiakis-eueliksias-kai-episfalous-apasxolisis";

  assert.doesNotThrow(() =>
    Preview.applyDraftChanges(PROGRAMS, "law", [{
      slug,
      concept: "law",
      assigned: false,
      assignment_status: "CURATED",
      source: "law-v3-signed-semantic-review",
      reason: "Substantive legal relevance."
    }])
  );
});
