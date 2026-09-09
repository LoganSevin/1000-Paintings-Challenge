/**
 * Maps — create map stills (arena / overworld / dungeon / city) for Fight & worlds.
 * Generate → save to catalog (and Generated). Simple, same-origin API.
 */
(function () {
  "use strict";

  var state = {
    imageUrl: "",
    busy: false,
    saved: [],
    genNum: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function absUrl(url) {
    if (!url) return "";
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return url;
    }
  }

  function setStatus(msg, kind) {
    var el = $("mp-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "mp-status" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
  }

  function setBusy(on) {
    state.busy = !!on;
    ["mp-generate", "mp-save", "mp-variation"].forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = !!on;
    });
    var save = $("mp-save");
    if (save && !on) save.disabled = !state.imageUrl;
  }

  function kindValue() {
    var s = $("mp-kind");
    return (s && s.value) || "arena";
  }

  function viewValue() {
    var s = $("mp-view");
    return (s && s.value) || "top-down";
  }

  function styleValue() {
    var s = $("mp-style");
    return (s && s.value) || "painterly";
  }

  function aspectValue() {
    var s = $("mp-aspect");
    return (s && s.value) || "16:9";
  }

  function userPrompt() {
    var el = $("mp-prompt");
    return el ? String(el.value || "").trim() : "";
  }

  function paintRef() {
    var el = $("mp-paint-ref");
    var n = el ? parseInt(el.value, 10) : 0;
    return n >= 1 && n <= 1000 ? n : 0;
  }

  function buildMapPrompt() {
    var kind = kindValue();
    var view = viewValue();
    var style = styleValue();
    var idea = userPrompt() || "a memorable playable stage";

    var kindLine = {
      arena: "fighting-game arena stage — clear ground plane, readable silhouette space for characters",
      overworld: "game overworld map — regions, paths, landmarks, legible at a glance",
      dungeon: "dungeon or interior map — corridors, chambers, navigable space",
      city: "city or settlement map — streets, blocks, districts",
      landscape: "wide landscape map board — terrain bands and points of interest",
      stage: "side-view stage backdrop — platform fighter stage environment",
    }[kind] || "playable map environment";

    var viewLine = {
      "top-down": "top-down orthographic map view",
      isometric: "isometric 3/4 map view",
      "side-view": "side-scrolling stage backdrop (profile)",
      "bird-eye": "high bird's-eye map view",
    }[view] || "map view";

    var styleLine = {
      painterly: "painterly fine-art map illustration",
      toon: "clean toon game art map",
      pixel: "detailed pixel-art map (high resolution read)",
      ink: "ink and watercolor cartography",
      stencil: "bold stencil / graphic map",
    }[style] || "illustrated map";

    return (
      "Create a NEW original " +
      styleLine +
      ". " +
      kindLine +
      ". Camera/framing: " +
      viewLine +
      ". Subject: " +
      idea +
      ". " +
      "Single coherent map image, full bleed, no UI chrome, no HUD, no text labels unless carved as art, " +
      "no watermark, no collage panels. Designed as a usable game/world map or stage backdrop."
    );
  }

  function showPreview(url) {
    state.imageUrl = url || "";
    var img = $("mp-preview");
    var empty = $("mp-empty");
    if (img) {
      if (url) {
        img.src = absUrl(url);
        img.hidden = false;
      } else {
        img.removeAttribute("src");
        img.hidden = true;
      }
    }
    if (empty) empty.hidden = !!url;
    var save = $("mp-save");
    if (save) save.disabled = state.busy || !url;
  }

  function extractImageUrl(payload) {
    if (!payload) return "";
    var img = payload.image || (payload.images && payload.images[0]);
    var raw =
      (img && (img.url || img.download_url || img.uri)) ||
      payload.image_url ||
      payload.output_url ||
      "";
    return absUrl(raw);
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function pollJob(jobId, left) {
    if (left == null) left = 90;
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for map image."));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        var job = res.d || {};
        var st = String(job.status || "working").toLowerCase();
        setStatus("Generating map… " + st);
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractImageUrl(job);
          if (url) return url;
          throw new Error("Job done but no image URL.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((job.error && (job.error.message || job.error)) || "Generate failed");
        }
        return delay(1500).then(function () {
          return pollJob(jobId, left - 1);
        });
      });
  }

  function generateMap() {
    if (state.busy) return;
    var prompt = buildMapPrompt();
    var aspect = aspectValue();
    var ref = paintRef();
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "map-" + Date.now();

    var body = {
      job_id: jobId,
      stasis: prompt.slice(0, 4000),
      prompt: prompt.slice(0, 4000),
      fused_prompt: prompt.slice(0, 4000),
      buzz_words: ["map", kindValue(), viewValue(), styleValue(), "game stage", "full bleed"],
      spells: ref ? [ref] : [],
      aspect_ratio: aspect,
      mag_fresh: true,
      fresh_variation: true,
      spell_cast: !!ref,
      source: "maps-tab",
    };
    if (ref) {
      var paintUrl = "/paintings/" + ref + ".jpg";
      body.spell_reference_image = absUrl(paintUrl);
      body.reference_image = absUrl(paintUrl);
    }

    setBusy(true);
    setStatus("Generating map…");
    fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, status: r.status, d: d };
        });
      })
      .then(function (res) {
        var d = res.d || {};
        if (res.status === 202 || (!extractImageUrl(d) && (d.job_id || jobId))) {
          return pollJob(d.job_id || jobId);
        }
        if (!res.ok) throw new Error((d && d.error) || "Generate failed");
        var url = extractImageUrl(d);
        if (!url && d.job_id) return pollJob(d.job_id);
        if (!url) throw new Error("No image returned");
        return url;
      })
      .then(function (url) {
        state.genNum = null;
        showPreview(url);
        setStatus("Map ready — name it and Save map.", "ok");
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Generate failed", "err");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function saveMap() {
    if (!state.imageUrl || state.busy) return;
    var nameEl = $("mp-name");
    var name = nameEl ? String(nameEl.value || "").trim() : "";
    if (!name) {
      setStatus("Enter a map name before saving.", "err");
      return;
    }
    setBusy(true);
    setStatus("Saving map…");
    // 1) Archive still into Generated
    fetch(apiUrl("/api/save-generated-image"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: state.imageUrl,
        source: "maps",
        collection: "generated",
        description: name + " · " + kindValue() + " map",
        meta: {
          source: "maps",
          kind: kindValue(),
          view: viewValue(),
          style: styleValue(),
          prompt: userPrompt(),
        },
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok || (d && d.ok === false)) {
            throw new Error((d && d.error) || "Save generated failed");
          }
          return d;
        });
      })
      .then(function (saved) {
        state.genNum = saved && saved.num != null ? saved.num : null;
        var url = (saved && saved.url) || state.imageUrl;
        // 2) Catalog entry
        return fetch(apiUrl("/api/maps"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name,
            kind: kindValue(),
            view: viewValue(),
            style: styleValue(),
            prompt: userPrompt(),
            image_url: url,
            gen_num: state.genNum,
            painting_ref: paintRef() || null,
          }),
        }).then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok || (d && d.ok === false)) {
              throw new Error((d && d.error) || "Map catalog save failed");
            }
            return d;
          });
        });
      })
      .then(function (d) {
        setStatus(
          "Saved map “" +
            name +
            "”" +
            (state.genNum != null ? " · also Generated #" + state.genNum : "") +
            ".",
          "ok"
        );
        return loadSaved();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Save failed", "err");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function loadSaved() {
    return fetch(apiUrl("/api/maps"), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        state.saved = (d && d.maps) || [];
        renderSaved();
      })
      .catch(function () {
        state.saved = [];
        renderSaved();
      });
  }

  function renderSaved() {
    var list = $("mp-list");
    if (!list) return;
    list.innerHTML = "";
    if (!state.saved.length) {
      list.innerHTML = '<p class="mp-empty">No saved maps yet.</p>';
      return;
    }
    // Newest first
    state.saved
      .slice()
      .reverse()
      .forEach(function (m) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mp-card";
        var url = absUrl(m.image_url || m.url || "");
        btn.innerHTML =
          (url ? '<img src="' + url.replace(/"/g, "") + '" alt="" loading="lazy" />' : "") +
          "<span>" +
          escapeHtml(m.name || "Map") +
          "<small>" +
          escapeHtml((m.kind || "") + (m.gen_num != null ? " · G#" + m.gen_num : "")) +
          "</small></span>";
        btn.addEventListener("click", function () {
          if (url) showPreview(url);
          var n = $("mp-name");
          if (n) n.value = m.name || "";
          var p = $("mp-prompt");
          if (p && m.prompt) p.value = m.prompt;
          setStatus("Loaded “" + (m.name || "map") + "”.");
        });
        list.appendChild(btn);
      });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bind() {
    var gen = $("mp-generate");
    if (gen && !gen.dataset.bound) {
      gen.dataset.bound = "1";
      gen.addEventListener("click", generateMap);
    }
    var save = $("mp-save");
    if (save && !save.dataset.bound) {
      save.dataset.bound = "1";
      save.addEventListener("click", saveMap);
    }
    var v = $("mp-variation");
    if (v && !v.dataset.bound) {
      v.dataset.bound = "1";
      v.addEventListener("click", generateMap);
    }
  }

  function onShow() {
    bind();
    loadSaved();
    setStatus("Describe a map, pick kind/view, Generate.");
  }

  function onHide() {
    /* idle */
  }

  window.Maps = { onShow: onShow, onHide: onHide };

  window.addEventListener("maps-show", onShow);
  window.addEventListener("maps-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
