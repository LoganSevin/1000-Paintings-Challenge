/**
 * Texture studio — turn Spellforge stills into seamless tiled materials.
 */
(function () {
  "use strict";

  var canvas;
  var ctx;
  var seam;
  var seamCtx;
  var viewW = 900;
  var viewH = 560;
  var running = false;
  var raf = 0;
  var activeKey = "q";
  var selectedSpell = 0;
  var page = 0;
  var PAGE = 36;
  var dpr = 1;
  var panX = 0;
  var panY = 0;
  var dragging = false;
  var lastPtr = { x: 0, y: 0 };

  function $(id) {
    return document.getElementById(id);
  }

  function tex() {
    return window.SpellMapTextures;
  }

  function spellUrl(n) {
    if (tex() && tex().spellUrl) return tex().spellUrl(n);
    if (typeof window.getSpellforgeSpellUrl === "function") return window.getSpellforgeSpellUrl(n);
    return "paintings/" + n + ".jpg";
  }

  function displayOrder() {
    try {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.getDisplayOrder === "function") {
        var a = window.SpellforgeAPI.getDisplayOrder();
        if (a && a.length) return a;
      }
    } catch (e) {}
    try {
      var raw = JSON.parse(localStorage.getItem("spellforge_display_order_v11") || "[]");
      if (raw && raw.length) return raw;
    } catch (e2) {}
    var i;
    var out = [];
    for (i = 1; i <= 1000; i++) out.push(i);
    return out;
  }

  function equipped() {
    try {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.getEquippedSlots === "function") {
        var s = window.SpellforgeAPI.getEquippedSlots() || [];
        return [s[0] || null, s[1] || null, s[2] || null];
      }
    } catch (e) {}
    try {
      var raw = JSON.parse(localStorage.getItem("spellforge_equipped_v1") || "null");
      if (Array.isArray(raw)) return [raw[0] || null, raw[1] || null, raw[2] || null];
    } catch (e2) {}
    return [null, null, null];
  }

  function setStatus(msg) {
    var el = $("tx-status");
    if (el) el.textContent = msg || "";
  }

  function layerLabel(k) {
    return (tex() && tex().LABELS && tex().LABELS[k]) || k.toUpperCase();
  }

  function activeNum() {
    var T = tex();
    if (selectedSpell) return selectedSpell;
    if (!T) return 0;
    return T.getNums()[activeKey] || 0;
  }

  function assign(key, num) {
    key = key || activeKey;
    num = parseInt(num, 10);
    if (!num || !tex()) return;
    selectedSpell = num;
    tex().setLayer(key, num);
    setStatus(layerLabel(key) + " material ← spell #" + num + " (seamless tile)");
    syncSlots();
  }

  function roll(key) {
    key = key || activeKey;
    if (!tex()) return;
    assign(key, tex().randomNum());
  }

  function currentImage() {
    var T = tex();
    var n = activeNum();
    if (!T || !n) return null;
    var img = T.getImage(n);
    if (!img) T.loadImage(n);
    return img && img.complete && img.naturalWidth ? img : null;
  }

  function currentTile() {
    var T = tex();
    var img = currentImage();
    if (!T || !img) return null;
    if (T.tileCanvas) return T.tileCanvas(img);
    if (T.seamlessTile) return T.seamlessTile(img, T.getTile(), T.getCrop());
    return null;
  }

  function drawSeam(tileImg) {
    if (!seamCtx || !seam) return;
    var w = seam.width;
    var h = seam.height;
    seamCtx.setTransform(1, 0, 0, 1, 0, 0);
    seamCtx.fillStyle = "#0a0e12";
    seamCtx.fillRect(0, 0, w, h);
    if (!tileImg) return;
    var cell = Math.floor(Math.min(w, h) / 2);
    seamCtx.imageSmoothingEnabled = false;
    var gx;
    var gy;
    for (gy = 0; gy < 2; gy++) {
      for (gx = 0; gx < 2; gx++) {
        seamCtx.drawImage(tileImg, gx * cell, gy * cell, cell, cell);
      }
    }
  }

  function drawIsoCube(dst, tileImg, cx, cy, s) {
    if (!tileImg) return;
    dst.save();
    dst.translate(cx, cy);
    function face(pts, shade) {
      dst.save();
      dst.beginPath();
      dst.moveTo(pts[0][0], pts[0][1]);
      dst.lineTo(pts[1][0], pts[1][1]);
      dst.lineTo(pts[2][0], pts[2][1]);
      dst.lineTo(pts[3][0], pts[3][1]);
      dst.closePath();
      dst.clip();
      dst.fillStyle = dst.createPattern(tileImg, "repeat");
      dst.fillRect(-s * 2, -s * 2, s * 4, s * 4);
      dst.fillStyle = shade;
      dst.fillRect(-s * 2, -s * 2, s * 4, s * 4);
      dst.restore();
    }
    var t = s * 0.58;
    face(
      [
        [0, -s * 0.55],
        [t, -s * 0.22],
        [0, s * 0.12],
        [-t, -s * 0.22],
      ],
      "rgba(255,255,255,0.08)"
    );
    face(
      [
        [-t, -s * 0.22],
        [0, s * 0.12],
        [0, s * 0.72],
        [-t, s * 0.38],
      ],
      "rgba(0,0,0,0.28)"
    );
    face(
      [
        [t, -s * 0.22],
        [0, s * 0.12],
        [0, s * 0.72],
        [t, s * 0.38],
      ],
      "rgba(0,0,0,0.14)"
    );
    dst.restore();
  }

  function draw() {
    if (!ctx) return;
    var T = tex();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#12161c";
    ctx.fillRect(0, 0, viewW, viewH);
    var img = currentImage();
    var tileImg = currentTile();
    if (tileImg) {
      var pat = ctx.createPattern(tileImg, "repeat");
      if (pat && typeof pat.setTransform === "function") {
        try {
          pat.setTransform(new DOMMatrix().translate(panX, panY));
        } catch (e) {}
      }
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, viewW, viewH);
      drawIsoCube(ctx, tileImg, viewW - 88, 92, 54);
    } else {
      ctx.fillStyle = "#8a9690";
      ctx.font = "15px Bahnschrift, sans-serif";
      ctx.fillText("Pick a spell — QWER makes a seamless material from its paint, not a poster on the map.", 28, viewH / 2);
    }
    drawSeam(tileImg);
    if (T && img && !tileImg) T.loadImage(activeNum());
  }

  function loop() {
    if (!running) return;
    draw();
    raf = requestAnimationFrame(loop);
  }

  function resize() {
    canvas = $("tx-canvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    var wrap = $("tx-stage");
    var r = wrap ? wrap.getBoundingClientRect() : { width: 900, height: 560 };
    dpr = Math.min(2, window.devicePixelRatio || 1);
    viewW = Math.max(320, r.width);
    viewH = Math.max(240, r.height);
    canvas.width = viewW * dpr;
    canvas.height = viewH * dpr;
    canvas.style.width = viewW + "px";
    canvas.style.height = viewH + "px";
    seam = $("tx-seam");
    if (seam) {
      seamCtx = seam.getContext("2d");
      var side = Math.min(256, Math.max(160, Math.floor(seam.getBoundingClientRect().width || 220)));
      seam.width = side;
      seam.height = side;
    }
  }

  function syncSlots() {
    var T = tex();
    var nums = T ? T.getNums() : { q: 0, w: 0, e: 0, r: 0 };
    ["q", "w", "e", "r"].forEach(function (k) {
      var btn = $("tx-slot-" + k);
      if (!btn) return;
      btn.classList.toggle("active", activeKey === k);
      var img = btn.querySelector("img");
      var lab = btn.querySelector(".tx-slot-num");
      if (nums[k]) {
        if (img) img.src = spellUrl(nums[k]);
        if (lab) lab.textContent = "#" + nums[k];
      } else {
        if (img) img.removeAttribute("src");
        if (lab) lab.textContent = layerLabel(k);
      }
    });
    var tileEl = $("tx-tile");
    if (tileEl && T) tileEl.value = String(T.getTile());
    var tileVal = $("tx-tile-val");
    if (tileVal && T) tileVal.textContent = T.getTile() + "px";
    var cropEl = $("tx-crop");
    if (cropEl && T) cropEl.value = String(Math.round(T.getCrop() * 100));
    var cropVal = $("tx-crop-val");
    if (cropVal && T) cropVal.textContent = Math.round(T.getCrop() * 100) + "%";
  }

  function renderTray() {
    var hold = $("tx-tray");
    if (!hold) return;
    var order = displayOrder();
    var totalPages = Math.max(1, Math.ceil(order.length / PAGE));
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;
    var slice = order.slice(page * PAGE, page * PAGE + PAGE);
    var pg = $("tx-page");
    if (pg) pg.textContent = page + 1 + " / " + totalPages;
    hold.innerHTML = "";
    slice.forEach(function (n) {
      n = parseInt(n, 10);
      if (!n) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tx-spell" + (selectedSpell === n ? " selected" : "");
      b.title = "Spell #" + n;
      var im = document.createElement("img");
      im.alt = "#" + n;
      im.loading = "lazy";
      im.src = spellUrl(n);
      b.appendChild(im);
      b.addEventListener("click", function () {
        selectedSpell = n;
        assign(activeKey, n);
        renderTray();
        renderEquip();
      });
      hold.appendChild(b);
    });
  }

  function renderEquip() {
    var hold = $("tx-equip");
    if (!hold) return;
    var slots = equipped();
    hold.innerHTML = "";
    slots.forEach(function (n, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tx-spell tx-equip-slot" + (n && selectedSpell === n ? " selected" : "");
      b.title = n ? "Equipped spell #" + n : "Empty Spellforge slot";
      if (n) {
        var im = document.createElement("img");
        im.alt = "#" + n;
        im.src = spellUrl(n);
        b.appendChild(im);
        b.addEventListener("click", function () {
          selectedSpell = n;
          assign(activeKey, n);
          renderTray();
          renderEquip();
        });
      } else {
        b.textContent = "Slot " + (i + 1);
      }
      hold.appendChild(b);
    });
  }

  function start() {
    canvas = $("tx-canvas");
    if (!canvas) return;
    resize();
    syncSlots();
    renderTray();
    renderEquip();
    if (!running) {
      running = true;
      raf = requestAnimationFrame(loop);
    }
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function bind() {
    if (document.body.dataset.txBound) return;
    document.body.dataset.txBound = "1";
    window.addEventListener("keydown", function (e) {
      if (document.body.getAttribute("data-active-tab") !== "texture") return;
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      var k = e.key.toLowerCase();
      if (k === "q" || k === "w" || k === "e" || k === "r") {
        if (!e.repeat) {
          activeKey = k;
          roll(k);
        }
        e.preventDefault();
      }
    });
    window.addEventListener("resize", function () {
      if (running) resize();
    });
    window.addEventListener("texture-show", start);
    window.addEventListener("texture-hide", stop);
    window.addEventListener("spellforge-ready", function () {
      if (running) {
        renderTray();
        renderEquip();
      }
    });
    if (tex()) {
      tex().onChange(function () {
        syncSlots();
      });
    }
    ["q", "w", "e", "r"].forEach(function (k) {
      var btn = $("tx-slot-" + k);
      if (!btn) return;
      btn.addEventListener("click", function () {
        activeKey = k;
        selectedSpell = (tex() && tex().getNums()[k]) || selectedSpell;
        syncSlots();
        setStatus(layerLabel(k) + " — pick a spell or press " + k.toUpperCase());
      });
    });
    $("tx-rand-all") &&
      $("tx-rand-all").addEventListener("click", function () {
        if (tex()) tex().randomizeAll();
        setStatus("Four materials rolled from Spellforge");
      });
    $("tx-clear") &&
      $("tx-clear").addEventListener("click", function () {
        if (!tex()) return;
        tex().clear(activeKey);
        selectedSpell = 0;
        setStatus("Cleared " + layerLabel(activeKey));
        syncSlots();
      });
    $("tx-tile") &&
      $("tx-tile").addEventListener("input", function () {
        if (tex()) tex().setTile($("tx-tile").value);
        syncSlots();
      });
    $("tx-crop") &&
      $("tx-crop").addEventListener("input", function () {
        if (tex()) tex().setCrop(parseInt($("tx-crop").value, 10) / 100);
        syncSlots();
      });
    $("tx-prev") &&
      $("tx-prev").addEventListener("click", function () {
        page -= 1;
        renderTray();
      });
    $("tx-next") &&
      $("tx-next").addEventListener("click", function () {
        page += 1;
        renderTray();
      });
  }

  function bindCanvas() {
    canvas = $("tx-canvas");
    if (!canvas || canvas.dataset.bound) return;
    canvas.dataset.bound = "1";
    canvas.addEventListener("pointerdown", function (e) {
      dragging = true;
      lastPtr.x = e.clientX;
      lastPtr.y = e.clientY;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {}
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      panX += e.clientX - lastPtr.x;
      panY += e.clientY - lastPtr.y;
      lastPtr.x = e.clientX;
      lastPtr.y = e.clientY;
    });
    canvas.addEventListener("pointerup", function () {
      dragging = false;
    });
    canvas.addEventListener("pointercancel", function () {
      dragging = false;
    });
  }

  function init() {
    if (!$("panel-texture")) return;
    bind();
    bindCanvas();
    if (location.hash.replace("#", "") === "texture") start();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.TextureStudio = {
    onShow: function () {
      bindCanvas();
      start();
    },
    onHide: stop,
  };
})();
