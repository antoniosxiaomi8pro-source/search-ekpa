// R1 step 2: the engine accepts a lexicon. With the shipped lexicon.json nothing may change
// (full rankings identical to the built-in tables), edits take effect immediately, and a
// broken lexicon is refused without touching the running one.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Engine = require("../public/search-engine.js");
const { querySet } = require("../server/ranking-diff.js");

const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"));
const PROGRAMS = read("../public/programs.json").filter((p) => p.status !== "inactive");
const CONCEPTS = read("../public/concepts.json");
const FIXTURE = read("fixtures/search-regression.json");
const SEED = read("../public/lexicon.json");
const clone = (v) => JSON.parse(JSON.stringify(v));

// Every query the ranking comparison uses + every word of the lexicon + inflections people type.
function allQueries() {
  const base = querySet(PROGRAMS, CONCEPTS, FIXTURE).flatMap(([, qs]) => qs);
  const words = [
    ...SEED.stopwords, ...SEED.category_words.map((e) => e.word), ...SEED.audience_categories.flatMap((g) => g.words),
    ...SEED.audience_programs.flatMap((g) => g.words), ...SEED.topics.flatMap((g) => g.words),
  ];
  const extra = ["φιλολόγων", "δασκάλων", "για φιλολόγους", "προγράμματα για δασκάλους", "σεφ μαγειρική", "ναυτικός τουρισμός", "chef", "marketing", "ηθοποιός"];
  return [...new Set([...base, ...words, ...extra])];
}
// Full ordered ranking (slug + score), not only the top 10.
const fullRanking = (q) => Engine.rank(PROGRAMS, CONCEPTS, q).map((r) => r.slug + ":" + r._score);

test("shipped lexicon.json: complete rankings are identical to the built-in lexicon, for every comparison query", () => {
  Engine.resetLexicon();
  const queries = allQueries();
  const before = queries.map(fullRanking);
  Engine.setLexicon(SEED);
  const after = queries.map(fullRanking);
  const diffs = queries.filter((q, i) => JSON.stringify(before[i]) !== JSON.stringify(after[i]));
  assert.deepEqual(diffs, [], "queries whose ranking changed");
  assert.ok(queries.length > 200, "query set should be large: " + queries.length);
  Engine.resetLexicon();
});

test("an edit takes effect at once (caches are dropped) and reset restores the original", () => {
  Engine.resetLexicon();
  assert.equal(Engine.rank(PROGRAMS, CONCEPTS, "δασκάλων").length, 0, "built-in lexicon: genitive plural is unknown");
  const lex = clone(SEED);
  lex.audience_categories[0].words.push("δασκάλων");
  Engine.setLexicon(lex);
  assert.equal(Engine.rank(PROGRAMS, CONCEPTS, "δασκάλων").length, Engine.rank(PROGRAMS, CONCEPTS, "δάσκαλος").length, "now behaves like δάσκαλος");
  Engine.resetLexicon();
  assert.equal(Engine.rank(PROGRAMS, CONCEPTS, "δασκάλων").length, 0, "back to the built-in lexicon");
});

test("a new category word works, including its inflections typed with other accents", () => {
  const lex = clone(SEED);
  lex.category_words.push({ word: "ηθοποιία", category: "Κινηματογράφος - Θέατρο" });
  Engine.setLexicon(lex);
  const a = Engine.rank(PROGRAMS, CONCEPTS, "ηθοποιία").map((r) => r.slug);
  const b = Engine.rank(PROGRAMS, CONCEPTS, "ΗΘΟΠΟΙΙΑ").map((r) => r.slug);
  assert.deepEqual(a, b);
  const members = PROGRAMS.filter((p) => p.primary_area === "Κινηματογράφος - Θέατρο" || (p.areas_of_study || []).includes("Κινηματογράφος - Θέατρο")).length;
  assert.equal(a.length, members);
  Engine.resetLexicon();
});

test("a stopword added in the lexicon is ignored by search; removed one is searched", () => {
  Engine.resetLexicon();
  const withWord = Engine.rank(PROGRAMS, CONCEPTS, "ψυχολογία κοινωνική").map((r) => r.slug).join();
  const lex = clone(SEED);
  lex.stopwords.push("κοινωνική");
  Engine.setLexicon(lex);
  const without = Engine.rank(PROGRAMS, CONCEPTS, "ψυχολογία κοινωνική").map((r) => r.slug).join();
  assert.notEqual(withWord, without);
  const onlyOne = Engine.rank(PROGRAMS, CONCEPTS, "ψυχολογία").map((r) => r.slug);
  assert.deepEqual(new Set(without.split(",")), new Set(onlyOne), "finds exactly what the query without the stopword finds");
  assert.ok(withWord.split(",").length > onlyOne.length, "before: the extra word widened the results");
  Engine.resetLexicon();
});

