"use strict";

const LEGACY_MAX_SEARCH_LIMIT = 40;
const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 40;
const MAX_PAGE = 1000;
const COMPACT_SEARCH_FIELDS = ["id", "slug", "title", "url", "image_url", "price"];

function positiveInt(raw, fallback) {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clampLegacyLimit(raw) {
  return Math.min(positiveInt(raw, LEGACY_MAX_SEARCH_LIMIT), LEGACY_MAX_SEARCH_LIMIT);
}

function parsePagination(query) {
  const page = Math.min(positiveInt(query.page, 1), MAX_PAGE);
  const pageSize = Math.min(positiveInt(query.page_size, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function toCompactResult(p) {
  const out = {};
  COMPACT_SEARCH_FIELDS.forEach((k) => { out[k] = p[k]; });
  return out;
}

function shapeResults(results, fields) {
  return fields === "compact" ? results.map(toCompactResult) : results;
}

function buildPagedResponse(allResults, query) {
  const { page, pageSize, offset } = parsePagination(query);
  const total = allResults.length;
  const pageResults = allResults.slice(offset, offset + pageSize);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    results: shapeResults(pageResults, query.fields),
    pagination: {
      page,
      page_size: pageSize,
      total_results: total,
      total_pages: totalPages,
      has_previous: page > 1 && total > 0,
      has_next: page < totalPages,
    },
  };
}

module.exports = {
  LEGACY_MAX_SEARCH_LIMIT,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  clampLegacyLimit,
  parsePagination,
  shapeResults,
  buildPagedResponse,
};
