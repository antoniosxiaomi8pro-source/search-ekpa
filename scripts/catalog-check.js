#!/usr/bin/env node
// Έλεγχος καταλόγου από τη γραμμή εντολών (μέχρι να υπάρξει το κουμπί στο admin).
//
//   npm run catalog:check                 κατάσταση + τιμές (~25 λεπτά, στο παρασκήνιο)
//   npm run catalog:check -- --status-only μόνο κατάσταση (1 αίτημα, λίγα δευτερόλεπτα)
//   npm run catalog:check -- --from <φάκελος> ξαναβγάζει τη λίστα από ήδη κατεβασμένο check.json
//   npm run catalog:apply -- <φάκελος>    εφαρμογή ενός ελεγμένου αποτελέσματος
//
// Το check ΔΕΝ αγγίζει το public/programs.json. Γράφει τα πάντα σε
// data/catalog-check/<ημερομηνία>/ (SUMMARY.txt, report.json, programs.candidate.json).
// Το apply κρατά πρώτα backup του τρέχοντος programs.json στον ίδιο φάκελο.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const Sync = require("../server/catalog-sync.js");

const ROOT = path.join(__dirname, "..");
const PROGRAMS_PATH = path.join(ROOT, "public/programs.json");
const OUT_ROOT = path.join(ROOT, "data/catalog-check");

function stamp() {
  return new Date().toISOString().replace(/[:]/g, "-").replace(/\..+$/, "");
}

function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function summaryText(summary, diff) {
  const lines = [];
  const list = (title, items, fmt) => {
    lines.push(`${title}: ${items.length}`);
    items.slice(0, 50).forEach((x) => lines.push("   " + fmt(x)));
    if (items.length > 50) lines.push(`   … και άλλα ${items.length - 50} (βλ. report.json)`);
  };
  lines.push("ΕΛΕΓΧΟΣ ΚΑΤΑΛΟΓΟΥ — EKPA Smart Finder");
  lines.push(`Ημερομηνία: ${summary.checked_at}`);
  lines.push("");
  lines.push(`Κατάλογος: ${summary.catalog_total} · Στον «Τρέχοντα Κύκλο»: ${summary.in_cycle}`);
  lines.push(`Μετά την εφαρμογή: ${summary.active_after} ενεργά · ${summary.inactive_after} κρυμμένα`);
  lines.push("");
  list("− Κρύβονται (εκτός κύκλου)", diff.deactivated, (x) => `${x.slug} — ${x.title}`);
  list("+ Επανεμφανίζονται", diff.reactivated, (x) => `${x.slug} — ${x.title}`);
  list("★ Νέα στον κύκλο (δεν υπάρχουν στον κατάλογο, ΔΕΝ προστίθενται αυτόματα)", diff.new_in_cycle, (x) => `${x.slug} — ${x.title}`);
  list("€ Τιμές που συμπληρώθηκαν", diff.price_filled, (x) => `${x.slug}: ${x.price}`);
  list("€ Τιμές που άλλαξαν", diff.price_changed, (x) => `${x.slug}: ${x.from} → ${x.to}`);
  list("⚠ Μεγάλη αλλαγή τιμής (>30%)", diff.price_flagged, (x) => `${x.slug}: ${x.from} → ${x.to}`);
  list("⚠ Στον κύκλο, αλλά η σελίδα λέει «δεν είναι διαθέσιμο»", diff.in_cycle_but_unavailable, (x) => `${x.slug} — ${x.title}`);
  list("⚠ Σελίδες που δεν φορτώθηκαν (κρατήθηκαν οι παλιές τιμές)", diff.page_errors, (x) => `${x.slug}: HTTP ${x.http}`);
  lines.push("");
  if (summary.can_apply) {
    lines.push("✅ Μπορεί να εφαρμοστεί μετά από έλεγχο.");
  } else {
    lines.push("⛔ ΔΕΝ μπορεί να εφαρμοστεί:");
    summary.blockers.forEach((b) => lines.push("   " + b));
  }
  return lines.join("\n") + "\n";
}

async function runCheck(statusOnly, fromDir) {
  const programs = JSON.parse(fs.readFileSync(PROGRAMS_PATH, "utf8"));
  const outDir = fromDir ? path.resolve(ROOT, fromDir) : path.join(OUT_ROOT, stamp());
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Έλεγχος καταλόγου (${fromDir ? "από αποθηκευμένο check.json" : statusOnly ? "μόνο κατάσταση" : "κατάσταση + τιμές"}) → ${path.relative(ROOT, outDir)}`);

  const check = fromDir ? JSON.parse(fs.readFileSync(path.join(outDir, "check.json"), "utf8")) : await Sync.checkCatalog(programs, {
    withPrices: !statusOnly,
    onProgress: ({ done, total }) => {
      if (done % 25 === 0 || done === total) console.log(`  σελίδες: ${done}/${total}`);
    },
  });
  if (!check.ok) {
    console.error("Αποτυχία: " + check.error);
    process.exit(1);
  }
  const { candidate, diff, summary } = Sync.buildCandidate(programs, check);
  writeAtomic(path.join(outDir, "check.json"), JSON.stringify(check));
  writeAtomic(path.join(outDir, "report.json"), JSON.stringify({ summary, diff }, null, 2));
  writeAtomic(path.join(outDir, "programs.candidate.json"), JSON.stringify(candidate));
  const text = summaryText(summary, diff);
  writeAtomic(path.join(outDir, "SUMMARY.txt"), text);
  console.log("\n" + text);
  console.log(`Εφαρμογή (μετά από έλεγχο): npm run catalog:apply -- ${path.relative(ROOT, outDir)}`);
}

function runApply(dirArg, force) {
  if (!dirArg) {
    console.error("Χρήση: npm run catalog:apply -- data/catalog-check/<φάκελος>");
    process.exit(1);
  }
  const dir = path.resolve(ROOT, dirArg);
  const { summary } = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8"));
  if (!summary.can_apply && !force) {
    console.error("⛔ Η εφαρμογή μπλοκαρίστηκε:\n  " + summary.blockers.join("\n  "));
    process.exit(1);
  }
  const candidate = JSON.parse(fs.readFileSync(path.join(dir, "programs.candidate.json"), "utf8"));
  const current = fs.readFileSync(PROGRAMS_PATH, "utf8");
  if (!Array.isArray(candidate) || candidate.length !== JSON.parse(current).length) {
    console.error("⛔ Το candidate δεν ταιριάζει με τον τρέχοντα κατάλογο (διαφορετικό πλήθος). Τρέξε νέο έλεγχο.");
    process.exit(1);
  }
  const backup = path.join(dir, "programs.before-apply.json");
  writeAtomic(backup, current);
  writeAtomic(PROGRAMS_PATH, JSON.stringify(candidate));
  console.log(`✅ Εφαρμόστηκε. Backup: ${path.relative(ROOT, backup)}`);
  console.log(`   Ενεργά: ${summary.active_after} · Κρυμμένα: ${summary.inactive_after}`);
  console.log("   Επόμενο: npm test");
}

const args = process.argv.slice(2);
if (args[0] === "apply") {
  runApply(args[1], args.includes("--force"));
} else {
  const fromIdx = args.indexOf("--from");
  runCheck(args.includes("--status-only"), fromIdx > -1 ? args[fromIdx + 1] : null).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
