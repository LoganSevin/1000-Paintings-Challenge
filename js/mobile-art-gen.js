/**
 * Mobile Art Gen — phone-first drag spells upward onto the canvas to compose & refine visions.
 */
(function () {
  "use strict";

  var TRAY_SLICE = 36;
  var DRAG_UP_THRESHOLD = 40;
  var LOD1_ANALYSES_URL = "data/lod1-analyses.json";
  var FETCH_TIMEOUT_MS = 45000;
  var VISUAL_INTENT_PREFIX =
    "MOBILE ART GEN — visual adaptation only. Paint how the source images are SEEN: " +
    "forms, colors, light, edges, surface, and spatial layout. " +
    "Do not invent a separate narrative; adapt what the descriptions say is visible.\n\n";

  var state = {
    pool: [],
    poolReady: false,
    poolLoading: false,
    trayMode: "random",
    trayItems: [],
    applied: [],
    visionUrl: "",
    generating: false,
    lod1Analyses: {},
    lod1AnalysesLoaded: false,
    lod1AnalysisPending: {},
    sessionPoolAdds: 0,
    castCount: 0,
    drag: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function absoluteAssetUrl(url) {
    if (!url) return "";
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return String(url);
    }
  }

  function parseLod1NumFromUrl(url) {
    if (!url) return null;
    var m = String(url).match(/\/generated\/(\d+)\.[a-z]+/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function emptyItem() {
    return { url: "", label: "", paintingNum: null, lod1Num: null, source: "" };
  }

  function normalizeItem(item) {
    item = item || emptyItem();
    if (!item.lod1Num && item.url) item.lod1Num = parseLod1NumFromUrl(item.url);
    return {
      url: item.url || "",
      label: item.label || "",
      paintingNum: item.paintingNum || null,
      lod1Num: item.lod1Num || null,
      source: item.source || "",
    };
  }

  function itemKey(item) {
    item = normalizeItem(item);
    return item.url || String(item.paintingNum || "") || String(item.lod1Num || "");
  }

  function setStatus(msg, kind) {
    var el = $("mag-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "mag-status" + (kind ? " " + kind : "");
  }

  function updateTrayCount() {
    var el = $("mag-tray-count");
    if (!el) return;
    var session =
      state.sessionPoolAdds > 0 ? " · +" + state.sessionPoolAdds + " new" : "";
    el.textContent =
      state.trayItems.length +
      " shown · " +
      state.pool.length +
      " in library" +
      session;
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

  function loadLod1Analyses() {
    if (state.lod1AnalysesLoaded) return Promise.resolve();
    return fetch(LOD1_ANALYSES_URL)
      .then(function (r) {
        return r.ok ? r.json() : {};
      })
      .catch(function () {
        return {};
      })
      .then(function (data) {
        state.lod1Analyses = data || {};
        state.lod1AnalysesLoaded = true;
      });
  }

  function ensureLod1Analysis(num) {
    if (!num) return Promise.resolve(null);
    var cached = state.lod1Analyses[String(num)] || state.lod1Analyses[num];
    if (cached) return Promise.resolve(cached);
    if (state.lod1AnalysisPending[num]) return state.lod1AnalysisPending[num];
    state.lod1AnalysisPending[num] = fetchWithTimeout(apiUrl("/api/analyze-lod1"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ num: num }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.ok && data.analysis) {
          state.lod1Analyses[String(num)] = data.analysis;
          return data.analysis;
        }
        return null;
      })
      .catch(function () {
        return null;
      })
      .finally(function () {
        delete state.lod1AnalysisPending[num];
      });
    return state.lod1AnalysisPending[num];
  }

  function fetchAcquiredFolder(folderId) {
    return fetchWithTimeout(
      apiUrl("/api/acquired-images?folder=" + encodeURIComponent(folderId)),
      { cache: "no-store" }
    )
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (!d || !d.files) return [];
        return d.files.map(function (f) {
          var lod1Num = parseLod1NumFromUrl(f.url);
          return normalizeItem({
            url: f.url,
            label: lod1Num ? "LOD1 #" + lod1Num : f.name || folderId,
            paintingNum: null,
            lod1Num: lod1Num,
            source: folderId,
          });
        });
      })
      .catch(function () {
        return [];
      });
  }

  function dedupePool(pool) {
    var seen = {};
    return pool.filter(function (item) {
      if (!item.url || seen[item.url]) return false;
      seen[item.url] = true;
      return true;
    });
  }

  function loadImagePool() {
    if (state.poolReady) return Promise.resolve(state.pool);
    if (state.poolLoading) {
      return new Promise(function (resolve) {
        var tick = setInterval(function () {
          if (state.poolReady) {
            clearInterval(tick);
            resolve(state.pool);
          }
        }, 80);
      });
    }
    state.poolLoading = true;
    setStatus("Loading spell library…", "pending");

    return Promise.all([
      window.loadGalleryData ? window.loadGalleryData() : Promise.resolve({ manifest: [] }),
      loadLod1Analyses(),
    ])
      .then(function (results) {
        var data = results[0];
        var manifest =
          (data && data.manifest) || (window.getGalleryManifest && window.getGalleryManifest()) || [];
        var pool = [];
        manifest.forEach(function (m) {
          var url = window.getPaintingUrl
            ? window.getPaintingUrl(m.number)
            : "paintings/" + m.number + ".jpg";
          pool.push(
            normalizeItem({
              url: url,
              label: "#" + m.number,
              paintingNum: m.number,
              source: "paintings",
            })
          );
        });
        return fetchWithTimeout(apiUrl("/api/acquired-images"), { cache: "no-store" })
          .then(function (r) {
            return r.ok ? r.json() : { folders: [] };
          })
          .then(function (index) {
            var folders = ["lod1s", "saved-stasis"];
            var falloutKids = [];
            (index.folders || []).forEach(function (f) {
              if (f.id === "saved-fallout" && f.children) {
                f.children.forEach(function (c) {
                  falloutKids.push(c.id);
                });
              }
            });
            folders = folders.concat(falloutKids);
            return Promise.all(folders.map(fetchAcquiredFolder)).then(function (chunks) {
              chunks.forEach(function (list) {
                pool = pool.concat(list);
              });
              state.pool = dedupePool(pool.map(normalizeItem));
              state.poolReady = true;
              state.poolLoading = false;
              setStatus(
                state.pool.length
                  ? state.pool.length + " spells ready — drag upward to cast."
                  : "Library empty — run start_server.bat and add paintings.",
                state.pool.length ? "ok" : "error"
              );
              return state.pool;
            });
          });
      })
      .catch(function () {
        state.poolLoading = false;
        setStatus("Could not load spell library.", "error");
        return [];
      });
  }

  function addToPool(item) {
    item = normalizeItem(item);
    if (!item.url) return false;
    if (
      state.pool.some(function (p) {
        return p.url === item.url;
      })
    ) {
      updateTrayCount();
      return false;
    }
    state.pool.push(item);
    state.sessionPoolAdds += 1;
    if (state.trayMode === "all") {
      state.trayItems = state.pool.slice();
    }
    updateTrayCount();
    renderTray();
    return true;
  }

  function registerGeneratedInPool(url) {
    if (!url) return Promise.resolve();
    var lod1Num = parseLod1NumFromUrl(url);
    var label = lod1Num
      ? "LOD1 #" + lod1Num
      : url.indexOf("data:") === 0
        ? "Local generation"
        : "Generated";
    addToPool({
      url: url,
      label: label,
      lod1Num: lod1Num,
      paintingNum: null,
      source: "mag-generated",
    });
    if (lod1Num) {
      return ensureLod1Analysis(lod1Num).then(function () {});
    }
    return Promise.resolve();
  }

  function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function fillTrayRandom() {
    if (!state.pool.length) {
      state.trayItems = [];
      return;
    }
    state.trayMode = "random";
    state.trayItems = shuffleArray(state.pool).slice(0, Math.min(TRAY_SLICE, state.pool.length));
    var allBtn = $("mag-show-all");
    if (allBtn) allBtn.classList.remove("active");
    var randBtn = $("mag-randomize");
    if (randBtn) randBtn.classList.add("active");
  }

  function fillTrayAll() {
    state.trayMode = "all";
    state.trayItems = state.pool.slice();
    var allBtn = $("mag-show-all");
    if (allBtn) allBtn.classList.add("active");
    var randBtn = $("mag-randomize");
    if (randBtn) randBtn.classList.remove("active");
  }

  function formatVisualSightLine(cell, analysis) {
    var header = "";
    if (cell.paintingNum) header = "Painting #" + cell.paintingNum;
    else if (cell.lod1Num) header = "LOD1 #" + cell.lod1Num;
    else if (cell.label) header = cell.label;
    else header = "Source image";

    var parts = [];
    if (analysis) {
      if (analysis.title) parts.push('Title seen: "' + analysis.title + '".');
      if (analysis.description) parts.push("How it looks: " + analysis.description.trim());
      else if (analysis.title) parts.push("How it looks: " + analysis.title + ".");
      if (analysis.style) parts.push("Style seen: " + analysis.style + ".");
      if (analysis.medium) parts.push("Medium: " + analysis.medium + ".");
      if (analysis.mood) parts.push("Mood seen: " + analysis.mood + ".");
      if (analysis.colors && analysis.colors.length) {
        parts.push("Colors seen: " + analysis.colors.slice(0, 10).join(", ") + ".");
      }
      if (analysis.tags && analysis.tags.length) {
        parts.push("Visual motifs seen: " + analysis.tags.slice(0, 12).join(", ") + ".");
      }
    } else {
      parts.push(
        "Visual reference without text analysis — adapt the visible forms and palette from this image file" +
          (cell.label ? " (" + cell.label + ")" : "") +
          "."
      );
    }
    return header + " — " + parts.join(" ");
  }

  function visualLineForCell(cell) {
    cell = normalizeItem(cell);
    if (!cell.url && !cell.paintingNum && !cell.lod1Num) {
      return Promise.resolve("Empty spell.");
    }
    if (cell.paintingNum) {
      var a = window.getGalleryAnalysis ? window.getGalleryAnalysis(cell.paintingNum) : null;
      return Promise.resolve(formatVisualSightLine(cell, a));
    }
    var lod1 = cell.lod1Num || parseLod1NumFromUrl(cell.url);
    if (lod1) {
      cell.lod1Num = lod1;
      var la = state.lod1Analyses[String(lod1)] || state.lod1Analyses[lod1];
      if (la) return Promise.resolve(formatVisualSightLine(cell, la));
      return ensureLod1Analysis(lod1).then(function (analysis) {
        return formatVisualSightLine(cell, analysis);
      });
    }
    return Promise.resolve(formatVisualSightLine(cell, null));
  }

  function castStrengthPercent(castNum) {
    return Math.min(40 + Math.max(castNum, 1) * 14, 88);
  }

  function formatCastBoost(castNum, latestCell) {
    var pct = castStrengthPercent(castNum);
    var label = (latestCell && latestCell.label) || "the latest spell";
    if (castNum > 1) {
      return (
        "CAST #" +
        castNum +
        " — NEW GENERATION (" +
        pct +
        "% push toward latest spell): Paint a wholly fresh artwork fusing every active spell. " +
        "This is a brand-new image, not an in-place edit of a prior frame. " +
        "Drive the composition hardest toward " +
        label +
        " — bold palette, forms, light, and layout shift from earlier casts."
      );
    }
    return (
      "CAST #" +
      castNum +
      " — STRONG FUSION (" +
      pct +
      "% weight): Build the image primarily from the applied spells' sight descriptions. " +
      "Lead with " +
      label +
      " — decisive forms, colors, and spatial layout from what is seen in the sources."
    );
  }

  function buildVisualDescription(cells, latestCell, castNum) {
    cells = (cells || []).filter(function (c) {
      return c && (c.url || c.paintingNum || c.lod1Num);
    });
    if (!cells.length) return Promise.resolve("No spells applied — drag a spell upward first.");
    return Promise.all(cells.map(visualLineForCell)).then(function (lines) {
      var boost = formatCastBoost(castNum, latestCell);
      var latestNote = "";
      if (latestCell && latestCell.label) {
        latestNote =
          "\n\nLATEST SPELL EMPHASIS: " +
          latestCell.label +
          " must drive this generation — prioritize its seen forms, palette, and motifs over all others.";
      }
      return (
        boost +
        "\n\nVISUAL SIGHT DESCRIPTIONS (what is seen in each source — adapt these looks):\n\n" +
        lines
          .map(function (line, i) {
            return i + 1 + ". " + line;
          })
          .join("\n\n") +
        "\n\nCompose one painting by adapting the seen forms, colors, light, edges, and surfaces above." +
        latestNote
      );
    });
  }

  function wrapVisualIntent(description) {
    return VISUAL_INTENT_PREFIX + description;
  }

  function playerPrompt() {
    var el = $("mag-prompt");
    return el && el.value ? el.value.trim() : "";
  }

  function formatSubjectivePrompt(prompt) {
    if (!prompt) return "";
    return (
      "Subjective focus (prioritize this intent, mood, and personal emphasis while keeping the visual sight descriptions accurate): " +
      prompt
    );
  }

  function localStasisWithSubjectivePriority(description, prompt) {
    var base = wrapVisualIntent(description);
    if (!prompt) return base;
    return (
      formatSubjectivePrompt(prompt) +
      "\n\nVisual sight grounding (how source images are seen — do not replace with narrative):\n" +
      base
    );
  }

  function paintingNumsFromItems(items) {
    var nums = [];
    items.forEach(function (cell) {
      if (cell.paintingNum && nums.indexOf(cell.paintingNum) < 0) nums.push(cell.paintingNum);
    });
    return nums.sort(function (a, b) {
      return a - b;
    });
  }

  function updateSaveButton() {
    var btn = $("mag-save");
    if (btn) btn.disabled = !state.visionUrl || state.generating;
  }

  function showVision(url) {
    state.visionUrl = url || "";
    var img = $("mag-canvas-img");
    var empty = $("mag-drop-empty");
    var zone = $("mag-drop-zone");
    if (!img) return;
    if (!url) {
      img.hidden = true;
      img.removeAttribute("src");
      if (empty) empty.hidden = false;
      if (zone) zone.classList.remove("mag-has-image");
      updateSaveButton();
      return;
    }
    if (empty) empty.hidden = true;
    img.hidden = false;
    img.src = url;
    img.alt = "Mobile Art Gen composition — hold to save";
    if (zone) zone.classList.add("mag-has-image");
    updateSaveButton();
  }

  function saveVisionImage() {
    var url = state.visionUrl;
    if (!url) {
      setStatus("Nothing to save yet — cast a spell first.", "error");
      return;
    }
    var abs = absoluteAssetUrl(url);
    setStatus("Saving image…", "pending");
    var work;
    if (/^data:/i.test(url)) {
      work = Promise.resolve(url);
    } else {
      work = fetch(abs, { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("Could not fetch image.");
          return r.blob();
        })
        .then(function (blob) {
          return URL.createObjectURL(blob);
        });
    }
    work
      .then(function (href) {
        var a = document.createElement("a");
        a.href = href;
        a.download = "mobile-art-gen-" + Date.now() + ".jpg";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        if (!/^data:/i.test(href)) {
          setTimeout(function () {
            URL.revokeObjectURL(href);
          }, 2000);
        }
        setStatus("Image saved — check Downloads / Photos.", "ok");
      })
      .catch(function () {
        window.open(abs, "_blank", "noopener");
        setStatus("Opened image — use your browser menu to save.", "ok");
      });
  }

  function renderApplied() {
    var heading = $("mag-applied-heading");
    if (heading) {
      heading.textContent = state.applied.length
        ? "Active spells (" + state.applied.length + ") — scroll to see all"
        : "Active spells — none yet";
    }
    var wrap = $("mag-applied");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!state.applied.length) {
      var empty = document.createElement("p");
      empty.className = "mag-applied-empty";
      empty.textContent = "Cast spells upward to list them here.";
      wrap.appendChild(empty);
      return;
    }
    state.applied.forEach(function (item, idx) {
      item = normalizeItem(item);
      var chip = document.createElement("div");
      chip.className = "mag-applied-chip";
      chip.title = item.label || "Spell";
      if (item.url) {
        var thumb = document.createElement("img");
        thumb.src = item.url;
        thumb.alt = "";
        chip.appendChild(thumb);
      }
      var txt = document.createElement("span");
      txt.textContent = item.label || "Spell";
      chip.appendChild(txt);
      var rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "×";
      rm.style.cssText =
        "border:none;background:transparent;color:inherit;cursor:pointer;padding:0 0.15rem;font-size:0.85rem;line-height:1;";
      rm.title = "Remove spell";
      rm.addEventListener("click", function () {
        state.applied.splice(idx, 1);
        renderApplied();
      });
      chip.appendChild(rm);
      wrap.appendChild(chip);
    });
  }

  function renderTray() {
    var strip = $("mag-spell-strip");
    if (!strip) return;
    strip.innerHTML = "";
    state.trayItems.forEach(function (item, idx) {
      item = normalizeItem(item);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mag-spell";
      btn.dataset.idx = String(idx);
      btn.title = "Drag upward: " + (item.label || "spell");
      var img = document.createElement("img");
      img.className = "mag-spell-thumb";
      img.src = item.url;
      img.alt = item.label || "Spell";
      img.loading = "lazy";
      btn.appendChild(img);
      var lbl = document.createElement("span");
      lbl.className = "mag-spell-label";
      lbl.textContent = item.label || "Spell";
      btn.appendChild(lbl);
      strip.appendChild(btn);
    });
    updateTrayCount();
  }

  function pollImageJob(jobId, attemptsLeft, castNum) {
    if (attemptsLeft == null) attemptsLeft = 100;
    if (attemptsLeft <= 0) {
      return Promise.reject(new Error("Generation timed out — try again or use fewer spells."));
    }
    return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), {}, 20000)
      .then(function (r) {
        if (r.status === 404) {
          throw new Error("Generation job lost — reload and try again.");
        }
        return r.json();
      })
      .then(function (job) {
        var label = castNum ? "Cast #" + castNum + " — " : "";
        setStatus(label + "generating… (" + (job.status || "working") + ")", "pending");
        if (job.status === "done") {
          var img = job.image || (job.images && job.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        }
        if (job.status === "failed") {
          throw new Error((job.error && job.error.message) || "Generation failed.");
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, 1000);
        }).then(function () {
          return pollImageJob(jobId, attemptsLeft - 1, castNum);
        });
      });
  }

  function compressDataUrl(dataUrl) {
    if (window.FleetingIdea && window.FleetingIdea.prepareCaptureForApi) {
      return window.FleetingIdea.prepareCaptureForApi(dataUrl);
    }
    if (window.FleetingIdea && window.FleetingIdea.compressDataUrl) {
      return window.FleetingIdea.compressDataUrl(dataUrl, 960, 0.78);
    }
    return Promise.resolve(dataUrl);
  }

  function canvasDataUrlFromUrl(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var maxW = 960;
        var scale = Math.min(1, maxW / Math.max(img.naturalWidth || 1, 1));
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
        c.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = function () {
        reject(new Error("Could not load reference image for refine."));
      };
      img.src = url;
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("Could not read reference image."));
      };
      reader.readAsDataURL(blob);
    });
  }

  function prepareReferenceImage(url) {
    if (!url) return Promise.resolve("");
    if (/^data:/i.test(url)) {
      return compressDataUrl(url);
    }
    var abs = absoluteAssetUrl(url);
    if (!/^https?:\/\//i.test(abs)) {
      return compressDataUrl(abs);
    }
    return fetch(abs, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("Could not load reference image.");
        return r.blob();
      })
      .then(blobToDataUrl)
      .then(compressDataUrl)
      .catch(function () {
        return canvasDataUrlFromUrl(abs);
      });
  }

  function finishGeneration(url) {
    showVision(url);
    return registerGeneratedInPool(url).then(function () {
      setStatus(
        "Vision updated — saved to generated · library " + state.pool.length + " spells.",
        "ok"
      );
    });
  }

  function beginGenerate() {
    state.generating = true;
    var zone = $("mag-drop-zone");
    if (zone) zone.classList.add("mag-generating");
    document.querySelectorAll(".mag-spell, .mag-tray-btn").forEach(function (el) {
      if (el.id !== "mag-save") el.disabled = true;
    });
    updateSaveButton();
  }

  function endGenerate() {
    state.generating = false;
    var zone = $("mag-drop-zone");
    if (zone) zone.classList.remove("mag-generating");
    document.querySelectorAll(".mag-spell, .mag-tray-btn").forEach(function (el) {
      el.disabled = false;
    });
    updateSaveButton();
  }

  function generateVision(visualDescription, nums, prompt, castNum) {
    var subjective = prompt ? formatSubjectivePrompt(prompt) : "";
    var stasisPayload = wrapVisualIntent(visualDescription);
    var castBoost = formatCastBoost(castNum, null);
    if (subjective) {
      subjective = castBoost + "\n\n" + subjective;
    } else {
      subjective = castBoost;
    }

    if (window.SPELLFORGE_LOCAL_GENERATE === true && window.composeStasisVisionLocal) {
      setStatus("Generating cast #" + castNum + " locally…", "pending");
      return window
        .composeStasisVisionLocal({
          stasis: localStasisWithSubjectivePriority(visualDescription, prompt),
          spells: nums || [],
          buzz_words: [],
        })
        .then(function (dataUrl) {
          return finishGeneration(dataUrl);
        });
    }

    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "mag-" + Date.now();
    var body = {
      job_id: jobId,
      stasis: stasisPayload,
      buzz_words: [],
      spells: nums || [],
      mag_fresh: true,
      cast_number: castNum,
    };
    if (subjective) body.prompt = subjective;

    setStatus("Generating cast #" + castNum + "…", "pending");
    return fetchWithTimeout(
      apiUrl("/api/generate-stasis-vision"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      FETCH_TIMEOUT_MS
    )
      .then(function (r) {
        if (r.status === 202) {
          return r.json().then(function (d) {
            return pollImageJob((d && d.job_id) || jobId, null, castNum);
          });
        }
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Generate failed");
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        });
      })
      .then(finishGeneration);
  }

  function applySpell(item) {
    if (state.generating) return;
    item = normalizeItem(item);
    if (!item.url) {
      setStatus("That spell has no image.", "error");
      return;
    }

    var exists = state.applied.some(function (a) {
      return itemKey(a) === itemKey(item);
    });
    if (!exists) {
      state.applied.push(item);
      renderApplied();
      scrollToAppliedPanel();
    }

    var prompt = playerPrompt();
    var nums = paintingNumsFromItems(state.applied);
    state.castCount += 1;
    var castNum = state.castCount;

    beginGenerate();
    buildVisualDescription(state.applied, item, castNum)
      .then(function (description) {
        return generateVision(description, nums, prompt, castNum);
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not generate.", "error");
      })
      .finally(endGenerate);
  }

  function resetComposition() {
    if (state.generating) return;
    state.applied = [];
    state.castCount = 0;
    state.visionUrl = "";
    showVision("");
    renderApplied();
    var el = $("mag-prompt");
    if (el) el.value = "";
    setStatus("Canvas cleared — drag spells upward to begin.", "ok");
  }

  function dropZoneRect() {
    var zone = $("mag-drop-zone");
    return zone ? zone.getBoundingClientRect() : null;
  }

  function pointInRect(x, y, rect) {
    return rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function removeGhost() {
    if (state.drag && state.drag.ghost && state.drag.ghost.parentNode) {
      state.drag.ghost.parentNode.removeChild(state.drag.ghost);
    }
    if (state.drag && state.drag.sourceEl) {
      state.drag.sourceEl.classList.remove("mag-spell-dragging");
    }
    state.drag = null;
  }

  function createGhost(item, x, y) {
    var ghost = document.createElement("div");
    ghost.className = "mag-drag-ghost";
    var img = document.createElement("img");
    img.src = item.url;
    img.alt = "";
    ghost.appendChild(img);
    document.body.appendChild(ghost);
    ghost.style.left = x + "px";
    ghost.style.top = y + "px";
    return ghost;
  }

  function onPointerDown(e) {
    if (state.generating) return;
    var spell = e.target.closest(".mag-spell");
    if (!spell || spell.disabled) return;
    var idx = parseInt(spell.dataset.idx, 10);
    var item = normalizeItem(state.trayItems[idx]);
    if (!item.url) return;

    e.preventDefault();
    spell.setPointerCapture(e.pointerId);
    spell.classList.add("mag-spell-dragging");

    var ghost = createGhost(item, e.clientX, e.clientY);
    state.drag = {
      item: item,
      sourceEl: spell,
      ghost: ghost,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      moved: false,
    };

    var zone = $("mag-drop-zone");
    if (zone) zone.classList.add("mag-drop-active");
  }

  function onPointerMove(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    state.drag.moved = true;
    state.drag.ghost.style.left = e.clientX + "px";
    state.drag.ghost.style.top = e.clientY + "px";

    var rect = dropZoneRect();
    var zone = $("mag-drop-zone");
    if (zone) {
      zone.classList.toggle("mag-drop-active", pointInRect(e.clientX, e.clientY, rect));
    }
  }

  function onPointerUp(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    var drag = state.drag;
    var dy = drag.startY - e.clientY;
    var rect = dropZoneRect();
    var overDrop = pointInRect(e.clientX, e.clientY, rect);
    var castUp = dy >= DRAG_UP_THRESHOLD;

    removeGhost();
    var zone = $("mag-drop-zone");
    if (zone) zone.classList.remove("mag-drop-active");

    if (drag.sourceEl && drag.sourceEl.releasePointerCapture) {
      try {
        drag.sourceEl.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }

    if (overDrop && (castUp || dy >= 20)) {
      applySpell(drag.item);
    } else if (!drag.moved && overDrop) {
      applySpell(drag.item);
    }
  }

  function onPointerCancel(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    removeGhost();
    var zone = $("mag-drop-zone");
    if (zone) zone.classList.remove("mag-drop-active");
  }

  function bindCanvasSave() {
    var img = $("mag-canvas-img");
    if (!img) return;
    img.addEventListener(
      "contextmenu",
      function (e) {
        if (!state.visionUrl) return;
        e.stopPropagation();
      },
      true
    );
  }

  function scrollToAppliedPanel() {
    var stage = document.querySelector(".mag-stage-wrap");
    var panel = document.querySelector(".mag-applied-panel");
    if (!stage || !panel) return;
    requestAnimationFrame(function () {
      stage.scrollTop = Math.max(0, panel.offsetTop - stage.offsetTop - 4);
    });
  }

  function bindUi() {
    bindCanvasSave();

    var saveBtn = $("mag-save");
    if (saveBtn) saveBtn.addEventListener("click", saveVisionImage);

    var strip = $("mag-spell-strip");
    if (strip) {
      strip.addEventListener("pointerdown", onPointerDown);
      strip.addEventListener("pointermove", onPointerMove);
      strip.addEventListener("pointerup", onPointerUp);
      strip.addEventListener("pointercancel", onPointerCancel);
    }

    var rand = $("mag-randomize");
    if (rand) {
      rand.addEventListener("click", function () {
        fillTrayRandom();
        renderTray();
        setStatus("Tray randomized from library.", "ok");
      });
    }

    var all = $("mag-show-all");
    if (all) {
      all.addEventListener("click", function () {
        fillTrayAll();
        renderTray();
        setStatus("Showing full library — scroll the tray.", "ok");
      });
    }

    var reset = $("mag-reset");
    if (reset) {
      reset.addEventListener("click", resetComposition);
    }

    var clear = $("mag-clear-prompt");
    if (clear) {
      clear.addEventListener("click", function () {
        var el = $("mag-prompt");
        if (el) el.value = "";
      });
    }

    var prompt = $("mag-prompt");
    if (prompt) {
      prompt.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && state.applied.length && !state.generating) {
          e.preventDefault();
          applySpell(state.applied[state.applied.length - 1]);
        }
      });
    }
  }

  function boot() {
    if (!$("panel-mobile-art-gen")) return;
    renderApplied();
    bindUi();
    window.dispatchEvent(new Event("mobile-art-gen-ready"));
  }

  function onShow() {
    loadImagePool().then(function () {
      if (!state.trayItems.length) {
        fillTrayRandom();
        renderTray();
      }
      updateTrayCount();
    });
  }

  window.MobileArtGen = {
    onShow: onShow,
    applySpell: applySpell,
    getPoolSize: function () {
      return state.pool.length;
    },
    getApplied: function () {
      return state.applied.slice();
    },
  };

  window.addEventListener("mobile-art-gen-show", onShow);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();