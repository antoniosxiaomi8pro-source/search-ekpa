const test = require("node:test");
const assert = require("node:assert/strict");

const Sync = require("../server/catalog-sync.js");

function page(overrides = {}) {
  return {
    http: 200,
    has_jsonld: true,
    unavailable: false,
    price: 100,
    start_date: "2026-10-19",
    application_deadline: "2026-10-09",
    cms_id: null,
    direction: null,
    title: null,
    description: null,
    image: null,
    ...overrides,
  };
}

function check(programs, pages = {}) {
  return {
    ok: true,
    finishedAt: "2026-10-08T10:00:00.000Z",
    withPrices: true,
    cycle: programs
      .filter((p) => p.status !== "inactive")
      .map((p) => ({ slug: p.slug, title: p.title })),
    pages,
    newInCycle: [],
  };
}

test("A7: parser reads only official related programs and preserves DOM order", () => {
  const html = `
    <html>
      <body>
        <a href="/courses/not-related" data-courseId="999">Outside section</a>

        <section id="course-related_courses">
          <h2>Σχετικά Προγράμματα</h2>
          <div class="course-card">
            <a class="course-card__link"
               href="/courses/tourism-management-and-marketing"
               data-courseId="196">Tourism</a>
          </div>
          <div class="course-card">
            <a class="course-card__link"
               href="/courses/rooms-division-management"
               data-courseId="738">Rooms</a>
          </div>
          <div class="course-card">
            <a class="course-card__link"
               href="/courses/geotourismos"
               data-courseId="900">Geo</a>
          </div>
        </section>

        <a href="/apply/3">Κάνε Αίτηση</a>
      </body>
    </html>
  `;

  const parsed = Sync.parseCoursePage(html);

  assert.deepEqual(
    parsed.official_related_program_ids,
    [196, 738, 900],
    "must read only #course-related_courses and preserve official DOM order"
  );

  assert.ok(
    !parsed.official_related_program_ids.includes(999),
    "course links outside the official related section must be ignored"
  );
});

test("A7: official related resolution keeps order, existing active only, excludes self, max 8", () => {
  const programs = [
    {
      id: 1,
      slug: "source",
      title: "Source",
      price: 100,
      status: "active",
      primary_area: "Area",
      areas_of_study: ["Area"],
      concepts: ["x"],
      similar_program_ids: [12],
    },
    ...Array.from({ length: 11 }, (_, i) => {
      const id = i + 2;
      return {
        id,
        slug: `p${id}`,
        title: `P${id}`,
        price: 100,
        status: id === 4 ? "inactive" : "active",
        primary_area: "Area",
        areas_of_study: ["Area"],
        concepts: ["x"],
        similar_program_ids: [],
      };
    }),
  ];

  const activePrograms = programs.filter((p) => p.status !== "inactive");

  const pages = Object.fromEntries(
    activePrograms.map((p) => [
      p.slug,
      page({
        cms_id: p.id,
        official_related_program_ids:
          p.id === 1
            ? [1, 5, 999, 4, 3, 2, 6, 7, 8, 9, 10, 11, 12]
            : [],
      }),
    ])
  );

  const { candidate } = Sync.buildCandidate(
    programs,
    check(programs, pages),
    { maxDeactivationRatio: 1 }
  );

  const source = candidate.find((p) => p.id === 1);

  assert.deepEqual(
    source.official_related_program_ids,
    [5, 3, 2, 6, 7, 8, 9, 10],
    "must preserve official order, remove self/missing/inactive entries, and cap at 8"
  );
});

test("A7: empty official related list stays empty and never falls back to computeSimilar", () => {
  const programs = [
    {
      id: 1,
      slug: "source",
      title: "Source",
      price: 100,
      status: "active",
      primary_area: "Area",
      areas_of_study: ["Area"],
      concepts: ["shared"],
      similar_program_ids: [],
    },
    {
      id: 2,
      slug: "algorithmic-match",
      title: "Algorithmic Match",
      price: 100,
      status: "active",
      primary_area: "Area",
      areas_of_study: ["Area"],
      concepts: ["shared"],
      similar_program_ids: [],
    },
  ];

  const pages = {
    source: page({
      cms_id: 1,
      official_related_program_ids: [],
    }),
    "algorithmic-match": page({
      cms_id: 2,
      official_related_program_ids: [],
    }),
  };

  const { candidate } = Sync.buildCandidate(
    programs,
    check(programs, pages),
    { maxDeactivationRatio: 1 }
  );

  const source = candidate.find((p) => p.id === 1);

  assert.deepEqual(
    source.official_related_program_ids,
    [],
    "official empty must remain empty"
  );

  assert.deepEqual(
    source.similar_program_ids,
    [],
    "no algorithmic related-program fallback is allowed"
  );
});
