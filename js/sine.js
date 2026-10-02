/**
 * Lumen — a line is a boundary with two sides.
 * Touching a line closes a shape. The enclosed area is the fill.
 * Clockwise and counter-clockwise travel swap which polarizer paints
 * each side, at each depth. Equations and image traces use the same rule.
 */
(function () {
  "use strict";

  var STORE = "l7in_lumen_v1";
  var TAU = Math.PI * 2;
  var NAMES = {
    gold: 46, teal: 174, ice: 198, magenta: 322, lime: 120,
    crimson: 4, violet: 272, amber: 32, sea: 168, rose: 340,
  };

  var polar = {
    prompt: "silk, grain, glass, void",
    depths: [
      { texture: "silk", cw: 42, ccw: 178 },
      { texture: "grain", cw: 24, ccw: 200 },
      { texture: "glass", cw: 190, ccw: 312 },
      { texture: "void", cw: 262, ccw: 8 },
    ],
  };

  var eq = { kind: "sin", amp: 0.55, freq: 3, phase: 0, slope: 0.4 };
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
    shapes: [],
    nextId: 1,
    selected: null,
    mode: "draw",
    pointer: null,
    undo: [],
    saveTimer: 0,
    exprs: [],
  };

  function $(id) { return document.getElementById(id); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function cloneShape(s) {
    return {
      id: s.id,
      pts: s.pts.map(function (p) { return { x: p.x, y: p.y }; }),
      closed: !!s.closed,
      trace: s.trace < 0 ? -1 : 1,
      spin: s.spin,
      label: s.label || "",
    };
  }

  function snapshot() {
    state.undo.push(state.shapes.map(cloneShape));
    if (state.undo.length > 40) state.undo.shift();
  }

  function scheduleSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(save, 280);
  }

  function save() {
    state.saveTimer = 0;
    try {
      localStorage.setItem(STORE, JSON.stringify({
        shapes: state.shapes,
        nextId: state.nextId,
        polar: polar,
        eq: eq,
        mode: state.mode,
        exprs: state.exprs.slice(0, 40),
      }));
    } catch (e) {}
  }

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE) || "null");
      if (!raw || !Array.isArray(raw.shapes)) return false;
      state.shapes = raw.shapes;
      state.nextId = raw.nextId || state.shapes.length + 1;
      if (raw.polar && Array.isArray(raw.polar.depths)) polar = raw.polar;
      if (raw.eq) eq = raw.eq;
      if (raw.mode) state.mode = raw.mode;
      if (Array.isArray(raw.exprs)) state.exprs = raw.exprs;
      return true;
    } catch (e) {
      return false;
    }
  }

  function circleShape() {
    var pts = [];
    var i;
    for (i = 0; i < 72; i++) {
      var a = (i / 72) * TAU;
      pts.push({ x: 0.5 + Math.cos(a) * 0.22, y: 0.5 + Math.sin(a) * 0.22 });
    }
    return {
      id: state.nextId++,
      pts: pts,
      closed: true,
      trace: 1,
      spin: 1,
      label: "circle",
    };
  }

  function selected() {
    var i;
    for (i = 0; i < state.shapes.length; i++) {
      if (state.shapes[i].id === state.selected) return state.shapes[i];
    }
    return null;
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function shoelace(pts) {
    var a = 0;
    var i;
    var n = pts.length;
    for (i = 0; i < n; i++) {
      var j = (i + 1) % n;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return a / 2;
  }

  function segIntersect(a, b, c, d) {
    var rxx = b.x - a.x, ryy = b.y - a.y;
    var sxx = d.x - c.x, syy = d.y - c.y;
    var den = rxx * syy - ryy * sxx;
    if (Math.abs(den) < 1e-9) return null;
    var t = ((c.x - a.x) * syy - (c.y - a.y) * sxx) / den;
    var u = ((c.x - a.x) * ryy - (c.y - a.y) * rxx) / den;
    if (t < 0.04 || t > 0.96 || u < 0.04 || u > 0.96) return null;
    return { x: a.x + rxx * t, y: a.y + ryy * t };
  }

  function closeOwn(pts) {
    var n = pts.length;
    if (n < 8) return null;
    var end = pts[n - 1];
    var i;
    for (i = 0; i < n - 6; i++) {
      if (dist(pts[i], end) < 0.028) return pts.slice(i);
    }
    var a = pts[n - 2];
    var b = end;
    for (i = 0; i < n - 5; i++) {
      var hit = segIntersect(a, b, pts[i], pts[i + 1]);
      if (!hit) continue;
      var loop = [hit].concat(pts.slice(i + 1, n - 1));
      loop.push(hit);
      return loop;
    }
    return null;
  }

  function nearestOn(pt, shape) {
    var best = null;
    var bestD = 1e9;
    var pts = shape.pts;
    var i;
    for (i = 0; i < pts.length - (shape.closed ? 0 : 1); i++) {
      var a = pts[i];
      var b = pts[(i + 1) % pts.length];
      var vx = b.x - a.x, vy = b.y - a.y;
      var l2 = vx * vx + vy * vy || 1e-8;
      var t = clamp(((pt.x - a.x) * vx + (pt.y - a.y) * vy) / l2, 0, 1);
      var q = { x: a.x + vx * t, y: a.y + vy * t, i: i };
      var d = dist(pt, q);
      if (d < bestD) { bestD = d; best = q; best.d = d; }
    }
    return best;
  }

  function pathBetween(shape, i0, i1) {
    var pts = shape.pts;
    var n = pts.length;
    var out = [];
    var i = i0;
    var guard = 0;
    while (guard++ < n + 2) {
      out.push(pts[i % n]);
      if (i % n === i1 % n) break;
      i++;
    }
    return out;
  }

  function tryBond(stroke) {
    var start = stroke.pts[0];
    var end = stroke.pts[stroke.pts.length - 1];
    var i;
    for (i = 0; i < state.shapes.length; i++) {
      var other = state.shapes[i];
      if (other === stroke || other.pts.length < 2) continue;
      var eh = nearestOn(end, other);
      var sh = nearestOn(start, other);
      if (!eh || !sh || eh.d > 0.03 || sh.d > 0.055) continue;
      var along = pathBetween(other, eh.i, sh.i);
      if (along.length < 2) along = pathBetween(other, sh.i, eh.i);
      var loop = stroke.pts.concat(along);
      if (loop.length >= 4) {
        stroke.pts = loop;
        stroke.closed = true;
        return true;
      }
    }
    return false;
  }

  function finishStroke(stroke) {
    var loop = closeOwn(stroke.pts);
    if (loop && loop.length >= 4) {
      stroke.pts = loop;
      stroke.closed = true;
      return;
    }
    if (stroke.pts.length > 6 && dist(stroke.pts[0], stroke.pts[stroke.pts.length - 1]) < 0.035) {
      stroke.closed = true;
      return;
    }
    tryBond(stroke);
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

  function toPx(pts) {
    return pts.map(function (p) { return { x: p.x * state.w, y: p.y * state.h }; });
  }

  function centroid(pts) {
    var x = 0, y = 0, i;
    for (i = 0; i < pts.length; i++) { x += pts[i].x; y += pts[i].y; }
    return { x: x / pts.length, y: y / pts.length };
  }

  function inset(pts, t) {
    var c = centroid(pts);
    return pts.map(function (p) {
      return { x: p.x + (c.x - p.x) * t, y: p.y + (c.y - p.y) * t };
    });
  }

  function tracePath(ctx, pts) {
    if (!pts.length) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    var i;
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (pts.length > 2) ctx.closePath();
  }

  function insideChannel(px, trace) {
    if (px.length < 2) return "cw";
    var c = centroid(px);
    var a = px[0];
    var b = px[Math.min(3, px.length - 1)];
    var tx = b.x - a.x, ty = b.y - a.y;
    var len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    if (trace < 0) { tx = -tx; ty = -ty; }
    var lx = -ty, ly = tx;
    var dot = lx * (c.x - a.x) + ly * (c.y - a.y);
    return dot >= 0 ? "ccw" : "cw";
  }

  function hsl(h, a) {
    return "hsla(" + Math.round(((h % 360) + 360) % 360) + ", 82%, 62%, " + a + ")";
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function paintBandTexture(ctx, name, hue) {
    var key = String(name || "silk").toLowerCase();
    var w = state.w;
    var h = state.h;
    ctx.save();
    ctx.strokeStyle = hsl(hue, 0.7);
    ctx.fillStyle = hsl(hue, 0.8);
    ctx.lineWidth = 1;
    if (key.indexOf("void") >= 0) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
      ctx.fillRect(0, 0, w, h);
    } else if (key.indexOf("grain") >= 0) {
      var n = 28;
      var i;
      var seed = 0;
      for (i = 0; i < key.length; i++) seed = (seed * 33 + key.charCodeAt(i)) % 997;
      for (i = 0; i < n; i++) {
        var x = ((seed * (i + 3) * 17) % 1000) / 1000 * w;
        var y = ((seed * (i + 11) * 29) % 1000) / 1000 * h;
        ctx.fillRect(x, y, 1.6, 1.6);
      }
    } else if (key.indexOf("glass") >= 0) {
      ctx.globalAlpha = 0.55;
      var y0 = (Math.abs(Math.round(hue)) * 3) % Math.max(1, h);
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.lineTo(w, (y0 + h * 0.18) % h);
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.45;
      var gap = 16;
      var shift = Math.abs(Math.round(hue)) % gap;
      var x;
      for (x = -h + shift; x < w; x += gap) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + h * 0.35, h);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawQuill(ctx, x, y, nx, ny, len, hue) {
    ctx.strokeStyle = hsl(hue, 0.85);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + nx * len, y + ny * len);
    ctx.stroke();
  }

  function drawShape(ctx, shape, time, isSel) {
    var px = toPx(shape.pts);
    if (px.length < 2) return;
    var area = shape.closed ? shoelace(shape.pts) : 0;
    var channel = shape.closed ? insideChannel(px, shape.trace) : "ccw";
    var other = channel === "cw" ? "ccw" : "cw";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (shape.closed) {
      var rich = state.shapes.length <= 24;
      var d;
      for (d = 0; d < 4; d++) {
        var outer = inset(px, d / 4);
        var inner = inset(px, (d + 1) / 4);
        var hue = polar.depths[d][channel] + shape.spin * 28;
        ctx.save();
        ctx.beginPath();
        tracePath(ctx, outer);
        var k;
        ctx.moveTo(inner[0].x, inner[0].y);
        for (k = inner.length - 1; k >= 0; k--) ctx.lineTo(inner[k].x, inner[k].y);
        ctx.closePath();
        ctx.fillStyle = hsl(hue, 0.22 + (3 - d) * 0.08);
        ctx.fill();
        if (rich) {
          ctx.clip();
          paintBandTexture(ctx, polar.depths[d].texture, hue);
        }
        ctx.restore();
      }
      ctx.beginPath();
      tracePath(ctx, px);
      ctx.strokeStyle = hsl(polar.depths[0][other] + shape.spin * 28, 0.35);
      ctx.lineWidth = 10;
      ctx.stroke();
      if (isSel) {
        var c = centroid(px);
        var insideName = channel === "cw" ? "clockwise" : "counter-clockwise";
        var outsideName = other === "cw" ? "clockwise" : "counter-clockwise";
        var words = polar.depths.map(function (depth, idx) {
          return idx + " " + depth.texture;
        }).join(" · ");
        ctx.font = "600 12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = hsl(polar.depths[0][channel] + shape.spin * 28, 0.95);
        ctx.fillText(insideName + "  " + words, c.x, c.y);
        var top = px[0].y;
        for (k = 1; k < px.length; k++) if (px[k].y < top) top = px[k].y;
        ctx.fillStyle = hsl(polar.depths[0][other] + shape.spin * 28, 0.95);
        ctx.fillText(outsideName, c.x, Math.max(14, top - 14));
      }
    }
    ctx.beginPath();
    ctx.moveTo(px[0].x, px[0].y);
    var i;
    for (i = 1; i < px.length; i++) ctx.lineTo(px[i].x, px[i].y);
    if (shape.closed) ctx.closePath();
    ctx.strokeStyle = isSel ? "#f4fff8" : "rgba(220, 245, 236, 0.85)";
    ctx.lineWidth = isSel ? 1.8 : 1.2;
    ctx.stroke();

    var dir = shape.trace < 0 ? -1 : 1;
    var step = Math.max(1, Math.floor(px.length / 28));
    for (i = 0; i < px.length; i += step) {
      var i2 = (i + (dir > 0 ? 1 : px.length - 1)) % px.length;
      if (!shape.closed && dir > 0 && i >= px.length - 1) break;
      var a = px[i], b = px[i2];
      var tx = b.x - a.x, ty = b.y - a.y;
      var len = Math.hypot(tx, ty) || 1;
      tx /= len; ty /= len;
      if (dir < 0) { tx = -tx; ty = -ty; }
      var u = i / px.length;
      var spinAng = shape.spin * u * TAU + time * 0.45;
      var lx = -ty, ly = tx;
      var co = Math.cos(spinAng), si = Math.sin(spinAng);
      var ox = lx * co - ly * si;
      var oy = lx * si + ly * co;
      var depth = Math.floor(((u * Math.max(shape.spin, 0.15)) % 1) * 4);
      var q = 10 + (depth + 1) * 3;
      drawQuill(ctx, a.x, a.y, ox, oy, q, polar.depths[depth].ccw + spinAng * 8);
      drawQuill(ctx, a.x, a.y, -ox, -oy, q * 0.75, polar.depths[depth].cw + spinAng * 8);
      if (i % (step * 3) === 0) {
        ctx.fillStyle = "#f4fff8";
        ctx.beginPath();
        ctx.moveTo(a.x + tx * 8, a.y + ty * 8);
        ctx.lineTo(a.x - ty * 3, a.y + tx * 3);
        ctx.lineTo(a.x + ty * 3, a.y - tx * 3);
        ctx.fill();
      }
    }
    shape._area = area;
    shape._inside = channel;
  }

  function draw() {
    var ctx = state.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, state.w, state.h);
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, state.w, state.h);
    var i;
    for (i = 0; i < state.shapes.length; i++) {
      drawShape(ctx, state.shapes[i], state.time, state.shapes[i].id === state.selected);
    }
  }

  function hitShape(px, py) {
    var best = null;
    var bestD = 22 * 22;
    var i, k;
    for (i = state.shapes.length - 1; i >= 0; i--) {
      var pts = toPx(state.shapes[i].pts);
      for (k = 0; k < pts.length; k += 2) {
        var d = (pts[k].x - px) * (pts[k].x - px) + (pts[k].y - py) * (pts[k].y - py);
        if (d < bestD) { bestD = d; best = state.shapes[i]; }
      }
    }
    return best;
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
        closed: false,
        trace: 1,
        spin: 1,
        label: "drawn",
      };
      state.shapes.push(stroke);
      state.pointer = { id: e.pointerId, kind: "draw", shape: stroke, last: p };
      state.selected = stroke.id;
      return;
    }
    var hit = hitShape(p.px, p.py);
    if (!hit) {
      state.selected = null;
      state.pointer = null;
      updateReadout();
      return;
    }
    state.selected = hit.id;
    state.pointer = { id: e.pointerId, kind: state.mode, shape: hit, last: p, snapped: false };
    updateReadout();
  }

  function pointerMove(e) {
    var drag = state.pointer;
    if (!drag || drag.id !== e.pointerId) return;
    var p = localPoint(e);
    if (!drag.snapped && drag.kind !== "draw") {
      snapshot();
      drag.snapped = true;
    }
    if (drag.kind === "draw") {
      var prev = drag.shape.pts[drag.shape.pts.length - 1];
      if (dist(p, prev) > 0.006) drag.shape.pts.push({ x: p.x, y: p.y });
    } else if (drag.kind === "move") {
      var dx = p.x - drag.last.x, dy = p.y - drag.last.y;
      drag.shape.pts.forEach(function (pt) { pt.x += dx; pt.y += dy; });
      drag.last = p;
    } else if (drag.kind === "trace") {
      var px = toPx(drag.shape.pts);
      var bestI = 0, bestD = 1e9, i;
      for (i = 0; i < px.length; i++) {
        var d = (px[i].x - p.px) * (px[i].x - p.px) + (px[i].y - p.py) * (px[i].y - p.py);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      var n = px.length;
      var a = px[bestI];
      var b = px[(bestI + 1) % n];
      var tx = b.x - a.x, ty = b.y - a.y;
      var mx = p.px - drag.last.px, my = p.py - drag.last.py;
      if (mx * tx + my * ty < 0) drag.shape.trace = -1;
      else if (mx * tx + my * ty > 0) drag.shape.trace = 1;
      drag.last = p;
    }
    updateReadout();
  }

  function pointerUp(e) {
    var drag = state.pointer;
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.kind === "draw") finishStroke(drag.shape);
    state.pointer = null;
    scheduleSave();
    updateReadout();
  }

  function sampleEquation() {
    var groups = [[]];
    var i;
    for (i = 0; i <= 120; i++) {
      var u = i / 120;
      var x = 0.06 + u * 0.88;
      var t = (u - 0.5) * eq.freq * TAU + eq.phase;
      var yv = null;
      var broken = false;
      if (eq.kind === "linear") yv = eq.slope * (u - 0.5) * 2;
      else if (eq.kind === "curve") yv = eq.slope * (u - 0.5) * 2 + eq.amp * Math.pow((u - 0.5) * 2, 2) - eq.amp * 0.35;
      else if (eq.kind === "asin") yv = Math.asin(clamp((u - 0.5) * 2, -1, 1)) / (Math.PI / 2);
      else if (eq.kind === "acos") yv = (Math.acos(clamp((u - 0.5) * 2, -1, 1)) / Math.PI - 0.5) * 2;
      else if (eq.kind === "atan") yv = Math.atan(t) / (Math.PI / 2);
      else if (eq.kind === "tan") {
        var c = Math.cos(t);
        if (Math.abs(c) < 0.2) broken = true;
        else yv = clamp(Math.sin(t) / c, -1.7, 1.7);
      } else if (eq.kind === "cos") yv = Math.cos(t);
      else yv = Math.sin(t);
      if (broken || yv == null) {
        if (groups[groups.length - 1].length) groups.push([]);
        continue;
      }
      groups[groups.length - 1].push({
        x: x,
        y: clamp(0.5 - eq.amp * yv * 0.38, 0.03, 0.97),
      });
    }
    return groups.filter(function (g) { return g.length > 2; });
  }

  function eqLabel() {
    if (eq.kind === "linear") return "y = " + eq.slope.toFixed(2) + "x";
    if (eq.kind === "curve") return "y = " + eq.amp.toFixed(2) + "x² + " + eq.slope.toFixed(2) + "x";
    if (eq.kind === "asin" || eq.kind === "acos" || eq.kind === "atan") return "y = " + eq.kind + "(x)";
    return "y = " + eq.amp.toFixed(2) + "·" + eq.kind + "(" + eq.freq.toFixed(1) + "x)";
  }

  function layEquation() {
    snapshot();
    var groups = sampleEquation();
    var label = eqLabel();
    groups.forEach(function (pts) {
      state.shapes.push({
        id: state.nextId++,
        pts: pts,
        closed: false,
        trace: 1,
        spin: 1,
        label: label,
      });
    });
    if (groups.length) state.selected = state.shapes[state.shapes.length - 1].id;
    scheduleSave();
    updateReadout();
  }

  function forceClose() {
    var s = selected();
    if (!s || s.closed || s.pts.length < 3) return;
    snapshot();
    s.closed = true;
    scheduleSave();
    updateReadout();
  }

  function setWant(wantCw) {
    var s = selected();
    if (!s) return;
    snapshot();
    var drawnCw = shoelace(s.pts) > 0;
    s.trace = wantCw === drawnCw ? 1 : -1;
    scheduleSave();
    updateReadout();
  }

  function hueFrom(token) {
    var m = /#([0-9a-f]{6})/i.exec(token);
    if (m) {
      var n = parseInt(m[1], 16);
      var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      var h = 0;
      if (mx !== mn) {
        var d = mx - mn;
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = Math.round(h * 60);
        if (h < 0) h += 360;
      }
      return h;
    }
    var word;
    for (word in NAMES) {
      if (token.toLowerCase().indexOf(word) >= 0) return NAMES[word];
    }
    return null;
  }

  function applyPrompt(text) {
    polar.prompt = String(text || "").trim();
    var parts = polar.prompt.split(/[,|\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var i;
    for (i = 0; i < 4; i++) {
      if (!parts[i]) continue;
      var bit = parts[i];
      var cw = /cw\s*[:=]\s*([#a-z0-9]+)/i.exec(bit);
      var ccw = /ccw\s*[:=]\s*([#a-z0-9]+)/i.exec(bit);
      if (cw) polar.depths[i].cw = hueFrom(cw[1]) != null ? hueFrom(cw[1]) : polar.depths[i].cw;
      if (ccw) polar.depths[i].ccw = hueFrom(ccw[1]) != null ? hueFrom(ccw[1]) : polar.depths[i].ccw;
      if (!cw && !ccw) {
        var h = hueFrom(bit);
        if (h != null) polar.depths[i].cw = h;
      }
      polar.depths[i].texture = bit
        .replace(/cw\s*[:=]\s*[#a-z0-9]+/ig, "")
        .replace(/ccw\s*[:=]\s*[#a-z0-9]+/ig, "")
        .replace(/#[0-9a-f]{6}/ig, "")
        .trim() || polar.depths[i].texture;
    }
    paintDepths();
    scheduleSave();
    updateReadout();
  }

  function paintDepths() {
    var host = $("lm-depths");
    if (!host) return;
    host.innerHTML = "";
    polar.depths.forEach(function (d, i) {
      var row = document.createElement("div");
      row.className = "lm-depth";
      row.innerHTML =
        "<span>Depth " + i + "</span>" +
        "<label>CW <input data-side='cw' data-i='" + i + "' type='range' min='0' max='360' value='" + d.cw + "'></label>" +
        "<label>CCW <input data-side='ccw' data-i='" + i + "' type='range' min='0' max='360' value='" + d.ccw + "'></label>" +
        "<em>" + esc(d.texture) + "</em>";
      host.appendChild(row);
    });
    host.querySelectorAll("input").forEach(function (input) {
      input.addEventListener("input", function () {
        var i = Number(input.getAttribute("data-i"));
        polar.depths[i][input.getAttribute("data-side")] = Number(input.value);
        scheduleSave();
        updateReadout();
      });
    });
  }

  function fmtPct(area) {
    return (Math.abs(area) * 100).toFixed(1) + "%";
  }

  function sideName(code) {
    return code === "cw" ? "Clockwise" : "Counter-clockwise";
  }

  function swatch(h) {
    return "<i class='lm-swatch' style='background:" + hsl(h, 1) + "'></i>";
  }

  function measure(shape) {
    var area = shoelace(shape.pts);
    var drawnCw = area > 0;
    var tracingCw = shape.trace < 0 ? !drawnCw : drawnCw;
    var inside = insideChannel(shape.pts, shape.trace);
    var outside = inside === "cw" ? "ccw" : "cw";
    return {
      area: area,
      tracingCw: tracingCw,
      way: tracingCw ? "Clockwise" : "Counter-clockwise",
      inside: inside,
      outside: outside,
    };
  }

  function updateReadout() {
    var el = $("lm-readout");
    var card = $("lm-card");
    var s = selected();
    var line = "Draw until a line touches a line. That loop is the fill.";
    var html = "<dl><dt>Shape</dt><dd>None selected</dd><dt>Fill</dt><dd>Closes when a line touches a line</dd></dl>";
    var tracingCw = false;
    if (s) {
      var m = measure(s);
      tracingCw = m.tracingCw;
      var rows = polar.depths.map(function (d, i) {
        var left = s.closed
          ? swatch(d[m.inside]) + sideName(m.inside)
          : swatch(d.cw) + "Clockwise";
        var right = s.closed
          ? swatch(d[m.outside]) + sideName(m.outside)
          : swatch(d.ccw) + "Counter-clockwise";
        return "<tr><td>" + i + "</td><td>" + esc(d.texture) + "</td><td>" + left + "</td><td>" + right + "</td></tr>";
      }).join("");
      var sheet =
        "<table class='lm-sheet'><thead><tr><th>Depth</th><th>Texture</th><th>" +
        (s.closed ? "Inside" : "One side") + "</th><th>" +
        (s.closed ? "Outside" : "Other side") + "</th></tr></thead><tbody>" +
        rows + "</tbody></table>";
      if (s.closed) {
        line = "Closed · fill " + fmtPct(m.area) + " · " + m.way.toLowerCase() +
          " · inside " + sideName(m.inside).toLowerCase();
        html =
          "<dl>" +
          "<dt>Shape</dt><dd>Closed</dd>" +
          "<dt>Fill</dt><dd>" + fmtPct(m.area) + " of the stage</dd>" +
          "<dt>Trajectory</dt><dd>" + m.way + "</dd>" +
          "<dt>Spin</dt><dd>" + Number(s.spin).toFixed(2) + " — outward twist, both sides</dd>" +
          "<dt>Inside</dt><dd>" + sideName(m.inside) + " polarizer</dd>" +
          "<dt>Outside</dt><dd>" + sideName(m.outside) + " polarizer</dd>" +
          (s.label ? "<dt>Form</dt><dd>" + esc(s.label) + "</dd>" : "") +
          "</dl>" + sheet;
      } else {
        line = "Open line · " + m.way.toLowerCase() + " · no fill until it touches a line";
        html =
          "<dl>" +
          "<dt>Shape</dt><dd>Open line</dd>" +
          "<dt>Fill</dt><dd>None until the line touches a line</dd>" +
          "<dt>Trajectory</dt><dd>" + m.way + "</dd>" +
          "<dt>Spin</dt><dd>" + Number(s.spin).toFixed(2) + " — outward twist, both sides</dd>" +
          "<dt>Left of travel</dt><dd>Counter-clockwise polarizer</dd>" +
          "<dt>Right of travel</dt><dd>Clockwise polarizer</dd>" +
          (s.label ? "<dt>Form</dt><dd>" + esc(s.label) + "</dd>" : "") +
          "</dl>" + sheet;
      }
    }
    if (el) el.textContent = line;
    if (card) {
      card.classList.toggle("is-flip", !!(s && !tracingCw));
      card.innerHTML = html;
    }
    document.querySelectorAll(".lm-depth").forEach(function (row) {
      row.classList.toggle("is-flip", !!(s && !tracingCw));
    });
    var cwBtn = $("lm-cw");
    var ccwBtn = $("lm-ccw");
    if (cwBtn) cwBtn.classList.toggle("is-on", !!(s && tracingCw));
    if (ccwBtn) ccwBtn.classList.toggle("is-on", !!(s && !tracingCw));
    var spin = $("lm-spin");
    if (spin && s && document.activeElement !== spin) spin.value = String(s.spin);
    var box = $("lm-exprs");
    if (box && document.activeElement !== box) box.value = state.exprs.slice(0, 24).join("\n");
  }

  function bezierPoints(b, n) {
    var out = [];
    var i;
    for (i = 0; i <= n; i++) {
      var t = i / n;
      var u = 1 - t;
      out.push({
        x: u * u * u * b.p0.x + 3 * u * u * t * b.p1.x + 3 * u * t * t * b.p2.x + t * t * t * b.p3.x,
        y: u * u * u * b.p0.y + 3 * u * u * t * b.p1.y + 3 * u * t * t * b.p2.y + t * t * t * b.p3.y,
      });
    }
    return out;
  }

  function chainsFromBeziers(beziers) {
    var chains = [];
    var cur = [];
    var i;
    for (i = 0; i < beziers.length; i++) {
      var b = beziers[i];
      if (cur.length) {
        var prev = cur[cur.length - 1];
        if (Math.hypot(prev.p3.x - b.p0.x, prev.p3.y - b.p0.y) > 1.5) {
          chains.push(cur);
          cur = [];
        }
      }
      cur.push(b);
    }
    if (cur.length) chains.push(cur);
    return chains;
  }

  function traceImage(file) {
    var api = window.GraphCalcImgTrace;
    var status = $("lm-status");
    if (!api || !api.imageToBezierExprs) {
      if (status) status.textContent = "Curve tracer is not loaded.";
      return;
    }
    if (status) status.textContent = "Tracing image into curves…";
    var url = URL.createObjectURL(file);
    api.imageToBezierExprs(url, { detail: 7, maxCurves: 240, maxWidth: 480, flipY: false })
      .then(function (result) {
        URL.revokeObjectURL(url);
        if (!result || !result.beziers || !result.beziers.length) {
          if (status) status.textContent = "No curves in that image.";
          return;
        }
        snapshot();
        var w = result.width || 1;
        var h = result.height || 1;
        var chains = chainsFromBeziers(result.beziers);
        chains.forEach(function (chain) {
          var pts = [];
          chain.forEach(function (b, idx) {
            var samples = bezierPoints(b, 6);
            if (idx) samples = samples.slice(1);
            samples.forEach(function (p) {
              pts.push({ x: 0.08 + (p.x / w) * 0.84, y: 0.08 + (p.y / h) * 0.84 });
            });
          });
          if (pts.length < 3) return;
          var shape = {
            id: state.nextId++,
            pts: pts,
            closed: dist(pts[0], pts[pts.length - 1]) < 0.04,
            trace: 1,
            spin: 0.75,
            label: "image curve",
          };
          if (!shape.closed) {
            var loop = closeOwn(pts);
            if (loop) { shape.pts = loop; shape.closed = true; }
          }
          state.shapes.push(shape);
        });
        state.exprs = result.exprs || [];
        state.selected = state.shapes.length ? state.shapes[state.shapes.length - 1].id : null;
        if (status) {
          status.textContent = chains.length + " curve chains · " + state.exprs.length + " Desmos segments.";
        }
        scheduleSave();
        updateReadout();
      })
      .catch(function () {
        URL.revokeObjectURL(url);
        if (status) status.textContent = "Could not trace that image.";
      });
  }

  function openInGraph() {
    if (!state.exprs.length) return;
    if (window.GalleryTabs && window.GalleryTabs.showTab) window.GalleryTabs.showTab("graphcalc");
    var gc = window.GraphCalc;
    if (gc && gc.addSketchCurves) gc.addSketchCurves(state.exprs);
    else if (gc && gc.pasteDesmos) gc.pasteDesmos(state.exprs.join("\n"));
  }

  function undo() {
    var prev = state.undo.pop();
    if (!prev) return;
    state.shapes = prev;
    if (state.selected != null && !selected()) state.selected = null;
    scheduleSave();
    updateReadout();
  }

  function clearAll() {
    if (!state.shapes.length) return;
    snapshot();
    state.shapes = [];
    state.selected = null;
    state.exprs = [];
    scheduleSave();
    updateReadout();
  }

  function setMode(mode) {
    state.mode = mode;
    if (state.canvas) state.canvas.dataset.mode = mode;
    document.querySelectorAll("[data-lm-mode]").forEach(function (btn) {
      btn.classList.toggle("is-on", btn.getAttribute("data-lm-mode") === mode);
    });
    scheduleSave();
  }

  function frame(ts) {
    if (!state.on) return;
    if (!state.last) state.last = ts;
    state.time += Math.min(0.05, (ts - state.last) / 1000);
    state.last = ts;
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
    var canvas = $("lm-canvas");
    if (!canvas || canvas.dataset.bound) return;
    canvas.dataset.bound = "1";
    state.canvas = canvas;
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    document.querySelectorAll("[data-lm-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () { setMode(btn.getAttribute("data-lm-mode")); });
    });
    var apply = $("lm-apply");
    var prompt = $("lm-prompt");
    if (apply && prompt) {
      apply.addEventListener("click", function () { applyPrompt(prompt.value); });
      prompt.addEventListener("keydown", function (e) {
        if (e.key === "Enter") applyPrompt(prompt.value);
      });
    }
    var kind = $("lm-eq-kind");
    if (kind) kind.addEventListener("change", function () { eq.kind = kind.value; });
    ["lm-amp", "lm-freq", "lm-phase", "lm-slope"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("input", function () {
        if (id === "lm-amp") eq.amp = Number(el.value);
        if (id === "lm-freq") eq.freq = Number(el.value);
        if (id === "lm-phase") eq.phase = Number(el.value);
        if (id === "lm-slope") eq.slope = Number(el.value);
      });
    });
    var lay = $("lm-lay");
    var close = $("lm-close");
    var cw = $("lm-cw");
    var ccw = $("lm-ccw");
    if (lay) lay.addEventListener("click", layEquation);
    if (close) close.addEventListener("click", forceClose);
    if (cw) cw.addEventListener("click", function () { setWant(true); });
    if (ccw) ccw.addEventListener("click", function () { setWant(false); });
    var file = $("lm-file");
    if (file) file.addEventListener("change", function () {
      if (file.files && file.files[0]) traceImage(file.files[0]);
    });
    var graph = $("lm-graph");
    if (graph) graph.addEventListener("click", openInGraph);
    var und = $("lm-undo");
    var clr = $("lm-clear");
    if (und) und.addEventListener("click", undo);
    if (clr) clr.addEventListener("click", clearAll);
    var spin = $("lm-spin");
    if (spin) spin.addEventListener("input", function () {
      var s = selected();
      if (!s) return;
      s.spin = Number(spin.value);
      scheduleSave();
      updateReadout();
    });
    window.addEventListener("keydown", function (e) {
      if (!state.on) return;
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected()) {
        e.preventDefault();
        snapshot();
        state.shapes = state.shapes.filter(function (s) { return s.id !== state.selected; });
        state.selected = null;
        scheduleSave();
        updateReadout();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        undo();
      }
    });
  }

  function syncControls() {
    var prompt = $("lm-prompt");
    if (prompt) prompt.value = polar.prompt || "";
    var kind = $("lm-eq-kind");
    if (kind) kind.value = eq.kind;
    if ($("lm-amp")) $("lm-amp").value = String(eq.amp);
    if ($("lm-freq")) $("lm-freq").value = String(eq.freq);
    if ($("lm-phase")) $("lm-phase").value = String(eq.phase);
    if ($("lm-slope")) $("lm-slope").value = String(eq.slope);
    var s = selected();
    if ($("lm-spin")) $("lm-spin").value = String(s ? s.spin : 1);
    setMode(state.mode === "morph" ? "draw" : state.mode);
    paintDepths();
  }

  function onShow() {
    document.body.classList.add("lm-tab-active");
    bind();
    if (!state.ready) {
      state.ready = true;
      if (!load() || !state.shapes.length) {
        var demo = circleShape();
        state.shapes = [demo];
        state.selected = demo.id;
      } else if (state.selected == null && state.shapes.length) {
        state.selected = state.shapes[state.shapes.length - 1].id;
      }
    }
    syncControls();
    resize();
    start();
    updateReadout();
  }

  function onHide() {
    document.body.classList.remove("lm-tab-active");
    stop();
    save();
  }

  window.addEventListener("resize", function () { if (state.on) resize(); });
  window.addEventListener("lumen-show", onShow);
  window.addEventListener("lumen-hide", onHide);
  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "lumen") onShow();
  });
  window.Lumen = { onShow: onShow, onHide: onHide };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (document.body.getAttribute("data-active-tab") === "lumen") onShow();
    });
  } else if (document.body.getAttribute("data-active-tab") === "lumen") {
    onShow();
  }
})();
