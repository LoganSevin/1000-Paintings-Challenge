/**
 * Shared Spellforge map textures — Q ground, W paths, E water, R walls.
 * Texture tab and MOBA both read this so QWER restyles the same arena.
 */
(function () {
  "use strict";

  var SAVE_KEY = "spell_map_textures_v1";
  var KEYS = ["q", "w", "e", "r"];
  var LABELS = { q: "Ground", w: "Paths", e: "Water", r: "Walls" };
  var MAP_W = 9600;
  var MAP_H = 9600;
  var nums = { q: 0, w: 0, e: 0, r: 0 };
  var images = {};
  var tileCache = {};
  var listeners = [];
  var tile = 160;
  var crop = 0.38;
  var loading = {};

  function loadSave() {
    try {
      var raw = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
      if (!raw || typeof raw !== "object") return;
      KEYS.forEach(function (k) {
        var n = parseInt(raw[k], 10);
        if (n > 0) nums[k] = n;
      });
      var t = parseInt(raw.tile, 10);
      if (t >= 48 && t <= 512) tile = t;
      var c = parseFloat(raw.crop);
      if (c >= 0.18 && c <= 0.95) crop = c;
    } catch (e) {}
  }

  function save() {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({ q: nums.q, w: nums.w, e: nums.e, r: nums.r, tile: tile, crop: crop })
      );
    } catch (e) {}
  }

  function notify() {
    listeners.forEach(function (fn) {
      try {
        fn({ nums: getNums(), tile: tile });
      } catch (e) {}
    });
  }

  function spellUrl(n) {
    n = parseInt(n, 10);
    if (!n) return "";
    try {
      if (typeof window.getSpellforgeSpellUrl === "function") {
        var u = String(window.getSpellforgeSpellUrl(n) || "");
        if (u) return u;
      }
    } catch (e) {}
    if (typeof window.getPaintingUrl === "function") {
      try {
        var p = window.getPaintingUrl(n);
        if (p) return p;
      } catch (e2) {}
    }
    if (n >= 1 && n <= 1000) return "paintings/" + n + ".jpg";
    if (n >= 100000 && n < 200000) return "generated/" + (n - 100000) + ".jpg";
    if (n >= 200000 && n < 300000) return "sketches/" + (n - 200000) + ".png";
    if (n >= 300000 && n < 400000) return "sketches-inverted/" + (n - 300000) + ".png";
    return "paintings/" + n + ".jpg";
  }

  function randomNum() {
    var pool = [];
    try {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.getDisplayOrder === "function") {
        pool = window.SpellforgeAPI.getDisplayOrder() || [];
      }
    } catch (e) {}
    if (!pool.length) {
      try {
        pool = JSON.parse(localStorage.getItem("spellforge_display_order_v11") || "[]");
      } catch (e2) {
        pool = [];
      }
    }
    pool = (pool || []).filter(function (n) {
      return parseInt(n, 10) > 0;
    });
    if (pool.length) return parseInt(pool[Math.floor(Math.random() * pool.length)], 10);
    return 1 + Math.floor(Math.random() * 1000);
  }

  function loadImage(n, cb) {
    n = parseInt(n, 10);
    if (!n) {
      if (cb) cb(null);
      return;
    }
    if (images[n] && images[n].complete && images[n].naturalWidth) {
      if (cb) cb(images[n]);
      return;
    }
    if (loading[n]) {
      if (cb) loading[n].push(cb);
      return;
    }
    loading[n] = cb ? [cb] : [];
    var img = new Image();
    img.decoding = "async";
    img.onload = function () {
      images[n] = img;
      var wait = loading[n] || [];
      delete loading[n];
      wait.forEach(function (fn) {
        try {
          fn(img);
        } catch (e) {}
      });
      notify();
    };
    img.onerror = function () {
      var wait = loading[n] || [];
      delete loading[n];
      wait.forEach(function (fn) {
        try {
          fn(null);
        } catch (e) {}
      });
    };
    img.src = spellUrl(n);
  }

  function clampByte(n) {
    return n < 0 ? 0 : n > 255 ? 255 : n;
  }

  function flattenLighting(ctx, size) {
    var small = document.createElement("canvas");
    small.width = 10;
    small.height = 10;
    var sm = small.getContext("2d");
    sm.imageSmoothingEnabled = true;
    sm.drawImage(ctx.canvas, 0, 0, 10, 10);
    var blur = document.createElement("canvas");
    blur.width = size;
    blur.height = size;
    var b = blur.getContext("2d");
    b.imageSmoothingEnabled = true;
    b.drawImage(small, 0, 0, size, size);
    var src = ctx.getImageData(0, 0, size, size);
    var low = b.getImageData(0, 0, size, size);
    var d = src.data;
    var l = low.data;
    var ar = 0;
    var ag = 0;
    var ab = 0;
    var i;
    var n = d.length / 4;
    for (i = 0; i < d.length; i += 4) {
      ar += d[i];
      ag += d[i + 1];
      ab += d[i + 2];
    }
    ar /= n;
    ag /= n;
    ab /= n;
    for (i = 0; i < d.length; i += 4) {
      d[i] = clampByte(d[i] - l[i] + ar);
      d[i + 1] = clampByte(d[i + 1] - l[i + 1] + ag);
      d[i + 2] = clampByte(d[i + 2] - l[i + 2] + ab);
    }
    ctx.putImageData(src, 0, 0);
  }

  function makeSeamlessTile(img, size, cropAmt) {
    size = Math.max(64, size | 0);
    cropAmt = Math.max(0.18, Math.min(0.92, cropAmt == null ? crop : cropAmt));
    var sw = img.naturalWidth;
    var sh = img.naturalHeight;
    if (!sw || !sh) return null;
    var side = Math.min(sw, sh) * cropAmt;
    var sx = (sw - side) / 2;
    var sy = (sh - side) / 2;
    var a = document.createElement("canvas");
    a.width = size;
    a.height = size;
    var ac = a.getContext("2d");
    ac.imageSmoothingEnabled = true;
    ac.imageSmoothingQuality = "high";
    ac.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    flattenLighting(ac, size);
    var b = document.createElement("canvas");
    b.width = size;
    b.height = size;
    var bc = b.getContext("2d");
    var h = size / 2;
    bc.drawImage(a, h, h);
    bc.drawImage(a, h - size, h);
    bc.drawImage(a, h, h - size);
    bc.drawImage(a, h - size, h - size);
    var overlay = document.createElement("canvas");
    overlay.width = size;
    overlay.height = size;
    var ov = overlay.getContext("2d");
    ov.drawImage(a, 0, 0);
    ov.globalCompositeOperation = "destination-in";
    var g = ov.createRadialGradient(h, h, size * 0.06, h, h, size * 0.5);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(0.55, "rgba(0,0,0,0.65)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ov.fillStyle = g;
    ov.fillRect(0, 0, size, size);
    bc.drawImage(overlay, 0, 0);
    return b;
  }

  function tileCanvasFor(img) {
    if (!img || !img.naturalWidth) return null;
    var key = img.src + ":" + tile + ":" + crop.toFixed(3);
    if (tileCache[key]) return tileCache[key];
    var c = makeSeamlessTile(img, tile, crop);
    if (c) tileCache[key] = c;
    return c;
  }

  function makePattern(ctx, img, ox, oy) {
    if (!ctx || !img || !img.complete || !img.naturalWidth) return null;
    var t = tileCanvasFor(img);
    if (!t) return null;
    var pat = ctx.createPattern(t, "repeat");
    if (pat && typeof pat.setTransform === "function") {
      try {
        pat.setTransform(new DOMMatrix().translate(-(ox || 0), -(oy || 0)));
      } catch (e) {}
    }
    return pat;
  }

  function getNums() {
    return { q: nums.q, w: nums.w, e: nums.e, r: nums.r };
  }

  function setLayer(key, num, cb) {
    key = String(key || "").toLowerCase();
    if (KEYS.indexOf(key) < 0) return;
    num = parseInt(num, 10) || 0;
    nums[key] = num;
    save();
    notify();
    if (num) loadImage(num, cb);
    else if (cb) cb(null);
  }

  function randomize(key, cb) {
    setLayer(key, randomNum(), cb);
  }

  function randomizeAll(cb) {
    var left = KEYS.length;
    KEYS.forEach(function (k) {
      randomize(k, function () {
        left -= 1;
        if (left <= 0 && cb) cb();
      });
    });
  }

  function clearLayer(key) {
    setLayer(key, 0);
  }

  function waypoints(lane) {
    if (lane === "mid") {
      return [
        [900, 8700],
        [2500, 7100],
        [4000, 5600],
        [5600, 4000],
        [7100, 2500],
        [8700, 900],
      ];
    }
    if (lane === "top") {
      return [
        [700, 8600],
        [700, 6200],
        [700, 3800],
        [700, 900],
        [3200, 700],
        [5800, 700],
        [8700, 700],
      ];
    }
    return [
      [1100, 8900],
      [3400, 8900],
      [5800, 8900],
      [8700, 8900],
      [8900, 6200],
      [8900, 3800],
      [8900, 900],
    ];
  }

  function strokePts(ctx, pts, ox, oy) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0] - ox, pts[0][1] - oy);
    var i;
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] - ox, pts[i][1] - oy);
    ctx.stroke();
  }

  function styleFor(ctx, key, fallback, ox, oy) {
    var n = nums[key];
    var img = n ? images[n] : null;
    if (n && !img) loadImage(n);
    var pat = makePattern(ctx, img, ox, oy);
    return pat || fallback;
  }

  function drawArena(ctx, ox, oy, viewW, viewH) {
    if (!ctx) return;
    ox = ox || 0;
    oy = oy || 0;
    viewW = viewW || MAP_W;
    viewH = viewH || MAP_H;
    ctx.fillStyle = styleFor(ctx, "q", "#14281c", ox, oy);
    ctx.fillRect(0, 0, viewW, viewH);
    if (!nums.q) {
      var gx;
      var gy;
      ctx.fillStyle = "#163222";
      for (gy = 0; gy < MAP_H; gy += 280) {
        for (gx = 0; gx < MAP_W; gx += 280) {
          if (((gx + gy) / 280) % 2 < 1) ctx.fillRect(gx - ox, gy - oy, 280, 280);
        }
      }
    }
    ctx.strokeStyle = styleFor(ctx, "w", "#3d6e4a", ox, oy);
    ctx.lineWidth = 160;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokePts(ctx, waypoints("top"), ox, oy);
    strokePts(ctx, waypoints("mid"), ox, oy);
    strokePts(ctx, waypoints("bot"), ox, oy);
    ctx.fillStyle = styleFor(ctx, "e", "#2a5a78", ox, oy);
    ctx.beginPath();
    ctx.moveTo(0 - ox, 6200 - oy);
    ctx.lineTo(6200 - ox, 0 - oy);
    ctx.lineTo(7200 - ox, 1000 - oy);
    ctx.lineTo(1000 - ox, 7200 - oy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = styleFor(ctx, "r", "#0f2a18", ox, oy);
    [
      [1800, 3600, 900, 700],
      [3600, 1800, 700, 900],
      [6200, 3600, 900, 700],
      [3600, 6200, 700, 900],
      [2200, 5200, 600, 500],
      [5200, 2200, 500, 600],
    ].forEach(function (b) {
      ctx.fillRect(b[0] - ox, b[1] - oy, b[2], b[3]);
    });
    ctx.fillStyle = nums.r ? styleFor(ctx, "r", "#102838", ox, oy) : "#102838";
    ctx.fillRect(80 - ox, 8000 - oy, 1500, 1520);
    ctx.fillStyle = nums.r ? styleFor(ctx, "r", "#401010", ox, oy) : "#401010";
    ctx.fillRect(8000 - ox, 80 - oy, 1520, 1500);
  }

  loadSave();
  KEYS.forEach(function (k) {
    if (nums[k]) loadImage(nums[k]);
  });

  window.SpellMapTextures = {
    KEYS: KEYS,
    LABELS: LABELS,
    MAP_W: MAP_W,
    MAP_H: MAP_H,
    spellUrl: spellUrl,
    randomNum: randomNum,
    getNums: getNums,
    getTile: function () {
      return tile;
    },
    getCrop: function () {
      return crop;
    },
    setTile: function (n) {
      n = parseInt(n, 10);
      if (!(n >= 48 && n <= 512)) return;
      tile = n;
      tileCache = {};
      save();
      notify();
    },
    setCrop: function (n) {
      n = parseFloat(n);
      if (!(n >= 0.18 && n <= 0.95)) return;
      crop = n;
      tileCache = {};
      save();
      notify();
    },
    seamlessTile: makeSeamlessTile,
    tileCanvas: tileCanvasFor,
    getImage: function (n) {
      return images[parseInt(n, 10)] || null;
    },
    loadImage: loadImage,
    setLayer: setLayer,
    randomize: randomize,
    randomizeAll: randomizeAll,
    clear: clearLayer,
    makePattern: makePattern,
    drawArena: drawArena,
    waypoints: waypoints,
    onChange: function (fn) {
      if (typeof fn === "function") listeners.push(fn);
    },
  };
})();
