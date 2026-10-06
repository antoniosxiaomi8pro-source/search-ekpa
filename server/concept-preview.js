"use strict";

const Engine = require("../public/search-engine.js");
const RankingDiff = require("./ranking-diff.js");

const ALLOWED_STATUSES = new Set([
  null,
  "CONFIRMED",
  "CURATED",
  "REVIEW",
  "REJECT"
]);

const clone = (v) => JSON.parse(JSON.stringify(v));

function validateChanges(programsAll, concept, changes) {
  if (!concept || typeof concept !== "string") {
    throw new Error("Λείπει το concept.");
  }

  if (!Array.isArray(changes)) {
    throw new Error("Το draft πρέπει να είναι array αλλαγών.");
  }

  const bySlug = new Map(programsAll.map((p) => [p.slug, p]));
  const seen = new Set();

  for (const change of changes) {
    if (!change || typeof change !== "object") {
      throw new Error("Μη έγκυρη αλλαγή draft.");
    }

    if (change.concept !== concept) {
      throw new Error(`Η αλλαγή για ${change.slug || "άγνωστο πρόγραμμα"} αφορά διαφορετικό concept.`);
    }

    if (!bySlug.has(change.slug)) {
      throw new Error(`Άγνωστο πρόγραμμα: ${change.slug}`);
    }

    if (seen.has(change.slug)) {
      throw new Error(`Διπλή αλλαγή για πρόγραμμα: ${change.slug}`);
    }
    seen.add(change.slug);

    if (typeof change.assigned !== "boolean") {
      throw new Error(`Το assigned πρέπει να είναι boolean για ${change.slug}.`);
    }

    const status = change.assignment_status || null;
    if (!ALLOWED_STATUSES.has(status)) {
      throw new Error(`Μη έγκυρο assignment status για ${change.slug}.`);
    }

    if (change.assigned && status === null) {
      throw new Error(
        `Μη έγκυρη κατάσταση για ${change.slug}: ASSIGNED δεν επιτρέπεται χωρίς governance status.`
      );
    }

    if (!change.assigned && status === "CONFIRMED") {
      throw new Error(
        `Μη έγκυρη κατάσταση για ${change.slug}: CONFIRMED απαιτεί ενεργό concept assignment.`
      );
    }

    if (change.assigned && status === "REJECT") {
      throw new Error(
        `Μη έγκυρη κατάσταση για ${change.slug}: REJECT δεν επιτρέπεται μαζί με ενεργό concept assignment.`
      );
    }

    if (
      change.source != null &&
      typeof change.source !== "string"
    ) {
      throw new Error(`Μη έγκυρο source για ${change.slug}.`);
    }

    if (
      change.reason != null &&
      typeof change.reason !== "string"
    ) {
      throw new Error(`Μη έγκυρο reason για ${change.slug}.`);
    }
  }
}

function applyDraftChanges(programsAll, concept, changes) {
  validateChanges(programsAll, concept, changes);

  const candidate = clone(programsAll);
  const bySlug = new Map(candidate.map((p) => [p.slug, p]));
  const applied = [];

  for (const change of changes) {
    const p = bySlug.get(change.slug);

    const before = {
      assigned: (p.concepts || []).includes(concept),
      assignment_status:
        p.concept_assignment_status &&
        p.concept_assignment_status[concept]
          ? p.concept_assignment_status[concept].status || null
          : null,
      source:
        p.concept_assignment_status &&
        p.concept_assignment_status[concept]
          ? p.concept_assignment_status[concept].source || ""
          : "",
      reason:
        p.concept_assignment_status &&
        p.concept_assignment_status[concept]
          ? p.concept_assignment_status[concept].reason || ""
          : ""
    };

    p.concepts = Array.isArray(p.concepts) ? [...p.concepts] : [];

    if (change.assigned) {
      if (!p.concepts.includes(concept)) {
        p.concepts.push(concept);
      }
    } else {
      p.concepts = p.concepts.filter((c) => c !== concept);
    }

    p.concept_assignment_status =
      p.concept_assignment_status &&
      typeof p.concept_assignment_status === "object"
        ? { ...p.concept_assignment_status }
        : {};

    const status = change.assignment_status || null;
    const source = String(change.source || "").trim();
    const reason = String(change.reason || "").trim();

    if (status || source || reason) {
      p.concept_assignment_status[concept] = {
        status,
        source,
        reason
      };
    } else {
      delete p.concept_assignment_status[concept];
    }

    const after = {
      assigned: change.assigned,
      assignment_status: status,
      source,
      reason
    };

    applied.push({
      slug: p.slug,
      title: p.title,
      before,
      after
    });
  }

  return { candidate, applied };
}

function checkProtectedBaseline(candidateAll, concepts, baseline) {
  if (!baseline || !baseline.protected_queries) {
    return {
      ok: false,
      failures: [{
        query: null,
        reason: "Το protected baseline δεν είναι διαθέσιμο."
      }]
    };
  }

  const active = candidateAll.filter((p) => p.status !== "inactive");
  const failures = [];

  for (const [query, expected] of Object.entries(
    baseline.protected_queries
  )) {
    const actual = Engine.rank(active, concepts, query);

    if (actual.length !== expected.total) {
      failures.push({
        query,
        reason: "result_count_changed",
        expected_total: expected.total,
        actual_total: actual.length
      });
      continue;
    }

    const actualTop10 = actual.slice(0, 10).map((r) => ({
      slug: r.slug,
      score: r._score
    }));

    if (JSON.stringify(actualTop10) !== JSON.stringify(expected.top10)) {
      failures.push({
        query,
        reason: "protected_top10_changed",
        expected_top10: expected.top10,
        actual_top10: actualTop10
      });
    }
  }

  return {
    ok: failures.length === 0,
    failures
  };
}

async function previewConceptDraft({
  programsAll,
  concepts,
  fixture,
  protectedBaseline,
  concept,
  changes
}) {
  const { candidate, applied } =
    applyDraftChanges(programsAll, concept, changes);

  const changedSlugs = new Set(applied.map((x) => x.slug));

  const ranking = await RankingDiff.compareRankingsAsync(
    programsAll,
    candidate,
    concepts,
    fixture || {},
    changedSlugs
  );

  const protectedCheck = checkProtectedBaseline(
    candidate,
    concepts,
    protectedBaseline
  );

  return {
    ok: true,
    concept,
    draft_changes: applied.length,
    changes: applied,
    ranking,
    protected_baseline: protectedCheck,
    blocked: !protectedCheck.ok
  };
}

module.exports = {
  validateChanges,
  applyDraftChanges,
  checkProtectedBaseline,
  previewConceptDraft
};
