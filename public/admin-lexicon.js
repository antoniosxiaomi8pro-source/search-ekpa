/* Admin tab «📖 Λεξικό» (R3.1). Edits public lexicon (stopwords, category words, audience, topics)
   through /api/admin/lexicon/*. Nothing is saved without a preview of what changes in the results.
   Uses from admin-taxonomy.html: adminToken, esc(). */
(function () {
  "use strict";
  var root = document.getElementById("lexRoot");
  var serverLex = null, draft = null, baseVersion = null, meta = null;
  var previewOf = null;      // JSON of the draft the last preview was made for
  var lastPreview = null;
  var programs = [];         // active programs [{slug,title}]
  var programsFull = [];     // same, with categories - for the live "already a category" check
  var categories = [];       // official category names present in the catalog
  var loaded = false, busy = false;

  var clone = function (v) { return JSON.parse(JSON.stringify(v)); };
  var draftJson = function () { return JSON.stringify(draft); };
  var isDirty = function () { return !!draft && draftJson() !== JSON.stringify(serverLex); };
  var newId = function () { return "g" + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36); };
  var $ = function (sel, el) { return (el || root).querySelector(sel); };

  function api(path, opts) {
    opts = opts || {};
    var headers = { "x-admin-token": adminToken };
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch(path, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, data: j }; }); });
  }
  function say(msg, type) {
    var el = $("#lexStatus"); if (!el) return;
    el.textContent = msg; el.className = "status " + (type || "info");
  }

  /* ---------- loading ---------- */
  window.lexOnShow = function () { if (adminToken) load(); else render(); };
  window.lexOnUnlock = function () { if (document.getElementById("tab-lexicon").style.display !== "none") load(); };

  function load() {
    if (busy) return;
    busy = true;
    Promise.all([
      api("/api/admin/lexicon"),
      fetch("/api/programs").then(function (r) { return r.json(); }),
      fetch("/categories.json").then(function (r) { return r.json(); }).catch(function () { return { categories: [] }; }),
    ]).then(function (parts) {
      var st = parts[0];
      if (!st.ok) throw new Error(st.data.error || ("HTTP " + st.status));
      meta = st.data;
      serverLex = st.data.lexicon; baseVersion = st.data.version; draft = clone(serverLex);
      programsFull = parts[1];
      if (window.EkpaSearch) { try { window.EkpaSearch.setLexicon(serverLex); } catch (e) {} }
      programs = parts[1].map(function (p) { return { slug: p.slug, title: p.title }; });
      var inCatalog = {};
      parts[1].forEach(function (p) { [p.primary_area].concat(p.areas_of_study || []).forEach(function (c) { if (c) inCatalog[c] = 1; }); });
      var official = (parts[2].categories || []).map(function (c) { return c.name; }).filter(function (n) { return inCatalog[n]; });
      categories = official.length ? official : Object.keys(inCatalog);
      categories.sort(function (a, b) { return a.localeCompare(b, "el"); });
      previewOf = null; lastPreview = null; loaded = true;
      render();
    }).catch(function (e) {
      render(); say("Δεν φορτώθηκε το λεξικό: " + e.message, "err");
    }).then(function () { busy = false; });
  }

  /* ---------- small editors ---------- */
  function chips(arr, onChange, placeholder, opts) {
    opts = opts || {};
    var box = document.createElement("div");
    var list = document.createElement("div"); list.className = "chips";
    arr.forEach(function (w, i) {
      var c = document.createElement("span"); c.className = "chip";
      c.innerHTML = esc(opts.label ? opts.label(w) : w);
      var x = document.createElement("button"); x.type = "button"; x.textContent = "×"; x.title = "Αφαίρεση";
      x.addEventListener("click", function () { arr.splice(i, 1); onChange(); });
      c.appendChild(x); list.appendChild(c);
    });
    box.appendChild(list);
    if (!opts.readonly) {
      var row = document.createElement("div"); row.className = "add-term-row";
      var inp = document.createElement("input"); inp.placeholder = placeholder || "Νέα λέξη…";
      var b = document.createElement("button"); b.type = "button"; b.textContent = "Προσθήκη";
      var add = function () {
        var parts = inp.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        if (!parts.length) return;
        parts.forEach(function (p) { if (arr.indexOf(p) < 0) arr.push(p); });
        onChange();
      };
      b.addEventListener("click", add);
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); add(); } });
      row.appendChild(inp); row.appendChild(b); box.appendChild(row);
    }
    return box;
  }

  function categoryPicker(arr, onChange) {
    var box = document.createElement("div");
    box.appendChild(chips(arr, onChange, null, { readonly: true }));
    var sel = document.createElement("select"); sel.className = "lex-select";
    sel.innerHTML = '<option value="">+ Πρόσθεσε κατηγορία…</option>' + categories.filter(function (c) { return arr.indexOf(c) < 0; })
      .map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("");
    sel.addEventListener("change", function () { if (sel.value) { arr.push(sel.value); onChange(); } });
    box.appendChild(sel);
    return box;
  }

  function programPicker(arr, onChange) {
    var box = document.createElement("div");
    var titleOf = function (s) { for (var i = 0; i < programs.length; i++) if (programs[i].slug === s) return programs[i].title; return null; };
    box.appendChild(chips(arr, onChange, null, { readonly: true, label: function (s) { var t = titleOf(s); return t ? t : "⚠ " + s + " (δεν υπάρχει ή είναι κρυμμένο)"; } }));
    var inp = document.createElement("input"); inp.className = "lex-input"; inp.placeholder = "🔎 Βρες πρόγραμμα για προσθήκη (γράψε μέρος του τίτλου)…";
    var res = document.createElement("div"); res.className = "lex-results";
    var fold = function (s) { return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); };
    inp.addEventListener("input", function () {
      var q = fold(inp.value.trim()); res.innerHTML = "";
      if (q.length < 2) return;
      programs.filter(function (p) { return arr.indexOf(p.slug) < 0 && fold(p.title).indexOf(q) >= 0; }).slice(0, 8).forEach(function (p) {
        var b = document.createElement("button"); b.type = "button"; b.className = "lex-result"; b.textContent = p.title;
        b.addEventListener("click", function () { arr.push(p.slug); onChange(); });
        res.appendChild(b);
      });
      if (!res.firstChild) res.innerHTML = '<div class="hint">Κανένα ενεργό πρόγραμμα.</div>';
    });
    box.appendChild(inp); box.appendChild(res);
    return box;
  }

  function card(title, hint, bodyEls, onRemove) {
    var c = document.createElement("div"); c.className = "concept-card";
    var head = document.createElement("div"); head.className = "concept-head";
    var t = document.createElement("div"); t.className = "concept-key"; t.style.fontFamily = "inherit"; t.textContent = title;
    head.appendChild(t);
    if (onRemove) { var r = document.createElement("button"); r.type = "button"; r.className = "btn btn-danger"; r.textContent = "Διαγραφή ομάδας"; r.addEventListener("click", function () { if (confirm("Διαγραφή αυτής της ομάδας;")) onRemove(); }); head.appendChild(r); }
    c.appendChild(head);
    if (hint) { var h = document.createElement("div"); h.className = "hint"; h.style.marginBottom = "8px"; h.textContent = hint; c.appendChild(h); }
    bodyEls.forEach(function (e) { c.appendChild(e); });
    return c;
  }
  // Live, per-group notes (no need to press Preview to learn about the common problems).
  function note(text, level) {
    var d = document.createElement("div"); d.className = "banner " + (level === "err" ? "err" : "warn"); d.style.cssText = "margin:8px 0;font-size:13px";
    d.textContent = (level === "err" ? "⛔ " : "⚠ ") + text; return d;
  }
  function shadowNotes(words) {
    var out = [];
    if (!window.EkpaSearch || !programsFull.length) return out;
    words.forEach(function (w) {
      var cat = null;
      try { cat = window.EkpaSearch.resolveCategoryIntent(programsFull, w); } catch (e) {}
      if (cat) out.push(note("Η λέξη «" + w + "» ταιριάζει ήδη με την κατηγορία «" + cat + "». Η αναζήτηση την αντιμετωπίζει ως κατηγορία πριν φτάσει σε αυτόν τον κανόνα, άρα ο κανόνας δεν θα ισχύσει. Για να δείχνει την κατηγορία, χρησιμοποίησε το «Λέξη → κατηγορία». Για συγκεκριμένα προγράμματα δεν γίνεται με αυτή τη λέξη.", "warn"));
    });
    return out;
  }
  function groupNotes(g, targetKey, targetName) {
    var out = [];
    if (g.words.length && !(g[targetKey] || []).length) out.push(note("Η ομάδα έχει λέξεις αλλά κανένα " + targetName + ". Πρόσθεσε τουλάχιστον ένα, αλλιώς δεν μπορεί να αποθηκευτεί.", "err"));
    if (!g.words.length && (g[targetKey] || []).length) out.push(note("Η ομάδα δεν έχει λέξεις. Πρόσθεσε τουλάχιστον μία, αλλιώς δεν θα χρησιμοποιηθεί.", "err"));
    return out.concat(shadowNotes(g.words));
  }
  function label(text) { var l = document.createElement("div"); l.className = "lex-label"; l.textContent = text; return l; }
  var rerender = function () { previewOf = null; lastPreview = null; render(); };

  /* ---------- sections ---------- */
  function sectionStopwords() {
    var p = document.createElement("section"); p.className = "panel";
    p.innerHTML = "<h3 style='margin-top:0'>🚫 Λέξεις που αγνοούνται</h3><div class='hint' style='margin-bottom:10px'>Λέξεις χωρίς νόημα για την αναζήτηση (και, για, πρόγραμμα…). Αγνοούνται σε όλες τις αναζητήσεις. Πρόσεχε: μια λέξη που υπάρχει σε τίτλους προγραμμάτων δεν θα μετράει πια στην αναζήτηση.</div>";
    p.appendChild(chips(draft.stopwords, rerender, "Νέα λέξη (ή πολλές με κόμμα)…"));
    return p;
  }

  function sectionCategoryWords() {
    var p = document.createElement("section"); p.className = "panel";
    p.innerHTML = "<h3 style='margin-top:0'>🏷️ Λέξη → κατηγορία</h3><div class='hint' style='margin-bottom:10px'>Όταν ο επισκέπτης γράφει αυτή τη λέξη, η αναζήτηση δείχνει όλη την κατηγορία (π.χ. «ναυτικός» → Ναυτιλιακά). Ισχύει και μέσα σε μεγαλύτερη φράση. Οι κλίσεις και οι τόνοι καλύπτονται αυτόματα, αλλά όχι οι γενικές πληθυντικού, γράψε και αυτές.</div>";
    var table = document.createElement("table"); table.className = "data-table";
    table.innerHTML = "<thead><tr><th>Λέξη</th><th>Κατηγορία</th><th></th></tr></thead>";
    var tb = document.createElement("tbody");
    draft.category_words.forEach(function (e, i) {
      var tr = document.createElement("tr");
      var td1 = document.createElement("td"), td2 = document.createElement("td"), td3 = document.createElement("td");
      var inp = document.createElement("input"); inp.className = "lex-input"; inp.value = e.word;
      inp.addEventListener("change", function () { e.word = inp.value.trim(); rerender(); });
      td1.appendChild(inp);
      var sel = document.createElement("select"); sel.className = "lex-select";
      var opts = categories.slice(); if (opts.indexOf(e.category) < 0) opts.unshift(e.category);
      sel.innerHTML = opts.map(function (c) { return '<option value="' + esc(c) + '"' + (c === e.category ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("");
      sel.addEventListener("change", function () { e.category = sel.value; rerender(); });
      td2.appendChild(sel);
      var x = document.createElement("button"); x.type = "button"; x.className = "btn btn-danger"; x.textContent = "✕";
      x.addEventListener("click", function () { draft.category_words.splice(i, 1); rerender(); });
      td3.appendChild(x);
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tb.appendChild(tr);
    });
    table.appendChild(tb); p.appendChild(table);
    var add = document.createElement("button"); add.type = "button"; add.className = "btn btn-secondary"; add.style.marginTop = "10px"; add.textContent = "➕ Νέα αντιστοίχιση";
    add.addEventListener("click", function () { draft.category_words.push({ word: "", category: categories[0] || "" }); render(); });
    p.appendChild(add);
    return p;
  }

  function sectionAudience() {
    var p = document.createElement("section"); p.className = "panel";
    p.innerHTML = "<h3 style='margin-top:0'>👥 Κοινό / επάγγελμα</h3><div class='hint' style='margin-bottom:10px'>Ισχύει όταν ο επισκέπτης γράφει <b>μόνο</b> τη λέξη (π.χ. «δάσκαλος»). Δείχνει είτε ολόκληρες κατηγορίες είτε συγκεκριμένα προγράμματα. Γράψε όλες τις μορφές της λέξης που περιμένεις (ενικός, πληθυντικός, γενική).</div>";
    draft.audience_categories.forEach(function (g, i) {
      p.appendChild(card("Κοινό → κατηγορίες: " + (g.words.slice(0, 3).join(", ") || "(νέα ομάδα)"), null, [
        label("Λέξεις"), chips(g.words, rerender, "π.χ. δάσκαλος, δασκάλου, δασκάλων…"),
        label("Κατηγορίες που εμφανίζονται"), categoryPicker(g.categories, rerender),
      ].concat(groupNotes(g, "categories", "κατηγορία")), function () { draft.audience_categories.splice(i, 1); rerender(); }));
    });
    draft.audience_programs.forEach(function (g, i) {
      var scanOn = Array.isArray(g.scan_terms);
      var scan = document.createElement("label"); scan.className = "lex-check";
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = scanOn;
      cb.addEventListener("change", function () { if (cb.checked) g.scan_terms = g.words.slice(); else delete g.scan_terms; rerender(); });
      scan.appendChild(cb); scan.appendChild(document.createTextNode(" Πρόσθεσε και προγράμματα που αναφέρουν το κοινό στο «Απευθύνεται σε…» της περιγραφής τους"));
      var els = [label("Λέξεις"), chips(g.words, rerender, "π.χ. φιλόλογος, φιλολόγου…"), label("Προγράμματα (εμφανίζονται πρώτα)"), programPicker(g.programs, rerender), scan].concat(groupNotes(g, "programs", "πρόγραμμα"));
      if (scanOn) { els.push(label("Λέξεις που αναζητούνται στην περιγραφή")); els.push(chips(g.scan_terms, rerender, "π.χ. φιλόλογοι, φιλολογίας…")); }
      p.appendChild(card("Κοινό → προγράμματα: " + (g.words.slice(0, 3).join(", ") || "(νέα ομάδα)"), null, els, function () { draft.audience_programs.splice(i, 1); rerender(); }));
    });
    var row = document.createElement("div"); row.className = "toolbar"; row.style.marginBottom = "0";
    var a = document.createElement("button"); a.type = "button"; a.className = "btn btn-secondary"; a.textContent = "➕ Νέο κοινό με κατηγορίες";
    a.addEventListener("click", function () { draft.audience_categories.push({ id: newId(), words: [], categories: [] }); render(); });
    var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-secondary"; b.textContent = "➕ Νέο κοινό με προγράμματα";
    b.addEventListener("click", function () { draft.audience_programs.push({ id: newId(), words: [], programs: [] }); render(); });
    row.appendChild(a); row.appendChild(b); p.appendChild(row);
    return p;
  }

  function sectionTopics() {
    var p = document.createElement("section"); p.className = "panel";
    p.innerHTML = "<h3 style='margin-top:0'>🍳 Θέματα</h3><div class='hint' style='margin-bottom:10px'>Για θέματα που δεν έχουν δική τους κατηγορία (π.χ. «σεφ» → 2 προγράμματα μαγειρικής). Δείχνει <b>μόνο</b> τα προγράμματα που επιλέγεις, όταν όλες οι λέξεις της αναζήτησης ανήκουν στο θέμα.</div>";
    draft.topics.forEach(function (g, i) {
      p.appendChild(card("Θέμα: " + (g.words.slice(0, 3).join(", ") || "(νέο θέμα)"), null, [
        label("Λέξεις"), chips(g.words, rerender, "π.χ. σεφ, μαγειρική…"),
        label("Προγράμματα"), programPicker(g.programs, rerender),
      ].concat(groupNotes(g, "programs", "πρόγραμμα")), function () { draft.topics.splice(i, 1); rerender(); }));
    });
    var add = document.createElement("button"); add.type = "button"; add.className = "btn btn-secondary"; add.textContent = "➕ Νέο θέμα";
    add.addEventListener("click", function () { draft.topics.push({ id: newId(), words: [], programs: [] }); render(); });
    p.appendChild(add);
    return p;
  }

  /* ---------- preview ---------- */
  function cleanDraft() {
    var d = clone(draft);
    d.stopwords = d.stopwords.map(function (w) { return w.trim(); }).filter(Boolean);
    d.category_words = d.category_words.filter(function (e) { return e.word.trim(); }).map(function (e) { return { word: e.word.trim(), category: e.category }; });
    ["audience_categories", "audience_programs", "topics"].forEach(function (k) {
      d[k] = d[k].filter(function (g) { return g.words.length || (g.programs && g.programs.length) || (g.categories && g.categories.length); });
    });
    return d;
  }
  var KIND = { added: "➕ προστέθηκε", removed: "➖ αφαιρέθηκε", changed: "✏️ άλλαξε" };
  var EVENT = {
    enters_from_outside: function (e) { return '<span class="plus">+ μπαίνει #' + e.to + "</span> " + esc(e.title) + " <small>(δεν ήταν στα 10 πρώτα)</small>"; },
    rises: function (e) { return '<span class="plus">↑ ανεβαίνει #' + e.from + " → #" + e.to + "</span> " + esc(e.title); },
    reordered: function (e) { return "↔ αλλάζει θέση #" + e.from + " → #" + e.to + " " + esc(e.title); },
    leaves: function (e) { return '<span class="minus">− φεύγει από το top-3 (ήταν #' + e.from + ")</span> " + esc(e.title) + (e.to ? " <small>→ #" + e.to + "</small>" : " <small>→ εκτός 10 πρώτων</small>"); },
  };
  function renderPreview(r) {
    var h = "";
    var hasErr = r.warnings.some(function (w) { return w.level === "error"; });
    h += '<div class="banner ' + (r.changes.length ? (r.other_changed ? "warn" : "ok") : "ok") + '"><b>' + (r.changes.length ? r.changes.length + (r.changes.length === 1 ? " αλλαγή στο λεξικό" : " αλλαγές στο λεξικό") : "Καμία αλλαγή στο λεξικό") + "</b> · ελέγχθηκαν " + r.queries + " αναζητήσεις · άλλαξαν τα αποτελέσματα σε <b>" + r.changed + "</b> (στο top-3: " + r.top3_changed + ")" + (r.other_changed ? ' · <b>' + r.other_changed + " αναζητήσεις εκτός των λέξεων που άλλαξες</b> επηρεάζονται, δες τις παρακάτω πριν αποθηκεύσεις." : "") + "</div>";
    if (r.changes.length) h += "<ul style='font-size:13px'>" + r.changes.map(function (c) { return "<li>" + KIND[c.kind] + ": «" + esc(c.word) + "» <small>(" + esc(c.group) + ")</small></li>"; }).join("") + "</ul>";
    r.warnings.forEach(function (w) { h += '<div class="banner ' + (w.level === "error" ? "err" : "warn") + '">' + (w.level === "error" ? "⛔ " : "⚠ ") + esc(w.text) + "</div>"; });
    r.groups.forEach(function (g) {
      if (!g.changed) { h += '<div class="hint">' + esc(g.label) + ": " + g.queries + " αναζητήσεις, καμία αλλαγή.</div>"; return; }
      var own = g.label === "Λέξεις που άλλαξαν";
      h += '<details class="change-list"' + (own || g.changed <= 5 ? " open" : "") + "><summary><b>" + esc(g.label) + "</b>: άλλαξαν " + g.changed + " από " + g.queries + (own ? " (αναμενόμενο)" : " — χρειάζεται έλεγχος") + "</summary>";
      g.changes.forEach(function (c) {
        h += '<div class="ranking-q">«' + esc(c.query) + "» <small>σύνολο " + c.total_before + " → " + c.total_after + "</small></div>";
        if (c.top3.length) h += "<ul>" + c.top3.map(function (e) { return "<li>" + EVENT[e.kind](e) + "</li>"; }).join("") + "</ul>";
        else h += '<div class="hint">Δεν αλλάζει το top-3, αλλάζουν θέσεις 4–10 ή το πλήθος.</div>';
      });
      h += "</details>";
    });
    return { html: h, hasErr: hasErr };
  }
  function problems(d) {
    var out = [];
    [["audience_categories", "categories", "Κοινό → κατηγορίες"], ["audience_programs", "programs", "Κοινό → προγράμματα"], ["topics", "programs", "Θέματα"]].forEach(function (x) {
      d[x[0]].forEach(function (g) {
        var name = x[2] + " «" + (g.words.slice(0, 2).join(", ") || "χωρίς λέξεις") + "»";
        if (!g.words.length) out.push(name + ": η ομάδα δεν έχει λέξεις.");
        else if (!(g[x[1]] || []).length) out.push(name + ": η ομάδα δεν έχει " + (x[1] === "categories" ? "κατηγορίες" : "προγράμματα") + ".");
      });
    });
    return out;
  }
  function doPreview() {
    if (busy) return;
    var d = cleanDraft();
    var probs = problems(d);
    if (probs.length) { say("Διόρθωσε πρώτα: " + probs.join(" "), "err"); var st = $("#lexStatus"); if (st && st.scrollIntoView) st.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    busy = true; say("Υπολογίζεται η προεπισκόπηση (λίγα δευτερόλεπτα)…", "info");
    $("#lexPreviewBtn").disabled = true;
    api("/api/admin/lexicon/preview", { method: "POST", body: { lexicon: d } }).then(function (r) {
      if (!r.ok) { say(r.data.error || ("HTTP " + r.status), "err"); var st2 = $("#lexStatus"); if (st2 && st2.scrollIntoView) st2.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      draft = d; previewOf = draftJson(); lastPreview = r.data; baseVersion = r.data.base_version;
      render(); say("Η προεπισκόπηση είναι έτοιμη. Έλεγξε τις αλλαγές και αποθήκευσε.", "ok");
      var el = $("#lexPreview"); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }).catch(function (e) { say("Η προεπισκόπηση απέτυχε: " + e.message, "err"); })
      .then(function () { busy = false; var b = $("#lexPreviewBtn"); if (b) b.disabled = false; });
  }
  function doSave() {
    if (busy || !lastPreview || previewOf !== draftJson()) return;
    var p = lastPreview;
    var msg = "Αποθήκευση του λεξικού;\n\n• " + p.changes.length + " αλλαγές στο λεξικό\n• Αλλάζουν τα αποτελέσματα σε " + p.changed + " αναζητήσεις (top-3: " + p.top3_changed + ")" + (p.other_changed ? "\n• ΠΡΟΣΟΧΗ: " + p.other_changed + " από αυτές είναι εκτός των λέξεων που άλλαξες" : "") + "\n\nΗ αλλαγή ισχύει αμέσως για τους επισκέπτες. Κρατιέται backup και μπορείς να επαναφέρεις.";
    if (!confirm(msg)) return;
    busy = true; say("Αποθήκευση…", "info");
    api("/api/admin/lexicon/save", { method: "POST", body: { lexicon: draft, base_version: baseVersion, confirm: true } }).then(function (r) {
      busy = false;
      if (!r.ok) { say(r.data.error || ("HTTP " + r.status), "err"); return; }
      loaded = false; load(); setTimeout(function () { say("Το λεξικό αποθηκεύτηκε και ισχύει τώρα.", "ok"); }, 600);
    }).catch(function (e) { busy = false; say("Η αποθήκευση απέτυχε: " + e.message, "err"); });
  }
  function doRollback() {
    if (busy || !meta || !meta.backups) return;
    if (!confirm("Επαναφορά της προηγούμενης έκδοσης του λεξικού; Η τρέχουσα θα κρατηθεί ως backup.")) return;
    busy = true;
    api("/api/admin/lexicon/rollback", { method: "POST", body: {} }).then(function (r) {
      busy = false;
      if (!r.ok) { say(r.data.error || ("HTTP " + r.status), "err"); return; }
      load(); setTimeout(function () { say("Έγινε επαναφορά της προηγούμενης έκδοσης.", "ok"); }, 600);
    }).catch(function (e) { busy = false; say("Η επαναφορά απέτυχε: " + e.message, "err"); });
  }

  /* ---------- page ---------- */
  function render() {
    root.innerHTML = "";
    if (!adminToken) { root.innerHTML = '<section class="panel"><p class="hint">Ξεκλείδωσε πρώτα με το admin token από πάνω.</p></section>'; return; }
    if (!draft) { root.innerHTML = '<section class="panel"><div id="lexStatus" class="status"></div><p class="hint">Φόρτωση…</p></section>'; return; }
    var dirty = isDirty();
    var top = document.createElement("section"); top.className = "panel";
    var src = { data_dir: "αποθηκευμένο στον server", package: "από το πακέτο (χωρίς DATA_DIR, δεν αποθηκεύεται)", builtin: "ενσωματωμένο (το αρχείο είχε πρόβλημα)" }[meta.source] || meta.source;
    top.innerHTML = "<h3 style='margin-top:0'>📖 Λεξικό αναζήτησης</h3>" +
      '<div class="hint" style="margin-bottom:8px">Εδώ ορίζεις πώς καταλαβαίνει η αναζήτηση λέξεις όπως «δάσκαλος», «ναυτικός» ή «σεφ». Οι αλλαγές ισχύουν αμέσως μετά την αποθήκευση, χωρίς νέο πακέτο.</div>' +
      "<div class='hint'>Κατάσταση: <b>" + esc(src) + "</b> · backups: " + (meta.backups || 0) + "</div>" +
      (meta.error ? '<div class="banner err">⛔ Το λεξικό δεν φορτώθηκε σωστά και η αναζήτηση χρησιμοποιεί το ενσωματωμένο: ' + esc(meta.error) + "</div>" : "") +
      (!meta.can_save ? '<div class="banner warn">Ο server δεν έχει DATA_DIR, άρα οι αλλαγές δεν μπορούν να αποθηκευτούν.</div>' : "") +
      '<div id="lexStatus" class="status"></div>' +
      '<div class="toolbar" style="margin:10px 0 0"><button class="btn btn-primary" id="lexPreviewBtn"' + (dirty ? "" : " disabled") + '>🔍 Προεπισκόπηση αλλαγών</button>' +
      '<button class="btn btn-primary" id="lexSaveBtn" style="background:var(--green)"' + (dirty && lastPreview && previewOf === draftJson() && meta.can_save && !renderPreview(lastPreview).hasErr ? "" : " disabled") + '>💾 Αποθήκευση</button>' +
      '<button class="btn btn-secondary" id="lexResetBtn"' + (dirty ? "" : " disabled") + '>↩ Ακύρωση αλλαγών</button>' +
      '<button class="btn btn-secondary" id="lexRollbackBtn"' + (meta.backups && meta.can_save ? "" : " disabled") + '>⏪ Επαναφορά προηγούμενης έκδοσης</button></div>' +
      '<div class="hint">' + (dirty ? (lastPreview && previewOf === draftJson() ? "Έχεις δει την προεπισκόπηση αυτών των αλλαγών. Μπορείς να αποθηκεύσεις." : "Έχεις μη αποθηκευμένες αλλαγές. Πάτα «Προεπισκόπηση» για να δεις τι αλλάζει στα αποτελέσματα.") : "Καμία αλλαγή.") + "</div>";
    root.appendChild(top);
    if (lastPreview && previewOf === draftJson()) {
      var pv = document.createElement("section"); pv.className = "panel"; pv.id = "lexPreview";
      pv.innerHTML = "<h3 style='margin-top:0'>Τι αλλάζει στα αποτελέσματα</h3>" + renderPreview(lastPreview).html;
      root.appendChild(pv);
    }
    root.appendChild(sectionStopwords());
    root.appendChild(sectionCategoryWords());
    root.appendChild(sectionAudience());
    root.appendChild(sectionTopics());
    $("#lexPreviewBtn").addEventListener("click", doPreview);
    $("#lexSaveBtn").addEventListener("click", doSave);
    $("#lexResetBtn").addEventListener("click", function () { if (confirm("Να χαθούν οι αλλαγές που δεν έχουν αποθηκευτεί;")) { draft = clone(serverLex); rerender(); } });
    $("#lexRollbackBtn").addEventListener("click", doRollback);
  }
  window.addEventListener("beforeunload", function (e) { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });
  render();
})();
