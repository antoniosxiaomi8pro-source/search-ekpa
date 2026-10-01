const test = require("node:test");
const assert = require("node:assert/strict");
const Sync = require("../server/catalog-sync.js");
const Enrich = require("../server/program-enrich.js");

const CONCEPTS = {
  psychology: ["ψυχολογια", "ψυχολογος", "psychology", "ψυχικη υγεια", "ψυχοθεραπεια", "συμβουλευτικη", "κλινικη"],
  tourism: ["τουρισμος", "τουριστικα", "hospitality"],
};

const page = (o = {}) => ({
  http: 200, has_jsonld: true, unavailable: false, price: 500, start_date: "2026-10-19",
  application_deadline: "2026-10-09", cms_id: 900, direction: "Ψυχολογία - Ψυχιατρική",
  title: "Νέα Ψυχολογία", description: "Πλήρης περιγραφή.", image: "https://x/img.jpg", ...o,
});
const check = (cycle, pages) => ({
  ok: true, finishedAt: "2026-10-01T10:00:00.000Z", withPrices: true,
  cycle: cycle.map((slug) => ({ slug, title: slug })), pages,
  newInCycle: [],
});

const base = () => [
  // complete program: must stay byte-identical except status/price bookkeeping
  { id: 1, slug: "full", title: "Κλινική Ψυχολογία", primary_area: "Ψυχολογία - Ψυχιατρική", areas_of_study: ["Ψυχολογία - Ψυχιατρική"],
    description_full: "Υπάρχουσα", description_for_matching: "Υπάρχουσα", price: 900, tags: ["ψυχολογια"], concepts: ["psychology"],
    similar_program_ids: [2], search_text: "x", tags_cms: [] },
  // program with gaps
  { id: null, slug: "gappy", title: "Ψυχολογία στα Τουριστικά", primary_area: null, areas_of_study: [],
    description_full: null, description_for_matching: null, price: 400, tags: [], concepts: [], similar_program_ids: [], search_text: "", tags_cms: [] },
  { id: 2, slug: "other", title: "Τουριστικά", primary_area: "Τουριστικά", areas_of_study: ["Τουριστικά"],
    description_full: "d", description_for_matching: "d", price: 300, tags: ["τουρισμος"], concepts: ["tourism"], similar_program_ids: [1], search_text: "x", tags_cms: [] },
];

test("enrich: fills ONLY empty fields; complete programs keep every search field", () => {
  const programs = base();
  const { candidate } = Sync.buildCandidate(programs, check(["full", "gappy", "other"], {
    full: page({ cms_id: 1, direction: "Τουριστικά", description: "ΑΛΛΗ", title: "ΑΛΛΟΣ" }),
    gappy: page({ cms_id: 55 }),
    other: page({ cms_id: 2 }),
  }), { concepts: CONCEPTS });
  const full = candidate.find((p) => p.slug === "full");
  for (const f of ["id", "title", "primary_area", "areas_of_study", "description_full", "description_for_matching", "tags", "concepts", "similar_program_ids", "search_text"]) {
    assert.deepEqual(full[f], programs[0][f], f);
  }
});

test("enrich: a program with gaps gets id, category, description, concepts, tags, related", () => {
  const { candidate, diff } = Sync.buildCandidate(base(), check(["full", "gappy", "other"], {
    full: page({ cms_id: 1 }), gappy: page({ cms_id: 55 }), other: page({ cms_id: 2 }),
  }), { concepts: CONCEPTS });
  const g = candidate.find((p) => p.slug === "gappy");
  assert.equal(g.id, 55);
  assert.equal(g.primary_area, "Ψυχολογία - Ψυχιατρική");
  assert.deepEqual(g.areas_of_study, ["Ψυχολογία - Ψυχιατρική"]);
  assert.equal(g.description_full, "Πλήρης περιγραφή.");
  assert.equal(g.description_for_matching, "Πλήρης περιγραφή.");
  assert.deepEqual(g.concepts, ["psychology", "tourism"]);
  assert.ok(g.tags.includes("ψυχολογια") && g.tags.includes("τουρισμος"));
  assert.equal(g.tags.filter((t) => CONCEPTS.psychology.includes(t)).length, Enrich.TAGS_PER_CONCEPT, "6 terms per concept");
  assert.deepEqual(g.similar_program_ids, [1], "same primary category + shared concept");
  assert.ok(g.search_text.includes("πληρης περιγραφη"));
  assert.deepEqual(diff.gaps_filled.find((x) => x.slug === "gappy").fields.sort(),
    ["areas_of_study", "concepts", "description_for_matching", "description_full", "id", "primary_area", "tags"]);
});

