const test = require("node:test");
const assert = require("node:assert/strict");
const Sync = require("../server/catalog-sync.js");

// Minimal markup modelled on the real pages (verified against live HTML on 2026-10-01).
const SCHEDULE_HTML = `
<table><tbody>
<tr><td class="text-left d-flex"><a class="course-schedule-table__link" href="/courses/alpha">
  <span class="course-schedule-table__title">Alpha &amp; Co</span></a></td>
  <td><a class="course-schedule-table__link" href="/courses/alpha"> 6 </a></td>
  <td><a class="course-schedule-table__link" href="/courses/alpha"> 195 </a></td></tr>
<tr><td class="text-left d-flex"><a class="course-schedule-table__link" href="/courses/beta">
  <span class="course-schedule-table__title">Beta</span></a></td>
  <td><a href="/courses/beta"> 2 </a></td><td><a href="/courses/beta"> 30 </a></td></tr>
<tr><td class="text-left d-flex"><a class="course-schedule-table__link" href="/courses/alpha">
  <span class="course-schedule-table__title">Alpha &amp; Co</span></a></td><td>6</td><td>195</td></tr>
<tr><th>Header row without a course</th></tr>
</tbody></table>`;

function coursePage({ price, startDate, unavailable, cmsId, direction = "Ψυχολογία - Ψυχιατρική", name = "X", description = "Περιγραφή &laquo;X&raquo;" }) {
  const ld = {
    "@context": "http://schema.org",
    "@type": "Course",
    name,
    description,
    image: "https://elearningekpa.gr/img/x.jpg",
    ...(startDate ? { hasCourseInstance: { "@type": "CourseInstance", startDate } } : {}),
    ...(price !== undefined ? { offers: { "@type": "Offer", price: String(price), priceCurrency: "EUR" } } : {}),
  };
  return `<html><script type="application/ld+json">{"@type":"Organization"}</script>
<script type="application/ld+json">${JSON.stringify([ld])}</script>
<body><h1>${name}</h1><div>Κατεύθυνση: <a href="/categories/x">${direction}</a></div> <p>Απονέμεται Πιστοποιητικό</p>
${unavailable ? "<p>Το πρόγραμμα δεν είναι διαθέσιμο.</p>" : `<a href="/apply/${cmsId ?? 77}">Κάνε Αίτηση</a><a href="/apply/${cmsId ?? 77}">Κάνε Αίτηση</a>`}
<div><strong>Προθεσμια Υποβολης Αιτησεων:</strong> <span>9/10/2026</span></div></body></html>`;
}

function check({ cycleSlugs, pages = {}, withPrices = true }) {
  return {
    ok: true,
    finishedAt: "2026-10-01T10:00:00.000Z",
    withPrices,
    cycle: cycleSlugs.map((slug) => ({ slug, title: slug })),
    pages,
    newInCycle: [],
  };
}

const catalog = () => [
  { slug: "alpha", title: "Alpha", price: 950 },
  { slug: "beta", title: "Beta", price: null },
  { slug: "gamma", title: "Gamma", price: 500 },
];

test("catalog-sync: parses the course-schedule table, dedupes, decodes entities", () => {
  const rows = Sync.parseCourseSchedule(SCHEDULE_HTML);
  assert.deepEqual(rows, [
    { slug: "alpha", title: "Alpha & Co", months: 6, hours: 195 },
    { slug: "beta", title: "Beta", months: 2, hours: 30 },
  ]);
});

test("catalog-sync: reads price, start date and availability from Course JSON-LD", () => {
  assert.deepEqual(Sync.parseCoursePage(coursePage({ price: 900, startDate: "2026-10-19", cmsId: 34 })), {
    has_jsonld: true, unavailable: false, price: 900, start_date: "2026-10-19", application_deadline: "2026-10-09",
    cms_id: 34, direction: "Ψυχολογία - Ψυχιατρική", official_related_program_ids: [],
    title: "X", description: "Περιγραφή «X»", image: "https://elearningekpa.gr/img/x.jpg",
  });
  const closed = Sync.parseCoursePage(coursePage({ price: 425, unavailable: true }));
  assert.equal(closed.unavailable, true);
  assert.equal(closed.cms_id, null, "no apply link when applications are closed");
  assert.equal(Sync.parseCoursePage("<html>no json-ld</html>").has_jsonld, false);
  assert.equal(Sync.parseCoursePage(coursePage({})).price, null);
});

test("catalog-sync: programs outside the cycle become inactive and are kept, not deleted", () => {
  const { candidate, diff, summary } = Sync.buildCandidate(catalog(), check({ cycleSlugs: ["alpha", "beta"], withPrices: false }), { maxDeactivationRatio: 1 });
  assert.equal(candidate.length, 3);
  assert.deepEqual(candidate.map((p) => p.status), ["active", "active", "inactive"]);
  assert.deepEqual(diff.deactivated.map((x) => x.slug), ["gamma"]);
  assert.equal(candidate[2].status_source, "course-schedule");
  assert.equal(summary.active_after, 2);
});

