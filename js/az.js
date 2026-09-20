(function () {
  "use strict";

  var GLYPHS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
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
    prompt: "",
    parse: { qty: 1, nouns: [], hasTable: false, raw: "" },
    genUrl: "",
    genEdges: null,
    genJob: 0,
    timer: 0
  };

  function $(id) {
    return document.getElementById(id);
  }

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

  function nextInsight(index) {
    var i = index < 0 ? state.selected : index;
    var ch = GLYPHS[i];
    var k = kappaFor(i);
    var y = yValue(i);
    var aa = AA[ch] || "Xaa";
    var turn =
      k > 0.4 ? "opens a right loop" : k < -0.4 ? "cinches a left fold" : "extends the chain";
    var qty = state.parse.qty || 1;
    var extra =
      state.parse.wantsApple
        ? (qty >= 20 ? "would cluster another apple in the pile" : "would add another apple on the plane")
        : "would add one more residue to the backbone";
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
        "): κ = " +
        k.toFixed(3) +
        " — " +
        turn +
        ". " +
        extra +
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

  function renderInsight() {
    var el = $("az-next-insight");
    if (!el) return;
    var info = nextInsight(state.hover >= 0 ? state.hover : state.selected);
    el.textContent = info.text;
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
    ctx.fill();
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
    ctx.ellipse(6, -16, 7, 3.5, -0.6, 0, Math.PI * 2);
    ctx.fillStyle = ghost ? "rgba(46,120,62,0.25)" : "rgba(46,120,62,0.85)";
    ctx.fill();
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

  function appleLayout(n, w, h) {
    var count = Math.min(n, 48);
    var pts = [];
    var cols = Math.ceil(Math.sqrt(count * 1.4));
    var rows = Math.ceil(count / cols);
    var ox = w * 0.5;
    var oy = h * 0.52;
    var gap = Math.min(38, (w - 120) / Math.max(cols, 1));
    var i;
    for (i = 0; i < count; i++) {
      var c = i % cols;
      var r = Math.floor(i / cols);
      pts.push({
        x: ox + (c - (cols - 1) / 2) * gap + (r % 2) * (gap * 0.28),
        y: oy + (r - (rows - 1) / 2) * gap * 0.72
      });
    }
    return pts;
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
      ctx.globalAlpha = 0.38;
      var iw = state.genImg.naturalWidth || state.genImg.width;
      var ih = state.genImg.naturalHeight || state.genImg.height;
      var sc = Math.min((w - 48) / iw, (h - 48) / ih);
      ctx.drawImage(state.genImg, 48, 24, iw * sc, ih * sc);
      ctx.restore();
    }
    if (state.genEdges) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(state.genEdges, 0, 0, w, h);
      ctx.restore();
    }

    var p = state.parse;
    if (!p.raw) {
      ctx.fillStyle = "rgba(26,32,48,0.45)";
      ctx.font = "italic 16px Times New Roman, serif";
      ctx.fillText("Type a scene — apples, counts, a table — the line work follows the words.", 56, h * 0.42);
      return;
    }

    if (p.hasTable) drawTable(ctx, w * 0.48, h * 0.62, Math.min(220, w * 0.32), 36);

    var n = Math.max(1, p.qty);
    var shown = Math.min(n, 48);
    if (p.wantsApple) {
      var pts = appleLayout(shown, w, h);
      pts.forEach(function (pt, i) {
        drawApple(ctx, pt.x, pt.y, 1.05 - (i % 5) * 0.04, false);
      });
      var nextI = state.hover >= 0 ? state.hover : state.selected;
      var ghost = appleLayout(shown + 1, w, h);
      if (ghost[shown]) {
        drawApple(ctx, ghost[shown].x, ghost[shown].y, 0.92, true);
        ctx.fillStyle = "#1d4ed8";
        ctx.font = "italic 12px Times New Roman, serif";
        ctx.fillText("next " + GLYPHS[nextI], ghost[shown].x + 14, ghost[shown].y - 12);
      }
    } else {
      var noun = (p.nouns[0] || "form").replace(/s$/, "");
      var i;
      for (i = 0; i < shown; i++) {
        var gx = w * 0.28 + (i % 8) * 52;
        var gy = h * 0.38 + Math.floor(i / 8) * 44;
        drawGeneric(ctx, gx, gy, 1, noun, false);
      }
    }

    ctx.fillStyle = "#1a2030";
    ctx.font = "italic 15px Times New Roman, serif";
    var label = shown < n ? shown + " of " + n + " " + (p.wantsApple ? "apples" : p.nouns[0] || "forms") : n + " " + (p.wantsApple ? (n === 1 ? "apple" : "apples") : p.nouns.join(", "));
    ctx.fillText(label, 52, h - 40);
  }

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function traceEdges(img, w, h) {
    var src = document.createElement("canvas");
    src.width = w;
    src.height = h;
    var sctx = src.getContext("2d");
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    var sc = Math.min(w / iw, h / ih);
    sctx.drawImage(img, 24, 16, iw * sc, ih * sc);
    var data;
    try {
      data = sctx.getImageData(0, 0, w, h);
    } catch (err) {
      return null;
    }
    var out = sctx.createImageData(w, h);
    var px = data.data;
    var ox = out.data;
    var y;
    var x;
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        var i = (y * w + x) * 4;
        var lum = function (xx, yy) {
          var j = (yy * w + xx) * 4;
          return px[j] * 0.3 + px[j + 1] * 0.59 + px[j + 2] * 0.11;
        };
        var gx = lum(x + 1, y) - lum(x - 1, y);
        var gy = lum(x, y + 1) - lum(x, y - 1);
        var mag = Math.sqrt(gx * gx + gy * gy);
        if (mag > 28) {
          ox[i] = 29;
          ox[i + 1] = 78;
          ox[i + 2] = 216;
          ox[i + 3] = Math.min(220, mag * 3);
        }
      }
    }
    var edge = document.createElement("canvas");
    edge.width = w;
    edge.height = h;
    edge.getContext("2d").putImageData(out, 0, 0);
    return edge;
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
    var stasis =
      "Museum line-art painting of this exact scene, accurate forms, clear contours, no collage: " +
      prompt;
    var countEl = $("az-fold-count");
    if (countEl) countEl.textContent = "generating still…";
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
        var img = new Image();
        img.onload = function () {
          if (job !== state.genJob) return;
          state.genImg = img;
          var canvas = $("az-fold");
          state.genEdges = canvas ? traceEdges(img, canvas.width, canvas.height) : null;
          drawScene();
          if (countEl) countEl.textContent = "generated line work";
        };
        img.src = url;
      })
      .catch(function () {
        if (job !== state.genJob) return;
        if (countEl) countEl.textContent = "line work (local)";
      });
  }

  function applyPrompt(text, generate) {
    state.prompt = String(text || "");
    state.parse = parsePrompt(state.prompt);
    renderEquations();
    renderInsight();
    drawScene();
    var countEl = $("az-fold-count");
    if (countEl && !generate) {
      var n = state.parse.qty;
      countEl.textContent = state.parse.raw
        ? (state.parse.wantsApple ? n + " apple" + (n === 1 ? "" : "s") : n + " " + (state.parse.nouns[0] || "forms"))
        : "empty";
    }
    if (generate && state.parse.raw) generateStill(state.prompt);
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
    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (e.key === "Enter") {
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

  function bindPrompt() {
    var input = $("az-prompt");
    if (!input || input.dataset.bound) return;
    input.dataset.bound = "1";
    input.addEventListener("input", function () {
      applyPrompt(input.value, false);
      clearTimeout(state.timer);
      state.timer = setTimeout(function () {
        applyPrompt(input.value, true);
      }, 1600);
    });
    var genBtn = $("az-generate");
    if (genBtn && !genBtn.dataset.bound) {
      genBtn.dataset.bound = "1";
      genBtn.addEventListener("click", function () {
        applyPrompt(input.value, true);
      });
    }
  }

  function init() {
    renderColumn();
    renderReadout();
    bindPrompt();
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
    var input = $("az-prompt");
    applyPrompt(input ? input.value : "", false);
  }

  window.AzScale = { onShow: init, glyphs: GLYPHS.slice() };
  window.addEventListener("az-show", init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
