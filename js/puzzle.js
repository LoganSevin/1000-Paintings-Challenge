/**
 * Puzzle — jigsaw any gallery still. Choose piece count, then play.
 */
(function () {
  "use strict";

  var STORAGE = "gallery.puzzle.v1";
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

  var PIECE_PRESETS = [
    { n: 4, cols: 2, rows: 2, label: "Easy" },
    { n: 9, cols: 3, rows: 3, label: "Easy" },
    { n: 12, cols: 4, rows: 3, label: "Easy" },
    { n: 16, cols: 4, rows: 4, label: "Casual" },
    { n: 24, cols: 6, rows: 4, label: "Casual" },
    { n: 36, cols: 6, rows: 6, label: "Medium" },
    { n: 48, cols: 8, rows: 6, label: "Medium" },
    { n: 64, cols: 8, rows: 8, label: "Hard" },
    { n: 100, cols: 10, rows: 10, label: "Hard" },
    { n: 144, cols: 12, rows: 12, label: "Expert" },
    { n: 256, cols: 16, rows: 16, label: "Expert" },
  ];

  var state = {
    collection: "paintings",
    catalogs: {},
    num: 1,
    preset: PIECE_PRESETS[3],
    playing: false,
    pieces: [],
    cols: 4,
    rows: 4,
    img: null,
    src: { w: 1, h: 1 },
    board: { x: 0, y: 0, w: 0, h: 0, cw: 0, ch: 0, tab: 0 },
    drag: null,
    hintPiece: null,
    hintUntil: 0,
    startedAt: 0,
    timer: 0,
    seed: 1,
    won: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function setStatus(msg, kind) {
    var el = $("pz-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "pz-status" + (kind ? " " + kind : "");
  }

  function loadPrefs() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE) || "null");
      if (!raw || typeof raw !== "object") return;
      if (raw.collection) state.collection = String(raw.collection);
      if (raw.n) {
        var p = PIECE_PRESETS.filter(function (x) {
          return x.n === Number(raw.n);
        })[0];
        if (p) state.preset = p;
      }
      if (raw.num) state.num = Number(raw.num) || 1;
    } catch (e) {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        STORAGE,
        JSON.stringify({
          collection: state.collection,
          n: state.preset.n,
          num: state.num,
        })
      );
    } catch (e) {}
  }

  function catalog(coll) {
    return state.catalogs[coll] || { first: 1, last: 1, count: 0, items: [], byNum: {} };
  }

  function currentItem() {
    var cat = catalog(state.collection);
    if (cat.byNum && cat.byNum[state.num]) return cat.byNum[state.num];
    if (cat.items && cat.items.length) {
      for (var i = 0; i < cat.items.length; i++) {
        if (Number(cat.items[i].number) === Number(state.num)) return cat.items[i];
      }
      return cat.items[0];
    }
    return null;
  }

  function itemUrl(it) {
    if (!it || !it.url) return "";
    var u = String(it.url);
    if (!u.startsWith("http") && !u.startsWith("blob:")) {
      if (u.charAt(0) !== "/") u = "/" + u;
      u = apiUrl(u);
    }
    return u;
  }

  function fallbackUrl(coll, n) {
    if (coll === "paintings") return apiUrl("/paintings/" + n + ".jpg");
    if (coll === "generated") return apiUrl("/generated/" + n + ".jpg");
    if (coll === "sketches") return apiUrl("/sketches/" + n + ".png");
    if (coll === "sketches-inverted") return apiUrl("/sketches-inverted/" + n + ".png");
    return "";
  }

  function parseAssetItems(data, coll) {
    var items = ((data && data.items) || [])
      .map(function (it, idx) {
        var url = it.url || it.src || "";
        var n =
          it.number != null
            ? Number(it.number)
            : it.version != null
              ? Number(it.version)
              : null;
        if (n == null && it.id != null && /^\d+$/.test(String(it.id))) n = Number(it.id);
        if (n == null) {
          var m = String(url).match(/(\d+)(?:\.[a-z0-9]+)?(?:\?|$)/i);
          if (m) n = Number(m[1]);
        }
        if (n == null) n = idx + 1;
        return {
          number: n,
          url: url,
          title: it.title || it.name || "#" + n,
        };
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
      collection: coll,
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
        var it = {
          number: n,
          url: "/paintings/" + n + ".jpg",
          title: "Painting #" + n,
        };
        items.push(it);
        byNum[n] = it;
      }
      var cat = {
        collection: coll,
        first: 1,
        last: 1000,
        count: 1000,
        items: items,
        byNum: byNum,
      };
      state.catalogs[coll] = cat;
      return Promise.resolve(cat);
    }

    var url = "/api/gallery-assets?collection=" + encodeURIComponent(coll) + "&limit=99999";
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
            var name = files[String(num)] || num + ".jpg";
            return {
              number: num,
              url: "/generated/" + name,
              title: "Generated #" + num,
            };
          });
          var byNum = {};
          items.forEach(function (it) {
            byNum[it.number] = it;
          });
          var cat = {
            collection: coll,
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
          return fetch(apiUrl(url + "&t=" + Date.now()), { cache: "default" })
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

    if (coll === "sketches" || coll === "sketches-inverted") {
      var prefix = coll === "sketches-inverted" ? "/sketches-inverted/" : "/sketches/";
      return fetch(apiUrl("/api/sketch-manifest?t=" + Date.now()), { cache: "default" })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          var rows = (data && data.items) || [];
          var items = rows
            .map(function (row) {
              var num = Number(row.num != null ? row.num : row.number);
              if (!isFinite(num)) return null;
              return {
                number: num,
                url: coll === "sketches-inverted" ? prefix + num + ".png" : row.url || prefix + num + ".png",
                title: (coll === "sketches-inverted" ? "Inverted #" : "Sketch #") + num,
              };
            })
            .filter(Boolean);
          if (!items.length) throw new Error("empty sketch manifest");
          var byNum = {};
          items.forEach(function (it) {
            byNum[it.number] = it;
          });
          var cat = {
            collection: coll,
            first: items[0].number,
            last: items[items.length - 1].number,
            count: items.length,
            items: items,
            byNum: byNum,
          };
          state.catalogs[coll] = cat;
          return cat;
        })
        .catch(function () {
          return fetch(apiUrl(url + "&t=" + Date.now()), { cache: "default" })
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

    return fetch(apiUrl(url + "&t=" + Date.now()), { cache: "default" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var cat = parseAssetItems(data, coll);
        state.catalogs[coll] = cat;
        return cat;
      })
      .catch(function () {
        var empty = { first: 1, last: 1, count: 0, items: [], byNum: {} };
        state.catalogs[coll] = empty;
        return empty;
      });
  }

  function clampNum() {
    var cat = catalog(state.collection);
    var n = Number(state.num);
    if (!isFinite(n)) n = cat.first;
    if (cat.byNum && cat.byNum[n]) {
      state.num = n;
      return;
    }
    if (cat.items && cat.items.length) {
      var nearest = cat.items[0].number;
      var best = Math.abs(cat.items[0].number - n);
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
    state.num = Math.max(cat.first, Math.min(cat.last, n));
  }

  function updateSetupUi() {
    var cat = catalog(state.collection);
    var numIn = $("pz-num");
    var range = $("pz-range");
    if (numIn) {
      numIn.min = String(cat.first || 1);
      numIn.max = String(cat.last || cat.first || 1);
      numIn.value = String(state.num);
    }
    if (range) {
      range.textContent =
        (cat.count ? cat.count + " · " : "") +
        (cat.first || 1) +
        "–" +
        (cat.last || 1);
    }
    document.querySelectorAll(".pz-coll").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-coll") === state.collection);
    });
    document.querySelectorAll(".pz-count").forEach(function (b) {
      b.classList.toggle("active", Number(b.getAttribute("data-n")) === state.preset.n);
    });
    var live = $("pz-count-live");
    if (live) {
      live.textContent =
        state.preset.n + " pieces · " + state.preset.cols + "×" + state.preset.rows + " · " + state.preset.label;
    }
    var prev = $("pz-preview");
    var it = currentItem();
    var src = it ? itemUrl(it) : fallbackUrl(state.collection, state.num);
    if (prev && src) {
      prev.src = src;
      prev.alt = it && it.title ? it.title : "#" + state.num;
    }
  }

  function renderCollectionButtons() {
    var row = $("pz-coll-row");
    if (!row) return;
    row.innerHTML = COLLECTIONS.map(function (c) {
      return (
        '<button type="button" class="pz-coll' +
        (c.id === state.collection ? " active" : "") +
        '" data-coll="' +
        c.id +
        '">' +
        c.label +
        "</button>"
      );
    }).join("");
  }

  function renderCountButtons() {
    var row = $("pz-counts");
    if (!row) return;
    row.innerHTML = PIECE_PRESETS.map(function (p) {
      return (
        '<button type="button" class="pz-count' +
        (p.n === state.preset.n ? " active" : "") +
        '" data-n="' +
        p.n +
        '" role="option" aria-selected="' +
        (p.n === state.preset.n ? "true" : "false") +
        '"><strong>' +
        p.n +
        "</strong><span>" +
        p.cols +
        "×" +
        p.rows +
        " · " +
        p.label +
        "</span></button>"
      );
    }).join("");
  }

  /**
   * Roundish bulbs on the sides only.
   * Diameter ≈ 1/4 of the short cell side.
   * Inward cuts stay outside a 0.25-radius keep-out at the piece center,
   * so two sockets never overlap or reach mid-piece.
   */
  var KNOB = {
    neck: 0.34,
    radius: 0.5,
    stem: 0.1,
    keep: 0.25,
    diameter: 0.25,
  };

  function knobExtent(ts) {
    var n = ts * KNOB.neck;
    var R = ts * KNOB.radius;
    var h = ts * KNOB.stem;
    return h + Math.sqrt(Math.max(0, R * R - n * n)) + R;
  }

  function knobDepthFactor() {
    return (
      KNOB.stem +
      Math.sqrt(Math.max(0, KNOB.radius * KNOB.radius - KNOB.neck * KNOB.neck)) +
      KNOB.radius
    );
  }

  function knobScale(cw, ch) {
    var minS = Math.min(cw, ch);
    var keepR = KNOB.keep * minS;
    var maxP = Math.min(minS * 0.5 - keepR, minS * 0.25);
    maxP = Math.max(3, maxP * 0.92);
    var k = knobDepthFactor();
    var ts = maxP / k;
    var maxR = (KNOB.diameter * minS) / 2;
    if (KNOB.radius * ts > maxR) ts = maxR / KNOB.radius;
    var R = KNOB.radius * ts;
    var cDist = ts * (k - KNOB.radius);
    var adj = Math.hypot(cw / 2 - cDist, ch / 2 - cDist);
    if (adj > 0 && adj < 2 * R + 3) {
      ts *= adj / (2 * R + 3);
    }
    var oppShort = minS;
    if (2 * knobExtent(ts) > oppShort - 2 * keepR) {
      ts *= (oppShort - 2 * keepR) / (2 * knobExtent(ts) + 1e-6);
    }
    return Math.max(5, Math.round(ts));
  }

  function ccwDelta(from, to) {
    var d = to - from;
    while (d < 0) d += Math.PI * 2;
    while (d >= Math.PI * 2) d -= Math.PI * 2;
    return d;
  }

  function tabSign(seed, c, r, axis) {
    var x = (Math.imul(c + 1, 73856093) ^ Math.imul(r + 1, 19349663) ^ Math.imul(axis + 1, 83492791) ^ seed) >>> 0;
    return x & 1 ? 1 : -1;
  }

  function makeEdges(cols, rows, seed) {
    var grid = [];
    for (var r = 0; r < rows; r++) {
      grid[r] = [];
      for (var c = 0; c < cols; c++) {
        var left = c === 0 ? 0 : -grid[r][c - 1].right;
        var top = r === 0 ? 0 : -grid[r - 1][c].bottom;
        var right = c === cols - 1 ? 0 : tabSign(seed, c, r, 0);
        var bottom = r === rows - 1 ? 0 : tabSign(seed, c, r, 1);
        grid[r][c] = { left: left, top: top, right: right, bottom: bottom };
      }
    }
    return grid;
  }

  function knobGeom(x0, y0, x1, y1, tab, nx, ny, ts) {
    var dx = x1 - x0;
    var dy = y1 - y0;
    var len = Math.hypot(dx, dy) || 1;
    var ux = dx / len;
    var uy = dy / len;
    var kx = nx * tab;
    var ky = ny * tab;
    var n = ts * KNOB.neck;
    var R = ts * KNOB.radius;
    var h = ts * KNOB.stem;
    var midX = (x0 + x1) / 2;
    var midY = (y0 + y1) / 2;
    var cDist = h + Math.sqrt(Math.max(0, R * R - n * n));
    var cx = midX + kx * cDist;
    var cy = midY + ky * cDist;
    var nLx = midX - ux * n;
    var nLy = midY - uy * n;
    var nRx = midX + ux * n;
    var nRy = midY + uy * n;
    return {
      R: R,
      cx: cx,
      cy: cy,
      nLx: nLx,
      nLy: nLy,
      nRx: nRx,
      nRy: nRy,
      bLx: nLx + kx * h,
      bLy: nLy + ky * h,
      bRx: nRx + kx * h,
      bRy: nRy + ky * h,
      farX: cx + kx * R,
      farY: cy + ky * R,
    };
  }

  function drawEdge(ctx, x0, y0, x1, y1, tab, nx, ny, ts) {
    if (!tab) {
      ctx.lineTo(x1, y1);
      return;
    }
    var g = knobGeom(x0, y0, x1, y1, tab, nx, ny, ts);
    var a0 = Math.atan2(g.bLy - g.cy, g.bLx - g.cx);
    var af = Math.atan2(g.farY - g.cy, g.farX - g.cx);
    var a1 = Math.atan2(g.bRy - g.cy, g.bRx - g.cx);
    ctx.lineTo(g.nLx, g.nLy);
    ctx.lineTo(g.bLx, g.bLy);
    ctx.arc(g.cx, g.cy, g.R, a0, af, ccwDelta(a0, af) <= Math.PI);
    ctx.arc(g.cx, g.cy, g.R, af, a1, ccwDelta(af, a1) <= Math.PI);
    ctx.lineTo(g.nRx, g.nRy);
    ctx.lineTo(x1, y1);
  }

  function punchHoles(ctx, cw, ch, e, ts) {
    var sides = [
      { tab: e.top, x0: 0, y0: 0, x1: cw, y1: 0, nx: 0, ny: -1 },
      { tab: e.right, x0: cw, y0: 0, x1: cw, y1: ch, nx: 1, ny: 0 },
      { tab: e.bottom, x0: cw, y0: ch, x1: 0, y1: ch, nx: 0, ny: 1 },
      { tab: e.left, x0: 0, y0: ch, x1: 0, y1: 0, nx: -1, ny: 0 },
    ];
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    sides.forEach(function (s) {
      if (!(s.tab < 0)) return;
      var g = knobGeom(s.x0, s.y0, s.x1, s.y1, s.tab, s.nx, s.ny, ts);
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.R + 0.75, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function piecePath(ctx, cw, ch, e, ts) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    drawEdge(ctx, 0, 0, cw, 0, e.top, 0, -1, ts);
    drawEdge(ctx, cw, 0, cw, ch, e.right, 1, 0, ts);
    drawEdge(ctx, cw, ch, 0, ch, e.bottom, 0, 1, ts);
    drawEdge(ctx, 0, ch, 0, 0, e.left, -1, 0, ts);
    ctx.closePath();
  }

  function rasterPiece(img, col, row, cols, rows, edges, maxCell) {
    var sw = img.width / cols;
    var sh = img.height / rows;
    var scale = Math.min(1, maxCell / Math.max(sw, sh));
    var cw = Math.max(12, Math.round(sw * scale));
    var ch = Math.max(12, Math.round(sh * scale));
    var ts = knobScale(cw, ch);
    var pad = Math.ceil(knobExtent(ts)) + 4;
    var can = document.createElement("canvas");
    can.width = cw + pad * 2;
    can.height = ch + pad * 2;
    var ctx = can.getContext("2d");
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.translate(pad, pad);
    piecePath(ctx, cw, ch, edges, ts);
    ctx.save();
    try {
      ctx.clip("evenodd");
    } catch (errClip) {
      ctx.clip();
    }
    ctx.drawImage(
      img,
      col * sw - sw * (pad / cw),
      row * sh - sh * (pad / ch),
      sw + sw * ((pad * 2) / cw),
      sh + sh * ((pad * 2) / ch),
      -pad,
      -pad,
      cw + pad * 2,
      ch + pad * 2
    );
    ctx.restore();
    punchHoles(ctx, cw, ch, edges, ts);
    piecePath(ctx, cw, ch, edges, ts);
    ctx.strokeStyle = "rgba(20, 12, 4, 0.72)";
    ctx.lineWidth = Math.max(1.2, Math.min(cw, ch) * 0.035);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 236, 200, 0.28)";
    ctx.lineWidth = 1;
    ctx.stroke();
    return { canvas: can, cw: cw, ch: ch, pad: pad, ts: ts, edges: edges };
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("Could not load image"));
      };
      img.src = url;
    });
  }

  function placedCount() {
    var n = 0;
    state.pieces.forEach(function (p) {
      if (p.locked) n++;
    });
    return n;
  }

  function formatTime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function updateHud() {
    var pl = $("pz-placed");
    var tot = $("pz-total");
    var tm = $("pz-time");
    var title = $("pz-title");
    if (pl) pl.textContent = String(placedCount());
    if (tot) tot.textContent = String(state.pieces.length);
    if (tm) tm.textContent = formatTime(state.playing ? Date.now() - state.startedAt : 0);
    if (title) {
      var it = currentItem();
      title.textContent = it && it.title ? it.title : "#" + state.num;
    }
  }

  function layoutBoard() {
    var canvas = $("pz-canvas");
    if (!canvas || !state.img) return;
    var wrap = $("pz-board-wrap");
    var cssW = Math.max(280, wrap ? wrap.clientWidth : canvas.clientWidth || 640);
    var cssH = Math.max(320, Math.min(window.innerHeight * 0.72, cssW * 0.78 + 80));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";

    var img = state.img;
    var margin = 18 * dpr;
    var maxW = canvas.width - margin * 2;
    var maxH = canvas.height - margin * 2;
    var aspect = img.width / img.height;
    var bw = maxW * 0.72;
    var bh = bw / aspect;
    if (bh > maxH * 0.82) {
      bh = maxH * 0.82;
      bw = bh * aspect;
    }
    state.board.w = bw;
    state.board.h = bh;
    state.board.x = (canvas.width - bw) / 2;
    state.board.y = (canvas.height - bh) / 2;
    state.board.cw = bw / state.cols;
    state.board.ch = bh / state.rows;
    state.board.tab = Math.min(state.board.cw, state.board.ch) * 0.28;
    state.dpr = dpr;
  }

  function scatterPieces() {
    var canvas = $("pz-canvas");
    if (!canvas) return;
    var bw = state.board.w;
    var bh = state.board.h;
    var bx = state.board.x;
    var by = state.board.y;
    var pad = 8;
    state.pieces.forEach(function (p, i) {
      if (p.locked) return;
      var side = i % 4;
      var jitter = function (n) {
        return (Math.random() - 0.5) * n;
      };
      if (side === 0) {
        p.x = pad + Math.random() * Math.max(20, bx - p.w - pad * 2);
        p.y = pad + Math.random() * Math.max(20, canvas.height - p.h - pad * 2);
      } else if (side === 1) {
        p.x = bx + bw + pad + Math.random() * Math.max(20, canvas.width - bx - bw - p.w - pad * 2);
        p.y = pad + Math.random() * Math.max(20, canvas.height - p.h - pad * 2);
      } else if (side === 2) {
        p.x = pad + Math.random() * Math.max(20, canvas.width - p.w - pad * 2);
        p.y = pad + Math.random() * Math.max(20, by - p.h - pad * 2);
      } else {
        p.x = pad + Math.random() * Math.max(20, canvas.width - p.w - pad * 2);
        p.y = by + bh + pad + Math.random() * Math.max(20, canvas.height - by - bh - p.h - pad * 2);
      }
      p.x = Math.max(0, Math.min(canvas.width - p.w, p.x + jitter(12)));
      p.y = Math.max(0, Math.min(canvas.height - p.h, p.y + jitter(12)));
      p.z = i;
    });
  }

  function slotPos(p) {
    return {
      x: state.board.x + p.col * state.board.cw - p.pad,
      y: state.board.y + p.row * state.board.ch - p.pad,
    };
  }

  function draw() {
    var canvas = $("pz-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var b = state.board;
    ctx.save();
    ctx.fillStyle = "rgba(8, 6, 4, 0.55)";
    ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    if (state.img) {
      ctx.globalAlpha = 0.18;
      ctx.drawImage(state.img, b.x, b.y, b.w, b.h);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = "rgba(243, 217, 164, 0.28)";
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = "rgba(243, 217, 164, 0.08)";
    ctx.lineWidth = 1;
    for (var c = 1; c < state.cols; c++) {
      ctx.beginPath();
      ctx.moveTo(b.x + c * b.cw, b.y);
      ctx.lineTo(b.x + c * b.cw, b.y + b.h);
      ctx.stroke();
    }
    for (var r = 1; r < state.rows; r++) {
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + r * b.ch);
      ctx.lineTo(b.x + b.w, b.y + r * b.ch);
      ctx.stroke();
    }
    ctx.restore();

    var now = Date.now();
    var ordered = state.pieces.slice().sort(function (a, b) {
      if (a.locked !== b.locked) return a.locked ? -1 : 1;
      return a.z - b.z;
    });
    ordered.forEach(function (p) {
      if (state.hintUntil > now && !p.locked && state.hintPiece === p) {
        var s = slotPos(p);
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.drawImage(p.canvas, s.x, s.y, p.w, p.h);
        ctx.restore();
      }
      ctx.drawImage(p.canvas, p.x, p.y, p.w, p.h);
      if (p.locked && p.edges) {
        ctx.save();
        ctx.translate(p.x + p.pad, p.y + p.pad);
        piecePath(ctx, p.cw, p.ch, p.edges, p.ts);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.strokeStyle = "#ffd24a";
        ctx.shadowColor = "#ffe566";
        ctx.shadowBlur = Math.max(4, Math.min(p.cw, p.ch) * 0.06);
        ctx.lineWidth = Math.max(2.2, Math.min(p.cw, p.ch) * 0.045);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#fff3a0";
        ctx.lineWidth = Math.max(1.1, Math.min(p.cw, p.ch) * 0.02);
        ctx.stroke();
        ctx.restore();
      }
    });

    if (state.won) {
      ctx.save();
      ctx.fillStyle = "rgba(12, 8, 4, 0.42)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffe08a";
      ctx.font = "700 " + Math.round(28 * (state.dpr || 1)) + "px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("Complete", canvas.width / 2, canvas.height / 2 - 8);
      ctx.font = "500 " + Math.round(16 * (state.dpr || 1)) + "px system-ui, sans-serif";
      ctx.fillStyle = "#efe8dc";
      ctx.fillText(
        placedCount() + " pieces · " + formatTime(Date.now() - state.startedAt),
        canvas.width / 2,
        canvas.height / 2 + 22
      );
      ctx.restore();
    }
  }

  function hitTest(x, y) {
    var list = state.pieces.slice().sort(function (a, b) {
      return b.z - a.z;
    });
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.locked) continue;
      if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) {
        var lx = Math.floor(((x - p.x) / p.w) * p.canvas.width);
        var ly = Math.floor(((y - p.y) / p.h) * p.canvas.height);
        if (lx < 0 || ly < 0 || lx >= p.canvas.width || ly >= p.canvas.height) continue;
        var pctx = p.canvas.getContext("2d");
        var pix = pctx.getImageData(lx, ly, 1, 1).data;
        if (pix[3] > 12) return p;
      }
    }
    return null;
  }

  function canvasPoint(ev) {
    var canvas = $("pz-canvas");
    var rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * canvas.width,
      y: ((ev.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function trySnap(p) {
    var s = slotPos(p);
    var dist = Math.hypot(p.x - s.x, p.y - s.y);
    var thresh = Math.min(p.cw, p.ch) * 0.32;
    if (dist <= thresh) {
      p.x = s.x;
      p.y = s.y;
      p.locked = true;
      return true;
    }
    return false;
  }

  function checkWin() {
    if (state.won) return;
    if (placedCount() >= state.pieces.length && state.pieces.length) {
      state.won = true;
      stopTimer();
      setStatus("Puzzle complete — " + state.preset.n + " pieces in " + formatTime(Date.now() - state.startedAt) + ".", "win");
    }
  }

  function startTimer() {
    stopTimer();
    state.startedAt = Date.now();
    state.timer = setInterval(function () {
      updateHud();
      if (state.hintUntil && Date.now() > state.hintUntil) {
        state.hintUntil = 0;
        state.hintPiece = null;
        draw();
      }
    }, 250);
  }

  function stopTimer() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = 0;
    }
  }

  function showPlayUi(on) {
    var setup = $("pz-setup");
    var hud = $("pz-hud");
    var wrap = $("pz-board-wrap");
    if (setup) setup.hidden = !!on;
    if (hud) hud.hidden = !on;
    if (wrap) wrap.hidden = !on;
  }

  function normalizeImage(img) {
    var max = 1400;
    if (img.width <= max && img.height <= max) return img;
    var s = max / Math.max(img.width, img.height);
    var c = document.createElement("canvas");
    c.width = Math.max(2, Math.round(img.width * s));
    c.height = Math.max(2, Math.round(img.height * s));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function finishPuzzleLayout(pieces) {
    state.pieces = pieces;
    showPlayUi(true);
    layoutBoard();
    if (!pieces.length) {
      var playEmpty = $("pz-play");
      if (playEmpty) playEmpty.disabled = false;
      return;
    }
    var scaleX = state.board.cw / pieces[0].cw;
    var scaleY = state.board.ch / pieces[0].ch;
    var sc = Math.min(scaleX, scaleY);
    pieces.forEach(function (p) {
      p.w = p.canvas.width * sc;
      p.h = p.canvas.height * sc;
      p.cw = p.cw * sc;
      p.ch = p.ch * sc;
      p.pad = p.pad * sc;
      p.ts = p.ts * sc;
    });
    scatterPieces();
    state.playing = true;
    startTimer();
    updateHud();
    draw();
    var play = $("pz-play");
    if (play) play.disabled = false;
    setStatus("Drag pieces onto the faint picture. They lock when they fit.", "ok");
  }

  function buildPuzzle(img) {
    img = normalizeImage(img);
    state.img = img;
    state.cols = state.preset.cols;
    state.rows = state.preset.rows;
    state.seed = (Math.random() * 1e9) | 0;
    state.won = false;
    state.hintPiece = null;
    var edges = makeEdges(state.cols, state.rows, state.seed);
    var maxCell = state.preset.n >= 100 ? 88 : state.preset.n >= 48 ? 120 : 180;
    var pieces = [];
    var r = 0;
    var c = 0;

    function step() {
      var budget = state.preset.n >= 64 ? 24 : 64;
      while (budget-- > 0 && r < state.rows) {
        var ras = rasterPiece(img, c, r, state.cols, state.rows, edges[r][c], maxCell);
        pieces.push({
          col: c,
          row: r,
          canvas: ras.canvas,
          w: ras.canvas.width,
          h: ras.canvas.height,
          cw: ras.cw,
          ch: ras.ch,
          pad: ras.pad,
          ts: ras.ts,
          edges: ras.edges,
          x: 0,
          y: 0,
          z: c + r * state.cols,
          locked: false,
        });
        c += 1;
        if (c >= state.cols) {
          c = 0;
          r += 1;
        }
      }
      if (r < state.rows) {
        setStatus("Slicing pieces… " + pieces.length + " / " + state.preset.n);
        requestAnimationFrame(step);
        return;
      }
      finishPuzzleLayout(pieces);
    }
    step();
  }

  function startPuzzle() {
    var play = $("pz-play");
    if (play) play.disabled = true;
    setStatus("Slicing " + state.preset.n + " pieces…");
    var it = currentItem();
    var url = it ? itemUrl(it) : fallbackUrl(state.collection, state.num);
    if (!url) {
      if (play) play.disabled = false;
      setStatus("No image in this collection.", "err");
      return;
    }
    loadImage(url)
      .then(function (img) {
        buildPuzzle(img);
      })
      .catch(function () {
        var alt = fallbackUrl(state.collection, state.num);
        if (alt && alt !== url) return loadImage(alt).then(buildPuzzle);
        throw new Error("load");
      })
      .catch(function () {
        setStatus("Could not load that still — try another number.", "err");
        if (play) play.disabled = false;
      });
  }

  function backToSetup() {
    state.playing = false;
    state.won = false;
    stopTimer();
    showPlayUi(false);
    setStatus("Pick a piece count, then Play.");
    updateSetupUi();
  }

  function randomItem() {
    var cat = catalog(state.collection);
    if (cat.items && cat.items.length) {
      var it = cat.items[Math.floor(Math.random() * cat.items.length)];
      state.num = it.number;
    } else {
      var a = cat.first || 1;
      var b = cat.last || a;
      state.num = a + Math.floor(Math.random() * (b - a + 1));
    }
    clampNum();
    savePrefs();
    updateSetupUi();
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
    } else {
      state.num += dir;
      clampNum();
    }
    savePrefs();
    updateSetupUi();
  }

  function bindCanvas() {
    var canvas = $("pz-canvas");
    if (!canvas || canvas.dataset.pzBound) return;
    canvas.dataset.pzBound = "1";

    canvas.addEventListener("pointerdown", function (ev) {
      if (!state.playing || state.won) return;
      ev.preventDefault();
      var pt = canvasPoint(ev);
      var p = hitTest(pt.x, pt.y);
      if (!p) return;
      var maxZ = 0;
      state.pieces.forEach(function (x) {
        if (x.z > maxZ) maxZ = x.z;
      });
      p.z = maxZ + 1;
      state.drag = { piece: p, dx: pt.x - p.x, dy: pt.y - p.y };
      canvas.classList.add("is-drag");
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch (e) {}
      draw();
    });

    canvas.addEventListener("pointermove", function (ev) {
      if (!state.drag) return;
      var pt = canvasPoint(ev);
      var p = state.drag.piece;
      p.x = pt.x - state.drag.dx;
      p.y = pt.y - state.drag.dy;
      p.x = Math.max(-p.w * 0.4, Math.min(canvas.width - p.w * 0.6, p.x));
      p.y = Math.max(-p.h * 0.4, Math.min(canvas.height - p.h * 0.6, p.y));
      draw();
    });

    function endDrag() {
      if (!state.drag) return;
      var p = state.drag.piece;
      if (trySnap(p)) {
        setStatus(placedCount() + " / " + state.pieces.length + " placed", "ok");
        checkWin();
      }
      state.drag = null;
      canvas.classList.remove("is-drag");
      updateHud();
      draw();
    }

    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
  }

  function selectCollection(id) {
    state.collection = id;
    setStatus("Loading " + id + "…");
    fetchCatalog(id).then(function (cat) {
      if (!cat.count) {
        setStatus("Nothing in " + id + " yet.", "err");
      } else {
        setStatus("");
      }
      clampNum();
      savePrefs();
      updateSetupUi();
    });
  }

  function bind() {
    if (!$("panel-puzzle")) return;
    loadPrefs();
    renderCollectionButtons();
    renderCountButtons();
    showPlayUi(false);

    $("pz-coll-row") &&
      $("pz-coll-row").addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest(".pz-coll") : null;
        if (!btn) return;
        selectCollection(btn.getAttribute("data-coll"));
      });

    $("pz-counts") &&
      $("pz-counts").addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest(".pz-count") : null;
        if (!btn) return;
        var n = Number(btn.getAttribute("data-n"));
        var p = PIECE_PRESETS.filter(function (x) {
          return x.n === n;
        })[0];
        if (!p) return;
        state.preset = p;
        savePrefs();
        updateSetupUi();
      });

    $("pz-num") &&
      $("pz-num").addEventListener("change", function () {
        state.num = parseInt($("pz-num").value, 10) || 1;
        clampNum();
        savePrefs();
        updateSetupUi();
      });
    $("pz-prev") && $("pz-prev").addEventListener("click", function () {
      stepNum(-1);
    });
    $("pz-next") && $("pz-next").addEventListener("click", function () {
      stepNum(1);
    });
    $("pz-random") && $("pz-random").addEventListener("click", randomItem);
    $("pz-play") && $("pz-play").addEventListener("click", startPuzzle);
    $("pz-setup-btn") && $("pz-setup-btn").addEventListener("click", backToSetup);
    $("pz-shuffle") &&
      $("pz-shuffle").addEventListener("click", function () {
        scatterPieces();
        draw();
      });
    $("pz-hint") &&
      $("pz-hint").addEventListener("click", function () {
        var loose = state.pieces.filter(function (p) {
          return !p.locked;
        });
        if (!loose.length) return;
        state.hintPiece = loose[Math.floor(Math.random() * loose.length)];
        state.hintUntil = Date.now() + 1600;
        setStatus("Ghost shows where that piece belongs.", "ok");
        draw();
      });
    $("pz-new-art") &&
      $("pz-new-art").addEventListener("click", function () {
        randomItem();
        startPuzzle();
      });

    bindCanvas();
    window.addEventListener("resize", function () {
      if (!state.playing || !state.img || !state.pieces.length) return;
      layoutBoard();
      var padRatio = state.pieces[0].cw ? state.pieces[0].pad / state.pieces[0].cw : 0.28;
      var tsRatio = state.pieces[0].cw ? (state.pieces[0].ts || 0) / state.pieces[0].cw : 0.2;
      state.pieces.forEach(function (p) {
        p.cw = state.board.cw;
        p.ch = state.board.ch;
        p.pad = p.cw * padRatio;
        p.ts = p.cw * tsRatio;
        p.w = p.cw + p.pad * 2;
        p.h = p.ch + p.pad * 2;
        if (p.locked) {
          var s = slotPos(p);
          p.x = s.x;
          p.y = s.y;
        }
      });
      draw();
    });

    fetchCatalog(state.collection).then(function () {
      clampNum();
      updateSetupUi();
    });
  }

  function onShow() {
    document.body.classList.add("pz-tab-active");
    if (!state.playing) {
      fetchCatalog(state.collection).then(function () {
        clampNum();
        updateSetupUi();
      });
    } else {
      layoutBoard();
      draw();
    }
  }

  function onHide() {
    document.body.classList.remove("pz-tab-active");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "puzzle") onShow();
    else onHide();
  });
  window.addEventListener("puzzle-show", onShow);
  window.addEventListener("puzzle-hide", onHide);

  window.Puzzle = {
    onShow: onShow,
    onHide: onHide,
  };
})();