test("catalog-sync: an inactive program that returns to the cycle is reactivated", () => {
  const programs = catalog().map((p) => (p.slug === "gamma" ? { ...p, status: "inactive" } : p));
  const { candidate, diff } = Sync.buildCandidate(programs, check({ cycleSlugs: ["alpha", "beta", "gamma"], withPrices: false }));
  assert.equal(candidate[2].status, "active");
  assert.deepEqual(diff.reactivated.map((x) => x.slug), ["gamma"]);
});

test("catalog-sync: fills missing prices, updates existing ones and keeps the original as price_base", () => {
  const pages = {
    alpha: { http: 200, has_jsonld: true, unavailable: false, price: 900, start_date: "2026-10-19" },
    beta: { http: 200, has_jsonld: true, unavailable: false, price: 620, start_date: "2026-10-19" },
  };
  const { candidate, diff } = Sync.buildCandidate(catalog(), check({ cycleSlugs: ["alpha", "beta", "gamma"], pages }));
  const [alpha, beta, gamma] = candidate;
  assert.equal(alpha.price, 900);
  assert.equal(alpha.price_base, 950);
  assert.equal(alpha.price_source, "jsonld");
  assert.equal(alpha.cycle_start_date, "2026-10-19");
  assert.equal(beta.price, 620);
  assert.equal(beta.price_base, undefined, "no invented base price when none existed");
  assert.deepEqual(diff.price_filled, [{ slug: "beta", price: 620 }]);
  assert.deepEqual(diff.price_changed, [{ slug: "alpha", from: 950, to: 900 }]);
  // gamma's page was not fetched -> reported, old price kept
  assert.equal(gamma.price, 500);
  assert.deepEqual(diff.page_errors, [{ slug: "gamma", http: null }]);
});

test("catalog-sync: a later sync never overwrites price_base with a discounted price", () => {
  const first = Sync.buildCandidate(catalog(), check({
    cycleSlugs: ["alpha", "beta", "gamma"],
    pages: { alpha: { http: 200, has_jsonld: true, price: 900 } },
  })).candidate;
  const second = Sync.buildCandidate(first, check({
    cycleSlugs: ["alpha", "beta", "gamma"],
    pages: { alpha: { http: 200, has_jsonld: true, price: 1060 } },
  })).candidate;
  assert.equal(second[0].price, 1060);
  assert.equal(second[0].price_base, 950);
});

test("catalog-sync: input catalog is never mutated", () => {
  const programs = catalog();
  const snapshot = JSON.stringify(programs);
  Sync.buildCandidate(programs, check({ cycleSlugs: ["alpha"], pages: { alpha: { http: 200, has_jsonld: true, price: 1 } } }), { maxDeactivationRatio: 1 });
  assert.equal(JSON.stringify(programs), snapshot);
});

test("catalog-sync safety: blocks apply when the cycle list is suspiciously small", () => {
  const { summary } = Sync.buildCandidate(catalog(), check({ cycleSlugs: ["alpha"], withPrices: false }));
  assert.equal(summary.can_apply, false);
  assert.ok(summary.blockers.length >= 1);
});

test("catalog-sync safety: blocks apply when too many active programs would be hidden", () => {
  const programs = Array.from({ length: 20 }, (_, i) => ({ slug: "p" + i, title: "P" + i, price: 100 }));
  const keep = programs.slice(0, 16).map((p) => p.slug); // 4/20 = 20% hidden > 15%
  const { summary } = Sync.buildCandidate(programs, check({ cycleSlugs: keep, withPrices: false }));
  assert.equal(summary.can_apply, false);
  assert.match(summary.blockers.join(" "), /Απενεργοποιούνται 4 από 20/);
});

test("catalog-sync safety: flags large price moves for review", () => {
  const { diff } = Sync.buildCandidate(catalog(), check({
    cycleSlugs: ["alpha", "beta", "gamma"],
    pages: { gamma: { http: 200, has_jsonld: true, price: 900 } }, // 500 -> 900 = +80%
  }));
  assert.deepEqual(diff.price_flagged, [{ slug: "gamma", from: 500, to: 900 }]);
});

test("catalog-sync: checkCatalog fetches only ACTIVE program pages and reports new programs", async () => {
  const requested = [];
  const fakeFetch = async (url) => {
    requested.push(url);
    if (url === Sync.COURSE_SCHEDULE_URL) {
      return { status: 200, text: async () => SCHEDULE_HTML };
    }
    return { status: 200, text: async () => coursePage({ price: 700, startDate: "2026-10-19" }) };
  };
  const programs = [
    { slug: "alpha", url: "https://elearningekpa.gr/courses/alpha", price: 1 },
    { slug: "gone", url: "https://elearningekpa.gr/courses/gone", price: 1 },
  ];
  const result = await Sync.checkCatalog(programs, { fetchImpl: fakeFetch, delayMs: 0 });
  assert.equal(result.ok, true);
  // active program + the program that is new in the cycle; never the inactive one
  assert.deepEqual(requested, [Sync.COURSE_SCHEDULE_URL, "https://elearningekpa.gr/courses/alpha", "https://elearningekpa.gr/courses/beta"]);
  assert.deepEqual(result.newInCycle.map((c) => c.slug), ["beta"]);
  assert.equal(result.pages.alpha.price, 700);
});

