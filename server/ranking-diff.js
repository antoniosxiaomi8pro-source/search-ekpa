"use strict";

// Compares visitor-facing top-10 results between two catalogs. Used by the CLI
// (scripts/ranking-diff.js) and by the admin "Κατάλογος" tab before applying a check.
//
// Query set: the regression fixture's verified queries + every category name + the
// first term of every taxonomy concept.

const Engine = require("../public/search-engine.js");

const active = (list) => list.filter((p) => p.status !== "inactive");

function querySet(programs, concepts, fixture) {
  const categories = [...new Set(programs.flatMap((p) => [p.primary_area, ...(p.areas_of_study || [])]).filter(Boolean))];
  return [
    ["Ελεγμένες αναζητήσεις", Object.keys(fixture || {})],
    ["Ονόματα κατηγοριών", categories],
    ["Πρώτος όρος κάθε έννοιας", Object.values(concepts || {}).map((t) => t[0]).filter(Boolean)],
  ].map(([label, qs]) => [label, [...new Set(qs)]]);
}

// changedSlugs: programs filled/added by the check, flagged in the output.
// The sync version (~1.6s for 173 queries) is for the CLI. Inside the live server use
// compareRankingsAsync, which yields to the event loop between queries so visitors'
// searches are never queued behind it.
function compareRankings(currentAll, candidateAll, concepts, fixture, changedSlugs = new Set()) {
  const gen = compareSteps(currentAll, candidateAll, concepts, fixture, changedSlugs);
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

async function compareRankingsAsync(currentAll, candidateAll, concepts, fixture, changedSlugs = new Set()) {
  const gen = compareSteps(currentAll, candidateAll, concepts, fixture, changedSlugs);
  let r = gen.next();
  while (!r.done) {
    await new Promise((resolve) => setImmediate(resolve));
    r = gen.next();
  }
  return r.value;
}

function* compareSteps(currentAll, candidateAll, concepts, fixture, changedSlugs) {
  const current = active(currentAll);
  const candidate = active(candidateAll);
  const titleOf = new Map([...current, ...candidate].map((p) => [p.slug, p.title]));
  const groups = [];
  let total = 0;
  let changedTotal = 0;
  for (const [label, queries] of querySet(current, concepts, fixture)) {
    const changes = [];
    for (const q of queries) {
      yield;
      total++;
      const before = Engine.rank(current, concepts, q);
      const after = Engine.rank(candidate, concepts, q);
      const b10 = before.slice(0, 10).map((p) => p.slug);
      const a10 = after.slice(0, 10).map((p) => p.slug);
      if (JSON.stringify(b10) === JSON.stringify(a10)) continue;
      changedTotal++;
      changes.push({
        query: q,
        total_before: before.length,
        total_after: after.length,
        added: a10.filter((s) => !b10.includes(s)).map((s) => ({ slug: s, title: titleOf.get(s), position: a10.indexOf(s) + 1, filled: changedSlugs.has(s) })),
        removed: b10.filter((s) => !a10.includes(s)).map((s) => ({ slug: s, title: titleOf.get(s), position: b10.indexOf(s) + 1 })),
      });
    }
    groups.push({ label, queries: queries.length, changed: changes.length, changes });
  }
  return { active_before: current.length, active_after: candidate.length, queries: total, changed: changedTotal, groups };
}

function toText(result, header = []) {
  const out = [
    "ΑΛΛΑΓΕΣ ΣΤΑ ΑΠΟΤΕΛΕΣΜΑΤΑ ΑΝΑΖΗΤΗΣΗΣ (top-10, μόνο ενεργά)",
    ...header,
    `Ενεργά: ${result.active_before} → ${result.active_after}`,
    `Αναζητήσεις που άλλαξαν: ${result.changed} από ${result.queries}`,
  ];
  for (const g of result.groups) {
    out.push("", `=== ${g.label} (${g.queries}) ===`);
    for (const c of g.changes) {
      out.push("", `«${c.query}»  σύνολο ${c.total_before} → ${c.total_after}`);
      if (!c.added.length && !c.removed.length) out.push("   (ίδια προγράμματα, άλλαξε μόνο η σειρά)");
      c.added.forEach((a) => out.push(`   + #${a.position} ${a.title}${a.filled ? "  [συμπληρώθηκε/νέο]" : ""}`));
      c.removed.forEach((r) => out.push(`   − ήταν #${r.position} ${r.title}`));
    }
    out.push(`--> άλλαξαν ${g.changed} από ${g.queries}`);
  }
  return out.join("\n") + "\n";
}

module.exports = { compareRankings, compareRankingsAsync, toText };
