(function () {
  "use strict";

  var GLYPHS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  var SPACE = " ";
  var PREVIEW_GLYPHS = GLYPHS.concat([SPACE]);
  var COUNT = GLYPHS.length;
  var TOP = COUNT - 1;
  var AA = {
    A: "Ala", B: "Asx", C: "Cys", D: "Asp", E: "Glu", F: "Phe", G: "Gly",
    H: "His", I: "Ile", J: "Xle", K: "Lys", L: "Leu", M: "Met", N: "Asn",
    O: "Pyl", P: "Pro", Q: "Gln", R: "Arg", S: "Ser", T: "Thr", U: "Sec",
    V: "Val", W: "Trp", X: "Xaa", Y: "Tyr", Z: "Glx",
    "0": "Gly", "1": "Ala", "2": "Ser", "3": "Thr", "4": "Val",
    "5": "Leu", "6": "Ile", "7": "Pro", "8": "Phe", "9": "Tyr"
  };

  var state = {
    selected: 0,
    hover: -1,
    hoverCh: null,
    lightboxCh: null,
    prompt: "",
    parse: { qty: 1, nouns: [], hasTable: false, raw: "" },
    genUrl: "",
    genCurves: null, // image → Desmos Bézier curves of the main still (Graph tab tracer)
    showCurves: true,
    genJob: 0,
    timer: 0,
    previewUrls: {},
    previewQueue: [],
    previewBusy: 0,
    previewGen: 0,
    previewCols: 6,
    mainReady: false,
    mainSeed: null, // seed sentence of the last clicked main still (resume only applies to it)
    pendingPrefer: null,
    eqHidden: false,
    letterGrid: true
  };

  function $(id) {
    return document.getElementById(id);
  }

  /**
   * Post-generation image → Desmos step. Same tracer and same defaults as the Graph
   * tab's "Image → sketch (img2desmos-style)" Convert to curves: detail 7, max 900
   * curves, 520px trace width, y flipped for math axes.
   */
  var DESMOS_OPTS = { detail: 7, maxCurves: 900, maxWidth: 520, flipY: true };

  function yValue(index) {
    return COUNT - index;
  }

  function glyphIndex(ch) {
    return GLYPHS.indexOf(String(ch || "").toUpperCase());
  }

  function kappaFor(index) {
    if (index < 0) return 0;
    var k = ((index % 7) - 3) * (Math.PI / 6.5);
    if (GLYPHS[index] === "P" || GLYPHS[index] === "7") k += Math.PI / 2.4;
    if (GLYPHS[index] === "G" || GLYPHS[index] === "0") k *= 0.35;
    return k;
  }

  function rankLabel(index) {
    if (index === 0) return "highest point";
    if (index === TOP) return "lowest point";
    return "rung " + (index + 1) + " of 36";
  }

  function parsePrompt(text) {
    var raw = String(text || "").trim();
    var lower = raw.toLowerCase();
    var qty = 1;
    var m;
    var re = /\b(\d{1,5})\b/g;
    while ((m = re.exec(lower))) {
      var n = parseInt(m[1], 10);
      if (n > qty) qty = n;
    }
    if (/\b(a|an)\b/.test(lower) && qty === 1) qty = 1;
    if (/\bhundred\b/.test(lower)) qty = Math.max(qty, 100);
    if (/\bthousand\b/.test(lower)) qty = Math.max(qty, 1000);
    var nouns = [];
    var lexicon = [
      "apple", "apples", "table", "tables", "tree", "trees", "horse", "bird",
      "eye", "moon", "star", "flower", "leaf", "house", "bowl", "pear",
      "orange", "grape", "fish", "cat", "dog", "hand", "face", "sun"
    ];
    lexicon.forEach(function (w) {
      if (lower.indexOf(w) >= 0 && nouns.indexOf(w) < 0) nouns.push(w);
    });
    if (!nouns.length && raw) nouns.push("form");
    return {
      qty: qty,
      nouns: nouns,
      hasTable: /\btable/.test(lower),
      wantsApple: /\bapple/.test(lower),
      raw: raw
    };
  }

  function letterEffect(ch) {
    var map = {
      "0": { kind: "seed", blurb: "resets to one seed form at the origin" },
      "1": { kind: "one", blurb: "a single close-up object" },
      "3": { kind: "three", blurb: "three objects, a small still-life" },
      A: { kind: "apple", blurb: "locks the form to apples" },
      W: { kind: "wide", blurb: "spreads the pile into a wide field" },
      X: { kind: "cross", blurb: "crosses the structure with a second axis" },
      Y: { kind: "fork", blurb: "forks the pile into two clusters" },
      Z: { kind: "ground", blurb: "grounds everything on the origin plane" },
      " ": { kind: "break", blurb: "inserts a space — a word break and a new cluster" }
    };
    return map[ch] || {
      kind: "turn",
      blurb: "turns the backbone (κ) and shifts height y=" + yValue(glyphIndex(ch))
    };
  }

  function mutateParse(base, ch) {
    var p = {
      qty: base.qty || 1,
      nouns: (base.nouns || []).slice(),
      hasTable: !!base.hasTable,
      wantsApple: !!base.wantsApple,
      raw: (base.raw || "") + ch,
      spread: 1,
      fork: false,
      ground: false,
      cross: false
    };
    var fx = letterEffect(ch);
    if (ch === "0") p.qty = 1;
    if (ch === "1") p.qty = 1;
    if (ch === "3") p.qty = 3;
    if (/^[2-9]$/.test(ch)) p.qty = parseInt(ch, 10);
    if (ch === "A") p.wantsApple = true;
    if (ch === "W") p.spread = 1.55;
    if (ch === "X") p.cross = true;
    if (ch === "Y") p.fork = true;
    if (ch === "Z") p.ground = true;
    if (ch === SPACE) p.fork = true;
    p.fx = fx;
    return p;
  }

  function glyphLabel(ch) {
    return ch === SPACE ? "space" : ch;
  }

  function datasetCh(ch) {
    return ch === SPACE ? "space" : ch;
  }

  function nextInsight(indexOrCh) {
    var ch =
      typeof indexOrCh === "string"
        ? indexOrCh
        : GLYPHS[indexOrCh < 0 ? state.selected : indexOrCh];
    if (ch === SPACE) {
      return {
        ch: SPACE,
        aa: "pause",
        kappa: 0.18,
        y: 0,
        text:
          "If the next character is a space: the sentence breaks. Forms get breathing room and a new cluster can start."
      };
    }
    var i = glyphIndex(ch);
    var k = kappaFor(i);
    var y = yValue(i);
    var aa = AA[ch] || "Xaa";
    var fx = letterEffect(ch);
    return {
      ch: ch,
      aa: aa,
      kappa: k,
      y: y,
      text:
        "If the next letter is " +
        ch +
        " (" +
        aa +
        ", y=" +
        y +
        "): the still would " +
        fx.blurb +
        ". κ = " +
        k.toFixed(3) +
        "."
    };
  }

  function renderColumn() {
    var col = $("az-column");
    if (!col) return;
    col.innerHTML = "";
    GLYPHS.forEach(function (ch, i) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "az-rung" + (i === state.selected ? " is-selected" : "");
      btn.dataset.azIndex = String(i);
      btn.setAttribute("aria-pressed", i === state.selected ? "true" : "false");
      btn.title = nextInsight(i).text;
      btn.innerHTML =
        '<span class="az-y">' +
        yValue(i) +
        '</span><span class="az-glyph">' +
        ch +
        '</span><span class="az-idx">' +
        (i + 1) +
        "</span>";
      btn.addEventListener("click", function () {
        selectIndex(i);
      });
      btn.addEventListener("mouseenter", function () {
        state.hover = i;
        renderInsight();
        drawScene();
      });
      btn.addEventListener("mouseleave", function () {
        if (state.hover === i) state.hover = -1;
        renderInsight();
        drawScene();
      });
      col.appendChild(btn);
    });
  }

  function renderReadout() {
    var ch = GLYPHS[state.selected];
    var glyphEl = $("az-readout-glyph");
    var metaEl = $("az-readout-meta");
    if (glyphEl) glyphEl.textContent = ch;
    if (metaEl) {
      metaEl.textContent =
        ch +
        " is the " +
        rankLabel(state.selected) +
        ". Rung " +
        (state.selected + 1) +
        " of 36. Height y = " +
        yValue(state.selected) +
        " (36 at 0, 1 at Z — above the origin).";
    }
    renderInsight();
  }

  function insightTarget() {
    if (state.hoverCh != null) return state.hoverCh;
    if (state.hover >= 0) return GLYPHS[state.hover];
    return GLYPHS[state.selected];
  }

  function renderInsight() {
    var el = $("az-next-insight");
    if (!el) return;
    el.textContent = nextInsight(insightTarget()).text;
  }

  function renderEquations() {
    var el = $("az-equations");
    if (!el) return;
    var p = state.parse;
    if (!p.raw) {
      el.innerHTML = "<em>Type a scene. Letters set κ; words set the form; numbers set N.</em>";
      return;
    }
    var n = Math.max(1, p.qty);
    var noun = p.wantsApple ? "apple" : p.nouns[0] || "form";
    var lines = [
      "N = " + n + " · " + noun + (n === 1 ? "" : "s"),
      "θ₀ = 0.22",
      "x_{n+1} = x_n + cos(θ_n)",
      "y_{n+1} = y_n + sin(θ_n)"
    ];
    if (p.hasTable) lines.push("table: (x/a)^2 + (y/b)^2 = 1");
    if (p.wantsApple) lines.push("apple: r(φ) = 1 − 0.18 cos(φ)");
    lines.push("fill: clockwise → right · counter-clockwise → left");
    var next = nextInsight(state.hover >= 0 ? state.hover : state.selected);
    lines.push("κ_next(" + next.ch + ") = " + next.kappa.toFixed(3));
    el.innerHTML = lines
      .map(function (line) {
        return "<div>" + line.replace(/</g, "&lt;") + "</div>";
      })
      .join("");
  }

  function drawGrid(ctx, w, h) {
    ctx.fillStyle = "#fbfcfe";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#e6eef8";
    ctx.lineWidth = 1;
    var g;
    for (g = 40; g < w; g += 40) {
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, h);
      ctx.stroke();
    }
    for (g = 40; g < h; g += 40) {
      ctx.beginPath();
      ctx.moveTo(0, g);
      ctx.lineTo(w, g);
      ctx.stroke();
    }
    ctx.strokeStyle = "#9aa7b8";
    ctx.beginPath();
    ctx.moveTo(36, h - 28);
    ctx.lineTo(w - 12, h - 28);
    ctx.moveTo(36, 12);
    ctx.lineTo(36, h - 28);
    ctx.stroke();
    ctx.fillStyle = "#6b7788";
    ctx.font = "12px Times New Roman, serif";
    ctx.fillText("0", 22, h - 14);
    ctx.fillText("x", w - 18, h - 14);
    ctx.fillText("y", 14, 18);
  }

  function drawApple(ctx, x, y, s, ghost) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.bezierCurveTo(12, -10, 16, 2, 8, 12);
    ctx.bezierCurveTo(4, 16, -4, 16, -8, 12);
    ctx.bezierCurveTo(-16, 2, -12, -10, 0, -10);
    ctx.closePath();
    ctx.fillStyle = ghost ? "rgba(196, 48, 48, 0.18)" : "rgba(196, 48, 48, 0.82)";
    ctx.fill("nonzero");
    ctx.strokeStyle = ghost ? "rgba(29,78,216,0.55)" : "#1a2030";
    ctx.setLineDash(ghost ? [4, 4] : []);
    ctx.lineWidth = ghost ? 1.4 : 1.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.quadraticCurveTo(2, -16, 1, -20);
    ctx.strokeStyle = "#3d2914";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(6, -16, 7, 3.5, -0.6, 0, Math.PI * 2, true);
    ctx.fillStyle = ghost ? "rgba(46,120,62,0.25)" : "rgba(46,120,62,0.85)";
    ctx.fill("nonzero");
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawTable(ctx, cx, cy, w, d) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, w, d, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(166, 124, 72, 0.28)";
    ctx.fill();
    ctx.strokeStyle = "#5c3d22";
    ctx.lineWidth = 2;
    ctx.stroke();
    var legs = [
      [cx - w * 0.62, cy + 4],
      [cx + w * 0.62, cy + 4],
      [cx - w * 0.5, cy + d],
      [cx + w * 0.5, cy + d]
    ];
    ctx.strokeStyle = "#4a3018";
    ctx.lineWidth = 3;
    legs.forEach(function (leg) {
      ctx.beginPath();
      ctx.moveTo(leg[0], leg[1]);
      ctx.lineTo(leg[0] + (leg[0] < cx ? -6 : 6), cy + d + 38);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawGeneric(ctx, x, y, s, label, ghost) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.ellipse(0, 0, 16 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = ghost ? "rgba(29,78,216,0.12)" : "rgba(201,162,39,0.35)";
    ctx.fill();
    ctx.strokeStyle = ghost ? "rgba(29,78,216,0.6)" : "#1a2030";
    ctx.setLineDash(ghost ? [4, 4] : []);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = "#111";
    ctx.font = "700 " + Math.round(10 * s) + "px Times New Roman, serif";
    ctx.textAlign = "center";
    ctx.fillText(label, 0, 4);
    ctx.restore();
  }

  function appleLayout(n, w, h, parse) {
    parse = parse || {};
    var count = Math.min(n, 48);
    var pts = [];
    var cols = Math.ceil(Math.sqrt(count * 1.4));
    var rows = Math.ceil(count / cols);
    var spread = parse.spread || 1;
    var ox = w * (parse.fork ? 0.38 : 0.5);
    var oy = h * (parse.ground ? 0.68 : 0.52);
    var gap = Math.min(38, (w - 120) / Math.max(cols, 1)) * spread;
    var i;
    for (i = 0; i < count; i++) {
      var c = i % cols;
      var r = Math.floor(i / cols);
      var x = ox + (c - (cols - 1) / 2) * gap + (r % 2) * (gap * 0.28);
      var y = oy + (r - (rows - 1) / 2) * gap * 0.72;
      if (parse.fork && i >= count / 2) x += w * 0.28;
      pts.push({ x: x, y: y });
    }
    return pts;
  }

  function paintParse(ctx, w, h, parse, opts) {
    opts = opts || {};
    if (parse.hasTable) drawTable(ctx, w * 0.48, h * (parse.ground ? 0.72 : 0.62), Math.min(220, w * 0.32), 36);
    if (parse.cross) {
      ctx.save();
      ctx.strokeStyle = "rgba(29,78,216,0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(40, 20);
      ctx.lineTo(w - 20, h - 36);
      ctx.stroke();
      ctx.restore();
    }
    var n = Math.max(1, parse.qty || 1);
    var shown = Math.min(n, opts.max || 48);
    if (parse.wantsApple) {
      appleLayout(shown, w, h, parse).forEach(function (pt, i) {
        drawApple(ctx, pt.x, pt.y, (opts.scale || 1) * (1.05 - (i % 5) * 0.04), !!opts.ghost);
      });
    } else {
      var noun = ((parse.nouns && parse.nouns[0]) || "form").replace(/s$/, "");
      var i;
      for (i = 0; i < shown; i++) {
        drawGeneric(
          ctx,
          w * 0.28 + (i % 8) * 52 * (parse.spread || 1),
          h * 0.38 + Math.floor(i / 8) * 44,
          opts.scale || 1,
          noun,
          !!opts.ghost
        );
      }
    }
  }

  function seedSentence() {
    return String(state.prompt || "").trim() || GLYPHS[0];
  }

  function previewKey(ch) {
    return seedSentence() + "\n" + ch;
  }

  function applyPreviewCols(n) {
    var cols = Math.max(1, Math.min(6, n | 0));
    state.previewCols = cols;
    try {
      localStorage.setItem("az-preview-cols", String(cols));
    } catch (e) {}
    var drawer = $("az-preview-drawer");
    var host = $("az-previews");
    var label = $("az-preview-col-label");
    if (drawer) drawer.setAttribute("data-cols", String(cols));
    if (host) host.style.setProperty("--az-cols", String(cols));
    if (label) label.textContent = String(cols);
  }

  function bindPreviewDrag() {
    var handle = $("az-preview-handle");
    if (!handle || handle.dataset.bound) return;
    handle.dataset.bound = "1";
    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      var startX = e.clientX;
      var startCols = state.previewCols;
      function move(ev) {
        var dx = startX - ev.clientX;
        var next = startCols + Math.round(dx / 52);
        applyPreviewCols(next);
      }
      function up(ev) {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  function setTileVision(ch, url) {
    var btn = document.querySelector('.az-preview-tile[data-az-next="' + datasetCh(ch) + '"]');
    if (!btn || !url) return;
    var media = btn.querySelector("img, canvas");
    var img = document.createElement("img");
    img.alt = ch;
    img.src = url;
    if (media && media.parentNode) media.parentNode.replaceChild(img, media);
    else btn.insertBefore(img, btn.firstChild);
  }

  function fetchPremonition(ch, genId) {
    var key = previewKey(ch);
    var seed = seedSentence();
    var stasis =
      "Premonition vision: the sentence so far is «" +
      seedSentence() +
      "». Show the picture that would appear if the next letter typed is '" +
      ch +
      "'. " +
      (ch === SPACE ? "A space is a word break." : "Letter " + ch + " is the next influential variable.") +
      " It must change the scene. Seeded from the first letter 0 when the prompt is empty. Museum line-art, accurate forms, contour and fill.";
    return fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stasis: stasis,
        buzz_words: ["line art", "premonition", "next letter " + ch],
        aspect_ratio: "1:1"
      })
    })
      .then(function (r) {
        if (r.status === 202) {
          return r.json().then(function (d) {
            return pollJob(d.job_id, 90);
          });
        }
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "failed");
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image");
        });
      })
      .then(function (url) {
        // A request that was already paid for is kept even if its run was stopped or
        // replaced: cache it under the sentence it was made for (so Resume never pays
        // twice) and save it. Only draw it if that sentence is still the current one.
        state.previewUrls[key] = url;
        if (key === previewKey(ch)) setTileVision(ch, url);
        persistAzStill(url, "0-Z letter " + glyphLabel(ch) + " · " + seed);
        updateResumeButton();
      })
      .catch(function () {});
  }

  function pumpPremonitions() {
    var gen = state.previewGen;
    while (state.previewBusy < 2 && state.previewQueue.length) {
      var ch = state.previewQueue.shift();
      if (state.previewUrls[previewKey(ch)]) continue;
      state.previewBusy++;
      fetchPremonition(ch, gen).then(function () {
        if (gen !== state.previewGen) return; // stopped or restarted by a newer click
        state.previewBusy--;
        pumpPremonitions();
      });
    }
    updateResumeButton();
  }

  /** Letters still missing a premonition for the current sentence. */
  function missingPremonitions() {
    return PREVIEW_GLYPHS.filter(function (ch) {
      return !state.previewUrls[previewKey(ch)];
    });
  }

  function premonitionsRunning() {
    return state.previewBusy > 0 || state.previewQueue.length > 0;
  }

  /**
   * Premonitions only ever start from a click (Generate, or Resume). When a clicked
   * run was stopped (letter grid off) and letters are still missing for the same
   * sentence, offer "Resume N pending" instead of restarting on its own.
   */
  function updateResumeButton() {
    var btn = $("az-resume");
    if (!btn) return;
    var n = 0;
    if (state.letterGrid && state.mainReady && state.mainSeed === seedSentence() && !premonitionsRunning()) {
      n = missingPremonitions().length;
    }
    btn.hidden = n === 0;
    btn.textContent = "Resume " + n + " pending";
  }

  /** Hover / lightbox: move a letter to the front of a queue that is already running. Never starts one. */
  function preferPremonition(ch) {
    if (!state.letterGrid || !state.mainReady) return;
    var at = state.previewQueue.indexOf(ch);
    if (at > 0) {
      state.previewQueue.splice(at, 1);
      state.previewQueue.unshift(ch);
    }
  }

  /** Start a premonition run. Callers: a clicked Generate (after its main still) or the Resume button. */
  function queuePremonitions(preferCh) {
    if (!state.letterGrid) return;
    if (!state.mainReady) {
      if (preferCh) state.pendingPrefer = preferCh;
      return;
    }
    state.previewGen++;
    state.previewBusy = 0;
    state.previewQueue = [];
    if (preferCh && !state.previewUrls[previewKey(preferCh)]) {
      state.previewQueue.push(preferCh);
    }
    PREVIEW_GLYPHS.forEach(function (ch) {
      if (!state.previewUrls[previewKey(ch)] && state.previewQueue.indexOf(ch) < 0) {
        state.previewQueue.push(ch);
      }
    });
    pumpPremonitions();
  }

  function renderPreviewDocks() {
    var host = $("az-previews");
    if (!host) return;
    host.innerHTML = "";
    GLYPHS.forEach(function (ch) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "az-preview-tile";
      btn.dataset.azNext = ch;
      btn.title = nextInsight(ch).text;
      var cached = state.previewUrls[previewKey(ch)];
      if (cached) {
        var img = document.createElement("img");
        img.alt = ch;
        img.src = cached;
        btn.appendChild(img);
      } else {
        var cv = document.createElement("canvas");
        cv.width = 160;
        cv.height = 100;
        btn.appendChild(cv);
        var ctx = cv.getContext("2d");
        ctx.fillStyle = "#f7f9fc";
        ctx.fillRect(0, 0, cv.width, cv.height);
        paintParse(ctx, cv.width, cv.height, mutateParse(state.parse, ch), {
          max: 6,
          scale: 0.5
        });
      }
      var g = document.createElement("span");
      g.className = "az-preview-g";
      g.textContent = ch;
      btn.appendChild(g);
      btn.addEventListener("mouseenter", function () {
        state.hover = glyphIndex(ch);
        state.hoverCh = ch;
        renderInsight();
        drawScene();
        if (!state.previewUrls[previewKey(ch)]) preferPremonition(ch);
      });
      btn.addEventListener("mouseleave", function () {
        if (state.hoverCh === ch) {
          state.hover = -1;
          state.hoverCh = null;
        }
        renderInsight();
        drawScene();
      });
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        openLightbox(ch);
      });
      host.appendChild(btn);
    });
    bindSpaceTile();
  }

  function fillTileSketch(btn, ch) {
    if (!btn) return;
    var cached = state.previewUrls[previewKey(ch)];
    var media = btn.querySelector("img, canvas");
    if (cached) {
      var img = document.createElement("img");
      img.alt = glyphLabel(ch);
      img.src = cached;
      if (media) media.parentNode.replaceChild(img, media);
      else btn.insertBefore(img, btn.firstChild);
      return;
    }
    var cv = media && media.tagName === "CANVAS" ? media : document.createElement("canvas");
    cv.width = 160;
    cv.height = 160;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#f7f9fc";
    ctx.fillRect(0, 0, cv.width, cv.height);
    paintParse(ctx, cv.width, cv.height, mutateParse(state.parse.raw ? state.parse : parsePrompt(seedSentence()), ch), {
      max: 6,
      scale: 0.5
    });
    if (!media) btn.insertBefore(cv, btn.firstChild);
    else if (media !== cv) media.parentNode.replaceChild(cv, media);
  }

  function bindSpaceTile() {
    var btn = $("az-space-tile");
    if (!btn) return;
    fillTileSketch(btn, SPACE);
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("mouseenter", function () {
      state.hoverCh = SPACE;
      state.hover = -1;
      renderInsight();
      drawScene();
      if (!state.previewUrls[previewKey(SPACE)]) preferPremonition(SPACE);
    });
    btn.addEventListener("mouseleave", function () {
      if (state.hoverCh === SPACE) state.hoverCh = null;
      renderInsight();
      drawScene();
    });
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      openLightbox(SPACE);
    });
  }

  function openLightbox(ch) {
    state.lightboxCh = ch;
    var box = $("az-lightbox");
    var title = $("az-lightbox-title");
    var stage = $("az-lightbox-stage");
    var meta = $("az-lightbox-meta");
    if (!box || !stage) return;
    if (title) title.textContent = "Premonition · " + glyphLabel(ch);
    if (meta) meta.textContent = nextInsight(ch).text;
    stage.innerHTML = "";
    var url = state.previewUrls[previewKey(ch)];
    if (url) {
      var img = document.createElement("img");
      img.alt = glyphLabel(ch);
      img.src = url;
      stage.appendChild(img);
    } else {
      var cv = document.createElement("canvas");
      cv.width = 720;
      cv.height = 480;
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#f7f9fc";
      ctx.fillRect(0, 0, cv.width, cv.height);
      paintParse(ctx, cv.width, cv.height, mutateParse(state.parse.raw ? state.parse : parsePrompt(seedSentence()), ch), {
        max: 12,
        scale: 1.1
      });
      stage.appendChild(cv);
      preferPremonition(ch);
    }
    box.hidden = false;
  }

  function closeLightbox() {
    var box = $("az-lightbox");
    if (box) box.hidden = true;
    state.lightboxCh = null;
  }

  function useLightboxLetter() {
    var ch = state.lightboxCh;
    closeLightbox();
    if (ch == null) return;
    var input = $("az-prompt");
    if (input) {
      input.value = (input.value || "") + ch;
      applyPrompt(input.value, true);
    }
    if (ch !== SPACE) selectIndex(glyphIndex(ch));
  }

  function bindLightbox() {
    var useBtn = $("az-lightbox-use");
    var closeBtn = $("az-lightbox-close");
    var box = $("az-lightbox");
    if (useBtn && !useBtn.dataset.bound) {
      useBtn.dataset.bound = "1";
      useBtn.addEventListener("click", useLightboxLetter);
    }
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = "1";
      closeBtn.addEventListener("click", closeLightbox);
    }
    if (box && !box.dataset.bound) {
      box.dataset.bound = "1";
      box.addEventListener("click", function (e) {
        if (e.target === box) closeLightbox();
      });
    }
  }

  function drawScene() {
    var canvas = $("az-fold");
    if (!canvas) return;
    var wrap = canvas.parentNode;
    var w = Math.max(320, wrap.clientWidth || 640);
    var h = Math.max(240, wrap.clientHeight || 420);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    var ctx = canvas.getContext("2d");
    drawGrid(ctx, w, h);

    if (state.genUrl && state.genImg && state.genImg.complete) {
      ctx.save();
      var iw = state.genImg.naturalWidth || state.genImg.width;
      var ih = state.genImg.naturalHeight || state.genImg.height;
      if (!state.letterGrid) {
        ctx.fillStyle = "#0c1018";
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        var scFull = Math.min(w / iw, h / ih);
        var dw = iw * scFull;
        var dh = ih * scFull;
        ctx.drawImage(state.genImg, (w - dw) / 2, (h - dh) / 2, dw, dh);
        ctx.restore();
        drawDesmosCurves(ctx, (w - dw) / 2, (h - dh) / 2, dw, dh, "#7dd3fc");
        ctx.fillStyle = "#eef3ee";
        ctx.font = "italic 14px Times New Roman, serif";
        ctx.fillText(String(state.prompt || seedSentence()).slice(0, 72) || "standalone", 16, h - 16);
        return;
      }
      ctx.globalAlpha = 0.38;
      var sc = Math.min((w - 48) / iw, (h - 48) / ih);
      ctx.drawImage(state.genImg, 48, 24, iw * sc, ih * sc);
      ctx.restore();
      drawDesmosCurves(ctx, 48, 24, iw * sc, ih * sc, "#1d4ed8");
    }

    var p = state.parse.raw ? state.parse : parsePrompt(seedSentence());

    paintParse(ctx, w, h, p, {});
    var nextCh = state.hoverCh != null || state.hover >= 0 ? insightTarget() : null;
    if (nextCh) {
      var ghostParse = mutateParse(p, nextCh);
      ctx.save();
      ctx.globalAlpha = 0.55;
      paintParse(ctx, w, h, ghostParse, { ghost: true, max: Math.min(8, (p.qty || 1) + 1) });
      ctx.restore();
    }

    ctx.fillStyle = "#1a2030";
    ctx.font = "italic 15px Times New Roman, serif";
    var n = Math.max(1, p.qty || 1);
    var label = n + " " + (p.wantsApple ? (n === 1 ? "apple" : "apples") : p.nouns.join(", ") || "forms");
    ctx.fillText(label, 52, h - 40);
  }

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function persistAzStill(url, note) {
    if (!url) return Promise.resolve(null);
    var payload = {
      source: "az",
      collection: "generated",
      reveal: false,
      description: String(note || seedSentence()).slice(0, 800),
      meta: {
        source: "az",
        mode: state.letterGrid ? "letter-grid" : "standalone",
        prompt: state.prompt,
        seed: seedSentence()
      }
    };
    if (String(url).indexOf("data:") === 0) payload.image_base64 = url;
    else payload.image_url = url;
    var bases = [];
    var sf = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    if (sf) bases.push(sf);
    bases.push("");
    var host = (location.hostname || "").toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      bases.push("http://127.0.0.1:8765", "http://localhost:8765");
    } else {
      bases.push("http://127.0.0.1:8765", "http://localhost:8765");
    }
    function tryNext(i) {
      if (i >= bases.length) return Promise.resolve(null);
      var opts = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        mode: bases[i] ? "cors" : "same-origin"
      };
      try {
        opts.targetAddressSpace = "loopback";
      } catch (eAddr) {}
      return fetch((bases[i] || "") + "/api/save-generated-image", opts)
        .then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok || (d && d.ok === false)) throw new Error("save");
            return d;
          });
        })
        .catch(function () {
          return tryNext(i + 1);
        });
    }
    return tryNext(0);
  }

  /** Stroke the traced Bézier curves over the still, in the rectangle the still was drawn in. */
  function drawDesmosCurves(ctx, x, y, dw, dh, color) {
    var c = state.genCurves;
    if (!c || !state.showCurves || !c.beziers || !c.beziers.length) return;
    var sx = dw / c.width;
    var sy = dh / c.height;
    function px(p) {
      return x + p.x * sx;
    }
    function py(p) {
      return y + (c.flipY ? c.height - 1 - p.y : p.y) * sy;
    }
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 1.25;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (var i = 0; i < c.beziers.length; i++) {
      var b = c.beziers[i];
      ctx.moveTo(px(b.p0), py(b.p0));
      ctx.bezierCurveTo(px(b.p1), py(b.p1), px(b.p2), py(b.p2), px(b.p3), py(b.p3));
    }
    ctx.stroke();
    ctx.restore();
  }

  function updateDesmosUi() {
    var n = state.genCurves && state.genCurves.exprs ? state.genCurves.exprs.length : 0;
    var open = $("az-desmos-open");
    if (open) {
      open.hidden = n === 0;
      open.textContent = "Open " + n + " curves in Graph";
    }
    var toggle = $("az-desmos-toggle");
    if (toggle) toggle.checked = !!state.showCurves;
  }

  /** Run the Graph tab's image → Desmos tracer on a finished still. Resolves the result or null. */
  function traceDesmos(url, job) {
    var api = window.GraphCalcImgTrace;
    if (!api || !api.imageToBezierExprs) return Promise.resolve(null);
    return api
      .imageToBezierExprs(url, DESMOS_OPTS)
      .then(function (result) {
        if (job !== state.genJob) return null;
        state.genCurves = result && result.exprs && result.exprs.length ? result : null;
        updateDesmosUi();
        drawScene();
        return state.genCurves;
      })
      .catch(function (err) {
        if (job !== state.genJob) return null;
        state.genCurves = null;
        updateDesmosUi();
        if (window.console) console.warn("[0-Z] Desmos trace failed:", err && err.message);
        return null;
      });
  }

  /** Graph tab, with these curves loaded as Desmos expressions (like Convert to curves). */
  function openCurvesInGraph() {
    var c = state.genCurves;
    if (!c || !c.exprs || !c.exprs.length) return;
    if (window.GalleryTabs && window.GalleryTabs.showTab) window.GalleryTabs.showTab("graphcalc");
    var gc = window.GraphCalc;
    if (gc && gc.addSketchCurves) gc.addSketchCurves(c.exprs);
    else if (gc && gc.pasteDesmos) gc.pasteDesmos(c.exprs.join("\n"));
  }

  function pollJob(jobId, left) {
    if (left <= 0) return Promise.reject(new Error("timed out"));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (job) {
        if (job && job.status === "done") {
          var img = job.image || (job.images && job.images[0]);
          if (img && img.url) return img.url;
        }
        if (job && job.status === "failed") throw new Error((job.error && job.error.message) || "failed");
        return new Promise(function (resolve) {
          setTimeout(resolve, 1000);
        }).then(function () {
          return pollJob(jobId, left - 1);
        });
      });
  }

  function generateStill(prompt) {
    var job = ++state.genJob;
    var scene = String(prompt || seedSentence());
    var stasis =
      "Museum line-art painting of this exact scene, accurate forms, clear contours, no collage: " +
      scene;
    var countEl = $("az-fold-count");
    if (countEl) countEl.textContent = "generating main still…";
    state.genCurves = null;
    updateDesmosUi();
    return fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stasis: stasis,
        buzz_words: ["line art", "contour", "ink", "fill"],
        aspect_ratio: "16:9"
      })
    })
      .then(function (r) {
        if (r.status === 202) {
          return r.json().then(function (d) {
            return pollJob(d.job_id, 90);
          });
        }
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "generate failed");
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image");
        });
      })
      .then(function (url) {
        if (job !== state.genJob) return;
        state.genUrl = url;
        var note = state.letterGrid
          ? "0-Z main · " + scene
          : "0-Z standalone · " + scene;
        persistAzStill(url, note);
        return new Promise(function (resolve) {
          var img = new Image();
          img.onload = function () {
            if (job !== state.genJob) return resolve(true);
            state.genImg = img;
            drawScene();
            var ready = state.letterGrid ? "main still ready" : "standalone still ready · saved to Generated";
            if (countEl) countEl.textContent = ready + " · tracing Desmos curves…";
            traceDesmos(url, job).then(function (curves) {
              if (job === state.genJob && countEl) {
                countEl.textContent = curves
                  ? ready + " · " + curves.exprs.length + " Desmos curves from " + curves.contourCount + " contours"
                  : ready + " · no Desmos curves traced";
              }
              resolve(true);
            });
          };
          img.onerror = function () {
            resolve(true);
          };
          img.src = url;
        });
      })
      .catch(function (err) {
        if (job !== state.genJob) return false;
        var msg = String((err && err.message) || "failed");
        if (countEl) countEl.textContent = "generate failed: " + (msg.length > 220 ? msg.slice(0, 220) + "…" : msg);
        return false;
      });
  }

  function stopLetterGridJobs() {
    state.previewGen++;
    state.previewQueue = [];
    state.previewBusy = 0;
    state.pendingPrefer = null;
    updateResumeButton();
  }

  function applyLetterGridUi() {
    var drawer = $("az-preview-drawer");
    var shell = document.querySelector("#panel-az .az-shell") || document.querySelector(".az-shell");
    if (drawer) drawer.hidden = !state.letterGrid;
    if (shell) shell.classList.toggle("az-letter-grid-off", !state.letterGrid);
    var toggle = $("az-letter-grid");
    if (toggle) {
      toggle.checked = !!state.letterGrid;
      toggle.setAttribute("aria-checked", state.letterGrid ? "true" : "false");
    }
    var genBtn = $("az-generate");
    if (genBtn) {
      genBtn.textContent = state.letterGrid ? "Generate still" : "Generate standalone";
    }
  }

  function setLetterGrid(on, opts) {
    opts = opts || {};
    state.letterGrid = !!on;
    try {
      localStorage.setItem("az-letter-grid", state.letterGrid ? "1" : "0");
    } catch (e) {}
    applyLetterGridUi();
    if (!state.letterGrid) {
      stopLetterGridJobs();
    }
    // Turning the grid back on never restarts generation by itself — see Resume.
    updateResumeButton();
    drawScene();
  }

  function generateStandalone() {
    state.mainReady = false;
    state.mainSeed = seedSentence();
    stopLetterGridJobs();
    return generateStill(seedSentence()).then(function (ok) {
      state.mainReady = !!ok;
    });
  }

  function generateMainThenPreviews() {
    state.mainReady = false;
    state.mainSeed = seedSentence();
    return generateStill(seedSentence()).then(function (ok) {
      // A failed main still means the image provider is down — 37 letter stills would fail too.
      if (!ok) return;
      state.mainReady = true;
      if (!state.letterGrid) return;
      queuePremonitions(state.pendingPrefer);
      state.pendingPrefer = null;
    });
  }

  function runGenerate() {
    if (state.letterGrid) return generateMainThenPreviews();
    return generateStandalone();
  }

  function applyPrompt(text, generate) {
    state.prompt = String(text || "");
    state.parse = parsePrompt(state.prompt);
    renderEquations();
    renderInsight();
    if (state.letterGrid) renderPreviewDocks();
    drawScene();
    var countEl = $("az-fold-count");
    if (countEl && !generate) {
      var n = state.parse.qty;
      countEl.textContent = state.parse.raw
        ? (state.parse.wantsApple ? n + " apple" + (n === 1 ? "" : "s") : n + " " + (state.parse.nouns[0] || "forms"))
        : "empty";
    }
    updateResumeButton();
    if (generate) runGenerate();
  }

  function selectIndex(index) {
    var i = Math.max(0, Math.min(TOP, index | 0));
    state.selected = i;
    document.querySelectorAll(".az-rung").forEach(function (el) {
      var on = Number(el.dataset.azIndex) === i;
      el.classList.toggle("is-selected", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderReadout();
    drawScene();
  }

  function copySelected() {
    var ch = GLYPHS[state.selected];
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ch).catch(function () {});
    }
  }

  function onKey(e) {
    if (!document.body.classList.contains("az-tab-active")) return;
    var tag = (e.target && e.target.tagName) || "";
    if (e.key === "Escape" && state.lightboxCh != null) {
      e.preventDefault();
      closeLightbox();
      return;
    }
    if (tag === "INPUT" || tag === "TEXTAREA") {
      // Enter in the 0-Z prompt submits it like the Generate button. Other fields
      // (e.g. page chat) must never start a generate.
      if (e.key === "Enter" && e.target.id === "az-prompt") {
        e.preventDefault();
        applyPrompt(e.target.value, true);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      selectIndex(state.selected + 1);
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      selectIndex(state.selected - 1);
    }
  }

  function bindEqToggle() {
    var btn = $("az-eq-toggle");
    var panel = $("az-equations");
    if (!btn || !panel) return;
    var hidden = false;
    try {
      hidden = localStorage.getItem("az-eq-hidden") === "1";
    } catch (e) {}
    function apply(hide) {
      state.eqHidden = hide;
      panel.classList.toggle("is-hidden", hide);
      btn.setAttribute("aria-expanded", hide ? "false" : "true");
      btn.textContent = hide ? "Show values" : "Hide values";
      try {
        localStorage.setItem("az-eq-hidden", hide ? "1" : "0");
      } catch (err) {}
    }
    apply(hidden);
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", function () {
      apply(!state.eqHidden);
    });
  }

  function bindLetterGridToggle() {
    var toggle = $("az-letter-grid");
    if (!toggle || toggle.dataset.bound) return;
    toggle.dataset.bound = "1";
    toggle.addEventListener("change", function () {
      setLetterGrid(!!toggle.checked);
    });
  }

  function bindPrompt() {
    var input = $("az-prompt");
    if (!input || input.dataset.bound) return;
    input.dataset.bound = "1";
    input.addEventListener("input", function () {
      // Live local sketch only — generating costs credits, so it waits for Generate.
      applyPrompt(input.value, false);
    });
    var genBtn = $("az-generate");
    if (genBtn && !genBtn.dataset.bound) {
      genBtn.dataset.bound = "1";
      genBtn.addEventListener("click", function () {
        applyPrompt(input.value, true);
      });
    }
    var openBtn = $("az-desmos-open");
    if (openBtn && !openBtn.dataset.bound) {
      openBtn.dataset.bound = "1";
      openBtn.addEventListener("click", openCurvesInGraph);
    }
    var curvesToggle = $("az-desmos-toggle");
    if (curvesToggle && !curvesToggle.dataset.bound) {
      curvesToggle.dataset.bound = "1";
      try {
        state.showCurves = localStorage.getItem("az-desmos-curves") !== "0";
      } catch (eC) {}
      curvesToggle.addEventListener("change", function () {
        state.showCurves = !!curvesToggle.checked;
        try {
          localStorage.setItem("az-desmos-curves", state.showCurves ? "1" : "0");
        } catch (eS) {}
        drawScene();
      });
    }
    var resumeBtn = $("az-resume");
    if (resumeBtn && !resumeBtn.dataset.bound) {
      resumeBtn.dataset.bound = "1";
      resumeBtn.addEventListener("click", function () {
        queuePremonitions(null);
      });
    }
  }

  function init() {
    renderColumn();
    renderReadout();
    bindPrompt();
    bindLetterGridToggle();
    var copyBtn = $("az-copy");
    if (copyBtn && !copyBtn.dataset.bound) {
      copyBtn.dataset.bound = "1";
      copyBtn.addEventListener("click", copySelected);
    }
    if (!document.documentElement.dataset.azKeys) {
      document.documentElement.dataset.azKeys = "1";
      document.addEventListener("keydown", onKey);
      window.addEventListener("resize", drawScene);
    }
    bindLightbox();
    bindPreviewDrag();
    var savedCols = 6;
    try {
      savedCols = parseInt(localStorage.getItem("az-preview-cols") || "6", 10);
    } catch (eCols) {}
    applyPreviewCols(savedCols);
    var letterOn = true;
    try {
      var stored = localStorage.getItem("az-letter-grid");
      if (stored === "0") letterOn = false;
      else if (stored === "1") letterOn = true;
    } catch (eGrid) {}
    setLetterGrid(letterOn, { skipQueue: true });
    var input = $("az-prompt");
    applyPrompt(input ? input.value : "", false);
    if (state.letterGrid) renderPreviewDocks();
    bindEqToggle();
    // No generate here: init runs on page load and on every tab open. Stills are
    // generated only from the Generate button (or Enter in the 0-Z prompt).
    updateResumeButton();
    updateDesmosUi();
  }

  window.AzScale = {
    onShow: init,
    glyphs: GLYPHS.slice(),
    getState: function () {
      return {
        mainReady: state.mainReady,
        queued: state.previewQueue.length,
        busy: state.previewBusy,
        missing: missingPremonitions().length,
        letterGrid: state.letterGrid,
        desmosCurves: state.genCurves ? state.genCurves.exprs.length : 0,
        desmosContours: state.genCurves ? state.genCurves.contourCount : 0,
        showCurves: state.showCurves,
      };
    },
  };
  window.addEventListener("az-show", init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
