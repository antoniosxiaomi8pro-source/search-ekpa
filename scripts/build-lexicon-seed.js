#!/usr/bin/env node
// R1, step 1: writes public/lexicon.json - the search lexicon that today lives inside
// public/search-engine.js - with real Greek words that a person can read and edit.
//
//   node scripts/build-lexicon-seed.js           write public/lexicon.json (refuses to overwrite)
//   node scripts/build-lexicon-seed.js --check   only verify that public/lexicon.json is
//                                                 exactly equivalent to the engine's tables
//
// The engine stores words in a "folded" form (accents removed, η/υ/ι/ει/οι merged, ...) which
// cannot be turned back into the spelling a person would type. The original spelling is
// recovered from the comments next to each entry, or from the explicit lists below, and then
// PROVEN: folding every word must give back exactly the engine's key, and nothing more, nothing less.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ENGINE = path.join(ROOT, "public/search-engine.js");
const OUT = path.join(ROOT, "public/lexicon.json");
const SCHEMA_VERSION = 1;

// Spelling that cannot be recovered from comments (checked by the proof below).
const STOPWORD_ORIGINALS = "και για της του τον το τα την με από στο στη στην στον στα είναι ένα μια αλλά να κάτι θέλω ψάχνω ήθελα μπορώ μπορείτε προτείνετε κάποιο κάποια είμαι that and the of in for to a an with on πρόγραμμα προγράμματα program programs".split(" ");
const PHILOLOGIST_ORIGINALS = ["φιλόλογος", "φιλόλογο", "φιλολόγου", "φιλόλογοι", "φιλολόγους"];
const COOKING_ORIGINALS = ["chef", "σεφ", "μαγειρική", "μαγειρικής"];
// Words that make a program count for the audience when its description names them after "απευθύνεται".
const PHILOLOGIST_SCAN_TERMS = ["φιλολογ", "φιλόλογος", "φιλόλογοι", "φιλολόγους", "φιλολόγου", "φιλολογίας", "φιλολογιών", "φιλολογίες", "φιλολογικών"];
const OVERRIDES = { "μαρκετινγκ": "μάρκετινγκ" }; // comment says "greeklish/Greek transliteration"

