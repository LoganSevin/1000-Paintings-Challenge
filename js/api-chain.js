/**
 * API — drag spells into a chain pipeline, generate callable chain APIs.
 */
(function () {
  "use strict";

  var TRAY_SLICE = 36;
  var MAX_CHAIN_STEPS = 12;
  var CHAIN_OPS = ["ingest", "fuse", "transform", "refine", "emit"];
  var LOCAL_CHAINS_KEY = "api-chains-local";

  var state = {
    pool: [],
    poolReady: false,
    trayItems: [],
    chain: [],
    saved: [],
    activeId: "",
    drag: null,
    generating: false,
    running: false,
    lastFused: "",
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function setStatus(msg, kind) {
    var el = $("api-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "api-status" + (kind ? " " + kind : "");
  }

  function slugify(name) {
    return String(name || "chain")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "chain";
  }

  function normalizeItem(item) {
    item = item || {};
    var num = item.paintingNum || item.painting_num || null;
    var analysis = num && window.getGalleryAnalysis ? window.getGalleryAnalysis(num) : null;
    return {
      url: item.url || "",
      label: item.label || (num ? "#" + num : "Spell"),
      paintingNum: num,
      title: (analysis && analysis.title) || item.title || item.label || "",
      description: (analysis && analysis.description) || item.description || "",
      tags: (analysis && analysis.tags) || item.tags || [],
      style: (analysis && analysis.style) || item.style || "",
      mood: (analysis && analysis.mood) || item.mood || "",
    };
  }

  function operationForIndex(idx, total) {
    if (total <= 1) return "emit";
    if (idx === 0) return "ingest";
    if (idx === total - 1) return "emit";
    if (idx === total - 2 && total > 2) return "refine";
    return idx % 2 === 1 ? "fuse" : "transform";
  }

  function chainStepPayload(item, idx, total) {
    var norm = normalizeItem(item);
    return {
      step: idx + 1,
      operation: operationForIndex(idx, total),
      painting_num: norm.paintingNum,
      url: norm.url,
      label: norm.label,
      title: norm.title,
      description: norm.description,
      tags: norm.tags,
      style: norm.style,
      mood: norm.mood,
    };
  }

  function buildOpenApiSpec(name, slug, steps, description) {
    var path = "/api/chains/" + slug + "/run";
    return {
      openapi: "3.0.3",
      info: {
        title: name + " — Spell Chain API",
        description: description || "Generated spell chain from the 1000 Paintings gallery.",
        version: "1.0.0",
      },
      paths: {
        [path]: {
          post: {
            summary: "Run spell chain: " + name,
            operationId: "run_" + slug.replace(/-/g, "_"),
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      input: { type: "string", description: "Optional seed text passed into the chain." },
                      prompt: { type: "string", description: "Optional override prompt for the final emit step." },
                    },
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "Fused chain output",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        ok: { type: "boolean" },
                        chain_id: { type: "string" },
                        fused_prompt: { type: "string" },
                        steps: { type: "array" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "x-spell-chain": {
        steps: steps,
        painting_numbers: steps
          .map(function (s) {
            return s.painting_num;
          })
          .filter(Boolean),
      },
    };
  }

  function buildGeneratedSpec(name, slug, description) {
    var steps = state.chain.map(function (item, idx) {
      return chainStepPayload(item, idx, state.chain.length);
    });
    var origin = "";
    try {
      origin = window.location.origin;
    } catch (_e) {
      origin = "http://localhost:8765";
    }
    return {
      id: state.activeId || null,
      name: name,
      slug: slug,
      description: description,
      method: "POST",
      endpoint: "/api/chains/" + slug + "/run",
      url: origin + "/api/chains/" + slug + "/run",
      steps: steps,
      step_count: steps.length,
      openapi: buildOpenApiSpec(name, slug, steps, description),
      created_at: new Date().toISOString(),
    };
  }

  function renderChain() {
    var wrap = $("api-chain-steps");
    var empty = $("api-chain-empty");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (empty) empty.hidden = state.chain.length > 0;
    state.chain.forEach(function (item, idx) {
      var norm = normalizeItem(item);
      var step = document.createElement("div");
      step.className = "api-chain-step";
      step.dataset.idx = String(idx);
      step.innerHTML =
        '<div class="api-step-head">' +
        "<span>Step " +
        (idx + 1) +
        "</span>" +
        '<button type="button" class="api-step-rm" data-action="remove" aria-label="Remove step">×</button>' +
        "</div>" +
        '<div class="api-step-thumb"><img src="' +
        escapeAttr(norm.url) +
        '" alt="" loading="lazy" /></div>' +
        '<div class="api-step-meta">' +
        '<p class="api-step-label">' +
        escapeHtml(norm.title || norm.label) +
        "</p>" +
        '<p class="api-step-op">' +
        escapeHtml(operationForIndex(idx, state.chain.length)) +
        "</p>" +
        "</div>";
      wrap.appendChild(step);
    });
    var saveBtn = $("api-save-chain-btn");
    if (saveBtn) saveBtn.disabled = state.chain.length < 1 || state.generating;
    var runBtn = $("api-run-btn");
    if (runBtn) runBtn.disabled = state.chain.length < 1 || state.running;
  }

  function fuseChainLocally(input, promptOverride) {
    var steps = state.chain.map(function (item, idx) {
      return chainStepPayload(item, idx, state.chain.length);
    });
    var seed = String(input || "").trim();
    var lines = [];
    if (seed) lines.push("Seed input: " + seed);
    steps.forEach(function (step) {
      var op = step.operation || "fuse";
      var title = step.title || step.label || "spell";
      var desc = String(step.description || "").trim();
      var tags = (step.tags || []).slice(0, 8).join(", ");
      var prefix = step.painting_num ? "#" + step.painting_num + " " : "";
      if (op === "ingest") {
        lines.push("[ingest] " + prefix + title + ". " + desc);
      } else if (op === "emit") {
        lines.push("[emit] Finalize as " + prefix + title + " — " + tags);
      } else if (op === "refine") {
        lines.push("[refine] Polish through " + prefix + title + " (" + tags + ")");
      } else {
        lines.push("[" + op + "] Blend " + prefix + title + " — " + tags);
      }
    });
    lines.push("Output: fused vision prompt for downstream generation.");
    var fused = lines.join("\n");
    var override = String(promptOverride || "").trim();
    if (override) fused = override + "\n\n" + fused;
    return fused;
  }

  function renderFusedOutput(text, isEmpty) {
    var out = $("api-fused-output");
    var copyBtn = $("api-copy-fused");
    state.lastFused = text || "";
    if (out) {
      out.textContent = text || "Run the chain to see the fused prompt here.";
      out.classList.toggle("api-fused-empty", !!isEmpty);
    }
    if (copyBtn) copyBtn.disabled = !state.lastFused;
  }

  function renderSpec(spec) {
    var endpoint = $("api-endpoint");
    var pre = $("api-spec-pre");
    if (endpoint) endpoint.textContent = spec ? spec.method + " " + spec.url : "—";
    if (pre) pre.textContent = spec ? JSON.stringify(spec, null, 2) : "Generate an API to see the spec.";
    state.lastSpec = spec || null;
  }

  function renderSaved() {
    var list = $("api-saved-list");
    if (!list) return;
    list.innerHTML = "";
    if (!state.saved.length) {
      list.innerHTML = '<span class="api-saved-empty">No saved chain APIs yet.</span>';
      return;
    }
    state.saved.forEach(function (row) {
      var card = document.createElement("div");
      card.className = "api-saved-card";
      card.dataset.id = row.id;
      card.innerHTML =
        "<span>" +
        escapeHtml(row.name || row.slug) +
        " · " +
        (row.step_count || (row.steps || []).length) +
        " steps</span>" +
        '<button type="button" data-action="load">Load</button>' +
        '<button type="button" data-action="remove">×</button>';
      list.appendChild(card);
    });
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, "&#39;");
  }

  function addToChain(item) {
    item = normalizeItem(item);
    if (!item.url) return;
    if (state.chain.length >= MAX_CHAIN_STEPS) {
      setStatus("Chain max is " + MAX_CHAIN_STEPS + " spells.", "error");
      return;
    }
    var dup = state.chain.some(function (s) {
      return s.url === item.url;
    });
    if (dup) {
      setStatus("That spell is already in the chain.", "error");
      return;
    }
    state.chain.push(item);
    renderChain();
    setStatus("Spell added — step " + state.chain.length + " of chain.", "ok");
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

  function isOverChainCanvas(x, y) {
    var canvas = $("api-chain-canvas");
    if (!canvas) return false;
    var rect = canvas.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function onPointerDown(e) {
    var spell = e.target.closest(".api-spell");
    if (!spell) return;
    var item = normalizeItem(state.trayItems[parseInt(spell.dataset.idx, 10)]);
    if (!item.url) return;
    e.preventDefault();
    spell.setPointerCapture(e.pointerId);
    state.drag = {
      item: item,
      ghost: createGhost(item, e.clientX, e.clientY),
      pointerId: e.pointerId,
      moved: false,
    };
    var canvas = $("api-chain-canvas");
    if (canvas) canvas.classList.add("api-drop-active");
  }

  function onPointerUp(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    var drag = state.drag;
    if (drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    var canvas = $("api-chain-canvas");
    if (canvas) canvas.classList.remove("api-drop-active");
    if (isOverChainCanvas(e.clientX, e.clientY)) addToChain(drag.item);
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
    var canvas = $("api-chain-canvas");
    if (canvas) canvas.classList.remove("api-drop-active");
    state.drag = null;
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
    var strip = $("api-spell-strip");
    if (!strip) return;
    strip.innerHTML = "";
    state.trayItems.forEach(function (item, idx) {
      var el = document.createElement("div");
      el.className = "st-spell api-spell";
      el.dataset.idx = String(idx);
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.label;
      el.appendChild(img);
      strip.appendChild(el);
    });
    var count = $("api-tray-count");
    if (count) {
      count.textContent = state.trayItems.length + " shown · drag onto chain to link";
    }
  }

  function loadLocalChains() {
    try {
      var rows = JSON.parse(localStorage.getItem(LOCAL_CHAINS_KEY) || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch (_err) {
      return [];
    }
  }

  function writeLocalChains(chains) {
    try {
      localStorage.setItem(LOCAL_CHAINS_KEY, JSON.stringify(chains || []));
    } catch (_err) {
      /* ignore quota */
    }
  }

  function mergeSavedChains(serverChains, localChains) {
    var merged = [];
    var seen = {};
    (serverChains || []).concat(localChains || []).forEach(function (row) {
      var key = String(row.id || row.slug || row.name || "");
      if (!key || seen[key]) return;
      seen[key] = true;
      merged.push(row);
    });
    merged.sort(function (a, b) {
      return String(b.updated_at || b.created_at || "").localeCompare(
        String(a.updated_at || a.created_at || "")
      );
    });
    return merged;
  }

  function upsertLocalChain(entry) {
    var local = loadLocalChains();
    var key = String(entry.id || entry.slug || "");
    local = local.filter(function (row) {
      return String(row.id || row.slug || "") !== key;
    });
    local.unshift(entry);
    if (local.length > 100) local = local.slice(0, 100);
    writeLocalChains(local);
    return local;
  }

  function loadSavedChains() {
    var local = loadLocalChains();
    return fetch(apiUrl("/api/chains"), { cache: "no-store" })
      .then(function (r) {
        return window.parseGalleryApiResponse ? window.parseGalleryApiResponse(r) : r.json();
      })
      .then(function (data) {
        state.saved = mergeSavedChains(data.chains || [], local);
        renderSaved();
        return state.saved;
      })
      .catch(function () {
        state.saved = local;
        renderSaved();
        return state.saved;
      });
  }

  function saveChainLocally(spec) {
    var entry = Object.assign({}, spec, {
      id: spec.id || "local-" + spec.slug + "-" + Date.now(),
      updated_at: new Date().toISOString(),
    });
    upsertLocalChain(entry);
    state.activeId = entry.id;
    state.saved = mergeSavedChains([], loadLocalChains());
    renderSaved();
    renderSpec(entry);
    window.dispatchEvent(new Event("api-chains-updated"));
    return entry;
  }

  function saveChain() {
    if (state.chain.length < 1) {
      setStatus("Drag at least one spell onto the chain.", "error");
      return;
    }
    var name = ($("api-name") && $("api-name").value.trim()) || "";
    if (!name) {
      setStatus("Enter a chain name before saving.", "error");
      $("api-name") && $("api-name").focus();
      return;
    }
    var description = ($("api-desc") && $("api-desc").value.trim()) || "";
    var slug = slugify(name);
    var spec = buildGeneratedSpec(name, slug, description);
    if (state.activeId) spec.id = state.activeId;
    state.generating = true;
    renderChain();
    setStatus("Saving chain…", "pending");
    fetch(apiUrl("/api/chains"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spec),
    })
      .then(function (r) {
        return window.parseGalleryApiResponse ? window.parseGalleryApiResponse(r) : r.json();
      })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "Save failed");
        state.activeId = data.chain && data.chain.id;
        var saved = data.chain || spec;
        if (saved.id) spec.id = saved.id;
        if (saved.slug) spec.slug = saved.slug;
        upsertLocalChain(saved);
        renderSpec(spec);
        setStatus(
          'Chain saved — use @"' +
            name +
            '" or @' +
            (saved.slug || slug).replace(/-/g, "") +
            " in Animate.",
          "ok"
        );
        window.dispatchEvent(new Event("api-chains-updated"));
        return loadSavedChains();
      })
      .catch(function (err) {
        var local = saveChainLocally(spec);
        setStatus(
          (err.message || "Server save failed") +
            ' — saved on this device. Use @"' +
            name +
            '" in Animate.',
          "ok"
        );
        return local;
      })
      .finally(function () {
        state.generating = false;
        renderChain();
      });
  }

  function loadChainIntoEditor(chain) {
    if (!chain) return;
    state.activeId = chain.id || "";
    state.chain = (chain.steps || []).map(normalizeItem);
    if ($("api-name")) $("api-name").value = chain.name || "";
    if ($("api-desc")) $("api-desc").value = chain.description || "";
    renderChain();
    renderSpec(chain);
    setStatus('Loaded "' + (chain.name || "API") + '".', "ok");
  }

  function copyText(text, label) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        setStatus((label || "Copied") + " copied.", "ok");
      });
    }
  }

  function runInputValue() {
    var runInput = $("api-run-input") && $("api-run-input").value.trim();
    if (runInput) return runInput;
    return ($("api-desc") && $("api-desc").value.trim()) || "";
  }

  function chainSlugForRun() {
    if (state.lastSpec && state.lastSpec.slug) return state.lastSpec.slug;
    var name = ($("api-name") && $("api-name").value.trim()) || "";
    return slugify(name);
  }

  function runChain() {
    if (state.chain.length < 1) {
      setStatus("Add spells to the chain first.", "error");
      return;
    }
    var input = runInputValue();
    var slug = chainSlugForRun();
    state.running = true;
    renderChain();
    setStatus("Running chain…", "pending");
    renderFusedOutput("Fusing spells…", false);

    fetch(apiUrl("/api/chains/" + encodeURIComponent(slug) + "/run"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: input, prompt: input }),
    })
      .then(function (r) {
        return (window.parseGalleryApiResponse ? window.parseGalleryApiResponse(r) : r.json()).then(
          function (data) {
            return { ok: r.ok, data: data };
          }
        );
      })
      .then(function (res) {
        if (res.ok && res.data && res.data.fused_prompt) {
          renderFusedOutput(res.data.fused_prompt, false);
          setStatus("Chain ran — fused prompt ready. Copy and paste into Animate or gen tabs.", "ok");
          return;
        }
        throw new Error((res.data && res.data.error) || "not saved");
      })
      .catch(function () {
        var fused = fuseChainLocally(input, input);
        renderFusedOutput(fused, false);
        setStatus("Fused locally. Save chain to use @tag in Animate.", "ok");
      })
      .finally(function () {
        state.running = false;
        renderChain();
      });
  }

  function bindUi() {
    $("api-save-chain-btn").addEventListener("click", saveChain);
    $("api-run-btn").addEventListener("click", runChain);
    $("api-copy-fused").addEventListener("click", function () {
      copyText(state.lastFused, "Fused prompt");
    });
    $("api-run-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        runChain();
      }
    });
    $("api-clear-chain").addEventListener("click", function () {
      state.chain = [];
      state.activeId = "";
      renderChain();
      renderSpec(null);
      renderFusedOutput("", true);
      setStatus("Chain cleared.", "ok");
    });
    $("api-randomize").addEventListener("click", function () {
      fillTrayRandom();
      renderTray();
    });
    $("api-copy-endpoint").addEventListener("click", function () {
      if (state.lastSpec) copyText(state.lastSpec.url, "Endpoint URL");
    });
    $("api-copy-spec").addEventListener("click", function () {
      if (state.lastSpec) copyText(JSON.stringify(state.lastSpec, null, 2), "API spec");
    });
    $("api-chain-steps").addEventListener("click", function (e) {
      var btn = e.target.closest('[data-action="remove"]');
      if (!btn) return;
      var step = e.target.closest(".api-chain-step");
      if (!step) return;
      state.chain.splice(parseInt(step.dataset.idx, 10), 1);
      renderChain();
    });
    $("api-saved-list").addEventListener("click", function (e) {
      var card = e.target.closest(".api-saved-card");
      var btn = e.target.closest("button");
      if (!card || !btn) return;
      var row = state.saved.find(function (c) {
        return c.id === card.dataset.id;
      });
      if (btn.dataset.action === "load" && row) loadChainIntoEditor(row);
      if (btn.dataset.action === "remove") {
        fetch(apiUrl("/api/chains/remove"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: card.dataset.id }),
        }).then(function () {
          window.dispatchEvent(new Event("api-chains-updated"));
          return loadSavedChains();
        });
      }
    });
    var strip = $("api-spell-strip");
    if (strip) {
      strip.addEventListener("pointerdown", onPointerDown);
      strip.addEventListener("pointermove", onPointerMove);
      strip.addEventListener("pointerup", onPointerUp);
      strip.addEventListener("pointercancel", onPointerCancel);
    }
    var canvas = $("api-chain-canvas");
    if (canvas) {
      canvas.addEventListener("dragover", function (e) {
        e.preventDefault();
      });
    }
  }

  function onShow() {
    loadImagePool();
    loadSavedChains();
  }

  function boot() {
    if (!$("panel-api")) return;
    bindUi();
    renderChain();
    renderSpec(null);
    renderFusedOutput("", true);
    setStatus("Drag spells onto the chain, name it, then Save chain.", "ok");
    window.dispatchEvent(new Event("api-chain-ready"));
  }

  window.ApiChain = { onShow: onShow };
  window.addEventListener("api-chain-show", onShow);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();