test("enrich: a site category we don't know is never invented", () => {
  const { candidate } = Sync.buildCandidate(base(), check(["full", "gappy", "other"], {
    gappy: page({ direction: "Άγνωστη Κατηγορία" }),
  }), { concepts: CONCEPTS });
  const g = candidate.find((p) => p.slug === "gappy");
  assert.equal(g.primary_area, null);
  assert.deepEqual(g.areas_of_study, []);
});

test("enrich: an id already used by another program is never assigned", () => {
  const { candidate, diff } = Sync.buildCandidate(base(), check(["full", "gappy", "other"], {
    gappy: page({ cms_id: 2 }),
  }), { concepts: CONCEPTS });
  assert.equal(candidate.find((p) => p.slug === "gappy").id, null);
  assert.deepEqual(diff.id_conflicts, [{ slug: "gappy", id: 2, already_used_by: "other" }]);
});

test("enrich: reports when the site's category differs from ours, without changing ours", () => {
  const { candidate, diff } = Sync.buildCandidate(base(), check(["full", "gappy", "other"], {
    full: page({ cms_id: 1, direction: "Τουριστικά" }),
  }), { concepts: CONCEPTS });
  assert.equal(candidate.find((p) => p.slug === "full").primary_area, "Ψυχολογία - Ψυχιατρική");
  assert.deepEqual(diff.category_differs, [{ slug: "full", ours: "Ψυχολογία - Ψυχιατρική", site: "Τουριστικά" }]);
});

test("enrich: a program new in the cycle is added as a complete, active record", () => {
  const c = check(["full", "gappy", "other", "brand-new"], { "brand-new": page({ cms_id: 901, title: "Ψυχολογία Νέα" }) });
  c.newInCycle = [{ slug: "brand-new", title: "Ψυχολογία Νέα" }];
  const { candidate, diff, summary } = Sync.buildCandidate(base(), c, { concepts: CONCEPTS });
  const n = candidate.find((p) => p.slug === "brand-new");
  assert.ok(n);
  assert.equal(n.status, "active");
  assert.equal(n.id, 901);
  assert.equal(n.url, "https://elearningekpa.gr/courses/brand-new");
  assert.equal(n.price, 500);
  assert.equal(n.primary_area, "Ψυχολογία - Ψυχιατρική");
  assert.deepEqual(n.concepts, ["psychology"]);
  assert.ok(n.similar_program_ids.includes(1));
  for (const f of ["slug", "title", "url", "image_url", "description_full", "tags", "search_text"]) assert.ok(!Enrich.isEmpty(n[f]), f);
  assert.equal(summary.new_added, 1);
  assert.equal(diff.new_added[0].slug, "brand-new");
});

test("enrich: a new program whose page is closed is reported, not added", () => {
  const c = check(["full", "gappy", "other", "closed-new"], { "closed-new": page({ unavailable: true }) });
  c.newInCycle = [{ slug: "closed-new", title: "Closed" }];
  const { candidate, diff } = Sync.buildCandidate(base(), c, { concepts: CONCEPTS });
  assert.equal(candidate.find((p) => p.slug === "closed-new"), undefined);
  assert.equal(diff.new_not_added[0].reason, "δεν είναι διαθέσιμο");
});

test("enrich: derived engine-relevant fields are deterministic", () => {
  const a = Enrich.deriveTags(["tourism", "psychology"], CONCEPTS);
  const b = Enrich.deriveTags(["psychology", "tourism"], CONCEPTS);
  assert.deepEqual(a, b);
  assert.deepEqual(a, [...a].sort());
});
