/**
 * Sine — interactive light drawings.
 * Every stroke is a sine wave along a path. Morph bends the path and the
 * wave; Move carries a whole stroke.
 */
(function () {
  "use strict";

  var STORE = "l7in_sine_light_v1";
  var TAU = Math.PI * 2;
  var HUES = [172, 48, 322, 198, 128];

  var brush = {
    freq: 6,
    amp: 0.08,
    phase: 0,
    harm: 0.45,
    hue: 172,
    thick: 2.4,
    speed: 1.6,
  };

  var state = {
    on: false,
    raf: 0,
    last: 0,
    time: 0,
    canvas: null,
    ctx: null,
    dpr: 1,
    w: 0,
    h: 0,
    strokes: [],
    nextId: 1,
    selected: null,
    mode: "morph",
    pointer: null,
    undo: [],
    saveTimer: 0,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function cloneStroke(s) {
    return {
      id: s.id,
      pts: s.pts.map(function (p) {
        return { x: p.x, y: p.y };
      }),
      freq: s.freq,
      amp: s.amp,
      phase: s.phase,
      harm: s.harm,
      hue: s.hue,
      thick: s.thick,
      speed: s.speed,
    };
  }

  function snapshot() {
    state.undo.push(
      state.strokes.map(cloneStroke)
    );
    if (state.undo.length > 40) state.undo.shift();
  }

  function scheduleSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(save, 280);
  }

  function save() {
    state.saveTimer = 0;
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({
          strokes: state.strokes,
          nextId: state.nextId,
          brush: brush,
          mode: state.mode,
        })
      );
    } catch (e) {}
  }

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE) || "null");
      if (!raw || !Array.isArray(raw.strokes)) return false;
      state.strokes = raw.strokes.filter(function (s) {
        return s && Array.isArray(s.pts) && s.pts.length;
      });
      state.nextId = raw.nextId || state.strokes.length + 1;
      if (raw.brush) Object.assign(brush, raw.brush);
      if (raw.mode === "draw" || raw.mode === "move" || raw.mode === "morph") {
        state.mode = raw.mode;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function freshWave(y) {
    var pts = [];
    var i;
    for (i = 0; i <= 28; i++) {
      pts.push({ x: 0.08 + (i / 28) * 0.84, y: y });
    }
    return {
      id: state.nextId++,
      pts: pts,
      freq: brush.freq,
      amp: brush.amp,
      phase: brush.phase,
      harm: brush.harm,
      hue: brush.hue,
      thick: brush.thick,
      speed: brush.speed,
    };
  }

  function selectedStroke() {
    var i;
    for (i = 0; i < state.strokes.length; i++) {
      if (state.strokes[i].id === state.selected) return state.strokes[i];
    }
    return null;
  }

  function targetParams() {
    return selectedStroke() || brush;
  }

  function cssSize() {
    var r = state.canvas.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height), r: r };
  }

  function resize() {
    if (!state.canvas) return;
    var box = cssSize();
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    state.w = box.w;
    state.h = box.h;
    state.canvas.width = Math.round(box.w * state.dpr);
    state.canvas.height = Math.round(box.h * state.dpr);
    state.ctx = state.canvas.getContext("2d");
    state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  function localPoint(e) {
    var box = cssSize();
    return {
      x: (e.clientX - box.r.left) / box.w,
      y: (e.clientY - box.r.top) / box.h,
      px: e.clientX - box.r.left,
      py: e.clientY - box.r.top,
    };
  }

  function toPx(p) {
    return { x: p.x * state.w, y: p.y * state.h };
  }

  function spineSamples(pts) {
    var px = pts.map(toPx);
    if (px.length < 2) return px.map(function (p) {
      return { x: p.x, y: p.y, u: 0, nx: 0, ny: -1 };
    });
    var seg = [];
    var total = 0;
    var i;
    for (i = 1; i < px.length; i++) {
      var d = Math.hypot(px[i].x - px[i - 1].x, px[i].y - px[i - 1].y);
      seg.push(d);
      total += d;
    }
    if (total < 1) {
      return [{ x: px[0].x, y: px[0].y, u: 0, nx: 0, ny: -1 }];
    }
    var step = 3;
    var out = [];
    function at(dist) {
      var walked = 0;
      var k = 1;
      while (k < px.length && walked + seg[k - 1] < dist) {
        walked += seg[k - 1];
        k++;
      }
      var span = seg[k - 1] || 1;
      var t = clamp((dist - walked) / span, 0, 1);
      var a = px[k - 1];
      var b = px[Math.min(k, px.length - 1)];
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var len = Math.hypot(dx, dy) || 1;
      return {
        x: a.x + dx * t,
        y: a.y + dy * t,
        u: dist / total,
        nx: -dy / len,
        ny: dx / len,
      };
    }
    var prev = null;
    for (var dist = 0; dist <= total; dist += step) {
      var s = at(Math.min(dist, total));
      if (prev && s.nx * prev.nx + s.ny * prev.ny < 0) {
        s.nx *= -1;
        s.ny *= -1;
      }
      prev = s;
      out.push(s);
    }
    return out;
  }

  function wavePoints(stroke, time) {
    var spine = spineSamples(stroke.pts);
    var amp = stroke.amp * Math.min(state.w, state.h);
    var phase = stroke.phase + time * stroke.speed;
    return spine.map(function (s) {
      var ang = s.u * stroke.freq * TAU + phase;
      var wave = Math.sin(ang) + stroke.harm * 0.55 * Math.sin(ang * 2.0 + 1.1);
      return {
        x: s.x + s.nx * amp * wave,
        y: s.y + s.ny * amp * wave,
        u: s.u,
        glow: 0.45 + 0.55 * Math.pow(Math.max(0, Math.sin(ang * 1.0)), 1.4),
      };
    });
  }

  function trace(ctx, pts) {
    if (!pts.length) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    var i;
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }

  function drawStroke(ctx, stroke, time, selected) {
    var pts = wavePoints(stroke, time);
    if (pts.length < 2) return;
    var hue = stroke.hue;
    var thick = stroke.thick * (selected ? 1.15 : 1);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "hsla(" + hue + ", 100%, 62%, 0.16)";
    ctx.lineWidth = thick * 8;
    trace(ctx, pts);
    ctx.stroke();
    ctx.strokeStyle = "hsla(" + hue + ", 100%, 70%, 0.55)";
    ctx.lineWidth = thick * 2.6;
    trace(ctx, pts);
    ctx.stroke();
    ctx.strokeStyle = "hsla(" + hue + ", 35%, 96%, 0.92)";
    ctx.lineWidth = Math.max(1, thick * 0.7);
    trace(ctx, pts);
    ctx.stroke();

    ctx.fillStyle = "hsla(" + hue + ", 40%, 98%, 0.9)";
    var i;
    for (i = 0; i < pts.length; i += 3) {
      var p = pts[i];
      var rad = (0.6 + p.glow * 2.1) * (selected ? 1.15 : 1);
      ctx.globalAlpha = 0.25 + p.glow * 0.75;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (selected && state.mode === "morph") {
      ctx.globalCompositeOperation = "source-over";
      var handles = handleIndexes(stroke);
      handles.forEach(function (idx) {
        var h = toPx(stroke.pts[idx]);
        ctx.beginPath();
        ctx.arc(h.x, h.y, 5, 0, TAU);
        ctx.fillStyle = "rgba(8, 16, 18, 0.8)";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#d8fff4";
        ctx.stroke();
      });
    }
  }

  function handleIndexes(stroke) {
    var n = stroke.pts.length;
    if (n <= 1) return [0];
    var want = Math.min(n, 16);
    var out = [];
    var i;
    for (i = 0; i < want; i++) {
      out.push(Math.round((i * (n - 1)) / (want - 1)));
    }
    return out;
  }

  function draw() {
    var ctx = state.ctx;
    if (!ctx) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, state.w, state.h);
    var g = ctx.createRadialGradient(
      state.w * 0.5,
      state.h * 0.45,
      20,
      state.w * 0.5,
      state.h * 0.5,
      Math.max(state.w, state.h) * 0.72
    );
    g.addColorStop(0, "rgba(18, 36, 42, 0.55)");
    g.addColorStop(1, "rgba(5, 6, 10, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, state.w, state.h);
    var i;
    for (i = 0; i < state.strokes.length; i++) {
      var s = state.strokes[i];
      drawStroke(ctx, s, state.time, s.id === state.selected);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function hitHandle(stroke, px, py) {
    if (state.mode !== "morph") return -1;
    var best = -1;
    var bestD = 16 * 16;
    handleIndexes(stroke).forEach(function (idx) {
      var h = toPx(stroke.pts[idx]);
      var d = (h.x - px) * (h.x - px) + (h.y - py) * (h.y - py);
      if (d < bestD) {
        bestD = d;
        best = idx;
      }
    });
    return best;
  }

  function hitStroke(px, py) {
    var best = null;
    var bestD = 26 * 26;
    var i;
    for (i = state.strokes.length - 1; i >= 0; i--) {
      var s = state.strokes[i];
      var handle = hitHandle(s, px, py);
      if (handle >= 0) {
        return { stroke: s, handle: handle, d: 0 };
      }
      var pts = wavePoints(s, state.time);
      var k;
      for (k = 0; k < pts.length; k += 2) {
        var d = (pts[k].x - px) * (pts[k].x - px) + (pts[k].y - py) * (pts[k].y - py);
        if (d < bestD) {
          bestD = d;
          best = { stroke: s, handle: -1, d: d };
        }
      }
    }
    return best;
  }

  function bend(stroke, index, dx, dy) {
    var sigma = 2.4;
    var i;
    for (i = 0; i < stroke.pts.length; i++) {
      var w = Math.exp(-((i - index) * (i - index)) / (2 * sigma * sigma));
      stroke.pts[i].x = clamp(stroke.pts[i].x + dx * w, -0.2, 1.2);
      stroke.pts[i].y = clamp(stroke.pts[i].y + dy * w, -0.2, 1.2);
    }
  }

  function translate(stroke, dx, dy) {
    stroke.pts.forEach(function (p) {
      p.x += dx;
      p.y += dy;
    });
  }

  function applyBrushTo(stroke) {
    stroke.freq = brush.freq;
    stroke.amp = brush.amp;
    stroke.phase = brush.phase;
    stroke.harm = brush.harm;
    stroke.hue = brush.hue;
    stroke.thick = brush.thick;
    stroke.speed = brush.speed;
  }

  function readSlidersFrom(src) {
    setRange("sn-freq", src.freq);
    setRange("sn-amp", Math.round(src.amp * 1000) / 10);
    setRange("sn-phase", Math.round((src.phase * 180) / Math.PI) % 360);
    setRange("sn-harm", Math.round(src.harm * 100));
    setRange("sn-thick", src.thick);
    setRange("sn-speed", src.speed);
    setRange("sn-hue", src.hue);
    paintSwatches();
  }

  function setRange(id, value) {
    var el = $(id);
    if (!el) return;
    el.value = String(value);
    var out = el.parentNode && el.parentNode.querySelector("output");
    if (out) out.textContent = el.value;
  }

  function writeFromSliders() {
    var src = targetParams();
    src.freq = Number($("sn-freq").value);
    src.amp = Number($("sn-amp").value) / 100;
    src.phase = (Number($("sn-phase").value) * Math.PI) / 180;
    src.harm = Number($("sn-harm").value) / 100;
    src.thick = Number($("sn-thick").value);
    src.speed = Number($("sn-speed").value);
    src.hue = Number($("sn-hue").value);
    if (src !== brush) {
      brush.freq = src.freq;
      brush.amp = src.amp;
      brush.harm = src.harm;
      brush.hue = src.hue;
      brush.thick = src.thick;
      brush.speed = src.speed;
    }
    paintSwatches();
    updateReadout();
    scheduleSave();
  }

  function paintSwatches() {
    document.querySelectorAll(".sn-swatch").forEach(function (btn) {
      var hue = Number(btn.getAttribute("data-hue"));
      btn.classList.toggle("is-on", hue === Math.round(targetParams().hue));
      btn.style.background = "hsl(" + hue + ", 90%, 62%)";
    });
  }

  function updateReadout() {
    var el = $("sn-readout");
    if (!el) return;
    var s = selectedStroke();
    var src = s || brush;
    var label = s ? "Wave " + s.id : "Next stroke";
    el.textContent =
      label +
      " · " +
      state.strokes.length +
      (state.strokes.length === 1 ? " light" : " lights") +
      " · " +
      src.freq.toFixed(1) +
      " cycles · amp " +
      Math.round(src.amp * 100) +
      "%";
  }

  function setMode(mode) {
    state.mode = mode;
    if (state.canvas) state.canvas.dataset.mode = mode;
    document.querySelectorAll("[data-sn-mode]").forEach(function (btn) {
      btn.classList.toggle("is-on", btn.getAttribute("data-sn-mode") === mode);
    });
    scheduleSave();
  }

  function select(id) {
    state.selected = id;
    var s = selectedStroke();
    readSlidersFrom(s || brush);
    updateReadout();
  }

  function pointerDown(e) {
    if (!state.canvas) return;
    state.canvas.setPointerCapture(e.pointerId);
    var p = localPoint(e);
    if (state.mode === "draw") {
      snapshot();
      var stroke = {
        id: state.nextId++,
        pts: [{ x: p.x, y: p.y }],
        freq: brush.freq,
        amp: brush.amp,
        phase: brush.phase,
        harm: brush.harm,
        hue: brush.hue,
        thick: brush.thick,
        speed: brush.speed,
      };
      state.strokes.push(stroke);
      state.pointer = { id: e.pointerId, kind: "draw", stroke: stroke, last: p };
      select(stroke.id);
      return;
    }
    var hit = hitStroke(p.px, p.py);
    if (!hit) {
      select(null);
      state.pointer = null;
      return;
    }
    select(hit.stroke.id);
    state.pointer = {
      id: e.pointerId,
      kind: hit.handle >= 0 ? "bend" : state.mode,
      stroke: hit.stroke,
      handle: hit.handle,
      last: p,
      freq: hit.stroke.freq,
      amp: hit.stroke.amp,
    };
  }

  function pointerMove(e) {
    var drag = state.pointer;
    if (!drag || drag.id !== e.pointerId) return;
    var p = localPoint(e);
    if (drag.kind !== "draw" && !drag.didSnap) {
      snapshot();
      drag.didSnap = true;
    }
    if (drag.kind === "draw") {
      var prev = drag.stroke.pts[drag.stroke.pts.length - 1];
      if (Math.hypot(p.x - prev.x, p.y - prev.y) > 0.008) {
        drag.stroke.pts.push({ x: p.x, y: p.y });
      }
    } else if (drag.kind === "move") {
      translate(drag.stroke, p.x - drag.last.x, p.y - drag.last.y);
      drag.last = p;
    } else if (drag.kind === "bend") {
      bend(drag.stroke, drag.handle, p.x - drag.last.x, p.y - drag.last.y);
      drag.last = p;
    } else if (drag.kind === "morph") {
      drag.stroke.freq = clamp(drag.freq + (p.px - drag.last.px) / 16, 0.5, 36);
      drag.stroke.amp = clamp(drag.amp - (p.py - drag.last.py) / state.h, 0.01, 0.42);
      brush.freq = drag.stroke.freq;
      brush.amp = drag.stroke.amp;
      readSlidersFrom(drag.stroke);
    }
    updateReadout();
  }

  function finishDraw(stroke) {
    if (stroke.pts.length >= 2) return;
    var c = stroke.pts[0];
    var pts = [];
    var i;
    for (i = 0; i <= 18; i++) {
      pts.push({
        x: clamp(c.x - 0.16 + (i / 18) * 0.32, 0, 1),
        y: c.y,
      });
    }
    stroke.pts = pts;
  }

  function pointerUp(e) {
    var drag = state.pointer;
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.kind === "draw") finishDraw(drag.stroke);
    state.pointer = null;
    scheduleSave();
    updateReadout();
  }

  function undo() {
    var prev = state.undo.pop();
    if (!prev) return;
    state.strokes = prev;
    if (state.selected != null && !selectedStroke()) state.selected = null;
    scheduleSave();
    updateReadout();
  }

  function addWave() {
    snapshot();
    var y = 0.5;
    if (state.strokes.length) {
      y = ((state.strokes.length * 0.16) % 0.7) + 0.18;
    }
    var stroke = freshWave(y);
    state.strokes.push(stroke);
    select(stroke.id);
    scheduleSave();
  }

  function clearAll() {
    if (!state.strokes.length) return;
    snapshot();
    state.strokes = [];
    select(null);
    scheduleSave();
  }

  function frame(ts) {
    if (!state.on) return;
    if (!state.last) state.last = ts;
    var dt = Math.min(0.05, (ts - state.last) / 1000);
    state.last = ts;
    state.time += dt;
    draw();
    state.raf = requestAnimationFrame(frame);
  }

  function start() {
    if (state.on) return;
    state.on = true;
    state.last = 0;
    resize();
    state.raf = requestAnimationFrame(frame);
  }

  function stop() {
    state.on = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  function bind() {
    var canvas = $("sn-canvas");
    if (!canvas || canvas.dataset.bound) return;
    canvas.dataset.bound = "1";
    state.canvas = canvas;
    canvas.dataset.mode = state.mode;
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);

    document.querySelectorAll("[data-sn-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setMode(btn.getAttribute("data-sn-mode"));
      });
    });
    ["sn-freq", "sn-amp", "sn-phase", "sn-harm", "sn-thick", "sn-speed", "sn-hue"].forEach(
      function (id) {
        var el = $(id);
        if (!el) return;
        el.addEventListener("pointerdown", function () {
          snapshot();
        });
        el.addEventListener("input", function () {
          var out = el.parentNode && el.parentNode.querySelector("output");
          if (out) out.textContent = el.value;
          writeFromSliders();
        });
      }
    );
    document.querySelectorAll(".sn-swatch").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var hue = Number(btn.getAttribute("data-hue"));
        setRange("sn-hue", hue);
        if (!state.pointer) snapshot();
        writeFromSliders();
      });
    });
    var add = $("sn-new");
    var und = $("sn-undo");
    var clr = $("sn-clear");
    if (add) add.addEventListener("click", addWave);
    if (und) und.addEventListener("click", undo);
    if (clr) clr.addEventListener("click", clearAll);

    window.addEventListener("keydown", function (e) {
      if (!state.on) return;
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedStroke()) {
        e.preventDefault();
        snapshot();
        state.strokes = state.strokes.filter(function (s) {
          return s.id !== state.selected;
        });
        select(null);
        scheduleSave();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        undo();
      } else if (e.key === "1") setMode("draw");
      else if (e.key === "2") setMode("move");
      else if (e.key === "3") setMode("morph");
    });
  }

  function onShow() {
    document.body.classList.add("sn-tab-active");
    bind();
    if (!state.ready) {
      state.ready = true;
      if (!load()) {
        state.strokes = [freshWave(0.5)];
        state.selected = state.strokes[0].id;
      } else if (state.strokes.length && state.selected == null) {
        state.selected = state.strokes[state.strokes.length - 1].id;
      }
    }
    setMode(state.mode);
    readSlidersFrom(selectedStroke() || brush);
    resize();
    start();
    updateReadout();
  }

  function onHide() {
    document.body.classList.remove("sn-tab-active");
    stop();
    save();
  }

  window.addEventListener("resize", function () {
    if (state.on) resize();
  });
  window.addEventListener("sine-show", onShow);
  window.addEventListener("sine-hide", onHide);
  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "sine") onShow();
  });

  window.SineLight = { onShow: onShow, onHide: onHide };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (document.body.getAttribute("data-active-tab") === "sine") onShow();
    });
  } else if (document.body.getAttribute("data-active-tab") === "sine") {
    onShow();
  }
})();
