"use strict";

// "What would change in the search results if this lexicon were saved?" - for the admin
// page (R3.1). Compares the lexicon being served with a draft, on:
//   - the checked queries (regression fixture), every category name and the first term of every concept,
//   - the words the draft adds, removes or changes (and, for stopwords, the program titles containing them).
// Also returns warnings a person cannot see by themselves: a word that is already a category
// (its audience/topic rule would never apply), programs that are hidden or gone, categories that
// do not exist, a stopword that occurs in program titles.
//
// Lesson from the category alignment (LEDGER 2026-10-01): the report must list EVERY change in
// positions 1-3 - a program entering from outside, rising from 4-10, leaving, or only moving - not
// just new entries.

const path = require("node:path");
const { Worker } = require("node:worker_threads");
const Engine = require("../public/search-engine.js");
const { querySet } = require("./ranking-diff.js");

const norm = (w) => Engine.foldGreek(Engine.normalize(w));
const active = (list) => list.filter((p) => p.status !== "inactive");

// Flat entries of a lexicon: "group|folded word" -> { word, group, target }
function entriesOf(lex) {
  const out = new Map();
  const add = (group, word, target) => out.set(group + "|" + norm(word), { word, group, target: JSON.stringify(target) });
  (lex.stopwords || []).forEach((w) => add("Λέξεις που αγνοούνται", w, null));
  (lex.category_words || []).forEach((e) => add("Λέξη → κατηγορία", e.word, e.category));
  (lex.audience_categories || []).forEach((g) => (g.words || []).forEach((w) => add("Κοινό → κατηγορίες", w, [g.categories])));
  (lex.audience_programs || []).forEach((g) => (g.words || []).forEach((w) => add("Κοινό → προγράμματα", w, [g.programs, g.scan_terms || null])));
  (lex.topics || []).forEach((g) => (g.words || []).forEach((w) => add("Θέματα", w, [g.programs])));
  return out;
}

function diffLexicons(current, candidate) {
  const a = entriesOf(current);
  const b = entriesOf(candidate);
  const changes = [];
  for (const [k, e] of b) {
    if (!a.has(k)) changes.push({ kind: "added", group: e.group, word: e.word });
    else if (a.get(k).target !== e.target) changes.push({ kind: "changed", group: e.group, word: e.word });
  }
  for (const [k, e] of a) if (!b.has(k)) changes.push({ kind: "removed", group: e.group, word: e.word });
  return changes;
}

function warningsFor(candidate, programsAll, categoryNames) {
  const warnings = [];
  const bySlug = new Map(programsAll.map((p) => [p.slug, p]));
  const groups = [
    ...(candidate.audience_programs || []).map((g) => ["Κοινό → προγράμματα", g]),
    ...(candidate.topics || []).map((g) => ["Θέματα", g]),
  ];
  groups.forEach(([label, g]) => {
    (g.programs || []).forEach((slug) => {
      const p = bySlug.get(slug);
      if (!p) warnings.push({ level: "warn", text: `${label} («${(g.words || []).join(", ")}»): το πρόγραμμα «${slug}» δεν υπάρχει πια στον κατάλογο και αγνοείται.` });
      else if (p.status === "inactive") warnings.push({ level: "warn", text: `${label} («${(g.words || []).join(", ")}»): το πρόγραμμα «${p.title}» είναι κρυμμένο (δεν δέχεται αιτήσεις) και δεν θα εμφανίζεται.` });
    });
  });
  const cats = [
    ...(candidate.category_words || []).map((e) => [e.word, [e.category]]),
    ...(candidate.audience_categories || []).map((g) => [(g.words || []).join(", "), g.categories || []]),
  ];
  cats.forEach(([words, list]) => list.forEach((c) => {
    if (!categoryNames.has(c)) warnings.push({ level: "error", text: `«${words}»: η κατηγορία «${c}» δεν υπάρχει στον κατάλογο, η αντιστοίχιση δεν θα ισχύσει.` });
  }));
  return warnings;
}

function runWorker(data, timeoutMs) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, "lexicon-preview-worker.js"), { workerData: data });
    const t = setTimeout(() => { w.terminate(); reject(new Error("Η προεπισκόπηση άργησε πολύ και διακόπηκε.")); }, timeoutMs);
    w.once("message", (m) => { clearTimeout(t); m.ok ? resolve(m) : reject(new Error(m.error)); });
    w.once("error", (e) => { clearTimeout(t); reject(e); });
  });
}

