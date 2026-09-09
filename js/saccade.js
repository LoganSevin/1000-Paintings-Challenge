/**
 * Saccade — the painting as a stranger's eyes actually take it.
 * Jumps, not pans. Foveal theft. Peripheral invention. Afterimage. False memory.
 */
(function () {
  "use strict";

  var COLLECTIONS = [
    { id: "paintings", label: "Paintings" },
    { id: "generated", label: "Generated" },
    { id: "sketches", label: "Sketches" },
    { id: "sketches-inverted", label: "Inverted" },
    { id: "phone-uploads", label: "Phone" },
    { id: "characters", label: "Characters" },
    { id: "objects", label: "Objects" },
    { id: "places", label: "Places" },
  ];

  var state = {
    collection: "paintings",
    catalogs: {},
    num: 1,
    img: null,
    blur: null,
    gist: null,
    sal: null,
    salW: 0,
    salH: 0,
    ior: null,
    seen: null,
    mode: "watch",
    gazeX: 0.5,
    gazeY: 0.5,
    toX: 0.5,
    toY: 0.5,
    jumping: false,
    jumpT: 0,
    fromX: 0.5,
    fromY: 0.5,
    nextAt: 0,
    startedAt: 0,
    fixations: [],
    raf: 0,
    view: { x: 0, y: 0, w: 0, h: 0 },
    grain: null,
    shutFrom: 0,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function setStatus(msg) {
    var el = $("sc-status");
    if (el) el.textContent = msg || "";
  }

  function catalog(coll) {
    return state.catalogs[coll] || { first: 1, last: 1, count: 0, items: [], byNum: {} };
  }

  function parseAssetItems(data, coll) {
    var items = ((data && data.items) || [])
      .map(function (it, idx) {
        var url = it.url || it.src || "";
        var n =
          it.number != null
            ? Number(it.number)
            : it.num != null
              ? Number(it.num)
              : it.version != null
                ? Number(it.version)
                : null;
        if (n == null) {
          var m = String(url).match(/(\d+)(?:\.[a-z0-9]+)?(?:\?|$)/i);
          if (m) n = Number(m[1]);
        }
        if (n == null) n = idx + 1;
        return { number: n, url: url, title: it.title || it.name || "#" + n };
      })
      .filter(function (it) {
        return it.url;
      });
    items.sort(function (a, b) {
      return a.number - b.number;
    });
    var byNum = {};
    items.forEach(function (it) {
      byNum[it.number] = it;
    });
    return {
      first: items.length ? items[0].number : 1,
      last: items.length ? items[items.length - 1].number : 1,
      count: items.length,
      items: items,
      byNum: byNum,
    };
  }

  function fetchCatalog(coll) {
    if (state.catalogs[coll] && state.catalogs[coll].count) {
      return Promise.resolve(state.catalogs[coll]);
    }
    if (coll === "paintings") {
      var items = [];
      var byNum = {};
      for (var n = 1; n <= 1000; n++) {
        var it = { number: n, url: "/paintings/" + n + ".jpg", title: "Painting #" + n };
        items.push(it);
        byNum[n] = it;
      }
      var cat = { first: 1, last: 1000, count: 1000, items: items, byNum: byNum };
      state.catalogs[coll] = cat;
      return Promise.resolve(cat);
    }
    var url = "/api/gallery-assets?collection=" + encodeURIComponent(coll) + "&limit=99999&t=" + Date.now();
    if (coll === "generated") {
      return fetch(apiUrl("/api/dream-pool?t=" + Date.now()), { cache: "default" })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          var nums = Array.isArray(data.generated_nums) ? data.generated_nums.slice() : [];
          var files = data.generated_files || {};
          nums.sort(function (a, b) {
            return a - b;
          });
          var items = nums.map(function (num) {
            return {
              number: num,
              url: "/generated/" + (files[String(num)] || num + ".jpg"),
              title: "Generated #" + num,
            };
          });
          var byNum = {};
          items.forEach(function (it) {
            byNum[it.number] = it;
          });
          var cat = {
            first: items.length ? items[0].number : 1,
            last: items.length ? items[items.length - 1].number : 1,
            count: items.length,
            items: items,
            byNum: byNum,
          };
          state.catalogs[coll] = cat;
          return cat;
        })
        .catch(function () {
          return fetch(apiUrl(url), { cache: "default" })
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              var cat = parseAssetItems(data, coll);
              state.catalogs[coll] = cat;
              return cat;
            });
        });
    }
    return fetch(apiUrl(url), { cache: "default" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var cat = parseAssetItems(data, coll);
        if (coll === "sketches" || coll === "sketches-inverted") {
          var prefix = coll === "sketches-inverted" ? "/sketches-inverted/" : "/sketches/";
          if (!cat.count) {
            var rows = (data && data.items) || [];
            cat = parseAssetItems(
              {
                items: rows.map(function (row) {
                  var num = row.num != null ? row.num : row.number;
                  return { number: num, url: row.url || prefix + num + ".png", title: "#" + num };
                }),
              },
              coll
            );
          }
        }
        state.catalogs[coll] = cat;
        return cat;
      })
      .catch(function () {
        var empty = { first: 1, last: 1, count: 0, items: [], byNum: {} };
        state.catalogs[coll] = empty;
        return empty;
      });
  }

  function currentItem() {
    var cat = catalog(state.collection);
    if (cat.byNum && cat.byNum[state.num]) return cat.byNum[state.num];
    if (cat.items && cat.items.length) return cat.items[0];
    return null;
  }

  function itemUrl(it) {
    if (!it || !it.url) return "";
    var u = String(it.url);
    if (u.charAt(0) !== "/" && u.indexOf("http") !== 0) u = "/" + u;
    if (u.indexOf("http") !== 0) u = apiUrl(u);
    return u;
  }

  function clampNum() {
    var cat = catalog(state.collection);
    var n = Number(state.num);
    if (cat.byNum && cat.byNum[n]) {
      state.num = n;
      return;
    }
    if (cat.items && cat.items.length) {
      var nearest = cat.items[0].number;
      var best = 1e9;
      cat.items.forEach(function (it) {
        var d = Math.abs(it.number - n);
        if (d < best) {
          best = d;
          nearest = it.number;
        }
      });
      state.num = nearest;
      return;
    }
    state.num = cat.first || 1;
  }

  function makeBlur(img, w, h) {
    var tiny = document.createElement("canvas");
    tiny.width = Math.max(12, Math.round(w / 14));
    tiny.height = Math.max(12, Math.round(h / 14));
    tiny.getContext("2d").drawImage(img, 0, 0, tiny.width, tiny.height);
    var out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    var ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tiny, 0, 0, w, h);
    var id = ctx.getImageData(0, 0, w, h);
    var d = id.data;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i];
      var g = d[i + 1];
      var b = d[i + 2];
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;
      d[i] = r * 0.35 + lum * 0.65;
      d[i + 1] = g * 0.35 + lum * 0.65;
      d[i + 2] = b * 0.35 + lum * 0.65;
    }
    ctx.putImageData(id, 0, 0);
    return out;
  }

  function makeGist(img, w, h) {
    var tiny = document.createElement("canvas");
    tiny.width = 18;
    tiny.height = Math.max(10, Math.round(18 * (h / w)));
    tiny.getContext("2d").drawImage(img, 0, 0, tiny.width, tiny.height);
    var out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    var ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, w, h);
    return out;
  }

  function buildSaliency(img) {
    var w = 72;
    var h = Math.max(24, Math.round(72 * (img.height / img.width)));
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    var d = ctx.getImageData(0, 0, w, h).data;
    function lum(x, y) {
      x = Math.max(0, Math.min(w - 1, x));
      y = Math.max(0, Math.min(h - 1, y));
      var i = (y * w + x) * 4;
      return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    var sal = new Float32Array(w * h);
    var max = 0.001;
    var cx = (w - 1) / 2;
    var cy = (h - 1) / 2;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var p = (i) * 4;
        var r = d[p];
        var g = d[p + 1];
        var b = d[p + 2];
        var L = 0.299 * r + 0.587 * g + 0.114 * b;
        var contrast =
          Math.abs(L - lum(x - 1, y)) +
          Math.abs(L - lum(x + 1, y)) +
          Math.abs(L - lum(x, y - 1)) +
          Math.abs(L - lum(x, y + 1));
        var sat = Math.max(r, g, b) - Math.min(r, g, b);
        var dx = (x - cx) / w;
        var dy = (y - cy) / h;
        var center = Math.exp(-6 * (dx * dx + dy * dy));
        var warm = Math.max(0, r - b);
        var v = contrast * 1.35 + sat * 0.7 + center * 90 + warm * 0.25;
        sal[i] = v;
        if (v > max) max = v;
      }
    }
    for (var k = 0; k < sal.length; k++) sal[k] /= max;
    return { sal: sal, w: w, h: h };
  }

  function makeGrain(w, h) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d");
    var id = ctx.createImageData(w, h);
    var d = id.data;
    for (var i = 0; i < d.length; i += 4) {
      var n = (Math.random() * 255) | 0;
      d[i] = n;
      d[i + 1] = n;
      d[i + 2] = n;
      d[i + 3] = 28;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("load"));
      };
      img.src = url;
    });
  }

  function prepareImage(img) {
    var max = 1400;
    var s = Math.min(1, max / Math.max(img.width, img.height));
    var w = Math.max(2, Math.round(img.width * s));
    var h = Math.max(2, Math.round(img.height * s));
    var sharp = img;
    if (s < 1) {
      sharp = document.createElement("canvas");
      sharp.width = w;
      sharp.height = h;
      sharp.getContext("2d").drawImage(img, 0, 0, w, h);
    }
    state.img = sharp;
    state.blur = makeBlur(sharp, w, h);
    state.gist = makeGist(sharp, w, h);
    var sm = buildSaliency(sharp);
    state.sal = sm.sal;
    state.salW = sm.w;
    state.salH = sm.h;
    state.ior = new Float32Array(sm.w * sm.h);
    state.seen = new Float32Array(sm.w * sm.h);
    state.fixations = [];
    state.gazeX = 0.5;
    state.gazeY = 0.52;
    state.toX = 0.5;
    state.toY = 0.52;
    state.jumping = false;
    state.nextAt = 0;
    state.startedAt = performance.now();
    state.shutFrom = 0;
    layout();
  }

  function layout() {
    var canvas = $("sc-canvas");
    var stage = canvas && canvas.parentNode;
    if (!canvas || !state.img) return;
    var cssW = Math.max(280, stage.clientWidth || 640);
    var cssH = Math.max(280, Math.min(window.innerHeight * 0.68, cssW * 0.72));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    var img = state.img;
    var pad = 18 * dpr;
    var maxW = canvas.width - pad * 2;
    var maxH = canvas.height - pad * 2;
    var sc = Math.min(maxW / img.width, maxH / img.height);
    var bw = img.width * sc;
    var bh = img.height * sc;
    state.view = {
      x: (canvas.width - bw) / 2,
      y: (canvas.height - bh) / 2,
      w: bw,
      h: bh,
      dpr: dpr,
    };
    state.grain = makeGrain(Math.round(cssW / 2), Math.round(cssH / 2));
  }

  function seenPercent() {
    if (!state.seen) return 0;
    var n = 0;
    for (var i = 0; i < state.seen.length; i++) if (state.seen[i] > 0.35) n++;
    return (100 * n) / state.seen.length;
  }

  function updateHud() {
    var fx = $("sc-stat-fix");
    var sn = $("sc-stat-seen");
    var tm = $("sc-stat-time");
    if (fx) fx.textContent = state.fixations.length + " jumps";
    if (sn) sn.textContent = seenPercent().toFixed(0) + "% in true detail";
    var t = (performance.now() - state.startedAt) / 1000;
    if (tm) tm.textContent = t.toFixed(1) + "s looking";
  }

  function markSeen(nx, ny) {
    if (!state.seen) return;
    var sw = state.salW;
    var sh = state.salH;
    var cx = nx * (sw - 1);
    var cy = ny * (sh - 1);
    var rad = Math.max(2.2, sw * 0.07);
    for (var y = Math.floor(cy - rad); y <= cy + rad; y++) {
      if (y < 0 || y >= sh) continue;
      for (var x = Math.floor(cx - rad); x <= cx + rad; x++) {
        if (x < 0 || x >= sw) continue;
        var d = Math.hypot(x - cx, y - cy) / rad;
        if (d > 1) continue;
        var i = y * sw + x;
        var add = (1 - d) * (1 - d);
        state.seen[i] = Math.min(1, state.seen[i] + add);
        state.ior[i] = Math.min(1, state.ior[i] + add * 0.85);
      }
    }
  }

  function decayIor(dt) {
    if (!state.ior) return;
    var k = Math.exp(-dt * 0.35);
    for (var i = 0; i < state.ior.length; i++) state.ior[i] *= k;
  }

  function pickTarget() {
    var sal = state.sal;
    var ior = state.ior;
    var w = state.salW;
    var h = state.salH;
    var best = -1;
    var bestI = (h * 0.5 * w + w * 0.5) | 0;
    for (var i = 0; i < sal.length; i++) {
      var v = sal[i] * (1 - ior[i] * 0.92) * (0.65 + Math.random() * 0.45);
      if (v > best) {
        best = v;
        bestI = i;
      }
    }
    return {
      x: ((bestI % w) + 0.5) / w,
      y: (Math.floor(bestI / w) + 0.5) / h,
    };
  }

  function startJump() {
    var t = pickTarget();
    state.fromX = state.gazeX;
    state.fromY = state.gazeY;
    state.toX = t.x;
    state.toY = t.y;
    state.jumping = true;
    state.jumpT = 0;
  }

  function land() {
    state.gazeX = state.toX;
    state.gazeY = state.toY;
    state.jumping = false;
    state.fixations.push({
      x: state.gazeX,
      y: state.gazeY,
      t: performance.now() - state.startedAt,
    });
    markSeen(state.gazeX, state.gazeY);
    var dwell = 160 + Math.random() * 280;
    state.nextAt = performance.now() + dwell;
  }

  function drawFovea(ctx, px, py) {
    var v = state.view;
    var r = Math.min(v.w, v.h) * 0.13;
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(state.img, v.x, v.y, v.w, v.h);
    ctx.restore();

    var g = ctx.createRadialGradient(px, py, r * 0.45, px, py, r * 1.55);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.55, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(5,4,10,0.0)");
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, r * 1.55, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = "destination-over";
    ctx.restore();

    ctx.beginPath();
    ctx.arc(px, py, r * 0.98, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 210, 74, 0.9)";
    ctx.lineWidth = Math.max(1.5, 2 * (state.view.dpr || 1));
    ctx.shadowColor = "#ffe566";
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawWatch(ctx, canvas) {
    var v = state.view;
    ctx.fillStyle = "#05040a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    var t = performance.now() - state.startedAt;
    if (t < 220) {
      ctx.globalAlpha = 0.92;
      ctx.drawImage(state.gist, v.x, v.y, v.w, v.h);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.drawImage(state.blur, v.x, v.y, v.w, v.h);
    var px = v.x + state.gazeX * v.w;
    var py = v.y + state.gazeY * v.h;
    drawFovea(ctx, px, py);
    ctx.save();
    ctx.strokeStyle = "rgba(255, 210, 74, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    state.fixations.forEach(function (f, i) {
      var x = v.x + f.x * v.w;
      var y = v.y + f.y * v.h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.restore();
    state.fixations.forEach(function (f, i) {
      var x = v.x + f.x * v.w;
      var y = v.y + f.y * v.h;
      var a = 0.15 + 0.55 * (i / Math.max(1, state.fixations.length));
      ctx.beginPath();
      ctx.arc(x, y, 3.2 * (state.view.dpr || 1), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 210, 74," + a + ")";
      ctx.fill();
    });
  }

  function complementaryFrame(ctx, canvas, age) {
    var v = state.view;
    var fade = Math.max(0, 1 - age / 5200);
    ctx.fillStyle = "#06030a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!state.img || fade <= 0.02) return;
    var tmp = complementaryCache();
    ctx.save();
    ctx.globalAlpha = fade * 0.88;
    ctx.filter = "blur(" + (2 + age / 900) + "px)";
    ctx.drawImage(tmp, v.x, v.y, v.w, v.h);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  var _compCan = null;
  var _compKey = "";
  function complementaryCache() {
    var key = state.collection + ":" + state.num + ":" + (state.img && state.img.width);
    if (_compCan && _compKey === key) return _compCan;
    var src = state.img;
    var c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    var ictx = c.getContext("2d");
    ictx.drawImage(src, 0, 0);
    var id = ictx.getImageData(0, 0, c.width, c.height);
    var d = id.data;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i] / 255;
      var g = d[i + 1] / 255;
      var b = d[i + 2] / 255;
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;
      var rg = r - g;
      var yb = 0.5 * (r + g) - b;
      rg = -rg;
      yb = -yb;
      lum = 0.22 + (1 - lum) * 0.38;
      var nr = lum + 0.55 * rg + 0.2 * yb;
      var ng = lum - 0.55 * rg + 0.2 * yb;
      var nb = lum - 0.7 * yb;
      d[i] = Math.max(0, Math.min(255, nr * 255));
      d[i + 1] = Math.max(0, Math.min(255, ng * 255));
      d[i + 2] = Math.max(0, Math.min(255, nb * 255));
    }
    ictx.putImageData(id, 0, 0);
    _compCan = c;
    _compKey = key;
    return c;
  }

  function drawMemory(ctx, canvas) {
    var v = state.view;
    ctx.fillStyle = "#08060c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.82;
    ctx.drawImage(state.gist, v.x, v.y, v.w, v.h);
    ctx.globalAlpha = 1;
    var r = Math.min(v.w, v.h) * 0.12;
    state.fixations.forEach(function (f, i) {
      var drift = 0.012 * Math.sin(i * 1.7);
      var px = v.x + (f.x + drift) * v.w;
      var py = v.y + (f.y - drift * 0.6) * v.h;
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, r * (0.85 + (i % 5) * 0.04), 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = 0.55 + 0.35 * (i / Math.max(1, state.fixations.length));
      ctx.drawImage(state.img, v.x, v.y, v.w, v.h);
      ctx.restore();
    });
    ctx.fillStyle = "rgba(5,4,10,0.28)";
    ctx.fillRect(v.x, v.y, v.w, v.h * 0.08);
    ctx.fillRect(v.x, v.y + v.h * 0.92, v.w, v.h * 0.08);
  }

  function draw() {
    var canvas = $("sc-canvas");
    if (!canvas || !state.img) return;
    var ctx = canvas.getContext("2d");
    if (state.mode === "shut") {
      complementaryFrame(ctx, canvas, performance.now() - state.shutFrom);
    } else if (state.mode === "keep") {
      drawMemory(ctx, canvas);
    } else {
      drawWatch(ctx, canvas);
    }
    if (state.grain) {
      ctx.save();
      ctx.globalAlpha = state.mode === "shut" ? 0.22 : 0.08;
      ctx.drawImage(state.grain, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }

  var lastTick = 0;
  function tick(now) {
    if (!state.img) return;
    var dt = lastTick ? Math.min(0.05, (now - lastTick) / 1000) : 0.016;
    lastTick = now;
    if (state.mode === "watch") {
      decayIor(dt);
      var t = now - state.startedAt;
      if (t > 240) {
        if (state.jumping) {
          state.jumpT += dt / 0.045;
          var k = Math.min(1, state.jumpT);
          if (k >= 1) {
            land();
          } else {
            var e = 1 - Math.pow(1 - k, 3);
            state.gazeX = state.fromX + (state.toX - state.fromX) * e;
            state.gazeY = state.fromY + (state.toY - state.fromY) * e;
          }
        } else if (now >= state.nextAt) {
          startJump();
        } else {
          markSeen(state.gazeX, state.gazeY);
        }
      }
    } else if (state.mode === "steer") {
      markSeen(state.gazeX, state.gazeY);
    }
    draw();
    updateHud();
    state.raf = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (state.raf) cancelAnimationFrame(state.raf);
    lastTick = 0;
    state.raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll(".sc-mode").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-sc-mode") === mode);
    });
    if (mode === "shut") {
      state.shutFrom = performance.now();
      setStatus("Eyes closed. Opponent color blooms from wherever the fovea actually went. It will die in a few seconds.");
    } else if (mode === "keep") {
      setStatus(
        "False memory: a color gist plus the patches that were stolen. Most of the canvas was never seen — the brain filled it."
      );
    } else if (mode === "steer") {
      setStatus("Drag on the painting. Only the gold ring is honest.");
    } else {
      setStatus("A stranger is looking. Count the jumps. Almost none of the painting is ever sharp.");
    }
  }

  function loadCurrent() {
    var it = currentItem();
    var url = itemUrl(it);
    if (!url) {
      setStatus("Nothing in this collection.");
      return;
    }
    setStatus("Loading still…");
    loadImage(url)
      .then(function (img) {
        prepareImage(img);
        setMode(state.mode === "shut" || state.mode === "keep" ? "watch" : state.mode);
        document.querySelectorAll(".sc-mode").forEach(function (b) {
          b.classList.toggle("active", b.getAttribute("data-sc-mode") === state.mode);
        });
        setStatus("First 200ms is weather. Then the eye starts jumping.");
        startLoop();
      })
      .catch(function () {
        setStatus("Could not load that still.");
      });
  }

  function stepNum(dir) {
    var cat = catalog(state.collection);
    if (cat.items && cat.items.length) {
      var idx = 0;
      for (var i = 0; i < cat.items.length; i++) {
        if (cat.items[i].number === state.num) {
          idx = i;
          break;
        }
      }
      idx = (idx + dir + cat.items.length) % cat.items.length;
      state.num = cat.items[idx].number;
    }
    var numIn = $("sc-num");
    if (numIn) numIn.value = String(state.num);
    loadCurrent();
  }

  function randomItem() {
    var cat = catalog(state.collection);
    if (cat.items && cat.items.length) {
      state.num = cat.items[Math.floor(Math.random() * cat.items.length)].number;
    }
    var numIn = $("sc-num");
    if (numIn) numIn.value = String(state.num);
    loadCurrent();
  }

  function saveMemory() {
    var canvas = $("sc-canvas");
    if (!canvas) return;
    var prev = state.mode;
    setMode("keep");
    draw();
    try {
      var a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "saccade-memory-" + state.collection + "-" + state.num + ".png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus("Kept the false memory as a PNG.");
    } catch (e) {
      setStatus("Could not save (the still may be blocked from export).");
    }
    setMode(prev === "keep" ? "keep" : prev);
  }

  function bind() {
    if (!$("panel-saccade")) return;
    var sel = $("sc-coll");
    if (sel) {
      sel.innerHTML = COLLECTIONS.map(function (c) {
        return '<option value="' + c.id + '">' + c.label + "</option>";
      }).join("");
      sel.value = "paintings";
      sel.addEventListener("change", function () {
        state.collection = sel.value;
        fetchCatalog(state.collection).then(function (cat) {
          state.num = cat.first || 1;
          var numIn = $("sc-num");
          if (numIn) {
            numIn.min = String(cat.first || 1);
            numIn.max = String(cat.last || 1);
            numIn.value = String(state.num);
          }
          loadCurrent();
        });
      });
    }
    $("sc-prev") && $("sc-prev").addEventListener("click", function () {
      stepNum(-1);
    });
    $("sc-next") && $("sc-next").addEventListener("click", function () {
      stepNum(1);
    });
    $("sc-rand") && $("sc-rand").addEventListener("click", randomItem);
    $("sc-num") &&
      $("sc-num").addEventListener("change", function () {
        state.num = parseInt($("sc-num").value, 10) || 1;
        clampNum();
        $("sc-num").value = String(state.num);
        loadCurrent();
      });
    document.querySelectorAll(".sc-mode").forEach(function (b) {
      b.addEventListener("click", function () {
        setMode(b.getAttribute("data-sc-mode"));
      });
    });
    $("sc-save") && $("sc-save").addEventListener("click", saveMemory);

    var canvas = $("sc-canvas");
    if (canvas) {
      canvas.addEventListener("pointerdown", function (ev) {
        if (state.mode !== "steer" && state.mode !== "watch") return;
        if (state.mode === "watch") setMode("steer");
        var rect = canvas.getBoundingClientRect();
        var x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
        var y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
        var v = state.view;
        state.gazeX = Math.max(0, Math.min(1, (x - v.x) / v.w));
        state.gazeY = Math.max(0, Math.min(1, (y - v.y) / v.h));
        state.fixations.push({
          x: state.gazeX,
          y: state.gazeY,
          t: performance.now() - state.startedAt,
        });
        markSeen(state.gazeX, state.gazeY);
        try {
          canvas.setPointerCapture(ev.pointerId);
        } catch (e) {}
      });
      canvas.addEventListener("pointermove", function (ev) {
        if (state.mode !== "steer") return;
        var rect = canvas.getBoundingClientRect();
        var x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
        var y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
        var v = state.view;
        state.gazeX = Math.max(0, Math.min(1, (x - v.x) / v.w));
        state.gazeY = Math.max(0, Math.min(1, (y - v.y) / v.h));
      });
    }

    window.addEventListener("resize", function () {
      if (!state.img) return;
      layout();
    });

  }

  function onShow() {
    document.body.classList.add("sc-tab-active");
    if (state.img) {
      layout();
      startLoop();
    } else {
      fetchCatalog(state.collection).then(function () {
        loadCurrent();
      });
    }
  }

  function onHide() {
    document.body.classList.remove("sc-tab-active");
    stopLoop();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "saccade") onShow();
    else onHide();
  });
  window.addEventListener("saccade-show", onShow);
  window.addEventListener("saccade-hide", onHide);

  window.Saccade = { onShow: onShow, onHide: onHide };
})();
