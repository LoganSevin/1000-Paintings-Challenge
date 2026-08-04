/**
 * Animate — spell-driven short clips on a 10-minute timeline with dual-buffer film playback.
 */
(function () {
  "use strict";

  var TRAY_SLICE = 36;
  var DRAG_UP_THRESHOLD = 40;
  var MAX_TIMELINE_MS = 600000;
  var PX_PER_SEC = 14;
  var FETCH_TIMEOUT_MS = 90000;
  var POLL_INTERVAL_MS = 800;
  var POLL_MAX_MS = 12 * 60 * 1000;
  var POLL_FETCH_TIMEOUT_MS = 30000;
  var POLL_FETCH_RETRIES = 5;
  var VIDEO_RESOLUTION = "480p";
  var MORPH_REF_MAX_SEC = 8;
  var SPELL_REF_MAX_SEC = 10;
  var WHISPER_MAX_SEC = 15;
  var LOD1_ANALYSES_URL = "data/lod1-analyses.json";
  var VISUAL_INTENT_PREFIX =
    "ANIMATE — museum-quality fine-art MOTION. Adapt spell sight into living frames: " +
    "fluid organic movement, cinematic light, painterly texture, thumbnail-readable composition. " +
    "Preserve what is SEEN in each source — forms, colors, edges, surfaces — as they move.\n\n";

  var state = {
    pool: [],
    poolReady: false,
    poolLoading: false,
    trayItems: [],
    trayShowAll: false,
    trayRandomSlice: [],
    segments: [],
    playheadMs: 0,
    durationSec: 6,
    morphChain: false,
    appendAtEnd: true,
    generating: false,
    cancelRequested: false,
    activeJobId: null,
    genStartedAt: 0,
    genTimerId: null,
    genEtaSec: 120,
    timelinePlaying: false,
    theaterOpen: false,
    playbackSlot: 0,
    castOrder: [],
    castRoster: {},
    castBeats: [],
    beatIdSeq: 0,
    savedCharacters: [],
    savedObjects: [],
    savedRooms: [],
    savedChains: [],
    activePlaceId: "",
    activeObjectIds: [],
    lastGenJob: null,
    sparkle: null,
    lod1Analyses: {},
    lod1AnalysesLoaded: false,
    lod1AnalysisPending: {},
    drag: null,
    segmentIdSeq: 0,
    playbackCleanup: null,
  };

  var mentionState = {
    menu: null,
    activeInput: null,
    atIndex: -1,
    highlight: 0,
    items: [],
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
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error("Request timed out."));
      }, ms);
      fetch(url, options)
        .then(function (r) {
          clearTimeout(timer);
          resolve(r);
        })
        .catch(function (err) {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function formatClock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function formatMs(ms) {
    return formatClock((ms || 0) / 1000);
  }

  function absoluteUrl(url) {
    if (!url) return "";
    try {
      return new URL(url, window.location.href).href;
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

  function paintingNumsFromItems(items) {
    var nums = [];
    (items || []).forEach(function (cell) {
      if (cell.paintingNum && nums.indexOf(cell.paintingNum) < 0) nums.push(cell.paintingNum);
    });
    return nums.sort(function (a, b) {
      return a - b;
    });
  }

  function nextSegmentId() {
    state.segmentIdSeq += 1;
    return "seg-" + Date.now() + "-" + state.segmentIdSeq;
  }

  function setStatus(msg, kind) {
    var el = $("an-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "an-status" + (kind ? " " + kind : "");
  }

  function getTraySearchQuery() {
    var el = $("an-spell-search");
    return el && el.value ? el.value.trim() : "";
  }

  function spellItemMatchesQuery(item, query) {
    var q = String(query || "").trim();
    if (!q) return true;
    item = normalizeItem(item);
    if (item.paintingNum && window.paintingMatchesSearch) {
      var analysis = window.getGalleryAnalysis ? window.getGalleryAnalysis(item.paintingNum) : null;
      if (window.paintingMatchesSearch(item.paintingNum, analysis, q)) return true;
    }
    if (item.lod1Num) {
      if (window.paintingMatchesNumericQuery && window.paintingMatchesNumericQuery(item.lod1Num, q)) {
        return true;
      }
      var lod1Analysis =
        state.lod1Analyses[String(item.lod1Num)] || state.lod1Analyses[item.lod1Num];
      if (lod1Analysis && window.buildMetadataSearchText) {
        if (window.buildMetadataSearchText(lod1Analysis).indexOf(q.toLowerCase()) >= 0) return true;
      }
    }
    var blob = (item.label + " " + item.source + " " + String(item.url || "").replace(/[/_-]/g, " "))
      .toLowerCase();
    return blob.indexOf(q.toLowerCase()) >= 0;
  }

  function sortSpellSearchMatches(items, query) {
    if (!window.paintingNumericSearchRank) return items;
    var q = String(query || "").trim();
    if (!q) return items;
    return items.slice().sort(function (a, b) {
      var ra = a.paintingNum ? window.paintingNumericSearchRank(a.paintingNum, q) : 2;
      var rb = b.paintingNum ? window.paintingNumericSearchRank(b.paintingNum, q) : 2;
      if (ra !== rb) return ra - rb;
      if (a.paintingNum && b.paintingNum) return a.paintingNum - b.paintingNum;
      if (a.lod1Num && b.lod1Num) return a.lod1Num - b.lod1Num;
      return String(a.label || "").localeCompare(String(b.label || ""));
    });
  }

  function applyTrayView() {
    var query = getTraySearchQuery();
    if (query) {
      state.trayItems = sortSpellSearchMatches(
        state.pool.filter(function (item) {
          return spellItemMatchesQuery(item, query);
        }),
        query
      );
    } else if (state.trayShowAll) {
      state.trayItems = state.pool.slice();
    } else {
      state.trayItems = state.trayRandomSlice.slice();
    }
    renderTray();
  }

  function updateTrayCount() {
    var el = $("an-tray-count");
    if (!el) return;
    var query = getTraySearchQuery();
    if (query) {
      var n = state.trayItems.length;
      el.textContent =
        n + " match" + (n === 1 ? "" : "es") + ' for "' + query + '" · ' + state.pool.length + " in library";
      return;
    }
    el.textContent =
      state.trayItems.length + " shown · " + state.pool.length + " in library";
  }

  function friendlyAnimateError(err) {
    var msg = (err && err.message) || String(err || "");
    var low = msg.toLowerCase();
    if (
      low.indexOf("handshake") >= 0 ||
      low.indexOf("_ssl.c") >= 0 ||
      (low.indexOf("ssl") >= 0 && low.indexOf("secure") >= 0)
    ) {
      return (
        "Secure connection to the video API timed out (SSL handshake). " +
        "Check internet/VPN/firewall, then try again — the server auto-retries."
      );
    }
    if (
      low.indexOf("8.7") >= 0 ||
      (low.indexOf("duration") >= 0 && (low.indexOf("exceed") >= 0 || low.indexOf("maximum") >= 0))
    ) {
      return (
        "Clip length exceeds morph limits (~8s reference). Turn off Morph link, pick a shorter " +
        "previous clip, or use 6s casts."
      );
    }
    if (low.indexOf("4096") >= 0 || (low.indexOf("prompt") >= 0 && low.indexOf("maximum") >= 0)) {
      return (
        "Video API rejected the prompt length (4096 byte max). " +
        "Restart the gallery server if you have not since the last update, then try again with shorter beat lines."
      );
    }
    if (
      low.indexOf("overloaded") >= 0 ||
      low.indexOf("overload") >= 0 ||
      low.indexOf("rate limit") >= 0 ||
      low.indexOf("too many requests") >= 0
    ) {
      return (
        "xAI video generation is temporarily overloaded (high demand on their servers). " +
        "Wait a minute and try again — the gallery now auto-retries up to ~5 minutes when this happens."
      );
    }
    if (low.indexOf("timed out") >= 0 || low.indexOf("timeout") >= 0) {
      return (
        "Video generation timed out. The gallery keeps polling up to 12 minutes — " +
        "if this appeared quickly, restart start_server.bat and try again."
      );
    }
    if (low.indexOf("html instead of json") >= 0) {
      return msg;
    }
    if (low.indexOf("could not reach") >= 0 || low.indexOf("network") >= 0) {
      return "Could not reach the video API. Check your internet connection and restart start_server.bat.";
    }
    return msg || "Animate cast failed.";
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
        return r.ok ? parseApiResponse(r) : null;
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
          (data && data.manifest) ||
          (window.getGalleryManifest && window.getGalleryManifest()) ||
          [];
        var pool = [];
        manifest.forEach(function (m) {
          pool.push(
            normalizeItem({
              url: window.getPaintingUrl
                ? window.getPaintingUrl(m.number)
                : "paintings/" + m.number + ".jpg",
              label: "#" + m.number,
              paintingNum: m.number,
              source: "paintings",
            })
          );
        });
        return fetchWithTimeout(apiUrl("/api/acquired-images"), { cache: "no-store" })
          .then(function (r) {
            return r.ok ? parseApiResponse(r) : { folders: [] };
          })
          .then(function (index) {
            var folders = ["lod1s", "saved-stasis"];
            (index.folders || []).forEach(function (f) {
              if (f.id === "saved-fallout" && f.children) {
                f.children.forEach(function (c) {
                  folders.push(c.id);
                });
              }
            });
            return Promise.all(folders.map(fetchAcquiredFolder)).then(function (chunks) {
              chunks.forEach(function (list) {
                pool = pool.concat(list);
              });
              state.pool = dedupePool(pool.map(normalizeItem));
              state.poolReady = true;
              state.poolLoading = false;
              updateTrayCount();
              setStatus(
                state.pool.length
                  ? state.pool.length + " spells ready — drag upward to cast motion."
                  : "Pool empty — run start_server.bat and add paintings.",
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
    state.trayShowAll = false;
    if (!state.pool.length) {
      state.trayRandomSlice = [];
      state.trayItems = [];
      renderTray();
      return;
    }
    state.trayRandomSlice = shuffleArray(state.pool).slice(0, Math.min(TRAY_SLICE, state.pool.length));
    applyTrayView();
  }

  function fillTrayAll() {
    state.trayShowAll = true;
    applyTrayView();
  }

  function renderTray() {
    var strip = $("an-spell-strip");
    if (!strip) return;
    strip.innerHTML = "";
    if (!state.trayItems.length) {
      var empty = document.createElement("p");
      empty.className = "an-spell-strip-empty";
      empty.textContent = getTraySearchQuery()
        ? "No spells match — try #, title, tags, or mood."
        : "Spell library empty — run start_server.bat and add paintings.";
      strip.appendChild(empty);
      updateTrayCount();
      return;
    }
    state.trayItems.forEach(function (item, idx) {
      item = normalizeItem(item);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "an-spell";
      btn.dataset.idx = String(idx);
      btn.title = "Drag upward: " + (item.label || "spell");
      var img = document.createElement("img");
      img.className = "an-spell-thumb";
      img.src = item.url;
      img.alt = item.label || "Spell";
      img.loading = "lazy";
      btn.appendChild(img);
      var lbl = document.createElement("span");
      lbl.className = "an-spell-label";
      lbl.textContent = item.label || "Spell";
      btn.appendChild(lbl);
      strip.appendChild(btn);
    });
    updateTrayCount();
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
        "Visual reference without text analysis — adapt visible forms and palette from this image" +
          (cell.label ? " (" + cell.label + ")" : "") +
          " into motion."
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

  function buildVisualDescriptionFromSpells(spellItems) {
    var cells = (spellItems || [])
      .map(normalizeItem)
      .filter(function (c) {
        return c.url || c.paintingNum || c.lod1Num;
      });
    if (!cells.length) {
      return Promise.resolve("No spell images — motion will follow prompt and character only.");
    }
    return Promise.all(cells.map(visualLineForCell)).then(function (lines) {
      return (
        "VISUAL SIGHT DESCRIPTIONS (adapt these looks into motion):\n\n" +
        lines
          .map(function (line, i) {
            return i + 1 + ". " + line;
          })
          .join("\n\n") +
        "\n\nAnimate by moving the seen forms, colors, light, edges, and surfaces above."
      );
    });
  }

  function wrapVisualIntent(description) {
    return VISUAL_INTENT_PREFIX + description;
  }

  function clampStasisForApi(text) {
    text = String(text || "").trim();
    var maxBytes = 1200;
    if (!text) return text;
    var enc = new TextEncoder();
    if (enc.encode(text).length <= maxBytes) return text;
    var lo = 0;
    var hi = text.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      var trial = text.slice(0, mid).trim() + "...";
      if (enc.encode(trial).length <= maxBytes) lo = mid;
      else hi = mid - 1;
    }
    return text.slice(0, lo).trim() + "...";
  }

  function buildVisualStasis(spellItem, extraSpells) {
    var spells = [];
    if (spellItem) spells.push(normalizeItem(spellItem));
    (extraSpells || []).forEach(function (s) {
      spells.push(normalizeItem(s));
    });
    return buildVisualDescriptionFromSpells(spells).then(function (desc) {
      return clampStasisForApi(wrapVisualIntent(desc));
    });
  }

  function motionPrompt() {
    var el = $("an-prompt");
    return el && el.value ? el.value.trim() : "";
  }

  function maxCastCount() {
    return state.savedCharacters.length || 0;
  }

  function castCount() {
    return state.castOrder.length;
  }

  function isOnCast(charId) {
    return state.castRoster.hasOwnProperty(charId);
  }

  function primaryCastEntry() {
    if (!state.castOrder.length) return null;
    return state.castRoster[state.castOrder[0]] || null;
  }

  function primaryCastCharacter() {
    var entry = primaryCastEntry();
    return entry ? entry.character : null;
  }

  function nextBeatId() {
    state.beatIdSeq += 1;
    return "beat-" + state.beatIdSeq;
  }

  function characterOnCastById(charId) {
    var entry = state.castRoster[charId];
    return entry && entry.character ? entry.character : null;
  }

  var BEAT_TYPE_META = {
    action: {
      label: "Action",
      placeholder: "Motion, gesture, physical beat…",
    },
    dialogue: {
      label: "Dialogue",
      placeholder: "What they say — oval speech bubble…",
    },
    reaction: {
      label: "Reaction",
      placeholder: "Expression, listening, emotional beat…",
    },
  };

  function beatTypeMeta(type) {
    return BEAT_TYPE_META[type] || BEAT_TYPE_META.action;
  }

  function beatDisplayText(beat) {
    if (!beat) return "";
    if (beat.text != null && String(beat.text).trim()) return String(beat.text).trim();
    if (beat.type === "dialogue") return String(beat.dialogue || "").trim();
    if (beat.type === "reaction") return String(beat.reaction || "").trim();
    return String(beat.action || "").trim();
  }

  function makeBeat(characterId, type, text, followUp) {
    return {
      id: nextBeatId(),
      characterId: characterId,
      type: type || "action",
      text: text || "",
      followUp: !!followUp,
    };
  }

  function expandLegacyBeatEntry(b) {
    if (!b || !b.characterId) return [];
    if (b.type && !b.action && !b.dialogue) {
      return [
        {
          id: b.id || nextBeatId(),
          characterId: b.characterId,
          type: b.type,
          text: b.text || "",
          followUp: !!b.followUp,
        },
      ];
    }
    var out = [];
    var action = String(b.action || "").trim();
    var dialogue = String(b.dialogue || "").trim();
    var follow = !!b.followUp;
    if (action) {
      out.push(makeBeat(b.characterId, "action", action, follow));
      follow = true;
    }
    if (dialogue) {
      out.push(makeBeat(b.characterId, "dialogue", dialogue, follow || out.length > 0));
    }
    if (!out.length) {
      out.push(makeBeat(b.characterId, b.type || "action", b.text || "", follow));
    }
    return out;
  }

  function syncCastBeatsFromDom() {
    var list = $("an-cast-list");
    if (!list) return;
    var synced = [];
    list.querySelectorAll(".an-beat-card").forEach(function (card) {
      var beatId = card.dataset.beatId;
      if (!beatId) return;
      var sel = card.querySelector(".an-beat-char-select");
      var follow = card.querySelector(".an-beat-follow-chk");
      var input = card.querySelector(".an-beat-input");
      synced.push({
        id: beatId,
        characterId: sel ? sel.value : "",
        type: card.dataset.beatType || "action",
        text: input ? String(input.value || "") : "",
        followUp: follow ? !!follow.checked : false,
      });
    });
    if (synced.length) state.castBeats = synced;
  }

  function getCastPayload() {
    return state.castOrder
      .map(function (id) {
        var entry = state.castRoster[id];
        if (!entry || !entry.character) return null;
        return { id: id, character: entry.character, action: "", dialogue: "" };
      })
      .filter(Boolean);
  }

  function getBeatsPayload() {
    syncCastBeatsFromDom();
    return state.castBeats
      .map(function (beat, idx) {
        var ch = characterOnCastById(beat.characterId);
        if (!ch) return null;
        var text = expandCharacterMentions(beat.text || "");
        var type = beat.type || "action";
        return {
          id: beat.id,
          order: idx + 1,
          character_id: beat.characterId,
          character: ch,
          type: type,
          text: text,
          action: type === "action" ? text : "",
          dialogue: type === "dialogue" ? text : "",
          reaction: type === "reaction" ? text : "",
          follow_up: !!beat.followUp,
        };
      })
      .filter(Boolean);
  }

  function beatsHavePerformance(beats) {
    return (beats || []).some(function (b) {
      return !!beatDisplayText(b);
    });
  }

  function castHasPerformance() {
    return beatsHavePerformance(getBeatsPayload());
  }

  function buildBeatPerformancePrompt(beats) {
    beats = beats || getBeatsPayload();
    if (!beats.length || !beatsHavePerformance(beats)) return "";
    var lines = [
      "MANDATORY PERFORMANCE SCRIPT — execute beats in listed order:",
      "Same actor may appear in multiple beats; each beat is a new story moment.",
      "Never swap which actor performs which beat.",
    ];
    beats.forEach(function (beat, i) {
      var name = (beat.character && beat.character.name) || "Actor";
      lines.push("\nBEAT " + (i + 1) + " — " + name);
      if (beat.follow_up && i > 0) {
        var prev = beats[i - 1];
        var prevName = (prev.character && prev.character.name) || "prior actor";
        lines.push(
          "Continues / reacts right after beat " + i + " (" + prevName + ") — not simultaneous with it."
        );
      }
      var type = beat.type || "action";
      var text = beat.text || beat.action || beat.dialogue || beat.reaction || "";
      if (type === "action" && text) {
        lines.push(name + " ACTION (visible motion): " + text);
      } else if (type === "dialogue" && text) {
        lines.push(
          name + ' DIALOGUE (oval speech bubble / lip-sync): "' + text + '"'
        );
      } else if (type === "reaction" && text) {
        lines.push(name + " REACTION (expression / listening): " + text);
      }
    });
    return lines.join("\n");
  }

  function buildCastPerformancePrompt() {
    return buildBeatPerformancePrompt();
  }

  function migrateRosterLinesToBeats() {
    if (state.castBeats.length) return;
    state.castOrder.forEach(function (id) {
      var entry = state.castRoster[id];
      if (!entry) return;
      var action = String(entry.action || "").trim();
      var dialogue = String(entry.dialogue || "").trim();
      if (action) {
        state.castBeats.push(makeBeat(id, "action", action, state.castBeats.length > 0));
      }
      if (dialogue) {
        state.castBeats.push(makeBeat(id, "dialogue", dialogue, state.castBeats.length > 0));
      }
    });
  }

  function pruneBeatsForCast() {
    state.castBeats = state.castBeats.filter(function (b) {
      return isOnCast(b.characterId);
    });
  }

  function setBeatType(beatId, beatType) {
    if (!BEAT_TYPE_META[beatType]) return;
    var beat = state.castBeats.find(function (b) {
      return b.id === beatId;
    });
    if (!beat || beat.type === beatType) return;
    beat.type = beatType;
    renderCastPanel();
    persistCastScript();
  }

  function addCastBeat(characterId, beatType) {
    if (!castCount()) {
      setStatus("Toggle someone ON CAST first.", "error");
      return;
    }
    var cid = characterId || state.castOrder[0];
    if (!isOnCast(cid)) cid = state.castOrder[0];
    var type = beatType || "action";
    if (!BEAT_TYPE_META[type]) type = "action";
    state.castBeats.push(makeBeat(cid, type, "", state.castBeats.length > 0));
    renderCastPanel();
    persistCastScript();
    setStatus(beatTypeMeta(type).label + " beat added — stack in any order.", "ok");
  }

  function removeCastBeat(beatId) {
    state.castBeats = state.castBeats.filter(function (b) {
      return b.id !== beatId;
    });
    renderCastPanel();
    persistCastScript();
  }

  function moveCastBeat(beatId, dir) {
    var idx = -1;
    state.castBeats.forEach(function (b, i) {
      if (b.id === beatId) idx = i;
    });
    if (idx < 0) return;
    var next = idx + dir;
    if (next < 0 || next >= state.castBeats.length) return;
    var copy = state.castBeats.slice();
    var tmp = copy[idx];
    copy[idx] = copy[next];
    copy[next] = tmp;
    state.castBeats = copy;
    renderCastPanel();
    persistCastScript();
  }

  function duplicateCastBeat(beatId) {
    var src = state.castBeats.find(function (b) {
      return b.id === beatId;
    });
    if (!src) return;
    var idx = state.castBeats.indexOf(src);
    var clone = makeBeat(src.characterId, src.type || "action", src.text || "", true);
    state.castBeats.splice(idx + 1, 0, clone);
    renderCastPanel();
    persistCastScript();
  }

  function composeScenePrompt() {
    return expandAssetMentions(motionPrompt());
  }

  function mentionTagForAsset(asset) {
    var name = String((asset && asset.name) || "Asset").trim();
    if (/[\s"]/.test(name)) {
      return '@"' + name.replace(/"/g, "") + '"';
    }
    return "@" + name.replace(/\s+/g, "");
  }

  function mentionTagForCharacter(ch) {
    return mentionTagForAsset(ch);
  }

  function assetKind(asset) {
    if (!asset) return "character";
    if (asset.kind === "chain" || asset.steps) return "chain";
    return asset.kind || (asset.archetype != null ? "character" : asset.category ? "object" : asset.mood ? "room" : "character");
  }

  function normalizeChainForMention(chain) {
    chain = chain || {};
    var steps = chain.steps || [];
    var first = steps[0] || {};
    return {
      kind: "chain",
      id: chain.id || chain.slug || "",
      name: chain.name || chain.slug || "Chain",
      slug: chain.slug || "",
      description: chain.description || "",
      steps: steps,
      step_count: chain.step_count || steps.length,
      preview_url: first.url || first.preview_url || "",
    };
  }

  function chainMentionKeys(asset) {
    var keys = [];
    var name = String((asset && asset.name) || "").trim().toLowerCase();
    var slug = String((asset && asset.slug) || "").trim().toLowerCase();
    if (name) {
      keys.push(name);
      keys.push(name.replace(/\s+/g, ""));
      keys.push(name.replace(/\s+/g, "-"));
    }
    if (slug) keys.push(slug);
    return keys;
  }

  function chainOperationForIndex(idx, total) {
    if (total <= 1) return "emit";
    if (idx === 0) return "ingest";
    if (idx === total - 1) return "emit";
    if (idx === total - 2 && total > 2) return "refine";
    return idx % 2 === 1 ? "fuse" : "transform";
  }

  function fuseChainAsset(chain, seed) {
    var steps = (chain && chain.steps) || [];
    var lines = [];
    var input = String(seed || "").trim();
    if (input) lines.push("Seed input: " + input);
    steps.forEach(function (step, idx) {
      var op = step.operation || chainOperationForIndex(idx, steps.length);
      var title = step.title || step.label || "spell";
      var desc = String(step.description || "").trim();
      var tags = (step.tags || []).slice(0, 8).join(", ");
      var prefix = step.painting_num ? "#" + step.painting_num + " " : "";
      if (op === "ingest") lines.push("[ingest] " + prefix + title + ". " + desc);
      else if (op === "emit") lines.push("[emit] Finalize as " + prefix + title + " — " + tags);
      else if (op === "refine") lines.push("[refine] Polish through " + prefix + title + " (" + tags + ")");
      else lines.push("[" + op + "] Blend " + prefix + title + " — " + tags);
    });
    lines.push("Output: fused vision prompt for downstream generation.");
    return lines.join("\n");
  }

  function getMentionableAssets() {
    var list = [];
    state.savedCharacters.forEach(function (ch) {
      list.push({ kind: "character", asset: ch, on: isOnCast(ch.id) });
    });
    state.savedObjects.forEach(function (obj) {
      list.push({ kind: "object", asset: obj, on: state.activeObjectIds.indexOf(obj.id) >= 0 });
    });
    state.savedRooms.forEach(function (room) {
      list.push({ kind: "room", asset: room, on: state.activePlaceId === room.id });
    });
    state.savedChains.forEach(function (chain) {
      list.push({ kind: "chain", asset: chain, on: false });
    });
    list.sort(function (a, b) {
      if (a.on !== b.on) return a.on ? -1 : 1;
      var rank = { character: 0, object: 1, room: 2, chain: 3 };
      return (rank[a.kind] || 9) - (rank[b.kind] || 9);
    });
    return list;
  }

  function getMentionableCharacters() {
    return getMentionableAssets().filter(function (row) {
      return row.kind === "character";
    }).map(function (row) {
      return row.asset;
    });
  }

  function findAssetByMentionToken(token) {
    var raw = String(token || "").trim();
    if (!raw) return null;
    if (raw.charAt(0) === "@") raw = raw.slice(1);
    if (raw.charAt(0) === '"') {
      var end = raw.indexOf('"', 1);
      raw = end > 0 ? raw.slice(1, end) : raw.slice(1);
    }
    raw = raw.trim().toLowerCase();
    if (!raw) return null;
    var c;
    for (c = 0; c < state.savedChains.length; c++) {
      var chain = state.savedChains[c];
      var keys = chainMentionKeys(chain);
      if (keys.indexOf(raw) >= 0) return { kind: "chain", asset: chain };
    }
    var pools = [state.savedCharacters, state.savedObjects, state.savedRooms];
    for (var p = 0; p < pools.length; p++) {
      for (var i = 0; i < pools[p].length; i++) {
        if (String(pools[p][i].name || "").toLowerCase() === raw) {
          return { kind: assetKind(pools[p][i]), asset: pools[p][i] };
        }
      }
    }
    for (var j = 0; j < pools.length; j++) {
      for (var k = 0; k < pools[j].length; k++) {
        var n = String(pools[j][k].name || "").toLowerCase();
        if (n.indexOf(raw) === 0) return { kind: assetKind(pools[j][k]), asset: pools[j][k] };
      }
    }
    for (c = 0; c < state.savedChains.length; c++) {
      chain = state.savedChains[c];
      keys = chainMentionKeys(chain);
      for (var ki = 0; ki < keys.length; ki++) {
        if (keys[ki].indexOf(raw) === 0) return { kind: "chain", asset: chain };
      }
    }
    return null;
  }

  function findCharacterByMentionToken(token) {
    var hit = findAssetByMentionToken(token);
    return hit && hit.kind === "character" ? hit.asset : null;
  }

  function expandAssetMentions(text) {
    text = String(text || "");
    if (!text || text.indexOf("@") < 0) return text;
    return text.replace(/@"([^"]+)"|@([A-Za-z0-9_\-]+)/g, function (match, quoted, bare) {
      var hit = findAssetByMentionToken(quoted != null ? "@" + quoted : "@" + bare);
      if (!hit) return match;
      var a = hit.asset;
      var role = hit.kind;
      if (hit.kind === "chain") {
        return (
          mentionTagForAsset(a) +
          " (chain API, " +
          (a.step_count || (a.steps && a.steps.length) || 0) +
          " spells):\n" +
          fuseChainAsset(a)
        );
      }
      if (hit.kind === "character") {
        role = isOnCast(a.id) ? "on-cast actor" : "saved character";
      } else if (hit.kind === "object") {
        role = state.activeObjectIds.indexOf(a.id) >= 0 ? "equipped object" : "saved object";
      } else if (hit.kind === "room") {
        role = state.activePlaceId === a.id ? "active place" : "saved place";
      }
      var extra = a.archetype || a.category || a.mood || "";
      return (
        mentionTagForAsset(a) +
        " (" +
        role +
        ": " +
        (a.name || "Asset") +
        (extra ? ", " + extra : "") +
        ")"
      );
    });
  }

  function expandCharacterMentions(text) {
    return expandAssetMentions(text);
  }

  function findActiveMention(input) {
    if (!input) return null;
    var val = input.value;
    var caret = input.selectionStart != null ? input.selectionStart : val.length;
    var before = val.slice(0, caret);
    var at = before.lastIndexOf("@");
    if (at < 0) return null;
    var query = before.slice(at + 1);
    if (/[\s\n]/.test(query)) return null;
    return { at: at, query: query, caret: caret };
  }

  function filterMentionAssets(query) {
    var q = String(query || "").toLowerCase();
    return getMentionableAssets().filter(function (row) {
      var name = String(row.asset.name || "").toLowerCase();
      var id = String(row.asset.id || "").toLowerCase();
      var slug = String(row.asset.slug || "").toLowerCase();
      if (!q) return true;
      return (
        name.indexOf(q) >= 0 ||
        id.indexOf(q) >= 0 ||
        slug.indexOf(q) >= 0 ||
        row.kind.indexOf(q) >= 0 ||
        (row.kind === "chain" && "api".indexOf(q) >= 0)
      );
    });
  }

  function filterMentionCharacters(query) {
    return filterMentionAssets(query).filter(function (row) {
      return row.kind === "character";
    }).map(function (row) {
      return row.asset;
    });
  }

  function ensureMentionMenu() {
    if (mentionState.menu) return mentionState.menu;
    var menu = document.createElement("div");
    menu.id = "an-mention-menu";
    menu.className = "an-mention-menu";
    menu.hidden = true;
    menu.setAttribute("role", "listbox");
    document.body.appendChild(menu);
    mentionState.menu = menu;
    return menu;
  }

  function hideMentionMenu() {
    var menu = mentionState.menu;
    if (menu) menu.hidden = true;
    mentionState.activeInput = null;
    mentionState.atIndex = -1;
    mentionState.highlight = 0;
    mentionState.items = [];
  }

  function positionMentionMenu(input) {
    var menu = ensureMentionMenu();
    if (!input) return;
    var rect = input.getBoundingClientRect();
    menu.style.left = Math.max(8, rect.left) + "px";
    menu.style.top = rect.bottom + 4 + "px";
    menu.style.width = Math.max(rect.width, 176) + "px";
  }

  function renderMentionMenu(input, query) {
    var menu = ensureMentionMenu();
    var items = filterMentionAssets(query);
    mentionState.activeInput = input;
    mentionState.items = items;
    mentionState.highlight = 0;
    if (mentionState.atIndex < 0) {
      var ctx = findActiveMention(input);
      mentionState.atIndex = ctx ? ctx.at : -1;
    }

    menu.innerHTML = "";
    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "an-mention-empty";
      empty.textContent =
        state.savedCharacters.length ||
          state.savedObjects.length ||
          state.savedRooms.length ||
          state.savedChains.length
          ? "No matching @tags"
          : "Save characters, objects, places, or chain APIs first";
      menu.appendChild(empty);
    } else {
      items.forEach(function (row, idx) {
        var asset = row.asset;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "an-mention-item" + (idx === 0 ? " an-mention-active" : "");
        btn.setAttribute("role", "option");
        btn.dataset.idx = String(idx);
        if (asset.preview_url) {
          var img = document.createElement("img");
          img.className = "an-mention-thumb";
          img.src = asset.preview_url;
          img.alt = "";
          btn.appendChild(img);
        } else {
          var ph = document.createElement("span");
          ph.className = "an-mention-thumb an-mention-thumb-empty";
          btn.appendChild(ph);
        }
        var meta = document.createElement("span");
        meta.className = "an-mention-meta";
        var nm = document.createElement("span");
        nm.className = "an-mention-name";
        nm.textContent = asset.name || "Asset";
        meta.appendChild(nm);
        var tag = document.createElement("span");
        tag.className = "an-mention-tag" + (row.kind === "chain" ? " an-mention-tag-chain" : "");
        tag.textContent = mentionTagForAsset(asset);
        meta.appendChild(tag);
        if (row.kind === "chain") nm.classList.add("an-mention-name-chain");
        btn.appendChild(meta);
        var kindBadge = document.createElement("span");
        kindBadge.className = "an-mention-badge an-mention-kind-" + row.kind;
        kindBadge.textContent = row.kind;
        btn.appendChild(kindBadge);
        if (row.on) {
          var badge = document.createElement("span");
          badge.className = "an-mention-badge";
          badge.textContent = row.kind === "character" ? "cast" : "on";
          btn.appendChild(badge);
        }
        btn.addEventListener("mousedown", function (e) {
          e.preventDefault();
          selectMentionAsset(row);
        });
        menu.appendChild(btn);
      });
    }

    positionMentionMenu(input);
    menu.hidden = false;
  }

  function highlightMentionItem(idx) {
    var menu = mentionState.menu;
    if (!menu || !mentionState.items.length) return;
    mentionState.highlight = clamp(idx, 0, mentionState.items.length - 1);
    menu.querySelectorAll(".an-mention-item").forEach(function (el, i) {
      el.classList.toggle("an-mention-active", i === mentionState.highlight);
    });
    var active = menu.querySelector(".an-mention-item.an-mention-active");
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  }

  function selectMentionAsset(row) {
    var input = mentionState.activeInput;
    if (!input || !row || !row.asset) {
      hideMentionMenu();
      return;
    }
    var ctx = findActiveMention(input);
    if (!ctx) {
      hideMentionMenu();
      return;
    }
    var tag = mentionTagForAsset(row.asset);
    var val = input.value;
    var next = val.slice(0, ctx.at) + tag + " " + val.slice(ctx.caret);
    input.value = next;
    var caret = ctx.at + tag.length + 1;
    if (input.setSelectionRange) input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    hideMentionMenu();
    input.focus();
  }

  function selectMentionCharacter(ch) {
    selectMentionAsset({ kind: "character", asset: ch });
  }

  function updateMentionMenuForInput(input) {
    var ctx = findActiveMention(input);
    if (!ctx) {
      hideMentionMenu();
      return;
    }
    mentionState.atIndex = ctx.at;
    renderMentionMenu(input, ctx.query);
  }

  function mentionMenuOpen() {
    return !!(mentionState.menu && !mentionState.menu.hidden && mentionState.items.length);
  }

  function attachCharacterMentions(inputEl, opts) {
    opts = opts || {};
    if (!inputEl || inputEl.dataset.anMentionsBound === "1") return;
    inputEl.dataset.anMentionsBound = "1";

    inputEl.addEventListener("input", function () {
      updateMentionMenuForInput(inputEl);
    });

    inputEl.addEventListener("keydown", function (e) {
      if (mentionState.activeInput === inputEl && mentionState.menu && !mentionState.menu.hidden) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          highlightMentionItem(mentionState.highlight + 1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          highlightMentionItem(mentionState.highlight - 1);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          if (mentionState.items.length) {
            e.preventDefault();
            selectMentionAsset(mentionState.items[mentionState.highlight]);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          hideMentionMenu();
          return;
        }
      }
      if (opts.allowEnterSubmit && e.key === "Enter" && !state.generating && !mentionMenuOpen()) {
        e.preventDefault();
        castSpell(null);
      }
    });

    inputEl.addEventListener("blur", function () {
      setTimeout(hideMentionMenu, 120);
    });
  }

  function persistCastScript() {
    try {
      localStorage.setItem(
        "animate-cast-script",
        JSON.stringify({
          castOrder: state.castOrder.slice(),
          beats: state.castBeats.map(function (b) {
            return {
              id: b.id,
              characterId: b.characterId,
              type: b.type || "action",
              text: b.text || "",
              followUp: !!b.followUp,
            };
          }),
        })
      );
    } catch (e) {}
  }

  function restoreCastScript() {
    state.castOrder = [];
    state.castRoster = {};
    state.castBeats = [];
    var restoredScript = false;
    try {
      var scriptRaw = localStorage.getItem("animate-cast-script");
      if (scriptRaw) {
        var script = JSON.parse(scriptRaw);
        if (script && Array.isArray(script.castOrder)) {
          script.castOrder.forEach(function (id) {
            var ch = state.savedCharacters.find(function (c) {
              return c.id === id;
            });
            if (!ch) return;
            state.castOrder.push(id);
            state.castRoster[id] = { character: ch };
          });
          (script.beats || []).forEach(function (b) {
            expandLegacyBeatEntry(b).forEach(function (beat) {
              var m = String(beat.id || "").match(/(\d+)$/);
              if (m) state.beatIdSeq = Math.max(state.beatIdSeq, parseInt(m[1], 10));
              state.castBeats.push(beat);
            });
          });
          restoredScript = true;
        }
      }
    } catch (e1) {}
    if (!restoredScript) {
      try {
        var raw = localStorage.getItem("animate-cast-roster");
        if (raw) {
          var slim = JSON.parse(raw);
          if (Array.isArray(slim)) {
            slim.forEach(function (row) {
              var ch = state.savedCharacters.find(function (c) {
                return c.id === row.id;
              });
              if (!ch) return;
              state.castOrder.push(ch.id);
              state.castRoster[ch.id] = {
                character: ch,
                action: row.action || "",
                dialogue: row.dialogue || "",
              };
            });
          }
        }
      } catch (e2) {}
    }
    migrateRosterLinesToBeats();
    pruneBeatsForCast();
    warmCastUploads();
  }

  function updateCastUi() {
    var countEl = $("an-cast-roster-count");
    var panel = $("an-cast-panel");
    var n = castCount();
    var max = maxCastCount();
    if (countEl) {
      countEl.textContent = n ? n + "/" + max + " on cast" : "0 on cast — tap to add";
      countEl.classList.toggle("an-cast-live", n > 0);
    }
    if (panel) panel.hidden = n < 1;
    renderCharacterStrip();
    renderCastPanel();
    warmCastUploads();
  }

  function toggleCast(ch) {
    if (!ch || !ch.id) return;
    if (isOnCast(ch.id)) {
      removeFromCast(ch.id, false);
      setStatus("“" + (ch.name || "Character") + "” removed from cast.", "ok");
      return;
    }
    if (castCount() >= maxCastCount()) {
      setStatus("Cast full (" + maxCastCount() + ") — remove someone first.", "error");
      return;
    }
    state.castOrder.push(ch.id);
    state.castRoster[ch.id] = { character: ch };
    persistCastScript();
    updateCastUi();
    setStatus("“" + (ch.name || "Character") + "” ON CAST (" + castCount() + "/" + maxCastCount() + ").", "ok");
  }

  function removeFromCast(charId, announce) {
    if (!isOnCast(charId)) return;
    var name = (state.castRoster[charId].character && state.castRoster[charId].character.name) || "Character";
    state.castOrder = state.castOrder.filter(function (id) {
      return id !== charId;
    });
    delete state.castRoster[charId];
    state.castBeats = state.castBeats.filter(function (b) {
      return b.characterId !== charId;
    });
    pruneBeatsForCast();
    persistCastScript();
    updateCastUi();
    if (announce !== false) setStatus("“" + name + "” removed from cast.", "ok");
  }

  function clearCast() {
    if (!castCount()) return;
    state.castOrder = [];
    state.castRoster = {};
    state.castBeats = [];
    persistCastScript();
    updateCastUi();
    setStatus("Cast cleared — all characters off.", "ok");
  }

  function castLabel() {
    var cast = getCastPayload();
    if (!cast.length) return "";
    if (cast.length === 1) return cast[0].character.name || "Character";
    return cast
      .map(function (c) {
        return c.character.name || "Character";
      })
      .join(" + ");
  }

  function timelineUsedMs() {
    var total = 0;
    state.segments.forEach(function (seg) {
      total += (seg.durationSec || 0) * 1000;
    });
    return total;
  }

  function timelineTrackWidthPx() {
    var usedSec = timelineUsedMs() / 1000;
    var spanSec = Math.max(600, usedSec + 30);
    return Math.round(spanSec * PX_PER_SEC);
  }

  function msToPx(ms) {
    return (ms / 1000) * PX_PER_SEC;
  }

  function pxToMs(px) {
    return (px / PX_PER_SEC) * 1000;
  }

  function sortedSegments() {
    return state.segments.slice().sort(function (a, b) {
      return a.startMs - b.startMs;
    });
  }

  function segmentAtPlayhead() {
    var list = sortedSegments();
    for (var i = list.length - 1; i >= 0; i--) {
      var seg = list[i];
      var end = seg.startMs + seg.durationSec * 1000;
      if (state.playheadMs >= seg.startMs && state.playheadMs < end) return seg;
    }
    return null;
  }

  function previousSegmentForMorph(insertMs) {
    var list = sortedSegments().filter(function (s) {
      return s.url && !s.pending;
    });
    var prev = null;
    list.forEach(function (seg) {
      var end = seg.startMs + seg.durationSec * 1000;
      if (end <= insertMs + 50 && (!prev || end > prev.startMs + prev.durationSec * 1000)) {
        prev = seg;
      }
    });
    return prev;
  }

  function resolveMorphOptions(insertMs) {
    var out = { morph_chain: false, video_url: "", skipped: false, reason: "" };
    if (!state.morphChain) return out;
    var prev = previousSegmentForMorph(insertMs);
    if (!prev || !prev.url) {
      out.reason = "No prior clip to morph from.";
      return out;
    }
    if (prev.durationSec > MORPH_REF_MAX_SEC) {
      out.skipped = true;
      out.reason =
        "Prior clip is " +
        prev.durationSec +
        "s (> " +
        MORPH_REF_MAX_SEC +
        "s) — morph skipped, using fresh transmute.";
      return out;
    }
    out.morph_chain = true;
    out.video_url = prev.url;
    return out;
  }

  function effectiveDurationSec(opts) {
    opts = opts || {};
    var requested = opts.duration || state.durationSec;
    var hasSpells = (opts.spells || []).length > 0;
    var hasCharacter = castCount() > 0;
    var morph = !!opts.morph_chain;

    if (morph) return Math.min(requested, MORPH_REF_MAX_SEC);
    if (hasSpells || hasCharacter) return Math.min(requested, SPELL_REF_MAX_SEC);
    return Math.min(requested, WHISPER_MAX_SEC);
  }

  function estimateEtaSec(durationSec, morph) {
    var base = morph ? 55 : durationSec <= 6 ? 45 : 65;
    if (durationSec >= 15) base += 30;
    else if (durationSec >= 10) base += 15;
    return base;
  }

  function warmCastUploads() {
    if (!state.castOrder.length && !state.activePlaceId && !state.activeObjectIds.length) return;
    fetchWithTimeout(
      apiUrl("/api/animate-warm"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cast_ids: state.castOrder.slice(),
          place_id: state.activePlaceId || "",
          object_ids: state.activeObjectIds.slice(),
        }),
      },
      12000
    ).catch(function () {});
  }

  function buildFastVisualStasis(spellItem) {
    if (!spellItem) return Promise.resolve("");
    var item = normalizeItem(spellItem);
    var hint = item.label || "spell reference";
    if (item.paintingNum && window.getGalleryAnalysis) {
      var ga = window.getGalleryAnalysis(item.paintingNum);
      if (ga && ga.description) hint = String(ga.description).trim().slice(0, 100);
      else if (ga && ga.title) hint = String(ga.title).trim();
    } else if (item.lod1Num) {
      var la = state.lod1Analyses[String(item.lod1Num)] || state.lod1Analyses[item.lod1Num];
      if (la && la.description) hint = String(la.description).trim().slice(0, 100);
    }
    return Promise.resolve(
      clampStasisForApi("Motion from reference image — " + hint + ". Match its colors and forms.")
    );
  }

  function insertStartMsForNew(durationSec) {
    if (state.appendAtEnd) {
      var end = 0;
      state.segments.forEach(function (seg) {
        end = Math.max(end, seg.startMs + seg.durationSec * 1000);
      });
      return end;
    }
    return state.playheadMs;
  }

  function canFitSegment(durationSec, startMs) {
    return startMs + durationSec * 1000 <= MAX_TIMELINE_MS;
  }

  function addSegment(seg) {
    state.segments.push(seg);
    renderTimeline();
    updateTimelineMeta();
  }

  function removeSegmentById(id) {
    state.segments = state.segments.filter(function (s) {
      return s.id !== id;
    });
    renderTimeline();
    updateTimelineMeta();
  }

  function updateSegmentById(id, patch) {
    state.segments.forEach(function (s) {
      if (s.id === id) {
        Object.keys(patch || {}).forEach(function (k) {
          s[k] = patch[k];
        });
      }
    });
    renderTimeline();
    updateTimelineMeta();
  }

  function renderRuler() {
    var ruler = $("an-timeline-ruler");
    if (!ruler) return;
    ruler.innerHTML = "";
    var width = timelineTrackWidthPx();
    ruler.style.width = width + "px";
    var totalSec = width / PX_PER_SEC;
    var step = totalSec > 420 ? 60 : totalSec > 180 ? 30 : 15;
    for (var t = 0; t <= totalSec; t += step) {
      var tick = document.createElement("span");
      tick.className = "an-ruler-tick";
      tick.style.left = msToPx(t * 1000) + "px";
      tick.textContent = formatClock(t);
      ruler.appendChild(tick);
    }
  }

  function renderTimeline() {
    var track = $("an-timeline-track");
    var layer = $("an-segments-layer");
    var playhead = $("an-playhead");
    if (!track || !layer || !playhead) return;

    var width = timelineTrackWidthPx();
    track.style.width = width + "px";
    layer.style.width = width + "px";
    layer.innerHTML = "";

    sortedSegments().forEach(function (seg) {
      var el = document.createElement("div");
      el.className = "an-segment";
      if (seg.pending) el.className += " an-seg-pending";
      el.dataset.id = seg.id;
      el.style.left = msToPx(seg.startMs) + "px";
      el.style.width = Math.max(28, msToPx(seg.durationSec * 1000)) + "px";
      el.title = (seg.label || "Clip") + " · " + seg.durationSec + "s";

      if (seg.thumbUrl) {
        var thumb = document.createElement("img");
        thumb.className = "an-seg-thumb";
        thumb.src = seg.thumbUrl;
        thumb.alt = "";
        el.appendChild(thumb);
      }
      var lbl = document.createElement("span");
      lbl.className = "an-seg-label";
      lbl.textContent = (seg.label || "Clip") + " · " + seg.durationSec + "s";
      el.appendChild(lbl);

      el.addEventListener("click", function () {
        state.playheadMs = seg.startMs;
        updatePlayheadUi();
        if (seg.url && !seg.pending) previewSegment(seg);
      });
      layer.appendChild(el);
    });

    renderRuler();
    updatePlayheadUi();
  }

  function updatePlayheadUi() {
    var playhead = $("an-playhead");
    if (playhead) playhead.style.left = msToPx(state.playheadMs) + "px";
    var scroll = $("an-timeline-scroll");
    if (scroll) {
      var px = msToPx(state.playheadMs);
      var view = scroll.clientWidth;
      if (px < scroll.scrollLeft + 40 || px > scroll.scrollLeft + view - 40) {
        scroll.scrollLeft = Math.max(0, px - view * 0.35);
      }
    }
  }

  function updateTimelineMeta() {
    var el = $("an-timeline-meta");
    if (!el) return;
    var used = timelineUsedMs();
    var count = state.segments.filter(function (s) {
      return !s.pending;
    }).length;
    el.textContent =
      "Playhead " +
      formatMs(state.playheadMs) +
      " · used " +
      formatMs(used) +
      " / " +
      formatMs(MAX_TIMELINE_MS) +
      " · " +
      count +
      " clips";
  }

  function syncDurationUi() {
    document.querySelectorAll(".an-dur-btn").forEach(function (btn) {
      var d = parseInt(btn.getAttribute("data-dur"), 10);
      btn.classList.toggle("active", d === state.durationSec);
    });
    var hint = $("an-dur-hint");
    if (hint) {
      hint.textContent =
        "Each cast is 6–15s — morph uses ≤" +
        MORPH_REF_MAX_SEC +
        "s ref · spells ≤" +
        SPELL_REF_MAX_SEC +
        "s · prompt-only ≤" +
        WHISPER_MAX_SEC +
        "s";
    }
  }

  function showGenPreview(url) {
    var img = $("an-gen-preview");
    if (!img) return;
    if (!url) {
      img.hidden = true;
      img.removeAttribute("src");
      return;
    }
    img.src = url;
    img.alt = "Spell preview";
    img.hidden = false;
  }

  function setProgressVisible(on) {
    var wrap = $("an-progress-wrap");
    var overlay = $("an-gen-overlay");
    var zone = $("an-drop-zone");
    if (wrap) wrap.hidden = !on;
    if (overlay) overlay.hidden = !on;
    if (zone) zone.classList.toggle("an-generating", !!on);
  }

  function updateProgressUi(job) {
    if (job) state.lastGenJob = job;
    job = job || state.lastGenJob;

    var fill = $("an-progress-fill");
    var detail = $("an-progress-detail");
    var phase = $("an-gen-phase");
    var eta = $("an-gen-eta");

    var elapsed = state.genStartedAt ? (Date.now() - state.genStartedAt) / 1000 : 0;
    if (job && job.elapsed_sec != null) elapsed = job.elapsed_sec;

    var pct = clamp((elapsed / Math.max(state.genEtaSec, 1)) * 100, 4, 96);
    if (job && job.status === "done") pct = 100;
    if (fill) fill.style.width = pct + "%";

    var phaseLabel = "Rendering motion…";
    if (job) {
      if (job.xai_status) {
        phaseLabel =
          String(job.xai_status).indexOf("overloaded") >= 0
            ? "API busy — " + job.xai_status
            : "xAI: " + job.xai_status;
      } else if (job.status === "queued") {
        phaseLabel = "Starting render job…";
      } else if (job.status) phaseLabel = "Job: " + job.status;
      if (job.mode) phaseLabel += " · " + job.mode;
    }
    if (phase) phase.textContent = phaseLabel;

    if (detail) {
      detail.textContent =
        formatClock(elapsed) +
        " elapsed · ETA ~" +
        formatClock(Math.max(0, state.genEtaSec - elapsed)) +
        " · " +
        VIDEO_RESOLUTION;
    }
    if (eta) {
      eta.textContent =
        "Usually ~1–2 min at " +
        VIDEO_RESOLUTION +
        (castCount() ? " · " + castCount() + " actor(s) on cast" : "");
    }
  }

  function startGenTimer() {
    stopGenTimer();
    state.genStartedAt = Date.now();
    updateProgressUi(null);
    state.genTimerId = setInterval(function () {
      updateProgressUi(null);
      var timer = $("an-gen-timer");
      if (timer) {
        var elapsed = Math.floor((Date.now() - state.genStartedAt) / 1000);
        timer.textContent = formatClock(elapsed) + " elapsed";
      }
    }, 500);
  }

  function stopGenTimer() {
    if (state.genTimerId) {
      clearInterval(state.genTimerId);
      state.genTimerId = null;
    }
  }

  function startSparkleCursor() {
    var zone = $("an-drop-zone");
    var canvas = $("an-sparkle-canvas");
    if (!zone || !canvas) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var particles = [];
    function resize() {
      var rect = zone.getBoundingClientRect();
      canvas.width = Math.floor(rect.width);
      canvas.height = Math.floor(rect.height);
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
    }
    resize();
    function onMove(e) {
      var rect = zone.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      for (var i = 0; i < 3; i++) {
        particles.push({
          x: x + (Math.random() - 0.5) * 8,
          y: y + (Math.random() - 0.5) * 8,
          vx: (Math.random() - 0.5) * 1.2,
          vy: -0.4 - Math.random() * 1.4,
          life: 1,
          hue: 42 + Math.random() * 30,
        });
      }
      if (particles.length > 120) particles.splice(0, particles.length - 120);
    }
    function tick() {
      if (!state.generating) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles = particles.filter(function (p) {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.035;
        if (p.life <= 0) return false;
        ctx.globalAlpha = p.life;
        ctx.fillStyle = "hsl(" + p.hue + ", 90%, 72%)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 + (1 - p.life) * 2, 0, Math.PI * 2);
        ctx.fill();
        return true;
      });
      ctx.globalAlpha = 1;
      state.sparkle.rafId = requestAnimationFrame(tick);
    }
    state.sparkle = {
      onMove: onMove,
      resize: resize,
      rafId: requestAnimationFrame(tick),
    };
    zone.addEventListener("pointermove", onMove);
    window.addEventListener("resize", resize);
  }

  function stopSparkleCursor() {
    var zone = $("an-drop-zone");
    var canvas = $("an-sparkle-canvas");
    if (state.sparkle) {
      if (state.sparkle.rafId) cancelAnimationFrame(state.sparkle.rafId);
      if (zone && state.sparkle.onMove) zone.removeEventListener("pointermove", state.sparkle.onMove);
      if (state.sparkle.resize) window.removeEventListener("resize", state.sparkle.resize);
      state.sparkle = null;
    }
    if (canvas) {
      var ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function beginGeneration(previewUrl) {
    state.generating = true;
    state.cancelRequested = false;
    state.lastGenJob = null;
    setProgressVisible(true);
    showGenPreview(previewUrl || "");
    startGenTimer();
    startSparkleCursor();
    document.querySelectorAll(".an-spell, .an-btn, .an-dur-btn").forEach(function (el) {
      if (el.id !== "an-cancel-gen") el.disabled = true;
    });
    var cancel = $("an-cancel-gen");
    if (cancel) cancel.disabled = false;
  }

  function endGeneration() {
    state.generating = false;
    state.activeJobId = null;
    state.lastGenJob = null;
    stopGenTimer();
    stopSparkleCursor();
    setProgressVisible(false);
    showGenPreview("");
    document.querySelectorAll(".an-spell, .an-btn, .an-dur-btn").forEach(function (el) {
      el.disabled = false;
    });
  }

  function pollVideoJob(jobId, startedAt, fetchRetriesLeft) {
    if (state.cancelRequested) {
      return Promise.reject(new Error("Generation cancelled."));
    }
    startedAt = startedAt || Date.now();
    if (Date.now() - startedAt > POLL_MAX_MS) {
      return Promise.reject(
        new Error("Video generation timed out after 12 minutes — try again in a moment.")
      );
    }
    if (fetchRetriesLeft == null) fetchRetriesLeft = POLL_FETCH_RETRIES;

    function pollOnce() {
      return fetchWithTimeout(
        apiUrl("/api/jobs/" + jobId),
        { cache: "no-store" },
        POLL_FETCH_TIMEOUT_MS
      )
        .then(function (r) {
          if (r.status === 404) throw new Error("Generation job lost — reload and try again.");
          return parseApiResponse(r);
        })
        .then(function (job) {
          if (state.cancelRequested) {
            return Promise.reject(new Error("Generation cancelled."));
          }
          updateProgressUi(job);
          var timer = $("an-gen-timer");
          if (timer && job.elapsed_sec != null) {
            timer.textContent = formatClock(job.elapsed_sec) + " elapsed";
          }
          if (job.status === "done") {
            var vid = job.video;
            var url = vid && (vid.url || vid.download_url || vid.uri);
            if (
              window.GallerySaveVideo &&
              window.GallerySaveVideo.preferSavedUrl
            ) {
              url = window.GallerySaveVideo.preferSavedUrl(job, url);
            }
            if (url) return { url: url, job: job };
            throw new Error("No video URL returned.");
          }
          if (job.status === "failed" || job.status === "expired") {
            var errMsg =
              (job.error && (job.error.message || job.error)) || "Video generation failed.";
            throw new Error(typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg));
          }
          var waitMs = POLL_INTERVAL_MS;
          if (job.xai_status && String(job.xai_status).indexOf("overloaded") >= 0) {
            waitMs = 2500;
          } else if (job.status === "queued") {
            waitMs = 800;
          }
          return delay(waitMs).then(function () {
            return pollVideoJob(jobId, startedAt, POLL_FETCH_RETRIES);
          });
        });
    }

    return pollOnce().catch(function (err) {
      if (state.cancelRequested) {
        return Promise.reject(new Error("Generation cancelled."));
      }
      var msg = String((err && err.message) || err || "");
      var transient =
        msg.indexOf("timed out") >= 0 ||
        msg.indexOf("timeout") >= 0 ||
        msg.indexOf("network") >= 0 ||
        msg.indexOf("fetch") >= 0;
      if (transient && fetchRetriesLeft > 0) {
        setStatus("Connection hiccup — still waiting on video (" + fetchRetriesLeft + ")…", "pending");
        return delay(2000).then(function () {
          return pollVideoJob(jobId, startedAt, fetchRetriesLeft - 1);
        });
      }
      throw err;
    });
  }

  function generateSegment(opts) {
    opts = opts || {};
    var body = {
      stasis: opts.stasis || "",
      prompt: opts.prompt || "",
      duration: opts.duration || state.durationSec,
      spells: opts.spells || [],
      resolution: VIDEO_RESOLUTION,
      morph_chain: !!opts.morph_chain,
      video_url: opts.video_url || "",
      aspect_ratio: "16:9",
    };
    var cast = getCastPayload();
    var beats = getBeatsPayload();
    if (cast.length) {
      body.cast = cast;
      body.character = cast[0].character;
      body.character_id = cast[0].character.id;
    }
    if (beats.length) body.beats = beats;
    if (state.activePlaceId) {
      var place = state.savedRooms.find(function (r) {
        return r.id === state.activePlaceId;
      });
      if (place) {
        body.place_id = place.id;
        body.place = place;
      }
    }
    if (state.activeObjectIds.length) {
      body.object_ids = state.activeObjectIds.slice();
      body.objects = state.activeObjectIds
        .map(function (oid) {
          return state.savedObjects.find(function (o) {
            return o.id === oid;
          });
        })
        .filter(Boolean);
    }
    return fetchWithTimeout(
      apiUrl("/api/animate-cast"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      FETCH_TIMEOUT_MS
    ).then(function (r) {
      return parseApiResponse(r).then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || "Animate cast failed.");
        if (r.status === 202 && d.job_id) {
          state.activeJobId = d.job_id;
          return pollVideoJob(d.job_id);
        }
        var vid = d.video;
        var url = vid && (vid.url || vid.download_url || vid.uri);
        if (url) return { url: url, job: d };
        if (d.job_id) {
          state.activeJobId = d.job_id;
          return pollVideoJob(d.job_id);
        }
        throw new Error("No job id returned.");
      });
    });
  }

  function previewSegment(seg) {
    var player = $("an-player");
    var zone = $("an-drop-zone");
    if (!player || !seg || !seg.url) return;
    player.src = absoluteUrl(seg.url);
    player.hidden = false;
    player.controls = true;
    if (zone) zone.classList.add("an-has-video");
    player.play().catch(function () {});
  }

  function showLatestVideo(url) {
    previewSegment({ url: url });
  }

  function castSpell(spellItem) {
    if (state.generating) {
      setStatus("Already generating a clip…", "error");
      return Promise.resolve();
    }

    spellItem = spellItem ? normalizeItem(spellItem) : null;
    var hasSpellVisual = spellItem && (spellItem.url || spellItem.paintingNum || spellItem.lod1Num);
    var hasCharacter = castCount() > 0;

    var hasPerformance = castHasPerformance();

    if (!hasSpellVisual && !hasCharacter && !motionPrompt() && !hasPerformance) {
      setStatus("Drag a spell up, add script beats, or enter a scene prompt.", "error");
      return Promise.resolve();
    }

    if (hasCharacter && !hasPerformance && !motionPrompt() && !hasSpellVisual) {
      setStatus("Add script beats (Action, Dialogue, or Reaction) — or a scene-wide motion prompt.", "error");
      return Promise.resolve();
    }

    var insertMs = insertStartMsForNew(state.durationSec);
    var morph = resolveMorphOptions(insertMs);
    if (morph.skipped) setStatus(morph.reason, "ok");

    var spells = hasSpellVisual ? paintingNumsFromItems([spellItem]) : [];
    var duration = effectiveDurationSec({
      duration: state.durationSec,
      spells: spells,
      morph_chain: morph.morph_chain,
    });

    if (!canFitSegment(duration, insertMs)) {
      setStatus("Timeline full (10:00 max) — clear or shorten clips.", "error");
      return Promise.resolve();
    }

    var label = hasSpellVisual
      ? spellItem.label || "Spell"
      : hasCharacter
        ? castLabel()
        : "Motion";

    var pendingId = nextSegmentId();
    addSegment({
      id: pendingId,
      startMs: insertMs,
      durationSec: duration,
      url: "",
      thumbUrl: hasSpellVisual ? spellItem.url : primaryCastCharacter() && primaryCastCharacter().preview_url,
      label: label,
      pending: true,
      spells: spells,
    });

    state.genEtaSec = estimateEtaSec(duration, morph.morph_chain);
    beginGeneration(hasSpellVisual ? spellItem.url : primaryCastCharacter() && primaryCastCharacter().preview_url);
    setStatus("Casting " + label + " (" + duration + "s)…", "pending");

    warmCastUploads();
    var stasisPromise = hasSpellVisual
      ? buildFastVisualStasis(spellItem)
      : Promise.resolve("");

    return stasisPromise
      .then(function (stasis) {
        return generateSegment({
          stasis: stasis,
          prompt: composeScenePrompt(),
          duration: duration,
          spells: spells,
          morph_chain: morph.morph_chain,
          video_url: morph.video_url,
        });
      })
      .then(function (result) {
        var rawUrl = absoluteUrl(result.url);
        // Prefer server auto-saved path; always ensure clip lands in saved-videos/
        var prefer =
          window.GallerySaveVideo && window.GallerySaveVideo.preferSavedUrl
            ? window.GallerySaveVideo.preferSavedUrl(result.job || result, rawUrl)
            : rawUrl;
        var savePromise =
          window.GallerySaveVideo && window.GallerySaveVideo.save
            ? window.GallerySaveVideo.save(prefer || rawUrl)
            : Promise.resolve(null);
        return savePromise
          .then(function (saved) {
            var url =
              (saved && saved.url && absoluteUrl(saved.url)) || prefer || rawUrl;
            updateSegmentById(pendingId, {
              url: url,
              pending: false,
              thumbUrl: hasSpellVisual
                ? spellItem.url
                : primaryCastCharacter() && primaryCastCharacter().preview_url,
              savedName: saved && saved.name,
            });
            state.playheadMs = insertMs;
            updatePlayheadUi();
            showLatestVideo(url);
            setStatus(
              "Clip ready" +
                (saved && saved.name ? " — saved-videos/" + saved.name : "") +
                " · timeline " +
                formatMs(timelineUsedMs()) +
                " used.",
              "ok"
            );
          })
          .catch(function () {
            updateSegmentById(pendingId, {
              url: prefer || rawUrl,
              pending: false,
              thumbUrl: hasSpellVisual
                ? spellItem.url
                : primaryCastCharacter() && primaryCastCharacter().preview_url,
            });
            state.playheadMs = insertMs;
            updatePlayheadUi();
            showLatestVideo(prefer || rawUrl);
            setStatus("Clip ready — added to timeline (" + formatMs(timelineUsedMs()) + " used).", "ok");
          });
      })
      .catch(function (err) {
        removeSegmentById(pendingId);
        setStatus(friendlyAnimateError(err), "error");
      })
      .finally(endGeneration);
  }

  function pasteClipAtPlayhead() {
    var input = $("an-paste-url");
    var raw = input && input.value ? input.value.trim() : "";
    if (!raw) {
      setStatus("Paste a video URL first.", "error");
      return;
    }
    var duration = clamp(state.durationSec, 1, WHISPER_MAX_SEC);
    var startMs = state.appendAtEnd ? insertStartMsForNew(duration) : state.playheadMs;
    if (!canFitSegment(duration, startMs)) {
      setStatus("Not enough room on timeline (10:00 max).", "error");
      return;
    }
    addSegment({
      id: nextSegmentId(),
      startMs: startMs,
      durationSec: duration,
      url: raw,
      thumbUrl: "",
      label: "Pasted",
      pending: false,
      spells: [],
    });
    if (input) input.value = "";
    state.playheadMs = startMs;
    updatePlayheadUi();
    previewSegment({ url: raw });
    setStatus("Pasted clip at " + formatMs(startMs) + ".", "ok");
  }

  function clearTimeline() {
    if (state.generating) {
      setStatus("Wait for the current cast to finish.", "error");
      return;
    }
    stopTimelinePlayback();
    state.segments = [];
    state.playheadMs = 0;
    renderTimeline();
    updateTimelineMeta();
    var player = $("an-player");
    var alt = $("an-player-alt");
    var zone = $("an-drop-zone");
    if (player) {
      player.pause();
      player.removeAttribute("src");
      player.hidden = true;
    }
    if (alt) {
      alt.pause();
      alt.removeAttribute("src");
      alt.hidden = true;
    }
    if (zone) zone.classList.remove("an-has-video");
    setStatus("Timeline cleared.", "ok");
  }

  function loadSavedCharacters() {
    return fetchWithTimeout(apiUrl("/api/characters"), { cache: "no-store" })
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (d) {
        state.savedCharacters = (d && d.characters) || [];
        restoreCastScript();
        syncCastWithSavedCharacters();
        updateCastUi();
        try {
          localStorage.setItem("animate-characters-cache", JSON.stringify(state.savedCharacters));
        } catch (e) {}
        return state.savedCharacters;
      })
      .catch(function () {
        try {
          state.savedCharacters = JSON.parse(localStorage.getItem("animate-characters-cache") || "[]");
        } catch (e2) {
          state.savedCharacters = [];
        }
        restoreCastScript();
        syncCastWithSavedCharacters();
        updateCastUi();
        return state.savedCharacters;
      });
  }

  function syncCastWithSavedCharacters() {
    var nextOrder = [];
    var nextRoster = {};
    state.castOrder.forEach(function (id) {
      var ch = state.savedCharacters.find(function (c) {
        return c.id === id;
      });
      if (!ch) return;
      nextOrder.push(id);
      var prev = state.castRoster[id] || {};
      nextRoster[id] = { character: ch };
    });
    state.castOrder = nextOrder;
    state.castRoster = nextRoster;
    state.castBeats.forEach(function (b) {
      if (!nextRoster[b.characterId] && nextOrder.length) {
        b.characterId = nextOrder[0];
      }
    });
    pruneBeatsForCast();
  }

  function renderCharacterStrip() {
    var strip = $("an-character-strip");
    if (!strip) return;
    strip.innerHTML = "";
    if (!state.savedCharacters.length) {
      var empty = document.createElement("span");
      empty.className = "an-character-empty";
      empty.textContent = "No saved characters — build one in Characters tab.";
      strip.appendChild(empty);
      return;
    }
    state.savedCharacters.forEach(function (ch) {
      var on = isOnCast(ch.id);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "an-character-chip " + (on ? "on-cast" : "off-cast");
      btn.title = (on ? "On cast — tap to remove" : "Off cast — tap to add") + ": " + (ch.name || "Character");
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      if (ch.preview_url) {
        var img = document.createElement("img");
        img.src = ch.preview_url;
        img.alt = ch.name || "";
        btn.appendChild(img);
      }
      var lbl = document.createElement("span");
      lbl.className = "an-character-chip-name";
      lbl.textContent = ch.name || "Character";
      btn.appendChild(lbl);
      btn.addEventListener("click", function () {
        toggleCast(ch);
      });
      strip.appendChild(btn);
    });
  }

  function togglePlace(room) {
    if (!room || !room.id) return;
    if (state.activePlaceId === room.id) {
      state.activePlaceId = "";
      setStatus('Place cleared.', "ok");
    } else {
      state.activePlaceId = room.id;
      setStatus('Place set to "' + (room.name || "scene") + '".', "ok");
    }
    renderPlaceStrip();
    warmCastUploads();
  }

  function toggleObject(obj) {
    if (!obj || !obj.id) return;
    var idx = state.activeObjectIds.indexOf(obj.id);
    if (idx >= 0) {
      state.activeObjectIds.splice(idx, 1);
      setStatus('Object "' + (obj.name || "object") + '" removed.', "ok");
    } else {
      if (state.activeObjectIds.length >= 3) {
        setStatus("Max 3 objects — remove one first.", "error");
        return;
      }
      state.activeObjectIds.push(obj.id);
      setStatus('Object "' + (obj.name || "object") + '" equipped.', "ok");
    }
    renderObjectStrip();
    warmCastUploads();
  }

  function renderPlaceStrip() {
    var strip = $("an-place-strip");
    var label = $("an-place-label");
    if (label) {
      if (!state.activePlaceId) {
        label.textContent = "None — tap a saved place";
      } else {
        var room = state.savedRooms.find(function (r) {
          return r.id === state.activePlaceId;
        });
        label.textContent = room ? "Place: " + room.name : "Place selected";
        label.classList.add("an-cast-live");
      }
      if (!state.activePlaceId) label.classList.remove("an-cast-live");
    }
    if (!strip) return;
    strip.innerHTML = "";
    if (!state.savedRooms.length) {
      strip.innerHTML = '<span class="an-character-empty">No saved places — build in Places tab.</span>';
      return;
    }
    state.savedRooms.forEach(function (room) {
      var on = state.activePlaceId === room.id;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "an-character-chip an-place-chip " + (on ? "on-cast" : "off-cast");
      if (room.preview_url) {
        var img = document.createElement("img");
        img.src = room.preview_url;
        btn.appendChild(img);
      }
      var lbl = document.createElement("span");
      lbl.className = "an-character-chip-name";
      lbl.textContent = room.name || "Place";
      btn.appendChild(lbl);
      btn.addEventListener("click", function () {
        togglePlace(room);
      });
      strip.appendChild(btn);
    });
  }

  function renderObjectStrip() {
    var strip = $("an-object-strip");
    var count = $("an-object-count");
    if (count) {
      count.textContent = state.activeObjectIds.length
        ? state.activeObjectIds.length + "/3 equipped"
        : "0 equipped";
      count.classList.toggle("an-cast-live", state.activeObjectIds.length > 0);
    }
    if (!strip) return;
    strip.innerHTML = "";
    if (!state.savedObjects.length) {
      strip.innerHTML = '<span class="an-character-empty">No saved objects — build in Objects tab.</span>';
      return;
    }
    state.savedObjects.forEach(function (obj) {
      var on = state.activeObjectIds.indexOf(obj.id) >= 0;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "an-character-chip an-object-chip " + (on ? "on-cast" : "off-cast");
      if (obj.preview_url) {
        var img = document.createElement("img");
        img.src = obj.preview_url;
        btn.appendChild(img);
      }
      var lbl = document.createElement("span");
      lbl.className = "an-character-chip-name";
      lbl.textContent = obj.name || "Object";
      btn.appendChild(lbl);
      btn.addEventListener("click", function () {
        toggleObject(obj);
      });
      strip.appendChild(btn);
    });
  }

  function loadSavedObjects() {
    return fetchWithTimeout(apiUrl("/api/objects"), { cache: "no-store" })
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (d) {
        state.savedObjects = (d && d.objects) || [];
        renderObjectStrip();
        return state.savedObjects;
      })
      .catch(function () {
        state.savedObjects = [];
        renderObjectStrip();
        return [];
      });
  }

  function loadLocalChainsForAnimate() {
    try {
      var rows = JSON.parse(localStorage.getItem("api-chains-local") || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch (_err) {
      return [];
    }
  }

  function mergeChainsForAnimate(serverChains, localChains) {
    var merged = [];
    var seen = {};
    (serverChains || []).concat(localChains || []).forEach(function (row) {
      var key = String(row.id || row.slug || row.name || "");
      if (!key || seen[key]) return;
      seen[key] = true;
      merged.push(normalizeChainForMention(row));
    });
    return merged;
  }

  function loadSavedChains() {
    var local = loadLocalChainsForAnimate().map(normalizeChainForMention);
    return fetchWithTimeout(apiUrl("/api/chains"), { cache: "no-store" }, 12000)
      .then(function (r) {
        return window.parseGalleryApiResponse ? window.parseGalleryApiResponse(r) : r.json();
      })
      .then(function (d) {
        var server = (d && d.chains ? d.chains : []).map(normalizeChainForMention);
        state.savedChains = mergeChainsForAnimate(server, local);
        return state.savedChains;
      })
      .catch(function () {
        state.savedChains = local;
        return state.savedChains;
      });
  }

  function loadSavedRooms() {
    return fetchWithTimeout(apiUrl("/api/rooms"), { cache: "no-store" })
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (d) {
        state.savedRooms = (d && d.rooms) || [];
        renderPlaceStrip();
        return state.savedRooms;
      })
      .catch(function () {
        state.savedRooms = [];
        renderPlaceStrip();
        return [];
      });
  }

  function renderBeatQuickAdd() {
    var quick = $("an-beat-quick");
    if (!quick) return;
    quick.innerHTML = "";
    state.castOrder.forEach(function (id) {
      var ch = characterOnCastById(id);
      if (!ch) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "an-btn an-beat-quick-btn";
      btn.textContent = "+ " + (ch.name || "Character");
      btn.addEventListener("click", function () {
        addCastBeat(id, "dialogue");
      });
      quick.appendChild(btn);
    });
  }

  function renderCastPanel() {
    var list = $("an-cast-list");
    var heading = $("an-cast-heading");
    if (!list) return;
    list.innerHTML = "";
    renderBeatQuickAdd();
    var beats = state.castBeats;
    if (heading) {
      heading.textContent =
        beats.length > 1
          ? "Performance script — " + beats.length + " beats (play in order)"
          : "Performance script — add beats in any order";
    }
    if (!beats.length) {
      var empty = document.createElement("p");
      empty.className = "an-beat-intro";
      empty.textContent = "No beats yet — add Action, Dialogue, or Reaction beats below.";
      list.appendChild(empty);
      return;
    }

    beats.forEach(function (beat, idx) {
      var beatType = beat.type || "action";
      var meta = beatTypeMeta(beatType);
      var card = document.createElement("div");
      card.className =
        "an-beat-card an-beat-type-" +
        beatType +
        (beat.followUp ? " an-beat-follow" : "");
      card.dataset.beatId = beat.id;
      card.dataset.beatType = beatType;

      var head = document.createElement("div");
      head.className = "an-beat-head";

      var num = document.createElement("span");
      num.className = "an-beat-num";
      num.textContent = "Beat " + (idx + 1);
      head.appendChild(num);

      var typeSel = document.createElement("select");
      typeSel.className = "an-beat-type-select an-beat-type-select-" + beatType;
      typeSel.title = "Change beat type";
      ["action", "dialogue", "reaction"].forEach(function (t) {
        var opt = document.createElement("option");
        opt.value = t;
        opt.textContent = beatTypeMeta(t).label;
        if (t === beatType) opt.selected = true;
        typeSel.appendChild(opt);
      });
      typeSel.addEventListener("change", function () {
        setBeatType(beat.id, typeSel.value);
      });
      head.appendChild(typeSel);

      var moves = document.createElement("div");
      moves.className = "an-beat-move";
      ["↑", "↓"].forEach(function (label, mi) {
        var mb = document.createElement("button");
        mb.type = "button";
        mb.className = "an-btn";
        mb.textContent = label;
        mb.title = mi === 0 ? "Move beat up" : "Move beat down";
        mb.disabled = mi === 0 ? idx === 0 : idx === beats.length - 1;
        mb.addEventListener("click", function () {
          moveCastBeat(beat.id, mi === 0 ? -1 : 1);
        });
        moves.appendChild(mb);
      });
      head.appendChild(moves);

      var sel = document.createElement("select");
      sel.className = "an-beat-char-select";
      state.castOrder.forEach(function (id) {
        var ch = characterOnCastById(id);
        if (!ch) return;
        var opt = document.createElement("option");
        opt.value = id;
        opt.textContent = ch.name || "Character";
        if (id === beat.characterId) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener("change", function () {
        beat.characterId = sel.value;
        persistCastScript();
      });
      head.appendChild(sel);

      var dup = document.createElement("button");
      dup.type = "button";
      dup.className = "an-btn an-beat-dup";
      dup.textContent = "Dup";
      dup.title = "Duplicate beat below";
      dup.addEventListener("click", function () {
        duplicateCastBeat(beat.id);
      });
      head.appendChild(dup);

      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "an-btn an-beat-rm";
      rm.textContent = "Remove";
      rm.addEventListener("click", function () {
        removeCastBeat(beat.id);
      });
      head.appendChild(rm);
      card.appendChild(head);

      var followRow = document.createElement("label");
      followRow.className = "an-beat-follow-row";
      var followChk = document.createElement("input");
      followChk.type = "checkbox";
      followChk.className = "an-beat-follow-chk";
      followChk.checked = !!beat.followUp;
      followChk.disabled = idx === 0;
      followChk.addEventListener("change", function () {
        beat.followUp = !!followChk.checked;
        persistCastScript();
        card.classList.toggle("an-beat-follow", beat.followUp);
      });
      followRow.appendChild(followChk);
      followRow.appendChild(
        document.createTextNode(
          idx === 0
            ? "First beat — opens the scene"
            : "Continues / reacts after previous beat"
        )
      );
      card.appendChild(followRow);

      var fields = document.createElement("div");
      fields.className = "an-beat-fields";

      var field = document.createElement("div");
      field.className = "an-cast-field an-beat-field-" + beatType;

      var label = document.createElement("label");
      label.textContent = meta.label;
      field.appendChild(label);

      var input;
      if (beatType === "dialogue") {
        input = document.createElement("textarea");
        input.rows = 2;
        input.className = "an-beat-input an-beat-input-dialogue";
      } else {
        input = document.createElement("input");
        input.type = "text";
        input.className =
          "an-beat-input an-beat-input-" + beatType;
      }
      input.placeholder = meta.placeholder;
      input.value = beat.text || beatDisplayText(beat) || "";
      input.addEventListener("input", function () {
        beat.text = input.value;
        persistCastScript();
      });
      field.appendChild(input);
      attachCharacterMentions(input);
      fields.appendChild(field);
      card.appendChild(fields);
      list.appendChild(card);
    });
  }

  function getPlayers() {
    return {
      a: $("an-player"),
      b: $("an-player-alt"),
    };
  }

  function activePlayerEl() {
    var p = getPlayers();
    return state.playbackSlot === 0 ? p.a : p.b;
  }

  function inactivePlayerEl() {
    var p = getPlayers();
    return state.playbackSlot === 0 ? p.b : p.a;
  }

  function setActivePlayerSlot(slot) {
    state.playbackSlot = slot ? 1 : 0;
    var p = getPlayers();
    if (!p.a || !p.b) return;
    p.a.classList.toggle("an-player-active", state.playbackSlot === 0);
    p.b.classList.toggle("an-player-active", state.playbackSlot === 1);
    p.a.hidden = false;
    p.b.hidden = false;
  }

  function stopTimelinePlayback() {
    state.timelinePlaying = false;
    if (state.playbackCleanup) {
      state.playbackCleanup();
      state.playbackCleanup = null;
    }
    var p = getPlayers();
    if (p.a) {
      p.a.onended = null;
      p.a.pause();
    }
    if (p.b) {
      p.b.onended = null;
      p.b.pause();
    }
  }

  function updateTheaterMeta(index, total) {
    var meta = $("an-theater-meta");
    if (meta) meta.textContent = "Clip " + index + "/" + total;
  }

  function enterTheater() {
    state.theaterOpen = true;
    document.body.classList.add("an-theater-active");
    var bar = $("an-theater-bar");
    if (bar) bar.hidden = false;
    var zone = $("an-drop-zone");
    if (zone && zone.requestFullscreen) {
      zone.requestFullscreen().catch(function () {});
    } else if (zone && zone.webkitRequestFullscreen) {
      zone.webkitRequestFullscreen();
    }
  }

  function exitTheater() {
    state.theaterOpen = false;
    document.body.classList.remove("an-theater-active");
    var bar = $("an-theater-bar");
    if (bar) bar.hidden = true;
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
    var p = getPlayers();
    if (p.a) p.a.controls = true;
    if (p.b) p.b.controls = false;
  }

  function playTimeline(opts) {
    opts = opts || {};
    var playable = sortedSegments().filter(function (s) {
      return s.url && !s.pending;
    });
    if (!playable.length) {
      setStatus("No clips to play — cast or paste first.", "error");
      return;
    }

    stopTimelinePlayback();
    state.timelinePlaying = true;

    if (opts.theater) enterTheater();
    else exitTheater();

    var idx = 0;
    setActivePlayerSlot(0);
    var zone = $("an-drop-zone");
    if (zone) zone.classList.add("an-has-video");

    function cleanup() {
      var active = activePlayerEl();
      var inactive = inactivePlayerEl();
      if (active) active.onended = null;
      if (inactive) inactive.onended = null;
    }
    state.playbackCleanup = cleanup;

    function playIndex(i) {
      if (!state.timelinePlaying) return;
      if (i >= playable.length) {
        stopTimelinePlayback();
        setStatus("Timeline finished.", "ok");
        if (opts.theater) exitTheater();
        return;
      }

      var seg = playable[i];
      var active = activePlayerEl();
      var inactive = inactivePlayerEl();
      if (!active) return;

      state.playheadMs = seg.startMs;
      updatePlayheadUi();
      updateTheaterMeta(i + 1, playable.length);

      active.controls = !opts.theater;
      active.src = absoluteUrl(seg.url);
      active.classList.add("an-player-active");

      if (inactive) {
        inactive.classList.remove("an-player-active");
        inactive.controls = false;
        if (i + 1 < playable.length) {
          inactive.src = absoluteUrl(playable[i + 1].url);
          inactive.load();
        }
      }

      active.onended = function () {
        state.playbackSlot = state.playbackSlot === 0 ? 1 : 0;
        setActivePlayerSlot(state.playbackSlot);
        playIndex(i + 1);
      };

      active.play().catch(function () {
        setStatus("Could not play clip " + (i + 1) + ".", "error");
        playIndex(i + 1);
      });
    }

    playIndex(0);
    setStatus("Playing timeline (" + playable.length + " clips)…", "ok");
  }

  function dropZoneRect() {
    var zone = $("an-drop-zone");
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
      state.drag.sourceEl.classList.remove("an-spell-dragging");
    }
    state.drag = null;
  }

  function createGhost(item, x, y) {
    var ghost = document.createElement("div");
    ghost.className = "an-drag-ghost";
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
    var spell = e.target.closest(".an-spell");
    if (!spell || spell.disabled) return;
    var idx = parseInt(spell.dataset.idx, 10);
    var item = normalizeItem(state.trayItems[idx]);
    if (!item.url && !castCount()) return;

    e.preventDefault();
    if (spell.setPointerCapture) spell.setPointerCapture(e.pointerId);
    spell.classList.add("an-spell-dragging");

    var lead = primaryCastCharacter();
    var ghost = createGhost(
      item.url ? item : { url: lead.preview_url, label: lead.name },
      e.clientX,
      e.clientY
    );
    state.drag = {
      item: item,
      sourceEl: spell,
      ghost: ghost,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      moved: false,
    };

    var zone = $("an-drop-zone");
    if (zone) zone.classList.add("an-drop-active");
  }

  function onPointerMove(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    state.drag.moved = true;
    state.drag.ghost.style.left = e.clientX + "px";
    state.drag.ghost.style.top = e.clientY + "px";
    var rect = dropZoneRect();
    var zone = $("an-drop-zone");
    if (zone) zone.classList.toggle("an-drop-active", pointInRect(e.clientX, e.clientY, rect));
  }

  function onPointerUp(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    var drag = state.drag;
    var dy = drag.startY - e.clientY;
    var rect = dropZoneRect();
    var overDrop = pointInRect(e.clientX, e.clientY, rect);
    var castUp = dy >= DRAG_UP_THRESHOLD;

    removeGhost();
    var zone = $("an-drop-zone");
    if (zone) zone.classList.remove("an-drop-active");

    if (drag.sourceEl && drag.sourceEl.releasePointerCapture) {
      try {
        drag.sourceEl.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }

    if (overDrop && (castUp || dy >= 20 || !drag.moved)) {
      castSpell(drag.item);
    }
  }

  function onPointerCancel(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    removeGhost();
    var zone = $("an-drop-zone");
    if (zone) zone.classList.remove("an-drop-active");
  }

  function onTimelineScrollClick(e) {
    if (state.generating) return;
    var track = $("an-timeline-track");
    if (!track || !track.contains(e.target)) return;
    if (e.target.closest(".an-segment")) return;
    var rect = track.getBoundingClientRect();
    var x = e.clientX - rect.left + ( $("an-timeline-scroll").scrollLeft || 0);
    state.playheadMs = clamp(pxToMs(x), 0, MAX_TIMELINE_MS);
    updatePlayheadUi();
    updateTimelineMeta();
  }

  function bindUi() {
    document.querySelectorAll(".an-dur-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var d = parseInt(btn.getAttribute("data-dur"), 10);
        if (d === 6 || d === 10 || d === 15) {
          state.durationSec = d;
          syncDurationUi();
        }
      });
    });

    var append = $("an-append-end");
    if (append) {
      append.checked = state.appendAtEnd;
      append.addEventListener("change", function () {
        state.appendAtEnd = !!append.checked;
      });
    }

    var morph = $("an-morph-chain");
    if (morph) {
      morph.checked = state.morphChain;
      morph.addEventListener("change", function () {
        state.morphChain = !!morph.checked;
      });
    }

    var pasteBtn = $("an-paste-btn");
    if (pasteBtn) pasteBtn.addEventListener("click", pasteClipAtPlayhead);

    var clearBtn = $("an-clear-timeline");
    if (clearBtn) clearBtn.addEventListener("click", clearTimeline);

    var playBtn = $("an-play-timeline");
    if (playBtn) {
      playBtn.addEventListener("click", function () {
        playTimeline({ theater: false });
      });
    }

    var fsBtn = $("an-play-fullscreen");
    if (fsBtn) {
      fsBtn.addEventListener("click", function () {
        playTimeline({ theater: true });
      });
    }

    var exit = $("an-theater-exit");
    if (exit) exit.addEventListener("click", exitTheater);

    var cancel = $("an-cancel-gen");
    if (cancel) {
      cancel.addEventListener("click", function () {
        if (!state.generating) return;
        state.cancelRequested = true;
        setStatus("Cancelling…", "pending");
        endGeneration();
        setStatus("Generation cancelled.", "ok");
      });
    }

    var spellSearch = $("an-spell-search");
    if (spellSearch) {
      spellSearch.addEventListener("input", function () {
        applyTrayView();
      });
      spellSearch.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          spellSearch.value = "";
          applyTrayView();
        }
      });
    }

    var rand = $("an-randomize");
    if (rand) {
      rand.addEventListener("click", function () {
        if (spellSearch) spellSearch.value = "";
        fillTrayRandom();
        setStatus("Tray randomized.", "ok");
      });
    }

    var all = $("an-show-all");
    if (all) {
      all.addEventListener("click", function () {
        if (spellSearch) spellSearch.value = "";
        fillTrayAll();
        setStatus("Showing full library.", "ok");
      });
    }

    var castClear = $("an-cast-clear");
    if (castClear) castClear.addEventListener("click", clearCast);

    ["action", "dialogue", "reaction"].forEach(function (type) {
      var beatAdd = $("an-beat-add-" + type);
      if (beatAdd) {
        beatAdd.addEventListener("click", function () {
          addCastBeat(null, type);
        });
      }
    });

    var strip = $("an-spell-strip");
    if (strip) {
      strip.addEventListener("pointerdown", onPointerDown);
      strip.addEventListener("pointermove", onPointerMove);
      strip.addEventListener("pointerup", onPointerUp);
      strip.addEventListener("pointercancel", onPointerCancel);
    }

    var scroll = $("an-timeline-scroll");
    if (scroll) scroll.addEventListener("click", onTimelineScrollClick);

    var prompt = $("an-prompt");
    if (prompt) attachCharacterMentions(prompt, { allowEnterSubmit: true });

    document.addEventListener("mousedown", function (e) {
      if (!mentionState.menu || mentionState.menu.hidden) return;
      if (e.target.closest("#an-mention-menu")) return;
      if (mentionState.activeInput && e.target === mentionState.activeInput) return;
      hideMentionMenu();
    });

    document.addEventListener("fullscreenchange", function () {
      if (!document.fullscreenElement && state.theaterOpen) {
        exitTheater();
        stopTimelinePlayback();
      }
    });
  }

  function boot() {
    if (!$("panel-animate")) return;
    syncDurationUi();
    renderTimeline();
    updateTimelineMeta();
    bindUi();
    window.dispatchEvent(new Event("animate-ready"));
  }

  function consumeLoganHandoff() {
    try {
      var raw = sessionStorage.getItem("logan-handoff");
      if (!raw) return;
      sessionStorage.removeItem("logan-handoff");
      var data = JSON.parse(raw);
      if (!data) return;
      if (data.videoUrl) {
        var paste = $("an-paste-url");
        if (paste) paste.value = absoluteUrl(data.videoUrl);
        pasteClipAtPlayhead();
        setStatus("Logan clip pasted on timeline.", "ok");
      }
      if (data.prompt) {
        var prompt = $("an-prompt");
        if (prompt && !prompt.value.trim()) prompt.value = data.prompt;
      }
    } catch (eHandoff) {}
  }

  function onShow() {
    consumeLoganHandoff();
    loadImagePool().then(function () {
      if (!state.trayItems.length) {
        fillTrayRandom();
        renderTray();
      } else {
        updateTrayCount();
      }
    });
    loadSavedCharacters();
    loadSavedObjects();
    loadSavedRooms();
    loadSavedChains();
    fetchWithTimeout(apiUrl("/api/health"), { cache: "no-store" }, 12000)
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (d && d.ok && !window.SPELLFORGE_API_BASE) {
          /* same-origin server */
        }
      })
      .catch(function () {});
  }

  window.Animate = {
    onShow: onShow,
    castSpell: castSpell,
    playTimeline: playTimeline,
    getSegments: function () {
      return state.segments.slice();
    },
    getActiveCharacter: function () {
      return primaryCastCharacter();
    },
    getCastRoster: function () {
      return getCastPayload();
    },
  };

  window.addEventListener("animate-show", onShow);
  window.addEventListener("api-chains-updated", loadSavedChains);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();