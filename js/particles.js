/**
 * Particle sandbox — pour / stir paint-dust sampled from a gallery still.
 */
(function () {
  "use strict";

  var MAX = 11000;
  var CELL = 10;
  var state = {
    parts: [],
    w: 800,
    h: 520,
    dpr: 1,
    tool: "pour",
    running: false,
    paused: false,
    pointer: { down: false, x: 0, y: 0, px: 0, py: 0 },
    grav: 0.28,
    size: 3,
    num: 1,
    collection: "paintings",
    genNums: [],
    genFiles: {},
    srcW: 0,
    srcH: 0,
    srcData: null,
    palette: [],
    bgImage: null,
    bgUrl: "",
    generating: false,
    readingTouched: false,
    raf: 0,
    ready: false,
    loadToken: 0,
    ink: null,
    inkCtx: null,
    strokes: [],
    liveStroke: null,
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
    var el = $("ps-status");
    if (el) el.textContent = msg || "";
  }

  function canvasPoint(ev) {
    var canvas = $("ps-canvas");
    var rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (canvas.width / Math.max(1, rect.width)),
      y: (ev.clientY - rect.top) * (canvas.height / Math.max(1, rect.height)),
    };
  }

  function layout() {
    var canvas = $("ps-canvas");
    var stage = $("ps-stage");
    if (!canvas || !stage) return;
    var cssW = Math.max(280, stage.clientWidth || 800);
    var cssH = Math.max(320, Math.min(520, Math.round(cssW * 0.62)));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    var nw = canvas.width;
    var nh = canvas.height;
    if (state.w && state.h && (state.w !== nw || state.h !== nh)) {
      var sx = nw / state.w;
      var sy = nh / state.h;
      var i;
      for (i = 0; i < state.parts.length; i++) {
        state.parts[i].x *= sx;
        state.parts[i].y *= sy;
      }
      for (i = 0; i < state.strokes.length; i++) {
        state.strokes[i].pts.forEach(function (pt) {
          pt.x *= sx;
          pt.y *= sy;
        });
      }
    }
    state.w = nw;
    state.h = nh;
    state.dpr = dpr;
    ensureInk(true);
  }

  function stillUrl(num) {
    num = num | 0;
    if (state.collection === "generated") {
      var name = (state.genFiles && state.genFiles[String(num)]) || num + ".jpg";
      return apiUrl("/generated/" + name);
    }
    return apiUrl("/paintings/" + num + ".jpg");
  }

  function clampNum(n) {
    n = n | 0;
    if (state.collection === "generated" && state.genNums && state.genNums.length) {
      var first = state.genNums[0];
      var last = state.genNums[state.genNums.length - 1];
      if (state.genFiles && state.genFiles[String(n)]) return n;
      var nearest = first;
      var best = 1e9;
      for (var i = 0; i < state.genNums.length; i++) {
        var d = Math.abs(state.genNums[i] - n);
        if (d < best) {
          best = d;
          nearest = state.genNums[i];
        }
      }
      return nearest;
    }
    return Math.max(1, Math.min(1000, n || 1));
  }

  function sampleAt(nx, ny) {
    var data = state.srcData;
    if (!data || !state.srcW) return pickColor();
    var x = Math.max(0, Math.min(state.srcW - 1, Math.floor(nx * state.srcW)));
    var y = Math.max(0, Math.min(state.srcH - 1, Math.floor(ny * state.srcH)));
    var i = (y * state.srcW + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  }

  function pickColor() {
    var pal = state.palette;
    if (!pal.length) return [200, 180, 140];
    var c = pal[(Math.random() * pal.length) | 0];
    var j = 10;
    return [
      Math.max(0, Math.min(255, c[0] + ((Math.random() - 0.5) * j) | 0)),
      Math.max(0, Math.min(255, c[1] + ((Math.random() - 0.5) * j) | 0)),
      Math.max(0, Math.min(255, c[2] + ((Math.random() - 0.5) * j) | 0)),
    ];
  }

  function emit(x, y, n, burst, opts) {
    opts = opts || {};
    n = Math.min(n, MAX - state.parts.length);
    var dpr = state.dpr || 1;
    var scatter = opts.scatter != null ? opts.scatter : burst ? 22 : 16;
    var nx = x / Math.max(1, state.w);
    var ny = y / Math.max(1, state.h);
    var lock = opts.color;
    var i;
    for (i = 0; i < n; i++) {
      var grit = Math.random();
      var r =
        grit < 0.62
          ? (0.28 + Math.random() * 1.05) * dpr
          : state.size * (0.28 + Math.random() * 0.55) * dpr;
      var ox = x + (Math.random() - 0.5) * scatter;
      var oy = y + (Math.random() - 0.5) * scatter;
      var col =
        lock ||
        (Math.random() < 0.82
          ? sampleAt(nx + (Math.random() - 0.5) * 0.04, ny + (Math.random() - 0.5) * 0.04)
          : pickColor());
      var a = Math.random() * Math.PI * 2;
      var sp = burst ? 2.2 + Math.random() * 5.5 : Math.random() * 0.9;
      state.parts.push({
        x: ox,
        y: oy,
        vx: Math.cos(a) * sp + (opts.vx || 0),
        vy: Math.sin(a) * sp - (burst ? 1.6 : 0) + (opts.vy || 0),
        r: r,
        cr: col[0],
        cg: col[1],
        cb: col[2],
      });
    }
  }

  function ensureInk(scaleFromOld) {
    var w = Math.max(1, state.w);
    var h = Math.max(1, state.h);
    if (state.ink && state.ink.width === w && state.ink.height === h) return;
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d");
    if (scaleFromOld && state.ink) {
      ctx.drawImage(state.ink, 0, 0, w, h);
    }
    state.ink = c;
    state.inkCtx = ctx;
  }

  function clearInk() {
    if (!state.inkCtx || !state.ink) return;
    state.inkCtx.clearRect(0, 0, state.ink.width, state.ink.height);
  }

  function clearStill() {
    state.bgImage = null;
    state.bgUrl = "";
    setStatus("Still template cleared — Generate will not copy the last painting.");
  }

  function clearField() {
    state.parts = [];
    state.strokes = [];
    state.liveStroke = null;
    clearInk();
    setStatus("Field cleared.");
  }

  function startDrawStroke(x, y) {
    ensureInk();
    var col = sampleAt(x / Math.max(1, state.w), y / Math.max(1, state.h));
    state.liveStroke = {
      pts: [{ x: x, y: y }],
      cr: col[0],
      cg: col[1],
      cb: col[2],
      width: Math.max(2.4, state.size * (state.dpr || 1) * 1.85),
    };
    state.strokes.push(state.liveStroke);
    if (state.strokes.length > 48) state.strokes.shift();
  }

  function stampDraw() {
    ensureInk();
    var ptr = state.pointer;
    var x = ptr.x;
    var y = ptr.y;
    var px = ptr.px;
    var py = ptr.py;
    var col = sampleAt(x / Math.max(1, state.w), y / Math.max(1, state.h));
    var ctx = state.inkCtx;
    var width = Math.max(2.4, state.size * (state.dpr || 1) * 1.85);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgb(" + col[0] + "," + col[1] + "," + col[2] + ")";
    ctx.lineWidth = width;
    ctx.beginPath();
    if (Math.hypot(x - px, y - py) < 0.8) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(x, y, width * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    var dist = Math.hypot(x - px, y - py);
    var n = Math.max(6, Math.min(36, 4 + ((dist / 1.6) | 0)));
    emit(x, y, n, false, {
      color: col,
      scatter: 3.5 + state.size * 0.8,
      vx: (x - px) * 0.12,
      vy: (y - py) * 0.12,
    });
    if (state.liveStroke) {
      state.liveStroke.cr = col[0];
      state.liveStroke.cg = col[1];
      state.liveStroke.cb = col[2];
      state.liveStroke.width = width;
      var last = state.liveStroke.pts[state.liveStroke.pts.length - 1];
      if (!last || Math.hypot(x - last.x, y - last.y) > 2.2) {
        state.liveStroke.pts.push({ x: x, y: y });
      }
    }
  }

  function eraseInk(x, y, rad) {
    if (state.inkCtx) {
      var ctx = state.inkCtx;
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    var rad2 = rad * rad;
    var i;
    for (i = 0; i < state.strokes.length; i++) {
      state.strokes[i].pts = state.strokes[i].pts.filter(function (pt) {
        var dx = pt.x - x;
        var dy = pt.y - y;
        return dx * dx + dy * dy > rad2;
      });
    }
    state.strokes = state.strokes.filter(function (st) {
      return st.pts.length >= 2;
    });
  }

  function renderSwatches() {
    var el = $("ps-swatches");
    if (!el) return;
    el.innerHTML = state.palette
      .slice(0, 16)
      .map(function (c) {
        return (
          '<span style="background:rgb(' + c[0] + "," + c[1] + "," + c[2] + ')"></span>'
        );
      })
      .join("");
  }

  function ingestStill(img, token) {
    if (token !== state.loadToken) return;
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    var max = 200;
    var s = Math.min(1, max / Math.max(iw, ih));
    var cw = Math.max(8, Math.round(iw * s));
    var ch = Math.max(8, Math.round(ih * s));
    var c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    var ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, cw, ch);
    var id;
    try {
      id = ctx.getImageData(0, 0, cw, ch);
    } catch (e) {
      setStatus("Could not read pixels from #" + state.num);
      return;
    }
    state.srcW = cw;
    state.srcH = ch;
    state.srcData = id.data;
    var d = id.data;
    var pix = cw * ch;
    var buckets = {};
    var i;
    for (i = 0; i < pix; i++) {
      var p = i * 4;
      var r = d[p];
      var g = d[p + 1];
      var b = d[p + 2];
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 12 || lum > 252) continue;
      var key = (r >> 5) + "-" + (g >> 5) + "-" + (b >> 5);
      var bkt = buckets[key];
      if (!bkt) {
        bkt = { r: 0, g: 0, b: 0, n: 0 };
        buckets[key] = bkt;
      }
      bkt.r += r;
      bkt.g += g;
      bkt.b += b;
      bkt.n++;
    }
    var list = [];
    for (var k in buckets) {
      if (Object.prototype.hasOwnProperty.call(buckets, k)) list.push(buckets[k]);
    }
    list.sort(function (a, b) {
      return b.n - a.n;
    });
    var pal = list.slice(0, 20).map(function (bkt) {
      return [(bkt.r / bkt.n) | 0, (bkt.g / bkt.n) | 0, (bkt.b / bkt.n) | 0];
    });
    if (!pal.length) pal = [[200, 180, 140]];
    state.palette = pal;
    renderSwatches();
    var kind = state.collection === "generated" ? "Generated" : "Painting";
    setStatus(kind + " #" + state.num + " · " + pal.length + " pigments ready");
  }

  function blobToBitmap(blob) {
    if (typeof createImageBitmap === "function") return createImageBitmap(blob);
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        resolve(im);
      };
      im.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("image"));
      };
      im.src = url;
    });
  }

  function fetchStill(url, token) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      if (token !== state.loadToken) return null;
      return r.blob();
    });
  }

  function loadPalette(num) {
    state.num = clampNum(num);
    var token = ++state.loadToken;
    var url = stillUrl(state.num);
    var thumb = $("ps-thumb");
    if (thumb) thumb.src = url;
    var numIn = $("ps-num");
    if (numIn) numIn.value = String(state.num);
    setStatus("Sampling " + state.collection + " #" + state.num + "…");
    fetchStill(url, token)
      .then(function (blob) {
        if (!blob || token !== state.loadToken) return null;
        return blobToBitmap(blob);
      })
      .then(function (bmp) {
        if (!bmp || token !== state.loadToken) return;
        ingestStill(bmp, token);
        if (bmp.close) {
          try {
            bmp.close();
          } catch (e) {}
        }
      })
      .catch(function () {
        if (token !== state.loadToken) return;
        if (state.collection !== "generated") {
          setStatus("Could not load " + state.collection + " #" + state.num);
          return;
        }
        fetchStill(apiUrl("/generated/" + state.num + ".png"), token)
          .then(function (blob) {
            if (!blob) return null;
            return blobToBitmap(blob);
          })
          .then(function (bmp) {
            if (!bmp || token !== state.loadToken) return;
            ingestStill(bmp, token);
          })
          .catch(function () {
            setStatus("Could not load Generated #" + state.num);
          });
      });
  }

  function loadGenCatalog() {
    return fetch(apiUrl("/api/dream-pool?t=" + Date.now()), { cache: "default" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var nums = Array.isArray(data.generated_nums) ? data.generated_nums.slice() : [];
        nums.sort(function (a, b) {
          return a - b;
        });
        state.genNums = nums;
        state.genFiles = data.generated_files || {};
        var numIn = $("ps-num");
        if (numIn && nums.length) {
          numIn.min = String(nums[0]);
          numIn.max = String(nums[nums.length - 1]);
        }
        return nums;
      })
      .catch(function () {
        state.genNums = [];
        state.genFiles = {};
        return [];
      });
  }

  function step() {
    var parts = state.parts;
    var w = state.w;
    var h = state.h;
    var g = state.grav * (state.dpr || 1) * 0.04;
    var ptr = state.pointer;
    var tool = state.tool;
    var i;
    var p;

    if (ptr.down && tool === "erase") {
      var rad = 44 * (state.dpr || 1);
      var rad2 = rad * rad;
      var write = 0;
      for (i = 0; i < parts.length; i++) {
        p = parts[i];
        var ex = p.x - ptr.x;
        var ey = p.y - ptr.y;
        if (ex * ex + ey * ey > rad2) parts[write++] = p;
      }
      parts.length = write;
      eraseInk(ptr.x, ptr.y, rad);
    }

    if (ptr.down && tool === "pour") {
      emit(ptr.x, ptr.y, 42);
    }
    if (ptr.down && tool === "draw") {
      stampDraw();
    }

    var cols = Math.max(1, Math.ceil(w / CELL));
    var rows = Math.max(1, Math.ceil(h / CELL));
    var grid = new Array(cols * rows);
    for (i = 0; i < grid.length; i++) grid[i] = [];

    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (ptr.down && tool !== "pour" && tool !== "erase" && tool !== "draw") {
        var dx = p.x - ptr.x;
        var dy = p.y - ptr.y;
        var dist = Math.hypot(dx, dy) + 0.001;
        var fall = Math.exp(-dist / (90 * state.dpr));
        if (tool === "attract") {
          p.vx -= (dx / dist) * 0.55 * fall;
          p.vy -= (dy / dist) * 0.55 * fall;
        } else if (tool === "repel") {
          p.vx += (dx / dist) * 0.7 * fall;
          p.vy += (dy / dist) * 0.7 * fall;
        } else if (tool === "stir") {
          var fx = ptr.x - ptr.px;
          var fy = ptr.y - ptr.py;
          p.vx += fx * 0.08 * fall;
          p.vy += fy * 0.08 * fall;
        }
      }
      p.vy += g;
      p.vx *= 0.988;
      p.vy *= 0.988;
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < p.r) {
        p.x = p.r;
        p.vx *= -0.22;
      }
      if (p.x > w - p.r) {
        p.x = w - p.r;
        p.vx *= -0.22;
      }
      if (p.y > h - p.r) {
        p.y = h - p.r;
        p.vy *= -0.08;
        p.vx *= 0.72;
      }
      if (p.y < p.r) {
        p.y = p.r;
        p.vy *= -0.22;
      }
      var cx = Math.min(cols - 1, Math.max(0, (p.x / CELL) | 0));
      var cy = Math.min(rows - 1, Math.max(0, (p.y / CELL) | 0));
      grid[cy * cols + cx].push(i);
    }

    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (p.r < 1.2) continue;
      var gx = Math.min(cols - 1, Math.max(0, (p.x / CELL) | 0));
      var gy = Math.min(rows - 1, Math.max(0, (p.y / CELL) | 0));
      for (var oy = -1; oy <= 1; oy++) {
        var yy = gy + oy;
        if (yy < 0 || yy >= rows) continue;
        for (var ox = -1; ox <= 1; ox++) {
          var xx = gx + ox;
          if (xx < 0 || xx >= cols) continue;
          var bucket = grid[yy * cols + xx];
          for (var k = 0; k < bucket.length; k++) {
            var j = bucket[k];
            if (j <= i) continue;
            var q = parts[j];
            if (q.r < 1.2) continue;
            var ddx = q.x - p.x;
            var ddy = q.y - p.y;
            var d2 = ddx * ddx + ddy * ddy;
            var min = (p.r + q.r) * 0.4;
            if (d2 > 0 && d2 < min * min) {
              var d = Math.sqrt(d2);
              var push = ((min - d) / d) * 0.28;
              var px = ddx * push;
              var py = ddy * push;
              p.x -= px;
              p.y -= py;
              q.x += px;
              q.y += py;
              p.vx -= px * 0.1;
              p.vy -= py * 0.1;
              q.vx += px * 0.1;
              q.vy += py * 0.1;
            }
          }
        }
      }
    }

    ptr.px = ptr.x;
    ptr.py = ptr.y;
  }

  function draw() {
    var canvas = $("ps-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    if (state.bgImage) {
      ctx.globalAlpha = 1;
      ctx.drawImage(state.bgImage, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(8, 9, 14, 0.22)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "rgba(8, 9, 14, 0.5)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (state.ink) {
      ctx.globalAlpha = 0.94;
      ctx.drawImage(state.ink, 0, 0);
    }
    var parts = state.parts;
    ctx.globalAlpha = 0.92;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var s = Math.max(0.8, p.r * 1.85);
      ctx.fillStyle = "rgb(" + p.cr + "," + p.cg + "," + p.cb + ")";
      ctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
    }
    ctx.globalAlpha = 1;
  }

  function tick() {
    if (!state.running) return;
    if (!state.paused) step();
    draw();
    var el = $("ps-status");
    if (el && state.pointer.down && !state.generating) {
      el.textContent =
        state.parts.length + " grains · " + state.tool + " · painting #" + state.num;
    }
    state.raf = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (state.running) return;
    state.running = true;
    state.raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    state.running = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  function setTool(name) {
    state.tool = name;
    document.querySelectorAll(".ps-tool").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-ps-tool") === name);
    });
    var tips = {
      pour: "Pour grit — hold to dump pigment from the still",
      draw: "Draw — stroke objects; grit follows the line",
      stir: "Stir the pile",
      attract: "Pull grit in",
      repel: "Push grit out",
      erase: "Erase grit and drawings",
    };
    setStatus(tips[name] || "Tool: " + name);
  }

  function delayMs(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function extractImageUrl(payload) {
    if (!payload) return "";
    var img = payload.image || (payload.images && payload.images[0]) || {};
    var raw =
      (img && (img.url || img.download_url)) ||
      payload.url ||
      payload.image_url ||
      payload.output_url ||
      "";
    if (!raw && payload.result && payload.result.url) raw = payload.result.url;
    return raw;
  }

  function pollImageJob(jobId, left) {
    if (left == null) left = 90;
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for image."));
    return fetch(apiUrl("/api/jobs/" + jobId), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (job) {
        var st = String((job && job.status) || "working").toLowerCase();
        setStatus("Generating background… " + st);
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractImageUrl(job);
          if (url) return url;
          throw new Error("Job finished but no image URL.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((job.error && (job.error.message || job.error)) || "Image job failed");
        }
        return delayMs(1500).then(function () {
          return pollImageJob(jobId, left - 1);
        });
      });
  }

  function rgbHex(c) {
    return (
      "#" +
      [c[0], c[1], c[2]]
        .map(function (n) {
          var h = Number(n).toString(16);
          return h.length < 2 ? "0" + h : h;
        })
        .join("")
    );
  }

  function fieldSummary() {
    var n = state.parts.length;
    var w = Math.max(1, state.w);
    var h = Math.max(1, state.h);
    var names = [
      "upper-left",
      "upper-center",
      "upper-right",
      "middle-left",
      "center",
      "middle-right",
      "lower-left",
      "lower-center",
      "lower-right",
    ];
    var cells = [];
    var i;
    for (i = 0; i < 9; i++) cells.push({ r: 0, g: 0, b: 0, n: 0 });
    var top = {};
    var piled = 0;
    for (i = 0; i < n; i++) {
      var p = state.parts[i];
      var gx = Math.min(2, Math.max(0, Math.floor((p.x / w) * 3)));
      var gy = Math.min(2, Math.max(0, Math.floor((p.y / h) * 3)));
      var cell = cells[gy * 3 + gx];
      cell.r += p.cr;
      cell.g += p.cg;
      cell.b += p.cb;
      cell.n++;
      var key = (p.cr >> 4) + "," + (p.cg >> 4) + "," + (p.cb >> 4);
      top[key] = (top[key] || 0) + 1;
      if (p.y > h * 0.62) piled++;
    }
    var regions = [];
    for (i = 0; i < 9; i++) {
      var c = cells[i];
      if (!c.n) {
        regions.push({
          name: names[i],
          dens: "empty",
          hex: "",
          empty: true,
          n: 0,
        });
        continue;
      }
      var rr = (c.r / c.n) | 0;
      var gg = (c.g / c.n) | 0;
      var bb = (c.b / c.n) | 0;
      var hex = rgbHex([rr, gg, bb]);
      var dens = c.n > n * 0.18 ? "dense" : c.n > n * 0.07 ? "moderate" : "sparse";
      regions.push({
        name: names[i],
        dens: dens,
        hex: hex,
        r: rr,
        g: gg,
        b: bb,
        empty: false,
        n: c.n,
      });
    }
    var ranked = Object.keys(top).sort(function (a, b) {
      return top[b] - top[a];
    });
    var liveHex = ranked.slice(0, 6).map(function (k) {
      var parts = k.split(",");
      return rgbHex([
        (parseInt(parts[0], 10) || 0) << 4,
        (parseInt(parts[1], 10) || 0) << 4,
        (parseInt(parts[2], 10) || 0) << 4,
      ]);
    });
    var palHex = (state.palette || []).slice(0, 6).map(rgbHex);
    return {
      count: n,
      hexes: liveHex.length ? liveHex : palHex,
      palHex: palHex,
      piled: n ? Math.round((100 * piled) / n) : 0,
      clusters: ranked.length,
      regions: regions,
    };
  }

  function existHints(r, g, b, dens) {
    var lum = 0.299 * r + 0.587 * g + 0.114 * b;
    var mx = Math.max(r, g, b);
    var mn = Math.min(r, g, b);
    var sat = mx - mn;
    var h = 0;
    if (sat > 8) {
      var rr = r / 255;
      var gg = g / 255;
      var bb = b / 255;
      var d = sat / 255;
      if (mx === r) h = ((gg - bb) / d) % 6;
      else if (mx === g) h = (bb - rr) / d + 2;
      else h = (rr - gg) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    var ideas = [];
    if (lum < 42) ideas.push("a dark body, deep water, iron, a cloak, a cave-mouth");
    else if (lum > 200) ideas.push("bone, lamp-glow, salt-cloth, a pale figure");
    if (sat < 18) ideas.push("stone, ash, plaster, fog-wall");
    if (h < 28 || h >= 345) ideas.push("flesh, brick, ember, rust, a wound-line");
    else if (h < 55) ideas.push("ochre ground, brass, wheat, a clay figure");
    else if (h < 85) ideas.push("foliage, a bronze-green figure, weeded water");
    else if (h < 160) ideas.push("a river, glass, verdigris architecture");
    else if (h < 260) ideas.push("dusk cloth, a procession, distant architecture");
    else ideas.push("wine-drape, orchid, ritual smoke");
    if (dens === "dense") ideas.push("a solid object should FILL this stroke");
    if (dens === "sparse") ideas.push("a thin object, vine, crack, or weather along this line");
    return ideas.slice(0, 3).join("; ");
  }

  function regionNameAt(nx, ny) {
    var gx = Math.min(2, Math.max(0, Math.floor(nx * 3)));
    var gy = Math.min(2, Math.max(0, Math.floor(ny * 3)));
    return [
      "upper-left",
      "upper-center",
      "upper-right",
      "middle-left",
      "center",
      "middle-right",
      "lower-left",
      "lower-center",
      "lower-right",
    ][gy * 3 + gx];
  }

  function writingFromField(s) {
    var w = Math.max(1, state.w);
    var h = Math.max(1, state.h);
    var lines = [];
    var drawn = state.strokes.filter(function (st) {
      return st.pts && st.pts.length >= 2;
    });
    if (drawn.length) {
      drawn.slice(0, 8).forEach(function (st, idx) {
        var p0 = st.pts[0];
        var p1 = st.pts[st.pts.length - 1];
        var dx = p1.x - p0.x;
        var dy = p1.y - p0.y;
        var dir;
        if (Math.abs(dy) > Math.abs(dx) * 1.15) dir = dy > 0 ? "falls" : "rises";
        else if (Math.abs(dx) > Math.abs(dy) * 1.15)
          dir = dx > 0 ? "travels right" : "travels left";
        else dir = "curves";
        var dens = st.pts.length > 40 ? "dense" : "moderate";
        lines.push(
          "Drawn stroke " +
            (idx + 1) +
            " " +
            rgbHex([st.cr, st.cg, st.cb]) +
            " " +
            dir +
            " " +
            regionNameAt(p0.x / w, p0.y / h) +
            " → " +
            regionNameAt(p1.x / w, p1.y / h) +
            " — invent a thing that occupies THIS stroke: " +
            existHints(st.cr, st.cg, st.cb, dens)
        );
      });
    } else if (s.count) {
      lines.push(
        "No drawn strokes — packed grit is the body of matter. Invent objects that occupy the dense pigment regions, not zigzags or stamps."
      );
    } else {
      lines.push("Empty field — draw or pour grit first.");
    }
    s.regions.forEach(function (reg) {
      if (reg.empty) {
        lines.push(
          reg.name +
            ": empty — " +
            (state.bgUrl ? "keep previous painting or air." : "air / distance.")
        );
      } else {
        lines.push(
          reg.name +
            ": packed " +
            reg.dens +
            " " +
            reg.hex +
            " grit — " +
            existHints(reg.r, reg.g, reg.b, reg.dens)
        );
      }
    });
    return lines.join("\n");
  }

  function refreshReading(force) {
    var el = $("ps-reading");
    if (!el) return;
    if (!force && state.readingTouched && el.value.trim()) return;
    el.value = writingFromField(fieldSummary());
  }

  function paintOccupancy(ctx, w, h) {
    var sx = w / Math.max(1, state.w);
    var sy = h / Math.max(1, state.h);
    if (state.ink) {
      ctx.globalAlpha = 0.9;
      ctx.drawImage(state.ink, 0, 0, w, h);
    }
    var parts = state.parts;
    ctx.globalAlpha = 0.62;
    var i;
    for (i = 0; i < parts.length; i++) {
      var p = parts[i];
      var rw = Math.max(1.1, p.r * sx * 1.7);
      ctx.fillStyle = "rgb(" + p.cr + "," + p.cg + "," + p.cb + ")";
      ctx.fillRect(p.x * sx - rw * 0.5, p.y * sy - rw * 0.5, rw, rw);
    }
    ctx.globalAlpha = 0.96;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (i = 0; i < state.strokes.length; i++) {
      var st = state.strokes[i];
      if (!st.pts || st.pts.length < 2) continue;
      ctx.strokeStyle = "rgb(" + st.cr + "," + st.cg + "," + st.cb + ")";
      ctx.lineWidth = Math.max(7, st.width * sx * 1.35);
      ctx.beginPath();
      ctx.moveTo(st.pts[0].x * sx, st.pts[0].y * sy);
      var j;
      for (j = 1; j < st.pts.length; j++) ctx.lineTo(st.pts[j].x * sx, st.pts[j].y * sy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function plateToJpeg(canvas) {
    try {
      return canvas.toDataURL("image/jpeg", 0.78);
    } catch (err) {
      return "";
    }
  }

  function snapshotComposePlate() {
    var w = 896;
    var h = 504;
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d");
    function overlay() {
      paintOccupancy(ctx, w, h);
      return plateToJpeg(c);
    }
    var prev = state.bgUrl && String(state.bgUrl).charAt(0) === "/" ? state.bgUrl : "";
    if (!prev) {
      ctx.fillStyle = "#0a0b10";
      ctx.fillRect(0, 0, w, h);
      return Promise.resolve(overlay());
    }
    return fetch(apiUrl(prev), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("bg");
        return r.blob();
      })
      .then(function (blob) {
        return blobToBitmap(blob);
      })
      .then(function (bmp) {
        ctx.drawImage(bmp, 0, 0, w, h);
        if (bmp.close) {
          try {
            bmp.close();
          } catch (e) {}
        }
        return overlay();
      })
      .catch(function () {
        ctx.fillStyle = "#0a0b10";
        ctx.fillRect(0, 0, w, h);
        return overlay();
      });
  }

  function buildPrompt() {
    var user = ($("ps-prompt") && $("ps-prompt").value.trim()) || "";
    var material = ($("ps-material") && $("ps-material").value.trim()) || "";
    var reading = ($("ps-reading") && $("ps-reading").value.trim()) || "";
    var s = fieldSummary();
    var src =
      (state.collection === "generated" ? "generated still G#" : "painting #") + state.num;
    var over = state.bgUrl
      ? "LAYER: paint a NEW finished picture on the previous still. Drawn strokes are objects to invent. Packed grit is the body of matter. Empty space stays previous painting or air."
      : "Compose a NEW finished picture from the drawn strokes and packed grit. No previous still — do not copy an old painting.";
    var scene =
      user ||
      "Invent a cohesive scene. Drawn strokes become figures, rivers, ropes, architecture, cloth, or land. Packed grit is the substance of those things.";
    var mat =
      material ||
      "Directly alter materials as the scene needs: oil, metal, water, cloth, plaster, smoke — plus spell-thread gold as surface detailing only.";
    return (
      "USER SCENE (obey first, this is the picture):\n" +
      scene +
      "\n\nMATERIAL (change the physical stuff of the painting to this):\n" +
      mat +
      "\n\n" +
      over +
      "\n\nOCCUPANCY: Drawn strokes (smooth ribbons) are intentional object-paths — invent a real thing that sits IN each stroke and follows it. " +
      "Packed grit is pigment-mass, the BODY of those objects, not decoration. " +
      "FORBIDDEN: zigzag stamps, chevron tiles, repeating material stickers, particle dots, sparkles, confetti, simulation overlay. " +
      "Do not copy grit as grit. Replace strokes and masses with finished painted objects.\n\n" +
      "FIELD READING:\n" +
      (reading || writingFromField(s)) +
      "\n\nPalette in play: " +
      (s.hexes.join(", ") || "earth pigment") +
      ". " +
      s.count +
      " grit grains; " +
      state.strokes.length +
      " drawn strokes; " +
      s.piled +
      "% settled low. Spellwork as buried texture (filaments, sigil-knots, no readable letters). " +
      "Logan Sevin DNA from " +
      src +
      ". No watermark, no typography."
    );
  }

  function hangPainting(url) {
    if (!url) return Promise.resolve(false);
    var path = String(url);
    var full = path.charAt(0) === "/" ? apiUrl(path) : path;
    return fetch(full, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("hang http");
        return r.blob();
      })
      .then(function (blob) {
        return blobToBitmap(blob);
      })
      .then(function (bmp) {
        state.bgImage = bmp;
        state.bgUrl = path.charAt(0) === "/" ? path.split("?")[0] : path;
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function unlockGenerate(btn, msg) {
    state.generating = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Generate background";
    }
    if (msg) setStatus(msg);
  }

  function generateBackground() {
    if (state.generating) {
      setStatus("Already generating — wait for this piece to hang, then click again.");
      return;
    }
    try {
      refreshReading(false);
    } catch (eRead) {}
    var prompt = buildPrompt();
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "particles-" + Date.now();
    var btn = $("ps-generate");
    state.generating = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Generating…";
    }
    var unlockTimer = setTimeout(function () {
      if (state.generating) unlockGenerate(btn, "Generate timed out — click to try again.");
    }, 180000);
    setStatus(
      state.bgUrl
        ? "Inventing objects along the grain paths, over the last piece…"
        : "Inventing objects that occupy the grain paths…"
    );
    snapshotComposePlate()
      .catch(function () {
        return "";
      })
      .then(function (snap) {
        prompt += "\n\nPass " + Date.now() + " (new painting, not a repeat).";
        var spells = [];
        if (state.collection === "paintings" && state.num >= 1 && state.num <= 1000) {
          spells = [state.num];
        }
        return fetch(apiUrl("/api/generate-stasis-vision"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_id: jobId,
            stasis: prompt,
            prompt: prompt,
            buzz_words: [
              "objects occupying drawn strokes",
              "packed pigment as matter",
              "no zigzag stamps",
              "finished painted objects",
              "spell-thread gold",
              "new painting this pass",
            ],
            spells: spells,
            aspect_ratio: "16:9",
            mag_fresh: true,
            spell_cast: !!snap,
            fresh_variation: true,
            reference_image: snap || undefined,
            source: "particles",
          }),
          cache: "no-store",
        });
      })
      .then(function (r) {
        return r.text().then(function (raw) {
          var d = {};
          try {
            d = raw ? JSON.parse(raw) : {};
          } catch (e) {
            throw new Error(raw ? String(raw).slice(0, 180) : "Generate returned empty");
          }
          return { r: r, d: d };
        });
      })
      .then(function (pack) {
        var d = pack.d || {};
        if (!pack.r.ok && pack.r.status !== 202) {
          throw new Error(d.error || "Generate failed (" + pack.r.status + ")");
        }
        var url = extractImageUrl(d);
        if (url) return url;
        var jid = d.job_id || (pack.r.status === 202 ? jobId : "");
        if (jid) return pollImageJob(jid);
        throw new Error(d.error || "No image returned");
      })
      .then(function (url) {
        var full = url.charAt(0) === "/" ? apiUrl(url) : url;
        setStatus("Hanging the new piece…");
        return fetch(apiUrl("/api/save-generated-image"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_url: full,
            source: "particles",
            collection: "generated",
            description: (($("ps-prompt") && $("ps-prompt").value) || "Particle field").slice(0, 160),
            meta: { source: "particles", prompt: prompt.slice(0, 500), from: state.collection + "/" + state.num },
          }),
        })
          .then(function (r) {
            return r.json().catch(function () {
              return {};
            });
          })
          .then(function (saved) {
            var local = (saved && saved.url) || url;
            return hangPainting(local).then(function () {
              return saved && saved.num != null ? saved : { url: local, num: saved && saved.num };
            });
          });
      })
      .then(function (saved) {
        var n = saved && saved.num != null ? "Generated #" + saved.num : "Generated";
        setStatus("New piece hung · " + n + " · generate again to paint over it");
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Generate failed");
      })
      .then(function () {
        clearTimeout(unlockTimer);
        unlockGenerate(btn);
      });
  }

  function bind() {
    if (!$("panel-particles")) return;
    document.querySelectorAll(".ps-tool").forEach(function (b) {
      b.addEventListener("click", function () {
        setTool(b.getAttribute("data-ps-tool"));
      });
    });
    $("ps-coll") &&
      $("ps-coll").addEventListener("change", function () {
        state.collection = $("ps-coll").value || "paintings";
        if (state.collection === "generated") {
          loadGenCatalog().then(function (nums) {
            loadPalette(nums.length ? nums[nums.length - 1] : 1);
          });
        } else {
          var numIn = $("ps-num");
          if (numIn) {
            numIn.min = "1";
            numIn.max = "1000";
          }
          loadPalette(state.num);
        }
      });
    $("ps-prev") &&
      $("ps-prev").addEventListener("click", function () {
        if (state.collection === "generated" && state.genNums.length) {
          var i = state.genNums.indexOf(state.num);
          if (i < 0) i = state.genNums.length - 1;
          loadPalette(state.genNums[(i - 1 + state.genNums.length) % state.genNums.length]);
        } else loadPalette(state.num - 1);
      });
    $("ps-next") &&
      $("ps-next").addEventListener("click", function () {
        if (state.collection === "generated" && state.genNums.length) {
          var j = state.genNums.indexOf(state.num);
          if (j < 0) j = -1;
          loadPalette(state.genNums[(j + 1) % state.genNums.length]);
        } else loadPalette(state.num + 1);
      });
    $("ps-rand") &&
      $("ps-rand").addEventListener("click", function () {
        if (state.collection === "generated" && state.genNums.length) {
          loadPalette(state.genNums[(Math.random() * state.genNums.length) | 0]);
        } else loadPalette(1 + ((Math.random() * 1000) | 0));
      });
    $("ps-generate") && $("ps-generate").addEventListener("click", generateBackground);
    $("ps-read") &&
      $("ps-read").addEventListener("click", function () {
        refreshReading(true);
        setStatus("Path reading updated — edit what occupies each stroke, then generate.");
      });
    $("ps-reading") &&
      $("ps-reading").addEventListener("input", function () {
        state.readingTouched = true;
      });
    $("ps-num") &&
      $("ps-num").addEventListener("change", function () {
        loadPalette(parseInt($("ps-num").value, 10) || 1);
      });
    $("ps-grav") &&
      $("ps-grav").addEventListener("input", function () {
        state.grav = (parseInt($("ps-grav").value, 10) || 0) / 100;
      });
    $("ps-size") &&
      $("ps-size").addEventListener("input", function () {
        state.size = parseInt($("ps-size").value, 10) || 4;
      });
    $("ps-pause") &&
      $("ps-pause").addEventListener("click", function () {
        state.paused = !state.paused;
        $("ps-pause").textContent = state.paused ? "Resume" : "Pause";
      });
    $("ps-clear") &&
      $("ps-clear").addEventListener("click", function () {
        clearField();
        if (state.bgUrl) {
          setStatus("Field cleared. Still template still hung — Clear still to stop copying it.");
        }
      });
    $("ps-clear-still") &&
      $("ps-clear-still").addEventListener("click", function () {
        clearStill();
      });
    $("ps-burst") &&
      $("ps-burst").addEventListener("click", function () {
        emit(state.w * 0.5, state.h * 0.28, 720, true);
      });

    var canvas = $("ps-canvas");
    if (canvas) {
      canvas.addEventListener("pointerdown", function (ev) {
        var pt = canvasPoint(ev);
        state.pointer.down = true;
        state.pointer.x = pt.x;
        state.pointer.y = pt.y;
        state.pointer.px = pt.x;
        state.pointer.py = pt.y;
        if (state.tool === "draw") startDrawStroke(pt.x, pt.y);
        try {
          canvas.setPointerCapture(ev.pointerId);
        } catch (e) {}
        ev.preventDefault();
      });
      canvas.addEventListener("pointermove", function (ev) {
        var pt = canvasPoint(ev);
        state.pointer.x = pt.x;
        state.pointer.y = pt.y;
      });
      function up() {
        state.pointer.down = false;
        state.liveStroke = null;
      }
      canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointercancel", up);
    }
    window.addEventListener("resize", function () {
      if (!state.ready) return;
      layout();
    });
  }

  function onShow() {
    document.body.classList.add("ps-tab-active");
    layout();
    state.ready = true;
    state.grav = (($("ps-grav") && parseInt($("ps-grav").value, 10)) || 28) / 100;
    if (!state.srcData) loadPalette(state.num);
    startLoop();
  }

  function onHide() {
    document.body.classList.remove("ps-tab-active");
    stopLoop();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.addEventListener("particles-show", onShow);
  window.addEventListener("particles-hide", onHide);
  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "particles") onShow();
    else onHide();
  });

  window.Particles = { onShow: onShow, onHide: onHide };
})();