test("catalog-sync: retries rate-limited pages and gives up cleanly", async () => {
  let calls = 0;
  const fakeFetch = async (url) => {
    if (url === Sync.COURSE_SCHEDULE_URL) return { status: 200, text: async () => SCHEDULE_HTML };
    calls++;
    return { status: 403, text: async () => "" };
  };
  const result = await Sync.checkCatalog([{ slug: "alpha", price: 1 }], { fetchImpl: fakeFetch, delayMs: 0, retryDelaysMs: [0, 0] });
  assert.equal(calls, 6); // alpha + new "beta", 3 attempts each
  assert.deepEqual(result.pages.alpha, { http: 403 });
});

test("catalog-sync: a failed course-schedule request is an error, not an empty cycle", async () => {
  const result = await Sync.checkCatalog([{ slug: "alpha" }], {
    fetchImpl: async () => ({ status: 503, text: async () => "" }),
    delayMs: 0,
    retryDelaysMs: [],
  });
  assert.equal(result.ok, false);
});

test("catalog-sync: listed in the cycle but page says applications closed -> hidden", () => {
  const pages = {
    alpha: { http: 200, has_jsonld: true, unavailable: true, price: 850, start_date: "2026-10-19", application_deadline: "2026-09-20" },
    beta: { http: 200, has_jsonld: true, unavailable: false, price: 620, application_deadline: "2026-10-09" },
    gamma: { http: 200, has_jsonld: true, unavailable: false, price: 500 },
  };
  const { candidate, diff } = Sync.buildCandidate(catalog(), check({ cycleSlugs: ["alpha", "beta", "gamma"], pages }), { maxDeactivationRatio: 1 });
  assert.equal(candidate[0].status, "inactive");
  assert.equal(candidate[0].status_source, "course-page");
  assert.equal(candidate[0].application_deadline, "2026-09-20");
  assert.equal(candidate[1].status, "active");
  assert.equal(candidate[1].application_deadline, "2026-10-09");
  assert.deepEqual(diff.deactivated.map((x) => x.slug), ["alpha"]);
  assert.deepEqual(diff.in_cycle_but_unavailable.map((x) => x.slug), ["alpha"]);
});

test("catalog-sync: a hidden program whose page is still closed is not reported as reactivated", () => {
  const programs = catalog().map((p) => (p.slug === "alpha" ? { ...p, status: "inactive" } : p));
  const pages = { alpha: { http: 200, has_jsonld: true, unavailable: true, price: 850 } };
  const { diff } = Sync.buildCandidate(programs, check({ cycleSlugs: ["alpha", "beta", "gamma"], pages }));
  assert.deepEqual(diff.reactivated, []);
  assert.deepEqual(diff.deactivated, []);
});

test("catalog-sync: a status-only check never un-hides a program hidden by its own page", () => {
  const programs = catalog().map((p) => (p.slug === "alpha" ? { ...p, status: "inactive", status_source: "course-page" } : p));
  const { candidate, diff } = Sync.buildCandidate(programs, check({ cycleSlugs: ["alpha", "beta", "gamma"], withPrices: false }));
  assert.equal(candidate[0].status, "inactive");
  assert.deepEqual(diff.reactivated, []);
  // ...but a full check that sees the page open again does reactivate it
  const full = Sync.buildCandidate(programs, check({ cycleSlugs: ["alpha", "beta", "gamma"], pages: { alpha: { http: 200, has_jsonld: true, unavailable: false, price: 1 } } }));
  assert.equal(full.candidate[0].status, "active");
  assert.deepEqual(full.diff.reactivated.map((x) => x.slug), ["alpha"]);
});

test("catalog-sync: «Κατεύθυνση» is read from the header link, not from the text after it", () => {
  const html = `<div class="course-category text-md-left"><span class="d-none">Κατεύθυνση:</span>
    <a class="course-category__link" href="/categories/ygeia" target="_blank">Υγεία</a></div>
    <div class="course-short-intro"><span><p>Πιστοποιητικό Εξειδικευμένης Επιμόρφωσης </p></span></div>
    <div><span>Έναρξη Μαθημάτων <strong>19/10/2026</strong></span></div><a href="/apply/1190">Κάνε Αίτηση</a>`;
  const r = Sync.parseCoursePage(html);
  assert.equal(r.direction, "Υγεία");
  assert.equal(r.cms_id, 1190);
});
