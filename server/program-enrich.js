"use strict";

// Fills the search fields of a program from its public page, and builds complete
// records for programs that are new in the cycle. Used by the catalog check.
//
// Rule: ONLY EMPTY FIELDS ARE FILLED. A field that already has a value is never
// changed here - existing, reviewed data keeps its current ranking behaviour.
//
// How each field is derived (measured against the existing catalog on 2026-10-01):
//  - id:                 the site's own application link "/apply/<id>" (same number as
//                        the CMS id for every program that already has one).
//  - primary_area:       the page's "Κατεύθυνση" (the site's official category), only
//                        if it is a category name already used in the catalog.
//  - areas_of_study:     [primary_area] when empty.
//  - description_*:      the Course JSON-LD description.
//  - concepts:           concept keys whose terms appear in title + PRIMARY category
//                        (precision 0.95 vs. the existing hand-checked concepts; adding
//                        the secondary categories drops it to 0.87 - e.g. "Digital
//                        Energy" picked up the Cisco concept only because a secondary
//                        category is "Πληροφορική - Δίκτυα - ..."). A wrong concept
//                        becomes tags worth +90 on unrelated queries, so precision wins
//                        over recall. Descriptions are never used (they name-drop
//                        unrelated words, the reason the engine's coverage bonus ignores them).
//  - tags:               the first 6 terms of each concept, sorted (the existing
//                        catalog carries ~6 terms per concept).
//  - similar_program_ids: other ACTIVE programs with an id, ranked by shared primary
//                        category, concepts and secondary categories.

const TAGS_PER_CONCEPT = 6;
const SIMILAR_COUNT = 10;

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEmpty(v) {
  return v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);
}

// Term matches at a word start (so "λογιστ" matches "λογιστική" but "ιστ" doesn't
// match inside "λογιστική").
function textHasTerm(text, term) {
  const t = norm(term);
  return !!t && (" " + text + " ").includes(" " + t);
}

function deriveConcepts(p, concepts) {
  const text = norm([p.title, p.primary_area].join(" "));
  return Object.keys(concepts).filter((k) => (concepts[k] || []).some((t) => textHasTerm(text, t)));
}

function deriveTags(conceptKeys, concepts) {
  const tags = new Set();
  conceptKeys.forEach((k) => (concepts[k] || []).slice(0, TAGS_PER_CONCEPT).forEach((t) => tags.add(norm(t))));
  return [...tags].filter(Boolean).sort();
}

function searchText(p) {
  return norm([p.title, p.primary_area, (p.areas_of_study || []).join(" "), p.description_for_matching || p.description_full, (p.tags || []).join(" ")].join(" "));
}

function similarityScore(a, b) {
  let s = 0;
  if (a.primary_area && a.primary_area === b.primary_area) s += 3;
  const ac = new Set(a.concepts || []);
  (b.concepts || []).forEach((c) => { if (ac.has(c)) s += 2; });
  const aa = new Set(a.areas_of_study || []);
  (b.areas_of_study || []).forEach((x) => { if (aa.has(x) && x !== a.primary_area) s += 1; });
  return s;
}

function computeSimilar(p, pool) {
  return pool
    .filter((o) => o.slug !== p.slug && o.id !== null && o.id !== undefined && o.status !== "inactive")
    .map((o) => ({ id: o.id, s: similarityScore(p, o), title: o.title }))
    .filter((x) => x.s >= 3)
    .sort((x, y) => y.s - x.s || String(x.title).localeCompare(String(y.title), "el"))
    .slice(0, SIMILAR_COUNT)
    .map((x) => x.id);
}

// Fills empty fields of one program from its parsed page. Returns the list of filled
// fields (similar_program_ids is done later, once the whole catalog is filled).
function fillFromPage(p, page, ctx) {
  const filled = [];
  const set = (field, value) => {
    if (isEmpty(p[field]) && !isEmpty(value)) {
      p[field] = value;
      filled.push(field);
    }
  };
  if (page.cms_id !== null && page.cms_id !== undefined) set("id", page.cms_id);
  if (page.direction && ctx.knownCategories.has(page.direction)) set("primary_area", page.direction);
  if (!isEmpty(p.primary_area)) set("areas_of_study", [p.primary_area]);
  set("description_full", page.description);
  set("description_for_matching", p.description_full);
  if (isEmpty(p.concepts)) {
    const c = deriveConcepts(p, ctx.concepts);
    set("concepts", c);
    if (isEmpty(p.tags)) set("tags", deriveTags(c, ctx.concepts));
  }
  if (filled.length) p.search_text = searchText(p);
  return filled;
}

function buildNewProgram(row, page, ctx) {
  const p = {
    id: page.cms_id ?? null,
    slug: row.slug,
    title: page.title || row.title,
    url: `https://elearningekpa.gr/courses/${row.slug}`,
    image_url: page.image || null,
    primary_area: null,
    areas_of_study: [],
    description_full: null,
    description_for_matching: null,
    price: page.price,
    tags_cms: [],
    tags: [],
    concepts: [],
    search_text: "",
    similar_program_ids: [],
  };
  fillFromPage(p, page, ctx);
  p.search_text = searchText(p);
  return p;
}

function knownCategories(programs) {
  const s = new Set();
  programs.forEach((p) => {
    if (p.primary_area) s.add(p.primary_area);
    (p.areas_of_study || []).forEach((a) => s.add(a));
  });
  return s;
}

module.exports = {
  TAGS_PER_CONCEPT,
  SIMILAR_COUNT,
  isEmpty,
  deriveConcepts,
  deriveTags,
  computeSimilar,
  fillFromPage,
  buildNewProgram,
  knownCategories,
  searchText,
};
