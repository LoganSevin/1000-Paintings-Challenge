/**
 * Viral — unique spell chains → newly generated image → TikTok video.
 */
(function () {
  "use strict";

  var CAST_TRAY_SLICE = 36;
  var FETCH_TIMEOUT_MS = 120000;
  var POLL_INTERVAL_MS = 900;
  var FIRST_POLL_DELAY_MS = 600;
  var VIDEO_POLL_MS = 800;
  var VIDEO_POLL_MAX_MS = 12 * 60 * 1000;
  var CLIP_SEC = 5;
  var LIFE_CAST_RETRIES = 2;
  var LIFE_PLAYBACK_ACCEL = 1.45;
  var LIFE_CAPTURE_FPS = 30;

  var LIFE_TEMPO_HINT =
    "MOTION TEMPO: normal real-time speed — NOT slow motion, NOT glacial drift, NOT timelapse-slow. " +
    "Motion must be clearly visible within the first second. TikTok scroll-stop energy; punchy and alive.";

  var CHAIN_OPS = ["ingest", "fuse", "transform", "refine", "emit"];
  var BASE_TAGS = ["1000PaintingsChallenge", "ArtTok", "AIArt", "OriginalArt", "PainterOfTikTok", "FYP"];

  var CHAIN_ARCS = [
    { id: "threshold", label: "Threshold crossing", hint: "Ingest → fuse → transform → emit" },
    { id: "collision", label: "Mood collision", hint: "Two palettes collide, then crystallize" },
    { id: "spiral", label: "Spiral refine", hint: "Same motif refined deeper each step" },
    { id: "fracture", label: "Fracture & rebuild", hint: "Break apart, then recombine" },
    { id: "echo", label: "Echo chamber", hint: "Motifs echo and amplify" },
    { id: "oracle", label: "Oracle emit", hint: "Mystery ingest, bold final reveal" },
  ];

  var TOPICS = [
    { id: "challenge", label: "1000 Paintings grind", hook: "POV: painting #{n} of 1000 just changed the algorithm" },
    { id: "surreal", label: "Surreal scroll-stop", hook: "I chained {k} spells and THIS came out" },
    { id: "process", label: "Process magic", hook: "Watch a unique spell chain become one frame" },
    { id: "story", label: "Story drop", hook: "The chain told a story before the image existed" },
    { id: "reveal", label: "Final reveal", hook: "Nobody expected step {k} to dominate the fusion" },
    { id: "niche", label: "Niche art FYP", hook: "For everyone who needs weirder originals on their feed" },
  ];

  var LIFE_PROMPTS = [
    "Energetic living painting — quick breaths, rapid blinks, fabric flutters, hair sways in wind. Bold visible motion; camera locked.",
    "Dynamic atmosphere — clouds roll fast, light sweeps across brushstrokes, particles swirl, shadows shift noticeably.",
    "Painterly surge — pigment shimmers and pulses, glaze flashes with light, edges throb with alive texture. Fast internal motion.",
    "Awakening rush — reflections ripple quickly, atmosphere churns, parallax inside the scene. Hypnotic but NOT slow.",
    "Living storm — wind whips, glow pulses, liquid and smoke move with real energy. Locked camera, fast world inside the frame.",
  ];

  var LIFE_VARIANT_LABELS = [
    "Quick breath",
    "Fast atmosphere",
    "Painterly surge",
    "Awakening rush",
    "Living storm",
  ];

  var DEFAULT_BOARD_COUNT = 4;

  var state = {
    pool: [],
    poolReady: false,
    trayItems: [],
    arcId: "threshold",
    topicId: "challenge",
    chainLen: 4,
    variantCount: 3,
    boardCount: DEFAULT_BOARD_COUNT,
    boards: [],
    activeBoardId: "",
    swapTarget: null,
    seed: null,
    chain: null,
    fusedPrompt: "",
    post: null,
    selectedVariantId: "",
    history: [],
    drag: null,
    active: false,
    forging: false,
    exporting: false,
    blobUrls: [],
    previewImageUrl: "",
    feedObserver: null,
    feedVariants: [],
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

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shuffle(arr) {
    var copy = arr.slice();
    var i;
    for (i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    return copy;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function uniqueId() {
    return "vi-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
  }

  function absoluteUrl(url) {
    if (!url) return "";
    if (url.indexOf("blob:") === 0 || url.indexOf("data:") === 0) return url;
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

  function mediaProxyUrl(url) {
    url = absoluteUrl(url);
    if (!url || url.indexOf("blob:") === 0 || url.indexOf("data:") === 0) return url;
    if (isSameOriginUrl(url)) return url;
    return apiUrl("/api/proxy-media?url=" + encodeURIComponent(url));
  }

  function trackBlobUrl(url) {
    if (url && url.indexOf("blob:") === 0) state.blobUrls.push(url);
  }

  function revokeBlobUrls() {
    state.blobUrls.forEach(function (u) {
      try {
        URL.revokeObjectURL(u);
      } catch (eRevoke) {}
    });
    state.blobUrls = [];
  }

  function setStatus(msg, kind) {
    var el = $("vi-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "vi-status" + (kind ? " " + kind : "");
  }

  function setPipelineStep(step) {
    document.querySelectorAll(".vi-pipe-step").forEach(function (el) {
      var s = el.getAttribute("data-step");
      el.classList.toggle("active", s === step);
      el.classList.toggle("done", step === "image" && s === "chain" || step === "video" && (s === "chain" || s === "image") || step === "done");
    });
  }

  function normalizeSpell(item) {
    var num = item.paintingNum || item.number || 0;
    var analysis = num && window.getGalleryAnalysis ? window.getGalleryAnalysis(num) : item.analysis || null;
    return {
      url: item.url || "",
      label: item.label || (num ? "#" + num : "Spell"),
      paintingNum: num,
      title: item.title || (analysis && analysis.title) || item.label || "",
      description: (analysis && analysis.description) || item.description || "",
      tags: item.tags || (analysis && analysis.tags) || [],
      colors: item.colors || (analysis && analysis.colors) || [],
      style: (analysis && analysis.style) || item.style || "",
      mood: (analysis && analysis.mood) || item.mood || "",
      analysis: analysis,
    };
  }

  function spellRow(m) {
    var num = m.number;
    return normalizeSpell({
      number: num,
      url: window.getPaintingUrl ? window.getPaintingUrl(num) : "paintings/" + num + ".jpg",
      paintingNum: num,
      label: "#" + num,
    });
  }

  function operationForIndex(idx, total, arcId) {
    if (total <= 1) return "emit";
    if (arcId === "fracture" && idx === Math.floor(total / 2)) return "transform";
    if (arcId === "oracle" && idx === 0) return "ingest";
    if (arcId === "oracle" && idx === total - 1) return "emit";
    if (idx === 0) return "ingest";
    if (idx === total - 1) return "emit";
    if (idx === total - 2 && total > 2) return "refine";
    return idx % 2 === 1 ? "fuse" : "transform";
  }

  function getActiveBoard() {
    var i;
    for (i = 0; i < state.boards.length; i++) {
      if (state.boards[i].id === state.activeBoardId) return state.boards[i];
    }
    return state.boards[0] || null;
  }

  function getBoardById(id) {
    var i;
    for (i = 0; i < state.boards.length; i++) {
      if (state.boards[i].id === id) return state.boards[i];
    }
    return null;
  }

  function createBoard() {
    return {
      id: uniqueId(),
      chain: null,
      fusedPrompt: "",
      seed: null,
      status: "idle",
      statusText: "",
      pipeStep: "",
      post: null,
      selectedVariantId: "",
      forging: false,
    };
  }

  function syncActiveBoardToLegacy(board) {
    board = board || getActiveBoard();
    if (!board) {
      state.chain = null;
      state.fusedPrompt = "";
      state.post = null;
      state.selectedVariantId = "";
      state.previewImageUrl = "";
      state.feedVariants = [];
      return;
    }
    state.chain = board.chain;
    state.fusedPrompt = board.fusedPrompt;
    state.post = board.post;
    state.selectedVariantId = board.selectedVariantId;
    state.previewImageUrl = board.post && board.post.imageUrl ? board.post.imageUrl : "";
    state.feedVariants = board.post && board.post.variants ? board.post.variants : [];
  }

  function setActiveBoard(boardId) {
    var board = getBoardById(boardId);
    if (!board) return;
    state.activeBoardId = board.id;
    syncActiveBoardToLegacy(board);
    renderBoards();
    var label = $("vi-active-board-label");
    if (label) {
      label.textContent =
        "Active: Chain " + (state.boards.indexOf(board) + 1) + " — " + (board.chain && board.chain.arc ? board.chain.arc.label : "preview");
    }
    if (board.post) {
      restorePost(board.post);
    } else if (board.fusedPrompt) {
      renderFeed([]);
    } else {
      renderFeed([]);
    }
    renderDetail(board.post);
    updateActions(hasExportablePost(board.post));
  }

  function ensureBoards(count) {
    count = count == null ? state.boardCount : count;
    state.boardCount = clamp(count, 2, 8);
    while (state.boards.length < state.boardCount) {
      var nb = createBoard();
      rerollBoard(nb, true);
      state.boards.push(nb);
    }
    while (state.boards.length > state.boardCount) {
      state.boards.pop();
    }
    if (!state.activeBoardId || !getBoardById(state.activeBoardId)) {
      state.activeBoardId = state.boards[0] ? state.boards[0].id : "";
    }
    renderBoards();
    if (state.activeBoardId) setActiveBoard(state.activeBoardId);
  }

  function pickChainSpells(len, arcId, seed) {
    var pool = state.pool.slice();
    if (seed) {
      pool = pool.filter(function (s) {
        return s.paintingNum !== seed.paintingNum;
      });
    }
    pool = shuffle(pool);
    var picked = [];
    var usedStyles = {};
    var i;
    if (seed) picked.push(seed);
    for (i = 0; i < pool.length && picked.length < len; i++) {
      var s = pool[i];
      if (!s.url) continue;
      var style = s.style || "mixed";
      if (picked.length < len - 1 && usedStyles[style] > 1 && Math.random() > 0.35) continue;
      usedStyles[style] = (usedStyles[style] || 0) + 1;
      picked.push(s);
    }
    while (picked.length < len && pool[picked.length]) {
      picked.push(pool[picked.length]);
    }
    return picked.slice(0, len);
  }

  function buildUniqueChainForBoard(board) {
    var len = state.chainLen;
    var arc = CHAIN_ARCS.find(function (a) {
      return a.id === state.arcId;
    }) || CHAIN_ARCS[0];
    var topic = TOPICS.find(function (t) {
      return t.id === state.topicId;
    }) || TOPICS[0];
    var spells = pickChainSpells(len, arc.id, board && board.seed ? board.seed : state.seed);
    var steps = spells.map(function (spell, idx) {
      return {
        step: idx + 1,
        operation: operationForIndex(idx, spells.length, arc.id),
        spell: spell,
        painting_num: spell.paintingNum,
        url: spell.url,
        title: spell.title,
        description: spell.description,
        tags: spell.tags,
        style: spell.style,
        mood: spell.mood,
      };
    });
    return {
      id: uniqueId(),
      arc: arc,
      topic: topic,
      steps: steps,
      createdAt: Date.now(),
    };
  }

  function buildUniqueChain() {
    return buildUniqueChainForBoard({ seed: state.seed });
  }

  function rerollBoard(board, silent) {
    if (!board) return;
    board.chain = buildUniqueChainForBoard(board);
    board.fusedPrompt = fuseChainPrompt(board.chain, board.chain.topic);
    board.post = null;
    board.selectedVariantId = "";
    board.status = "idle";
    board.statusText = "";
    board.pipeStep = "";
    if (!silent) renderBoards();
    if (board.id === state.activeBoardId) {
      syncActiveBoardToLegacy(board);
      renderFeed([]);
      renderDetail(null);
      updateActions(false);
    }
  }

  function replaceStepSpell(board, stepIndex, spellItem) {
    if (!board || !board.chain || !board.chain.steps[stepIndex]) return;
    var spell = normalizeSpell(spellItem);
    if (!spell.url) return;
    var step = board.chain.steps[stepIndex];
    var dup = false;
    var i;
    for (i = 0; i < board.chain.steps.length; i++) {
      if (i !== stepIndex && board.chain.steps[i].painting_num === spell.paintingNum) dup = true;
    }
    if (dup) {
      setStatus("That painting is already in this chain — pick another.", "error");
      return;
    }
    step.spell = spell;
    step.painting_num = spell.paintingNum;
    step.url = spell.url;
    step.title = spell.title;
    step.description = spell.description;
    step.tags = spell.tags;
    step.style = spell.style;
    step.mood = spell.mood;
    step.operation = operationForIndex(stepIndex, board.chain.steps.length, board.chain.arc.id);
    board.fusedPrompt = fuseChainPrompt(board.chain, board.chain.topic);
    board.post = null;
    board.selectedVariantId = "";
    board.status = "idle";
    state.swapTarget = null;
    renderBoards();
    if (board.id === state.activeBoardId) {
      syncActiveBoardToLegacy(board);
      renderFeed([]);
      renderDetail(null);
      updateActions(false);
    }
    setStatus("Swapped step " + (stepIndex + 1) + " — forge to see the new hybrid form.", "ok");
  }

  function randomSwapStep(board, stepIndex) {
    var pool = shuffle(state.pool).filter(function (s) {
      if (!s.url) return false;
      var j;
      for (j = 0; j < board.chain.steps.length; j++) {
        if (j !== stepIndex && board.chain.steps[j].painting_num === s.paintingNum) return false;
      }
      return true;
    });
    if (!pool.length) return;
    replaceStepSpell(board, stepIndex, pool[0]);
  }

  function fuseChainPrompt(chain, topic) {
    var lines = [
      "VIRAL TIKTOK CHAIN — unique fusion arc: " + chain.arc.label + ".",
      "Topic angle: " + topic.label + ".",
      "Output: ONE never-before-seen vertical fine-art frame for TikTok (9:16).",
      "CRITICAL — SYNTHESIZE A NEW HYBRID ENTITY: crossbreed spell DNA into one unprecedented form.",
      "BAN: collage, diptych, triptych, slideshow, side-by-side panels, floating copies of source paintings.",
      "Spells are ingredients — the output must look born from their fusion, not arranged beside them.",
    ];
    chain.steps.forEach(function (step) {
      var op = step.operation;
      var s = step.spell;
      var prefix = step.painting_num ? "#" + step.painting_num + " " : "";
      var desc = String(s.description || "").trim().slice(0, 220);
      var tagText = (s.tags || []).slice(0, 6).join(", ");
      if (op === "ingest") lines.push("[ingest] Open with " + prefix + s.title + ". " + desc);
      else if (op === "emit") lines.push("[emit] Final TikTok frame as " + prefix + s.title + " — " + tagText);
      else if (op === "refine") lines.push("[refine] Polish through " + prefix + s.title + " (" + tagText + ")");
      else if (op === "transform") lines.push("[transform] Mutate via " + prefix + s.title + " — mood: " + (s.mood || "layered"));
      else lines.push("[fuse] Blend " + prefix + s.title + " — " + tagText);
    });
    lines.push("Chain signature: " + chain.id);
    return lines.join("\n");
  }

  function buildBuzz(chain) {
    var buzz = ["viral chain", "tiktok vertical", "original fusion"];
    chain.steps.forEach(function (step) {
      (step.tags || []).slice(0, 3).forEach(function (t) {
        if (buzz.indexOf(t) < 0) buzz.push(t);
      });
    });
    return buzz;
  }

  function paintingNumsFromChain(chain) {
    return chain.steps
      .map(function (s) {
        return s.painting_num;
      })
      .filter(Boolean);
  }

  function buildHook(chain, topic) {
    var k = chain.steps.length;
    var last = chain.steps[chain.steps.length - 1];
    var n = last && last.painting_num ? last.painting_num : "";
    var hook = topic.hook.replace("{k}", String(k)).replace("{n}", String(n));
    return hook + ' — "' + (last.spell.title || "Untitled") + '"';
  }

  function buildCaption(chain, topic) {
    var ops = chain.steps
      .map(function (s, i) {
        return (i + 1) + ". [" + s.operation + "] #" + s.painting_num + " " + s.title;
      })
      .join("\n");
    return (
      "Unique spell chain → brand-new frame.\n\n" +
      "Arc: " +
      chain.arc.label +
      "\n" +
      ops +
      "\n\n" +
      "Part of my 1000 Paintings Challenge — follow for the next chain."
    );
  }

  function buildHashtags(chain, topic) {
    var tags = BASE_TAGS.concat([topic.id.replace(/[^a-z0-9]/gi, ""), "SpellChain", "GenerativeArt"]);
    chain.steps.forEach(function (s) {
      (s.tags || []).slice(0, 2).forEach(function (t) {
        tags.push(String(t).replace(/[^a-z0-9]/gi, ""));
      });
    });
    var seen = {};
    return tags
      .filter(function (t) {
        var k = t.toLowerCase();
        if (!t || seen[k]) return false;
        seen[k] = 1;
        return true;
      })
      .slice(0, 14)
      .map(function (t) {
        return "#" + t;
      })
      .join(" ");
  }

  function renderBoards() {
    var el = $("vi-boards");
    if (!el) return;
    if (!state.boards.length) {
      el.innerHTML = '<p class="vi-chain-empty">Add chain panels to begin.</p>';
      return;
    }
    el.innerHTML = state.boards
      .map(function (board, boardIdx) {
        var chain = board.chain;
        var stepsHtml = "";
        if (chain && chain.steps.length) {
          stepsHtml = chain.steps
            .map(function (step, idx) {
              var swapOn =
                state.swapTarget &&
                state.swapTarget.boardId === board.id &&
                state.swapTarget.stepIndex === idx;
              return (
                '<div class="vi-board-step' +
                (swapOn ? " swap-target" : "") +
                '" data-board="' +
                escapeHtml(board.id) +
                '" data-step="' +
                idx +
                '">' +
                '<button type="button" class="vi-board-step-swap" data-board="' +
                escapeHtml(board.id) +
                '" data-step="' +
                idx +
                '" title="Random swap">↻</button>' +
                '<img src="' +
                escapeHtml(step.url) +
                '" alt="" />' +
                '<span class="vi-board-step-op">' +
                escapeHtml(step.operation) +
                "</span>" +
                '<span class="vi-board-step-num">#' +
                escapeHtml(step.painting_num) +
                "</span></div>"
              );
            })
            .join("");
        }
        var preview =
          board.post && board.post.imageUrl
            ? '<img class="vi-board-preview" src="' + escapeHtml(absoluteUrl(board.post.imageUrl)) + '" alt="" />'
            : "";
        return (
          '<article class="vi-board' +
          (board.id === state.activeBoardId ? " active" : "") +
          (board.status === "forging" || board.forging ? " forging" : "") +
          (board.status === "done" ? " done" : "") +
          '" data-board-id="' +
          escapeHtml(board.id) +
          '">' +
          '<div class="vi-board-head">' +
          '<h3 class="vi-board-title">Chain ' +
          (boardIdx + 1) +
          " · " +
          escapeHtml(chain && chain.arc ? chain.arc.label : "—") +
          "</h3>" +
          '<span class="vi-board-status ' +
          escapeHtml(board.status || "idle") +
          '">' +
          escapeHtml(board.statusText || board.status || "ready") +
          "</span></div>" +
          '<div class="vi-board-chain">' +
          stepsHtml +
          "</div>" +
          preview +
          '<pre class="vi-board-fused">' +
          escapeHtml((board.fusedPrompt || "").slice(0, 280)) +
          (board.fusedPrompt && board.fusedPrompt.length > 280 ? "…" : "") +
          "</pre>" +
          '<div class="vi-board-actions">' +
          '<button type="button" class="vi-btn accent vi-board-forge" data-board="' +
          escapeHtml(board.id) +
          '">Forge</button>' +
          '<button type="button" class="vi-btn vi-board-reroll" data-board="' +
          escapeHtml(board.id) +
          '">Reroll</button></div></article>'
        );
      })
      .join("");
  }

  function renderChain(chain) {
    renderBoards();
  }

  function renderFused(text) {
    var board = getActiveBoard();
    if (board) board.fusedPrompt = text || board.fusedPrompt;
    renderBoards();
  }

  function renderDetail(post) {
    var detail = $("vi-detail");
    if (!post) {
      if (detail) detail.hidden = true;
      updateActions(false);
      return;
    }
    if (detail) detail.hidden = false;
    var hook = $("vi-detail-hook");
    var cap = $("vi-detail-caption");
    var tags = $("vi-detail-tags");
    if (hook) hook.textContent = post.hook;
    if (cap) cap.textContent = post.caption;
    if (tags) tags.textContent = post.hashtags;
    updateActions(hasExportablePost(post));
  }

  function hasExportablePost(post) {
    if (!post) return false;
    if (post.variants && post.variants.length) {
      return post.variants.some(function (v) {
        return !v.pending && !v.failed;
      });
    }
    return !!(post.videoUrl || post.imageUrl);
  }

  function updateActions(enabled) {
    ["vi-copy-caption", "vi-export-tiktok", "vi-open-tiktok"].forEach(function (id) {
      var btn = $(id);
      if (btn) btn.disabled = !enabled || state.forging || state.exporting;
    });
  }

  function getSelectedVariant() {
    if (!state.post || !state.post.variants || !state.post.variants.length) return null;
    var i;
    for (i = 0; i < state.post.variants.length; i++) {
      if (state.post.variants[i].id === state.selectedVariantId) return state.post.variants[i];
    }
    return state.post.variants[0];
  }

  function getVariantById(id) {
    var pools = [];
    if (state.post && state.post.variants) pools.push(state.post.variants);
    if (state.feedVariants && state.feedVariants.length) pools.push(state.feedVariants);
    var p;
    var i;
    for (p = 0; p < pools.length; p++) {
      for (i = 0; i < pools[p].length; i++) {
        if (pools[p][i].id === id) return pools[p][i];
      }
    }
    return null;
  }

  function variantVideoSrc(variant) {
    if (!variant) return "";
    var raw = variant.videoUrl || variant.playUrl || "";
    return absoluteUrl(raw);
  }

  function setVideoElementSrc(vid, url) {
    if (!vid || !url) return false;
    if (vid.src === url || vid.currentSrc === url) return false;
    vid.src = url;
    vid.load();
    return true;
  }

  function pauseAllFeedVideos() {
    document.querySelectorAll("#vi-feed-track video").forEach(function (v) {
      try {
        v.pause();
      } catch (ePause) {}
    });
  }

  function renderFeedRail(variants) {
    var rail = $("vi-feed-rail");
    if (!rail) return;
    if (!variants || variants.length < 2) {
      rail.innerHTML = "";
      rail.setAttribute("aria-hidden", "true");
      return;
    }
    rail.innerHTML = variants
      .map(function (v) {
        return (
          '<span class="vi-feed-dot' +
          (v.id === state.selectedVariantId ? " active" : "") +
          '" data-dot="' +
          escapeHtml(v.id) +
          '"></span>'
        );
      })
      .join("");
    rail.setAttribute("aria-hidden", "false");
  }

  function feedSlideHtml(v) {
    var thumb = v.posterUrl || state.previewImageUrl || (state.post && state.post.imageUrl) || "";
    if (v.isImagePreview) {
      return (
        '<article class="vi-feed-slide" data-variant="' +
        escapeHtml(v.id) +
        '">' +
        '<img src="' +
        escapeHtml(absoluteUrl(thumb)) +
        '" alt="Generated frame preview" />' +
        '<span class="vi-feed-label">Generated frame</span></article>'
      );
    }
    if (v.pending) {
      return (
        '<article class="vi-feed-slide is-pending" data-variant="' +
        escapeHtml(v.id) +
        '">' +
        (thumb ? '<img class="vi-feed-poster" src="' + escapeHtml(absoluteUrl(thumb)) + '" alt="" />' : "") +
        '<span class="vi-feed-spinner" aria-hidden="true"></span>' +
        '<span class="vi-feed-label">' +
        escapeHtml(v.label) +
        '</span><span class="vi-feed-meta">Bringing to life…</span></article>'
      );
    }
    if (v.failed) {
      return (
        '<article class="vi-feed-slide is-failed" data-variant="' +
        escapeHtml(v.id) +
        '">' +
        (thumb ? '<img class="vi-feed-poster" src="' + escapeHtml(absoluteUrl(thumb)) + '" alt="" />' : "") +
        '<span class="vi-feed-label">' +
        escapeHtml(v.label) +
        '</span><span class="vi-feed-meta">' +
        escapeHtml(v.error || "Life cast failed") +
        '</span><button type="button" class="vi-feed-retry" data-retry-variant="' +
        escapeHtml(v.id) +
        '">Retry</button></article>'
      );
    }
    var src = variantVideoSrc(v);
    return (
      '<article class="vi-feed-slide" data-variant="' +
      escapeHtml(v.id) +
      '" data-video-src="' +
      escapeHtml(src) +
      '">' +
      (thumb ? '<img class="vi-feed-poster" src="' + escapeHtml(absoluteUrl(thumb)) + '" alt="" />' : "") +
      '<video playsinline webkit-playsinline loop muted preload="auto"' +
      (src ? ' src="' + escapeHtml(src) + '"' : "") +
      "></video>" +
      '<button type="button" class="vi-feed-play" aria-label="Play ' +
      escapeHtml(v.label) +
      '">▶</button>' +
      '<span class="vi-feed-label">' +
      escapeHtml(v.label) +
      '</span><span class="vi-feed-meta">' +
      escapeHtml(v.lifeLabel || v.idleLabel || "AI life") +
      "</span></article>"
    );
  }

  function bindFeedObserver() {
    var track = $("vi-feed-track");
    if (!track) return;
    if (state.feedObserver) {
      state.feedObserver.disconnect();
      state.feedObserver = null;
    }
    if (!window.IntersectionObserver) return;

    state.feedObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var slide = entry.target;
          var vid = slide.querySelector("video");
          if (entry.isIntersecting && entry.intersectionRatio >= 0.55) {
            pauseAllFeedVideos();
            playFeedSlide(slide);
          } else if (vid) {
            vid.pause();
          }
        });
      },
      { root: track, threshold: [0.35, 0.6, 0.85] }
    );

    track.querySelectorAll(".vi-feed-slide").forEach(function (slide) {
      if (!slide.classList.contains("vi-feed-empty")) state.feedObserver.observe(slide);
    });
  }

  function bindFeedInteractions() {
    var track = $("vi-feed-track");
    if (!track || track._viFeedBound) return;
    track._viFeedBound = true;
    track.addEventListener("click", function (e) {
      var retryBtn = e.target.closest(".vi-feed-retry");
      if (retryBtn) {
        retryLifeVariant(retryBtn.getAttribute("data-retry-variant"));
        return;
      }
      var playBtn = e.target.closest(".vi-feed-play");
      if (!playBtn) return;
      var slide = playBtn.closest(".vi-feed-slide");
      var vid = slide && slide.querySelector("video");
      if (!vid) return;
      vid.muted = false;
      vid
        .play()
        .then(function () {
          playBtn.hidden = true;
          var poster = slide.querySelector(".vi-feed-poster");
          if (poster) poster.classList.add("is-hidden");
        })
        .catch(function () {
          setStatus("Tap ▶ again or scroll to another option.", "ok");
        });
    });
  }

  function updateVariantStripActive(variantId) {
    var strip = $("vi-variants");
    if (strip) {
      strip.querySelectorAll(".vi-variant-card").forEach(function (card) {
        card.classList.toggle("active", card.getAttribute("data-variant") === variantId);
      });
    }
    renderFeedRail(state.post && state.post.variants ? state.post.variants : state.feedVariants);
  }

  function playFeedSlide(slide) {
    if (!slide || slide.classList.contains("is-pending") || slide.classList.contains("vi-feed-empty")) return;

    var variantId = slide.getAttribute("data-variant");
    if (variantId && variantId !== "preview-image") {
      state.selectedVariantId = variantId;
      updateVariantStripActive(variantId);
    }

    var vid = slide.querySelector("video");
    if (!vid) return;

    var variant = getVariantById(variantId);
    var src = slide.getAttribute("data-video-src") || (variant ? variantVideoSrc(variant) : "") || vid.currentSrc || "";
    if (!src) {
      setStatus("No video URL for this option.", "error");
      return;
    }
    slide.setAttribute("data-video-src", src);

    var playBtn = slide.querySelector(".vi-feed-play");
    var poster = slide.querySelector(".vi-feed-poster");

    vid.controls = true;
    vid.muted = true;
    vid.playsInline = true;
    vid.loop = true;
    vid.preload = "auto";
    vid.setAttribute("playsinline", "");
    vid.setAttribute("webkit-playsinline", "");

    function showPoster() {
      vid.classList.remove("is-playing");
      if (poster) poster.classList.remove("is-hidden");
    }

    function hidePoster() {
      vid.classList.add("is-playing");
      if (poster) poster.classList.add("is-hidden");
      if (playBtn) playBtn.hidden = true;
    }

    function showPlayBtn() {
      if (playBtn) playBtn.hidden = false;
      showPoster();
    }

    function attemptPlay() {
      return vid.play().then(hidePoster).catch(showPlayBtn);
    }

    function loadSrc(url, errFlag) {
      if (!url) return;
      slide.setAttribute("data-video-src", url);
      if (variant && errFlag) variant[errFlag] = true;
      setVideoElementSrc(vid, url);
      showPoster();
      if (vid.readyState >= 2) {
        attemptPlay();
        return;
      }
      vid.addEventListener(
        "loadeddata",
        function onLoaded() {
          vid.removeEventListener("loadeddata", onLoaded);
          attemptPlay();
        },
        { once: true }
      );
      setTimeout(attemptPlay, 1500);
    }

    vid.onplaying = hidePoster;
    vid.onerror = function () {
      if (variant && variant.videoUrl && !variant._triedProxy && !isSameOriginUrl(variant.videoUrl)) {
        loadSrc(mediaProxyUrl(variant.videoUrl), "_triedProxy");
        return;
      }
      showPlayBtn();
      setStatus("Video failed to load — tap ▶ or try another option.", "error");
    };

    if (!setVideoElementSrc(vid, src) && vid.readyState >= 2) {
      attemptPlay();
      return;
    }
    showPoster();
    if (vid.readyState >= 2) {
      attemptPlay();
      return;
    }
    vid.addEventListener(
      "loadeddata",
      function onLoaded() {
        vid.removeEventListener("loadeddata", onLoaded);
        attemptPlay();
      },
      { once: true }
    );
    setTimeout(attemptPlay, 1500);
  }

  function renderFeed(variants) {
    var track = $("vi-feed-track");
    if (!track) return;
    variants = variants || [];

    if (!variants.length && !state.previewImageUrl) {
      track.innerHTML =
        '<article class="vi-feed-slide vi-feed-empty" id="vi-feed-empty">' +
        "<p>Forge to generate videos — then scroll ↕ between options like TikTok.</p></article>";
      renderFeedRail([]);
      return;
    }

    if (!variants.length && state.previewImageUrl) {
      variants = [
        {
          id: "preview-image",
          label: "Generated frame",
          pending: false,
          isImagePreview: true,
          posterUrl: state.previewImageUrl,
        },
      ];
    }

    track.innerHTML = variants.map(feedSlideHtml).join("");
    renderFeedRail(variants);
    bindFeedInteractions();
    bindFeedObserver();

    var sel = state.selectedVariantId || (variants[0] && variants[0].id);
    var target = sel && track.querySelector('.vi-feed-slide[data-variant="' + sel + '"]');
    var targetVariant = sel && variants.find(function (v) {
      return v.id === sel;
    });
    if (target && targetVariant && !targetVariant.pending && !targetVariant.isImagePreview) {
      requestAnimationFrame(function () {
        target.scrollIntoView({ block: "start" });
        playFeedSlide(target);
      });
    }
  }

  function showGeneratedImage(url) {
    state.previewImageUrl = url || "";
    renderFeed([]);
  }

  function scrollFeedToVariant(variantId) {
    var track = $("vi-feed-track");
    if (!track) return;
    var slide = track.querySelector('.vi-feed-slide[data-variant="' + variantId + '"]');
    if (slide) slide.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderVariants(variants, options) {
    options = options || {};
    state.feedVariants = variants || [];
    var el = $("vi-variants");
    if (!el) return;
    if (!variants || !variants.length) {
      el.innerHTML = '<p class="vi-history-empty">Video options appear after forge.</p>';
      if (options.refreshFeed !== false) renderFeed([]);
      return;
    }
    el.innerHTML = variants
      .map(function (v) {
        var thumb = v.posterUrl || (state.post && state.post.imageUrl) || "";
        return (
          '<button type="button" class="vi-variant-card' +
          (v.id === state.selectedVariantId ? " active" : "") +
          (v.pending ? " is-pending" : "") +
          (v.failed ? " is-failed" : "") +
          '" data-variant="' +
          escapeHtml(v.id) +
          '">' +
          (thumb ? '<img class="vi-variant-thumb" src="' + escapeHtml(absoluteUrl(thumb)) + '" alt="" />' : '<span class="vi-variant-thumb"></span>') +
          '<span class="vi-variant-label">' +
          escapeHtml(v.label) +
          "</span>" +
      '<span class="vi-variant-meta">' +
      escapeHtml(v.failed ? "Failed" : v.lifeLabel || v.idleLabel || "AI life") +
      "</span></button>"
        );
      })
      .join("");
    if (options.refreshFeed !== false) renderFeed(variants);
    else updateVariantStripActive(state.selectedVariantId);
  }

  function selectVariant(variantId) {
    var board = getActiveBoard();
    var variants = (board && board.post && board.post.variants) || state.feedVariants || [];
    var variant = null;
    var i;
    for (i = 0; i < variants.length; i++) {
      if (variants[i].id === variantId) {
        variant = variants[i];
        break;
      }
    }
    if (!variant || variant.pending || variant.failed) return;
    state.selectedVariantId = variant.id;
    if (board) board.selectedVariantId = variant.id;
    updateVariantStripActive(variant.id);
    scrollFeedToVariant(variant.id);
    var slide = document.querySelector('.vi-feed-slide[data-variant="' + variant.id + '"]');
    if (slide) playFeedSlide(slide);
  }

  function renderHistory() {
    var el = $("vi-history");
    if (!el) return;
    if (!state.history.length) {
      el.innerHTML = '<p class="vi-history-empty">Past forges in this session appear here.</p>';
      return;
    }
    el.innerHTML = state.history
      .slice(0, 8)
      .map(function (h) {
        return (
          '<button type="button" class="vi-history-card" data-id="' +
          escapeHtml(h.id) +
          '">' +
          (h.thumb
            ? '<img src="' + escapeHtml(h.thumb) + '" alt="" />'
            : "") +
          '<span class="vi-history-hook">' +
          escapeHtml(h.hook) +
          "</span></button>"
        );
      })
      .join("");
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

  function imageUrlToDataUrl(url) {
    if (!url) return Promise.resolve("");
    if (url.indexOf("data:") === 0) return Promise.resolve(url);
    return fetch(url)
      .then(function (r) {
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

  function pollImageJob(jobId, attemptsLeft, firstPoll) {
    if (attemptsLeft == null) attemptsLeft = 90;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Image generation timed out."));
    var pollOnce = function () {
      return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), { cache: "no-store" }, 30000);
    };
    var start = firstPoll
      ? delay(FIRST_POLL_DELAY_MS).then(pollOnce)
      : pollOnce();
    return start
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (job) {
        setStatus("Generating image… (" + (job.status || "working") + ")", "pending");
        if (job.status === "done") {
          var img = job.image || (job.images && job.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        }
        if (job.status === "failed") {
          throw new Error((job.error && job.error.message) || "Image generation failed.");
        }
        return delay(POLL_INTERVAL_MS).then(function () {
          return pollImageJob(jobId, attemptsLeft - 1, false);
        });
      });
  }

  function pollVideoJob(jobId, startedAt) {
    startedAt = startedAt || Date.now();
    if (Date.now() - startedAt > VIDEO_POLL_MAX_MS) {
      return Promise.reject(new Error("Video generation timed out."));
    }
    return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), { cache: "no-store" }, 30000)
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (job) {
        setStatus("Bringing painting to life… (" + (job.status || "working") + ")", "pending");
        if (job.status === "done") {
          var vid = job.video;
          var url =
            (vid && (vid.url || vid.download_url || vid.uri)) ||
            job.video_url ||
            job.output_url ||
            job.result_url;
          if (window.GallerySaveVideo && window.GallerySaveVideo.preferSavedUrl) {
            url = window.GallerySaveVideo.preferSavedUrl(job, url);
          }
          if (url) return absoluteUrl(url);
          throw new Error("No video URL returned.");
        }
        if (job.status === "failed" || job.status === "expired") {
          throw new Error((job.error && (job.error.message || job.error)) || "Video failed.");
        }
        return delay(VIDEO_POLL_MS).then(function () {
          return pollVideoJob(jobId, startedAt);
        });
      });
  }

  function generateChainImageLocal(chain, fused) {
    var nums = paintingNumsFromChain(chain);
    if (!window.composeStasisVisionLocal || nums.length < 2) {
      return Promise.reject(new Error("Local image fusion unavailable."));
    }
    return window.composeStasisVisionLocal({
      spells: nums,
      stasis: fused,
      buzz_words: buildBuzz(chain),
    });
  }

  function generateChainImageCloud(chain, fused) {
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "vi-img-" + Date.now();
    var nums = paintingNumsFromChain(chain);

    return fetchWithTimeout(
      apiUrl("/api/generate-stasis-vision"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          stasis: fused,
          craft_hints:
            "TikTok viral vertical — synthesize spells into ONE new hybrid entity. No collage, no slideshow, no side-by-side source paintings. Emergent fused form only.",
          buzz_words: buildBuzz(chain),
          spells: nums,
          aspect_ratio: "9:16",
          mag_fresh: true,
          fresh_variation: true,
          refine: false,
          spell_cast: true,
          prompt: chain.topic.label,
        }),
      },
      FETCH_TIMEOUT_MS
    )
      .then(function (r) {
        if (r.status === 202) {
          return r.json().then(function (d) {
            return pollImageJob((d && d.job_id) || jobId, null, true);
          });
        }
        return parseApiResponse(r).then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Image generate failed");
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        });
      });
  }

  function generateChainImage(chain, fused) {
    return generateChainImageCloud(chain, fused).catch(function (err) {
      setStatus("Cloud image failed — trying local fusion…", "pending");
      return generateChainImageLocal(chain, fused).catch(function () {
        throw err;
      });
    });
  }

  function materializeVideoVariant(rawUrl, chain, idx, motion, options) {
    options = options || {};
    var label = options.label || "Life " + String.fromCharCode(65 + idx);
    var id = chain.id + "-v" + idx;
    var url = absoluteUrl(rawUrl);
    var culminationUrl = options.culminationUrl || "";
    var variant = {
      id: id,
      label: label,
      motion: motion,
      videoUrl: url,
      playUrl: url.indexOf("blob:") === 0 ? url : "",
      blob: null,
      lifeLabel: options.lifeLabel || "",
      pending: false,
      failed: false,
      posterUrl: culminationUrl || "",
    };

    function afterSave(saved) {
      if (saved && saved.url) {
        variant.videoUrl = absoluteUrl(saved.url);
        variant.savedName = saved.name;
        if (variant.playUrl && variant.playUrl.indexOf("blob:") !== 0) {
          variant.playUrl = variant.videoUrl;
        }
      }
      return variant;
    }

    var saveP =
      window.GallerySaveVideo && window.GallerySaveVideo.save
        ? window.GallerySaveVideo.save(url)
        : Promise.resolve(null);

    if (url.indexOf("blob:") === 0) {
      return fetch(url)
        .then(function (r) {
          return r.blob();
        })
        .then(function (blob) {
          variant.blob = blob;
          return saveP.then(afterSave).catch(function () {
            return variant;
          });
        })
        .catch(function () {
          return saveP.then(afterSave).catch(function () {
            return variant;
          });
        });
    }
    return saveP.then(afterSave).catch(function () {
      return variant;
    });
  }

  function resolveVideoPlaybackUrl(url) {
    url = absoluteUrl(url);
    if (!url) return Promise.resolve({ playUrl: "", blob: null });
    if (url.indexOf("blob:") === 0) {
      return fetch(url)
        .then(function (r) {
          return r.blob();
        })
        .then(function (blob) {
          return { playUrl: url, blob: blob };
        })
        .catch(function () {
          return { playUrl: url, blob: null };
        });
    }
    var fetchUrl = isSameOriginUrl(url) ? url : mediaProxyUrl(url);
    return fetch(fetchUrl, { cache: "no-store", credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("Video fetch failed");
        return r.blob();
      })
      .then(function (blob) {
        if (!blob || !blob.size) throw new Error("Video blob empty");
        var playUrl = URL.createObjectURL(blob);
        trackBlobUrl(playUrl);
        return { playUrl: playUrl, blob: blob };
      })
      .catch(function () {
        return { playUrl: mediaProxyUrl(url), blob: null };
      });
  }

  function buildLifeCastStasis(chain, fused, motion) {
    return (
      fused +
      "\n\n[PHOTO-TO-LIFE] Animate reference_image ONLY — the fused hybrid frame from this " +
      chain.steps.length +
      "-step spell chain. Bring the painting alive with bold, fast, clearly visible motion: subjects, atmosphere, light, texture. " +
      "Camera locked — NO pan, zoom, crop drift, Ken Burns, or screensaver motion. No cuts, no new objects, no scene change. " +
      "Ignore source spell thumbnails; the attached reference is the sole visual to animate. " +
      LIFE_TEMPO_HINT +
      " " +
      motion
    );
  }

  function pickRecorderMime() {
    var mime = "";
    if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
      ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].some(function (t) {
        if (MediaRecorder.isTypeSupported(t)) {
          mime = t;
          return true;
        }
        return false;
      });
    }
    return mime;
  }

  function accelerateVideoBlob(blob, rate) {
    rate = rate || LIFE_PLAYBACK_ACCEL;
    if (!blob || !blob.size || rate <= 1.02) return Promise.resolve(blob);
    var mime = pickRecorderMime();
    if (!mime || !window.MediaRecorder) return Promise.resolve(blob);

    return new Promise(function (resolve) {
      var video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      var src = URL.createObjectURL(blob);
      trackBlobUrl(src);
      var settled = false;

      function done(outBlob) {
        if (settled) return;
        settled = true;
        try {
          video.pause();
        } catch (ePause) {}
        video.removeAttribute("src");
        try {
          video.load();
        } catch (eLoad) {}
        resolve(outBlob || blob);
      }

      video.onerror = function () {
        done(blob);
      };

      video.onloadedmetadata = function () {
        var w = video.videoWidth || 720;
        var h = video.videoHeight || 1280;
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext("2d");
        if (!ctx || !canvas.captureStream) {
          done(blob);
          return;
        }

        var stream = canvas.captureStream(LIFE_CAPTURE_FPS);
        var recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5500000 });
        var chunks = [];
        recorder.ondataavailable = function (ev) {
          if (ev.data && ev.data.size) chunks.push(ev.data);
        };
        recorder.onstop = function () {
          var out = new Blob(chunks, { type: mime });
          done(out && out.size ? out : blob);
        };

        video.playbackRate = rate;
        recorder.start(120);
        video.currentTime = 0;

        function drawFrame() {
          if (settled) return;
          if (video.readyState >= 2) ctx.drawImage(video, 0, 0, w, h);
          if (video.ended || video.currentTime >= video.duration - 0.04) {
            try {
              recorder.stop();
            } catch (eStop) {
              done(blob);
            }
            return;
          }
          if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(drawFrame);
          else requestAnimationFrame(drawFrame);
        }

        video
          .play()
          .then(drawFrame)
          .catch(function () {
            done(blob);
          });

        setTimeout(function () {
          if (!settled) {
            try {
              recorder.stop();
            } catch (eTimeout) {
              done(blob);
            }
          }
        }, Math.ceil(((video.duration || CLIP_SEC) / rate + 3) * 1000));
      };

      video.src = src;
    });
  }

  function punchUpLifeCastVideo(url) {
    if (LIFE_PLAYBACK_ACCEL <= 1.02) return Promise.resolve(url);
    return resolveVideoPlaybackUrl(url)
      .then(function (res) {
        if (!res.blob || !res.blob.size) return url;
        return accelerateVideoBlob(res.blob, LIFE_PLAYBACK_ACCEL).then(function (fastBlob) {
          if (!fastBlob || fastBlob === res.blob) return res.playUrl || url;
          var fastUrl = URL.createObjectURL(fastBlob);
          trackBlobUrl(fastUrl);
          return fastUrl;
        });
      })
      .catch(function () {
        return url;
      });
  }

  function failedLifeVariant(chain, idx, imageUrl, lifeLabel, err) {
    return {
      id: chain.id + "-v" + idx,
      label: "Life " + String.fromCharCode(65 + idx),
      pending: false,
      failed: true,
      error: (err && err.message) || String(err || "Life cast failed"),
      posterUrl: imageUrl,
      lifeLabel: lifeLabel,
    };
  }

  function generateChainVideoWithMotion(imageUrl, chain, fused, motion, variantIndex) {
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "vi-vid-" + Date.now() + "-" + variantIndex;

    return imageUrlToDataUrl(imageUrl)
      .then(function (raw) {
        return compressDataUrl(raw, 1280, 0.88);
      })
      .then(function (compressed) {
        return fetchWithTimeout(
          apiUrl("/api/animate-cast"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              job_id: jobId,
              stasis: buildLifeCastStasis(chain, fused, motion),
              prompt:
                motion +
                " Animate ONLY reference_image — the fused viral TikTok frame. Photo-to-life with bold, fast, clearly visible internal motion. " +
                LIFE_TEMPO_HINT +
                " FIXED camera — absolutely NO Ken Burns, pan, zoom, or slideshow. Loopable 9:16 vertical. Arc: " +
                chain.arc.label,
              craft_hints:
                "TikTok viral photo-to-life — normal speed, energetic motion, NOT slow motion. Visible movement in first second.",
              duration: CLIP_SEC,
              spells: [],
              spell_cast: false,
              resolution: "720p",
              aspect_ratio: "9:16",
              morph_chain: false,
              culmination: true,
              chain_arc: chain.arc.id,
              chain_steps: chain.steps.length,
              reference_image: compressed,
              image_url: imageUrl,
            }),
          },
          FETCH_TIMEOUT_MS
        );
      })
      .then(function (r) {
        return parseApiResponse(r).then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Video cast failed");
          if (r.status === 202 && d.job_id) return pollVideoJob(d.job_id);
          var vid = d.video;
          var url =
            (vid && (vid.url || vid.download_url || vid.uri)) || d.video_url || d.output_url || d.result_url;
          if (url) return absoluteUrl(url);
          if (d.job_id) return pollVideoJob(d.job_id);
          throw new Error("No video job returned.");
        });
      });
  }

  function hashStr(s) {
    var h = 0;
    var i;
    for (i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * (i + 1)) | 0;
    return Math.abs(h);
  }

  function castLifeVariant(imageUrl, chain, fused, idx, attempt) {
    attempt = attempt || 0;
    var motion = LIFE_PROMPTS[(hashStr(chain.id) + idx * 7) % LIFE_PROMPTS.length];
    var lifeLabel = LIFE_VARIANT_LABELS[idx % LIFE_VARIANT_LABELS.length];
    return generateChainVideoWithMotion(imageUrl, chain, fused, motion, idx)
      .then(function (url) {
        setStatus("Punching up motion tempo for clip " + (idx + 1) + "…", "pending");
        return punchUpLifeCastVideo(url);
      })
      .then(function (url) {
        return materializeVideoVariant(url, chain, idx, motion, {
          culminationUrl: imageUrl,
          lifeLabel: lifeLabel,
        });
      })
      .catch(function (err) {
        if (attempt < LIFE_CAST_RETRIES) {
          setStatus(
            "Life cast " +
              (idx + 1) +
              " failed — retrying (" +
              (attempt + 2) +
              "/" +
              (LIFE_CAST_RETRIES + 1) +
              ")…",
            "pending"
          );
          return delay(1200).then(function () {
            return castLifeVariant(imageUrl, chain, fused, idx, attempt + 1);
          });
        }
        return failedLifeVariant(chain, idx, imageUrl, lifeLabel, err);
      });
  }

  function retryLifeVariant(variantId) {
    var board = getActiveBoard();
    if (!board || !board.post || !board.post.imageUrl || state.forging) return Promise.resolve();
    var chain = board.chain;
    if (!chain) return Promise.resolve();
    var fused = board.fusedPrompt;
    var imageUrl = board.post.imageUrl;
    var match = String(variantId || "").match(/-v(\d+)$/);
    var idx = match ? parseInt(match[1], 10) : -1;
    if (idx < 0 || idx >= state.variantCount) return Promise.resolve();

    var variants = (board.post.variants || []).slice();
    while (variants.length < state.variantCount) {
      variants.push({
        id: chain.id + "-v" + variants.length,
        label: "Life " + String.fromCharCode(65 + variants.length),
        pending: true,
        posterUrl: imageUrl,
      });
    }
    variants[idx] = {
      id: chain.id + "-v" + idx,
      label: "Life " + String.fromCharCode(65 + idx),
      pending: true,
      posterUrl: imageUrl,
    };
    board.post.variants = variants;
    if (board.id === state.activeBoardId) {
      syncActiveBoardToLegacy(board);
      renderVariants(variants);
      setStatus("Retrying life cast " + (idx + 1) + "…", "pending");
    }

    return castLifeVariant(imageUrl, chain, fused, idx, 0).then(function (variant) {
      variants[idx] = variant;
      board.post.variants = variants;
      if (board.id === state.activeBoardId) {
        syncActiveBoardToLegacy(board);
        renderVariants(variants);
        updateActions(hasExportablePost(board.post));
        if (!variant.failed) {
          state.selectedVariantId = variant.id;
          board.selectedVariantId = variant.id;
          scrollFeedToVariant(variant.id);
          var slide = document.querySelector('.vi-feed-slide[data-variant="' + variant.id + '"]');
          if (slide) playFeedSlide(slide);
          setStatus("Life cast " + (idx + 1) + " ready.", "ok");
        } else {
          setStatus(variant.error || "Life cast failed — try again.", "error");
        }
      }
    });
  }

  function forgeVideoVariants(imageUrl, chain, fused, board) {
    var variants = [];
    var pending = [];
    var i;
    for (i = 0; i < state.variantCount; i++) {
      pending.push({
        id: chain.id + "-v" + i,
        label: "Life " + String.fromCharCode(65 + i),
        pending: true,
        posterUrl: imageUrl,
      });
    }
    if (board && board.id === state.activeBoardId) {
      state.previewImageUrl = imageUrl;
      renderVariants(pending);
      state.selectedVariantId = pending[0].id;
      if (board) board.selectedVariantId = pending[0].id;
    }

    function castOne(idx) {
      if (idx >= state.variantCount) return Promise.resolve(variants);
      var lifeLabel = LIFE_VARIANT_LABELS[idx % LIFE_VARIANT_LABELS.length];
      setStatus(
        "Bringing frame to life " + (idx + 1) + " of " + state.variantCount + " (" + lifeLabel + ")…",
        "pending"
      );

      return castLifeVariant(imageUrl, chain, fused, idx, 0)
        .then(function (variant) {
          variants.push(variant);
          if (board && !variant.failed) board.selectedVariantId = variant.id;
          if (board && board.id === state.activeBoardId) {
            if ((!state.selectedVariantId || idx === 0) && !variant.failed) state.selectedVariantId = variant.id;
            renderVariants(variants.concat(pending.slice(idx + 1)));
            if (idx === 0 && !variant.failed) {
              state.selectedVariantId = variant.id;
              requestAnimationFrame(function () {
                scrollFeedToVariant(variant.id);
                var firstSlide = document.querySelector('.vi-feed-slide[data-variant="' + variant.id + '"]');
                if (firstSlide) playFeedSlide(firstSlide);
              });
            }
          }
          return castOne(idx + 1);
        });
    }

    return castOne(0);
  }

  function rerollChain() {
    rerollAllBoards();
  }

  function rerollAllBoards() {
    state.boards.forEach(function (b) {
      rerollBoard(b, true);
    });
    renderBoards();
    setStatus(state.boards.length + " chains rerolled — swap spells, then forge.", "ok");
  }

  function setBoardPipeline(board, step) {
    board.pipeStep = step;
    if (board.id === state.activeBoardId) setPipelineStep(step);
  }

  function forgeBoard(board) {
    if (!board || board.forging) return Promise.resolve();
    if (!state.poolReady || state.pool.length < 3) {
      setStatus("Loading paintings…", "error");
      return loadPool().then(function () {
        return forgeBoard(board);
      });
    }
    if (!board.chain) rerollBoard(board, true);

    board.forging = true;
    board.status = "forging";
    board.statusText = "fusing…";
    state.forging = true;
    renderBoards();
    if (board.id === state.activeBoardId) {
      updateActions(false);
      setBoardPipeline(board, "chain");
    }

    var chain = board.chain;
    var fused = board.fusedPrompt;
    var boardIdx = state.boards.indexOf(board) + 1;

    return generateChainImage(chain, fused)
      .then(function (imageUrl) {
        setBoardPipeline(board, "image");
        board.statusText = "life clips…";
        renderBoards();
        if (board.id === state.activeBoardId) {
          showGeneratedImage(imageUrl);
          setStatus("Chain " + boardIdx + " fused — bringing frame to life (" + state.variantCount + " casts)…", "pending");
        }
        setBoardPipeline(board, "video");
        return forgeVideoVariants(imageUrl, chain, fused, board).then(function (variants) {
          return { imageUrl: imageUrl, variants: variants };
        });
      })
      .then(function (result) {
        var post = {
          id: chain.id,
          boardId: board.id,
          hook: buildHook(chain, chain.topic),
          caption: buildCaption(chain, chain.topic),
          hashtags: buildHashtags(chain, chain.topic),
          imageUrl: result.imageUrl,
          variants: result.variants,
          chain: chain,
        };
        board.post = post;
        board.status = "done";
        board.statusText = result.variants.length + " clips";
        board.selectedVariantId = result.variants[0] ? result.variants[0].id : "";
        setBoardPipeline(board, "done");
        state.history.unshift({
          id: post.id,
          hook: post.hook,
          thumb: post.imageUrl,
          post: post,
          boardId: board.id,
        });
        renderBoards();
        renderHistory();
        if (board.id === state.activeBoardId) {
          syncActiveBoardToLegacy(board);
          renderVariants(result.variants);
          renderDetail(post);
          var sel = getSelectedVariant();
          if (sel) {
            scrollFeedToVariant(sel.id);
            var doneSlide = document.querySelector('.vi-feed-slide[data-variant="' + sel.id + '"]');
            if (doneSlide) playFeedSlide(doneSlide);
          }
        }
        return post;
      })
      .catch(function (err) {
        board.status = "error";
        board.statusText = "failed";
        renderBoards();
        if (board.id === state.activeBoardId) {
          setStatus(err.message || "Forge failed — is the server running?", "error");
          setBoardPipeline(board, "chain");
        }
        throw err;
      })
      .finally(function () {
        board.forging = false;
        state.forging = state.boards.some(function (b) {
          return b.forging;
        });
        renderBoards();
        if (board.id === state.activeBoardId) {
          syncActiveBoardToLegacy(board);
          updateActions(hasExportablePost(board.post));
        }
      });
  }

  function forgeAllBoards() {
    if (state.forging) return Promise.resolve();
    revokeBlobUrls();
    setStatus("Forging " + state.boards.length + " chains (" + state.variantCount + " life casts each)…", "pending");
    var queue = state.boards.slice();
    var done = 0;
    function next() {
      if (!queue.length) {
        setStatus("All " + done + " chains forged — click panels to preview.", "ok");
        return Promise.resolve();
      }
      var board = queue.shift();
      return forgeBoard(board)
        .then(function () {
          done++;
          return next();
        })
        .catch(function () {
          done++;
          return next();
        });
    }
    return next();
  }

  function forgePipeline() {
    var board = getActiveBoard();
    if (!board) {
      ensureBoards();
      board = getActiveBoard();
    }
    revokeBlobUrls();
    return forgeBoard(board);
  }

  function copyCaption() {
    var post = state.post;
    if (!post) return;
    var text = post.hook + "\n\n" + post.caption + "\n\n" + post.hashtags;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        setStatus("Caption copied.", "ok");
      });
    }
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 8000);
  }

  function ensureVariantBlob(variant) {
    if (!variant) return Promise.reject(new Error("Select a video option first."));
    if (variant.blob && variant.blob.size > 0) return Promise.resolve(variant.blob);
    var url = variant.videoUrl || variant.playUrl;
    if (!url) return Promise.reject(new Error("No video available for export."));
    url = absoluteUrl(url);
    if (url.indexOf("blob:") === 0) {
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error("Could not read cached video.");
        return r.blob();
      });
    }
    return fetch(mediaProxyUrl(url), { cache: "no-store", credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("Could not download video for export.");
      return r.blob();
    });
  }

  function openTikTokUpload() {
    window.open("https://www.tiktok.com/upload", "_blank", "noopener,noreferrer");
  }

  function exportTikTok() {
    if (state.exporting) return Promise.resolve();
    var variant = getSelectedVariant();
    if (!variant || variant.pending) {
      setStatus("Select a finished video option first.", "error");
      return Promise.resolve();
    }
    state.exporting = true;
    updateActions(hasExportablePost(state.post));
    setStatus("Preparing video for TikTok export…", "pending");

    var onStatus = function (msg) {
      setStatus(msg, "pending");
    };

    return ensureVariantBlob(variant)
      .then(function (blob) {
        if (!blob || !blob.size) throw new Error("Video file is empty.");
        variant.blob = blob;

        if (blob.type && blob.type.indexOf("mp4") >= 0) {
          downloadBlob(blob, "1000-paintings-viral.mp4");
          openTikTokUpload();
          setStatus(
            "MP4 saved — TikTok upload opened. Drag the file onto that page (browsers cannot auto-fill drafts).",
            "ok"
          );
          return null;
        }

        if (window.VideofyExport && window.VideofyExport.export) {
          onStatus("Encoding TikTok MP4 — first export may take a minute…");
          return window.VideofyExport.export("tiktok", blob, {
            onStatus: onStatus,
            title: "1000 Paintings viral",
          }).then(function () {
            setStatus(
              "MP4 saved — TikTok upload opened. Choose the file if the share sheet did not attach it.",
              "ok"
            );
          });
        }

        if (!window.VideofyExport || !window.VideofyExport.toMp4) {
          throw new Error("Video encoder not loaded — hard refresh (Ctrl+F5) and try again.");
        }
        onStatus("Encoding TikTok MP4 — first export may take a minute…");
        return window.VideofyExport.toMp4(blob, { onStatus: onStatus }).then(function (mp4Blob) {
          downloadBlob(mp4Blob, "1000-paintings-viral.mp4");
          openTikTokUpload();
          setStatus("MP4 saved — TikTok upload opened. Drag the file onto that page.", "ok");
        });
      })
      .catch(function (err) {
        setStatus(err.message || "MP4 export failed.", "error");
      })
      .finally(function () {
        state.exporting = false;
        updateActions(hasExportablePost(state.post));
      });
  }

  function restorePost(post) {
    if (!post) return;
    if (post.boardId) {
      var board = getBoardById(post.boardId);
      if (board) {
        board.post = post;
        board.status = "done";
        board.statusText = (post.variants && post.variants.length) + " clips";
      }
    }
    state.post = post;
    state.selectedVariantId =
      post.variants && post.variants.length
        ? (post.variants.find(function (v) {
            return v.id === state.selectedVariantId;
          }) || post.variants[0]).id
        : "";
    state.previewImageUrl = post.imageUrl || "";
    renderDetail(post);
    var variants = post.variants || [];
    if (!variants.length) {
      renderFeed([]);
      return;
    }
    state.feedVariants = variants;
    renderVariants(variants);
    var sel = getSelectedVariant();
    if (sel) {
      scrollFeedToVariant(sel.id);
      var slide = document.querySelector('.vi-feed-slide[data-variant="' + sel.id + '"]');
      if (slide) playFeedSlide(slide);
    }
  }

  function renderArcs() {
    var el = $("vi-arcs");
    if (!el) return;
    el.innerHTML = CHAIN_ARCS.map(function (a) {
      return (
        '<button type="button" class="vi-topic' +
        (a.id === state.arcId ? " active" : "") +
        '" data-arc="' +
        escapeHtml(a.id) +
        '"><span class="vi-topic-label">' +
        escapeHtml(a.label) +
        '</span><span class="vi-topic-hint">' +
        escapeHtml(a.hint) +
        "</span></button>"
      );
    }).join("");
  }

  function renderTopics() {
    var el = $("vi-topics");
    if (!el) return;
    el.innerHTML = TOPICS.map(function (t) {
      return (
        '<button type="button" class="vi-topic vi-topic-compact' +
        (t.id === state.topicId ? " active" : "") +
        '" data-topic="' +
        escapeHtml(t.id) +
        '"><span class="vi-topic-label">' +
        escapeHtml(t.label) +
        "</span></button>"
      );
    }).join("");
  }

  function renderFeatured() {
    var el = $("vi-featured");
    if (!el) return;
    if (!state.seed) {
      el.innerHTML = '<p class="vi-featured-empty">Drop a painting to start the chain</p>';
      return;
    }
    var s = state.seed;
    el.innerHTML =
      '<div class="vi-featured-card">' +
      '<img src="' +
      escapeHtml(s.url) +
      '" alt="" />' +
      '<div class="vi-featured-meta"><strong>#' +
      escapeHtml(s.paintingNum) +
      " " +
      escapeHtml(s.title) +
      '</strong>Chain seed</div>' +
      '<button type="button" class="vi-featured-rm" aria-label="Clear seed">×</button></div>';
    var rm = el.querySelector(".vi-featured-rm");
    if (rm) {
      rm.addEventListener("click", function (e) {
        e.stopPropagation();
        state.seed = null;
        renderFeatured();
      });
    }
  }

  function loadPool() {
    if (state.poolReady) return Promise.resolve();
    return (window.loadGalleryData ? window.loadGalleryData() : Promise.resolve({ manifest: [] })).then(
      function (data) {
        state.pool = (data.manifest || []).map(function (m) {
          return normalizeSpell(spellRow(m));
        });
        state.poolReady = true;
        fillTrayRandom();
        renderTray();
      }
    );
  }

  function fillTrayRandom() {
    state.trayItems = shuffle(state.pool).slice(0, CAST_TRAY_SLICE);
  }

  function renderTray() {
    var strip = $("vi-spell-strip");
    if (!strip) return;
    strip.innerHTML = "";
    state.trayItems.forEach(function (item, idx) {
      var el = document.createElement("div");
      el.className = "st-spell vi-spell";
      el.dataset.idx = String(idx);
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.label;
      el.appendChild(img);
      strip.appendChild(el);
    });
    var count = $("vi-tray-count");
    if (count) count.textContent = state.trayItems.length + " shown · drag to swap spells";
  }

  function createGhost(item, x, y) {
    var ghost = document.createElement("div");
    ghost.className = "st-drag-ghost";
    var img = document.createElement("img");
    img.src = item.url;
    ghost.appendChild(img);
    ghost.style.left = x + "px";
    ghost.style.top = y + "px";
    document.body.appendChild(ghost);
    return ghost;
  }

  function isOverFeatured(x, y) {
    var el = $("vi-featured");
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function boardStepAt(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el) return null;
    var step = el.closest(".vi-board-step");
    if (!step) return null;
    return {
      boardId: step.getAttribute("data-board"),
      stepIndex: parseInt(step.getAttribute("data-step"), 10),
    };
  }

  function bindUi() {
    renderArcs();
    renderTopics();

    $("vi-arcs") &&
      $("vi-arcs").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-arc]");
        if (!btn) return;
        state.arcId = btn.dataset.arc;
        renderArcs();
      });

    $("vi-topics") &&
      $("vi-topics").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-topic]");
        if (!btn) return;
        state.topicId = btn.dataset.topic;
        renderTopics();
      });

    var len = $("vi-chain-len");
    if (len) {
      len.addEventListener("input", function () {
        state.chainLen = parseInt(len.value, 10) || 4;
        var val = $("vi-chain-len-val");
        if (val) val.textContent = state.chainLen + " spells";
      });
    }

    var bcount = $("vi-board-count");
    if (bcount) {
      bcount.addEventListener("input", function () {
        state.boardCount = clamp(parseInt(bcount.value, 10) || DEFAULT_BOARD_COUNT, 2, 6);
        var val = $("vi-board-count-val");
        if (val) val.textContent = state.boardCount + " chains";
        ensureBoards(state.boardCount);
      });
    }

    var vcount = $("vi-variant-count");
    if (vcount) {
      vcount.addEventListener("input", function () {
        state.variantCount = clamp(parseInt(vcount.value, 10) || 3, 2, 4);
        var val = $("vi-variant-count-val");
        if (val) val.textContent = state.variantCount + " clips";
      });
    }

    $("vi-boards") &&
      $("vi-boards").addEventListener("click", function (e) {
        var forgeBtn = e.target.closest(".vi-board-forge");
        if (forgeBtn) {
          e.stopPropagation();
          forgeBoard(getBoardById(forgeBtn.getAttribute("data-board")));
          return;
        }
        var rerollBtn = e.target.closest(".vi-board-reroll");
        if (rerollBtn) {
          e.stopPropagation();
          rerollBoard(getBoardById(rerollBtn.getAttribute("data-board")));
          setStatus("Chain rerolled — swap spells before forging.", "ok");
          return;
        }
        var swapBtn = e.target.closest(".vi-board-step-swap");
        if (swapBtn) {
          e.stopPropagation();
          randomSwapStep(getBoardById(swapBtn.getAttribute("data-board")), parseInt(swapBtn.getAttribute("data-step"), 10));
          return;
        }
        var step = e.target.closest(".vi-board-step");
        if (step) {
          e.stopPropagation();
          state.swapTarget = {
            boardId: step.getAttribute("data-board"),
            stepIndex: parseInt(step.getAttribute("data-step"), 10),
          };
          renderBoards();
          setStatus("Step selected — drag a painting from the tray onto it to swap.", "ok");
          return;
        }
        var boardEl = e.target.closest(".vi-board");
        if (boardEl) setActiveBoard(boardEl.getAttribute("data-board-id"));
      });

    $("vi-variants") &&
      $("vi-variants").addEventListener("click", function (e) {
        var card = e.target.closest("[data-variant]");
        if (!card) return;
        selectVariant(card.getAttribute("data-variant"));
      });

    $("vi-forge-all") && $("vi-forge-all").addEventListener("click", forgeAllBoards);
    $("vi-reroll-all") && $("vi-reroll-all").addEventListener("click", rerollAllBoards);
    $("vi-add-board") &&
      $("vi-add-board").addEventListener("click", function () {
        state.boardCount = clamp(state.boardCount + 1, 2, 6);
        var slider = $("vi-board-count");
        if (slider) slider.value = String(state.boardCount);
        var val = $("vi-board-count-val");
        if (val) val.textContent = state.boardCount + " chains";
        ensureBoards(state.boardCount);
        setStatus("Added chain panel — " + state.boardCount + " total.", "ok");
      });
    $("vi-copy-caption") && $("vi-copy-caption").addEventListener("click", copyCaption);
    $("vi-export-tiktok") && $("vi-export-tiktok").addEventListener("click", exportTikTok);
    $("vi-open-tiktok") && $("vi-open-tiktok").addEventListener("click", openTikTokUpload);
    $("vi-randomize") &&
      $("vi-randomize").addEventListener("click", function () {
        fillTrayRandom();
        renderTray();
      });

    $("vi-history") &&
      $("vi-history").addEventListener("click", function (e) {
        var card = e.target.closest(".vi-history-card");
        if (!card) return;
        var entry = state.history.find(function (h) {
          return h.id === card.dataset.id;
        });
        if (entry && entry.post) {
          if (entry.boardId) setActiveBoard(entry.boardId);
          restorePost(entry.post);
        }
      });

    var strip = $("vi-spell-strip");
    if (strip) {
      strip.addEventListener("pointerdown", onPointerDown);
      strip.addEventListener("pointermove", onPointerMove);
      strip.addEventListener("pointerup", onPointerUp);
      strip.addEventListener("pointercancel", onPointerCancel);
    }
  }

  function onPointerDown(e) {
    var spell = e.target.closest(".vi-spell");
    if (!spell) return;
    var item = normalizeSpell(state.trayItems[parseInt(spell.dataset.idx, 10)]);
    if (!item.url) return;
    e.preventDefault();
    spell.setPointerCapture(e.pointerId);
    state.drag = { item: item, ghost: createGhost(item, e.clientX, e.clientY), pointerId: e.pointerId };
    var feat = $("vi-featured");
    if (feat) feat.classList.add("drop-active");
  }

  function onPointerUp(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    if (state.drag.ghost.parentNode) state.drag.ghost.parentNode.removeChild(state.drag.ghost);
    var feat = $("vi-featured");
    if (feat) feat.classList.remove("drop-active");
    if (isOverFeatured(e.clientX, e.clientY)) {
      state.seed = state.drag.item;
      renderFeatured();
    } else {
      var target = boardStepAt(e.clientX, e.clientY);
      if (target) {
        var board = getBoardById(target.boardId);
        if (board) replaceStepSpell(board, target.stepIndex, state.drag.item);
      } else if (state.swapTarget) {
        var swapBoard = getBoardById(state.swapTarget.boardId);
        if (swapBoard) replaceStepSpell(swapBoard, state.swapTarget.stepIndex, state.drag.item);
      }
    }
    state.drag = null;
  }

  function onPointerMove(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    state.drag.ghost.style.left = e.clientX + "px";
    state.drag.ghost.style.top = e.clientY + "px";
  }

  function onPointerCancel(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    if (state.drag.ghost.parentNode) state.drag.ghost.parentNode.removeChild(state.drag.ghost);
    state.drag = null;
  }

  function onShow() {
    state.active = true;
    loadPool().then(function () {
      if (!state.boards.length) ensureBoards(state.boardCount);
    });
    if (window.VideofyExport && window.VideofyExport.prefetch) window.VideofyExport.prefetch();
  }

  function onHide() {
    state.active = false;
    pauseAllFeedVideos();
    if (state.feedObserver) {
      state.feedObserver.disconnect();
      state.feedObserver = null;
    }
  }

  function boot() {
    if (!$("panel-viral")) return;
    bindUi();
    renderFeatured();
    state.previewImageUrl = "";
    renderVariants([]);
    renderHistory();
    loadPool().then(function () {
      ensureBoards(state.boardCount);
    });
    window.dispatchEvent(new Event("viral-ready"));
  }

  window.Viral = { onShow: onShow, onHide: onHide, forge: forgePipeline, rerollChain: rerollChain };
  window.addEventListener("viral-show", onShow);
  window.addEventListener("viral-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();