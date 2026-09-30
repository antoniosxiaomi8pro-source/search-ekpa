"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.join(__dirname, "..");
const Engine = require(path.join(ROOT, "public/search-engine.js"));
const programs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/programs.json"), "utf-8"));
const concepts = JSON.parse(fs.readFileSync(path.join(ROOT, "public/concepts.json"), "utf-8"));

const TOURISM = "Τουριστικά";
const MARITIME = "Ναυτιλιακά";
const THEATRE = "Κινηματογράφος - Θέατρο";
const PEDAGOGY = "Παιδαγωγικά";
const CREDITED = "Μοριοδοτούμενα Προγράμματα Παιδαγωγικών & Ειδικής Αγωγής";
const DEPY_SLUG = "eidiki-diapaidagogisi-parembasi-stin-diataraxi-elleimatikis-prosoxis-kai-yperkinitikotita-dep-y";

function member(p, category) { return Engine.programBelongsToCategory(p, category); }

test("Greeklish word-final s transliterates to native final sigma so query variants converge", () => {
  const tourism = Engine.foldGreek(Engine.normalize("τουρισμός"));
  const teacher = Engine.foldGreek(Engine.normalize("δάσκαλος"));
  assert.ok(Engine.queryVariants("tourismos").includes(tourism));
  assert.ok(Engine.queryVariants("daskalos").includes(teacher));
});

test("tourismos resolves to the same official Τουριστικά category as τουρισμός", () => {
  assert.equal(Engine.resolveCategoryIntent(programs, "τουρισμός"), TOURISM);
  assert.equal(Engine.resolveCategoryIntent(programs, "tourismos"), TOURISM);
});

test("nautikos resolves to the official Ναυτιλιακά category", () => {
  assert.equal(Engine.resolveCategoryIntent(programs, "nautikos"), MARITIME);
  const results = Engine.rank(programs, concepts, "nautikos");
  assert.ok(results.length > 0);
  assert.ok(results.every((p) => member(p, MARITIME)));
});

test("daskalos resolves to the same teacher multi-category audience intent", () => {
  const got = Engine.resolveAudienceMultiCategoryIntent(programs, "daskalos");
  assert.deepEqual([...got].sort(), [PEDAGOGY, CREDITED].sort());
});

test("ithopoios resolves to the official Κινηματογράφος - Θέατρο category", () => {
  assert.equal(Engine.resolveCategoryIntent(programs, "ithopoios"), THEATRE);
  const results = Engine.rank(programs, concepts, "ithopoios");
  assert.ok(results.length > 0);
  assert.ok(results.every((p) => member(p, THEATRE)));
});

test("ΔΕΠΥ, ΔΕΠ-Υ and δεπ υ normalize to the same canonical Greek query", () => {
  const canon = (q) => Engine.foldGreek(Engine.normalize(q));
  assert.equal(canon("ΔΕΠΥ"), canon("ΔΕΠ-Υ"));
  assert.equal(canon("ΔΕΠΥ"), canon("δεπ υ"));
});

test("ΔΕΠΥ / ΔΕΠ-Υ / δεπ υ / ADHD all rank the exact ΔΕΠ-Υ program first", () => {
  for (const q of ["ΔΕΠΥ", "ΔΕΠ-Υ", "δεπ υ", "ADHD"]) {
    const results = Engine.rank(programs, concepts, q);
    assert.ok(results.length > 0, `${q}: expected results`);
    assert.equal(results[0].slug, DEPY_SLUG, `${q}: exact ΔΕΠ-Υ program should rank first`);
  }
});

test("compound μαθητής με ΔΕΠΥ keeps normal search and lifts the exact ΔΕΠ-Υ program into top 10", () => {
  const q = "μαθητής με ΔΕΠΥ";
  assert.equal(Engine.resolveCategoryIntent(programs, q), null);
  assert.equal(Engine.resolveAudienceMultiCategoryIntent(programs, q), null);
  assert.equal(Engine.resolveTopicIntent(programs, q), null);
  const results = Engine.rank(programs, concepts, q);
  const pos = results.findIndex((p) => p.slug === DEPY_SLUG);
  assert.ok(pos >= 0 && pos < 10, `expected exact ΔΕΠ-Υ program in top 10, got rank ${pos + 1}`);
});
