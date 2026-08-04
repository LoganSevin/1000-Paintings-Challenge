/**
 * Conceptualizer — 5×3 slot reels, fleeting-style 5 slots, visual-description actualizers.
 */
(function () {
  "use strict";

  var COLS = 5;
  var ROWS = 3;
  var SLOT_COUNT = 5;
  var SLOTS_KEY = "conceptualizer_slots_v1";
  var LOD1_ANALYSES_URL = "data/lod1-analyses.json";
  var FETCH_TIMEOUT_MS = 45000;
  /** Long enough for server-side wait (xAI video can take several minutes). */
  var VIDEO_WAIT_TIMEOUT_MS = 12 * 60 * 1000;
  /** Keep still fidelity high — video model should animate THIS frame, not reinvent it. */
  var REF_MAX_SIDE = 1536;
  var REF_QUALITY = 0.92;
  var ASPECT_KEY = "conceptualizer_aspect_v1";
  var DURATION_KEY = "conceptualizer_duration_v1";
  var RES_KEY = "conceptualizer_resolution_v1";
  var VISUAL_INTENT_PREFIX =
    "CONCEPTUALIZER — visual adaptation only. Paint how the source images are SEEN: " +
    "forms, colors, light, edges, surface, and spatial layout. " +
    "Do not invent a separate narrative; adapt what the descriptions say is visible.\n\n";

  var state = {
    grid: [],
    equipped: [],
    activeSlot: 0,
    pool: [],
    poolReady: false,
    poolLoading: false,
    spinning: false,
    generating: false,
    animating: false,
    visionUrl: "",
    videoUrl: "",
    /** Local sequential save under gallery/saved-videos/ (e.g. 3.mp4). */
    savedVideo: null,
    /** Prompt + visual description that produced the current still (for same-esque animate). */
    visionGen: null,
    aspect: "16:9",
    durationSec: 10,
    resolution: "720p",
    loadTimer: null,
    loadStartedAt: 0,
    lastJob: null,
    loadPhaseHint: "",
    lod1Analyses: {},
    lod1AnalysesLoaded: false,
    lod1AnalysisPending: {},
    sessionPoolAdds: 0,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function parseLod1NumFromUrl(url) {
    if (!url) return null;
    var m = String(url).match(/\/generated\/(\d+)\.[a-z]+/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function emptySlot() {
    return { url: "", label: "", paintingNum: null, lod1Num: null, source: "" };
  }

  function emptyCell() {
    return { url: "", label: "", paintingNum: null, lod1Num: null, source: "" };
  }

  function normalizePoolItem(item) {
    item = item || emptyCell();
    if (!item.lod1Num && item.url) item.lod1Num = parseLod1NumFromUrl(item.url);
    return {
      url: item.url || "",
      label: item.label || "",
      paintingNum: item.paintingNum || null,
      lod1Num: item.lod1Num || null,
      source: item.source || "",
    };
  }

  function loadEquipped() {
    try {
      var raw = localStorage.getItem(SLOTS_KEY);
      if (!raw) return Array(SLOT_COUNT).fill(null).map(emptySlot);
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length !== SLOT_COUNT) {
        return Array(SLOT_COUNT).fill(null).map(emptySlot);
      }
      return parsed.map(normalizePoolItem);
    } catch (e) {
      return Array(SLOT_COUNT).fill(null).map(emptySlot);
    }
  }

  function saveEquipped() {
    try {
      localStorage.setItem(SLOTS_KEY, JSON.stringify(state.equipped));
    } catch (e) {}
  }

  function setStatus(msg, kind) {
    var el = $("cz-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "cz-status" + (kind ? " " + kind : "");
  }

  function updatePoolHint() {
    var hint = $("cz-pool-hint");
    if (!hint) return;
    var session =
      state.sessionPoolAdds > 0 ? " · +" + state.sessionPoolAdds + " new this session" : "";
    hint.textContent = state.pool.length
      ? state.pool.length +
        " images in shuffle roster" +
        session +
        " — paintings, LOD1s, stasis, fallout & your generations."
      : "Pool empty — run start_server.bat and add paintings or generated images.";
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
          return normalizePoolItem({
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
    setStatus("Loading shuffle roster…", "pending");

    var work = Promise.all([
      window.loadGalleryData ? window.loadGalleryData() : Promise.resolve({ manifest: [] }),
      loadLod1Analyses(),
    ]);

    return work
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
            normalizePoolItem({
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
              state.pool = dedupePool(pool.map(normalizePoolItem));
              state.poolReady = true;
              state.poolLoading = false;
              updatePoolHint();
              setStatus(
                state.pool.length
                  ? state.pool.length + " images in shuffle roster."
                  : "Pool empty — add paintings or run the server.",
                state.pool.length ? "ok" : "error"
              );
              return state.pool;
            });
          });
      })
      .catch(function () {
        state.poolLoading = false;
        setStatus("Could not load image pool.", "error");
        return [];
      });
  }

  function addToPool(item) {
    item = normalizePoolItem(item);
    if (!item.url) return false;
    if (state.pool.some(function (p) {
      return p.url === item.url;
    })) {
      updatePoolHint();
      return false;
    }
    state.pool.push(item);
    state.sessionPoolAdds += 1;
    updatePoolHint();
    return true;
  }

  function registerGeneratedInPool(url) {
    if (!url) return Promise.resolve();
    var lod1Num = parseLod1NumFromUrl(url);
    var label = lod1Num ? "LOD1 #" + lod1Num : url.indexOf("data:") === 0 ? "Local generation" : "Generated";
    addToPool({
      url: url,
      label: label,
      lod1Num: lod1Num,
      paintingNum: null,
      source: "conceptualizer-generated",
    });
    if (lod1Num) {
      return ensureLod1Analysis(lod1Num).then(function () {});
    }
    return Promise.resolve();
  }

  function randomPoolItem() {
    if (!state.pool.length) return emptyCell();
    return normalizePoolItem(state.pool[Math.floor(Math.random() * state.pool.length)]);
  }

  /** Prefer a different URL so a broken cell can recover without landing on the same file. */
  function pickDifferentPoolItem(currentUrl) {
    if (!state.pool.length) return emptyCell();
    var item = randomPoolItem();
    if (!currentUrl) return item;
    for (var i = 0; i < 20; i++) {
      item = randomPoolItem();
      if (item.url && item.url !== currentUrl) return item;
    }
    return item;
  }

  function bindCellImage(img) {
    if (!img) return;
    img.onload = function () {
      img.classList.remove("cz-img-failed");
      var cell = img.closest(".cz-cell, .cz-equip-slot");
      if (cell) cell.classList.remove("cz-cell-failed");
    };
    img.onerror = function () {
      img.classList.add("cz-img-failed");
      var cell = img.closest(".cz-cell, .cz-equip-slot");
      if (cell) cell.classList.add("cz-cell-failed");
    };
  }

  function setImgSrc(img, url, forceReload) {
    if (!url) {
      img.removeAttribute("src");
      return;
    }
    if (forceReload) {
      img.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "_czr=" + Date.now();
    } else {
      img.src = url;
    }
  }

  function applyCellImage(cellEl, item, withFall, forceReload) {
    if (!cellEl) return;
    var img = cellEl.querySelector("img");
    if (!img) {
      img = document.createElement("img");
      cellEl.appendChild(img);
    }
    bindCellImage(img);
    img.classList.remove("cz-img-failed");
    cellEl.classList.remove("cz-cell-failed");
    img.alt = (item && item.label) || "Reel";
    img.loading = "lazy";
    setImgSrc(img, (item && item.url) || "", !!forceReload);
    if (withFall) {
      cellEl.classList.remove("cz-falling");
      void cellEl.offsetWidth;
      cellEl.classList.add("cz-falling");
    }
  }

  /** Replace one reel cell from the pool (click a dead/broken tile to reshuffle it). */
  function reshuffleCell(col, row) {
    if (state.spinning || state.generating || !state.pool.length) return;
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
    var idx = cellIndex(col, row);
    var prev = normalizePoolItem(state.grid[idx] || emptyCell());
    var item = pickDifferentPoolItem(prev.url);
    var sameUrl = !!(prev.url && item.url === prev.url);
    state.grid[idx] = item;
    var cellEl = document.querySelector(
      '.cz-cell[data-col="' + col + '"][data-row="' + row + '"]'
    );
    applyCellImage(cellEl, item, true, sameUrl);
    setStatus(
      "Shuffled column " + (col + 1) + ", row " + (row + 1) + ".",
      "ok"
    );
  }

  function fillGridRandom() {
    state.grid = [];
    for (var c = 0; c < COLS; c++) {
      for (var r = 0; r < ROWS; r++) {
        state.grid.push(randomPoolItem());
      }
    }
    renderGrid();
  }

  /** Flat grid is column-major: [c0r0, c0r1, c0r2, c1r0, …] matching fillGridRandom / reel cols */
  function cellIndex(col, row) {
    return col * ROWS + row;
  }

  function columnCells(col) {
    var out = [];
    for (var r = 0; r < ROWS; r++) {
      out.push(normalizePoolItem(state.grid[cellIndex(col, r)] || emptyCell()));
    }
    return out;
  }

  function rowCells(row) {
    var out = [];
    for (var c = 0; c < COLS; c++) {
      out.push(normalizePoolItem(state.grid[cellIndex(c, row)] || emptyCell()));
    }
    return out;
  }

  function paintingNumsFromCells(cells) {
    var nums = [];
    cells.forEach(function (cell) {
      if (cell.paintingNum && nums.indexOf(cell.paintingNum) < 0) nums.push(cell.paintingNum);
    });
    return nums.sort(function (a, b) {
      return a - b;
    });
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

  function fallbackVisualLine(cell) {
    return formatVisualSightLine(cell, null);
  }

  function visualLineForCell(cell) {
    cell = normalizePoolItem(cell);
    if (!cell.url && !cell.paintingNum && !cell.lod1Num) {
      return Promise.resolve("Empty reel cell.");
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
    return Promise.resolve(fallbackVisualLine(cell));
  }

  function buildVisualDescriptionFromCells(cells) {
    cells = (cells || []).filter(function (c) {
      return c && (c.url || c.paintingNum || c.lod1Num);
    });
    if (!cells.length) return Promise.resolve("No images in selection — spin the reels first.");
    return Promise.all(cells.map(visualLineForCell)).then(function (lines) {
      return (
        "VISUAL SIGHT DESCRIPTIONS (what is seen in each source — adapt these looks):\n\n" +
        lines
          .map(function (line, i) {
            return i + 1 + ". " + line;
          })
          .join("\n\n") +
        "\n\nMerge into one painting by adapting the seen forms, colors, light, edges, and surfaces above."
      );
    });
  }

  function wrapVisualIntent(description) {
    return VISUAL_INTENT_PREFIX + description;
  }

  function visualDescriptionForColumn(col) {
    return buildVisualDescriptionFromCells(columnCells(col));
  }

  function visualDescriptionForRow(row) {
    return buildVisualDescriptionFromCells(rowCells(row));
  }

  function visualDescriptionForEquipped(slotIdx) {
    var slot = normalizePoolItem(state.equipped[slotIdx]);
    if (!slot.url && !slot.paintingNum && !slot.lod1Num) {
      return Promise.resolve("Empty equipped slot — randomize a slot thumb first.");
    }
    return buildVisualDescriptionFromCells([slot]);
  }

  function playerPrompt() {
    var el = $("cz-prompt");
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

  function absoluteUrl(url) {
    if (!url) return "";
    if (url.indexOf("blob:") === 0 || url.indexOf("data:") === 0) return url;
    if (/^https?:\/\//i.test(String(url))) {
      try {
        return new URL(url).href;
      } catch (eAbs) {
        return String(url);
      }
    }
    var apiBase = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    if (apiBase) {
      try {
        return new URL(url, apiBase + "/").href;
      } catch (eApi) {}
    }
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return String(url);
    }
  }

  function isSameOriginUrl(url) {
    try {
      return new URL(url, window.location.href).origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }

  function mediaProxyUrl(url, filename) {
    url = absoluteUrl(url);
    if (!url || url.indexOf("blob:") === 0 || url.indexOf("data:") === 0) return url;
    if (isSameOriginUrl(url)) return url;
    var proxyPath =
      "/api/proxy-media?url=" +
      encodeURIComponent(url) +
      (filename ? "&filename=" + encodeURIComponent(filename) : "&filename=video.mp4");
    try {
      return new URL(proxyPath, window.location.href).href;
    } catch (eProxy) {
      return proxyPath;
    }
  }

  function updateSaveVideoUi() {
    var btn = $("cz-save-video");
    var dl = $("cz-video-download");
    var hasRemote = !!state.videoUrl;
    var saved = state.savedVideo;
    if (btn) {
      btn.disabled = !hasRemote && !saved;
      if (saved && saved.name) {
        btn.textContent = "✓ " + saved.name;
        btn.classList.add("cz-saved");
        btn.title = "Saved as gallery/saved-videos/" + saved.name;
      } else {
        btn.textContent = "💾 Save video";
        btn.classList.remove("cz-saved");
        btn.title =
          "Save clip into gallery/saved-videos as the next number (1.mp4, 2.mp4, …)";
      }
    }
    if (dl) {
      if (saved && saved.url) {
        dl.hidden = false;
        dl.href = absoluteUrl(saved.url);
        dl.setAttribute("download", saved.name || "video.mp4");
        dl.textContent = "Download " + (saved.name || "video");
      } else if (hasRemote) {
        dl.hidden = false;
        dl.href = mediaProxyUrl(state.videoUrl, "video.mp4");
        dl.setAttribute("download", "video.mp4");
        dl.textContent = "Download";
      } else {
        dl.hidden = true;
        dl.removeAttribute("href");
      }
    }
  }

  /**
   * Persist remote (or local) clip into gallery/saved-videos/N.mp4 — sequential like generated/.
   */
  function saveVideoToGallery(url, opts) {
    opts = opts || {};
    url = url || state.videoUrl;
    if (!url) return Promise.reject(new Error("No video to save."));
    if (state.savedVideo && state.savedVideo.url && !opts.force) {
      return Promise.resolve(state.savedVideo);
    }

    function applySaved(d) {
      state.savedVideo = {
        num: d.num,
        name: d.name,
        url: d.url,
        path: d.path,
      };
      if (d.url) {
        state.videoUrl = d.url;
        var vid = $("cz-vision-video");
        if (vid) {
          vid.src = absoluteUrl(d.url);
          vid.load();
          vid.play().catch(function () {});
        }
      }
      updateSaveVideoUi();
      return state.savedVideo;
    }

    // blob: must upload file bytes — server cannot fetch blob: URLs
    if (String(url).indexOf("blob:") === 0) {
      return fetch(url)
        .then(function (r) {
          return r.blob();
        })
        .then(function (blob) {
          var form = new FormData();
          form.append(
            "file",
            blob,
            blob.type && blob.type.indexOf("mp4") >= 0 ? "clip.mp4" : "clip.webm"
          );
          form.append("force_mp4", "1");
          return fetchWithTimeout(
            apiUrl("/api/save-video"),
            { method: "POST", body: form },
            VIDEO_WAIT_TIMEOUT_MS
          );
        })
        .then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok || (d && d.ok === false)) {
              throw new Error((d && d.error) || "Could not save video.");
            }
            return applySaved(d);
          });
        });
    }

    return fetchWithTimeout(
      apiUrl("/api/save-video"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: absoluteUrl(url), force_mp4: true }),
      },
      VIDEO_WAIT_TIMEOUT_MS
    ).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok || (d && d.ok === false)) {
          throw new Error((d && d.error) || "Could not save video.");
        }
        return applySaved(d);
      });
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function parseAspect(aspect) {
    var parts = String(aspect || "16:9").split(":");
    var aw = parseFloat(parts[0]);
    var ah = parseFloat(parts[1]);
    if (!(aw > 0) || !(ah > 0)) {
      aw = 16;
      ah = 9;
    }
    return { w: aw, h: ah, ratio: aw / ah };
  }

  /** Aspect used for the current still (locked at generate) or the UI selection. */
  function effectiveAspect() {
    var g = state.visionGen;
    if (g && g.aspect) return g.aspect;
    return state.aspect || "16:9";
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

  /**
   * Fit still into target aspect without stretching (letterbox).
   * Video and still must share the same frame shape so image-to-life does not warp.
   */
  function prepareReferenceForAspect(dataUrl, aspect, maxSide, quality) {
    return new Promise(function (resolve) {
      if (!dataUrl || dataUrl.indexOf("data:image") !== 0) return resolve(dataUrl || "");
      var a = parseAspect(aspect);
      var img = new Image();
      img.onload = function () {
        var iw = Math.max(1, img.width || 1);
        var ih = Math.max(1, img.height || 1);
        var tw;
        var th;
        if (a.ratio >= 1) {
          tw = maxSide;
          th = Math.max(1, Math.round(maxSide / a.ratio));
        } else {
          th = maxSide;
          tw = Math.max(1, Math.round(maxSide * a.ratio));
        }
        var canvas = document.createElement("canvas");
        canvas.width = tw;
        canvas.height = th;
        var ctx = canvas.getContext("2d");
        if (!ctx) return resolve(dataUrl);
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, tw, th);
        var scale = Math.min(tw / iw, th / ih);
        var dw = iw * scale;
        var dh = ih * scale;
        ctx.drawImage(img, (tw - dw) / 2, (th - dh) / 2, dw, dh);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = function () {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  function syncOutputFrameAspect() {
    var frame = document.querySelector("#cz-output .cz-output-frame");
    if (!frame) return;
    var aspect = effectiveAspect();
    frame.style.aspectRatio = String(aspect).replace(":", " / ");
    frame.dataset.aspect = aspect;
  }

  function imageUrlToDataUrl(url) {
    if (!url) return Promise.resolve("");
    if (url.indexOf("data:") === 0) return Promise.resolve(url);
    var fetchUrl = isSameOriginUrl(url) ? absoluteUrl(url) : mediaProxyUrl(url);
    return fetch(fetchUrl)
      .then(function (r) {
        if (!r.ok) throw new Error("Image fetch failed");
        return r.blob();
      })
      .then(function (blob) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () {
            resolve(reader.result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      })
      .catch(function () {
        return url;
      });
  }

  function updateAnimateButton() {
    var btn = $("cz-animate");
    if (!btn) return;
    btn.disabled = !state.visionUrl || state.generating || state.animating || state.spinning;
    if (state.animating) return;
    btn.textContent = "▶ Animate loop";
  }

  function rememberVisionGen(visualDescription, prompt) {
    var player = String(prompt || "").trim();
    var visual = String(visualDescription || "").trim();
    state.visionGen = {
      playerPrompt: player,
      visualDescription: visual,
      /** Locked so animate uses the same frame shape as the still. */
      aspect: state.aspect || "16:9",
      stasisPayload: wrapVisualIntent(visual),
      subjective: player ? formatSubjectivePrompt(player) : "",
      fullGenerationText: localStasisWithSubjectivePriority(visual, player),
      savedAt: Date.now(),
    };
  }

  function clipText(text, maxLen) {
    text = String(text || "").trim();
    if (!text) return "";
    if (text.length <= maxLen) return text;
    return text.slice(0, Math.max(0, maxLen - 16)).trim() + "\n…[truncated]";
  }

  function showVision(url) {
    state.visionUrl = url || "";
    state.videoUrl = "";
    state.savedVideo = null;
    if (!url) state.visionGen = null;
    var img = $("cz-vision-img");
    var vid = $("cz-vision-video");
    var empty = $("cz-output-empty");
    if (vid) {
      vid.hidden = true;
      vid.removeAttribute("src");
      try {
        vid.load();
      } catch (eLoad) {}
    }
    if (!img) {
      updateAnimateButton();
      return;
    }
    if (!url) {
      img.hidden = true;
      img.removeAttribute("src");
      if (empty) empty.hidden = false;
      updateAnimateButton();
      syncOutputFrameAspect();
      return;
    }
    if (empty) empty.hidden = true;
    img.hidden = false;
    img.src = absoluteUrl(url);
    img.alt = "Generated conceptualizer vision";
    updateAnimateButton();
    updateSaveVideoUi();
    syncOutputFrameAspect();
  }

  function showVideo(url) {
    state.videoUrl = url || "";
    state.savedVideo = null;
    var img = $("cz-vision-img");
    var vid = $("cz-vision-video");
    var empty = $("cz-output-empty");
    if (!url || !vid) {
      updateSaveVideoUi();
      return;
    }
    if (empty) empty.hidden = true;
    if (img) img.hidden = true;
    vid.hidden = false;
    vid.loop = true;
    vid.muted = false;
    vid.playsInline = true;
    vid.controls = true;
    if (state.visionUrl) vid.poster = absoluteUrl(state.visionUrl);
    // Local saved-videos/N.mp4 plays directly; remote stills use proxy with a real filename
    var playSrc = isSameOriginUrl(url) || String(url).indexOf("/saved-videos/") >= 0
      ? absoluteUrl(url)
      : mediaProxyUrl(url, "video.mp4");
    vid.src = playSrc;
    vid.load();
    vid.play().catch(function () {});
    updateAnimateButton();
    updateSaveVideoUi();
  }

  /**
   * @param {{ originPrompt?: string, visualDescription?: string, motionExtra?: string }} opts
   */
  function buildLoopStasis(opts) {
    opts = opts || {};
    var origin = String(opts.originPrompt || "").trim();
    var visual = String(opts.visualDescription || "").trim();
    var motionExtra = String(opts.motionExtra || "").trim();
    var lines = [
      "[IMAGE-TO-LIFE — SAME STILL + ORIGINAL GENERATION PROMPT]",
      "The attached reference is the user's generated still. Animate THAT frame only — same-esque living version, not a new artwork.",
      "",
      "ORIGINAL GENERATION PROMPT (what this still was made to depict — honor this intent every frame):",
    ];
    if (origin) {
      lines.push(clipText(origin, 900));
    } else {
      lines.push("(no separate user prompt was used — stay locked to the visual description and still pixels)");
    }
    if (visual) {
      lines.push("");
      lines.push("VISUAL SIGHT GROUNDING used when generating the still (how sources were seen):");
      lines.push(clipText(visual, 1600));
    }
    lines.push("");
    lines.push("FIDELITY LOCK (mandatory every frame):");
    lines.push("• Same composition, camera angle, crop, and framing as the still.");
    lines.push("• Same subjects, silhouettes, proportions, and spatial layout — no swaps, no extras, no removals.");
    lines.push("• Same palette, brushwork, texture, lighting direction, and painterly style.");
    lines.push("• Same reading of the original generation prompt — do not reinterpret into a different scene.");
    lines.push(
      "FORBIDDEN: reimagining, new characters/objects, style transfer, different painting, hard cuts, text, watermarks."
    );
    lines.push("Camera LOCKED — no pan, zoom, Ken Burns, or slideshow. Only internal motion inside the still.");
    lines.push(
      "SEAMLESS LOOP: first and last frames match the reference still. Duration " +
        state.durationSec +
        "s · aspect " +
        effectiveAspect() +
        " (match still frame exactly — do not crop or stretch)."
    );
    if (motionExtra && motionExtra !== origin) {
      lines.push("ADDITIONAL MOTION HINT (do not change subjects or redesign): " + clipText(motionExtra, 400));
    } else if (origin) {
      lines.push(
        "MOTION ONLY: bring the still to life in ways that express the original generation prompt — soft living motion, no redesign."
      );
    } else {
      lines.push(
        "MOTION ONLY: gentle living atmosphere — soft light drift, subtle surface life — no new subjects."
      );
    }
    return lines.join("\n");
  }

  function buildLoopPrompt(opts) {
    opts = opts || {};
    var origin = String(opts.originPrompt || "").trim();
    var visual = String(opts.visualDescription || "").trim();
    var motionExtra = String(opts.motionExtra || "").trim();
    var parts = [
      "IMAGE-TO-LIFE of the attached still — keep the SAME painting, now moving.",
      "Perfect " +
        state.durationSec +
        "s seamless loop at " +
        effectiveAspect() +
        "; start and end frames identical to the still. Fixed camera; do not crop or stretch the frame.",
    ];
    if (origin) {
      parts.push(
        "ORIGINAL GENERATION PROMPT (mandatory subject/mood lock): " + clipText(origin, 700)
      );
    }
    if (visual) {
      parts.push("Visual grounding for that still: " + clipText(visual, 900));
    }
    parts.push(
      "Preserve exact look: forms, colors, brushwork, layout, and the meaning of the generation prompt. No redesign, no scene change, no text."
    );
    if (motionExtra && motionExtra !== origin) {
      parts.push("Motion only: " + clipText(motionExtra, 280));
    } else if (origin) {
      parts.push("Motion only: living expression of the original generation prompt inside the still.");
    } else {
      parts.push("Motion only: subtle light, atmosphere, and micro-life inside the still.");
    }
    return parts.join(" ");
  }

  /** Dense single prompt for server image-to-life path (cast_body.prompt). */
  function buildImageToLifePrompt(opts) {
    opts = opts || {};
    var origin = String(opts.originPrompt || "").trim();
    var visual = String(opts.visualDescription || "").trim();
    var motionExtra = String(opts.motionExtra || "").trim();
    var lines = [
      "IMAGE-TO-LIFE — animate the attached still only. Same-esque: same subjects, composition, palette, brushwork.",
      "Seamless " +
        state.durationSec +
        "s loop at " +
        effectiveAspect() +
        " (same aspect as the still — no crop, no stretch); first frame equals last frame; fixed camera; no redesign.",
    ];
    if (origin) {
      lines.push("This still was generated with this user prompt — stay faithful to it:");
      lines.push(clipText(origin, 800));
    }
    if (visual) {
      lines.push("Visual sight description used for generation:");
      lines.push(clipText(visual, 1200));
    }
    if (motionExtra && motionExtra !== origin) {
      lines.push("Extra motion (must not change identity): " + clipText(motionExtra, 300));
    } else {
      lines.push(
        origin
          ? "Animate living motion that expresses that generation prompt without changing what is depicted."
          : "Animate soft living motion inside the still only."
      );
    }
    return lines.join("\n");
  }

  function buildLoopCraftHints(opts) {
    opts = opts || {};
    var origin = String(opts.originPrompt || "").trim();
    var bits = [
      "image-to-life",
      "same still as generation",
      "honor original generation prompt",
      "same-esque",
      "fidelity lock",
      "no redesign",
      "fixed camera",
      "seamless loop",
      state.durationSec + "s",
      effectiveAspect(),
      "match still aspect",
    ];
    if (origin) bits.push("prompt: " + clipText(origin, 120).replace(/\n/g, " "));
    return bits.join("; ");
  }

  function buildLoopBeats(opts) {
    opts = opts || {};
    var origin = String(opts.originPrompt || "").trim();
    var motionExtra = String(opts.motionExtra || "").trim();
    var d = state.durationSec;
    var mid = Math.max(2, Math.round(d / 2));
    var almost = Math.max(mid + 1, d - 1);
    var peak =
      motionExtra && motionExtra !== origin
        ? "Peak motion only (still same image + original prompt): " + clipText(motionExtra, 200)
        : origin
          ? "Peak living motion expressing original prompt — still the same image: " +
            clipText(origin, 200)
          : "Peak ambient life inside the SAME still — no new subjects, no camera move.";
    return [
      {
        t: 0,
        text:
          "Match the reference still and original generation intent exactly — same crop, subjects, palette" +
          (origin ? "; prompt: " + clipText(origin, 140) : "") +
          ".",
      },
      {
        t: Math.min(2, mid - 1),
        text: "Soft internal motion only — composition and generation prompt stay locked.",
      },
      { t: mid, text: peak },
      {
        t: almost,
        text: "Ease motion back; still identical to reference and original prompt reading.",
      },
      {
        t: d,
        text: "Return to the exact reference still for a perfect loop join — same as frame 0.",
      },
    ];
  }

  function visionAnimateOpts() {
    var g = state.visionGen || {};
    var currentBox = playerPrompt();
    var origin = String(g.playerPrompt || "").trim();
    var visual = String(g.visualDescription || "").trim();
    // Current prompt box: only as extra motion if it differs from the generation prompt
    var motionExtra = "";
    if (currentBox && currentBox !== origin) motionExtra = currentBox;
    return {
      originPrompt: origin,
      visualDescription: visual,
      motionExtra: motionExtra,
      fullGenerationText: g.fullGenerationText || "",
    };
  }

  function formatClock(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function humanJobPhase(status, xaiStatus) {
    var st = String(status || "").toLowerCase();
    var xai = String(xaiStatus || "").toLowerCase();
    if (xai.indexOf("overload") >= 0) return "Provider busy — retrying";
    if (st === "starting") return "Starting…";
    if (st === "pending" || st === "queued" || st === "created" || st === "waiting")
      return "In queue — waiting for a render slot";
    if (st === "running" || st === "processing" || st === "working" || st === "in_progress")
      return "Rendering motion frames";
    if (st === "finalizing" || st === "uploading" || st === "postprocess") return "Finalizing clip";
    if (st === "done" || st === "completed" || st === "success" || st === "succeeded") return "Done";
    if (st === "failed" || st === "error" || st === "expired") return "Failed";
    if (st) return "Working — " + st;
    return "Working…";
  }

  function estimateLoadProgress(elapsedSec, job) {
    var eta = state.durationSec <= 6 ? 50 : state.durationSec <= 10 ? 75 : 100;
    if (state.resolution === "720p") eta += 15;
    var st = String((job && job.status) || "").toLowerCase();
    var base = 8;
    if (st === "pending" || st === "queued") base = 12 + Math.min(18, elapsedSec * 0.4);
    else if (st === "running" || st === "processing" || st === "working")
      base = 30 + Math.min(55, (elapsedSec / eta) * 55);
    else if (st === "finalizing") base = 88;
    else if (st === "done") base = 100;
    else base = 15 + Math.min(50, (elapsedSec / eta) * 50);
    return Math.max(6, Math.min(96, Math.round(base)));
  }

  function setLoadingOverlay(on, opts) {
    opts = opts || {};
    var el = $("cz-loading");
    if (!el) return;
    if (!on) {
      el.hidden = true;
      el.setAttribute("aria-busy", "false");
      if (state.loadTimer) {
        clearInterval(state.loadTimer);
        state.loadTimer = null;
      }
      state.lastJob = null;
      state.loadPhaseHint = "";
      var frame = el.closest(".cz-output-frame");
      if (frame) frame.classList.remove("cz-is-loading");
      return;
    }
    el.hidden = false;
    el.removeAttribute("hidden");
    el.setAttribute("aria-busy", "true");
    var frameOn = el.closest(".cz-output-frame");
    if (frameOn) frameOn.classList.add("cz-is-loading");
    var title = $("cz-loading-title");
    var phase = $("cz-loading-phase");
    var meta = $("cz-loading-meta");
    var fill = $("cz-loading-bar-fill");
    if (title) title.textContent = opts.title || "Animating seamless loop…";
    if (opts.phase) state.loadPhaseHint = opts.phase;
    if (phase) phase.textContent = opts.phase || state.loadPhaseHint || "Starting";
    if (meta) {
      meta.textContent =
        (opts.meta || formatClock(0) + " elapsed") +
        " · " +
        state.durationSec +
        "s · " +
        effectiveAspect() +
        " · " +
        state.resolution;
    }
    if (fill) fill.style.width = (opts.progress != null ? opts.progress : 10) + "%";
  }

  function updateLoadingProgress(job) {
    if (job && (job.status || job.xai_status || job.elapsed_sec != null)) {
      state.lastJob = job;
    }
    job = job || state.lastJob || {};
    var elapsed =
      job.elapsed_sec != null
        ? Number(job.elapsed_sec)
        : (Date.now() - (state.loadStartedAt || Date.now())) / 1000;
    var stRaw = String(job.status || "").toLowerCase();
    var phase = humanJobPhase(job.status, job.xai_status);
    // Keep manual prep phases until the job API reports a real status
    if (
      state.loadPhaseHint &&
      (!stRaw || stRaw === "starting") &&
      !job.xai_status
    ) {
      phase = state.loadPhaseHint;
    }
    var pct = estimateLoadProgress(elapsed, job);
    var etaSec = state.durationSec <= 6 ? 50 : state.durationSec <= 10 ? 75 : 100;
    if (state.resolution === "720p") etaSec += 15;
    var remain = Math.max(0, Math.round(etaSec - elapsed));
    setLoadingOverlay(true, {
      title: "Animating seamless loop…",
      phase: phase,
      meta: formatClock(elapsed) + " elapsed · ~" + formatClock(remain) + " left",
      progress: pct,
    });
    setStatus(
      phase + " · " + formatClock(elapsed) + " · " + state.resolution + " · " + state.durationSec + "s",
      "pending"
    );
    var animBtn = $("cz-animate");
    if (animBtn && state.animating) {
      animBtn.textContent = "⏳ " + formatClock(elapsed);
    }
  }

  function startLoadingTicker() {
    state.loadStartedAt = Date.now();
    state.lastJob = { status: "starting" };
    if (state.loadTimer) clearInterval(state.loadTimer);
    state.loadTimer = setInterval(function () {
      if (!state.animating) return;
      updateLoadingProgress(null);
    }, 500);
  }

  function videoUrlFromPayload(d) {
    if (!d) return "";
    var vid = d.video;
    var url =
      (vid && (vid.url || vid.download_url || vid.uri)) ||
      d.video_url ||
      d.output_url ||
      d.result_url;
    return url ? absoluteUrl(url) : "";
  }

  function setBusyUi(busy) {
    document
      .querySelectorAll(".cz-act-btn, .cz-spin-btn, .cz-dur-btn, .cz-res-btn, .cz-aspect-select")
      .forEach(function (el) {
        el.disabled = !!busy;
      });
    updateAnimateButton();
  }

  function animateVisionLoop() {
    if (state.animating || state.generating) return;
    if (!state.visionUrl) {
      setStatus("Generate a vision first, then animate it into a loop.", "error");
      return;
    }
    state.animating = true;
    setBusyUi(true);
    var animBtn = $("cz-animate");
    if (animBtn) {
      animBtn.classList.add("cz-busy");
      animBtn.textContent = "⏳ 0:00";
    }
    startLoadingTicker();
    setLoadingOverlay(true, {
      title: "Animating seamless loop…",
      phase: "Preparing reference frame",
      meta: "0:00 elapsed",
      progress: 8,
    });
    var loopAspect = effectiveAspect();
    setStatus(
      "Preparing reference frame · " +
        loopAspect +
        " · " +
        state.resolution +
        " · " +
        state.durationSec +
        "s",
      "pending"
    );
    var animOpts = visionAnimateOpts();
    if (!animOpts.originPrompt && !animOpts.visualDescription) {
      setStatus(
        "Animating with still only — regenerate a vision first so the original prompt is remembered for same-esque motion.",
        "pending"
      );
    }
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "cz-vid-" + Date.now();
    var imageUrl = absoluteUrl(state.visionUrl);
    var imageToLifePrompt = buildImageToLifePrompt(animOpts);

    setStatus(
      "Preparing " +
        state.durationSec +
        "s · " +
        loopAspect +
        " · " +
        state.resolution +
        " loop" +
        (animOpts.originPrompt ? " (using generation prompt)" : "") +
        "…",
      "pending"
    );

    imageUrlToDataUrl(imageUrl)
      .then(function (raw) {
        setLoadingOverlay(true, {
          title: "Animating seamless loop…",
          phase: "Fitting still to " + loopAspect + " (no stretch)",
          meta: formatClock((Date.now() - state.loadStartedAt) / 1000) + " elapsed",
          progress: 14,
        });
        // Letterbox into the still's aspect so the video model never stretches a different ratio
        return prepareReferenceForAspect(raw, loopAspect, REF_MAX_SIDE, REF_QUALITY);
      })
      .then(function (compressed) {
        if (!compressed) throw new Error("Could not prepare the generated image for animation.");
        state.lastJob = { status: "running" };
        state.loadPhaseHint = "Rendering motion on the server…";
        setLoadingOverlay(true, {
          title: "Animating seamless loop…",
          phase: animOpts.originPrompt
            ? "Rendering with generation prompt lock…"
            : "Rendering motion on the server…",
          meta: formatClock((Date.now() - state.loadStartedAt) / 1000) + " elapsed",
          progress: 28,
        });
        setStatus(
          "Rendering motion on the server… · " +
            loopAspect +
            " · " +
            state.resolution +
            " · " +
            state.durationSec +
            "s" +
            (animOpts.originPrompt ? " · prompt locked" : ""),
          "pending"
        );
        // wait:true — server runs the job to completion (no /api/jobs poll loop)
        return fetchWithTimeout(
          apiUrl("/api/animate-cast"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              wait: true,
              wait_for_result: true,
              job_id: jobId,
              stasis: buildLoopStasis(animOpts),
              prompt: buildLoopPrompt(animOpts),
              // Dense prompt for image-to-life path (overrides cast_body.prompt on server)
              image_to_life_prompt: imageToLifePrompt,
              generation_prompt: animOpts.originPrompt || "",
              generation_visual: clipText(animOpts.visualDescription, 2000),
              craft_hints: buildLoopCraftHints(animOpts),
              buzz_words: [
                "image-to-life",
                "same still",
                "original generation prompt",
                "same-esque",
                "fidelity lock",
                "no redesign",
                "seamless loop",
                "fixed camera",
                "match still aspect",
                "conceptualizer",
              ],
              beats: buildLoopBeats(animOpts),
              duration: state.durationSec,
              // No style spells — only the generated still + original prompt drive appearance
              spells: [],
              spell_cast: false,
              // Dual-lock: same still as primary + identity ref
              spell_reference_image: compressed,
              resolution: state.resolution,
              aspect_ratio: loopAspect,
              morph_chain: false,
              culmination: true,
              reference_image: compressed,
              image_url: imageUrl,
            }),
          },
          VIDEO_WAIT_TIMEOUT_MS
        );
      })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) {
            var errObj = d && d.error;
            var errMsg =
              (typeof errObj === "string" && errObj) ||
              (errObj && (errObj.message || errObj.error)) ||
              (d && d.message) ||
              "Animate failed";
            throw new Error(errMsg);
          }
          var url = videoUrlFromPayload(d);
          if (url) return url;
          var st = String((d && d.status) || "").toLowerCase();
          if (st === "failed" || st === "error" || st === "expired") {
            throw new Error(
              (d.error && (d.error.message || d.error)) || "Video generation failed."
            );
          }
          throw new Error(
            "No video returned. Restart start_server.bat so wait-mode is active, then try again."
          );
        });
      })
      .then(function (url) {
        setLoadingOverlay(true, {
          title: "Animating seamless loop…",
          phase: "Saving clip to saved-videos…",
          meta: formatClock((Date.now() - state.loadStartedAt) / 1000) + " elapsed",
          progress: 100,
        });
        showVideo(url);
        // Auto-save into gallery/saved-videos/N.mp4 (sequential, not "proxy-media")
        return saveVideoToGallery(url)
          .then(function (saved) {
            setStatus(
              "Loop ready — saved as saved-videos/" +
                (saved && saved.name ? saved.name : "?") +
                " · " +
                state.durationSec +
                "s · " +
                effectiveAspect() +
                " · " +
                state.resolution +
                ".",
              "ok"
            );
          })
          .catch(function (saveErr) {
            setStatus(
              "Loop ready (not saved yet — " +
                ((saveErr && saveErr.message) || "save failed") +
                "). Use Save video.",
              "pending"
            );
          });
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not animate loop.", "error");
      })
      .finally(function () {
        state.animating = false;
        setLoadingOverlay(false);
        setBusyUi(false);
        var doneBtn = $("cz-animate");
        if (doneBtn) {
          doneBtn.classList.remove("cz-busy");
          doneBtn.textContent = "▶ Animate loop";
        }
        document.querySelectorAll(".cz-dur-btn, .cz-res-btn").forEach(function (btn) {
          btn.disabled = false;
        });
        var aspectEl = $("cz-aspect");
        if (aspectEl) aspectEl.disabled = false;
        document.querySelectorAll(".cz-act-btn").forEach(function (btn) {
          btn.disabled = false;
        });
        var spin = $("cz-spin");
        if (spin) spin.disabled = state.spinning;
        updateAnimateButton();
        syncDurationButtons();
        syncResButtons();
      });
  }

  function syncDurationButtons() {
    document.querySelectorAll(".cz-dur-btn").forEach(function (btn) {
      var d = parseInt(btn.getAttribute("data-dur"), 10);
      var on = d === state.durationSec;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function syncResButtons() {
    document.querySelectorAll(".cz-res-btn").forEach(function (btn) {
      var r = btn.getAttribute("data-res") || "";
      var on = r === state.resolution;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function loadVideoPrefs() {
    try {
      var a = localStorage.getItem(ASPECT_KEY);
      if (a) state.aspect = a;
      var d = parseInt(localStorage.getItem(DURATION_KEY), 10);
      if (d === 6 || d === 10 || d === 15) state.durationSec = d;
      var res = localStorage.getItem(RES_KEY);
      if (res === "480p" || res === "720p") state.resolution = res;
    } catch (e) {}
  }

  function saveVideoPrefs() {
    try {
      localStorage.setItem(ASPECT_KEY, state.aspect);
      localStorage.setItem(DURATION_KEY, String(state.durationSec));
      localStorage.setItem(RES_KEY, state.resolution);
    } catch (e) {}
  }

  function pollImageJob(jobId, attemptsLeft) {
    if (attemptsLeft == null) attemptsLeft = 60;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Generation timed out."));
    return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), {}, 20000)
      .then(function (r) {
        return r.json();
      })
      .then(function (job) {
        setStatus("Generating… (" + (job.status || "working") + ")", "pending");
        if (job.status === "done") {
          var img = job.image || (job.images && job.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        }
        if (job.status === "failed") {
          throw new Error((job.error && job.error.message) || "Generation failed.");
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, 900);
        }).then(function () {
          return pollImageJob(jobId, attemptsLeft - 1);
        });
      });
  }

  function finishGeneration(url) {
    showVision(url);
    return registerGeneratedInPool(url).then(function () {
      setStatus(
        "Vision ready — roster now " + state.pool.length + " images (+" + state.sessionPoolAdds + " this session).",
        "ok"
      );
    });
  }

  function generateVision(visualDescription, nums, prompt) {
    var subjective = prompt ? formatSubjectivePrompt(prompt) : "";
    var stasisPayload = wrapVisualIntent(visualDescription);
    var stillAspect = state.aspect || "16:9";

    function afterImageUrl(url) {
      // Only bind generation prompt + aspect after a successful still
      rememberVisionGen(visualDescription, prompt);
      return finishGeneration(url);
    }

    if (window.SPELLFORGE_LOCAL_GENERATE === true && window.composeStasisVisionLocal) {
      setStatus("Fusing locally at " + stillAspect + "…", "pending");
      return window
        .composeStasisVisionLocal({
          stasis: localStasisWithSubjectivePriority(visualDescription, prompt),
          spells: nums || [],
          buzz_words: [],
          aspect_ratio: stillAspect,
        })
        .then(afterImageUrl);
    }

    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "cz-" + Date.now();
    var body = {
      job_id: jobId,
      stasis: stasisPayload,
      buzz_words: [],
      spells: nums || [],
      // Same aspect as Animate loop — still and video must share frame shape
      aspect_ratio: stillAspect,
    };
    if (subjective) body.prompt = subjective;

    setStatus("Generating visual adaptation at " + stillAspect + "…", "pending");
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
            return pollImageJob((d && d.job_id) || jobId);
          });
        }
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Generate failed");
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        });
      })
      .then(afterImageUrl);
  }

  function beginGenerate() {
    state.generating = true;
    document.querySelectorAll(".cz-act-btn, .cz-spin-btn").forEach(function (btn) {
      btn.disabled = true;
    });
    updateAnimateButton();
  }

  function endGenerate() {
    state.generating = false;
    document.querySelectorAll(".cz-act-btn").forEach(function (btn) {
      btn.disabled = false;
    });
    var spin = $("cz-spin");
    if (spin) spin.disabled = state.spinning;
    updateAnimateButton();
  }

  function actualizeColumn(col, mode) {
    if (state.generating) return;
    var prompt = playerPrompt();
    if (mode === "player" && !prompt) {
      setStatus("Type your prompt — subjective focus on top of the column's visual descriptions.", "error");
      return;
    }
    beginGenerate();
    visualDescriptionForColumn(col)
      .then(function (description) {
        var nums = paintingNumsFromCells(columnCells(col));
        if (mode === "player") return generateVision(description, nums, prompt);
        return generateVision(description, nums, "");
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not generate.", "error");
      })
      .finally(endGenerate);
  }

  function actualizeRow(row, mode) {
    if (state.generating) return;
    if (row < 0 || row >= ROWS) return;
    var prompt = playerPrompt();
    if (mode === "player" && !prompt) {
      setStatus("Type your prompt — subjective focus on top of the row's visual descriptions.", "error");
      return;
    }
    beginGenerate();
    visualDescriptionForRow(row)
      .then(function (description) {
        var nums = paintingNumsFromCells(rowCells(row));
        if (mode === "player") return generateVision(description, nums, prompt);
        return generateVision(description, nums, "");
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not generate.", "error");
      })
      .finally(endGenerate);
  }

  function actualizeEquipped(slotIdx, mode) {
    if (state.generating) return;
    var slot = normalizePoolItem(state.equipped[slotIdx]);
    if (!slot.url && !slot.paintingNum && !slot.lod1Num) {
      setStatus("Equip slot " + (slotIdx + 1) + " first (click a thumb).", "error");
      return;
    }
    var prompt = playerPrompt();
    if (mode === "player" && !prompt) {
      setStatus("Type your prompt — subjective focus on top of the slot's visual description.", "error");
      return;
    }
    beginGenerate();
    var nums = slot.paintingNum ? [slot.paintingNum] : [];
    visualDescriptionForEquipped(slotIdx)
      .then(function (description) {
        if (mode === "player") return generateVision(description, nums, prompt);
        return generateVision(description, nums, "");
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not generate.", "error");
      })
      .finally(endGenerate);
  }

  function spinReels() {
    if (state.spinning || state.generating || !state.pool.length) return;
    state.spinning = true;
    var spinBtn = $("cz-spin");
    if (spinBtn) spinBtn.disabled = true;
    setStatus("Spinning reels…", "pending");

    document.querySelectorAll(".cz-reel-col").forEach(function (col) {
      col.classList.add("cz-spinning");
    });

    var totalMs = 0;
    for (var c = 0; c < COLS; c++) {
      (function (col) {
        var delay = 180 + col * 140;
        totalMs = Math.max(totalMs, delay + 620);
        setTimeout(function () {
          var colEl = document.querySelector('.cz-reel-col[data-col="' + col + '"]');
          if (colEl) colEl.classList.remove("cz-spinning");
          for (var r = 0; r < ROWS; r++) {
            (function (row) {
              var idx = cellIndex(col, row);
              var cellDelay = row * 90;
              setTimeout(function () {
                state.grid[idx] = randomPoolItem();
                var cellEl = document.querySelector(
                  '.cz-cell[data-col="' + col + '"][data-row="' + row + '"]'
                );
                applyCellImage(cellEl, state.grid[idx], true, false);
              }, cellDelay);
            })(r);
          }
        }, delay);
      })(c);
    }

    setTimeout(function () {
      state.spinning = false;
      if (spinBtn) spinBtn.disabled = state.generating;
      setStatus("Reels stopped — " + state.pool.length + " images in roster.", "ok");
    }, totalMs + 80);
  }

  function renderGrid() {
    var gridEl = $("cz-reels-grid");
    if (!gridEl) return;
    gridEl.innerHTML = "";
    for (var c = 0; c < COLS; c++) {
      var colEl = document.createElement("div");
      colEl.className = "cz-reel-col";
      colEl.dataset.col = String(c);
      for (var r = 0; r < ROWS; r++) {
        var idx = cellIndex(c, r);
        var cell = normalizePoolItem(state.grid[idx] || emptyCell());
        state.grid[idx] = cell;
        var cellEl = document.createElement("div");
        cellEl.className = "cz-cell";
        cellEl.dataset.col = String(c);
        cellEl.dataset.row = String(r);
        cellEl.title = "Click to shuffle this image";
        var img = document.createElement("img");
        img.alt = cell.label || "Reel";
        img.loading = "lazy";
        bindCellImage(img);
        if (cell.url) img.src = cell.url;
        cellEl.appendChild(img);
        colEl.appendChild(cellEl);
      }
      gridEl.appendChild(colEl);
    }
  }

  function renderEquipped() {
    var wrap = $("cz-equip-slots");
    if (!wrap) return;
    wrap.innerHTML = "";
    for (var i = 0; i < SLOT_COUNT; i++) {
      var slot = normalizePoolItem(state.equipped[i] || emptySlot());
      state.equipped[i] = slot;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cz-equip-slot" + (state.activeSlot === i ? " active" : "");
      btn.title =
        "Slot " +
        (i + 1) +
        " — click to select, double-click to shuffle image";
      btn.dataset.slot = String(i);
      var num = document.createElement("span");
      num.className = "cz-slot-num";
      num.textContent = String(i + 1);
      btn.appendChild(num);
      if (slot.url) {
        var img = document.createElement("img");
        img.alt = slot.label || "Slot " + (i + 1);
        bindCellImage(img);
        img.src = slot.url;
        btn.appendChild(img);
      }
      wrap.appendChild(btn);
    }
  }

  function randomizeSlot(idx) {
    if (!state.pool.length) return;
    var prev = normalizePoolItem(state.equipped[idx] || emptySlot());
    state.equipped[idx] = pickDifferentPoolItem(prev.url);
    saveEquipped();
    renderEquipped();
  }

  function randomizeAllSlots() {
    for (var i = 0; i < SLOT_COUNT; i++) {
      state.equipped[i] = randomPoolItem();
    }
    saveEquipped();
    renderEquipped();
  }

  function bindMachine() {
    document.querySelectorAll(".cz-act-btn.top").forEach(function (btn) {
      btn.addEventListener("click", function () {
        actualizeColumn(parseInt(btn.dataset.col, 10), "stasis");
      });
    });
    document.querySelectorAll(".cz-act-btn.bottom").forEach(function (btn) {
      btn.addEventListener("click", function () {
        actualizeColumn(parseInt(btn.dataset.col, 10), "player");
      });
    });
    document.querySelectorAll(".cz-act-btn.left").forEach(function (btn) {
      btn.addEventListener("click", function () {
        actualizeEquipped(parseInt(btn.dataset.slot, 10), "player");
      });
    });
    document.querySelectorAll(".cz-act-btn.right").forEach(function (btn) {
      btn.addEventListener("click", function () {
        actualizeRow(parseInt(btn.dataset.row, 10), "player");
      });
    });

    var spinBtn = $("cz-spin");
    if (spinBtn) spinBtn.addEventListener("click", spinReels);

    var reelsGrid = $("cz-reels-grid");
    if (reelsGrid) {
      reelsGrid.addEventListener("click", function (e) {
        var cell = e.target.closest(".cz-cell");
        if (!cell || !reelsGrid.contains(cell)) return;
        var col = parseInt(cell.dataset.col, 10);
        var row = parseInt(cell.dataset.row, 10);
        if (isNaN(col) || isNaN(row)) return;
        reshuffleCell(col, row);
      });
    }

    var randBtn = $("cz-randomize-slots");
    if (randBtn) randBtn.addEventListener("click", randomizeAllSlots);

    var randOne = $("cz-randomize-slot");
    if (randOne) {
      randOne.addEventListener("click", function () {
        randomizeSlot(state.activeSlot);
      });
    }

    var slotsWrap = $("cz-equip-slots");
    if (slotsWrap) {
      slotsWrap.addEventListener("click", function (e) {
        var btn = e.target.closest(".cz-equip-slot");
        if (!btn) return;
        var si = parseInt(btn.dataset.slot, 10);
        state.activeSlot = si;
        // Broken equip thumb: single click reshuffles that slot only
        if (btn.classList.contains("cz-cell-failed") && state.pool.length) {
          randomizeSlot(si);
          return;
        }
        renderEquipped();
      });
      slotsWrap.addEventListener("dblclick", function (e) {
        var btn = e.target.closest(".cz-equip-slot");
        if (!btn) return;
        randomizeSlot(parseInt(btn.dataset.slot, 10));
      });
    }

    document.querySelectorAll(".cz-dur-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var d = parseInt(btn.getAttribute("data-dur"), 10);
        if (d !== 6 && d !== 10 && d !== 15) return;
        state.durationSec = d;
        saveVideoPrefs();
        syncDurationButtons();
      });
    });

    document.querySelectorAll(".cz-res-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var r = btn.getAttribute("data-res") || "";
        if (r !== "480p" && r !== "720p") return;
        state.resolution = r;
        saveVideoPrefs();
        syncResButtons();
      });
    });

    var aspectEl = $("cz-aspect");
    if (aspectEl) {
      aspectEl.value = state.aspect;
      aspectEl.addEventListener("change", function () {
        state.aspect = aspectEl.value || "16:9";
        saveVideoPrefs();
        // Preview frame follows the selector until a still locks its own aspect
        if (!state.visionUrl || !(state.visionGen && state.visionGen.aspect)) {
          syncOutputFrameAspect();
        } else if (state.visionGen.aspect !== state.aspect) {
          setStatus(
            "Aspect set to " +
              state.aspect +
              " for the next still. Animate still uses " +
              state.visionGen.aspect +
              " (this image). Regenerate to match.",
            "ok"
          );
        } else {
          syncOutputFrameAspect();
        }
      });
    }

    var animateBtn = $("cz-animate");
    if (animateBtn) animateBtn.addEventListener("click", animateVisionLoop);

    var saveVidBtn = $("cz-save-video");
    if (saveVidBtn) {
      saveVidBtn.addEventListener("click", function () {
        if (!state.videoUrl && !(state.savedVideo && state.savedVideo.url)) {
          setStatus("Animate a loop first, then save.", "error");
          return;
        }
        if (state.savedVideo && state.savedVideo.name) {
          setStatus("Already saved as saved-videos/" + state.savedVideo.name + ".", "ok");
          return;
        }
        saveVidBtn.disabled = true;
        setStatus("Saving to saved-videos/…", "pending");
        saveVideoToGallery(state.videoUrl, { force: true })
          .then(function (saved) {
            setStatus("Saved as saved-videos/" + (saved.name || "?") + ".", "ok");
          })
          .catch(function (err) {
            setStatus((err && err.message) || "Could not save video.", "error");
            updateSaveVideoUi();
          });
      });
    }
    updateSaveVideoUi();
  }

  function boot() {
    if (!$("panel-conceptualizer")) return;
    loadVideoPrefs();
    state.equipped = loadEquipped();
    state.grid = [];
    for (var i = 0; i < COLS * ROWS; i++) {
      state.grid.push(emptyCell());
    }
    renderEquipped();
    renderGrid();
    bindMachine();
    syncDurationButtons();
    syncResButtons();
    var aspectEl = $("cz-aspect");
    if (aspectEl) aspectEl.value = state.aspect;
    syncOutputFrameAspect();
    updateAnimateButton();
    window.dispatchEvent(new Event("conceptualizer-ready"));
  }

  function onShow() {
    loadImagePool().then(function () {
      if (
        !state.grid.some(function (c) {
          return c.url;
        })
      ) {
        fillGridRandom();
      }
      if (
        !state.equipped.some(function (s) {
          return s && s.url;
        })
      ) {
        randomizeAllSlots();
      }
    });
  }

  window.Conceptualizer = {
    onShow: onShow,
    spin: spinReels,
    animateLoop: animateVisionLoop,
    getPoolSize: function () {
      return state.pool.length;
    },
    getGrid: function () {
      return state.grid.slice();
    },
    getEquipped: function () {
      return state.equipped.slice();
    },
    getVisionUrl: function () {
      return state.visionUrl;
    },
    getVideoUrl: function () {
      return state.videoUrl;
    },
  };

  window.addEventListener("conceptualizer-show", onShow);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();