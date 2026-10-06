"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = require("node:net").createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const ROOT = path.join(__dirname, "..");
const TOKEN = "concept-auto-rollback-test-token";

const SLUG =
  "organosi-kai-dioikisi-ksenodoxeiakon-kai-touristikon-monadon";

let dir;
let seedFile;
let dataDir;
let server;
let base;

async function startServer() {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;

  server = spawn(
    process.execPath,
    [path.join(ROOT, "server/server.js")],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        TEST_ONLY_CONCEPT_POST_VERIFY_FAIL: "1",
        PORT: String(port),
        PROGRAMS_FILE: seedFile,
        DATA_DIR: dataDir,
        ADMIN_TOKEN: TOKEN,
        ADMIN_RATE_LIMIT_PER_MIN: "1000",
        CATALOG_STATUS_RATE_LIMIT_PER_MIN: "1000"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  await new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("server did not start")),
      15000
    );

    server.stdout.on("data", (d) => {
      if (String(d).includes("listening")) {
        clearTimeout(t);
        resolve();
      }
    });

    server.on("exit", (code) => {
      clearTimeout(t);
      reject(new Error("server exited " + code));
    });
  });
}

function stopServer() {
  if (!server) return Promise.resolve();

  return new Promise((resolve) => {
    const current = server;
    server = null;
    current.once("exit", resolve);
    current.kill();
  });
}

async function api(method, route, body) {
  const r = await fetch(base + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": TOKEN
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  return {
    status: r.status,
    body: await r.json()
  };
}

test.before(async () => {
  dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "sf-concept-auto-rollback-")
  );

  seedFile = path.join(dir, "programs.json");
  dataDir = path.join(dir, "data");

  fs.copyFileSync(
    path.join(ROOT, "public/programs.json"),
    seedFile
  );

  await startServer();
});

test.after(async () => {
  if (server) await stopServer();
  fs.rmSync(dir, { recursive: true, force: true });
});

test(
  "concept management: failed post-publish verification automatically restores the previous catalog",
  async () => {
    const preview = await api(
      "POST",
      "/api/admin/concept-management/preview",
      {
        concept: "tourism",
        changes: [{
          concept: "tourism",
          slug: SLUG,
          assigned: true,
          assignment_status: "REVIEW",
          source: "auto-rollback-test",
          reason: "Must be rolled back automatically"
        }]
      }
    );

    assert.equal(preview.status, 200);
    assert.equal(preview.body.blocked, false);
    assert.equal(preview.body.protected_baseline.ok, true);
    assert.equal(typeof preview.body.base_version, "string");

    const originalVersion = preview.body.base_version;

    const publish = await api(
      "POST",
      "/api/admin/concept-management/publish",
      {
        concept: "tourism",
        base_version: originalVersion,
        confirm: true,
        changes: [{
          concept: "tourism",
          slug: SLUG,
          assigned: true,
          assignment_status: "REVIEW",
          source: "auto-rollback-test",
          reason: "Must be rolled back automatically"
        }]
      }
    );

    assert.equal(publish.status, 500);
    assert.equal(publish.body.rolled_back, true);
    assert.match(
      publish.body.error,
      /αυτόματο rollback/i
    );
    assert.equal(
      publish.body.failed_verification.ok,
      false
    );
    assert.equal(
      publish.body.failed_verification.failures[0].reason,
      "forced_post_publish_verification_failure"
    );
    assert.equal(
      publish.body.live_version,
      originalVersion
    );

    const record = await api(
      "GET",
      `/api/admin/concept-management?concept=tourism&search=${encodeURIComponent(
        SLUG
      )}&page=1&page_size=10`
    );

    assert.equal(record.status, 200);
    assert.equal(record.body.programs.length, 1);
    assert.equal(record.body.programs[0].slug, SLUG);
    assert.equal(record.body.programs[0].assigned, true);
    assert.equal(
      record.body.programs[0].assignment_status,
      null
    );
    assert.equal(record.body.programs[0].source, null);
    assert.equal(record.body.programs[0].reason, null);

    const catalog = await api(
      "GET",
      "/api/admin/catalog"
    );

    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.live.source, "rollback");
    assert.equal(catalog.body.live.total, 702);
    assert.equal(catalog.body.live.active, 693);

    assert.ok(
      catalog.body.backups.some(
        (b) => b.reason === "before-apply"
      )
    );

    assert.ok(
      catalog.body.backups.some(
        (b) => b.reason === "before-rollback"
      )
    );

    await stopServer();
    await startServer();

    const afterRestart = await api(
      "GET",
      "/api/admin/catalog"
    );

    assert.equal(afterRestart.status, 200);
    assert.equal(
      afterRestart.body.live.source,
      "rollback"
    );
    assert.equal(afterRestart.body.live.total, 702);
    assert.equal(afterRestart.body.live.active, 693);

    const afterRestartRecord = await api(
      "GET",
      `/api/admin/concept-management?concept=tourism&search=${encodeURIComponent(
        SLUG
      )}&page=1&page_size=10`
    );

    assert.equal(
      afterRestartRecord.body.programs[0].assignment_status,
      null
    );
    assert.equal(
      afterRestartRecord.body.programs[0].source,
      null
    );
    assert.equal(
      afterRestartRecord.body.programs[0].reason,
      null
    );
  }
);
