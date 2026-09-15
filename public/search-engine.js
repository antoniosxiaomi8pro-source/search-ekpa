/**
 * EKPA Smart Finder - shared search engine.
 * Same module runs in the browser (window.EkpaSearch) AND in Node (module.exports),
 * so the backend's retrieval step is guaranteed to behave identically to the
 * frontend's instant-search - no logic duplication/drift between the two.
 * (index.html loads THIS file via <script src="search-engine.js"> — there is no
 * second copy of the scoring logic anywhere else.)
 *
 * Performance model (v4):
 *  - Per-program normalized fields + token sets are computed ONCE per programs array
 *    (cached in a WeakMap), not on every query.
 *  - Query variants + concept expansion + typo-correction are computed ONCE per query,
 *    not once per program (the v3 backend recomputed them 702x per request, ~1-2.5s).
 *  - Folded concept terms are cached per concepts object (re-built automatically when
 *    the admin panel replaces the concepts object).
 *  - Small LRU cache of full rankings per query (invalidated when programs/concepts change).
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
  //
  // IMPORTANT: entries here are matched against ALREADY-FOLDED query tokens (see
  // queryVariants/foldGreek below), so they must be written in their POST-FOLD form
  // (accents stripped, η/υ/ω folded) - e.g. "της" -> "τις", "είναι" -> "ιναι", "από"
  // -> "απο". Several entries here were previously written in their original,
  // unfolded spelling and as a result silently never matched anything (discovered
  // 15/9/2026 while investigating why periphrastic queries like "θέλω κάτι για..."
  // lost their focus - "της"/"του"/"των"/"στη"/"στην"/"είναι"/"από" were NOT being
  // filtered at all despite being listed). If you add a new Greek stopword, run it
  // through foldGreek(normalize(word)) first and add the RESULT, not the word itself.
  const STOPWORDS = new Set([
    "και", "για", "τις", "τοι", "τον", "το", "τα", "τιν", "με", "απο", "στο",
    "στι", "στιν", "στον", "στα", "ιναι", "ενα", "μια", "αλλα",
    // Noise verbs/pronouns from consultative-style queries ("θέλω κάτι για...",
    // "ψάχνω κάποιο πρόγραμμα που να...") - these carry no topical signal either,
    // but were drowning out the real keyword in longer, conversational queries.
    "να", "κατι", "θελο", "ψαχνο", "ιθελα", "μπορο", "μποριτε", "προτινετε",
    "καπιο", "καπια", "ιμαι",
    "that", "and", "the", "of", "in", "for", "to", "a", "an", "with", "on",
    // Every single item in this catalog IS a "πρόγραμμα" (course/program) — the word
    // carries no discriminating signal for relevance, it just adds noise that can
    // outweigh genuine matches (e.g. "προγράμματα για φιλολόγους" was scoring an
    // unrelated "...Ψηφιακά Προγράμματα" title above the real philology courses).
    "προγραμμα", "προγραμματα", "program", "programs",
  ]);

  function normalize(v) {
    return String(v || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
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
    return /[a-z]/i.test(text) && !/[Ͱ-Ͽἀ-῿]/.test(text);
  }

  // Greeklish transliteration is only attempted for queries with at least this many
  // letters. Very short Latin queries are almost always acronyms ("ai", "hr", "it",
  // "bi", "seo") — transliterating them ("hr" -> "ιρ") produced fragments that occur
  // inside hundreds of unrelated Greek words ("εργαστήριο"), matching ~80-95% of the
  // whole catalog. Real greeklish words ("psixologia", "dioikisi") are never that short.
  const MIN_GREEKLISH_LETTERS = 4;

  // Greek "αυ"/"ευ" are pronounced (and often typed in Greeklish) as "af"/"av" or
  // "ef"/"ev" depending on the following consonant's voicing (e.g. "ναυτιλιακά" is
  // commonly typed "naftiliaka"). We can't reliably tell from Latin letters alone
  // whether "f"/"v" was meant as itself (φ/β) or as part of a diphthong, so when
  // this pattern appears we try the diphthong reading too, as an extra candidate.
  function transliterateGreeklishAuEu(latinLower) {
    const marked = latinLower
      .replace(/av/g, "").replace(/af/g, "")
      .replace(/ev/g, "").replace(/ef/g, "");
    return transliterateGreeklish(marked).replace(//g, "αυ").replace(//g, "ευ");
  }

  // A query is checked in both its normal form AND (if it looks like Latin-script Greek)
  // a transliterated-to-Greek form. Both variants get folded, so "psixologia" and
  // "ψυχολογία" converge to the same canonical string ("ψιχολογια").
  function queryVariants(q) {
    const variants = new Set();
    const base = foldGreek(normalize(q));
    if (base) variants.add(base);
    const lower = String(q || "").toLowerCase();
    if (isLikelyGreeklish(lower) && base.replace(/\s+/g, "").length >= MIN_GREEKLISH_LETTERS) {
      const translit = foldGreek(normalize(transliterateGreeklish(lower)));
      if (translit) variants.add(translit);
      if (/a[fv]|e[fv]/.test(lower)) {
        const translit2 = foldGreek(normalize(transliterateGreeklishAuEu(lower)));
        if (translit2) variants.add(translit2);
      }
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

  // Genuine typos almost always share their opening letters (e.g. "διαφημιση" /
  // "διαφιμιση"). Words that are only "close" because Greek phonetic folding
  // collapsed a shared SUFFIX (e.g. "ψυχολογια"/"οινολογια" both end in -ολογια
  // after folding) do NOT share a prefix — requiring one filters out exactly
  // that false-positive class without weakening real typo tolerance.
  const MIN_SHARED_PREFIX = 3;
  function sharesPrefix(a, b, n) {
    if (!a || !b || a[0] !== b[0]) return false; // the opening letter must always match —
    // this is what actually rules out unrelated roots like ψυχολογια/οινολογια or
    // μαθισις/παθισις, regardless of what happens later in the word.
    if (a.length === b.length) return a.slice(0, n) === b.slice(0, n);
    // Different lengths: only bridge the gap for a DOUBLED letter specifically
    // (e.g. "αγγλικα" vs "αγλικα" — forgetting to double a consonant is a very
    // common Greek/Greeklish typo). A first attempt allowed any single inserted
    // character here, but that reopened dozens of unrelated collisions across the
    // real catalog (e.g. "στατιστικα"/"στρατιοτικα", "γεολογια"/"γεμολογια") —
    // far more damage than the one case it was meant to fix.
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    const shortPrefix = shorter.slice(0, n);
    for (let i = 1; i < Math.min(longer.length, n + 1); i++) {
      if (longer[i] === longer[i - 1]) {
        const candidate = longer.slice(0, i) + longer.slice(i + 1);
        if (candidate.slice(0, n) === shortPrefix) return true;
      }
    }
    return false;
  }

  // ---- Vocabulary (typo-correction targets) ----
  // Built from words that ACTUALLY occur in the catalog (titles + official categories
  // only - deliberately excluding tags and free-text descriptions, which is exactly where
  // the "digital marketing" -> stray "digital" bug came from). Filtered by document
  // frequency: a word used in too many programs (like "διοικηση") is too generic to be a
  // safe typo-correction target.
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

  // Folded concept terms, cached per concepts object. The admin panel replaces the whole
  // CONCEPTS object on save, so a new object automatically gets a fresh cache entry.
  const foldedConceptsCache = new WeakMap();
  function getFoldedConcepts(CONCEPTS) {
    if (!CONCEPTS || typeof CONCEPTS !== "object") return [];
    let f = foldedConceptsCache.get(CONCEPTS);
    if (!f) {
      f = Object.values(CONCEPTS).map((terms) => (terms || []).map((t) => foldGreek(normalize(t))));
      foldedConceptsCache.set(CONCEPTS, f);
    }
    return f;
  }

  // Multi-word concept terms are kept intact as phrases (not flattened into loose
  // single words) - that flattening was the second bug ("digital marketing" -> stray "digital").
  //
  // Also tracks, best-effort, which ORIGINAL query word each expanded term came from
  // (`byWord`) — used by the coverage bonus in scoreEntry() below to tell "one word
  // matched hard" apart from "every word in the query matched something" (e.g.
  // "αθλητική ψυχολογία" should prefer a program that is genuinely about both sports
  // AND psychology over one that is only heavily about psychology).
  function expandQueryDetailed(q, CONCEPTS, vocab) {
    const allTerms = new Set();
    const byWord = {}; // original query word -> Set of terms attributable to it
    const folded = getFoldedConcepts(CONCEPTS);
    queryVariants(q).forEach((variantText) => {
      const words = variantText.split(" ").filter((t) => t.length > 1 && !STOPWORDS.has(t));
      words.forEach((t) => {
        allTerms.add(t);
        (byWord[t] = byWord[t] || new Set()).add(t);
      });
      const textTokens = new Set(words);
      folded.forEach((conceptTerms) => {
        const hit = conceptTerms.some((t) => phraseMatches(t, variantText, textTokens));
        if (hit) {
          const added = conceptTerms.slice(0, 6);
          added.forEach((t) => allTerms.add(t));
          // Attribute this concept's terms to whichever original word(s) plausibly
          // triggered it (shares a substring with the trigger term). Best-effort: if
          // nothing matches, the terms still count for relevance (added above),
          // just without contributing to the coverage bonus.
          conceptTerms.forEach((ct) => {
            words.forEach((w) => {
              if (ct.includes(w) || w.includes(ct)) {
                added.forEach((a) => (byWord[w] = byWord[w] || new Set()).add(a));
              }
            });
          });
        }
      });
      // Generalized typo tolerance: correct tokens against real catalog vocabulary.
      if (vocab) {
        textTokens.forEach((tok) => {
          if (tok.length < 5 || STOPWORDS.has(tok)) return;
          fuzzyVocabMatches(tok, vocab).forEach((corrected) => {
            allTerms.add(corrected);
            (byWord[tok] = byWord[tok] || new Set()).add(corrected);
            folded.forEach((conceptTerms) => {
              if (conceptTerms.includes(corrected)) {
                conceptTerms.slice(0, 6).forEach((ct) => {
                  allTerms.add(ct);
                  (byWord[tok] = byWord[tok] || new Set()).add(ct);
                });
              }
            });
          });
        });
      }
    });
    const byWordArr = {};
    Object.entries(byWord).forEach(([k, v]) => { byWordArr[k] = Array.from(v); });
    return { termsFlat: Array.from(allTerms), byWord: byWordArr };
  }

  function expandQuery(q, CONCEPTS, vocab) {
    return expandQueryDetailed(q, CONCEPTS, vocab).termsFlat;
  }

  // A short expanded term (e.g. "ινος", folded from "οίνος"/wine) can legitimately
  // appear as a SUBSTRING of a longer inflected form of the same root ("οίνου",
  // "οίνων"), but Greek also has extremely common suffixes ("-ινος" is a standard
  // adjective ending) that make short substrings collide with totally unrelated
  // words ("ανθρώπινος", "καρκίνος"). Requiring the term to cover a healthy share
  // of the token's length keeps genuine root/inflection matches while rejecting
  // coincidental fragments buried inside a much longer, unrelated word.
  const MIN_TERM_TOKEN_OVERLAP = 0.75;
  function containsTerm(textAll, tokenSet, term) {
    if (term.includes(" ")) return (" " + textAll + " ").includes(" " + term + " ");
    if (term.length <= 3) return tokenSet.has(term);
    for (const tok of tokenSet) {
      if (tok.includes(term) && term.length / tok.length >= MIN_TERM_TOKEN_OVERLAP) return true;
    }
    return false;
  }

  // Raw (un-expanded) query containment. For very short single-token queries
  // (<= SHORT_RAW_MAX chars, e.g. "ai", "hr", "ψυ") a plain substring test matches
  // fragments inside almost every word of the catalog; those are matched as a WORD
  // PREFIX instead ("ψυ" -> "ψυχολογία" still works for type-ahead, "hr" no longer
  // matches "εργαστήριο"). Longer queries keep substring behaviour so partial words
  // ("market" -> "marketing") still work exactly as before.
  const SHORT_RAW_MAX = 3;
  function rawContains(text, tokenSet, raw) {
    if (raw.length > SHORT_RAW_MAX || raw.includes(" ")) return text.includes(raw);
    for (const tok of tokenSet) {
      if (tok.startsWith(raw)) return true;
    }
    return false;
  }

  function fullText(p) {
    return foldGreek(normalize(
      [p.title, p.primary_area, (p.areas_of_study || []).join(" "), p.description_for_matching || p.description_full, (p.tags || []).join(" ")].join(" ")
    ));
  }

  // ---- Precomputed per-program index ----
  function buildEntry(p) {
    const title = foldGreek(normalize(p.title));
    const primaryArea = foldGreek(normalize(p.primary_area));
    const area = foldGreek(normalize((p.areas_of_study || []).join(" ")));
    const tags = foldGreek(normalize((p.tags || []).join(" ")));
    const all = fullText(p);
    return {
      p, title, primaryArea, area, tags, all,
      titleTok: new Set(title.split(" ")),
      tagsTok: new Set(tags.split(" ")),
      primaryAreaTok: new Set(primaryArea.split(" ")),
      areaTok: new Set(area.split(" ")),
      allTok: new Set(all.split(" ")),
    };
  }

  const indexCache = new WeakMap();
  function getIndex(programs) {
    let idx = indexCache.get(programs);
    if (!idx) {
      idx = { entries: programs.map(buildEntry), vocab: buildVocabulary(programs), rankCache: new Map(), rankCacheConcepts: null };
      indexCache.set(programs, idx);
    }
    return idx;
  }
  function getVocabulary(programs) {
    return getIndex(programs).vocab;
  }

  // How much to reward a program for genuinely covering MULTIPLE distinct query
  // concepts (e.g. "αθλητική ψυχολογία") over one that just heavily matches a single
  // concept. Deliberately modest relative to typical scores (100-250) — enough to lift
  // a weak-but-broad match above a strong-but-narrow one when that's the only
  // genuinely on-topic result, without overriding a program that is a strong match
  // on its own.
  const COVERAGE_BONUS_PER_EXTRA_CONCEPT = 70;

  function scoreEntry(e, variants, terms, byWord) {
    let s = 0;
    variants.forEach((raw) => {
      if (e.title === raw) s += 200;
      if (rawContains(e.title, e.titleTok, raw)) s += 100;
      if (rawContains(e.tags, e.tagsTok, raw)) s += 90;
      if (rawContains(e.primaryArea, e.primaryAreaTok, raw)) s += 45; // official primary category - strong signal
      else if (rawContains(e.area, e.areaTok, raw)) s += 15; // only among secondary categories - weaker signal
      if (rawContains(e.all, e.allTok, raw)) s += 25;
    });
    terms.forEach((t) => {
      if (containsTerm(e.title, e.titleTok, t)) s += 18;
      if (containsTerm(e.tags, e.tagsTok, t)) s += 15;
      if (containsTerm(e.primaryArea, e.primaryAreaTok, t)) s += 8;
      else if (containsTerm(e.area, e.areaTok, t)) s += 3;
      if (containsTerm(e.all, e.allTok, t)) s += 3;
    });
    // Coverage bonus: only evaluated for queries with 2+ distinct meaningful words —
    // a single-word/single-concept query never reaches this block with a nonzero
    // effect, so it returns exactly what the logic above already computed.
    //
    // Deliberately checks ONLY title/tags/category, never the full description
    // (`all`). A program's long-form description routinely name-drops unrelated
    // words in passing (eligibility lists, "για όσους έχουν πτυχίο X ή Y..."), so
    // treating any description substring as "this word is covered" let an unrelated
    // program (e.g. one merely listing psychology graduates among eligible
    // applicants) collect the bonus and outrank programs that are actually about the
    // query's topics. Title/tags/category are curated per-program and don't have
    // that problem.
    if (byWord) {
      const words = Object.keys(byWord);
      if (s > 0 && words.length >= 2) {
        let covered = 0;
        words.forEach((w) => {
          const hit = byWord[w].some((t) =>
            containsTerm(e.title, e.titleTok, t) || containsTerm(e.tags, e.tagsTok, t) ||
            containsTerm(e.primaryArea, e.primaryAreaTok, t) || containsTerm(e.area, e.areaTok, t)
          );
          if (hit) covered++;
        });
        if (covered >= 2) s += (covered - 1) * COVERAGE_BONUS_PER_EXTRA_CONCEPT;
      }
    }
    return s;
  }

  // Backwards-compatible single-program scorer (same signature as v3). Slow path —
  // only for ad-hoc use/tests; search()/rank() use the precomputed index.
  function score(p, q, CONCEPTS, vocab) {
    const { termsFlat: terms, byWord } = expandQueryDetailed(q, CONCEPTS, vocab);
    return scoreEntry(buildEntry(p), queryVariants(q), terms, byWord);
  }

  const MAX_QUERY_LENGTH = 700; // hard cap: no legitimate search needs more than this,
  // and it bounds the cost of vocabulary fuzzy-matching (which scales with query token count).
  const RANK_CACHE_SIZE = 300;

  // Full ranking of all matching programs: [{ entryIndex, s }] sorted by score desc.
  function rankAll(programs, concepts, query) {
    query = String(query || "").slice(0, MAX_QUERY_LENGTH);
    const idx = getIndex(programs);
    if (idx.rankCacheConcepts !== concepts) { idx.rankCache.clear(); idx.rankCacheConcepts = concepts; }
    const key = foldGreek(normalize(query)) + " " + query.toLowerCase();
    const cached = idx.rankCache.get(key);
    if (cached) { idx.rankCache.delete(key); idx.rankCache.set(key, cached); return cached; }

    const variants = queryVariants(query);
    const { termsFlat: terms, byWord } = expandQueryDetailed(query, concepts, idx.vocab);
    const ranked = [];
    if (variants.length) {
      for (let i = 0; i < idx.entries.length; i++) {
        const s = scoreEntry(idx.entries[i], variants, terms, byWord);
        if (s > 0) ranked.push({ i, s });
      }
      ranked.sort((a, b) => b.s - a.s);
    }
    idx.rankCache.set(key, ranked);
    if (idx.rankCache.size > RANK_CACHE_SIZE) idx.rankCache.delete(idx.rankCache.keys().next().value);
    return ranked;
  }

  // rank(): all matches (optionally filtered), as program copies with a _score field.
  function rank(programs, concepts, query, opts) {
    const filter = opts && opts.filter;
    const idx = getIndex(programs);
    const out = [];
    for (const { i, s } of rankAll(programs, concepts, query)) {
      const p = idx.entries[i].p;
      if (filter && !filter(p)) continue;
      out.push(Object.assign({}, p, { _score: s }));
    }
    return out;
  }

  function search(programs, concepts, query, k = 40) {
    const idx = getIndex(programs);
    return rankAll(programs, concepts, query)
      .slice(0, k)
      .map(({ i, s }) => Object.assign({}, idx.entries[i].p, { _score: s }));
  }

  // Human-readable expansion of a query (used by index.html's "Expanded:" line).
  function describeExpansion(programs, concepts, query) {
    return expandQuery(String(query || "").slice(0, MAX_QUERY_LENGTH), concepts, getVocabulary(programs));
  }

  return {
    normalize, foldGreek, transliterateGreeklish, levenshtein, phraseMatches, expandQuery,
    expandQueryDetailed, containsTerm, score, search, rank, describeExpansion, getVocabulary, queryVariants,
  };
});
