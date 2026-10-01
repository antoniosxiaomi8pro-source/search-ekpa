const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CatalogStore, checkedAt } = require("../server/catalog-store.js");

const cat = (at, extra = {}) => [
  { slug: "a", title: "A", status: "active", status_checked_at: at, ...extra },
  { slug: "b", title: "B", status: "active", status_checked_at: at },
];

function setup(seedAt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-store-"));
  const seedFile = path.join(dir, "seed.json");
  const dataDir = path.join(dir, "data");
  fs.writeFileSync(seedFile, JSON.stringify(cat(seedAt)));
  const open = () => new CatalogStore({ seedFile, dataDir });
  const setSeed = (at, extra) => fs.writeFileSync(seedFile, JSON.stringify(cat(at, extra)));
  return { dir, seedFile, dataDir, open, setSeed };
}

test("store: checkedAt is the latest check date, null for never-checked catalogs", () => {
  assert.equal(checkedAt([{ status_checked_at: "2026-10-01T10:00:00Z" }, { status_checked_at: "2026-10-02T10:00:00Z" }]), "2026-10-02T10:00:00Z");
  assert.equal(checkedAt([{ slug: "x" }]), null);
});

test("store: without DATA_DIR the package catalog is used as-is", () => {
  const { seedFile } = setup("2026-10-01T10:00:00Z");
  const s = new CatalogStore({ seedFile, dataDir: null });
  assert.equal(s.load().length, 2);
  assert.equal(s.meta.source, "package");
});

test("store: first start copies the package catalog into DATA_DIR", () => {
  const { open, dataDir } = setup("2026-10-01T10:00:00Z");
  const s = open();
  s.load();
  assert.equal(s.meta.source, "package");
  assert.ok(fs.existsSync(path.join(dataDir, "programs.json")));
});

test("store: a NEWER catalog from the admin button survives a restart with an older package", () => {
  const { open } = setup("2026-10-01T10:00:00Z");
  const s = open();
  s.load();
  s.apply(cat("2026-10-20T10:00:00Z", { title: "from-button" }));
  const after = open();
  after.load();
  assert.equal(after.programs[0].title, "from-button");
  assert.equal(after.meta.source, "check");
});

test("store: a NEW package with a newer catalog replaces the stored one, which is backed up", () => {
  const { open, setSeed } = setup("2026-10-01T10:00:00Z");
  const s = open();
  s.load();
  s.apply(cat("2026-10-20T10:00:00Z", { title: "from-button" }));
  setSeed("2026-10-25T10:00:00Z", { title: "from-new-package" });
  const after = open();
  after.load();
  assert.equal(after.programs[0].title, "from-new-package");
  assert.equal(after.meta.source, "package");
  const backups = after.listBackups();
  assert.ok(backups.some((b) => b.reason === "replaced-by-package" && b.checked_at === "2026-10-20T10:00:00Z"));
});

test("store: a NEW package with an OLDER catalog does not replace a newer button check", () => {
  const { open, setSeed } = setup("2026-10-01T10:00:00Z");
  const s = open();
  s.load();
  s.apply(cat("2026-10-20T10:00:00Z", { title: "from-button" }));
  setSeed("2026-10-15T10:00:00Z", { title: "older-package" });
  const after = open();
  after.load();
  assert.equal(after.programs[0].title, "from-button");
});

test("store: a rollback to an older catalog is NOT undone by the same package on restart", () => {
  const { open } = setup("2026-10-01T10:00:00Z");
  const s = open();
  s.load();
  s.apply(cat("2026-10-20T10:00:00Z", { title: "v2" }));
  s.apply(cat("2026-10-21T10:00:00Z", { title: "v3" }));
  s.rollback(); // back to v2
  assert.equal(s.programs[0].title, "v2");
  const after = open();
  after.load();
  assert.equal(after.programs[0].title, "v2");
  assert.equal(after.meta.source, "rollback");
});

test("store: apply and rollback always keep a backup of what they replace", () => {
  const { open } = setup("2026-10-01T10:00:00Z");
  const s = open();
  s.load();
  s.apply(cat("2026-10-20T10:00:00Z"));
  assert.equal(s.listBackups()[0].reason, "before-apply");
  s.rollback();
  assert.equal(s.listBackups()[0].reason, "before-rollback");
});

test("store: a corrupt stored catalog falls back to the package one", () => {
  const { open, dataDir } = setup("2026-10-01T10:00:00Z");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "programs.json"), "{not json");
  const s = open();
  assert.equal(s.load().length, 2);
  assert.equal(s.meta.source, "package");
});

test("store: rollback rejects unknown or path-like backup names", () => {
  const { open } = setup("2026-10-01T10:00:00Z");
  const s = open();
  s.load();
  s.apply(cat("2026-10-20T10:00:00Z"));
  assert.throws(() => s.rollback("../../etc/passwd"), /Δεν υπάρχει backup/);
});