const top3Events = (b, a, title) => {
  const b3 = b.slice(0, 3), a3 = a.slice(0, 3);
  const ev = [];
  a3.forEach((slug, i) => {
    if (b3[i] === slug) return;
    const was = b.indexOf(slug);
    ev.push({ kind: was < 0 ? "enters_from_outside" : was < 3 ? "reordered" : "rises", slug, title: title(slug), from: was < 0 ? null : was + 1, to: i + 1 });
  });
  b3.forEach((slug, i) => {
    if (a3.includes(slug)) return;
    const now = a.indexOf(slug);
    ev.push({ kind: "leaves", slug, title: title(slug), from: i + 1, to: now < 0 ? null : now + 1 });
  });
  return ev;
};

// current / candidate: readable lexicon objects. programsAll: the full catalog.
async function previewLexicon({ programsAll, concepts, fixture, current, candidate, categoryNames, timeoutMs = 90000 }) {
  Engine.compileLexicon(candidate); // throws a Greek message if invalid
  const programs = active(programsAll);
  const title = (() => { const m = new Map(programsAll.map((p) => [p.slug, p.title])); return (s) => m.get(s) || s; })();
  const changes = diffLexicons(current, candidate);

  // queries: the usual set + the touched words
  const base = querySet(programs, concepts, fixture);
  const touched = [...new Set(changes.map((c) => c.word))];
  const stopTouched = changes.filter((c) => c.group === "Λέξεις που αγνοούνται");
  const titleQueries = [];
  stopTouched.forEach((c) => {
    const k = norm(c.word);
    programs.filter((p) => (" " + norm(p.title) + " ").includes(" " + k + " ")).slice(0, 30).forEach((p) => titleQueries.push(p.title));
  });
  const groupsDef = [...base, ["Λέξεις που άλλαξαν", touched], ["Τίτλοι προγραμμάτων με λέξη που αλλάζει σε «αγνοείται»", [...new Set(titleQueries)]]]
    .map(([label, qs]) => [label, [...new Set(qs)]]);
  const queries = [...new Set(groupsDef.flatMap(([, qs]) => qs))];

  const shadowProbes = [...new Set([
    ...(candidate.audience_categories || []).flatMap((g) => g.words || []),
    ...(candidate.audience_programs || []).flatMap((g) => g.words || []),
    ...(candidate.topics || []).flatMap((g) => g.words || []),
  ])].filter((w) => touched.includes(w));

  const res = await runWorker({ programs, concepts, queries, current, candidate, shadowProbes }, timeoutMs);

  const warnings = warningsFor(candidate, programsAll, categoryNames || new Set());
  Object.entries(res.shadow).forEach(([word, cat]) => warnings.push({ level: "warn", text: `Η λέξη «${word}» ταιριάζει ήδη με την κατηγορία «${cat}». Η μηχανή την αντιμετωπίζει ως κατηγορία πριν φτάσει στον κανόνα κοινού/θέματος, άρα ο κανόνας που ορίζεις δεν θα ισχύσει.` }));
  stopTouched.filter((c) => c.kind === "added").forEach((c) => {
    const k = norm(c.word);
    const n = programs.filter((p) => (" " + norm(p.title) + " ").includes(" " + k + " ")).length;
    if (n) warnings.push({ level: "warn", text: `Η λέξη «${c.word}», που θα αγνοείται, υπάρχει σε ${n} τίτλους προγραμμάτων.` });
  });
  const short = changes.filter((c) => c.kind !== "removed" && norm(c.word).length < 3);
  short.forEach((c) => warnings.push({ level: "warn", text: `Η λέξη «${c.word}» είναι πολύ σύντομη (λιγότερο από 3 γράμματα) και μπορεί να ταιριάζει με πολλά.` }));

  let total = 0, changedTotal = 0, top3Changed = 0;
  const groups = groupsDef.map(([label, qs]) => {
    const list = [];
    qs.forEach((q) => {
      total++;
      const b = res.before[q], a = res.after[q];
      if (!b || !a) return;
      if (JSON.stringify(b.top) === JSON.stringify(a.top) && b.total === a.total) return;
      changedTotal++;
      const ev = top3Events(b.top, a.top, title);
      if (ev.length) top3Changed++;
      list.push({
        query: q, total_before: b.total, total_after: a.total, top3: ev,
        before: b.top.map((s, i) => ({ position: i + 1, slug: s, title: title(s) })),
        after: a.top.map((s, i) => ({ position: i + 1, slug: s, title: title(s) })),
      });
    });
    return { label, queries: qs.length, changed: list.length, changes: list };
  }).filter((g) => g.queries > 0);

  // Changes outside the words the draft touches need a human's approval.
  const own = groups.find((g) => g.label === "Λέξεις που άλλαξαν");
  const otherChanged = groups.filter((g) => g !== own).reduce((n, g) => n + g.changed, 0);
  return { changes, warnings, queries: total, changed: changedTotal, top3_changed: top3Changed, other_changed: otherChanged, groups };
}

module.exports = { previewLexicon, diffLexicons, warningsFor, top3Events };
