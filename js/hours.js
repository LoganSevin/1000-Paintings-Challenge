/**
 * 24 Hours — one idle painting for all 86,400 seconds of the local day.
 * Nested periods (43200 … 3) each move their own ring; the second-of-day
 * is a unique spark that never repeats until tomorrow.
 */
(function () {
  "use strict";

  var DAY = 86400;
  var LAYERS = [
    { s: 43200, name: "half", label: "12 h" },
    { s: 21600, name: "watch", label: "6 h" },
    { s: 10800, name: "tide", label: "3 h" },
    { s: 5400, name: "phase", label: "90 m" },
    { s: 2700, name: "bell", label: "45 m" },
    { s: 1350, name: "chime", label: "22 m" },
    { s: 675, name: "breath", label: "11 m" },
    { s: 135, name: "pulse", label: "2 m" },
    { s: 27, name: "beat", label: "27 s" },
    { s: 9, name: "tick", label: "9 s" },
    { s: 3, name: "flicker", label: "3 s" },
  ];

  var state = {
    running: false,
    raf: 0,
    preview: null,
    canvas: null,
    ctx: null,
    dpr: 1,
    w: 0,
    h: 0,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function secondOfDay(d) {
    d = d || new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
  }

  function wrapDay(t) {
    t = t % DAY;
    if (t < 0) t += DAY;
    return t;
  }

  function pad2(n) {
    n = Math.floor(Math.abs(n));
    return (n < 10 ? "0" : "") + n;
  }

  function stampFromSec(t) {
    t = wrapDay(t);
    var s = Math.floor(t) % DAY;
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return pad2(h) + ":" + pad2(m) + ":" + pad2(sec);
  }

  function hash(n) {
    var x = Math.imul(n | 0, 2654435761) >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 2246822519) >>> 0;
    x ^= x >>> 13;
    x = Math.imul(x, 3266489917) >>> 0;
    x ^= x >>> 16;
    return x >>> 0;
  }

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  function hsl(h, s, l, a) {
    return "hsla(" + h + "," + s + "%," + l + "%," + (a == null ? 1 : a) + ")";
  }

  function skyFor(t) {
    var h = t / 3600;
    var night = { top: [230, 42, 8], mid: [250, 38, 14], bot: [20, 28, 10] };
    var dawn = { top: [18, 55, 38], mid: [22, 70, 48], bot: [32, 55, 42] };
    var day = { top: [205, 62, 42], mid: [198, 48, 58], bot: [38, 28, 18] };
    var dusk = { top: [265, 48, 22], mid: [18, 72, 42], bot: [28, 40, 16] };
    function lerpC(a, b, u) {
      return [mix(a[0], b[0], u), mix(a[1], b[1], u), mix(a[2], b[2], u)];
    }
    function pack(c) {
      return { top: hsl(c.top[0], c.top[1], c.top[2]), mid: hsl(c.mid[0], c.mid[1], c.mid[2]), bot: hsl(c.bot[0], c.bot[1], c.bot[2]) };
    }
    if (h < 5 || h >= 21) return pack(night);
    if (h < 7) {
      var u = (h - 5) / 2;
      return pack({ top: lerpC(night.top, dawn.top, u), mid: lerpC(night.mid, dawn.mid, u), bot: lerpC(night.bot, dawn.bot, u) });
    }
    if (h < 9) {
      u = (h - 7) / 2;
      return pack({ top: lerpC(dawn.top, day.top, u), mid: lerpC(dawn.mid, day.mid, u), bot: lerpC(dawn.bot, day.bot, u) });
    }
    if (h < 17) return pack(day);
    if (h < 19) {
      u = (h - 17) / 2;
      return pack({ top: lerpC(day.top, dusk.top, u), mid: lerpC(day.mid, dusk.mid, u), bot: lerpC(day.bot, dusk.bot, u) });
    }
    u = (h - 19) / 2;
    return pack({ top: lerpC(dusk.top, night.top, u), mid: lerpC(dusk.mid, night.mid, u), bot: lerpC(dusk.bot, night.bot, u) });
  }

  function resize() {
    var canvas = state.canvas;
    if (!canvas) return;
    var wrap = canvas.parentNode;
    var w = Math.max(320, wrap.clientWidth || 640);
    var h = Math.max(280, wrap.clientHeight || 420);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    state.dpr = dpr;
    state.w = w;
    state.h = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    state.ctx = canvas.getContext("2d");
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(t) {
    var ctx = state.ctx;
    if (!ctx) return;
    var w = state.w;
    var h = state.h;
    var cx = w * 0.5;
    var cy = h * 0.52;
    var R = Math.min(w, h) * 0.42;
    t = wrapDay(t);
    var sky = skyFor(t);
    var g = ctx.createRadialGradient(cx, cy - R * 0.35, 8, cx, cy, R * 2.1);
    g.addColorStop(0, sky.mid);
    g.addColorStop(0.45, sky.top);
    g.addColorStop(1, sky.bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    var sunAng = ((t / DAY) * Math.PI * 2) - Math.PI / 2;
    var moonAng = sunAng + Math.PI;
    var orbit = R * 0.78;
    var sunY = cy + Math.sin(sunAng) * orbit;
    var sunUp = Math.max(0, Math.min(1, 1 - (sunY - (cy - orbit * 0.2)) / (orbit * 1.4)));
    ctx.save();
    ctx.globalAlpha = 0.22 + sunUp * 0.55;
    ctx.fillStyle = hsl(42, 90, 62, 1);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(sunAng) * orbit, sunY, 10 + sunUp * 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.18 + (1 - sunUp) * 0.5;
    ctx.fillStyle = hsl(48, 18, 86, 1);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(moonAng) * orbit, cy + Math.sin(moonAng) * orbit, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    var i;
    for (i = 0; i < LAYERS.length; i++) {
      var layer = LAYERS[i];
      var cells = DAY / layer.s;
      var idx = Math.floor(t / layer.s) % cells;
      var phase = (t % layer.s) / layer.s;
      var radius = R * (0.18 + (i / (LAYERS.length - 1)) * 0.78);
      var hue = (hash(Math.floor(t / layer.s) * 17 + i * 91) % 360);
      ctx.beginPath();
      ctx.strokeStyle = hsl(hue, 42, 62, 0.18 + (i / LAYERS.length) * 0.22);
      ctx.lineWidth = i > 7 ? 1.1 : 1.6;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      var marks = Math.min(cells, i < 4 ? cells : i < 8 ? 24 : 12);
      var m;
      for (m = 0; m < marks; m++) {
        var a = (m / marks) * Math.PI * 2 - Math.PI / 2;
        var on = Math.floor((idx / cells) * marks) === m;
        ctx.beginPath();
        ctx.strokeStyle = hsl(hue, on ? 70 : 30, on ? 72 : 48, on ? 0.95 : 0.28);
        ctx.lineWidth = on ? 2.2 : 1;
        ctx.moveTo(cx + Math.cos(a) * (radius - 3), cy + Math.sin(a) * (radius - 3));
        ctx.lineTo(cx + Math.cos(a) * (radius + (on ? 7 : 4)), cy + Math.sin(a) * (radius + (on ? 7 : 4)));
        ctx.stroke();
      }

      var beadA = (idx / cells + phase / cells) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.fillStyle = hsl(hue, 68, 68, 0.92);
      ctx.arc(cx + Math.cos(beadA) * radius, cy + Math.sin(beadA) * radius, i >= 8 ? 2.4 : 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    var flicker = (t % 3) / 3;
    var tick9 = (t % 9) / 9;
    var beat27 = (t % 27) / 27;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(flicker * Math.PI * 2));
    ctx.fillStyle = hsl((hash(Math.floor(t)) % 360), 55, 64, 1);
    ctx.beginPath();
    ctx.arc(cx, cy, 11 + 4 * Math.sin(tick9 * Math.PI * 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    for (i = 0; i < 3; i++) {
      var ta = tick9 * Math.PI * 2 + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.fillStyle = hsl(48, 80, 70, 0.85);
      ctx.arc(cx + Math.cos(ta) * (R * 0.12), cy + Math.sin(ta) * (R * 0.12), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (i = 0; i < 3; i++) {
      var ba = beat27 * Math.PI * 2 + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.fillStyle = hsl(200, 55, 72, 0.7);
      ctx.arc(cx + Math.cos(ba) * (R * 0.22), cy + Math.sin(ba) * (R * 0.22), 2, 0, Math.PI * 2);
      ctx.fill();
    }

    var nowA = (t / DAY) * Math.PI * 2 - Math.PI / 2;
    var sparkR = R * 0.96;
    var unique = hash(Math.floor(t));
    ctx.beginPath();
    ctx.fillStyle = hsl(unique % 360, 70, 68, 1);
    ctx.arc(cx + Math.cos(nowA) * sparkR, cy + Math.sin(nowA) * sparkR, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = hsl(42, 80, 70, 0.85);
    ctx.lineWidth = 1.4;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(nowA) * sparkR, cy + Math.sin(nowA) * sparkR);
    ctx.stroke();

    var trail = 48;
    for (i = 1; i < trail; i++) {
      var tt = wrapDay(t - i);
      var aa = (tt / DAY) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.fillStyle = hsl(hash(Math.floor(tt)) % 360, 50, 60, 0.35 * (1 - i / trail));
      ctx.arc(cx + Math.cos(aa) * sparkR, cy + Math.sin(aa) * sparkR, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function paintHud(t) {
    var clock = $("hr-clock");
    var dayEl = $("hr-daysec");
    var list = $("hr-layers");
    var note = $("hr-note");
    t = wrapDay(t);
    var whole = Math.floor(t);
    if (clock) clock.textContent = stampFromSec(t) + (state.preview != null ? " · preview" : "");
    if (dayEl) dayEl.textContent = whole.toLocaleString() + " / 86,400";
    if (list && list.dataset.sec !== String(whole)) {
      list.dataset.sec = String(whole);
      list.innerHTML = LAYERS.map(function (layer) {
        var cells = DAY / layer.s;
        var idx = Math.floor(t / layer.s) % cells;
        var left = layer.s - (t % layer.s);
        return (
          "<li><span>" +
          layer.label +
          "</span><strong>" +
          (idx + 1) +
          " / " +
          cells +
          "</strong><em>" +
          Math.ceil(left) +
          "s left</em></li>"
        );
      }).join("");
    }
    if (note) {
      note.textContent =
        "Second " +
        (whole + 1) +
        " of the local day. Nested rings: 12h → 3s. The gold hand is this second; it will not sit here again until tomorrow.";
    }
  }

  function nowT() {
    if (state.preview != null) return state.preview;
    return secondOfDay();
  }

  function frame() {
    if (!state.running) return;
    var t = nowT();
    if (state.preview == null) t = secondOfDay();
    draw(t);
    paintHud(t);
    state.raf = requestAnimationFrame(frame);
  }

  function start() {
    if (state.running) return;
    state.running = true;
    resize();
    frame();
  }

  function stop() {
    state.running = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  function bindScrub() {
    var canvas = state.canvas;
    if (!canvas || canvas.dataset.scrub) return;
    canvas.dataset.scrub = "1";
    function fromEvent(e) {
      var r = canvas.getBoundingClientRect();
      var x = e.clientX - r.left - r.width / 2;
      var y = e.clientY - r.top - r.height / 2;
      var ang = Math.atan2(x, -y);
      var t = ((ang / (Math.PI * 2) + 1) % 1) * DAY;
      return t;
    }
    canvas.addEventListener("pointerdown", function (e) {
      canvas.setPointerCapture(e.pointerId);
      state.preview = fromEvent(e);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (state.preview == null) return;
      state.preview = fromEvent(e);
    });
    function endScrub() {
      state.preview = null;
    }
    canvas.addEventListener("pointerup", endScrub);
    canvas.addEventListener("pointercancel", endScrub);
  }

  function onShow() {
    document.body.classList.add("hr-tab-active");
    if (!state.canvas) state.canvas = $("hr-canvas");
    if (!state.canvas) return;
    resize();
    bindScrub();
    start();
  }

  function onHide() {
    document.body.classList.remove("hr-tab-active");
    stop();
  }

  window.addEventListener("resize", function () {
    if (state.running) resize();
  });
  window.addEventListener("hours-show", onShow);
  window.addEventListener("hours-hide", onHide);
  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "hours") onShow();
  });

  window.HoursDay = { onShow: onShow, onHide: onHide };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (document.body.getAttribute("data-active-tab") === "hours") onShow();
    });
  } else if (document.body.getAttribute("data-active-tab") === "hours") {
    onShow();
  }
})();
