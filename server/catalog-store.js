"use strict";

// Which catalog is live: the one shipped in the package (public/programs.json) or the
// one produced by the admin "Έλεγχος καταλόγου" button (DATA_DIR/programs.json).
//
// Rule (docs/B0-architecture-decisions.md §5): THE NEWEST CHECK WINS. Both catalogs are
// snapshots of the same source made by the same code, so the most recent snapshot is
// the most correct. Whenever a catalog is replaced, the previous one is kept as a backup.
// This is only valid because nobody edits programs by hand.
//
// The package catalog is compared ONCE, when a new package arrives (its check date
// differs from meta.seed_checked_at). Otherwise a manual rollback to an older catalog
// would be undone by the package on the next restart.

const fs = require("node:fs");
const path = require("node:path");
const { overlayGovernedConcepts } = require("./concept-governance-overlay.js");

const MAX_BACKUPS = 20;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

// Date of the check that produced a catalog (latest status_checked_at), or null for a
// catalog that has never been checked (pre-2026-10-01 exports).
function checkedAt(programs) {
  let max = null;
  for (const p of programs) {
    const t = p && p.status_checked_at;
    if (typeof t === "string" && (!max || t > max)) max = t;
  }
  return max;
}

function isNewer(a, b) {
  if (!a) return false;
  if (!b) return true;
  return a > b; // ISO-8601 strings compare chronologically
}

class CatalogStore {
  // seedFile: catalog shipped with the code. dataDir: persistent dir (or null).
  constructor({ seedFile, dataDir, log = () => {} }) {
    this.seedFile = seedFile;
    this.dataDir = dataDir;
    this.log = log;
    this.file = dataDir ? path.join(dataDir, "programs.json") : null;
    this.metaFile = dataDir ? path.join(dataDir, "catalog-meta.json") : null;
    this.backupDir = dataDir ? path.join(dataDir, "catalog-backups") : null;
    this.programs = null;
    this.meta = null;
  }

  // Decides at startup which catalog is live. Returns the program array.
  load() {
    const seed = readJson(this.seedFile);
    const seedAt = checkedAt(seed);
    if (!this.dataDir) {
      this.programs = seed;
      this.meta = { source: "package", checked_at: seedAt, applied_at: null, note: "χωρίς DATA_DIR" };
      return this.programs;
    }
    fs.mkdirSync(this.dataDir, { recursive: true });
    let stored = null;
    if (fs.existsSync(this.file)) {
      try {
        stored = readJson(this.file);
        if (!Array.isArray(stored) || !stored.length) stored = null;
      } catch (e) {
        this.log(`Κατάλογος: το ${this.file} δεν διαβάζεται (${e.message}) - χρησιμοποιείται ο κατάλογος του πακέτου.`);
        stored = null;
      }
    }
    let meta = null;
    try { meta = readJson(this.metaFile); } catch (e) {}
    const storedAt = stored ? checkedAt(stored) : null;
    const packageAlreadySeen = !!(meta && Object.prototype.hasOwnProperty.call(meta, "seed_checked_at") && meta.seed_checked_at === seedAt);

    if (stored && (packageAlreadySeen || !isNewer(seedAt, storedAt))) {
      this.programs = stored;
      this.meta = { ...(meta || { source: "check", checked_at: storedAt, applied_at: null }), checked_at: storedAt, seed_checked_at: seedAt };
      if (!packageAlreadySeen) writeAtomic(this.metaFile, JSON.stringify(this.meta, null, 2));
      this.log(`Κατάλογος: ${this.meta.source === "package" ? "πακέτο" : this.meta.source === "rollback" ? "επαναφορά" : "έλεγχος (κουμπί)"} ${storedAt || "-"} από ${this.file}`);
      return this.programs;
    }
    // New package with a newer catalog (or nothing stored yet): it becomes the live one.
    // Preserve explicit governed concept decisions from the persistent catalog.
    const nextCatalog = stored
      ? overlayGovernedConcepts(seed, stored)
      : seed;

    if (stored) this.backup(stored, "replaced-by-package");

    this.write(nextCatalog, {
      source: "package",
      checked_at: seedAt,
      applied_at: new Date().toISOString(),
      seed_checked_at: seedAt
    });
    this.log(`Κατάλογος: πακέτο ${seedAt || "(χωρίς ημερομηνία ελέγχου)"}${stored ? ` - νεότερο από τον αποθηκευμένο (${storedAt || "-"}), που κρατήθηκε ως backup` : ""}`);
    return this.programs;
  }

  write(programs, meta) {
    this.programs = programs;
    this.meta = meta;
    if (!this.dataDir) return;
    writeAtomic(this.file, JSON.stringify(programs));
    writeAtomic(this.metaFile, JSON.stringify(meta, null, 2));
  }

  backup(programs, reason) {
    if (!this.backupDir) return null;
    fs.mkdirSync(this.backupDir, { recursive: true });
    const at = checkedAt(programs) || "unchecked";
    const name = `programs.${new Date().toISOString().replace(/[:.]/g, "-")}.${reason}.json`;
    const file = path.join(this.backupDir, name);
    writeAtomic(file, JSON.stringify(programs));
    writeAtomic(file.replace(/\.json$/, ".meta.json"), JSON.stringify({ reason, checked_at: at, saved_at: new Date().toISOString(), source: this.meta && this.meta.source }, null, 2));
    this.prune();
    return name;
  }

  prune() {
    const files = this.listBackups();
    files.slice(MAX_BACKUPS).forEach((b) => {
      fs.rmSync(path.join(this.backupDir, b.file), { force: true });
      fs.rmSync(path.join(this.backupDir, b.file.replace(/\.json$/, ".meta.json")), { force: true });
    });
  }

  listBackups() {
    if (!this.backupDir || !fs.existsSync(this.backupDir)) return [];
    return fs.readdirSync(this.backupDir)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
      .sort()
      .reverse()
      .map((file) => {
        let meta = {};
        try { meta = readJson(path.join(this.backupDir, file.replace(/\.json$/, ".meta.json"))); } catch (e) {}
        return { file, ...meta };
      });
  }

  // Applies a reviewed check result. Requires DATA_DIR (otherwise it would not survive a restart).
  apply(candidate, info = {}) {
    if (!this.dataDir) throw new Error("Χρειάζεται DATA_DIR για εφαρμογή από το admin.");
    this.backup(this.programs, "before-apply");
    this.write(candidate, { source: "check", checked_at: checkedAt(candidate), applied_at: new Date().toISOString(), seed_checked_at: this.meta && this.meta.seed_checked_at, ...info });
    return this.programs;
  }

  // Restores a backup (default: the most recent one).
  rollback(file) {
    if (!this.dataDir) throw new Error("Χρειάζεται DATA_DIR.");
    const list = this.listBackups();
    const target = file ? list.find((b) => b.file === file) : list[0];
    if (!target) throw new Error("Δεν υπάρχει backup.");
    if (path.basename(target.file) !== target.file) throw new Error("Μη έγκυρο όνομα backup.");
    const restored = readJson(path.join(this.backupDir, target.file));
    this.backup(this.programs, "before-rollback");
    this.write(restored, { source: "rollback", checked_at: checkedAt(restored), applied_at: new Date().toISOString(), restored_from: target.file, seed_checked_at: this.meta && this.meta.seed_checked_at });
    return this.programs;
  }
}

module.exports = { CatalogStore, checkedAt, isNewer, MAX_BACKUPS };
