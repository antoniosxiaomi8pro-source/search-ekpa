"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { CatalogStore } = require("../server/catalog-store.js");

function tempDir() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "ekpa-catalog-governance-")
  );
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function p({
  slug = "program-1",
  title = "Program",
  checkedAt,
  concepts = [],
  statuses,
  price = 100
}) {
  const out = {
    slug,
    title,
    status: "active",
    status_checked_at: checkedAt,
    concepts: [...concepts],
    price
  };

  if (statuses !== undefined) {
    out.concept_assignment_status =
      JSON.parse(JSON.stringify(statuses));
  }

  return out;
}

test("CatalogStore: newer package preserves governed CONFIRMED assignment while package fields update", () => {
  const dir = tempDir();
  const seedFile = path.join(dir, "seed.json");
  const dataDir = path.join(dir, "data");

  writeJson(seedFile, [
    p({
      checkedAt: "2026-10-01T10:00:00Z",
      concepts: ["finance"],
      price: 100
    })
  ]);

  const first = new CatalogStore({
    seedFile,
    dataDir
  });

  first.load();

  first.apply([
    p({
      checkedAt: "2026-10-01T10:00:00Z",
      concepts: ["finance", "law"],
      statuses: {
        law: {
          status: "CONFIRMED",
          source: "manual-review",
          reason: "Explicitly confirmed."
        }
      },
      price: 100
    })
  ], { source: "concept-management" });

  writeJson(seedFile, [
    p({
      title: "Updated package title",
      checkedAt: "2026-10-02T10:00:00Z",
      concepts: ["finance"],
      price: 200
    })
  ]);

  const restarted = new CatalogStore({
    seedFile,
    dataDir
  });

  const live = restarted.load();

  assert.equal(live[0].title, "Updated package title");
  assert.equal(live[0].price, 200);
  assert.deepEqual(live[0].concepts, ["finance", "law"]);

  assert.deepEqual(
    live[0].concept_assignment_status.law,
    {
      status: "CONFIRMED",
      source: "manual-review",
      reason: "Explicitly confirmed."
    }
  );

  assert.ok(
    restarted.listBackups().some(
      (b) => b.reason === "replaced-by-package"
    )
  );
});

test("CatalogStore: governed REJECT removes package-generated concept", () => {
  const dir = tempDir();
  const seedFile = path.join(dir, "seed.json");
  const dataDir = path.join(dir, "data");

  writeJson(seedFile, [
    p({
      checkedAt: "2026-10-01T10:00:00Z",
      concepts: ["finance"]
    })
  ]);

  const first = new CatalogStore({
    seedFile,
    dataDir
  });

  first.load();

  first.apply([
    p({
      checkedAt: "2026-10-01T10:00:00Z",
      concepts: ["finance"],
      statuses: {
        law: {
          status: "REJECT",
          source: "manual-review",
          reason: "False positive."
        }
      }
    })
  ], { source: "concept-management" });

  writeJson(seedFile, [
    p({
      checkedAt: "2026-10-02T10:00:00Z",
      concepts: ["finance", "law"]
    })
  ]);

  const restarted = new CatalogStore({
    seedFile,
    dataDir
  });

  const live = restarted.load();

  assert.deepEqual(live[0].concepts, ["finance"]);
  assert.equal(
    live[0].concept_assignment_status.law.status,
    "REJECT"
  );
});

test("CatalogStore: ungoverned package concepts remain controlled by the new package", () => {
  const dir = tempDir();
  const seedFile = path.join(dir, "seed.json");
  const dataDir = path.join(dir, "data");

  writeJson(seedFile, [
    p({
      checkedAt: "2026-10-01T10:00:00Z",
      concepts: ["tourism", "old_generated"]
    })
  ]);

  const first = new CatalogStore({
    seedFile,
    dataDir
  });

  first.load();

  first.apply([
    p({
      checkedAt: "2026-10-01T10:00:00Z",
      concepts: ["tourism", "old_generated", "law"],
      statuses: {
        law: {
          status: "CURATED",
          source: "human-review",
          reason: "Keep law assignment."
        }
      }
    })
  ], { source: "concept-management" });

  writeJson(seedFile, [
    p({
      checkedAt: "2026-10-02T10:00:00Z",
      concepts: ["tourism", "marketing"]
    })
  ]);

  const restarted = new CatalogStore({
    seedFile,
    dataDir
  });

  const live = restarted.load();

  assert.deepEqual(
    live[0].concepts,
    ["tourism", "marketing", "law"]
  );

  assert.equal(
    live[0].concept_assignment_status.law.status,
    "CURATED"
  );

  assert.equal(
    live[0].concepts.includes("old_generated"),
    false
  );
});
