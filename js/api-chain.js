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

  var DEFINE = [
    ["logan7in unlimited", "The studio license on this site: usage is not capped by a monthly or prepaid wallet. You can keep using logan7in.art for life without buying a ticket. xAI may still meter their own cloud; that meter is not a door here."],
    ["studio license", "The rule this gallery runs on, not an xAI product. It says the site stays usable whether or not a Grok key can spend."],
    ["prepaid unlimited", "No “you have $X left on this site” bucket. Logan7in unlimited does not run out of prepaid studio credits because the studio does not sell access by the dollar."],
    ["monthly unlimited", "No monthly usage cap on the gallery itself. A busy month does not lock Generate or the rest of the tabs."],
    ["for life", "The uncapped studio rule does not expire. It is not a trial and not a subscription that ends."],
    ["xai", "The company behind Grok. Their API is a paid vendor. They charge whoever’s API key is on the request. They do not own this gallery."],
    ["grok", "xAI’s model. Cloud Generate / describe / blend can ask Grok to invent a still or write a caption. That is optional paid cloud work, not the cover charge."],
    ["meters", "Counts usage to bill it. xAI meters tokens and image gens on their cloud. A meter is a vendor invoice, not a lock on logan7in.art."],
    ["vendor meter", "xAI’s own billing counter. The credits HUD can show it as telemetry. It is not a requirement to walk into the studio."],
    ["tokens", "Chunks of text the model reads or writes. Cloud blend, redefine, and describe spend tokens. Local fuse and browsing do not."],
    ["image gens", "Paid cloud requests that ask a model to make a new picture. Spellforge Generate uses this when a key can still spend."],
    ["cloud", "Someone else’s computers (here, xAI). A cloud call leaves this browser, hits their API, and can be billed to a key."],
    ["wallets", "Who would be charged if a paid cloud call runs: Logan’s site key, or a visitor’s pasted key. Studio wallets are not a door under Logan7in unlimited."],
    ["door", "A lock that would stop you using the site. A capped xAI wallet used to feel like a door. Unlimited means that is not allowed to block usage."],
    ["monthly studio cap", "A made-up limit we refuse: “you already generated too much this month on logan7in.art.” There isn’t one."],
    ["prepaid studio cap", "A made-up limit we refuse: “the gallery’s prepaid bucket is empty, so stop.” There isn’t one."],
    ["abundant", "Treated as plentiful, not rationed. Walking into the studio and getting a vision should not be scarce."],
    ["spell chains", "The builder on this tab’s second pane. You drag paintings into a pipeline, save a name, and call it from Animate. It runs in the browser and does not call xAI."],
    ["pipeline", "The ordered steps of a spell chain: ingest → fuse/transform → refine → emit. Local text assembly, not a paid image gen."],
    ["@yourchainname", "How Animate refers to a saved chain. Yellow chain tags. Still local — no xAI bill."],
    ["animate", "The studio tab that can play motion. It can read a saved chain by name. That lookup is free."],
    ["browser", "This device. Local fuse, chains, and most tabs run here with no xAI invoice."],
    ["cloud model calls", "Requests to Grok: Generate, blend, redefine, describe. Metered to whichever API key is sent. Optional."],
    ["spellforge generate", "The Spellforge button that tries to make a stasis vision. Tries cloud if a key can spend; if not, fuses equipped spells on this device."],
    ["blend", "Cloud step that weaves several spell descriptions into one fused text. Can spend tokens on a key. Not required to use the studio."],
    ["redefine", "Cloud rewrite of the current stasis text. Same idea as blend: optional, billed to a key if it runs on xAI."],
    ["describe", "Cloud caption of a phone upload: title, what’s visible, generation prompt. Paid if it hits xAI. Uploading the photo itself is free. If the vendor wallet won’t spend, a local stub caption is used so upload is not a locked door."],
    ["metered", "Counted for a bill. Cloud calls are metered by xAI. Studio use is not metered as a paywall."],
    ["api key", "A secret string xAI uses to know which account to charge. The site can send Logan’s Netlify key, a visitor’s key, or no key (free path)."],
    ["xai_api_key", "The Netlify environment key — Logan’s team wallet. Unguarded live Generates used to drain this. It is a vendor key, not the studio license."],
    ["netlify site key", "Same as XAI_API_KEY: the key stored on the host. xAI bills that team if Generate goes to the cloud with no visitor key."],
    ["team wallet", "The xAI billing account tied to that site key (the team id in their error). Capping that wallet must not cap logan7in.art."],
    ["visitor key", "A key someone pastes so cloud gens bill them. Still someone paying. Not the default. Not required."],
    ["no key", "The free path: browse, Kids, chains, uploads, on-device fuse. Nothing is sent to xAI."],
    ["on-device fuse", "Spellforge merges the equipped paintings in this browser into a stasis vision. No Grok invoice. This is how Generate stays unlimited when cloud won’t spend."],
    ["on this device", "In your browser, on this phone or computer — not on xAI’s servers."],
    ["local canvas merge", "The on-device fuse: stacked/composed from the equipped spell images. Not a brand-new Grok painting, and not a bill."],
    ["stasis vision", "The still Spellforge is trying to make from the fused spells. Cloud = new Grok image. Capped cloud = local fuse of what you already equipped."],
    ["credits empty", "xAI saying that key’s prepaid balance is gone. Under Logan7in unlimited, Generate still runs locally instead of sending you to Buy credits."],
    ["spending limit", "xAI saying that key hit a monthly cap. Same rule: studio usage continues; vendor cap is not a door."],
    ["vendor telemetry", "The credits readout. It can show what xAI thinks that wallet has left. It does not decide whether you may use the site."],
    ["cover charge", "A fee to walk in. Cloud gens are not that. Donations and prints are how the gallery is supposed to earn."],
    ["donations", "Money given to keep the generative process going. Suggested amounts on pieces are donations, not sale prices."],
    ["prints", "Etsy / Redbubble listings. A way the site can make money without metering Grok."],
    ["netlify", "The host that serves logan7in.art. It can store the site xAI key. Hosting the files is not the same as xAI billing."],
    ["fuse locally", "Same as on-device fuse: merge equipped spells in the browser when cloud Generate cannot spend."],
    ["ticket", "A fee or key you would need before using the site. Logan7in unlimited means there is no ticket."],
    ["vendor", "An outside company you can optionally call. xAI is a vendor. The gallery is not their product."],
    ["invoice", "A bill from the vendor for metered cloud use. An invoice to a key is not a lock on the studio."],
    ["telemetry", "A readout of what the vendor thinks. The credits HUD is telemetry. It does not grant or deny access."],
    ["equipped spells", "The paintings sitting in Spellforge slots I–III. Local fuse composes those images on this device."],
    ["caption", "Words about a picture: title, what’s visible, a prompt. Describe writes a caption. The photo can exist without one."],
    ["still", "A single finished picture, not a video. A stasis vision is a still."],
    ["paywall", "A stop that demands money before you continue. Studio use is not behind a paywall."],
    ["subscription", "A recurring paid plan that can end. Logan7in unlimited is not a subscription."],
    ["trial", "A short test period that expires. Unlimited is not a trial."],
    ["secret string", "The API key itself — a password-like token xAI uses to pick an account to charge."],
    ["host", "Where the website files live (Netlify). Hosting pages is not the same as paying Grok per generate."],
    ["stacked", "How local fuse can layer the equipped paintings. It is a composition of what you already picked, not a new Grok invent."],
    ["composed", "Put together from parts you already have. On-device fuse composes equipped spells."],
    ["optional", "You can skip it and the studio still works. Cloud Generate, describe, and visitor keys are optional."],
    ["free path", "Everything that does not send a key to xAI: browse, Kids, chains, uploads, on-device fuse."],
    ["account", "Whose xAI billing the key belongs to. Site key = Logan’s team. Visitor key = whoever pasted it."],
  ];

  function normPhrase(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[“”"']/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function definePhrase(raw) {
    var q = normPhrase(raw);
    if (!q || q.length < 2) return null;
    var i;
    var best = null;
    var bestScore = 0;
    for (i = 0; i < DEFINE.length; i++) {
      var key = DEFINE[i][0];
      var def = DEFINE[i][1];
      if (q === key) return { term: key, text: def, exact: true };
      if (q.indexOf(key) >= 0 || key.indexOf(q) >= 0) {
        var score = Math.min(q.length, key.length) / Math.max(q.length, key.length) + (q.indexOf(key) >= 0 ? 0.35 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = { term: key, text: def, exact: false };
        }
      }
    }
    if (best && bestScore >= 0.35) return best;
    var words = q.split(" ").filter(function (w) {
      return w.length > 3;
    });
    for (i = 0; i < DEFINE.length; i++) {
      var hits = 0;
      words.forEach(function (w) {
        if (DEFINE[i][0].indexOf(w) >= 0) hits++;
      });
      if (hits && hits / Math.max(words.length, 1) >= 0.5) {
        return { term: DEFINE[i][0], text: DEFINE[i][1], exact: false };
      }
    }
    return {
      term: q,
      text:
        "That selection is not a headword yet. It is ordinary wording. Highlight a shorter name inside this card — like “API key”, “vendor”, “invoice”, or “on-device fuse” — and Define again to go deeper.",
      exact: false,
    };
  }

  function clearDefineMark(root) {
    if (!root) return;
    root.querySelectorAll("mark.api-define-mark").forEach(function (mark) {
      var parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
  }

  function isolateSelection(root) {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return "";
    var range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return "";
    var text = String(sel).replace(/\s+/g, " ").trim();
    if (text.length < 2) return "";
    clearDefineMark(root);
    var mark = document.createElement("mark");
    mark.className = "api-define-mark";
    try {
      range.surroundContents(mark);
    } catch (err) {
      mark.appendChild(range.extractContents());
      range.insertNode(mark);
    }
    sel.removeAllRanges();
    return text;
  }

  function placePopover(el, x, y) {
    el.hidden = false;
    el.style.left = "0px";
    el.style.top = "0px";
    var pad = 8;
    var w = el.offsetWidth;
    var h = el.offsetHeight;
    var left = Math.min(Math.max(pad, x), window.innerWidth - w - pad);
    var top = Math.min(Math.max(pad, y), window.innerHeight - h - pad);
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  function bindDefiner() {
    var root = document.querySelector(".api-logic");
    if (!root) return;
    var menu = document.createElement("div");
    menu.id = "api-define-menu";
    menu.className = "api-define-menu";
    menu.hidden = true;
    menu.innerHTML =
      '<button type="button" data-api-define>Define</button>' +
      '<button type="button" data-api-suggest>Suggest for fix</button>';
    var card = document.createElement("div");
    card.id = "api-define-card";
    card.className = "api-define-card";
    card.hidden = true;
    card.setAttribute("role", "dialog");
    card.innerHTML =
      '<div class="api-define-toolbar">' +
      '<button type="button" data-api-define-back hidden>Back</button>' +
      '<span class="api-define-crumb"></span>' +
      "</div>" +
      "<h4></h4>" +
      '<p class="api-define-body"></p>' +
      '<p class="api-define-hint">Highlight any of this and right-click Define to go deeper.</p>';
    document.body.appendChild(card);
    document.body.appendChild(menu);
    var pending = "";
    var stack = [];
    var current = null;
    var ignoreClickUntil = 0;
    var SUGGEST_KEY = "logan7in-api-define-suggestions-v1";

    function loadSuggestions() {
      try {
        var raw = JSON.parse(localStorage.getItem(SUGGEST_KEY) || "[]");
        return Array.isArray(raw) ? raw : [];
      } catch (err) {
        return [];
      }
    }

    function saveSuggestions(rows) {
      try {
        localStorage.setItem(SUGGEST_KEY, JSON.stringify(rows.slice(0, 200)));
      } catch (err) {}
      renderSuggestions();
    }

    function renderSuggestions() {
      var list = $("api-suggest-list");
      var empty = $("api-suggest-empty");
      if (!list) return;
      var rows = loadSuggestions();
      list.innerHTML = "";
      rows.forEach(function (row) {
        var li = document.createElement("li");
        li.textContent = row.phrase + (row.from ? " (from “" + row.from + "”)" : "");
        list.appendChild(li);
      });
      if (empty) empty.hidden = rows.length > 0;
    }

    renderSuggestions();
    var exportBtn = $("api-suggest-export");
    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        var blob = new Blob([JSON.stringify(loadSuggestions(), null, 2)], {
          type: "application/json",
        });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "logan7in-api-define-suggestions.json";
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }

    function hideMenu() {
      menu.hidden = true;
    }

    function hideAll() {
      hideMenu();
      card.hidden = true;
      stack = [];
      current = null;
      clearDefineMark(root);
      clearDefineMark(card);
    }

    function paintCard(hit, x, y) {
      current = hit;
      card.querySelector("h4").textContent = hit.term;
      var body = card.querySelector(".api-define-body");
      clearDefineMark(body);
      body.textContent = hit.text;
      var back = card.querySelector("[data-api-define-back]");
      var crumb = card.querySelector(".api-define-crumb");
      back.hidden = stack.length === 0;
      crumb.textContent = stack.length
        ? stack
            .map(function (s) {
              return s.term;
            })
            .concat([hit.term])
            .join(" → ")
        : "Define again inside this card";
      hideMenu();
      placePopover(card, x, y);
    }

    function showDef(phrase, x, y, fromCard) {
      var hit = definePhrase(phrase);
      if (!hit) return;
      if (fromCard && current) stack.push(current);
      else if (!fromCard) stack = [];
      paintCard(hit, x, y);
    }

    function openMenu(e, scope, fromCard) {
      var target = fromCard ? card.querySelector(".api-define-body") || card : scope;
      var phrase =
        isolateSelection(target) ||
        String(window.getSelection() || "").replace(/\s+/g, " ").trim();
      if (!phrase) return false;
      e.preventDefault();
      e.stopPropagation();
      pending = phrase;
      ignoreClickUntil = Date.now() + 500;
      menu.setAttribute("data-from-card", fromCard ? "1" : "0");
      var label = phrase.length > 28 ? phrase.slice(0, 26) + "…" : phrase;
      menu.querySelector("[data-api-define]").textContent = "Define “" + label + "”";
      placePopover(menu, e.clientX + 12, e.clientY + 12);
      menu.style.zIndex = "10140";
      return true;
    }

    root.addEventListener("contextmenu", function (e) {
      openMenu(e, root, false);
    });

    card.addEventListener("contextmenu", function (e) {
      openMenu(e, card, true);
    });

    menu.addEventListener("click", function (e) {
      var fromCard = menu.getAttribute("data-from-card") === "1";
      var rect = menu.getBoundingClientRect();
      if (e.target && e.target.closest("[data-api-define]")) {
        showDef(pending, rect.left, rect.bottom + 8, fromCard);
        return;
      }
      if (e.target && e.target.closest("[data-api-suggest]")) {
        var rows = loadSuggestions();
        var phrase = normPhrase(pending);
        if (
          phrase &&
          !rows.some(function (row) {
            return normPhrase(row.phrase) === phrase;
          })
        ) {
          rows.unshift({
            phrase: pending,
            from: current && current.term ? current.term : "",
            at: new Date().toISOString(),
          });
          saveSuggestions(rows);
        }
        hideMenu();
      }
    });

    card.addEventListener("click", function (e) {
      var back = e.target && e.target.closest("[data-api-define-back]");
      if (!back) return;
      var prev = stack.pop();
      if (!prev) return;
      var rect = card.getBoundingClientRect();
      paintCard(prev, rect.left, rect.top);
    });

    document.addEventListener("click", function (e) {
      if (Date.now() < ignoreClickUntil) return;
      if (menu.contains(e.target) || card.contains(e.target)) return;
      if (String(window.getSelection() || "").trim()) return;
      hideAll();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!menu.hidden) {
        hideMenu();
        return;
      }
      if (!card.hidden && stack.length) {
        var prev = stack.pop();
        var rect = card.getBoundingClientRect();
        paintCard(prev, rect.left, rect.top);
        return;
      }
      hideAll();
    });
  }

  function setPane(name) {
    name = name === "chains" ? "chains" : "logic";
    document.querySelectorAll(".api-subtab").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-api-pane") === name);
    });
    document.querySelectorAll(".api-pane").forEach(function (pane) {
      pane.hidden = pane.getAttribute("data-api-pane") !== name;
    });
    if (name === "chains") onShow();
  }

  function boot() {
    if (!$("panel-api")) return;
    document.querySelectorAll(".api-subtab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setPane(btn.getAttribute("data-api-pane"));
      });
    });
    bindUi();
    bindDefiner();
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