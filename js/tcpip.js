/* TCP/IP road: Logan's powerline sketch above the tab bar, with sagging wires
   between poles and a flat road beneath. Cars are packets driving both ways.
   No network calls. Respects prefers-reduced-motion. Toggle lives in #tcpip. */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var KEY = "tcpip-road-hidden";
  // Pole x positions as fractions of tab-bar width, traced from the sketch.
  var POLES = [0.015, 0.13, 0.265, 0.34, 0.435, 0.525, 0.635, 0.75, 0.875, 0.985];
  var H = 60, TOP = 6, GROUND = H - 1, SAG = 9;
  var COLORS = ["#e8d5a3", "#d9774b", "#7fb3c9", "#c9a0dc", "#9cc58a", "#e0b84f", "#f2f2ee", "#d65a6f"];
  var nav, wrap, svg, roadPath, carLayer, cars = [], lights = [], clock = 0, len = 0, raf = 0, last = 0, spawnT = 0;
  // Traffic lights at these fractions of the width (between poles). Cycle seconds.
  var LIGHTS = [0.2, 0.48, 0.81], GREEN = 5, YELLOW = 1.4, RED = 4, CYCLE = GREEN + YELLOW + RED;
  var LAMP = { red: "#ff4a3d", yellow: "#ffc93a", green: "#3ddc6a", off: "#2b2f33" };
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function hidden() { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }

  function carShape(color) {
    var g = el("g", { "class": "tcpip-car" });
    el("rect", { x: -6, y: -2.6, width: 12, height: 4, rx: 1.6, fill: color }, g);
    el("path", { d: "M-3.2 -2.6 L-1.8 -5 H2.2 L3.6 -2.6 Z", fill: color, opacity: 0.9 }, g);
    el("path", { d: "M-1.4 -4.4 H1.9 L2.8 -2.8 H-2.3 Z", fill: "#1c2a33", opacity: 0.75 }, g);
    el("circle", { cx: -3.4, cy: 1.5, r: 1.35, fill: "#141414" }, g);
    el("circle", { cx: 3.4, cy: 1.5, r: 1.35, fill: "#141414" }, g);
    el("circle", { cx: 5.6, cy: -1, r: 0.7, fill: "#fff6c8" }, g);
    return g;
  }

  function build() {
    var w = Math.max(200, Math.round(nav.getBoundingClientRect().width));
    wrap.style.width = w + "px";
    svg.setAttribute("viewBox", "0 0 " + w + " " + H);
    svg.setAttribute("width", w);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var xs = POLES.map(function (f) { return f * w; });
    // y of the middle wire (offset 0, sag index 1) at x; matches the drawn Bezier spans.
    function wireY(x) {
      var y0 = ARM - 1.6;
      for (var i = 1; i < xs.length; i++) {
        if (x >= xs[i - 1] && x <= xs[i]) {
          var span = xs[i] - xs[i - 1], t = (x - xs[i - 1]) / span;
          var sag = Math.min(14, Math.max(4, span * 0.09)) + 0.6;
          return y0 + 4 * t * (1 - t) * sag;
        }
      }
      return y0;
    }
    var ROAD_Y = H - 6; // flat road center, just above the tab bar edge
    var ARM = TOP + 2;
    var cross = el("g", { "class": "tcpip-cross" }, svg);
    var lx = LIGHTS.map(function (f) { return Math.round(f * w); });
    // One-point perspective: every cross street recedes to a shared vanishing point.
    var VPX = w / 2, VPY = TOP + 3, BASE = ROAD_Y - 4.5, HALF = 12, FAR = 0.78;
    var defs = el("defs", {}, svg);
    var gr = el("linearGradient", { id: "tcpip-fade", x1: 0, y1: 1, x2: 0, y2: 0 }, defs);
    el("stop", { offset: 0, "stop-color": "#e8d5a3", "stop-opacity": 0.13 }, gr);
    el("stop", { offset: 1, "stop-color": "#e8d5a3", "stop-opacity": 0 }, gr);
    function lerp(p, q, t) { return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; }
    // Perspective depth: equal steps in distance shrink toward the VP.
    function tz(z) { return 1 - 1 / (1 + z); }
    lx.forEach(function (x) {
      var vp = [x + (VPX - x) * Math.min(0.3, 90 / Math.max(1, Math.abs(VPX - x))), VPY], L0 = [x - HALF, BASE], R0 = [x + HALF, BASE], C0 = [x, BASE];
      var Lf = lerp(L0, vp, FAR), Rf = lerp(R0, vp, FAR);
      el("polygon", { points: [L0, R0, Rf, Lf].map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "), fill: "url(#tcpip-fade)" }, cross);
      var eg = el("g", { "class": "tcpip-cross-edge" }, cross);
      [[L0, Lf], [R0, Rf]].forEach(function (e) {
        el("line", { x1: e[0][0], y1: e[0][1], x2: e[1][0], y2: e[1][1] }, eg);
      });
      // Dashed center line: dashes shrink and fade with depth.
      for (var z = 0.25; z < 3.4; z += 0.5) {
        var t1 = tz(z), t2 = tz(z + 0.25);
        if (t2 > FAR) break;
        var p1 = lerp(C0, vp, t1), p2 = lerp(C0, vp, t2);
        el("line", { x1: p1[0].toFixed(1), y1: p1[1].toFixed(1), x2: p2[0].toFixed(1), y2: p2[1].toFixed(1), "class": "tcpip-cross-dash", "stroke-width": (1 - t1) * 1.1, opacity: (0.55 * (1 - t1 / FAR)).toFixed(2) }, cross);
      }
      // Foreshortened crosswalk across the cross street, just behind the corner.
      for (var k = 0; k < 4; k++) {
        var ta = tz(0.04 + k * 0.05), tb = tz(0.065 + k * 0.05);
        var a1 = lerp(L0, vp, ta), a2 = lerp(R0, vp, ta), b1 = lerp(R0, vp, tb), b2 = lerp(L0, vp, tb);
        el("polygon", { points: [a1, a2, b1, b2].map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "), "class": "tcpip-walk" }, cross);
      }
    });
    var poles = el("g", { "class": "tcpip-poles" }, svg);
    xs.forEach(function (x) {
      el("line", { x1: x, y1: TOP - 3, x2: x, y2: ROAD_Y, "class": "tcpip-pole" }, poles);
      el("line", { x1: x - 8, y1: ARM, x2: x + 8, y2: ARM, "class": "tcpip-arm" }, poles);
      [-6, 0, 6].forEach(function (o) { el("circle", { cx: x + o, cy: ARM - 1.4, r: 1.1, "class": "tcpip-insul" }, poles); });
    });
    var wires = el("g", { "class": "tcpip-wires" }, svg);
    [-6, 0, 6].forEach(function (o, k) {
      var y0 = ARM - 1.6;
      var wd = "M-30 " + (y0 + 6) + " Q" + (xs[0] + o - 12) + " " + (y0 + 1) + " " + (xs[0] + o) + " " + y0;
      for (var i = 1; i < xs.length; i++) {
        var span = xs[i] - xs[i - 1];
        var sag = Math.min(14, Math.max(4, span * 0.09)) + k * 0.6;
        wd += " Q" + ((xs[i - 1] + xs[i]) / 2 + o) + " " + (y0 + sag * 2) + " " + (xs[i] + o) + " " + y0;
      }
      wd += " Q" + (xs[xs.length - 1] + o + 12) + " " + (y0 + 1) + " " + (w + 30) + " " + (y0 + 6);
      el("path", { d: wd, "class": "tcpip-wire" }, wires);
    });
    var d = "M-30 " + ROAD_Y + " H" + (w + 30);
    el("rect", { x: 0, y: ROAD_Y - 4.5, width: w, height: 9, "class": "tcpip-asphalt" }, svg);
    el("line", { x1: 0, y1: ROAD_Y - 4.5, x2: w, y2: ROAD_Y - 4.5, "class": "tcpip-edge" }, svg);
    el("path", { d: d, "class": "tcpip-center" }, svg);
    var walks = el("g", { "class": "tcpip-walks" }, svg);
    lx.forEach(function (x) {
      [-10, 10].forEach(function (o) {
        for (var k = 0; k < 4; k++) el("rect", { x: x + o - 1.5, y: ROAD_Y - 4 + k * 2.2, width: 3, height: 1.2, "class": "tcpip-walk" }, walks);
      });
    });
    var prev = lights; lights = [];
    lx.forEach(function (x, i) {
      var g = el("g", { "class": "tcpip-light" }, svg);
      // Hang the signal from the middle power wire, directly over the road.
      var hx = x, wy = wireY(hx), top = Math.max(wy + 4, ARM + 9), boxH = 12;
      el("line", { x1: hx, y1: wy, x2: hx, y2: top, "class": "tcpip-light-hanger" }, g);
      el("circle", { cx: hx, cy: wy, r: 0.9, "class": "tcpip-light-clamp" }, g);
      var glow = el("ellipse", { cx: hx, cy: ROAD_Y - 2, rx: 14, ry: 4, "class": "tcpip-light-glow", fill: LAMP.off }, g);
      el("rect", { x: hx - 2.6, y: top, width: 5.2, height: boxH, rx: 1.2, "class": "tcpip-light-box" }, g);
      var lamps = ["red", "yellow", "green"].map(function (c, k) { return el("circle", { cx: hx, cy: top + 2.4 + k * 3.6, r: 1.25, fill: LAMP.off }, g); });
      lamps.glow = glow;
      lights.push({ x: x, s: x + 30, lamps: lamps, off: prev[i] ? prev[i].off : i * 3.1, state: "" });
    });
    paintLights();
    roadPath = el("path", { d: d, fill: "none", stroke: "none" }, svg);
    carLayer = el("g", { "class": "tcpip-cars" }, svg);
    len = roadPath.getTotalLength();
    // Plant the poles on the tab bar's top edge whatever margin the theme gives it.
    wrap.style.marginBottom = "0px";
    var gap = nav.getBoundingClientRect().top - wrap.getBoundingClientRect().bottom;
    wrap.style.marginBottom = (-gap - 1) + "px";
    cars.forEach(function (c) { carLayer.appendChild(c.g); });
  }

  function lightState(L) {
    if (reduce && reduce.matches) return "green";
    var t = (clock + L.off) % CYCLE;
    return t < GREEN ? "green" : t < GREEN + YELLOW ? "yellow" : "red";
  }
  function paintLights() {
    lights.forEach(function (L) {
      var st = lightState(L);
      if (st === L.state) return;
      L.state = st;
      L.lamps[0].setAttribute("fill", st === "red" ? LAMP.red : LAMP.off);
      L.lamps[1].setAttribute("fill", st === "yellow" ? LAMP.yellow : LAMP.off);
      L.lamps[2].setAttribute("fill", st === "green" ? LAMP.green : LAMP.off);
      if (L.lamps.glow) L.lamps.glow.setAttribute("fill", LAMP[st]);
    });
  }
  // How far this car may travel (along its direction) before stopping.
  function room(c) {
    var lim = Infinity, GAP = 11;
    for (var i = 0; i < cars.length; i++) {
      var o = cars[i];
      if (o === c || o.dir !== c.dir) continue;
      var ahead = (o.s - c.s) * c.dir;
      if (ahead > 0) lim = Math.min(lim, ahead - GAP);
    }
    for (var j = 0; j < lights.length; j++) {
      var L = lights[j];
      if (L.state === "green") continue;
      var stopAt = (L.s - c.dir * 12 - c.s) * c.dir; // stop line before the crosswalk
      // Yellow: only stop if there is room to; red: always stop before the line.
      if (stopAt > -0.5 && (L.state === "red" || stopAt > 10)) lim = Math.min(lim, Math.max(0, stopAt));
    }
    return lim;
  }

  function spawn(dir, at) {
    var g = carShape(COLORS[(Math.random() * COLORS.length) | 0]);
    carLayer.appendChild(g);
    var c = { g: g, dir: dir, s: at != null ? at : (dir > 0 ? 0 : len), v: 28 + Math.random() * 26 };
    cars.push(c);
    place(c);
  }

  function place(c) {
    var s = Math.max(0, Math.min(len, c.s));
    var p = roadPath.getPointAtLength(s);
    var q = roadPath.getPointAtLength(Math.min(len, s + 1));
    var p0 = roadPath.getPointAtLength(Math.max(0, s - 1));
    var ang = Math.atan2(q.y - p0.y, q.x - p0.x);
    var off = c.dir > 0 ? 2.2 : -2.2; // two lanes, normal offset
    var x = p.x - Math.sin(ang) * off, y = p.y + Math.cos(ang) * off;
    var deg = ang * 180 / Math.PI; // leftward cars are mirrored, never rotated
    c.g.setAttribute("transform", "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ") rotate(" + deg.toFixed(1) + ") scale(" + (c.dir < 0 ? "-0.8 0.8" : "0.8") + ")");
  }

  function tick(t) {
    raf = requestAnimationFrame(tick);
    var dt = Math.min(0.1, (t - (last || t)) / 1000); last = t;
    spawnT -= dt;
    var target = Math.max(3, Math.round(len / 110));
    clock += dt; paintLights();
    var clear = function (dir) { return !cars.some(function (o) { return o.dir === dir && (dir > 0 ? o.s < 16 : o.s > len - 16); }); };
    var nd = Math.random() < 0.5 ? 1 : -1;
    if (spawnT <= 0 && cars.length < target && clear(nd)) { spawn(nd); spawnT = 0.6 + Math.random() * 1.4; }
    for (var i = cars.length - 1; i >= 0; i--) {
      var c = cars[i];
      var r = room(c);
      // Ease to a stop: speed scales down within ~20px of the limit.
      var want = r === Infinity ? c.v : Math.min(c.v, Math.max(0, r) * 2.2);
      c.cur = (c.cur == null ? c.v : c.cur) + (want - (c.cur == null ? c.v : c.cur)) * Math.min(1, dt * 6);
      var step = Math.min(c.cur * dt, Math.max(0, r));
      c.s += c.dir * step;
      if (c.s < -5 || c.s > len + 5) { c.g.remove(); cars.splice(i, 1); continue; }
      place(c);
    }
  }

  function start() {
    stop();
    if (!wrap || wrap.hidden) return;
    if (reduce && reduce.matches) {
      // Static: a few parked packets, no motion.
      paintLights();
      for (var i = 0; i < 4; i++) spawn(i % 2 ? -1 : 1, len * (0.1 + i * 0.22));
      return;
    }
    // Seed so the road isn't empty on load.
    for (var j = 0; j < 4; j++) spawn(j % 2 ? -1 : 1, len * (0.1 + j * 0.23) + (j % 2 ? 6 : -6));
    last = 0; raf = requestAnimationFrame(tick);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf); raf = 0;
    cars.forEach(function (c) { c.g.remove(); }); cars = [];
  }

  function setHidden(h) {
    try { localStorage.setItem(KEY, h ? "1" : "0"); } catch (e) {}
    if (wrap) wrap.hidden = h;
    var t = document.getElementById("tcpip-road-toggle");
    if (t) t.checked = !h;
    if (h) stop(); else { build(); start(); }
  }

  function init() {
    nav = document.querySelector(".site-header .site-tabs") || document.querySelector(".site-tabs");
    if (!nav || document.getElementById("tcpip-road")) return;
    wrap = document.createElement("div");
    wrap.id = "tcpip-road";
    wrap.className = "tcpip-road";
    wrap.setAttribute("aria-hidden", "true");
    wrap.title = "TCP/IP — cars are packets";
    svg = el("svg", { "class": "tcpip-road-svg", height: H, preserveAspectRatio: "none" }, wrap);
    nav.parentNode.insertBefore(wrap, nav);
    wrap.hidden = hidden();
    build();
    start();
    var rt = 0;
    var ro = window.ResizeObserver ? new ResizeObserver(function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (wrap.hidden) return;
        var w = Math.round(nav.getBoundingClientRect().width);
        if (Math.abs(w - parseFloat(wrap.style.width || 0)) < 2) return;
        var fr = cars.map(function (c) { return { c: c, f: c.s / (len || 1) }; });
        build();
        fr.forEach(function (o) { o.c.s = o.f * len; });
      }, 120);
    }) : null;
    if (ro) ro.observe(nav); else window.addEventListener("resize", function () { build(); });
    if (reduce && reduce.addEventListener) reduce.addEventListener("change", function () { lights.forEach(function (L) { L.state = ""; }); start(); });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; }
      else if (!wrap.hidden && !raf && !(reduce && reduce.matches)) { last = 0; raf = requestAnimationFrame(tick); }
    });
    var t = document.getElementById("tcpip-road-toggle");
    if (t) {
      t.checked = !wrap.hidden;
      t.addEventListener("change", function () { setHidden(!t.checked); });
    }
  }

  window.TcpIp = { onShow: function () {}, setHidden: setHidden };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
