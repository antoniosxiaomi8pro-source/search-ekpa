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
    // Join the official ADHD acronym when punctuation normalization splits
    // "ΔΕΠ-Υ" into two tokens ("δεπ υ"), so ΔΕΠΥ / ΔΕΠ-Υ / δεπ υ share one
    // canonical representation before iotacism folds υ -> ι.
    return s
      .replace(/δεπ\s+υ/g, "δεπυ")
      .replace(/ει|οι|υι/g, "ι")
      .replace(/η/g, "ι")
      .replace(/υ/g, "ι")
      .replace(/ω/g, "ο");
  }

  const GREEKLISH_DIGRAPHS = [
    ["th", "θ"], ["ps", "ψ"], ["ks", "ξ"], ["ch", "χ"], ["ou", "ου"], ["au", "αυ"], ["eu", "ευ"], ["ai", "αι"],
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
    // Native Greek uses final sigma (ς) at word endings. The single-letter
    // table necessarily emits σ for Latin "s"; convert only word-final σ here
    // so Greeklish "tourismos" converges with native "τουρισμός" without
    // changing canonical Greek catalog/index text globally.
    return out.replace(/σ(?=$|[^\p{L}\p{N}])/gu, "ς");
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

  // Explicit, curated whole-query aliases loaded from lexicon.json.
  // These are deliberately NOT generated automatically from concept terms:
  // every alias must be explicitly validated before it becomes searchable.
  const QUERY_ALIASES = {};

  // Explicit curated token-level aliases loaded from lexicon.json.
  // Unlike generic acronym inference, only exact normalized tokens that
  // appear in this table may be expanded.
  const TOKEN_ALIASES = {};

  // Explicit curated multi-word semantic intents loaded from lexicon.json.
  // A phrase intent activates only when one of its registered phrases matches.
  const PHRASE_INTENTS = {};

  // Explicit query-specific lexical collision exclusions loaded from lexicon.json.
  // These do not hide programs; they only prevent known unrelated tokens from
  // creating relevance for the registered query through substring/fuzzy collisions.
  const COLLISION_EXCLUSIONS = {};

  function resolvePhraseIntent(query) {
    const normalized = foldGreek(normalize(String(query || "")));
    if (!normalized) return null;

    for (const intent of Object.values(PHRASE_INTENTS)) {
      if (intent.phrases.includes(normalized)) {
        return {
          id: intent.id,
          phrases: intent.phrases.slice(),
          terms: intent.terms.slice()
        };
      }
    }
    return null;
  }

  let compoundIndexCache = new WeakMap();

  function collectCompoundPhrases(programs, concepts) {
    const out = [];
    const add = (phrase, source) => {
      const folded = foldGreek(normalize(phrase));
      if (!folded) return;
      out.push({ phrase: folded, source });
    };

    (programs || []).forEach((p) => {
      add(p.primary_area, "primary_area");
      (p.areas_of_study || []).forEach((area) => add(area, "areas_of_study"));
    });

    Object.entries(concepts || {}).forEach(([key, terms]) => {
      (terms || []).forEach((term) => add(term, "concept:" + key));
    });

    Object.keys(CATEGORY_ALIASES).forEach((term) => add(term, "lexicon:category"));
    Object.keys(AUDIENCE_MULTI_CATEGORY_ALIASES).forEach((term) => add(term, "lexicon:audience_category"));
    Object.keys(AUDIENCE_PROGRAM_ALIASES).forEach((term) => add(term, "lexicon:audience_program"));
    Object.keys(TOPIC_ALIASES).forEach((term) => add(term, "lexicon:topic"));
    Object.values(QUERY_ALIASES).forEach((term) => add(term, "lexicon:query_alias_canonical"));

    return out;
  }

  function buildCompoundIndex(programs, concepts) {
    const cached = compoundIndexCache.get(programs);
    if (cached && cached.concepts === concepts) return cached.index;

    const phrases = collectCompoundPhrases(programs, concepts);
    const singles = new Set();
    const candidates = new Map();

    phrases.forEach(({ phrase, source }) => {
      const tokens = phrase.split(" ").filter(Boolean);
      const meaningful = tokens.filter((w) => w.length >= 2 && !STOPWORDS.has(w));

      if (tokens.length === 1) {
        singles.add(tokens[0]);
        return;
      }

      if (meaningful.length < 2) return;

      const joined = tokens.join("");
      if (joined.length < 6) return;

      if (!candidates.has(joined)) candidates.set(joined, new Map());
      const owners = candidates.get(joined);
      if (!owners.has(phrase)) owners.set(phrase, new Set());
      owners.get(phrase).add(source);
    });

    const index = new Map();

    candidates.forEach((owners, joined) => {
      if (singles.has(joined)) return;
      if (owners.size !== 1) return;

      const [canonical, sources] = owners.entries().next().value;
      index.set(joined, {
        canonical,
        sources: Array.from(sources).sort()
      });
    });

    compoundIndexCache.set(programs, { concepts, index });
    return index;
  }

  function resolveConcatenatedQuery(programs, concepts, query) {
    const base = foldGreek(normalize(query));
    if (!base) return null;

    const index = buildCompoundIndex(programs, concepts);
    const tokens = base.split(" ").filter(Boolean);
    const resolved = [];
    let changed = false;

    tokens.forEach((token) => {
      const hit = index.get(token);
      if (!hit) {
        resolved.push(token);
        return;
      }
      resolved.push(...hit.canonical.split(" "));
      changed = true;
    });

    return changed ? resolved.join(" ") : null;
  }

  function resolveCuratedTokenAliases(query) {
    const base = foldGreek(normalize(query));
    if (!base) return null;

    const tokens = base.split(" ").filter(Boolean);
    const resolved = [];
    let changed = false;

    tokens.forEach((token) => {
      const target = TOKEN_ALIASES[token];

      if (!target) {
        resolved.push(token);
        return;
      }

      const canonical = foldGreek(normalize(target));

      if (!canonical) {
        resolved.push(token);
        return;
      }

      resolved.push(...canonical.split(" ").filter(Boolean));
      changed = true;
    });

    return changed ? resolved.join(" ") : null;
  }

  // A query is checked in both its normal form AND (if it looks like Latin-script Greek)
  // a transliterated-to-Greek form. Both variants get folded, so "psixologia" and
  // "ψυχολογία" converge to the same canonical string ("ψιχολογια").
  function queryVariants(q) {
    const variants = new Set();
    const base = foldGreek(normalize(q));
    if (base) variants.add(base);

    // Exact curated alias equivalence, e.g. "λεγαλ" -> "legal".
    // Add the canonical spelling as another raw variant so filtering, intent
    // resolution and scoring all see the same semantic query.
    const aliasTarget = QUERY_ALIASES[base];
    if (aliasTarget) {
      const aliasBase = foldGreek(normalize(aliasTarget));
      if (aliasBase) variants.add(aliasBase);

      const aliasLower = String(aliasTarget).toLowerCase();
      if (
        isLikelyGreeklish(aliasLower) &&
        aliasBase.replace(/\s+/g, "").length >= MIN_GREEKLISH_LETTERS
      ) {
        const aliasTranslit = foldGreek(normalize(transliterateGreeklish(aliasLower)));
        if (aliasTranslit) variants.add(aliasTranslit);

        if (/a[fv]|e[fv]/.test(aliasLower)) {
          const aliasTranslit2 = foldGreek(normalize(transliterateGreeklishAuEu(aliasLower)));
          if (aliasTranslit2) variants.add(aliasTranslit2);
        }
      }
    }

    // Controlled acronym equivalence at the query-normalization layer. This is
    // not a score boost: it simply gives English ADHD and Greek ΔΕΠΥ the same
    // raw-query representations, allowing the existing title/category/concept
    // scoring rules to rank an exact ΔΕΠ-Υ title naturally.
    const depy = foldGreek(normalize("ΔΕΠΥ"));
    if (base.split(" ").includes("adhd")) variants.add(base.split(" ").map((w) => w === "adhd" ? depy : w).join(" "));
    if (base.split(" ").includes(depy)) variants.add(base.split(" ").map((w) => w === depy ? "adhd" : w).join(" "));

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
    const phraseIntent = resolvePhraseIntent(q);

    // A registered phrase intent is one semantic unit. Its constituent words
    // must not leak into scoring as unrelated independent relevance terms.
    // The curated terms remain explicit and governed by lexicon.json.
    if (phraseIntent) {
      const termsFlat = Array.from(new Set(phraseIntent.terms));
      const byWord = {};
      const phraseKey = phraseIntent.phrases[0];

      byWord[phraseKey] = termsFlat.slice();

      return { termsFlat, byWord };
    }

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

  let indexCache = new WeakMap(); // replaced by setLexicon()
  function getIndex(programs) {
    let idx = indexCache.get(programs);
    if (!idx) {
      const provenanceConcepts = new Set();
      programs.forEach((p) => {
        const map = p && p.concept_assignment_status;
        if (map && typeof map === "object") Object.keys(map).forEach((k) => provenanceConcepts.add(k));
      });
      idx = { entries: programs.map(buildEntry), vocab: buildVocabulary(programs), provenanceConcepts, rankCache: new Map(), rankCacheConcepts: null };
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

  function collisionExclusionsFor(query, expandedTerms) {
    const out = new Set();

    const addFor = (value) => {
      const key = foldGreek(normalize(String(value || "")));
      const blocked = COLLISION_EXCLUSIONS[key];
      if (blocked && blocked.length) blocked.forEach((tok) => out.add(tok));
    };

    addFor(query);
    (expandedTerms || []).forEach(addFor);

    return out.size ? out : null;
  }

  function rawContainsSafe(text, tokenSet, raw, blockedTokens) {
    if (!blockedTokens || !blockedTokens.size || raw.includes(" ")) {
      return rawContains(text, tokenSet, raw);
    }

    if (raw.length <= SHORT_RAW_MAX) {
      for (const tok of tokenSet) {
        if (blockedTokens.has(tok)) continue;
        if (tok.startsWith(raw)) return true;
      }
      return false;
    }

    for (const tok of tokenSet) {
      if (blockedTokens.has(tok)) continue;

      if (tok === raw) return true;

      if (tok.startsWith(raw)) {
        const ratio = raw.length / tok.length;
        if (ratio >= MIN_TERM_TOKEN_OVERLAP) return true;
      }
    }
    return false;
  }

  function containsTermSafe(textAll, tokenSet, term, blockedTokens) {
    if (!blockedTokens || !blockedTokens.size || term.includes(" ")) {
      return containsTerm(textAll, tokenSet, term);
    }

    if (term.length <= 3) {
      return tokenSet.has(term) && !blockedTokens.has(term);
    }

    for (const tok of tokenSet) {
      if (blockedTokens.has(tok)) continue;
      if (tok.includes(term) && term.length / tok.length >= MIN_TERM_TOKEN_OVERLAP) return true;
    }
    return false;
  }

  function scoreEntry(e, variants, terms, byWord, blockedTokens) {
    let s = 0;
    variants.forEach((raw) => {
      if (e.title === raw) s += 200;
      if (rawContainsSafe(e.title, e.titleTok, raw, blockedTokens)) s += 100;
      if (rawContainsSafe(e.tags, e.tagsTok, raw, blockedTokens)) s += 90;
      if (rawContainsSafe(e.primaryArea, e.primaryAreaTok, raw, blockedTokens)) s += 45; // official primary category - strong signal
      else if (rawContainsSafe(e.area, e.areaTok, raw, blockedTokens)) s += 15; // only among secondary categories - weaker signal
      if (rawContainsSafe(e.all, e.allTok, raw, blockedTokens)) s += 25;
    });
    terms.forEach((t) => {
      if (containsTermSafe(e.title, e.titleTok, t, blockedTokens)) s += 18;
      if (containsTermSafe(e.tags, e.tagsTok, t, blockedTokens)) s += 15;
      if (containsTermSafe(e.primaryArea, e.primaryAreaTok, t, blockedTokens)) s += 8;
      else if (containsTermSafe(e.area, e.areaTok, t, blockedTokens)) s += 3;
      if (containsTermSafe(e.all, e.allTok, t, blockedTokens)) s += 3;
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
            containsTermSafe(e.title, e.titleTok, t, blockedTokens) ||
            containsTermSafe(e.tags, e.tagsTok, t, blockedTokens) ||
            containsTermSafe(e.primaryArea, e.primaryAreaTok, t, blockedTokens) ||
            containsTermSafe(e.area, e.areaTok, t, blockedTokens)
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
    const blockedTokens = collisionExclusionsFor(q, terms);
    return scoreEntry(buildEntry(p), queryVariants(q), terms, byWord, blockedTokens);
  }

  // ==========================================================================
  // Checkpoint A: official category intent.
  //
  // Goal: when a query is CLEARLY asking for an official EKPA category/direction
  // ("marketing", "\u03c0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1 \u03bd\u03b1\u03c5\u03c4\u03b9\u03bb\u03af\u03b1\u03c2", "\u03b8\u03ad\u03b1\u03c4\u03c1\u03bf"), return every program that
  // officially belongs there (program.primary_area / program.areas_of_study),
  // not merely whichever programs happen to already score > 0 for that query
  // via title/tags/description substring hits. Deliberately conservative: it
  // only ever narrows to category-only results when EVERY meaningful word in
  // the query is accounted for by exactly one resolved category - a leftover
  // word the category can't explain ("marketing ksenodoxeion", "AI gia
  // giatrous") falls straight back to the normal scoring engine below,
  // unchanged. Category membership itself is decided ONLY from primary_area/
  // areas_of_study, per spec - never from description/tags/concepts.
  // ==========================================================================

  // A handful of common query words that don't literally appear inside the
  // official category string they mean, so no amount of folding/prefix-matching
  // resolves them generically. Each entry was verified against the REAL
  // programs.json to resolve to exactly one official category before being
  // added here (see the Checkpoint A report for how each was checked; reject
  // anything that turns out ambiguous or unsupported instead of guessing).
  // Keys are ALREADY folded (foldGreek(normalize(word))) - see the comment on
  // STOPWORDS above for why: matching happens against folded query tokens.
  const CATEGORY_ALIASES = {
    "\u03bc\u03b1\u03c1\u03ba\u03b5\u03c4\u03b9\u03bd\u03b3\u03ba": "Marketing \u03ba\u03b1\u03b9 \u03a0\u03c9\u03bb\u03ae\u03c3\u03b5\u03b9\u03c2", // greeklish/Greek transliteration of the English category word
    "\u03c4\u03bf\u03b9\u03c1\u03b9\u03c3\u03bc\u03bf\u03c2": "\u03a4\u03bf\u03c5\u03c1\u03b9\u03c3\u03c4\u03b9\u03ba\u03ac", // "\u03c4\u03bf\u03c5\u03c1\u03b9\u03c3\u03bc\u03cc\u03c2" (noun) vs official "\u03a4\u03bf\u03c5\u03c1\u03b9\u03c3\u03c4\u03b9\u03ba\u03ac" (adjective) - different suffix, same root
    "\u03bc\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03b9\u03c3\u03b9\u03c2": "\u039c\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03bf\u03cd\u03bc\u03b5\u03bd\u03b1 \u03a0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1 \u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ce\u03bd & \u0395\u03b9\u03b4\u03b9\u03ba\u03ae\u03c2 \u0391\u03b3\u03c9\u03b3\u03ae\u03c2", // "\u03bc\u03bf\u03c1\u03b9\u03bf\u03b4\u03cc\u03c4\u03b7\u03c3\u03b7\u03c2"
    "\u03bc\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03b9\u03c3\u03b9": "\u039c\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03bf\u03cd\u03bc\u03b5\u03bd\u03b1 \u03a0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1 \u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ce\u03bd & \u0395\u03b9\u03b4\u03b9\u03ba\u03ae\u03c2 \u0391\u03b3\u03c9\u03b3\u03ae\u03c2", // "\u03bc\u03bf\u03c1\u03b9\u03bf\u03b4\u03cc\u03c4\u03b7\u03c3\u03b7"
      "\u03bd\u03b1\u03b9\u03c4\u03b9\u03ba\u03bf\u03c2": "\u039d\u03b1\u03c5\u03c4\u03b9\u03bb\u03b9\u03b1\u03ba\u03ac", // verified: \u03bd\u03b1\u03c5\u03c4\u03b9\u03ba\u03cc\u03c2 -> official Nautiliaka category (maritime industry, Checkpoint B audit)
    "\u03bd\u03b1\u03b9\u03c4\u03b9\u03ba\u03b9": "\u039d\u03b1\u03c5\u03c4\u03b9\u03bb\u03b9\u03b1\u03ba\u03ac", // verified: \u03bd\u03b1\u03c5\u03c4\u03b9\u03ba\u03bf\u03af -> official Nautiliaka category (maritime industry, Checkpoint B audit)
    "\u03bd\u03b1\u03b9\u03c4\u03b9\u03ba\u03bf\u03b9\u03c2": "\u039d\u03b1\u03c5\u03c4\u03b9\u03bb\u03b9\u03b1\u03ba\u03ac", // verified: \u03bd\u03b1\u03c5\u03c4\u03b9\u03ba\u03bf\u03cd\u03c2 -> official Nautiliaka category (maritime industry, Checkpoint B audit)
    "\u03bd\u03b1\u03b9\u03c4\u03b9\u03ba\u03bf\u03b9": "\u039d\u03b1\u03c5\u03c4\u03b9\u03bb\u03b9\u03b1\u03ba\u03ac", // verified: \u03bd\u03b1\u03c5\u03c4\u03b9\u03ba\u03bf\u03cd -> official Nautiliaka category (maritime industry, Checkpoint B audit)
    "\u03bd\u03b1\u03b9\u03c4\u03b9\u03ba\u03bf\u03bd": "\u039d\u03b1\u03c5\u03c4\u03b9\u03bb\u03b9\u03b1\u03ba\u03ac", // verified: \u03bd\u03b1\u03c5\u03c4\u03b9\u03ba\u03ce\u03bd -> official Nautiliaka category (maritime industry, Checkpoint B audit)
    "\u03b9\u03b8\u03bf\u03c0\u03b9\u03bf\u03c2": "\u039a\u03b9\u03bd\u03b7\u03bc\u03b1\u03c4\u03bf\u03b3\u03c1\u03ac\u03c6\u03bf\u03c2\u0020\u002d\u0020\u0398\u03ad\u03b1\u03c4\u03c1\u03bf", // verified: \u03b7\u03b8\u03bf\u03c0\u03bf\u03b9\u03cc\u03c2 -> official Kinimatografos-Theatro category (Checkpoint B audit)
    "\u03b9\u03b8\u03bf\u03c0\u03b9\u03b9": "\u039a\u03b9\u03bd\u03b7\u03bc\u03b1\u03c4\u03bf\u03b3\u03c1\u03ac\u03c6\u03bf\u03c2\u0020\u002d\u0020\u0398\u03ad\u03b1\u03c4\u03c1\u03bf", // verified: \u03b7\u03b8\u03bf\u03c0\u03bf\u03b9\u03bf\u03af -> official Kinimatografos-Theatro category (Checkpoint B audit)
    "\u03b9\u03b8\u03bf\u03c0\u03b9\u03bf\u03b9\u03c2": "\u039a\u03b9\u03bd\u03b7\u03bc\u03b1\u03c4\u03bf\u03b3\u03c1\u03ac\u03c6\u03bf\u03c2\u0020\u002d\u0020\u0398\u03ad\u03b1\u03c4\u03c1\u03bf", // verified: \u03b7\u03b8\u03bf\u03c0\u03bf\u03b9\u03bf\u03cd\u03c2 -> official Kinimatografos-Theatro category (Checkpoint B audit)
    "\u03b9\u03b8\u03bf\u03c0\u03b9\u03bf\u03b9": "\u039a\u03b9\u03bd\u03b7\u03bc\u03b1\u03c4\u03bf\u03b3\u03c1\u03ac\u03c6\u03bf\u03c2\u0020\u002d\u0020\u0398\u03ad\u03b1\u03c4\u03c1\u03bf", // verified: \u03b7\u03b8\u03bf\u03c0\u03bf\u03b9\u03bf\u03cd -> official Kinimatografos-Theatro category (Checkpoint B audit)
    "\u03b9\u03b8\u03bf\u03c0\u03b9\u03bf\u03bd": "\u039a\u03b9\u03bd\u03b7\u03bc\u03b1\u03c4\u03bf\u03b3\u03c1\u03ac\u03c6\u03bf\u03c2\u0020\u002d\u0020\u0398\u03ad\u03b1\u03c4\u03c1\u03bf", // verified: \u03b7\u03b8\u03bf\u03c0\u03bf\u03b9\u03ce\u03bd -> official Kinimatografos-Theatro category (Checkpoint B audit)
    "σινεμα": "Κινηματογράφος - Θέατρο", // A8 feedback: cinema synonym -> official category
  };
  // Latin-script acronyms embedded in an official category's ORIGINAL (pre-fold)
  // text, e.g. category "(AI)" suffix -> "ai". Extracted before normalize/fold
  // strips the parentheses, so short acronyms aren't lost to the length filter
  // below (which excludes short tokens elsewhere to avoid generic-word noise).
  function extractAcronyms(originalText) {
    const out = new Set();
    const re = /\b[A-Z]{2,6}\b/g;
    let m;
    while ((m = re.exec(String(originalText || "")))) out.add(m[0].toLowerCase());
    return out;
  }

  // Minimum shared-prefix length before two folded words are even considered
  // for the fuzzy category-word match below (same spirit as MIN_SHARED_PREFIX
  // for typo tolerance, kept separate since the safety requirements differ).
  const CATEGORY_FUZZY_MIN_PREFIX = 4;
  // How much of the longer/shorter word must be covered by that shared prefix
  // for a fuzzy category-word match (root+different suffix, e.g. official
  // "\u039d\u03b1\u03c5\u03c4\u03b9\u03bb\u03b9\u03b1\u03ba\u03ac" matching query "\u03bd\u03b1\u03c5\u03c4\u03b9\u03bb\u03af\u03b1") to count. Deliberately loose
  // per-word - safety against over-matching comes from resolveCategoryIntent()
  // requiring ALL query words to agree on exactly one category, not from this
  // ratio alone (verified against the real 63-category vocabulary: ambiguous
  // roots that recur across multiple official categories, e.g. "\u03b1\u03bd\u03ac\u03c0\u03c4\u03c5\u03be\u03b7"
  // or "\u03b5\u03c0\u03b1\u03b3\u03b3\u03b5\u03bb\u03bc\u03b1\u03c4\u03b9\u03ba\u03cc\u03c2", correctly produce 2+ candidate
  // categories for that one word, which resolveCategoryIntent then treats as
  // unresolved for that word rather than picking one).
  const CATEGORY_FUZZY_MIN_RATIO = 0.7;

  function commonPrefixLen(a, b) {
    let i = 0;
    const n = Math.min(a.length, b.length);
    while (i < n && a[i] === b[i]) i++;
    return i;
  }

  function buildCategoryIndex(programs) {
    const byFolded = new Map(); // foldedFullName -> { name, folded, tokens: Set, acronyms: Set }
    programs.forEach((p) => {
      const names = new Set([p.primary_area, ...(p.areas_of_study || [])].filter(Boolean));
      names.forEach((name) => {
        const folded = foldGreek(normalize(name));
        if (!byFolded.has(folded)) {
          const tokens = new Set(folded.split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t)));
          byFolded.set(folded, { name, folded, tokens, acronyms: extractAcronyms(name) });
        }
      });
    });
    const categories = Array.from(byFolded.values());
    // Validate the explicit alias targets actually exist in this dataset - an
    // alias pointing at a category that isn't (or is no longer) present must
    // never silently "match everything"; drop it instead.
    const aliasMap = new Map();
    Object.entries(CATEGORY_ALIASES).forEach(([foldedWord, targetName]) => {
      const targetFolded = foldGreek(normalize(targetName));
      if (byFolded.has(targetFolded)) aliasMap.set(foldedWord, byFolded.get(targetFolded).name);
    });
    return { categories, aliasMap };
  }

  let categoryIndexCache = new WeakMap(); // replaced by setLexicon()
  function getCategoryIndex(programs) {
    let ci = categoryIndexCache.get(programs);
    if (!ci) { ci = buildCategoryIndex(programs); categoryIndexCache.set(programs, ci); }
    return ci;
  }

  // Which official categories (by name) a single folded, non-stopword query
  // word resolves to. Empty = the word isn't a recognized category reference
  // at all (a real topical word, a typo, or simply not part of the taxonomy).
  function categoriesForWord(word, categoryIndex) {
    const hits = new Set();
    if (categoryIndex.aliasMap.has(word)) hits.add(categoryIndex.aliasMap.get(word));
    categoryIndex.categories.forEach((cat) => {
      if (hits.has(cat.name)) return;
      if (cat.tokens.has(word) || cat.acronyms.has(word)) { hits.add(cat.name); return; }
      if (word.length < CATEGORY_FUZZY_MIN_PREFIX) return;
      for (const tok of cat.tokens) {
        if (tok.length < CATEGORY_FUZZY_MIN_PREFIX) continue;
        const cp = commonPrefixLen(word, tok);
        if (cp < CATEGORY_FUZZY_MIN_PREFIX) continue;
        if (Math.max(cp / tok.length, cp / word.length) >= CATEGORY_FUZZY_MIN_RATIO) { hits.add(cat.name); break; }
      }
    });
    return hits;
  }

  // Resolves a query to exactly one official category, or null. Conservative
  // by construction: every meaningful (non-stopword) word in the query must
  // point to the SAME single category - a word that resolves to nothing, or to
  // a different category than the rest, makes the whole query unresolved
  // (falls back to normal semantic search, never guesses).
  function resolveCategoryIntent(programs, query) {
    const categoryIndex = getCategoryIndex(programs);
    if (!categoryIndex.categories.length) return null;

    // Exact full-category names are authoritative even when their individual
    // words are shared with broader/nested official category names.
    const exact = foldGreek(normalize(query));
    const exactCategory = categoryIndex.categories.find((cat) => cat.folded === exact);
    if (exactCategory) return exactCategory.name;
    for (const variant of queryVariants(query)) {
      const words = variant.split(" ").filter((w) => w.length >= 2 && !STOPWORDS.has(w));
      if (!words.length) continue;
      let intersection = null;
      let anyUnresolved = false;
      for (const w of words) {
        const hits = categoriesForWord(w, categoryIndex);
        if (!hits.size) { anyUnresolved = true; break; }
        intersection = intersection === null ? hits : new Set([...intersection].filter((c) => hits.has(c)));
        if (!intersection.size) { anyUnresolved = true; break; }
      }
      if (!anyUnresolved && intersection && intersection.size === 1) {
        return Array.from(intersection)[0];
      }
    }
    return null;
  }

  // --- Checkpoint B: audience/profession words that are confidently relevant
  // to MULTIPLE official categories at once, verified against the real
  // dataset (see the Checkpoint B report for the audit). Unlike
  // CATEGORY_ALIASES above (one word -> one category), each entry here maps
  // one word -> an array of official category names. Deliberately its own,
  // narrow mechanism rather than a generalization of CATEGORY_ALIASES/
  // categoriesForWord: it is consulted ONLY when a query reduces to exactly
  // one meaningful (non-stopword) word, so it can never combine with a
  // second word's own candidates the way the general fuzzy/token matching in
  // categoriesForWord does - which is what keeps compound queries like
  // "AI για γιατρούς" / "marketing ξενοδοχείων" safe (see negative tests).
  //
  // δάσκαλος/δασκάλα/δάσκαλοι/δασκάλες/δασκάλους/δασκάλου and εκπαιδευτικός/... have ZERO literal
  // overlap with either category name (confirmed in the audit: 0 category-name
  // token matches for either word), so a plain alias-to-string entry in
  // CATEGORY_ALIASES would only ever pick one target and arbitrarily ignore
  // the other equally-real one. Both targets are real, disjoint, and each
  // independently plausible for a teacher/educator audience:
  //   - "Παιδαγωγικά" (71 members): pedagogy/teaching-methods programs.
  //   - "Μοριοδοτούμενα Προγράμματα Παιδαγωγικών & Ειδικής Αγωγής" (52 members):
  //     programs that carry official teacher-hiring/promotion credit points
  //     ("μοριοδότηση") in the Greek public-education system - i.e. exactly
  //     the kind of program a working teacher searches for.
  // Deliberately EXCLUDES neuter/adjectival forms ("εκπαιδευτικό", "εκπαιδευτικά",
  // "εκπαιδευτικές") since those are overwhelmingly used as an ADJECTIVE
  // ("εκπαιδευτικό λογισμικό", "εκπαιδευτικές δραστηριότητες") rather than the
  // noun "a teacher/educator" - including them here would risk this mechanism
  // firing on a bare adjective with no noun, which is not how the audience/
  // profession intent this checkpoint targets actually gets typed.
  const AUDIENCE_MULTI_CATEGORY_ALIASES = {
    "\u03b4\u03b1\u03c3\u03ba\u03b1\u03bb\u03bf\u03c2": ["\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ac", "\u039c\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03bf\u03cd\u03bc\u03b5\u03bd\u03b1\u0020\u03a0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1\u0020\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ce\u03bd\u0020\u0026\u0020\u0395\u03b9\u03b4\u03b9\u03ba\u03ae\u03c2\u0020\u0391\u03b3\u03c9\u03b3\u03ae\u03c2"], // verified: \u03b4\u03ac\u03c3\u03ba\u03b1\u03bb\u03bf\u03c2 -> Paidagogika + Moriodotoumena (Checkpoint B audit)
    "\u03b4\u03b1\u03c3\u03ba\u03b1\u03bb\u03b1": ["\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ac", "\u039c\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03bf\u03cd\u03bc\u03b5\u03bd\u03b1\u0020\u03a0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1\u0020\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ce\u03bd\u0020\u0026\u0020\u0395\u03b9\u03b4\u03b9\u03ba\u03ae\u03c2\u0020\u0391\u03b3\u03c9\u03b3\u03ae\u03c2"], // verified: \u03b4\u03b1\u03c3\u03ba\u03ac\u03bb\u03b1 -> Paidagogika + Moriodotoumena (Checkpoint B audit)
    "\u03b4\u03b1\u03c3\u03ba\u03b1\u03bb\u03b9": ["\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ac", "\u039c\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03bf\u03cd\u03bc\u03b5\u03bd\u03b1\u0020\u03a0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1\u0020\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ce\u03bd\u0020\u0026\u0020\u0395\u03b9\u03b4\u03b9\u03ba\u03ae\u03c2\u0020\u0391\u03b3\u03c9\u03b3\u03ae\u03c2"], // verified: \u03b4\u03ac\u03c3\u03ba\u03b1\u03bb\u03bf\u03b9 -> Paidagogika + Moriodotoumena (Checkpoint B audit)
    "\u03b4\u03b1\u03c3\u03ba\u03b1\u03bb\u03b5\u03c2": ["\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ac", "\u039c\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03bf\u03cd\u03bc\u03b5\u03bd\u03b1\u0020\u03a0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1\u0020\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ce\u03bd\u0020\u0026\u0020\u0395\u03b9\u03b4\u03b9\u03ba\u03ae\u03c2\u0020\u0391\u03b3\u03c9\u03b3\u03ae\u03c2"], // verified: \u03b4\u03b1\u03c3\u03ba\u03ac\u03bb\u03b5\u03c2 -> Paidagogika + Moriodotoumena (Checkpoint B audit)
    "\u03b4\u03b1\u03c3\u03ba\u03b1\u03bb\u03bf\u03b9\u03c2": ["\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ac", "\u039c\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03bf\u03cd\u03bc\u03b5\u03bd\u03b1\u0020\u03a0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1\u0020\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ce\u03bd\u0020\u0026\u0020\u0395\u03b9\u03b4\u03b9\u03ba\u03ae\u03c2\u0020\u0391\u03b3\u03c9\u03b3\u03ae\u03c2"], // verified: \u03b4\u03b1\u03c3\u03ba\u03ac\u03bb\u03bf\u03c5\u03c2 -> Paidagogika + Moriodotoumena (Checkpoint B audit)
    "\u03b4\u03b1\u03c3\u03ba\u03b1\u03bb\u03bf\u03b9": ["\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ac", "\u039c\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03bf\u03cd\u03bc\u03b5\u03bd\u03b1\u0020\u03a0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1\u0020\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ce\u03bd\u0020\u0026\u0020\u0395\u03b9\u03b4\u03b9\u03ba\u03ae\u03c2\u0020\u0391\u03b3\u03c9\u03b3\u03ae\u03c2"], // verified: \u03b4\u03b1\u03c3\u03ba\u03ac\u03bb\u03bf\u03c5 -> Paidagogika + Moriodotoumena (Checkpoint B audit)
    "\u03b5\u03ba\u03c0\u03b1\u03b9\u03b4\u03b5\u03b9\u03c4\u03b9\u03ba\u03bf\u03c2": ["\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ac", "\u039c\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03bf\u03cd\u03bc\u03b5\u03bd\u03b1\u0020\u03a0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1\u0020\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ce\u03bd\u0020\u0026\u0020\u0395\u03b9\u03b4\u03b9\u03ba\u03ae\u03c2\u0020\u0391\u03b3\u03c9\u03b3\u03ae\u03c2"], // verified: \u03b5\u03ba\u03c0\u03b1\u03b9\u03b4\u03b5\u03c5\u03c4\u03b9\u03ba\u03cc\u03c2 -> Paidagogika + Moriodotoumena (Checkpoint B audit)
    "\u03b5\u03ba\u03c0\u03b1\u03b9\u03b4\u03b5\u03b9\u03c4\u03b9\u03ba\u03bf\u03b9": ["\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ac", "\u039c\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03bf\u03cd\u03bc\u03b5\u03bd\u03b1\u0020\u03a0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1\u0020\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ce\u03bd\u0020\u0026\u0020\u0395\u03b9\u03b4\u03b9\u03ba\u03ae\u03c2\u0020\u0391\u03b3\u03c9\u03b3\u03ae\u03c2"], // verified: \u03b5\u03ba\u03c0\u03b1\u03b9\u03b4\u03b5\u03c5\u03c4\u03b9\u03ba\u03bf\u03cd -> Paidagogika + Moriodotoumena (Checkpoint B audit)
    "\u03b5\u03ba\u03c0\u03b1\u03b9\u03b4\u03b5\u03b9\u03c4\u03b9\u03ba\u03b9": ["\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ac", "\u039c\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03bf\u03cd\u03bc\u03b5\u03bd\u03b1\u0020\u03a0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1\u0020\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ce\u03bd\u0020\u0026\u0020\u0395\u03b9\u03b4\u03b9\u03ba\u03ae\u03c2\u0020\u0391\u03b3\u03c9\u03b3\u03ae\u03c2"], // verified: \u03b5\u03ba\u03c0\u03b1\u03b9\u03b4\u03b5\u03c5\u03c4\u03b9\u03ba\u03bf\u03af -> Paidagogika + Moriodotoumena (Checkpoint B audit)
    "\u03b5\u03ba\u03c0\u03b1\u03b9\u03b4\u03b5\u03b9\u03c4\u03b9\u03ba\u03bf\u03b9\u03c2": ["\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ac", "\u039c\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03bf\u03cd\u03bc\u03b5\u03bd\u03b1\u0020\u03a0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1\u0020\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ce\u03bd\u0020\u0026\u0020\u0395\u03b9\u03b4\u03b9\u03ba\u03ae\u03c2\u0020\u0391\u03b3\u03c9\u03b3\u03ae\u03c2"], // verified: \u03b5\u03ba\u03c0\u03b1\u03b9\u03b4\u03b5\u03c5\u03c4\u03b9\u03ba\u03bf\u03cd\u03c2 -> Paidagogika + Moriodotoumena (Checkpoint B audit)
    "\u03b5\u03ba\u03c0\u03b1\u03b9\u03b4\u03b5\u03b9\u03c4\u03b9\u03ba\u03bf\u03bd": ["\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ac", "\u039c\u03bf\u03c1\u03b9\u03bf\u03b4\u03bf\u03c4\u03bf\u03cd\u03bc\u03b5\u03bd\u03b1\u0020\u03a0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1\u0020\u03a0\u03b1\u03b9\u03b4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03ce\u03bd\u0020\u0026\u0020\u0395\u03b9\u03b4\u03b9\u03ba\u03ae\u03c2\u0020\u0391\u03b3\u03c9\u03b3\u03ae\u03c2"], // verified: \u03b5\u03ba\u03c0\u03b1\u03b9\u03b4\u03b5\u03c5\u03c4\u03b9\u03ba\u03ce\u03bd -> Paidagogika + Moriodotoumena (Checkpoint B audit)
  };

  function resolveAudienceMultiCategoryIntent(programs, query) {
    const categoryIndex = getCategoryIndex(programs);
    if (!categoryIndex.categories.length) return null;
    const validNames = new Set(categoryIndex.categories.map((c) => c.name));
    for (const variant of queryVariants(query)) {
      const words = variant.split(" ").filter((w) => w.length >= 2 && !STOPWORDS.has(w));
      // Only ever consult this table when the query reduces to exactly one
      // meaningful word - see the comment on AUDIENCE_MULTI_CATEGORY_ALIASES.
      if (words.length !== 1) continue;
      const targets = AUDIENCE_MULTI_CATEGORY_ALIASES[words[0]];
      if (!targets) continue;
      const resolved = targets.filter((name) => validNames.has(name));
      if (resolved.length > 1) return resolved;
      if (resolved.length === 1) return resolved[0];
    }
    return null;
  }


  function programBelongsToCategory(program, categoryName) {
    if (!program || !categoryName) return false;
    if (program.primary_area === categoryName) return true;
    return Array.isArray(program.areas_of_study) && program.areas_of_study.includes(categoryName);
  }


  // --- law-v2 prototype: evidence-gated concept intent --------------------
  // This gate is dormant for concepts that have no provenance decisions in
  // the current program array. That keeps all legacy concepts backward-
  // compatible until they have been audited.
  function conceptAssignmentStatus(program, conceptKey) {
    const map = program && program.concept_assignment_status;
    const item = map && map[conceptKey];
    return item && item.status ? String(item.status).toUpperCase() : null;
  }

  function hasConceptProvenance(idx, conceptKey) {
    return !!(idx && idx.provenanceConcepts && idx.provenanceConcepts.has(conceptKey));
  }

  function conceptForCategoryName(concepts, categoryName, provenanceConcepts) {
    if (!concepts || !categoryName || !provenanceConcepts || !provenanceConcepts.size) return null;
    const cat = foldGreek(normalize(categoryName));
    const catTokens = new Set(cat.split(" ").filter(Boolean));
    const matches = [];
    provenanceConcepts.forEach((key) => {
      const terms = (concepts[key] || []).map((t) => foldGreek(normalize(t)));
      if (terms.some((t) => phraseMatches(t, cat, catTokens))) matches.push(key);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function resolveSingleConceptIntent(programs, concepts, query, categoryNames, idx) {
    if (typeof categoryNames === "string") {
      const byCategory = conceptForCategoryName(concepts, categoryNames, idx.provenanceConcepts);
      if (byCategory && hasConceptProvenance(idx, byCategory)) return byCategory;
    }

    const meaningful = queryVariants(query)
      .map((v) => v.split(" ").filter((w) => w.length >= 2 && !STOPWORDS.has(w)))
      .filter((words) => words.length === 1);
    if (!meaningful.length) return null;

    // First, resolve an exact single-token query directly against audited
    // concept terms. This is critical for Greek variants such as `δίκαιο`:
    // the query itself is an exact law term, but expansion may overlap with
    // only one of the concept's first terms and therefore miss the old >=2
    // overlap threshold.
    const directTokens = new Set(
      meaningful.flatMap((words) => words.map((w) => foldGreek(normalize(w))))
    );
    const directCandidates = [];
    (idx.provenanceConcepts || new Set()).forEach((key) => {
      const terms = (concepts[key] || []).map((t) => foldGreek(normalize(t)));
      if (terms.some((t) => directTokens.has(t))) directCandidates.push(key);
    });
    if (directCandidates.length === 1) return directCandidates[0];

    const expanded = expandQueryDetailed(query, concepts, idx.vocab).termsFlat;
    const expandedSet = new Set(expanded);
    const candidates = [];
    (idx.provenanceConcepts || new Set()).forEach((key) => {
      const first = (concepts[key] || []).slice(0, 6).map((t) => foldGreek(normalize(t)));
      const overlap = first.filter((t) => expandedSet.has(t)).length;
      if (overlap >= 2) candidates.push(key);
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  function trustedCmsTags(program) {
    const out = new Set();
    (program.tags_cms || []).forEach((t) => {
      const n = foldGreek(normalize(t));
      if (n) out.add(n);
    });
    return foldGreek(normalize(Array.from(out).join(" ")));
  }

  function hasDirectCoreEvidence(program, e, concepts, conceptKey, variants) {
    // For an explicitly REJECTed broad concept assignment, do not let
    // generated tags inherited from OTHER concepts rescue the record.
    //
    // Example: criminology legitimately generates `ποινικο δικαιο`, but that
    // must not re-qualify a program for the broad `δίκαιο` / `law` intent after
    // its law assignment has been explicitly rejected.
    //
    // CURATED / CONFIRMED / REVIEW records are already accepted before this
    // function is called, so legitimate interdisciplinary law programs remain
    // unaffected. A REJECT record can only survive through explicit core
    // evidence authored in title, primary taxonomy, or CMS tags.
    const cmsTags = trustedCmsTags(program);
    const cmsTagTok = new Set(cmsTags.split(" ").filter(Boolean));
    return variants.some((raw) =>
      containsTerm(e.title, e.titleTok, raw) ||
      containsTerm(e.primaryArea, e.primaryAreaTok, raw) ||
      containsTerm(cmsTags, cmsTagTok, raw)
    );
  }

  function primaryAreaSupportsConcept(program, concepts, conceptKey) {
    const primary = foldGreek(normalize(program && program.primary_area));
    if (!primary) return false;
    const tokens = new Set(primary.split(" "));
    return (concepts[conceptKey] || [])
      .map((t) => foldGreek(normalize(t)))
      .some((t) => phraseMatches(t, primary, tokens));
  }

  function eligibleForConceptIntent(program, entry, concepts, conceptKey, variants) {
    if (!conceptKey) return true;
    const status = conceptAssignmentStatus(program, conceptKey);
    if (status === "CONFIRMED" || status === "CURATED" || status === "REVIEW") return true;
    if (status === "REJECT") {
      // A rejected concept cannot qualify the record through expansion,
      // secondary taxonomy, generated tags from that rejected concept, or
      // audience-only description. Only explicit direct evidence from
      // title/primary/CMS tags may still qualify the rejected assignment.
      return hasDirectCoreEvidence(program, entry, concepts, conceptKey, variants);
    }
    // Legacy/unaudited records are intentionally backward-compatible. Evidence
    // gating only activates after an explicit provenance decision exists.
    return true;
  }

  // --- Checkpoint B, Type B: "audience/profession -> controlled topic set".
  // For a real-world topic that has NO official category in primary_area/
  // areas_of_study at all (verified in the audit - "chef"/"σεφ"/"μαγειρική"
  // have zero category matches), inventing a fake category would violate the
  // task's explicit constraint. Instead this maps the word directly to an
  // explicit, small, hand-verified list of real program slugs - never a
  // category name, and never combined with the category machinery above.
  //
  // "chef" (English) / "σεφ" (Greek transliteration) and "μαγειρική" (the Greek
  // noun for "cooking") are three names for the exact same real-world topic;
  // the catalog has exactly 2 real programs about it. "μαγειρική" already finds
  // both via ordinary title matching (verified in the audit: score 146 each),
  // but "chef"/"σεφ" match nothing today despite meaning the same thing - this
  // set makes all three resolve to the identical, verified pair of slugs.
  // --- Checkpoint D.1: profession/audience intent backed by a controlled
  // program set when no single official taxonomy category represents the
  // profession.  "Philologist" is intentionally NOT mapped to all Pedagogy:
  // the audited catalog shows a narrower subject cluster (Greek language/texts,
  // literature and history) and the live partial query "φιλολο" already
  // surfaces the strongest members of that cluster.
  // Checkpoint D.1 Revision — Dynamic Audience Eligibility.
  // Keep the audited thematic seed set, but augment it dynamically with programs
  // whose own description explicitly declares philology graduates/philologists as
  // target audience. This is deliberately anchored to audience-introduction wording
  // ("απευθύνεται σε" / "απευθύνεται") so incidental mentions such as an academic
  // coordinator's Department of Philology do not qualify a program by themselves.
  const AUDIENCE_PROGRAM_SETS = {
    philologist: [
      "arxaia-ellhnika-gia-arxarious",
      "didaktiki-neoellinikon-keimenon",
      "methodologia-kai-didaktiki-tis-hstorias",
      "oi-piges-tou-hstorikou-ereunontas-tin-elliniki-hstoria-tou-20ou-aiona",
      "neoteri-kai-sugxroni-elliniki-hstoria-1821-2021-tomes-kai-gegonota",
      "anagnosi-filanagnosia-kai-paidiki-logotexnia",
      "h-epidimia-os-thema-kai-os-metafora-sti-logotexnia",
    ],
  };
  const AUDIENCE_PROGRAM_ALIASES = {
    "φιλολογος": "philologist",
    "φιλολογο": "philologist",
    "φιλολογοι": "philologist",
    "φιλολογι": "philologist",
    "φιλολογοις": "philologist",
  };

  // Programs of an audience group that are NOT in its hand-picked list but whose description
  // explicitly names the audience after "απευθύνεται" (e.g. philologists). The words to look
  // for come from the lexicon (audience_programs[].scan_terms); a group without scan_terms
  // has no such rule. Terms are matched as whole words on normalize()d text.
  const AUDIENCE_SCAN_MARKER = "απευθυνεται";
  const AUDIENCE_SCAN_SPAN = 900; // bounded span after each marker (audience lists can be long)
  const AUDIENCE_SCAN_DEFAULT_TERMS = {
    philologist: ["φιλολογ", "φιλολογος", "φιλολογοι", "φιλολογους", "φιλολογου", "φιλολογιας", "φιλολογιων", "φιλολογιες", "φιλολογικων"],
  };
  const AUDIENCE_SCAN_REGEX = {}; // audience id -> RegExp (kept in sync by setLexicon)
  function buildScanRegex(terms) {
    const alts = Array.from(new Set(terms.map((t) => normalize(t)).filter(Boolean)))
      .sort((a, b) => b.length - a.length)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return alts.length ? new RegExp("(?<!\\p{L})(?:" + alts.join("|") + ")(?!\\p{L})", "u") : null;
  }
  Object.keys(AUDIENCE_SCAN_DEFAULT_TERMS).forEach((id) => { AUDIENCE_SCAN_REGEX[id] = buildScanRegex(AUDIENCE_SCAN_DEFAULT_TERMS[id]); });

  function explicitlyTargetsAudience(p, audience) {
    const re = AUDIENCE_SCAN_REGEX[audience];
    if (!re) return false;
    const text = normalize([p.description_for_matching, p.description_full].filter(Boolean).join(" "));
    if (!text) return false;
    let from = 0;
    while (true) {
      const i = text.indexOf(AUDIENCE_SCAN_MARKER, from);
      if (i < 0) break;
      if (re.test(text.slice(i, i + AUDIENCE_SCAN_SPAN))) return true;
      from = i + AUDIENCE_SCAN_MARKER.length;
    }
    return false;
  }
  function explicitlyTargetsPhilologists(p) { return explicitlyTargetsAudience(p, "philologist"); }

  function audienceProgramSlugs(programs, audience) {
    const seed = AUDIENCE_PROGRAM_SETS[audience] || [];
    const out = [];
    const seen = new Set();
    seed.forEach((slug) => {
      if (!seen.has(slug) && programs.some((p) => p.slug === slug)) { seen.add(slug); out.push(slug); }
    });
    if (AUDIENCE_SCAN_REGEX[audience]) {
      programs.forEach((p) => {
        if (p.slug && !seen.has(p.slug) && explicitlyTargetsAudience(p, audience)) {
          seen.add(p.slug); out.push(p.slug);
        }
      });
    }
    return out;
  }

  // { audience, slugs } for a single-word audience query, or null.
  function resolveAudienceProgramIntentDetailed(programs, query) {
    for (const variant of queryVariants(query)) {
      const words = variant.split(" ").filter((w) => w.length >= 2 && !STOPWORDS.has(w));
      if (words.length !== 1) continue;
      const audience = AUDIENCE_PROGRAM_ALIASES[words[0]];
      if (!audience || !AUDIENCE_PROGRAM_SETS[audience]) continue;
      return { audience, slugs: audienceProgramSlugs(programs, audience) };
    }
    return null;
  }
  function resolveAudienceProgramIntent(programs, query) {
    const r = resolveAudienceProgramIntentDetailed(programs, query);
    return r ? r.slugs : null;
  }

  const TOPIC_SETS = {
    cooking: [
      "epaggelmatikh-mageirikh-sugxronh-kouzina", // Επαγγελματική Μαγειρική και Σύγχρονη Κουζίνα
      "epaggelmatikh-mageirikh-ellhnikh-kouzina", // Επαγγελματική Μαγειρική και Ελληνική Κουζίνα
    ],
  };
  // Keys are ALREADY folded (foldGreek(normalize(word))), same convention as
  // CATEGORY_ALIASES above.
  const TOPIC_ALIASES = {
    chef: "cooking", // English, as typed by the widget's own example query
    "σεφ": "cooking",
    "μαγιρικι": "cooking", // folded μαγειρική
    "μαγιρικις": "cooking", // folded μαγειρικής (genitive, e.g. "σχολή μαγειρικής")
  };

  // Resolves a query to a controlled topic's slug list, or null. Same
  // conservative shape as resolveCategoryIntent: every meaningful word must
  // agree on the SAME topic, and an unresolved or disagreeing word makes the
  // whole query fall through to normal search - never a forced, wrong topic.
  function resolveTopicIntent(programs, query) {
    for (const variant of queryVariants(query)) {
      const words = variant.split(" ").filter((w) => w.length >= 2 && !STOPWORDS.has(w));
      if (!words.length) continue;
      let topic = null;
      let anyUnresolved = false;
      for (const w of words) {
        const t = TOPIC_ALIASES[w];
        if (!t) { anyUnresolved = true; break; }
        if (topic === null) topic = t;
        else if (topic !== t) { anyUnresolved = true; break; }
      }
      if (!anyUnresolved && topic && TOPIC_SETS[topic]) {
        return TOPIC_SETS[topic].filter((slug) => programs.some((p) => p.slug === slug));
      }
    }
    return null;
  }

  // ---- Lexicon (R1) -------------------------------------------------------------------
  // The tables above (stopwords, category words, audience words, topics) are the DEFAULT
  // lexicon. A readable lexicon (public/lexicon.json, edited in the admin page) replaces
  // them with setLexicon(). The tables are changed IN PLACE so every existing reference
  // (including the exported STOPWORDS) stays valid, and every cache that depends on them
  // is dropped - otherwise an edit would only show after a restart.
  // Without setLexicon() nothing changes: the default tables are exactly the ones above.
  const LEXICON_SCHEMA_VERSION = 1;
  const LEXICON_MAX_WORDS = 5000;
  const LEXICON_MAX_PROGRAMS = 2000;
  const foldWord = (w) => foldGreek(normalize(w));
  const replaceContents = (target, source) => { Object.keys(target).forEach((k) => delete target[k]); Object.assign(target, source); };
  const cloneJson = (v) => JSON.parse(JSON.stringify(v));

  function snapshotTables() {
    const scan = {};
    Object.keys(AUDIENCE_SCAN_DEFAULT_TERMS).forEach((id) => { scan[id] = AUDIENCE_SCAN_DEFAULT_TERMS[id].slice(); });
    return {
      stopwords: Array.from(STOPWORDS),
      category: cloneJson(CATEGORY_ALIASES),
      audienceMulti: cloneJson(AUDIENCE_MULTI_CATEGORY_ALIASES),
      audienceSets: cloneJson(AUDIENCE_PROGRAM_SETS),
      audienceAliases: cloneJson(AUDIENCE_PROGRAM_ALIASES),
      topicSets: cloneJson(TOPIC_SETS),
      topicAliases: cloneJson(TOPIC_ALIASES),
      queryAliases: cloneJson(QUERY_ALIASES),
      tokenAliases: cloneJson(TOKEN_ALIASES),
      phraseIntents: cloneJson(PHRASE_INTENTS),
      collisionExclusions: cloneJson(COLLISION_EXCLUSIONS),
      scan,
    };
  }
  const DEFAULT_TABLES = snapshotTables();

  function applyTables(t) {
    STOPWORDS.clear();
    t.stopwords.forEach((w) => STOPWORDS.add(w));
    replaceContents(CATEGORY_ALIASES, t.category);
    replaceContents(AUDIENCE_MULTI_CATEGORY_ALIASES, t.audienceMulti);
    replaceContents(AUDIENCE_PROGRAM_SETS, t.audienceSets);
    replaceContents(AUDIENCE_PROGRAM_ALIASES, t.audienceAliases);
    replaceContents(TOPIC_SETS, t.topicSets);
    replaceContents(TOPIC_ALIASES, t.topicAliases);
    replaceContents(QUERY_ALIASES, t.queryAliases);
    replaceContents(TOKEN_ALIASES, t.tokenAliases);
    replaceContents(PHRASE_INTENTS, t.phraseIntents);
    replaceContents(COLLISION_EXCLUSIONS, t.collisionExclusions);
    Object.keys(AUDIENCE_SCAN_REGEX).forEach((k) => delete AUDIENCE_SCAN_REGEX[k]);
    Object.keys(t.scan).forEach((id) => { const re = buildScanRegex(t.scan[id]); if (re) AUDIENCE_SCAN_REGEX[id] = re; });
    indexCache = new WeakMap();
    categoryIndexCache = new WeakMap();
    trustedTypoVocabularyCache = new WeakMap();
    compoundIndexCache = new WeakMap();
  }

  // Readable lexicon -> the engine's (folded) tables. Throws Error with a Greek message when
  // the lexicon is not valid; nothing is applied in that case.
  function compileLexicon(lex) {
    const fail = (m) => { throw new Error("Μη έγκυρο λεξικό: " + m); };
    if (!lex || typeof lex !== "object" || Array.isArray(lex)) fail("δεν είναι αντικείμενο.");
    if (lex.schema_version !== LEXICON_SCHEMA_VERSION) fail("schema_version " + lex.schema_version + " (αναμενόταν " + LEXICON_SCHEMA_VERSION + ").");
    for (const k of ["stopwords", "category_words", "audience_categories", "audience_programs", "topics"]) {
      if (!Array.isArray(lex[k])) fail("λείπει η λίστα " + k + ".");
    }
    let totalWords = 0;
    const word = (w, where) => {
      if (typeof w !== "string" || !w.trim() || w.length > 100) fail("άκυρη λέξη στο " + where + ".");
      const f = foldWord(w);
      if (!f) fail("η λέξη «" + w + "» (" + where + ") δεν έχει γράμματα.");
      if (++totalWords > LEXICON_MAX_WORDS) fail("πάνω από " + LEXICON_MAX_WORDS + " λέξεις.");
      return f;
    };
    const strings = (arr, where, max) => {
      if (!Array.isArray(arr) || !arr.length || arr.length > max || arr.some((x) => typeof x !== "string" || !x.trim())) fail("άκυρη λίστα στο " + where + ".");
      return arr.slice();
    };
    const id = (g, where) => { if (!g || typeof g.id !== "string" || !/^[a-z0-9_-]{1,40}$/.test(g.id)) fail("άκυρο id στο " + where + "."); return g.id; };

    const t = { stopwords: new Set(), category: {}, audienceMulti: {}, audienceSets: {}, audienceAliases: {}, topicSets: {}, topicAliases: {}, queryAliases: {}, tokenAliases: {}, phraseIntents: {}, collisionExclusions: {}, scan: {} };
    const owner = {}; // folded word -> which table owns it
    const claim = (f, table, original) => {
      if (owner[f] && owner[f] !== table) fail("η λέξη «" + original + "» υπάρχει και στο «" + owner[f] + "» και στο «" + table + "».");
      owner[f] = table;
    };

    lex.stopwords.forEach((w) => { const f = word(w, "stopwords"); t.stopwords.add(f); claim(f, "stopwords", w); });
    lex.category_words.forEach((e) => {
      const f = word(e && e.word, "category_words");
      if (typeof e.category !== "string" || !e.category.trim()) fail("λείπει κατηγορία για τη λέξη «" + e.word + "».");
      if (t.category[f] && t.category[f] !== e.category) fail("η λέξη «" + e.word + "» έχει δύο διαφορετικές κατηγορίες.");
      t.category[f] = e.category; claim(f, "λέξη→κατηγορία", e.word);
    });
    lex.audience_categories.forEach((g) => {
      id(g, "audience_categories");
      const cats = strings(g.categories, "audience_categories.categories", 20);
      strings(g.words, "audience_categories.words", LEXICON_MAX_WORDS).forEach((w) => {
        const f = word(w, "audience_categories");
        if (t.audienceMulti[f] && JSON.stringify(t.audienceMulti[f]) !== JSON.stringify(cats)) fail("η λέξη «" + w + "» έχει δύο διαφορετικά σύνολα κατηγοριών.");
        t.audienceMulti[f] = cats; claim(f, "κοινό→κατηγορίες", w);
      });
    });
    lex.audience_programs.forEach((g) => {
      const gid = id(g, "audience_programs");
      if (t.audienceSets[gid]) fail("διπλό id «" + gid + "» στο κοινό→προγράμματα.");
      t.audienceSets[gid] = strings(g.programs, "audience_programs.programs", LEXICON_MAX_PROGRAMS);
      strings(g.words, "audience_programs.words", LEXICON_MAX_WORDS).forEach((w) => {
        const f = word(w, "audience_programs");
        if (t.audienceAliases[f] && t.audienceAliases[f] !== gid) fail("η λέξη «" + w + "» οδηγεί σε δύο ομάδες κοινού.");
        t.audienceAliases[f] = gid; claim(f, "κοινό→προγράμματα", w);
      });
      if (g.scan_terms !== undefined) {
        t.scan[gid] = strings(g.scan_terms, "audience_programs.scan_terms", 100).map((x) => { const n = normalize(x); if (!n) fail("άκυρος όρος σάρωσης."); return n; });
      }
    });
    lex.topics.forEach((g) => {
      const gid = id(g, "topics");
      if (t.topicSets[gid]) fail("διπλό id «" + gid + "» στα θέματα.");
      t.topicSets[gid] = strings(g.programs, "topics.programs", LEXICON_MAX_PROGRAMS);
      strings(g.words, "topics.words", LEXICON_MAX_WORDS).forEach((w) => {
        const f = word(w, "topics");
        if (t.topicAliases[f] && t.topicAliases[f] !== gid) fail("η λέξη «" + w + "» οδηγεί σε δύο θέματα.");
        t.topicAliases[f] = gid; claim(f, "θέματα", w);
      });
    });

    const queryAliases = lex.query_aliases === undefined ? [] : lex.query_aliases;
    if (!Array.isArray(queryAliases)) fail("το query_aliases δεν είναι λίστα.");
    queryAliases.forEach((e) => {
      if (!e || typeof e !== "object" || Array.isArray(e)) fail("άκυρη εγγραφή στο query_aliases.");
      const alias = word(e.alias, "query_aliases.alias");
      if (typeof e.canonical !== "string" || !e.canonical.trim() || e.canonical.length > 100) {
        fail("άκυρο canonical στο query_aliases.");
      }
      const canonical = foldWord(e.canonical);
      if (!canonical) fail("άκυρο canonical για το alias «" + e.alias + "».");
      if (alias === canonical) fail("το alias «" + e.alias + "» είναι ίδιο με το canonical.");
      if (t.queryAliases[alias] && t.queryAliases[alias] !== e.canonical.trim()) {
        fail("το alias «" + e.alias + "» έχει δύο διαφορετικά canonical queries.");
      }
      t.queryAliases[alias] = e.canonical.trim();
      claim(alias, "query_aliases", e.alias);
    });

    const tokenAliases = lex.token_aliases === undefined ? [] : lex.token_aliases;
    if (!Array.isArray(tokenAliases)) fail("το token_aliases δεν είναι λίστα.");

    tokenAliases.forEach((e) => {
      if (!e || typeof e !== "object" || Array.isArray(e)) {
        fail("άκυρη εγγραφή στο token_aliases.");
      }

      const alias = word(e.alias, "token_aliases.alias");

      if (alias.includes(" ")) {
        fail("το token_aliases.alias πρέπει να είναι ακριβώς ένα token.");
      }

      if (typeof e.canonical !== "string" || !e.canonical.trim()) {
        fail("άκυρο canonical στο token_aliases.");
      }

      if (
        t.tokenAliases[alias] &&
        t.tokenAliases[alias] !== e.canonical.trim()
      ) {
        fail("το ίδιο token alias οδηγεί σε δύο διαφορετικά canonical queries.");
      }

      t.tokenAliases[alias] = e.canonical.trim();
      claim(alias, "token_aliases", e.alias);
    });
    const phraseIntents = lex.phrase_intents === undefined ? [] : lex.phrase_intents;
    if (!Array.isArray(phraseIntents)) fail("το phrase_intents δεν είναι λίστα.");

    const phraseIntentOwner = {};

    phraseIntents.forEach((g) => {
      const gid = id(g, "phrase_intents");
      if (t.phraseIntents[gid]) fail("διπλό id «" + gid + "» στα phrase_intents.");

      const phrases = strings(g.phrases, "phrase_intents.phrases", 100).map((phrase) => {
        const f = foldWord(phrase);
        if (!f.includes(" ")) fail("το phrase_intents.phrases πρέπει να περιέχει multi-word phrases.");

        if (phraseIntentOwner[f] && phraseIntentOwner[f] !== gid) {
          fail(
            "η phrase «" + phrase + "» ανήκει σε δύο διαφορετικά phrase intents: «" +
            phraseIntentOwner[f] + "» και «" + gid + "»."
          );
        }

        phraseIntentOwner[f] = gid;
        return f;
      });

      const terms = strings(g.terms, "phrase_intents.terms", 100).map((term) => {
        const f = foldWord(term);
        if (!f) fail("άκυρος όρος στο phrase_intents.terms.");
        return f;
      });

      t.phraseIntents[gid] = { id: gid, phrases, terms };
    });

    const collisionExclusions = lex.collision_exclusions === undefined ? [] : lex.collision_exclusions;
    if (!Array.isArray(collisionExclusions)) fail("το collision_exclusions δεν είναι λίστα.");

    collisionExclusions.forEach((e) => {
      if (!e || typeof e !== "object" || Array.isArray(e)) {
        fail("άκυρη εγγραφή στο collision_exclusions.");
      }

      const query = word(e.query, "collision_exclusions.query");
      const blocked = strings(
        e.blocked_tokens,
        "collision_exclusions.blocked_tokens",
        100
      ).map((token) => {
        const f = foldWord(token);
        if (!f || f.includes(" ")) {
          fail("το collision_exclusions.blocked_tokens πρέπει να περιέχει single tokens.");
        }
        return f;
      });

      if (t.collisionExclusions[query]) {
        fail("διπλό query «" + e.query + "» στο collision_exclusions.");
      }

      t.collisionExclusions[query] = Array.from(new Set(blocked));
    });

    // A word that is both a stopword and an alias could never act as an alias (stopwords are dropped first).
    Object.keys(owner).forEach((f) => {
      if (owner[f] !== "stopwords" && t.stopwords.has(f)) fail("η λέξη «" + f + "» είναι και stopword και λέξη αντιστοίχισης.");
    });
    t.stopwords = Array.from(t.stopwords);
    return t;
  }

  function setLexicon(lex) {
    const t = compileLexicon(lex); // throws before anything changes
    applyTables(t);
    return {
      stopwords: t.stopwords.length,
      category_words: Object.keys(t.category).length,
      audience_words: Object.keys(t.audienceMulti).length + Object.keys(t.audienceAliases).length,
      topic_words: Object.keys(t.topicAliases).length,
      query_aliases: Object.keys(t.queryAliases).length,
      token_aliases: Object.keys(t.tokenAliases).length,
      phrase_intents: Object.keys(t.phraseIntents).length,
      collision_exclusions: Object.keys(t.collisionExclusions).length,
    };
  }
  function resetLexicon() { applyTables(DEFAULT_TABLES); }
  function getLexiconTables() { return snapshotTables(); }
  function getDefaultLexiconTables() { return cloneJson(DEFAULT_TABLES); }

  // Checkpoint G5: trusted typo recovery.
  //
  // This vocabulary is deliberately separate from buildVocabulary(). Official
  // taxonomy tokens may be very frequent, so adding them to the ordinary fuzzy
  // vocabulary would change already-correct searches. Here they are used only
  // as correction targets for a query token that is not already canonical.
  let trustedTypoVocabularyCache = new WeakMap(); // replaced by setLexicon()

  function buildTrustedTypoVocabulary(programs) {
    const cached = trustedTypoVocabularyCache.get(programs);
    if (cached) return cached;

    const trusted = new Set();
    const categories = new Set();

    programs.forEach((p) => {
      (p.areas_of_study || []).forEach((area) => {
        if (area) categories.add(area);
      });
    });

    categories.forEach((area) => {
      // Only taxonomy categories that the existing authoritative category
      // resolver already recognizes may contribute automatic typo targets.
      // This keeps typo recovery subordinate to established search intent
      // instead of turning every taxonomy word into a new standalone intent.
      if (!resolveCategoryIntent(programs, area)) return;

      foldGreek(normalize(area)).split(" ").forEach((token) => {
        if (token.length >= 5 && !STOPWORDS.has(token)) trusted.add(token);
      });
    });

    const vocabulary = Array.from(trusted);
    trustedTypoVocabularyCache.set(programs, vocabulary);
    return vocabulary;
  }

  function adjacentTranspositionDistanceOne(a, b) {
    if (a.length !== b.length || a === b) return false;

    const diffs = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diffs.push(i);
      if (diffs.length > 2) return false;
    }

    return diffs.length === 2 &&
      diffs[1] === diffs[0] + 1 &&
      a[diffs[0]] === b[diffs[1]] &&
      a[diffs[1]] === b[diffs[0]];
  }

  function trustedTypoDistance(token, candidate) {
    if (token === candidate) return null;
    if (token.length < 5 || candidate.length < 5) return null;

    // Common Greek keyboard/phonetic decomposition: πσ... typed instead of ψ...
    // Keep this local to trusted typo matching; never rewrite the normal query.
    let comparable = token;
    if (comparable.slice(0, 2) === "πσ" && candidate[0] === "ψ") {
      comparable = "ψ" + comparable.slice(2);
      if (comparable === candidate) return 1;
    }

    if (adjacentTranspositionDistanceOne(comparable, candidate)) return 1;

    const distance = levenshtein(comparable, candidate);

    // One edit is safe for long trusted taxonomy words when their root agrees.
    if (
      distance === 1 &&
      comparable.slice(0, 3) === candidate.slice(0, 3)
    ) {
      return 1;
    }

    // Greek folding can turn one visible missing-letter typo into two folded
    // edits (for example ψυχολοια -> ψιχολια). Permit two edits only for
    // sufficiently long words with a stronger four-character common root.
    if (
      distance === 2 &&
      comparable.length >= 7 &&
      candidate.length >= 7 &&
      comparable.slice(0, 4) === candidate.slice(0, 4)
    ) {
      return 2;
    }

    return null;
  }

  function resolveTrustedTypo(programs, concepts, query) {
    const trusted = buildTrustedTypoVocabulary(programs);
    const variants = queryVariants(query);
    if (!variants.length) return null;

    // G5 starts conservatively with a single meaningful token. Compound-query
    // correction can be added later with its own regression corpus rather than
    // silently rewriting several user words at once.
    const words = variants[0]
      .split(" ")
      .filter((w) => w.length >= 2 && !STOPWORDS.has(w));

    if (words.length !== 1) return null;

    const token = words[0];

    // Preserve established semantic behavior. Calling the existing expansion
    // pipeline without a vocabulary leaves only direct concept expansion;
    // fuzzy vocabulary correction is therefore excluded from this guard.
    const directExpansion = expandQueryDetailed(query, concepts, null);
    const rawVariantTerms = new Set();

    variants.forEach((variantText) => {
      variantText
        .split(" ")
        .filter((w) => w.length > 1 && !STOPWORDS.has(w))
        .forEach((w) => rawVariantTerms.add(w));
    });

    const hasDirectConceptExpansion = directExpansion.termsFlat.some(
      (term) => !rawVariantTerms.has(term)
    );

    if (hasDirectConceptExpansion) return null;

    // An already-authoritative taxonomy token is never fuzzy-corrected.
    if (trusted.indexOf(token) !== -1) return null;

    let bestDistance = Infinity;
    let best = [];

    for (const candidate of trusted) {
      const distance = trustedTypoDistance(token, candidate);
      if (distance === null) continue;

      if (distance < bestDistance) {
        bestDistance = distance;
        best = [candidate];
      } else if (distance === bestDistance) {
        best.push(candidate);
      }
    }

    // Ambiguity means no correction. We prefer the existing search behavior
    // over guessing between equally plausible taxonomy terms.
    return best.length === 1 ? best[0] : null;
  }

  const MAX_QUERY_LENGTH = 700; // hard cap: no legitimate search needs more than this,
  // and it bounds the cost of vocabulary fuzzy-matching (which scales with query token count).
  const RANK_CACHE_SIZE = 300;

  // Full ranking of all matching programs: [{ entryIndex, s }] sorted by score desc.
  function rankAll(programs, concepts, query, skipTrustedTypoRecovery) {
    query = String(query || "").slice(0, MAX_QUERY_LENGTH);

    // Exact governed whole-query aliases are canonical replacements, not
    // additive scoring variants. Once an explicitly curated alias matches
    // the entire normalized query, all downstream intent/scoring logic sees
    // only its canonical query.
    const queryAliasKey = foldGreek(normalize(query));
    const queryAliasTarget = QUERY_ALIASES[queryAliasKey];
    if (queryAliasTarget) query = queryAliasTarget;

    const tokenAliasResolution = resolveCuratedTokenAliases(query);
    if (tokenAliasResolution) query = tokenAliasResolution;

    const concatenatedResolution = resolveConcatenatedQuery(programs, concepts, query);
    const semanticQuery = concatenatedResolution || query;

    if (!skipTrustedTypoRecovery) {
      const trustedCorrection = resolveTrustedTypo(programs, concepts, semanticQuery);
      if (trustedCorrection) {
        return rankAll(programs, concepts, trustedCorrection, true);
      }
    }

    const idx = getIndex(programs);
    if (idx.rankCacheConcepts !== concepts) { idx.rankCache.clear(); idx.rankCacheConcepts = concepts; }
    const key = foldGreek(normalize(query)) + " " + query.toLowerCase();
    const cached = idx.rankCache.get(key);
    if (cached) { idx.rankCache.delete(key); idx.rankCache.set(key, cached); return cached; }

    const phraseIntent = resolvePhraseIntent(semanticQuery);
    const variants = Array.from(new Set([
      ...queryVariants(query),
      ...queryVariants(semanticQuery),
      ...(phraseIntent ? phraseIntent.phrases : [])
    ]));
    const { termsFlat: terms, byWord } = expandQueryDetailed(semanticQuery, concepts, idx.vocab);
    const blockedTokens = collisionExclusionsFor(semanticQuery, terms);

    const ranked = [];
    if (variants.length) {
      // Checkpoint A: single official category. Checkpoint B: the SAME word
      // may instead resolve to several official categories at once (audience/
      // profession aliases verified in the Checkpoint B audit), or to a
      // controlled topic set (Type B, for real topics with no official
      // category at all). All three are mutually exclusive by construction
      // (disjoint alias tables), tried in this fixed order, and every one of
      // them falls through to plain scored search below when unresolved -
      // intent resolution failing NEVER produces zero results by itself.
      let categoryNames = resolveCategoryIntent(programs, semanticQuery);
      if (!categoryNames) categoryNames = resolveAudienceMultiCategoryIntent(programs, query);
      const conceptIntent = resolveSingleConceptIntent(programs, concepts, query, categoryNames, idx);
      if (categoryNames) {
        // Category intent resolved with confidence: the candidate set is EVERY
        // official member of that category (or, for an array, the UNION of
        // members across every resolved category, deduplicated by slug), even
        // ones the raw query terms score 0 against (a member's title/tags/
        // description need not mention the query at all to belong) - then rank
        // within that fixed set using the exact same scoreEntry() the normal
        // path uses below, so a member that ALSO genuinely matches the query
        // surfaces first. Ties broken by original catalog order, for determinism.
        const names = Array.isArray(categoryNames) ? categoryNames : [categoryNames];
        for (let i = 0; i < idx.entries.length; i++) {
          if (!names.some((name) => programBelongsToCategory(idx.entries[i].p, name))) continue;
          if (conceptIntent && !eligibleForConceptIntent(idx.entries[i].p, idx.entries[i], concepts, conceptIntent, variants)) continue;
          ranked.push({ i, s: scoreEntry(idx.entries[i], variants, terms, byWord, blockedTokens) });
        }
        ranked.sort((a, b) => b.s - a.s || a.i - b.i);
      } else {
        const audienceIntent = resolveAudienceProgramIntentDetailed(programs, query);
        const audienceProgramSlugs = audienceIntent ? audienceIntent.slugs : null;
        const topicSlugs = audienceProgramSlugs || resolveTopicIntent(programs, query);
        if (topicSlugs && topicSlugs.length) {
          // Controlled topic set (Type B): the candidate set is EXACTLY the
          // verified slug list, nothing added, nothing left out - deliberately
          // narrower than the category branch above, per the task's explicit
          // instruction to return only the topic-mapped programs.
          const slugSet = new Set(topicSlugs);
          for (let i = 0; i < idx.entries.length; i++) {
            if (!slugSet.has(idx.entries[i].p.slug)) continue;
            ranked.push({ i, s: scoreEntry(idx.entries[i], variants, terms, byWord, blockedTokens) });
          }
          if (audienceProgramSlugs) {
            // For audience searches, audited thematic programs remain the strongest
            // recommendations; programs included solely because they explicitly name
            // the audience follow them. Within each tier, normal relevance scoring
            // and catalog order remain deterministic.
            const thematicSeed = new Set(AUDIENCE_PROGRAM_SETS[audienceIntent.audience] || []);
            ranked.sort((a, b) => {
              const ap = thematicSeed.has(idx.entries[a.i].p.slug) ? 0 : 1;
              const bp = thematicSeed.has(idx.entries[b.i].p.slug) ? 0 : 1;
              return ap - bp || b.s - a.s || a.i - b.i;
            });
          } else {
            ranked.sort((a, b) => b.s - a.s || a.i - b.i);
          }
        } else {
          for (let i = 0; i < idx.entries.length; i++) {
            if (conceptIntent && !eligibleForConceptIntent(idx.entries[i].p, idx.entries[i], concepts, conceptIntent, variants)) continue;
            const s = scoreEntry(idx.entries[i], variants, terms, byWord, blockedTokens);
            if (s > 0) ranked.push({ i, s });
          }
          ranked.sort((a, b) => b.s - a.s);
        }
      }
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
    STOPWORDS, buildCategoryIndex, resolveCategoryIntent, programBelongsToCategory,
    resolveAudienceMultiCategoryIntent, resolveAudienceProgramIntent, explicitlyTargetsPhilologists, resolveTopicIntent,
    setLexicon, resetLexicon, compileLexicon, getLexiconTables, getDefaultLexiconTables, LEXICON_SCHEMA_VERSION,
    buildCompoundIndex, resolveConcatenatedQuery, resolveCuratedTokenAliases, resolvePhraseIntent,
  };
});
