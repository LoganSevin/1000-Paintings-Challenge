/**
 * Places — environments & scenes. Drag spells onto preview to reshape style.
 */
(function () {
  "use strict";

  var TRAY_SLICE = 36;
  var DRAG_UP_THRESHOLD = 40;
  var FETCH_TIMEOUT_MS = 90000;
  var POLL_INTERVAL_MS = 900;

  var state = {
    pool: [],
    poolReady: false,
    trayItems: [],
    appliedSpells: [],
    saved: [],
    draft: null,
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
    var el = $("rm-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "st-status" + (kind ? " " + kind : "");
  }

  function defaultDraft() {
    return {
      prompt: "",
      mood: "neutral",
      lighting: "natural",
      time_of_day: "day",
      spells: [],
      spell_palette: [],
      art_style: "painterly",
      continuity_id: "",
    };
  }

  function currentDraft() {
    if (!state.draft) state.draft = defaultDraft();
    return state.draft;
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
    return {
      url: item.url || "",
      label: item.label || "",
      paintingNum: item.paintingNum || null,
      source: item.source || "",
    };
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

  function maxAppliedSpells() {
    if (state.poolReady && state.pool.length) return Math.min(state.pool.length, 24);
    return TRAY_SLICE;
  }

  function renderAppliedSpells() {
    var row = $("rm-applied-spells");
    var heading = $("rm-applied-heading");
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
        '<span class="st-applied-empty">Drag spells onto the scene preview to reshape palette & atmosphere.</span>';
      return;
    }
    state.appliedSpells.forEach(function (item, idx) {
      var chip = document.createElement("span");
      chip.className = "st-applied-chip";
      chip.textContent = item.label || "Spell";
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "st-applied-rm";
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

  function buildRoomStasis(draft) {
    return [
      "ENVIRONMENT / PLACE — wide scene for characters to inhabit (not a portrait).",
      "Mood: " + draft.mood + " · Lighting: " + draft.lighting + " · Time: " + draft.time_of_day,
      "Style: " + draft.art_style + ". Spells strongly influence palette, architecture, and atmosphere.",
      draft.prompt || "Original painterly environment, 16:9 establishing view.",
    ].join("\n");
  }

  function buildBuzzWords(draft) {
    var buzz = [draft.mood, draft.lighting, draft.time_of_day, "environment", "establishing shot"];
    (draft.spell_palette || []).slice(0, 8).forEach(function (c) {
      buzz.push(c);
    });
    return buzz.filter(Boolean);
  }

  function pollImageJob(jobId, attemptsLeft) {
    if (attemptsLeft == null) attemptsLeft = 80;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Scene generation timed out."));
    return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), {}, 25000)
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (job) {
        setStatus("Painting scene… (" + (job.status || "working") + ")", "pending");
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
          return pollImageJob(jobId, attemptsLeft - 1);
        });
      });
  }

  function showPreview(url) {
    var empty = $("rm-empty");
    var img = $("rm-preview");
    if (!img) return;
    if (!url) {
      if (empty) empty.hidden = false;
      img.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    img.src = url;
    img.alt = "Room preview";
    img.hidden = false;
  }

  function beginGenerate() {
    state.generating = true;
    var stage = $("rm-stage");
    if (stage) stage.classList.add("st-generating");
    document.querySelectorAll(".rm-btn, .rm-spell").forEach(function (el) {
      el.disabled = true;
    });
  }

  function endGenerate() {
    state.generating = false;
    var stage = $("rm-stage");
    if (stage) stage.classList.remove("st-generating");
    document.querySelectorAll(".rm-btn, .rm-spell").forEach(function (el) {
      el.disabled = false;
    });
  }

  function readUiToDraft() {
    var d = currentDraft();
    var p = $("rm-prompt");
    d.prompt = p && p.value ? p.value.trim() : "";
    ["mood", "lighting", "time_of_day", "art_style"].forEach(function (key) {
      var el = $("rm-" + key.replace(/_/g, "-"));
      if (el) d[key] = el.value;
    });
    d.spells = state.appliedSpells.slice();
  }

  function generateRoom(options) {
    options = options || {};
    if (state.generating) return Promise.resolve();
    readUiToDraft();
    var draft = currentDraft();
    if (!draft.prompt && !options.refine) {
      setStatus("Describe your scene first.", "error");
      return Promise.resolve();
    }
    if (!state.continuityId) {
      state.continuityId = "room-draft-" + Date.now();
    }
    beginGenerate();
    var spellCast = !!options.spellCast;
    var variation = !!options.variation;
    var refine = spellCast || (!!options.refine && !variation);
    setStatus(
      spellCast
        ? "Reshaping place with spell…"
        : variation
          ? "Painting new variation…"
          : refine
            ? "Refining scene…"
            : "Painting environment…",
      "pending"
    );
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "rm-" + Date.now();
    var placeRef = options.referenceUrl || state.imageUrl || "";
    var spellRef = spellCast ? options.spellReference || "" : "";
    var buzz = buildBuzzWords(draft);
    if (variation) buzz.push("fresh variation " + (Date.now() % 100000));
    return fetchWithTimeout(
      apiUrl("/api/generate-stasis-vision"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          stasis: buildRoomStasis(draft),
          buzz_words: buzz,
          spells: paintingNumsFromSpells(state.appliedSpells),
          room_mode: true,
          aspect_ratio: "16:9",
          mag_fresh: !refine,
          fresh_variation: variation,
          refine: refine,
          spell_cast: spellCast,
          spell_reference_image: spellRef,
          reference_image: refine ? placeRef : "",
          prompt: draft.prompt,
          mood: draft.mood,
          lighting: draft.lighting,
          time_of_day: draft.time_of_day,
        }),
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
      .then(function (url) {
        state.imageUrl = url;
        showPreview(url);
        setStatus("Scene ready — save & set as Place in Animate.", "ok");
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not generate scene.", "error");
      })
      .finally(endGenerate);
  }

  function capturePreviewDataUrl() {
    var img = $("rm-preview");
    if (!img || img.hidden || !img.naturalWidth) return "";
    try {
      var canvas = document.createElement("canvas");
      var maxDim = 320;
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

  function saveRoom() {
    readUiToDraft();
    var name =
      ($("rm-save-name") && $("rm-save-name").value.trim()) ||
      state.activeSavedName ||
      "";
    if (!name) {
      setStatus("Enter a name before saving.", "error");
      return;
    }
    if (!state.imageUrl) {
      setStatus("Generate a scene first.", "error");
      return;
    }
    var draft = currentDraft();
    fetchWithTimeout(apiUrl("/api/rooms"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: state.activeSavedId || undefined,
        name: name,
        prompt: draft.prompt,
        mood: draft.mood,
        lighting: draft.lighting,
        time_of_day: draft.time_of_day,
        spells: draft.spells,
        spell_palette: draft.spell_palette,
        art_style: draft.art_style,
        image_url: state.imageUrl,
        continuity_id: state.continuityId || state.activeSavedId || "room-" + Date.now(),
        preview_png: capturePreviewDataUrl(),
      }),
    })
      .then(function (r) {
        return parseApiResponse(r).then(function (d) {
          if (!r.ok || !d.ok) throw new Error((d && d.error) || "Save failed.");
          return d.room;
        });
      })
      .then(function (room) {
        if (room && room.id) {
          state.activeSavedId = room.id;
          state.activeSavedName = room.name || name;
        }
        $("rm-save-name").value = "";
        setStatus('Place "' + name + '" saved (#' + (room && room.version ? room.version : "?") + ").", "ok");
        return loadSavedRooms();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not save.", "error");
      });
  }

  function loadSavedRooms() {
    return fetchWithTimeout(apiUrl("/api/rooms"), { cache: "no-store" })
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (d) {
        state.saved = (d && d.rooms) || [];
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
    var lib = $("rm-saved-list");
    if (!lib) return;
    lib.innerHTML = "";
    if (!state.saved.length) {
      lib.innerHTML = '<p class="st-saved-empty">No saved places yet.</p>';
      return;
    }
    state.saved.forEach(function (room) {
      var card = document.createElement("div");
      card.className = "st-saved-card";
      card.dataset.id = room.id;
      if (room.preview_url) {
        var img = document.createElement("img");
        img.src = room.preview_url;
        img.alt = room.name;
        card.appendChild(img);
      }
      var meta = document.createElement("div");
      meta.className = "st-saved-meta";
      meta.innerHTML =
        '<span class="st-version">#' + (room.version || 1) + "</span>" +
        "<strong>" + (room.name || "Place") + "</strong><span>" + (room.mood || "") + "</span>";
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

  function loadRoomIntoEditor(room) {
    state.activeSavedId = room.id || "";
    state.activeSavedName = room.name || "";
    state.draft = {
      prompt: room.prompt || "",
      mood: room.mood || "neutral",
      lighting: room.lighting || "natural",
      time_of_day: room.time_of_day || "day",
      spells: room.spells || [],
      spell_palette: room.spell_palette || [],
      art_style: room.art_style || "painterly",
      continuity_id: room.continuity_id || room.id,
    };
    state.continuityId = room.continuity_id || room.id;
    state.imageUrl = room.image_url || room.preview_url || "";
    state.appliedSpells = (room.spells || []).map(normalizeItem);
    renderAppliedSpells();
    $("rm-prompt").value = state.draft.prompt;
    $("rm-mood").value = state.draft.mood;
    $("rm-lighting").value = state.draft.lighting;
    $("rm-time-of-day").value = state.draft.time_of_day;
    $("rm-art-style").value = state.draft.art_style;
    showPreview(state.imageUrl);
    setStatus('Loaded "' + (room.name || "place") + '".', "ok");
  }

  function loadImagePool() {
    if (state.poolReady) return Promise.resolve();
    return (window.loadGalleryData ? window.loadGalleryData() : Promise.resolve({ manifest: [] }))
      .then(function (data) {
        var pool = [];
        (data.manifest || []).forEach(function (m) {
          pool.push(
            normalizeItem({
              url: window.getPaintingUrl ? window.getPaintingUrl(m.number) : "paintings/" + m.number + ".jpg",
              label: "#" + m.number,
              paintingNum: m.number,
            })
          );
        });
        state.pool = pool;
        state.poolReady = true;
        fillTrayRandom();
        renderTray();
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
    state.trayItems = copy.slice(0, TRAY_SLICE);
  }

  function renderTray() {
    var strip = $("rm-spell-strip");
    if (!strip) return;
    strip.innerHTML = "";
    state.trayItems.forEach(function (item, idx) {
      var el = document.createElement("div");
      el.className = "st-spell rm-spell";
      el.dataset.idx = String(idx);
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.label;
      el.appendChild(img);
      strip.appendChild(el);
    });
    var count = $("rm-tray-count");
    if (count) {
      count.textContent =
        state.trayItems.length + " shown · drag onto preview to reshape scene";
    }
  }

  function applySpell(item) {
    if (state.generating) return;
    item = normalizeItem(item);
    if (!item.url) return;
    if (!state.imageUrl) {
      setStatus("Generate a place first, then drag spells onto it.", "error");
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
      if (palette.length) draft.spell_palette = palette;
      draft.spells = state.appliedSpells.slice();
      setStatus(
        "Spell " + state.appliedSpells.length + "/" + cap + " — reshaping place…",
        "ok"
      );
      generateRoom({
        spellCast: true,
        spellReference: item.url,
        refine: true,
        referenceUrl: state.imageUrl,
      });
    });
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

  function onPointerDown(e) {
    if (state.generating) return;
    var spell = e.target.closest(".rm-spell");
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
    var stage = $("rm-stage");
    if (stage) stage.classList.add("st-drop-active");
  }

  function onPointerUp(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    var drag = state.drag;
    var dy = drag.startY - e.clientY;
    var stage = $("rm-stage");
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
    var stage = $("rm-stage");
    if (stage) stage.classList.remove("st-drop-active");
    state.drag = null;
  }

  function bindUi() {
    $("rm-generate").addEventListener("click", function () {
      state.imageUrl = "";
      state.activeSavedId = "";
      state.activeSavedName = "";
      showPreview("");
      generateRoom();
    });
    $("rm-save-btn").addEventListener("click", saveRoom);
    $("rm-saved-list").addEventListener("click", function (e) {
      var card = e.target.closest(".st-saved-card");
      var btn = e.target.closest("button");
      if (!card || !btn) return;
      var room = state.saved.find(function (r) {
        return r.id === card.dataset.id;
      });
      if (btn.dataset.action === "remove") {
        if (!window.confirm("Remove this place?")) return;
        fetchWithTimeout(apiUrl("/api/rooms/remove"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: card.dataset.id }),
        }).then(loadSavedRooms);
      } else if (btn.dataset.action === "load" && room) loadRoomIntoEditor(room);
    });
    $("rm-randomize").addEventListener("click", function () {
      fillTrayRandom();
      renderTray();
    });
    var strip = $("rm-spell-strip");
    if (strip) {
      strip.addEventListener("pointerdown", onPointerDown);
      strip.addEventListener("pointermove", onPointerMove);
      strip.addEventListener("pointerup", onPointerUp);
      strip.addEventListener("pointercancel", onPointerCancel);
    }
    var applied = $("rm-applied-spells");
    if (applied) {
      applied.addEventListener("click", function (e) {
        var btn = e.target.closest(".st-applied-rm");
        if (!btn) return;
        state.appliedSpells.splice(parseInt(btn.dataset.idx, 10), 1);
        readUiToDraft();
        currentDraft().spells = state.appliedSpells.slice();
        renderAppliedSpells();
      });
    }
    $("rm-regen").addEventListener("click", function () {
      generateRoom({ variation: true });
    });
  }

  function onShow() {
    loadImagePool();
    loadSavedRooms();
  }

  function boot() {
    if (!$("panel-rooms")) return;
    state.draft = defaultDraft();
    bindUi();
    renderAppliedSpells();
    setStatus("Describe a place — generate, then drag spells onto the preview to reshape it.", "ok");
    window.dispatchEvent(new Event("rooms-ready"));
  }

  window.Rooms = {
    onShow: onShow,
    listSaved: function () {
      return state.saved.slice();
    },
  };
  window.addEventListener("rooms-show", onShow);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();