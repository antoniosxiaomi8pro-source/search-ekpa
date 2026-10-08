// R3.1: the preview must show EVERY change in positions 1-3 (enter from outside, rise, leave,
// reorder) and warn about what a person cannot see: shadowed words, hidden/missing programs,
// unknown categories, stopwords that occur in program titles.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { previewLexicon, diffLexicons, top3Events } = require("../server/lexicon-preview.js");

const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"));
const PROGRAMS = read("../public/programs.json");
const CONCEPTS = read("../public/concepts.json");
const FIXTURE = read("fixtures/search-regression.json");
const SEED = read("../public/lexicon.json");
const CATS = new Set(PROGRAMS.flatMap((p) => [p.primary_area, ...(p.areas_of_study || [])]).filter(Boolean));
const clone = (v) => JSON.parse(JSON.stringify(v));
const preview = (candidate) => previewLexicon({ programsAll: PROGRAMS, concepts: CONCEPTS, fixture: FIXTURE, current: SEED, candidate, categoryNames: CATS });

test("top3Events covers entering from outside, rising from 4-10, leaving and reordering", () => {
  const t = (s) => s.toUpperCase();
  const ev = top3Events(["a", "b", "c", "d", "e"], ["a", "d", "x", "b"], t);
  assert.deepEqual(ev.map((e) => [e.kind, e.slug, e.from, e.to]), [
    ["rises", "d", 4, 2],
    ["enters_from_outside", "x", null, 3],
    ["leaves", "b", 2, 4],
    ["leaves", "c", 3, null],
  ]);
  assert.deepEqual(top3Events(["a", "b", "c"], ["b", "a", "c"], t).map((e) => e.kind), ["reordered", "reordered"]);
  assert.deepEqual(top3Events(["a", "b", "c"], ["a", "b", "c", "d"], t), []);
});

test("diffLexicons: added, removed and changed words", () => {
  const c = clone(SEED);
  c.stopwords.push("νέα");
  c.stopwords = c.stopwords.filter((w) => w !== "και");
  c.topics[0].programs.pop();

  c.query_aliases.push({
    alias: "νομοσ",
    canonical: "legal"
  });

  c.token_aliases.push({
    alias: "peopleops",
    canonical: "human resources"
  });

  const kinds = diffLexicons(SEED, c)
    .map((x) => x.kind + ":" + x.word)
    .sort();

  assert.ok(kinds.includes("added:νέα") && kinds.includes("removed:και"));
  assert.ok(kinds.includes("changed:σεφ"), "editing a group's programs changes all its words");
  assert.ok(kinds.includes("added:νομοσ"), "whole-query alias must be visible in preview diff");
  assert.ok(kinds.includes("added:peopleops"), "token alias must be visible in preview diff");
});

test("no change: nothing differs and nothing is flagged", async () => {
  const r = await preview(clone(SEED));
  assert.equal(r.changes.length, 0);
  assert.equal(r.changed, 0);
  assert.equal(r.other_changed, 0);
  assert.deepEqual(r.warnings, []);
  assert.ok(r.queries > 170);
});

test("a new audience word: its own query changes (expected), the top-3 is listed in full, base queries untouched", async () => {
  const c = clone(SEED);
  c.audience_categories[0].words.push("δασκάλων");
  const r = await preview(c);
  assert.equal(r.other_changed, 0);
  const own = r.groups.find((g) => g.label === "Λέξεις που άλλαξαν");
  assert.equal(own.changes.length, 1);
  assert.equal(own.changes[0].query, "δασκάλων");
  assert.equal(own.changes[0].total_before, 0);
  assert.ok(own.changes[0].total_after > 50);
  assert.equal(own.changes[0].top3.length, 3, "all three positions are new");
  assert.equal(own.changes[0].top3.every((e) => e.kind === "enters_from_outside"), true);
});

test("A2.1: a new token alias is a touched query and its ranking impact is previewed", async () => {
  const c = clone(SEED);

  c.token_aliases.push({
    alias: "peopleops",
    canonical: "human resources"
  });

  const r = await preview(c);

  assert.ok(
    r.changes.some(
      (x) =>
        x.kind === "added" &&
        x.group === "Acronyms / token aliases" &&
        x.word === "peopleops"
    ),
    "token alias must be reported as a lexicon change"
  );

  const own = r.groups.find(
    (g) => g.label === "Λέξεις που άλλαξαν"
  );

  assert.ok(own, "touched-query group must exist");

  const q = own.changes.find(
    (x) => x.query === "peopleops"
  );

  assert.ok(q, "new alias query must be included in preview");

  assert.ok(
    q.total_after > 0,
    "after the alias is applied it must resolve to real results"
  );
});

test("A2.1: changing an alias canonical target is reported as changed", () => {
  const c = clone(SEED);

  const existing = c.token_aliases.find(
    (e) => e.alias.toLowerCase() === "hrm"
  );

  assert.ok(existing, "HRM seed alias must exist");

  existing.canonical = "management";

  const changes = diffLexicons(SEED, c);

  assert.ok(
    changes.some(
      (x) =>
        x.kind === "changed" &&
        x.group === "Acronyms / token aliases" &&
        x.word.toLowerCase() === "hrm"
    )
  );
});

test("warning: an audience word that is already a category is shadowed", async () => {
  const c = clone(SEED);
  c.audience_programs.push({ id: "nurse", words: ["νοσηλευτής"], programs: ["eisagwgh-sth-nanoiatrikh"] });
  const r = await preview(c);
  assert.ok(r.warnings.some((w) => /νοσηλευτής/.test(w.text) && /Νοσηλευτική/.test(w.text) && /δεν θα ισχύσει/.test(w.text)), JSON.stringify(r.warnings));
});

test("warnings: hidden program, vanished program, unknown category", async () => {
  const hidden = PROGRAMS.find((p) => p.status === "inactive");
  const c = clone(SEED);
  c.topics.push({ id: "t2", words: ["θέμα"], programs: [hidden.slug, "gone-program"] });
  c.category_words.push({ word: "ψαράς", category: "Κατηγορία που δεν υπάρχει" });
  const r = await preview(c);
  const texts = r.warnings.map((w) => w.text).join("\n");
  assert.match(texts, /κρυμμένο/);
  assert.match(texts, /δεν υπάρχει πια στον κατάλογο/);
  assert.ok(r.warnings.some((w) => w.level === "error" && /Κατηγορία που δεν υπάρχει/.test(w.text)), "unknown category is an error (blocks saving in the UI)");
});

test("a new stopword: warns about titles containing it and shows how those titles' searches change", async () => {
  const c = clone(SEED);
  c.stopwords.push("κοινωνική");
  const r = await preview(c);
  assert.ok(r.warnings.some((w) => /κοινωνική/.test(w.text) && /τίτλους/.test(w.text)));
  assert.ok(r.groups.some((g) => /Τίτλοι προγραμμάτων/.test(g.label) && g.queries > 0));
  assert.ok(r.other_changed > 0, "changes outside the edited word need a human's approval");
});

test("an invalid draft is refused with the engine's message", async () => {
  const c = clone(SEED);
  c.stopwords.push("ναυτικός");
  await assert.rejects(preview(c), /Μη έγκυρο λεξικό/);
});
