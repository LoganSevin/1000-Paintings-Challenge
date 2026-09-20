(function () {
  "use strict";

  var GLYPHS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  var COUNT = GLYPHS.length;
  var TOP = COUNT - 1;
  var AA = {
    A: "Ala", C: "Cys", D: "Asp", E: "Glu", F: "Phe", G: "Gly", H: "His",
    I: "Ile", K: "Lys", L: "Leu", M: "Met", N: "Asn", P: "Pro", Q: "Gln",
    R: "Arg", S: "Ser", T: "Thr", V: "Val", W: "Trp", Y: "Tyr",
    B: "Asx", J: "Xle", O: "Pyl", U: "Sec", X: "Xaa", Z: "Glx",
    "0": "Gly", "1": "Ala", "2": "Ser", "3": "Thr", "4": "Val",
    "5": "Leu", "6": "Ile", "7": "Pro", "8": "Phe", "9": "Tyr"
  };

  var state = {
    selected: 0,
    prompt: "",
    residues: [],
    shown: 0,
    raf: 0
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

  function rankLabel(index) {
    if (index === 0) return "highest point";
    if (index === TOP) return "lowest point";
    return "rung " + (index + 1) + " of " + GLYPHS.length;
  }

  function kappaFor(index) {
    if (index < 0) return 0;
    var k = ((index % 7) - 3) * (Math.PI / 6.5);
    if (GLYPHS[index] === "P" || GLYPHS[index] === "7") k += Math.PI / 2.4;
    if (GLYPHS[index] === "G" || GLYPHS[index] === "0") k *= 0.35;
    return k;
  }

  function buildResidues(text) {
    var pts = [];
    var x = 0;
    var y = 0;
    var theta = 0.22;
    var raw = String(text || "").toUpperCase();
    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (ch === " " || ch === "-") {
        theta += 0.18;
        continue;
      }
      var idx = glyphIndex(ch);
      if (idx < 0) continue;
      theta += kappaFor(idx);
      var step = 16 + (idx % 6);
      x += Math.cos(theta) * step;
      y += Math.sin(theta) * step;
      pts.push({
        x: x,
        y: y,
        ch: ch,
        idx: idx,
        aa: AA[ch] || "Xaa",
        hydro: yValue(idx)
      });
    }
    return pts;
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
      btn.title = ch + " · " + rankLabel(i);
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
  }

  function equationLines(residues) {
    var lines = [
      "θ₀ = 0.22",
      "x_{n+1} = x_n + \\cos(\\theta_n)",
      "y_{n+1} = y_n + \\sin(\\theta_n)"
    ];
    var seen = {};
    residues.forEach(function (r) {
      if (seen[r.ch]) return;
      seen[r.ch] = true;
      var k = kappaFor(r.idx);
      lines.push(
        "\\kappa(" + r.ch + ") = " + k.toFixed(3) +
          "  ·  y = " + r.hydro + "\\cos(" + (r.idx + 1) + "x)"
      );
    });
    if (residues.length) {
      lines.push("N = " + residues.length + " residues");
    }
    return lines.slice(0, 10);
  }

  function renderEquations(residues) {
    var el = $("az-equations");
    if (!el) return;
    if (!residues.length) {
      el.innerHTML = "<em>Type in the prompt — letters become κ turns and Desmos curves.</em>";
      return;
    }
    el.innerHTML = equationLines(residues)
      .map(function (line) {
        return "<div>" + line.replace(/</g, "&lt;") + "</div>";
      })
      .join("");
  }

  function drawFold() {
    var canvas = $("az-fold");
    if (!canvas) return;
    var wrap = canvas.parentNode;
    var w = Math.max(320, wrap.clientWidth || 640);
    var h = Math.max(240, wrap.clientHeight || 420);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

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

    var pts = state.residues.slice(0, Math.max(0, Math.round(state.shown)));
    if (!pts.length) {
      ctx.fillStyle = "rgba(26,32,48,0.45)";
      ctx.font = "italic 16px Times New Roman, serif";
      ctx.fillText("Type a sequence — the chain folds as you write.", 56, h * 0.42);
      return;
    }

    var minX = pts[0].x;
    var maxX = pts[0].x;
    var minY = pts[0].y;
    var maxY = pts[0].y;
    pts.forEach(function (p) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    var pad = 48;
    var spanX = Math.max(40, maxX - minX);
    var spanY = Math.max(40, maxY - minY);
    var scale = Math.min((w - pad * 2) / spanX, (h - pad * 2 - 20) / spanY);
    function tx(p) {
      return pad + (p.x - minX) * scale;
    }
    function ty(p) {
      return h - pad - (p.y - minY) * scale;
    }

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1d4ed8";
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var px = tx(p);
      var py = ty(p);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    ctx.strokeStyle = "rgba(29,78,216,0.28)";
    ctx.lineWidth = 10;
    ctx.stroke();

    pts.forEach(function (p, i) {
      var px = tx(p);
      var py = ty(p);
      var r = 7 + (p.idx % 5) * 0.6;
      var hue = 32 + p.hydro * 6;
      ctx.beginPath();
      ctx.arc(px, py, r + 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(201,162,39,0.18)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = "hsl(" + hue + ", 62%, 58%)";
      ctx.fill();
      ctx.strokeStyle = "#1a2030";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      var ang = i === 0 ? 0 : Math.atan2(py - ty(pts[i - 1]), px - tx(pts[i - 1]));
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(ang + 1.2) * (r + 9), py + Math.sin(ang + 1.2) * (r + 9));
      ctx.strokeStyle = "rgba(26,32,48,0.55)";
      ctx.stroke();
      ctx.fillStyle = "#111";
      ctx.font = "700 10px Times New Roman, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.ch, px, py);
    });
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  function tickFold() {
    var target = state.residues.length;
    if (Math.abs(state.shown - target) < 0.04) {
      state.shown = target;
      drawFold();
      state.raf = 0;
      return;
    }
    state.shown += (target - state.shown) * 0.22;
    drawFold();
    state.raf = requestAnimationFrame(tickFold);
  }

  function setPrompt(text) {
    state.prompt = String(text || "");
    state.residues = buildResidues(state.prompt);
    renderEquations(state.residues);
    var countEl = $("az-fold-count");
    if (countEl) {
      countEl.textContent = state.residues.length
        ? state.residues.length + " residue" + (state.residues.length === 1 ? "" : "s")
        : "empty chain";
    }
    if (!state.raf) state.raf = requestAnimationFrame(tickFold);
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
    var rung = document.querySelector('.az-rung[data-az-index="' + i + '"]');
    if (rung && rung.scrollIntoView) {
      rung.scrollIntoView({ block: "nearest" });
    }
  }

  function copySelected() {
    var ch = GLYPHS[state.selected];
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ch).catch(function () {});
    }
    var btn = $("az-copy");
    if (btn) {
      var prev = btn.textContent;
      btn.textContent = "Copied " + ch;
      setTimeout(function () {
        btn.textContent = prev;
      }, 1200);
    }
  }

  function onKey(e) {
    if (!document.body.classList.contains("az-tab-active")) return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      selectIndex(state.selected + 1);
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      selectIndex(state.selected - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      selectIndex(TOP);
    }
  }

  function bindPrompt() {
    var input = $("az-prompt");
    if (!input || input.dataset.bound) return;
    input.dataset.bound = "1";
    input.addEventListener("input", function () {
      setPrompt(input.value);
    });
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
      window.addEventListener("resize", function () {
        drawFold();
      });
    }
    var input = $("az-prompt");
    setPrompt(input ? input.value : state.prompt);
    drawFold();
  }

  window.AzScale = {
    onShow: init,
    glyphs: GLYPHS.slice()
  };

  window.addEventListener("az-show", init);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