// The engine's tables, read from the engine source itself (not retyped).
function loadEngineTables() {
  const src = fs.readFileSync(ENGINE, "utf8");
  const patched = src.replace(
    /  return \{\n    normalize,/,
    "  return {STOPWORDS_ALL: STOPWORDS, CATEGORY_ALIASES, AUDIENCE_MULTI_CATEGORY_ALIASES, AUDIENCE_PROGRAM_SETS, AUDIENCE_PROGRAM_ALIASES, TOPIC_SETS, TOPIC_ALIASES,\n    normalize,"
  );
  if (patched === src) throw new Error("Δεν βρέθηκε το return του search-engine.js - άλλαξε η μορφή του αρχείου;");
  const m = { exports: {} };
  new Function("module", patched)(m);
  const E = m.exports;
  return { E, src, fold: (w) => E.foldGreek(E.normalize(w)) };
}

// "δ" escapes -> real characters, so comments can be read.
const unescapeU = (l) => l.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

function originalsFromComments(src, keys, fold) {
  const lines = src.split("\n").map(unescapeU);
  const out = {};
  for (const k of keys) {
    if (OVERRIDES[k]) { out[k] = OVERRIDES[k]; continue; }
    const line = lines.find((l) => l.trim().startsWith('"' + k + '"'));
    const words = line ? ((line.split("//")[1] || "").match(/\p{L}+/gu) || []) : [];
    const hit = words.find((w) => /\p{Script=Greek}/u.test(w) && fold(w) === k);
    if (!hit) throw new Error(`Δεν βρέθηκε αρχική γραφή για το κλειδί "${k}"`);
    out[k] = hit;
  }
  return out;
}

const sameSet = (a, b) => a.length === b.length && new Set(a).size === new Set(b).size && a.every((x) => new Set(b).has(x));

function build() {
  const { E, src, fold } = loadEngineTables();

  // stopwords
  const stopKeys = [...E.STOPWORDS_ALL];
  const stopwords = STOPWORD_ORIGINALS.slice();

  // word -> one category
  const catKeys = Object.keys(E.CATEGORY_ALIASES);
  const catOrig = originalsFromComments(src, catKeys, fold);
  const category_words = catKeys.map((k) => ({ word: catOrig[k], category: E.CATEGORY_ALIASES[k] }));

  // audience words -> several categories (all keys must share the same targets)
  const audKeys = Object.keys(E.AUDIENCE_MULTI_CATEGORY_ALIASES);
  const audOrig = originalsFromComments(src, audKeys, fold);
  const targets = E.AUDIENCE_MULTI_CATEGORY_ALIASES[audKeys[0]];
  audKeys.forEach((k) => { if (JSON.stringify(E.AUDIENCE_MULTI_CATEGORY_ALIASES[k]) !== JSON.stringify(targets)) throw new Error("Οι λέξεις κοινού δεν έχουν όλες τις ίδιες κατηγορίες"); });
  const audience_categories = [{ id: "teacher", words: audKeys.map((k) => audOrig[k]), categories: targets.slice() }];

  // audience words -> specific programs
  const audience_programs = [{ id: "philologist", words: PHILOLOGIST_ORIGINALS.slice(), programs: E.AUDIENCE_PROGRAM_SETS.philologist.slice(), scan_terms: PHILOLOGIST_SCAN_TERMS.slice() }];

  // topics
  const topics = [{ id: "cooking", words: COOKING_ORIGINALS.slice(), programs: E.TOPIC_SETS.cooking.slice() }];

  const lexicon = { schema_version: SCHEMA_VERSION, stopwords, category_words, audience_categories, audience_programs, topics };
  verify(lexicon, E);
  return lexicon;
}

// Proof: the engine's own compiler turns the readable lexicon into exactly the default tables.
function verify(lexicon, E) {
  const got = E.compileLexicon(lexicon);
  const want = E.getDefaultLexiconTables();
  const problems = [];
  if (!sameSet(got.stopwords, want.stopwords)) problems.push("stopwords: διαφορετικό σύνολο");
  const eq = (name, a, b) => { if (JSON.stringify(Object.entries(a).sort()) !== JSON.stringify(Object.entries(b).sort())) problems.push(name + ": διαφορά"); };
  eq("category_words", got.category, want.category);
  eq("audience_categories", got.audienceMulti, want.audienceMulti);
  eq("audience_programs.sets", got.audienceSets, want.audienceSets);
  eq("audience_programs.aliases", got.audienceAliases, want.audienceAliases);
  eq("topics.sets", got.topicSets, want.topicSets);
  eq("topics.aliases", got.topicAliases, want.topicAliases);
  eq("audience_programs.scan_terms", Object.fromEntries(Object.entries(got.scan).map(([k, v]) => [k, v.slice().sort()])), Object.fromEntries(Object.entries(want.scan).map(([k, v]) => [k, v.slice().sort()])));
  if (problems.length) throw new Error("Το lexicon.json δεν ισοδυναμεί με τους πίνακες της μηχανής:\n  " + problems.join("\n  "));
}

function main() {
  if (process.argv.includes("--check")) {
    const { E, fold } = loadEngineTables();
    verify(JSON.parse(fs.readFileSync(OUT, "utf8")), E);
    console.log("✅ public/lexicon.json ισοδυναμεί ακριβώς με τους πίνακες της μηχανής.");
    return;
  }
  if (fs.existsSync(OUT)) { console.error("⛔ Υπάρχει ήδη " + OUT + " - δεν αντικαθίσταται. Χρησιμοποίησε --check."); process.exit(1); }
  const lexicon = build();
  fs.writeFileSync(OUT, JSON.stringify(lexicon, null, 2) + "\n");
  console.log("✅ Γράφτηκε " + OUT);
  console.log(`   stopwords ${lexicon.stopwords.length} · λέξη→κατηγορία ${lexicon.category_words.length} · κοινό→κατηγορίες ${lexicon.audience_categories[0].words.length} λέξεις · κοινό→προγράμματα ${lexicon.audience_programs[0].words.length} λέξεις/${lexicon.audience_programs[0].programs.length} προγράμματα · θέματα ${lexicon.topics[0].words.length} λέξεις/${lexicon.topics[0].programs.length} προγράμματα`);
  console.log("   Απόδειξη: κάθε λέξη, αφού διπλωθεί, δίνει ακριβώς το κλειδί της μηχανής (και κανένα επιπλέον).");
}

module.exports = { verify, loadEngineTables, SCHEMA_VERSION };
if (require.main === module) main();