test("new audience group: hand-picked programs first, then programs whose description names the audience", () => {
  // "φοιτητής" is not a category word and not an audience word today, so it reaches this mechanism.
  const picked = "eisagwgh-sth-nanoiatrikh";
  const lex = clone(SEED);
  lex.audience_programs.push({ id: "nurse", words: ["φοιτητής", "φοιτητές"], programs: [picked], scan_terms: ["φοιτητής", "φοιτητές", "φοιτητών"] });
  Engine.setLexicon(lex);
  const got = Engine.rank(PROGRAMS, CONCEPTS, "φοιτητής").map((r) => r.slug);
  assert.equal(got[0], picked, "hand-picked first");
  // independent scan of the catalog
  const norm = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const expected = PROGRAMS.filter((p) => {
    if (p.slug === picked) return false;
    const t = norm([p.description_for_matching, p.description_full].filter(Boolean).join(" "));
    for (let i = t.indexOf("απευθυνεται"); i >= 0; i = t.indexOf("απευθυνεται", i + 11)) {
      if (/(?<!\p{L})(?:φοιτητης|φοιτητες|φοιτητων)(?!\p{L})/u.test(t.slice(i, i + 900))) return true;
    }
    return false;
  }).map((p) => p.slug);
  assert.deepEqual(new Set(got.slice(1)), new Set(expected));
  assert.ok(expected.length > 0, "the catalog should contain such programs");
  // the philologist rule still works next to it
  assert.equal(Engine.rank(PROGRAMS, CONCEPTS, "φιλόλογος").length, 10);
  Engine.resetLexicon();
});

test("an audience group without scan_terms returns only its hand-picked programs", () => {
  const lex = clone(SEED);
  lex.audience_programs.find((g) => g.id === "philologist").scan_terms = undefined;
  delete lex.audience_programs.find((g) => g.id === "philologist").scan_terms;
  Engine.setLexicon(lex);
  assert.equal(Engine.rank(PROGRAMS, CONCEPTS, "φιλόλογος").length, 7);
  Engine.resetLexicon();
});

test("invalid lexicons are refused with a clear message and the running lexicon is untouched", () => {
  Engine.resetLexicon();
  const before = JSON.stringify(Engine.getLexiconTables());
  const rankBefore = fullRanking("ναυτικός");
  const cases = {
    "άλλη έκδοση": (l) => { l.schema_version = 2; },
    "λείπει λίστα": (l) => { delete l.topics; },
    "κενή λέξη": (l) => { l.stopwords.push("  "); },
    "λέξη μόνο με σύμβολα": (l) => { l.stopwords.push("!!!"); },
    "λέξη σε δύο πίνακες": (l) => { l.topics[0].words.push("ναυτικός"); },
    "λέξη και stopword και αντιστοίχιση": (l) => { l.stopwords.push("σεφ"); },
    "δύο κατηγορίες για την ίδια λέξη": (l) => { l.category_words.push({ word: "ναυτικός", category: "Τουριστικά" }); },
    "κατηγορία χωρίς όνομα": (l) => { l.category_words.push({ word: "ψαράς", category: "" }); },
    "άκυρο id": (l) => { l.topics[0].id = "Μαγειρική!"; },
    "προγράμματα όχι λίστα": (l) => { l.topics[0].programs = "x"; },
    "όχι αντικείμενο": () => null,
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const lex = clone(SEED);
    const res = mutate(lex);
    assert.throws(() => Engine.setLexicon(name === "όχι αντικείμενο" ? [] : lex), /Μη έγκυρο λεξικό/, name);
  }
  assert.equal(JSON.stringify(Engine.getLexiconTables()), before, "tables untouched");
  assert.deepEqual(fullRanking("ναυτικός"), rankBefore, "rankings untouched");
});

test("a program named by the lexicon that no longer exists is ignored, never an error", () => {
  const lex = clone(SEED);
  lex.topics[0].programs.push("this-program-was-removed");
  Engine.setLexicon(lex);
  assert.equal(Engine.rank(PROGRAMS, CONCEPTS, "σεφ").length, 2);
  Engine.resetLexicon();
});
