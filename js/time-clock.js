/**
 * Header day/night globe — grass, sky gradient, sun by day, stars by night.
 * 12pm top, 6pm right, 12am bottom, 6am left.
 */
(function () {
  "use strict";

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function mixHex(a, b, t) {
    function hex(n) {
      n = Math.round(n);
      return (n < 16 ? "0" : "") + n.toString(16);
    }
    var ar = parseInt(a.slice(1, 3), 16);
    var ag = parseInt(a.slice(3, 5), 16);
    var ab = parseInt(a.slice(5, 7), 16);
    var br = parseInt(b.slice(1, 3), 16);
    var bg = parseInt(b.slice(3, 5), 16);
    var bb = parseInt(b.slice(5, 7), 16);
    return "#" + hex(lerp(ar, br, t)) + hex(lerp(ag, bg, t)) + hex(lerp(ab, bb, t));
  }

  function skyFor(h) {
    var night = { top: "#0a1022", mid: "#1a2748", bot: "#2a2040" };
    var dawn = { top: "#5a6a9a", mid: "#e89070", bot: "#f2c48a" };
    var day = { top: "#3d9ee8", mid: "#87c8ef", bot: "#d4eefc" };
    var dusk = { top: "#2a3060", mid: "#e07048", bot: "#f0b070" };
    var t;
    if (h < 5 || h >= 21) return night;
    if (h < 7) {
      t = (h - 5) / 2;
      return {
        top: mixHex(night.top, dawn.top, t),
        mid: mixHex(night.mid, dawn.mid, t),
        bot: mixHex(night.bot, dawn.bot, t),
      };
    }
    if (h < 9) {
      t = (h - 7) / 2;
      return {
        top: mixHex(dawn.top, day.top, t),
        mid: mixHex(dawn.mid, day.mid, t),
        bot: mixHex(dawn.bot, day.bot, t),
      };
    }
    if (h < 17) return day;
    if (h < 19) {
      t = (h - 17) / 2;
      return {
        top: mixHex(day.top, dusk.top, t),
        mid: mixHex(day.mid, dusk.mid, t),
        bot: mixHex(day.bot, dusk.bot, t),
      };
    }
    t = (h - 19) / 2;
    return {
      top: mixHex(dusk.top, night.top, t),
      mid: mixHex(dusk.mid, night.mid, t),
      bot: mixHex(dusk.bot, night.bot, t),
    };
  }

  function bodyPos(h) {
    var ang = ((h - 12) / 24) * Math.PI * 2;
    var r = 34;
    return {
      x: 50 + Math.sin(ang) * r,
      y: 50 - Math.cos(ang) * r,
    };
  }

  var previewing = false;

  function nowHours() {
    var now = new Date();
    return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  }

  function minutesNow() {
    var now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function applyHour(h, preview, now) {
    var el = document.getElementById("time-globe");
    var wrap = document.getElementById("time-clock");
    if (!el) return;
    h = ((h % 24) + 24) % 24;
    var sky = skyFor(h);
    var sun = bodyPos(h);
    var moon = bodyPos((h + 12) % 24);
    var starOp = 0;
    if (h < 5.5 || h >= 20.5) starOp = 1;
    else if (h < 7) starOp = 1 - (h - 5.5) / 1.5;
    else if (h >= 19) starOp = (h - 19) / 1.5;
    el.style.setProperty("--sky-top", sky.top);
    el.style.setProperty("--sky-mid", sky.mid);
    el.style.setProperty("--sky-bot", sky.bot);
    el.style.setProperty("--sun-x", sun.x.toFixed(1) + "%");
    el.style.setProperty("--sun-y", sun.y.toFixed(1) + "%");
    el.style.setProperty("--moon-x", moon.x.toFixed(1) + "%");
    el.style.setProperty("--moon-y", moon.y.toFixed(1) + "%");
    el.style.setProperty("--star-op", String(Math.max(0, Math.min(1, starOp))));
    el.style.setProperty("--orb-z", sun.y > 58 ? "2" : "6");
    var ring = bodyPos(h);
    var rx = 50 + ((ring.x - 50) / 34) * 48;
    var ry = 50 + ((ring.y - 50) / 34) * 48;
    var wrapEl = document.getElementById("time-globe-wrap");
    if (wrapEl) {
      wrapEl.style.setProperty("--ring-x", rx.toFixed(1) + "%");
      wrapEl.style.setProperty("--ring-y", ry.toFixed(1) + "%");
    }
    var hh, mm, stamp;
    if (now && !preview) {
      hh = String(now.getHours()).padStart(2, "0");
      mm = String(now.getMinutes()).padStart(2, "0");
      stamp = hh + ":" + mm + ":" + String(now.getSeconds()).padStart(2, "0");
    } else {
      hh = String(Math.floor(h)).padStart(2, "0");
      mm = String(Math.floor((h % 1) * 60)).padStart(2, "0");
      stamp = hh + ":" + mm;
    }
    var readout = document.getElementById("time-readout");
    if (readout) readout.textContent = stamp + (preview ? " · preview" : "");
    if (wrap) {
      wrap.classList.toggle("previewing", !!preview);
      wrap.title = preview ? "Preview " + stamp + " — release to snap to now" : "Local time " + stamp;
    }
  }

  function hourFromPointer(e, node) {
    var r = node.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    var dx = e.clientX - cx;
    var dy = cy - e.clientY;
    var ang = Math.atan2(dx, dy);
    var h = 12 + (ang / (Math.PI * 2)) * 24;
    return ((h % 24) + 24) % 24;
  }

  function applyNow() {
    var now = new Date();
    applyHour(now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600, false, now);
  }

  function tick() {
    if (previewing) return;
    applyNow();
  }

  // Line ticks up with the real second boundary so the seconds flip on time.
  function scheduleTick() {
    tick();
    setTimeout(scheduleTick, 1000 - (Date.now() % 1000) + 5);
  }

  function bindSlider() {
    var ring = document.getElementById("time-ring");
    var wrap = document.getElementById("time-globe-wrap");
    var node = ring || wrap;
    if (!node || node.dataset.bound) return;
    node.dataset.bound = "1";
    node.addEventListener("pointerdown", function (e) {
      previewing = true;
      try {
        node.setPointerCapture(e.pointerId);
      } catch (err) {}
      applyHour(hourFromPointer(e, node), true);
      e.preventDefault();
    });
    node.addEventListener("pointermove", function (e) {
      if (!previewing) return;
      applyHour(hourFromPointer(e, node), true);
    });
    function snap() {
      if (!previewing) return;
      previewing = false;
      applyNow();
    }
    node.addEventListener("pointerup", snap);
    node.addEventListener("pointercancel", snap);
  }

  function start() {
    bindSlider();
    tick();
  }

  start();
  scheduleTick();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  }
})();
