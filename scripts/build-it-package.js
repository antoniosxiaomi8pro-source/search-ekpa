#!/usr/bin/env node
// Builds the production handoff package for EKPA IT (R0, docs/B0-architecture-decisions.md §8).
//
//   npm run package:it -- --date 2026-10-15
//   npm run package:it -- --date 2026-10-15 --rev 2          (second package of the same day: ...-2026-10-15-v2-...)
//   npm run package:it -- --date 2026-10-15 --ref <commit>   (default: HEAD)
//   npm run package:it -- --date 2026-10-15 --out <dir>      (default: ~/Desktop/Search EKPA FINAL VESRSION IT )
//
// What it guarantees (each step stops the build on failure):
//  1. Backend code comes from a COMMIT via `git archive` - never from the working tree,
//     so an old or half-edited copy can't slip in (the 2026-09-30 mistake).
//  2. The packaged backend passes its own full test suite.
//  3. The packaged backend, started for real, serves the exact API contract the GTM
//     widget calls (typeahead, paged relevance, paged price_asc, /api/programs, CORS).
//  4. No secrets / runtime data inside (.env, analytics, data/, *.tmp, .DS_Store).
//  5. The GTM artifact is the frozen PRODUCTION file, points at IT's backend, is ES5.
//  6. A release addendum for this date exists (release/it-docs/HANDOVER-NOTES-ADDENDUM-<date>.md).
//  7. A manifest with SHA-256 of every key file is written, and an existing zip is
//     NEVER overwritten - every change is a new dated package.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PROD_BACKEND = "https://smartfinder.elearningekpa.gr";
const WIDGET_FILE = "release/gtm/ekpa-search-widget-gtm-v26-PRODUCTION.txt";
const ROOT_DOCS = [
  "ADMIN-PANEL-GUIDE.md", "ADMIN-CATALOG-GUIDE.md", "API-KEY-SETUP.md", "ARCHITECTURE.md", "DEPLOY-Railway.md",
  "DEPLOY-SelfHosted.md", "GTMREADME.md", "HANDOVER-NOTES.md", "INSTALL-GUIDE.md",
];
// Not shipped inside search-ekpa/: Brandery-internal docs and the release assets
// themselves (they are placed at the package top level instead).
const EXCLUDE_FROM_BACKEND = ["docs", "release", ".DS_Store"];
const FORBIDDEN = [/^\.env$/, /analytics\.json$/, /\.tmp$/, /(^|\/)data\//, /\.DS_Store$/, /(^|\/)node_modules(\/|$)/];

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
function fail(msg) {
  console.error("\n⛔ ΤΟ ΠΑΚΕΤΟ ΔΕΝ ΦΤΙΑΧΤΗΚΕ: " + msg);
  process.exit(1);
}
function step(msg) {
  console.log("• " + msg);
}
function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) return [path.relative(base, full)];
    return e.isDirectory() ? walk(full, base) : [path.relative(base, full)];
  });
}

// ---- GTM artifact checks ----
function checkWidget(file) {
  const src = fs.readFileSync(file, "utf8");
  const m = /var BACKEND_URL\s*=\s*"([^"]+)"/.exec(src);
  if (!m) fail("Το widget δεν έχει γραμμή BACKEND_URL.");
  if (m[1] !== PROD_BACKEND) fail(`Το PRODUCTION widget δείχνει σε ${m[1]} αντί για ${PROD_BACKEND}.`);
  // GTM Custom HTML compiles as ES5. Strip comments and string literals, then look
  // for ES2015+ syntax.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  const es6 = [[/\blet\s/, "let"], [/\bconst\s/, "const"], [/=>/, "arrow function"], [/`/, "template literal"], [/\?\./, "optional chaining"], [/\?\?/, "nullish coalescing"]];
  for (const [re, name] of es6) if (re.test(code)) fail(`Το widget περιέχει ${name} (μη ES5) - ο GTM θα το απορρίψει.`);
}

const SMOKE_TOKEN = "smoke-" + crypto.randomBytes(8).toString("hex");

