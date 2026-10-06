(function () {
  "use strict";

  var root = document.getElementById("conceptManagementRoot");
  if (!root) return;

  var loaded = false;
  var current = null;
  var page = 1;
  var pageSize = 50;
  var searchTimer = null;

  var editMode = false;
  var draft = {};

  var previewResult = null;
  var previewSignature = null;
  var previewBusy = false;

  var publishBusy = false;
  var rollbackBusy = false;
  var lastPublishBackup = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[c];
    });
  }

  function api(url) {
    return fetch(url, {
      headers: { "x-admin-token": adminToken }
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
        return data;
      });
    });
  }

  function badge(status) {
    var bg = "#eef2f6";
    var fg = "#667085";
    var label = status || "UNCLASSIFIED";

    if (label === "CONFIRMED") {
      bg = "#ecfdf3"; fg = "#087443";
    } else if (label === "CURATED") {
      bg = "#eef4ff"; fg = "#1849a9";
    } else if (label === "REVIEW") {
      bg = "#fff4e5"; fg = "#a15c00";
    } else if (label === "REJECT") {
      bg = "#fdecec"; fg = "#b3261e";
    }

    return '<span style="display:inline-block;padding:4px 8px;border-radius:999px;background:' +
      bg + ';color:' + fg + ';font-size:12px;font-weight:bold">' +
      esc(label) + "</span>";
  }

  function renderShell() {
    root.innerHTML = [
      '<section class="panel">',
        '<div class="toolbar">',
          '<div>',
            '<h3 style="margin:0 0 4px">🧭 Concept Management</h3>',
            '<div class="hint">',
              'All Programs · Search · Filters · Pagination · Signal Explanation · Controlled Draft Editing',
            '</div>',
          '</div>',
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">',
            '<span id="cmDraftCount" class="counter">Draft changes: 0</span>',
            '<button id="cmPreviewDraft" type="button" class="btn btn-secondary" disabled>Preview Draft</button>',
            '<button id="cmPublishDraft" type="button" class="btn btn-primary" disabled>Publish Draft</button>',
            '<button id="cmRollbackPublish" type="button" class="btn btn-secondary" style="display:none" disabled>Rollback Last Publish</button>',
            '<button id="cmDiscardDraft" type="button" class="btn btn-secondary" disabled>Discard Draft</button>',
            '<button id="cmEditMode" type="button" class="btn btn-primary">Edit Mode: OFF</button>',
          '</div>',
        '</div>',

        '<div id="cmStatus" class="status"></div>',

        '<div class="toolbar">',
          '<select id="cmConcept" class="lex-select" style="max-width:240px"></select>',

          '<input id="cmSearch" type="search" ',
            'placeholder="Αναζήτηση τίτλου ή slug..." ',
            'class="lex-input" style="flex:1">',

          '<select id="cmAssigned" class="lex-select" style="max-width:180px">',
            '<option value="all">Assigned: Όλα</option>',
            '<option value="yes">Μόνο Assigned</option>',
            '<option value="no">Μόνο Not Assigned</option>',
          '</select>',

          '<select id="cmStatusFilter" class="lex-select" style="max-width:190px">',
            '<option value="">Όλα τα statuses</option>',
            '<option value="CONFIRMED">CONFIRMED</option>',
            '<option value="CURATED">CURATED</option>',
            '<option value="REVIEW">REVIEW</option>',
            '<option value="REJECT">REJECT</option>',
            '<option value="UNCLASSIFIED">UNCLASSIFIED</option>',
          '</select>',
        '</div>',

        '<div id="cmSummary"></div>',
        '<div id="cmPreviewPanel"></div>',
        '<div id="cmPaginationTop"></div>',
        '<div id="cmPrograms"></div>',
        '<div id="cmPaginationBottom"></div>',
      '</section>'
    ].join("");

    document.getElementById("cmConcept").addEventListener("change", function () {
      page = 1;
      loadPrograms();
    });

    document.getElementById("cmAssigned").addEventListener("change", function () {
      page = 1;
      loadPrograms();
    });

    document.getElementById("cmStatusFilter").addEventListener("change", function () {
      page = 1;
      loadPrograms();
    });

    document.getElementById("cmSearch").addEventListener("input", function () {
      clearTimeout(searchTimer);
      page = 1;
      searchTimer = setTimeout(loadPrograms, 250);
    });

    document.getElementById("cmEditMode").addEventListener("click", function () {
      editMode = !editMode;
      updateEditModeUi();
      if (current) renderPrograms(current);
    });

    document.getElementById("cmPreviewDraft").addEventListener("click", function () {
      previewDraft();
    });

    document.getElementById("cmPublishDraft").addEventListener("click", function () {
      publishDraft();
    });

    document.getElementById("cmRollbackPublish").addEventListener("click", function () {
      rollbackLastPublish();
    });

    document.getElementById("cmDiscardDraft").addEventListener("click", function () {
      if (!Object.keys(draft).length) return;
      if (!window.confirm("Απόρριψη όλων των μη αποθηκευμένων Draft αλλαγών;")) return;
      draft = {};
      invalidatePreview();
      updateDraftUi();
      if (current) renderPrograms(current);
    });
  }

  function currentDraftChanges() {
    if (!current || !current.concept) return [];

    return Object.values(draft)
      .filter(function (d) {
        return d.concept === current.concept;
      })
      .sort(function (a, b) {
        return String(a.slug).localeCompare(String(b.slug));
      });
  }

  function currentDraftSignature() {
    return JSON.stringify(currentDraftChanges());
  }

  function invalidatePreview() {
    previewResult = null;
    previewSignature = null;

    var panel = document.getElementById("cmPreviewPanel");
    if (panel) panel.innerHTML = "";
  }

  function updateEditModeUi() {
    var btn = document.getElementById("cmEditMode");
    if (!btn) return;

    btn.textContent = "Edit Mode: " + (editMode ? "ON" : "OFF");
    btn.className = editMode ? "btn btn-danger" : "btn btn-primary";
  }

  function updateDraftUi() {
    var count = Object.keys(draft).length;
    var currentCount = currentDraftChanges().length;

    var label = document.getElementById("cmDraftCount");
    if (label) {
      label.textContent =
        "Draft changes: " + count +
        (current ? " · current concept: " + currentCount : "");
    }

    var discard = document.getElementById("cmDiscardDraft");
    if (discard) {
      discard.disabled = count === 0 || publishBusy || rollbackBusy;
    }

    var preview = document.getElementById("cmPreviewDraft");
    if (preview) {
      preview.disabled =
        previewBusy ||
        publishBusy ||
        rollbackBusy ||
        currentCount === 0;

      preview.textContent = previewBusy
        ? "Preview running..."
        : "Preview Draft" + (currentCount ? " (" + currentCount + ")" : "");
    }

    var publish = document.getElementById("cmPublishDraft");
    if (publish) {
      var previewCurrent =
        !!previewResult &&
        !previewResult.blocked &&
        !!previewResult.base_version &&
        previewSignature === currentDraftSignature();

      publish.disabled =
        publishBusy ||
        previewBusy ||
        rollbackBusy ||
        currentCount === 0 ||
        !previewCurrent;

      publish.textContent = publishBusy
        ? "Publishing..."
        : "Publish Draft";
    }

    var rollback = document.getElementById("cmRollbackPublish");
    if (rollback) {
      rollback.style.display = lastPublishBackup ? "" : "none";
      rollback.disabled =
        rollbackBusy ||
        publishBusy ||
        previewBusy ||
        !lastPublishBackup;

      rollback.textContent = rollbackBusy
        ? "Rolling back..."
        : "Rollback Last Publish";
    }
  }

  function draftKey(concept, slug) {
    return concept + "::" + slug;
  }

  function effectiveProgram(p) {
    if (!current) return p;

    var key = draftKey(current.concept, p.slug);
    var d = draft[key];

    if (!d) return p;

    return Object.assign({}, p, {
      assigned: d.assigned,
      assignment_status: d.assignment_status,
      source: d.source,
      reason: d.reason
    });
  }

  function setDraftField(p, field, value) {
    if (!current) return;

    var key = draftKey(current.concept, p.slug);
    var existing = draft[key];

    if (!existing) {
      existing = {
        slug: p.slug,
        concept: current.concept,
        assigned: p.assigned,
        assignment_status: p.assignment_status,
        source: p.source || "",
        reason: p.reason || ""
      };
    }

    existing[field] = value;

    var same =
      existing.assigned === p.assigned &&
      existing.assignment_status === p.assignment_status &&
      existing.source === (p.source || "") &&
      existing.reason === (p.reason || "");

    if (same) {
      delete draft[key];
    } else {
      draft[key] = existing;
    }

    invalidatePreview();
    updateDraftUi();
    renderPrograms(current);
  }

  function say(msg, type) {
    var el = document.getElementById("cmStatus");
    if (!el) return;
    el.textContent = msg;
    el.className = "status " + (type || "info");
  }

  function renderSummary(data) {
    var c = data.status_counts || {};

    document.getElementById("cmSummary").innerHTML = [
      '<div class="kpis">',
        '<div class="kpi"><b>' + esc(data.catalog_total) + '</b><span>catalog programs</span></div>',
        '<div class="kpi"><b>' + esc(data.active_programs) + '</b><span>active</span></div>',
        '<div class="kpi"><b>' + esc(data.audited_count) + '</b><span>audited για το concept</span></div>',
        '<div class="kpi"><b>' + esc(data.assigned_count) + '</b><span>assigned</span></div>',
        '<div class="kpi"><b>' + esc(c.CONFIRMED || 0) + '</b><span>CONFIRMED</span></div>',
        '<div class="kpi"><b>' + esc(c.CURATED || 0) + '</b><span>CURATED</span></div>',
        '<div class="kpi"><b>' + esc(c.REVIEW || 0) + '</b><span>REVIEW</span></div>',
        '<div class="kpi"><b>' + esc(c.REJECT || 0) + '</b><span>REJECT</span></div>',
      '</div>',

      '<div class="banner ok">',
        '<b>Concept:</b> ' + esc(data.concept) +
        ' &nbsp; <b>Queries/terms:</b> ' +
        esc((data.concept_terms || []).join(", ") || "—"),
      '</div>'
    ].join("");
  }

  function signalLine(label, values) {
    if (!values || !values.length) return "";
    return '<div style="margin:3px 0"><b>' + esc(label) + ':</b> ' +
      esc(values.join(" · ")) + '</div>';
  }

  function renderSignalExplanation(p) {
    var s = p.signal_explanation || {};
    var html = "";

    if (s.explicit_assignment) {
      html += '<div style="margin:3px 0;color:#087443"><b>✓ Explicit concept assignment</b></div>';
    }

    if (s.audit_record) {
      html += '<div style="margin:3px 0"><b>✓ Audit record:</b> ' +
        esc(p.assignment_status || "UNCLASSIFIED") + '</div>';
    }

    html += signalLine("Primary area match", s.primary_area_matches);
    html += signalLine("Areas of study match", s.areas_of_study_matches);
    html += signalLine("CMS tag match", s.cms_tag_matches);
    html += signalLine("Generated tag match", s.generated_tag_matches);

    if (!html) {
      html = '<div class="hint">Δεν υπάρχει άμεσο signal για αυτό το concept.</div>';
    }

    return html;
  }

  function renderPrograms(data) {
    var rows = data.programs || [];

    var html = '<div class="counter" style="margin:12px 0">' +
      'Εμφάνιση ' + rows.length +
      ' από ' + data.filtered_total +
      ' αποτελέσματα' +
      '</div>';

    if (!rows.length) {
      html += '<div class="banner warn">Δεν βρέθηκαν προγράμματα με αυτά τα φίλτρα.</div>';
      document.getElementById("cmPrograms").innerHTML = html;
      return;
    }

    html += rows.map(function (raw) {
      var p = effectiveProgram(raw);
      var hasDraft = !!draft[draftKey(data.concept, raw.slug)];

      return [
        '<div class="concept-card"' + (hasDraft ? ' style="border:2px solid #a15c00"' : '') + '>',

          '<div class="concept-head">',
            '<div>',
              '<div style="font-weight:bold;font-size:15px">' + esc(p.title) + '</div>',
              '<div class="hint">' + esc(p.slug) + '</div>',
            '</div>',

            '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">',
              editMode
                ? (
                  '<label style="font-size:12px;font-weight:bold;cursor:pointer">' +
                  '<input type="checkbox" class="cmAssignedEdit" data-slug="' + esc(raw.slug) + '" ' +
                  (p.assigned ? 'checked' : '') + '> ASSIGNED' +
                  '</label>' +
                  '<select class="lex-select cmStatusEdit" data-slug="' + esc(raw.slug) + '" style="max-width:160px">' +
                    '<option value=""' + (!p.assignment_status ? ' selected' : '') + '>UNCLASSIFIED</option>' +
                    '<option value="CONFIRMED"' + (p.assignment_status === "CONFIRMED" ? ' selected' : '') + '>CONFIRMED</option>' +
                    '<option value="CURATED"' + (p.assignment_status === "CURATED" ? ' selected' : '') + '>CURATED</option>' +
                    '<option value="REVIEW"' + (p.assignment_status === "REVIEW" ? ' selected' : '') + '>REVIEW</option>' +
                    '<option value="REJECT"' + (p.assignment_status === "REJECT" ? ' selected' : '') + '>REJECT</option>' +
                  '</select>'
                )
                : (
                  p.assigned
                    ? '<span style="font-size:12px;color:#087443;font-weight:bold">✓ ASSIGNED</span>'
                    : '<span style="font-size:12px;color:#667085">NOT ASSIGNED</span>' +
                      badge(p.assignment_status)
                ),
            '</div>',
          '</div>',

          '<table class="data-table">',
            '<tbody>',
              '<tr><th style="width:170px">Primary area</th><td>' +
                esc(p.primary_area || "—") + '</td></tr>',

              '<tr><th>Areas of study</th><td>' +
                esc((p.areas_of_study || []).join(" · ") || "—") + '</td></tr>',

              '<tr><th>Source</th><td>' +
                (editMode
                  ? '<input class="lex-input cmSourceEdit" data-slug="' + esc(raw.slug) + '" value="' + esc(p.source || "") + '" placeholder="source / provenance">'
                  : esc(p.source || "—")) +
                '</td></tr>',

              '<tr><th>Reason</th><td>' +
                (editMode
                  ? '<textarea class="lex-input cmReasonEdit" data-slug="' + esc(raw.slug) + '" rows="3" placeholder="reason / rationale">' + esc(p.reason || "") + '</textarea>'
                  : esc(p.reason || "—")) +
                '</td></tr>',

              '<tr><th>Program concepts</th><td>' +
                esc((p.concepts || []).join(" · ") || "—") + '</td></tr>',

              '<tr><th>CMS tags</th><td>' +
                esc((p.tags_cms || []).join(" · ") || "—") + '</td></tr>',

              '<tr><th>Generated tags</th><td>' +
                esc((p.tags || []).join(" · ") || "—") + '</td></tr>',
            '</tbody>',
          '</table>',

          '<details class="change-list" style="margin-top:10px">',
            '<summary><b>Why is this program here? / Signal Explanation</b></summary>',
            '<div style="padding:8px 2px;font-size:13px">',
              renderSignalExplanation(p),
              p.source
                ? '<div style="margin-top:8px"><b>Provenance source:</b> ' +
                  esc(p.source) + '</div>'
                : '',
              p.reason
                ? '<div style="margin-top:4px"><b>Reason:</b> ' +
                  esc(p.reason) + '</div>'
                : '',
            '</div>',
          '</details>',

        '</div>'
      ].join("");
    }).join("");

    document.getElementById("cmPrograms").innerHTML = html;

    if (editMode) {
      document.querySelectorAll(".cmAssignedEdit").forEach(function (el) {
        el.addEventListener("change", function () {
          var raw = rows.find(function (x) { return x.slug === el.dataset.slug; });
          if (raw) setDraftField(raw, "assigned", !!el.checked);
        });
      });

      document.querySelectorAll(".cmStatusEdit").forEach(function (el) {
        el.addEventListener("change", function () {
          var raw = rows.find(function (x) { return x.slug === el.dataset.slug; });
          if (raw) setDraftField(raw, "assignment_status", el.value || null);
        });
      });

      document.querySelectorAll(".cmSourceEdit").forEach(function (el) {
        el.addEventListener("change", function () {
          var raw = rows.find(function (x) { return x.slug === el.dataset.slug; });
          if (raw) setDraftField(raw, "source", el.value || "");
        });
      });

      document.querySelectorAll(".cmReasonEdit").forEach(function (el) {
        el.addEventListener("change", function () {
          var raw = rows.find(function (x) { return x.slug === el.dataset.slug; });
          if (raw) setDraftField(raw, "reason", el.value || "");
        });
      });
    }

    updateDraftUi();
  }

  function paginationHtml(data) {
    if (!data || data.pages <= 1) return "";

    return [
      '<div class="toolbar" style="margin:14px 0">',
        '<button type="button" class="btn btn-secondary cmPrev" ',
          data.page <= 1 ? 'disabled' : '', '>← Προηγούμενη</button>',

        '<span class="counter">',
          'Σελίδα <b>' + data.page + '</b> από <b>' + data.pages + '</b>',
          ' · ' + data.filtered_total + ' αποτελέσματα',
        '</span>',

        '<button type="button" class="btn btn-secondary cmNext" ',
          data.page >= data.pages ? 'disabled' : '', '>Επόμενη →</button>',
      '</div>'
    ].join("");
  }

  function attachPagination(data) {
    ["cmPaginationTop", "cmPaginationBottom"].forEach(function (id) {
      var el = document.getElementById(id);
      el.innerHTML = paginationHtml(data);

      var prev = el.querySelector(".cmPrev");
      var next = el.querySelector(".cmNext");

      if (prev) {
        prev.addEventListener("click", function () {
          if (page > 1) {
            page--;
            loadPrograms();
            window.scrollTo({ top: root.offsetTop - 20, behavior: "smooth" });
          }
        });
      }

      if (next) {
        next.addEventListener("click", function () {
          if (page < data.pages) {
            page++;
            loadPrograms();
            window.scrollTo({ top: root.offsetTop - 20, behavior: "smooth" });
          }
        });
      }
    });
  }

  function renderPreview(result) {
    var panel = document.getElementById("cmPreviewPanel");
    if (!panel) return;

    if (!result) {
      panel.innerHTML = "";
      return;
    }

    var protectedCheck = result.protected_baseline || {};
    var ranking = result.ranking || {};
    var changes = result.changes || [];
    var failures = protectedCheck.failures || [];

    var statusHtml = result.blocked
      ? '<div class="banner err"><b>⛔ BLOCKED</b> — Η αλλαγή παραβιάζει το Protected Baseline. Δεν επιτρέπεται Publish.</div>'
      : '<div class="banner ok"><b>✓ PREVIEW PASS</b> — Το Protected Baseline παραμένει ανέγγιχτο.</div>';

    var programHtml = changes.map(function (c) {
      var b = c.before || {};
      var a = c.after || {};

      return [
        '<details class="change-list" open>',
          '<summary><b>' + esc(c.title || c.slug) + '</b></summary>',
          '<table class="data-table">',
            '<thead>',
              '<tr><th>Field</th><th>Before</th><th>After</th></tr>',
            '</thead>',
            '<tbody>',
              '<tr><td>Assigned</td><td>' + esc(String(b.assigned)) + '</td><td>' + esc(String(a.assigned)) + '</td></tr>',
              '<tr><td>Status</td><td>' + esc(b.assignment_status || "UNCLASSIFIED") + '</td><td>' + esc(a.assignment_status || "UNCLASSIFIED") + '</td></tr>',
              '<tr><td>Source</td><td>' + esc(b.source || "—") + '</td><td>' + esc(a.source || "—") + '</td></tr>',
              '<tr><td>Reason</td><td>' + esc(b.reason || "—") + '</td><td>' + esc(a.reason || "—") + '</td></tr>',
            '</tbody>',
          '</table>',
        '</details>'
      ].join("");
    }).join("");

    var failureHtml = "";

    if (failures.length) {
      failureHtml = [
        '<h4 style="margin:16px 0 8px">Protected queries που επηρεάζονται</h4>',
        '<table class="data-table">',
          '<thead><tr><th>Query</th><th>Reason</th><th>Results</th></tr></thead>',
          '<tbody>',
            failures.map(function (f) {
              var totals = "";

              if (
                f.expected_total != null ||
                f.actual_total != null
              ) {
                totals =
                  esc(String(f.expected_total == null ? "—" : f.expected_total)) +
                  " → " +
                  esc(String(f.actual_total == null ? "—" : f.actual_total));
              } else {
                totals = "top-10 changed";
              }

              return '<tr>' +
                '<td><b>' + esc(f.query || "—") + '</b></td>' +
                '<td>' + esc(f.reason || "—") + '</td>' +
                '<td>' + totals + '</td>' +
                '</tr>';
            }).join(""),
          '</tbody>',
        '</table>'
      ].join("");
    }

    var rankingHtml = [
      '<div class="kpis" style="margin-top:14px">',
        '<div class="kpi"><b>' + esc(result.draft_changes || 0) + '</b><span>draft changes</span></div>',
        '<div class="kpi"><b>' + esc(ranking.queries || 0) + '</b><span>queries checked</span></div>',
        '<div class="kpi"><b>' + esc(ranking.changed || 0) + '</b><span>ranking changes</span></div>',
        '<div class="kpi"><b>' + esc(protectedCheck.ok ? "PASS" : "FAIL") + '</b><span>protected baseline</span></div>',
      '</div>'
    ].join("");

    var rankingDetails = "";

    if (ranking.groups) {
      rankingDetails = ranking.groups.map(function (g) {
        if (!g.changed) return "";

        return [
          '<details class="change-list">',
            '<summary><b>' + esc(g.label) + '</b>: άλλαξαν ' +
              esc(g.changed) + ' από ' + esc(g.queries) + '</summary>',
            (g.changes || []).map(function (c) {
              return [
                '<div class="ranking-q">',
                  '«' + esc(c.query) + '» ',
                  '<small>σύνολο ' +
                    esc(c.total_before) + ' → ' +
                    esc(c.total_after) +
                  '</small>',
                '</div>',
                (c.added || []).map(function (a) {
                  return '<div class="plus">+ #' +
                    esc(a.position) + ' ' +
                    esc(a.title || a.slug) +
                    '</div>';
                }).join(""),
                (c.removed || []).map(function (r) {
                  return '<div class="minus">− ήταν #' +
                    esc(r.position) + ' ' +
                    esc(r.title || r.slug) +
                    '</div>';
                }).join("")
              ].join("");
            }).join(""),
          '</details>'
        ].join("");
      }).join("");
    }

    panel.innerHTML = [
      '<section class="panel" style="border:2px solid ' +
        (result.blocked ? '#b3261e' : '#087443') + '">',
        '<h3 style="margin-top:0">Preview Draft Impact</h3>',
        statusHtml,
        rankingHtml,
        '<h4 style="margin:16px 0 8px">Program changes</h4>',
        programHtml || '<div class="hint">Καμία αλλαγή.</div>',
        failureHtml,
        rankingDetails
          ? '<h4 style="margin:16px 0 8px">Ranking impact</h4>' + rankingDetails
          : '',
        '<div class="hint" style="margin-top:14px">',
          'Preview only — δεν γράφτηκε κανένα αρχείο και δεν άλλαξαν live δεδομένα.',
        '</div>',
      '</section>'
    ].join("");
  }

  function previewDraft() {
    if (previewBusy || !current) return;

    var changes = currentDraftChanges();

    if (!changes.length) {
      say("Δεν υπάρχουν Draft αλλαγές για το επιλεγμένο concept.", "info");
      return;
    }

    previewBusy = true;
    updateDraftUi();
    say("Υπολογίζεται Preview + Protected Regression...", "info");

    fetch("/api/admin/concept-management/preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": adminToken
      },
      body: JSON.stringify({
        concept: current.concept,
        changes: changes
      })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
          return data;
        });
      })
      .then(function (data) {
        previewResult = data;
        previewSignature = currentDraftSignature();

        renderPreview(data);

        say(
          data.blocked
            ? "Preview ολοκληρώθηκε: BLOCKED από το Protected Baseline."
            : "Preview ολοκληρώθηκε: PASS.",
          data.blocked ? "err" : "ok"
        );

        var panel = document.getElementById("cmPreviewPanel");
        if (panel && panel.scrollIntoView) {
          panel.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        }
      })
      .catch(function (e) {
        invalidatePreview();
        say("Το Preview απέτυχε: " + e.message, "err");
      })
      .then(function () {
        previewBusy = false;
        updateDraftUi();
      });
  }

  function renderPublishOutcome(kind, data) {
    var panel = document.getElementById("cmPreviewPanel");
    if (!panel) return;

    if (kind === "published") {
      panel.innerHTML = [
        '<section class="panel" style="border:2px solid #087443">',
          '<div class="banner ok">',
            '<b>✓ PUBLISHED</b> — Οι αλλαγές γράφτηκαν επιτυχώς και πέρασαν το post-publish verification.',
          '</div>',
          '<div class="kpis" style="margin-top:14px">',
            '<div class="kpi"><b>' + esc(data.draft_changes || 0) + '</b><span>published changes</span></div>',
            '<div class="kpi"><b>PASS</b><span>protected baseline</span></div>',
            '<div class="kpi"><b>' + esc((data.live && data.live.total) || "—") + '</b><span>catalog programs</span></div>',
            '<div class="kpi"><b>' + esc((data.live && data.live.active) || "—") + '</b><span>active programs</span></div>',
          '</div>',
          '<div class="hint" style="margin-top:12px">',
            '<b>Backup:</b> ' + esc(data.backup_file || "—"),
          '</div>',
        '</section>'
      ].join("");
      return;
    }

    if (kind === "rolled-back") {
      panel.innerHTML = [
        '<section class="panel" style="border:2px solid #a15c00">',
          '<div class="banner warn">',
            '<b>↶ ROLLBACK COMPLETE</b> — Η προηγούμενη έκδοση του catalog αποκαταστάθηκε.',
          '</div>',
          '<div class="hint" style="margin-top:12px">',
            '<b>Restored from:</b> ' +
            esc((data.live && data.live.restored_from) || "—"),
          '</div>',
        '</section>'
      ].join("");
      return;
    }

    if (kind === "auto-rollback") {
      panel.innerHTML = [
        '<section class="panel" style="border:2px solid #b3261e">',
          '<div class="banner err">',
            '<b>Publish failed safely.</b> Το post-publish verification απέτυχε και ο server έκανε automatic rollback.',
          '</div>',
          '<div class="hint" style="margin-top:12px">',
            'Τα προηγούμενα live δεδομένα αποκαταστάθηκαν.',
          '</div>',
        '</section>'
      ].join("");
    }
  }

  function publishDraft() {
    if (publishBusy || previewBusy || rollbackBusy || !current) return;

    var changes = currentDraftChanges();

    var previewCurrent =
      !!previewResult &&
      !previewResult.blocked &&
      !!previewResult.base_version &&
      previewSignature === currentDraftSignature();

    if (!changes.length) {
      say("Δεν υπάρχουν Draft αλλαγές για Publish.", "info");
      return;
    }

    if (!previewCurrent) {
      say("Απαιτείται νέο PASS Preview πριν από το Publish.", "err");
      updateDraftUi();
      return;
    }

    if (!window.confirm(
      "Να γίνει Publish των " + changes.length +
      " αλλαγών για το concept «" + current.concept + "»;\\n\\n" +
      "Ο server θα ξανατρέξει validation, θα δημιουργήσει backup και θα κάνει post-publish verification."
    )) {
      return;
    }

    publishBusy = true;
    updateDraftUi();
    say("Γίνεται server-side validation και Safe Publish...", "info");

    fetch("/api/admin/concept-management/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": adminToken
      },
      body: JSON.stringify({
        concept: current.concept,
        changes: changes,
        base_version: previewResult.base_version,
        confirm: true
      })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) {
            var e = new Error(data.error || ("HTTP " + r.status));
            e.status = r.status;
            e.data = data;
            throw e;
          }
          return data;
        });
      })
      .then(function (data) {
        lastPublishBackup = data.backup_file || null;

        draft = {};
        previewResult = null;
        previewSignature = null;

        renderPublishOutcome("published", data);
        say(
          "Publish ολοκληρώθηκε επιτυχώς και το post-publish verification είναι PASS.",
          "ok"
        );

        loadPrograms();
      })
      .catch(function (e) {
        var data = e.data || {};

        if (
          e.status === 409 &&
          /stale|άλλαξε/i.test(String(data.error || e.message))
        ) {
          invalidatePreview();
          say(
            "Το Draft είναι stale. Ο κατάλογος άλλαξε — τρέξε νέο Preview.",
            "err"
          );
        } else if (
          e.status === 409 &&
          data.preview &&
          data.preview.blocked
        ) {
          previewResult = data.preview;
          previewSignature = currentDraftSignature();
          renderPreview(data.preview);
          say("Publish BLOCKED από το Protected Baseline.", "err");
        } else if (
          e.status === 500 &&
          data.rolled_back === true
        ) {
          invalidatePreview();
          lastPublishBackup = null;
          renderPublishOutcome("auto-rollback", data);
          say(
            "Το Publish απέτυχε, αλλά έγινε επιτυχές automatic rollback.",
            "err"
          );
          loadPrograms();
        } else {
          say(
            "Το Publish απέτυχε: " + (data.error || e.message),
            "err"
          );
        }
      })
      .then(function () {
        publishBusy = false;
        updateDraftUi();
      });
  }

  function rollbackLastPublish() {
    if (rollbackBusy || publishBusy || !lastPublishBackup) return;

    var backup = lastPublishBackup;

    if (!window.confirm(
      "Να γίνει rollback στο backup:\\n\\n" +
      backup +
      "\\n\\nΗ τρέχουσα έκδοση θα κρατηθεί επίσης ως before-rollback backup."
    )) {
      return;
    }

    rollbackBusy = true;
    updateDraftUi();
    say("Γίνεται rollback στην προηγούμενη έκδοση...", "info");

    fetch("/api/admin/catalog/rollback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": adminToken
      },
      body: JSON.stringify({
        file: backup
      })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
          return data;
        });
      })
      .then(function (data) {
        lastPublishBackup = null;
        draft = {};
        invalidatePreview();

        renderPublishOutcome("rolled-back", data);
        say(
          "Rollback ολοκληρώθηκε. Η προηγούμενη έκδοση αποκαταστάθηκε.",
          "ok"
        );

        loadPrograms();
      })
      .catch(function (e) {
        say("Το Rollback απέτυχε: " + e.message, "err");
      })
      .then(function () {
        rollbackBusy = false;
        updateDraftUi();
      });
  }

  function loadPrograms() {
    if (!adminToken) {
      say("Ξεκλείδωσε πρώτα το admin panel.", "info");
      return;
    }

    var concept = document.getElementById("cmConcept").value;
    if (!concept) return;

    var search = document.getElementById("cmSearch").value || "";
    var assigned = document.getElementById("cmAssigned").value || "all";
    var status = document.getElementById("cmStatusFilter").value || "";

    var params = new URLSearchParams();
    params.set("concept", concept);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    params.set("assigned", assigned);

    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);

    say("Φόρτωση προγραμμάτων...", "info");

    api("/api/admin/concept-management?" + params.toString())
      .then(function (data) {
        current = data;
        page = data.page;

        if (
          previewSignature &&
          previewSignature !== currentDraftSignature()
        ) {
          invalidatePreview();
        }

        renderSummary(data);
        renderPrograms(data);
        attachPagination(data);

        say("Τα δεδομένα φορτώθηκαν.", "ok");
      })
      .catch(function (e) {
        say("Αποτυχία φόρτωσης: " + e.message, "err");
      });
  }

  function loadConceptList() {
    api("/api/admin/concept-management")
      .then(function (data) {
        var list = data.concepts || [];
        var sel = document.getElementById("cmConcept");

        sel.innerHTML = list.map(function (c) {
          return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
        }).join("");

        var initial = list.indexOf("law") >= 0 ? "law" : list[0];

        if (initial) {
          sel.value = initial;
          page = 1;
          loadPrograms();
        }
      })
      .catch(function (e) {
        say("Αποτυχία φόρτωσης concepts: " + e.message, "err");
      });
  }

  window.conceptManagementOnShow = function () {
    if (!root.innerHTML) renderShell();

    if (!adminToken) {
      say("Ξεκλείδωσε πρώτα το admin panel με το admin token.", "info");
      return;
    }

    if (!loaded) {
      loaded = true;
      loadConceptList();
    }
  };

  window.conceptManagementOnUnlock = function () {
    loaded = false;

    var tab = document.getElementById("tab-concept-management");
    if (tab && tab.style.display !== "none") {
      loaded = true;
      loadConceptList();
    }
  };

  renderShell();
})();
