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
const TOKEN = "concept-management-publish-test-token";

const TOURISM_SLUG =
  "organosi-kai-dioikisi-ksenodoxeiakon-kai-touristikon-monadon";

const LAW_SLUG =
  "paralegal-ekseidikeumeno-prosopiko-sto-xoro-paroxis-nomikon-ypiresion";

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

    server.on("exit", (c) => {
      clearTimeout(t);
      reject(new Error("server exited " + c));
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

async function api(method, route, body, token = TOKEN) {
  const r = await fetch(base + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-admin-token": token } : {})
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
    path.join(os.tmpdir(), "sf-concept-publish-")
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
  "concept management safe publish: preview -> publish -> restart -> stale block -> protected block -> rollback",
  async () => {
    const preview = await api(
      "POST",
      "/api/admin/concept-management/preview",
      {
        concept: "tourism",
        changes: [
          {
            concept: "tourism",
            slug: TOURISM_SLUG,
            assigned: true,
            assignment_status: "REVIEW",
            source: "safe-publish-test",
            reason: "Controlled automated publish validation"
          }
        ]
      }
    );

    assert.equal(preview.status, 200);
    assert.equal(preview.body.blocked, false);
    assert.equal(
      preview.body.protected_baseline.ok,
      true
    );
    assert.equal(
      preview.body.ranking.changed,
      0
    );
    assert.equal(
      typeof preview.body.base_version,
      "string"
    );
    assert.ok(preview.body.base_version.length > 20);

    const originalVersion = preview.body.base_version;

    const publish = await api(
      "POST",
      "/api/admin/concept-management/publish",
      {
        concept: "tourism",
        base_version: originalVersion,
        confirm: true,
        changes: [
          {
            concept: "tourism",
            slug: TOURISM_SLUG,
            assigned: true,
            assignment_status: "REVIEW",
            source: "safe-publish-test",
            reason: "Controlled automated publish validation"
          }
        ]
      }
    );

    assert.equal(publish.status, 200);
    assert.equal(publish.body.ok, true);
    assert.equal(publish.body.published, true);
    assert.equal(
      publish.body.protected_baseline.ok,
      true
    );
    assert.notEqual(
      publish.body.version,
      originalVersion
    );
    assert.equal(
      typeof publish.body.backup_file,
      "string"
    );
    assert.match(
      publish.body.backup_file,
      /before-apply\.json$/
    );
    assert.equal(
      publish.body.live.source,
      "concept-management"
    );
    assert.equal(publish.body.live.total, 702);
    assert.equal(publish.body.live.active, 693);

    const publishedVersion = publish.body.version;
    const backupFile = publish.body.backup_file;

    await stopServer();
    await startServer();

    const afterRestart = await api(
      "GET",
      "/api/admin/catalog"
    );

    assert.equal(afterRestart.status, 200);
    assert.equal(
      afterRestart.body.live.source,
      "concept-management"
    );
    assert.ok(
      afterRestart.body.backups.some(
        (b) => b.file === backupFile
      )
    );

    const record = await api(
      "GET",
      `/api/admin/concept-management?concept=tourism&search=${encodeURIComponent(
        TOURISM_SLUG
      )}&page=1&page_size=10`
    );

    assert.equal(record.status, 200);
    assert.equal(record.body.programs.length, 1);
    assert.equal(
      record.body.programs[0].slug,
      TOURISM_SLUG
    );
    assert.equal(
      record.body.programs[0].assigned,
      true
    );
    assert.equal(
      record.body.programs[0].assignment_status,
      "REVIEW"
    );
    assert.equal(
      record.body.programs[0].source,
      "safe-publish-test"
    );

    const stale = await api(
      "POST",
      "/api/admin/concept-management/publish",
      {
        concept: "tourism",
        base_version: originalVersion,
        confirm: true,
        changes: [
          {
            concept: "tourism",
            slug: TOURISM_SLUG,
            assigned: true,
            assignment_status: "REVIEW",
            source: "stale-test",
            reason: "Must not publish"
          }
        ]
      }
    );

    assert.equal(stale.status, 409);
    assert.match(
      stale.body.error,
      /stale|άλλαξε/i
    );
    assert.equal(
      stale.body.current_version,
      publishedVersion
    );

    const protectedBlock = await api(
      "POST",
      "/api/admin/concept-management/publish",
      {
        concept: "law",
        base_version: publishedVersion,
        confirm: true,
        changes: [
          {
            concept: "law",
            slug: LAW_SLUG,
            assigned: false,
            assignment_status: "REJECT",
            source: "protected-publish-test",
            reason: "Must be blocked"
          }
        ]
      }
    );

    assert.equal(protectedBlock.status, 409);
    assert.match(
      protectedBlock.body.error,
      /Protected Baseline/i
    );
    assert.equal(
      protectedBlock.body.preview.blocked,
      true
    );
    assert.equal(
      protectedBlock.body.preview.protected_baseline.ok,
      false
    );
    assert.ok(
      protectedBlock.body.preview.protected_baseline.failures.some(
        (x) =>
          ["legal", "λεγαλ", "law", "νομικός", "δίκαιο"].includes(
            x.query
          )
      )
    );

    const rollback = await api(
      "POST",
      "/api/admin/catalog/rollback",
      { file: backupFile }
    );

    assert.equal(rollback.status, 200);
    assert.equal(rollback.body.ok, true);
    assert.equal(
      rollback.body.live.source,
      "rollback"
    );
    assert.equal(
      rollback.body.live.restored_from,
      backupFile
    );
    assert.equal(rollback.body.live.total, 702);
    assert.equal(rollback.body.live.active, 693);

    const restoredRecord = await api(
      "GET",
      `/api/admin/concept-management?concept=tourism&search=${encodeURIComponent(
        TOURISM_SLUG
      )}&page=1&page_size=10`
    );

    assert.equal(restoredRecord.status, 200);
    assert.equal(
      restoredRecord.body.programs[0].assignment_status,
      null
    );
    assert.equal(
      restoredRecord.body.programs[0].source,
      null
    );
    assert.equal(
      restoredRecord.body.programs[0].reason,
      null
    );

    const finalCatalog = await api(
      "GET",
      "/api/admin/catalog"
    );

    assert.ok(
      finalCatalog.body.backups.some(
        (b) => b.reason === "before-rollback"
      )
    );
  }
);
