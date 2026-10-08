"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(
  path.join(__dirname, "../public/admin-lexicon.js"),
  "utf8"
);

test("A2.1 UI exposes the governed Query Aliases / Acronyms section", () => {
  assert.ok(
    SRC.includes("function sectionAliases()"),
    "sectionAliases() must exist"
  );

  assert.ok(
    SRC.includes("Query Aliases / Acronyms"),
    "admin must expose Query Aliases / Acronyms"
  );

  assert.ok(
    SRC.includes("Whole-query aliases"),
    "whole-query aliases editor must exist"
  );

  assert.ok(
    SRC.includes("Token / Acronym aliases"),
    "token/acronym aliases editor must exist"
  );

  assert.ok(
    SRC.includes("root.appendChild(sectionAliases())"),
    "aliases section must be rendered in the Lexicon admin"
  );
});

test("A2.1 UI edits the canonical lexicon fields, not a parallel store", () => {
  assert.ok(
    SRC.includes('"query_aliases"'),
    "UI must operate on query_aliases"
  );

  assert.ok(
    SRC.includes('"token_aliases"'),
    "UI must operate on token_aliases"
  );

  assert.ok(
    SRC.includes('draft[key].push({ alias: "", canonical: "" })'),
    "new aliases must be written into the existing lexicon draft"
  );
});

test("A2.1 UI keeps aliases behind the existing preview-before-save flow", () => {
  assert.ok(
    SRC.includes('api("/api/admin/lexicon/preview"'),
    "must use the existing lexicon preview endpoint"
  );

  assert.ok(
    SRC.includes("previewOf !== draftJson()"),
    "save must remain blocked when preview is stale"
  );

  assert.ok(
    SRC.includes('api("/api/admin/lexicon/save"'),
    "must use the existing lexicon save endpoint"
  );

  assert.ok(
    SRC.includes("base_version: baseVersion"),
    "save must preserve optimistic version checking"
  );
});
