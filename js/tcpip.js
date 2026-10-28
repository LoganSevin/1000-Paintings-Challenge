/* TCP/IP road: Logan's powerline sketch above the tab bar, redrawn as a sagging
   road strung between utility poles. Cars are packets driving both ways.
   No network calls. Respects prefers-reduced-motion. Toggle lives in #tcpip. */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var KEY = "tcpip-road-hidden";
  // Pole x positions as fractions of tab-bar width, traced from the sketch.
  var POLES = [0.015, 0.13, 0.265, 0.34, 0.435, 0.525, 0.635, 0.75, 0.875, 0.985];
  var H = 46, TOP = 9, GROUND = H - 1, SAG = 9;
  var COLORS = ["#e8d5a3", "#d9774b", "#7fb3c9", "#c9a0dc", "#9cc58a", "#e0b84f", "#f2f2ee", "#d65a6f"];
  var nav, wrap, svg, roadPath, carLayer, cars = [], len = 0, raf = 0, last = 0, spawnT = 0;
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
    // Road: extends off both edges so cars enter/leave out of frame.
    var d = "M" + (-30) + " " + (TOP + SAG * 0.6) + " Q" + (xs[0] - 10) + " " + (TOP + 2) + " " + xs[0] + " " + TOP;
    for (var i = 1; i < xs.length; i++) {
      var mx = (xs[i - 1] + xs[i]) / 2, span = xs[i] - xs[i - 1];
      var s = Math.min(SAG + 4, Math.max(4, span * 0.09));
      d += " Q" + mx + " " + (TOP + s * 2) + " " + xs[i] + " " + TOP;
    }
    d += " Q" + (xs[xs.length - 1] + 10) + " " + (TOP + 2) + " " + (w + 30) + " " + (TOP + SAG * 0.6);
    var poles = el("g", { "class": "tcpip-poles" }, svg);
    xs.forEach(function (x) {
      el("line", { x1: x, y1: TOP - 3, x2: x, y2: GROUND, "class": "tcpip-pole" }, poles);
      el("line", { x1: x - 7, y1: TOP - 1, x2: x + 7, y2: TOP - 1, "class": "tcpip-arm" }, poles);
      el("line", { x1: x - 5, y1: TOP + 4, x2: x + 5, y2: TOP + 4, "class": "tcpip-arm tcpip-arm-lo" }, poles);
      el("circle", { cx: x - 6, cy: TOP - 2, r: 1, "class": "tcpip-insul" }, poles);
      el("circle", { cx: x + 6, cy: TOP - 2, r: 1, "class": "tcpip-insul" }, poles);
    });
    el("path", { d: d, "class": "tcpip-asphalt" }, svg);
    el("path", { d: d, "class": "tcpip-edge" }, svg);
    el("path", { d: d, "class": "tcpip-center" }, svg);
    roadPath = el("path", { d: d, fill: "none", stroke: "none" }, svg);
    carLayer = el("g", { "class": "tcpip-cars" }, svg);
    len = roadPath.getTotalLength();
    // Plant the poles on the tab bar's top edge whatever margin the theme gives it.
    wrap.style.marginBottom = "0px";
    var gap = nav.getBoundingClientRect().top - wrap.getBoundingClientRect().bottom;
    wrap.style.marginBottom = (-gap - 1) + "px";
    cars.forEach(function (c) { carLayer.appendChild(c.g); });
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
    var deg = ang * 180 / Math.PI + (c.dir < 0 ? 180 : 0);
    c.g.setAttribute("transform", "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ") rotate(" + deg.toFixed(1) + ") scale(0.8)");
  }

  function tick(t) {
    raf = requestAnimationFrame(tick);
    var dt = Math.min(0.1, (t - (last || t)) / 1000); last = t;
    spawnT -= dt;
    var target = Math.max(3, Math.round(len / 110));
    if (spawnT <= 0 && cars.length < target) { spawn(Math.random() < 0.5 ? 1 : -1); spawnT = 0.6 + Math.random() * 1.4; }
    for (var i = cars.length - 1; i >= 0; i--) {
      var c = cars[i];
      c.s += c.dir * c.v * dt;
      if (c.s < -5 || c.s > len + 5) { c.g.remove(); cars.splice(i, 1); continue; }
      place(c);
    }
  }

  function start() {
    stop();
    if (!wrap || wrap.hidden) return;
    if (reduce && reduce.matches) {
      // Static: a few parked packets, no motion.
      for (var i = 0; i < 4; i++) spawn(i % 2 ? -1 : 1, len * (0.15 + i * 0.22));
      return;
    }
    // Seed so the road isn't empty on load.
    for (var j = 0; j < 4; j++) spawn(j % 2 ? -1 : 1, len * Math.random());
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
    if (reduce && reduce.addEventListener) reduce.addEventListener("change", start);
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
