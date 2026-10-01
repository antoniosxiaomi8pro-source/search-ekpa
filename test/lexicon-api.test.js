// End-to-end: real server processes with different DATA_DIR contents.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, "public/lexicon.json"), "utf8"));
const TOKEN = "test-token";
const clone = (v) => JSON.parse(JSON.stringify(v));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = require("node:net").createServer();
    s.unref(); s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function startServer(dataDir) {
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(ROOT, "server/server.js")], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_TOKEN: TOKEN },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start: " + log)), 20000);
    server.stdout.on("data", () => { if (log.includes("listening")) { clearTimeout(t); resolve(); } });
    server.on("exit", (c) => reject(new Error("server exited " + c + ": " + log)));
  });
  const base = `http://127.0.0.1:${port}`;
  const get = (p, headers) => fetch(base + p, { headers });
  const admin = (p) => get(p, { "x-admin-token": TOKEN });
  const stop = () => new Promise((r) => { if (server.exitCode !== null) return r(); server.once("exit", r); server.kill(); });
  return { base, get, admin, stop, log: () => log };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sf-lexapi-"));
const count = async (s, q) => (await (await s.get(`/api/search?q=${encodeURIComponent(q)}&format=paged&page_size=1`)).json()).pagination.total_results;

test("empty DATA_DIR: the package lexicon is seeded, served at /lexicon.json and applied", async () => {
  const dir = tmp();
  const s = await startServer(dir);
  try {
    assert.ok(fs.existsSync(path.join(dir, "lexicon.json")));
    const served = await (await s.get("/lexicon.json")).json();
    assert.deepEqual(served, SEED);
    const st = await (await s.admin("/api/admin/lexicon")).json();
    assert.equal(st.source, "data_dir");
    assert.equal(st.error, null);
    assert.equal(await count(s, "δασκάλων"), 0, "genitive plural not in the shipped lexicon");
  } finally { await s.stop(); }
});

test("an edited lexicon in DATA_DIR is used by the live search and survives the package", async () => {
  const dir = tmp();
  const edited = clone(SEED); edited.audience_categories[0].words.push("δασκάλων");
  fs.writeFileSync(path.join(dir, "lexicon.json"), JSON.stringify(edited));
  const s = await startServer(dir);
  try {
    assert.equal(await count(s, "δασκάλων"), await count(s, "δάσκαλος"));
    assert.ok((await count(s, "δασκάλων")) > 0);
    const served = await (await s.get("/lexicon.json")).json();
    assert.ok(served.audience_categories[0].words.includes("δασκάλων"));
  } finally { await s.stop(); }
});

test("a broken lexicon file does not stop the server; the problem is reported to the admin", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "lexicon.json"), "{ broken");
  const s = await startServer(dir);
  try {
    assert.equal((await s.get("/health")).status, 200);
    assert.ok((await count(s, "ψυχολογία")) > 0, "search works on the built-in lexicon");
    const st = await (await s.admin("/api/admin/lexicon")).json();
    assert.equal(st.source, "builtin");
    assert.ok(st.error);
    assert.equal(fs.readFileSync(path.join(dir, "lexicon.json"), "utf8"), "{ broken");
  } finally { await s.stop(); }
});

test("admin lexicon status and the full export need the admin token", async () => {
  const dir = tmp();
  const s = await startServer(dir);
  try {
    assert.equal((await s.get("/api/admin/lexicon")).status, 401);
    assert.equal((await s.get("/api/admin/export")).status, 401);
    const r = await s.admin("/api/admin/export");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition"), /attachment; filename="ekpa-smart-finder-export-\d{4}-\d{2}-\d{2}\.json"/);
    const x = await r.json();
    assert.equal(x.format, 1);
    assert.deepEqual(x.lexicon, SEED);
    assert.ok(Object.keys(x.concepts).length > 50);
    assert.ok(x.catalog.programs.length >= 700, "full catalog including hidden programs");
    assert.ok(x.catalog.programs.some((p) => p.status === "inactive"));
    assert.ok(x.catalog.meta);
  } finally { await s.stop(); }
});

const post = (s, p, body, token = TOKEN) => fetch(s.base + p, { method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": token }, body: JSON.stringify(body) });

test("admin page flow: preview -> save -> live at once -> rollback, with a version check", async () => {
  const dir = tmp();
  const s = await startServer(dir);
  try {
    const st0 = await (await s.admin("/api/admin/lexicon")).json();
    assert.ok(st0.version);
    const draft = clone(st0.lexicon); draft.audience_categories[0].words.push("δασκάλων");

    // token needed
    assert.equal((await post(s, "/api/admin/lexicon/preview", { lexicon: draft }, "wrong")).status, 401);
    // a draft that is not valid is refused
    const bad = clone(draft); bad.stopwords.push("ναυτικός");
    const rb = await post(s, "/api/admin/lexicon/preview", { lexicon: bad });
    assert.equal(rb.status, 400);
    assert.match((await rb.json()).error, /Μη έγκυρο λεξικό/);

    // preview does not change what visitors get
    const pv = await post(s, "/api/admin/lexicon/preview", { lexicon: draft });
    assert.equal(pv.status, 200);
    const pvj = await pv.json();
    assert.equal(pvj.changes.length, 1);
    assert.equal(pvj.base_version, st0.version);
    assert.equal(await count(s, "δασκάλων"), 0, "not live yet");

    // saving needs explicit confirmation and the version the editor started from
    assert.equal((await post(s, "/api/admin/lexicon/save", { lexicon: draft, base_version: st0.version })).status, 400);
    assert.equal((await post(s, "/api/admin/lexicon/save", { lexicon: draft, base_version: "stale", confirm: true })).status, 409);
    const ok = await post(s, "/api/admin/lexicon/save", { lexicon: draft, base_version: st0.version, confirm: true });
    assert.equal(ok.status, 200);
    const okj = await ok.json();
    assert.notEqual(okj.version, st0.version);
    assert.equal(okj.backups, 1);
    assert.ok((await count(s, "δασκάλων")) > 50, "live at once, no restart");
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, "lexicon.json"), "utf8")).audience_categories[0].words.includes("δασκάλων"));

    // a second editor holding the old version cannot overwrite
    assert.equal((await post(s, "/api/admin/lexicon/save", { lexicon: st0.lexicon, base_version: st0.version, confirm: true })).status, 409);

    const rr = await post(s, "/api/admin/lexicon/rollback", {});
    assert.equal(rr.status, 200);
    assert.equal(await count(s, "δασκάλων"), 0, "rolled back");
  } finally { await s.stop(); }
});

test("the saved lexicon survives a restart", async () => {
  const dir = tmp();
  let s = await startServer(dir);
  try {
    const st = await (await s.admin("/api/admin/lexicon")).json();
    const draft = clone(st.lexicon); draft.audience_categories[0].words.push("δασκάλων");
    assert.equal((await post(s, "/api/admin/lexicon/save", { lexicon: draft, base_version: st.version, confirm: true })).status, 200);
  } finally { await s.stop(); }
  s = await startServer(dir);
  try { assert.ok((await count(s, "δασκάλων")) > 50); } finally { await s.stop(); }
});
