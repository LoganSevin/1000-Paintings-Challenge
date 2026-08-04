/**
 * Stasis vision walk plane: mosaic tiles + infinite color continuation.
 */
(function () {
  var FIELD_CELL = 18;
  var SAMPLE_GRID = 64;
  var _sampleCanvas = null;
  var _sampleSrc = "";
  var _samplePixels = null;

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function paletteFromBuzz(buzz, stasis) {
    var map = {
      pink: [232, 121, 169],
      purple: [155, 126, 217],
      blue: [90, 140, 220],
      green: [90, 180, 120],
      orange: [230, 150, 80],
      gold: [210, 170, 60],
      red: [200, 90, 90],
      teal: [70, 160, 150],
    };
    var text = (buzz || []).join(" ") + " " + (stasis || "");
    var lower = text.toLowerCase();
    var out = [];
    Object.keys(map).forEach(function (k) {
      if (lower.indexOf(k) >= 0) out.push(map[k].slice());
    });
    if (!out.length) out.push([90, 85, 100]);
    return out;
  }

  function ensureSampleCache(img) {
    if (!img || !img.complete || !img.naturalWidth) {
      _sampleCanvas = null;
      _sampleSrc = "";
      _samplePixels = null;
      return null;
    }
    var src = img.src || "";
    if (_sampleCanvas && _sampleSrc === src && _samplePixels) return _sampleCanvas;
    var c = document.createElement("canvas");
    c.width = SAMPLE_GRID;
    c.height = SAMPLE_GRID;
    var cx = c.getContext("2d");
    cx.drawImage(img, 0, 0, SAMPLE_GRID, SAMPLE_GRID);
    try {
      _samplePixels = cx.getImageData(0, 0, SAMPLE_GRID, SAMPLE_GRID).data;
    } catch (err) {
      _samplePixels = null;
    }
    _sampleCanvas = c;
    _sampleSrc = src;
    return c;
  }

  function sampleImageColor(img, u, v) {
    ensureSampleCache(img);
    if (!_samplePixels) return [70, 68, 78];
    var x = clamp(Math.floor(u * (SAMPLE_GRID - 1)), 0, SAMPLE_GRID - 1);
    var y = clamp(Math.floor(v * (SAMPLE_GRID - 1)), 0, SAMPLE_GRID - 1);
    var i = (y * SAMPLE_GRID + x) * 4;
    return [_samplePixels[i], _samplePixels[i + 1], _samplePixels[i + 2]];
  }

  function uvFromWorld(wx, wy) {
    if (window.MuralwalkCoords && window.MuralwalkCoords.uvFromWorld) {
      return window.MuralwalkCoords.uvFromWorld(wx, wy);
    }
    return {
      u: 0.5 + wx * 0.0018,
      v: 0.5 + wy * 0.0018,
    };
  }

  function worldColorAt(img, wx, wy, buzz, stasis) {
    var uv = uvFromWorld(wx, wy);
    var cu = clamp(uv.u, 0, 1);
    var cv = clamp(uv.v, 0, 1);
    var rgb =
      img && img.complete && img.naturalWidth
        ? sampleImageColor(img, cu, cv)
        : paletteFromBuzz(buzz, stasis)[0].slice();
    var drift = (((wx * 0.013 + wy * 0.011) | 0) % 9) - 4;
    return [
      clamp(rgb[0] + drift * 2, 0, 255),
      clamp(rgb[1] + ((drift * 3) % 7) - 3, 0, 255),
      clamp(rgb[2] + (drift % 3) - 1, 0, 255),
    ];
  }

  function drawExtendedColorField(ctx, w, h, camWx, camWy, img, buzz, stasis) {
    if (img && img.complete && img.naturalWidth) ensureSampleCache(img);
    var cx = w / 2;
    var cy = h / 2;
    var cell = FIELD_CELL;
    ctx.save();
    for (var py = 0; py < h; py += cell) {
      for (var px = 0; px < w; px += cell) {
        var wx = camWx + (px + cell * 0.5 - cx);
        var wy = camWy + (py + cell * 0.5 - cy);
        var rgb = worldColorAt(img, wx, wy, buzz, stasis);
        ctx.fillStyle = "rgb(" + rgb.join(",") + ")";
        ctx.fillRect(px, py, cell + 1, cell + 1);
      }
    }
    ctx.restore();
  }

  var VISION_PARALLAX = 0.42;
  var VISION_SCALE = 1.55;

  function drawVisionImage(ctx, w, h, camWx, camWy, img, alpha) {
    alpha = alpha == null ? 0.9 : alpha;
    if (!img || !img.complete || !img.naturalWidth) return false;
    var scale = Math.max(w / img.naturalWidth, h / img.naturalHeight) * VISION_SCALE;
    var dw = img.naturalWidth * scale;
    var dh = img.naturalHeight * scale;
    var x = (w - dw) / 2 - camWx * VISION_PARALLAX;
    var y = (h - dh) / 2 - camWy * VISION_PARALLAX;
    ctx.save();
    ctx.globalAlpha = alpha;
    try {
      ctx.drawImage(img, x, y, dw, dh);
    } catch (err) {
      ctx.restore();
      return false;
    }
    ctx.restore();
    return true;
  }

  function drawSingleVision(ctx, w, h, camWx, camWy, img, buzz, stasis, alpha) {
    alpha = alpha == null ? 0.9 : alpha;
    buzz = buzz || [];
    stasis = stasis || "";
    drawExtendedColorField(ctx, w, h, camWx, camWy, img, buzz, stasis);
    if (!img || !img.complete || !img.naturalWidth) {
      return !!buzz.length || !!stasis;
    }
    drawVisionImage(ctx, w, h, camWx, camWy, img, alpha);
    return true;
  }

  function drawPlane(ctx, w, h, camWx, camWy, img, buzz, stasis) {
    return drawSingleVision(ctx, w, h, camWx, camWy, img, buzz, stasis, 0.9);
  }

  function visionScreenRect(camWx, camWy, w, h, img) {
    if (!img || !img.complete || !img.naturalWidth) return null;
    var scale = Math.max(w / img.naturalWidth, h / img.naturalHeight) * VISION_SCALE;
    var dw = img.naturalWidth * scale;
    var dh = img.naturalHeight * scale;
    var left = (w - dw) / 2 - camWx * VISION_PARALLAX;
    var top = (h - dh) / 2 - camWy * VISION_PARALLAX;
    return { left: left, top: top, right: left + dw, bottom: top + dh };
  }

  function visionTilePitch(w, h, img) {
    var rect = visionScreenRect(0, 0, w, h, img);
    if (!rect) {
      return { pitchX: 420, pitchY: 300, pad: 22 };
    }
    var parallax = VISION_PARALLAX;
    return {
      pitchX: (rect.right - rect.left) / parallax,
      pitchY: (rect.bottom - rect.top) / parallax,
      pad: 22,
    };
  }

  function drawMosaicPlane(ctx, w, h, camWx, camWy, mosaic, buzz, stasis) {
    if (!mosaic || !mosaic.tiles || !mosaic.tiles.length) return false;
    buzz = buzz || [];
    stasis = stasis || "";
    if (mosaic.onCompassTile && mosaic.activeTile && mosaic.activeTile.img) {
      var active = mosaic.activeTile;
      var ax = active.offsetWx || 0;
      var ay = active.offsetWy || 0;
      var drewActive = drawSingleVision(
        ctx,
        w,
        h,
        camWx - ax,
        camWy - ay,
        active.img,
        active.buzz || buzz,
        active.stasis || stasis,
        active.alpha == null ? 0.96 : active.alpha
      );
      if (mosaic.centerImg && mosaic.centerImg.complete && mosaic.centerImg.naturalWidth) {
        drawVisionImage(ctx, w, h, camWx, camWy, mosaic.centerImg, 0.18);
      }
      return drewActive;
    }
    var fieldImg = mosaic.activeImg || mosaic.centerImg;
    var fieldBuzz = mosaic.activeBuzz || buzz;
    var fieldStasis = mosaic.activeStasis || stasis;
    drawExtendedColorField(ctx, w, h, camWx, camWy, fieldImg, fieldBuzz, fieldStasis);
    var drew =
      !!fieldBuzz.length ||
      !!fieldStasis ||
      !!(fieldImg && fieldImg.complete);
    for (var i = 0; i < mosaic.tiles.length; i++) {
      var tile = mosaic.tiles[i];
      if (!tile.img || !tile.img.complete || !tile.img.naturalWidth) continue;
      var ox = tile.offsetWx || 0;
      var oy = tile.offsetWy || 0;
      var alpha = tile.alpha == null ? 0.9 : tile.alpha;
      if (drawVisionImage(ctx, w, h, camWx - ox, camWy - oy, tile.img, alpha)) drew = true;
    }
    return drew;
  }

  function clampWorldToVision(wx, wy, camWx, camWy, w, h, img, pad) {
    var rect = visionScreenRect(camWx, camWy, w, h, img);
    if (!rect) return { x: wx, y: wy };
    pad = pad == null ? 20 : pad;
    var cx = w / 2;
    var cy = h / 2;
    var sx = cx + (wx - camWx);
    var sy = cy + (wy - camWy);
    sx = clamp(sx, rect.left + pad, rect.right - pad);
    sy = clamp(sy, rect.top + pad, rect.bottom - pad);
    return { x: camWx + (sx - cx), y: camWy + (sy - cy) };
  }

  function clampWorldToMosaic(wx, wy, camWx, camWy, w, h, mosaic, pad) {
    if (!mosaic || !mosaic.pitchX) {
      return clampWorldToVision(wx, wy, camWx, camWy, w, h, mosaic && mosaic.centerImg, pad);
    }
    pad = pad == null ? mosaic.pad || 22 : pad;
    var halfX = mosaic.pitchX * 1.52;
    var halfY = mosaic.pitchY * 1.52;
    return {
      x: clamp(wx, -halfX + pad, halfX - pad),
      y: clamp(wy, -halfY + pad, halfY - pad),
    };
  }

  function mosaicGridAt(wx, wy, pitchX, pitchY) {
    return {
      gx: Math.round(wx / pitchX),
      gy: Math.round(wy / pitchY),
    };
  }

  function predictAhead(ctx, w, h, camWx, camWy, dx, dy, img, buzz, stasis) {
    if (!dx && !dy) return;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = dx / len;
    var ny = dy / len;
    var cx = w / 2;
    var cy = h / 2;
    var aheadWx = camWx + nx * 110;
    var aheadWy = camWy + ny * 110;
    var rgb = worldColorAt(img, aheadWx, aheadWy, buzz, stasis);
    var steps = 7;
    ctx.save();
    for (var i = 1; i <= steps; i++) {
      var t = i / steps;
      var px = cx + nx * t * 95;
      var py = cy + ny * t * 95;
      var r = 18 + t * 28;
      var a = 0.22 * (1 - t * 0.65);
      var grd = ctx.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, "rgba(" + rgb.join(",") + "," + a + ")");
      grd.addColorStop(1, "rgba(" + rgb.join(",") + ",0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  window.StasisWalkFloor = {
    drawPlane: drawPlane,
    drawMosaicPlane: drawMosaicPlane,
    predictAhead: predictAhead,
    visionScreenRect: visionScreenRect,
    visionTilePitch: visionTilePitch,
    clampWorldToVision: clampWorldToVision,
    clampWorldToMosaic: clampWorldToMosaic,
    mosaicGridAt: mosaicGridAt,
    sampleImageColor: sampleImageColor,
    paletteFromBuzz: paletteFromBuzz,
    worldColorAt: worldColorAt,
  };
})();