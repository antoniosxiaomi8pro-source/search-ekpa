// R1 step 3: where the lexicon lives (DATA_DIR), safe saving, backups, rollback, and the rule
// that a package never overwrites EKPA's edits and a broken file never stops the server.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Engine = require("../public/search-engine.js");
const { LexiconStore, MAX_BACKUPS } = require("../server/lexicon-store.js");

const SEED_FILE = path.join(__dirname, "../public/lexicon.json");
const SEED = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sf-lex-"));
const store = (dataDir, seedFile = SEED_FILE) => new LexiconStore({ seedFile, dataDir, engine: Engine });
const stopwords = () => Engine.getLexiconTables().stopwords.length;

test.afterEach(() => Engine.resetLexicon());

test("first start: the package lexicon is copied to DATA_DIR and applied", () => {
  const dir = tmp();
  const s = store(dir);
  s.load();
  assert.ok(fs.existsSync(path.join(dir, "lexicon.json")));
  assert.equal(s.status().source, "data_dir");
  assert.equal(s.status().seeded, true);
  assert.equal(s.status().error, null);
});

test("a package never overwrites the lexicon EKPA edited", () => {
  const dir = tmp();
  const edited = clone(SEED); edited.stopwords.push("επιπλέον");
  fs.writeFileSync(path.join(dir, "lexicon.json"), JSON.stringify(edited));
  const s = store(dir);
  s.load();
  assert.equal(s.status().seeded, false);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, "lexicon.json"), "utf8")).stopwords.includes("επιπλέον"));
  assert.equal(stopwords(), SEED.stopwords.length + 1);
});

test("without DATA_DIR the package lexicon is used and nothing can be saved", () => {
  const s = store(null);
  s.load();
  assert.equal(s.status().source, "package");
  assert.equal(s.status().can_save, false);
  assert.throws(() => s.save(SEED), /DATA_DIR/);
});

test("a broken file never stops the server: built-in lexicon, error reported, file left untouched", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "lexicon.json"), "{ not json");
  const s = store(dir);
  assert.doesNotThrow(() => s.load());
  assert.equal(s.status().source, "builtin");
  assert.match(s.status().error, /./);
  assert.equal(fs.readFileSync(path.join(dir, "lexicon.json"), "utf8"), "{ not json", "left for a human to fix");
  assert.equal(stopwords(), SEED.stopwords.length, "engine runs on its built-in tables");
  assert.ok(s.current().stopwords, "current() still gives the shipped lexicon for display");
});

test("an invalid lexicon (wrong version) is reported the same way", () => {
  const dir = tmp();
  const bad = clone(SEED); bad.schema_version = 99;
  fs.writeFileSync(path.join(dir, "lexicon.json"), JSON.stringify(bad));
  const s = store(dir); s.load();
  assert.equal(s.status().source, "builtin");
  assert.match(s.status().error, /schema_version/);
});

test("save: validates first, backs up the previous file, writes, applies immediately", () => {
  const dir = tmp();
  const s = store(dir); s.load();
  const next = clone(SEED); next.stopwords.push("επιπλέον");
  s.save(next);
  assert.equal(stopwords(), SEED.stopwords.length + 1, "applied without restart");
  assert.equal(s.listBackups().length, 1);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, "lexicon.json"), "utf8")).stopwords.includes("επιπλέον"));
  const backup = JSON.parse(fs.readFileSync(path.join(dir, "lexicon-backups", s.listBackups()[0].file), "utf8"));
  assert.equal(backup.stopwords.length, SEED.stopwords.length, "backup holds the previous version");
});

test("save of an invalid lexicon changes nothing: not the file, not the engine, no backup", () => {
  const dir = tmp();
  const s = store(dir); s.load();
  const before = fs.readFileSync(path.join(dir, "lexicon.json"), "utf8");
  const bad = clone(SEED); bad.stopwords.push("ναυτικός"); // also a category word
  assert.throws(() => s.save(bad), /Μη έγκυρο λεξικό/);
  assert.equal(fs.readFileSync(path.join(dir, "lexicon.json"), "utf8"), before);
  assert.equal(s.listBackups().length, 0);
  assert.equal(stopwords(), SEED.stopwords.length);
});

test("rollback restores the previous version, applies it, and keeps the replaced one as a backup", () => {
  const dir = tmp();
  const s = store(dir); s.load();
  const next = clone(SEED); next.stopwords.push("επιπλέον");
  s.save(next);
  const restored = s.rollback();
  assert.ok(restored);
  assert.equal(stopwords(), SEED.stopwords.length);
  assert.equal(s.listBackups().length, 2, "the edited version is not lost");
  assert.throws(() => s.rollback("../../etc/passwd"), /backup/i);
});

test("only the last MAX_BACKUPS backups are kept", () => {
  const dir = tmp();
  const s = store(dir); s.load();
  for (let i = 0; i < MAX_BACKUPS + 4; i++) {
    const l = clone(SEED); l.stopwords.push("λέξη" + "α".repeat(i + 1));
    s.save(l);
    // distinct millisecond names
    const t = Date.now(); while (Date.now() === t) {}
  }
  assert.equal(s.listBackups().length, MAX_BACKUPS);
});
