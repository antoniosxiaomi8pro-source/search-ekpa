"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  overlayGovernedConcepts
} = require("../server/concept-governance-overlay.js");

function program(slug, concepts = [], statuses = undefined, extra = {}) {
  const p = {
    slug,
    title: slug,
    concepts: [...concepts],
    ...extra
  };

  if (statuses !== undefined) {
    p.concept_assignment_status = JSON.parse(JSON.stringify(statuses));
  }

  return p;
}

test("governance overlay: CONFIRMED assigned survives package", () => {
  const pkg = [
    program("p1", ["finance"])
  ];

  const live = [
    program("p1", ["finance", "law"], {
      law: {
        status: "CONFIRMED",
        source: "manual",
        reason: "reviewed"
      }
    })
  ];

  const out = overlayGovernedConcepts(pkg, live);

  assert.deepEqual(out[0].concepts, ["finance", "law"]);
  assert.deepEqual(
    out[0].concept_assignment_status.law,
    live[0].concept_assignment_status.law
  );
});

test("governance overlay: REJECT not-assigned overrides package-generated assignment", () => {
  const pkg = [
    program("p1", ["finance", "law"])
  ];

  const live = [
    program("p1", ["finance"], {
      law: {
        status: "REJECT",
        source: "manual",
        reason: "false positive"
      }
    })
  ];

  const out = overlayGovernedConcepts(pkg, live);

  assert.deepEqual(out[0].concepts, ["finance"]);
  assert.equal(out[0].concept_assignment_status.law.status, "REJECT");
});

test("governance overlay: CURATED not-assigned survives", () => {
  const pkg = [
    program("p1", ["law", "health"])
  ];

  const live = [
    program("p1", ["health"], {
      law: {
        status: "CURATED",
        source: "semantic-review",
        reason: "relevant but intentionally not assigned"
      }
    })
  ];

  const out = overlayGovernedConcepts(pkg, live);

  assert.deepEqual(out[0].concepts, ["health"]);
  assert.equal(out[0].concept_assignment_status.law.status, "CURATED");
});

test("governance overlay: ungoverned concepts follow new package", () => {
  const pkg = [
    program("p1", ["tourism", "marketing"])
  ];

  const live = [
    program("p1", ["tourism", "old_generated"], {
      tourism: {
        status: "CONFIRMED",
        source: "manual",
        reason: "confirmed"
      }
    })
  ];

  const out = overlayGovernedConcepts(pkg, live);

  assert.deepEqual(
    out[0].concepts,
    ["tourism", "marketing"]
  );
});

test("governance overlay: new program remains untouched", () => {
  const pkg = [
    program("new-program", ["new_concept"], undefined, {
      price: 123
    })
  ];

  const live = [
    program("old-program", ["law"], {
      law: {
        status: "CONFIRMED",
        source: "manual",
        reason: "confirmed"
      }
    })
  ];

  const out = overlayGovernedConcepts(pkg, live);

  assert.deepEqual(out, pkg);
});

test("governance overlay: missing or renamed slug receives no overlay", () => {
  const pkg = [
    program("renamed-program", ["marketing"])
  ];

  const live = [
    program("old-program", ["law"], {
      law: {
        status: "CONFIRMED",
        source: "manual",
        reason: "confirmed"
      }
    })
  ];

  const out = overlayGovernedConcepts(pkg, live);

  assert.deepEqual(out, pkg);
});

test("governance overlay: source and reason are preserved exactly", () => {
  const status = {
    law: {
      status: "CURATED",
      source: "law-v3-signed-semantic-review",
      reason: "Exact governed reason with punctuation: α, β, γ."
    }
  };

  const pkg = [
    program("p1", [])
  ];

  const live = [
    program("p1", ["law"], status)
  ];

  const out = overlayGovernedConcepts(pkg, live);

  assert.deepEqual(
    out[0].concept_assignment_status.law,
    status.law
  );
});

test("governance overlay: input catalogs are never mutated", () => {
  const pkg = [
    program("p1", ["law", "finance"], {
      finance: {
        status: "CONFIRMED",
        source: "package",
        reason: "package governance"
      }
    })
  ];

  const live = [
    program("p1", ["finance"], {
      law: {
        status: "REJECT",
        source: "manual",
        reason: "rejected"
      }
    })
  ];

  const pkgBefore = JSON.stringify(pkg);
  const liveBefore = JSON.stringify(live);

  overlayGovernedConcepts(pkg, live);

  assert.equal(JSON.stringify(pkg), pkgBefore);
  assert.equal(JSON.stringify(live), liveBefore);
});
