/**
 * Stasis timelapse: walks descriptor tokens from 3 equipped spells, morphs paintings,
 * refines toward stasis vision — one forward run (no 8s loop), buzz words steer each stage.
 */
(function () {
  var SEC_PER_TOKEN = 7;
  var FINALE_SEC = 42;
  var SLOT_NAMES = ["I", "II", "III"];

  var COLOR_MAP = {
    pink: [232, 121, 169],
    purple: [155, 126, 217],
    violet: [140, 100, 200],
    blue: [90, 140, 220],
    cyan: [80, 180, 200],
    teal: [70, 160, 150],
    green: [90, 180, 120],
    lime: [140, 200, 90],
    orange: [230, 150, 80],
    red: [200, 90, 90],
    gold: [210, 170, 60],
    amber: [220, 160, 70],
    cream: [245, 230, 200],
    ivory: [250, 245, 235],
    dusk: [120, 80, 140],
    dawn: [255, 180, 140],
    noir: [30, 28, 35],
    dark: [25, 22, 30],
  };

  var BUZZ_EFFECTS = {
    swirl: "swirl",
    spiral: "swirl",
    vortex: "swirl",
    fluid: "ripple",
    flow: "ripple",
    water: "ripple",
    ripple: "ripple",
    wave: "ripple",
    abstract: "lines",
    geometric: "lines",
    line: "lines",
    organic: "grain",
    texture: "grain",
    brush: "grain",
    impasto: "grain",
    light: "glow",
    glow: "glow",
    luminous: "glow",
    dusk: "warm",
    dawn: "warm",
    sunset: "warm",
    dream: "soft",
    soft: "soft",
    haze: "soft",
    mist: "soft",
    dark: "vignette",
    shadow: "vignette",
    energy: "sharp",
    dynamic: "sharp",
    sharp: "sharp",
    crystal: "sharp",
    motion: "ripple",
    dance: "swirl",
  };

  var tl = {
    canvas: null,
    ctx: null,
    captionEl: null,
    running: false,
    raf: 0,
    time: 0,
    stasisText: "",
    livePrompt: "",
    stasisImage: null,
    stasisImageUrl: "",
    previewImages: [],
    activeBuzz: [],
    palette: [
      [40, 30, 50],
      [120, 80, 160],
      [200, 120, 180],
    ],
    detailBoost: 0,
    liveBoost: 0,
    spellTokens: [],
    lastNumsKey: "",
    equippedNums: [],
    currentTokenWord: "",
    videoEl: null,
    statusEl: null,
    downloadEl: null,
    rebuildBtn: null,
    videoBlobUrl: "",
    recording: false,
    recordTimeScale: 1,
    videoBuildTimer: null,
  };

  function getAnalysis(num) {
    var a = window.getGalleryAnalyses && window.getGalleryAnalyses();
    if (!a) return null;
    return a[String(num)] || a[num] || null;
  }

  function buildSpellTokens(nums) {
    var out = [];
    for (var si = 0; si < nums.length && si < 3; si++) {
      var an = getAnalysis(nums[si]);
      if (!an) continue;
      if (an.style) {
        out.push({
          word: an.style,
          spellIdx: si,
          spellNum: nums[si],
          slot: SLOT_NAMES[si],
          kind: "style",
        });
      }
      var tags = an.tags || [];
      for (var ti = 0; ti < tags.length && ti < 6; ti++) {
        out.push({
          word: tags[ti],
          spellIdx: si,
          spellNum: nums[si],
          slot: SLOT_NAMES[si],
          kind: "tag",
        });
      }
    }
    if (!out.length && nums.length) {
      out.push({
        word: "spell fusion",
        spellIdx: 0,
        spellNum: nums[0],
        slot: "I",
        kind: "style",
      });
    }
    return out;
  }

  function totalDuration() {
    var n = tl.spellTokens.length;
    if (!n) return FINALE_SEC;
    return n * SEC_PER_TOKEN + FINALE_SEC;
  }

  function timelineAt(timeSec) {
    var tokens = tl.spellTokens;
    var n = tokens.length;
    var total = totalDuration();
    var globalPhase = total > 0 ? clamp(timeSec / total, 0, 1) : 0;
    if (!n) {
      return {
        globalPhase: globalPhase,
        tokenIndex: 0,
        tokenLocal: 0,
        activeToken: null,
        inFinale: true,
        activeSpellIdx: 0,
      };
    }
    var tokenPhase = timeSec / SEC_PER_TOKEN;
    var tokenIndex = Math.min(Math.floor(tokenPhase), n - 1);
    var tokenLocal = clamp(tokenPhase - tokenIndex, 0, 1);
    var inFinale = timeSec >= n * SEC_PER_TOKEN;
    var activeToken = tokens[tokenIndex];
    return {
      globalPhase: globalPhase,
      tokenIndex: tokenIndex,
      tokenLocal: tokenLocal,
      activeToken: activeToken,
      inFinale: inFinale,
      activeSpellIdx: activeToken ? activeToken.spellIdx : 0,
    };
  }

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h >>> 0);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function resolveUrl(url) {
    if (!url || url.indexOf("http") === 0) return url;
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return url;
    }
  }

  function activeEffects() {
    var found = {};
    var all = tl.activeBuzz.concat(promptTokens());
    if (tl.currentTokenWord) all = all.concat([tl.currentTokenWord]);
    for (var i = 0; i < all.length; i++) {
      var w = String(all[i]).toLowerCase();
      var keys = Object.keys(BUZZ_EFFECTS);
      for (var k = 0; k < keys.length; k++) {
        if (w.indexOf(keys[k]) >= 0) found[BUZZ_EFFECTS[keys[k]]] = true;
      }
    }
    return found;
  }

  function promptTokens() {
    return String(tl.livePrompt || "")
      .toLowerCase()
      .split(/[,;\s]+/)
      .map(function (s) {
        return s.trim();
      })
      .filter(function (s) {
        return s.length > 2;
      });
  }

  function paletteFromText(text) {
    var out = [];
    var raw = String(text || "");
    var lower = raw.toLowerCase();
    // Prefer explicit hex codes in stasis / palette lines
    var hexRe = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
    var m;
    while ((m = hexRe.exec(raw))) {
      var hx = m[1];
      if (hx.length === 3) hx = hx[0] + hx[0] + hx[1] + hx[1] + hx[2] + hx[2];
      out.push([
        parseInt(hx.slice(0, 2), 16),
        parseInt(hx.slice(2, 4), 16),
        parseInt(hx.slice(4, 6), 16),
      ]);
    }
    if (!out.length) {
      var keys = Object.keys(COLOR_MAP);
      for (var i = 0; i < keys.length; i++) {
        if (lower.indexOf(keys[i]) >= 0) out.push(COLOR_MAP[keys[i]]);
      }
    }
    if (!out.length) {
      var h = hashStr(text || "stasis");
      out.push([
        (h % 80) + 60,
        ((h >> 8) % 60) + 40,
        ((h >> 16) % 80) + 80,
      ]);
      out.push([
        ((h >> 4) % 100) + 100,
        ((h >> 12) % 80) + 60,
        ((h >> 20) % 100) + 100,
      ]);
    }
    return out;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        resolve(img);
      };
      img.onerror = reject;
      img.src = resolveUrl(url);
    });
  }

  function loadPreviewPaintings(nums) {
    tl.previewImages = [];
    if (!nums.length) return Promise.resolve();
    var jobs = [];
    for (var i = 0; i < Math.min(nums.length, 3); i++) {
      (function (idx, num) {
        jobs.push(
          loadImage(
            window.getPaintingUrl
              ? window.getPaintingUrl(num)
              : "paintings/" + num + ".jpg"
          )
            .then(function (img) {
              tl.previewImages[idx] = img;
            })
            .catch(function () {})
        );
      })(i, nums[i]);
    }
    return Promise.all(jobs);
  }

  function resize() {
    if (!tl.canvas) return;
    var wrap = tl.canvas.parentElement;
    var width = wrap ? Math.min(wrap.clientWidth, 900) : 720;
    tl.canvas.width = width;
    tl.canvas.height = Math.round((width * 9) / 16);
  }

  function smoothstep(u) {
    u = clamp(u, 0, 1);
    return u * u * (3 - 2 * u);
  }

  function normalizeWeights(arr) {
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    if (sum < 0.001) return arr;
    for (var j = 0; j < arr.length; j++) arr[j] /= sum;
    return arr;
  }

  function computeSpellWeights(tlState, spellCount) {
    var w = [];
    var i;
    for (i = 0; i < spellCount; i++) w[i] = 0.04;

    if (!spellCount) return w;

    if (tlState.inFinale) {
      var cycle = (tl.time * 0.04) % spellCount;
      var a = Math.floor(cycle);
      var b = (a + 1) % spellCount;
      var fe = smoothstep(cycle - a);
      for (i = 0; i < spellCount; i++) w[i] = 0.06;
      w[a] += (1 - fe) * 0.82;
      w[b] += fe * 0.82;
      return normalizeWeights(w);
    }

    var focus = tlState.activeSpellIdx % spellCount;
    var nextIdx = Math.min(tlState.tokenIndex + 1, tl.spellTokens.length - 1);
    var nextTok = tl.spellTokens[nextIdx];
    var nextFocus = nextTok ? nextTok.spellIdx % spellCount : (focus + 1) % spellCount;
    var ease = smoothstep(tlState.tokenLocal);

    for (i = 0; i < spellCount; i++) {
      if (i === focus) w[i] = 0.08 + (1 - ease) * 0.88;
      else if (i === nextFocus && nextFocus !== focus) w[i] = 0.08 + ease * 0.88;
    }
    return normalizeWeights(w);
  }

  function drawCover(ctx, w, h, img, alpha, offsetX, offsetY, scaleMul, filterStr) {
    if (!img || alpha < 0.01) return;
    var iw = img.width;
    var ih = img.height;
    var scale = Math.max(w / iw, h / ih) * (scaleMul || 1);
    var dw = iw * scale;
    var dh = ih * scale;
    var dx = (w - dw) / 2 + (offsetX || 0);
    var dy = (h - dh) / 2 + (offsetY || 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (filterStr) ctx.filter = filterStr;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  }

  function drawDissolveTransition(ctx, w, h, imgFrom, imgTo, ease, tlState, detail) {
    if (!imgFrom || !imgTo || ease < 0.02) return;
    if (ease > 0.98) return;
    var seed = hashStr((tlState.activeToken && tlState.activeToken.word) || "morph");
    var blocks = 14;
    var reveal = ease;
    ctx.save();
    for (var by = 0; by < blocks; by++) {
      for (var bx = 0; bx < blocks; bx++) {
        var cell = (bx + by * blocks + seed) % 97;
        var threshold = cell / 97;
        if (threshold > reveal) continue;
        var bx0 = (bx / blocks) * w;
        var by0 = (by / blocks) * h;
        var bw = Math.ceil(w / blocks) + 1;
        var bh = Math.ceil(h / blocks) + 1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(bx0, by0, bw, bh);
        ctx.clip();
        var mid = 0.5 - Math.abs(ease - 0.5);
        drawCover(ctx, w, h, imgTo, 0.35 + mid * 0.5, 0, 0, 1.02 + detail * 0.04, "saturate(1.15)");
        ctx.restore();
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = "difference";
    ctx.globalAlpha = 0.08 * Math.sin(ease * Math.PI);
    drawCover(ctx, w, h, imgTo, 1, 0, 0, 1, null);
    drawCover(ctx, w, h, imgFrom, 1, 0, 0, 1, null);
    ctx.restore();
    ctx.restore();
  }

  function drawStasisTextMist(ctx, w, h, phase, detail, tlState) {
    var pal = tl.palette;
    var seed = hashStr(tl.stasisText);
    for (var i = 0; i < pal.length; i++) {
      var rgb = pal[i % pal.length];
      var px = w * (0.25 + 0.5 * ((i + seed * 0.001) % 1));
      var py = h * (0.3 + 0.4 * (((i * 1.7 + seed) % 100) / 100));
      var r = Math.min(w, h) * (0.25 + phase * 0.15 + detail * 0.1);
      var grd = ctx.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, "rgba(" + rgb.join(",") + "," + (0.12 + detail * 0.2) + ")");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function drawSpellLayers(ctx, w, h, tlState, detail) {
    var nums = tl.equippedNums;
    var spellCount = nums.length;
    if (!spellCount) return false;

    var hasAny = false;
    for (var c = 0; c < spellCount; c++) {
      if (tl.previewImages[c]) hasAny = true;
    }
    if (!hasAny) return false;

    var weights = computeSpellWeights(tlState, spellCount);
    var phase = tlState.globalPhase;
    var ease = smoothstep(tlState.tokenLocal);
    var focus = tlState.activeSpellIdx % spellCount;
    var nextIdx = Math.min(tlState.tokenIndex + 1, tl.spellTokens.length - 1);
    var nextTok = tl.spellTokens[nextIdx];
    var nextFocus = nextTok ? nextTok.spellIdx % spellCount : (focus + 1) % spellCount;
    var imgFrom = tl.previewImages[focus];
    var imgTo = tl.previewImages[nextFocus];

    ctx.fillStyle = "#0a0908";
    ctx.fillRect(0, 0, w, h);
    drawStasisTextMist(ctx, w, h, phase, detail, tlState);

    var driftBase = (phase - 0.5) * w * 0.06;

    for (var i = 0; i < spellCount; i++) {
      var img = tl.previewImages[i];
      if (!img || weights[i] < 0.03) continue;
      var towardNext = i === nextFocus ? ease * 0.04 * h : 0;
      var awayFocus = i === focus ? -(ease * 0.03 * h) : 0;
      var offsetX = driftBase * (i - (spellCount - 1) / 2);
      var scale = 1.0 + phase * 0.06 + weights[i] * 0.08 + detail * 0.04;
      var sat = 0.9 + weights[i] * 0.25 + detail * 0.2;
      var hue = (hashStr(String(nums[i])) % 24) - 12;
      drawCover(
        ctx,
        w,
        h,
        img,
        weights[i],
        offsetX,
        towardNext + awayFocus,
        scale,
        "saturate(" + sat + ") hue-rotate(" + hue * ease + "deg) contrast(" + (0.95 + detail * 0.15) + ")"
      );
    }

    if (imgFrom && imgTo && focus !== nextFocus && ease > 0.05 && ease < 0.95) {
      drawDissolveTransition(ctx, w, h, imgFrom, imgTo, ease, tlState, detail);
    }

    if (ease > 0.02 && ease < 0.98 && imgTo) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(w * (1 - ease), 0, w * ease + 2, h);
      ctx.clip();
      drawCover(ctx, w, h, imgTo, 0.92, driftBase * 0.5, 0, 1.03, "saturate(1.2)");
      ctx.restore();
    }

    return true;
  }

  function drawPaintingMorph(ctx, w, h, t, tlState, detail) {
    return drawSpellLayers(ctx, w, h, tlState, detail);
  }

  function drawPlaceholder(ctx, w, h, t, tlState) {
    var buzzCount = tl.activeBuzz.length + promptTokens().length;
    var detail = clamp(
      tlState.globalPhase * 0.65 +
        buzzCount * 0.08 +
        tl.liveBoost * 0.25 +
        (tlState.activeToken ? 0.12 : 0),
      0,
      1
    );

    if (drawPaintingMorph(ctx, w, h, t, tlState, detail)) {
      drawBuzzOverlays(ctx, w, h, t, tlState.globalPhase, detail, activeEffects());
      return;
    }

    ctx.fillStyle = "#0f0e0d";
    ctx.fillRect(0, 0, w, h);
    drawStasisTextMist(ctx, w, h, tlState.globalPhase, detail, tlState);
    ctx.fillStyle = "rgba(245,240,232,0.88)";
    ctx.font = "15px 'DM Sans', sans-serif";
    var msg = tl.stasisText
      ? "Stasis timelapse · generate vision to deepen the forward run"
      : "Equip 2+ spells — watch tokens cycle through each stylization";
    ctx.fillText(msg, 20, h / 2);
  }

  function drawBuzzOverlays(ctx, w, h, t, phase, detail, fx) {
    var live = tl.liveBoost;
    if (fx.swirl && detail > 0.35) {
      ctx.save();
      ctx.globalAlpha = 0.06 * detail;
      ctx.strokeStyle = "rgba(200, 180, 255, 0.4)";
      ctx.lineWidth = 1;
      var cx = w * (0.35 + phase * 0.3);
      var cy = h * 0.5;
      for (var s = 0; s < 3; s++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (40 + s * 30) * detail, 0, Math.PI * 2 * (0.3 + phase * 0.7));
        ctx.stroke();
      }
      ctx.restore();
    }
    if (fx.ripple && detail > 0.4) {
      ctx.strokeStyle = "rgba(200, 220, 255, " + 0.08 * detail + ")";
      ctx.lineWidth = 1;
      var step = 28;
      var wave = phase * Math.PI * 2;
      for (var y = 0; y < h; y += step) {
        ctx.beginPath();
        for (var x = 0; x <= w; x += 24) {
          var yy = y + Math.sin(wave + x * 0.012) * 6 * detail;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    }
    if (fx.lines && detail > 0.35) {
      ctx.strokeStyle = "rgba(245, 240, 232, " + 0.08 * detail + ")";
      ctx.lineWidth = 1;
      for (var L = 0; L < 10; L++) {
        ctx.beginPath();
        ctx.moveTo(0, (h / 10) * L + Math.sin(t * (1 + live * 0.5) + L) * 12);
        ctx.lineTo(w, (h / 10) * L + Math.cos(t * 0.7 + L) * 12);
        ctx.stroke();
      }
    }
    if (fx.grain && detail > 0.4) {
      ctx.fillStyle = "rgba(255,255,255," + 0.05 * detail + ")";
      var seed = hashStr(tl.stasisText + tl.livePrompt) + Math.floor(t * 40);
      for (var g = 0; g < 150 * detail; g++) {
        var gx = (hashStr("g" + seed + g) % 1000) / 1000 * w;
        var gy = (hashStr("h" + seed + g) % 1000) / 1000 * h;
        ctx.fillRect(gx, gy, 1, 1);
      }
    }
    if (fx.glow && detail > 0.3) {
      var grd = ctx.createRadialGradient(
        w * 0.5,
        h * 0.5,
        0,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.55
      );
      grd.addColorStop(0, "rgba(255, 220, 180, " + 0.18 * detail + ")");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
    }
    if (fx.soft && detail > 0.2) {
      ctx.fillStyle = "rgba(240, 235, 255, " + 0.06 * detail + ")";
      ctx.fillRect(0, 0, w, h);
    }
    if (fx.warm && detail > 0.25) {
      ctx.fillStyle = "rgba(220, 140, 80, " + 0.1 * detail + ")";
      ctx.fillRect(0, 0, w, h);
    }
    if (fx.vignette) {
      var vig = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.2,
        w / 2,
        h / 2,
        Math.max(w, h) * 0.75
      );
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0," + 0.5 * (0.4 + phase * 0.6) + ")");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function colorGrade(ctx, w, h, rgb, amount) {
    if (!amount) return;
    ctx.fillStyle =
      "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + amount + ")";
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }

  function drawStasisFrame(ctx, w, h, t, tlState, detail, fx) {
    var img = tl.stasisImage;
    var phase = tlState.globalPhase;
    var ease = smoothstep(tlState.tokenLocal);
    var tokenHue = tlState.activeToken ? (hashStr(tlState.activeToken.word) % 36) - 18 : 0;
    var live = tl.liveBoost;

    drawSpellLayers(ctx, w, h, tlState, detail * 0.85);

    var iw = img.width;
    var ih = img.height;
    var zoom = 1.0 + phase * 0.1 + detail * 0.06 + ease * 0.04;
    var driftX = (phase - 0.5) * w * 0.03 + ease * w * 0.02;
    var driftY = ease * h * 0.015;
    var scale = Math.max(w / iw, h / ih) * zoom;
    var dw = iw * scale;
    var dh = ih * scale;
    var dx = (w - dw) / 2 + driftX;
    var dy = (h - dh) / 2 + driftY;

    var blurAmt = Math.max(0, 8 - detail * 8 - phase * 3);
    var contrast = 0.88 + detail * 0.35 + ease * 0.1;
    var saturate = 0.9 + detail * 0.45 + live * 0.15;
    var hue = tokenHue + (hashStr(tl.livePrompt) % 10) - 5;

    var underPaint = 0.22 + phase * 0.35 + detail * 0.2;
    if (ease > 0.1 && ease < 0.9) underPaint *= 0.75 + ease * 0.25;

    ctx.save();
    ctx.globalAlpha = underPaint;
    ctx.filter =
      "blur(" +
      blurAmt +
      "px) contrast(" +
      contrast +
      ") saturate(" +
      saturate +
      ") hue-rotate(" +
      hue +
      "deg)";
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.55 + phase * 0.35 + detail * 0.15;
    ctx.filter = "contrast(" + (1 + detail * 0.2) + ") saturate(" + (1 + live * 0.1) + ")";
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();

    if (detail > 0.25) {
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = 0.1 + detail * 0.2;
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    }

    var pal = tl.palette;
    if (pal.length && tlState.activeToken) {
      var pi = tlState.activeSpellIdx % pal.length;
      colorGrade(ctx, w, h, pal[pi], 0.08 + detail * 0.12 + ease * 0.08);
    }

    drawBuzzOverlays(ctx, w, h, t, phase, detail, fx);
  }

  function updateCaption(tlState, detail, buzzCount) {
    if (!tl.captionEl) return;
    var phase = tlState.globalPhase;
    var stage =
      phase < 0.2
        ? "Emerging"
        : phase < 0.45
          ? "Structuring"
          : phase < 0.7
            ? "Refining"
            : "Flourish";
    var bits = [stage + " · " + Math.round(phase * 100) + "% through run"];
    if (tlState.activeToken) {
      bits.push(
        "Spell " +
          tlState.activeToken.slot +
          ' · "' +
          tlState.activeToken.word +
          '"'
      );
    }
    bits.push(
      (tlState.tokenIndex + 1) +
        "/" +
        Math.max(1, tl.spellTokens.length) +
        " tokens"
    );
    if (tlState.inFinale) bits.push("continuation");
    var live = tl.livePrompt.trim();
    if (live) bits.push('live: "' + (live.length > 28 ? live.slice(0, 28) + "…" : live) + '"');
    if (tl.stasisImage) bits.push("stasis vision");
    else bits.push("3-spell morph");
    tl.captionEl.textContent = bits.join(" · ");
  }

  function tick() {
    if (!tl.running || !tl.ctx) return;
    var ctx = tl.ctx;
    var w = tl.canvas.width;
    var h = tl.canvas.height;
    if (w < 2 || h < 2) {
      tl.raf = requestAnimationFrame(tick);
      return;
    }
    tl.time += 0.016 * (tl.recordTimeScale || 1);

    var t = tl.time;
    var tlState = timelineAt(t);
    tl.currentTokenWord = tlState.activeToken ? tlState.activeToken.word : "";
    var buzzCount = tl.activeBuzz.length + promptTokens().length;
    var targetDetail = clamp(
      tlState.globalPhase * 0.8 +
        Math.min(1, buzzCount * 0.08) * 0.35 +
        tl.liveBoost * 0.3 +
        tlState.tokenLocal * 0.15,
      0,
      1
    );
    tl.detailBoost = lerp(tl.detailBoost, targetDetail, 0.04);
    var detail = tl.detailBoost;
    tl.liveBoost = lerp(
      tl.liveBoost,
      tl.livePrompt.trim() ? 1 : 0,
      tl.livePrompt.trim() ? 0.08 : 0.03
    );
    var fx = activeEffects();

    if (!tl.stasisImage) {
      drawPlaceholder(ctx, w, h, t, tlState);
      updateCaption(tlState, detail, buzzCount);
      tl.raf = requestAnimationFrame(tick);
      return;
    }

    drawStasisFrame(ctx, w, h, t, tlState, detail, fx);
    updateCaption(tlState, detail, buzzCount);

    tl.raf = requestAnimationFrame(tick);
  }

  function preferredMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    var types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    for (var i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return "";
  }

  function setVideoStatus(text, show) {
    if (!tl.statusEl) tl.statusEl = document.getElementById("spell-loop-video-status");
    if (!tl.statusEl) return;
    tl.statusEl.hidden = !show;
    if (show) tl.statusEl.textContent = text;
  }

  tl.showVideo = function (url) {
    if (!tl.videoEl) tl.videoEl = document.getElementById("spell-loop-video");
    if (!tl.downloadEl) tl.downloadEl = document.getElementById("spell-loop-download-video");
    if (!tl.videoEl || !url) return;
    tl.videoEl.src = url;
    tl.videoEl.hidden = false;
    tl.videoEl.loop = false;
    if (tl.canvas) tl.canvas.hidden = true;
    setVideoStatus("", false);
    tl.stop();
    if (tl.downloadEl) {
      tl.downloadEl.href = url;
      tl.downloadEl.hidden = false;
    }
    tl.videoEl.play().catch(function () {});
  };

  tl.showCanvasPreview = function () {
    if (tl.videoEl) {
      tl.videoEl.hidden = true;
      tl.videoEl.pause();
    }
    if (tl.canvas) tl.canvas.hidden = false;
    if (tl.equippedNums.length >= 2 && !tl.recording) tl.start();
  };

  tl.buildVideo = function () {
    if (!tl.canvas || tl.spellTokens.length < 2) {
      return Promise.reject(new Error("Equip at least 2 spells."));
    }
    if (!window.MediaRecorder || !tl.canvas.captureStream) {
      tl.showCanvasPreview();
      return Promise.reject(new Error("Video export not supported in this browser."));
    }
    if (tl.recording) return Promise.resolve(tl.videoBlobUrl);

    return new Promise(function (resolve, reject) {
      resize();
      tl.restartRun();
      var runSec = totalDuration();
      var wallSec = clamp(runSec * 0.4, 24, 72);
      tl.recordTimeScale = runSec / wallSec;

      setVideoStatus("Building timelapse video (" + Math.round(wallSec) + "s)…", true);
      tl.showCanvasPreview();
      tl.recording = true;
      tl.start();

      var fps = 30;
      var stream = tl.canvas.captureStream(fps);
      var mime = preferredMime();
      var recorder;
      try {
        recorder = mime
          ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000 })
          : new MediaRecorder(stream);
      } catch (e) {
        tl.recording = false;
        tl.recordTimeScale = 1;
        tl.showCanvasPreview();
        reject(e);
        return;
      }

      var chunks = [];
      recorder.ondataavailable = function (ev) {
        if (ev.data && ev.data.size) chunks.push(ev.data);
      };
      recorder.onerror = function () {
        tl.recording = false;
        tl.recordTimeScale = 1;
        setVideoStatus("", false);
        tl.showCanvasPreview();
        reject(new Error("Video recording failed."));
      };
      recorder.onstop = function () {
        tl.recording = false;
        tl.recordTimeScale = 1;
        if (tl.videoBlobUrl) URL.revokeObjectURL(tl.videoBlobUrl);
        var blob = new Blob(chunks, { type: mime || "video/webm" });
        tl.videoBlobUrl = URL.createObjectURL(blob);
        tl.showVideo(tl.videoBlobUrl);
        resolve(tl.videoBlobUrl);
      };

      recorder.start(250);
      setTimeout(function () {
        try {
          recorder.stop();
        } catch (e2) {}
        stream.getTracks().forEach(function (tr) {
          tr.stop();
        });
      }, wallSec * 1000 + 400);
    });
  };

  function spellforgePanelVisible() {
    var panel = document.getElementById("panel-spellforge");
    return !!(panel && !panel.hidden);
  }

  tl.scheduleVideoBuild = function (force) {
    if (tl.videoBuildTimer) clearTimeout(tl.videoBuildTimer);
    if (!force && !spellforgePanelVisible()) {
      setVideoStatus("Switch to Spellforge to build timelapse video.", true);
      return;
    }
    if (tl.spellTokens.length < 2) {
      if (tl.videoEl) {
        tl.videoEl.hidden = true;
        tl.videoEl.removeAttribute("src");
      }
      if (tl.downloadEl) tl.downloadEl.hidden = true;
      tl.showCanvasPreview();
      setVideoStatus("Equip 2+ spells to build timelapse video.", true);
      return;
    }
    setVideoStatus("Timelapse video will build in a moment…", true);
    tl.videoBuildTimer = setTimeout(function () {
      tl.buildVideo().catch(function (err) {
        setVideoStatus(err.message || "Video build failed — showing live preview.", true);
        tl.showCanvasPreview();
      });
    }, 900);
  };

  tl.init = function (canvasId, captionId) {
    tl.canvas = document.getElementById(canvasId);
    tl.captionEl = document.getElementById(captionId);
    tl.videoEl = document.getElementById("spell-loop-video");
    tl.statusEl = document.getElementById("spell-loop-video-status");
    tl.downloadEl = document.getElementById("spell-loop-download-video");
    tl.rebuildBtn = document.getElementById("spell-loop-rebuild-video");
    if (!tl.canvas) return;
    tl.ctx = tl.canvas.getContext("2d");
    if (!tl.resizeBound) {
      tl.resizeBound = true;
      window.addEventListener("resize", resize);
    }
    if (tl.rebuildBtn && !tl.rebuildBtn.dataset.bound) {
      tl.rebuildBtn.dataset.bound = "1";
      tl.rebuildBtn.addEventListener("click", function () {
        tl.buildVideo().catch(function (err) {
          setVideoStatus(err.message || "Rebuild failed.", true);
        });
      });
    }
    resize();
  };

  tl.restartRun = function () {
    tl.time = 0;
    tl.detailBoost = 0;
  };

  tl.setStasisVision = function (url, stasisText, opts) {
    opts = opts || {};
    tl.stasisText = stasisText || "";
    tl.stasisImageUrl = url || "";
    if (!url) {
      tl.stasisImage = null;
      if (!tl.running && spellforgePanelVisible()) tl.start();
      return Promise.resolve();
    }
    return loadImage(url).then(function (img) {
      tl.stasisImage = img;
      if (opts.schedule !== false) tl.scheduleVideoBuild(!!opts.force);
    });
  };

  tl.useCanvas = function (canvas) {
    if (!canvas) return;
    tl.canvas = canvas;
    tl.ctx = canvas.getContext("2d");
  };

  tl.buildVideoStandalone = function (opts) {
    opts = opts || {};
    var prevCanvas = tl.canvas;
    var prevCtx = tl.ctx;
    if (opts.canvas) {
      tl.useCanvas(opts.canvas);
      if (opts.width) tl.canvas.width = opts.width;
      if (opts.height) tl.canvas.height = opts.height;
    } else {
      resize();
    }
    var nums = opts.nums || tl.equippedNums;
    if (!nums || nums.length < 2) {
      return Promise.reject(new Error("Equip at least 2 spells."));
    }
    return tl
      .configure({
        stasisText: opts.stasisText || tl.stasisText,
        livePrompt: opts.livePrompt || "",
        nums: nums,
        activeBuzz: opts.activeBuzz || tl.activeBuzz,
      })
      .then(function () {
        if (opts.visionUrl) {
          return tl.setStasisVision(opts.visionUrl, opts.stasisText || tl.stasisText, {
            schedule: false,
          });
        }
        return null;
      })
      .then(function () {
        return tl.buildVideo();
      })
      .finally(function () {
        if (prevCanvas) {
          tl.canvas = prevCanvas;
          tl.ctx = prevCtx;
        }
      });
  };

  tl.configure = function (opts) {
    opts = opts || {};
    if (opts.stasisText != null) {
      tl.stasisText = opts.stasisText;
      tl.palette = paletteFromText(tl.stasisText + " " + (opts.livePrompt || ""));
    }
    if (opts.livePrompt != null) tl.livePrompt = opts.livePrompt;
    if (opts.activeBuzz) tl.activeBuzz = opts.activeBuzz.slice();
    if (opts.palette) tl.palette = opts.palette;
    if (opts.nums && opts.nums.length >= 2) {
      var key = opts.nums.join(",");
      if (key !== tl.lastNumsKey) {
        tl.lastNumsKey = key;
        tl.equippedNums = opts.nums.slice();
        tl.spellTokens = buildSpellTokens(opts.nums);
        tl.restartRun();
      }
      return loadPreviewPaintings(opts.nums).then(function () {
        tl.scheduleVideoBuild();
      });
    }
    if (opts.nums && opts.nums.length < 2) {
      tl.spellTokens = [];
      tl.lastNumsKey = "";
      tl.stop();
      tl.scheduleVideoBuild();
    }
    return Promise.resolve();
  };

  tl.setBuzz = function (words) {
    tl.activeBuzz = (words || []).slice();
  };

  tl.setLivePrompt = function (text) {
    tl.livePrompt = text || "";
    tl.palette = paletteFromText(tl.stasisText + " " + tl.livePrompt);
  };

  tl.start = function () {
    if (tl.running) return;
    tl.running = true;
    tick();
  };

  tl.stop = function () {
    tl.running = false;
    if (tl.raf) cancelAnimationFrame(tl.raf);
  };

  window.SpellTimelapse = tl;
  window.SpellLoop = {
    init: tl.init,
    resize: resize,
    start: tl.start,
    stop: tl.stop,
    restartRun: tl.restartRun,
    buildVideo: tl.buildVideo,
    buildVideoStandalone: tl.buildVideoStandalone,
    scheduleVideoBuild: tl.scheduleVideoBuild,
    canvas: null,
    setState: function (nums, fused, meta, stasisText, promptText, freshUrls) {
      var buzz = (fused && fused.combined_tags) || meta.tags || [];
      if (promptText) {
        buzz = buzz.concat(
          String(promptText)
            .toLowerCase()
            .split(/[,;\s]+/)
            .map(function (w) {
              return w.trim();
            })
            .filter(function (w) {
              return w.length > 2;
            })
        );
      }
      tl.setBuzz(buzz);
      tl.configure({
        stasisText: stasisText,
        livePrompt: promptText || "",
        nums: nums,
      }).then(function () {
        window.SpellLoop.canvas = tl.canvas;
        resize();
        if (freshUrls && freshUrls[0]) {
          tl.setStasisVision(freshUrls[0], stasisText);
        } else if (tl.stasisImageUrl) {
          tl.setStasisVision(tl.stasisImageUrl, stasisText);
        } else {
          tl.scheduleVideoBuild();
        }
      });
    },
  };
  window.SpellLoop.canvas = tl.canvas;
})();