#!/usr/bin/env node
// Δείχνει πώς αλλάζουν τα αποτελέσματα αναζήτησης αν εφαρμοστεί ένας υποψήφιος κατάλογος.
//
//   npm run ranking:diff -- data/catalog-check/<φάκελος>
//
// Συγκρίνει (μόνο ενεργά προγράμματα, όπως τα βλέπει ο επισκέπτης) το top-10:
//  - των 49 ελεγμένων αναζητήσεων του regression fixture,
//  - κάθε ονόματος κατηγορίας, και του πρώτου όρου κάθε έννοιας του taxonomy.
// Γράφει RANKING-DIFF.txt και ranking-diff.json στον ίδιο φάκελο. Δεν αλλάζει τίποτα.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const Engine = require("../public/search-engine.js");

const ROOT = path.join(__dirname, "..");
const dirArg = process.argv[2];
if (!dirArg) {
  console.error("Χρήση: npm run ranking:diff -- data/catalog-check/<φάκελος>");
  process.exit(1);
}
const dir = path.resolve(ROOT, dirArg);
const active = (list) => list.filter((p) => p.status !== "inactive");
const current = active(JSON.parse(fs.readFileSync(path.join(ROOT, "public/programs.json"), "utf8")));
const candidate = active(JSON.parse(fs.readFileSync(path.join(dir, "programs.candidate.json"), "utf8")));
const concepts = JSON.parse(fs.readFileSync(path.join(ROOT, "public/concepts.json"), "utf8"));
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/search-regression.json"), "utf8"));
let changedSlugs = new Set();
try {
  const { diff } = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8"));
  changedSlugs = new Set([...(diff.gaps_filled || []).map((x) => x.slug), ...(diff.new_added || []).map((x) => x.slug)]);
} catch (e) {}

const categories = [...new Set(current.flatMap((p) => [p.primary_area, ...(p.areas_of_study || [])]).filter(Boolean))];
const groups = [
  ["Ελεγμένες αναζητήσεις (regression fixture)", Object.keys(fixture)],
  ["Ονόματα κατηγοριών", categories],
  ["Πρώτος όρος κάθε έννοιας", Object.values(concepts).map((t) => t[0]).filter(Boolean)],
];

const titleOf = new Map([...current, ...candidate].map((p) => [p.slug, p.title]));
const out = [];
const json = [];
let totalQ = 0, totalChanged = 0;
for (const [label, queries] of groups) {
  const uniq = [...new Set(queries)];
  let changed = 0;
  out.push(`\n=== ${label} (${uniq.length}) ===`);
  for (const q of uniq) {
    totalQ++;
    const before = Engine.rank(current, concepts, q);
    const after = Engine.rank(candidate, concepts, q);
    const b10 = before.slice(0, 10).map((p) => p.slug);
    const a10 = after.slice(0, 10).map((p) => p.slug);
    if (JSON.stringify(b10) === JSON.stringify(a10)) continue;
    changed++;
    totalChanged++;
    const added = a10.filter((s) => !b10.includes(s));
    const removed = b10.filter((s) => !a10.includes(s));
    json.push({ group: label, query: q, total_before: before.length, total_after: after.length, before: b10, after: a10, added, removed });
    out.push(`\n«${q}»  σύνολο ${before.length} → ${after.length}`);
    if (!added.length && !removed.length) out.push("   (ίδια προγράμματα, άλλαξε μόνο η σειρά)");
    added.forEach((s) => out.push(`   + #${a10.indexOf(s) + 1} ${titleOf.get(s)}${changedSlugs.has(s) ? "  [συμπληρώθηκε/νέο]" : ""}`));
    removed.forEach((s) => out.push(`   − ήταν #${b10.indexOf(s) + 1} ${titleOf.get(s)}`));
  }
  out.push(`--> άλλαξαν ${changed} από ${uniq.length}`);
}
const header = [
  "ΑΛΛΑΓΕΣ ΣΤΑ ΑΠΟΤΕΛΕΣΜΑΤΑ ΑΝΑΖΗΤΗΣΗΣ (top-10, μόνο ενεργά)",
  `Υποψήφιος: ${path.relative(ROOT, dir)}`,
  `Ενεργά: ${current.length} → ${candidate.length}`,
  `Αναζητήσεις που άλλαξαν: ${totalChanged} από ${totalQ}`,
];
const text = header.join("\n") + "\n" + out.join("\n") + "\n";
fs.writeFileSync(path.join(dir, "RANKING-DIFF.txt"), text);
fs.writeFileSync(path.join(dir, "ranking-diff.json"), JSON.stringify(json, null, 2));
console.log(header.join("\n"));
console.log(`Λεπτομέρειες: ${path.relative(ROOT, path.join(dir, "RANKING-DIFF.txt"))}`);
