/**
 * Lumen — a closed line is a fill.
 * Each travel direction carries a real texture from the boundary inward.
 * The core is a substance. Void names the empty space outside the shape
 * and is never a layer of the fill.
 * A morphism is the map that carries texture along that position:
 * transport, blend, laminate, or pulse.
 */
(function () {
  "use strict";

  var STORE = "l7in_lumen_v2";
  var TAU = Math.PI * 2;
  // Shared frame for waves, drawn lines, and image traces.
  var STAGE_INSET = 0.06;

  var MAT = {
    silk:    { title: "Silk",    base: [214, 206, 196], thread: [248, 244, 236], shade: [148, 136, 126], alpha: 0.94 },
    grain:   { title: "Grain",   base: [186, 148, 96],  thread: [112, 74, 38],   shade: [74, 48, 26],    alpha: 0.96 },
    glass:   { title: "Glass",   base: [206, 228, 230], thread: [255, 255, 255], shade: [110, 168, 178], alpha: 0.5 },
    pigment: { title: "Pigment", base: [156, 46, 42],   thread: [214, 98, 62],   shade: [64, 18, 24],    alpha: 1 },
    stone:   { title: "Stone",   base: [148, 150, 146], thread: [214, 214, 208], shade: [72, 74, 76],    alpha: 0.98 },
    metal:   { title: "Metal",   base: [132, 142, 154], thread: [236, 240, 244], shade: [58, 64, 74],    alpha: 0.95 },
    weave:   { title: "Weave",   base: [176, 142, 102], thread: [86, 58, 36],    shade: [214, 196, 158], alpha: 0.96 },
  };
  var MAT_IDS = Object.keys(MAT);
  var VOID_KINDS = { still: "Still", haze: "Haze", dust: "Dust", echo: "Echo" };
  var MORPHS = {
    transport: "Transport — carry one texture inward",
    blend: "Blend — line texture into core texture",
    laminate: "Laminate — shells, core is the last",
    pulse: "Pulse — density waves along the line",
  };

  function defaultField() {
    return {
      morph: "blend",
      pulse: 3,
      prompt: "cw: silk>pigment, ccw: grain>stone, void: haze",
      cw: {
        boundary: "silk", core: "pigment",
        scale: 1, density: 0.82, relief: 0.72, flow: 0.5,
        shells: ["silk", "weave", "pigment", "pigment"],
      },
      ccw: {
        boundary: "grain", core: "stone",
        scale: 1.1, density: 0.7, relief: 0.6, flow: 0.42,
        shells: ["grain", "grain", "stone", "stone"],
      },
      void: { kind: "haze", reach: 0.55, density: 0.45 },
    };
  }

  var field = defaultField();
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
    tiles: {},
    ready: false,
    photo: null,
    imageAspect: 0,
    view: { scale: 1, ox: 0, oy: 0, aspect: 1.5, user: false },
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
      sketch: !!s.sketch,
      wave: s.wave ? {
        kind: s.wave.kind,
        amp: s.wave.amp,
        freq: s.wave.freq,
        phase: s.wave.phase,
        slope: s.wave.slope,
      } : undefined,
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
        field: field,
        eq: eq,
        mode: state.mode,
        exprs: state.exprs.slice(0, 40),
      }));
    } catch (e) {}
  }

  function copyStruct(src, fallback) {
    var s = {
      boundary: MAT[src && src.boundary] ? src.boundary : fallback.boundary,
      core: MAT[src && src.core] ? src.core : fallback.core,
      scale: clamp(Number(src && src.scale != null ? src.scale : fallback.scale), 0.35, 2.4),
      density: clamp(Number(src && src.density != null ? src.density : fallback.density), 0.05, 1),
      relief: clamp(Number(src && src.relief != null ? src.relief : fallback.relief), 0.05, 1),
      flow: clamp(Number(src && src.flow != null ? src.flow : fallback.flow), 0, 1),
      shells: fallback.shells.slice(),
    };
    if (src && Array.isArray(src.shells)) {
      var i;
      for (i = 0; i < 4; i++) {
        if (MAT[src.shells[i]]) s.shells[i] = src.shells[i];
      }
    }
    s.shells[0] = s.boundary;
    s.shells[3] = s.core;
    return s;
  }

  function adoptField(raw) {
    var base = defaultField();
    if (!raw) return base;
    base.morph = MORPHS[raw.morph] ? raw.morph : base.morph;
    base.pulse = clamp(Number(raw.pulse || base.pulse), 0.5, 8);
    base.prompt = typeof raw.prompt === "string" && raw.prompt ? raw.prompt : base.prompt;
    base.cw = copyStruct(raw.cw, base.cw);
    base.ccw = copyStruct(raw.ccw, base.ccw);
    if (raw.void && VOID_KINDS[raw.void.kind]) base.void.kind = raw.void.kind;
    if (raw.void) {
      base.void.reach = clamp(Number(raw.void.reach != null ? raw.void.reach : base.void.reach), 0, 1);
      base.void.density = clamp(Number(raw.void.density != null ? raw.void.density : base.void.density), 0, 1);
    }
    return base;
  }

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE) || "null");
      if (!raw) {
        var old = JSON.parse(localStorage.getItem("l7in_lumen_v1") || "null");
        if (!old || !Array.isArray(old.shapes)) return false;
        state.shapes = old.shapes;
        state.nextId = old.nextId || state.shapes.length + 1;
        if (Array.isArray(old.exprs)) state.exprs = old.exprs;
        return true;
      }
      if (!Array.isArray(raw.shapes)) return false;
      state.shapes = raw.shapes;
      state.nextId = raw.nextId || state.shapes.length + 1;
      field = adoptField(raw.field);
      if (raw.eq) eq = raw.eq;
      if (raw.mode) state.mode = raw.mode;
      if (Array.isArray(raw.exprs)) state.exprs = raw.exprs;
      return true;
    } catch (e) {
      return false;
    }
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
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (state.ctx && Math.abs(box.w - state.w) < 0.5 && Math.abs(box.h - state.h) < 0.5 && dpr === state.dpr) return;
    state.dpr = dpr;
    state.w = box.w;
    state.h = box.h;
    state.canvas.width = Math.round(box.w * state.dpr);
    state.canvas.height = Math.round(box.h * state.dpr);
    state.ctx = state.canvas.getContext("2d");
    state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    var key;
    for (key in state.tiles) state.tiles[key].pat = null;
  }

  function localPoint(e) {
    var box = cssSize();
    var px = e.clientX - box.r.left;
    var py = e.clientY - box.r.top;
    var sheet = pxToSheet(px, py);
    return { x: sheet.x, y: sheet.y, px: px, py: py };
  }

  function aspectOf() {
    return state.imageAspect > 0 ? state.imageAspect : 1.5;
  }

  function sheetToPx(p) {
    var a = state.view.aspect || aspectOf();
    var s = state.view.scale || 1;
    return { x: state.view.ox + p.x * s * a, y: state.view.oy + p.y * s };
  }

  function pxToSheet(px, py) {
    var a = state.view.aspect || aspectOf();
    var s = state.view.scale || 1;
    return { x: (px - state.view.ox) / (s * a), y: (py - state.view.oy) / s };
  }

  function contentBounds() {
    var minX = 0, minY = 0, maxX = 1, maxY = 1;
    var i, k, p;
    for (i = 0; i < state.shapes.length; i++) {
      var pts = state.shapes[i].pts;
      for (k = 0; k < pts.length; k++) {
        p = pts[k];
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    var dx = Math.max(0.04, (maxX - minX) * 0.05);
    var dy = Math.max(0.04, (maxY - minY) * 0.05);
    return { minX: minX - dx, minY: minY - dy, maxX: maxX + dx, maxY: maxY + dy };
  }

  function fitMetrics() {
    var b = contentBounds();
    var aspect = aspectOf();
    var pad = 28;
    var sw = Math.max(1, state.w);
    var sh = Math.max(1, state.h);
    var cw = Math.max(1e-4, b.maxX - b.minX);
    var ch = Math.max(1e-4, b.maxY - b.minY);
    var scale = Math.min((sw - pad * 2) / (cw * aspect), (sh - pad * 2) / ch);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    var pxW = cw * scale * aspect;
    var pxH = ch * scale;
    return {
      scale: scale,
      ox: (sw - pxW) / 2 - b.minX * scale * aspect,
      oy: (sh - pxH) / 2 - b.minY * scale,
      aspect: aspect,
    };
  }

  function fitView() {
    var m = fitMetrics();
    state.view.scale = m.scale;
    state.view.ox = m.ox;
    state.view.oy = m.oy;
    state.view.aspect = m.aspect;
    state.view.user = false;
  }

  function zoomAt(px, py, factor) {
    var before = pxToSheet(px, py);
    var aspect = aspectOf();
    var fitted = fitMetrics().scale;
    var next = clamp(state.view.scale * factor, fitted * 0.12, fitted * 18);
    state.view.aspect = aspect;
    state.view.scale = next;
    state.view.ox = px - before.x * next * aspect;
    state.view.oy = py - before.y * next;
    state.view.user = true;
  }

  function toPx(pts) {
    return pts.map(sheetToPx);
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

  function offsetOut(px, dist) {
    var c = centroid(px);
    return px.map(function (p) {
      var dx = p.x - c.x, dy = p.y - c.y;
      var len = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / len) * dist, y: p.y + (dy / len) * dist };
    });
  }

  function strokeLine(ctx, pts, closed) {
    if (!pts.length) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    var i;
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed && pts.length > 2) ctx.closePath();
  }

  function leftFacesInside(px, trace) {
    if (px.length < 2) return true;
    var c = centroid(px);
    var a = px[0];
    var b = px[Math.min(3, px.length - 1)];
    var tx = b.x - a.x, ty = b.y - a.y;
    var len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    if (trace < 0) { tx = -tx; ty = -ty; }
    var lx = -ty, ly = tx;
    return lx * (c.x - a.x) + ly * (c.y - a.y) >= 0;
  }

  function insideChannel(px, trace) {
    // Left of travel carries the clockwise texture, so choosing Clockwise
    // fills the shape with that texture when the interior is on the left.
    return leftFacesInside(px, trace) ? "cw" : "ccw";
  }

  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function rgb(c) { return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")"; }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  function qnum(n, step) { return Math.round(n / step) * step; }

  function paintTile(g, id, scale, density, relief) {
    var m = MAT[id];
    var rnd = mulberry(id.length * 131 + Math.round(scale * 10) * 17 + Math.round(density * 20));
    var gap, y, i, x, len, ang, count, r, grd;
    g.fillStyle = rgb(m.base);
    g.fillRect(0, 0, 192, 192);
    g.lineCap = "round";
    if (id === "silk") {
      gap = Math.max(2.2, 6.5 / scale);
      for (y = 0; y < 192; y += gap) {
        g.strokeStyle = rgba(y / gap % 4 < 1 ? m.thread : m.shade, 0.18 + relief * 0.7);
        g.lineWidth = y / gap % 5 === 0 ? 1.6 : 0.7;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(192, y + Math.sin(y * 0.08) * 0.8);
        g.stroke();
      }
      grd = g.createLinearGradient(0, 0, 192, 0);
      grd.addColorStop(0, rgba(m.shade, 0.05));
      grd.addColorStop(0.5, rgba(m.thread, 0.16 * relief));
      grd.addColorStop(1, rgba(m.shade, 0.08));
      g.fillStyle = grd;
      g.fillRect(0, 0, 192, 192);
    } else if (id === "grain") {
      count = Math.floor(50 + density * 420);
      for (i = 0; i < count; i++) {
        x = rnd() * 192;
        y = rnd() * 192;
        len = (4 + rnd() * 14) * scale;
        ang = -0.5 + rnd() * 0.35;
        g.strokeStyle = rgba(rnd() > 0.7 ? m.thread : m.shade, 0.25 + relief * 0.65);
        g.lineWidth = 0.6 + rnd();
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
        g.stroke();
      }
    } else if (id === "glass") {
      g.strokeStyle = rgba(m.thread, 0.18 + relief * 0.45);
      g.lineWidth = 10 / scale;
      for (i = -2; i < 6; i++) {
        g.beginPath();
        g.moveTo(-20, i * 36);
        g.lineTo(210, i * 36 + 70);
        g.stroke();
      }
      for (i = 0; i < 5; i++) {
        g.fillStyle = rgba(m.thread, 0.08 + relief * 0.12);
        g.beginPath();
        g.ellipse(30 + rnd() * 140, 20 + rnd() * 150, 18 * scale, 6, -0.6, 0, TAU);
        g.fill();
      }
    } else if (id === "pigment") {
      count = Math.floor(18 + density * 70);
      for (i = 0; i < count; i++) {
        r = (7 + rnd() * 16) * Math.max(0.6, scale);
        g.fillStyle = rgba(rnd() > 0.5 ? m.thread : m.shade, 0.18 + relief * 0.55);
        g.beginPath();
        g.ellipse(rnd() * 192, rnd() * 192, r, r * (0.55 + rnd() * 0.5), rnd() * 3, 0, TAU);
        g.fill();
      }
    } else if (id === "stone") {
      count = Math.floor(16 + density * 36);
      for (i = 0; i < count; i++) {
        r = (10 + rnd() * 28) / Math.max(0.7, scale);
        g.fillStyle = rgba(rnd() > 0.5 ? m.thread : m.shade, 0.18 + relief * 0.4);
        g.beginPath();
        g.ellipse(rnd() * 192, rnd() * 192, r, r * (0.7 + rnd() * 0.4), rnd(), 0, TAU);
        g.fill();
      }
      g.strokeStyle = rgba(m.shade, 0.35 + relief * 0.4);
      g.lineWidth = 1;
      for (i = 0; i < 4; i++) {
        g.beginPath();
        g.moveTo(rnd() * 192, rnd() * 192);
        g.lineTo(rnd() * 192, rnd() * 192);
        g.lineTo(rnd() * 192, rnd() * 192);
        g.stroke();
      }
    } else if (id === "metal") {
      gap = Math.max(1.5, 3.2 / scale);
      for (y = 0; y < 192; y += gap) {
        g.strokeStyle = rgba((y / gap) % 7 === 0 ? m.thread : m.shade, 0.2 + relief * 0.65);
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(192, y);
        g.stroke();
      }
      grd = g.createLinearGradient(0, 40, 0, 90);
      grd.addColorStop(0, rgba(m.thread, 0));
      grd.addColorStop(0.5, rgba(m.thread, 0.35 * relief));
      grd.addColorStop(1, rgba(m.thread, 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, 192, 192);
    } else {
      gap = Math.max(4, 8 / scale);
      var col, row, on;
      for (y = 0; y < 192; y += gap) {
        row = Math.floor(y / gap);
        for (x = 0; x < 192; x += gap) {
          col = Math.floor(x / gap);
          on = (col + row) % 2 === 0;
          g.strokeStyle = rgba(on ? m.thread : m.shade, 0.25 + relief * 0.6);
          g.lineWidth = 1.3;
          g.beginPath();
          if (row % 2 === 0) {
            g.moveTo(x, y + gap * 0.5);
            g.lineTo(x + gap, y + gap * 0.5);
          } else {
            g.moveTo(x + gap * 0.5, y);
            g.lineTo(x + gap * 0.5, y + gap);
          }
          g.stroke();
        }
      }
    }
  }

  function getTile(sample) {
    var id = MAT[sample.id] ? sample.id : "pigment";
    var scale = qnum(clamp(sample.scale || 1, 0.35, 2.4), 0.1);
    var density = qnum(clamp(sample.density == null ? 0.8 : sample.density, 0.05, 1), 0.05);
    var relief = qnum(clamp(sample.relief == null ? 0.7 : sample.relief, 0.05, 1), 0.05);
    var key = id + "|" + scale + "|" + density + "|" + relief;
    var tile = state.tiles[key];
    if (!tile) {
      var keys = Object.keys(state.tiles);
      if (keys.length > 48) delete state.tiles[keys[0]];
      var canvas = document.createElement("canvas");
      canvas.width = 192;
      canvas.height = 192;
      paintTile(canvas.getContext("2d"), id, scale, density, relief);
      tile = state.tiles[key] = { canvas: canvas, pat: null };
    }
    return tile;
  }

  function patternOf(ctx, sample) {
    var tile = getTile(sample);
    if (!tile.pat) tile.pat = ctx.createPattern(tile.canvas, "repeat");
    return tile.pat;
  }

  function fillPattern(ctx, sample, anchor) {
    ctx.save();
    ctx.translate(anchor.x, anchor.y);
    ctx.rotate(sample.rot || 0);
    ctx.translate(-anchor.x, -anchor.y);
    var cover = sample.alpha == null ? 1 : sample.alpha;
    if (sample.id2 && MAT[sample.id2] && sample.mix > 0.02) {
      ctx.globalAlpha = cover * (1 - sample.mix);
      ctx.fillStyle = patternOf(ctx, sample);
      ctx.fillRect(anchor.x - state.w, anchor.y - state.h, state.w * 2, state.h * 2);
      ctx.globalAlpha = cover * sample.mix;
      ctx.fillStyle = patternOf(ctx, {
        id: sample.id2, scale: sample.scale, density: sample.density, relief: sample.relief,
      });
      ctx.fillRect(anchor.x - state.w, anchor.y - state.h, state.w * 2, state.h * 2);
    } else {
      ctx.globalAlpha = cover;
      ctx.fillStyle = patternOf(ctx, sample);
      ctx.fillRect(anchor.x - state.w, anchor.y - state.h, state.w * 2, state.h * 2);
    }
    ctx.restore();
  }

  function paintPoly(ctx, pts, sample, anchor) {
    if (!pts || pts.length < 3) return;
    ctx.save();
    strokeLine(ctx, pts, true);
    ctx.clip();
    fillPattern(ctx, sample, anchor);
    ctx.restore();
  }

  function shellsOf(struct) {
    return struct.shells && struct.shells.length === 4
      ? struct.shells
      : [struct.boundary, struct.boundary, struct.core, struct.core];
  }

  function coreId(struct) {
    if (field.morph === "transport") return struct.boundary;
    if (field.morph === "laminate") return shellsOf(struct)[3];
    return struct.core;
  }

  function sampleMorph(struct, s, u, shape, tangent) {
    var id = struct.boundary;
    var id2 = null;
    var mix = 0;
    var density = struct.density;
    var scale = struct.scale;
    var shells = shellsOf(struct);
    if (field.morph === "blend") {
      id2 = struct.core;
      var x = clamp((s - 0.08) / 0.42, 0, 1);
      mix = x * x * (3 - 2 * x);
    } else if (field.morph === "laminate") {
      id = shells[s < 0.14 ? 0 : s < 0.34 ? 1 : s < 0.58 ? 2 : 3];
    } else if (field.morph === "pulse") {
      var wave = 0.5 + 0.5 * Math.sin(u * field.pulse * TAU + state.time * 1.3 + s * (shape.spin || 0) * TAU);
      density = clamp(struct.density * (0.25 + wave), 0.08, 1);
      scale = struct.scale * (0.72 + 0.55 * wave);
      id2 = struct.core;
      mix = s > 0.35 ? clamp((s - 0.35) / 0.65, 0, 1) * (0.45 + 0.55 * wave) : 0;
    } else {
      scale = struct.scale * (1 + s * 1.8);
    }
    if (s >= 0.999) {
      id = coreId(struct);
      id2 = null;
      mix = 0;
    }
    var rot = (tangent || 0) + (struct.flow - 0.5) * Math.PI + (shape.spin || 0) * s * Math.PI;
    if (shape.trace < 0) rot += Math.PI;
    var alpha = MAT[id] ? MAT[id].alpha : 1;
    if (s > 0.84) alpha = Math.max(alpha, 0.92);
    return {
      id: id, id2: id2, mix: mix, scale: scale, density: density,
      relief: struct.relief, rot: rot, alpha: alpha,
    };
  }

  function paintVoid(ctx) {
    var w = state.w, h = state.h;
    var kind = field.void.kind;
    var d = field.void.density;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#07080c";
    ctx.fillRect(0, 0, w, h);
    var i, x, y, rad, g, rnd, n;
    if (kind === "haze") {
      var spots = [[0.06, 0.1], [0.94, 0.14], [0.12, 0.9], [0.88, 0.84], [0.5, 0.02], [0.02, 0.48], [0.98, 0.55]];
      for (i = 0; i < spots.length; i++) {
        x = spots[i][0] * w;
        y = spots[i][1] * h;
        rad = Math.max(w, h) * (0.22 + (i % 3) * 0.07);
        g = ctx.createRadialGradient(x, y, 4, x, y, rad);
        g.addColorStop(0, "rgba(168, 188, 196, " + (0.035 + d * 0.09) + ")");
        g.addColorStop(1, "rgba(7, 8, 12, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    } else if (kind === "dust") {
      rnd = mulberry(417);
      n = Math.floor(24 + d * 260);
      for (i = 0; i < n; i++) {
        ctx.fillStyle = "rgba(206, 214, 216, " + (0.12 + rnd() * 0.4 * Math.max(d, 0.2)) + ")";
        ctx.fillRect(rnd() * w, rnd() * h, 0.7 + rnd() * 1.5, 0.7 + rnd() * 1.5);
      }
    } else if (kind === "still") {
      ctx.fillStyle = "rgba(150, 168, 176, 0.02)";
      ctx.fillRect(0, 0, w, h);
    }
  }

  function drawEcho(ctx, px) {
    if (field.void.kind !== "echo") return;
    var reach = 8 + field.void.reach * 36;
    var i;
    ctx.save();
    for (i = 1; i <= 3; i++) {
      strokeLine(ctx, offsetOut(px, reach * i * 0.5), true);
      ctx.strokeStyle = "rgba(190, 206, 214, " + (0.18 * Math.max(field.void.density, 0.25) / i) + ")";
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function bandBetween(ctx, outer, inner, struct, shape, sFixed) {
    var n = outer.length;
    var step = n > 240 ? 4 : n > 100 ? 2 : 1;
    var i = 0;
    var j, u, tang, sample, anchor;
    while (i < n) {
      j = i + step;
      if (j >= n) j = 0;
      if (Math.hypot(outer[j].x - outer[i].x, outer[j].y - outer[i].y) < 0.4) {
        if (j === 0) break;
        i += step;
        continue;
      }
      u = i / n;
      tang = Math.atan2(outer[j].y - outer[i].y, outer[j].x - outer[i].x);
      sample = sampleMorph(struct, sFixed, u, shape, tang);
      if (sFixed === 0) {
        sample.id = struct.boundary;
        sample.id2 = null;
        sample.mix = 0;
        sample.alpha = MAT[struct.boundary].alpha;
      }
      anchor = {
        x: (outer[i].x + inner[j].x) / 2,
        y: (outer[i].y + inner[j].y) / 2,
      };
      var tx = outer[j].x - outer[i].x, ty = outer[j].y - outer[i].y;
      var span = Math.hypot(tx, ty) || 1;
      tx /= span; ty /= span;
      var pad = 1.8;
      paintPoly(ctx, [
        { x: outer[i].x - tx * pad, y: outer[i].y - ty * pad },
        { x: outer[j].x + tx * pad, y: outer[j].y + ty * pad },
        { x: inner[j].x + tx * pad, y: inner[j].y + ty * pad },
        { x: inner[i].x - tx * pad, y: inner[i].y - ty * pad },
      ], sample, anchor);
      if (j === 0) break;
      i += step;
    }
  }

  function drawInward(ctx, px, struct, shape) {
    var n = px.length;
    if (n < 3) return;
    var c = centroid(px);
    var under = {
      id: coreId(struct), id2: null, mix: 0,
      scale: struct.scale * 1.4,
      density: struct.density,
      relief: struct.relief,
      rot: (shape.spin || 0) * Math.PI + (struct.flow - 0.5) * Math.PI,
      alpha: 1,
    };
    ctx.save();
    strokeLine(ctx, px, true);
    ctx.clip();
    fillPattern(ctx, under, c);
    ctx.restore();

    var rings = n > 240 ? 3 : 5;
    var r, s0, s1;
    for (r = 0; r < rings; r++) {
      s0 = r / rings;
      s1 = (r + 1) / rings;
      bandBetween(ctx, inset(px, s0 * 0.9), inset(px, s1 * 0.9), struct, shape, (s0 + s1) / 2);
    }
  }

  function drawOutward(ctx, px, struct, shape) {
    var reach = 7 + field.void.reach * 30;
    bandBetween(ctx, offsetOut(px, reach), px, struct, shape, 0);
  }

  function drawOpenSides(ctx, px, shape) {
    var n = px.length;
    var i, a, b, tx, ty, len, lx, ly, span;
    span = 8 + field.void.reach * 10;
    for (i = 0; i < n - 1; i++) {
      a = px[i];
      b = px[i + 1];
      tx = b.x - a.x;
      ty = b.y - a.y;
      len = Math.hypot(tx, ty) || 1;
      tx /= len; ty /= len;
      if (shape.trace < 0) { tx = -tx; ty = -ty; }
      lx = -ty; ly = tx;
      var u = i / Math.max(1, n - 1);
      var tang = Math.atan2(ty, tx);
      var left = sampleMorph(field.cw, 0, u, shape, tang);
      var right = sampleMorph(field.ccw, 0, u, shape, tang);
      left.id = field.cw.boundary; left.id2 = null; left.mix = 0;
      right.id = field.ccw.boundary; right.id2 = null; right.mix = 0;
      paintPoly(ctx, [
        a, b,
        { x: b.x + lx * span, y: b.y + ly * span },
        { x: a.x + lx * span, y: a.y + ly * span },
      ], left, a);
      paintPoly(ctx, [
        a, b,
        { x: b.x - lx * span, y: b.y - ly * span },
        { x: a.x - lx * span, y: a.y - ly * span },
      ], right, a);
    }
  }

  function drawFibers(ctx, px, shape, inwardKey) {
    var n = px.length;
    var closed = !!shape.closed;
    var step = Math.max(1, Math.floor(n / (closed ? 12 : 10)));
    var i;
    for (i = 0; i < n; i += step) {
      var j = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      if (j === i) break;
      var a = px[i];
      var b = px[j];
      var tx = b.x - a.x, ty = b.y - a.y;
      var len = Math.hypot(tx, ty) || 1;
      tx /= len; ty /= len;
      if (shape.trace < 0) { tx = -tx; ty = -ty; }
      var lx = -ty, ly = tx;
      var u = i / n;
      var wave = field.morph === "pulse"
        ? 0.45 + 0.85 * (0.5 + 0.5 * Math.sin(u * field.pulse * TAU + state.time * 1.3))
        : 1;
      var inwardIsLeft = !closed || leftFacesInside(px, shape.trace);
      tick(ctx, a, lx, ly, field.cw, shape, u, wave, inwardIsLeft);
      tick(ctx, a, -lx, -ly, field.ccw, shape, u, wave, !closed || !inwardIsLeft);
      if (i % (step * 3) === 0) {
        ctx.fillStyle = "rgba(244, 255, 248, 0.9)";
        ctx.beginPath();
        ctx.moveTo(a.x + tx * 8, a.y + ty * 8);
        ctx.lineTo(a.x - ty * 3.2, a.y + tx * 3.2);
        ctx.lineTo(a.x + ty * 3.2, a.y - tx * 3.2);
        ctx.fill();
      }
    }
  }

  function tick(ctx, a, nx, ny, struct, shape, u, wave, inward) {
    var spin = (shape.spin || 0) * u * Math.PI * 0.65;
    var co = Math.cos(spin), si = Math.sin(spin);
    var rx = nx * co - ny * si;
    var ry = nx * si + ny * co;
    var reach = inward ? 5 + struct.density * 9 : 4 + field.void.reach * 8;
    reach *= wave;
    var col = MAT[struct.boundary] || MAT.pigment;
    ctx.strokeStyle = rgba(col.shade, inward ? 0.45 : 0.28);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x + rx * reach, a.y + ry * reach);
    ctx.stroke();
  }

  function drawShape(ctx, shape, isSel) {
    var px = toPx(shape.pts);
    if (px.length < 2) return;
    if (shape.sketch) {
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      strokeLine(ctx, px, false);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.72)";
      ctx.lineWidth = 3.4;
      ctx.stroke();
      ctx.strokeStyle = isSel ? "#ffffff" : "rgba(255, 255, 255, 0.95)";
      ctx.lineWidth = isSel ? 1.8 : 1.35;
      ctx.stroke();
      return;
    }
    var area = shape.closed ? shoelace(shape.pts) : 0;
    shape._area = area;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (shape.closed && px.length >= 3) {
      var inwardKey = insideChannel(px, shape.trace);
      shape._inside = inwardKey;
      var inward = field[inwardKey];
      var outward = field[inwardKey === "cw" ? "ccw" : "cw"];
      drawEcho(ctx, px);
      drawOutward(ctx, px, outward, shape);
      drawInward(ctx, px, inward, shape);
      strokeLine(ctx, px, true);
      ctx.strokeStyle = isSel ? "#f4fff8" : "rgba(236, 244, 240, 0.88)";
      ctx.lineWidth = isSel ? 1.7 : 1.15;
      ctx.stroke();
      drawFibers(ctx, px, shape, inwardKey);
      if (isSel) {
        var c = centroid(px);
        var top = px[0].y;
        var k;
        for (k = 1; k < px.length; k++) if (px[k].y < top) top = px[k].y;
        ctx.font = "600 12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = rgb((MAT[coreId(inward)] || MAT.pigment).thread);
        ctx.fillText(MAT[coreId(inward)].title, c.x, c.y);
        ctx.fillStyle = "rgba(214, 226, 230, 0.9)";
        ctx.fillText("void · " + field.void.kind, c.x, Math.max(14, top - 14));
      }
    } else {
      shape._inside = null;
      drawOpenSides(ctx, px, shape);
      strokeLine(ctx, px, false);
      ctx.strokeStyle = isSel ? "#f4fff8" : "rgba(236, 244, 240, 0.88)";
      ctx.lineWidth = isSel ? 1.7 : 1.15;
      ctx.stroke();
      drawFibers(ctx, px, shape, null);
    }
  }

  function draw() {
    var ctx = state.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, state.w, state.h);
    paintVoid(ctx);
    if (state.photo && state.view.scale > 0) {
      var a = state.view.aspect || aspectOf();
      ctx.drawImage(state.photo, state.view.ox, state.view.oy, state.view.scale * a, state.view.scale);
    }
    var i;
    for (i = 0; i < state.shapes.length; i++) {
      drawShape(ctx, state.shapes[i], state.shapes[i].id === state.selected);
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
    if (e.button === 1 || e.altKey) {
      e.preventDefault();
      state.pointer = { id: e.pointerId, kind: "pan", last: p };
      return;
    }
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
    if (drag.kind === "pan") {
      state.view.ox += p.px - drag.last.px;
      state.view.oy += p.py - drag.last.py;
      drag.last = p;
      state.view.user = true;
      return;
    }
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
      var x = STAGE_INSET + u * (1 - STAGE_INSET * 2);
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
        wave: { kind: eq.kind, amp: eq.amp, freq: eq.freq, phase: eq.phase, slope: eq.slope },
      });
    });
    if (groups.length) state.selected = state.shapes[state.shapes.length - 1].id;
    setStatus(groups.length ? label + " on the sheet." : "That equation has no line to lay.");
    fitView();
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

  function tokenMat(raw) {
    var k = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
    if (k === "void" || k === "empty" || k === "nothing") return "void";
    return MAT[k] ? k : "";
  }

  function spreadShells(bits) {
    if (bits.length <= 1) return [bits[0], bits[0], bits[0], bits[0]];
    if (bits.length === 2) return [bits[0], bits[0], bits[1], bits[1]];
    if (bits.length === 3) return [bits[0], bits[1], bits[2], bits[2]];
    return bits.slice(0, 4);
  }

  function setStatus(text) {
    var status = $("lm-status");
    if (status) status.textContent = text || "";
  }

  function applyPrompt(text) {
    field.prompt = String(text || "").trim();
    var note = "";
    field.prompt.split(/[,|\n]/).forEach(function (part) {
      var m = /^\s*(cw|ccw|void)\s*:\s*(.+)$/i.exec(part.trim());
      if (!m) return;
      var key = m[1].toLowerCase();
      var body = m[2].trim().toLowerCase();
      if (key === "void") {
        var kind = body.replace(/[^a-z]/g, "");
        if (VOID_KINDS[kind]) field.void.kind = kind;
        else note = "Void is still, haze, dust, or echo. It describes empty space.";
        return;
      }
      var bits = body.split(/\s*>\s*/).map(tokenMat).filter(Boolean);
      if (!bits.length || bits.indexOf("void") >= 0) {
        note = "Void is empty space outside the shape. It cannot be the core, or a texture inside the fill. Use silk, grain, glass, pigment, stone, metal, or weave.";
        return;
      }
      var struct = field[key];
      struct.boundary = bits[0];
      struct.core = bits[bits.length - 1];
      struct.shells = spreadShells(bits);
    });
    setStatus(note);
    paintControls();
    scheduleSave();
    updateReadout();
  }

  function matOptions(selectedId) {
    return MAT_IDS.map(function (id) {
      return "<option value='" + id + "'" + (id === selectedId ? " selected" : "") + ">" + MAT[id].title + "</option>";
    }).join("");
  }

  function slider(structKey, key, label, min, max, step, value) {
    return "<label>" + label +
      "<input data-struct='" + structKey + "' data-key='" + key + "' type='range' min='" + min +
      "' max='" + max + "' step='" + step + "' value='" + value + "'></label>";
  }

  function paintControls() {
    var host = $("lm-materials");
    if (!host) return;
    var laminate = field.morph === "laminate";
    var transport = field.morph === "transport";
    function block(key, title) {
      var s = field[key];
      var shells = "";
      if (laminate) {
        shells = "<div class='lm-row'>" + [0, 1, 2, 3].map(function (i) {
          var name = i === 0 ? "Line" : i === 3 ? "Core" : "Shell " + (i + 1);
          return "<label>" + name + "<select data-struct='" + key + "' data-shell='" + i + "'>" + matOptions(s.shells[i]) + "</select></label>";
        }).join("") + "</div>";
      }
      return "<section class='lm-block' id='lm-block-" + key + "'>" +
        "<p class='lm-kicker'>" + title + "</p>" +
        (laminate ? shells : (
          "<div class='lm-row'>" +
          "<label>On the line<select data-struct='" + key + "' data-key='boundary'>" + matOptions(s.boundary) + "</select></label>" +
          "<label>Core<select data-struct='" + key + "' data-key='core'" + (transport ? " disabled" : "") + ">" + matOptions(s.core) + "</select></label>" +
          "</div>"
        )) +
        "<div class='lm-row'>" +
        slider(key, "scale", "Scale", 0.4, 2.2, 0.05, s.scale) +
        slider(key, "density", "Density", 0.1, 1, 0.01, s.density) +
        slider(key, "relief", "Relief", 0.1, 1, 0.01, s.relief) +
        slider(key, "flow", "Flow off the line", 0, 1, 0.01, s.flow) +
        "</div></section>";
    }
    var voidOpts = Object.keys(VOID_KINDS).map(function (k) {
      return "<option value='" + k + "'" + (field.void.kind === k ? " selected" : "") + ">" + VOID_KINDS[k] + "</option>";
    }).join("");
    host.innerHTML =
      "<label>Morphism<select id='lm-morph'>" + Object.keys(MORPHS).map(function (k) {
        return "<option value='" + k + "'" + (field.morph === k ? " selected" : "") + ">" + MORPHS[k] + "</option>";
      }).join("") + "</select></label>" +
      (field.morph === "pulse"
        ? "<label>Pulse along the line<input id='lm-pulse' type='range' min='0.5' max='8' step='0.1' value='" + field.pulse + "'></label>"
        : "") +
      (transport ? "<p class='lm-note'>Transport carries the line texture inward. The core is that same substance.</p>" : "") +
      block("cw", "Clockwise texture") +
      block("ccw", "Counter-clockwise texture") +
      "<section class='lm-block' id='lm-block-void'>" +
      "<p class='lm-kicker'>Empty space</p>" +
      "<div class='lm-row'>" +
      "<label>Void<select id='lm-void-kind'>" + voidOpts + "</select></label>" +
      "<label>Reach into emptiness<input id='lm-void-reach' type='range' min='0' max='1' step='0.01' value='" + field.void.reach + "'></label>" +
      "<label>How present<input id='lm-void-density' type='range' min='0' max='1' step='0.01' value='" + field.void.density + "'></label>" +
      "</div></section>";

    var morph = $("lm-morph");
    if (morph) morph.addEventListener("change", function () {
      field.morph = morph.value;
      paintControls();
      scheduleSave();
      updateReadout();
    });
    var pulse = $("lm-pulse");
    if (pulse) pulse.addEventListener("input", function () {
      field.pulse = Number(pulse.value);
      scheduleSave();
    });
    host.querySelectorAll("select[data-key], select[data-shell]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var struct = field[sel.getAttribute("data-struct")];
        if (sel.hasAttribute("data-shell")) {
          var i = Number(sel.getAttribute("data-shell"));
          struct.shells[i] = sel.value;
          struct.boundary = struct.shells[0];
          struct.core = struct.shells[3];
        } else {
          struct[sel.getAttribute("data-key")] = sel.value;
          struct.shells[0] = struct.boundary;
          struct.shells[3] = struct.core;
        }
        scheduleSave();
        updateReadout();
      });
    });
    host.querySelectorAll("input[data-key]").forEach(function (input) {
      input.addEventListener("input", function () {
        field[input.getAttribute("data-struct")][input.getAttribute("data-key")] = Number(input.value);
        scheduleSave();
        updateReadout();
      });
    });
    var kind = $("lm-void-kind");
    if (kind) kind.addEventListener("change", function () {
      field.void.kind = kind.value;
      scheduleSave();
      updateReadout();
    });
    var reach = $("lm-void-reach");
    if (reach) reach.addEventListener("input", function () {
      field.void.reach = Number(reach.value);
      scheduleSave();
    });
    var density = $("lm-void-density");
    if (density) density.addEventListener("input", function () {
      field.void.density = Number(density.value);
      scheduleSave();
    });
    markSides();
  }

  function fmtPct(area) {
    return (Math.abs(area) * 100).toFixed(1) + "%";
  }

  function measure(shape) {
    var area = shoelace(shape.pts);
    var drawnCw = area > 0;
    var tracingCw = shape.trace < 0 ? !drawnCw : drawnCw;
    var inside = shape.closed ? insideChannel(toPx(shape.pts), shape.trace) : null;
    return {
      area: area,
      tracingCw: tracingCw,
      way: tracingCw ? "Clockwise" : "Counter-clockwise",
      inside: inside,
    };
  }

  function updateReadout() {
    var el = $("lm-readout");
    var s = selected();
    var line = state.photo ? "Image sheet. Draw on the picture." : "Sketch an image. The window becomes that picture.";
    var tracingCw = false;
    if (s) {
      var m = measure(s);
      tracingCw = m.tracingCw;
      if (s.sketch) line = "Sketch line on the image";
      else if (s.closed && m.inside) {
        var core = MAT[coreId(field[m.inside])].title;
        line = "Closed · fill " + fmtPct(m.area) + " · " + m.way.toLowerCase() +
          " · core " + core.toLowerCase() + " · void " + field.void.kind + " outside";
      } else line = "Open line · " + m.way.toLowerCase() + " · no fill until it closes";
    }
    if (el) el.textContent = line;
    markSides();
    var cwBtn = $("lm-cw");
    var ccwBtn = $("lm-ccw");
    if (cwBtn) cwBtn.classList.toggle("is-on", !!(s && tracingCw));
    if (ccwBtn) ccwBtn.classList.toggle("is-on", !!(s && !tracingCw));
    var spin = $("lm-spin");
    if (spin && s && document.activeElement !== spin) spin.value = String(s.spin);
  }

  function markSides() {
    var s = selected();
    var inward = null;
    if (s && s.closed && s.pts.length > 2 && state.w) {
      inward = insideChannel(toPx(s.pts), s.trace);
    }
    var cw = $("lm-block-cw");
    var ccw = $("lm-block-ccw");
    if (cw) {
      cw.classList.toggle("is-inward", inward === "cw");
      cw.classList.toggle("is-outward", inward === "ccw");
    }
    if (ccw) {
      ccw.classList.toggle("is-inward", inward === "ccw");
      ccw.classList.toggle("is-outward", inward === "cw");
    }
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

  function layoutWindow() {
    if (!state.canvas) return;
    resize();
    if (!state.view.user) fitView();
  }

  function traceImage(file) {
    var api = window.GraphCalcImgTrace;
    if (!api || !api.imageToBezierExprs) {
      setStatus("Sketch tracer is not loaded.");
      return;
    }
    setStatus("Opening the image…");
    var url = URL.createObjectURL(file);
    var img = new Image();
    var pictured = new Promise(function (resolve, reject) {
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("image")); };
      img.src = url;
    });
    var traced = api.imageToBezierExprs(url, { detail: 7, maxCurves: 240, maxWidth: 480, flipY: false });
    pictured.then(function (image) {
      state.photo = image;
      state.imageAspect = (image.naturalWidth || 1) / Math.max(1, image.naturalHeight || 1);
      state.view.user = false;
      layoutWindow();
    }).catch(function () {});
    Promise.all([pictured, traced]).then(function (pair) {
      URL.revokeObjectURL(url);
      var result = pair[1];
      var w = (result && result.width) || 1;
      var h = (result && result.height) || 1;
      snapshot();
      state.shapes = [];
      state.selected = null;
      state.exprs = [];
      var count = 0;
      if (result && result.beziers && result.beziers.length) {
        chainsFromBeziers(result.beziers).forEach(function (chain) {
          var pts = [];
          chain.forEach(function (b, idx) {
            var samples = bezierPoints(b, 6);
            if (idx) samples = samples.slice(1);
            samples.forEach(function (p) {
              pts.push({ x: p.x / w, y: p.y / h });
            });
          });
          if (pts.length < 3) return;
          count++;
          state.shapes.push({
            id: state.nextId++,
            pts: pts,
            closed: false,
            trace: 1,
            spin: 0.75,
            label: "sketch",
            sketch: true,
          });
        });
      }
      state.selected = count ? state.shapes[state.shapes.length - 1].id : null;
      fitView();
      setStatus(count ? count + " sketch lines on the image." : "The image is the sheet. No lines to sketch.");
      var input = $("lm-file");
      if (input) input.value = "";
      scheduleSave();
      updateReadout();
    }).catch(function () {
      URL.revokeObjectURL(url);
      setStatus("Could not open that image.");
      var input = $("lm-file");
      if (input) input.value = "";
    });
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
    if (window.ResizeObserver) {
      var stage = canvas.closest(".lm-stage");
      if (stage) {
        var ro = new ResizeObserver(function () { if (state.on) layoutWindow(); });
        ro.observe(stage);
      }
    }
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("auxclick", function (e) {
      if (e.button === 1) e.preventDefault();
    });
    canvas.addEventListener("wheel", function (e) {
      if (!state.on) return;
      e.preventDefault();
      var box = cssSize();
      zoomAt(e.clientX - box.r.left, e.clientY - box.r.top, e.deltaY > 0 ? 1 / 1.18 : 1.18);
    }, { passive: false });
    var zoomOut = $("lm-zoom-out");
    var zoomIn = $("lm-zoom-in");
    var zoomFit = $("lm-zoom-fit");
    if (zoomOut) zoomOut.addEventListener("click", function () { zoomAt(state.w / 2, state.h / 2, 1 / 1.2); });
    if (zoomIn) zoomIn.addEventListener("click", function () { zoomAt(state.w / 2, state.h / 2, 1.2); });
    if (zoomFit) zoomFit.addEventListener("click", function () { fitView(); });
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
        state.shapes = state.shapes.filter(function (sh) { return sh.id !== state.selected; });
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
    if (prompt && document.activeElement !== prompt) prompt.value = field.prompt || "";
    var kind = $("lm-eq-kind");
    if (kind) kind.value = eq.kind;
    if ($("lm-amp")) $("lm-amp").value = String(eq.amp);
    if ($("lm-freq")) $("lm-freq").value = String(eq.freq);
    if ($("lm-phase")) $("lm-phase").value = String(eq.phase);
    if ($("lm-slope")) $("lm-slope").value = String(eq.slope);
    var s = selected();
    if ($("lm-spin")) $("lm-spin").value = String(s ? s.spin : 1);
    setMode(state.mode === "morph" ? "draw" : state.mode);
    paintControls();
  }

  function onShow() {
    document.body.classList.add("lm-tab-active");
    bind();
    if (!state.ready) {
      state.ready = true;
      if (load() && state.selected == null && state.shapes.length) {
        state.selected = state.shapes[state.shapes.length - 1].id;
      }
    }
    syncControls();
    layoutWindow();
    start();
    updateReadout();
  }

  function onHide() {
    document.body.classList.remove("lm-tab-active");
    stop();
    save();
  }

  window.addEventListener("resize", function () { if (state.on) layoutWindow(); });
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
