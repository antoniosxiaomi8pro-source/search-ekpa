// End-to-end: a real server process on a small catalog where one program is inactive.
// Proves hidden programs never reach visitors, while old click links still resolve.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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
const full = JSON.parse(fs.readFileSync(path.join(ROOT, "public/programs.json"), "utf8"));
const HIDDEN = full.find((p) => /ψυχολογ/i.test(p.title));
const sample = full.filter((p) => /ψυχολογ/i.test(p.title)).slice(0, 12);
const catalog = sample.map((p) =>
  p.slug === HIDDEN.slug ? { ...p, status: "inactive" } : { ...p, status: "active" }
);

let server;
let base;

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-inactive-"));
  const file = path.join(dir, "programs.json");
  fs.writeFileSync(file, JSON.stringify(catalog));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(ROOT, "server/server.js")], {
    env: { ...process.env, PORT: String(port), PROGRAMS_FILE: file, DATA_DIR: path.join(dir, "data"), ADMIN_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 15000);
    server.stdout.on("data", (d) => {
      if (String(d).includes("listening")) { clearTimeout(t); resolve(); }
    });
    server.on("exit", (code) => reject(new Error("server exited " + code)));
  });
});

test.after(() => { if (server) server.kill(); });

const get = (p) => fetch(base + p).then((r) => r.json());

test("inactive: hidden program never appears in typeahead search", async () => {
  const q = encodeURIComponent(HIDDEN.title);
  const results = await get(`/api/search?q=${q}&limit=40&fields=compact`);
  assert.ok(results.length > 0, "query should still return the active programs");
  assert.ok(!results.some((r) => r.slug === HIDDEN.slug));
});

test("inactive: hidden program never appears in paged results (both sorts)", async () => {
  const q = encodeURIComponent("ψυχολογία");
  for (const sort of ["relevance", "price_asc"]) {
    const data = await get(`/api/search?q=${q}&format=paged&page=1&page_size=40&sort=${sort}`);
    assert.equal(data.pagination.total_results, catalog.length - 1);
    assert.ok(!data.results.some((r) => r.slug === HIDDEN.slug), sort);
  }
});

test("inactive: hidden program is not served by /api/programs or /programs.json", async () => {
  for (const p of ["/api/programs", "/programs.json"]) {
    const list = await get(p);
    assert.equal(list.length, catalog.length - 1, p);
    assert.ok(!list.some((r) => r.slug === HIDDEN.slug), p);
  }
});

test("inactive: /health keeps the full catalog size and reports active separately", async () => {
  const h = await get("/health");
  assert.deepEqual(h, { ok: true, programs: catalog.length, active_programs: catalog.length - 1 });
});

test("inactive: clicks on an old link to a hidden program are still recorded", async () => {
  const res = await fetch(base + "/api/track-click", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ query: "ψυχολογία", program_id: HIDDEN.slug }),
  });
  assert.equal(res.status, 200);
});
