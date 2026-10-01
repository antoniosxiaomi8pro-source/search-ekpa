"use strict";

// Catalog check: compares programs.json against the public EKPA site and builds a
// reviewed candidate. It never writes anything itself — callers decide (CLI today,
// the admin "Έλεγχος καταλόγου" button later).
//
// Sources (see docs/B0-architecture-decisions.md §10):
//  - Status: https://elearningekpa.gr/course-schedule ("Τρέχων Κύκλος") lists exactly the
//    programs that accept applications this cycle. One request.
//  - Price:  each ACTIVE program page carries schema.org Course JSON-LD with offers.price
//    (current price, including the cycle's discount) and hasCourseInstance.startDate.
//
// The site answers 403 to fast sequential requests, so page fetches are deliberately
// slow (default 2s apart) and retried with backoff.

const SITE_ORIGIN = "https://elearningekpa.gr";
const COURSE_SCHEDULE_URL = SITE_ORIGIN + "/course-schedule";
const USER_AGENT = "EKPA-SmartFinder-CatalogCheck/1.0";
const UNAVAILABLE_MARKER = "Το πρόγραμμα δεν είναι διαθέσιμο";

const DEFAULTS = {
  delayMs: 2000,
  retryDelaysMs: [5000, 15000],
  // Safety gate thresholds: a result outside these is far more likely a parsing or
  // site-layout problem than a real catalog change, so applying it is blocked.
  minActiveRatio: 0.5, // cycle list must contain at least half the current catalog
  maxDeactivationRatio: 0.15, // at most 15% of currently-active programs may go inactive
  maxPriceChangeRatio: 0.3, // per-program price moves above 30% are flagged for review
};

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function slugFromHref(href) {
  const m = /\/courses\/([^/?#"]+)/.exec(href);
  return m ? decodeURIComponent(m[1]) : null;
}

// Parses the "Τρέχων Κύκλος" table. Each row: title link, months, hours.
function parseCourseSchedule(html) {
  const bySlug = new Map();
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
  let row;
  while ((row = rowRe.exec(html))) {
    const body = row[1];
    if (!body.includes("course-schedule-table__title")) continue;
    const hrefM = /href="([^"]*\/courses\/[^"]+)"/.exec(body);
    const slug = hrefM ? slugFromHref(hrefM[1]) : null;
    if (!slug || bySlug.has(slug)) continue;
    const titleM = /course-schedule-table__title[^>]*>([\s\S]*?)<\/span>/.exec(body);
    const cells = [...body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
      decodeEntities(c[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
    );
    const num = (v) => (v && /^\d+$/.test(v) ? Number(v) : null);
    bySlug.set(slug, {
      slug,
      title: titleM ? decodeEntities(titleM[1].replace(/<[^>]+>/g, "")).trim() : null,
      months: num(cells[1]),
      hours: num(cells[2]),
    });
  }
  return [...bySlug.values()];
}

// Extracts the schema.org Course object from a program page.
function parseCoursePage(html) {
  let course = null;
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const j = JSON.parse(m[1]);
      const found = (Array.isArray(j) ? j : [j]).find((x) => x && x["@type"] === "Course");
      if (found) course = found;
    } catch (e) {
      // malformed JSON-LD block - ignore, others may still be valid
    }
  }
  const unavailable = html.includes(UNAVAILABLE_MARKER);
  const application_deadline = parseApplicationDeadline(html);
  if (!course) return { has_jsonld: false, unavailable, price: null, start_date: null, application_deadline };
  const rawPrice = course.offers ? course.offers.price : null;
  const price = rawPrice === null || rawPrice === undefined || rawPrice === "" ? null : Number(rawPrice);
  const inst = course.hasCourseInstance || {};
  return {
    has_jsonld: true,
    unavailable,
    price: Number.isFinite(price) ? price : null,
    start_date: typeof inst.startDate === "string" ? inst.startDate : null,
    application_deadline,
  };
}

// "Προθεσμια Υποβολης Αιτησεων: 9/10/2026" (program info box) -> "2026-10-09".
function parseApplicationDeadline(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const m = /Προθεσμ[ιί]α Υποβολ[ηή]ς Αιτ[ηή]σεων:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, opts) {
  const { fetchImpl, retryDelaysMs } = opts;
  let lastStatus = null;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) await sleep(retryDelaysMs[attempt - 1]);
    try {
      const res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });
      lastStatus = res.status;
      if (res.status === 200) return { status: 200, text: await res.text() };
      if (res.status === 404) return { status: 404, text: null }; // definitive, no retry
      // 403/429/5xx: rate limit or transient - retry
    } catch (e) {
      lastStatus = "network-error";
    }
  }
  return { status: lastStatus, text: null };
}

function isActive(p) {
  return p.status !== "inactive";
}

