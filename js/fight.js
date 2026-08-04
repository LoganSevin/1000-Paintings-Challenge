/**
 * Fight — 4-fighter arena with AI costume creation, keyframe anims,
 * keyboard/gamepad, CPU, LAN lobby, training sandbox, map builder.
 */
(function () {
  "use strict";

  var W = 1280;
  var H = 720;
  var GRAVITY = 2400;
  var ROUND_TIME = 99;
  var MAX_FIGHTERS = 4;
  /**
   * Stage: scenic still behind, ground underfoot.
   * Fighters are hero-scale subjects (like the gen still centerfold), not stickers.
   */
  var STAGE = {
    halfW: 380,
    depth: 220,
    cam: { x: 0, y: 120, z: 420 },
    fov: 480,
    groundY: 0,
    /** Lower horizon = more ground, taller hero characters */
    horizon: 0.48,
    /** World-unit body height so project() yields ~55–70% of canvas height */
    heroH: 320,
    heroW: 200,
  };

  var state = {
    mode: "create",
    roster: [],
    selectedId: null,
    draftDataUrl: "",
    draftLabel: "",
    src: "paintings",
    srcItems: [],
    srcLoading: false,
    maps: [],
    currentMapId: "scene-rain-street",
    match: null,
    train: null,
    mapEdit: {
      name: "Custom Dome",
      prompt: "",
      edge: "cliff",
      sceneUrl: "",
      sceneImg: null,
    },
    sceneCache: {},
    lan: { room: null, playerId: "", poll: 0 },
    keys: {},
    pads: {},
    padButtons: {},
    time: 0,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function setStatus(id, msg, kind) {
    var el = $(id);
    if (!el) return;
    el.textContent = msg || "";
    el.className = "ft-status" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
  }

  function uid() {
    return "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function loadImg(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("Image load failed"));
      };
      img.src = url;
    });
  }

  function measureOpaqueBounds(canvas) {
    var ctx = canvas.getContext("2d");
    var w = canvas.width;
    var h = canvas.height;
    var d = ctx.getImageData(0, 0, w, h).data;
    var minX = w,
      minY = h,
      maxX = 0,
      maxY = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] >= 200) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX <= minX || maxY <= minY) {
      return { x: 0, y: 0, w: w, h: h, aspect: h / w };
    }
    return {
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
      aspect: (maxY - minY + 1) / (maxX - minX + 1),
    };
  }

  /**
   * Do NOT soft-feather character alpha — that put holes in outfits.
   * Kept as a no-op for any leftover call sites.
   */
  function featherCanvas(c, frac) {
    return c;
  }

  /**
   * Plain studio plate for gens. Alpha is edge-flood + body/FX keep (no green screen).
   */
  var KEY_BG = {
    hex: "#2a2a32",
    label: "plain seamless flat medium-dark studio gray (#2a2a32)",
    r: 0x2a,
    g: 0x2a,
    b: 0x32,
  };

  function isLegacyChroma(r, g, b) {
    if (g > 160 && r < 80 && b < 80 && g > r + 70 && g > b + 70) return true;
    if (r > 180 && b > 180 && g < 70) return true;
    return false;
  }

  function colorDistRgb(r, g, b, r2, g2, b2) {
    return Math.abs(r - r2) + Math.abs(g - g2) + Math.abs(b - b2);
  }

  /**
   * Keep the fighter body plus detached spell/skill FX; drop plate crumbs.
   * Identity stills: largest only. Cells: largest + vivid / sizable islands (energy orbs).
   */
  function keepBodyAndFxComponents(d, w, h, keepFx) {
    var seen = new Uint8Array(w * h);
    var stack = new Int32Array(w * h * 2);
    var components = [];
    var sp, x, y, p, nx, ny, np, size, sx, sy, i;
    var maxChroma, maxLum, r, g, b, ch;

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        p = y * w + x;
        if (seen[p] || d[p * 4 + 3] < 200) continue;
        sp = 0;
        stack[sp++] = x;
        stack[sp++] = y;
        seen[p] = 1;
        var cells = [p];
        size = 1;
        maxChroma = 0;
        maxLum = 0;
        while (sp > 0) {
          sy = stack[--sp];
          sx = stack[--sp];
          var ii = (sy * w + sx) * 4;
          r = d[ii];
          g = d[ii + 1];
          b = d[ii + 2];
          ch = Math.max(r, g, b) - Math.min(r, g, b);
          if (ch > maxChroma) maxChroma = ch;
          var lum = (r + g + b) / 3;
          if (lum > maxLum) maxLum = lum;
          var dirs = [1, 0, -1, 0, 0, 1, 0, -1];
          for (i = 0; i < 8; i += 2) {
            nx = sx + dirs[i];
            ny = sy + dirs[i + 1];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            np = ny * w + nx;
            if (seen[np] || d[np * 4 + 3] < 200) continue;
            seen[np] = 1;
            stack[sp++] = nx;
            stack[sp++] = ny;
            cells.push(np);
            size++;
          }
        }
        components.push({
          cells: cells,
          size: size,
          maxChroma: maxChroma,
          maxLum: maxLum,
        });
      }
    }
    if (!components.length) return;
    components.sort(function (a, b) {
      return b.size - a.size;
    });
    var bestSize = components[0].size;
    if (bestSize < 40) return;
    var keep = new Uint8Array(w * h);
    for (i = 0; i < components.length; i++) {
      var c = components[i];
      var isBody = i === 0;
      var keepThis = isBody;
      if (keepFx && !isBody) {
        // Detached spell/skill blobs: vivid or large relative to body; drop dull plate crumbs
        var isBigEnough = c.size >= bestSize * 0.1;
        var isFx =
          c.size >= 48 &&
          (c.maxChroma >= 42 || c.maxLum >= 200) &&
          c.size >= bestSize * 0.012;
        keepThis = isBigEnough || isFx;
      }
      if (keepThis) {
        for (var j = 0; j < c.cells.length; j++) keep[c.cells[j]] = 1;
      }
    }
    for (p = 0; p < w * h; p++) {
      if (!keep[p] && d[p * 4 + 3] > 0) {
        d[p * 4] = 0;
        d[p * 4 + 1] = 0;
        d[p * 4 + 2] = 0;
        d[p * 4 + 3] = 0;
      }
    }
  }

  /** Identity still: largest blob only (no floating plate). */
  function keepLargestComponent(d, w, h) {
    keepBodyAndFxComponents(d, w, h, false);
  }

  function solidifyBinaryAlpha(d) {
    var i;
    for (i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0) d[i + 3] = 255;
      else {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 0;
      }
    }
  }

  /**
   * Restore paint inside fully enclosed transparent pockets (alpha holes in the body).
   * origD = pre-key RGB; d = working buffer after edge flood.
   */
  function fillEnclosedAlphaHoles(origD, d, w, h) {
    var seen = new Uint8Array(w * h);
    var stack = new Int32Array(w * h * 2);
    var x, y, p, sp, sx, sy, nx, ny, np, i, touchesEdge, cells;

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        p = y * w + x;
        if (seen[p] || d[p * 4 + 3] >= 128) continue;
        sp = 0;
        stack[sp++] = x;
        stack[sp++] = y;
        seen[p] = 1;
        cells = [p];
        touchesEdge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        while (sp > 0) {
          sy = stack[--sp];
          sx = stack[--sp];
          var dirs = [1, 0, -1, 0, 0, 1, 0, -1];
          for (i = 0; i < 8; i += 2) {
            nx = sx + dirs[i];
            ny = sy + dirs[i + 1];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            np = ny * w + nx;
            if (seen[np] || d[np * 4 + 3] >= 128) continue;
            seen[np] = 1;
            stack[sp++] = nx;
            stack[sp++] = ny;
            cells.push(np);
            if (nx === 0 || ny === 0 || nx === w - 1 || ny === h - 1) touchesEdge = true;
          }
        }
        // Interior hole only — restore original color so body stays solid
        if (!touchesEdge && cells.length > 0 && cells.length < w * h * 0.35) {
          for (i = 0; i < cells.length; i++) {
            var pi = cells[i] * 4;
            d[pi] = origD[pi];
            d[pi + 1] = origD[pi + 1];
            d[pi + 2] = origD[pi + 2];
            d[pi + 3] = 255;
          }
        }
      }
    }
  }

  /**
   * Morphological close on binary alpha: fill 1–2px pinholes without eating niches.
   */
  function morphCloseAlpha(d, w, h, rounds) {
    rounds = rounds == null ? 1 : rounds;
    var r, x, y, p, k, nx, ny, any, ar, ag, ab, nn, ni;
    var tmp = new Uint8Array(w * h);
    function dilate() {
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          p = y * w + x;
          any = d[p * 4 + 3] >= 200;
          if (!any) {
            if (x > 0 && d[(y * w + (x - 1)) * 4 + 3] >= 200) any = true;
            else if (x < w - 1 && d[(y * w + (x + 1)) * 4 + 3] >= 200) any = true;
            else if (y > 0 && d[((y - 1) * w + x) * 4 + 3] >= 200) any = true;
            else if (y < h - 1 && d[((y + 1) * w + x) * 4 + 3] >= 200) any = true;
          }
          tmp[p] = any ? 1 : 0;
        }
      }
      for (p = 0; p < w * h; p++) {
        if (tmp[p] && d[p * 4 + 3] < 200) {
          ar = ag = ab = nn = 0;
          x = p % w;
          y = (p / w) | 0;
          var neigh = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ];
          for (k = 0; k < 4; k++) {
            nx = neigh[k][0];
            ny = neigh[k][1];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            ni = (ny * w + nx) * 4;
            if (d[ni + 3] >= 200) {
              ar += d[ni];
              ag += d[ni + 1];
              ab += d[ni + 2];
              nn++;
            }
          }
          if (nn) {
            d[p * 4] = (ar / nn) | 0;
            d[p * 4 + 1] = (ag / nn) | 0;
            d[p * 4 + 2] = (ab / nn) | 0;
            d[p * 4 + 3] = 255;
          }
        }
      }
    }
    function erode() {
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          p = y * w + x;
          any = d[p * 4 + 3] >= 200;
          if (any) {
            if (x > 0 && d[(y * w + (x - 1)) * 4 + 3] < 200) any = false;
            else if (x < w - 1 && d[(y * w + (x + 1)) * 4 + 3] < 200) any = false;
            else if (y > 0 && d[((y - 1) * w + x) * 4 + 3] < 200) any = false;
            else if (y < h - 1 && d[((y + 1) * w + x) * 4 + 3] < 200) any = false;
          }
          tmp[p] = any ? 1 : 0;
        }
      }
      for (p = 0; p < w * h; p++) {
        if (!tmp[p] && d[p * 4 + 3] >= 200) {
          d[p * 4] = 0;
          d[p * 4 + 1] = 0;
          d[p * 4 + 2] = 0;
          d[p * 4 + 3] = 0;
        }
      }
    }
    for (r = 0; r < rounds; r++) {
      dilate();
      erode();
    }
  }

  /**
   * Clean alpha for arena composite:
   * - 0 = backdrop (edge flood through niches; never punch body holes)
   * - 255 = solid body / FX
   * @param {{mode?: 'identity'|'strip'|'cell'|'anim'}} opts
   */
  function removeBackground(canvas, opts) {
    opts = opts || {};
    var mode = opts.mode || "identity";
    if (mode === "anim") mode = "cell";
    if (!canvas || !canvas.width) return canvas;
    var ctx = canvas.getContext("2d");
    var w = canvas.width;
    var h = canvas.height;
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    var origD = new Uint8ClampedArray(d);
    function pix(x, y) {
      return (y * w + x) * 4;
    }

    // Sample plate from corners + outer rim (not mid-edge limbs)
    var mr = 0,
      mg = 0,
      mb = 0,
      n = 0;
    var x, y, i, samples, si;
    samples = [
      [1, 1],
      [w - 2, 1],
      [1, h - 2],
      [w - 2, h - 2],
      [(w / 2) | 0, 1],
      [(w / 4) | 0, 1],
      [((3 * w) / 4) | 0, 1],
      [1, (h / 4) | 0],
      [w - 2, (h / 4) | 0],
    ];
    var step = Math.max(1, (Math.min(w, h) / 18) | 0);
    for (x = 0; x < w; x += step) {
      samples.push([x, 0]);
      samples.push([x, 1]);
      samples.push([x, h - 1]);
      samples.push([x, h - 2]);
    }
    for (y = 0; y < h; y += step) {
      samples.push([0, y]);
      samples.push([1, y]);
      samples.push([w - 1, y]);
      samples.push([w - 2, y]);
    }
    for (si = 0; si < samples.length; si++) {
      x = samples[si][0];
      y = samples[si][1];
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      i = pix(x, y);
      if (d[i + 3] < 8) continue;
      mr += d[i];
      mg += d[i + 1];
      mb += d[i + 2];
      n++;
    }
    if (n < 4) {
      mr = KEY_BG.r;
      mg = KEY_BG.g;
      mb = KEY_BG.b;
    } else {
      mr = (mr / n) | 0;
      mg = (mg / n) | 0;
      mb = (mb / n) | 0;
    }
    mr = ((mr * 2 + KEY_BG.r) / 3) | 0;
    mg = ((mg * 2 + KEY_BG.g) / 3) | 0;
    mb = ((mb * 2 + KEY_BG.b) / 3) | 0;

    // Plate match: studio key + sampled rim + common AI plain plates (only via edge flood)
    var thresh = mode === "strip" ? 50 : 58;

    function isPlateRgb(r, g, b) {
      if (isLegacyChroma(r, g, b)) return true;
      var chroma = Math.max(r, g, b) - Math.min(r, g, b);
      var lum = (r + g + b) / 3;
      var distB = colorDistRgb(r, g, b, mr, mg, mb);
      var distK = colorDistRgb(r, g, b, KEY_BG.r, KEY_BG.g, KEY_BG.b);
      if (distB < 32 || distK < 32) return true;
      if (chroma <= 24 && (distB < thresh || distK < thresh + 6)) return true;
      if (chroma <= 16 && (distB < thresh + 14 || distK < thresh + 16)) return true;
      // Light gray / off-white studio plates AI often invents
      if (chroma <= 18 && lum >= 165 && lum <= 245 && (distB < 70 || lum > 200)) return true;
      // Near-black void plates
      if (chroma <= 14 && lum <= 28) return true;
      return false;
    }

    function isPlate(ii) {
      return isPlateRgb(d[ii], d[ii + 1], d[ii + 2]);
    }

    // 8-connected edge flood — wraps niches (armpits, legs, weapon gaps)
    var seen = new Uint8Array(w * h);
    var stack = [];
    function seed(sx, sy) {
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
      var p = sy * w + sx;
      if (seen[p]) return;
      var ii = p * 4;
      if (d[ii + 3] < 4) {
        seen[p] = 1;
        d[ii] = 0;
        d[ii + 1] = 0;
        d[ii + 2] = 0;
        d[ii + 3] = 0;
        stack.push(sx, sy);
        return;
      }
      if (!isPlate(ii)) return;
      seen[p] = 1;
      d[ii] = 0;
      d[ii + 1] = 0;
      d[ii + 2] = 0;
      d[ii + 3] = 0;
      stack.push(sx, sy);
    }
    for (x = 0; x < w; x++) {
      seed(x, 0);
      seed(x, h - 1);
    }
    for (y = 0; y < h; y++) {
      seed(0, y);
      seed(w - 1, y);
    }
    while (stack.length) {
      y = stack.pop();
      x = stack.pop();
      seed(x + 1, y);
      seed(x - 1, y);
      seed(x, y + 1);
      seed(x, y - 1);
      seed(x + 1, y + 1);
      seed(x + 1, y - 1);
      seed(x - 1, y + 1);
      seed(x - 1, y - 1);
    }

    solidifyBinaryAlpha(d);

    // Fill alpha holes punched inside the character (never leave swiss-cheese body)
    if (mode === "cell" || mode === "identity") {
      fillEnclosedAlphaHoles(origD, d, w, h);
      solidifyBinaryAlpha(d);
      morphCloseAlpha(d, w, h, 1);
      solidifyBinaryAlpha(d);
    }

    if (mode === "identity") {
      keepLargestComponent(d, w, h);
    } else if (mode === "cell") {
      keepBodyAndFxComponents(d, w, h, true);
    }

    solidifyBinaryAlpha(d);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /**
   * Perfect clean alpha for one strip cell.
   * Key while plate margins still exist; crop AFTER — never re-flood a tight crop
   * (that was re-sampling character edges as "plate" and punching holes).
   */
  function bakeCellAlpha(canvas) {
    if (!canvas || !canvas.width) return canvas;
    // Light pad so edge flood can wrap every niche even if AI drew to the cell edge
    var pad = Math.max(4, Math.round(Math.min(canvas.width, canvas.height) * 0.04));
    var padded = document.createElement("canvas");
    padded.width = canvas.width + pad * 2;
    padded.height = canvas.height + pad * 2;
    var pctx = padded.getContext("2d");
    pctx.fillStyle = KEY_BG.hex;
    pctx.fillRect(0, 0, padded.width, padded.height);
    pctx.drawImage(canvas, pad, pad);
    removeBackground(padded, { mode: "cell" });
    var cropped = tightCropCanvas(padded) || padded;
    // Final solidify only — no second flood
    try {
      var id = cropped.getContext("2d").getImageData(0, 0, cropped.width, cropped.height);
      solidifyBinaryAlpha(id.data);
      cropped.getContext("2d").putImageData(id, 0, 0);
    } catch (e) {}
    cropped._keyedOk = true;
    return cropped;
  }

  /**
   * Composite cutout onto a tall 3:4 studio plate with LARGE margins so the
   * model always sees a full-body figure (not a face-fill / bust crop).
   */
  function compositeOnKeyPlateDataUrl(src) {
    return (typeof src === "string" ? loadImg(src) : Promise.resolve(src)).then(function (img) {
      if (!img) throw new Error("No image for plate composite");
      var iw = img.naturalWidth || img.width;
      var ih = img.naturalHeight || img.height;
      if (!iw || !ih) throw new Error("Empty image");
      // Fixed vertical canvas — matches FRAME_ASPECT generation
      var outW = 540;
      var outH = 720;
      var c = document.createElement("canvas");
      c.width = outW;
      c.height = outH;
      var ctx = c.getContext("2d");
      ctx.fillStyle = KEY_BG.hex;
      ctx.fillRect(0, 0, outW, outH);
      // Character uses ~72% of height max — always leave head/foot plate margin
      var maxW = outW * 0.7;
      var maxH = outH * 0.72;
      var sc = Math.min(maxW / iw, maxH / ih);
      var dw = Math.max(2, Math.round(iw * sc));
      var dh = Math.max(2, Math.round(ih * sc));
      var dx = ((outW - dw) / 2) | 0;
      // Feet toward bottom third, not glued to edge
      var dy = ((outH - dh) * 0.55) | 0;
      if (dy + dh > outH - 12) dy = outH - 12 - dh;
      if (dy < 12) dy = 12;
      ctx.drawImage(img, dx, dy, dw, dh);
      return c.toDataURL("image/png");
    });
  }

  /** Require full body before spending multi-frame credits. */
  function assertFullBodySource(src, label) {
    label = label || "Image";
    return (typeof src === "string" ? loadImg(src) : Promise.resolve(src)).then(function (img) {
      var c = document.createElement("canvas");
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      // Key lightly then score — raw plates need alpha to measure silhouette
      removeBackground(c, { mode: "identity" });
      var check = assessFullBody(c, null);
      if (!check.ok) {
        throw new Error(
          label +
            " is not a complete full-body character (" +
            check.reason +
            "). Re-generate the fighter still head-to-toe before baking anims — multi-frame is blocked to protect your credits."
        );
      }
      return img;
    });
  }

  function refineSilhouette(canvas) {
    return canvas;
  }

  function softProtectAura(canvas) {
    return canvas;
  }

  /** Identity still: high-quality cutout once. */
  function bakeIdentityAlphaStill(img) {
    if (!img || !(img.naturalWidth || img.width)) return null;
    var full = bakeFullBody(img);
    if (!full) return null;
    removeBackground(full, { mode: "identity" });
    return full;
  }

  function canvasToPngDataUrl(canvas) {
    try {
      return canvas.toDataURL("image/png");
    } catch (e) {
      return "";
    }
  }

  /**
   * Game draw: trust frames marked _keyedOk only if plate is gone.
   * Otherwise force full clean alpha (never stamp studio gray into the arena).
   */
  function ensureKeyedCanvas(src, mode) {
    if (!src) return null;
    if (src._keyedOk && src.getContext && typeof edgeHasOpaquePlate === "function" && !edgeHasOpaquePlate(src)) {
      return src;
    }
    if (src._ensureKeyCache && src._ensureKeyCache._keyedOk) return src._ensureKeyCache;
    var m = mode || "identity";
    var out = null;
    if ((m === "anim" || m === "cell") && typeof processAnimFrame === "function") {
      out = processAnimFrame(src);
    }
    if (!out) {
      var w = src.naturalWidth || src.width;
      var h = src.naturalHeight || src.height;
      if (!w || !h) return src;
      var c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(src, 0, 0, w, h);
      removeBackground(c, { mode: m === "anim" ? "cell" : m });
      var cropped = tightCropCanvas(c) || c;
      if (typeof edgeHasOpaquePlate === "function" && edgeHasOpaquePlate(cropped)) {
        removeBackground(cropped, { mode: m === "anim" ? "cell" : m });
      }
      try {
        var id = cropped.getContext("2d").getImageData(0, 0, cropped.width, cropped.height);
        solidifyBinaryAlpha(id.data);
        cropped.getContext("2d").putImageData(id, 0, 0);
      } catch (e) {}
      cropped._keyedOk = true;
      out = cropped;
    }
    if (out) {
      out._keyedOk = true;
      try {
        src._ensureKeyCache = out;
      } catch (e2) {}
    }
    return out || src;
  }

  function countOpaque(c) {
    if (!c || !c.width) return 0;
    try {
      var d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      var n = 0;
      for (var i = 3; i < d.length; i += 4) if (d[i] >= 200) n++;
      return n;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Reject incomplete gens (bust, half-body, scrap) so we don't keep/spend more
   * credits on unusable frames. Full character = head region + torso + feet region.
   * @returns {{ok:boolean, reason:string, score:number}}
   */
  function assessFullBody(src, animName) {
    if (!src) return { ok: false, reason: "empty image", score: 0 };
    var w = src.width || src.naturalWidth || 0;
    var h = src.height || src.naturalHeight || 0;
    if (!w || !h) return { ok: false, reason: "empty image", score: 0 };
    var c = src.getContext ? src : null;
    if (!c) {
      c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      try {
        c.getContext("2d").drawImage(src, 0, 0, w, h);
      } catch (e) {
        return { ok: false, reason: "unreadable image", score: 0 };
      }
    }
    var opaque = countOpaque(c);
    if (opaque < 600) return { ok: false, reason: "almost empty (not a character)", score: 0 };
    var b;
    try {
      b = measureOpaqueBounds(c);
    } catch (e2) {
      return { ok: false, reason: "no silhouette", score: 0 };
    }
    if (!b || b.w < 8 || b.h < 8) return { ok: false, reason: "no silhouette", score: 0 };

    var aspect = b.h / Math.max(1, b.w);
    var fill = opaque / Math.max(1, b.w * b.h);
    var heightFrac = b.h / Math.max(1, h);
    var allowWide = animName === "ko" || animName === "fall";
    // Full-body standing poses are tall; KO downed may be wider
    if (!allowWide && aspect < 1.12) {
      return {
        ok: false,
        reason: "cropped / bust / half-body (not full height)",
        score: aspect,
      };
    }
    if (allowWide && aspect < 0.42) {
      return { ok: false, reason: "scrap (too flat)", score: aspect };
    }
    if (fill < 0.12) {
      return { ok: false, reason: "sparse scrap (not solid character)", score: fill };
    }
    // After key, content should still be a substantial figure
    if (heightFrac < 0.28 && b.h < 140) {
      return { ok: false, reason: "tiny / incomplete figure", score: heightFrac };
    }

    // Head band (top of silhouette) + feet band (bottom) must both have paint
    try {
      var d = c.getContext("2d").getImageData(b.x, b.y, b.w, b.h).data;
      var band = Math.max(3, (b.h * 0.2) | 0);
      var topN = 0;
      var botN = 0;
      var midN = 0;
      var x, y, i;
      for (y = 0; y < b.h; y++) {
        for (x = 0; x < b.w; x++) {
          i = (y * b.w + x) * 4;
          if (d[i + 3] < 200) continue;
          if (y < band) topN++;
          else if (y >= b.h - band) botN++;
          else midN++;
        }
      }
      var bandArea = Math.max(1, band * b.w);
      if (topN / bandArea < 0.02) {
        return { ok: false, reason: "missing head / top of body", score: topN / bandArea };
      }
      if (botN / bandArea < 0.015 && !allowWide) {
        return { ok: false, reason: "missing legs / feet (half character)", score: botN / bandArea };
      }
      if (midN < opaque * 0.2) {
        return { ok: false, reason: "broken / incomplete body mass", score: midN };
      }
    } catch (e3) {
      /* bounds check enough */
    }

    return { ok: true, reason: "full body", score: aspect * fill };
  }

  /**
   * Read opaque silhouette: per-row min/max X, find arm band (widest rows).
   */
  function analyzeSilhouette(canvas) {
    var ctx = canvas.getContext("2d");
    var w = canvas.width;
    var h = canvas.height;
    var d = ctx.getImageData(0, 0, w, h).data;
    var rows = [];
    var minX = w,
      maxX = 0,
      minY = h,
      maxY = 0;
    for (var y = 0; y < h; y++) {
      var lo = -1,
        hi = -1;
      for (var x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] >= 200) {
          if (lo < 0) lo = x;
          hi = x;
        }
      }
      if (lo >= 0) {
        rows[y] = { lo: lo, hi: hi, mid: (lo + hi) * 0.5, span: hi - lo + 1 };
        if (lo < minX) minX = lo;
        if (hi > maxX) maxX = hi;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX <= minX) {
      return { minX: 0, maxX: w - 1, minY: 0, maxY: h - 1, bodyL: w * 0.35, bodyR: w * 0.65, armY0: h * 0.18, armY1: h * 0.4 };
    }
    // Widest rows in upper 45% = arm span
    var yArmEnd = minY + (maxY - minY) * 0.48;
    var bestSpan = 0;
    var armRows = [];
    for (y = minY; y <= yArmEnd; y++) {
      if (!rows[y]) continue;
      if (rows[y].span > bestSpan) bestSpan = rows[y].span;
    }
    var armY0 = minY + (maxY - minY) * 0.12;
    var armY1 = minY + (maxY - minY) * 0.38;
    var found = false;
    for (y = minY; y <= yArmEnd; y++) {
      if (!rows[y]) continue;
      if (rows[y].span >= bestSpan * 0.82) {
        if (!found) {
          armY0 = y;
          found = true;
        }
        armY1 = y;
        armRows.push(rows[y]);
      }
    }
    // Body column from mid-torso rows (narrower than arms)
    var t0 = minY + (maxY - minY) * 0.28;
    var t1 = minY + (maxY - minY) * 0.55;
    var mids = [];
    var bodySpans = [];
    for (y = (t0 | 0); y <= t1; y++) {
      if (!rows[y]) continue;
      mids.push(rows[y].mid);
      bodySpans.push(rows[y].span);
    }
    mids.sort(function (a, b) {
      return a - b;
    });
    bodySpans.sort(function (a, b) {
      return a - b;
    });
    var mid = mids.length ? mids[(mids.length / 2) | 0] : (minX + maxX) * 0.5;
    var bodySpan = bodySpans.length ? bodySpans[(bodySpans.length * 0.35) | 0] : (maxX - minX) * 0.35;
    // Prefer torso width from non-arm rows if arms are clearly wider
    if (bestSpan > bodySpan * 1.25) bodySpan = Math.min(bodySpan, bestSpan * 0.42);
    var bodyL = mid - bodySpan * 0.5;
    var bodyR = mid + bodySpan * 0.5;
    bodyL = clamp(bodyL, minX, maxX);
    bodyR = clamp(bodyR, minX, maxX);
    if (bodyR - bodyL < w * 0.12) {
      bodyL = mid - w * 0.12;
      bodyR = mid + w * 0.12;
    }
    return {
      minX: minX,
      maxX: maxX,
      minY: minY,
      maxY: maxY,
      mid: mid,
      bodyL: bodyL,
      bodyR: bodyR,
      armY0: armY0,
      armY1: Math.max(armY1, armY0 + 8),
      hipY: minY + (maxY - minY) * 0.5,
      rows: rows,
    };
  }

  function cutPart(full, x, y, w, h, soft) {
    if (!full || w < 2 || h < 2) return null;
    x = Math.max(0, Math.floor(x));
    y = Math.max(0, Math.floor(y));
    w = Math.min(Math.floor(w), full.width - x);
    h = Math.min(Math.floor(h), full.height - y);
    if (w < 2 || h < 2) return null;
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(full, x, y, w, h, 0, 0, w, h);
    // Ignore soft-edge requests — character alpha must stay fully solid
    return c;
  }

  /**
   * Bake T-pose still: scale, key background to alpha, tight crop to body.
   */
  function bakeFullBody(img) {
    if (!img || !img.naturalWidth) return null;
    var iw = img.naturalWidth;
    var ih = img.naturalHeight;
    var maxSide = 560;
    var sc = Math.min(1, maxSide / Math.max(iw, ih));
    var w = Math.max(2, Math.round(iw * sc));
    var h = Math.max(2, Math.round(ih * sc));
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    removeBackground(c, { mode: "identity" });
    try {
      var b = measureOpaqueBounds(c);
      if (b.w > 12 && b.h > 12) {
        var pad = 1;
        var x = Math.max(0, b.x - pad);
        var y = Math.max(0, b.y - pad);
        var bw = Math.min(c.width - x, b.w + pad * 2);
        var bh = Math.min(c.height - y, b.h + pad * 2);
        var crop = document.createElement("canvas");
        crop.width = bw;
        crop.height = bh;
        crop.getContext("2d").drawImage(c, x, y, bw, bh, 0, 0, bw, bh);
        return crop;
      }
    } catch (e) {}
    return c;
  }

  /**
   * Dissect T-pose using silhouette analysis (not fixed fractions).
   * Full-length arms from body to fingertips — one piece per side so they don't vanish.
   */
  function dissectTPose(full) {
    if (!full) return null;
    var W = full.width;
    var H = full.height;
    var A = analyzeSilhouette(full);
    var bw = Math.max(1, A.maxX - A.minX);
    var bh = Math.max(1, A.maxY - A.minY);

    function cutPx(x, y, w, h, soft) {
      return cutPart(full, x, y, w, h, soft);
    }
    function flipH(src) {
      if (!src) return null;
      var c = document.createElement("canvas");
      c.width = src.width;
      c.height = src.height;
      var x = c.getContext("2d");
      x.translate(c.width, 0);
      x.scale(-1, 1);
      x.drawImage(src, 0, 0);
      return c;
    }

    // Head: top of body column
    var headY0 = A.minY;
    var headY1 = A.minY + bh * 0.22;
    var head = cutPx(A.bodyL - bw * 0.02, headY0, A.bodyR - A.bodyL + bw * 0.04, headY1 - headY0, true);

    // Torso: body column neck→hips (shoulders included a bit, not full arm wings)
    var torY0 = A.minY + bh * 0.14;
    var torY1 = A.hipY + bh * 0.06;
    var torso = cutPx(A.bodyL - bw * 0.04, torY0, A.bodyR - A.bodyL + bw * 0.08, torY1 - torY0, true);

    // Arms: full span from torso edge to silhouette tip (single piece — upper+lower together)
    var armPad = Math.max(4, (A.armY1 - A.armY0) * 0.35);
    var armY0 = Math.max(A.minY, A.armY0 - armPad);
    var armY1 = Math.min(A.maxY, A.armY1 + armPad);
    var armH = Math.max(8, armY1 - armY0);
    // Right arm (shoulder at bodyR → hand at maxX)
    var armRX0 = A.bodyR - bw * 0.06;
    var armRW = Math.max(8, A.maxX - armRX0 + 2);
    var armR = cutPx(armRX0, armY0, armRW, armH, true);
    // Left arm raw then flip so shoulder is on left of crop (matches right layout)
    var armLX1 = A.bodyL + bw * 0.06;
    var armLX0 = A.minX - 2;
    var armLW = Math.max(8, armLX1 - armLX0);
    var armLraw = cutPx(armLX0, armY0, armLW, armH, true);
    var armL = flipH(armLraw);

    // Legs
    var legY0 = A.hipY - bh * 0.02;
    var legMid = (A.bodyL + A.bodyR) * 0.5;
    var legRU = cutPx(legMid - 2, legY0, A.bodyR - legMid + bw * 0.08, (A.maxY - legY0) * 0.52, true);
    var legRL = cutPx(legMid - 2, legY0 + (A.maxY - legY0) * 0.45, A.bodyR - legMid + bw * 0.08, (A.maxY - legY0) * 0.55, true);
    var legLU = cutPx(A.bodyL - bw * 0.06, legY0, legMid - A.bodyL + 4, (A.maxY - legY0) * 0.52, true);
    var legLL = cutPx(A.bodyL - bw * 0.06, legY0 + (A.maxY - legY0) * 0.45, legMid - A.bodyL + 4, (A.maxY - legY0) * 0.55, true);

    // Weapon: outer right strip if present
    var weapon = cutPx(A.bodyR + bw * 0.15, A.minY + bh * 0.15, Math.max(8, A.maxX - A.bodyR - bw * 0.1), bh * 0.5, true);

    var parts = {
      full: full,
      head: head,
      torso: torso,
      armR: armR,
      armL: armL,
      // Keep split aliases for elbow bend (half of full arm)
      armRU: armR,
      armRL: armR,
      armLU: armL,
      armLL: armL,
      legRU: legRU,
      legRL: legRL,
      legLU: legLU,
      legLL: legLL,
      weapon: weapon,
    };

    function piv(c, px, py) {
      if (!c) return null;
      return { c: c, w: c.width, h: c.height, px: c.width * px, py: c.height * py };
    }
    // Half-arm pivots: use full arm for both segments with different UV via draw later
    // Shoulder pivot near medial edge, mid-height
    var armRUpp = piv(armR, 0.08, 0.5);
    var armLUpp = piv(armL, 0.08, 0.5);
    // For single-piece arms we only use upper pivot; elbow bend applies mild second draw of outer half

    function frac(px, py) {
      return { x: px / W, y: py / H };
    }
    var shY = (armY0 + armY1) * 0.5;
    var neckY = A.minY + bh * 0.18;
    var hipY = A.hipY;

    var torsoOpaque = countOpaque(torso);
    // Limb swings when we have clear arm mass (T-pose armspan OR solid arm strips)
    var armSpan = A.maxX - A.minX;
    var bodySpan = Math.max(1, A.bodyR - A.bodyL);
    var hasTPoseArms = armSpan > bodySpan * 1.35;
    var armROk = countOpaque(armR) > 40 && armR && armR.width > 10;
    var armLOk = countOpaque(armL) > 40 && armL && armL.width > 10;
    var limbsOk = torsoOpaque > 80 && armROk && (hasTPoseArms || armLOk);

    return {
      parts: parts,
      head: piv(head, 0.5, 0.88),
      torso: piv(torso, 0.5, 0.92),
      armRU: armRUpp,
      armRL: armR ? { c: armR, w: armR.width, h: armH, px: armR.width * 0.08, py: armR.height * 0.5, half: true } : null,
      armLU: armLUpp,
      armLL: armL ? { c: armL, w: armL.width, h: armH, px: armL.width * 0.08, py: armL.height * 0.5, half: true } : null,
      // Prefer single full arm draw
      armR: armRUpp,
      armL: armLUpp,
      legRU: piv(legRU, 0.5, 0.06),
      legRL: piv(legRL, 0.5, 0.06),
      legLU: piv(legLU, 0.5, 0.06),
      legLL: piv(legLL, 0.5, 0.06),
      weapon: piv(weapon, 0.3, 0.1),
      neck: frac((A.bodyL + A.bodyR) * 0.5, neckY),
      shR: frac(A.bodyR - bw * 0.02, shY),
      shL: frac(A.bodyL + bw * 0.02, shY),
      hipR: frac((legMid + A.bodyR) * 0.5, hipY),
      hipL: frac((legMid + A.bodyL) * 0.5, hipY),
      hipC: frac(legMid, hipY),
      fw: W,
      fh: H,
      limbsOk: limbsOk,
      singleArm: true,
    };
  }

  /**
   * One identity still — roster + base sprite. Multi-frame clips attach separately.
   */
  function attachFighterSprite(f, bodyImg) {
    f.img = bodyImg || null;
    f.parts = null;
    f.rig = null;
    f.sprite = null;
    f.headSprite = null;
    f.torsoSprite = null;
    f.frameClips = f.frameClips || null;
    f.silhouette = { aspect: 1.55 };
    if (!bodyImg || !bodyImg.naturalWidth) return;
    try {
      var full = bakeFullBody(bodyImg);
      if (!full) {
        f.sprite = bodyImg;
        return;
      }
      f.sprite = full;
      f.silhouette = {
        aspect: clamp(full.height / Math.max(1, full.width), 0.75, 2.4),
        contentH: 1,
        contentW: 1,
      };
    } catch (e) {
      f.sprite = bodyImg;
      f.silhouette = {
        aspect: clamp(bodyImg.naturalHeight / Math.max(1, bodyImg.naturalWidth), 0.75, 2.4),
      };
    }
  }

  /**
   * Per-frame animation defs (ONE full-body pose per AI call — never multi-panel strips).
   * Consistent vertical 3:4 so orientation never flips landscape/portrait mid-set.
   */
  var SPRITE_BOX = { w: 280, h: 400 };
  var FRAME_ASPECT = "3:4";

  var FRAME_STRIPS = {
    idle: {
      loop: true,
      fps: 8,
      hitFrame: null,
      frames: [
        "idle FIGHTING STANCE facing RIGHT, calm BREATHING: chest low, shoulders relaxed, mouth soft, feet planted, weapon ready if any",
        "idle same stance facing RIGHT, INHALE / light PANT: ribcage rises, chest expands, shoulders lift a little, same feet",
        "idle same stance facing RIGHT, peak breath or soft PANT: chest highest, head barely lifts, readable breathing silhouette",
        "idle same stance facing RIGHT, EXHALE settle: chest lowers, return toward first pose, continuous breathing loop",
      ],
    },
    walk: {
      loop: true,
      fps: 14,
      frames: [
        "WALK CYCLE facing RIGHT moving right: LEFT foot forward stride, RIGHT leg back, arms/weapon counter-swing, clear leg motion",
        "WALK CYCLE facing RIGHT: legs PASSING mid-stride, body upright, continuous walk, same scale",
        "WALK CYCLE facing RIGHT: RIGHT foot forward stride, LEFT leg back, arms counter-swing, clear leg motion",
        "WALK CYCLE facing RIGHT: legs PASSING again, ready to loop, same baseline and height",
      ],
    },
    punch: {
      loop: false,
      fps: 14,
      hitFrame: 2,
      frames: [
        "GROUND punch facing RIGHT: wind-up, rear hand/weapon cocked BACK, hips load, feet planted",
        "GROUND punch facing RIGHT: fist/weapon thrusting FORWARD to the right, body rotates into punch",
        "GROUND punch IMPACT facing RIGHT: full extension FORWARD (right), clear attack silhouette, weight forward",
        "GROUND punch recovery facing RIGHT: arm returns, guard reset, same framing",
      ],
    },
    kick: {
      loop: false,
      fps: 13,
      hitFrame: 2,
      frames: [
        "GROUND kick facing RIGHT: chamber RIGHT knee up, balance on left, wind-up",
        "GROUND kick facing RIGHT: right leg extending FORWARD to the right",
        "GROUND kick IMPACT facing RIGHT: full kick out to the RIGHT, readable leg attack",
        "GROUND kick recovery facing RIGHT: foot returns, stance reset",
      ],
    },
    spell: {
      loop: false,
      fps: 12,
      hitFrame: 2,
      frames: [
        "GROUND spell facing RIGHT: gather energy at hands/weapon near body, aiming RIGHT",
        "GROUND spell facing RIGHT: hands/weapon rise, energy builds, still aiming RIGHT",
        "GROUND spell RELEASE facing RIGHT: thrust energy FORWARD to the right, solid outlined VFX",
        "GROUND spell settle facing RIGHT: energy fades, guard returns",
      ],
    },
    special: {
      loop: false,
      fps: 13,
      hitFrame: 2,
      frames: [
        "SPECIAL facing RIGHT: dramatic wind-up, body loads, weapon ready if any",
        "SPECIAL facing RIGHT: launch FORWARD to the right mid-move, aggressive silhouette",
        "SPECIAL IMPACT facing RIGHT: peak strike FORWARD, clear power pose",
        "SPECIAL recovery facing RIGHT: end lag, same baseline",
      ],
    },
    finisher: {
      loop: false,
      fps: 12,
      hitFrame: 2,
      frames: [
        "FINISHER facing RIGHT: super power-up pose, weapon raised if any, aura ready",
        "FINISHER facing RIGHT: leap or charge FORWARD mid-air toward the right",
        "FINISHER IMPACT facing RIGHT: devastating strike FORWARD, huge readable pose",
        "FINISHER end lag facing RIGHT: settle after super",
      ],
    },
    block: {
      loop: true,
      fps: 5,
      frames: [
        "DEFENSE BLOCK facing RIGHT: high guard, arms/weapon RAISED protecting head and chest, feet set",
        "DEFENSE BLOCK facing RIGHT: tighter braced guard, shoulders tense, clearly blocking not idle",
      ],
    },
    hit: {
      loop: false,
      fps: 12,
      frames: [
        "HIT RECOIL facing RIGHT: sharp IMPACT flinch, body snaps BACK/left, clear pain reaction",
        "HIT RECOIL: stronger knockback lean, arms flail or guard breaks, still full body",
        "HIT RECOIL: stumble recover, off-balance, full body visible",
      ],
    },
    ko: {
      loop: false,
      fps: 8,
      frames: [
        "KO: struck hard, body crumples, full body",
        "KO: falling toward the ground mid-air, limp, full body",
        "KO DOWNED on the ground: flat / side-lying INCAPACITATED, eyes closed ASLEEP defeated, not standing",
      ],
    },
    jump: {
      loop: false,
      fps: 10,
      frames: [
        "JUMP PREP: deep crouch, knees bent, arms back, about to leap, full body",
        "JUMP AIRBORNE PEAK: body high in air, knees tucked or extended, apex of jump, full body",
        "JUMP LAND PREP: falling, legs ready to absorb impact, about to land, full body",
      ],
    },
    air_punch: {
      loop: false,
      fps: 14,
      hitFrame: 1,
      frames: [
        "AERIAL punch IN AIR facing RIGHT: body airborne, fist/weapon cocked while jumping",
        "AERIAL punch IMPACT IN AIR facing RIGHT: fist thrusts FORWARD mid-air (not standing on ground)",
        "AERIAL punch recovery IN AIR facing RIGHT: still airborne after swing",
      ],
    },
    air_kick: {
      loop: false,
      fps: 13,
      hitFrame: 1,
      frames: [
        "AERIAL kick IN AIR facing RIGHT: flying knee chamber mid-jump",
        "AERIAL kick IMPACT IN AIR facing RIGHT: leg kicks FORWARD while airborne (not grounded kick)",
        "AERIAL kick recovery IN AIR facing RIGHT: still in air after kick",
      ],
    },
    air_spell: {
      loop: false,
      fps: 12,
      hitFrame: 1,
      frames: [
        "AERIAL spell IN AIR facing RIGHT: gather energy mid-jump, aiming RIGHT",
        "AERIAL spell RELEASE IN AIR facing RIGHT: cast energy FORWARD while airborne, solid VFX",
        "AERIAL spell settle IN AIR facing RIGHT: still jumping after cast",
      ],
    },
  };

  function tightCropCanvas(src) {
    if (!src) return null;
    try {
      var b = measureOpaqueBounds(src);
      if (b.w < 4 || b.h < 4) return src;
      var c = document.createElement("canvas");
      c.width = b.w;
      c.height = b.h;
      c.getContext("2d").drawImage(src, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
      return c;
    } catch (e) {
      return src;
    }
  }

  /** True if opaque studio-plate color still clings to image edges (alpha failed). */
  function edgeHasOpaquePlate(canvas) {
    if (!canvas || !canvas.width) return false;
    try {
      var w = canvas.width;
      var h = canvas.height;
      var d = canvas.getContext("2d").getImageData(0, 0, w, h).data;
      var hits = 0;
      var checks = 0;
      var step = Math.max(1, (Math.min(w, h) / 16) | 0);
      function check(x, y) {
        var i = (y * w + x) * 4;
        if (d[i + 3] < 200) return;
        checks++;
        var r = d[i];
        var g = d[i + 1];
        var b = d[i + 2];
        var chroma = Math.max(r, g, b) - Math.min(r, g, b);
        var dist = colorDistRgb(r, g, b, KEY_BG.r, KEY_BG.g, KEY_BG.b);
        if (chroma <= 28 && dist < 55) hits++;
        if (isLegacyChroma(r, g, b)) hits++;
      }
      var x, y;
      for (x = 0; x < w; x += step) {
        check(x, 0);
        check(x, 1);
        check(x, h - 1);
        check(x, h - 2);
      }
      for (y = 0; y < h; y += step) {
        check(0, y);
        check(1, y);
        check(w - 1, y);
        check(w - 2, y);
      }
      return checks > 0 && hits / checks > 0.12;
    } catch (e) {
      return false;
    }
  }

  /**
   * Place keyed character in fixed box. Optional fixedScale locks size across a clip
   * (prevents bobbing / growing between frames).
   */
  function fitInSpriteBox(src, boxW, boxH, fixedScale) {
    boxW = boxW || SPRITE_BOX.w;
    boxH = boxH || SPRITE_BOX.h;
    if (!src || !(src.width || src.naturalWidth)) return src;
    var sw = src.width || src.naturalWidth;
    var sh = src.height || src.naturalHeight;
    var b;
    try {
      b = measureOpaqueBounds(src);
    } catch (e) {
      b = null;
    }
    if (!b || b.w < 4 || b.h < 4) {
      b = { x: 0, y: 0, w: sw, h: sh };
    }
    var margin = 0.08;
    var innerW = boxW * (1 - margin * 2);
    var innerH = boxH * (1 - margin * 2);
    var sc =
      fixedScale && fixedScale > 0
        ? fixedScale
        : Math.min(innerW / b.w, innerH / b.h);
    // Never upscale past box
    var maxSc = Math.min(innerW / b.w, innerH / b.h);
    if (sc > maxSc) sc = maxSc;
    var dw = Math.max(1, b.w * sc);
    var dh = Math.max(1, b.h * sc);
    var c = document.createElement("canvas");
    c.width = boxW;
    c.height = boxH;
    var ctx = c.getContext("2d");
    ctx.clearRect(0, 0, boxW, boxH);
    var dx = (boxW - dw) / 2;
    // Shared foot baseline for every frame
    var dy = boxH * (1 - margin) - dh;
    if (dy < boxH * margin) dy = boxH * margin;
    ctx.drawImage(src, b.x, b.y, b.w, b.h, dx, dy, dw, dh);
    c._keyedOk = true;
    return c;
  }

  /**
   * After a clip's frames are keyed: same scale + same foot line so motion is fluent
   * (no size jitter / bobbing between cells).
   */
  function normalizeClipFrames(frames) {
    if (!frames || !frames.length) return frames;
    var boxW = SPRITE_BOX.w;
    var boxH = SPRITE_BOX.h;
    var margin = 0.08;
    var innerW = boxW * (1 - margin * 2);
    var innerH = boxH * (1 - margin * 2);
    var bounds = [];
    var maxW = 1;
    var maxH = 1;
    var i;
    for (i = 0; i < frames.length; i++) {
      var fr = frames[i];
      if (!fr) {
        bounds.push(null);
        continue;
      }
      var b;
      try {
        b = measureOpaqueBounds(fr);
      } catch (e) {
        b = null;
      }
      if (!b || b.w < 2) {
        b = {
          x: 0,
          y: 0,
          w: fr.width || boxW,
          h: fr.height || boxH,
        };
      }
      bounds.push(b);
      if (b.w > maxW) maxW = b.w;
      if (b.h > maxH) maxH = b.h;
    }
    // One scale for the whole clip — tallest/widest pose still fits
    var sc = Math.min(innerW / maxW, innerH / maxH) * 0.98;
    var out = [];
    for (i = 0; i < frames.length; i++) {
      if (!frames[i] || !bounds[i]) continue;
      var bb = bounds[i];
      var c = document.createElement("canvas");
      c.width = boxW;
      c.height = boxH;
      var ctx = c.getContext("2d");
      ctx.clearRect(0, 0, boxW, boxH);
      var dw = bb.w * sc;
      var dh = bb.h * sc;
      var dx = (boxW - dw) / 2;
      var dy = boxH * (1 - margin) - dh;
      if (dy < boxH * margin) dy = boxH * margin;
      ctx.drawImage(frames[i], bb.x, bb.y, bb.w, bb.h, dx, dy, dw, dh);
      scrubPlateFringe(c, 4);
      solidifyCanvas(c);
      c._keyedOk = true;
      out.push(c);
    }
    return out;
  }

  function solidifyCanvas(canvas) {
    if (!canvas || !canvas.width) return canvas;
    try {
      var id = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      solidifyBinaryAlpha(id.data);
      canvas.getContext("2d").putImageData(id, 0, 0);
    } catch (e) {}
    return canvas;
  }

  /**
   * Peel studio-plate fringe that still touches transparent (stamped bg on silhouette).
   * Does not punch holes inside the body (interior pixels lack transparent neighbors).
   */
  function scrubPlateFringe(canvas, rounds) {
    if (!canvas || !canvas.width) return canvas;
    rounds = rounds == null ? 4 : rounds;
    try {
      var w = canvas.width;
      var h = canvas.height;
      var ctx = canvas.getContext("2d");
      var img = ctx.getImageData(0, 0, w, h);
      var d = img.data;
      var r, x, y, i, ch, dist, a, kill;
      function isPlatePx(i) {
        if (d[i + 3] < 200) return false;
        if (isLegacyChroma(d[i], d[i + 1], d[i + 2])) return true;
        ch = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        dist = colorDistRgb(d[i], d[i + 1], d[i + 2], KEY_BG.r, KEY_BG.g, KEY_BG.b);
        return ch <= 26 && dist < 58;
      }
      function touchesClear(x, y) {
        var n;
        var dirs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (n = 0; n < 4; n++) {
          var nx = x + dirs[n][0];
          var ny = y + dirs[n][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true;
          if (d[(ny * w + nx) * 4 + 3] < 128) return true;
        }
        return false;
      }
      for (r = 0; r < rounds; r++) {
        kill = [];
        for (y = 0; y < h; y++) {
          for (x = 0; x < w; x++) {
            i = (y * w + x) * 4;
            if (!isPlatePx(i)) continue;
            if (touchesClear(x, y)) kill.push(i);
          }
        }
        if (!kill.length) break;
        for (a = 0; a < kill.length; a++) {
          i = kill[a];
          d[i] = 0;
          d[i + 1] = 0;
          d[i + 2] = 0;
          d[i + 3] = 0;
        }
      }
      solidifyBinaryAlpha(d);
      ctx.putImageData(img, 0, 0);
    } catch (e) {}
    return canvas;
  }

  /**
   * Full pipeline for one AI still → clean-alpha crop.
   * Clip-level normalizeClipFrames() locks scale/baseline after all poses land.
   */
  function processAnimFrame(src, opts) {
    opts = opts || {};
    if (!src) return null;
    var w = src.naturalWidth || src.width;
    var h = src.naturalHeight || src.height;
    if (!w || !h) return null;
    var raw = document.createElement("canvas");
    raw.width = w;
    raw.height = h;
    raw.getContext("2d").drawImage(src, 0, 0, w, h);
    var keyed = bakeCellAlpha(raw);
    if (!keyed) return null;
    removeBackground(keyed, { mode: "cell" });
    solidifyCanvas(keyed);
    scrubPlateFringe(keyed, 5);
    fillEnclosedOnCanvas(keyed);
    solidifyCanvas(keyed);
    keyed = tightCropCanvas(keyed) || keyed;
    if (opts.skipBox) {
      keyed._keyedOk = true;
      return keyed;
    }
    var boxed = fitInSpriteBox(keyed, SPRITE_BOX.w, SPRITE_BOX.h, opts.fixedScale || 0);
    removeBackground(boxed, { mode: "cell" });
    solidifyCanvas(boxed);
    scrubPlateFringe(boxed, 6);
    fillEnclosedOnCanvas(boxed);
    solidifyCanvas(boxed);
    boxed._keyedOk = true;
    try {
      delete boxed._ensureKeyCache;
    } catch (e) {}
    return boxed;
  }

  function fillEnclosedOnCanvas(canvas) {
    if (!canvas || !canvas.width) return;
    try {
      var ctx = canvas.getContext("2d");
      var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var orig = new Uint8ClampedArray(img.data);
      fillEnclosedAlphaHoles(orig, img.data, canvas.width, canvas.height);
      solidifyBinaryAlpha(img.data);
      ctx.putImageData(img, 0, 0);
    } catch (e) {}
  }

  /**
   * Force clean alpha on every frame of every known clip on a fighter card.
   * Safe to call on already-keyed frames (re-processes in place).
   */
  function ensureCleanAlphaAllClips(card) {
    if (!card || !card.frameClips) return 0;
    var count = 0;
    var names = CLIP_BAKE_ORDER.slice();
    Object.keys(card.frameClips).forEach(function (n) {
      if (names.indexOf(n) < 0) names.push(n);
    });
    names.forEach(function (animName) {
      var clip = card.frameClips[animName];
      if (!clip || !clip.frames || !clip.frames.length) return;
      var next = [];
      var i;
      for (i = 0; i < clip.frames.length; i++) {
        var fr = clip.frames[i];
        if (!fr) continue;
        var clean = processAnimFrame(fr, { skipBox: true });
        if (clean && countOpaque(clean) > 40 && assessFullBody(clean, animName).ok) {
          next.push(clean);
        }
        // drop incomplete frames — never keep half-characters
      }
      next = normalizeClipFrames(next);
      count += next.length;
      clip.frames = next;
    });
    card._hoverSrcCache = null;
    card._alphasClean = true;
    return count;
  }

  /**
   * ONE full-body pose per request. Incomplete results are rejected (not saved).
   */
  function buildFramePrompt(animName, frameIndex, poseText, costumeHint, opts) {
    opts = opts || {};
    var def = FRAME_STRIPS[animName];
    if (!def) return null;
    var n = (def.frames && def.frames.length) || 1;
    var fi = (frameIndex | 0) + 1;
    var noText =
      "NO text, letters, numbers, captions, name tags, logos, watermarks, or UI anywhere. ";
    var plate =
      "BACKGROUND: pure flat seamless " +
      KEY_BG.label +
      " only — no floor, room, gradient, or environment. ";
    var framing =
      "Match the attached FULL-BODY reference: same camera distance, same character scale, " +
      "same full figure head-to-feet. Do NOT zoom in on face or torso. Do NOT crop legs. " +
      "Pose change only. Weapons from the reference stay and are used in the action. ";
    return {
      stasis:
        FULL_BODY_RULE +
        "2D fighting-game animation frame (single pose). " +
        framing +
        noText +
        plate +
        "Beat " +
        fi +
        "/" +
        n +
        " · " +
        animName +
        ": " +
        (poseText || "fighting pose") +
        ". Thick black outline, solid opaque body. " +
        (costumeHint ? "Outfit (not as text): " + costumeHint + ". " : ""),
      prompt:
        "full body fighter head to feet both legs, same scale as reference, not zoomed not bust, " +
        animName +
        " pose, thick black outline, flat " +
        KEY_BG.hex +
        ", no text, " +
        (poseText || "fighting pose"),
      buzz_words: [
        "full body head to feet",
        "both legs both feet visible",
        "not zoomed not bust not cropped",
        "same scale as reference",
        "street fighter sprite",
        "no text",
        "thick black outline",
        "flat " + KEY_BG.hex + " background",
        animName,
      ],
    };
  }

  /**
   * Current animation frame for a fighter (real multi-frame when baked).
   * Returns primary frame; sets f._frameBlend for 60fps crossfade between cells.
   */
  /** Resolve which clip name to play (fallbacks for missing air clips, etc.). */
  function resolveClipName(f, name) {
    var clips = f.frameClips;
    if (!clips) return name;
    if (clips[name] && clips[name].frames && clips[name].frames.length) return name;
    if (name === "air_punch" && clips.punch) return "punch";
    if (name === "air_kick" && clips.kick) return "kick";
    if (name === "air_spell" && clips.spell) return "spell";
    if (name === "special" && clips.punch) return "punch";
    if (name === "finisher" && (clips.spell || clips.punch)) return clips.spell ? "spell" : "punch";
    if (name === "fall" && clips.ko) return "ko";
    if (name === "jump" && clips.idle) return "idle";
    return name;
  }

  /**
   * Jump pose from vertical state: crouch prep → airborne peak → land prep.
   * Keeps jump clips in sync with real jump physics.
   */
  function jumpFrameIndex(f, n) {
    if (n < 1) return 0;
    if (n === 1) return 0;
    if (n === 2) return f.onGround ? 0 : 1;
    // 3+ frames: 0 crouch, 1 peak, 2 land-prep
    if (f.jumpPhase === "land" || (f.onGround && f.animT > 0.12 && f._wasAirborne)) {
      return n - 1;
    }
    if (!f.onGround) {
      if (f.vy > 80) return Math.min(1, n - 1); // rising / peak
      return Math.min(2, n - 1); // falling — prep land
    }
    // still on ground at jump start = crouch
    return 0;
  }

  function sampleAnimFrame(f) {
    f._frameBlend = 0;
    f._frameNext = null;
    var clips = f.frameClips;
    var name = f.anim || "idle";
    if (clips) {
      name = resolveClipName(f, name);
      var clip = clips[name];
      if (clip && clip.frames && clip.frames.length) {
        var fps = clip.fps || 10;
        var n = clip.frames.length;
        var fi, next, blend, frac;
        // Jump: drive frames from physics phase so it reads as real jump
        if (f.anim === "jump" && n >= 2) {
          fi = jumpFrameIndex(f, n);
          next = Math.min(n - 1, fi + (f.onGround ? 0 : 1));
          blend = f.onGround ? 0 : clamp(0.35 + Math.abs(f.vy) / 900, 0, 0.65);
          f._frameIndex = fi;
          f._frameClip = name;
          f._frameNext = next !== fi ? clip.frames[next] : null;
          f._frameBlend = blend * 0.5;
          return clip.frames[fi];
        }
        var t = Math.max(0, f.animT) * fps;
        if (clip.loop) {
          fi = Math.floor(t) % n;
          next = (fi + 1) % n;
          frac = t - Math.floor(t);
        } else {
          fi = Math.min(n - 1, Math.floor(t));
          next = Math.min(n - 1, fi + 1);
          frac = fi >= n - 1 ? 0 : t - Math.floor(t);
        }
        blend = frac * frac * (3 - 2 * frac);
        f._frameIndex = fi;
        f._frameClip = name;
        f._frameNext = next !== fi ? clip.frames[next] : null;
        f._frameBlend = blend;
        return clip.frames[fi];
      }
    }
    f._frameIndex = 0;
    return f.sprite || f.img;
  }

  function animUsesFrames(f) {
    var clips = f.frameClips;
    if (!clips) return false;
    var n = resolveClipName(f, f.anim || "idle");
    return !!(clips[n] && clips[n].frames && clips[n].frames.length > 1);
  }

  /** Hit window from multi-frame clip when available. */
  function isAnimHitWindow(f) {
    var clips = f.frameClips;
    var name = resolveClipName(f, f.anim);
    var clip = clips && clips[name];
    if (clip && clip.hitFrame != null && clip.frames && clip.frames.length) {
      var fps = clip.fps || 10;
      var t0 = clip.hitFrame / fps;
      var t1 = (clip.hitFrame + 1.15) / fps;
      return f.animT >= t0 && f.animT <= t1;
    }
    return sampleAnim(f.anim, f.animT).hitWindow;
  }

  function frameClipDuration(f, animName) {
    var clips = f.frameClips;
    var clip = clips && clips[animName];
    if (clip && clip.frames && clip.frames.length && !clip.loop) {
      return clip.frames.length / (clip.fps || 10);
    }
    var def = ANIMS[animName];
    return def ? def.dur : 0.4;
  }

  /** Draw a cut limb/part rotated about its pivot — native size, no warp stretch. */
  function drawRigPart(ctx, part, x, y, angle, scale, flipX) {
    if (!part || !part.c) return;
    ctx.save();
    ctx.translate(x, y);
    if (flipX) ctx.scale(-1, 1);
    ctx.rotate(angle);
    var s = scale;
    ctx.drawImage(part.c, -part.px * s, -part.py * s, part.w * s, part.h * s);
    ctx.restore();
  }

  /** Tip of a limb segment (for chaining elbow/knee/hand). */
  function limbTip(x, y, angle, length) {
    return { x: x + Math.cos(angle) * length, y: y + Math.sin(angle) * length };
  }

  /**
   * Articulated pose: joint angles in radians.
   * Arms: 0 ≈ down, positive swings forward (toward +X, attack direction).
   * Legs: 0 ≈ down, positive swings forward.
   */
  function sampleJoints(anim, t) {
    var def = ANIMS[anim] || ANIMS.idle;
    var u = def.loop ? (t % def.dur) / def.dur : clamp(t / def.dur, 0, 1);
    var phase = u * Math.PI * 2;
    // defaults idle
    var j = {
      rSh: 0.25,
      rEl: 0.35,
      lSh: -0.2,
      lEl: 0.3,
      rHip: 0.08,
      rKn: 0.12,
      lHip: -0.08,
      lKn: 0.12,
      torso: 0,
      bob: 0,
      spell: 0,
      fist: 0,
    };
    if (anim === "idle") {
      j.bob = Math.sin(phase) * 4;
      j.rSh = 0.2 + Math.sin(phase) * 0.06;
      j.lSh = -0.2 - Math.sin(phase) * 0.06;
    } else if (anim === "walk") {
      j.bob = Math.abs(Math.sin(phase)) * 8;
      j.rHip = Math.sin(phase) * 0.55;
      j.lHip = Math.sin(phase + Math.PI) * 0.55;
      j.rKn = 0.2 + Math.max(0, Math.sin(phase)) * 0.55;
      j.lKn = 0.2 + Math.max(0, Math.sin(phase + Math.PI)) * 0.55;
      j.rSh = Math.sin(phase + Math.PI) * 0.45;
      j.lSh = Math.sin(phase) * 0.45;
      j.rEl = 0.4;
      j.lEl = 0.4;
      j.torso = Math.sin(phase) * 0.04;
    } else if (anim === "punch") {
      // Joint offset from DOWN: + = cock back, − = swing forward (toward facing)
      if (u < 0.2) {
        var w = u / 0.2;
        j.rSh = 0.2 + w * 1.3;
        j.rEl = 0.4 + w * 1.0;
        j.torso = -w * 0.15;
        j.lSh = -0.35;
        j.lEl = 0.5;
      } else if (u < 0.5) {
        var p = (u - 0.2) / 0.3;
        j.rSh = 1.5 - p * 3.1;
        j.rEl = 1.4 - p * 1.15;
        j.torso = -0.15 + p * 0.35;
        j.fist = p;
        j.lSh = -0.5;
        j.rHip = p * 0.2;
      } else {
        var r = (u - 0.5) / 0.5;
        j.rSh = -1.6 + r * 1.85;
        j.rEl = 0.25 + r * 0.15;
        j.torso = 0.2 * (1 - r);
        j.fist = 1 - r;
        j.lSh = -0.25;
      }
    } else if (anim === "kick") {
      if (u < 0.22) {
        var k0 = u / 0.22;
        j.rHip = k0 * 0.5;
        j.rKn = 0.3 + k0 * 1.2;
        j.torso = -k0 * 0.12;
        j.lSh = 0.4;
        j.rSh = 0.5;
      } else if (u < 0.52) {
        var k1 = (u - 0.22) / 0.3;
        j.rHip = 0.5 - k1 * 2.3;
        j.rKn = 1.5 - k1 * 1.1;
        j.torso = -0.12 + k1 * 0.25;
        j.fist = k1;
        j.lHip = k1 * 0.15;
      } else {
        var k2 = (u - 0.52) / 0.48;
        j.rHip = -1.8 + k2 * 1.9;
        j.rKn = 0.4;
        j.torso = 0.13 * (1 - k2);
        j.fist = 1 - k2;
      }
    } else if (anim === "spell") {
      // Both arms raise overhead, channel, release forward
      if (u < 0.35) {
        var s0 = u / 0.35;
        j.rSh = 0.2 - s0 * 2.4;
        j.lSh = -0.2 - s0 * 2.2;
        j.rEl = 0.3 + s0 * 0.9;
        j.lEl = 0.3 + s0 * 0.9;
        j.spell = s0 * 0.55;
        j.bob = -s0 * 12;
      } else if (u < 0.7) {
        var s1 = (u - 0.35) / 0.35;
        j.rSh = -2.2 + Math.sin(s1 * 14) * 0.1;
        j.lSh = -2.4 + Math.sin(s1 * 14 + 1) * 0.1;
        j.rEl = 1.1;
        j.lEl = 1.1;
        j.spell = 0.55 + s1 * 0.45;
        j.bob = -12 - Math.sin(s1 * 10) * 5;
        j.torso = Math.sin(s1 * 8) * 0.06;
      } else {
        var s2 = (u - 0.7) / 0.3;
        j.rSh = -2.2 + s2 * 0.9;
        j.lSh = -2.4 + s2 * 1.0;
        j.spell = 1 - s2 * 0.25;
        j.bob = -12 * (1 - s2);
        j.fist = s2;
      }
    } else if (anim === "special") {
      if (u < 0.4) {
        var sp = u / 0.4;
        j.rSh = 0.2 - sp * 2.5;
        j.lSh = -0.2 - sp * 1.4;
        j.rEl = sp * 0.8;
        j.rHip = -sp * 0.4;
        j.spell = sp;
        j.torso = sp * 0.18;
        j.bob = -sp * 18;
      } else {
        var sp2 = (u - 0.4) / 0.6;
        j.rSh = -2.3 + sp2 * 0.6;
        j.lSh = -1.6;
        j.rHip = -0.4 - sp2 * 1.3;
        j.rKn = sp2 * 0.6;
        j.spell = 1;
        j.fist = sp2;
        j.torso = 0.18 - sp2 * 0.08;
      }
    } else if (anim === "finisher") {
      var wave = Math.sin(u * Math.PI);
      j.rSh = -wave * 2.6;
      j.lSh = -wave * 2.3;
      j.rHip = -Math.sin(u * Math.PI * 2) * 1.1;
      j.lHip = Math.sin(u * Math.PI * 2) * 0.6;
      j.spell = wave;
      j.fist = wave;
      j.bob = -wave * 32;
      j.torso = Math.sin(u * Math.PI * 2) * 0.18;
    } else if (anim === "block") {
      j.rSh = -0.9;
      j.lSh = -0.75;
      j.rEl = 1.5;
      j.lEl = 1.45;
      j.torso = 0.1;
    } else if (anim === "hit") {
      j.torso = 0.28 * Math.sin(u * Math.PI);
      j.rSh = 0.8;
      j.lSh = 0.5;
      j.bob = Math.sin(u * Math.PI) * 8;
    } else if (anim === "fall" || anim === "ko") {
      j.torso = u * (anim === "ko" ? 1.35 : 1.05);
      j.rSh = u * 1.4;
      j.lSh = u * 0.9;
      j.rHip = u * 0.7;
      j.lHip = -u * 0.35;
      j.bob = u * (anim === "ko" ? 24 : 12);
    } else if (anim === "jump") {
      j.rHip = 0.55;
      j.lHip = 0.5;
      j.rKn = 1.0;
      j.lKn = 0.95;
      j.rSh = -0.9;
      j.lSh = -0.8;
      j.bob = -u * 8;
    }
    return j;
  }

  function drawLimbCapsule(ctx, x0, y0, ang, len, thick, color, color2) {
    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(ang);
    var grd = ctx.createLinearGradient(0, 0, len, 0);
    grd.addColorStop(0, color);
    grd.addColorStop(1, color2 || color);
    ctx.fillStyle = grd;
    ctx.beginPath();
    // rounded capsule along +X
    var r = thick / 2;
    ctx.moveTo(r, -r);
    ctx.lineTo(len - r, -r);
    ctx.arc(len - r, 0, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(r, r);
    ctx.arc(r, 0, r, Math.PI / 2, -Math.PI / 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    return { x: x0 + Math.cos(ang) * len, y: y0 + Math.sin(ang) * len };
  }

  function drawJointBall(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---------- generative dome scenes ---------- */
  function builtInScenes() {
    return [
      {
        id: "scene-rain-street",
        name: "Rain Street",
        edge: "wall",
        prompt:
          "cinematic rainy night city street, wet asphalt ground, neon reflections, fighting-game stage background, empty midground for characters, no people",
        procedural: "neon",
      },
      {
        id: "scene-temple",
        name: "Temple Courtyard",
        edge: "wall",
        prompt:
          "ancient temple courtyard at golden hour, stone paving ground, dramatic sky, epic stage still, empty of people, cinematic",
        procedural: "storm",
      },
      {
        id: "scene-cliff",
        name: "Cliff Overlook",
        edge: "cliff",
        prompt:
          "windswept cliff overlook arena, rocky ground, ocean and storm clouds, vast scenic still, no characters in frame",
        procedural: "void",
      },
      {
        id: "scene-dojo",
        name: "Bamboo Dojo",
        edge: "wall",
        prompt:
          "open bamboo dojo with polished wooden floor, soft mist forest beyond, serene cinematic stage background, no people",
        procedural: "aurora",
      },
    ];
  }

  function defaultMap() {
    return builtInScenes()[0];
  }

  function getMap(id) {
    id = id || state.currentMapId;
    for (var i = 0; i < state.maps.length; i++) {
      if (state.maps[i].id === id) return state.maps[i];
    }
    var built = builtInScenes();
    for (var j = 0; j < built.length; j++) {
      if (built[j].id === id) return built[j];
    }
    return defaultMap();
  }

  function ensureSceneImage(map) {
    if (!map) return Promise.resolve(null);
    if (map.sceneImg && map.sceneImg.complete) return Promise.resolve(map.sceneImg);
    if (map.sceneUrl) {
      return loadImg(map.sceneUrl)
        .then(function (img) {
          map.sceneImg = img;
          state.sceneCache[map.id] = img;
          return img;
        })
        .catch(function () {
          return null;
        });
    }
    return Promise.resolve(null);
  }

  /** Project stage (wx, height, wz) → screen. Feet sit on the ground band. */
  function project(wx, hy, wz) {
    var cam = STAGE.cam;
    var lookZ = Math.max(70, cam.z - wz);
    var scale = STAGE.fov / lookZ;
    // Anchor ground near bottom third so hero-scale fighters fill the frame
    var groundScreenY = H * 0.88;
    var y = groundScreenY - hy * scale * 0.95 - (wz * 0.12);
    // mild parallax: deeper = slightly higher on screen (into the painting)
    y -= wz * 0.08;
    return {
      x: W / 2 + (wx - cam.x) * scale * 0.95,
      y: y,
      s: scale,
      depth: lookZ,
    };
  }

  function groundLineY() {
    return H * 0.72;
  }

  /** Screen pixel height for a hero fighter at this world depth */
  function heroScreenScale(wz) {
    var pr = project(0, 0, wz || 0);
    // Aim for ~0.62 of canvas height for body at mid-stage
    var target = H * 0.62;
    var base = STAGE.heroH * (pr.s / 1.15);
    return clamp(target / Math.max(80, STAGE.heroH), 1.6, 3.2) * clamp(pr.s / 1.1, 0.85, 1.25);
  }

  /**
   * Fighting-game motion (SF / MK style feel on a single full-body still).
   * Keys are whole-body poses: step (ox), hop (oy), squash (scX/scY), lean (rot),
   * smear trails, attack power (reach/kick/glow). Phases ≈ startup → active → recovery.
   * Not multi-frame sprite sheets — but timing, weight, and hitstop read like a fighter.
   */
  var ANIMS = {
    idle: {
      loop: true,
      dur: 1.4,
      keys: [
        { t: 0, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0 },
        { t: 0.5, ox: 0, oy: -2, scX: 1.008, scY: 0.992, rot: 0.008 },
        { t: 1, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0 },
      ],
    },
    walk: {
      loop: true,
      dur: 0.48,
      keys: [
        { t: 0, ox: 0, oy: 0, scX: 1, scY: 1, rot: -0.025 },
        { t: 0.25, ox: 3, oy: -5, scX: 0.995, scY: 1.01, rot: 0.02 },
        { t: 0.5, ox: 0, oy: 0, scX: 1.005, scY: 0.995, rot: 0.025 },
        { t: 0.75, ox: -2, oy: -5, scX: 0.995, scY: 1.01, rot: -0.02 },
        { t: 1, ox: 0, oy: 0, scX: 1, scY: 1, rot: -0.025 },
      ],
    },
    // Subtle human weight — no cartoon squash that makes them look alien
    punch: {
      loop: false,
      dur: 0.36,
      hit: 0.1,
      hitEnd: 0.16,
      keys: [
        { t: 0, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0, reach: 0, smear: 0 },
        { t: 0.2, ox: -6, oy: 3, scX: 1.02, scY: 0.98, rot: -0.04, reach: 0.15, smear: 0 },
        { t: 0.35, ox: 18, oy: -2, scX: 0.98, scY: 1.02, rot: 0.08, reach: 1, smear: 0.75 },
        { t: 0.55, ox: 14, oy: 0, scX: 1, scY: 1, rot: 0.05, reach: 0.5, smear: 0.35 },
        { t: 1, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0, reach: 0, smear: 0 },
      ],
    },
    kick: {
      loop: false,
      dur: 0.44,
      hit: 0.14,
      hitEnd: 0.2,
      keys: [
        { t: 0, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0, kick: 0, smear: 0 },
        { t: 0.22, ox: -8, oy: 2, scX: 1.02, scY: 0.98, rot: 0.06, kick: 0.2, smear: 0 },
        { t: 0.4, ox: 12, oy: -6, scX: 0.99, scY: 1.02, rot: -0.1, kick: 1, smear: 0.7 },
        { t: 0.65, ox: 6, oy: 0, scX: 1, scY: 1, rot: -0.04, kick: 0.25, smear: 0.2 },
        { t: 1, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0, kick: 0, smear: 0 },
      ],
    },
    spell: {
      loop: false,
      dur: 0.58,
      hit: 0.28,
      hitEnd: 0.36,
      keys: [
        { t: 0, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0, glow: 0, smear: 0 },
        { t: 0.3, ox: -4, oy: -4, scX: 1, scY: 1.01, rot: -0.03, glow: 0.55, smear: 0 },
        { t: 0.5, ox: 10, oy: -6, scX: 0.99, scY: 1.01, rot: 0.04, glow: 1, smear: 0.4 },
        { t: 1, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0, glow: 0, smear: 0 },
      ],
    },
    special: {
      loop: false,
      dur: 0.65,
      hit: 0.26,
      hitEnd: 0.34,
      keys: [
        { t: 0, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0, glow: 0, reach: 0, smear: 0 },
        { t: 0.25, ox: -10, oy: 4, scX: 1.03, scY: 0.97, rot: -0.06, glow: 0.4, reach: 0.2, smear: 0 },
        { t: 0.42, ox: 22, oy: -4, scX: 0.98, scY: 1.02, rot: 0.1, glow: 1, reach: 1, smear: 0.8 },
        { t: 1, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0, glow: 0, reach: 0, smear: 0 },
      ],
    },
    finisher: {
      loop: false,
      dur: 0.95,
      hit: 0.4,
      hitEnd: 0.5,
      keys: [
        { t: 0, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0, glow: 0, smear: 0 },
        { t: 0.25, ox: -12, oy: 4, scX: 1.03, scY: 0.97, rot: -0.08, glow: 0.35, smear: 0 },
        { t: 0.45, ox: 26, oy: -8, scX: 0.97, scY: 1.03, rot: 0.12, glow: 1.1, smear: 0.9 },
        { t: 0.7, ox: 12, oy: -2, scX: 1, scY: 1, rot: 0.05, glow: 0.4, smear: 0.25 },
        { t: 1, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0, glow: 0, smear: 0 },
      ],
    },
    block: {
      loop: true,
      dur: 0.5,
      keys: [
        { t: 0, ox: -4, oy: 1, scX: 1.01, scY: 0.99, rot: 0.05 },
        { t: 1, ox: -5, oy: 2, scX: 1.015, scY: 0.985, rot: 0.06 },
      ],
    },
    hit: {
      loop: false,
      dur: 0.34,
      keys: [
        { t: 0, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0, flash: 1 },
        { t: 0.15, ox: -14, oy: -3, scX: 0.99, scY: 1.01, rot: -0.1, flash: 0.7 },
        { t: 1, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0, flash: 0 },
      ],
    },
    fall: {
      loop: false,
      dur: 0.7,
      keys: [
        { t: 0, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0 },
        { t: 0.3, ox: -14, oy: -28, scX: 1, scY: 1, rot: -0.45 },
        { t: 0.65, ox: -22, oy: -6, scX: 1.02, scY: 0.97, rot: -0.95 },
        { t: 1, ox: -18, oy: 6, scX: 1.04, scY: 0.94, rot: -1.25 },
      ],
    },
    ko: {
      loop: false,
      dur: 1.1,
      keys: [
        { t: 0, ox: 0, oy: 0, scX: 1, scY: 1, rot: 0, flash: 1 },
        { t: 0.25, ox: -18, oy: -36, scX: 1, scY: 1, rot: -0.55, flash: 0.4 },
        { t: 0.55, ox: -28, oy: -8, scX: 1.03, scY: 0.96, rot: -1.15 },
        { t: 1, ox: -24, oy: 8, scX: 1.05, scY: 0.92, rot: -1.4 },
      ],
    },
    jump: {
      loop: false,
      dur: 0.85,
      keys: [
        { t: 0, ox: 0, oy: 4, scX: 1.04, scY: 0.94, rot: 0 },
        { t: 0.2, ox: 0, oy: -2, scX: 0.98, scY: 1.04, rot: 0 },
        { t: 0.55, ox: 0, oy: -6, scX: 0.99, scY: 1.02, rot: 0.02 },
        { t: 1, ox: 0, oy: 2, scX: 1.03, scY: 0.96, rot: 0 },
      ],
    },
    air_punch: {
      loop: false,
      dur: 0.32,
      hit: 0.08,
      hitEnd: 0.16,
      keys: [
        { t: 0, ox: 0, oy: -4, scX: 1, scY: 1, rot: -0.04, reach: 0.2, smear: 0 },
        { t: 0.35, ox: 14, oy: -6, scX: 0.98, scY: 1.02, rot: 0.1, reach: 1, smear: 0.7 },
        { t: 1, ox: 4, oy: -4, scX: 1, scY: 1, rot: 0.04, reach: 0.2, smear: 0.15 },
      ],
    },
    air_kick: {
      loop: false,
      dur: 0.38,
      hit: 0.1,
      hitEnd: 0.18,
      keys: [
        { t: 0, ox: 0, oy: -4, scX: 1, scY: 1, rot: 0.08, kick: 0.25, smear: 0 },
        { t: 0.4, ox: 10, oy: -8, scX: 0.99, scY: 1.02, rot: -0.12, kick: 1, smear: 0.75 },
        { t: 1, ox: 2, oy: -4, scX: 1, scY: 1, rot: 0.02, kick: 0.15, smear: 0.1 },
      ],
    },
    air_spell: {
      loop: false,
      dur: 0.42,
      hit: 0.16,
      hitEnd: 0.24,
      keys: [
        { t: 0, ox: 0, oy: -4, scX: 1, scY: 1, rot: -0.03, glow: 0.4, smear: 0 },
        { t: 0.45, ox: 12, oy: -8, scX: 0.99, scY: 1.01, rot: 0.05, glow: 1, smear: 0.45 },
        { t: 1, ox: 2, oy: -4, scX: 1, scY: 1, rot: 0, glow: 0.15, smear: 0 },
      ],
    },
  };

  function easeSmooth(f) {
    return f * f * (3 - 2 * f);
  }

  function sampleAnim(name, t) {
    var def = ANIMS[name] || ANIMS.idle;
    var u = def.loop ? (t % def.dur) / def.dur : clamp(t / def.dur, 0, 1);
    var keys = def.keys;
    var a = keys[0];
    var b = keys[keys.length - 1];
    for (var i = 0; i < keys.length - 1; i++) {
      if (u >= keys[i].t && u <= keys[i + 1].t) {
        a = keys[i];
        b = keys[i + 1];
        break;
      }
    }
    var span = b.t - a.t || 1;
    var f = easeSmooth(clamp((u - a.t) / span, 0, 1));
    function lerp(k, fallback) {
      var av = a[k] != null ? a[k] : fallback != null ? fallback : 0;
      var bv = b[k] != null ? b[k] : av;
      return av + (bv - av) * f;
    }
    var scX = lerp("scX", 1) || 1;
    var scY = lerp("scY", 1) || 1;
    // Back-compat for old sc field
    if (a.sc != null || b.sc != null) {
      var sc = lerp("sc", 1) || 1;
      scX *= sc;
      scY *= sc;
    }
    var hitEnd = def.hitEnd != null ? def.hitEnd : def.hit != null ? def.hit + 0.06 : null;
    return {
      ox: lerp("ox", 0),
      oy: lerp("oy", 0),
      y: lerp("oy", 0),
      sc: (scX + scY) * 0.5,
      scX: scX,
      scY: scY,
      rot: lerp("rot", 0),
      arm: lerp("arm", 0),
      reach: lerp("reach", 0),
      kick: lerp("kick", 0),
      glow: lerp("glow", 0),
      smear: lerp("smear", 0),
      flash: lerp("flash", 0),
      done: !def.loop && t >= def.dur,
      hitWindow: def.hit != null && t >= def.hit && t <= (hitEnd != null ? hitEnd : def.hit + 0.08),
      def: def,
    };
  }

  function triggerHitstop(frames, shake) {
    var m = activeBagMatch();
    if (!m) return;
    // ~frames at 60fps
    m.hitstop = Math.max(m.hitstop || 0, (frames || 6) / 60);
    m.shake = Math.max(m.shake || 0, shake != null ? shake : 6);
  }

  /* ---------- fighter (world disc: wx, wz, hy) ---------- */
  function makeFighter(opts) {
    opts = opts || {};
    var ang = opts.angle != null ? opts.angle : 0;
    var rad = opts.rad != null ? opts.rad : 80;
    return {
      id: opts.id || uid(),
      name: opts.name || "Fighter",
      team: opts.team || 0,
      isCpu: !!opts.isCpu,
      isDummy: !!opts.isDummy,
      img: opts.img || null,
      imgUrl: opts.imgUrl || "",
      wx: opts.wx != null ? opts.wx : Math.sin(ang) * rad,
      wz: opts.wz != null ? opts.wz : Math.cos(ang) * rad,
      hy: 0,
      vx: 0,
      vz: 0,
      vy: 0,
      facing: opts.facing != null ? opts.facing : 1,
      yaw: opts.yaw != null ? opts.yaw : 0,
      w: opts.w != null ? opts.w : STAGE.heroW,
      h: opts.h != null ? opts.h : STAGE.heroH,
      hp: 100,
      maxHp: opts.isDummy ? 9999 : 100,
      meter: 0,
      maxMeter: 100,
      anim: "idle",
      animT: 0,
      onGround: true,
      blocking: false,
      invuln: 0,
      stun: 0,
      combo: 0,
      comboLog: [],
      hitsThisAnim: false,
      dead: false,
      fallingOff: false,
      color: opts.color || "#e06050",
      input: {
        left: 0,
        right: 0,
        forward: 0,
        back: 0,
        jump: 0,
        punch: 0,
        kick: 0,
        spell: 0,
        special: 0,
        finisher: 0,
        block: 0,
        moveX: 0,
        moveZ: 0,
      },
      cpuCd: 0,
    };
  }

  function setAnim(f, name, force) {
    if (!force && f.anim === name && !(ANIMS[name] && ANIMS[name].loop)) return;
    if (!force && f.stun > 0 && name !== "hit" && name !== "fall" && name !== "ko") return;
    if (!force && f.dead && name !== "ko") return;
    var busy = [
      "punch",
      "kick",
      "spell",
      "special",
      "finisher",
      "air_punch",
      "air_kick",
      "air_spell",
      "hit",
      "fall",
      "ko",
    ];
    if (!force && busy.indexOf(f.anim) >= 0 && !sampleAnim(f.anim, f.animT).done) {
      // Allow cancelling jump into aerial attacks
      if (!(f.anim === "jump" && (name === "air_punch" || name === "air_kick" || name === "air_spell"))) {
        if (busy.indexOf(name) < 0 && name !== "jump") return;
      }
    }
    f.anim = name;
    f.animT = 0;
    f.hitsThisAnim = false;
    f.missThisAnim = false;
    // Lock attack direction at start so left/right attacks stay aimed that way
    var atkLock = [
      "punch",
      "kick",
      "spell",
      "special",
      "finisher",
      "air_punch",
      "air_kick",
      "air_spell",
    ];
    if (atkLock.indexOf(name) >= 0) {
      f.attackFacing = f.facing || 1;
    }
    if (name === "jump") {
      f.jumpPhase = "crouch";
      f._wasAirborne = false;
    }
  }

  /* ---------- physics / combat on ground plane ---------- */
  function clampToStage(f, map) {
    var edge = (map && map.edge) || "wall";
    var hw = STAGE.halfW;
    var zd = STAGE.depth;
    // Soft walls left/right & back of stage
    if (edge === "wall" || !f.fallingOff) {
      if (f.wx < -hw) {
        f.wx = -hw;
        f.vx = Math.max(0, f.vx);
      }
      if (f.wx > hw) {
        f.wx = hw;
        f.vx = Math.min(0, f.vx);
      }
      if (f.wz < -zd * 0.35) {
        f.wz = -zd * 0.35;
        f.vz = Math.max(0, f.vz);
      }
      if (f.wz > zd * 0.55) {
        f.wz = zd * 0.55;
        f.vz = Math.min(0, f.vz);
      }
      f.fallingOff = false;
    }
    // Cliff mode: front edge of ground can drop you
    if (edge === "cliff" && f.wz > zd * 0.62) {
      f.fallingOff = true;
    }
  }

  function applyHit(att, vic, kind) {
    if (vic.dead || vic.invuln > 0) return false;
    var toVicX = vic.wx - att.wx;
    var toVicZ = vic.wz - att.wz;
    var dx = att.wx - vic.wx;
    var toward = dx * vic.facing;
    var anc = fighterScreenAnchor(vic);
    var attAnc = fighterScreenAnchor(att);
    var midX = (anc.x + attAnc.x) * 0.5;
    var midY = (anc.y + attAnc.y) * 0.5;

    // Block if facing attacker
    if (vic.blocking && toward > 0) {
      vic.meter = clamp(vic.meter + 4, 0, vic.maxMeter);
      vic.stun = 0.08;
      setAnim(vic, "block", true);
      spawnFightLabel(midX, midY - 20, "BLOCK", "#8ec8ff");
      spawnImpactBurst(midX, midY, "#a0d0ff", 6);
      triggerHitstop(4, 3);
      return "block";
    }
    var dmg =
      {
        punch: 7,
        kick: 10,
        spell: 14,
        special: 18,
        finisher: 32,
        air_punch: 6,
        air_kick: 9,
        air_spell: 12,
      }[kind] || 8;
    if (vic.isDummy) dmg = Math.min(dmg, 3);
    vic.hp = Math.max(0, vic.hp - dmg);
    att.meter = clamp(att.meter + dmg * 1.2, 0, att.maxMeter);
    att.combo += 1;
    att.comboLog.push(kind);
    if (att.comboLog.length > 8) att.comboLog.shift();
    vic.stun = kind === "finisher" ? 0.55 : kind === "special" ? 0.4 : 0.28;
    vic.invuln = 0.1;
    var len = Math.hypot(toVicX, toVicZ) || 1;
    var power =
      kind === "finisher"
        ? 520
        : kind === "kick" || kind === "air_kick"
          ? 320
          : kind === "special"
            ? 400
            : kind === "air_punch"
              ? 180
              : 200;
    // Knock direction = away from attacker (where they fly / fall)
    vic.knockX = toVicX / len;
    vic.knockZ = toVicZ / len;
    vic.knockFace = toVicX >= 0 ? 1 : -1;
    // Face the attacker (see who hit you); body still flies knockFace
    vic.facing = toVicX >= 0 ? -1 : 1;
    vic.vx = vic.knockX * power;
    vic.vz = vic.knockZ * power * 0.55;
    vic.vy = kind === "finisher" ? 520 : kind === "special" ? 400 : kind === "kick" ? 220 : 160;
    vic.hitReactT = 0;

    // Classic fighter freeze-frame on connect
    var stopF =
      kind === "finisher" ? 14 : kind === "special" ? 10 : kind === "spell" ? 9 : kind === "kick" ? 8 : 7;
    triggerHitstop(stopF, kind === "finisher" ? 14 : kind === "special" ? 10 : 7);

    if (vic.hp <= 0) {
      vic.dead = true;
      setAnim(vic, "ko", true);
      spawnFightLabel(anc.x, anc.y - 40, "K.O.!", "#ff4060");
      spawnFightLabel(anc.x, anc.y - 10, "-" + Math.ceil(dmg), "#ffb0b8");
      spawnImpactBurst(midX, midY, "#ff6080", 18);
      triggerHitstop(18, 16);
    } else if (kind === "finisher" || kind === "special") {
      setAnim(vic, "fall", true);
      spawnFightLabel(anc.x, anc.y - 24, kind === "finisher" ? "FINISH!" : "LAUNCH", "#ffd060");
      spawnFightLabel(anc.x + 30, anc.y, "-" + Math.ceil(dmg), "#ffe0a0");
      spawnImpactBurst(midX, midY, "#ffc060", 14);
    } else {
      setAnim(vic, "hit", true);
      var labels = { punch: "HIT!", kick: "WHACK!", spell: "BLAST!", special: "HIT!", finisher: "HIT!" };
      spawnFightLabel(anc.x, anc.y - 18, labels[kind] || "HIT!", "#ffe8a0");
      spawnFightLabel(anc.x + 28, anc.y + 8, "-" + Math.ceil(dmg), "#ff9090");
      spawnImpactBurst(midX, midY, kind === "spell" ? "#80c0ff" : "#ffd080", 12);
    }
    if (att.combo > 1) {
      var aa = fighterScreenAnchor(att);
      spawnFightLabel(aa.x, aa.y - 50, att.combo + " HIT", "#ffb040");
    }
    return true;
  }

  function tryAttackHits(att, fighters, kind) {
    var pose = sampleAnim(att.anim, att.animT);
    var def = ANIMS[att.anim] || {};
    var hitWin = isAnimHitWindow(att);
    // Whiff / miss once the strike window closes with no contact
    var missAfter = def.hit != null ? def.hit + 0.12 : null;
    var clip = att.frameClips && att.frameClips[resolveClipName(att, att.anim)];
    if (clip && clip.hitFrame != null) {
      missAfter = (clip.hitFrame + 1.4) / (clip.fps || 10);
    }
    if (
      missAfter != null &&
      att.animT > missAfter &&
      !att.hitsThisAnim &&
      !att.missThisAnim
    ) {
      att.missThisAnim = true;
      var a = fighterScreenAnchor(att);
      spawnFightLabel(a.x + (att.facing || 1) * 40, a.y + 10, "MISS", "#a0a8b8");
    }
    if (att.hitsThisAnim) return;
    if (!hitWin) return;
    var reach = 95 + (pose.reach || 0) * 110 + (pose.kick || 0) * 80;
    // Spells / finishers have more range
    if (kind === "spell" || kind === "special" || kind === "air_spell") reach += 40;
    if (kind === "finisher") reach += 70;
    var anyInRange = false;
    for (var i = 0; i < fighters.length; i++) {
      var vic = fighters[i];
      if (vic.id === att.id || vic.dead) continue;
      if (att.team && vic.team && att.team === vic.team && state.match && state.match.mode === "2v2")
        continue;
      var dx = vic.wx - att.wx;
      var dz = vic.wz - att.wz;
      var dist = Math.hypot(dx, dz);
      if (dist > reach) continue;
      var atkFace = att.attackFacing != null ? att.attackFacing : att.facing || 1;
      var front = dx * atkFace;
      // Must hit in the direction they're facing (not behind)
      if (front < -25 && dist > 45) continue;
      var hyTol =
        kind === "air_punch" || kind === "air_kick" || kind === "air_spell" ? 200 : 140;
      if (Math.abs(vic.hy - att.hy) > hyTol) continue;
      anyInRange = true;
      var res = applyHit(att, vic, kind);
      if (res) {
        att.hitsThisAnim = true;
        att.missThisAnim = true; // don't also show MISS
      }
    }
    // In range but blocked-only still counts as a "resolved" strike (no MISS)
    if (anyInRange && !att.hitsThisAnim) {
      att.missThisAnim = true;
    }
  }

  /* ---------- input ---------- */
  function padHeld(act) {
    return !!(state.padButtons && state.padButtons[act]);
  }

  function readKeyboard(f, slot) {
    var k = state.keys;
    if (slot !== 0) return;
    f.input.left = k["KeyA"] || k["ArrowLeft"] || padHeld("left") ? 1 : 0;
    f.input.right = k["KeyD"] || k["ArrowRight"] || padHeld("right") ? 1 : 0;
    // Q/E = walk into / out of the dome (circular depth)
    f.input.forward = k["KeyQ"] || padHeld("forward") ? 1 : 0;
    f.input.back = k["KeyE"] || padHeld("back") ? 1 : 0;
    // stick-style planar intent
    f.input.moveX = (f.input.right ? 1 : 0) - (f.input.left ? 1 : 0);
    f.input.moveZ = (f.input.back ? 1 : 0) - (f.input.forward ? 1 : 0);
    f.input.jump = k["KeyW"] || k["ArrowUp"] || k["Space"] || padHeld("jump") ? 1 : 0;
    f.input.block = k["KeyS"] || k["ArrowDown"] || padHeld("block") ? 1 : 0;
    var j = !!(k["KeyJ"] || padHeld("punch"));
    var kk = !!(k["KeyK"] || padHeld("kick"));
    var l = !!(k["KeyL"] || padHeld("spell"));
    // Finisher = press J+K+L together (also I or pad finisher)
    var jkl = j && kk && l;
    f.input.finisher =
      jkl || k["KeyI"] || padHeld("finisher") ? 1 : 0;
    f.input.punch = j && !jkl ? 1 : 0;
    f.input.kick = kk && !jkl ? 1 : 0;
    f.input.spell = l && !jkl ? 1 : 0;
    f.input.special = k["KeyU"] || k["KeyO"] || padHeld("special") ? 1 : 0;
  }

  function bindFightPad(root) {
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "1";
    state.padButtons = state.padButtons || {};
    function setAct(el, on) {
      var act = el && el.getAttribute("data-ft-act");
      if (!act) return;
      state.padButtons[act] = !!on;
      el.classList.toggle("held", !!on);
    }
    root.querySelectorAll(".ft-pad-btn").forEach(function (btn) {
      btn.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        try {
          btn.setPointerCapture(e.pointerId);
        } catch (err) {}
        setAct(btn, true);
      });
      btn.addEventListener("pointerup", function () {
        setAct(btn, false);
      });
      btn.addEventListener("pointercancel", function () {
        setAct(btn, false);
      });
      btn.addEventListener("pointerleave", function (e) {
        if (e.buttons === 0) setAct(btn, false);
      });
    });
  }

  function readGamepad(f, padIndex) {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var gp = pads[padIndex];
    if (!gp) return false;
    var ax = gp.axes[0] || 0;
    var ay = gp.axes[1] || 0;
    var dpadL = gp.buttons[14] && gp.buttons[14].pressed;
    var dpadR = gp.buttons[15] && gp.buttons[15].pressed;
    var dpadU = gp.buttons[12] && gp.buttons[12].pressed;
    var dpadD = gp.buttons[13] && gp.buttons[13].pressed;
    f.input.moveX = Math.abs(ax) > 0.25 ? ax : dpadR ? 1 : dpadL ? -1 : 0;
    f.input.moveZ = Math.abs(ay) > 0.25 ? ay : dpadD ? 1 : dpadU ? -1 : 0;
    f.input.left = f.input.moveX < -0.3 ? 1 : 0;
    f.input.right = f.input.moveX > 0.3 ? 1 : 0;
    f.input.forward = f.input.moveZ < -0.3 ? 1 : 0;
    f.input.back = f.input.moveZ > 0.3 ? 1 : 0;
    f.input.jump = 0;
    if (gp.buttons[1] && gp.buttons[1].pressed) f.input.jump = 1;
    if (gp.buttons[12] && gp.buttons[12].pressed) f.input.jump = 1;
    f.input.punch = gp.buttons[2] && gp.buttons[2].pressed ? 1 : 0;
    f.input.kick = gp.buttons[0] && gp.buttons[0].pressed ? 1 : 0;
    f.input.spell = gp.buttons[3] && gp.buttons[3].pressed ? 1 : 0;
    f.input.special = gp.buttons[5] && gp.buttons[5].pressed ? 1 : 0;
    f.input.finisher = gp.buttons[7] && gp.buttons[7].pressed ? 1 : 0;
    f.input.block = (gp.buttons[6] && gp.buttons[6].value > 0.4) || (gp.buttons[4] && gp.buttons[4].pressed) ? 1 : 0;
    return true;
  }

  function cpuThink(f, fighters, dt) {
    f.cpuCd -= dt;
    var target = null;
    var best = 1e9;
    for (var i = 0; i < fighters.length; i++) {
      var o = fighters[i];
      if (o.id === f.id || o.dead) continue;
      if (f.team && o.team && f.team === o.team) continue;
      var d = Math.hypot(o.wx - f.wx, o.wz - f.wz);
      if (d < best) {
        best = d;
        target = o;
      }
    }
    f.input = {
      left: 0,
      right: 0,
      forward: 0,
      back: 0,
      jump: 0,
      punch: 0,
      kick: 0,
      spell: 0,
      special: 0,
      finisher: 0,
      block: 0,
      moveX: 0,
      moveZ: 0,
    };
    if (!target) return;
    var dx = target.wx - f.wx;
    var dz = target.wz - f.wz;
    var dist = Math.hypot(dx, dz) || 1;
    f.facing = dx >= 0 ? 1 : -1;
    // Walk along the disc toward target — circular path when skirting the rim
    if (dist > 70) {
      f.input.moveX = dx / dist;
      f.input.moveZ = dz / dist;
    } else if (dist < 45) {
      f.input.moveX = -dx / dist;
      f.input.moveZ = -dz / dist;
    }
    if (f.cpuCd > 0) return;
    f.cpuCd = 0.28 + Math.random() * 0.45;
    var r = Math.random();
    if (f.meter >= 90 && dist < 120 && r < 0.35) f.input.finisher = 1;
    else if (f.meter >= 40 && r < 0.25) f.input.special = 1;
    else if (dist < 100 && r < 0.35) f.input.spell = 1;
    else if (dist < 85 && r < 0.55) f.input.kick = 1;
    else if (dist < 75) f.input.punch = 1;
    if (target.hy > f.hy + 40 && f.onGround && Math.random() < 0.4) f.input.jump = 1;
    if (target.anim === "punch" || target.anim === "kick") {
      if (Math.random() < 0.35) f.input.block = 1;
    }
  }

  function controlFighter(f, dt, fighters, map, slotIndex) {
    if (f.dead || f.isDummy) {
      if (f.isDummy && !f.dead) {
        f.input = {
          left: 0,
          right: 0,
          forward: 0,
          back: 0,
          jump: 0,
          punch: 0,
          kick: 0,
          spell: 0,
          special: 0,
          finisher: 0,
          block: 0,
          moveX: 0,
          moveZ: 0,
        };
      }
    } else if (f.isCpu) {
      cpuThink(f, fighters, dt);
    } else {
      f.input = {
        left: 0,
        right: 0,
        forward: 0,
        back: 0,
        jump: 0,
        punch: 0,
        kick: 0,
        spell: 0,
        special: 0,
        finisher: 0,
        block: 0,
        moveX: 0,
        moveZ: 0,
      };
      if (!isTypingTarget(document.activeElement)) {
        var usedPad = readGamepad(f, slotIndex);
        if (!usedPad) readKeyboard(f, slotIndex);
      }
    }

    f.stun = Math.max(0, f.stun - dt);
    f.invuln = Math.max(0, f.invuln - dt);
    f.animT += dt;

    var pose = sampleAnim(f.anim, f.animT);
    var animDone = pose.done;
    var clipName = resolveClipName(f, f.anim);
    if (f.frameClips && f.frameClips[clipName] && !f.frameClips[clipName].loop) {
      // Jump is held by physics, not clip duration
      if (f.anim !== "jump") {
        animDone = f.animT >= frameClipDuration(f, clipName);
      }
    }
    if (animDone && f.anim !== "ko" && f.anim !== "jump") {
      setAnim(f, f.onGround ? "idle" : "jump", true);
      if (!f.onGround) f.jumpPhase = f.vy > 0 ? "rise" : "fall";
    }

    var attackBusy = [
      "punch",
      "kick",
      "spell",
      "special",
      "finisher",
      "air_punch",
      "air_kick",
      "air_spell",
      "hit",
      "fall",
      "ko",
    ];
    var inAttack = attackBusy.indexOf(f.anim) >= 0;
    var aerialAtk =
      f.anim === "air_punch" || f.anim === "air_kick" || f.anim === "air_spell";

    if (f.stun <= 0 && !f.dead && !f.fallingOff) {
      var mx = f.input.moveX || 0;
      var mz = f.input.moveZ || 0;
      if (!mx && !mz) {
        mx = (f.input.right ? 1 : 0) - (f.input.left ? 1 : 0);
        mz = (f.input.back ? 1 : 0) - (f.input.forward ? 1 : 0);
      }
      var mlen = Math.hypot(mx, mz);
      var speed = 250;
      // Attacks lock footwork + facing so they keep aiming the way they faced
      if (inAttack && f.anim !== "hit") {
        f.vx *= aerialAtk ? 0.92 : 0.55;
        f.vz *= aerialAtk ? 0.92 : 0.55;
        if (f.attackFacing != null) f.facing = f.attackFacing;
      } else if (mlen > 0.1) {
        mx /= mlen;
        mz /= mlen;
        f.vx = mx * speed;
        f.vz = mz * speed * 0.7;
        // Always look in the direction of horizontal movement (walk L/R)
        if (Math.abs(mx) > 0.15) f.facing = mx >= 0 ? 1 : -1;
      } else {
        f.vx *= f.onGround ? 0.78 : 0.98;
        f.vz *= f.onGround ? 0.78 : 0.98;
      }
      var moving = mlen > 0.15 && !inAttack;
      // Jump: crouch beat, then launch
      if (f.input.jump && f.onGround && !inAttack && f.anim !== "jump") {
        setAnim(f, "jump", true);
        f.jumpPhase = "crouch";
        f._pendingJump = true;
      }
      if (f._pendingJump && f.anim === "jump" && f.animT >= 0.1 && f.onGround) {
        f.vy = 720;
        f.onGround = false;
        f.jumpPhase = "rise";
        f._pendingJump = false;
        f._wasAirborne = true;
      }
      f.blocking = !!f.input.block && f.onGround && !inAttack && f.anim !== "jump";
      var freeSuper = !!(state.train && state.train.running);
      var jumpCrouch = f.anim === "jump" && f._pendingJump;
      // Grounded combat / move anims (don't cancel jump crouch with walk/punch)
      if (f.onGround && !jumpCrouch && (!inAttack || f.anim === "block")) {
        if (f.blocking) setAnim(f, "block");
        else if (f.input.finisher && (freeSuper || f.meter >= 85)) {
          if (!freeSuper) f.meter -= 85;
          setAnim(f, "finisher", true);
        } else if (f.input.special && (freeSuper || f.meter >= 35)) {
          if (!freeSuper) f.meter -= 35;
          setAnim(f, "special", true);
        } else if (f.input.spell) setAnim(f, "spell", true);
        else if (f.input.kick) setAnim(f, "kick", true);
        else if (f.input.punch) setAnim(f, "punch", true);
        else if (moving && (f.anim === "idle" || f.anim === "walk" || f.anim === "block"))
          setAnim(f, "walk");
        else if (!moving && f.anim === "walk") setAnim(f, "idle");
        else if (!moving && f.anim === "jump" && f.jumpPhase === "land" && !(f._landHold > 0))
          setAnim(f, "idle");
      }
      // Air: punch / kick / spell (different anims) while airborne
      if (!f.onGround && !f.dead && f.stun <= 0) {
        if (!inAttack || f.anim === "jump") {
          if (f.input.spell) setAnim(f, "air_spell", true);
          else if (f.input.kick) setAnim(f, "air_kick", true);
          else if (f.input.punch) setAnim(f, "air_punch", true);
          else if (f.anim === "idle" || f.anim === "walk") setAnim(f, "jump", true);
        }
      }
    }

    if (f.combo > 0 && f.anim === "idle") {
      f.combo = Math.max(0, f.combo - dt * 2);
      if (f.combo < 0.5) {
        f.combo = 0;
        f.comboLog = [];
      }
    }

    // vertical (jump / fall off cliffs)
    var wasOnGround = f.onGround;
    f.vy -= GRAVITY * dt;
    f.hy += f.vy * dt;
    if (f.hy <= 0 && !f.fallingOff) {
      f.hy = 0;
      f.vy = 0;
      f.onGround = true;
      // Landing from air → land pose then idle
      if (!wasOnGround && f._wasAirborne) {
        if (
          f.anim === "jump" ||
          f.anim === "air_punch" ||
          f.anim === "air_kick" ||
          f.anim === "air_spell"
        ) {
          setAnim(f, "jump", true);
          f.jumpPhase = "land";
          f.animT = 0.55;
          f._landHold = 0.18;
        }
        f._wasAirborne = false;
      }
    } else if (f.hy > 0) {
      f.onGround = false;
      f._wasAirborne = true;
      if (f.anim === "jump") {
        f.jumpPhase = f.vy > 40 ? "rise" : "fall";
      }
    }
    if (f._landHold > 0) {
      f._landHold -= dt;
      if (f._landHold <= 0 && f.onGround && f.anim === "jump") {
        setAnim(f, "idle", true);
      }
    }

    f.wx += f.vx * dt;
    f.wz += f.vz * dt;
    clampToStage(f, map);

    if (f.fallingOff) {
      f.hy -= 420 * dt;
      f.vy -= GRAVITY * 0.5 * dt;
      if (f.hy < -350 && !f.dead) {
        f.hp = 0;
        f.dead = true;
        setAnim(f, "ko", true);
      }
    }

    if (f.isDummy && f.hy < -50) {
      f.wx = 90;
      f.wz = 20;
      f.hy = 0;
      f.fallingOff = false;
      f.hp = f.maxHp;
    }

    var atk = {
      punch: "punch",
      kick: "kick",
      spell: "spell",
      special: "special",
      finisher: "finisher",
      air_punch: "air_punch",
      air_kick: "air_kick",
      air_spell: "air_spell",
    };
    if (atk[f.anim]) tryAttackHits(f, fighters, atk[f.anim]);
  }

  /* ---------- render: generative dome + disc ---------- */
  function proceduralSky(ctx, kind, t) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    if (kind === "neon") {
      g.addColorStop(0, "#12081c");
      g.addColorStop(0.45, "#2a1050");
      g.addColorStop(1, "#08060c");
    } else if (kind === "storm") {
      g.addColorStop(0, "#1a2030");
      g.addColorStop(0.5, "#3a4050");
      g.addColorStop(1, "#12141a");
    } else if (kind === "void") {
      g.addColorStop(0, "#050510");
      g.addColorStop(1, "#000005");
    } else {
      g.addColorStop(0, "#0c1830");
      g.addColorStop(0.4, "#204060");
      g.addColorStop(1, "#101018");
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // drifting light bands — HDRI-ish
    for (var i = 0; i < 12; i++) {
      var a = (i / 12) * Math.PI * 2 + t * 0.15;
      ctx.strokeStyle =
        kind === "neon"
          ? "rgba(255,40,180," + (0.08 + (i % 3) * 0.03) + ")"
          : kind === "aurora"
            ? "rgba(80,255,180," + (0.07 + (i % 3) * 0.03) + ")"
            : "rgba(200,220,255," + (0.05 + (i % 3) * 0.02) + ")";
      ctx.lineWidth = 18 + (i % 4) * 8;
      ctx.beginPath();
      ctx.arc(W / 2, H * 0.95, 280 + i * 28, a, a + 1.1);
      ctx.stroke();
    }
  }

  /**
   * Picture-perfect stage still as the world; soft ground strip under hero-scale fighters.
   * Scene = background. Fighters = full subjects standing in it (not stickers).
   */
  function drawStageWorld(ctx, map, t) {
    t = t || 0;
    var env = map && (map.sceneImg || state.sceneCache[map.id]);
    var farY = groundLineY();
    var nearY = H + 10;

    // Full scenic still — letterboxed slightly so ground band can sit under characters
    if (env && env.complete && env.naturalWidth) {
      var scale = Math.max(W / env.naturalWidth, (H * 0.92) / env.naturalHeight);
      var dw = env.naturalWidth * scale;
      var dh = env.naturalHeight * scale;
      // Bias scene upward so more of the lower canvas is “stage floor”
      ctx.drawImage(env, (W - dw) / 2, H * 0.02 - dh * 0.08, dw, dh);
    } else {
      proceduralSky(ctx, (map && map.procedural) || "aurora", t);
    }

    // Ground plane reflects the scene (blurred) so feet share the world's palette
    var insetFar = W * 0.06;
    if (env && env.complete && env.naturalWidth) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(insetFar, farY);
      ctx.lineTo(W - insetFar, farY);
      ctx.lineTo(W + 30, nearY);
      ctx.lineTo(-30, nearY);
      ctx.closePath();
      ctx.clip();
      // Stronger scene bleed on the floor — fighters stand *in* the painting
      ctx.globalAlpha = 0.42;
      ctx.filter = "blur(10px) saturate(0.85) brightness(0.55)";
      ctx.drawImage(env, 0, farY - 40, W, nearY - farY + 90);
      ctx.filter = "none";
      ctx.globalAlpha = 1;
      // Soft floor darken for legibility without killing the scene
      var floorShade = ctx.createLinearGradient(0, farY, 0, nearY);
      floorShade.addColorStop(0, "rgba(0,0,0,0.15)");
      floorShade.addColorStop(0.5, "rgba(0,0,0,0.28)");
      floorShade.addColorStop(1, "rgba(0,0,0,0.5)");
      ctx.fillStyle = floorShade;
      ctx.fillRect(0, farY, W, nearY - farY);
      ctx.restore();
    } else {
      var ground = ctx.createLinearGradient(0, farY, 0, nearY);
      ground.addColorStop(0, "rgba(18,20,28,0.35)");
      ground.addColorStop(1, "rgba(6,8,12,0.75)");
      ctx.fillStyle = ground;
      ctx.beginPath();
      ctx.moveTo(insetFar, farY);
      ctx.lineTo(W - insetFar, farY);
      ctx.lineTo(W + 30, nearY);
      ctx.lineTo(-30, nearY);
      ctx.closePath();
      ctx.fill();
    }

    // Soft darken only the lowest band so feet read against the scene
    var footFade = ctx.createLinearGradient(0, H * 0.62, 0, H);
    footFade.addColorStop(0, "rgba(0,0,0,0)");
    footFade.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = footFade;
    ctx.fillRect(0, H * 0.62, W, H * 0.38);

    // Soft depth lines
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (var i = 0; i < 5; i++) {
      var u = i / 4;
      var y = farY + (nearY - farY) * (0.15 + u * 0.8);
      var inset = insetFar * (1 - u) - 10 * u;
      ctx.beginPath();
      ctx.moveTo(inset, y);
      ctx.lineTo(W - inset, y);
      ctx.stroke();
    }

    // Horizon blend into the painting
    var seam = ctx.createLinearGradient(0, farY - 40, 0, farY + 30);
    seam.addColorStop(0, "rgba(0,0,0,0)");
    seam.addColorStop(0.5, "rgba(0,0,0,0.2)");
    seam.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = seam;
    ctx.fillRect(0, farY - 40, W, 70);
  }

  function activeBagMatch() {
    return state.match || state.train;
  }

  function fighterScreenAnchor(f) {
    var pr = project(f.wx, 0, f.wz);
    return {
      x: pr.x,
      y: pr.y - (f.hy || 0) * 0.45 - H * 0.22,
      floorY: pr.y,
    };
  }

  function addFightFx(fx) {
    var m = activeBagMatch();
    if (!m) return;
    if (!m.fx) m.fx = [];
    m.fx.push(fx);
  }

  function spawnImpactBurst(x, y, color, n) {
    n = n || 10;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      var sp = 80 + Math.random() * 160;
      addFightFx({
        kind: "dot",
        x: x,
        y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        r: 3 + Math.random() * 5,
        color: color || "#ffd080",
        t: 0,
        life: 0.28 + Math.random() * 0.25,
      });
    }
    addFightFx({
      kind: "ring",
      x: x,
      y: y,
      r0: 6,
      r1: 48,
      color: color || "#ffe0a0",
      t: 0,
      life: 0.28,
    });
  }

  function spawnFightLabel(x, y, text, color) {
    addFightFx({
      kind: "label",
      x: x,
      y: y,
      vx: 0,
      vy: -70,
      text: text,
      color: color || "#fff",
      t: 0,
      life: 0.7,
      size: text.length > 4 ? 28 : 34,
    });
  }

  /** Sample real colors from the stage still so fighters grade into that world. */
  function sampleScenePalette(map) {
    var env = map && (map.sceneImg || (map.id && state.sceneCache[map.id]));
    if (!env || !env.complete || !env.naturalWidth) return null;
    try {
      var c = document.createElement("canvas");
      c.width = 48;
      c.height = 32;
      var x = c.getContext("2d");
      x.drawImage(env, 0, 0, c.width, c.height);
      var d = x.getImageData(0, 0, 48, 32).data;
      var r = 0,
        g = 0,
        b = 0,
        n = 0;
      // Weight lower half more (ground / mid) for foot ambient
      for (var py = 12; py < 32; py++) {
        for (var px = 0; px < 48; px++) {
          var i = (py * 48 + px) * 4;
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
          n++;
        }
      }
      if (!n) return null;
      return {
        r: (r / n) | 0,
        g: (g / n) | 0,
        b: (b / n) | 0,
      };
    } catch (e) {
      return null;
    }
  }

  /** Stage light + sampled ambient so fighters sit in the painted world. */
  function stageLightForMap(map) {
    var id = (map && (map.id || map.procedural || map.name)) || "";
    id = String(id).toLowerCase();
    var base;
    if (id.indexOf("rain") >= 0 || id.indexOf("neon") >= 0)
      base = { dir: 0.35, amb: "rgba(40,70,120,0.22)", rim: "rgba(120,200,255,0.18)", ground: 0.5 };
    else if (id.indexOf("temple") >= 0 || id.indexOf("gold") >= 0)
      base = { dir: -0.25, amb: "rgba(90,50,20,0.2)", rim: "rgba(255,200,120,0.16)", ground: 0.42 };
    else if (id.indexOf("cliff") >= 0 || id.indexOf("storm") >= 0)
      base = { dir: 0.45, amb: "rgba(30,40,60,0.28)", rim: "rgba(180,200,220,0.12)", ground: 0.55 };
    else if (id.indexOf("dojo") >= 0)
      base = { dir: -0.15, amb: "rgba(60,45,30,0.18)", rim: "rgba(255,230,180,0.14)", ground: 0.4 };
    else base = { dir: 0.2, amb: "rgba(20,20,30,0.2)", rim: "rgba(255,255,255,0.1)", ground: 0.45 };

    var pal = sampleScenePalette(map);
    if (pal) {
      base.amb =
        "rgba(" +
        Math.min(255, pal.r) +
        "," +
        Math.min(255, pal.g) +
        "," +
        Math.min(255, pal.b) +
        ",0.28)";
      base.rim =
        "rgba(" +
        Math.min(255, pal.r + 40) +
        "," +
        Math.min(255, pal.g + 40) +
        "," +
        Math.min(255, pal.b + 50) +
        ",0.14)";
      base.ground = 0.48;
    }
    return base;
  }

  /**
   * Multi-frame sprite + scene integration:
   * clean silhouette, contact shadow, ambient grade, directional hit/KO.
   */
  function drawFighter(ctx, f) {
    var pose = sampleAnim(f.anim, f.animT);
    var floorPr = project(f.wx, 0, f.wz);
    var prLift = project(f.wx, 0, f.wz);
    var depthScale = clamp(1 - f.wz * 0.0012, 0.88, 1.08);
    var targetH = H * 0.54 * depthScale;
    var hasFrames = animUsesFrames(f);
    var spr = sampleAnimFrame(f);
    // Multi-frame: fixed box aspect so size never jitters between cells
    var aspect = hasFrames
      ? SPRITE_BOX.h / SPRITE_BOX.w
      : ((spr && (spr.height || spr.naturalHeight)) || 400) /
        Math.max(1, (spr && (spr.width || spr.naturalWidth)) || 280);
    var drawH = targetH;
    var drawW = drawH / clamp(aspect, 0.9, 2.6);
    if (hasFrames) {
      drawW = drawH * (SPRITE_BOX.w / SPRITE_BOX.h);
    } else if (drawW > drawH * 0.88) {
      drawW = drawH * 0.88;
      drawH = drawW * aspect;
    }

    // Knock / fall orientation — tumble AWAY from the hit
    var knockFace = f.knockFace != null ? f.knockFace : f.facing || 1;
    var face = f.facing || 1;
    var react = f.anim === "hit" || f.anim === "fall" || f.anim === "ko";
    var attacking =
      f.anim === "punch" ||
      f.anim === "kick" ||
      f.anim === "spell" ||
      f.anim === "special" ||
      f.anim === "finisher" ||
      f.anim === "air_punch" ||
      f.anim === "air_kick" ||
      f.anim === "air_spell";
    // Attacks face attackFacing (locked at move start) so left AND right work
    var drawFace = react
      ? knockFace
      : attacking && f.attackFacing != null
        ? f.attackFacing
        : face;
    var uReact = 0;
    if (react) {
      var dur = frameClipDuration(f, f.anim) || (ANIMS[f.anim] && ANIMS[f.anim].dur) || 0.4;
      uReact = clamp(f.animT / Math.max(0.05, dur), 0, 1);
    }
    var lift = f.hy * (prLift.s * 0.85);
    // Screen-space slide: knock flies away; attacks lunge the way they face
    var atkPow = Math.max(pose.reach || 0, pose.kick || 0, pose.glow || 0, pose.smear || 0);
    // Multi-frame sprites already have motion painted in — keep screen pos stable (no lunge jitter)
    var ox =
      (react ? knockFace * (f.anim === "hit" ? 10 : 22) * uReact : 0) +
      (attacking && !hasFrames ? drawFace * (8 + atkPow * 22) : 0) +
      (hasFrames ? 0 : (pose.ox || 0) * (drawH / 400) * face);
    var oy = hasFrames ? 0 : (pose.oy || 0) * (drawH / 400);
    // Lean into the fall direction (away from attacker)
    var rot = 0;
    if (f.anim === "hit") rot = knockFace * uReact * 0.12;
    else if (f.anim === "fall") rot = knockFace * uReact * 0.55;
    else if (f.anim === "ko") rot = knockFace * easeSmooth(uReact) * 0.95;
    else if (!hasFrames) rot = pose.rot || 0;

    var light = stageLightForMap(
      (state.match && state.match.map) || (state.train && state.train.map) || null
    );
    var shadowW = Math.min(drawW * 0.42, drawH * 0.16);
    var air = clamp(f.hy / 140, 0, 1);

    // Contact + cast shadow on the ground plane (grounds them in the scene)
    if (!f.fallingOff && f.hy < 100) {
      var shAlpha = light.ground * (1 - air) * 0.92;
      var skew = light.dir * (14 + air * 20);
      ctx.save();
      ctx.translate(floorPr.x + skew, floorPr.y + 3);
      ctx.scale(1 + Math.abs(light.dir) * 0.15, 0.28 + air * 0.08);
      var sh = ctx.createRadialGradient(0, 0, 2, 0, 0, shadowW * (1 + air * 0.4));
      sh.addColorStop(0, "rgba(0,0,0," + shAlpha + ")");
      sh.addColorStop(0.55, "rgba(0,0,0," + shAlpha * 0.35 + ")");
      sh.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sh;
      ctx.beginPath();
      ctx.arc(0, 0, shadowW * (1 + air * 0.35), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Facing / attack direction chevron (move left = hit left is obvious)
    var aimFace = attacking ? drawFace : face;
    ctx.save();
    ctx.translate(floorPr.x + ox + aimFace * (drawW * 0.08), floorPr.y + 10);
    ctx.fillStyle = attacking
      ? "rgba(255, 200, 80, 0.95)"
      : "rgba(220, 235, 255, 0.75)";
    ctx.beginPath();
    // Arrow pointing the way they face / attack
    ctx.moveTo(aimFace * 16, 0);
    ctx.lineTo(aimFace * -4, -9);
    ctx.lineTo(aimFace * -4, 9);
    ctx.closePath();
    ctx.fill();
    if (attacking) {
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,220,120,0.95)";
      ctx.fillText(aimFace > 0 ? "→ HIT" : "HIT ←", aimFace * 6, 22);
    }
    ctx.restore();

    ctx.save();
    ctx.translate(floorPr.x + ox, floorPr.y - lift + oy);
    ctx.scale(drawFace, 1);
    if (rot) ctx.rotate(rot);
    if (f.invuln > 0 && Math.floor(f.animT * 24) % 2 === 0) ctx.globalAlpha = 0.4;

    // Only re-key if not already clean (avoid re-boxing jitter every draw)
    if (!spr || !spr._keyedOk) spr = ensureKeyedCanvas(spr, "cell") || spr;
    if (f._frameNext && !f._frameNext._keyedOk) {
      f._frameNext = ensureKeyedCanvas(f._frameNext, "cell") || f._frameNext;
    }

    if (spr && (spr.complete !== false) && (spr.width || spr.naturalWidth)) {
      // No breathe/squash on multi-frame — that caused size bobbing
      if (!hasFrames) {
        var breathe = 1;
        if (f.anim === "idle" || f.anim === "block") {
          breathe = 1 + Math.sin(state.time * 2.2 + (f.wx || 0) * 0.01) * 0.008;
        }
        var footSquash = f.onGround && f.hy < 4 ? 0.992 : 1;
        ctx.scale(1, footSquash * breathe);
      }

      var blend = f._frameBlend || 0;
      var nextFr = f._frameNext;
      if (hasFrames && nextFr && blend > 0.04 && blend < 0.96) {
        ctx.globalAlpha = 1 - blend;
        ctx.drawImage(spr, -drawW * 0.5, -drawH, drawW, drawH);
        ctx.globalAlpha = blend;
        ctx.drawImage(nextFr, -drawW * 0.5, -drawH, drawW, drawH);
        ctx.globalAlpha = 1;
      } else {
        ctx.drawImage(spr, -drawW * 0.5, -drawH, drawW, drawH);
      }

      if (!hasFrames && pose.flash > 0.12) {
        ctx.globalCompositeOperation = "source-atop";
        ctx.fillStyle = "rgba(255,255,255," + 0.28 * pose.flash + ")";
        ctx.fillRect(-drawW * 0.5, -drawH, drawW, drawH);
        ctx.globalCompositeOperation = "source-over";
      }
    } else {
      ctx.fillStyle = f.color || "#6080c0";
      ctx.fillRect(-drawW * 0.2, -drawH, drawW * 0.4, drawH);
    }

    var onHit = isAnimHitWindow(f);
    var pow = onHit ? 1 : Math.max(pose.reach || 0, pose.kick || 0, pose.glow || 0, pose.smear || 0);
    if (
      pow > 0.35 &&
      (f.anim === "punch" ||
        f.anim === "kick" ||
        f.anim === "spell" ||
        f.anim === "special" ||
        f.anim === "finisher" ||
        f.anim === "air_punch" ||
        f.anim === "air_kick" ||
        f.anim === "air_spell")
    ) {
      var gx = drawW * (f.anim === "kick" || f.anim === "air_kick" ? 0.28 : 0.4);
      var gy =
        -drawH *
        (f.anim === "kick" || f.anim === "air_kick"
          ? 0.32
          : f.anim === "spell" || f.anim === "air_spell"
            ? 0.55
            : 0.48);
      var pulse = (12 + pow * 30) * (drawH / 420);
      ctx.globalCompositeOperation = "lighter";
      var grd = ctx.createRadialGradient(gx, gy, 0, gx, gy, pulse);
      if (f.anim === "spell" || f.anim === "finisher") {
        grd.addColorStop(0, "rgba(230,245,255," + 0.85 * pow + ")");
        grd.addColorStop(0.45, "rgba(100,160,255," + 0.35 * pow + ")");
      } else {
        grd.addColorStop(0, "rgba(255,235,190," + 0.8 * pow + ")");
        grd.addColorStop(0.4, "rgba(255,130,70," + 0.35 * pow + ")");
      }
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(gx, gy, pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();

    var nameY = floorPr.y - drawH - 12 - f.hy * 0.35;
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(f.name || "Fighter", floorPr.x + 1, nameY);
    ctx.fillStyle = "#f8f4f0";
    ctx.fillText(f.name || "Fighter", floorPr.x, nameY - 1);
  }

  function drawFx(ctx, match) {
    if (!match || !match.fx) return;
    var dt = match._dt || 0.016;
    for (var i = match.fx.length - 1; i >= 0; i--) {
      var p = match.fx[i];
      p.t += dt;
      var u = clamp(p.t / (p.life || 0.5), 0, 1);
      var fade = 1 - u;
      if (p.vx) p.x += p.vx * dt;
      if (p.vy) p.y += p.vy * dt;
      ctx.save();
      ctx.globalAlpha = fade;
      if (p.kind === "label") {
        ctx.font = "bold " + (p.size || 32) + "px Impact, sans-serif";
        ctx.textAlign = "center";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.fillStyle = p.color || "#fff";
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillText(p.text, p.x, p.y);
      } else if (p.kind === "ring") {
        var rr = (p.r0 || 4) + ((p.r1 || 40) - (p.r0 || 4)) * u;
        ctx.strokeStyle = p.color || "#fff";
        ctx.lineWidth = 3 * fade;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color || "#fff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, (p.r || 4) * fade, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      if (p.t >= p.life) match.fx.splice(i, 1);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- match loop ---------- */
  function updateHud(match) {
    var timer = $("ft-timer");
    if (timer) timer.textContent = String(Math.ceil(match.timeLeft));
    var bars = $("ft-bars");
    if (!bars) return;
    bars.innerHTML = match.fighters
      .map(function (f) {
        var hpPct = clamp((f.hp / f.maxHp) * 100, 0, 100);
        var mPct = clamp((f.meter / f.maxMeter) * 100, 0, 100);
        return (
          '<div class="ft-bar-slot">' +
          '<div class="name"><span>' +
          escapeHtml(f.name) +
          (f.isCpu ? " (CPU)" : "") +
          "</span><span>" +
          Math.ceil(f.hp) +
          "</span></div>" +
          '<div class="ft-bar-track"><div class="ft-bar-fill" style="width:' +
          hpPct +
          '%"></div></div>' +
          '<div class="ft-bar-track"><div class="ft-bar-fill meter" style="width:' +
          mPct +
          '%"></div></div>' +
          "</div>"
        );
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function aliveOnTeam(fighters, team) {
    return fighters.filter(function (f) {
      return !f.dead && f.team === team;
    }).length;
  }

  /** True when a dead fighter has finished their KO (or fall) animation. */
  function isKoSequenceDone(f) {
    if (!f || !f.dead) return true;
    // Still need to enter KO
    if (f.anim !== "ko" && f.anim !== "fall") return false;
    if (f.frameClips && f.frameClips.ko && f.anim === "ko") {
      return f.animT >= frameClipDuration(f, "ko") + 0.2;
    }
    if (f.frameClips && f.frameClips.fall && f.anim === "fall") {
      // Fall may lead into KO; wait out fall then allow end if no ko strip
      return f.animT >= frameClipDuration(f, "fall") + 0.15;
    }
    var def = ANIMS[f.anim] || ANIMS.ko;
    return f.animT >= (def.dur || 1.1) + 0.25;
  }

  function allDeadFinishedKo(match) {
    return match.fighters.every(function (f) {
      if (f.isDummy) return true;
      if (!f.dead) return true;
      return isKoSequenceDone(f);
    });
  }

  function checkMatchEnd(match) {
    if (match.over) return;

    // Already waiting on final KO animation(s)
    if (match.pendingWinner) {
      if (allDeadFinishedKo(match)) {
        match.over = true;
        match.winner = match.pendingWinner;
        match.pendingWinner = null;
        setStatus("ft-match-status", "Winner: " + match.winner, "ok");
      }
      return;
    }

    var living = match.fighters.filter(function (f) {
      return !f.dead && !f.isDummy;
    });
    var endWinner = null;
    if (match.mode === "2v2") {
      var t1 = aliveOnTeam(match.fighters, 1);
      var t2 = aliveOnTeam(match.fighters, 2);
      if (t1 === 0 || t2 === 0) {
        endWinner = t1 > 0 ? "Team 1" : t2 > 0 ? "Team 2" : "Draw";
      }
    } else if (living.length <= 1) {
      endWinner = living[0] ? living[0].name : "Draw";
    }
    if (match.timeLeft <= 0 && !endWinner) {
      var best = null;
      match.fighters.forEach(function (f) {
        if (f.isDummy) return;
        if (!best || f.hp > best.hp) best = f;
      });
      endWinner = best ? best.name + " (time)" : "Draw";
    }
    if (endWinner) {
      // Hold winner banner until last KO animation plays out
      match.pendingWinner = endWinner;
      match.fighters.forEach(function (f) {
        if (f.dead && f.anim !== "ko" && f.anim !== "fall") {
          setAnim(f, "ko", true);
        }
      });
      if (allDeadFinishedKo(match)) {
        match.over = true;
        match.winner = match.pendingWinner;
        match.pendingWinner = null;
        setStatus("ft-match-status", "Winner: " + match.winner, "ok");
      } else {
        setStatus("ft-match-status", "K.O. …", "");
      }
    }
  }

  function tickMatch(match, dt) {
    if (match.paused || match.over) return;
    // Hitstop: freeze gameplay briefly on impact (Street Fighter feel)
    if (match.hitstop > 0 && !match.pendingWinner) {
      match.hitstop = Math.max(0, match.hitstop - dt);
      match._dt = 0;
      if (match.shake > 0) match.shake = Math.max(0, match.shake - dt * 40);
      updateHud(match);
      return;
    }
    // Clear residual hitstop once we're waiting on KO so the fall anim can play
    if (match.pendingWinner && match.hitstop > 0) {
      match.hitstop = 0;
    }
    match._dt = dt;
    if (!match.pendingWinner) {
      match.timeLeft = Math.max(0, match.timeLeft - dt);
    }
    if (match.shake > 0) match.shake = Math.max(0, match.shake - dt * 28);
    var map = match.map;
    match.fighters.forEach(function (f, i) {
      controlFighter(f, dt, match.fighters, map, i);
    });
    checkMatchEnd(match);
    updateHud(match);
  }

  function renderMatch(ctx, match) {
    ctx.save();
    if (match.shake > 0.5) {
      var mag = Math.min(12, match.shake);
      ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag * 0.6);
    }
    drawStageWorld(ctx, match.map, state.time);
    var sorted = match.fighters.slice().sort(function (a, b) {
      return a.wz - b.wz;
    });
    sorted.forEach(function (f) {
      drawFighter(ctx, f);
    });
    drawFx(ctx, match);
    ctx.restore();
    if (match.over) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#ffe8a0";
      ctx.font = "bold 48px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(match.winner || "KO", W / 2, H / 2);
    } else if (match.paused) {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 40px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", W / 2, H / 2);
    }
  }

  function loop(now) {
    now = now || performance.now();
    // Target smooth 60fps; cap spikes only (don't floor at 30fps)
    var raw = (now - (loop._t || now)) / 1000;
    loop._t = now;
    var dt = raw > 0 && raw < 0.1 ? raw : 1 / 60;
    // Always advance visual clock for 60fps breathe / VFX
    state.time = (state.time || 0) + dt;

    if (state.match && state.match.running) {
      var canvas = $("ft-canvas");
      var ctx = canvas && canvas.getContext("2d");
      tickMatch(state.match, dt);
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);
        renderMatch(ctx, state.match);
      }
    }
    if (state.train && state.train.running) {
      var tc = $("ft-train-canvas");
      var tctx = tc && tc.getContext("2d");
      tickMatch(state.train, dt);
      if (tctx) {
        tctx.clearRect(0, 0, W, H);
        renderMatch(tctx, state.train);
      }
      var log = $("ft-train-combo");
      if (log && state.train.fighters[0]) {
        var p = state.train.fighters[0];
        log.textContent =
          "Combo x" +
          Math.floor(p.combo) +
          ": " +
          (p.comboLog.join(" → ") || "—");
      }
    }
    if (state.mode === "map") {
      drawMapEditor();
    }
    // Smooth bake preview at display refresh rate
    if (state._bakePreviewLive && state._bakePreviewClip) {
      var clip = state._bakePreviewClip;
      var fps = clip.fps || 8;
      clip._acc = (clip._acc || 0) + dt;
      var step = 1 / fps;
      while (clip._acc >= step && clip.frames && clip.frames.length) {
        clip._acc -= step;
        clip.i = (clip.i + 1) % clip.frames.length;
      }
      paintBakePreviewFrame();
    }
    requestAnimationFrame(loop);
  }

  /* ---------- start match ---------- */
  function rosterFighter(slot, angle, rad, facing, team, forceCpu) {
    var card = state.roster[slot] || state.roster[0];
    var f = makeFighter({
      name: card ? card.name : "CPU " + (slot + 1),
      angle: angle,
      rad: rad,
      facing: facing,
      team: team,
      isCpu: forceCpu || !card || slot > 0,
      color: ["#e06050", "#5090e0", "#50c070", "#d0b040"][slot % 4],
      imgUrl: card && card.url,
    });
    function bindCardSprites() {
      var body = card._bodyImg || card._img;
      if (body) {
        attachFighterSprite(f, body);
        card._sprite = f.sprite;
      }
      // Attach multi-frame clips — force clean alpha on every clip type first
      if (card.frameClips) {
        if (!card._alphasClean) ensureCleanAlphaAllClips(card);
        f.frameClips = card.frameClips;
      }
    }
    if (card && (card._bodyImg || card._img)) {
      bindCardSprites();
    } else if (card) {
      var bodyUrl = card.bodyUrl || card.url;
      if (bodyUrl) {
        loadImg(bodyUrl).then(function (img) {
          card._bodyImg = img;
          card._img = img;
          bindCardSprites();
        });
      }
    }
    if (slot === 0 && card) f.isCpu = false;
    return f;
  }

  function applyLanPlayersToFighters(fighters) {
    var players = (state.lan.room && state.lan.room.players) || [];
    if (!players.length) return;
    // Slot 0 is local human; remaining lobby players override CPU names/images when present
    var others = players.filter(function (p) {
      return p.playerId !== state.lan.playerId;
    });
    for (var i = 0; i < others.length && i + 1 < fighters.length; i++) {
      var f = fighters[i + 1];
      var p = others[i];
      f.name = (p.name || f.name) + "";
      f.isCpu = true; // full remote input sync later — CPU pilots their roster look for now
      f._lan = true;
      if (p.imgUrl) {
        f.imgUrl = p.imgUrl;
        loadImg(p.imgUrl).then(function (img) {
          attachFighterSprite(f, img);
        });
      }
    }
  }

  function startMatch(kind) {
    if (!state.roster.length) {
      setStatus("ft-match-status", "Lock in a fighter first (Create fighter tab).", "err");
      return;
    }
    var mode = ($("ft-match-mode") && $("ft-match-mode").value) || "ffa";
    var map = getMap(($("ft-map-select") && $("ft-map-select").value) || "scene-rain-street");
    ensureSceneImage(map);
    var fighters = [];
    // Place fighters on the ground plane (wx left/right, wz depth into the painted scene)
    if (mode === "1v1") {
      fighters = [
        rosterFighter(0, 0, 0, 1, 1, false),
        rosterFighter(1, 0, 0, -1, 2, true),
      ];
      fighters[0].wx = -150;
      fighters[0].wz = 0;
      fighters[1].wx = 150;
      fighters[1].wz = 0;
    } else if (mode === "2v2") {
      fighters = [
        rosterFighter(0, 0, 0, 1, 1, false),
        rosterFighter(1, 0, 0, 1, 1, true),
        rosterFighter(2, 0, 0, -1, 2, true),
        rosterFighter(3, 0, 0, -1, 2, true),
      ];
      // Slightly smaller when 4 on screen so they still read as subjects
      fighters.forEach(function (fi) {
        fi.h = STAGE.heroH * 0.88;
        fi.w = STAGE.heroW * 0.88;
      });
      fighters[0].wx = -200;
      fighters[0].wz = -10;
      fighters[1].wx = -90;
      fighters[1].wz = 25;
      fighters[2].wx = 90;
      fighters[2].wz = 25;
      fighters[3].wx = 200;
      fighters[3].wz = -10;
    } else {
      fighters = [
        rosterFighter(0, 0, 0, 1, 0, false),
        rosterFighter(1, 0, 0, -1, 0, true),
        rosterFighter(2, 0, 0, 1, 0, true),
        rosterFighter(3, 0, 0, -1, 0, true),
      ];
      fighters.forEach(function (fi) {
        fi.h = STAGE.heroH * 0.88;
        fi.w = STAGE.heroW * 0.88;
      });
      fighters[0].wx = -180;
      fighters[0].wz = 0;
      fighters[1].wx = -55;
      fighters[1].wz = 30;
      fighters[2].wx = 55;
      fighters[2].wz = 30;
      fighters[3].wx = 180;
      fighters[3].wz = 0;
    }
    fighters[0].isCpu = false;
    fighters[0].name = (state.roster[0] && state.roster[0].name) || "You";
    applyLanPlayersToFighters(fighters);

    state.match = {
      running: true,
      paused: false,
      over: false,
      winner: "",
      mode: mode,
      map: map,
      fighters: fighters,
      timeLeft: ROUND_TIME,
      fx: [],
      kind: kind || "arena",
      hitstop: 0,
      shake: 0,
      pendingWinner: null,
    };
    var hud = $("ft-hud");
    if (hud) hud.hidden = false;
    $("ft-pause") && ($("ft-pause").disabled = false);
    setStatus(
      "ft-match-status",
      "Stage ready — fighters on the ground, scene behind them. CPU fills empty slots.",
      "ok"
    );
    updateHud(state.match);
  }

  function startTraining() {
    if (!state.roster.length) {
      setStatus("ft-match-status", "Create a fighter first.", "err");
      return;
    }
    var map = getMap(($("ft-map-select") && $("ft-map-select").value) || state.currentMapId);
    ensureSceneImage(map);
    var p1 = rosterFighter(0, 0, 0, 1, 1, false);
    p1.wx = -130;
    p1.wz = 0;
    p1.isCpu = false;
    var dummy = makeFighter({
      name: "Dummy",
      wx: 130,
      wz: 0,
      facing: -1,
      isCpu: false,
      isDummy: true,
      color: "#888",
    });
    dummy.maxHp = 9999;
    dummy.hp = 9999;
    state.train = {
      running: true,
      paused: false,
      over: false,
      mode: "train",
      map: map,
      fighters: [p1, dummy],
      timeLeft: 999,
      fx: [],
      hitstop: 0,
      shake: 0,
    };
  }

  /* ---------- map editor ---------- */
  function drawMapEditor() {
    var canvas = $("ft-map-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var preview = {
      id: "preview",
      edge: state.mapEdit.edge || "wall",
      procedural: "aurora",
      sceneImg: state.mapEdit.sceneImg,
      sceneUrl: state.mapEdit.sceneUrl,
    };
    ctx.clearRect(0, 0, W, H);
    drawStageWorld(ctx, preview, state.time || 0);
    if (state.roster[0] && (state.roster[0]._bodyImg || state.roster[0]._img)) {
      var ghost = makeFighter({ wx: 0, wz: 10, facing: 1, name: state.roster[0].name });
      var r0 = state.roster[0];
      attachFighterSprite(ghost, r0._bodyImg || r0._img);
      drawFighter(ctx, ghost);
    }
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "15px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(
      (state.mapEdit.name || "Scene") +
        (state.mapEdit.sceneUrl ? " · generated still ready" : " · generate a picture-perfect scene"),
      16,
      28
    );
  }

  function ensureMapEditSeed() {
    if (!state.mapEdit.prompt) {
      state.mapEdit.prompt =
        "cinematic fighting stage background, beautiful scenic environment, clear ground for characters, no people in frame";
    }
  }

  function genScene() {
    var prompt =
      ($("ft-scene-prompt") && $("ft-scene-prompt").value.trim()) ||
      state.mapEdit.prompt ||
      "";
    if (!prompt) {
      setStatus("ft-map-status", "Describe the scene first.", "err");
      return;
    }
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "scene-" + Date.now();
    setStatus("ft-map-status", "Generating picture-perfect stage still…", "");
    $("ft-scene-gen") && ($("ft-scene-gen").disabled = true);
    var stasis =
      "PICTURE-PERFECT FIGHTING-GAME STAGE STILL. " +
      "A beautiful cinematic environment with clear open ground in the foreground for characters to stand on. " +
      "Empty of people — fighters will be composited later. No UI, no text, no watermark. " +
      "Scene: " +
      prompt +
      ". Wide establishing shot, dramatic lighting, ground plane readable.";
    fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        stasis: stasis,
        prompt: "cinematic stage background with ground, " + prompt,
        buzz_words: ["stage", "environment", "ground", "cinematic", "empty of people", "scenic"],
        spells: [],
        aspect_ratio: "16:9",
        mag_fresh: true,
        spell_cast: false,
        fresh_variation: true,
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, status: r.status, d: d || {} };
        });
      })
      .then(function (res) {
        var url = extractImageUrl(res.d);
        if (url) return url;
        var jid = res.d.job_id || jobId;
        if (res.status === 202 || jid) return pollFightImageJob(jid, 90, "ft-map-status");
        throw new Error((res.d && res.d.error) || "Scene generate failed");
      })
      .then(function (url) {
        state.mapEdit.sceneUrl = url;
        state.mapEdit.prompt = prompt;
        return loadImg(url).then(function (img) {
          state.mapEdit.sceneImg = img;
        });
      })
      .then(function () {
        setStatus("ft-map-status", "Dome scene ready — Save scene, then Enter dome in Arena.", "ok");
      })
      .catch(function (err) {
        setStatus("ft-map-status", (err && err.message) || "Scene gen failed", "err");
      })
      .finally(function () {
        $("ft-scene-gen") && ($("ft-scene-gen").disabled = false);
      });
  }

  /* ---------- character create ---------- */
  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        resolve(r.result);
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  /**
   * Bake clean binary-alpha PNG from any still URL and return data URL + canvas.
   */
  function processIdentityStill(url) {
    return ensureDataUrl(url).then(function (dataUrl) {
      return loadImg(dataUrl).then(function (img) {
        var keyed = bakeIdentityAlphaStill(img) || ensureKeyedCanvas(img);
        if (!keyed) throw new Error("Could not build clean alpha still");
        var png = canvasToPngDataUrl(keyed);
        return { png: png || dataUrl, canvas: keyed, img: img };
      });
    });
  }

  /**
   * Preview still. Does NOT process gallery references by default (looks weird).
   * Pass { applyAlpha: true } after AI generate / lock to show clean cutout.
   */
  function showPreview(url, label, opts) {
    opts = opts || {};
    var img = $("ft-preview");
    var lab = $("ft-preview-label");
    var wrap = $("ft-preview-wrap") || (img && img.parentElement);
    if (!img) return;
    if (!url) {
      img.src = "";
      img.hidden = true;
      if (lab) lab.hidden = true;
      if (wrap) wrap.classList.remove("ft-preview-alpha");
      return;
    }
    if (!opts.applyAlpha) {
      if (wrap) wrap.classList.remove("ft-preview-alpha");
      img.src = url;
      img.hidden = false;
      if (lab) {
        lab.textContent = label || state.draftLabel || "";
        lab.hidden = false;
      }
      return;
    }
    if (wrap) wrap.classList.add("ft-preview-alpha");
    processIdentityStill(url)
      .then(function (res) {
        state.draftDataUrl = res.png;
        state.draftAlphaReady = true;
        img.src = res.png;
        img.hidden = false;
        if (lab) {
          lab.textContent = (label || state.draftLabel || "Identity still") + " · clean alpha";
          lab.hidden = false;
        }
      })
      .catch(function () {
        if (wrap) wrap.classList.remove("ft-preview-alpha");
        img.src = url;
        img.hidden = false;
        if (lab) {
          lab.textContent = label || state.draftLabel || "";
          lab.hidden = !url;
        }
      });
  }

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (el.isContentEditable) return true;
    return !!(el.closest && el.closest("input, textarea, select, [contenteditable='true']"));
  }

  function ensureDataUrl(url) {
    if (!url) return Promise.reject(new Error("No image"));
    if (String(url).indexOf("data:") === 0) return Promise.resolve(url);
    return loadImg(url).then(function (img) {
      var c = document.createElement("canvas");
      var w = Math.min(768, img.naturalWidth || img.width || 512);
      var h = Math.min(768, img.naturalHeight || img.height || 512);
      var scale = Math.min(w / (img.naturalWidth || w), h / (img.naturalHeight || h));
      c.width = Math.max(1, Math.round((img.naturalWidth || w) * scale));
      c.height = Math.max(1, Math.round((img.naturalHeight || h) * scale));
      var ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.9);
    });
  }

  function setDraftStill(url, label) {
    if (!url) return;
    state.draftDataUrl = url;
    state.draftPortrait = "";
    state.draftBody = "";
    state.draftTpose = "";
    state.draftLabel = label || "";
    showPreview(url, label);
    document.querySelectorAll(".ft-src-item").forEach(function (btn) {
      btn.classList.toggle("selected", btn.getAttribute("data-url") === url);
    });
    setStatus("ft-create-status", "Still selected" + (label ? ": " + label : "") + ".", "ok");
    // Cache a data-URL for costume API / lock-in (gallery paths need conversion)
    ensureDataUrl(url)
      .then(function (dataUrl) {
        state.draftDataUrl = dataUrl;
        state._draftSourcePath = url;
      })
      .catch(function () {});
  }

  function loadSourceCatalog(src) {
    src = src || state.src || "paintings";
    state.src = src;
    var grid = $("ft-src-grid");
    var status = $("ft-src-status");
    var browse = $("ft-src-browse");
    var gal = $("ft-src-gallery");
    if (browse) browse.hidden = src !== "browse";
    if (gal) gal.hidden = src === "browse";
    document.querySelectorAll(".ft-src-tab").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-ft-src") === src);
    });
    if (src === "browse") {
      if (status) status.textContent = "";
      return Promise.resolve();
    }
    if (!grid) return Promise.resolve();
    state.srcLoading = true;
    if (status) status.textContent = "Loading " + src + "…";
    grid.innerHTML = "";
    var q = ($("ft-src-search") && $("ft-src-search").value.trim()) || "";
    // Prefer transfer catalog (paintings/generated/phone); fall back to gallery-assets
    var url =
      apiUrl("/api/transfer/catalog?collection=" + encodeURIComponent(src) + "&t=" + Date.now());
    return fetch(url, { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        var items = (d && d.items) || [];
        if (!items.length && src !== "phone-uploads") {
          return fetch(
            apiUrl(
              "/api/gallery-assets?collection=" +
                encodeURIComponent(src === "paintings" ? "generated" : src) +
                "&t=" +
                Date.now()
            ),
            { cache: "no-store" }
          )
            .then(function (r2) {
              return r2.ok ? r2.json() : null;
            })
            .then(function (g) {
              return (g && g.items) || items;
            })
            .catch(function () {
              return items;
            });
        }
        return items;
      })
      .then(function (items) {
        // Paintings fallback: scan via transfer only; if empty try numeric sample
        if ((!items || !items.length) && src === "paintings") {
          items = [];
          for (var n = 1; n <= 48; n++) {
            items.push({
              url: "/paintings/" + n + ".jpg",
              title: "#" + n,
              name: n + ".jpg",
            });
          }
        }
        if (q) {
          var ql = q.toLowerCase();
          items = items.filter(function (it) {
            var t = String(it.title || it.name || it.url || "").toLowerCase();
            return t.indexOf(ql) >= 0;
          });
        }
        state.srcItems = items.slice(0, 400);
        state.srcLoading = false;
        if (!state.srcItems.length) {
          if (status) status.textContent = "No images in " + src + ".";
          grid.innerHTML = "";
          return;
        }
        if (status)
          status.textContent =
            state.srcItems.length + " images — click one to use as fighter still.";
        grid.innerHTML = state.srcItems
          .map(function (it) {
            var u = it.url || it.image_url || "";
            if (!u) return "";
            if (u.charAt(0) !== "/" && u.indexOf("http") !== 0 && u.indexOf("data:") !== 0) {
              u = "/" + u.replace(/^\.\//, "");
            }
            var title = it.title || it.name || u.split("/").pop() || "image";
            return (
              '<button type="button" class="ft-src-item' +
              (state.draftDataUrl === u ? " selected" : "") +
              '" data-url="' +
              escapeHtml(u) +
              '" data-title="' +
              escapeHtml(title) +
              '" title="' +
              escapeHtml(title) +
              '">' +
              '<img src="' +
              escapeHtml(u) +
              '" alt="" loading="lazy" />' +
              "<span>" +
              escapeHtml(title) +
              "</span></button>"
            );
          })
          .join("");
      })
      .catch(function (err) {
        state.srcLoading = false;
        if (status)
          status.textContent =
            "Could not load " + src + " — " + ((err && err.message) || "offline");
      });
  }

  function persistRoster() {
    try {
      localStorage.setItem(
        "fight_roster_v1",
        JSON.stringify(
          state.roster.slice(0, 8).map(function (c) {
            var u = c.url || "";
            if (u.indexOf("data:") === 0 && u.length > 200000) {
              return {
                id: c.id,
                name: c.name,
                url: c.serverUrl || "",
                costume: c.costume,
                created: c.created,
                serverId: c.serverId,
              };
            }
            return {
              id: c.id,
              name: c.name,
              url: u,
              portraitUrl: c.portraitUrl || u,
              bodyUrl: c.bodyUrl || "",
              tposeUrl: c.tposeUrl || "",
              costume: c.costume,
              created: c.created,
              serverId: c.serverId,
            };
          })
        )
      );
    } catch (e) {}
  }

  function deleteFighter(id) {
    if (!id) return;
    var card = state.roster.filter(function (c) {
      return c.id === id;
    })[0];
    var label = (card && card.name) || "Fighter";
    state.roster = state.roster.filter(function (c) {
      return c.id !== id;
    });
    if (state.selectedId === id) {
      state.selectedId = state.roster[0] ? state.roster[0].id : null;
    }
    if (state._bakeCard && state._bakeCard.id === id) {
      if (state.selectedId) {
        var next = state.roster.filter(function (c) {
          return c.id === state.selectedId;
        })[0];
        if (next) openBakeStudioForCard(next);
        else clearBakeStudioView();
      } else {
        clearBakeStudioView();
      }
    }
    persistRoster();
    renderRoster();
    setStatus("ft-create-status", "Deleted “" + label + "”.", "ok");
  }

  function frameToImgSrc(fr) {
    if (!fr) return "";
    if (typeof fr === "string") return fr;
    if (fr.src && typeof fr.src === "string" && fr.src.indexOf("data:") === 0) return fr.src;
    if (typeof fr.toDataURL === "function") {
      try {
        return fr.toDataURL("image/png");
      } catch (e) {
        return "";
      }
    }
    return fr.src || "";
  }

  /** Prefer idle/walk for roster hover preview. */
  function pickHoverClip(card) {
    if (!card || !card.frameClips) return null;
    var prefer = ["idle", "walk", "punch", "kick", "block"];
    var i;
    for (i = 0; i < prefer.length; i++) {
      var c = card.frameClips[prefer[i]];
      if (c && c.frames && c.frames.length) return c;
    }
    var keys = Object.keys(card.frameClips);
    for (i = 0; i < keys.length; i++) {
      var cl = card.frameClips[keys[i]];
      if (cl && cl.frames && cl.frames.length) return cl;
    }
    return null;
  }

  function stopRosterHoverPreview() {
    var h = state._rosterHover;
    if (!h) return;
    if (h.timer) {
      clearInterval(h.timer);
      h.timer = 0;
    }
    if (h.img && h.still) {
      try {
        h.img.src = h.still;
      } catch (e) {}
    }
    state._rosterHover = null;
  }

  function startRosterHoverPreview(card, img) {
    stopRosterHoverPreview();
    if (!card || !img) return;
    var clip = pickHoverClip(card);
    if (!clip || !clip.frames || clip.frames.length < 2) return;
    var cacheKey = clip.frames.length + "@" + (clip.fps || 8);
    var srcs = card._hoverSrcCache && card._hoverSrcCache.key === cacheKey
      ? card._hoverSrcCache.srcs
      : null;
    if (!srcs) {
      srcs = [];
      var i;
      for (i = 0; i < clip.frames.length; i++) {
        var s = frameToImgSrc(clip.frames[i]);
        if (s) srcs.push(s);
      }
      card._hoverSrcCache = { key: cacheKey, srcs: srcs };
    }
    if (srcs.length < 2) return;
    var still = card.portraitUrl || card.url || img.getAttribute("src") || "";
    state._rosterHover = {
      cardId: card.id,
      img: img,
      still: still,
      srcs: srcs,
      i: 0,
      timer: 0,
    };
    var fps = Math.max(4, clip.fps || 8);
    var step = Math.round(1000 / fps);
    state._rosterHover.timer = setInterval(function () {
      var hv = state._rosterHover;
      if (!hv || !hv.img) return;
      hv.i = (hv.i + 1) % hv.srcs.length;
      hv.img.src = hv.srcs[hv.i];
    }, step);
  }

  /**
   * Exclusive active fighter: one selection, Bake studio always matches that card
   * (or empty state). Clicking the same card again deselects.
   */
  function activateFighter(card, opts) {
    opts = opts || {};
    stopRosterHoverPreview();

    // Toggle off if re-clicking the active fighter (unless force)
    if (!opts.force && card && state.selectedId === card.id && !opts.keepSelected) {
      if (state._bakeCard && state._bakeCard._bakingFrames && state._bakeCard.id === card.id) {
        // Don't deselect mid-bake
      } else {
        state.selectedId = null;
        clearBakeStudioView();
        renderRoster();
        setStatus("ft-create-status", "Deselected “" + card.name + "”.", "ok");
        return;
      }
    }

    if (!card) {
      state.selectedId = null;
      clearBakeStudioView();
      renderRoster();
      return;
    }

    // Another fighter is baking — keep studio on the bake target
    if (
      state._bakeCard &&
      state._bakeCard._bakingFrames &&
      state._bakeCard.id !== card.id
    ) {
      state.selectedId = card.id;
      state.roster = [card].concat(
        state.roster.filter(function (c) {
          return c.id !== card.id;
        })
      );
      persistRoster();
      renderRoster();
      setStatus(
        "ft-create-status",
        "Selected “" +
          card.name +
          "” (P1). Bake studio still on “" +
          state._bakeCard.name +
          "” until bake finishes.",
        "ok"
      );
      return;
    }

    state.selectedId = card.id;
    state.roster = [card].concat(
      state.roster.filter(function (c) {
        return c.id !== card.id;
      })
    );
    persistRoster();
    openBakeStudioForCard(card);
    renderRoster();
  }

  function clearBakeStudioView() {
    if (state._bakePreviewTimer) {
      clearInterval(state._bakePreviewTimer);
      state._bakePreviewTimer = 0;
    }
    state._bakePreviewClip = null;
    state._bakePreviewLive = false;
    state._bakeViewClip = null;
    state._bakeClipList = [];
    state._bakeCard = null;
    var el = bakeStudioEls();
    if (!el.root) return;
    el.root.hidden = true;
    if (el.frames) el.frames.innerHTML = "";
    if (el.log) el.log.innerHTML = "";
    if (el.bar) el.bar.style.width = "0%";
    if (el.label) el.label.textContent = "";
    if (el.phase) el.phase.textContent = "";
    if (el.clipName) el.clipName.textContent = "—";
    if (el.strip) {
      el.strip.removeAttribute("src");
      el.strip.alt = "";
    }
    if (el.preview) {
      var ctx = el.preview.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, el.preview.width, el.preview.height);
    }
    var tabs = $("ft-bake-clip-tabs");
    if (tabs) tabs.innerHTML = "";
  }

  function openBakeStudioForCard(card) {
    if (!card) {
      clearBakeStudioView();
      return;
    }
    if (state._bakePreviewTimer) {
      clearInterval(state._bakePreviewTimer);
      state._bakePreviewTimer = 0;
    }
    state._bakePreviewClip = null;
    state._bakeCard = card;
    state._bakePreviewLive = true;
    state._bakeViewClip = null;

    var el = bakeStudioEls();
    if (!el.root) return;
    el.root.hidden = false;
    if (el.frames) el.frames.innerHTML = "";
    if (el.log) el.log.innerHTML = "";
    if (el.bar) el.bar.style.width = "0%";
    if (el.label) el.label.textContent = card._framesReady ? "Clips ready" : "Roster preview";
    if (el.clipName) el.clipName.textContent = "—";
    if (el.strip) {
      el.strip.removeAttribute("src");
      el.strip.alt = "";
    }
    var refUrl = card.url || card.bodyUrl || card.portraitUrl || "";
    if (el.ref && refUrl) el.ref.src = refUrl;

    var hasClips =
      card.frameClips &&
      Object.keys(card.frameClips).some(function (n) {
        return (
          card.frameClips[n] &&
          card.frameClips[n].frames &&
          card.frameClips[n].frames.length
        );
      });

    if (hasClips) {
      if (!card._alphasClean) {
        var nClean = ensureCleanAlphaAllClips(card);
        if (el.phase) {
          el.phase.textContent =
            "Viewing “" +
            card.name +
            "” — clean alpha applied to " +
            nClean +
            " frames (all clips)";
        }
      } else if (el.phase) {
        el.phase.textContent =
          "Viewing “" + card.name + "” — all clips use clean alpha · tabs to review";
      }
      rebuildBakeClipTabs(card);
      var first =
        (state._bakeClipList && state._bakeClipList[0]) ||
        Object.keys(card.frameClips)[0];
      if (first) selectBakeClip(card, first);
      state._bakePreviewLive = true;
      setStatus(
        "ft-create-status",
        "Active: “" +
          card.name +
          "” — idle/walk/punch/kick/spell/special/finisher/hit/block/ko/jump use clean alpha.",
        "ok"
      );
    } else {
      var tabs = $("ft-bake-clip-tabs");
      if (tabs) tabs.innerHTML = "";
      state._bakeClipList = [];
      if (el.phase) {
        el.phase.textContent =
          "“" + card.name + "” has no multi-frame clips yet — lock & bake to animate";
      }
      if (el.preview) {
        var ctx = el.preview.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, el.preview.width, el.preview.height);
          ctx.fillStyle = "#1a1e28";
          ctx.fillRect(0, 0, el.preview.width, el.preview.height);
          if (refUrl) {
            var img = new Image();
            img.onload = function () {
              var sc = Math.min(
                el.preview.width / img.width,
                el.preview.height / img.height
              ) * 0.9;
              var dw = img.width * sc;
              var dh = img.height * sc;
              ctx.drawImage(
                img,
                (el.preview.width - dw) / 2,
                (el.preview.height - dh) / 2,
                dw,
                dh
              );
            };
            img.src = refUrl;
          }
        }
      }
      setStatus(
        "ft-create-status",
        "Active: “" + card.name + "”. Bake multi-frame anims to preview clips.",
        "ok"
      );
    }
  }

  function renderRoster() {
    var el = $("ft-roster");
    if (!el) return;
    stopRosterHoverPreview();
    if (!state.roster.length) {
      el.innerHTML = '<p class="ft-muted">No fighters locked yet.</p>';
      return;
    }
    el.innerHTML = state.roster
      .map(function (c) {
        var hasAnim = !!pickHoverClip(c);
        return (
          '<div class="ft-roster-card' +
          (c.id === state.selectedId ? " selected" : "") +
          (hasAnim ? " has-anim" : "") +
          '" data-id="' +
          escapeHtml(c.id) +
          '" title="' +
          (hasAnim ? "Hover to preview anim · click to activate" : "Click to activate") +
          '">' +
          '<button type="button" class="ft-roster-pick" data-id="' +
          escapeHtml(c.id) +
          '" title="Select fighter">' +
          (c.portraitUrl || c.url
            ? '<img class="ft-roster-thumb" src="' +
              escapeHtml(c.portraitUrl || c.url) +
              '" alt="" draggable="false" />'
            : "") +
          "<span>" +
          escapeHtml(c.name) +
          "</span></button>" +
          '<button type="button" class="ft-roster-del" data-id="' +
          escapeHtml(c.id) +
          '" title="Delete fighter" aria-label="Delete ' +
          escapeHtml(c.name) +
          '">×</button>' +
          "</div>"
        );
      })
      .join("");
  }

  function extractImageUrl(payload) {
    if (!payload) return "";
    if (typeof payload === "string" && (payload.indexOf("/") === 0 || payload.indexOf("http") === 0 || payload.indexOf("data:") === 0))
      return payload;
    if (payload.url) return payload.url;
    if (payload.image_url) return payload.image_url;
    if (payload.image && payload.image.url) return payload.image.url;
    if (payload.images && payload.images[0]) {
      var im = payload.images[0];
      return (im && im.url) || im || "";
    }
    if (payload.result && payload.result.url) return payload.result.url;
    return "";
  }

  function delayMs(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function pollFightImageJob(jobId, left, statusId) {
    if (left == null) left = 90;
    statusId = statusId || "ft-create-status";
    if (state._bakeCancel) return Promise.reject(new Error("Bake cancelled"));
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for image."));
    return fetch(apiUrl("/api/jobs/" + jobId), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (job) {
        var st = String((job && job.status) || "working").toLowerCase();
        var msg = "AI job " + st + " · " + left + " polls left";
        setStatus(statusId, msg, "");
        var phase = $("ft-bake-phase");
        if (phase && !state._bakeCancel) {
          phase.textContent = msg + (state._bakeCurrentAnim ? " · " + state._bakeCurrentAnim.toUpperCase() : "");
        }
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractImageUrl(job);
          if (url) return url;
          throw new Error("Job finished but no image URL.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          var err = (job && job.error) || "Image job failed";
          if (typeof err === "object") err = err.message || JSON.stringify(err);
          throw new Error(String(err));
        }
        return delayMs(1500).then(function () {
          return pollFightImageJob(jobId, left - 1, statusId);
        });
      });
  }

  /** Random identity traits so two gens never collapse into the same stock fighter. */
  function uniqueFighterDNA(name, look) {
    function pick(arr) {
      return arr[(Math.random() * arr.length) | 0];
    }
    var builds = [
      "tall lean frame",
      "stocky powerful build",
      "compact athletic build",
      "long-limbed wiry frame",
      "broad-shouldered heavyweight",
      "petite dense fighter",
    ];
    var faces = [
      "sharp angular face with high cheekbones",
      "round soft face",
      "weathered scarred face",
      "youthful smooth face",
      "stern older face",
      "androgynous elegant face",
    ];
    var skins = [
      "deep brown skin",
      "pale freckled skin",
      "olive tan skin",
      "golden bronze skin",
      "cool undertone fair skin",
      "rich mahogany skin",
    ];
    var hair = [
      "shaved head",
      "long dark braids",
      "wild colorful mohawk",
      "silver short bob",
      "thick dreadlocks",
      "bald with scalp tattoos",
      "high ponytail",
      "messy undercut",
      "flowing white hair",
      "tight cornrows",
    ];
    var vibes = [
      "street brawler energy",
      "elegant duelist energy",
      "occult caster energy",
      "cyber enforcer energy",
      "tribal champion energy",
      "royal knight energy",
      "rogue assassin energy",
      "carnival gladiator energy",
    ];
    var accents = [
      "signature color: deep crimson",
      "signature color: electric teal",
      "signature color: bone white and violet",
      "signature color: rust orange",
      "signature color: lime and charcoal",
      "signature color: rose gold and steel",
      "signature color: cobalt blue",
      "signature color: sunflower yellow and black",
    ];
    var avoid = state.roster
      .slice(0, 8)
      .map(function (c) {
        return (c.name || "") + " / " + String(c.costume || "").slice(0, 80);
      })
      .filter(Boolean)
      .join(" | ");
    return {
      build: pick(builds),
      face: pick(faces),
      skin: pick(skins),
      hair: pick(hair),
      vibe: pick(vibes),
      accent: pick(accents),
      seedTag: "uid-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      avoid: avoid,
      name: String(name || "").trim(),
      look: String(look || "").trim() || "distinctive arena fighter",
    };
  }

  /**
   * Full-body requirement — always FIRST in the prompt (models weight the start heavily).
   */
  var FULL_BODY_RULE =
    "CRITICAL #1 — COMPLETE FULL-BODY CHARACTER ONLY: entire figure from top of head through neck, torso, " +
    "hips, BOTH legs, and BOTH feet. Arms fully visible. Camera pulled back like a Street Fighter character " +
    "select screen. Large empty studio margin above head and below feet. " +
    "FORBIDDEN: close-up, face portrait, bust, chest-up, waist-up, cropped legs, missing feet, " +
    "missing head, zoomed crop, half character, severed body. " +
    "If any part of the design brief suggests a portrait or close-up, IGNORE it — always full body. ";

  /**
   * Create a new fighter — USER PROMPT is primary. Thick black outline, plain studio plate.
   * Never attach gallery refs here (they force bust crops and waste credits).
   */
  function buildUniqueFighterPrompt(userPrompt, name, hasReference) {
    var dna = uniqueFighterDNA(name, userPrompt);
    var look = String(userPrompt || "").trim() || dna.look;
    var keyBg =
      "BACKGROUND: plain seamless " +
      KEY_BG.label +
      " filling the frame — no environment, no floor props. " +
      "Body, outfit, skin, hair, eyes, weapons 100% solid opaque.";
    return {
      stasis:
        FULL_BODY_RULE +
        "ORIGINAL 2D FIGHTING-GAME CHARACTER SPRITE. " +
        "Design brief (appearance only — do not write as text in the image): " +
        look +
        ". " +
        "Fighting-ready stance, face readable, thick bold black comic ink outline. " +
        "If the design implies a weapon, show it held ready. " +
        "Optional flavor: " +
        dna.vibe +
        ", " +
        dna.accent +
        ". " +
        keyBg +
        " NO text, letters, numbers, name tags, captions, logos, watermarks. " +
        "Exactly one complete character. " +
        dna.seedTag +
        ".",
      prompt:
        "full body fighter head to feet both legs visible street fighter select screen, " +
        "not portrait not bust, thick black outline, " +
        look.slice(0, 100) +
        ", flat studio gray " +
        KEY_BG.hex +
        ", no text",
      buzz_words: [
        "full body head to feet",
        "both legs both feet visible",
        "street fighter character select",
        "not portrait not bust not cropped",
        "camera pulled back",
        "thick black outline",
        "plain studio background",
        "no text no watermark",
        "weapon if designed",
        look.slice(0, 50),
      ],
    };
  }

  function requestFightImage(built, aspect, referenceImage, statusId, opts) {
    opts = opts || {};
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "fight-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    var body = {
      job_id: jobId,
      stasis: built.stasis,
      prompt: built.prompt,
      buzz_words: built.buzz_words,
      spells: [],
      aspect_ratio: aspect || "3:4",
      mag_fresh: true,
      spell_cast: false,
      fresh_variation: true,
    };
    if (referenceImage) {
      body.reference_image = referenceImage;
      // Hard identity lock only when baking anims of an already-locked fighter
      if (opts.lockIdentity) {
        body.spell_reference_image = referenceImage;
        body.mag_fresh = false;
        body.fresh_variation = false;
      } else {
        // Soft style hint only — still invent freely
        body.mag_fresh = true;
        body.fresh_variation = true;
      }
    }
    return fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, status: r.status, d: d || {} };
        });
      })
      .then(function (res) {
        var d = res.d;
        var url = extractImageUrl(d);
        if (url) return url;
        var jid = d.job_id || jobId;
        if (res.status === 202 || jid) return pollFightImageJob(jid, 90, statusId || "ft-create-status");
        if (!res.ok) {
          var msg = d.error || d.message || "Generate failed";
          if (typeof msg === "object") msg = msg.message || JSON.stringify(msg);
          if (/^[a-f0-9-]{16,}$/i.test(String(msg).trim())) msg = "Generate failed — try again";
          throw new Error(msg);
        }
        throw new Error("No image returned — is start_server.bat running with xAI key?");
      });
  }

  /* ---------- Bake studio UI (live progress + previews) ---------- */
  function bakeStudioEls() {
    return {
      root: $("ft-bake-studio"),
      phase: $("ft-bake-phase"),
      bar: $("ft-bake-bar"),
      label: $("ft-bake-label"),
      ref: $("ft-bake-ref"),
      strip: $("ft-bake-strip"),
      frames: $("ft-bake-frames"),
      clipName: $("ft-bake-clip-name"),
      preview: $("ft-bake-preview"),
      log: $("ft-bake-log"),
      cancel: $("ft-bake-cancel"),
      play: $("ft-bake-play"),
    };
  }

  function bakeLog(msg, kind) {
    var log = $("ft-bake-log");
    if (!log) return;
    var line = document.createElement("div");
    line.className = kind || "";
    var t = new Date();
    var ts =
      String(t.getHours()).padStart(2, "0") +
      ":" +
      String(t.getMinutes()).padStart(2, "0") +
      ":" +
      String(t.getSeconds()).padStart(2, "0");
    line.textContent = "[" + ts + "] " + msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function showBakeStudio(card) {
    var el = bakeStudioEls();
    if (!el.root) return;
    el.root.hidden = false;
    if (el.log) el.log.innerHTML = "";
    if (el.frames) el.frames.innerHTML = "";
    if (el.bar) el.bar.style.width = "0%";
    if (el.label) el.label.textContent = "Starting…";
    if (el.phase) el.phase.textContent = "Preparing bake for “" + (card.name || "Fighter") + "”";
    if (el.clipName) el.clipName.textContent = "—";
    if (el.strip) {
      el.strip.removeAttribute("src");
      el.strip.alt = "Waiting for strip…";
    }
    var refUrl = card.url || card.bodyUrl || card.portraitUrl || "";
    if (el.ref && refUrl) el.ref.src = refUrl;
    state._bakePreviewClip = null;
    if (state._bakePreviewTimer) {
      clearInterval(state._bakePreviewTimer);
      state._bakePreviewTimer = 0;
    }
  }

  function hideBakeStudioSoon() {
    /* keep studio visible so user can review frames after bake */
  }

  function updateBakeProgress(done, total, animName, phaseText) {
    var el = bakeStudioEls();
    var pct = total ? Math.round((done / total) * 100) : 0;
    if (el.bar) el.bar.style.width = pct + "%";
    if (el.label)
      el.label.textContent =
        done +
        " / " +
        total +
        " clips" +
        (animName ? " · now: " + animName.toUpperCase() : "") +
        " · " +
        pct +
        "%";
    if (el.phase && phaseText) el.phase.textContent = phaseText;
    if (el.clipName && animName) el.clipName.textContent = animName.toUpperCase();
    setStatus(
      "ft-create-status",
      "Baking “" + (animName || "…") + "” (" + done + "/" + total + ")…",
      ""
    );
  }

  function showBakeStrip(url, animName) {
    var el = bakeStudioEls();
    if (el.strip && url) {
      el.strip.src = url;
      el.strip.alt = animName + " sprite strip";
    }
  }

  /** Every fight anim — all must use processAnimFrame clean alpha. */
  var CLIP_BAKE_ORDER = [
    "idle",
    "walk",
    "punch",
    "kick",
    "spell",
    "special",
    "finisher",
    "hit",
    "block",
    "ko",
    "jump",
    "air_punch",
    "air_kick",
    "air_spell",
  ];

  function clipHasFrames(card, animName) {
    var cl = card && card.frameClips && card.frameClips[animName];
    return !!(cl && cl.frames && cl.frames.length);
  }

  function rekeyActiveFighterAlphas() {
    var card = getActiveBakeCard();
    if (!card) {
      setStatus("ft-create-status", "Select a fighter first.", "err");
      return;
    }
    if (!card.frameClips || !Object.keys(card.frameClips).length) {
      setStatus("ft-create-status", "No clips yet — bake anims first.", "err");
      return;
    }
    var n = ensureCleanAlphaAllClips(card);
    state._bakeCard = card;
    rebuildBakeClipTabs(card);
    var view = state._bakeViewClip;
    if (view && clipHasFrames(card, view)) selectBakeClip(card, view);
    else {
      var first = CLIP_BAKE_ORDER.filter(function (nm) {
        return clipHasFrames(card, nm);
      })[0];
      if (first) selectBakeClip(card, first);
    }
    bakeLog(
      "Clean alpha applied to " + n + " frames across idle/walk/punch/kick/spell/special/finisher/hit/block/ko/jump",
      "ok"
    );
    setStatus(
      "ft-create-status",
      "Clean alpha on all clips for “" + card.name + "” (" + n + " frames).",
      "ok"
    );
  }

  function rebuildBakeClipTabs(card) {
    var tabs = $("ft-bake-clip-tabs");
    if (!tabs || !card) return;
    card.frameClips = card.frameClips || {};
    // Always list every clip type (modular bake / retry)
    var names = CLIP_BAKE_ORDER.slice();
    Object.keys(card.frameClips).forEach(function (n) {
      if (names.indexOf(n) < 0) names.push(n);
    });
    state._bakeClipList = names.filter(function (n) {
      return clipHasFrames(card, n);
    });
    tabs.innerHTML = "";
    names.forEach(function (n) {
      var has = clipHasFrames(card, n);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = n;
      btn.dataset.clip = n;
      var cls = [];
      if (state._bakeViewClip === n) cls.push("active");
      if (!has) cls.push("missing");
      if (state._bakeCurrentAnim === n && card._bakingFrames) cls.push("baking");
      btn.className = cls.join(" ");
      btn.title = has
        ? "View “" + n + "” · double-click or use Retry to re-generate"
        : "Not baked yet — click to generate this clip only";
      btn.onclick = function () {
        if (!has) {
          retryBakeClip(n);
          return;
        }
        selectBakeClip(card, n);
      };
      btn.ondblclick = function (e) {
        e.preventDefault();
        retryBakeClip(n);
      };
      tabs.appendChild(btn);
    });
  }

  function selectBakeClip(card, animName) {
    if (!card || !card.frameClips || !card.frameClips[animName]) return;
    if (!clipHasFrames(card, animName)) return;
    state._bakeViewClip = animName;
    state._bakeCard = card;
    var clip = card.frameClips[animName];
    showBakeFrames(animName, clip.frames, clip.fps, true);
    rebuildBakeClipTabs(card);
    bakeLog("Viewing “" + animName.toUpperCase() + "” (" + clip.frames.length + " frames)", "work");
  }

  function cycleBakeClip(dir) {
    var card = state._bakeCard;
    var list = state._bakeClipList || [];
    if (!card || !list.length) return;
    var cur = state._bakeViewClip || list[list.length - 1];
    var idx = list.indexOf(cur);
    if (idx < 0) idx = 0;
    idx = (idx + dir + list.length) % list.length;
    selectBakeClip(card, list[idx]);
  }

  function showBakeFrames(animName, frames, fps, keepPlaying) {
    var el = bakeStudioEls();
    if (!el.frames) return;
    el.frames.innerHTML = "";
    if (el.clipName) el.clipName.textContent = animName.toUpperCase();
    frames.forEach(function (fr, idx) {
      var c = document.createElement("canvas");
      c.width = 56;
      c.height = 72;
      c.title = animName + " frame " + (idx + 1) + " — click to scrub";
      c.style.cursor = "pointer";
      var cx = c.getContext("2d");
      // checker for alpha
      for (var y = 0; y < 72; y += 6) {
        for (var x = 0; x < 56; x += 6) {
          cx.fillStyle = (x + y) % 12 === 0 ? "#12151c" : "#1a1e28";
          cx.fillRect(x, y, 6, 6);
        }
      }
      var keyed = ensureKeyedCanvas(fr, "anim") || fr;
      if (keyed && (keyed.width || keyed.naturalWidth)) {
        var fw = keyed.width || keyed.naturalWidth;
        var fh = keyed.height || keyed.naturalHeight;
        var sc = Math.min(56 / fw, 72 / fh);
        var dw = fw * sc;
        var dh = fh * sc;
        cx.drawImage(keyed, (56 - dw) / 2, (72 - dh) / 2, dw, dh);
      }
      c.onclick = function () {
        if (state._bakePreviewClip) {
          state._bakePreviewClip.i = idx;
          paintBakePreviewFrame();
        }
      };
      el.frames.appendChild(c);
    });
    state._bakePreviewClip = {
      frames: frames,
      fps: fps || 8,
      name: animName,
      i: 0,
      _acc: 0,
    };
    state._bakeViewClip = animName;
    if (!keepPlaying) state._bakePreviewLive = true;
    paintBakePreviewFrame();
  }

  function getPreviewView() {
    if (state._viewZoom == null) state._viewZoom = 1;
    if (state._viewPanX == null) state._viewPanX = 0;
    if (state._viewPanY == null) state._viewPanY = 0;
    return {
      zoom: state._viewZoom,
      panX: state._viewPanX,
      panY: state._viewPanY,
    };
  }

  function paintBakePreviewFrame() {
    var el = bakeStudioEls();
    var clip = state._bakePreviewClip;
    if (!el.preview || !clip || !clip.frames || !clip.frames.length) return;
    var ctx = el.preview.getContext("2d");
    var W = el.preview.width;
    var H = el.preview.height;
    ctx.clearRect(0, 0, W, H);
    // Checker scales with zoom for cleaner edit view
    var chk = Math.max(6, (10 / Math.max(1, getPreviewView().zoom)) | 0);
    for (var y = 0; y < H; y += chk) {
      for (var x = 0; x < W; x += chk) {
        ctx.fillStyle = (x + y) % (chk * 2) === 0 ? "#12151c" : "#1a1e28";
        ctx.fillRect(x, y, chk, chk);
      }
    }
    var fr = clip.frames[clip.i % clip.frames.length];
    if (!fr) return;
    if (!fr._keyedOk) fr = ensureKeyedCanvas(fr, "cell") || fr;
    // Keep clip reference in sync if ensureKeyed replaced canvas
    if (fr && clip.frames[clip.i % clip.frames.length] !== fr) {
      clip.frames[clip.i % clip.frames.length] = fr;
    }
    var fw = fr.width || fr.naturalWidth;
    var fh = fr.height || fr.naturalHeight;
    var view = getPreviewView();
    var base = Math.min(W / fw, H / fh) * 0.9;
    var sc = base * view.zoom;
    var dw = fw * sc;
    var dh = fh * sc;
    var ox = (W - dw) / 2 + view.panX;
    var oy = (H - dh) / 2 + view.panY;
    state._bakePreviewDraw = {
      ox: ox,
      oy: oy,
      dw: dw,
      dh: dh,
      fw: fw,
      fh: fh,
      fr: fr,
      base: base,
    };
    ctx.imageSmoothingEnabled = view.zoom < 2.5;
    ctx.drawImage(fr, ox, oy, dw, dh);
    // HUD
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(0, H - 22, W, 22);
    ctx.fillStyle = "#b8e0ff";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    var modeHint = state._alphaTraceMode ? " · " + state._alphaTraceMode.toUpperCase() : "";
    var undos =
      fr._alphaUndo && fr._alphaUndo.length ? " · undo×" + fr._alphaUndo.length : "";
    ctx.fillText(
      (clip.name || "").toUpperCase() +
        " · f" +
        ((clip.i % clip.frames.length) + 1) +
        "/" +
        clip.frames.length +
        " · " +
        Math.round(view.zoom * 100) +
        "%" +
        modeHint +
        undos +
        (state._bakePreviewLive && !state._alphaTraceMode ? " ▶" : ""),
      W / 2,
      H - 7
    );
  }

  function previewClientToCanvas(clientX, clientY) {
    var el = bakeStudioEls();
    if (!el.preview) return null;
    var rect = el.preview.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (el.preview.width / Math.max(1, rect.width)),
      y: (clientY - rect.top) * (el.preview.height / Math.max(1, rect.height)),
    };
  }

  function previewToFrameXY(clientX, clientY) {
    var d = state._bakePreviewDraw;
    var p = previewClientToCanvas(clientX, clientY);
    if (!d || !d.fr || !p) return null;
    if (p.x < d.ox || p.y < d.oy || p.x > d.ox + d.dw || p.y > d.oy + d.dh) return null;
    var fx = ((p.x - d.ox) / d.dw) * d.fw;
    var fy = ((p.y - d.oy) / d.dh) * d.fh;
    return { x: fx | 0, y: fy | 0, fr: d.fr };
  }

  /** Snapshot frame pixels before a stroke / flood (one undo step). */
  function pushAlphaUndo(fr) {
    if (!fr || !fr.getContext) return;
    try {
      if (!fr._alphaUndo) fr._alphaUndo = [];
      var id = fr.getContext("2d").getImageData(0, 0, fr.width, fr.height);
      fr._alphaUndo.push(id);
      while (fr._alphaUndo.length > 50) fr._alphaUndo.shift();
    } catch (e) {}
  }

  function undoAlphaStroke() {
    var d = state._bakePreviewDraw;
    var fr = d && d.fr;
    if (!fr || !fr._alphaUndo || !fr._alphaUndo.length) {
      bakeLog("Nothing to undo", "work");
      return;
    }
    try {
      var id = fr._alphaUndo.pop();
      fr.getContext("2d").putImageData(id, 0, 0);
      fr._keyedOk = true;
      try {
        delete fr._ensureKeyCache;
      } catch (e) {}
      paintBakePreviewFrame();
      bakeLog("Undo · " + fr._alphaUndo.length + " step(s) left", "ok");
    } catch (e2) {
      bakeLog("Undo failed", "err");
    }
  }

  function setPreviewZoom(nextZoom, anchorClientX, anchorClientY) {
    var el = bakeStudioEls();
    var d = state._bakePreviewDraw;
    var view = getPreviewView();
    var oldZ = view.zoom;
    var newZ = clamp(nextZoom, 1, 12);
    if (Math.abs(newZ - oldZ) < 0.001) return;
    // Zoom toward cursor (or canvas center)
    var p =
      anchorClientX != null
        ? previewClientToCanvas(anchorClientX, anchorClientY)
        : { x: el.preview ? el.preview.width / 2 : 0, y: el.preview ? el.preview.height / 2 : 0 };
    if (d && p) {
      // Point in frame space before zoom
      var fx = (p.x - d.ox) / Math.max(1e-6, d.dw);
      var fy = (p.y - d.oy) / Math.max(1e-6, d.dh);
      state._viewZoom = newZ;
      // Recompute layout with new zoom, then pan so that fx,fy stays under cursor
      var W = el.preview.width;
      var H = el.preview.height;
      var base = Math.min(W / d.fw, H / d.fh) * 0.9;
      var sc = base * newZ;
      var dw = d.fw * sc;
      var dh = d.fh * sc;
      state._viewPanX = p.x - (W - dw) / 2 - fx * dw;
      state._viewPanY = p.y - (H - dh) / 2 - fy * dh;
    } else {
      state._viewZoom = newZ;
    }
    paintBakePreviewFrame();
    var zl = $("ft-alpha-zoom-label");
    if (zl) zl.textContent = Math.round(newZ * 100) + "%";
  }

  function resetPreviewView() {
    state._viewZoom = 1;
    state._viewPanX = 0;
    state._viewPanY = 0;
    paintBakePreviewFrame();
    var zl = $("ft-alpha-zoom-label");
    if (zl) zl.textContent = "100%";
  }

  /** Scale brush radius so on-screen size stays useful when zoomed in. */
  function effectiveBrushRadius(fr) {
    var brush = state._alphaBrush || 12;
    var d = state._bakePreviewDraw;
    if (!d || !d.dw || !d.fw) return brush;
    // brush is in frame pixels; keep ~constant screen px
    var screenBrush = state._alphaBrushScreen || 14;
    var r = (screenBrush * d.fw) / d.dw;
    return Math.max(1.5, Math.min(fr.width * 0.2, r));
  }

  /** User-assisted alpha: paint-erase plate or flood-clear similar bg from a click. */
  function alphaTraceBrushAt(clientX, clientY, opts) {
    opts = opts || {};
    var hit = previewToFrameXY(clientX, clientY);
    if (!hit) return;
    var fr = hit.fr;
    if (!fr || !fr.getContext) return;
    if (opts.beginStroke) pushAlphaUndo(fr);
    var brush = effectiveBrushRadius(fr);
    var ctx = fr.getContext("2d");
    var mode = state._alphaTraceMode || "erase";
    if (mode === "erase") {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(hit.x + 0.5, hit.y + 0.5, brush, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (mode === "keep") {
      try {
        var img = ctx.getImageData(0, 0, fr.width, fr.height);
        var d = img.data;
        var r = Math.ceil(brush);
        var x0 = Math.max(0, hit.x - r);
        var y0 = Math.max(0, hit.y - r);
        var x1 = Math.min(fr.width - 1, hit.x + r);
        var y1 = Math.min(fr.height - 1, hit.y + r);
        var x, y, i, dx, dy;
        for (y = y0; y <= y1; y++) {
          for (x = x0; x <= x1; x++) {
            dx = x - hit.x;
            dy = y - hit.y;
            if (dx * dx + dy * dy > brush * brush) continue;
            i = (y * fr.width + x) * 4;
            if (d[i + 3] < 200) {
              var ni = i;
              if (x > 0 && d[i - 1] >= 200) ni = i - 4;
              else if (y > 0 && d[i - fr.width * 4 + 3] >= 200) ni = i - fr.width * 4;
              d[i] = d[ni];
              d[i + 1] = d[ni + 1];
              d[i + 2] = d[ni + 2];
              d[i + 3] = 255;
            }
          }
        }
        ctx.putImageData(img, 0, 0);
      } catch (e) {}
    }
    fr._keyedOk = true;
    try {
      delete fr._ensureKeyCache;
    } catch (e2) {}
    // Live view only during stroke — thumbs refresh on mouseup
    paintBakePreviewFrame();
  }

  function refreshBakeThumbsKeepIndex() {
    var clip = state._bakePreviewClip;
    if (!clip) {
      paintBakePreviewFrame();
      return;
    }
    var keepI = clip.i || 0;
    var live = state._bakePreviewLive;
    var z = state._viewZoom;
    var px = state._viewPanX;
    var py = state._viewPanY;
    showBakeFrames(clip.name, clip.frames, clip.fps, true);
    if (state._bakePreviewClip) {
      state._bakePreviewClip.i = keepI % Math.max(1, clip.frames.length);
      state._bakePreviewLive = live;
    }
    state._viewZoom = z;
    state._viewPanX = px;
    state._viewPanY = py;
    paintBakePreviewFrame();
  }

  function alphaTraceFloodAt(clientX, clientY) {
    var hit = previewToFrameXY(clientX, clientY);
    if (!hit || !hit.fr || !hit.fr.getContext) return;
    var fr = hit.fr;
    var w = fr.width;
    var h = fr.height;
    var ctx = fr.getContext("2d");
    try {
      pushAlphaUndo(fr);
      var img = ctx.getImageData(0, 0, w, h);
      var d = img.data;
      var sx = clamp(hit.x, 0, w - 1);
      var sy = clamp(hit.y, 0, h - 1);
      var si = (sy * w + sx) * 4;
      var tr = d[si];
      var tg = d[si + 1];
      var tb = d[si + 2];
      var ta = d[si + 3];
      if (ta < 8) {
        fr._alphaUndo && fr._alphaUndo.pop();
        return;
      }
      var thresh = 48;
      var seen = new Uint8Array(w * h);
      var stack = [sx, sy];
      seen[sy * w + sx] = 1;
      while (stack.length) {
        var y = stack.pop();
        var x = stack.pop();
        var i = (y * w + x) * 4;
        if (colorDistRgb(d[i], d[i + 1], d[i + 2], tr, tg, tb) > thresh) continue;
        var ch = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        var seedCh = Math.max(tr, tg, tb) - Math.min(tr, tg, tb);
        if (seedCh < 30 && ch > 45) continue;
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 0;
        var n;
        var dirs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (n = 0; n < 4; n++) {
          var nx = x + dirs[n][0];
          var ny = y + dirs[n][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var np = ny * w + nx;
          if (seen[np]) continue;
          if (d[np * 4 + 3] < 8) continue;
          seen[np] = 1;
          stack.push(nx, ny);
        }
      }
      solidifyBinaryAlpha(d);
      ctx.putImageData(img, 0, 0);
      fr._keyedOk = true;
      try {
        delete fr._ensureKeyCache;
      } catch (e) {}
      state._bakePreviewLive = false;
      paintBakePreviewFrame();
      bakeLog("Flood-cleared · Undo available", "ok");
    } catch (e2) {
      bakeLog("Flood clear failed: " + e2, "err");
    }
  }

  function setAlphaTraceMode(mode) {
    state._alphaTraceMode = mode || "";
    state._bakePreviewLive = false;
    if (mode === "pan") {
      bakeLog("Pan: drag on preview · scroll wheel zooms", "work");
    } else if (mode) {
      bakeLog(
        mode === "flood"
          ? "Flood clear: click plate · zoom in for precision · Ctrl+Z undo"
          : mode === "erase"
            ? "Paint erase: drag · scroll to zoom · Ctrl+Z / Undo for strokes"
            : "Paint keep: drag to restore · zoom + undo supported",
        "work"
      );
    }
    paintBakePreviewFrame();
    updateAlphaCursor();
  }

  function updateAlphaCursor() {
    var prev = $("ft-bake-preview");
    if (!prev) return;
    var m = state._alphaTraceMode;
    if (m === "pan" || state._alphaPanning) prev.style.cursor = "grab";
    else if (m) prev.style.cursor = "crosshair";
    else prev.style.cursor = "default";
  }

  function bindAlphaTraceTools() {
    var prev = $("ft-bake-preview");
    if (!prev || prev._alphaBound) return;
    prev._alphaBound = true;
    var paintDown = false;
    var panDown = false;
    var lastPan = null;
    var strokeActive = false;

    prev.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        state._bakePreviewLive = false;
        var view = getPreviewView();
        var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        setPreviewZoom(view.zoom * factor, e.clientX, e.clientY);
      },
      { passive: false }
    );

    prev.addEventListener("mousedown", function (e) {
      state._bakePreviewLive = false;
      // Middle button or pan mode or Space-held → pan
      var wantPan =
        e.button === 1 ||
        state._alphaTraceMode === "pan" ||
        state._alphaSpacePan ||
        (e.button === 0 && e.altKey);
      if (wantPan) {
        e.preventDefault();
        panDown = true;
        state._alphaPanning = true;
        lastPan = { x: e.clientX, y: e.clientY };
        updateAlphaCursor();
        return;
      }
      if (!state._alphaTraceMode || state._alphaTraceMode === "pan") return;
      if (e.button !== 0) return;
      e.preventDefault();
      paintDown = true;
      strokeActive = false;
      if (state._alphaTraceMode === "flood") {
        alphaTraceFloodAt(e.clientX, e.clientY);
        paintDown = false;
        return;
      }
      strokeActive = true;
      alphaTraceBrushAt(e.clientX, e.clientY, { beginStroke: true });
    });

    window.addEventListener("mousemove", function (e) {
      if (panDown && lastPan) {
        var dx = e.clientX - lastPan.x;
        var dy = e.clientY - lastPan.y;
        lastPan = { x: e.clientX, y: e.clientY };
        // CSS pixels → canvas pixels
        var el = bakeStudioEls();
        if (el.preview) {
          var rect = el.preview.getBoundingClientRect();
          var sx = el.preview.width / Math.max(1, rect.width);
          var sy = el.preview.height / Math.max(1, rect.height);
          state._viewPanX = (state._viewPanX || 0) + dx * sx;
          state._viewPanY = (state._viewPanY || 0) + dy * sy;
          paintBakePreviewFrame();
        }
        return;
      }
      if (
        !paintDown ||
        !state._alphaTraceMode ||
        state._alphaTraceMode === "flood" ||
        state._alphaTraceMode === "pan"
      )
        return;
      alphaTraceBrushAt(e.clientX, e.clientY, { beginStroke: false });
    });

    window.addEventListener("mouseup", function () {
      if (paintDown && strokeActive) {
        // Refresh strip thumbs once after stroke ends
        refreshBakeThumbsKeepIndex();
      }
      paintDown = false;
      strokeActive = false;
      panDown = false;
      state._alphaPanning = false;
      lastPan = null;
      updateAlphaCursor();
    });

    window.addEventListener("keydown", function (e) {
      if (isTypingTarget(e.target)) return;
      if (e.code === "Space") {
        state._alphaSpacePan = true;
        updateAlphaCursor();
      }
      // Ctrl+Z / Cmd+Z undo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        var studio = $("ft-bake-studio");
        if (studio && !studio.hidden) {
          e.preventDefault();
          undoAlphaStroke();
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        if ($("ft-bake-studio") && !$("ft-bake-studio").hidden) {
          e.preventDefault();
          setPreviewZoom((state._viewZoom || 1) * 1.2);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        if ($("ft-bake-studio") && !$("ft-bake-studio").hidden) {
          e.preventDefault();
          setPreviewZoom((state._viewZoom || 1) / 1.2);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        if ($("ft-bake-studio") && !$("ft-bake-studio").hidden) {
          e.preventDefault();
          resetPreviewView();
        }
      }
    });
    window.addEventListener("keyup", function (e) {
      if (e.code === "Space") {
        state._alphaSpacePan = false;
        updateAlphaCursor();
      }
    });

    $("ft-alpha-erase") &&
      ($("ft-alpha-erase").onclick = function () {
        setAlphaTraceMode(state._alphaTraceMode === "erase" ? "" : "erase");
      });
    $("ft-alpha-flood") &&
      ($("ft-alpha-flood").onclick = function () {
        setAlphaTraceMode(state._alphaTraceMode === "flood" ? "" : "flood");
      });
    $("ft-alpha-keep") &&
      ($("ft-alpha-keep").onclick = function () {
        setAlphaTraceMode(state._alphaTraceMode === "keep" ? "" : "keep");
      });
    $("ft-alpha-pan") &&
      ($("ft-alpha-pan").onclick = function () {
        setAlphaTraceMode(state._alphaTraceMode === "pan" ? "" : "pan");
      });
    $("ft-alpha-brush") &&
      ($("ft-alpha-brush").onclick = function () {
        var steps = [8, 12, 16, 22, 30];
        var cur = state._alphaBrushScreen || 14;
        var idx = 0;
        for (var i = 0; i < steps.length; i++) if (steps[i] <= cur) idx = i;
        state._alphaBrushScreen = steps[(idx + 1) % steps.length];
        state._alphaBrush = state._alphaBrushScreen;
        bakeLog("Brush ~" + state._alphaBrushScreen + "px on screen", "work");
      });
    $("ft-alpha-undo") && ($("ft-alpha-undo").onclick = undoAlphaStroke);
    $("ft-alpha-zoom-in") &&
      ($("ft-alpha-zoom-in").onclick = function () {
        setPreviewZoom((state._viewZoom || 1) * 1.35);
      });
    $("ft-alpha-zoom-out") &&
      ($("ft-alpha-zoom-out").onclick = function () {
        setPreviewZoom((state._viewZoom || 1) / 1.35);
      });
    $("ft-alpha-zoom-reset") && ($("ft-alpha-zoom-reset").onclick = resetPreviewView);
  }

  function playBakePreview() {
    var clip = state._bakePreviewClip;
    if (!clip || !clip.frames || !clip.frames.length) return;
    state._bakePreviewLive = !state._bakePreviewLive;
    bakeLog(
      state._bakePreviewLive
        ? "Playing “" + clip.name + "” (loop)…"
        : "Preview paused on “" + clip.name + "”",
      "work"
    );
    paintBakePreviewFrame();
  }

  function setBakeUiBusy(busy) {
    var ids = [
      "ft-bake-anims",
      "ft-bake-retry",
      "ft-bake-retry-missing",
      "ft-bake-clean-alpha",
      "ft-lock-fighter",
    ];
    ids.forEach(function (id) {
      if ($(id)) $(id).disabled = !!busy;
    });
  }

  /**
   * Bake animation clips as individual full-body frames (never multi-panel strips).
   * Each frame: AI still → forced clean alpha → fixed sprite box.
   * @param {{only?: string|string[]}} opts
   */
  function bakeFighterAnimations(card, statusId, opts) {
    statusId = statusId || "ft-create-status";
    opts = opts || {};
    if (!card) return Promise.reject(new Error("No fighter"));
    if (card._bakingFrames) {
      return Promise.reject(new Error("A bake is already running for this fighter."));
    }
    var refSrc = card.bodyUrl || card.url || card.portraitUrl;
    if (!refSrc) return Promise.reject(new Error("No still to animate from"));

    var order;
    if (opts.only) {
      order = (Array.isArray(opts.only) ? opts.only : [opts.only]).filter(function (n) {
        return !!FRAME_STRIPS[n];
      });
    } else {
      order = CLIP_BAKE_ORDER.slice();
    }
    if (!order.length) return Promise.reject(new Error("No clips to bake"));

    // Flatten to per-frame jobs so progress is honest and orientation stays vertical
    var jobs = [];
    order.forEach(function (animName) {
      var def = FRAME_STRIPS[animName];
      var poses = (def && def.frames) || [];
      var fi;
      for (fi = 0; fi < poses.length; fi++) {
        jobs.push({
          anim: animName,
          frameIndex: fi,
          pose: poses[fi],
          clipLen: poses.length,
        });
      }
    });
    if (!jobs.length) return Promise.reject(new Error("No frames to bake"));

    card.frameClips = card.frameClips || {};
    // Working buffers per clip (only for clips in this job set)
    var working = {};
    order.forEach(function (animName) {
      var def = FRAME_STRIPS[animName];
      working[animName] = {
        frames: new Array(def.frames.length),
        fps: def.fps,
        loop: !!def.loop,
        hitFrame: def.hitFrame != null ? def.hitFrame : null,
      };
    });

    var modular = !!opts.only;
    // Block multi-frame entirely if identity isn't full-body (protects credits)
    return assertFullBodySource(refSrc, "Fighter still")
      .then(function () {
        card._bakingFrames = true;
        state._bakeCancel = false;
        state._bakeCard = card;
        state._bakePreviewLive = true;
        showBakeStudio(card);
        rebuildBakeClipTabs(card);
        bakeLog(
          (modular ? "Retry / modular bake" : "Full bake") +
            " for “" +
            card.name +
            "” — " +
            jobs.length +
            " frames · FULL BODY only",
          "work"
        );
        bakeLog("Identity verified full-body — starting gens", "ok");
        return compositeOnKeyPlateDataUrl(refSrc);
      })
      .then(function (refData) {
      var el = bakeStudioEls();
      if (el.ref) el.ref.src = refData;
      var i = 0;
      // Costume only — never put fighter names into prompts (models paint them as text)
      var hint = String(card.costume || "")
        .replace(/\bname\b/gi, "")
        .trim()
        .slice(0, 140);
      // No auto re-roll: incomplete = reject only (saves credits). User can Retry clip.
      var MAX_FULLBODY_TRIES = 1;

      function commitClip(animName) {
        var buf = working[animName];
        if (!buf) return;
        var ready = [];
        var ri;
        for (ri = 0; ri < buf.frames.length; ri++) {
          var fr = buf.frames[ri];
          if (!fr) continue;
          fr = processAnimFrame(fr, { skipBox: true }) || fr;
          var chk = assessFullBody(fr, animName);
          if (!chk.ok) {
            bakeLog(
              animName.toUpperCase() + " slot " + (ri + 1) + " dropped: " + chk.reason,
              "err"
            );
            continue;
          }
          if (fr && (fr.width || fr.naturalWidth) && countOpaque(fr) > 40) ready.push(fr);
        }
        if (!ready.length) {
          bakeLog(animName.toUpperCase() + " — no full-body frames kept", "err");
          return;
        }
        ready = normalizeClipFrames(ready);
        card.frameClips[animName] = {
          frames: ready,
          fps: buf.fps,
          loop: buf.loop,
          hitFrame: buf.hitFrame,
        };
        card._hoverSrcCache = null;
        card._alphasClean = false;
      }

      /**
       * Generate one pose; reject non-full-body results (optional one re-roll).
       * Incomplete images are never stored.
       */
      function requestFullBodyFrame(job, attempt) {
        attempt = attempt || 0;
        var animName = job.anim;
        var built = buildFramePrompt(animName, job.frameIndex, job.pose, hint, {
          strictFullBody: attempt > 0,
        });
        bakeLog(
          animName.toUpperCase() +
            " f" +
            (job.frameIndex + 1) +
            "/" +
            job.clipLen +
            (attempt ? " re-roll full-body #" + (attempt + 1) : " — full body required") +
            "…",
          "work"
        );
        return requestFightImage(built, FRAME_ASPECT, refData, statusId, {
          lockIdentity: true,
        })
          .then(function (url) {
            if (state._bakeCancel) return null;
            showBakeStrip(url, animName + " f" + (job.frameIndex + 1));
            return loadImg(url);
          })
          .then(function (img) {
            if (!img || state._bakeCancel) return null;
            // Score raw gen first (before cutout can hide a bust crop)
            var rawC = document.createElement("canvas");
            rawC.width = img.naturalWidth || img.width;
            rawC.height = img.naturalHeight || img.height;
            rawC.getContext("2d").drawImage(img, 0, 0);
            removeBackground(rawC, { mode: "cell" });
            var rawCheck = assessFullBody(rawC, animName);
            if (!rawCheck.ok) {
              bakeLog(
                "REJECTED " +
                  animName.toUpperCase() +
                  " f" +
                  (job.frameIndex + 1) +
                  " (raw): " +
                  rawCheck.reason +
                  " — not saved",
                "err"
              );
              if (attempt + 1 < MAX_FULLBODY_TRIES && !state._bakeCancel) {
                return requestFullBodyFrame(job, attempt + 1);
              }
              return null;
            }
            var fr = processAnimFrame(img, { skipBox: true });
            var check = assessFullBody(fr, animName);
            if (check.ok && fr) {
              bakeLog(
                animName.toUpperCase() +
                  " f" +
                  (job.frameIndex + 1) +
                  " accepted (full body)",
                "ok"
              );
              return fr;
            }
            bakeLog(
              "REJECTED " +
                animName.toUpperCase() +
                " f" +
                (job.frameIndex + 1) +
                ": " +
                ((check && check.reason) || "incomplete") +
                " — not saved",
              "err"
            );
            if (attempt + 1 < MAX_FULLBODY_TRIES && !state._bakeCancel) {
              return requestFullBodyFrame(job, attempt + 1);
            }
            return null;
          });
      }

      function next() {
        if (state._bakeCancel) {
          order.forEach(commitClip);
          card._bakingFrames = false;
          state._bakeCurrentAnim = null;
          rebuildBakeClipTabs(card);
          bakeLog("Bake cancelled — only accepted full-body frames kept.", "err");
          setStatus(statusId, "Bake cancelled — other clips kept.", "err");
          if (el.phase) el.phase.textContent = "Cancelled";
          persistRoster();
          return card;
        }
        if (i >= jobs.length) {
          order.forEach(commitClip);
          var scrubbed = ensureCleanAlphaAllClips(card);
          bakeLog(
            "Clean alpha pass on all clips (idle→jump) · " + scrubbed + " frames",
            "ok"
          );
          card._bakingFrames = false;
          card._framesReady = true;
          state._bakeCurrentAnim = null;
          updateBakeProgress(jobs.length, jobs.length, "", "All frames ready — review clips above");
          bakeLog(
            modular
              ? "Modular bake done for “" + card.name + "”"
              : "Done — full-body clips ready for “" + card.name + "”",
            "ok"
          );
          setStatus(
            statusId,
            modular
              ? "Updated clip(s) for “" + card.name + "”. Incomplete gens were rejected."
              : "Anims ready for “" +
                  card.name +
                  "” (full-body only). Retry any empty/missing slots.",
            "ok"
          );
          rebuildBakeClipTabs(card);
          persistRoster();
          hideBakeStudioSoon();
          return card;
        }

        var job = jobs[i];
        var animName = job.anim;
        var def = FRAME_STRIPS[animName];
        state._bakeCurrentAnim = animName;
        state._bakeViewClip = animName;
        rebuildBakeClipTabs(card);
        updateBakeProgress(
          i,
          jobs.length,
          animName,
          (modular ? "Retry " : "") +
            animName.toUpperCase() +
            " frame " +
            (job.frameIndex + 1) +
            "/" +
            job.clipLen +
            " · full body only…"
        );

        return requestFullBodyFrame(job, 0)
          .then(function (fr) {
            if (state._bakeCancel) {
              i++;
              return next();
            }
            if (fr) working[animName].frames[job.frameIndex] = fr;
            var partial = working[animName].frames.filter(Boolean);
            if (partial.length) showBakeFrames(animName, partial, def.fps, true);
            var clipJobsLeft = 0;
            var j;
            for (j = i + 1; j < jobs.length; j++) {
              if (jobs[j].anim === animName) clipJobsLeft++;
            }
            if (clipJobsLeft === 0) {
              commitClip(animName);
              rebuildBakeClipTabs(card);
              persistRoster();
              var kept =
                (card.frameClips[animName] && card.frameClips[animName].frames.length) || 0;
              bakeLog(
                animName.toUpperCase() +
                  " clip · " +
                  kept +
                  " full-body frame(s) kept",
                kept ? "ok" : "err"
              );
            }
            i++;
            updateBakeProgress(i, jobs.length, animName, "Frame done");
            return next();
          })
          .catch(function (err) {
            console.warn("Frame bake failed:", animName, job.frameIndex, err);
            bakeLog(
              animName.toUpperCase() +
                " f" +
                (job.frameIndex + 1) +
                " FAILED: " +
                ((err && err.message) || err),
              "err"
            );
            i++;
            return next();
          });
      }
      return next();
    });
  }

  function getActiveBakeCard() {
    if (state._bakeCard) {
      var still = state.roster.filter(function (c) {
        return c.id === state._bakeCard.id;
      })[0];
      if (still) return still;
    }
    return (
      state.roster.filter(function (c) {
        return c.id === state.selectedId;
      })[0] || state.roster[0]
    );
  }

  /** Re-generate one clip; keeps every other clip untouched. */
  function retryBakeClip(animName) {
    var card = getActiveBakeCard();
    if (!card) {
      setStatus("ft-create-status", "Select a fighter first.", "err");
      return;
    }
    if (!FRAME_STRIPS[animName]) {
      setStatus("ft-create-status", "Unknown clip: " + animName, "err");
      return;
    }
    if (card._bakingFrames) {
      setStatus("ft-create-status", "Wait for the current bake to finish (or Cancel).", "err");
      return;
    }
    state._bakeViewClip = animName;
    setBakeUiBusy(true);
    bakeFighterAnimations(card, "ft-create-status", { only: [animName] })
      .catch(function (err) {
        setStatus("ft-create-status", (err && err.message) || "Retry failed", "err");
        bakeLog("Retry error: " + ((err && err.message) || err), "err");
      })
      .finally(function () {
        setBakeUiBusy(false);
      });
  }

  function retryMissingClips() {
    var card = getActiveBakeCard();
    if (!card) {
      setStatus("ft-create-status", "Select a fighter first.", "err");
      return;
    }
    if (card._bakingFrames) {
      setStatus("ft-create-status", "Wait for the current bake to finish (or Cancel).", "err");
      return;
    }
    card.frameClips = card.frameClips || {};
    var missing = CLIP_BAKE_ORDER.filter(function (n) {
      return !clipHasFrames(card, n);
    });
    if (!missing.length) {
      setStatus("ft-create-status", "All clips already baked. Use Retry on a tab to re-roll one.", "ok");
      return;
    }
    setBakeUiBusy(true);
    bakeFighterAnimations(card, "ft-create-status", { only: missing })
      .catch(function (err) {
        setStatus("ft-create-status", (err && err.message) || "Bake failed", "err");
      })
      .finally(function () {
        setBakeUiBusy(false);
      });
  }

  function bakeSelectedFighterAnims() {
    var card = getActiveBakeCard();
    if (!card) {
      setStatus("ft-create-status", "Lock a fighter first, then bake multi-frame anims.", "err");
      return;
    }
    setBakeUiBusy(true);
    bakeFighterAnimations(card, "ft-create-status")
      .catch(function (err) {
        setStatus("ft-create-status", (err && err.message) || "Bake failed", "err");
        bakeLog("Bake error: " + ((err && err.message) || err), "err");
      })
      .finally(function () {
        setBakeUiBusy(false);
      });
  }

  function retryActiveBakeClip() {
    var name = state._bakeViewClip;
    if (!name) {
      setStatus("ft-create-status", "Select a clip tab first, then Retry.", "err");
      return;
    }
    retryBakeClip(name);
  }

  function lockFighter() {
    var name = ($("ft-name") && $("ft-name").value.trim()) || "Fighter";
    // One identity still for roster AND arena — always with clean alpha baked in
    var src = state.draftDataUrl || state.draftPortrait || state.draftBody;
    if (!src) {
      setStatus("ft-create-status", "Pick a still or run AI generate first.", "err");
      return;
    }
    setStatus("ft-create-status", "Locking fighter (baking clean alpha still)…", "");
    $("ft-lock-fighter") && ($("ft-lock-fighter").disabled = true);
    processIdentityStill(src)
      .then(function (res) {
        var dataUrl = res.png;
        var card = {
          id: uid(),
          name: name.slice(0, 48),
          url: dataUrl,
          portraitUrl: dataUrl,
          bodyUrl: dataUrl,
          costume: ($("ft-costume") && $("ft-costume").value) || "",
          created: Date.now(),
        };
        state.draftDataUrl = dataUrl;
        state.roster.unshift(card);
        state.selectedId = card.id;
        persistRoster();
        showPreview(dataUrl, card.name + " · locked", { applyAlpha: false });
        return loadImg(dataUrl).then(function (img) {
          card._img = img;
          card._bodyImg = img;
          card._sprite = res.canvas || null;
          return fetch(apiUrl("/api/fight/character"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: card.name,
              image_base64: dataUrl,
              costume: card.costume,
            }),
          })
            .then(function (r) {
              return r.json().catch(function () {
                return null;
              });
            })
            .then(function (d) {
              if (d && d.ok && d.url) {
                card.serverUrl = d.url;
                card.serverId = d.id;
              }
              return card;
            })
            .catch(function () {
              return card;
            });
        });
      })
      .then(function (card) {
        // Gate: refuse incomplete stills so we never spend multi-frame credits on them
        return assertFullBodySource(card.url || card.bodyUrl, "Locked still").then(function () {
          return card;
        });
      })
      .then(function (card) {
        renderRoster();
        openBakeStudioForCard(card);
        setStatus(
          "ft-create-status",
          "Locked full-body “" +
            card.name +
            "”. Multi-frame is NOT auto-started (protects credits). Click “Bake multi-frame anims” when ready.",
          "ok"
        );
      })
      .catch(function (err) {
        setStatus("ft-create-status", (err && err.message) || "Lock failed", "err");
      })
      .finally(function () {
        $("ft-lock-fighter") && ($("ft-lock-fighter").disabled = false);
      });
  }

  /**
   * One unique full-body identity still — roster card and in-game sprite are identical.
   */
  function genCostume() {
    var prompt = ($("ft-costume") && $("ft-costume").value.trim()) || "";
    var name = ($("ft-name") && $("ft-name").value.trim()) || "";
    if (!prompt) {
      setStatus("ft-create-status", "Type a costume / look prompt first (spaces work).", "err");
      return;
    }
    $("ft-gen-costume") && ($("ft-gen-costume").disabled = true);
    // NEVER pass gallery/draft as reference — that forces bust/portrait crops and wastes credits
    setStatus(
      "ft-create-status",
      "Generating FULL-BODY fighter still (head-to-feet, no reference crop)…",
      ""
    );
    requestFightImage(
      buildUniqueFighterPrompt(prompt, name, false),
      "3:4",
      null,
      "ft-create-status",
      { lockIdentity: false }
    )
      .then(function (url) {
        if (!url) throw new Error("Empty image URL");
        // Reject incomplete RAW result before we treat it as identity
        return loadImg(url).then(function (rawImg) {
          var rawC = document.createElement("canvas");
          rawC.width = rawImg.naturalWidth || rawImg.width;
          rawC.height = rawImg.naturalHeight || rawImg.height;
          rawC.getContext("2d").drawImage(rawImg, 0, 0);
          removeBackground(rawC, { mode: "identity" });
          var rawCheck = assessFullBody(rawC, null);
          if (!rawCheck.ok) {
            throw new Error(
              "Rejected incomplete still (" +
                rawCheck.reason +
                "). Not saved — hit Generate again for a true full-body."
            );
          }
          state.draftPortrait = "";
          state.draftBody = "";
          state.draftTpose = "";
          state.draftLabel = (name || "Fighter") + " · full-body still";
          return processIdentityStill(url).then(function (res) {
            var check = assessFullBody(res.canvas || null);
            if (!check.ok) {
              throw new Error(
                "Rejected after cutout (" +
                  check.reason +
                  "). Not saved — re-generate full body head-to-feet."
              );
            }
            state.draftDataUrl = res.png;
            showPreview(res.png, state.draftLabel, { applyAlpha: false });
            var wrap = $("ft-preview-wrap");
            if (wrap) wrap.classList.add("ft-preview-alpha");
          });
        });
      })
      .then(function () {
        setStatus(
          "ft-create-status",
          "Full-body identity still ready. Lock in when happy — then Bake multi-frame (only when still is good).",
          "ok"
        );
      })
      .catch(function (err) {
        var msg = (err && err.message) || "Generate failed";
        if (/^[a-f0-9-]{16,}$/i.test(String(msg).trim())) {
          msg = "Generate job failed — restart server / check xAI key, then retry";
        }
        setStatus("ft-create-status", msg, "err");
      })
      .finally(function () {
        $("ft-gen-costume") && ($("ft-gen-costume").disabled = false);
      });
  }

  /* ---------- LAN ---------- */
  function lanHeartbeat(action) {
    var fighter = state.roster[0];
    return fetch(apiUrl("/api/fight/live"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: action || "presence",
        playerId: state.lan.playerId || (state.lan.playerId = uid()),
        name: (fighter && fighter.name) || "Player",
        fighterId: fighter && fighter.id,
        imgUrl: fighter && fighter.url,
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        state.lan.room = d;
        renderLan(d);
        return d;
      });
  }

  function renderLan(d) {
    var ul = $("ft-lan-slots");
    if (!ul) return;
    var players = (d && d.players) || [];
    if (!players.length) {
      ul.innerHTML = "<li>No players yet — host or join.</li>";
      return;
    }
    ul.innerHTML = players
      .map(function (p, i) {
        return (
          "<li>Slot " +
          (i + 1) +
          ": <strong>" +
          escapeHtml(p.name || "Player") +
          "</strong>" +
          (p.playerId === state.lan.playerId ? " (you)" : "") +
          "</li>"
        );
      })
      .join("");
    setStatus(
      "ft-lan-status",
      players.length + " / 4 in lobby · host can Start match in Arena",
      "ok"
    );
  }

  function pollLan() {
    fetch(apiUrl("/api/fight/live?t=" + Date.now()), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        state.lan.room = d;
        renderLan(d);
      })
      .catch(function () {
        setStatus("ft-lan-status", "LAN offline — start_server.bat required.", "err");
      });
  }

  /* ---------- maps load/save ---------- */
  function refreshMapSelect() {
    var sel = $("ft-map-select");
    if (!sel) return;
    var maps = state.maps.length ? state.maps : [defaultMap()];
    sel.innerHTML = maps
      .map(function (m) {
        return (
          '<option value="' +
          escapeHtml(m.id) +
          '">' +
          escapeHtml(m.name) +
          "</option>"
        );
      })
      .join("");
  }

  function loadMaps() {
    state.maps = builtInScenes().slice();
    try {
      var raw = localStorage.getItem("fight_scenes_v2");
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          arr.forEach(function (m) {
            if (m && m.id) state.maps.push(m);
          });
        }
      }
    } catch (e) {}
    fetch(apiUrl("/api/fight/maps?t=" + Date.now()), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (d && d.maps && d.maps.length) {
          d.maps.forEach(function (m) {
            if (!state.maps.some(function (x) {
              return x.id === m.id;
            }))
              state.maps.push(m);
          });
        }
        // preload generative skies
        state.maps.forEach(function (m) {
          ensureSceneImage(m);
        });
        refreshMapSelect();
      })
      .catch(function () {
        refreshMapSelect();
      });
  }

  function saveMap() {
    ensureMapEditSeed();
    var name = ($("ft-map-name") && $("ft-map-name").value.trim()) || "Custom Dome";
    var edge =
      ($("ft-scene-edge") && $("ft-scene-edge").value) || state.mapEdit.edge || "cliff";
    var prompt =
      ($("ft-scene-prompt") && $("ft-scene-prompt").value.trim()) || state.mapEdit.prompt || "";
    var map = {
      id: uid(),
      name: name,
      edge: edge,
      prompt: prompt,
      sceneUrl: state.mapEdit.sceneUrl || "",
      procedural: "aurora",
    };
    if (state.mapEdit.sceneImg) map.sceneImg = state.mapEdit.sceneImg;
    state.maps.push(map);
    state.currentMapId = map.id;
    try {
      var custom = state.maps.filter(function (m) {
        return String(m.id).indexOf("scene-") !== 0 && String(m.id).indexOf("dome-") !== 0;
      });
      localStorage.setItem(
        "fight_scenes_v2",
        JSON.stringify(
          custom.slice(-16).map(function (m) {
            return {
              id: m.id,
              name: m.name,
              edge: m.edge,
              prompt: m.prompt,
              sceneUrl: m.sceneUrl,
              procedural: m.procedural,
            };
          })
        )
      );
    } catch (e) {}
    fetch(apiUrl("/api/fight/maps"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(map),
    }).catch(function () {});
    refreshMapSelect();
    if ($("ft-map-select")) $("ft-map-select").value = map.id;
    setStatus("ft-map-status", "Saved scene “" + name + "”. Open Arena and select it.", "ok");
  }

  /* ---------- UI wiring ---------- */
  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll(".ft-mode-tab").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-ft-mode") === mode);
    });
    document.querySelectorAll(".ft-pane").forEach(function (p) {
      var on = p.getAttribute("data-ft-pane") === mode;
      p.hidden = !on;
      p.classList.toggle("active", on);
    });
    if (mode === "map") ensureMapEditSeed();
    if (mode === "lan") pollLan();
    if (mode === "create" && state.src !== "browse" && !state.srcItems.length) {
      loadSourceCatalog(state.src || "paintings");
    }
  }

  function canvasPos(canvas, e) {
    var rect = canvas.getBoundingClientRect();
    var sx = W / rect.width;
    var sy = H / rect.height;
    var x = (e.clientX - rect.left) * sx;
    var y = (e.clientY - rect.top) * sy;
    return { x: x, y: y };
  }

  function bind() {
    if (!$("panel-fight")) return;

    document.querySelectorAll(".ft-mode-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setMode(btn.getAttribute("data-ft-mode") || "create");
      });
    });

    // create — image sources
    document.querySelectorAll(".ft-src-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        loadSourceCatalog(btn.getAttribute("data-ft-src") || "paintings");
      });
    });
    $("ft-src-refresh") &&
      $("ft-src-refresh").addEventListener("click", function () {
        loadSourceCatalog(state.src);
      });
    var searchTimer = 0;
    $("ft-src-search") &&
      $("ft-src-search").addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          if (state.src !== "browse") loadSourceCatalog(state.src);
        }, 220);
      });
    $("ft-src-grid") &&
      $("ft-src-grid").addEventListener("click", function (e) {
        var item = e.target && e.target.closest ? e.target.closest(".ft-src-item") : null;
        if (!item) return;
        setDraftStill(item.getAttribute("data-url"), item.getAttribute("data-title") || "");
      });

    var drop = $("ft-drop");
    var input = $("ft-img-input");
    if ($("ft-pick-img"))
      $("ft-pick-img").onclick = function () {
        input && input.click();
      };
    if (drop)
      drop.onclick = function () {
        input && input.click();
      };
    if (input)
      input.onchange = function () {
        var f = input.files && input.files[0];
        if (!f) return;
        fileToDataUrl(f).then(function (url) {
          setDraftStill(url, f.name || "Browse file");
        });
      };
    if (drop) {
      ["dragenter", "dragover"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
          e.preventDefault();
          drop.classList.add("drag");
        });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
          e.preventDefault();
          drop.classList.remove("drag");
        });
      });
      drop.addEventListener("drop", function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        fileToDataUrl(f).then(function (url) {
          setDraftStill(url, f.name || "Dropped file");
        });
      });
    }
    $("ft-gen-costume") && ($("ft-gen-costume").onclick = genCostume);
    $("ft-lock-fighter") && ($("ft-lock-fighter").onclick = lockFighter);
    $("ft-bake-anims") && ($("ft-bake-anims").onclick = bakeSelectedFighterAnims);
    $("ft-bake-retry") && ($("ft-bake-retry").onclick = retryActiveBakeClip);
    $("ft-bake-retry-missing") && ($("ft-bake-retry-missing").onclick = retryMissingClips);
    $("ft-bake-clean-alpha") && ($("ft-bake-clean-alpha").onclick = rekeyActiveFighterAlphas);
    bindAlphaTraceTools();
    $("ft-bake-cancel") &&
      ($("ft-bake-cancel").onclick = function () {
        state._bakeCancel = true;
        bakeLog("Cancel requested — finishing current job…", "err");
        var ph = $("ft-bake-phase");
        if (ph) ph.textContent = "Cancelling…";
      });
    $("ft-bake-play") && ($("ft-bake-play").onclick = playBakePreview);
    $("ft-bake-prev") &&
      ($("ft-bake-prev").onclick = function () {
        cycleBakeClip(-1);
      });
    $("ft-bake-next") &&
      ($("ft-bake-next").onclick = function () {
        cycleBakeClip(1);
      });
    bindFightPad($("ft-pad-arena"));
    bindFightPad($("ft-pad-train"));
    // Load paintings grid by default on create
    loadSourceCatalog("paintings");
    $("ft-roster") &&
      $("ft-roster").addEventListener("click", function (e) {
        var del = e.target.closest(".ft-roster-del");
        if (del) {
          e.preventDefault();
          e.stopPropagation();
          var delId = del.getAttribute("data-id");
          var who = state.roster.filter(function (c) {
            return c.id === delId;
          })[0];
          var nm = (who && who.name) || "this fighter";
          if (window.confirm('Delete fighter "' + nm + '" from your roster?')) {
            deleteFighter(delId);
          }
          return;
        }
        var pick = e.target.closest(".ft-roster-pick") || e.target.closest(".ft-roster-card");
        if (!pick) return;
        var id = pick.getAttribute("data-id");
        if (!id) return;
        var found = state.roster.filter(function (c) {
          return c.id === id;
        })[0];
        if (found) activateFighter(found);
      });
    $("ft-roster") &&
      $("ft-roster").addEventListener("mouseover", function (e) {
        var cardEl = e.target.closest(".ft-roster-card");
        if (!cardEl || !cardEl.classList.contains("has-anim")) return;
        var id = cardEl.getAttribute("data-id");
        if (!id) return;
        if (state._rosterHover && state._rosterHover.cardId === id) return;
        var found = state.roster.filter(function (c) {
          return c.id === id;
        })[0];
        var img = cardEl.querySelector(".ft-roster-thumb");
        if (found && img) startRosterHoverPreview(found, img);
      });
    $("ft-roster") &&
      $("ft-roster").addEventListener("mouseout", function (e) {
        var cardEl = e.target.closest(".ft-roster-card");
        if (!cardEl) return;
        var related = e.relatedTarget;
        if (related && cardEl.contains(related)) return;
        if (state._rosterHover && state._rosterHover.cardId === cardEl.getAttribute("data-id")) {
          stopRosterHoverPreview();
        }
      });

    // arena
    $("ft-start-match") &&
      ($("ft-start-match").onclick = function () {
        startMatch("arena");
      });
    $("ft-pause") &&
      ($("ft-pause").onclick = function () {
        if (!state.match) return;
        state.match.paused = !state.match.paused;
        $("ft-pause").textContent = state.match.paused ? "Resume" : "Pause";
      });

    // train
    $("ft-start-train") && ($("ft-start-train").onclick = startTraining);
    $("ft-reset-train") &&
      ($("ft-reset-train").onclick = function () {
        if (state.train && state.train.fighters[1]) {
          var dmy = state.train.fighters[1];
          dmy.hp = dmy.maxHp;
          dmy.dead = false;
          dmy.fallingOff = false;
          dmy.wx = 90;
          dmy.wz = 40;
          dmy.hy = 0;
          dmy.vx = 0;
          dmy.vz = 0;
          dmy.vy = 0;
          setAnim(dmy, "idle", true);
        }
      });

    // scene forge
    $("ft-scene-gen") && ($("ft-scene-gen").onclick = genScene);
    $("ft-map-save") && ($("ft-map-save").onclick = saveMap);
    $("ft-scene-edge") &&
      $("ft-scene-edge").addEventListener("change", function () {
        state.mapEdit.edge = $("ft-scene-edge").value;
      });
    $("ft-scene-from-gallery") &&
      ($("ft-scene-from-gallery").onclick = function () {
        var url = state.draftDataUrl || (state.roster[0] && state.roster[0].url);
        if (!url) {
          setStatus("ft-map-status", "Pick a fighter still first (Create tab).", "err");
          return;
        }
        state.mapEdit.sceneUrl = url;
        loadImg(url)
          .then(function (img) {
            state.mapEdit.sceneImg = img;
            setStatus("ft-map-status", "Using still as dome sky — Save scene.", "ok");
          })
          .catch(function () {
            setStatus("ft-map-status", "Could not load still as sky.", "err");
          });
      });
    $("ft-scene-prompt") &&
      $("ft-scene-prompt").addEventListener("input", function () {
        state.mapEdit.prompt = $("ft-scene-prompt").value;
      });
    $("ft-map-name") &&
      $("ft-map-name").addEventListener("input", function () {
        state.mapEdit.name = $("ft-map-name").value;
      });

    // lan
    $("ft-lan-host") &&
      ($("ft-lan-host").onclick = function () {
        lanHeartbeat("host")
          .then(function () {
            setStatus("ft-lan-status", "Hosting — others Join on LAN.", "ok");
          })
          .catch(function () {
            setStatus("ft-lan-status", "Host failed — is the server running?", "err");
          });
      });
    $("ft-lan-join") &&
      ($("ft-lan-join").onclick = function () {
        lanHeartbeat("join")
          .then(function () {
            setStatus("ft-lan-status", "Joined lobby.", "ok");
          })
          .catch(function () {
            setStatus("ft-lan-status", "Join failed.", "err");
          });
      });
    $("ft-lan-refresh") && ($("ft-lan-refresh").onclick = pollLan);

    window.addEventListener("keydown", function (e) {
      // Never steal keys while typing name / costume / search / etc.
      if (isTypingTarget(e.target)) return;
      state.keys[e.code] = true;
      if (document.body.getAttribute("data-active-tab") !== "fight") return;
      // Only block page scroll during active arena/train play, not on create/map/lan
      var playing =
        (state.match && state.match.running && !state.match.paused) ||
        (state.train && state.train.running);
      if (
        playing &&
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.code) >= 0
      ) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", function (e) {
      if (isTypingTarget(e.target)) return;
      state.keys[e.code] = false;
    });
    window.addEventListener("blur", function () {
      state.keys = {};
    });

    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "fight") {
        if (state.lan.poll) clearInterval(state.lan.poll);
        state.lan.poll = setInterval(function () {
          if (state.mode === "lan") pollLan();
        }, 2500);
      } else {
        if (state.match) state.match.paused = true;
        if (state.lan.poll) {
          clearInterval(state.lan.poll);
          state.lan.poll = 0;
        }
      }
    });
    window.addEventListener("fight-hide", function () {
      if (state.match) state.match.paused = true;
    });

    // restore roster
    try {
      var raw = localStorage.getItem("fight_roster_v1");
      if (raw) state.roster = JSON.parse(raw) || [];
    } catch (e) {}
    renderRoster();
    loadMaps();
    requestAnimationFrame(loop);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.Fight = {
    start: startMatch,
    roster: function () {
      return state.roster;
    },
  };
})();
