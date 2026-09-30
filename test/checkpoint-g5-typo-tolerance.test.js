const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Engine = require("../public/search-engine.js");

const programs = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../public/programs.json"), "utf8")
);

const concepts = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../public/concepts.json"), "utf8")
);

function ranked(q) {
  return Engine.rank(programs, concepts, q);
}

function topSlugs(q, n = 5) {
  return ranked(q).slice(0, n).map(x => x.slug);
}

const canonicalTop5 = topSlugs("ψυχολογία");

test("Checkpoint G5: existing accentless psychology behavior remains identical", () => {
  assert.deepEqual(
    topSlugs("ψυχολογια"),
    canonicalTop5
  );
});

test("Checkpoint G5: existing folded spelling behavior remains identical", () => {
  assert.deepEqual(
    topSlugs("ψιχολογια"),
    canonicalTop5
  );
});

test("Checkpoint G5: one extra trailing character recovers canonical psychology relevance", () => {
  assert.deepEqual(
    topSlugs("ψυχολογιαα"),
    canonicalTop5
  );
});

test("Checkpoint G5: one missing internal character recovers canonical psychology relevance", () => {
  assert.deepEqual(
    topSlugs("ψυχολοια"),
    canonicalTop5
  );
});

test("Checkpoint G5: adjacent opening transposition recovers canonical psychology relevance", () => {
  assert.deepEqual(
    topSlugs("πσυχολογια"),
    canonicalTop5
  );
});

test("Checkpoint G5: typo recovery does not collapse to zero-score catalog ordering", () => {
  for (const q of ["ψυχολογιαα", "ψυχολοια", "πσυχολογια"]) {
    const results = ranked(q);

    assert.ok(results.length > 0, q + " returned zero results");
    assert.ok(results[0]._score > 0, q + " returned zero-score ordering");
  }
});

test("Checkpoint G5 safety: canonical psychology ranking remains frozen", () => {
  const canonical = Engine.rank(programs, concepts, "ψυχολογία").slice(0, 5);

  assert.deepEqual(
    canonical.map((x) => x.slug),
    [
      "iatrikh-psuxologia",
      "egklimatologiki-psuxologia",
      "koinwnikh-klinikh-psuxologia-twn-eksarthsewn",
      "organwsiakh-psuxologia-kai-sumperifora",
      "efarmoges-ths-sumbouleutikhs-psuxologias-sthn-ekpaideush-ta-paidia-kai-tous-efhbous"
    ]
  );

  assert.deepEqual(
    canonical.map((x) => x._score),
    [402, 402, 402, 402, 402]
  );
});

test("Checkpoint G5 safety: statistics does not collapse into military terminology", () => {
  const statistics = Engine.rank(programs, concepts, "στατιστικα").slice(0, 3).map((x) => x.slug);
  const military = Engine.rank(programs, concepts, "στρατιοτικα").slice(0, 3).map((x) => x.slug);

  assert.equal(
    statistics.includes("aggliki-stratiotikh-orologia-stis-diethneis-sunergasies-kai-eirhneftikes-apostoles"),
    false
  );

  assert.equal(
    military.includes("statistics-analytics-and-data-mining"),
    false
  );
});

test("Checkpoint G5 safety: geology and gemology remain distinct", () => {
  const geology = Engine.rank(programs, concepts, "γεολογια").slice(0, 10).map((x) => x.slug);
  const gemology = Engine.rank(programs, concepts, "γεμολογια").slice(0, 10).map((x) => x.slug);

  assert.equal(
    geology.includes("gemologia-diamantia-kai-xromatistoi-polutimoi-lithoi-stin-kosmimatopoiia"),
    false
  );

  assert.deepEqual(
    gemology,
    [
      "gemologia-diamantia-kai-xromatistoi-polutimoi-lithoi-stin-kosmimatopoiia"
    ]
  );
});

test("Checkpoint G5 safety: valid ναυτιλια query keeps its established ranking", () => {
  const expected = [
    "geopolitiki-nautiki-hsxus-kai-nautiliaki-asfaleia",
    "thalassies-metafores-nautiliaki-epixeirimatikotita-ploigisi-sti-biosimi-anaptuksi",
    "prasini-nautilia-kai-apanthrakopoiisi",
    "nautilia-kai-plhroforikh",
    "nautiliako-dikaio-stin-praksi",
    "dioikisi-nautiliakon-epixeiriseon",
    "maritime-strategy-claims-and-operations",
    "shipping-english",
    "epithewrhseis-ploiwn-port-state-control",
    "diethnhs-kwdikas-asfalous-diaxeirishs-ploiwn-ism-code"
  ];

  assert.deepEqual(
    Engine.rank(programs, concepts, "ναυτιλια")
      .slice(0, 10)
      .map(x => x.slug),
    expected
  );
});

test("Checkpoint G5 safety: valid ψυχολόγος query keeps its established ranking", () => {
  const expected = [
    "iatrikh-psuxologia",
    "koinwnika-problhmata-kai-psuxikh-ygeia-tou-paidiou",
    "egklimatologiki-psuxologia",
    "koinwnikh-klinikh-psuxologia-twn-eksarthsewn",
    "organwsiakh-psuxologia-kai-sumperifora",
    "efarmoges-ths-sumbouleutikhs-psuxologias-sthn-ekpaideush-ta-paidia-kai-tous-efhbous",
    "dikastikh-psuxiatrodikastikh-psuxologia",
    "paidopsuxiatrikh",
    "thetikh-psuxologia-h-episthmh-ths-eutuxias",
    "paidopsuxologia-psuxologia-brefous-kai-paidiou-prosxolikhs-hlikias"
  ];

  assert.deepEqual(
    Engine.rank(programs, concepts, "ψυχολόγος")
      .slice(0, 10)
      .map(x => x.slug),
    expected
  );
});
