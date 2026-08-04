/**
 * Spells — browse spellbook + Cast generative workspace.
 */
(function () {
  "use strict";

  var PAGE_SIZE = 60;
  var PINNED_KEY = "spells-pinned-v1";
  var CAST_TRAY_SLICE = 36;
  var FETCH_TIMEOUT_MS = 90000;
  var POLL_INTERVAL_MS = 900;
  var FIRST_POLL_DELAY_MS = 600;
  var MAX_IMPORT_BYTES = 8 * 1024 * 1024;

  var state = {
    view: "cast",
    all: [],
    filtered: [],
    shown: 0,
    selected: null,
    pinned: {},
    ready: false,
    cast: {
      pool: [],
      poolReady: false,
      trayItems: [],
      applied: [],
      imageUrl: "",
      importSourceUrl: "",
      imageDescription: "",
      importAnalysis: null,
      importAnalyzing: false,
      imported: false,
      generating: false,
      continuityId: "",
      drag: null,
    },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function parseApiResponse(res) {
    if (window.parseGalleryApiResponse) return window.parseGalleryApiResponse(res);
    return res.json();
  }

  function fetchWithTimeout(url, options, ms) {
    ms = ms || FETCH_TIMEOUT_MS;
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      options = options || {};
      options.signal = AbortSignal.timeout(ms);
      return fetch(url, options);
    }
    return fetch(url, options);
  }

  function loadPinned() {
    try {
      var raw = JSON.parse(localStorage.getItem(PINNED_KEY) || "{}");
      state.pinned = raw && typeof raw === "object" ? raw : {};
    } catch (_e) {
      state.pinned = {};
    }
  }

  function savePinned() {
    try {
      localStorage.setItem(PINNED_KEY, JSON.stringify(state.pinned));
    } catch (_e) {
      /* ignore */
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setView(mode) {
    state.view = mode === "browse" ? "browse" : "cast";
    document.querySelectorAll(".sp-mode-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.spMode === state.view);
    });
    var castView = $("sp-cast-view");
    var browseView = $("sp-browse-view");
    var hintCast = $("sp-hint-cast");
    var hintBrowse = $("sp-hint-browse");
    if (castView) castView.hidden = state.view !== "cast";
    if (browseView) browseView.hidden = state.view !== "browse";
    if (hintCast) hintCast.hidden = state.view !== "cast";
    if (hintBrowse) hintBrowse.hidden = state.view !== "browse";
    if (state.view === "cast") loadCastPool();
  }

  function buildSpellText(num, analysis) {
    analysis = analysis || {};
    var lines = [];
    lines.push("Spell #" + num + " — " + (analysis.title || "Untitled"));
    var meta = [];
    if (analysis.style) meta.push("Style: " + analysis.style);
    if (analysis.mood) meta.push("Mood: " + analysis.mood);
    if (analysis.medium) meta.push("Medium: " + analysis.medium);
    if (meta.length) lines.push(meta.join(" · "));
    if (analysis.tags && analysis.tags.length) lines.push("Tags: " + analysis.tags.join(", "));
    if (analysis.colors && analysis.colors.length) lines.push("Colors: " + analysis.colors.join(", "));
    if (analysis.description) lines.push("", analysis.description);
    return lines.join("\n");
  }

  function spellRow(m) {
    var num = m.number;
    var analysis = window.getGalleryAnalysis ? window.getGalleryAnalysis(num) : null;
    return {
      number: num,
      url: window.getPaintingUrl ? window.getPaintingUrl(num) : "paintings/" + num + ".jpg",
      analysis: analysis,
      title: (analysis && analysis.title) || "Painting #" + num,
      style: (analysis && analysis.style) || "",
      mood: (analysis && analysis.mood) || "",
      tags: (analysis && analysis.tags) || [],
      paintingNum: num,
      label: "#" + num,
      searchText: window.buildMetadataSearchText
        ? window.buildMetadataSearchText(analysis)
        : String(num),
    };
  }

  function normalizeCastItem(item) {
    item = item || {};
    var num = item.paintingNum || item.number || item.painting_num || null;
    if (num && !item.analysis && window.getGalleryAnalysis) {
      item.analysis = window.getGalleryAnalysis(num);
    }
    return {
      url: item.url || "",
      label: item.label || (num ? "#" + num : "Spell"),
      paintingNum: num,
      title: item.title || (item.analysis && item.analysis.title) || item.label || "",
      tags: item.tags || (item.analysis && item.analysis.tags) || [],
    };
  }

  function setCastStatus(msg, kind) {
    var el = $("sp-cast-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "sp-cast-status" + (kind ? " " + kind : "");
  }

  function paintingNumsFromSpells(spells) {
    var nums = [];
    (spells || []).forEach(function (s) {
      if (s.paintingNum && nums.indexOf(s.paintingNum) < 0) nums.push(s.paintingNum);
    });
    return nums.sort(function (a, b) {
      return a - b;
    });
  }

  function getCastSubject() {
    var el = $("sp-cast-subject");
    return el && el.value ? el.value.trim() : "";
  }

  function setCastSubject(text) {
    var el = $("sp-cast-subject");
    if (el) el.value = text || "";
    state.cast.imageDescription = text || "";
  }

  function showCastSubjectPanel(show) {
    var wrap = $("sp-cast-subject-wrap");
    if (wrap) wrap.hidden = !show;
  }

  function resetCastScopeForNewImport() {
    state.cast.applied = [];
    state.cast.continuityId = "";
    state.cast.importAnalysis = null;
    renderCastApplied();
    setCastSubject("");
    renderImportAnalysis();
    updateImportActions();
  }

  function formatAnalysisBlock(analysis) {
    analysis = analysis || {};
    var lines = [];
    if (analysis.title) lines.push('Title: "' + analysis.title + '"');
    if (analysis.description) lines.push(analysis.description);
    var meta = [];
    if (analysis.style) meta.push("Style: " + analysis.style);
    if (analysis.mood) meta.push("Mood: " + analysis.mood);
    if (analysis.medium) meta.push("Medium: " + analysis.medium);
    if (analysis.subject_type) meta.push("Subject: " + analysis.subject_type);
    if (meta.length) lines.push(meta.join(" · "));
    if (analysis.tags && analysis.tags.length) lines.push("Tags: " + analysis.tags.join(", "));
    if (analysis.colors && analysis.colors.length) lines.push("Colors: " + analysis.colors.join(", "));
    return lines.join("\n");
  }

  function buildDescriptionFromAnalysis(analysis) {
    analysis = analysis || {};
    var parts = [];
    if (analysis.title) parts.push(analysis.title);
    if (analysis.description) parts.push(analysis.description);
    var meta = [];
    if (analysis.style) meta.push(analysis.style + " style");
    if (analysis.mood) meta.push(analysis.mood + " mood");
    if (analysis.medium) meta.push(analysis.medium);
    if (meta.length) parts.push(meta.join(", "));
    if (analysis.tags && analysis.tags.length) parts.push(analysis.tags.join(", "));
    if (analysis.colors && analysis.colors.length) parts.push("palette: " + analysis.colors.join(", "));
    return parts.join(". ").replace(/\.\s*\./g, ".").trim();
  }

  function updateImportActions() {
    var wrap = $("sp-cast-import-actions");
    var hasImport = !!state.cast.importSourceUrl;
    if (wrap) wrap.hidden = !hasImport;
    var useBtn = $("sp-cast-use-analysis-btn");
    if (useBtn) useBtn.hidden = !state.cast.importAnalysis;
    var analyzeBtn = $("sp-cast-analyze-btn");
    if (analyzeBtn) {
      analyzeBtn.disabled = state.cast.importAnalyzing || state.cast.generating;
      analyzeBtn.textContent = state.cast.importAnalyzing ? "Analyzing…" : "Analyze import";
    }
    var restoreBtn = $("sp-cast-restore-look-btn");
    if (restoreBtn) {
      restoreBtn.disabled =
        state.cast.generating ||
        !hasImport ||
        state.cast.imageUrl === state.cast.importSourceUrl;
    }
  }

  function renderImportAnalysis() {
    var panel = $("sp-cast-analysis");
    if (!panel) return;
    var analysis = state.cast.importAnalysis;
    if (!analysis) {
      panel.hidden = true;
      panel.innerHTML = "";
      updateImportActions();
      return;
    }
    panel.hidden = false;
    var tags = (analysis.tags || [])
      .map(function (t) {
        return '<span class="sp-tag">' + escapeHtml(t) + "</span>";
      })
      .join("");
    panel.innerHTML =
      '<p class="sp-cast-analysis-title">' +
      escapeHtml(analysis.title || "Import analysis") +
      "</p>" +
      (analysis.description
        ? '<p class="sp-cast-analysis-desc">' + escapeHtml(analysis.description) + "</p>"
        : "") +
      (tags ? '<div class="sp-cast-analysis-tags">' + tags + "</div>" : "") +
      '<p class="sp-cast-analysis-note">Included in every cast relay — use as description or Restore original look to pull this back onto generated results.</p>';
    updateImportActions();
  }

  function analyzeImportedImage() {
    if (!state.cast.importSourceUrl) {
      setCastStatus("Import an image first.", "error");
      return Promise.resolve();
    }
    if (state.cast.importAnalyzing) return Promise.resolve();
    state.cast.importAnalyzing = true;
    updateImportActions();
    setCastStatus("Analyzing imported image with AI…", "pending");
    return compressDataUrl(state.cast.importSourceUrl, 768, 0.8)
      .then(function (compressed) {
        return fetchWithTimeout(
          apiUrl("/api/analyze-image"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: compressed }),
          },
          FETCH_TIMEOUT_MS
        );
      })
      .then(function (r) {
        return parseApiResponse(r).then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Analysis failed");
          return d;
        });
      })
      .then(function (d) {
        if (!d || !d.analysis) throw new Error("No analysis returned.");
        state.cast.importAnalysis = d.analysis;
        renderImportAnalysis();
        setCastStatus("Import analyzed — use as description or keep casting.", "ok");
      })
      .catch(function (err) {
        setCastStatus(err.message || "Could not analyze import. Is the gallery server running?", "error");
      })
      .finally(function () {
        state.cast.importAnalyzing = false;
        updateImportActions();
      });
  }

  function applyAnalysisToSubject() {
    if (!state.cast.importAnalysis) {
      setCastStatus("Analyze the import first.", "error");
      return;
    }
    setCastSubject(buildDescriptionFromAnalysis(state.cast.importAnalysis));
    setCastStatus("Analysis copied into subject description.", "ok");
  }

  function reapplyImportedImage() {
    if (!state.cast.importSourceUrl) {
      setCastStatus("Import an image first.", "error");
      return;
    }
    state.cast.imageUrl = state.cast.importSourceUrl;
    state.cast.imported = true;
    showCastPreview(state.cast.importSourceUrl);
    setCastStatus("Original import reapplied to preview.", "ok");
  }

  function restoreImportLook() {
    if (!state.cast.importSourceUrl) {
      setCastStatus("Import an image first.", "error");
      return;
    }
    if (!state.cast.imageUrl || state.cast.imageUrl === state.cast.importSourceUrl) {
      reapplyImportedImage();
      return;
    }
    castGenerate({ restoreImportLook: true });
  }

  function spellCastDetailLines(spell) {
    var a =
      spell.analysis ||
      (spell.paintingNum && window.getGalleryAnalysis
        ? window.getGalleryAnalysis(spell.paintingNum)
        : null);
    var lines = [];
    lines.push(
      "#" + spell.paintingNum + " — " + (spell.title || (a && a.title) || "Spell")
    );
    var meta = [];
    if (a && a.style) meta.push("Style: " + a.style);
    if (a && a.mood) meta.push("Mood: " + a.mood);
    if (a && a.medium) meta.push("Medium: " + a.medium);
    if (meta.length) lines.push(meta.join(" · "));
    if (a && a.tags && a.tags.length) lines.push("Spell effects: " + a.tags.join(", "));
    if (a && a.colors && a.colors.length) lines.push("Palette: " + a.colors.join(", "));
    if (a && a.description) lines.push(String(a.description).slice(0, 360));
    return lines.join("\n");
  }

  function buildCastStasis(genOptions) {
    genOptions = genOptions || {};
    var subject = getCastSubject();
    var importBlock = state.cast.importAnalysis ? formatAnalysisBlock(state.cast.importAnalysis) : "";
    var lines = [];
    if (genOptions.restoreImportLook) {
      lines.push(
        "RESTORE IMPORT LOOK — reapply the original imported subject's appearance onto the current generated image."
      );
      lines.push("Keep equipped spell characteristics but re-anchor forms, palette, lighting, and identity to the import.");
      lines.push("");
      if (importBlock) {
        lines.push("ORIGINAL IMPORT (restore this look):");
        lines.push(importBlock);
        lines.push("");
      } else if (subject) {
        lines.push("ORIGINAL IMPORT (restore this look):");
        lines.push(subject);
        lines.push("");
      }
      if (state.cast.applied.length) {
        lines.push("Preserve these spell effects while restoring the import:");
        state.cast.applied.forEach(function (s) {
          lines.push(spellCastDetailLines(s));
          lines.push("");
        });
      }
    } else if (subject || importBlock) {
      lines.push(
        "SPELL CAST — maximize equipped spell color, texture, mood, and stylistic effects onto the imported subject."
      );
      lines.push("");
      if (importBlock) {
        lines.push("ORIGINAL IMPORT ANCHOR (relay this look through every cast — keep recognizable):");
        lines.push(importBlock);
        lines.push("");
      }
      if (subject) {
        lines.push("IMPORTED SUBJECT (identity anchor — keep recognizable while transforming):");
        lines.push(subject);
        lines.push("");
      }
      if (state.cast.applied.length) {
        lines.push("Equipped spells (apply their full characteristics to the subject above):");
        state.cast.applied.forEach(function (s) {
          lines.push(spellCastDetailLines(s));
          lines.push("");
        });
      }
    } else {
      lines.push("SPELL CAST — fuse equipped painting spells into one vision.");
      state.cast.applied.forEach(function (s) {
        lines.push(spellCastDetailLines(s));
      });
    }
    var direction = ($("sp-cast-prompt") && $("sp-cast-prompt").value.trim()) || "";
    if (direction) lines.push("Spell emphasis: " + direction);
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function buildCastPrompt(genOptions) {
    genOptions = genOptions || {};
    var subject = getCastSubject();
    var direction = ($("sp-cast-prompt") && $("sp-cast-prompt").value.trim()) || "";
    var parts = [];
    if (genOptions.restoreImportLook) {
      parts.push(
        "Restore the original imported subject's look onto this generated image. Re-anchor palette, forms, lighting, and identity to the import reference."
      );
      if (state.cast.importAnalysis && state.cast.importAnalysis.description) {
        parts.push("Original import: " + state.cast.importAnalysis.description);
      } else if (subject) {
        parts.push("Original import: " + subject);
      }
    } else if (subject || state.cast.importAnalysis) {
      parts.push(
        "Reshape this imported subject with spell characteristics. Keep the subject recognizable and relay the original import look."
      );
      if (state.cast.importAnalysis && state.cast.importAnalysis.description) {
        parts.push("Import anchor: " + state.cast.importAnalysis.description);
      }
      if (subject) parts.push("Subject: " + subject);
    }
    if (direction) parts.push(direction);
    return parts.join("\n\n");
  }

  function buildCastBuzz() {
    var buzz = ["spell cast", "painterly fusion"];
    var subject = getCastSubject();
    if (state.cast.importSourceUrl) buzz.push("import anchor");
    if (state.cast.importAnalysis) {
      if (state.cast.importAnalysis.style && buzz.indexOf(state.cast.importAnalysis.style) < 0) {
        buzz.push(state.cast.importAnalysis.style);
      }
      if (state.cast.importAnalysis.mood && buzz.indexOf(state.cast.importAnalysis.mood) < 0) {
        buzz.push(state.cast.importAnalysis.mood);
      }
      (state.cast.importAnalysis.tags || []).slice(0, 6).forEach(function (t) {
        if (buzz.indexOf(t) < 0) buzz.push(t);
      });
      (state.cast.importAnalysis.colors || []).slice(0, 4).forEach(function (c) {
        if (c && buzz.indexOf(c) < 0) buzz.push(c);
      });
    }
    if (subject) {
      buzz.push("imported subject");
      subject
        .toLowerCase()
        .split(/[\s,;.]+/)
        .filter(function (w) {
          return w.length > 3;
        })
        .slice(0, 8)
        .forEach(function (w) {
          if (buzz.indexOf(w) < 0) buzz.push(w);
        });
    }
    state.cast.applied.forEach(function (s) {
      var a =
        s.analysis ||
        (s.paintingNum && window.getGalleryAnalysis
          ? window.getGalleryAnalysis(s.paintingNum)
          : null);
      (s.tags || []).slice(0, 6).forEach(function (t) {
        if (buzz.indexOf(t) < 0) buzz.push(t);
      });
      if (a && a.style && buzz.indexOf(a.style) < 0) buzz.push(a.style);
      if (a && a.mood && buzz.indexOf(a.mood) < 0) buzz.push(a.mood);
      if (a && a.colors) {
        a.colors.slice(0, 4).forEach(function (c) {
          if (c && buzz.indexOf(c) < 0) buzz.push(c);
        });
      }
    });
    return buzz;
  }

  function compressDataUrl(dataUrl, maxSide, quality) {
    return new Promise(function (resolve) {
      if (!dataUrl || dataUrl.indexOf("data:image") !== 0) return resolve(dataUrl || "");
      var img = new Image();
      img.onload = function () {
        var w = img.width;
        var h = img.height;
        var scale = Math.min(1, maxSide / Math.max(w, h, 1));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        var ctx = canvas.getContext("2d");
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = function () {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  function pollImageJob(jobId, attemptsLeft, firstPoll) {
    if (attemptsLeft == null) attemptsLeft = 80;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Cast generation timed out."));
    var pollOnce = function () {
      return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), { cache: "no-store" }, 25000);
    };
    var startPoll = firstPoll
      ? new Promise(function (resolve) {
          setTimeout(resolve, FIRST_POLL_DELAY_MS);
        }).then(pollOnce)
      : pollOnce();
    return startPoll
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (job) {
        setCastStatus("Casting… (" + (job.status || "working") + ")", "pending");
        if (job.status === "done") {
          var img = job.image || (job.images && job.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        }
        if (job.status === "failed") {
          throw new Error((job.error && job.error.message) || "Generation failed.");
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, POLL_INTERVAL_MS);
        }).then(function () {
          return pollImageJob(jobId, attemptsLeft - 1, false);
        });
      });
  }

  function showCastPreview(url) {
    var empty = $("sp-cast-empty");
    var img = $("sp-cast-preview");
    var clearBtn = $("sp-cast-clear-img");
    if (!img) return;
    if (!url) {
      if (empty) empty.hidden = false;
      img.hidden = true;
      img.removeAttribute("src");
      if (clearBtn) clearBtn.hidden = true;
      showCastSubjectPanel(false);
      updateImportActions();
      return;
    }
    if (empty) empty.hidden = true;
    img.src = url;
    img.hidden = false;
    if (clearBtn) clearBtn.hidden = false;
    showCastSubjectPanel(true);
    updateImportActions();
  }

  function renderCastApplied() {
    var row = $("sp-cast-applied");
    if (!row) return;
    row.innerHTML = "";
    if (!state.cast.applied.length) {
      row.innerHTML =
        '<span class="sp-cast-applied-empty">No spells equipped — drag from the tray below.</span>';
      return;
    }
    state.cast.applied.forEach(function (item, idx) {
      var chip = document.createElement("span");
      chip.className = "sp-cast-chip";
      chip.textContent = item.label || item.title || "Spell";
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "sp-cast-chip-rm";
      rm.textContent = "×";
      rm.dataset.idx = String(idx);
      chip.appendChild(rm);
      row.appendChild(chip);
    });
  }

  function addCastSpell(item) {
    if (state.cast.generating) return;
    item = normalizeCastItem(item);
    if (!item.url) return;
    var exists = state.cast.applied.some(function (s) {
      return s.url === item.url;
    });
    if (exists) {
      setCastStatus("That spell is already on the cast.", "error");
      return;
    }
    if (state.cast.applied.length >= 16) {
      setCastStatus("Max 16 spells per cast.", "error");
      return;
    }
    state.cast.applied.push(item);
    renderCastApplied();
    var hasImage = !!state.cast.imageUrl;
    var subject = getCastSubject();
    if (hasImage && state.cast.imported && !subject) {
      setCastStatus(
        "Describe what's in the image for stronger effects — casting spell " +
          state.cast.applied.length +
          "…",
        "pending"
      );
    } else {
      setCastStatus(
        hasImage
          ? "Spell " + state.cast.applied.length + " — applying to image…"
          : "Spell " + state.cast.applied.length + " — casting vision…",
        "pending"
      );
    }
    castGenerate({ spellCast: hasImage });
  }

  function beginCastGenerate() {
    state.cast.generating = true;
    var stage = $("sp-cast-stage");
    if (stage) stage.classList.add("sp-generating");
    document.querySelectorAll(".sp-cast-controls .sp-btn, .sp-cast-import-actions .sp-btn, .sp-spell").forEach(function (el) {
      el.disabled = true;
    });
    updateImportActions();
  }

  function endCastGenerate() {
    state.cast.generating = false;
    var stage = $("sp-cast-stage");
    if (stage) stage.classList.remove("sp-generating");
    document.querySelectorAll(".sp-cast-controls .sp-btn, .sp-cast-import-actions .sp-btn, .sp-spell").forEach(function (el) {
      el.disabled = false;
    });
    updateImportActions();
  }

  function castGenerate(options) {
    options = options || {};
    if (state.cast.generating) return Promise.resolve();
    var applied = state.cast.applied;
    var prompt = ($("sp-cast-prompt") && $("sp-cast-prompt").value.trim()) || "";
    var hasImage = !!state.cast.imageUrl;
    if (!applied.length && !prompt && !hasImage) {
      setCastStatus("Drag spells, import an image, or add a cast direction.", "error");
      return Promise.resolve();
    }
    if (!state.cast.continuityId) {
      state.cast.continuityId = "sp-cast-" + Date.now();
    }
    var variation = !!options.variation;
    var restoreImportLook = !!options.restoreImportLook;
    var spellCast = !!options.spellCast && !restoreImportLook;
    var lastSpell = applied.length ? applied[applied.length - 1] : null;
    if (!spellCast && !restoreImportLook && hasImage && !variation && lastSpell) spellCast = true;
    var refine = restoreImportLook || spellCast || (hasImage && !variation);
    beginCastGenerate();
    setCastStatus(
      restoreImportLook
        ? "Restoring original import look…"
        : spellCast
          ? "Imbuing image with spell…"
          : variation
            ? "Painting new variation…"
            : refine
              ? "Applying spell cast…"
              : "Casting vision…",
      "pending"
    );

    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "sp-" + Date.now();
    var refImage;
    if (restoreImportLook && state.cast.importSourceUrl) {
      refImage = state.cast.importSourceUrl;
    } else if (state.cast.importSourceUrl && refine && !variation) {
      refImage = options.referenceUrl || state.cast.imageUrl || state.cast.importSourceUrl;
    } else {
      refImage = options.referenceUrl || state.cast.imageUrl || "";
    }
    var spellRef = spellCast && lastSpell ? lastSpell.url : "";
    var subject = getCastSubject();
    var importDesc = state.cast.importAnalysis
      ? buildDescriptionFromAnalysis(state.cast.importAnalysis)
      : "";
    var craftHints = importDesc || subject;
    if (restoreImportLook) {
      craftHints = "Restore import look: " + (importDesc || subject || "original imported subject");
    } else if (state.cast.importSourceUrl && craftHints) {
      craftHints = "Import anchor: " + craftHints;
    }
    var castPrompt = buildCastPrompt(options) || prompt;

    return compressDataUrl(refImage, 1280, 0.82)
      .then(function (compressedRef) {
        return fetchWithTimeout(
          apiUrl("/api/generate-stasis-vision"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              job_id: jobId,
              stasis: buildCastStasis(options),
              craft_hints: craftHints,
              buzz_words: buildCastBuzz(),
              spells: paintingNumsFromSpells(applied),
              aspect_ratio: "1:1",
              mag_fresh: !refine,
              fresh_variation: variation,
              refine: refine,
              spell_cast: spellCast,
              spell_reference_image: spellRef,
              reference_image: refine ? compressedRef : "",
              prompt: castPrompt,
            }),
          },
          FETCH_TIMEOUT_MS
        );
      })
      .then(function (r) {
        if (r.status === 202) {
          return r.json().then(function (d) {
            return pollImageJob((d && d.job_id) || jobId, null, true);
          });
        }
        return parseApiResponse(r).then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Cast failed");
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        });
      })
      .then(function (url) {
        state.cast.imageUrl = url;
        state.cast.imported = false;
        showCastPreview(url);
        setCastStatus(
          restoreImportLook
            ? "Original import look restored — drag more spells or restore again."
            : "Cast complete — drag more spells to keep refining.",
          "ok"
        );
      })
      .catch(function (err) {
        setCastStatus(err.message || "Cast failed. Is the gallery server running?", "error");
      })
      .finally(endCastGenerate);
  }

  function handleImportFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      setCastStatus("Please choose an image file.", "error");
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setCastStatus("Image must be under 8 MB.", "error");
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      compressDataUrl(reader.result, 1280, 0.82).then(function (dataUrl) {
        resetCastScopeForNewImport();
        state.cast.importSourceUrl = dataUrl;
        state.cast.imageUrl = dataUrl;
        state.cast.imported = true;
        showCastPreview(dataUrl);
        updateImportActions();
        setCastStatus("Describe or Analyze import — then drag spells to reshape it.", "ok");
        setTimeout(function () {
          var el = $("sp-cast-subject");
          if (el) {
            el.focus();
            el.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
        }, 60);
      });
    };
    reader.onerror = function () {
      setCastStatus("Could not read image.", "error");
    };
    reader.readAsDataURL(file);
  }

  function clearCastImage() {
    state.cast.imageUrl = "";
    state.cast.importSourceUrl = "";
    state.cast.importAnalysis = null;
    state.cast.imported = false;
    setCastSubject("");
    renderImportAnalysis();
    showCastPreview("");
    setCastStatus("Image cleared.", "ok");
  }

  function loadCastPool() {
    if (state.cast.poolReady) return Promise.resolve();
    return (window.loadGalleryData ? window.loadGalleryData() : Promise.resolve({ manifest: [] }))
      .then(function (data) {
        state.cast.pool = (data.manifest || []).map(function (m) {
          return normalizeCastItem(spellRow(m));
        });
        state.cast.poolReady = true;
        fillCastTrayRandom();
        renderCastTray();
      });
  }

  function fillCastTrayRandom() {
    var copy = state.cast.pool.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    state.cast.trayItems = copy.slice(0, CAST_TRAY_SLICE);
  }

  function renderCastTray() {
    var strip = $("sp-cast-spell-strip");
    if (!strip) return;
    strip.innerHTML = "";
    state.cast.trayItems.forEach(function (item, idx) {
      var el = document.createElement("div");
      el.className = "st-spell sp-spell";
      el.dataset.idx = String(idx);
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.label;
      el.appendChild(img);
      strip.appendChild(el);
    });
    var count = $("sp-cast-tray-count");
    if (count) {
      count.textContent = state.cast.trayItems.length + " shown · drag onto cast stage";
    }
  }

  function createGhost(item, x, y) {
    var ghost = document.createElement("div");
    ghost.className = "st-drag-ghost";
    var img = document.createElement("img");
    img.src = item.url;
    ghost.appendChild(img);
    document.body.appendChild(ghost);
    ghost.style.left = x + "px";
    ghost.style.top = y + "px";
    return ghost;
  }

  function isOverCastStage(x, y) {
    var stage = $("sp-cast-stage");
    if (!stage) return false;
    var rect = stage.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function onCastPointerDown(e) {
    if (state.cast.generating) return;
    var spell = e.target.closest(".sp-spell");
    if (!spell || !spell.closest("#sp-cast-spell-strip")) return;
    var item = normalizeCastItem(state.cast.trayItems[parseInt(spell.dataset.idx, 10)]);
    if (!item.url) return;
    e.preventDefault();
    spell.setPointerCapture(e.pointerId);
    state.cast.drag = {
      item: item,
      ghost: createGhost(item, e.clientX, e.clientY),
      pointerId: e.pointerId,
    };
    var stage = $("sp-cast-stage");
    if (stage) stage.classList.add("sp-drop-active");
  }

  function onCastPointerUp(e) {
    if (!state.cast.drag || e.pointerId !== state.cast.drag.pointerId) return;
    var drag = state.cast.drag;
    if (drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    var stage = $("sp-cast-stage");
    if (stage) stage.classList.remove("sp-drop-active");
    if (isOverCastStage(e.clientX, e.clientY)) addCastSpell(drag.item);
    state.cast.drag = null;
  }

  function onCastPointerMove(e) {
    if (!state.cast.drag || e.pointerId !== state.cast.drag.pointerId) return;
    state.cast.drag.ghost.style.left = e.clientX + "px";
    state.cast.drag.ghost.style.top = e.clientY + "px";
  }

  function onCastPointerCancel(e) {
    if (!state.cast.drag || e.pointerId !== state.cast.drag.pointerId) return;
    if (state.cast.drag.ghost.parentNode) state.cast.drag.ghost.parentNode.removeChild(state.cast.drag.ghost);
    var stage = $("sp-cast-stage");
    if (stage) stage.classList.remove("sp-drop-active");
    state.cast.drag = null;
  }

  function applyFilters() {
    var q = ($("sp-search") && $("sp-search").value.trim()) || "";
    var style = ($("sp-filter-style") && $("sp-filter-style").value) || "";
    var sort = ($("sp-sort") && $("sp-sort").value) || "number-asc";
    var pinnedOnly = $("sp-pinned-only") && $("sp-pinned-only").checked;

    var rows = state.all.filter(function (row) {
      if (pinnedOnly && !state.pinned[row.number]) return false;
      if (style && row.style !== style) return false;
      if (q) {
        if (window.paintingMatchesNumericQuery && window.paintingMatchesNumericQuery(row.number, q)) {
          return true;
        }
        if (row.searchText.indexOf(q.toLowerCase()) < 0) return false;
      }
      return true;
    });

    if (sort === "number-desc") {
      rows.sort(function (a, b) {
        return b.number - a.number;
      });
    } else if (sort === "title-asc") {
      rows.sort(function (a, b) {
        return String(a.title).localeCompare(String(b.title));
      });
    } else if (sort === "shuffle") {
      for (var i = rows.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = rows[i];
        rows[i] = rows[j];
        rows[j] = t;
      }
    } else {
      rows.sort(function (a, b) {
        return a.number - b.number;
      });
    }

    state.filtered = rows;
    state.shown = 0;
    renderGrid(true);
    updateCount();
  }

  function updateCount() {
    var el = $("sp-count");
    if (!el) return;
    var n = state.filtered.length;
    el.textContent = n + " spell" + (n === 1 ? "" : "s");
  }

  function renderGrid(reset) {
    var grid = $("sp-grid");
    if (!grid) return;
    if (reset) grid.innerHTML = "";
    var start = state.shown;
    var slice = state.filtered.slice(start, start + PAGE_SIZE);
    slice.forEach(function (row) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "sp-card" +
        (state.selected === row.number ? " sp-card-active" : "") +
        (state.pinned[row.number] ? " sp-card-pinned" : "");
      btn.dataset.number = String(row.number);
      btn.innerHTML =
        '<div class="sp-card-thumb"><img src="' +
        escapeHtml(row.url) +
        '" alt="" loading="lazy" /></div>' +
        '<div class="sp-card-meta">' +
        '<span class="sp-card-num">#' +
        row.number +
        "</span>" +
        '<p class="sp-card-title">' +
        escapeHtml(row.title) +
        "</p></div>";
      grid.appendChild(btn);
    });
    state.shown = start + slice.length;
    var more = $("sp-load-more-wrap");
    if (more) more.hidden = state.shown >= state.filtered.length;
  }

  function renderDetail(num) {
    var panel = $("sp-detail");
    if (!panel) return;
    var row = state.all.find(function (r) {
      return r.number === num;
    });
    if (!row) {
      panel.innerHTML =
        '<p class="sp-detail-empty">Pick a spell from the grid to read its full text.</p>';
      return;
    }
    var analysis = row.analysis || {};
    var spellText = buildSpellText(row.number, analysis);
    var tags = (row.tags || [])
      .map(function (t) {
        return '<span class="sp-tag">' + escapeHtml(t) + "</span>";
      })
      .join("");
    var pinned = !!state.pinned[row.number];
    panel.innerHTML =
      '<div class="sp-detail-preview"><img src="' +
      escapeHtml(row.url) +
      '" alt="" /></div>' +
      '<h3 class="sp-detail-title">' +
      escapeHtml(row.title) +
      "</h3>" +
      '<p class="sp-detail-sub">#' +
      row.number +
      (row.style ? " · " + escapeHtml(row.style) : "") +
      (row.mood ? " · " + escapeHtml(row.mood) : "") +
      "</p>" +
      (analysis.description
        ? '<p class="sp-detail-desc">' + escapeHtml(analysis.description) + "</p>"
        : "") +
      (tags ? '<div class="sp-detail-tags">' + tags + "</div>" : "") +
      '<pre class="sp-spell-text" id="sp-spell-text">' +
      escapeHtml(spellText) +
      "</pre>" +
      '<div class="sp-detail-actions">' +
      '<button type="button" class="sp-btn accent" data-action="copy-spell">Copy spell</button>' +
      '<button type="button" class="sp-btn" data-action="copy-tags">Copy tags</button>' +
      '<button type="button" class="sp-btn" data-action="pin">' +
      (pinned ? "Unpin" : "Pin spell") +
      "</button>" +
      '<button type="button" class="sp-btn" data-action="add-cast">Add to cast</button>' +
      '<button type="button" class="sp-btn" data-action="spellforge">Open in Spellforge</button>' +
      "</div>";
    panel.dataset.number = String(row.number);
  }

  function selectSpell(num) {
    state.selected = num;
    document.querySelectorAll(".sp-card").forEach(function (el) {
      el.classList.toggle("sp-card-active", parseInt(el.dataset.number, 10) === num);
    });
    renderDetail(num);
  }

  function copyText(text) {
    if (!text || !navigator.clipboard) return;
    navigator.clipboard.writeText(text);
  }

  function fillStyleFilter() {
    var sel = $("sp-filter-style");
    if (!sel || sel.options.length > 1) return;
    var styles = {};
    state.all.forEach(function (row) {
      if (row.style) styles[row.style] = true;
    });
    Object.keys(styles)
      .sort()
      .forEach(function (s) {
        var opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        sel.appendChild(opt);
      });
  }

  function loadSpells() {
    if (state.ready) return Promise.resolve();
    return (window.loadGalleryData ? window.loadGalleryData() : Promise.resolve({ manifest: [] }))
      .then(function (data) {
        state.all = (data.manifest || []).map(spellRow);
        state.ready = true;
        fillStyleFilter();
        applyFilters();
        if (state.all.length && !state.selected) selectSpell(state.all[0].number);
      });
  }

  function openInSpellforge(num) {
    var tab = document.querySelector('.tab[data-tab="spellforge"]');
    if (tab) tab.click();
    if (typeof window.equipSpellPainting === "function") {
      window.equipSpellPainting(num);
    }
  }

  function bindCastUi() {
    document.querySelectorAll(".sp-mode-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setView(btn.dataset.spMode);
      });
    });
    $("sp-cast-generate-btn").addEventListener("click", function () {
      castGenerate();
    });
    $("sp-cast-variation-btn").addEventListener("click", function () {
      castGenerate({ variation: true });
    });
    $("sp-cast-import-btn").addEventListener("click", function () {
      $("sp-cast-import").click();
    });
    $("sp-cast-import").addEventListener("change", function () {
      var file = $("sp-cast-import").files && $("sp-cast-import").files[0];
      if (file) handleImportFile(file);
      $("sp-cast-import").value = "";
    });
    $("sp-cast-clear-img").addEventListener("click", clearCastImage);
    $("sp-cast-analyze-btn").addEventListener("click", analyzeImportedImage);
    $("sp-cast-use-analysis-btn").addEventListener("click", applyAnalysisToSubject);
    $("sp-cast-reapply-import-btn").addEventListener("click", reapplyImportedImage);
    $("sp-cast-restore-look-btn").addEventListener("click", restoreImportLook);
    var subjectEl = $("sp-cast-subject");
    if (subjectEl) {
      subjectEl.addEventListener("input", function () {
        state.cast.imageDescription = subjectEl.value.trim();
      });
    }
    $("sp-cast-randomize").addEventListener("click", function () {
      fillCastTrayRandom();
      renderCastTray();
    });
    $("sp-cast-applied").addEventListener("click", function (e) {
      var btn = e.target.closest(".sp-cast-chip-rm");
      if (!btn) return;
      state.cast.applied.splice(parseInt(btn.dataset.idx, 10), 1);
      renderCastApplied();
    });
    var strip = $("sp-cast-spell-strip");
    if (strip) {
      strip.addEventListener("pointerdown", onCastPointerDown);
      strip.addEventListener("pointermove", onCastPointerMove);
      strip.addEventListener("pointerup", onCastPointerUp);
      strip.addEventListener("pointercancel", onCastPointerCancel);
    }
  }

  function bindBrowseUi() {
    $("sp-search").addEventListener("input", applyFilters);
    $("sp-filter-style").addEventListener("change", applyFilters);
    $("sp-sort").addEventListener("change", applyFilters);
    $("sp-pinned-only").addEventListener("change", applyFilters);
    $("sp-load-more").addEventListener("click", function () {
      renderGrid(false);
    });
    $("sp-grid").addEventListener("click", function (e) {
      var card = e.target.closest(".sp-card");
      if (!card) return;
      selectSpell(parseInt(card.dataset.number, 10));
    });
    $("sp-detail").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      var num = parseInt($("sp-detail").dataset.number || "0", 10);
      var row = state.all.find(function (r) {
        return r.number === num;
      });
      if (!row) return;
      if (btn.dataset.action === "copy-spell") copyText(buildSpellText(num, row.analysis));
      if (btn.dataset.action === "copy-tags") copyText((row.tags || []).join(", "));
      if (btn.dataset.action === "pin") {
        if (state.pinned[num]) delete state.pinned[num];
        else state.pinned[num] = true;
        savePinned();
        applyFilters();
        selectSpell(num);
      }
      if (btn.dataset.action === "add-cast") {
        setView("cast");
        addCastSpell(spellRow({ number: num }));
      }
      if (btn.dataset.action === "spellforge") openInSpellforge(num);
    });
  }

  function onShow() {
    loadSpells();
    loadCastPool();
    renderCastApplied();
  }

  function boot() {
    if (!$("panel-spells")) return;
    loadPinned();
    setView("cast");
    bindCastUi();
    bindBrowseUi();
    renderDetail(null);
    renderCastApplied();
    updateImportActions();
    setCastStatus("Import an image and describe it, or drag spells onto the stage.", "ok");
    window.dispatchEvent(new Event("spells-ready"));
  }

  window.Spells = { onShow: onShow };
  window.addEventListener("spells-show", onShow);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();