// ---- Contract smoke test against the packaged backend ----
async function smokeTest(backendDir) {
  const port = await new Promise((resolve, reject) => {
    const s = require("node:net").createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port: p } = s.address(); s.close(() => resolve(p)); });
  });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-pkg-data-"));
  const server = spawn(process.execPath, ["server/server.js"], {
    cwd: backendDir,
    env: { PATH: process.env.PATH, PORT: String(port), DATA_DIR: dataDir, ALLOWED_ORIGINS: "https://elearningekpa.gr", ADMIN_TOKEN: SMOKE_TOKEN },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), 20000);
      server.stdout.on("data", () => { if (log.includes("listening")) { clearTimeout(t); resolve(); } });
      server.on("exit", (c) => reject(new Error("exit " + c)));
    }).catch((e) => fail("Ο packaged server δεν ξεκίνησε (" + e.message + "):\n" + log));

    const base = `http://127.0.0.1:${port}`;
    const ORIGIN = { Origin: "https://elearningekpa.gr" };
    const q = encodeURIComponent("ψυχολογία");
    const getJson = async (p, headers = ORIGIN) => {
      const r = await fetch(base + p, { headers });
      if (r.status !== 200) fail(`${p} → HTTP ${r.status}`);
      return r.json();
    };

    const health = await getJson("/health");
    if (!health.ok || !(health.programs > 0)) fail("/health δεν απαντά σωστά: " + JSON.stringify(health));

    const ta = await getJson(`/api/search?q=${q}&limit=6&fields=compact`);
    if (!Array.isArray(ta) || ta.length === 0 || ta.length > 6) fail("Typeahead: αναμενόταν array 1-6 στοιχείων.");
    const keys = Object.keys(ta[0]).sort().join(",");
    if (keys !== "id,image_url,price,slug,title,url") fail("Typeahead compact πεδία: " + keys);

    for (const sort of ["relevance", "price_asc"]) {
      const d = await getJson(`/api/search?q=${q}&format=paged&page=1&page_size=40&sort=${sort}`);
      if (Array.isArray(d) || !Array.isArray(d.results) || !d.pagination) {
        fail(`format=paged&sort=${sort}: ο backend απάντησε χωρίς {results, pagination} - το widget v25 θα έδειχνε 0 αποτελέσματα.`);
      }
      if (d.results.length === 0 || d.results.length > 40) fail(`paged ${sort}: ${d.results.length} αποτελέσματα.`);
      if (sort === "price_asc") {
        const prices = d.results.map((r) => r.price).filter((p) => p !== null && p !== undefined && p !== "").map(Number);
        if (prices.some((p, i) => i > 0 && p < prices[i - 1])) fail("price_asc: οι τιμές δεν είναι σε αύξουσα σειρά.");
      }
    }

    const programs = await getJson("/api/programs");
    if (!Array.isArray(programs) || programs.length === 0) fail("/api/programs άδειο.");

    // v26 widget: every visitor-facing program carries working category links.
    const noLinks = programs.filter((p) => !Array.isArray(p.category_links));
    if (noLinks.length) fail(`/api/programs: ${noLinks.length} προγράμματα χωρίς category_links - το widget v26 δεν θα έδειχνε links κατηγοριών.`);
    if (!programs.some((p) => p.category_links.length > 1)) fail("/api/programs: κανένα πρόγραμμα με περισσότερες από μία κατηγορίες.");
    // Hidden programs never reach visitors, and /health reports both numbers.
    if (!(health.active_programs > 0 && health.active_programs < health.programs)) fail("/health: αναμενόταν active_programs < programs (κρυμμένα προγράμματα): " + JSON.stringify(health));
    if (programs.length !== health.active_programs) fail(`/api/programs (${programs.length}) δεν ταιριάζει με active_programs (${health.active_programs}).`);
    if (programs.some((p) => p.status === "inactive")) fail("/api/programs περιέχει κρυμμένο (inactive) πρόγραμμα.");
    const noId = programs.filter((p) => p.id === null || p.id === undefined);
    const noDesc = programs.filter((p) => !(p.description_full || p.description_for_matching));
    const noCat = programs.filter((p) => !p.primary_area);
    const noPrice = programs.filter((p) => p.price === null || p.price === undefined || p.price === "");

    // Admin "Κατάλογος" tab: endpoint works with the token, is closed without it, and the page ships the tab.
    const adminOk = await fetch(`${base}/api/admin/catalog`, { headers: { "x-admin-token": SMOKE_TOKEN } });
    if (adminOk.status !== 200) fail("GET /api/admin/catalog με σωστό token → HTTP " + adminOk.status);
    const cat = await adminOk.json();
    if (!cat || !cat.live || cat.live.active !== health.active_programs || cat.live.inactive !== health.programs - health.active_programs) fail("/api/admin/catalog: μη αναμενόμενη απάντηση: " + JSON.stringify(cat).slice(0, 300));
    if ((await fetch(`${base}/api/admin/catalog`)).status !== 401) fail("GET /api/admin/catalog χωρίς token δεν απορρίφθηκε.");
    const adminPage = await (await fetch(`${base}/admin-taxonomy.html`)).text();
    if (!adminPage.includes("Κατάλογος")) fail("Το admin-taxonomy.html δεν έχει την καρτέλα Κατάλογος.");

    const allowed = await fetch(`${base}/api/search?q=hr`, { headers: ORIGIN });
    if (allowed.headers.get("access-control-allow-origin") !== "https://elearningekpa.gr") fail("CORS: δεν επιτρέπεται το https://elearningekpa.gr.");
    const denied = await fetch(`${base}/api/search?q=hr`, { headers: { Origin: "https://evil.example" } });
    if (denied.status !== 403) fail("CORS: άγνωστο origin δεν απορρίφθηκε (HTTP " + denied.status + ").");

    return { health, typeahead: ta.length, programs: programs.length, gaps: { noId: noId.length, noDesc: noDesc.length, noCat: noCat.length, noPrice: noPrice.length } };
  } finally {
    // Wait for the server to exit before removing its DATA_DIR (it writes there).
    if (server.exitCode === null) await new Promise((r) => { server.once("exit", r); server.kill(); });
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function main() {
  const date = arg("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("Δώσε --date YYYY-MM-DD.");
  const rev = arg("rev");
  if (rev !== undefined && !/^[2-9]$|^[1-9]\d$/.test(rev)) fail("Το --rev πρέπει να είναι αριθμός ≥ 2 (το πρώτο πακέτο της ημέρας δεν έχει --rev).");
  const label = rev ? `${date}-v${rev}` : date; // used in every file name inside the package
  const ref = arg("ref", "HEAD");
  const outDir = path.resolve(arg("out", process.env.IT_PACKAGE_DIR || path.join(os.homedir(), "Desktop", "Search EKPA FINAL VESRSION IT ")));
  const name = `ekpa-smart-finder-IT-package-${label}-PRODUCTION`;
  const zipPath = path.join(outDir, name + ".zip");

  // 7 (early): never overwrite a package that may already have been sent.
  if (fs.existsSync(zipPath)) fail(`Υπάρχει ήδη ${zipPath}. Τα πακέτα που έχουν σταλεί δεν αλλάζουν - χρησιμοποίησε νέα ημερομηνία.`);
  if (!fs.existsSync(outDir)) fail("Ο φάκελος εξόδου δεν υπάρχει: " + outDir);

  const commit = git("rev-parse", ref);
  const subject = git("log", "-1", "--format=%s", commit);
  step(`Κώδικας από commit ${commit.slice(0, 7)} (${subject})`);
  const dirty = git("status", "--porcelain", "--untracked-files=no").split("\n").filter((l) => l && !l.endsWith(".DS_Store"));
  if (ref === "HEAD" && dirty.length) {
    console.log("  ⚠ Υπάρχουν αλλαγές που δεν έχουν γίνει commit - ΔΕΝ μπαίνουν στο πακέτο:\n    " + dirty.join("\n    "));
  }

  // 6 + 5: release assets (taken from the working tree; they are frozen by SHA in the manifest).
  const addendum = path.join(ROOT, "release/it-docs", `HANDOVER-NOTES-ADDENDUM-${label}.md`);
  if (!fs.existsSync(addendum)) fail(`Λείπει το ${path.relative(ROOT, addendum)} - κάθε πακέτο χρειάζεται τις δικές του σημειώσεις για το IT.`);
  const widget = path.join(ROOT, WIDGET_FILE);
  if (!fs.existsSync(widget)) fail("Λείπει το " + WIDGET_FILE);
  checkWidget(widget);
  step("GTM widget: PRODUCTION backend, ES5 - OK");

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "sf-pkg-"));
  const pkg = path.join(stage, name);
  const backend = path.join(pkg, "search-ekpa");
  fs.mkdirSync(backend, { recursive: true });
  let testsPass = null;
  try {
    // 1. Code from the commit.
    execFileSync("sh", ["-c", `git archive ${commit} | tar -x -C "${backend}"`], { cwd: ROOT });
    for (const e of EXCLUDE_FROM_BACKEND) fs.rmSync(path.join(backend, e), { recursive: true, force: true });
    for (const f of walk(backend)) if (f.endsWith(".DS_Store")) fs.rmSync(path.join(backend, f));
    step("Backend εξήχθη από το git");

    // 2. Tests, with the repo's installed dependencies.
    fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(backend, "node_modules"));
    try {
      const out = execFileSync("npm", ["test"], { cwd: backend, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const pass = /ℹ pass (\d+)/.exec(out), failN = /ℹ fail (\d+)/.exec(out);
      if (!pass || !failN || failN[1] !== "0") fail("Tests:\n" + out.slice(-2000));
      testsPass = pass[1];
      step(`Tests: ${pass[1]} pass / 0 fail`);
    } catch (e) {
      fail("Τα tests απέτυχαν:\n" + String(e.stdout || e.message).slice(-3000));
    }

    // 3. Contract smoke test.
    const smoke = await smokeTest(backend);
    smoke.testsPass = testsPass;
    step(`API contract του widget: OK (${smoke.health.programs} προγράμματα, ${smoke.health.active_programs ?? smoke.health.programs} ενεργά)`);
    fs.unlinkSync(path.join(backend, "node_modules"));
    step(`Κενά στα ορατά προγράμματα: χωρίς id ${smoke.gaps.noId}, περιγραφή ${smoke.gaps.noDesc}, κατηγορία ${smoke.gaps.noCat}, τιμή ${smoke.gaps.noPrice}`);

    // The addendum tells IT what /health must return. It has to be the number this very
    // package returns, not one remembered from an older package.
    const addText = fs.readFileSync(addendum, "utf8");
    const healthJson = JSON.stringify(smoke.health);
    if (!addText.includes(healthJson)) fail(`Το addendum δεν περιέχει την πραγματική απάντηση του /health αυτού του πακέτου: ${healthJson}`);
    if (!addText.includes(`tests ${smoke.testsPass} / pass ${smoke.testsPass} / fail 0`)) fail(`Το addendum δεν αναφέρει τον πραγματικό αριθμό tests: tests ${smoke.testsPass} / pass ${smoke.testsPass} / fail 0`);

    // Top-level docs + release assets.
    for (const f of ROOT_DOCS) if (fs.existsSync(path.join(backend, f))) fs.copyFileSync(path.join(backend, f), path.join(pkg, f));
    const addenda = fs.readdirSync(path.join(ROOT, "release/it-docs")).filter((f) => f.endsWith(".md")).sort();
    for (const f of addenda) fs.copyFileSync(path.join(ROOT, "release/it-docs", f), path.join(pkg, f));
    fs.copyFileSync(widget, path.join(pkg, path.basename(WIDGET_FILE)));

    // 4. Nothing forbidden inside.
    const files = walk(pkg);
    const bad = files.filter((f) => FORBIDDEN.some((re) => re.test(f)));
    if (bad.length) fail("Απαγορευμένα αρχεία στο πακέτο:\n  " + bad.join("\n  "));
    step(`Έλεγχος περιεχομένου: ${files.length} αρχεία, κανένα απαγορευμένο`);

    // 7. Manifest.
    const keyFiles = ["server/server.js", "server/search-api-contract.js", "server/catalog-sync.js", "server/catalog-store.js", "server/program-enrich.js", "server/ranking-diff.js", "public/search-engine.js", "public/concepts.json", "public/programs.json", "public/index.html"]
      .filter((f) => fs.existsSync(path.join(backend, f)));
    const manifest = [
      `EKPA SMART FINDER — PRODUCTION HANDOFF — ${label}`,
      "",
      "Production GTM artifact:",
      `${sha256(path.join(pkg, path.basename(WIDGET_FILE)))}  ${path.basename(WIDGET_FILE)}`,
      `Production backend: ${PROD_BACKEND}`,
      "GTM container: GTM-TZJNFCW",
      "",
      `Backend source: Brandery repository commit ${commit.slice(0, 7)} (${subject})`,
      ...keyFiles.map((f) => `${sha256(path.join(backend, f))}  ${f}`),
      "",
      "Build checks: tests PASS · widget API contract PASS · CORS PASS · no secrets/data inside",
      "Deployment order: BACKEND FIRST -> verify (see addendum) -> THEN enable GTM production tag.",
      "TESTING preservation: SmartFinder - TESTING2 must remain unchanged.",
      "",
      `Read first: HANDOVER-NOTES-ADDENDUM-${label}.md`,
      `Where older documents conflict, the ${label} addendum wins.`,
      "",
    ].join("\n");
    fs.writeFileSync(path.join(pkg, `RELEASE-MANIFEST-${label}.txt`), manifest);

    execFileSync("zip", ["-qrX", zipPath, name], { cwd: stage });
    console.log(`\n✅ ${zipPath}\n`);
    console.log(manifest);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

main().catch((e) => fail(e.stack || String(e)));
