/**
 * Per-tab pencil notes. Survives roster/spellbook layout shifts.
 */
(function () {
  "use strict";

  var KEY = "gallery_ann_v1_";
  var canvas;
  var ctx;
  var drawing = false;
  var mode = "draw";
  var last = null;
  var dpr = 1;
  var tab = "gallery";
  var memory = {};
  var loadGen = 0;
  var resizeTimer = 0;
  var lastW = 0;
  var lastH = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function currentTab() {
    return document.body.getAttribute("data-active-tab") || "gallery";
  }

  function storageKey(name) {
    return KEY + (name || currentTab());
  }

  function radius() {
    var el = $("ann-radius");
    var n = el ? parseInt(el.value, 10) : 16;
    return n >= 4 && n <= 120 ? n : 16;
  }

  function color() {
    var el = $("ann-color");
    return (el && el.value) || "#e8d5a3";
  }

  function readStore(name) {
    if (memory[name]) return memory[name];
    try {
      return localStorage.getItem(storageKey(name)) || "";
    } catch (e) {
      return "";
    }
  }

  function writeStore(name, data) {
    memory[name] = data || "";
    try {
      if (data) localStorage.setItem(storageKey(name), data);
      else localStorage.removeItem(storageKey(name));
    } catch (e) {}
  }

  function snapshot() {
    if (!canvas) return "";
    try {
      return canvas.toDataURL("image/png");
    } catch (e) {
      return "";
    }
  }

  function paintData(data, gen) {
    if (!data || !ctx) return;
    var img = new Image();
    img.onload = function () {
      if (gen !== loadGen) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    };
    img.src = data;
  }

  function sizeCanvas() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = window.innerWidth;
    var h = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    lastW = w;
    lastH = h;
  }

  function resize() {
    if (!canvas || !ctx) return;
    var w = window.innerWidth;
    var h = window.innerHeight;
    if (w === lastW && h === lastH && canvas.width) return;
    var keep = memory[tab] || snapshot() || readStore(tab);
    sizeCanvas();
    var gen = ++loadGen;
    if (keep) paintData(keep, gen);
  }

  function save() {
    if (!canvas) return;
    var data = snapshot();
    if (!data) return;
    if (memory[tab] && data.length < 800) return;
    writeStore(tab, data);
  }

  function load(name) {
    if (!canvas || !ctx) return;
    var data = readStore(name);
    var gen = ++loadGen;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (data) {
      memory[name] = data;
      paintData(data, gen);
    }
  }

  function switchTab(name) {
    name = name || currentTab();
    if (name === tab) {
      if (readStore(tab) && canvas) load(tab);
      return;
    }
    save();
    tab = name;
    load(tab);
  }

  function pos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function stroke(from, to) {
    var r = radius();
    ctx.beginPath();
    if (mode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = r * 2;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color();
      ctx.lineWidth = Math.max(1.5, r * 0.22);
    }
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  function setArmed(on) {
    document.body.classList.toggle("ann-drawing", !!on);
    document.body.classList.toggle("ann-erasing", !!on && mode === "erase");
    var tog = $("ann-toggle");
    if (tog) tog.classList.toggle("active", !!on);
    var bar = $("ann-bar");
    if (bar) bar.hidden = !on;
  }

  function setMode(next) {
    mode = next === "erase" ? "erase" : "draw";
    document.body.classList.toggle(
      "ann-erasing",
      document.body.classList.contains("ann-drawing") && mode === "erase"
    );
    $("ann-draw") && $("ann-draw").classList.toggle("active", mode === "draw");
    $("ann-erase") && $("ann-erase").classList.toggle("active", mode === "erase");
  }

  function bind() {
    canvas = $("ann-canvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d", { willReadFrequently: false });
    tab = currentTab();
    sizeCanvas();
    load(tab);

    canvas.addEventListener("pointerdown", function (e) {
      if (!document.body.classList.contains("ann-drawing")) return;
      drawing = true;
      last = pos(e);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {}
      stroke(last, last);
      e.preventDefault();
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!drawing) return;
      var p = pos(e);
      stroke(last, p);
      last = p;
      e.preventDefault();
    });
    function endStroke() {
      if (!drawing) return;
      drawing = false;
      last = null;
      save();
    }
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);

    $("ann-toggle") &&
      $("ann-toggle").addEventListener("click", function () {
        setArmed(!document.body.classList.contains("ann-drawing"));
      });
    $("ann-draw") &&
      $("ann-draw").addEventListener("click", function () {
        setMode("draw");
      });
    $("ann-erase") &&
      $("ann-erase").addEventListener("click", function () {
        setMode("erase");
      });
    $("ann-clear") &&
      $("ann-clear").addEventListener("click", function () {
        loadGen += 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        writeStore(tab, "");
      });
    $("ann-done") &&
      $("ann-done").addEventListener("click", function () {
        setArmed(false);
        save();
      });

    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 180);
    });
    window.addEventListener("tab-changed", function (e) {
      var name = e && e.detail && e.detail.tab;
      switchTab(name || currentTab());
    });
    window.addEventListener("hashchange", function () {
      switchTab(currentTab());
    });
    window.addEventListener("spellforge-ready", function () {
      if (readStore(tab)) load(tab);
    });
  }

  window.GalleryAnnotations = {
    arm: function () {
      setArmed(true);
      setMode("draw");
    },
    disarm: function () {
      setArmed(false);
    },
    snapshot: snapshot,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
