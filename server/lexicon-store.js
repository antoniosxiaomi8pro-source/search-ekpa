"use strict";

// Where the search lexicon lives and how it is changed safely (R1, docs/B0-architecture-decisions.md §3).
//
//   public/lexicon.json        the lexicon shipped with the package (seed, never edited at runtime)
//   DATA_DIR/lexicon.json      the live lexicon, edited by EKPA staff in the admin page
//   DATA_DIR/lexicon-backups/  the previous version, kept before every change (last 20)
//
// Rules (same as concepts.json): the seed is copied to DATA_DIR ONLY when DATA_DIR has no
// lexicon yet - a new package never overwrites EKPA's edits. A lexicon that cannot be read or
// is not valid never stops the server: the engine keeps its built-in tables and the problem is
// reported (status().error). The bad file is left in place so it can be fixed, not overwritten.

const fs = require("node:fs");
const path = require("node:path");

const MAX_BACKUPS = 20;

function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

class LexiconStore {
  // engine: the search engine module (setLexicon / resetLexicon / compileLexicon).
  constructor({ seedFile, dataDir, engine, log = () => {} }) {
    this.seedFile = seedFile;
    this.dataDir = dataDir;
    this.engine = engine;
    this.log = log;
    this.file = dataDir ? path.join(dataDir, "lexicon.json") : seedFile;
    this.backupDir = dataDir ? path.join(dataDir, "lexicon-backups") : null;
    this.lexicon = null; // the lexicon currently applied (object), or null = built-in tables
    this.state = { source: "builtin", error: null, counts: null, seeded: false, loaded_at: null };
  }

  load() {
    this.state = { source: "builtin", error: null, counts: null, seeded: false, loaded_at: new Date().toISOString() };
    if (this.dataDir) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      if (!fs.existsSync(this.file)) {
        try {
          fs.copyFileSync(this.seedFile, this.file);
          this.state.seeded = true;
          this.log(`Λεξικό: αρχικοποιήθηκε το ${this.file} από το πακέτο`);
        } catch (e) {
          this.state.error = `Δεν αντιγράφηκε το λεξικό του πακέτου (${e.message})`;
        }
      }
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.state.counts = this.engine.setLexicon(parsed);
      this.lexicon = parsed;
      this.state.source = this.dataDir ? "data_dir" : "package";
      this.log(`Λεξικό: ${this.state.source === "data_dir" ? this.file : "πακέτο"} (${this.state.counts.stopwords} stopwords, ${this.state.counts.category_words} λέξεις→κατηγορία, ${this.state.counts.audience_words} λέξεις κοινού, ${this.state.counts.topic_words} λέξεις θεμάτων)`);
    } catch (e) {
      this.engine.resetLexicon();
      this.lexicon = null;
      this.state.source = "builtin";
      this.state.error = e.message;
      this.log(`Λεξικό: ΣΦΑΛΜΑ - ${e.message}. Χρησιμοποιείται το ενσωματωμένο λεξικό της μηχανής. Το αρχείο ${this.file} δεν αλλάχθηκε.`);
    }
    return this.lexicon;
  }

  // The lexicon as JSON for display/export: the applied one, or - when the engine runs on its
  // built-in tables because the file is broken - the shipped seed (which is equivalent).
  current() {
    if (this.lexicon) return this.lexicon;
    try { return JSON.parse(fs.readFileSync(this.seedFile, "utf8")); } catch (e) { return null; }
  }

  status() {
    return { ...this.state, file: this.file, can_save: !!this.dataDir, backups: this.listBackups().length };
  }

  // Validates, keeps the previous file as a backup, writes atomically, applies at once.
  // Throws (Greek message) before anything changes if the lexicon is not valid.
  save(lexicon, info = {}) {
    if (!this.dataDir) throw new Error("Χρειάζεται DATA_DIR για αποθήκευση λεξικού.");
    this.engine.compileLexicon(lexicon); // throws if invalid
    this.backupCurrent(info.reason || "before-save");
    const previous = this.lexicon;
    try {
      this.state.counts = this.engine.setLexicon(lexicon);
    } catch (e) { // cannot happen after compileLexicon, but never leave a half-applied state
      if (previous) this.engine.setLexicon(previous); else this.engine.resetLexicon();
      throw e;
    }
    writeAtomic(this.file, JSON.stringify(lexicon, null, 2) + "\n");
    this.lexicon = lexicon;
    this.state = { ...this.state, source: "data_dir", error: null, loaded_at: new Date().toISOString() };
    return this.state.counts;
  }

  backupCurrent(reason) {
    if (!this.backupDir || !fs.existsSync(this.file)) return null;
    fs.mkdirSync(this.backupDir, { recursive: true });
    const name = `lexicon.${new Date().toISOString().replace(/[:.]/g, "-")}.${reason}.json`;
    fs.copyFileSync(this.file, path.join(this.backupDir, name));
    this.prune();
    return name;
  }

  prune() {
    this.listBackups().slice(MAX_BACKUPS).forEach((b) => fs.rmSync(path.join(this.backupDir, b.file), { force: true }));
  }

  listBackups() {
    if (!this.backupDir || !fs.existsSync(this.backupDir)) return [];
    return fs.readdirSync(this.backupDir).filter((f) => f.endsWith(".json")).sort().reverse().map((file) => ({ file }));
  }

  // Restores a backup (default: the most recent). The current file is itself backed up first.
  rollback(file) {
    if (!this.dataDir) throw new Error("Χρειάζεται DATA_DIR.");
    const list = this.listBackups();
    const target = file ? list.find((b) => b.file === file) : list[0];
    if (!target) throw new Error("Δεν υπάρχει backup.");
    if (path.basename(target.file) !== target.file) throw new Error("Μη έγκυρο όνομα backup.");
    const restored = JSON.parse(fs.readFileSync(path.join(this.backupDir, target.file), "utf8"));
    this.save(restored, { reason: "before-rollback" });
    return target.file;
  }
}

module.exports = { LexiconStore, MAX_BACKUPS };
