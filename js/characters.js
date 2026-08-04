/**
 * Characters — full 360° turnaround sheet (8 turns × 3 height pans), view only.
 */
(function () {
  "use strict";

  var TRAY_SLICE = 36;
  var DRAG_UP_THRESHOLD = 40;
  var FETCH_TIMEOUT_MS = 90000;
  var POLL_INTERVAL_MS = 900;
  var FRAME_COUNT = 8;
  var PAN_ROWS = 3;

  var state = {
    pool: [],
    poolReady: false,
    trayItems: [],
    appliedSpells: [],
    saved: [],
    draft: null,
    dirty: false,
    generating: false,
    drag: null,
    sheetUrl: "",
    frameCount: FRAME_COUNT,
    panRows: PAN_ROWS,
    currentImageUrl: "",
    continuityId: "",
    activeSavedId: "",
    activeSavedName: "",
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function setStatus(msg, kind) {
    var el = $("ch-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "ch-status" + (kind ? " " + kind : "");
  }

  function friendlyNetworkMessage(err) {
    var msg = String((err && err.message) || err || "").trim();
    var low = msg.toLowerCase();
    if (
      low.indexOf("getaddrinfo") >= 0 ||
      low.indexOf("errno 11001") >= 0 ||
      low.indexOf("name or service not known") >= 0
    ) {
      return (
        "Could not reach the image API — your PC could not look up the server (DNS). " +
        "Check Wi‑Fi/internet, turn off VPN, then try again. " +
        "If you use WOMBO mode, switch to start_server.bat with an xAI key."
      );
    }
    if (
      low.indexOf("image url must either") >= 0 ||
      low.indexOf("base64-encoded image") >= 0 ||
      low.indexOf("reference image could not be prepared") >= 0
    ) {
      return (
        "Reference image could not be sent to the image API. " +
        "Click Generate for a fresh turnaround, or Regenerate after the sheet appears."
      );
    }
    return msg || "Could not generate turnaround.";
  }

  function normalizeRefUrl(url) {
    var raw = String(url || "").trim();
    if (!raw || raw.indexOf("data:") === 0) return raw;
    try {
      var u = new URL(raw, window.location.href);
      if (
        u.origin === window.location.origin ||
        u.hostname === "localhost" ||
        u.hostname === "127.0.0.1"
      ) {
        return u.pathname + (u.search || "");
      }
      return u.href;
    } catch (e) {
      if (raw.indexOf("://") < 0) {
        return raw.charAt(0) === "/" ? raw : "/" + raw.replace(/^\/+/, "");
      }
      return raw;
    }
  }

  function defaultDraft() {
    return {
      prompt: "",
      archetype: "human",
      sliders: { head: 1, body: 1, limbs: 1 },
      colors: { skin: "#e8b896", hair: "#3d2914", eyes: "#2a5a8a", clothes: "#4a6fa5" },
      spells: [],
      spell_palette: [],
      shirt_pattern: "solid",
      aura_style: "none",
      art_style: "stencil",
      continuity_id: "",
    };
  }

  function currentDraft() {
    if (!state.draft) state.draft = defaultDraft();
    return state.draft;
  }

  function wantsSwarm(prompt) {
    return /\b(swarm|swarms|crowd|crowds|army|armies|horde|hordes|flock|flocks|pack of|many|multiple|group of|groups of|dozens|legion|legions|battalion|mob|mobs)\b/i.test(
      String(prompt || "")
    );
  }

  function detectArchetype(prompt) {
    var p = String(prompt || "").toLowerCase();
    if (/spider|arachnid|tarantula|scorpion/.test(p) && !/spider-?man|spiderman|superhero|comic hero|marvel|costume hero/.test(p)) {
      return "spider";
    }
    if (/giraffe/.test(p)) return "giraffe";
    if (/croc|alligator|gator|reptile/.test(p)) return "crocodile";
    if (/bird|eagle|owl|parrot|crow/.test(p)) return "bird";
    if (/cat|kitten|feline|lion|tiger/.test(p)) return "cat";
    if (/dog|puppy|wolf|canine/.test(p)) return "dog";
    if (/insect|bug|beetle|mantis|ant\b|bee|wasp|butterfly|moth/.test(p)) return "insect";
    return "human";
  }

  function markDirty() {
    state.dirty = true;
    var hint = $("ch-save-hint");
    if (hint) hint.textContent = "Unsaved changes — press Save character when ready.";
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

  function parseApiResponse(res) {
    if (window.parseGalleryApiResponse) return window.parseGalleryApiResponse(res);
    return res.json();
  }

  function normalizeItem(item) {
    item = item || {};
    if (!item.lod1Num && item.url) {
      var m = String(item.url).match(/\/generated\/(\d+)\.[a-z]+/i);
      if (m) item.lod1Num = parseInt(m[1], 10);
    }
    return {
      url: item.url || "",
      label: item.label || "",
      paintingNum: item.paintingNum || null,
      lod1Num: item.lod1Num || null,
      source: item.source || "",
    };
  }

  function maxAppliedSpells() {
    if (state.poolReady && state.pool.length) return state.pool.length;
    return TRAY_SLICE;
  }

  function paintingNumsFromSpells(spells) {
    var nums = [];
    (spells || []).forEach(function (s) {
      var n = typeof s === "number" ? s : s && s.paintingNum;
      if (n && nums.indexOf(n) < 0) nums.push(n);
    });
    return nums.sort(function (a, b) {
      return a - b;
    });
  }

  function syncSlidersToUi() {
    var d = currentDraft();
    ["head", "body", "limbs"].forEach(function (key) {
      var el = $("ch-slider-" + key);
      var val = $("ch-val-" + key);
      if (el) el.value = d.sliders[key];
      if (val) val.textContent = Number(d.sliders[key]).toFixed(2);
    });
  }

  function syncColorsToUi() {
    var d = currentDraft();
    ["skin", "hair", "eyes", "clothes"].forEach(function (key) {
      var el = $("ch-color-" + key);
      if (el) el.value = d.colors[key];
    });
  }

  function readUiToDraft() {
    var d = currentDraft();
    var promptEl = $("ch-prompt");
    d.prompt = promptEl && promptEl.value ? promptEl.value.trim() : "";
    d.archetype = detectArchetype(d.prompt);
    ["head", "body", "limbs"].forEach(function (key) {
      var el = $("ch-slider-" + key);
      if (el) d.sliders[key] = parseFloat(el.value) || 1;
    });
    ["skin", "hair", "eyes", "clothes"].forEach(function (key) {
      var el = $("ch-color-" + key);
      if (el) d.colors[key] = el.value;
    });
    var aura = $("ch-aura-style");
    var shirt = $("ch-shirt-pattern");
    var art = $("ch-art-style");
    if (aura) d.aura_style = aura.value;
    if (shirt) d.shirt_pattern = shirt.value;
    if (art) d.art_style = art.value;
    d.spells = state.appliedSpells.slice();
  }

  function buildTurnaroundStasis(draft) {
    draft = draft || currentDraft();
    var lines = [
      "CHARACTER TURNAROUND GRID — " + (draft.archetype || "human") + " archetype.",
      "Proportions — head scale " + draft.sliders.head + ", body " + draft.sliders.body + ", limbs " + draft.sliders.limbs + ".",
      "Locked colors — skin " + draft.colors.skin + ", hair " + draft.colors.hair + ", eyes " + draft.colors.eyes + ", clothes " + draft.colors.clothes + ".",
      "Shirt pattern: " + draft.shirt_pattern + " · aura: " + draft.aura_style + " · style: " + draft.art_style + " stencil.",
      "ONE composite image — " +
        state.panRows +
        " rows × " +
        state.frameCount +
        " columns = full perspective reference (no animation slicing).",
      "Row 1 TOP: upper pan — camera elevated ~25° looking down, height perspective.",
      "Row 2 MIDDLE: eye-level — neutral horizon, standard 360° Z-axis turns.",
      "Row 3 BOTTOM: lower pan — camera low ~20° looking up, height perspective.",
      "Columns left-to-right: front, 3/4 right, right profile, 3/4 back-right, back, 3/4 back-left, left profile, 3/4 left.",
      "FULL subject in every cell — entire body visible, 3D object with height/width/depth/girth.",
      wantsSwarm(draft.prompt)
        ? "Multi-subject swarm requested."
        : "SINGLE SUBJECT ONLY — one character repeated across all cells.",
    ];
    if (draft.prompt) lines.push("Subject: " + draft.prompt);
    if (draft.archetype === "spider") {
      lines.push("Arachnid insect creature — NOT Spider-Man or superhero costume.");
    }
    if (draft.spell_palette && draft.spell_palette.length) {
      lines.push("Spell palette: " + draft.spell_palette.slice(0, 10).join(", "));
    }
    (state.appliedSpells || []).forEach(function (s) {
      if (s.label) lines.push("Equipped spell: " + s.label);
      if (s.paintingNum) lines.push("Spell painting #" + s.paintingNum);
    });
    if (state.continuityId) {
      lines.push("Continuity ID: " + state.continuityId);
    }
    return lines.join("\n");
  }

  function buildBuzzWords(draft) {
    draft = draft || currentDraft();
    var buzz = [
      draft.art_style + " stencil",
      draft.shirt_pattern,
      draft.aura_style !== "none" ? draft.aura_style + " aura" : "",
      "turnaround reference grid",
      "upper pan lower pan",
      "height perspective",
      "360 degree rotation sheet",
    ];
    (draft.spell_palette || []).slice(0, 6).forEach(function (c) {
      buzz.push(c);
    });
    return buzz.filter(Boolean);
  }

  function pollImageJob(jobId, attemptsLeft) {
    if (attemptsLeft == null) attemptsLeft = 80;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Character generation timed out."));
    return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), {}, 25000)
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (job) {
        setStatus("Painting turnaround grid… (" + (job.status || "working") + ")", "pending");
        if (job.status === "done") {
          var img = job.image || (job.images && job.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        }
        if (job.status === "failed") {
          throw new Error(
            friendlyNetworkMessage((job.error && job.error.message) || "Generation failed.")
          );
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, POLL_INTERVAL_MS);
        }).then(function () {
          return pollImageJob(jobId, attemptsLeft - 1);
        });
      });
  }

  function beginGenerate() {
    state.generating = true;
    var stage = $("ch-sheet-stage");
    if (stage) stage.classList.add("ch-generating");
    document.querySelectorAll(".ch-btn, .ch-spell").forEach(function (el) {
      el.disabled = true;
    });
  }

  function endGenerate() {
    state.generating = false;
    var stage = $("ch-sheet-stage");
    if (stage) stage.classList.remove("ch-generating");
    document.querySelectorAll(".ch-btn, .ch-spell").forEach(function (el) {
      el.disabled = false;
    });
  }

  function showTurnaroundSheet(url) {
    state.sheetUrl = url || "";
    state.currentImageUrl = url || "";
    var img = $("ch-turnaround-sheet");
    var empty = $("ch-character-empty");
    var legend = $("ch-sheet-legend");
    if (img) {
      if (url) {
        img.src = url;
        img.hidden = false;
      } else {
        img.removeAttribute("src");
        img.hidden = true;
      }
    }
    if (empty) empty.hidden = !!url;
    if (legend) legend.hidden = !url;
  }

  function applyTurnaroundSheet(sheetUrl) {
    showTurnaroundSheet(sheetUrl);
    markDirty();
    setStatus(
      "Turnaround grid ready — scroll to see all " +
        state.frameCount +
        " turns × upper / eye / lower pan.",
      "ok"
    );
    return Promise.resolve();
  }

  function generateTurnaround(options) {
    options = options || {};
    if (state.generating) return Promise.resolve();
    readUiToDraft();
    var draft = currentDraft();
    if (!draft.prompt && !options.refine) {
      setStatus("Describe your character first.", "error");
      return Promise.resolve();
    }

    var nums = paintingNumsFromSpells(state.appliedSpells);
    var spellCast = !!options.spellCast;
    var spellRef = options.spellReference || "";
    var refine = spellCast || !!options.refine;
    var refUrl = normalizeRefUrl(
      spellCast ? spellRef : options.referenceUrl || state.sheetUrl || ""
    );
    if (refine && !refUrl) refine = false;

    if (!state.continuityId) {
      state.continuityId = "ch-draft-" + Date.now();
      draft.continuity_id = state.continuityId;
    }

    beginGenerate();
    setStatus(
      refine ? "Regenerating full turnaround grid…" : "Painting full turnaround grid…",
      "pending"
    );

    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "ch-" + Date.now();

    var body = {
      job_id: jobId,
      stasis: buildTurnaroundStasis(draft),
      buzz_words: buildBuzzWords(draft),
      spells: nums,
      character_mode: true,
      turnaround_sheet: true,
      frame_count: state.frameCount,
      pan_rows: state.panRows,
      aspect_ratio: "3:2",
      mag_fresh: !refine,
      refine: refine,
      spell_cast: spellCast,
      spell_reference_image: spellCast ? spellRef : "",
      reference_image: refine ? refUrl : "",
      prompt: draft.prompt,
    };

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
        return parseApiResponse(r).then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Generate failed");
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        });
      })
      .then(applyTurnaroundSheet)
      .catch(function (err) {
        setStatus(friendlyNetworkMessage(err), "error");
      })
      .finally(endGenerate);
  }

  function loadImagePool() {
    if (state.poolReady) return Promise.resolve(state.pool);
    return Promise.all([
      window.loadGalleryData ? window.loadGalleryData() : Promise.resolve({ manifest: [] }),
    ])
      .then(function (results) {
        var manifest =
          (results[0] && results[0].manifest) ||
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
            return Promise.all(
              folders.map(function (fid) {
                return fetchWithTimeout(
                  apiUrl("/api/acquired-images?folder=" + encodeURIComponent(fid)),
                  { cache: "no-store" }
                )
                  .then(function (r) {
                    return r.ok ? parseApiResponse(r) : null;
                  })
                  .then(function (d) {
                    if (!d || !d.files) return [];
                    return d.files.map(function (f) {
                      return normalizeItem({ url: f.url, label: f.name || fid, source: fid });
                    });
                  })
                  .catch(function () {
                    return [];
                  });
              })
            ).then(function (chunks) {
              chunks.forEach(function (list) {
                pool = pool.concat(list);
              });
              var seen = {};
              state.pool = pool.filter(function (item) {
                if (!item.url || seen[item.url]) return false;
                seen[item.url] = true;
                return true;
              });
              state.poolReady = true;
              return state.pool;
            });
          });
      })
      .catch(function () {
        return [];
      });
  }

  function fillTrayRandom() {
    var copy = state.pool.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    state.trayItems = copy.slice(0, Math.min(TRAY_SLICE, copy.length));
  }

  function renderTray() {
    var strip = $("ch-spell-strip");
    if (!strip) return;
    strip.innerHTML = "";
    state.trayItems.forEach(function (item, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ch-spell";
      btn.dataset.idx = String(idx);
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.label;
      img.loading = "lazy";
      btn.appendChild(img);
      var lbl = document.createElement("span");
      lbl.className = "ch-spell-label";
      lbl.textContent = item.label;
      btn.appendChild(lbl);
      strip.appendChild(btn);
    });
    var count = $("ch-tray-count");
    if (count) count.textContent = state.trayItems.length + " shown · " + state.pool.length + " in library";
  }

  function renderAppliedSpells() {
    var row = $("ch-applied-spells");
    var heading = $("ch-applied-heading");
    if (heading) {
      var cap = maxAppliedSpells();
      heading.textContent = state.appliedSpells.length
        ? "Active spells (" + state.appliedSpells.length + "/" + cap + ")"
        : "Active spells (0/" + cap + ")";
    }
    if (!row) return;
    row.innerHTML = "";
    if (!state.appliedSpells.length) {
      row.innerHTML = '<span class="ch-applied-empty">Drag spells onto the sheet — stack up to ' + maxAppliedSpells() + ".</span>";
      return;
    }
    state.appliedSpells.forEach(function (item, idx) {
      var chip = document.createElement("span");
      chip.className = "ch-applied-chip";
      chip.textContent = item.label || "Spell";
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "ch-applied-rm";
      rm.textContent = "×";
      rm.dataset.idx = String(idx);
      chip.appendChild(rm);
      row.appendChild(chip);
    });
  }

  function extractPaletteFromImage(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        var canvas = document.createElement("canvas");
        canvas.width = 48;
        canvas.height = 48;
        var ctx = canvas.getContext("2d");
        if (!ctx) return resolve([]);
        ctx.drawImage(img, 0, 0, 48, 48);
        var data = ctx.getImageData(0, 0, 48, 48).data;
        var buckets = {};
        for (var i = 0; i < data.length; i += 16) {
          var key =
            Math.round(data[i] / 32) * 32 +
            "," +
            Math.round(data[i + 1] / 32) * 32 +
            "," +
            Math.round(data[i + 2] / 32) * 32;
          buckets[key] = (buckets[key] || 0) + 1;
        }
        resolve(
          Object.keys(buckets)
            .sort(function (a, b) {
              return buckets[b] - buckets[a];
            })
            .slice(0, 8)
            .map(function (k) {
              var p = k.split(",");
              return (
                "#" +
                ((1 << 24) + (+p[0] << 16) + (+p[1] << 8) + +p[2]).toString(16).slice(1)
              );
            })
        );
      };
      img.onerror = function () {
        resolve([]);
      };
      img.src = url;
    });
  }

  function applySpell(item) {
    if (state.generating) return;
    item = normalizeItem(item);
    if (!item.url) return;
    var exists = state.appliedSpells.some(function (s) {
      return s.url === item.url;
    });
    if (exists) {
      setStatus("That spell is already equipped.", "error");
      return;
    }
    var cap = maxAppliedSpells();
    if (state.appliedSpells.length >= cap) {
      setStatus("Max spells equipped (" + cap + "). Remove one to add another.", "error");
      return;
    }
    state.appliedSpells.push(item);
    renderAppliedSpells();
    extractPaletteFromImage(item.url).then(function (palette) {
      var draft = currentDraft();
      if (palette.length) {
        draft.spell_palette = palette;
        if (palette[0]) draft.colors.clothes = palette[0];
        if (palette[1]) draft.colors.hair = palette[1];
        draft.shirt_pattern = "spell-weave";
        draft.aura_style = "painterly";
        syncColorsToUi();
        var shirt = $("ch-shirt-pattern");
        var aura = $("ch-aura-style");
        if (shirt) shirt.value = "spell-weave";
        if (aura) aura.value = "painterly";
      }
      draft.spells = state.appliedSpells.slice();
      markDirty();
      setStatus(
        "Spell " +
          state.appliedSpells.length +
          "/" +
          cap +
          " equipped — regenerating full turnaround grid…",
        "ok"
      );
      generateTurnaround({
        spellCast: true,
        spellReference: item.url,
        refine: true,
      });
    });
  }

  function loadSavedCharacters() {
    return fetchWithTimeout(apiUrl("/api/characters"), { cache: "no-store" })
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (d) {
        state.saved = (d && d.characters) || [];
        renderSavedLibrary();
        return state.saved;
      })
      .catch(function () {
        state.saved = [];
        renderSavedLibrary();
        return [];
      });
  }

  function renderSavedLibrary() {
    var lib = $("ch-saved-list");
    if (!lib) return;
    lib.innerHTML = "";
    if (!state.saved.length) {
      lib.innerHTML = '<p class="ch-saved-empty">No saved characters — build &amp; Save deliberately.</p>';
      return;
    }
    state.saved.forEach(function (ch) {
      var card = document.createElement("div");
      card.className = "ch-saved-card";
      card.dataset.id = ch.id;
      if (ch.preview_url) {
        var img = document.createElement("img");
        img.src = ch.preview_url;
        img.alt = ch.name;
        card.appendChild(img);
      }
      var meta = document.createElement("div");
      meta.className = "ch-saved-meta";
      meta.innerHTML =
        '<span class="ch-version">#' + (ch.version || 1) + "</span>" +
        "<strong>" + (ch.name || "Character") + "</strong><span>" + (ch.archetype || "") + "</span>";
      card.appendChild(meta);
      var actions = document.createElement("div");
      actions.className = "ch-saved-actions";
      ["Load", "Remove"].forEach(function (label) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "ch-btn";
        b.textContent = label;
        b.dataset.action = label.toLowerCase();
        actions.appendChild(b);
      });
      card.appendChild(actions);
      lib.appendChild(card);
    });
  }

  function capturePreviewDataUrl() {
    var sheet = $("ch-turnaround-sheet");
    if (!sheet || sheet.hidden || !sheet.naturalWidth) return "";
    try {
      var cols = state.frameCount || FRAME_COUNT;
      var rows = state.panRows || PAN_ROWS;
      var cellW = Math.floor(sheet.naturalWidth / cols);
      var cellH = Math.floor(sheet.naturalHeight / rows);
      if (cellW < 1 || cellH < 1) return "";
      var maxDim = 128;
      var scale = Math.min(1, maxDim / Math.max(cellW, cellH));
      var outW = Math.max(1, Math.round(cellW * scale));
      var outH = Math.max(1, Math.round(cellH * scale));
      var canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      var ctx = canvas.getContext("2d");
      if (!ctx) return "";
      ctx.drawImage(sheet, 0, cellH, cellW, cellH, 0, 0, outW, outH);
      return canvas.toDataURL("image/jpeg", 0.72);
    } catch (e) {
      return "";
    }
  }

  function saveCharacter() {
    readUiToDraft();
    var nameEl = $("ch-save-name");
    var name =
      (nameEl && nameEl.value ? nameEl.value.trim() : "") || state.activeSavedName || "";
    if (!name) {
      setStatus("Enter a name before saving.", "error");
      return;
    }
    var draft = currentDraft();
    if (!draft.prompt || !state.sheetUrl) {
      setStatus("Generate a turnaround sheet first.", "error");
      return;
    }
    var preview = capturePreviewDataUrl();
    setStatus("Saving character…", "pending");
    fetchWithTimeout(apiUrl("/api/characters"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: state.activeSavedId || undefined,
        name: name,
        prompt: draft.prompt,
        archetype: draft.archetype,
        sliders: draft.sliders,
        colors: draft.colors,
        spells: paintingNumsFromSpells(draft.spells),
        spell_palette: (draft.spell_palette || []).slice(0, 6),
        shirt_pattern: draft.shirt_pattern,
        aura_style: draft.aura_style,
        art_style: draft.art_style,
        sheet_url: state.sheetUrl,
        frame_count: state.frameCount,
        pan_rows: state.panRows,
        continuity_id: state.continuityId || state.activeSavedId || "ch-" + Date.now(),
        preview_png: preview.indexOf("data:") === 0 ? preview : "",
      }),
    })
      .then(function (r) {
        return parseApiResponse(r).then(function (d) {
          if (!r.ok || !d.ok) throw new Error((d && d.error) || "Save failed.");
          return d.character;
        });
      })
      .then(function (ch) {
        state.dirty = false;
        if (ch && ch.id) {
          state.activeSavedId = ch.id;
          state.activeSavedName = ch.name || name;
        }
        if (nameEl) nameEl.value = "";
        $("ch-save-hint").textContent =
          "Saved #" + (ch && ch.version ? ch.version : "?") + " — cast in Animate.";
        if (ch.preview_warning) {
          setStatus(
            "Saved “" + ch.name + "” #" + (ch.version || "?") + " (no thumbnail — " + ch.preview_warning + ")",
            "ok"
          );
        } else {
          setStatus("Saved “" + ch.name + "” #" + (ch.version || "?") + ".", "ok");
        }
        return loadSavedCharacters();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not save.", "error");
      });
  }

  function removeCharacter(id) {
    if (!id || !window.confirm("Remove this saved character?")) return;
    fetchWithTimeout(apiUrl("/api/characters/remove"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id }),
    })
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || "Remove failed.");
        setStatus("Character removed.", "ok");
        loadSavedCharacters();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not remove.", "error");
      });
  }

  function loadCharacterIntoEditor(ch) {
    state.activeSavedId = ch.id || "";
    state.activeSavedName = ch.name || "";
    state.draft = {
      prompt: ch.prompt || "",
      archetype: ch.archetype || "human",
      sliders: ch.sliders || { head: 1, body: 1, limbs: 1 },
      colors: ch.colors || defaultDraft().colors,
      spells: ch.spells || [],
      spell_palette: ch.spell_palette || [],
      shirt_pattern: ch.shirt_pattern || "solid",
      aura_style: ch.aura_style || "none",
      art_style: ch.art_style || "stencil",
      continuity_id: ch.continuity_id || ch.id,
    };
    state.appliedSpells = (ch.spells || []).map(function (s) {
      if (typeof s === "number") return normalizeItem({ paintingNum: s });
      return normalizeItem(s);
    });
    state.continuityId = ch.continuity_id || ch.id;
    state.frameCount = ch.frame_count || FRAME_COUNT;
    state.panRows = ch.pan_rows || PAN_ROWS;
    state.dirty = false;
    $("ch-prompt").value = state.draft.prompt;
    syncSlidersToUi();
    syncColorsToUi();
    $("ch-aura-style").value = state.draft.aura_style;
    $("ch-shirt-pattern").value = state.draft.shirt_pattern;
    $("ch-art-style").value = state.draft.art_style;
    renderAppliedSpells();
    if (ch.sheet_url) {
      applyTurnaroundSheet(ch.sheet_url);
      setStatus("Loaded “" + (ch.name || "character") + "”.", "ok");
      return;
    }
    showTurnaroundSheet(ch.preview_url || ch.image_url || "");
    setStatus("Loaded “" + (ch.name || "character") + "” (legacy).", "ok");
  }

  function createGhost(item, x, y) {
    var ghost = document.createElement("div");
    ghost.className = "ch-drag-ghost";
    var img = document.createElement("img");
    img.src = item.url;
    ghost.appendChild(img);
    document.body.appendChild(ghost);
    ghost.style.left = x + "px";
    ghost.style.top = y + "px";
    return ghost;
  }

  function onPointerDown(e) {
    if (state.generating) return;
    var spell = e.target.closest(".ch-spell");
    if (!spell) return;
    var item = normalizeItem(state.trayItems[parseInt(spell.dataset.idx, 10)]);
    if (!item.url) return;
    e.preventDefault();
    spell.setPointerCapture(e.pointerId);
    state.drag = {
      item: item,
      ghost: createGhost(item, e.clientX, e.clientY),
      startY: e.clientY,
      pointerId: e.pointerId,
      moved: false,
    };
    var stage = $("ch-sheet-stage");
    if (stage) stage.classList.add("ch-drop-active");
  }

  function onPointerUp(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    var drag = state.drag;
    var dy = drag.startY - e.clientY;
    var stage = $("ch-sheet-stage");
    var rect = stage ? stage.getBoundingClientRect() : null;
    var over =
      rect &&
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    if (drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    if (stage) stage.classList.remove("ch-drop-active");
    if (over && (dy >= DRAG_UP_THRESHOLD || !drag.moved)) applySpell(drag.item);
    state.drag = null;
  }

  function onPointerMove(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    state.drag.moved = true;
    state.drag.ghost.style.left = e.clientX + "px";
    state.drag.ghost.style.top = e.clientY + "px";
  }

  function bindUi() {
    $("ch-generate").addEventListener("click", function () {
      state.sheetUrl = "";
      state.activeSavedId = "";
      state.activeSavedName = "";
      showTurnaroundSheet("");
      generateTurnaround();
    });

    ["head", "body", "limbs"].forEach(function (key) {
      var el = $("ch-slider-" + key);
      if (!el) return;
      el.addEventListener("input", function () {
        readUiToDraft();
        $("ch-val-" + key).textContent = Number(el.value).toFixed(2);
        markDirty();
      });
    });

    ["skin", "hair", "eyes", "clothes"].forEach(function (key) {
      var el = $("ch-color-" + key);
      if (el)
        el.addEventListener("input", function () {
          readUiToDraft();
          markDirty();
        });
    });

    ["ch-aura-style", "ch-shirt-pattern", "ch-art-style", "ch-prompt"].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener("change", markDirty);
    });

    var strip = $("ch-spell-strip");
    strip.addEventListener("pointerdown", onPointerDown);
    strip.addEventListener("pointermove", onPointerMove);
    strip.addEventListener("pointerup", onPointerUp);
    strip.addEventListener("pointercancel", onPointerUp);

    $("ch-applied-spells").addEventListener("click", function (e) {
      var btn = e.target.closest(".ch-applied-rm");
      if (!btn) return;
      state.appliedSpells.splice(parseInt(btn.dataset.idx, 10), 1);
      readUiToDraft();
      renderAppliedSpells();
      markDirty();
    });

    $("ch-save-btn").addEventListener("click", saveCharacter);
    $("ch-saved-list").addEventListener("click", function (e) {
      var card = e.target.closest(".ch-saved-card");
      var btn = e.target.closest("button");
      if (!card || !btn) return;
      var ch = state.saved.find(function (c) {
        return c.id === card.dataset.id;
      });
      if (btn.dataset.action === "remove") removeCharacter(card.dataset.id);
      else if (btn.dataset.action === "load" && ch) loadCharacterIntoEditor(ch);
    });
    $("ch-randomize").addEventListener("click", function () {
      fillTrayRandom();
      renderTray();
    });
    $("ch-regen-view").addEventListener("click", function () {
      generateTurnaround({
        refine: !!state.sheetUrl,
        referenceUrl: state.sheetUrl,
      });
    });
  }

  function onShow() {
    loadImagePool().then(function () {
      if (!state.trayItems.length) {
        fillTrayRandom();
        renderTray();
      }
      renderAppliedSpells();
    });
    loadSavedCharacters();
  }

  function boot() {
    if (!$("panel-characters")) return;
    state.draft = defaultDraft();
    syncSlidersToUi();
    syncColorsToUi();
    bindUi();
    renderAppliedSpells();
    setStatus("Describe a character — one image with 8 turns + upper & lower pan rows.", "ok");
    window.dispatchEvent(new Event("characters-ready"));
  }

  window.Characters = {
    onShow: onShow,
    listSaved: function () {
      return state.saved.slice();
    },
    getSaved: function () {
      return state.saved.slice();
    },
  };

  window.addEventListener("characters-show", onShow);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();