// Runs the check. `programs` is the current catalog (not modified).
async function checkCatalog(programs, options = {}) {
  const opts = { ...DEFAULTS, fetchImpl: globalThis.fetch, withPrices: true, onProgress: () => {}, ...options };
  const startedAt = new Date().toISOString();

  const schedule = await fetchText(COURSE_SCHEDULE_URL, opts);
  if (schedule.status !== 200) {
    return { ok: false, error: `Η σελίδα «Τρέχων Κύκλος» δεν φορτώθηκε (HTTP ${schedule.status}).`, startedAt };
  }
  const cycle = parseCourseSchedule(schedule.text);
  const cycleBySlug = new Map(cycle.map((c) => [c.slug, c]));
  const catalogBySlug = new Map(programs.map((p) => [p.slug, p]));

  const pages = {};
  if (opts.withPrices) {
    const targets = programs.filter((p) => cycleBySlug.has(p.slug));
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i];
      const r = await fetchText(p.url || `${SITE_ORIGIN}/courses/${p.slug}`, opts);
      pages[p.slug] = r.status === 200 ? { http: 200, ...parseCoursePage(r.text) } : { http: r.status };
      opts.onProgress({ done: i + 1, total: targets.length, slug: p.slug });
      if (i < targets.length - 1) await sleep(opts.delayMs);
    }
  }

  return {
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    withPrices: !!opts.withPrices,
    cycle,
    pages,
    newInCycle: cycle.filter((c) => !catalogBySlug.has(c.slug)),
  };
}

// Builds the candidate catalog + a human-readable diff. Pure function.
function buildCandidate(programs, check, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const checkedAt = check.finishedAt || new Date().toISOString();
  const cycleBySlug = new Map(check.cycle.map((c) => [c.slug, c]));

  const diff = {
    deactivated: [],
    reactivated: [],
    price_filled: [],
    price_changed: [],
    price_flagged: [],
    page_errors: [],
    in_cycle_but_unavailable: [],
    new_in_cycle: check.newInCycle.map((c) => ({ slug: c.slug, title: c.title })),
  };

  const candidate = programs.map((orig) => {
    const p = { ...orig };
    const wasActive = isActive(orig);
    const inCycle = cycleBySlug.has(p.slug);
    p.status = inCycle ? "active" : "inactive";
    p.status_source = "course-schedule";
    p.status_checked_at = checkedAt;

    const page = check.pages[p.slug];
    if (inCycle && check.withPrices) {
      if (!page || page.http !== 200) {
        diff.page_errors.push({ slug: p.slug, http: page ? page.http : null });
      } else {
        // Listed in the cycle, but the page itself says applications are closed (e.g. the
        // program's own deadline passed). It does not accept registrations -> hidden (B0 §5).
        if (page.unavailable) {
          p.status = "inactive";
          p.status_source = "course-page";
          diff.in_cycle_but_unavailable.push({ slug: p.slug, title: p.title });
        }
        if (page.start_date) p.cycle_start_date = page.start_date;
        if (page.application_deadline) p.application_deadline = page.application_deadline;
        if (page.price !== null) {
          // First sync: the existing price came from the original export (base price,
          // before the cycle discount). Keep it once as price_base; never overwrite it later.
          if (!orig.price_source && orig.price !== null && orig.price !== undefined && p.price_base === undefined) {
            p.price_base = orig.price;
          }
          const before = orig.price === null || orig.price === undefined ? null : Number(orig.price);
          p.price = page.price;
          p.price_source = "jsonld";
          p.price_checked_at = checkedAt;
          if (before === null) {
            diff.price_filled.push({ slug: p.slug, price: page.price });
          } else if (before !== page.price) {
            diff.price_changed.push({ slug: p.slug, from: before, to: page.price });
            if (Math.abs(page.price - before) / before > opts.maxPriceChangeRatio) {
              diff.price_flagged.push({ slug: p.slug, from: before, to: page.price });
            }
          }
        }
      }
    }
    if (wasActive && !isActive(p)) diff.deactivated.push({ slug: p.slug, title: p.title });
    if (!wasActive && isActive(p)) diff.reactivated.push({ slug: p.slug, title: p.title });
    return p;
  });

  const activeBefore = programs.filter(isActive).length;
  const blockers = [];
  if (check.cycle.length < programs.length * opts.minActiveRatio) {
    blockers.push(
      `Η λίστα «Τρέχων Κύκλος» έχει μόνο ${check.cycle.length} προγράμματα (κατάλογος: ${programs.length}). Πιθανή αλλαγή στη μορφή του site.`
    );
  }
  if (activeBefore > 0 && diff.deactivated.length > activeBefore * opts.maxDeactivationRatio) {
    blockers.push(
      `Απενεργοποιούνται ${diff.deactivated.length} από ${activeBefore} ενεργά (>${Math.round(opts.maxDeactivationRatio * 100)}%). Χρειάζεται έλεγχος πριν την εφαρμογή.`
    );
  }

  const summary = {
    checked_at: checkedAt,
    catalog_total: programs.length,
    in_cycle: check.cycle.length,
    active_after: candidate.filter(isActive).length,
    inactive_after: candidate.filter((p) => !isActive(p)).length,
    deactivated: diff.deactivated.length,
    reactivated: diff.reactivated.length,
    new_in_cycle: diff.new_in_cycle.length,
    price_filled: diff.price_filled.length,
    price_changed: diff.price_changed.length,
    price_flagged: diff.price_flagged.length,
    page_errors: diff.page_errors.length,
    in_cycle_but_unavailable: diff.in_cycle_but_unavailable.length,
    can_apply: blockers.length === 0,
    blockers,
  };
  return { candidate, diff, summary };
}

module.exports = {
  COURSE_SCHEDULE_URL,
  DEFAULTS,
  parseCourseSchedule,
  parseCoursePage,
  checkCatalog,
  buildCandidate,
  isActive,
};
