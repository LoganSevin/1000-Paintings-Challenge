/**
 * Objects — inanimate items only (never people/creatures). Save & @tag in Animate.
 */
(function () {
  "use strict";

  var TRAY_SLICE = 36;
  var DRAG_UP_THRESHOLD = 40;
  var FETCH_TIMEOUT_MS = 90000;
  var POLL_INTERVAL_MS = 900;
  var FIRST_POLL_DELAY_MS = 450;
  var FETCH_RETRIES = 2;
  var OBJECT_ASPECT = "16:9";

  var state = {
    pool: [],
    poolReady: false,
    trayItems: [],
    appliedSpells: [],
    saved: [],
    draft: null,
    dirty: false,
    generating: false,
    imageUrl: "",
    continuityId: "",
    activeSavedId: "",
    activeSavedName: "",
    drag: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function setStatus(msg, kind) {
    var el = $("ob-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "st-status" + (kind ? " " + kind : "");
  }

  function defaultDraft() {
    return {
      prompt: "",
      material: "mixed",
      scale: "handheld",
      colors: { primary: "#8a7a5a", accent: "#c9a227" },
      spells: [],
      spell_palette: [],
      art_style: "stencil",
      continuity_id: "",
    };
  }

  function currentDraft() {
    if (!state.draft) state.draft = defaultDraft();
    return state.draft;
  }

  function isRetryableFetchError(err) {
    var msg = String((err && err.message) || err || "").toLowerCase();
    return (
      msg.indexOf("failed to fetch") >= 0 ||
      msg.indexOf("networkerror") >= 0 ||
      msg.indexOf("load failed") >= 0 ||
      msg.indexOf("connection") >= 0
    );
  }

  function friendlyNetworkMessage(err) {
    var msg = String((err && err.message) || err || "").trim();
    var low = msg.toLowerCase();
    if (low.indexOf("failed to fetch") >= 0 || low.indexOf("networkerror") >= 0) {
      return "Connection hiccup — the server may still be painting. Wait a moment, then try again.";
    }
    if (
      low.indexOf("getaddrinfo") >= 0 ||
      low.indexOf("errno 11001") >= 0 ||
      low.indexOf("name or service not known") >= 0
    ) {
      return (
        "Could not reach the image API — check Wi‑Fi/internet and that start_server.bat is running."
      );
    }
    return msg || "Could not generate object.";
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

  function fetchWithRetry(url, options, ms, retriesLeft) {
    if (retriesLeft == null) retriesLeft = FETCH_RETRIES;
    return fetchWithTimeout(url, options, ms).catch(function (err) {
      if (retriesLeft > 0 && isRetryableFetchError(err)) {
        return new Promise(function (resolve) {
          setTimeout(resolve, 500 + (FETCH_RETRIES - retriesLeft) * 400);
        }).then(function () {
          return fetchWithRetry(url, options, ms, retriesLeft - 1);
        });
      }
      throw err;
    });
  }

  function warmApiConnection() {
    return fetchWithRetry(apiUrl("/api/health"), { cache: "no-store" }, 8000, 1).catch(
      function () {
        return null;
      }
    );
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
    if (state.poolReady && state.pool.length) return Math.min(state.pool.length, 24);
    return TRAY_SLICE;
  }

  function renderAppliedSpells() {
    var row = $("ob-applied-spells");
    var heading = $("ob-applied-heading");
    if (heading) {
      var cap = maxAppliedSpells();
      heading.textContent = state.appliedSpells.length
        ? "Active spells (" + state.appliedSpells.length + "/" + cap + ")"
        : "Active spells (drag onto preview)";
    }
    if (!row) return;
    row.innerHTML = "";
    if (!state.appliedSpells.length) {
      row.innerHTML =
        '<span class="ob-applied-empty">Drag spells onto the object preview to imbue style.</span>';
      return;
    }
    state.appliedSpells.forEach(function (item, idx) {
      var chip = document.createElement("span");
      chip.className = "ob-applied-chip";
      chip.textContent = item.label || "Spell";
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "ob-applied-rm";
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

  function paintingNumsFromSpells(spells) {
    var nums = [];
    (spells || []).forEach(function (s) {
      if (s.paintingNum && nums.indexOf(s.paintingNum) < 0) nums.push(s.paintingNum);
    });
    return nums.sort(function (a, b) {
      return a - b;
    });
  }

  function buildObjectCraftHints(draft) {
    return [
      "Material: " + (draft.material || "mixed"),
      "Scale: " + (draft.scale || "handheld"),
      "Line/colors: " + (draft.art_style || "stencil") + ", " + draft.colors.primary + ", " + draft.colors.accent,
    ].join("\n");
  }

  function buildBuzzWords(draft) {
    var buzz = [draft.material, draft.art_style, "crisp edges", "surface texture"];
    (draft.spell_palette || []).slice(0, 6).forEach(function (c) {
      buzz.push(c);
    });
    return buzz.filter(Boolean);
  }

  function pollImageJob(jobId, attemptsLeft, firstPoll) {
    if (attemptsLeft == null) attemptsLeft = 80;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Object generation timed out."));
    var pollOnce = function () {
      return fetchWithRetry(apiUrl("/api/jobs/" + jobId), { cache: "no-store" }, 25000);
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
        setStatus("Painting object… (" + (job.status || "working") + ")", "pending");
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

  function showPreview(url) {
    var empty = $("ob-empty");
    var img = $("ob-preview");
    if (!img) return;
    if (!url) {
      if (empty) empty.hidden = false;
      img.hidden = true;
      img.removeAttribute("src");
      var stageEmpty = $("ob-stage");
      if (stageEmpty) stageEmpty.classList.remove("st-has-preview");
      return;
    }
    if (empty) empty.hidden = true;
    img.src = url;
    img.alt = "Object preview";
    img.hidden = false;
    var stage = $("ob-stage");
    if (stage) stage.classList.add("st-has-preview");
  }

  function beginGenerate() {
    state.generating = true;
    var stage = $("ob-stage");
    if (stage) stage.classList.add("st-generating");
    document.querySelectorAll(".ob-btn, .ob-spell").forEach(function (el) {
      el.disabled = true;
    });
  }

  function endGenerate() {
    state.generating = false;
    var stage = $("ob-stage");
    if (stage) stage.classList.remove("st-generating");
    document.querySelectorAll(".ob-btn, .ob-spell").forEach(function (el) {
      el.disabled = false;
    });
  }

  function readUiToDraft() {
    var d = currentDraft();
    var p = $("ob-prompt");
    d.prompt = p && p.value ? p.value.trim() : "";
    var mat = $("ob-material");
    var scale = $("ob-scale");
    var art = $("ob-art-style");
    var c1 = $("ob-color-primary");
    var c2 = $("ob-color-accent");
    if (mat) d.material = mat.value;
    if (scale) d.scale = scale.value;
    if (art) d.art_style = art.value;
    if (c1) d.colors.primary = c1.value;
    if (c2) d.colors.accent = c2.value;
  }

  function generateObject(options) {
    options = options || {};
    if (state.generating) return Promise.resolve();
    readUiToDraft();
    var draft = currentDraft();
    if (!draft.prompt && !options.refine) {
      setStatus("Describe your object first.", "error");
      return Promise.resolve();
    }
    if (!state.continuityId) {
      state.continuityId = "obj-draft-" + Date.now();
      draft.continuity_id = state.continuityId;
    }
    beginGenerate();
    var spellCast = !!options.spellCast;
    var variation = !!options.variation;
    var refine = spellCast || (!!options.refine && !variation);
    setStatus(
      spellCast
        ? "Imbuing object with spell…"
        : variation
          ? "Painting new variation…"
          : refine
            ? "Refining object…"
            : "Painting object…",
      "pending"
    );
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "ob-" + Date.now();
    var objectRef = options.referenceUrl || state.imageUrl || "";
    var spellRef = spellCast ? options.spellReference || "" : "";
    var buzz = buildBuzzWords(draft);
    if (variation) buzz.push("fresh variation " + (Date.now() % 100000));
    return warmApiConnection().then(function () {
      return fetchWithRetry(
      apiUrl("/api/generate-stasis-vision"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          stasis: buildObjectCraftHints(draft),
          craft_hints: buildObjectCraftHints(draft),
          buzz_words: buzz,
          spells: paintingNumsFromSpells(state.appliedSpells),
          object_mode: true,
          aspect_ratio: OBJECT_ASPECT,
          mag_fresh: !refine,
          fresh_variation: variation,
          refine: refine,
          spell_cast: spellCast,
          spell_reference_image: spellRef,
          reference_image: refine ? objectRef : "",
          prompt: draft.prompt,
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
          if (!r.ok) throw new Error((d && d.error) || "Generate failed");
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        });
      })
      .then(function (url) {
        state.imageUrl = url;
        showPreview(url);
        setStatus("Object ready — save or drag spells to restyle.", "ok");
      })
      .catch(function (err) {
        setStatus(friendlyNetworkMessage(err), "error");
      })
      .finally(endGenerate);
  }

  function capturePreviewDataUrl() {
    var img = $("ob-preview");
    if (!img || img.hidden || !img.naturalWidth) return "";
    try {
      var canvas = document.createElement("canvas");
      var maxDim = 256;
      var scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      var ctx = canvas.getContext("2d");
      if (!ctx) return "";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.82);
    } catch (e) {
      return "";
    }
  }

  function saveObject() {
    readUiToDraft();
    var name =
      ($("ob-save-name") && $("ob-save-name").value.trim()) ||
      state.activeSavedName ||
      "";
    if (!name) {
      setStatus("Enter a name before saving.", "error");
      return;
    }
    if (!state.imageUrl) {
      setStatus("Generate an object first.", "error");
      return;
    }
    var draft = currentDraft();
    setStatus("Saving object…", "pending");
    fetchWithTimeout(apiUrl("/api/objects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: state.activeSavedId || undefined,
          name: name,
          prompt: draft.prompt,
          material: draft.material,
        scale: draft.scale,
        colors: draft.colors,
        spells: draft.spells,
        spell_palette: draft.spell_palette,
        art_style: draft.art_style,
        image_url: state.imageUrl,
        continuity_id: state.continuityId || state.activeSavedId || "obj-" + Date.now(),
        preview_png: capturePreviewDataUrl(),
      }),
    })
      .then(function (r) {
        return parseApiResponse(r).then(function (d) {
          if (!r.ok || !d.ok) throw new Error((d && d.error) || "Save failed.");
          return d.object;
        });
      })
      .then(function (obj) {
        if (obj && obj.id) {
          state.activeSavedId = obj.id;
          state.activeSavedName = obj.name || name;
        }
        $("ob-save-name").value = "";
        $("ob-save-hint").textContent =
          "Saved as #" + (obj && obj.version ? obj.version : "?") + " — @tag in Animate.";
        setStatus('Object "' + name + '" saved (#' + (obj && obj.version ? obj.version : "?") + ").", "ok");
        return loadSavedObjects();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not save.", "error");
      });
  }

  function loadSavedObjects() {
    return fetchWithTimeout(apiUrl("/api/objects"), { cache: "no-store" })
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (d) {
        state.saved = (d && d.objects) || [];
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
    var lib = $("ob-saved-list");
    if (!lib) return;
    lib.innerHTML = "";
    if (!state.saved.length) {
      lib.innerHTML = '<p class="st-saved-empty">No saved objects yet.</p>';
      return;
    }
    state.saved.forEach(function (obj) {
      var card = document.createElement("div");
      card.className = "st-saved-card";
      card.dataset.id = obj.id;
      if (obj.preview_url) {
        var img = document.createElement("img");
        img.src = obj.preview_url;
        img.alt = obj.name;
        card.appendChild(img);
      }
      var meta = document.createElement("div");
      meta.className = "st-saved-meta";
      meta.innerHTML =
        '<span class="st-version">#' + (obj.version || 1) + "</span>" +
        "<strong>" + (obj.name || "Object") + "</strong><span>" + (obj.material || "") + "</span>";
      card.appendChild(meta);
      var actions = document.createElement("div");
      actions.className = "st-saved-actions";
      ["Load", "Remove"].forEach(function (label) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "st-btn";
        b.textContent = label;
        b.dataset.action = label.toLowerCase();
        actions.appendChild(b);
      });
      card.appendChild(actions);
      lib.appendChild(card);
    });
  }

  function loadObjectIntoEditor(obj) {
    state.activeSavedId = obj.id || "";
    state.activeSavedName = obj.name || "";
    state.draft = {
      prompt: obj.prompt || "",
      material: obj.material || "mixed",
      scale: obj.scale || "handheld",
      colors: obj.colors || defaultDraft().colors,
      spells: obj.spells || [],
      spell_palette: obj.spell_palette || [],
      art_style: obj.art_style || "stencil",
      continuity_id: obj.continuity_id || obj.id,
    };
    state.continuityId = obj.continuity_id || obj.id;
    state.imageUrl = obj.image_url || obj.preview_url || "";
    state.appliedSpells = (obj.spells || []).map(normalizeItem);
    renderAppliedSpells();
    $("ob-prompt").value = state.draft.prompt;
    $("ob-material").value = state.draft.material;
    $("ob-scale").value = state.draft.scale;
    $("ob-art-style").value = state.draft.art_style;
    $("ob-color-primary").value = state.draft.colors.primary;
    $("ob-color-accent").value = state.draft.colors.accent;
    showPreview(state.imageUrl);
    setStatus('Loaded "' + (obj.name || "object") + '".', "ok");
  }

  function loadImagePool() {
    if (state.poolReady) return Promise.resolve(state.pool);
    return Promise.all([
      window.loadGalleryData ? window.loadGalleryData() : Promise.resolve({ manifest: [] }),
    ])
      .then(function (results) {
        var manifest = (results[0] && results[0].manifest) || [];
        var pool = [];
        manifest.forEach(function (m) {
          pool.push(
            normalizeItem({
              url: window.getPaintingUrl ? window.getPaintingUrl(m.number) : "paintings/" + m.number + ".jpg",
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
              } else if (f.id) folders.push(f.id);
            });
            return Promise.all(
              folders.map(function (fid) {
                return fetchWithTimeout(apiUrl("/api/acquired-images?folder=" + fid), {
                  cache: "no-store",
                })
                  .then(function (r) {
                    return r.ok ? parseApiResponse(r) : { files: [] };
                  })
                  .then(function (data) {
                    (data.files || []).forEach(function (file) {
                      pool.push(normalizeItem({ url: file.url, label: file.name || "Spell", source: fid }));
                    });
                  });
              })
            ).then(function () {
              state.pool = pool;
              state.poolReady = true;
              return pool;
            });
          });
      });
  }

  function fillTrayRandom() {
    if (!state.pool.length) return;
    var copy = state.pool.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    state.trayItems = copy.slice(0, TRAY_SLICE);
  }

  function renderTray() {
    var strip = $("ob-spell-strip");
    var count = $("ob-tray-count");
    if (!strip) return;
    strip.innerHTML = "";
    state.trayItems.forEach(function (item, idx) {
      var el = document.createElement("div");
      el.className = "st-spell ob-spell";
      el.dataset.idx = String(idx);
      el.draggable = true;
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.label;
      el.appendChild(img);
      strip.appendChild(el);
    });
    if (count) count.textContent = state.trayItems.length + " shown · " + state.pool.length + " in library";
  }

  function applySpell(item) {
    if (state.generating) return;
    item = normalizeItem(item);
    if (!item.url) return;
    if (!state.imageUrl) {
      setStatus("Generate an object first, then drag spells onto it.", "error");
      return;
    }
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
        if (palette[0]) draft.colors.primary = palette[0];
        if (palette[1]) draft.colors.accent = palette[1];
        $("ob-color-primary").value = draft.colors.primary;
        $("ob-color-accent").value = draft.colors.accent;
      }
      draft.spells = state.appliedSpells.slice();
      setStatus(
        "Spell " + state.appliedSpells.length + "/" + cap + " — imbuing object…",
        "ok"
      );
      generateObject({
        spellCast: true,
        spellReference: item.url,
        refine: true,
        referenceUrl: state.imageUrl,
      });
    });
  }

  function createGhost(item, x, y) {
    var ghost = document.createElement("div");
    ghost.className = "ob-drag-ghost";
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
    var spell = e.target.closest(".ob-spell");
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
    var stage = $("ob-stage");
    if (stage) stage.classList.add("st-drop-active");
  }

  function onPointerUp(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    var drag = state.drag;
    var dy = drag.startY - e.clientY;
    var stage = $("ob-stage");
    var rect = stage ? stage.getBoundingClientRect() : null;
    var over =
      rect &&
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    if (drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    if (stage) stage.classList.remove("st-drop-active");
    if (over && (dy >= DRAG_UP_THRESHOLD || !drag.moved)) applySpell(drag.item);
    state.drag = null;
  }

  function onPointerMove(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    state.drag.moved = true;
    state.drag.ghost.style.left = e.clientX + "px";
    state.drag.ghost.style.top = e.clientY + "px";
  }

  function onPointerCancel(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    if (state.drag.ghost.parentNode) state.drag.ghost.parentNode.removeChild(state.drag.ghost);
    var stage = $("ob-stage");
    if (stage) stage.classList.remove("st-drop-active");
    state.drag = null;
  }

  function bindUi() {
    $("ob-generate").addEventListener("click", function () {
      state.imageUrl = "";
      state.activeSavedId = "";
      state.activeSavedName = "";
      showPreview("");
      generateObject();
    });
    $("ob-save-btn").addEventListener("click", saveObject);
    $("ob-saved-list").addEventListener("click", function (e) {
      var card = e.target.closest(".st-saved-card");
      var btn = e.target.closest("button");
      if (!card || !btn) return;
      var obj = state.saved.find(function (o) {
        return o.id === card.dataset.id;
      });
      if (btn.dataset.action === "remove") {
        if (!window.confirm("Remove this object?")) return;
        fetchWithTimeout(apiUrl("/api/objects/remove"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: card.dataset.id }),
        }).then(function () {
          loadSavedObjects();
        });
      } else if (btn.dataset.action === "load" && obj) loadObjectIntoEditor(obj);
    });
    $("ob-randomize").addEventListener("click", function () {
      fillTrayRandom();
      renderTray();
    });
    var strip = $("ob-spell-strip");
    if (strip) {
      strip.addEventListener("pointerdown", onPointerDown);
      strip.addEventListener("pointermove", onPointerMove);
      strip.addEventListener("pointerup", onPointerUp);
      strip.addEventListener("pointercancel", onPointerCancel);
    }
    var applied = $("ob-applied-spells");
    if (applied) {
      applied.addEventListener("click", function (e) {
        var btn = e.target.closest(".ob-applied-rm");
        if (!btn) return;
        state.appliedSpells.splice(parseInt(btn.dataset.idx, 10), 1);
        readUiToDraft();
        currentDraft().spells = state.appliedSpells.slice();
        renderAppliedSpells();
      });
    }
    $("ob-regen").addEventListener("click", function () {
      generateObject({ variation: true });
    });
  }

  function onShow() {
    warmApiConnection();
    loadImagePool().then(function () {
      if (!state.trayItems.length) {
        fillTrayRandom();
        renderTray();
      }
    });
    loadSavedObjects();
  }

  function boot() {
    if (!$("panel-objects")) return;
    state.draft = defaultDraft();
    bindUi();
    renderAppliedSpells();
    setStatus("Describe your object — generate, then drag spells onto the preview for color & texture.", "ok");
    window.dispatchEvent(new Event("objects-ready"));
  }

  window.Objects = {
    onShow: onShow,
    listSaved: function () {
      return state.saved.slice();
    },
  };
  window.addEventListener("objects-show", onShow);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();