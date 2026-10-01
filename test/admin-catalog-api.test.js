// End-to-end: real server + a local fake EKPA site. Exercises the admin "Κατάλογος" flow:
// check -> review -> apply -> restart keeps it -> rollback, plus the safety rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

// Ask the OS for a free port (random ranges can collide when test files run in parallel).
function freePort() {
  return new Promise((resolve, reject) => {
    const s = require("node:net").createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

const ROOT = path.join(__dirname, "..");
const TOKEN = "test-admin-token";
const full = JSON.parse(fs.readFileSync(path.join(ROOT, "public/programs.json"), "utf8"));
const sample = full.filter((p) => p.status !== "inactive" && /ψυχολογ/i.test(p.title)).slice(0, 8)
  .map((p) => ({ ...p, status_checked_at: "2026-09-01T00:00:00.000Z" }));
const GONE = sample[7].slug; // not in the fake cycle -> must be hidden by the check

// ---- fake site ----
const page = (p) => `<html><script type="application/ld+json">${JSON.stringify([{
  "@type": "Course", name: p.title, description: "Περιγραφή", image: p.image_url,
  hasCourseInstance: { startDate: "2026-10-19" }, offers: { price: String(Number(p.price || 100) + 1) },
}])}</script><body>Κατεύθυνση: <a>${p.primary_area}</a> Απονέμεται <a href="/apply/${p.id}">Κάνε Αίτηση</a>
<div>Προθεσμια Υποβολης Αιτησεων: 9/10/2026</div></body></html>`;
const schedule = () => `<table>${sample.filter((p) => p.slug !== GONE).map((p) =>
  `<tr><td><a href="/courses/${p.slug}"><span class="course-schedule-table__title">${p.title}</span></a></td><td>6</td><td>100</td></tr>`).join("")}</table>`;
const site = http.createServer((req, res) => {
  if (req.url === "/course-schedule") return res.end(schedule());
  const m = /^\/courses\/(.+)$/.exec(req.url);
  const p = m && sample.find((x) => x.slug === decodeURIComponent(m[1]));
  if (!p) { res.statusCode = 404; return res.end(); }
  res.end(page(p));
});

let dir, seedFile, dataDir, siteUrl, server, base;

async function startServer() {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(ROOT, "server/server.js")], {
    env: { ...process.env, PORT: String(port), PROGRAMS_FILE: seedFile, DATA_DIR: dataDir, ADMIN_TOKEN: TOKEN,
      CATALOG_SITE_ORIGIN: siteUrl, CATALOG_CHECK_DELAY_MS: "0", ADMIN_RATE_LIMIT_PER_MIN: "1000", CATALOG_STATUS_RATE_LIMIT_PER_MIN: "1000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 15000);
    server.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); resolve(); } });
    server.on("exit", (c) => reject(new Error("exit " + c)));
  });
}
function stopServer() {
  return new Promise((r) => { server.once("exit", r); server.kill(); });
}
const api = async (method, p, body, token = TOKEN) => {
  const r = await fetch(base + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { "x-admin-token": token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
};
async function waitForJob() {
  for (let i = 0; i < 100; i++) {
    const { body } = await api("GET", "/api/admin/catalog");
    if (body.job && !["running", "comparing"].includes(body.job.state)) return body.job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("job did not finish");
}

test.before(async () => {
  await new Promise((r) => site.listen(0, "127.0.0.1", r));
  siteUrl = `http://127.0.0.1:${site.address().port}`;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-admin-cat-"));
  seedFile = path.join(dir, "programs.json");
  dataDir = path.join(dir, "data");
  fs.writeFileSync(seedFile, JSON.stringify(sample));
  await startServer();
});
test.after(async () => { if (server) await stopServer(); site.close(); });

test("admin catalog: requires the admin token", async () => {
  assert.equal((await api("GET", "/api/admin/catalog", null, "")).status, 401);
  assert.equal((await api("POST", "/api/admin/catalog/check", { mode: "full" }, "wrong")).status, 401);
});

test("admin catalog: starts from the package catalog", async () => {
  const { body } = await api("GET", "/api/admin/catalog");
  assert.equal(body.live.source, "package");
  assert.equal(body.live.active, sample.length);
  assert.equal(body.live.can_apply_here, true);
});

let job;
test("admin catalog: a full check runs in the background and reports changes + ranking diff", async () => {
  const start = await api("POST", "/api/admin/catalog/check", { mode: "full" });
  assert.equal(start.status, 202);
  job = await waitForJob();
  assert.equal(job.state, "done");
  assert.equal(job.summary.deactivated, 1);
  assert.equal(job.diff.deactivated[0].slug, GONE);
  assert.equal(job.summary.price_changed, sample.length - 1);
  assert.equal(job.summary.can_apply, true);
  assert.ok(job.ranking && typeof job.ranking.changed === "number");
  assert.equal(job.candidate, undefined, "the full catalog is never sent to the browser");
  // nothing is live yet
  const programs = (await fetch(base + "/api/programs").then((r) => r.json()));
  assert.ok(programs.some((p) => p.slug === GONE));
});

test("admin catalog: apply needs explicit confirmation and the matching job id", async () => {
  assert.equal((await api("POST", "/api/admin/catalog/apply", { job_id: job.id })).status, 400);
  assert.equal((await api("POST", "/api/admin/catalog/apply", { job_id: "other", confirm: true })).status, 409);
});

test("admin catalog: apply makes the check live immediately, without a restart", async () => {
  const quickBefore = await api("GET", "/api/admin/catalog/quick");
  assert.equal(quickBefore.body.to_hide.length, 1, "reminder shows the pending change");
  const r = await api("POST", "/api/admin/catalog/apply", { job_id: job.id, confirm: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.live.source, "check");
  assert.equal(r.body.live.active, sample.length - 1);
  const programs = await fetch(base + "/api/programs").then((x) => x.json());
  assert.ok(!programs.some((p) => p.slug === GONE));
  const health = await fetch(base + "/health").then((x) => x.json());
  assert.equal(health.active_programs, sample.length - 1);
  const quickAfter = await api("GET", "/api/admin/catalog/quick");
  assert.equal(quickAfter.body.needs_check, false, "reminder is not stale after apply");
});

test("admin catalog: the applied check survives a restart (newer than the package)", async () => {
  await stopServer();
  await startServer();
  const { body } = await api("GET", "/api/admin/catalog");
  assert.equal(body.live.source, "check");
  assert.equal(body.live.active, sample.length - 1);
});

test("admin catalog: rollback restores the previous catalog and keeps it after restart", async () => {
  const r = await api("POST", "/api/admin/catalog/rollback", {});
  assert.equal(r.status, 200);
  assert.equal(r.body.live.active, sample.length);
  await stopServer();
  await startServer();
  const { body } = await api("GET", "/api/admin/catalog");
  assert.equal(body.live.source, "rollback");
  assert.equal(body.live.active, sample.length);
  assert.ok(body.backups.length >= 2);
});

test("admin catalog: a check started on an older catalog cannot be applied after it changed", async () => {
  await api("POST", "/api/admin/catalog/check", { mode: "status" });
  const j = await waitForJob();
  await api("POST", "/api/admin/catalog/rollback", {}); // catalog changes under the reviewed check
  const r = await api("POST", "/api/admin/catalog/apply", { job_id: j.id, confirm: true });
  assert.notEqual(r.status, 200);
});

test("admin catalog: quick check reports what a full check would change", async () => {
  const { status, body } = await api("GET", "/api/admin/catalog/quick");
  assert.equal(status, 200);
  assert.equal(typeof body.needs_check, "boolean");
  assert.ok(Array.isArray(body.to_hide));
});
