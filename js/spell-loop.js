/**
 * Living spell loop — procedural fusion driven by fused description, tags, and colors.
 * Updates smoothly when spells or text change (no fixed-length video).
 */
(function () {
  var COLOR_MAP = {
    pink: [232, 121, 169],
    magenta: [200, 80, 160],
    purple: [155, 126, 217],
    blue: [90, 140, 220],
    cyan: [80, 200, 210],
    green: [90, 180, 120],
    yellow: [220, 200, 90],
    orange: [230, 150, 80],
    red: [200, 90, 90],
    white: [240, 235, 230],
    black: [20, 18, 22],
    brown: [140, 100, 70],
    gold: [210, 170, 60],
    gray: [140, 140, 150],
    grey: [140, 140, 150],
  };

  var KEYWORD_MOTION = {
    swirl: 1.4,
    spiral: 1.3,
    fluid: 1.2,
    flow: 1.1,
    movement: 1.1,
    dynamic: 1.15,
    dream: 0.85,
    gentle: 0.7,
    slow: 0.65,
    dramatic: 1.25,
    energy: 1.2,
    energetic: 1.2,
    abstract: 1.0,
    organic: 1.05,
  };

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h >>> 0);
  }

  function parseColor(name) {
    if (!name) return [120, 100, 180];
    var raw = String(name).trim();
    // Hex: #RGB or #RRGGBB
    var hex = raw.replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    var key = raw.toLowerCase().trim();
    if (COLOR_MAP[key]) return COLOR_MAP[key].slice();
    // "deep blue" → try last word
    var parts = key.split(/[\s\-_\/]+/);
    for (var i = parts.length - 1; i >= 0; i--) {
      if (COLOR_MAP[parts[i]]) return COLOR_MAP[parts[i]].slice();
    }
    return [100 + (hashStr(key) % 100), 80 + (hashStr(key + "b") % 80), 120 + (hashStr(key + "c") % 80)];
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpRgb(c, t, out) {
    out[0] = lerp(c.from[0], c.to[0], t);
    out[1] = lerp(c.from[1], c.to[1], t);
    out[2] = lerp(c.from[2], c.to[2], t);
  }

  function extractWords(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(function (w) {
        return w.length > 3;
      })
      .slice(0, 24);
  }

  function motionFromLexicon(text, tags) {
    var m = 1;
    var blob = (text + " " + (tags || []).join(" ")).toLowerCase();
    var keys = Object.keys(KEYWORD_MOTION);
    for (var i = 0; i < keys.length; i++) {
      if (blob.indexOf(keys[i]) >= 0) m *= KEYWORD_MOTION[keys[i]];
    }
    return Math.max(0.4, Math.min(2.2, m));
  }

  function promptInfluence(promptText) {
    var p = String(promptText || "").toLowerCase();
    var h = hashStr(p);
    var speed = 1;
    if (p.indexOf("fast") >= 0 || p.indexOf("rush") >= 0) speed = 1.6;
    if (p.indexOf("slow") >= 0 || p.indexOf("gentle") >= 0) speed = 0.55;
    if (p.indexOf("spin") >= 0 || p.indexOf("swirl") >= 0) speed *= 1.25;
    return {
      orbit: 0.1 + (h % 120) / 350,
      speedMul: speed * (0.85 + (h % 40) / 80),
      scale: 0.58 + (h % 25) / 120,
      showParticles: p.length < 8,
    };
  }

  var loop = {
    canvas: null,
    ctx: null,
    running: false,
    raf: 0,
    time: 0,
    particles: [],
    floats: [],
    images: [],
    current: null,
    target: null,
    captionEl: null,
  };

  function defaultTarget() {
    return {
      nums: [],
      title: "",
      description: "",
      tags: [],
      colors: [],
      moods: [],
      motion: 1,
      seed: 1,
      palette: [
        [40, 30, 50],
        [120, 80, 160],
        [200, 120, 180],
      ],
    };
  }

  function buildTarget(nums, fused, meta, stasisText, promptText) {
    var t = defaultTarget();
    t.nums = nums.slice(0, 3);
    t.title = (fused && fused.fused_title) || "";
    t.stasis = String(stasisText || "");
    t.prompt = String(promptText || "");
    t.description = (t.stasis + " " + t.prompt).trim() ||
      (fused && fused.mixed_description) ||
      "";
    t.tags = (fused && fused.combined_tags) || meta.tags || [];
    t.moods = meta.moods || [];
    if (fused && fused.combined_mood) t.moods.push(fused.combined_mood);

    var cols = meta.colors || [];

    t.colors = cols;
    t.seed = hashStr(t.description + t.tags.join("|") + t.nums.join(","));
    t.motion = motionFromLexicon(t.description, t.tags);

    var palette = [];
    for (var c = 0; c < Math.min(cols.length, 5); c++) {
      palette.push(parseColor(cols[c]));
    }
    while (palette.length < 3) {
      palette.push(parseColor(["purple", "pink", "blue"][palette.length]));
    }
    t.palette = palette;
    t.influence = promptInfluence(promptText);
    return t;
  }

  function rebuildParticles(target) {
    var n = 120 + (target.seed % 80);
    loop.particles = [];
    for (var i = 0; i < n; i++) {
      var h = hashStr(target.seed + "-p" + i);
      loop.particles.push({
        x: (h % 1000) / 1000,
        y: ((h >> 10) % 1000) / 1000,
        vx: (((h >> 20) % 200) - 100) / 5000,
        vy: (((h >> 28) % 200) - 100) / 5000,
        size: 1 + (h % 4),
        hue: h % paletteLength(target),
      });
    }

    var words = extractWords(target.description).concat(target.tags.slice(0, 8));
    loop.floats = [];
    for (var w = 0; w < Math.min(words.length, 14); w++) {
      var wh = hashStr(target.seed + "-w" + words[w]);
      loop.floats.push({
        text: words[w],
        x: (wh % 900) / 1000 + 0.05,
        y: ((wh >> 8) % 800) / 1000 + 0.1,
        phase: (wh % 628) / 100,
      });
    }
  }

  function paletteLength(target) {
    return target && target.palette ? target.palette.length : 3;
  }

  function resolveUrl(url) {
    if (!url) return url;
    if (url.indexOf("http") === 0) return url;
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return url;
    }
  }

  function loadSpellImages(nums, freshUrls, onDone) {
    loop.images = [];
    var queue = [];
    var i;
    for (i = 0; i < nums.length && i < 3; i++) {
      queue.push({ kind: "spell", num: nums[i] });
    }
    if (freshUrls && freshUrls.length) {
      for (i = 0; i < freshUrls.length && i < 3; i++) {
        queue.push({ kind: "fresh", url: freshUrls[i] });
      }
    }
    if (!queue.length) {
      onDone();
      return;
    }
    var pending = queue.length;
    for (i = 0; i < queue.length; i++) {
      (function (slot, item) {
        var img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = function () {
          loop.images[slot] = {
            img: img,
            num: item.num || "fresh",
            ready: true,
            fresh: item.kind === "fresh",
            spell: item.kind === "spell",
          };
          pending--;
          if (pending <= 0) onDone();
        };
        img.onerror = function () {
          pending--;
          if (pending <= 0) onDone();
        };
        if (item.kind === "spell") {
          img.src = window.getSpellforgeSpellUrl
            ? window.getSpellforgeSpellUrl(item.num)
            : window.getPaintingUrl
              ? window.getPaintingUrl(item.num)
              : "paintings/" + item.num + ".jpg";
        } else {
          img.src = resolveUrl(item.url);
        }
      })(i, queue[i]);
    }
  }

  function ensureCurrent() {
    if (!loop.current) loop.current = JSON.parse(JSON.stringify(loop.target || defaultTarget()));
  }

  function tick() {
    if (!loop.running || !loop.ctx) return;
    var ctx = loop.ctx;
    var w = loop.canvas.width;
    var h = loop.canvas.height;
    var dt = 0.016;
    loop.time += dt;

    ensureCurrent();
    if (loop.target) {
      loop.current.motion = lerp(loop.current.motion, loop.target.motion, 0.06);
      if (!loop.current.influence) loop.current.influence = promptInfluence("");
      if (loop.target.influence) {
        loop.current.influence.orbit = lerp(
          loop.current.influence.orbit,
          loop.target.influence.orbit,
          0.08
        );
        loop.current.influence.speedMul = lerp(
          loop.current.influence.speedMul,
          loop.target.influence.speedMul,
          0.08
        );
        loop.current.influence.scale = lerp(
          loop.current.influence.scale,
          loop.target.influence.scale,
          0.08
        );
        loop.current.influence.showParticles = loop.target.influence.showParticles;
      }
      for (var p = 0; p < 3; p++) {
        if (!loop.current.palette[p]) loop.current.palette[p] = [0, 0, 0];
        if (!loop.target.palette[p]) continue;
        for (var c = 0; c < 3; c++) {
          loop.current.palette[p][c] = lerp(
            loop.current.palette[p][c],
            loop.target.palette[p][c],
            0.02
          );
        }
      }
    }

    var inf = loop.current.influence || promptInfluence("");
    var t = loop.time * loop.current.motion * inf.speedMul;
    var seed = loop.current.seed || 1;
    var pal = loop.current.palette || defaultTarget().palette;

    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, rgbCss(pal[0], 0.55));
    g.addColorStop(0.5, rgbCss(pal[1 % pal.length], 0.45));
    g.addColorStop(1, rgbCss(pal[2 % pal.length], 0.55));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    var layers = loop.images.filter(function (x) {
      return x && x.ready && x.img;
    });
    var spellLayers = layers.filter(function (x) {
      return x.spell || !x.fresh;
    });
    var freshLayers = layers.filter(function (x) {
      return x.fresh;
    });

    if (spellLayers.length) {
      drawAuras(ctx, w, h, t, pal, seed, 0.12);
      for (var S = 0; S < spellLayers.length; S++) {
        drawSpellLayer(ctx, w, h, spellLayers[S], S, spellLayers.length, t, seed, inf, false);
      }
    }
    if (freshLayers.length) {
      for (var F = 0; F < freshLayers.length; F++) {
        drawSpellLayer(ctx, w, h, freshLayers[F], F, freshLayers.length, t, seed, inf, true);
      }
    }

    if (inf.showParticles && !spellLayers.length) {
      drawParticles(ctx, w, h, t, pal, 1);
      drawFloatingWords(ctx, w, h, t);
    } else if (spellLayers.length) {
      drawParticles(ctx, w, h, t, pal, 0.22);
    }

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, h - 36, w, 36);
    ctx.fillStyle = "rgba(245, 240, 232, 0.9)";
    ctx.font = "14px 'DM Sans', sans-serif";
    var cap = loop.current.title || "Living spell";
    ctx.fillText(cap, 14, h - 12);

    loop.raf = requestAnimationFrame(tick);
  }

  function rgbCss(rgb, a) {
    return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a + ")";
  }

  function drawAuras(ctx, w, h, t, pal, seed, strength) {
    strength = strength == null ? 0.2 : strength;
    for (var a = 0; a < 4; a++) {
      var cx = w * (0.5 + 0.35 * Math.sin(t * 0.4 + a + seed * 0.001));
      var cy = h * (0.5 + 0.35 * Math.cos(t * 0.35 + a * 1.3));
      var r = Math.min(w, h) * (0.25 + 0.08 * Math.sin(t + a));
      var col = pal[a % pal.length];
      var grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, rgbCss(col, strength));
      grd.addColorStop(1, rgbCss(col, 0));
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function drawSpellLayer(ctx, w, h, layer, index, total, t, seed, inf, isFresh) {
    inf = inf || promptInfluence("");
    var phase = t * 0.25 + index * 2.1 + seed * 0.0001;
    var orbit = inf.orbit;
    var cx = w * (0.5 + orbit * Math.cos(phase));
    var cy = h * (0.5 + orbit * 0.85 * Math.sin(phase * 1.1));
    var scale = inf.scale + 0.1 * Math.sin(t * 0.5 + index);
    if (isFresh) scale *= 0.92;
    var iw = layer.img.width;
    var ih = layer.img.height;
    var size = Math.min(w, h) * scale;
    var aspect = iw / ih;
    var dw = aspect >= 1 ? size : size * aspect;
    var dh = aspect >= 1 ? size / aspect : size;
    var alpha = isFresh
      ? 0.5 + 0.2 * Math.sin(t * 0.6 + index)
      : 0.55 + (0.3 / total) * (1 + Math.sin(t * 0.8 + index));

    ctx.save();
    ctx.globalAlpha = Math.min(0.92, alpha);
    ctx.globalCompositeOperation = isFresh ? "lighter" : "screen";
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(phase * 0.3) * 0.08);
    ctx.drawImage(layer.img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  function drawParticles(ctx, w, h, t, pal, strength) {
    strength = strength == null ? 1 : strength;
    var mot = loop.current.motion;
    var maxP = Math.floor(loop.particles.length * strength);
    for (var i = 0; i < maxP; i++) {
      var p = loop.particles[i];
      p.x += p.vx * mot + Math.sin(t + i) * 0.0004;
      p.y += p.vy * mot + Math.cos(t * 0.9 + i) * 0.0004;
      if (p.x < 0) p.x = 1;
      if (p.x > 1) p.x = 0;
      if (p.y < 0) p.y = 1;
      if (p.y > 1) p.y = 0;
      var col = pal[p.hue % pal.length];
      ctx.fillStyle = rgbCss(col, 0.55 * strength);
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFloatingWords(ctx, w, h, t) {
    ctx.font = "italic 13px 'Cormorant Garamond', serif";
    for (var i = 0; i < loop.floats.length; i++) {
      var f = loop.floats[i];
      var x = (f.x + Math.sin(t * 0.3 + f.phase) * 0.04) * w;
      var y = (f.y + Math.cos(t * 0.25 + f.phase) * 0.03) * h;
      ctx.fillStyle = "rgba(245, 240, 232, " + (0.15 + 0.12 * Math.sin(t + f.phase)) + ")";
      ctx.fillText(f.text, x, y);
    }
  }

  function resize() {
    if (!loop.canvas) return;
    var wrap = loop.canvas.parentElement;
    var width = wrap ? wrap.clientWidth : 720;
    var height = Math.round((width * 9) / 16);
    loop.canvas.width = width;
    loop.canvas.height = Math.max(280, height);
  }

  function rebuildFloats(target) {
    var words = extractWords(target.description).concat(target.tags.slice(0, 8));
    loop.floats = [];
    for (var w = 0; w < Math.min(words.length, 14); w++) {
      var wh = hashStr(target.seed + "-w" + words[w]);
      loop.floats.push({
        text: words[w],
        x: (wh % 900) / 1000 + 0.05,
        y: ((wh >> 8) % 800) / 1000 + 0.1,
        phase: (wh % 628) / 100,
      });
    }
  }

  loop.setState = function (nums, fused, meta, stasisText, promptText, generatedUrls) {
    var prev = loop.target;
    loop.target = buildTarget(nums, fused, meta, stasisText, promptText);
    var stasisSame = prev && prev.stasis === loop.target.stasis;
    var numsSame =
      prev && prev.nums.join(",") === loop.target.nums.join(",");
    if (!loop.current) {
      loop.current = JSON.parse(JSON.stringify(loop.target));
      rebuildParticles(loop.target);
    } else if (!stasisSame || !numsSame) {
      rebuildParticles(loop.target);
    } else {
      loop.target.motion = motionFromLexicon(loop.target.description, loop.target.tags);
      loop.current.influence = loop.target.influence;
      rebuildFloats(loop.target);
    }

    if (loop.captionEl) {
      if (nums.length < 2) {
        loop.captionEl.textContent =
          "Equip 2+ spells — stasis locks the fusion; live prompt morphs the loop.";
      } else if (generatedUrls && generatedUrls.length) {
        loop.captionEl.textContent =
          "Fresh AI fusion images in loop — edit live prompt to reshape motion.";
      } else {
        loop.captionEl.textContent =
          "Procedural loop from stasis + prompt — generate fresh images for all-new artwork.";
      }
    }

    function afterLoad() {
      var hasImg = loop.images.some(function (x) {
        return x && x.ready && x.img;
      });
      if (hasImg && !loop.running) loop.start();
      if (!hasImg) loop.stop();
    }

    loadSpellImages(nums, generatedUrls, afterLoad);

    if (!nums.length) loop.stop();
  };

  loop.init = function (canvasId, captionId) {
    loop.canvas = document.getElementById(canvasId);
    loop.captionEl = document.getElementById(captionId);
    if (!loop.canvas) return;
    loop.ctx = loop.canvas.getContext("2d");
    resize();
    window.addEventListener("resize", debounce(resize, 200));
    loop.target = defaultTarget();
    loop.current = defaultTarget();
  };

  loop.start = function () {
    if (loop.running) return;
    loop.running = true;
    tick();
  };

  loop.stop = function () {
    loop.running = false;
    if (loop.raf) cancelAnimationFrame(loop.raf);
    if (loop.ctx && loop.canvas) {
      loop.ctx.fillStyle = "#0f0e0d";
      loop.ctx.fillRect(0, 0, loop.canvas.width, loop.canvas.height);
    }
  };

  function debounce(fn, ms) {
    var timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  window.SpellLoop = loop;
})();