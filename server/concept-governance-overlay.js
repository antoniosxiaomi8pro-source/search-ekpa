"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function overlayGovernedConcepts(packageCatalog, liveCatalog) {
  if (!Array.isArray(packageCatalog)) {
    throw new Error("packageCatalog must be an array.");
  }

  if (!Array.isArray(liveCatalog)) {
    throw new Error("liveCatalog must be an array.");
  }

  const liveBySlug = new Map(
    liveCatalog
      .filter((p) => p && typeof p.slug === "string")
      .map((p) => [p.slug, p])
  );

  return packageCatalog.map((packageProgram) => {
    const candidate = clone(packageProgram);
    const liveProgram = liveBySlug.get(candidate.slug);

    if (!liveProgram) return candidate;

    const governed =
      liveProgram.concept_assignment_status &&
      typeof liveProgram.concept_assignment_status === "object"
        ? liveProgram.concept_assignment_status
        : {};

    const governedConcepts = Object.keys(governed);

    if (!governedConcepts.length) {
      return candidate;
    }

    const packageStatus =
      candidate.concept_assignment_status &&
      typeof candidate.concept_assignment_status === "object"
        ? clone(candidate.concept_assignment_status)
        : {};

    candidate.concept_assignment_status = {
      ...packageStatus,
      ...clone(governed)
    };

    const liveAssigned = new Set(
      Array.isArray(liveProgram.concepts)
        ? liveProgram.concepts
        : []
    );

    const resultConcepts = Array.isArray(candidate.concepts)
      ? [...candidate.concepts]
      : [];

    const resultSet = new Set(resultConcepts);

    for (const concept of governedConcepts) {
      if (liveAssigned.has(concept)) {
        if (!resultSet.has(concept)) {
          resultConcepts.push(concept);
          resultSet.add(concept);
        }
      } else {
        resultSet.delete(concept);
      }
    }

    candidate.concepts = resultConcepts.filter((concept) =>
      resultSet.has(concept)
    );

    return candidate;
  });
}

module.exports = {
  overlayGovernedConcepts
};
