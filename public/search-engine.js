/**
 * EKPA Smart Finder - shared search engine.
 * Same module runs in the browser (window.EkpaSearch) AND in Node (module.exports),
 * so the backend's retrieval step is guaranteed to behave identically to the
 * frontend's instant-search - no logic duplication/drift between the two.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EkpaSearch = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  // Common function words that carry no topical meaning - excluded from scoring
  // terms so they don't dilute relevance in multi-word queries.
  const STOPWORDS = new Set([
    "και", "για", "της", "του", "των", "το", "τα", "τον", "την", "με", "από", "στο",
    "στη", "στην", "στον", "στα", "είναι", "ένα", "μία", "μια", "ή", "αλλα", "αλλά",
    "that", "and", "the", "of", "in", "for", "to", "a", "an", "with", "on",
  ]);

  // Generalized typo-tolerance: a vocabulary built from words that ACTUALLY occur in
  // the catalog (titles + official categories only - deliberately excluding tags and
  // free-text descriptions, which is exactly where the "digital marketing" -> stray
  // "digital" bug came from). Filtered by document frequency: a word used in too many
  // programs (like "διοικηση") is too generic to be a safe typo-correction target.
  function buildVocabulary(programs) {
    const freq = new Map();
    programs.forEach((p) => {
      const seen = new Set();
      [p.title, (p.areas_of_study || []).join(" ")].forEach((f) => {
        foldGreek(normalize(f)).split(" ").forEach((t) => {
          if (t.length >= 5 && !STOPWORDS.has(t)) seen.add(t);
        });
      });
      seen.forEach((t) => freq.set(t, (freq.get(t) || 0) + 1));
    });
    return Array.from(freq.entries()).filter(([, c]) => c >= 1 && c <= 20).map(([w]) => w);
  }

  let cachedVocab = null;
  let cachedVocabForPrograms = null;
  function getVocabulary(programs) {
    if (cachedVocab && cachedVocabForPrograms === programs) return cachedVocab;
    cachedVocab = buildVocabulary(programs);
    cachedVocabForPrograms = programs;
    return cachedVocab;
  }

  // Genuine typos almost always share their opening letters (e.g. "διαφημιση" /
  // "διαφιμιση"). Words that are only "close" because Greek phonetic folding
  // collapsed a shared SUFFIX (e.g. "ψυχολογια"/"οινολογια" both end in -ολογια
  // after folding) do NOT share a prefix — requiring one filters out exactly
  // that false-positive class without weakening real typo tolerance.
  const MIN_SHARED_PREFIX = 3;
  function sharesPrefix(a, b, n) {
    return a.slice(0, n) === b.slice(0, n);
  }

  function fuzzyVocabMatches(token, vocab) {
    if (token.length < 5) return [];
    const maxDist = token.length >= 9 ? 2 : 1;
    const out = [];
    for (const word of vocab) {
      if (word === token) continue;
      if (Math.abs(word.length - token.length) > maxDist) continue;
      if (!sharesPrefix(token, word, MIN_SHARED_PREFIX)) continue;
      if (levenshtein(token, word) <= maxDist) out.push(word);
    }
    return out.slice(0, 3);
  }

  function normalize(v) {
    return String(v || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Fold Greek letters that sound identical in Modern Greek (iotacism: η/υ/ει/οι/υι all
  // sound like "ι"; ω sounds like "ο"). Applied to ALL Greek text (catalog data AND
  // queries) so spelling variants and transliterated greeklish converge to the same
  // form. Never touches Latin letters, so English text/titles are unaffected.
  function foldGreek(s) {
    return s.replace(/ει|οι|υι/g, "ι").replace(/η/g, "ι").replace(/υ/g, "ι").replace(/ω/g, "ο");
  }

  const GREEKLISH_DIGRAPHS = [
    ["th", "θ"], ["ps", "ψ"], ["ks", "ξ"], ["ch", "χ"], ["ou", "ου"], ["ai", "αι"],
    ["ei", "ει"], ["oi", "οι"], ["mp", "μπ"], ["nt", "ντ"], ["gk", "γκ"], ["gg", "γγ"],
    ["ts", "τσ"], ["tz", "τζ"],
  ];
  const GREEKLISH_SINGLE = {
    a: "α", b: "β", c: "κ", d: "δ", e: "ε", f: "φ", g: "γ", h: "η", i: "ι", j: "ζ",
    k: "κ", l: "λ", m: "μ", n: "ν", o: "ο", p: "π", q: "κ", r: "ρ", s: "σ", t: "τ",
    u: "ου", v: "β", w: "ω", x: "χ", y: "υ", z: "ζ",
  };

  // Latin-script Greek ("greeklish") -> Greek transliteration, e.g. "psixologia" -> "ψιχολογια".
  function transliterateGreeklish(latinLower) {
    let out = "";
    let i = 0;
    while (i < latinLower.length) {
      const two = latinLower.slice(i, i + 2);
      const dg = GREEKLISH_DIGRAPHS.find(([lat]) => lat === two);
      if (dg) { out += dg[1]; i += 2; continue; }
      const ch = latinLower[i];
      if (GREEKLISH_SINGLE[ch]) { out += GREEKLISH_SINGLE[ch]; i += 1; continue; }
      out += ch;
      i += 1;
    }
    return out;
  }

  function isLikelyGreeklish(text) {
    return /[a-z]/i.test(text) && !/[\u0370-\u03FF\u1F00-\u1FFF]/.test(text);
  }

  // A query is checked in both its normal form AND (if it looks like Latin-script Greek)
  // a transliterated-to-Greek form. Both variants get folded, so "psixologia" and
  // "ψυχολογία" converge to the same canonical string ("ψιχολογια").
  function queryVariants(q) {
    const variants = new Set();
    const base = foldGreek(normalize(q));
    if (base) variants.add(base);
    const lower = String(q || "").toLowerCase();
    if (isLikelyGreeklish(lower)) {
      const translit = foldGreek(normalize(transliterateGreeklish(lower)));
      if (translit) variants.add(translit);
    }
    return Array.from(variants);
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (a.length < b.length) [a, b] = [b, a];
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const curr = [i];
      for (let j = 1; j <= b.length; j++) {
        curr.push(Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
      }
      prev = curr;
    }
    return prev[b.length];
  }

  // FIXED matching: whole-word for single-token triggers, whole-phrase (word-boundary)
  // for multi-word triggers. No raw substring containment (that was the original bug).
  function phraseMatches(triggerNorm, textNorm, textTokenSet) {
    const trigTokens = triggerNorm.split(" ");
    if (trigTokens.length === 1) {
      const t = trigTokens[0];
      if (textTokenSet.has(t)) return true;
      if (t.length >= 6) {
        for (const tok of textTokenSet) {
          if (Math.abs(tok.length - t.length) <= 1 && tok.length >= 6 && sharesPrefix(t, tok, MIN_SHARED_PREFIX) && levenshtein(t, tok) <= 1) return true;
        }
      }
      return false;
    }
    return (" " + textNorm + " ").includes(" " + triggerNorm + " ");
  }

  // Multi-word concept terms are kept intact as phrases (not flattened into loose
  // single words) - that flattening was the second bug ("digital marketing" -> stray "digital").
  function expandQuery(q, CONCEPTS, vocab) {
    const terms = new Set();
    queryVariants(q).forEach((variantText) => {
      variantText.split(" ").filter((t) => t.length > 1 && !STOPWORDS.has(t)).forEach((t) => terms.add(t));
      const textTokens = new Set(variantText.split(" "));
      Object.values(CONCEPTS).forEach((conceptTerms) => {
        const hit = conceptTerms.some((t) => phraseMatches(foldGreek(normalize(t)), variantText, textTokens));
        if (hit) conceptTerms.slice(0, 6).forEach((t) => terms.add(foldGreek(normalize(t))));
      });
      // Generalized typo tolerance: correct tokens against real catalog vocabulary.
      if (vocab) {
        textTokens.forEach((tok) => {
          if (tok.length < 5 || STOPWORDS.has(tok)) return;
          fuzzyVocabMatches(tok, vocab).forEach((corrected) => {
            terms.add(corrected);
            Object.values(CONCEPTS).forEach((conceptTerms) => {
              const isTrigger = conceptTerms.some((ct) => foldGreek(normalize(ct)) === corrected);
              if (isTrigger) conceptTerms.slice(0, 6).forEach((ct) => terms.add(foldGreek(normalize(ct))));
            });
          });
        });
      }
    });
    return Array.from(terms);
  }

  // A short expanded term (e.g. "ινος", folded from "οίνος"/wine) can legitimately
  // appear as a SUBSTRING of a longer inflected form of the same root ("οίνου",
  // "οίνων"), but Greek also has extremely common suffixes ("-ινος" is a standard
  // adjective ending) that make short substrings collide with totally unrelated
  // words ("ανθρώπινος", "καρκίνος"). Requiring the term to cover a healthy share
  // of the token's length keeps genuine root/inflection matches while rejecting
  // coincidental fragments buried inside a much longer, unrelated word.
  const MIN_TERM_TOKEN_OVERLAP = 0.6;
  function containsTerm(textAll, tokenSet, term) {
    if (term.includes(" ")) return (" " + textAll + " ").includes(" " + term + " ");
    if (term.length <= 3) return tokenSet.has(term);
    for (const tok of tokenSet) {
      if (tok.includes(term) && term.length / tok.length >= MIN_TERM_TOKEN_OVERLAP) return true;
    }
    return false;
  }

  function fullText(p) {
    return foldGreek(normalize(
      [p.title, p.primary_area, (p.areas_of_study || []).join(" "), p.description_for_matching || p.description_full, (p.tags || []).join(" ")].join(" ")
    ));
  }

  function score(p, q, CONCEPTS, vocab) {
    const variants = queryVariants(q);
    const terms = expandQuery(q, CONCEPTS, vocab);
    const title = foldGreek(normalize(p.title));
    const primaryArea = foldGreek(normalize(p.primary_area));
    const area = foldGreek(normalize((p.areas_of_study || []).join(" ")));
    const tags = foldGreek(normalize((p.tags || []).join(" ")));
    const all = fullText(p);
    const titleTok = new Set(title.split(" "));
    const tagsTok = new Set(tags.split(" "));
    const primaryAreaTok = new Set(primaryArea.split(" "));
    const areaTok = new Set(area.split(" "));
    const allTok = new Set(all.split(" "));
    let s = 0;
    variants.forEach((raw) => {
      if (title === raw) s += 200;
      if (title.includes(raw)) s += 100;
      if (tags.includes(raw)) s += 90;
      if (primaryArea.includes(raw)) s += 45; // official primary category - strong signal
      else if (area.includes(raw)) s += 15; // only found among secondary/other listed categories - weaker signal
      if (all.includes(raw)) s += 25;
    });
    terms.forEach((t) => {
      if (containsTerm(title, titleTok, t)) s += 18;
      if (containsTerm(tags, tagsTok, t)) s += 15;
      if (containsTerm(primaryArea, primaryAreaTok, t)) s += 8;
      else if (containsTerm(area, areaTok, t)) s += 3;
      if (containsTerm(all, allTok, t)) s += 3;
    });
    return s;
  }

  const MAX_QUERY_LENGTH = 700; // hard cap: no legitimate search needs more than this,
  // and it bounds the cost of vocabulary fuzzy-matching (which scales with query token count).

  function search(programs, concepts, query, k = 40) {
    query = String(query || "").slice(0, MAX_QUERY_LENGTH);
    const vocab = getVocabulary(programs);
    return programs
      .map((p) => ({ p, s: score(p, query, concepts, vocab) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => ({ ...x.p, _score: x.s }));
  }

  return { normalize, foldGreek, transliterateGreeklish, levenshtein, phraseMatches, expandQuery, containsTerm, score, search };
});
