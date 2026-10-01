#!/usr/bin/env node
// Δείχνει πώς αλλάζουν τα αποτελέσματα αναζήτησης αν εφαρμοστεί ένας υποψήφιος κατάλογος.
//
//   npm run ranking:diff -- data/catalog-check/<φάκελος>
//
// Γράφει RANKING-DIFF.txt και ranking-diff.json στον ίδιο φάκελο. Δεν αλλάζει τίποτα.
// Η λογική είναι στο server/ranking-diff.js (την ίδια χρησιμοποιεί και το admin).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const RankingDiff = require("../server/ranking-diff.js");

const ROOT = path.join(__dirname, "..");
const dirArg = process.argv[2];
if (!dirArg) {
  console.error("Χρήση: npm run ranking:diff -- data/catalog-check/<φάκελος>");
  process.exit(1);
}
const dir = path.resolve(ROOT, dirArg);
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const current = read(path.join(ROOT, "public/programs.json"));
const candidate = read(path.join(dir, "programs.candidate.json"));
const concepts = read(path.join(ROOT, "public/concepts.json"));
const fixture = read(path.join(ROOT, "test/fixtures/search-regression.json"));
let changed = new Set();
try {
  const { diff } = read(path.join(dir, "report.json"));
  changed = new Set([...(diff.gaps_filled || []).map((x) => x.slug), ...(diff.new_added || []).map((x) => x.slug)]);
} catch (e) {}

const result = RankingDiff.compareRankings(current, candidate, concepts, fixture, changed);
const text = RankingDiff.toText(result, [`Υποψήφιος: ${path.relative(ROOT, dir)}`]);
fs.writeFileSync(path.join(dir, "RANKING-DIFF.txt"), text);
fs.writeFileSync(path.join(dir, "ranking-diff.json"), JSON.stringify(result, null, 2));
console.log(text.split("\n").slice(0, 5).join("\n"));
result.groups.forEach((g) => console.log(`--> ${g.label}: άλλαξαν ${g.changed} από ${g.queries}`));
console.log(`Λεπτομέρειες: ${path.relative(ROOT, path.join(dir, "RANKING-DIFF.txt"))}`);
