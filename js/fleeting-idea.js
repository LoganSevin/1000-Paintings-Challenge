/**
 * Fleeting Idea — overhead projector: acetate on glass, smart lasso, flash projection.
 */
(function () {
  var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var ANALYSES_URL = "data/analyses.json";
  var LOD1_ANALYSES_URL = "data/lod1-analyses.json";
  var CYCLE_MS = 520;
  var TOTAL_FRAMES = 26;
  var CAP_W = 1280;
  var CAP_H = 720;
  var LASSO_CLOSE_PX = 18;
  var LASSO_POINT_MIN_PX = 10;
  var LASSO_DRAW_SIMPLIFY = 10;
  var LASSO_RDP_EPSILON = 5;
  var SLOT_COUNT = 5;
  var POSE_MIN = -250;
  var POSE_MAX = 350;
  var SIZE_MIN = 6;
  var SIZE_MAX = 240;
  var SCALE_RATIO_MAX = 5.5;
  var EDGE_SNAP_RADIUS = 22;
  var EDGE_THRESHOLD = 0.16;
  var FLOOD_TOLERANCE = 38;

  var LEXICON = {
    A: { nouns: ["aperture", "amber", "arc"], verbs: ["ascends", "assembles"], moods: ["ancient", "auroral"] },
    B: { nouns: ["bloom", "breath", "bridge"], verbs: ["blooms", "bends"], moods: ["brazen", "billowing"] },
    C: { nouns: ["chamber", "chorus", "cipher"], verbs: ["circles", "carves"], moods: ["cool", "cobalt"] },
    D: { nouns: ["drift", "doorway", "dusk"], verbs: ["dissolves", "dreams"], moods: ["dim", "delicate"] },
    E: { nouns: ["echo", "ember", "edge"], verbs: ["emerges", "entwines"], moods: ["ethereal", "earthen"] },
    F: { nouns: ["fold", "flame", "field"], verbs: ["floats", "fuses"], moods: ["faint", "frosted"] },
    G: { nouns: ["glow", "glyph", "garden"], verbs: ["gathers", "gleams"], moods: ["golden", "ghostly"] },
    H: { nouns: ["haze", "horizon", "halo"], verbs: ["hovers", "hums"], moods: ["hushed", "hazy"] },
    I: { nouns: ["ink", "isle", "iris"], verbs: ["ignites", "inverts"], moods: ["ivory", "iridescent"] },
    J: { nouns: ["junction", "jewel", "journey"], verbs: ["joins", "jumps"], moods: ["jagged", "jade"] },
    K: { nouns: ["knot", "keystone", "kernel"], verbs: ["kindles", "keeps"], moods: ["keen", "kinetic"] },
    L: { nouns: ["loom", "lens", "lagoon"], verbs: ["layers", "lingers"], moods: ["luminous", "lunar"] },
    M: { nouns: ["mirror", "mist", "mosaic"], verbs: ["merges", "murmurs"], moods: ["muted", "molten"] },
    N: { nouns: ["nexus", "night", "nebula"], verbs: ["nestles", "narrows"], moods: ["nocturnal", "nascent"] },
    O: { nouns: ["orbit", "oracle", "ocean"], verbs: ["opens", "overlays"], moods: ["opal", "ochre"] },
    P: { nouns: ["portal", "pulse", "prism"], verbs: ["pulses", "paints"], moods: ["pale", "prismatic"] },
    Q: { nouns: ["quarry", "quartz", "quill"], verbs: ["quivers", "queries"], moods: ["quicksilver", "quaint"] },
    R: { nouns: ["rift", "ripple", "root"], verbs: ["radiates", "reaches"], moods: ["rust", "rosy"] },
    S: { nouns: ["stasis", "spiral", "shard"], verbs: ["shifts", "shimmers"], moods: ["silver", "smoky"] },
    T: { nouns: ["thread", "threshold", "tide"], verbs: ["turns", "trembles"], moods: ["tender", "twilight"] },
    U: { nouns: ["undertow", "umbra", "union"], verbs: ["unfolds", "unites"], moods: ["ultramarine", "unseen"] },
    V: { nouns: ["veil", "vertex", "vista"], verbs: ["vibrates", "vaults"], moods: ["violet", "vivid"] },
    W: { nouns: ["weave", "well", "wavelength"], verbs: ["warps", "welds"], moods: ["wan", "weathered"] },
    X: { nouns: ["axis", "crossing", "xylem"], verbs: ["crosses", "extends"], moods: ["xeric", "exact"] },
    Y: { nouns: ["yarn", "yearning", "yonder"], verbs: ["yearns", "yields"], moods: ["yellowed", "youthful"] },
    Z: { nouns: ["zenith", "zone", "zephyr"], verbs: ["zones", "zigzags"], moods: ["zinc", "zonal"] },
  };

  var state = {
    letter: "A",
    cycleIndex: 0,
    held: true,
    cycling: false,
    composed: "",
    stageUrl: "",
    stageGeneratedAt: 0,
    tool: "move",
    brush: { shape: "round", texture: "smooth", size: 28, flow: 0.85, color: "#1a2030" },
    drawStroke: null,
    stampCache: {},
    smartLasso: true,
    objects: [],
    selectedId: null,
    lastCaptureUrl: "",
    analyses: {},
    analysesLoaded: false,
    lod1Analyses: {},
    lod1AnalysesLoaded: false,
    lod1AnalysisPending: {},
    composeSeed: Date.now(),
    cycleTimer: null,
    drag: null,
    rotateDrag: null,
    scaleDrag: null,
    cornerDrag: null,
    tiltDrag: null,
    stretchDrag: null,
    textBoxGesture: null,
    focusTextId: null,
    lasso: null,
    panelDrag: null,
    viewPan: { x: 0, y: 0 },
    viewPanDrag: null,
    drawTargetId: null,
    objectSeq: 0,
    nextZ: 10,
    composeLiveTimer: null,
    edgeCache: {},
    pipLayerId: null,
    warpRasterCache: {},
    imageLoadCache: {},
    _pendingLayerRemovals: [],
    _renderDepth: 0,
    _imageAuditTimer: null,
    _imageAuditGen: 0,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function hashString(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  function pickFrom(arr, seed) {
    if (!arr || !arr.length) return "";
    return arr[seed % arr.length];
  }

  function uid(prefix) {
    state.objectSeq += 1;
    return prefix + "-" + state.objectSeq;
  }

  var LATTICE_DIM = 5;
  var LATTICE_COUNT = LATTICE_DIM * LATTICE_DIM;
  var LATTICE_CENTER = Math.floor(LATTICE_COUNT / 2);
  var LATTICE_HANDLE_INDICES = [0, 2, 4, 10, 12, 14, 20, 22, 24];
  var LATTICE_TEXT_CORNERS = [0, 4, 24, 20];
  var WARP_CELL_STEPS = 14;
  var LATTICE_OUTER_RING = [0, 1, 2, 3, 4, 9, 14, 19, 24, 23, 22, 21, 20, 15, 10, 5, 0];

  function buildLatticeCells() {
    var cells = [];
    for (var ri = 0; ri < LATTICE_DIM - 1; ri++) {
      for (var ci = 0; ci < LATTICE_DIM - 1; ci++) {
        var tl = ri * LATTICE_DIM + ci;
        cells.push([tl, tl + 1, tl + LATTICE_DIM + 1, tl + LATTICE_DIM]);
      }
    }
    return cells;
  }

  function buildLatticeEdges() {
    var edges = [];
    var r;
    var c;
    for (r = 0; r < LATTICE_DIM; r++) {
      for (c = 0; c < LATTICE_DIM - 1; c++) {
        edges.push([r * LATTICE_DIM + c, r * LATTICE_DIM + c + 1]);
      }
    }
    for (c = 0; c < LATTICE_DIM; c++) {
      for (r = 0; r < LATTICE_DIM - 1; r++) {
        edges.push([r * LATTICE_DIM + c, (r + 1) * LATTICE_DIM + c]);
      }
    }
    return edges;
  }

  var LATTICE_CELLS = buildLatticeCells();
  var LATTICE_EDGES = buildLatticeEdges();

  function defaultLattice() {
    var pts = [];
    for (var row = 0; row < LATTICE_DIM; row++) {
      for (var col = 0; col < LATTICE_DIM; col++) {
        pts.push({
          x: (col / (LATTICE_DIM - 1)) * 100,
          y: (row / (LATTICE_DIM - 1)) * 100,
        });
      }
    }
    return pts;
  }

  function defaultCorners() {
    return defaultLattice();
  }

  function sampleLatticeGrid(lattice, gridDim, u, v) {
    var x = u * (gridDim - 1);
    var y = v * (gridDim - 1);
    var x0 = Math.floor(x);
    var y0 = Math.floor(y);
    var x1 = Math.min(gridDim - 1, x0 + 1);
    var y1 = Math.min(gridDim - 1, y0 + 1);
    var xf = x - x0;
    var yf = y - y0;
    function at(ix, iy) {
      return lattice[iy * gridDim + ix];
    }
    var a = at(x0, y0);
    var b = at(x1, y0);
    var c = at(x0, y1);
    var d = at(x1, y1);
    return {
      x: (1 - xf) * (1 - yf) * a.x + xf * (1 - yf) * b.x + (1 - xf) * yf * c.x + xf * yf * d.x,
      y: (1 - xf) * (1 - yf) * a.y + xf * (1 - yf) * b.y + (1 - xf) * yf * c.y + xf * yf * d.y,
    };
  }

  function upsampleLatticeToCurrent(lattice) {
    if (!lattice || !lattice.length) return defaultLattice();
    if (lattice.length === LATTICE_COUNT) return lattice.slice();
    var dim = Math.round(Math.sqrt(lattice.length));
    if (dim * dim !== lattice.length) return defaultLattice();
    var out = defaultLattice();
    var i;
    for (i = 0; i < LATTICE_COUNT; i++) {
      var row = Math.floor(i / LATTICE_DIM);
      var col = i % LATTICE_DIM;
      out[i] = sampleLatticeGrid(lattice, dim, col / (LATTICE_DIM - 1), row / (LATTICE_DIM - 1));
    }
    return out;
  }

  function migrateCornersToLattice(obj) {
    if (!obj.corners || obj.corners.length !== 4) return;
    var c = obj.corners;
    obj.lattice = defaultLattice();
    obj.lattice[0] = { x: c[0].x, y: c[0].y };
    obj.lattice[4] = { x: c[1].x, y: c[1].y };
    obj.lattice[24] = { x: c[2].x, y: c[2].y };
    obj.lattice[20] = { x: c[3].x, y: c[3].y };
    syncLatticeInteriorCoons(obj.lattice);
    delete obj.corners;
  }

  function ensureLattice(obj) {
    if (!obj.lattice || obj.lattice.length !== LATTICE_COUNT) {
      if (obj.corners && obj.corners.length === 4) migrateCornersToLattice(obj);
      else if (obj.corners && obj.corners.length === LATTICE_COUNT) {
        obj.lattice = upsampleLatticeToCurrent(obj.corners);
        delete obj.corners;
      } else if (obj.lattice && obj.lattice.length > 1) {
        obj.lattice = upsampleLatticeToCurrent(obj.lattice);
      } else {
        obj.lattice = defaultLattice();
      }
    }
    return obj.lattice;
  }

  function ensureCorners(obj) {
    return ensureLattice(obj);
  }

  function latticeAreDefault(lattice) {
    var d = defaultLattice();
    var i;
    for (i = 0; i < LATTICE_COUNT; i++) {
      if (Math.abs(lattice[i].x - d[i].x) > 0.5 || Math.abs(lattice[i].y - d[i].y) > 0.5) return false;
    }
    return true;
  }

  function cornersAreDefault(corners) {
    return latticeAreDefault(corners);
  }

  function latticePointsLocal(lattice, w, h) {
    return lattice.map(function (p) {
      return { x: (p.x / 100) * w, y: (p.y / 100) * h };
    });
  }

  function cornerPointsLocal(corners, w, h) {
    return latticePointsLocal(corners, w, h);
  }

  function drawImageTriangle(ctx, im, x0, y0, x1, y1, x2, y2, dx0, dy0, dx1, dy1, dx2, dy2) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(dx0, dy0);
    ctx.lineTo(dx1, dy1);
    ctx.lineTo(dx2, dy2);
    ctx.closePath();
    ctx.clip();
    var denom = x0 * (y2 - y1) + x1 * (y0 - y2) + x2 * (y1 - y0);
    if (Math.abs(denom) < 0.001) {
      ctx.restore();
      return;
    }
    var a = (dx0 * (y2 - y1) + dx1 * (y0 - y2) + dx2 * (y1 - y0)) / denom;
    var b = (dy0 * (y2 - y1) + dy1 * (y0 - y2) + dy2 * (y1 - y0)) / denom;
    var c = (dx0 * (x1 - x2) + dx1 * (x2 - x0) + dx2 * (x0 - x1)) / denom;
    var d = (dy0 * (x1 - x2) + dy1 * (x2 - x0) + dy2 * (x0 - x1)) / denom;
    var e = (dx0 * (x2 * y1 - x1 * y2) + dx1 * (x0 * y2 - x2 * y0) + dx2 * (x1 * y0 - x0 * y1)) / denom;
    var f = (dy0 * (x2 * y1 - x1 * y2) + dy1 * (x0 * y2 - x2 * y0) + dy2 * (x1 * y0 - x0 * y1)) / denom;
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(im, 0, 0);
    ctx.restore();
  }

  function bilinearCornerXY(corners, u, v) {
    var tl = corners[0];
    var tr = corners[1];
    var br = corners[2];
    var bl = corners[3];
    return {
      x: (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + u * v * br.x + (1 - u) * v * bl.x,
      y: (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + u * v * br.y + (1 - u) * v * bl.y,
    };
  }

  function drawImageBilinearQuad(ctx, img, corners, w, h, centered, srcRect, steps) {
    srcRect = srcRect || { x: 0, y: 0, w: img.width, h: img.height };
    steps = steps || WARP_CELL_STEPS;
    var pts = cornerPointsLocal(corners, w, h);
    if (centered) {
      pts = pts.map(function (p) { return { x: p.x - w / 2, y: p.y - h / 2 }; });
    }
    var c = [pts[0], pts[1], pts[2], pts[3]];
    var sx = srcRect.x;
    var sy = srcRect.y;
    var sw = srcRect.w;
    var sh = srcRect.h;
    var vi;
    var ui;
    for (vi = 0; vi < steps; vi++) {
      for (ui = 0; ui < steps; ui++) {
        var u0 = ui / steps;
        var u1 = (ui + 1) / steps;
        var v0 = vi / steps;
        var v1 = (vi + 1) / steps;
        var dst00 = bilinearCornerXY(c, u0, v0);
        var dst10 = bilinearCornerXY(c, u1, v0);
        var dst11 = bilinearCornerXY(c, u1, v1);
        var dst01 = bilinearCornerXY(c, u0, v1);
        var s00x = sx + u0 * sw;
        var s00y = sy + v0 * sh;
        var s10x = sx + u1 * sw;
        var s10y = sy + v0 * sh;
        var s11x = sx + u1 * sw;
        var s11y = sy + v1 * sh;
        var s01x = sx + u0 * sw;
        var s01y = sy + v1 * sh;
        drawImageTriangle(ctx, img, s00x, s00y, s10x, s10y, s11x, s11y, dst00.x, dst00.y, dst10.x, dst10.y, dst11.x, dst11.y);
        drawImageTriangle(ctx, img, s00x, s00y, s11x, s11y, s01x, s01y, dst00.x, dst00.y, dst11.x, dst11.y, dst01.x, dst01.y);
      }
    }
  }

  function drawImageLattice(ctx, img, lattice, w, h, centered) {
    var iw = img.width;
    var ih = img.height;
    var cellCols = LATTICE_DIM - 1;
    LATTICE_CELLS.forEach(function (indices, cellIdx) {
      var ci = cellIdx % cellCols;
      var ri = Math.floor(cellIdx / cellCols);
      var subCorners = indices.map(function (i) { return lattice[i]; });
      drawImageBilinearQuad(ctx, img, subCorners, w, h, centered, {
        x: (ci / cellCols) * iw,
        y: (ri / cellCols) * ih,
        w: iw / cellCols,
        h: ih / cellCols,
      });
    });
  }

  function layerIsWarped(obj) {
    return obj && !latticeAreDefault(ensureLattice(obj));
  }

  function drawStencilToCanvas(ctx, letter, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(30,40,60,0.82)";
    ctx.font = "600 " + Math.floor(Math.min(w, h) * 0.72) + "px Cormorant Garamond, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter || "A", w / 2, h / 2);
  }

  function drawTextToCanvas(ctx, obj, w, h) {
    normalizeTextBoxObject(obj);
    var text = obj.text || "Your text";
    var fontPx = textBoxFontPx(obj);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = obj.bg || TEXTBOX_CHROME.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = obj.borderColor || TEXTBOX_CHROME.borderColor;
    ctx.lineWidth = Math.max(2, Math.floor(fontPx * 0.1));
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
    ctx.fillStyle = obj.color || TEXTBOX_CHROME.color;
    ctx.font = "600 " + fontPx + "px Cormorant Garamond, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2, w * 0.9);
  }

  function warpRasterKey(obj, w, h) {
    if (obj.type === "image") {
      return obj.id + "|" + w + "x" + h + "|" + (obj.url || "") + "|tx:" + (obj.tiltX || 0) + "|ty:" + (obj.tiltY || 0);
    }
    if (obj.type === "textbox") {
      return (
        obj.id + "|" + w + "x" + h + "|t:" + (obj.text || "") + "|f:" + (obj.fontSize || 4.2) +
        "|tx:" + (obj.tiltX || 0) + "|ty:" + (obj.tiltY || 0)
      );
    }
    if (obj.type === "stencil") {
      return obj.id + "|" + w + "x" + h + "|s:" + (obj.letter || state.letter) + "|tx:" + (obj.tiltX || 0) + "|ty:" + (obj.tiltY || 0);
    }
    return obj.id + "|" + w + "x" + h;
  }

  function invalidateWarpRasterCache(objId) {
    if (!objId) {
      state.warpRasterCache = {};
      return;
    }
    Object.keys(state.warpRasterCache).forEach(function (key) {
      if (key.indexOf(objId + "|") === 0) delete state.warpRasterCache[key];
    });
  }

  function rasterForWarp(obj, w, h) {
    var c = document.createElement("canvas");
    c.width = Math.max(32, Math.round(w));
    c.height = Math.max(32, Math.round(h));
    var ctx = c.getContext("2d");
    if (obj.type === "stencil") {
      drawStencilToCanvas(ctx, obj.letter || state.letter, c.width, c.height);
      return Promise.resolve(c);
    }
    if (obj.type === "textbox") {
      drawTextToCanvas(ctx, obj, c.width, c.height);
      return Promise.resolve(c);
    }
    if (obj.type === "image" && obj.url) {
      return loadImage(obj.url).then(function (img) {
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return c;
      });
    }
    return Promise.resolve(c);
  }

  function getWarpRasterSource(obj, w, h) {
    var key = warpRasterKey(obj, w, h);
    if (state.warpRasterCache[key]) return Promise.resolve(state.warpRasterCache[key]);
    return rasterForWarp(obj, w, h).then(function (source) {
      state.warpRasterCache[key] = source;
      return source;
    });
  }

  function paintWarpedLayer(obj, canvas, w, h) {
    var key = warpRasterKey(obj, w, h);
    var source = state.warpRasterCache[key];
    if (!source) return false;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    drawImageLattice(ctx, source, ensureLattice(obj), w, h, false);
    return true;
  }

  function redrawWarpedLayer(obj, el) {
    if (!obj || !el || !layerIsWarped(obj)) return;
    var canvas = el.querySelector(".fi-warp-canvas");
    if (!canvas) return;
    var rect = el.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    obj._warpDrawGen = (obj._warpDrawGen || 0) + 1;
    var gen = obj._warpDrawGen;
    if (paintWarpedLayer(obj, canvas, w, h)) return;
    getWarpRasterSource(obj, w, h)
      .then(function (source) {
        if (!canvas.isConnected || obj._warpDrawGen !== gen) return;
        var ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, w, h);
        drawImageLattice(ctx, source, ensureLattice(obj), w, h, false);
      })
      .catch(function () {});
  }

  function updateWarpHandles(el, obj) {
    if (!el || !obj) return;
    var lattice = ensureLattice(obj);
    updateWarpBorder(el, lattice, obj.type === "textbox");
    var cornerLayer = el.querySelector(".fi-corner-handles");
    if (!cornerLayer) return;
    cornerLayer.querySelectorAll(".fi-corner-handle").forEach(function (handle) {
      var idx = parseInt(handle.dataset.corner, 10);
      var pt = lattice[idx];
      if (pt) {
        handle.style.left = pt.x + "%";
        handle.style.top = pt.y + "%";
      }
    });
  }

  function warmWarpRaster(obj, el) {
    if (!obj || !el) return;
    var canvas = el.querySelector(".fi-warp-canvas");
    if (!canvas) return;
    var rect = el.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    getWarpRasterSource(obj, w, h).then(function () {
      paintWarpedLayer(obj, canvas, w, h);
    }).catch(function () {});
  }

  var CORNER_MIN = -15;
  var CORNER_MAX = 115;

  function clientToLocalPercent(obj, clientX, clientY, rect, pose) {
    pose = pose || obj;
    var box = {
      left: (pose.x / 100) * rect.width,
      top: (pose.y / 100) * rect.height,
      width: (pose.w / 100) * rect.width,
      height: (pose.h / 100) * rect.height,
    };
    var localX = clientX - rect.left;
    var localY = clientY - rect.top;
    var cx = box.left + box.width / 2;
    var cy = box.top + box.height / 2;
    var rad = -((obj.rotation || 0) * Math.PI) / 180;
    var dx = localX - cx;
    var dy = localY - cy;
    var rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    var ry = dx * Math.sin(rad) + dy * Math.cos(rad);
    return {
      x: (rx / Math.max(box.width, 1) + 0.5) * 100,
      y: (ry / Math.max(box.height, 1) + 0.5) * 100,
    };
  }

  function stretchDragPose(drag) {
    return {
      x: drag.origX,
      y: drag.origY,
      w: drag.origW,
      h: drag.origH,
    };
  }

  function applyResizeTransformFast(el, obj) {
    if (!el || !obj) return;
    el.style.left = obj.x + "%";
    el.style.top = obj.y + "%";
    el.style.width = obj.w + "%";
    el.style.height = obj.h + "%";
    if (obj.type === "textbox") applyTextBoxStyles(el, obj);
    applyPlaneTiltFast(el, obj);
  }

  function clampCorner(pt) {
    return {
      x: Math.max(CORNER_MIN, Math.min(CORNER_MAX, pt.x)),
      y: Math.max(CORNER_MIN, Math.min(CORNER_MAX, pt.y)),
    };
  }

  function parseClipPctPoints(clipPath) {
    if (!clipPath || clipPath.indexOf("polygon") < 0) return [];
    var inner = clipPath.replace(/polygon\(|\)/g, "").trim();
    return inner.split(",").map(function (pair) {
      var parts = pair.trim().split(/\s+/);
      return { x: parseFloat(parts[0]), y: parseFloat(parts[1]) };
    });
  }

  function clipPointsAttr(points) {
    return points.map(function (p) { return p.x + "," + p.y; }).join(" ");
  }

  function ensureWarpDom(el, obj) {
    if (!el || !obj || !layerIsWarped(obj)) return;
    if (el.querySelector(".fi-warp-canvas")) return;
    var inner = el.querySelector(".fi-pose-inner");
    if (!inner) return;
    var wrapper = document.createElement("div");
    wrapper.className = "fi-pose-inner";
    var canvas = document.createElement("canvas");
    canvas.className = "fi-warp-canvas";
    wrapper.appendChild(canvas);
    inner.replaceWith(wrapper);
    redrawWarpedLayer(obj, el);
  }

  function lerpEdgePoints(edgePts, t) {
    var f = t * (edgePts.length - 1);
    var i = Math.min(Math.floor(f), edgePts.length - 2);
    var frac = f - i;
    var a = edgePts[i];
    var b = edgePts[i + 1];
    return { x: a.x + frac * (b.x - a.x), y: a.y + frac * (b.y - a.y) };
  }

  function bilinearLatticeCorner(lattice, u, v) {
    var P00 = lattice[0];
    var P10 = lattice[4];
    var P11 = lattice[24];
    var P01 = lattice[20];
    return {
      x: (1 - u) * (1 - v) * P00.x + u * (1 - v) * P10.x + u * v * P11.x + (1 - u) * v * P01.x,
      y: (1 - u) * (1 - v) * P00.y + u * (1 - v) * P10.y + u * v * P11.y + (1 - u) * v * P01.y,
    };
  }

  function coonsPatchPoint(lattice, u, v) {
    var top = [0, 1, 2, 3, 4].map(function (i) { return lattice[i]; });
    var right = [4, 9, 14, 19, 24].map(function (i) { return lattice[i]; });
    var bottom = [24, 23, 22, 21, 20].map(function (i) { return lattice[i]; });
    var left = [20, 15, 10, 5, 0].map(function (i) { return lattice[i]; });
    var Ptop = lerpEdgePoints(top, u);
    var Pbot = lerpEdgePoints(bottom, u);
    var Pleft = lerpEdgePoints(left, v);
    var Pright = lerpEdgePoints(right, v);
    var bc = bilinearLatticeCorner(lattice, u, v);
    return {
      x: (1 - v) * Ptop.x + v * Pbot.x + (1 - u) * Pleft.x + u * Pright.x - bc.x,
      y: (1 - v) * Ptop.y + v * Pbot.y + (1 - u) * Pleft.y + u * Pright.y - bc.y,
    };
  }

  function syncLatticeInteriorCoons(lattice) {
    var r;
    var c;
    for (r = 1; r < LATTICE_DIM - 1; r++) {
      for (c = 1; c < LATTICE_DIM - 1; c++) {
        var idx = r * LATTICE_DIM + c;
        if (idx === LATTICE_CENTER) continue;
        lattice[idx] = coonsPatchPoint(lattice, c / (LATTICE_DIM - 1), r / (LATTICE_DIM - 1));
      }
    }
  }

  function syncLatticeAfterHandleDrag(lattice, handleIdx) {
    if (handleIdx === LATTICE_CENTER) return;
    syncLatticeInteriorCoons(lattice);
  }

  function latticeGridSvg(lattice, outerOnly) {
    var lines;
    if (outerOnly) {
      lines = "";
      for (var i = 0; i < LATTICE_OUTER_RING.length - 1; i++) {
        var a = lattice[LATTICE_OUTER_RING[i]];
        var b = lattice[LATTICE_OUTER_RING[i + 1]];
        lines += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" />';
      }
    } else {
      lines = LATTICE_EDGES.map(function (pair) {
        var a = lattice[pair[0]];
        var b = lattice[pair[1]];
        return '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" />';
      }).join("");
    }
    return '<svg class="fi-lattice-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + lines + "</svg>";
  }

  function updateWarpBorder(el, lattice, outerOnly) {
    if (!el) return;
    var grid = el.querySelector(".fi-lattice-grid");
    if (!grid) return;
    var lines;
    if (outerOnly) {
      lines = [];
      for (var i = 0; i < LATTICE_OUTER_RING.length - 1; i++) {
        var a = lattice[LATTICE_OUTER_RING[i]];
        var b = lattice[LATTICE_OUTER_RING[i + 1]];
        lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
    } else {
      lines = LATTICE_EDGES.map(function (pair) {
        var a = lattice[pair[0]];
        var b = lattice[pair[1]];
        return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      });
    }
    var lineEls = grid.querySelectorAll("line");
    lines.forEach(function (spec, idx) {
      var line = lineEls[idx];
      if (!line) return;
      line.setAttribute("x1", spec.x1);
      line.setAttribute("y1", spec.y1);
      line.setAttribute("x2", spec.x2);
      line.setAttribute("y2", spec.y2);
    });
  }

  function updateClipEdge(el, clipPath) {
    if (!el) return;
    var edge = el.querySelector(".fi-clip-edge");
    if (!edge) return;
    var pts = parseClipPctPoints(clipPath);
    var poly = edge.querySelector("polygon");
    if (poly && pts.length >= 3) poly.setAttribute("points", clipPointsAttr(pts));
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function objectTypeLabel(obj) {
    if (obj.type === "stencil") return "stencil " + (obj.letter || state.letter);
    if (obj.type === "textbox") return "text";
    if (obj.isPip) return "pip";
    return obj.label || "sheet";
  }

  function supportsWarp(obj) {
    return false;
  }

  function supportsPlaneTilt(obj) {
    return obj && (obj.type === "image" || obj.type === "stencil" || obj.type === "textbox");
  }

  function clampTilt(deg) {
    return Math.max(-72, Math.min(72, deg));
  }

  function planeIsTilted(obj) {
    return supportsPlaneTilt(obj) && (Math.abs(obj.tiltX || 0) > 0.4 || Math.abs(obj.tiltY || 0) > 0.4);
  }

  function planeTiltCorners(obj) {
    var tiltX = ((obj.tiltX || 0) * Math.PI) / 180;
    var tiltY = ((obj.tiltY || 0) * Math.PI) / 180;
    var depth = 2.4;
    var unit = [
      [-0.5, -0.5, 0],
      [0.5, -0.5, 0],
      [0.5, 0.5, 0],
      [-0.5, 0.5, 0],
    ];
    return unit.map(function (pt) {
      var x = pt[0];
      var y = pt[1];
      var z = pt[2];
      var cosY = Math.cos(tiltY);
      var sinY = Math.sin(tiltY);
      var x1 = x * cosY + z * sinY;
      var z1 = -x * sinY + z * cosY;
      var cosX = Math.cos(tiltX);
      var sinX = Math.sin(tiltX);
      var y2 = y * cosX - z1 * sinX;
      var z2 = y * sinX + z1 * cosX;
      var scale = depth / (depth + z2);
      return {
        x: (x1 * scale + 0.5) * 100,
        y: (y2 * scale + 0.5) * 100,
      };
    });
  }

  function migrateLatticeToTilt(obj) {
    if (!supportsPlaneTilt(obj)) return;
    if (obj.lattice && !latticeAreDefault(obj.lattice)) {
      var l = obj.lattice;
      var topY = (l[0].y + l[4].y) / 2;
      var botY = (l[20].y + l[24].y) / 2;
      var leftX = (l[0].x + l[20].x) / 2;
      var rightX = (l[4].x + l[24].x) / 2;
      obj.tiltX = clampTilt((botY - topY - 100) * 0.42);
      obj.tiltY = clampTilt((rightX - leftX - 100) * 0.42);
      return;
    }
    if (obj.corners && obj.corners.length === 4 && !latticeAreDefault(obj.corners)) {
      var c = obj.corners;
      var topC = (c[0].y + c[1].y) / 2;
      var botC = (c[2].y + c[3].y) / 2;
      var leftC = (c[0].x + c[3].x) / 2;
      var rightC = (c[1].x + c[2].x) / 2;
      obj.tiltX = clampTilt((botC - topC - 100) * 0.42);
      obj.tiltY = clampTilt((rightC - leftC - 100) * 0.42);
    }
  }

  function normalizePlaneObject(obj) {
    if (!supportsPlaneTilt(obj)) return obj;
    migrateLatticeToTilt(obj);
    delete obj.lattice;
    delete obj.corners;
    if (obj.tiltX == null) obj.tiltX = 0;
    if (obj.tiltY == null) obj.tiltY = 0;
    return obj;
  }

  function planeTiltInner(el) {
    if (!el) return null;
    return (
      el.querySelector(".fi-plane-tilt-stage .fi-pose-inner") ||
      el.querySelector(".fi-textbox-tilt-stage .fi-pose-inner")
    );
  }

  function planeHandleMap(obj) {
    var corners = planeTiltCorners(obj);
    var map = {
      tl: corners[0],
      tr: corners[1],
      br: corners[2],
      bl: corners[3],
    };
    if (obj && supportsPlaneTilt(obj)) {
      map.top = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
      map.bottom = { x: (corners[3].x + corners[2].x) / 2, y: (corners[3].y + corners[2].y) / 2 };
      map.left = { x: (corners[0].x + corners[3].x) / 2, y: (corners[0].y + corners[3].y) / 2 };
      map.right = { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 };
    }
    return map;
  }

  function updatePlaneHandlePositions(el, obj) {
    if (!el || !supportsPlaneTilt(obj)) return;
    var map = planeHandleMap(obj);
    el.querySelectorAll(".fi-tilt-handle[data-corner]").forEach(function (handle) {
      var pt = map[handle.dataset.corner];
      if (!pt) return;
      handle.style.left = pt.x + "%";
      handle.style.top = pt.y + "%";
    });
    el.querySelectorAll(".fi-edge-handle[data-edge]").forEach(function (handle) {
      var pt = map[handle.dataset.edge];
      if (!pt) return;
      handle.style.left = pt.x + "%";
      handle.style.top = pt.y + "%";
    });
  }

  function applyTextBoxLayoutToEl(el, obj) {
    if (!el || !obj || obj.type !== "textbox") return;
    el.style.left = obj.x + "%";
    el.style.top = obj.y + "%";
    el.style.width = obj.w + "%";
    el.style.height = obj.h + "%";
    applyTextBoxStyles(el, obj);
  }

  function applyPlaneTilt(el, obj) {
    if (!el || !obj) return;
    normalizePlaneObject(obj);
    var inner = planeTiltInner(el);
    if (!inner) return;
    inner.style.transform = "rotateX(" + (obj.tiltX || 0) + "deg) rotateY(" + (obj.tiltY || 0) + "deg)";
    el.classList.toggle("is-tilted", planeIsTilted(obj));
    updatePlaneHandlePositions(el, obj);
  }

  function applyPlaneTiltFast(el, obj) {
    if (!el || !obj) return;
    var inner = planeTiltInner(el);
    if (!inner) return;
    inner.style.transform = "rotateX(" + (obj.tiltX || 0) + "deg) rotateY(" + (obj.tiltY || 0) + "deg)";
    el.classList.toggle("is-tilted", planeIsTilted(obj));
    updatePlaneHandlePositions(el, obj);
  }

  function setTiltDragChrome(active) {
    var ws = $("fi-workspace");
    if (ws) ws.classList.toggle("is-tilt-dragging", !!active);
  }

  function supportsEdgeStretch(obj) {
    return obj && (obj.type === "textbox" || obj.type === "image" || obj.type === "stencil");
  }

  function bedDeltaToLocalAxes(obj, dxBed, dyBed) {
    var rad = ((obj.rotation || 0) * Math.PI) / 180;
    return {
      dx: dxBed * Math.cos(rad) + dyBed * Math.sin(rad),
      dy: -dxBed * Math.sin(rad) + dyBed * Math.cos(rad),
    };
  }

  function applyEdgeStretchDrag(obj, drag, bedDelta) {
    if (!obj || !drag || !supportsEdgeStretch(obj) || !bedDelta) return;
    var local = bedDeltaToLocalAxes(obj, bedDelta.dx, bedDelta.dy);
    var ldx = local.dx;
    var ldy = local.dy;
    if (drag.edge === "right") {
      obj.w = clampSizePercent(drag.origW + ldx);
    } else if (drag.edge === "left") {
      obj.w = clampSizePercent(drag.origW - ldx);
      obj.x = clampPosePercent(drag.origX + ldx);
    } else if (drag.edge === "bottom") {
      obj.h = clampSizePercent(drag.origH + ldy);
      if (obj.type === "textbox" && drag.origH > 0) {
        obj.fitToText = false;
        obj.fontSize = clampTextBoxFont(drag.origFontSize * (obj.h / drag.origH));
      }
    } else if (drag.edge === "top") {
      obj.h = clampSizePercent(drag.origH - ldy);
      obj.y = clampPosePercent(drag.origY + ldy);
      if (obj.type === "textbox" && drag.origH > 0) {
        obj.fitToText = false;
        obj.fontSize = clampTextBoxFont(drag.origFontSize * (obj.h / drag.origH));
      }
    }
  }

  var TEXTBOX_CHROME = {
    bg: "rgba(248, 252, 255, 0.52)",
    color: "rgba(18, 26, 40, 0.9)",
    borderColor: "rgba(48, 62, 92, 0.55)",
  };

  function clampTextBoxFont(size) {
    return Math.max(1.2, Math.min(24, size));
  }

  function textBoxFontPx(obj) {
    var vmin = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(10, Math.round((obj.fontSize || 4.2) * vmin / 100));
  }

  function scaleTextBoxByRatio(obj, ratio) {
    if (!obj || obj.type !== "textbox" || !ratio || ratio === 1) return;
    obj.fitToText = false;
    obj.fontSize = clampTextBoxFont((obj.fontSize || 4.2) * ratio);
    invalidateWarpRasterCache(obj.id);
  }

  function normalizeTextBoxObject(obj) {
    if (!obj || obj.type !== "textbox") return obj;
    normalizePlaneObject(obj);
    if (obj.fontSize == null) obj.fontSize = 4.2;
    if (!obj.bg) obj.bg = TEXTBOX_CHROME.bg;
    if (!obj.color || obj.color === "#1a2030") obj.color = TEXTBOX_CHROME.color;
    if (!obj.borderColor) obj.borderColor = TEXTBOX_CHROME.borderColor;
    return obj;
  }

  function readTextBoxInnerText(inner) {
    if (!inner) return "";
    if (inner.classList.contains("is-placeholder")) return "";
    return String(inner.innerText != null ? inner.innerText : inner.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n/g, "\n");
  }

  function textBoxHtmlFromText(text) {
    if (!text) return "";
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  function syncTextBoxFromDom(obj) {
    if (!obj || obj.type !== "textbox") return obj;
    var inner = document.querySelector('.fi-textbox-object[data-id="' + obj.id + '"] .fi-textbox-inner');
    if (!inner) return obj;
    obj.text = readTextBoxInnerText(inner);
    return obj;
  }

  function syncAllTextBoxesFromDom() {
    state.objects.filter(function (o) { return o.type === "textbox"; }).forEach(syncTextBoxFromDom);
  }

  function applyTextBoxStyles(el, obj) {
    var inner = el && el.querySelector(".fi-textbox-inner");
    if (!inner || !obj) return;
    normalizeTextBoxObject(obj);
    inner.style.background = obj.bg;
    inner.style.color = obj.color;
    inner.style.borderColor = obj.borderColor;
    inner.style.fontSize = (obj.fontSize || 4.2) + "vmin";
    inner.style.whiteSpace = "pre";
    inner.style.overflow = "visible";
  }

  function ensureTextBoxLayout(obj) {
    if (!obj || obj.type !== "textbox") return obj;
    normalizeTextBoxObject(obj);
    if (obj.fitToText == null) obj.fitToText = true;
    if (!obj.w || !obj.h) {
      obj.w = 14;
      obj.h = 7;
    }
    obj.w = clampSizePercent(obj.w);
    obj.h = clampSizePercent(obj.h);
    if (obj.x == null || obj.y == null || obj.x < -40 || obj.x > 140 || obj.y < -40 || obj.y > 140) {
      obj.x = (100 - obj.w) / 2;
      obj.y = (100 - obj.h) / 2;
    }
    obj.x = clampPosePercent(obj.x);
    obj.y = clampPosePercent(obj.y);
    return obj;
  }

  function fitTextBoxToContent(obj, el, opts) {
    if (!obj || obj.type !== "textbox" || obj.fitToText === false || !el) return;
    opts = opts || {};
    applyTextBoxStyles(el, obj);
    var inner = el.querySelector(".fi-textbox-inner");
    var bed = acetateBedRect();
    if (!inner || bed.width < 120 || bed.height < 80) return;

    var cx = obj.x + obj.w / 2;
    var cy = obj.y + obj.h / 2;

    el.style.width = "auto";
    el.style.height = "auto";
    el.style.minWidth = "0";
    el.style.minHeight = "0";
    inner.style.boxSizing = "border-box";
    inner.style.display = "inline-block";
    inner.style.width = "max-content";
    inner.style.maxWidth = "none";
    inner.style.height = "auto";
    inner.style.minHeight = "0";
    inner.style.whiteSpace = "pre";
    inner.style.overflow = "visible";

    var rect = inner.getBoundingClientRect();
    var wPx = Math.max(44, Math.ceil(rect.width));
    var hPx = Math.max(30, Math.ceil(rect.height));

    inner.style.display = "block";
    inner.style.width = "100%";
    inner.style.maxWidth = "";
    inner.style.height = "100%";
    inner.style.whiteSpace = "pre";
    inner.style.overflow = "visible";

    obj.w = clampSizePercent((wPx / bed.width) * 100);
    obj.h = clampSizePercent((hPx / bed.height) * 100);
    if (opts.preserveCenter !== false) {
      obj.x = clampPosePercent(cx - obj.w / 2);
      obj.y = clampPosePercent(cy - obj.h / 2);
    }
    el.style.width = obj.w + "%";
    el.style.height = obj.h + "%";
    el.style.minWidth = "";
    el.style.minHeight = "";
    if (obj.id === state.selectedId) updatePlaneHandlePositions(el, obj);
  }

  function scheduleTextBoxFit(obj) {
    if (!obj || obj.type !== "textbox" || obj.fitToText === false) return;
    requestAnimationFrame(function () {
      var el = document.querySelector('.fi-textbox-object[data-id="' + obj.id + '"]');
      if (!el) return;
      fitTextBoxToContent(obj, el, { preserveCenter: true });
    });
  }

  function compressDataUrl(dataUrl, maxW, quality) {
    maxW = maxW || 960;
    quality = quality || 0.8;
    return new Promise(function (resolve) {
      if (!dataUrl) return resolve("");
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxW / Math.max(img.width, 1));
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  function getAnalysis(num) {
    if (!num) return null;
    return state.analyses[String(num)] || state.analyses[num] || null;
  }

  function getLod1Analysis(num) {
    if (!num) return null;
    return state.lod1Analyses[String(num)] || state.lod1Analyses[num] || null;
  }

  function parseLod1NumFromUrl(url) {
    if (!url) return null;
    var m = String(url).match(/\/generated\/(\d+)\.[a-z]+/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function slotIsLod1(s) {
    if (!s || !s.url) return false;
    return (
      s.source === "lod1" ||
      s.folderId === "generated" ||
      s.folderId === "lod1s" ||
      String(s.url).indexOf("/generated/") >= 0
    );
  }

  function slotLod1Num(s) {
    if (!s) return null;
    if (s.lod1Num) return s.lod1Num;
    if (slotIsLod1(s)) return parseLod1NumFromUrl(s.url);
    return null;
  }

  function appendAnalysisLines(chunk, analysis) {
    if (!analysis) return;
    if (analysis.title) chunk.push('"' + analysis.title + '"');
    if (analysis.style) chunk.push(analysis.style);
    if (analysis.mood) chunk.push(analysis.mood);
    if (analysis.description) {
      var snip = analysis.description.split(/[.!?]/)[0].trim();
      if (snip) chunk.push(snip.length > 110 ? snip.slice(0, 107) + "…" : snip);
    }
  }

  function loadAnalyses() {
    if (state.analysesLoaded) return Promise.resolve();
    if (window.loadGalleryData) {
      return window.loadGalleryData().then(function (data) {
        state.analyses = (data && data.analyses) || {};
        state.analysesLoaded = true;
      });
    }
    return fetch(ANALYSES_URL)
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (data) {
        state.analyses = data || {};
        state.analysesLoaded = true;
      });
  }

  function loadLod1Analyses() {
    if (state.lod1AnalysesLoaded) return Promise.resolve();
    return fetch(LOD1_ANALYSES_URL)
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (data) {
        state.lod1Analyses = data || {};
        state.lod1AnalysesLoaded = true;
      });
  }

  function apiUrl(path) {
    var base = window.SPELLFORGE_API_BASE || "";
    if (base && base.charAt(base.length - 1) === "/") base = base.slice(0, -1);
    return base + path;
  }

  function ensureLod1Analysis(num) {
    if (!num) return Promise.resolve(null);
    var cached = getLod1Analysis(num);
    if (cached) return Promise.resolve(cached);
    if (state.lod1AnalysisPending[num]) return state.lod1AnalysisPending[num];
    state.lod1AnalysisPending[num] = fetch(apiUrl("/api/analyze-lod1"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ num: num }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok && data.analysis) {
          state.lod1Analyses[String(num)] = data.analysis;
          composeMoment();
          return data.analysis;
        }
        return null;
      })
      .catch(function () { return null; })
      .finally(function () {
        delete state.lod1AnalysisPending[num];
      });
    return state.lod1AnalysisPending[num];
  }

  function prefetchLod1AnalysesForSlots() {
    var slots = getAllSlots();
    var nums = [];
    slots.forEach(function (s) {
      var n = slotLod1Num(s);
      if (n && !getLod1Analysis(n) && nums.indexOf(n) < 0) nums.push(n);
    });
    nums.forEach(function (n) { ensureLod1Analysis(n); });
  }

  function getEquippedSlots() {
    if (!window.FleetingAcquired || !window.FleetingAcquired.getSlots) return [];
    return window.FleetingAcquired.getSlots().filter(function (s) {
      return s && s.url;
    });
  }

  function sheetPaintingNums() {
    var nums = [];
    state.objects.forEach(function (o) {
      if (o.type === "image" && o.paintingNum && nums.indexOf(o.paintingNum) < 0) {
        nums.push(o.paintingNum);
      }
    });
    return nums.sort(function (a, b) { return a - b; });
  }

  function paintingNums(slots) {
    var nums = [];
    (slots || getEquippedSlots()).forEach(function (s) {
      if (s.paintingNum && nums.indexOf(s.paintingNum) < 0) nums.push(s.paintingNum);
    });
    return nums.sort(function (a, b) { return a - b; });
  }

  function gatherMeta(nums) {
    var titles = [], tags = [], styles = [], snippets = [];
    nums.forEach(function (n) {
      var a = getAnalysis(n);
      if (!a) return;
      if (a.title) titles.push(a.title);
      if (a.style) styles.push(a.style);
      if (a.tags) tags = tags.concat(a.tags);
      if (a.description) {
        var bit = a.description.split(/[.!?]/)[0].trim();
        if (bit) snippets.push(bit);
      }
    });
    return { titles: titles, tags: uniqueStrings(tags), styles: uniqueStrings(styles), snippets: snippets };
  }

  function uniqueStrings(arr) {
    var out = [];
    arr.forEach(function (s) { if (s && out.indexOf(s) < 0) out.push(s); });
    return out;
  }

  function getObject(id) {
    for (var i = 0; i < state.objects.length; i++) {
      if (state.objects[i].id === id) return state.objects[i];
    }
    return null;
  }

  function sortedObjects() {
    return state.objects.slice().sort(function (a, b) {
      return (a.zIndex || 0) - (b.zIndex || 0);
    });
  }

  function assignZ(obj) {
    state.nextZ += 1;
    obj.zIndex = state.nextZ;
  }

  function bringToFront(id) {
    var obj = getObject(id);
    if (!obj) return;
    assignZ(obj);
  }

  function reorderLayer(id, dir) {
    var obj = getObject(id);
    if (!obj) return;
    var sorted = sortedObjects();
    var idx = sorted.findIndex(function (o) { return o.id === id; });
    if (idx < 0) return;
    var next = idx + dir;
    if (next < 0 || next >= sorted.length) return;
    var tmp = sorted[idx];
    sorted[idx] = sorted[next];
    sorted[next] = tmp;
    sorted.forEach(function (o, i) { o.zIndex = i + 1; });
    state.nextZ = sorted.length + 1;
  }

  function sendBackward(id) { reorderLayer(id, -1); }
  function bringForward(id) { reorderLayer(id, 1); }

  function normalizeZ() {
    sortedObjects().forEach(function (o, i) { o.zIndex = i + 1; });
    state.nextZ = state.objects.length + 1;
  }

  function setLayerOrderFromPanel(panelIds) {
    var reversed = panelIds.slice().reverse();
    reversed.forEach(function (id, i) {
      var obj = getObject(id);
      if (obj) obj.zIndex = i + 1;
    });
    state.nextZ = Math.max(state.nextZ, panelIds.length + 1);
  }

  function panelDragInsertAt(list, card, clientY) {
    var cards = Array.prototype.slice.call(list.querySelectorAll(".fi-sheet-card"));
    var insertBefore = null;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i] === card) continue;
      var rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        insertBefore = cards[i];
        break;
      }
    }
    if (insertBefore) list.insertBefore(card, insertBefore);
    else list.appendChild(card);
  }

  function normalizeImageDimensions(obj) {
    if (!obj || obj.type !== "image" || !obj.aspect) return;
    var aspect = Math.max(0.2, obj.aspect);
    obj.h = clampSizePercent(obj.w / aspect);
  }

  function layoutGridForCount(total) {
    total = Math.max(1, total || 1);
    if (total <= 1) return { cols: 1, rows: 1 };
    if (total <= 2) return { cols: 2, rows: 1 };
    if (total <= 4) return { cols: 2, rows: 2 };
    return { cols: 3, rows: 2 };
  }

  function layoutForEquippedSlot(index, total, aspect) {
    var plate = glassPlateInBed();
    aspect = Math.max(0.2, aspect || 1);
    total = Math.max(1, total || 1);
    index = Math.max(0, index || 0);
    var grid = layoutGridForCount(total);
    var padX = total > 1 ? 5 : 8;
    var padY = total > 1 ? 7 : 10;
    var cellW = (plate.w - padX * 2) / grid.cols;
    var cellH = (plate.h - padY * 2) / grid.rows;
    var maxW = cellW * (total > 1 ? 0.84 : 0.68);
    var maxH = cellH * (total > 1 ? 0.84 : 0.72);
    var w = maxW;
    var h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    var col = index % grid.cols;
    var row = Math.floor(index / grid.cols);
    return {
      x: plate.x + padX + col * cellW + (cellW - w) / 2,
      y: plate.y + padY + row * cellH + (cellH - h) / 2,
      w: w,
      h: h,
      rotation: total > 1 ? Math.random() * 4 - 2 : Math.random() * 6 - 3,
      tiltX: 0,
      tiltY: 0,
      bedCoords: true,
    };
  }

  function layoutForAspect(i, aspect, total) {
    return layoutForEquippedSlot(i, total || 1, aspect);
  }

  function scatterLayout(i, aspect) {
    return layoutForEquippedSlot(i, 1, aspect || 16 / 9);
  }

  function scheduleLiveCompose() {
    if (state.composeLiveTimer) clearTimeout(state.composeLiveTimer);
    state.composeLiveTimer = setTimeout(function () {
      state.composeLiveTimer = null;
      composeMoment();
    }, 100);
  }

  function poseSummary() {
    return sortedObjects()
      .filter(function (o) { return o.type === "image"; })
      .map(function (o, i) {
        var tag = o.label || "sheet" + (i + 1);
        return "L" + (o.zIndex || 0) + ":" + tag + "@" + Math.round(o.x) + "," + Math.round(o.y);
      })
      .join(" ");
  }

  function getUserPrompt() {
    var el = $("fi-prompt");
    return el && el.value ? el.value.trim() : "";
  }

  function formatStageTime(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (err) {
      return "";
    }
  }

  function getAllSlots() {
    if (!window.FleetingAcquired || !window.FleetingAcquired.getSlots) return [];
    return window.FleetingAcquired.getSlots();
  }

  function buildSlotSpellsSummary() {
    var slots = getAllSlots();
    var lines = [];
    for (var i = 0; i < SLOT_COUNT; i++) {
      var s = slots[i];
      if (!s || !s.url) {
        lines.push("Spell " + (i + 1) + ": empty");
        continue;
      }
      var chunk = ["Spell " + (i + 1)];
      var lod1Num = slotLod1Num(s);
      if (lod1Num) {
        chunk.push("LOD1 #" + lod1Num);
        if (s.label && s.label.indexOf("LOD1") < 0) chunk.push(s.label);
        var la = getLod1Analysis(lod1Num);
        if (la) {
          appendAnalysisLines(chunk, la);
        } else {
          chunk.push("upscaled stasis vision · describing…");
        }
      } else {
        if (s.label) chunk.push(s.label);
        if (s.paintingNum) {
          var a = getAnalysis(s.paintingNum);
          if (a) {
            appendAnalysisLines(chunk, a);
          } else {
            chunk.push("#" + s.paintingNum);
          }
        }
        if (s.source && s.source !== "lod1") chunk.push("via " + s.source);
      }
      lines.push(chunk.join(" · "));
    }
    return lines;
  }

  function buildMomentComposition() {
    var parts = [];
    var spellLines = buildSlotSpellsSummary();
    if (spellLines.length) parts.push(spellLines.join(" | "));
    if (state.stageUrl) {
      var gen = "overhead essential upscale";
      if (state.stageGeneratedAt) gen += " · " + formatStageTime(state.stageGeneratedAt);
      parts.push(gen);
    }
    var userPrompt = getUserPrompt();
    if (userPrompt) parts.push("prompt index: " + userPrompt);
    var texts = state.objects
      .filter(function (o) { return o.type === "textbox" && o.text; })
      .map(function (o) { return '"' + o.text + '"'; });
    if (texts.length) parts.push("glass text " + texts.join(" "));
    var sheets = state.objects.filter(function (o) { return o.type === "image"; }).length;
    if (sheets) {
      parts.push(sheets + " transparency sheet" + (sheets === 1 ? "" : "s") + " on glass");
    }
    return parts.join(" · ");
  }

  function setComposerStatus(msg) {
    var el = $("fi-composer-status");
    if (el) el.textContent = msg || "";
  }

  function updateComposedDisplay() {
    var out = $("fi-composed");
    if (out) {
      out.textContent = state.composed || "";
      out.classList.add("fi-live");
      setTimeout(function () { if (out) out.classList.remove("fi-live"); }, 280);
    }
    window.dispatchEvent(
      new CustomEvent("fi-composed", {
        detail: { letter: state.letter, frame: state.cycleIndex + 1, text: state.composed },
      })
    );
  }

  function composeMoment() {
    cullBlankImageLayersSync();
    state.composed = buildMomentComposition();
    updateComposedDisplay();
  }

  function objectIsOverscaled(obj) {
    if (!obj) return false;
    var plate = glassPlateInBed();
    return (
      obj.x < plate.x - 0.5 ||
      obj.y < plate.y - 0.5 ||
      obj.x + obj.w > plate.x + plate.w + 0.5 ||
      obj.y + obj.h > plate.y + plate.h + 0.5
    );
  }

  function acetateBedRect() {
    var mount = $("fi-acetate-mount");
    return mount ? mount.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
  }

  function glassPlateInBed() {
    return { x: 0, y: 0, w: 100, h: 100 };
  }

  function syncHeaderHeight() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    var h = Math.ceil(header.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty("--fi-header-h", h + "px");
  }

  /** Fixed desktop rails — panels stay put; OHP does not chase growing status text. */
  function syncEdgeInsets() {
    var ws = $("fi-workspace");
    if (!ws) return;
    ws.style.setProperty("--fi-edge-left", "8.25rem");
    ws.style.setProperty("--fi-edge-right", "12.5rem");
    ws.style.setProperty("--fi-edge-top", "3.5rem");
    ws.style.setProperty("--fi-edge-bottom", "11.5rem");
    syncCubeGeometry();
  }

  function syncWorkspaceSize() {
    syncHeaderHeight();
    syncEdgeInsets();
    var building = $("fi-building-viewport");
    var canvas = $("fi-draw-canvas");
    if (!building || !canvas) return;
    var w = Math.max(1, building.clientWidth);
    var h = Math.max(1, building.clientHeight);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    syncCubeGeometry();
  }

  function syncCubeGeometry() {
    /* Decorative cube / webpage frame removed — open acetate bed only */
  }

  function applyViewPan() {
    var building = $("fi-building-viewport");
    if (!building) return;
    var x = state.viewPan.x + "px";
    var y = state.viewPan.y + "px";
    building.style.setProperty("--fi-pan-x", x);
    building.style.setProperty("--fi-pan-y", y);
    var stage = $("fi-exterior-stage");
    if (stage) {
      stage.style.setProperty("--fi-pan-x", x);
      stage.style.setProperty("--fi-pan-y", y);
    }
  }

  function syncExteriorPan() {
    applyViewPan();
  }

  function resetViewPan() {
    state.viewPan.x = 0;
    state.viewPan.y = 0;
    applyViewPan();
  }

  function startViewPanDrag(e) {
    e.preventDefault();
    state.viewPanDrag = {
      startX: e.clientX,
      startY: e.clientY,
      origPanX: state.viewPan.x,
      origPanY: state.viewPan.y,
    };
    var buildingPan = $("fi-building-viewport");
    if (buildingPan) {
      buildingPan.classList.add("is-view-panning");
      if (buildingPan.setPointerCapture) try { buildingPan.setPointerCapture(e.pointerId); } catch (err) {}
    }
    updateHud();
  }

  function syncExteriorPortalSize() {
    syncWorkspaceSize();
  }

  function initDrawCanvas() {
    syncWorkspaceSize();
    var canvas = $("fi-draw-canvas");
    if (canvas) canvas.dataset.ready = "1";
  }

  function buildingStageRect() {
    var building = $("fi-building-viewport");
    return building ? building.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
  }

  function worldPointFromClient(clientX, clientY) {
    return drawPointFromClient(clientX, clientY);
  }

  function drawPointFromClient(clientX, clientY) {
    var canvas = $("fi-draw-canvas");
    if (!canvas) return { x: 0, y: 0 };
    var rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      var sr = buildingStageRect();
      rect = sr;
    }
    var scaleX = canvas.width / Math.max(1, rect.width);
    var scaleY = canvas.height / Math.max(1, rect.height);
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function drawTargetObject() {
    return getObject(state.drawTargetId) || getObject(state.selectedId);
  }

  function ensureDrawTargetLayer() {
    if (state.drawTargetId && getObject(state.drawTargetId)) return state.drawTargetId;
    if (state.selectedId && getObject(state.selectedId)) {
      state.drawTargetId = state.selectedId;
      return state.drawTargetId;
    }
    var layers = sortedObjects().filter(function (o) {
      return o.type === "image" || o.type === "stencil" || o.type === "textbox";
    });
    if (!layers.length) return null;
    var top = layers[layers.length - 1];
    state.drawTargetId = top.id;
    state.selectedId = top.id;
    renderObjects();
    return top.id;
  }

  function placeDrawLayerAboveTarget(drawObj) {
    normalizeZ();
    var target = drawTargetObject();
    if (!target || target.id === drawObj.id) {
      assignZ(drawObj);
      return;
    }
    var targetZ = target.zIndex || 1;
    state.objects.forEach(function (o) {
      if (o.id === drawObj.id) return;
      if ((o.zIndex || 0) > targetZ) o.zIndex = (o.zIndex || 0) + 1;
    });
    drawObj.zIndex = targetZ + 1;
    drawObj.drawnOverId = target.id;
    drawObj.label = "ink on " + objectTypeLabel(target);
    state.nextZ = Math.max(state.nextZ, drawObj.zIndex + 1);
  }

  function drawCanvasToBedPercent(cx, cy, cw, ch) {
    var bed = acetateBedRect();
    var building = $("fi-building-viewport");
    var canvas = $("fi-draw-canvas");
    if (!building || !canvas || bed.width < 1 || bed.height < 1) {
      return { x: 0, y: 0, w: 10, h: 10 };
    }
    var br = building.getBoundingClientRect();
    var left = br.left + (cx / canvas.width) * br.width;
    var top = br.top + (cy / canvas.height) * br.height;
    return {
      x: ((left - bed.left) / bed.width) * 100,
      y: ((top - bed.top) / bed.height) * 100,
      w: ((cw / canvas.width) * br.width / bed.width) * 100,
      h: ((ch / canvas.height) * br.height / bed.height) * 100,
    };
  }

  function captureCoordsFromBed(obj) {
    var plate = glassPlateInBed();
    return {
      x: ((obj.x - plate.x) / plate.w) * 100,
      y: ((obj.y - plate.y) / plate.h) * 100,
      w: (obj.w / plate.w) * 100,
      h: (obj.h / plate.h) * 100,
      rotation: obj.rotation,
      clipPath: obj.clipPath,
      type: obj.type,
      url: obj.url,
      label: obj.label,
      letter: obj.letter,
      text: obj.text,
      color: obj.color,
      corners: obj.corners,
      id: obj.id,
    };
  }

  function migrateObjectsToBedCoords() {
    state.objects.forEach(function (obj) {
      if (supportsPlaneTilt(obj)) normalizePlaneObject(obj);
      if (obj.bedCoords) return;
      var plate = glassPlateInBed();
      if (plate.w < 0.5 || plate.h < 0.5) return;
      obj.x = plate.x + (obj.x / 100) * plate.w;
      obj.y = plate.y + (obj.y / 100) * plate.h;
      obj.w = (obj.w / 100) * plate.w;
      obj.h = (obj.h / 100) * plate.h;
      obj.bedCoords = true;
    });
  }

  function brushCacheKey() {
    var b = state.brush;
    return [b.shape, b.texture, b.size, b.flow, b.color].join("|");
  }

  function buildBrushStamp() {
    var key = brushCacheKey();
    if (state.stampCache[key]) return state.stampCache[key];
    var b = state.brush;
    var size = Math.max(4, b.size);
    var pad = Math.ceil(size * 0.35);
    var dim = size + pad * 2;
    var stamp = document.createElement("canvas");
    stamp.width = dim;
    stamp.height = dim;
    var ctx = stamp.getContext("2d");
    var cx = dim / 2;
    var cy = dim / 2;
    var rgb = b.color || "#1a2030";
    ctx.clearRect(0, 0, dim, dim);

    function applyTexture(alpha) {
      var img = ctx.getImageData(0, 0, dim, dim);
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 4) continue;
        var n = Math.random();
        if (b.texture === "grain") d[i + 3] = Math.round(d[i + 3] * (0.55 + n * 0.55) * alpha);
        else if (b.texture === "ink") d[i + 3] = Math.round(d[i + 3] * (0.35 + n * 0.75) * alpha);
        else if (b.texture === "chalk") d[i + 3] = Math.round(d[i + 3] * (n > 0.22 ? 0.9 : 0.15) * alpha);
        else if (b.texture === "charcoal") d[i + 3] = Math.round(d[i + 3] * (0.25 + n * 0.85) * alpha);
        else d[i + 3] = Math.round(d[i + 3] * alpha);
      }
      ctx.putImageData(img, 0, 0);
    }

    var flow = Math.max(0.1, Math.min(1, b.flow));
    if (b.shape === "square") {
      ctx.fillStyle = rgb;
      ctx.globalAlpha = flow;
      ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
      applyTexture(1);
    } else if (b.shape === "stamp") {
      ctx.fillStyle = rgb;
      ctx.globalAlpha = flow;
      ctx.beginPath();
      for (var i = 0; i < 10; i++) {
        var ang = -Math.PI / 2 + (i * Math.PI * 2) / 10;
        var rad = i % 2 === 0 ? size * 0.5 : size * 0.22;
        var px = cx + Math.cos(ang) * rad;
        var py = cy + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      applyTexture(1);
    } else if (b.shape === "ribbon") {
      var grd = ctx.createLinearGradient(cx - size / 2, cy, cx + size / 2, cy);
      grd.addColorStop(0, "rgba(0,0,0,0)");
      grd.addColorStop(0.5, rgb);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.globalAlpha = flow;
      ctx.fillRect(cx - size / 2, cy - size / 6, size, size / 3);
      applyTexture(1);
    } else {
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
      g.addColorStop(0, rgb);
      g.addColorStop(b.texture === "ink" ? 0.35 : 0.65, rgb);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.globalAlpha = flow;
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.fill();
      applyTexture(1);
    }
    ctx.globalAlpha = 1;
    state.stampCache[key] = stamp;
    return stamp;
  }

  function dabBrush(ctx, x, y, angle) {
    var stamp = buildBrushStamp();
    var dim = stamp.width;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.translate(x, y);
    if (angle != null) ctx.rotate(angle);
    ctx.drawImage(stamp, -dim / 2, -dim / 2);
    ctx.restore();
  }

  function stampAlongSegment(ctx, from, to) {
    var b = state.brush;
    var spacing = Math.max(2, b.size * (0.18 + (1 - b.flow) * 0.35));
    var dist = Math.hypot(to.x - from.x, to.y - from.y);
    var steps = Math.max(1, Math.ceil(dist / spacing));
    var angle = Math.atan2(to.y - from.y, to.x - from.x) + (b.shape === "ribbon" ? 0 : Math.random() * 0.35 - 0.175);
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      dabBrush(ctx, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, angle);
    }
  }

  function readBrushFromUi() {
    var shape = $("fi-brush-shape");
    var texture = $("fi-brush-texture");
    var size = $("fi-brush-size");
    var flow = $("fi-brush-flow");
    var color = $("fi-brush-color");
    if (shape) state.brush.shape = shape.value;
    if (texture) state.brush.texture = texture.value;
    if (size) state.brush.size = parseInt(size.value, 10) || 28;
    if (flow) state.brush.flow = (parseInt(flow.value, 10) || 85) / 100;
    if (color) state.brush.color = color.value;
    state.stampCache = {};
  }

  function onDrawPointerDown(e) {
    if (e.button === 1) {
      startViewPanDrag(e);
      return;
    }
    if (e.button !== 0) return;
    if (state.tool !== "draw") return;
    if (!ensureDrawTargetLayer()) {
      setComposerStatus("Add a layer on the glass first, then draw on top of it.");
      setTimeout(function () { setComposerStatus(""); }, 2200);
      return;
    }
    var canvas = $("fi-draw-canvas");
    if (!canvas) return;
    initDrawCanvas();
    readBrushFromUi();
    var pt = drawPointFromClient(e.clientX, e.clientY);
    state.drawStroke = {
      points: [pt],
      bounds: { minX: pt.x, minY: pt.y, maxX: pt.x, maxY: pt.y },
    };
    var ctx = canvas.getContext("2d");
    dabBrush(ctx, pt.x, pt.y, 0);
    if (canvas.setPointerCapture) try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    canvas.classList.add("is-drawing");
    e.preventDefault();
    e.stopPropagation();
    composeMoment();
    updateHud();
  }

  function onDrawPointerMove(e) {
    if (!state.drawStroke) return;
    var canvas = $("fi-draw-canvas");
    if (!canvas) return;
    var pt = drawPointFromClient(e.clientX, e.clientY);
    var prev = state.drawStroke.points[state.drawStroke.points.length - 1];
    if (Math.hypot(pt.x - prev.x, pt.y - prev.y) < 1.5) return;
    state.drawStroke.points.push(pt);
    var b = state.drawStroke.bounds;
    b.minX = Math.min(b.minX, pt.x);
    b.minY = Math.min(b.minY, pt.y);
    b.maxX = Math.max(b.maxX, pt.x);
    b.maxY = Math.max(b.maxY, pt.y);
    var ctx = canvas.getContext("2d");
    stampAlongSegment(ctx, prev, pt);
    e.preventDefault();
    scheduleLiveCompose();
  }

  function onDrawPointerUp() {
    if (!state.drawStroke) return;
    state.drawStroke = null;
    var canvas = $("fi-draw-canvas");
    if (canvas) canvas.classList.remove("is-drawing");
    composeMoment();
    updateHud();
  }

  function drawCanvasHasInk() {
    var canvas = $("fi-draw-canvas");
    if (!canvas || canvas.width < 1 || canvas.height < 1) return false;
    var d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (var i = 3; i < d.length; i += 4) {
      if (d[i] > 8) return true;
    }
    return false;
  }

  function commitDrawStrokes(opts) {
    opts = opts || {};
    var canvas = $("fi-draw-canvas");
    if (!canvas || canvas.width < 1) return;
    var ctx = canvas.getContext("2d");
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = img.data;
    var minX = canvas.width;
    var minY = canvas.height;
    var maxX = 0;
    var maxY = 0;
    var found = false;
    for (var y = 0; y < canvas.height; y++) {
      for (var x = 0; x < canvas.width; x++) {
        var a = d[(y * canvas.width + x) * 4 + 3];
        if (a > 8) {
          found = true;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (!found) {
      if (!opts.silent) {
        setComposerStatus("Nothing drawn yet — use Draw on the OHP surface.");
        setTimeout(function () { setComposerStatus(""); }, 1800);
      }
      return false;
    }
    var pad = 8;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(canvas.width - 1, maxX + pad);
    maxY = Math.min(canvas.height - 1, maxY + pad);
    var w = Math.max(4, maxX - minX + 1);
    var h = Math.max(4, maxY - minY + 1);
    var out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d").drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
    if (!imageHasVisibleInk(out)) {
      if (!opts.silent) {
        setComposerStatus("Nothing drawn yet — use Draw on the OHP surface.");
        setTimeout(function () { setComposerStatus(""); }, 1800);
      }
      return false;
    }
    var pct = drawCanvasToBedPercent(minX, minY, w, h);
    var id = uid("draw");
    var drawObj = {
      id: id,
      type: "image",
      url: out.toDataURL("image/png"),
      label: "drawing",
      paintingNum: null,
      x: pct.x,
      y: pct.y,
      w: pct.w,
      h: pct.h,
      rotation: 0,
      clipPath: "",
      corners: defaultCorners(),
      zIndex: 0,
      bedCoords: true,
      isDrawing: true,
    };
    state.objects.push(drawObj);
    placeDrawLayerAboveTarget(drawObj);
    state.selectedId = id;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderObjects();
    composeMoment();
    if (!opts.silent) {
      setComposerStatus("Strokes committed as acetate layer.");
      setTimeout(function () { setComposerStatus(""); }, 1600);
    }
    return true;
  }

  function finalizeDrawSession() {
    if (state.drawStroke) onDrawPointerUp();
    if (!drawCanvasHasInk()) return false;
    return commitDrawStrokes({ silent: true });
  }

  function chromeHitTarget(target) {
    return (
      target &&
      target.closest &&
      target.closest(
        ".fi-chrome-top, .fi-chrome-bottom, .fi-chrome-left, .fi-chrome-right, .fi-chrome-panel, .fi-prompt-exterior, .fi-timelapse-hud, .fi-prompt-hud-input, #fi-prompt, #fi-sheets-panel, .fi-sheets-panel, .fi-sheets-panel-actions, #fi-acquired-rail, .fi-acquired-rail, #fi-ohp-controls, .fi-ohp-controls, #fi-toggle-interface, #fi-restore-interface, #fi-vision-pip"
      )
    );
  }

  function onBuildingPointerDown(e) {
    if (chromeHitTarget(e.target)) return;
    if (e.button === 1) {
      startViewPanDrag(e);
      return;
    }
    if (state.tool === "draw") {
      onDrawPointerDown(e);
      return;
    }
    onPointerDown(e);
  }

  function setInterfaceHidden(hidden) {
    var ws = $("fi-workspace");
    if (!ws) return;
    ws.classList.toggle("fi-interface-hidden", !!hidden);
    document.body.classList.toggle("fi-interface-hidden", !!hidden);
    var toggleBtn = $("fi-toggle-interface");
    var restoreBtn = $("fi-restore-interface");
    if (toggleBtn) toggleBtn.hidden = !!hidden;
    if (restoreBtn) restoreBtn.hidden = !hidden;
    if (hidden) {
      document.documentElement.style.setProperty("--fi-header-h", "0px");
      syncWorkspaceSize();
    } else {
      syncHeaderHeight();
      syncEdgeInsets();
    }
  }

  function syncDomainChrome() {
    var layout = $("fi-stage-layout");
    if (!layout) return;
    var hasOverscaled = state.objects.some(function (o) {
      return o.type === "image" && objectIsOverscaled(o);
    });
    layout.classList.toggle("fi-domain-active", hasOverscaled);
  }

  function syncOverscaleToggle() {
    syncDomainChrome();
  }

  function clampPosePercent(v) {
    return Math.max(POSE_MIN, Math.min(POSE_MAX, v));
  }

  function clampSizePercent(v) {
    return Math.max(SIZE_MIN, Math.min(SIZE_MAX, v));
  }

  function updateHud() {
    var indexEl = $("fi-prompt-index");
    var clockEl = $("fi-timelapse-clock");
    var sheets = state.objects.filter(function (o) { return o.type === "image"; }).length;
    if (indexEl) {
      indexEl.textContent =
        "Index " + (state.cycleIndex + 1) + "/" + TOTAL_FRAMES + " · " + state.letter +
        (sheets ? " · " + sheets + " sheet" + (sheets === 1 ? "" : "s") : "");
    }
    if (clockEl) {
      var sel = getObject(state.selectedId);
      if (state.drawStroke) clockEl.textContent = "drawing…";
      else if (state.tool === "draw") {
        var drawTarget = drawTargetObject();
        clockEl.textContent = drawTarget
          ? "inking over " + objectTypeLabel(drawTarget) + " — toggle Draw off to save"
          : "select a layer, then draw on the OHP";
      }
      else if (state.stretchDrag) clockEl.textContent = "stretching…";
      else if (state.tiltDrag) clockEl.textContent = "tilting…";
      else if (state.tool === "move") {
        clockEl.textContent =
          sel && supportsPlaneTilt(sel)
            ? (sel.type === "textbox"
              ? "drag to move · click to type · corners tilt · edges stretch ↔ ↕"
              : "drag to move · drag corners to tilt on the table")
            : "slide layers on the glass · middle-click drag to pan the OHP";
      }
      else if (state.rotateDrag) clockEl.textContent = "rotating…";
      else if (state.scaleDrag) clockEl.textContent = "scaling…";
      else if (state.viewPanDrag) clockEl.textContent = "panning view…";
      else if (state.cornerDrag) clockEl.textContent = "warping…";
      else if (sel) clockEl.textContent = "layer " + (sel.zIndex || "?") + (state.drag ? " · sliding" : " · selected");
      else clockEl.textContent = state.held ? "stencil paused" : "stencil playing";
    }
  }

  function updateHoldButton() {
    var holdBtn = $("fi-hold-letter");
    if (!holdBtn) return;
    holdBtn.setAttribute("aria-pressed", state.held ? "true" : "false");
    holdBtn.classList.toggle("active", state.held);
    holdBtn.textContent = state.held ? "Resume stencil" : "Pause stencil";
  }

  function stencilCount() {
    return state.objects.filter(function (o) { return o.type === "stencil"; }).length;
  }

  function addStencil(layout) {
    var count = stencilCount();
    var plate = glassPlateInBed();
    var id = uid("stencil");
    var stencil = {
      id: id,
      type: "stencil",
      letter: state.letter,
      x: layout ? layout.x : plate.x + plate.w * (0.28 + count * 0.06),
      y: layout ? layout.y : plate.y + plate.h * (0.14 + count * 0.05),
      w: layout ? layout.w : plate.w * 0.2,
      h: layout ? layout.h : plate.h * 0.36,
      rotation: layout ? layout.rotation || -2 : Math.random() * 6 - 3,
      clipPath: "",
      tiltX: layout && layout.tiltX != null ? layout.tiltX : 0,
      tiltY: layout && layout.tiltY != null ? layout.tiltY : 0,
      zIndex: 0,
      bedCoords: true,
    };
    assignZ(stencil);
    state.objects.push(stencil);
    state.selectedId = id;
    renderObjects();
    composeMoment();
    return id;
  }

  function defaultTextBoxLayout() {
    var w = 14;
    var h = 7;
    return {
      x: (100 - w) / 2,
      y: (100 - h) / 2,
      w: w,
      h: h,
      rotation: 0,
      bedCoords: true,
    };
  }

  function flashTextBoxAdded(id) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var el = document.querySelector('.fi-textbox-object[data-id="' + id + '"]');
        if (!el) return;
        el.classList.add("fi-textbox-flash");
        setTimeout(function () {
          if (el) el.classList.remove("fi-textbox-flash");
        }, 3200);
      });
    });
  }

  function addTextBox(layout) {
    syncWorkspaceSize();
    var boxLayout = layout || defaultTextBoxLayout();
    var id = uid("text");
    var textbox = {
      id: id,
      type: "textbox",
      text: "",
      bg: TEXTBOX_CHROME.bg,
      color: TEXTBOX_CHROME.color,
      borderColor: TEXTBOX_CHROME.borderColor,
      fontSize: 4.2,
      tiltX: 0,
      tiltY: 0,
      x: boxLayout.x,
      y: boxLayout.y,
      w: boxLayout.w,
      h: boxLayout.h,
      rotation: boxLayout.rotation || 0,
      clipPath: "",
      zIndex: 0,
      fitToText: true,
      justAdded: true,
      bedCoords: true,
    };
    assignZ(textbox);
    state.objects.push(textbox);
    state.selectedId = id;
    state.focusTextId = id;
    bringToFront(id);
    renderObjects();
    flashTextBoxAdded(id);
    composeMoment();
    setComposerStatus("Text box on the glass — click to type; drag the tag to move.");
    requestAnimationFrame(function () {
      var inner = document.querySelector('.fi-textbox-object[data-id="' + id + '"] .fi-textbox-inner');
      if (inner) focusTextBoxEditor(inner, true);
      state.focusTextId = null;
    });
    setTimeout(function () {
      setComposerStatus("");
      var obj = getObject(id);
      if (obj) obj.justAdded = false;
    }, 2200);
    return id;
  }

  function addImageObject(slot, layout, opts) {
    opts = opts || {};
    if (!slot || !slot.url) return Promise.resolve(null);
    var id = uid("img");
    var count = state.objects.filter(function (o) { return o.type === "image"; }).length;
    var obj = {
      id: id,
      type: "image",
      url: slot.url,
      label: slot.label || "",
      paintingNum: slot.paintingNum || null,
      x: layout ? layout.x : 8 + count * 6,
      y: layout ? layout.y : 12 + count * 5,
      w: layout ? layout.w : 36,
      h: layout ? layout.h : 42,
      rotation: layout ? layout.rotation || 0 : Math.random() * 8 - 4,
      clipPath: layout && layout.clipPath ? layout.clipPath : "",
      clipEdge: !!(layout && layout.clipEdge),
      tiltX: layout && layout.tiltX != null ? layout.tiltX : 0,
      tiltY: layout && layout.tiltY != null ? layout.tiltY : 0,
      zIndex: 0,
      bedCoords: true,
      locked: false,
    };
    return validateImageUrl(slot.url)
      .then(function (img) {
        if (!layout || !layout.w || !layout.h) {
          var fitted = layoutForEquippedSlot(
            opts.slotIndex != null ? opts.slotIndex : count,
            opts.slotTotal || 1,
            img.width / Math.max(img.height, 1)
          );
          obj.x = fitted.x;
          obj.y = fitted.y;
          obj.w = fitted.w;
          obj.h = fitted.h;
          obj.rotation = fitted.rotation;
          obj.tiltX = fitted.tiltX || 0;
          obj.tiltY = fitted.tiltY || 0;
        }
        obj.aspect = img.width / Math.max(img.height, 1);
        obj.loadFailed = false;
        normalizeImageDimensions(obj);
        assignZ(obj);
        state.objects.push(obj);
        state.selectedId = id;
        bringToFront(id);
        renderObjects();
        if (opts.scrollPanel) {
          selectObject(id, { scrollPanel: true, bringToFront: false });
        }
        return id;
      })
      .catch(function () {
        var label = slot.label || slot.url || "image";
        setComposerStatus("Skipped blank or unreadable image (" + label + ").");
        setTimeout(function () { setComposerStatus(""); }, 2200);
        return null;
      });
  }

  function duplicateSelected() {
    var obj = getObject(state.selectedId);
    if (!obj) {
      setComposerStatus("Select a layer to duplicate.");
      setTimeout(function () { setComposerStatus(""); }, 1600);
      return;
    }
    var clone = JSON.parse(JSON.stringify(obj));
    clone.id = uid(obj.type === "image" ? "img" : obj.type === "textbox" ? "text" : "stencil");
    clone.locked = false;
    clone.x = clampPosePercent((obj.x || 0) + 2.5);
    clone.y = clampPosePercent((obj.y || 0) + 2.5);
    clone.zIndex = 0;
    if (clone.type === "textbox") normalizeTextBoxObject(clone);
    function finishDuplicate() {
      assignZ(clone);
      state.objects.push(clone);
      state.selectedId = clone.id;
      renderObjects();
      selectObject(clone.id, { scrollPanel: true, bringToFront: true });
      setComposerStatus("Layer duplicated.");
      setTimeout(function () { setComposerStatus(""); }, 1400);
    }
    if (clone.type === "image") {
      if (!clone.url) {
        setComposerStatus("Cannot duplicate — source image is blank.");
        setTimeout(function () { setComposerStatus(""); }, 1800);
        return;
      }
      validateImageUrl(clone.url).then(function () {
        normalizeImageDimensions(clone);
        clone.loadFailed = false;
        finishDuplicate();
      }).catch(function () {
        setComposerStatus("Cannot duplicate — source image is blank.");
        setTimeout(function () { setComposerStatus(""); }, 1800);
      });
      return;
    }
    finishDuplicate();
  }

  function toggleLayerLock() {
    var obj = getObject(state.selectedId);
    if (!obj) {
      setComposerStatus("Select a layer to lock or unlock.");
      setTimeout(function () { setComposerStatus(""); }, 1600);
      return;
    }
    obj.locked = !obj.locked;
    updateLockButton();
    renderObjects();
    setComposerStatus(obj.locked ? "Layer locked in place." : "Layer unlocked — slide again.");
    setTimeout(function () { setComposerStatus(""); }, 1400);
  }

  function updateLockButton() {
    var btn = $("fi-lock-layer");
    var obj = getObject(state.selectedId);
    if (!btn) return;
    var on = !!(obj && obj.locked);
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "Unlock" : "Lock";
  }

  function deleteSelected() {
    var obj = getObject(state.selectedId);
    if (!obj) {
      setComposerStatus("Select a layer to remove.");
      setTimeout(function () { setComposerStatus(""); }, 1600);
      return;
    }
    if (obj.isPip) state.pipLayerId = null;
    invalidateWarpRasterCache(obj.id);
    state.objects = state.objects.filter(function (o) { return o.id !== obj.id; });
    state.selectedId = null;
    normalizeZ();
    renderObjects();
    syncStageChrome();
    composeMoment();
    var msg = obj.type === "stencil" ? "Stencil removed." : obj.type === "textbox" ? "Text box removed." : "Sheet removed.";
    setComposerStatus(msg);
    setTimeout(function () { setComposerStatus(""); }, 1400);
  }

  function stripImageRefreshParam(url) {
    if (!url || url.indexOf("data:") === 0 || url.indexOf("blob:") === 0) return url;
    return url.replace(/([?&])fi_refresh=\d+/g, function (m, lead) {
      return lead;
    }).replace(/[?&]$/, "");
  }

  function bustImageUrl(url, stamp) {
    var base = stripImageRefreshParam(url);
    if (!base || base.indexOf("data:") === 0 || base.indexOf("blob:") === 0) return base;
    var sep = base.indexOf("?") >= 0 ? "&" : "?";
    return base + sep + "fi_refresh=" + stamp;
  }

  function syncLayerUrlsFromSlots() {
    var slots = getEquippedSlots();
    if (!slots.length) return 0;
    var updated = 0;
    state.objects.forEach(function (obj) {
      if (obj.type !== "image" || !obj.url) return;
      var slot = null;
      if (obj.paintingNum) {
        slot = slots.find(function (s) { return s.paintingNum === obj.paintingNum; });
      }
      if (!slot && obj.label) {
        slot = slots.find(function (s) { return s.label && s.label === obj.label; });
      }
      if (slot && slot.url && stripImageRefreshParam(slot.url) !== stripImageRefreshParam(obj.url)) {
        obj.url = slot.url;
        if (slot.label) obj.label = slot.label;
        if (slot.paintingNum) obj.paintingNum = slot.paintingNum;
        updated++;
      }
    });
    return updated;
  }

  function refreshLayers() {
    if (state.refreshingLayers) return Promise.resolve();
    state.refreshingLayers = true;
    setComposerStatus("Refreshing layers…");
    syncAllTextBoxesFromDom();
    var synced = syncLayerUrlsFromSlots();
    invalidateWarpRasterCache();
    state.imageLoadCache = {};
    var stamp = Date.now();
    var images = state.objects.filter(function (o) { return o.type === "image" && o.url; });
    images.forEach(function (obj) {
      obj.url = bustImageUrl(obj.url, stamp);
    });
    var loads = images.map(function (obj) {
      return loadImage(obj.url).catch(function () { return null; });
    });
    return Promise.all(loads)
      .then(function () {
        enforceNoBlankImageLayers({ silent: true });
        renderObjects();
        state.composeSeed = Date.now();
        composeMoment();
        var n = state.objects.length;
        var msg = "Layers refreshed";
        if (synced) msg += " — " + synced + " image" + (synced === 1 ? "" : "s") + " synced from slots";
        msg += " (" + n + ").";
        setComposerStatus(msg);
        setTimeout(function () { setComposerStatus(""); }, 2200);
      })
      .catch(function () {
        renderObjects();
        composeMoment();
        setComposerStatus("Layers refreshed with some image errors.");
        setTimeout(function () { setComposerStatus(""); }, 2200);
      })
      .finally(function () {
        state.refreshingLayers = false;
      });
  }

  function placeEquipped() {
    var slots = getEquippedSlots();
    if (!slots.length) {
      setComposerStatus("Equip images in slots first.");
      setTimeout(function () { setComposerStatus(""); }, 1800);
      return;
    }
    state.objects = state.objects.filter(function (o) { return o.type !== "image"; });
    var pending = slots.map(function (slot, i) {
      return addImageObject(slot, null, { scrollPanel: i === 0, slotIndex: i, slotTotal: slots.length });
    });
    Promise.all(pending).then(function (ids) {
      normalizeZ();
      renderObjects();
      var added = ids.filter(function (id) { return !!id; }).length;
      var skipped = slots.length - added;
      syncStageChrome(true);
      composeMoment();
      if (!added) {
        setComposerStatus("No valid images loaded — all " + slots.length + " slot image(s) were blank or unreadable.");
      } else if (skipped > 0) {
        setComposerStatus(
          "Loaded " + added + " sheet" + (added === 1 ? "" : "s") + " — skipped " + skipped + " blank slot image(s)."
        );
      } else {
        setComposerStatus("Loaded " + added + " transparency sheet" + (added === 1 ? "" : "s") + ".");
      }
      setTimeout(function () { setComposerStatus(""); }, 2400);
    });
  }

  function dropActivePaper() {
    if (!window.FleetingAcquired) return;
    var slots = window.FleetingAcquired.getSlots();
    var active = window.FleetingAcquired.getActiveSlot ? window.FleetingAcquired.getActiveSlot() : 0;
    var slot = slots[active] || slots.find(function (s) { return s && s.url; });
    if (!slot || !slot.url) {
      setComposerStatus("Equip a slot image to add a transparency.");
      setTimeout(function () { setComposerStatus(""); }, 1800);
      return;
    }
    addImageObject(slot, null, { scrollPanel: true }).then(function (id) {
      if (!id) return;
      renderObjects();
      syncStageChrome(true);
      composeMoment();
      setComposerStatus("Added a sheet to the glass.");
      setTimeout(function () { setComposerStatus(""); }, 1400);
    });
  }

  function projectionPreviewUrl() {
    return state.stageUrl || (state.objects.find(function (o) { return o.type === "image" && !o.isPip; }) || {}).url || "";
  }

  function findPipLayer() {
    if (state.pipLayerId) {
      var tracked = getObject(state.pipLayerId);
      if (tracked && tracked.isPip) return tracked;
      state.pipLayerId = null;
    }
    return state.objects.find(function (o) { return o.isPip; }) || null;
  }

  function pipSourceObject() {
    var selected = getObject(state.selectedId);
    if (selected && selected.type === "image" && !selected.isPip) return selected;
    var images = state.objects.filter(function (o) { return o.type === "image" && !o.isPip; });
    return images.length ? images[images.length - 1] : null;
  }

  function layoutForPip(aspect) {
    aspect = Math.max(0.2, aspect || 16 / 9);
    var w = 26;
    var h = w / aspect;
    if (h > 22) {
      h = 22;
      w = h * aspect;
    }
    return {
      x: 100 - w - 4,
      y: 100 - h - 6,
      w: w,
      h: h,
      rotation: 0,
    };
  }

  function removePipLayer() {
    var existing = findPipLayer();
    if (!existing) return false;
    if (state.selectedId === existing.id) state.selectedId = null;
    state.objects = state.objects.filter(function (o) { return o.id !== existing.id; });
    state.pipLayerId = null;
    normalizeZ();
    renderObjects();
    syncPipButton();
    syncStageChrome();
    return true;
  }

  function togglePipLayer() {
    if (removePipLayer()) {
      setComposerStatus("Picture in Picture layer removed.");
      setTimeout(function () { setComposerStatus(""); }, 1400);
      return;
    }
    var source = pipSourceObject();
    if (!source) {
      setComposerStatus("Add or select an image layer first.");
      setTimeout(function () { setComposerStatus(""); }, 1600);
      return;
    }
    var layout = layoutForPip(source.aspect || 16 / 9);
    var clone = JSON.parse(JSON.stringify(source));
    clone.id = uid("img");
    clone.isPip = true;
    clone.label = "pip";
    clone.locked = false;
    clone.x = layout.x;
    clone.y = layout.y;
    clone.w = layout.w;
    clone.h = layout.h;
    clone.rotation = layout.rotation;
    clone.zIndex = 0;
    normalizeImageDimensions(clone);
    assignZ(clone);
    state.objects.push(clone);
    state.pipLayerId = clone.id;
    state.selectedId = clone.id;
    bringToFront(clone.id);
    renderObjects();
    selectObject(clone.id, { scrollPanel: true, bringToFront: false });
    syncPipButton();
    setComposerStatus("Picture in Picture layer added — slide it on the acetate.");
    setTimeout(function () { setComposerStatus(""); }, 1800);
  }

  function syncPipButton() {
    var pipBtn = $("fi-vision-pip");
    if (!pipBtn) return;
    var hasSource = !!pipSourceObject();
    var pipOn = !!findPipLayer();
    pipBtn.hidden = !hasSource;
    pipBtn.classList.toggle("active", pipOn);
    pipBtn.textContent = pipOn ? "Hide PiP layer" : "Picture in Picture";
    pipBtn.setAttribute("aria-pressed", pipOn ? "true" : "false");
  }

  function bindPipLayer() {
    var pipBtn = $("fi-vision-pip");
    if (pipBtn && !pipBtn.dataset.bound) {
      pipBtn.dataset.bound = "1";
      pipBtn.addEventListener("click", togglePipLayer);
    }
  }

  function syncStageChrome(hasContent) {
    var hint = $("fi-vision-hint");
    var hiddenImg = $("fi-stage-img");
    if (hasContent == null) hasContent = state.objects.some(function (o) { return o.type === "image" && !o.isPip; });
    if (hint) hint.hidden = hasContent;
    var previewUrl = projectionPreviewUrl();
    if (previewUrl && hiddenImg) hiddenImg.src = previewUrl;
    syncPipButton();
  }

  function applyObjectTransform(el, obj, opts) {
    opts = opts || {};
    if (obj.type === "textbox") ensureTextBoxLayout(obj);
    el.style.left = obj.x + "%";
    el.style.top = obj.y + "%";
    el.style.width = obj.w + "%";
    el.style.height = obj.h + "%";
    if (obj.type === "textbox") {
      el.style.transformOrigin = "center center";
      el.style.zIndex = String(800 + (obj.zIndex || 0));
      el.style.minWidth = "";
      el.style.minHeight = "";
    } else {
      el.style.minWidth = "";
      el.style.minHeight = "";
      el.style.zIndex = String(obj.zIndex || 1);
    }
    if (supportsPlaneTilt(obj)) el.style.transformStyle = "preserve-3d";
    el.style.transform = "rotate(" + (obj.rotation || 0) + "deg)";
    el.classList.toggle("selected", obj.id === state.selectedId);
    el.classList.toggle("dragging", !!opts.dragging);
    el.classList.toggle("is-overscaled", objectIsOverscaled(obj));
    el.classList.toggle("is-locked", !!obj.locked);
    var inner = planeTiltInner(el) || el.querySelector(".fi-pose-inner");
    if (inner) {
      if (obj.clipPath) {
        inner.style.clipPath = obj.clipPath;
        inner.style.webkitClipPath = obj.clipPath;
      } else {
        inner.style.clipPath = "";
        inner.style.webkitClipPath = "";
      }
      if (obj.type === "textbox") applyTextBoxStyles(el, obj);
      if (supportsPlaneTilt(obj)) applyPlaneTilt(el, obj);
    }
    if (obj.clipPath && obj.clipEdge) updateClipEdge(el, obj.clipPath);
  }

  function selectObject(id, opts) {
    opts = opts || {};
    var obj = getObject(id);
    if (!obj) return;
    if (obj.type === "textbox") syncTextBoxFromDom(obj);
    if (opts.bringToFront) bringToFront(id);
    state.selectedId = id;
    if (state.tool === "draw") state.drawTargetId = id;
    if (!opts.noRender) renderObjects();
    if (opts.scrollPanel) {
      var card = document.querySelector('.fi-sheet-card[data-id="' + id + '"]');
      if (card && card.scrollIntoView) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function layerIsGenerated(obj) {
    if (!obj || obj.type !== "image") return false;
    if (obj.label === "generated" || obj.label === "vision" || obj.label === "capture") return true;
    return String(obj.url || "").indexOf("/generated/") >= 0;
  }

  function imageLayerLooksEmpty(obj) {
    if (!obj || obj.type !== "image") return false;
    if (!obj.url || obj.loadFailed) return true;
    var el = document.querySelector('.fi-image-object[data-id="' + obj.id + '"] img');
    if (!el) return false;
    if (!el.complete || el.naturalWidth === 0 || el.naturalHeight === 0) return true;
    return !imageHasVisibleInk(el);
  }

  function layerShowsRegenerate(obj) {
    return obj && obj.type === "image" && !obj.isPip && (obj.loadFailed || imageLayerLooksEmpty(obj) || layerIsGenerated(obj));
  }

  function panToLayer(id) {
    var obj = getObject(id);
    if (!obj) return;
    var el = document.querySelector('.fi-pose-object[data-id="' + id + '"]');
    var building = $("fi-building-viewport");
    if (!el || !building) {
      selectObject(id, { scrollPanel: true });
      return;
    }
    var objRect = el.getBoundingClientRect();
    var objCenterX = objRect.left + objRect.width / 2;
    var objCenterY = objRect.top + objRect.height / 2;
    var vpRect = building.getBoundingClientRect();
    var vpCenterX = vpRect.left + vpRect.width / 2;
    var vpCenterY = vpRect.top + vpRect.height / 2;
    state.viewPan.x += vpCenterX - objCenterX;
    state.viewPan.y += vpCenterY - objCenterY;
    applyViewPan();
    selectObject(id, { scrollPanel: true });
    setComposerStatus("Centered on " + objectTypeLabel(obj) + ".");
    setTimeout(function () { setComposerStatus(""); }, 1400);
    updateHud();
  }

  function copyPoseFromTo(source, target) {
    if (!source || !target) return;
    target.x = source.x;
    target.y = source.y;
    target.w = source.w;
    target.h = source.h;
    target.rotation = source.rotation || 0;
    if (supportsPlaneTilt(target)) {
      target.tiltX = source.tiltX || 0;
      target.tiltY = source.tiltY || 0;
    }
  }

  function moveSelectedToLayer(targetId) {
    var selected = getObject(state.selectedId);
    var target = getObject(targetId);
    if (!selected || !target || selected.id === target.id) return;
    if (selected.type !== "image" || selected.isPip) {
      setComposerStatus("Select an image layer first, then Move to another layer.");
      setTimeout(function () { setComposerStatus(""); }, 1800);
      return;
    }
    if (selected.locked) {
      setComposerStatus("Unlock the selected layer before moving it.");
      setTimeout(function () { setComposerStatus(""); }, 1800);
      return;
    }
    copyPoseFromTo(target, selected);
    invalidateWarpRasterCache(selected.id);
    renderObjects();
    composeMoment();
    panToLayer(selected.id);
    setComposerStatus("Moved to " + objectTypeLabel(target) + " position.");
    setTimeout(function () { setComposerStatus(""); }, 1800);
  }

  function replaceLayerImage(id, url, opts) {
    opts = opts || {};
    var obj = getObject(id);
    if (!obj || obj.type !== "image" || !url) return Promise.resolve(false);
    var prevUrl = stripImageRefreshParam(obj.url);
    delete state.imageLoadCache[prevUrl];
    delete state.imageLoadCache[stripImageRefreshParam(url)];
    if (opts.label) obj.label = opts.label;
    invalidateWarpRasterCache(obj.id);
    return validateImageUrl(url)
      .then(function (img) {
        obj.url = bustImageUrl(url, Date.now());
        obj.aspect = img.width / Math.max(img.height, 1);
        obj.loadFailed = false;
        normalizeImageDimensions(obj);
        renderObjects();
        composeMoment();
        return true;
      })
      .catch(function () {
        if (prevUrl && prevUrl !== stripImageRefreshParam(url)) {
          obj.url = prevUrl;
          obj.loadFailed = false;
          renderObjects();
          composeMoment();
        } else {
          removeEmptyLayer(id, { silent: true });
        }
        return false;
      });
  }

  function reloadLayerImage(id, url) {
    return replaceLayerImage(id, url, { loadFailed: false });
  }

  function regenerateLayer(id) {
    var obj = getObject(id);
    if (!obj || obj.type !== "image" || obj.isPip) return Promise.resolve();
    state.selectedId = id;
    renderObjects();
    if (window.FleetingWalk && window.FleetingWalk.regenerateLayer) {
      return window.FleetingWalk.regenerateLayer(id);
    }
    setComposerStatus("Regenerate unavailable — reload the page.");
    setTimeout(function () { setComposerStatus(""); }, 1800);
    return Promise.resolve();
  }

  function onSheetsPanelClick(e) {
    var actionBtn = e.target.closest(".fi-layer-card-action");
    if (!actionBtn) return;
    e.preventDefault();
    e.stopPropagation();
    var card = actionBtn.closest(".fi-sheet-card");
    var layerId = card && card.dataset.id;
    if (!layerId) return;
    var action = actionBtn.dataset.action;
    if (action === "goto") panToLayer(layerId);
    else if (action === "moveto") moveSelectedToLayer(layerId);
    else if (action === "regenerate") regenerateLayer(layerId);
  }

  function renderSheetsPanel() {
    var list = $("fi-sheets-list");
    var countEl = $("fi-sheets-count");
    var emptyEl = $("fi-sheets-empty");
    if (!list) return;
    var layers = sortedObjects().slice().reverse();
    if (countEl) countEl.textContent = String(layers.length);
    if (emptyEl) emptyEl.hidden = layers.length > 0;
    list.innerHTML = "";
    var selected = getObject(state.selectedId);
    var showMoveTo = !!(selected && selected.type === "image" && !selected.isPip);
    layers.forEach(function (obj) {
      var card = document.createElement("div");
      card.className =
        "fi-sheet-card fi-layer-card fi-layer-" + obj.type +
        (obj.id === state.selectedId ? " selected" : "") +
        (obj.locked ? " locked" : "");
      card.dataset.id = obj.id;
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", obj.id === state.selectedId ? "true" : "false");
      card.title = "Drag to reorder · " + objectTypeLabel(obj);
      var thumbHtml = "";
      if (obj.type === "image") {
        thumbHtml = '<img src="' + obj.url + '" alt="" draggable="false" crossorigin="anonymous" />';
      } else if (obj.type === "stencil") {
        thumbHtml = '<span class="fi-layer-stencil-glyph">' + escapeHtml(obj.letter || state.letter) + "</span>";
      } else if (obj.type === "textbox") {
        thumbHtml = '<span class="fi-layer-text-preview">' + escapeHtml(obj.text || "Your text") + "</span>";
      }
      var typeTag = obj.isPip ? "pip" : obj.type === "image" ? "vision" : obj.type === "stencil" ? "stencil" : "text";
      var moveToBtn =
        showMoveTo && obj.id !== state.selectedId
          ? '<button type="button" class="fi-layer-card-action" data-action="moveto" title="Move selected image to this layer\'s position">Move to</button>'
          : "";
      var regenBtn = layerShowsRegenerate(obj)
        ? '<button type="button" class="fi-layer-card-action fi-layer-card-regen" data-action="regenerate" title="Reload or regenerate this image">Regenerate</button>'
        : "";
      card.innerHTML =
        '<span class="fi-sheet-card-grip" aria-hidden="true">⋮⋮</span>' +
        '<div class="fi-sheet-card-thumb">' + thumbHtml + "</div>" +
        '<div class="fi-sheet-card-meta">' +
        '<span class="fi-sheet-card-label">' + escapeHtml(objectTypeLabel(obj)) +
        (obj.locked ? '<span class="fi-sheet-card-lock" title="Locked">🔒</span>' : "") +
        "</span>" +
        '<span class="fi-sheet-card-layer">' + typeTag + " · L" + (obj.zIndex || "?") + "</span>" +
        "</div>" +
        '<div class="fi-sheet-card-actions">' +
        '<button type="button" class="fi-layer-card-action" data-action="goto" title="Pan OHP to this layer">Go to</button>' +
        moveToBtn +
        regenBtn +
        "</div>";
      list.appendChild(card);
    });
  }

  function buildLatticeHandles(lattice) {
    var handles = "";
    LATTICE_HANDLE_INDICES.forEach(function (i) {
      handles +=
        '<div class="fi-corner-handle fi-lattice-handle" data-action="corner-drag" data-corner="' + i +
        '" title="Drag to curve-warp the acetate"></div>';
    });
    return (
      latticeGridSvg(lattice, false) +
      '<div class="fi-corner-handles">' + handles + "</div>"
    );
  }

  function buildPlaneTiltHandles() {
    var specs = ["tl", "tr", "br", "bl"];
    var handles = specs
      .map(function (corner) {
        return (
          '<div class="fi-corner-handle fi-tilt-handle" data-action="tilt-drag" data-corner="' + corner +
          '" title="Drag to tilt on the table"></div>'
        );
      })
      .join("");
    return '<div class="fi-corner-handles fi-plane-tilt-handles">' + handles + "</div>";
  }

  function buildEdgeStretchHandles(obj) {
    var isText = obj && obj.type === "textbox";
    var edges = [
      {
        edge: "top",
        label: "↕",
        title: isText ? "Drag to scale text height" : "Drag to resize height",
      },
      {
        edge: "bottom",
        label: "↕",
        title: isText ? "Drag to scale text height" : "Drag to resize height",
      },
      {
        edge: "left",
        label: "↔",
        title: isText ? "Drag to scale text width" : "Drag to resize width",
      },
      {
        edge: "right",
        label: "↔",
        title: isText ? "Drag to scale text width" : "Drag to resize width",
      },
    ];
    var handles = edges
      .map(function (spec) {
        var axis = spec.edge === "top" || spec.edge === "bottom" ? "fi-edge-ns" : "fi-edge-ew";
        return (
          '<div class="fi-edge-handle ' + axis + '" data-action="stretch-drag" data-edge="' + spec.edge +
          '" title="' + spec.title + '"><span aria-hidden="true">' + spec.label + "</span></div>"
        );
      })
      .join("");
    return '<div class="fi-edge-handles">' + handles + "</div>";
  }

  function buildClipEdgeSvg() {
    return (
      '<svg class="fi-clip-edge" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<polygon fill="none" stroke="#000" stroke-width="1" vector-effect="non-scaling-stroke"></polygon>' +
      "</svg>"
    );
  }

  function buildHandles(obj) {
    var delLabel =
      obj.type === "stencil" ? "Remove stencil" : obj.type === "textbox" ? "Remove text box" : "Remove sheet";
    var corners = supportsPlaneTilt(obj) ? buildPlaneTiltHandles() : "";
    var edges = supportsEdgeStretch(obj) ? buildEdgeStretchHandles(obj) : "";
    return (
      '<div class="fi-pose-handles">' +
      '<button type="button" class="fi-handle fi-handle-delete" data-action="delete" title="' + delLabel + '">×</button>' +
      '<button type="button" class="fi-handle" data-action="front" title="Bring forward">↑</button>' +
      '<button type="button" class="fi-handle" data-action="back" title="Send backward">↓</button>' +
      '<button type="button" class="fi-handle" data-action="rot-left" title="Rotate left">↺</button>' +
      '<button type="button" class="fi-handle" data-action="rot-right" title="Rotate right">↻</button>' +
      '<button type="button" class="fi-handle" data-action="scale" title="Larger">+</button>' +
      '<button type="button" class="fi-handle" data-action="shrink" title="Smaller">−</button>' +
      "</div>" +
      corners +
      edges +
      '<div class="fi-rotate-arm" data-action="rotate-drag" title="Drag to rotate"><span class="fi-rotate-knob"></span></div>' +
      '<div class="fi-scale-arm" data-action="scale-drag" title="Drag to scale"><span class="fi-scale-knob"></span></div>'
    );
  }

  function focusTextBoxEditor(inner, selectAll) {
    if (!inner) return;
    inner.focus();
    if (!selectAll) return;
    try {
      var range = document.createRange();
      range.selectNodeContents(inner);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (err) {}
  }

  function textBoxCanEdit(obj) {
    return (
      obj &&
      obj.type === "textbox" &&
      obj.id === state.selectedId &&
      state.tool !== "draw" &&
      state.tool !== "lasso"
    );
  }

  function bindTextBoxEditor(el, obj) {
    var inner = el.querySelector(".fi-textbox-inner");
    if (!inner) return;
    ensureTextBoxLayout(obj);
    applyTextBoxStyles(el, obj);
    inner.contentEditable = textBoxCanEdit(obj) ? "true" : "false";
    if (!inner.dataset.bound) {
      inner.dataset.bound = "1";
      inner.addEventListener("focus", function () {
        if (inner.classList.contains("is-placeholder")) {
          inner.classList.remove("is-placeholder");
          inner.textContent = "";
        }
      });
      inner.addEventListener("blur", function () {
        if (state.textBoxGesture || state.tiltDrag || state.stretchDrag) return;
        var val = readTextBoxInnerText(inner);
        if (!val.trim()) {
          inner.classList.add("is-placeholder");
          inner.textContent = "Your text";
          obj.text = "";
        } else {
          inner.classList.remove("is-placeholder");
          obj.text = val;
        }
        invalidateWarpRasterCache(obj.id);
        composeMoment();
        renderSheetsPanel();
      });
      inner.addEventListener("input", function () {
        if (inner.classList.contains("is-placeholder")) return;
        obj.text = readTextBoxInnerText(inner);
        obj.fitToText = false;
        invalidateWarpRasterCache(obj.id);
        renderSheetsPanel();
      });
      inner.addEventListener("keydown", function (e) {
        e.stopPropagation();
      });
    }
    if (state.focusTextId === obj.id) {
      requestAnimationFrame(function () {
        focusTextBoxEditor(inner, inner.classList.contains("is-placeholder"));
      });
    }
  }

  function renderObjects() {
    cullBlankImageLayersSync();
    state._renderDepth = (state._renderDepth || 0) + 1;
    syncAllTextBoxesFromDom();
    var layer = $("fi-objects-layer");
    if (!layer) {
      state._renderDepth = Math.max(0, state._renderDepth - 1);
      return;
    }
    layer.innerHTML = "";
    var textLayer = $("fi-text-layer");
    if (textLayer) textLayer.innerHTML = "";
    sortedObjects().forEach(function (obj) {
      var el = document.createElement("div");
      var typeClass =
        obj.type === "stencil"
          ? "fi-stencil-object"
          : obj.type === "textbox"
            ? "fi-textbox-object"
            : "fi-image-object fi-acetate";
      el.className = "fi-pose-object " + typeClass + (obj.isPip ? " fi-pip-layer" : "");
      el.dataset.id = obj.id;
      el.dataset.type = obj.type;
      var clipEdge = obj.clipPath && obj.clipEdge ? buildClipEdgeSvg() : "";
      if (obj.type === "stencil") {
        normalizePlaneObject(obj);
        var glyph = obj.letter || state.letter;
        el.dataset.letter = glyph;
        el.innerHTML =
          '<div class="fi-plane-tilt-stage"><div class="fi-pose-inner fi-stencil-inner"><span class="fi-stencil-glyph">' + glyph + "</span></div></div>" +
          clipEdge +
          '<span class="fi-pose-tag">stencil ' + glyph + "</span>" +
          (obj.id === state.selectedId ? buildHandles(obj) : "");
      } else if (obj.type === "textbox") {
        normalizeTextBoxObject(obj);
        ensureTextBoxLayout(obj);
        var textInner = !obj.text
          ? '<div class="fi-plane-tilt-stage fi-textbox-tilt-stage"><div class="fi-pose-inner fi-textbox-inner is-placeholder" contenteditable="false" spellcheck="false" data-placeholder="Your text">Your text</div></div>'
          : '<div class="fi-plane-tilt-stage fi-textbox-tilt-stage"><div class="fi-pose-inner fi-textbox-inner" contenteditable="false" spellcheck="false">' + textBoxHtmlFromText(obj.text) + "</div></div>";
        if (obj.justAdded) el.classList.add("just-added");
        el.innerHTML =
          textInner +
          clipEdge +
          '<span class="fi-pose-tag" title="Drag to move">text box</span>' +
          (obj.id === state.selectedId ? buildHandles(obj) : "");
      } else {
        normalizePlaneObject(obj);
        el.innerHTML =
          '<div class="fi-plane-tilt-stage"><div class="fi-pose-inner"><img src="' + obj.url + '" alt="" draggable="false" crossorigin="anonymous" /></div></div>' +
          clipEdge +
          '<span class="fi-pose-tag">' + (obj.isPip ? "pip" : obj.label || "sheet") + "</span>" +
          (obj.id === state.selectedId ? buildHandles(obj) : "");
      }
      applyObjectTransform(el, obj);
      if (obj.type === "textbox") bindTextBoxEditor(el, obj);
      if (obj.type === "image") {
        var imgEl = el.querySelector("img");
        if (imgEl) {
          imgEl.onerror = function () {
            requestRemoveEmptyLayer(obj.id);
            requestAnimationFrame(function () {
              if (flushPendingLayerRemovals({ silent: true })) renderObjects();
            });
          };
          imgEl.onload = function () {
            if (imageLayerLooksEmpty(obj)) {
              requestRemoveEmptyLayer(obj.id);
              requestAnimationFrame(function () {
                if (flushPendingLayerRemovals({ silent: true })) renderObjects();
              });
            } else {
              obj.loadFailed = false;
            }
          };
        }
      }
      layer.appendChild(el);
    });
    state.objects.filter(function (o) { return o.type === "textbox"; }).forEach(function (obj) {
      ensureTextBoxLayout(obj);
      var tbEl = document.querySelector('.fi-textbox-object[data-id="' + obj.id + '"]');
      if (!tbEl) return;
      applyObjectTransform(tbEl, obj);
      if (obj.justAdded && obj.fitToText !== false) {
        applyTextBoxStyles(tbEl, obj);
        fitTextBoxToContent(obj, tbEl, { preserveCenter: true });
        obj.justAdded = false;
        obj.fitToText = false;
      }
    });
    updateHud();
    renderSheetsPanel();
    var mount = $("fi-acetate-mount");
    if (mount) mount.classList.toggle("has-active-layer", !!state.selectedId);
    syncDomainChrome();
    updateLockButton();
    flushPendingLayerRemovals({ silent: true });
    state._renderDepth = Math.max(0, state._renderDepth - 1);
    if (state._renderDepth === 0) scheduleImageLayerAudit();
  }

  function glassPoint(clientX, clientY) {
    var canvas = $("fi-stage-canvas");
    if (!canvas) return { x: 0, y: 0, px: 0, py: 0, w: 1, h: 1 };
    var rect = canvas.getBoundingClientRect();
    var px = clientX - rect.left;
    var py = clientY - rect.top;
    return { x: (px / rect.width) * 100, y: (py / rect.height) * 100, px: px, py: py, w: rect.width, h: rect.height };
  }

  function canvasPoint(clientX, clientY, rectOverride) {
    var rect = rectOverride || acetateBedRect();
    var px = clientX - rect.left;
    var py = clientY - rect.top;
    return { x: (px / rect.width) * 100, y: (py / rect.height) * 100, px: px, py: py, w: rect.width, h: rect.height };
  }

  function objectRectPx(obj, rect) {
    return {
      left: (obj.x / 100) * rect.width,
      top: (obj.y / 100) * rect.height,
      width: (obj.w / 100) * rect.width,
      height: (obj.h / 100) * rect.height,
    };
  }

  function hitTestLayer(px, py, rect) {
    var sorted = sortedObjects()
      .filter(function (o) { return o.type === "image" || o.type === "stencil" || o.type === "textbox"; })
      .reverse();
    for (var i = 0; i < sorted.length; i++) {
      var box = objectRectPx(sorted[i], rect);
      if (px >= box.left && px <= box.left + box.width && py >= box.top && py <= box.top + box.height) {
        return sorted[i].id;
      }
    }
    return null;
  }

  function layerSupportsLasso(obj) {
    return obj && (obj.type === "image" || obj.type === "stencil" || obj.type === "textbox");
  }

  function lassoSubmitChecked() {
    var cb = $("fi-lasso-submit");
    return cb ? !!cb.checked : false;
  }

  function imageHasVisibleInk(img, opts) {
    opts = opts || {};
    var sampleMax = opts.sampleMax || 80;
    var minRatio = opts.minRatio || 0.0025;
    if (!img) return false;
    var iw = img.naturalWidth || img.width || 0;
    var ih = img.naturalHeight || img.height || 0;
    if (iw < 2 || ih < 2) return false;
    var w = Math.min(sampleMax, iw);
    var h = Math.max(4, Math.round(ih * (w / Math.max(iw, 1))));
    w = Math.max(4, w);
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d");
    if (!ctx) return false;
    try {
      ctx.drawImage(img, 0, 0, w, h);
    } catch (err) {
      return false;
    }
    var data = ctx.getImageData(0, 0, w, h).data;
    var total = w * h;
    var substantive = 0;
    for (var i = 0; i < data.length; i += 4) {
      var r = data[i];
      var g = data[i + 1];
      var b = data[i + 2];
      var a = data[i + 3];
      if (a <= 10) continue;
      var lum = r * 0.299 + g * 0.587 + b * 0.114;
      if (lum < 245 || r < 248 || g < 248 || b < 248) substantive++;
    }
    return substantive / total >= minRatio;
  }

  function validateLoadedImage(img) {
    if (!img || !(img.naturalWidth || img.width) || !(img.naturalHeight || img.height)) {
      return Promise.reject(new Error("Image has no pixels."));
    }
    if (!imageHasVisibleInk(img)) {
      return Promise.reject(new Error("Image is blank."));
    }
    return Promise.resolve(img);
  }

  function validateImageUrl(url) {
    return loadImage(url).then(validateLoadedImage);
  }

  function cullBlankImageLayersSync() {
    var sel = state.selectedId;
    var removed = 0;
    state.objects = state.objects.filter(function (o) {
      if (o.type !== "image") return true;
      if (!o.url || !String(o.url).trim() || o.loadFailed) {
        if (o.isPip) state.pipLayerId = null;
        removed++;
        return false;
      }
      return true;
    });
    if (removed > 0) {
      if (sel && !getObject(sel)) state.selectedId = null;
      normalizeZ();
    }
    return removed;
  }

  function requestRemoveEmptyLayer(id) {
    if (!id || !getObject(id)) return;
    if (state._pendingLayerRemovals.indexOf(id) < 0) state._pendingLayerRemovals.push(id);
  }

  function flushPendingLayerRemovals(opts) {
    opts = opts || {};
    var ids = state._pendingLayerRemovals.slice();
    state._pendingLayerRemovals = [];
    if (!ids.length) return 0;
    var idSet = {};
    ids.forEach(function (id) {
      var obj = getObject(id);
      if (!obj || obj.type !== "image") return;
      idSet[id] = true;
      if (obj.isPip) state.pipLayerId = null;
      if (state.selectedId === id) state.selectedId = null;
      invalidateWarpRasterCache(id);
      if (obj.url) delete state.imageLoadCache[stripImageRefreshParam(obj.url)];
    });
    var removed = Object.keys(idSet).length;
    if (!removed) return 0;
    state.objects = state.objects.filter(function (o) { return !idSet[o.id]; });
    normalizeZ();
    if (!opts.silent) {
      setComposerStatus("Removed " + removed + " blank layer" + (removed === 1 ? "" : "s") + ".");
      setTimeout(function () { setComposerStatus(""); }, 1800);
    }
    return removed;
  }

  function scheduleImageLayerAudit() {
    if (state._imageAuditTimer) clearTimeout(state._imageAuditTimer);
    state._imageAuditTimer = setTimeout(function () {
      state._imageAuditTimer = null;
      var gen = (state._imageAuditGen || 0) + 1;
      state._imageAuditGen = gen;
      var images = state.objects.filter(function (o) {
        return o.type === "image" && o.url;
      });
      if (!images.length) return;
      Promise.all(
        images.map(function (obj) {
          return validateImageUrl(obj.url).then(function () {
            return null;
          }).catch(function () {
            return obj.id;
          });
        })
      ).then(function (results) {
        if (state._imageAuditGen !== gen) return;
        results.forEach(function (id) {
          if (id) requestRemoveEmptyLayer(id);
        });
        if (state._pendingLayerRemovals.length) {
          flushPendingLayerRemovals({ silent: true });
          if (!state._renderDepth) renderObjects();
          else composeMoment();
        }
      });
    }, 60);
  }

  function enforceNoBlankImageLayers(opts) {
    opts = opts || {};
    cullBlankImageLayersSync();
    var images = state.objects.filter(function (o) {
      return o.type === "image" && o.url;
    });
    images.forEach(function (obj) {
      var el = document.querySelector('.fi-image-object[data-id="' + obj.id + '"] img');
      if (el && el.complete && imageLayerLooksEmpty(obj)) requestRemoveEmptyLayer(obj.id);
    });
    var flushed = flushPendingLayerRemovals({ silent: true });
    if (!opts.syncOnly) scheduleImageLayerAudit();
    return flushed;
  }

  function removeEmptyLayer(id, opts) {
    opts = opts || {};
    requestRemoveEmptyLayer(id);
    var removed = flushPendingLayerRemovals({ silent: opts.silent });
    if (removed && !state._renderDepth) {
      renderObjects();
    } else if (removed) {
      composeMoment();
    }
    return removed > 0;
  }

  function purgeEmptyImageLayers(opts) {
    opts = opts || {};
    cullBlankImageLayersSync();
    state.objects.forEach(function (o) {
      if (o.type === "image" && imageLayerLooksEmpty(o)) requestRemoveEmptyLayer(o.id);
    });
    var removed = flushPendingLayerRemovals({ silent: opts.silent });
    if (!opts.silent && removed > 0) {
      setComposerStatus("Removed " + removed + " blank layer" + (removed === 1 ? "" : "s") + ".");
      setTimeout(function () { setComposerStatus(""); }, 2000);
    }
    if (!opts.syncOnly) scheduleImageLayerAudit();
    if (removed && !state._renderDepth) renderObjects();
    return removed;
  }

  function loadImage(url) {
    if (state.imageLoadCache[url]) return state.imageLoadCache[url];
    state.imageLoadCache[url] = new Promise(function (resolve, reject) {
      var img = new Image();
      try {
        if (new URL(url, location.href).origin !== location.origin) img.crossOrigin = "anonymous";
      } catch (e) {
        if (url.indexOf("data:") !== 0 && url.indexOf("blob:") !== 0) img.crossOrigin = "anonymous";
      }
      img.onload = function () {
        if (!(img.naturalWidth || img.width) || !(img.naturalHeight || img.height)) {
          delete state.imageLoadCache[url];
          reject(new Error("Image has no pixels."));
          return;
        }
        resolve(img);
      };
      img.onerror = function () {
        delete state.imageLoadCache[url];
        reject(new Error("Could not load image"));
      };
      img.src = url;
    });
    return state.imageLoadCache[url];
  }

  function buildEdgeMap(img) {
    var maxDim = 320;
    var scale = Math.min(1, maxDim / Math.max(img.width, img.height, 1));
    var w = Math.max(8, Math.round(img.width * scale));
    var h = Math.max(8, Math.round(img.height * scale));
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h).data;
    var gray = new Float32Array(w * h);
    var i, gx, gy, mag;
    for (i = 0; i < w * h; i++) {
      gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    }
    var edges = new Float32Array(w * h);
    var maxMag = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        i = y * w + x;
        gx =
          -gray[i - w - 1] + gray[i - w + 1] +
          -2 * gray[i - 1] + 2 * gray[i + 1] +
          -gray[i + w - 1] + gray[i + w + 1];
        gy =
          -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
          gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
        mag = Math.sqrt(gx * gx + gy * gy);
        edges[i] = mag;
        if (mag > maxMag) maxMag = mag;
      }
    }
    return { edges: edges, w: w, h: h, maxMag: maxMag || 1 };
  }

  function rasterizeForLasso(obj, maxDim) {
    maxDim = maxDim || 400;
    var aspect = Math.max(obj.w, 1) / Math.max(obj.h, 1);
    var w = aspect >= 1 ? maxDim : Math.round(maxDim * aspect);
    var h = aspect >= 1 ? Math.round(maxDim / aspect) : maxDim;
    w = Math.max(32, w);
    h = Math.max(32, h);
    if (obj.type === "image" && obj.url) {
      return loadImage(obj.url).then(function (img) {
        var c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        return c;
      });
    }
    return rasterForWarp(obj, w, h);
  }

  function getEdgeMapForObject(obj) {
    if (!layerSupportsLasso(obj)) return Promise.resolve(null);
    if (state.edgeCache[obj.id]) return Promise.resolve(state.edgeCache[obj.id]);
    return rasterizeForLasso(obj, 320).then(function (canvas) {
      var map = buildEdgeMap(canvas);
      state.edgeCache[obj.id] = map;
      return map;
    }).catch(function () { return null; });
  }

  function snapCanvasPointToEdge(px, py, obj, edgeMap, rect, prevPt) {
    if (!edgeMap || !obj) return { x: px, y: py };
    var box = objectRectPx(obj, rect);
    var lx = ((px - box.left) / box.width) * edgeMap.w;
    var ly = ((py - box.top) / box.height) * edgeMap.h;
    var bestX = px;
    var bestY = py;
    var best = 0;
    var thr = edgeMap.maxMag * EDGE_THRESHOLD;
    var nx = 0;
    var ny = 0;
    if (prevPt) {
      var dxs = px - prevPt.x;
      var dys = py - prevPt.y;
      var len = Math.hypot(dxs, dys) || 1;
      nx = -dys / len;
      ny = dxs / len;
    }
    var rings = prevPt ? [0, 4, 8, 12, 16, 20] : [0, 3, 6, 9, 12];
    for (var ri = 0; ri < rings.length; ri++) {
      var ring = rings[ri];
      for (var ai = 0; ai < 16; ai++) {
        var ang = (ai / 16) * Math.PI * 2;
        var ox = Math.cos(ang) * ring;
        var oy = Math.sin(ang) * ring;
        if (prevPt && ring > 0) {
          ox += nx * ring * 0.65;
          oy += ny * ring * 0.65;
        }
        var sx = Math.round(lx + ox);
        var sy = Math.round(ly + oy);
        if (sx < 0 || sy < 0 || sx >= edgeMap.w || sy >= edgeMap.h) continue;
        var m = edgeMap.edges[sy * edgeMap.w + sx];
        if (m > best && m >= thr) {
          best = m;
          bestX = box.left + (sx / edgeMap.w) * box.width;
          bestY = box.top + (sy / edgeMap.h) * box.height;
        }
      }
    }
    return { x: bestX, y: bestY };
  }

  function getPixelDataForObject(obj) {
    if (!layerSupportsLasso(obj)) return Promise.resolve(null);
    var cacheKey = obj.id + "-px";
    if (state.edgeCache[cacheKey]) return Promise.resolve(state.edgeCache[cacheKey]);
    return rasterizeForLasso(obj, 400).then(function (canvas) {
      var w = canvas.width;
      var h = canvas.height;
      var data = canvas.getContext("2d").getImageData(0, 0, w, h);
      state.edgeCache[cacheKey] = { data: data, w: w, h: h };
      return state.edgeCache[cacheKey];
    }).catch(function () { return null; });
  }

  function colorDist(r1, g1, b1, r2, g2, b2) {
    return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
  }

  function floodFillContour(px, py, obj, pixelData, rect) {
    if (!pixelData || !obj) return null;
    var box = objectRectPx(obj, rect);
    var lx = Math.round(((px - box.left) / box.width) * pixelData.w);
    var ly = Math.round(((py - box.top) / box.height) * pixelData.h);
    if (lx < 0 || ly < 0 || lx >= pixelData.w || ly >= pixelData.h) return null;
    var data = pixelData.data.data;
    var w = pixelData.w;
    var h = pixelData.h;
    var si = (ly * w + lx) * 4;
    var sr = data[si];
    var sg = data[si + 1];
    var sb = data[si + 2];
    var mask = new Uint8Array(w * h);
    var stack = [[lx, ly]];
    var visited = 0;
    var maxVisit = w * h * 0.45;
    while (stack.length && visited < maxVisit) {
      var pt = stack.pop();
      var x = pt[0];
      var y = pt[1];
      var i = y * w + x;
      if (x < 0 || y < 0 || x >= w || y >= h || mask[i]) continue;
      var pi = i * 4;
      if (colorDist(data[pi], data[pi + 1], data[pi + 2], sr, sg, sb) > FLOOD_TOLERANCE) continue;
      mask[i] = 1;
      visited += 1;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    if (visited < 80) return null;
    var contour = [];
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var idx = y * w + x;
        if (!mask[idx]) continue;
        var border =
          !mask[idx - 1] || !mask[idx + 1] || !mask[idx - w] || !mask[idx + w];
        if (border) {
          contour.push({
            x: box.left + (x / w) * box.width,
            y: box.top + (y / h) * box.height,
          });
        }
      }
    }
    if (contour.length < 12) return null;
    var step = Math.max(1, Math.floor(contour.length / 80));
    var sampled = [];
    for (var ci = 0; ci < contour.length; ci += step) sampled.push(contour[ci]);
    return sampled.length >= 3 ? sampled : null;
  }

  function simplifyPoints(points, minDist) {
    if (points.length < 3) return points;
    var out = [points[0]];
    for (var i = 1; i < points.length; i++) {
      var prev = out[out.length - 1];
      if (Math.hypot(points[i].x - prev.x, points[i].y - prev.y) >= minDist) out.push(points[i]);
    }
    if (out.length < 2 && points.length) out.push(points[points.length - 1]);
    return out;
  }

  function pathLength(points) {
    var len = 0;
    for (var i = 1; i < points.length; i++) {
      len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return len;
  }

  function rdpPerpendicularDistance(point, lineStart, lineEnd) {
    var dx = lineEnd.x - lineStart.x;
    var dy = lineEnd.y - lineStart.y;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
    }
    var t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    var px = lineStart.x + t * dx;
    var py = lineStart.y + t * dy;
    return Math.hypot(point.x - px, point.y - py);
  }

  function rdpSimplify(points, epsilon) {
    if (points.length < 3) return points.slice();
    var first = points[0];
    var last = points[points.length - 1];
    var index = -1;
    var distMax = 0;
    for (var i = 1; i < points.length - 1; i++) {
      var dist = rdpPerpendicularDistance(points[i], first, last);
      if (dist > distMax) {
        distMax = dist;
        index = i;
      }
    }
    if (distMax > epsilon) {
      var left = rdpSimplify(points.slice(0, index + 1), epsilon);
      var right = rdpSimplify(points.slice(index), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  }

  function smoothLassoPath(points) {
    if (points.length < 3) return points.slice();
    var simplified = rdpSimplify(points, LASSO_RDP_EPSILON);
    if (simplified.length < 3) simplified = simplifyPoints(points, 8);
    if (simplified[simplified.length - 1] !== points[points.length - 1]) {
      simplified.push(points[points.length - 1]);
    }
    return simplified;
  }

  function setTool(tool) {
    var prevTool = state.tool;
    if (prevTool === "draw" && tool !== "draw") {
      var inkTarget = drawTargetObject();
      var committed = finalizeDrawSession();
      if (committed) {
        setComposerStatus(
          inkTarget
            ? "Ink saved as a layer above " + objectTypeLabel(inkTarget) + "."
            : "Drawing saved as acetate layer."
        );
        setTimeout(function () { setComposerStatus(""); }, 2000);
      }
    }
    state.tool = tool;
    state.smartLasso = tool === "lasso";
    document.querySelectorAll(".fi-tool-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
    var canvas = $("fi-stage-canvas");
    if (canvas) {
      canvas.classList.toggle("tool-lasso", tool === "lasso");
      canvas.classList.toggle("tool-move", tool === "move");
    }
    var drawPanel = $("fi-draw-panel");
    if (drawPanel) drawPanel.hidden = tool !== "draw";
    var building = $("fi-building-viewport");
    if (building) {
      building.classList.toggle("tool-draw", tool === "draw");
      building.classList.toggle("tool-lasso", tool === "lasso");
      building.classList.toggle("tool-move", tool === "move");
    }
    if (tool === "draw") {
      initDrawCanvas();
      readBrushFromUi();
      ensureDrawTargetLayer();
      var mount = $("fi-acetate-mount");
      if (mount) mount.classList.add("is-draw-mode");
      var canvas = $("fi-draw-canvas");
      if (canvas) canvas.classList.add("is-active");
      var inkTarget = drawTargetObject();
      if (inkTarget) {
        setComposerStatus("Drawing on top of " + objectTypeLabel(inkTarget) + " — switch tools to save ink as a layer.");
        setTimeout(function () { setComposerStatus(""); }, 2800);
      } else {
        setComposerStatus("Add a layer on the glass first, then draw on top of it.");
        setTimeout(function () { setComposerStatus(""); }, 2800);
      }
    } else {
      state.drawTargetId = null;
      var mountOff = $("fi-acetate-mount");
      if (mountOff) mountOff.classList.remove("is-draw-mode");
      var canvasOff = $("fi-draw-canvas");
      if (canvasOff) {
        canvasOff.classList.remove("is-active", "is-drawing");
      }
    }
    document.querySelectorAll(".fi-textbox-object .fi-textbox-inner").forEach(function (inner) {
      inner.contentEditable = "false";
    });
    updateHud();
  }

  function submitLassoCut(obj, clipPath, rect) {
    var pts = parseClipPctPoints(clipPath);
    if (pts.length < 3) return Promise.resolve();
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    pts.forEach(function (p) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    var box = objectRectPx(obj, rect);
    var cutLeft = box.left + (minX / 100) * box.width;
    var cutTop = box.top + (minY / 100) * box.height;
    var cutW = Math.max(4, ((maxX - minX) / 100) * box.width);
    var cutH = Math.max(4, ((maxY - minY) / 100) * box.height);
    var srcW = Math.max(32, Math.round(box.width));
    var srcH = Math.max(32, Math.round(box.height));
    var outW = Math.max(8, Math.round(cutW));
    var outH = Math.max(8, Math.round(cutH));
    return rasterizeForLasso(obj, Math.max(srcW, srcH)).then(function (source) {
      var srcCanvas = source;
      if (!(source instanceof HTMLCanvasElement)) {
        srcCanvas = document.createElement("canvas");
        srcCanvas.width = srcW;
        srcCanvas.height = srcH;
        srcCanvas.getContext("2d").drawImage(source, 0, 0, srcW, srcH);
      } else if (source.width !== srcW || source.height !== srcH) {
        var scaled = document.createElement("canvas");
        scaled.width = srcW;
        scaled.height = srcH;
        scaled.getContext("2d").drawImage(source, 0, 0, srcW, srcH);
        srcCanvas = scaled;
      }
      var out = document.createElement("canvas");
      out.width = outW;
      out.height = outH;
      var ctx = out.getContext("2d");
      ctx.beginPath();
      pts.forEach(function (p, idx) {
        var lx = (p.x / 100) * srcW - (minX / 100) * srcW;
        var ly = (p.y / 100) * srcH - (minY / 100) * srcH;
        if (idx === 0) ctx.moveTo(lx, ly);
        else ctx.lineTo(lx, ly);
      });
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(srcCanvas, -(minX / 100) * srcW, -(minY / 100) * srcH);
      var dataUrl = out.toDataURL("image/png");
      var id = uid("cut");
      var cutPct = pts.map(function (p) {
        var px = box.left + (p.x / 100) * box.width;
        var py = box.top + (p.y / 100) * box.height;
        var lx = ((px - cutLeft) / cutW) * 100;
        var ly = ((py - cutTop) / cutH) * 100;
        return Math.max(0, Math.min(100, lx)) + "% " + Math.max(0, Math.min(100, ly)) + "%";
      });
      if (!imageHasVisibleInk(out)) {
        setComposerStatus("Lasso cut was blank — nothing added.");
        setTimeout(function () { setComposerStatus(""); }, 1800);
        return;
      }
      var cutObj = {
        id: id,
        type: "image",
        url: dataUrl,
        label: "cut",
        paintingNum: null,
        x: (cutLeft / rect.width) * 100,
        y: (cutTop / rect.height) * 100,
        w: (cutW / rect.width) * 100,
        h: (cutH / rect.height) * 100,
        rotation: obj.rotation || 0,
        clipPath: "polygon(" + cutPct.join(", ") + ")",
        clipEdge: true,
        corners: defaultCorners(),
        zIndex: 0,
        bedCoords: true,
      };
      validateImageUrl(dataUrl).then(function () {
        assignZ(cutObj);
        state.objects.push(cutObj);
        bringToFront(id);
        state.selectedId = id;
        renderObjects();
      }).catch(function () {
        setComposerStatus("Lasso cut was blank — nothing added.");
        setTimeout(function () { setComposerStatus(""); }, 1800);
      });
    }).catch(function () {});
  }

  function applyLassoToSelected(points, edgeMap) {
    if (!state.selectedId || points.length < 3) return;
    var obj = getObject(state.selectedId);
    if (!layerSupportsLasso(obj)) {
      setComposerStatus("Select a layer on the glass, then smart-lasso to cut.");
      setTimeout(function () { setComposerStatus(""); }, 1800);
      return;
    }
    var canvas = $("fi-stage-canvas");
    if (!canvas) return;
    var glassRect = canvas.getBoundingClientRect();
    var bedRect = acetateBedRect();
    var refined = smoothLassoPath(points);
    if (refined.length < 3) return;
    var box = objectRectPx(obj, bedRect);
    var pctPoints = refined.map(function (p) {
      var clientX = glassRect.left + p.x;
      var clientY = glassRect.top + p.y;
      var lx = ((clientX - bedRect.left - box.left) / Math.max(box.width, 1)) * 100;
      var ly = ((clientY - bedRect.top - box.top) / Math.max(box.height, 1)) * 100;
      return Math.max(0, Math.min(100, lx)) + "% " + Math.max(0, Math.min(100, ly)) + "%";
    });
    var clipPath = "polygon(" + pctPoints.join(", ") + ")";
    var submitCut = lassoSubmitChecked();
    var done = function () {
      renderObjects();
      composeMoment();
      if (state.selectedId) selectObject(state.selectedId, { scrollPanel: true, bringToFront: false });
      setComposerStatus(submitCut ? "Cut added to Layers — review on the glass." : "Outline applied on layer.");
      setTimeout(function () { setComposerStatus(""); }, 1600);
    };
    if (submitCut) {
      submitLassoCut(obj, clipPath, bedRect).then(function () {
        done();
      });
    } else {
      obj.clipPath = clipPath;
      obj.clipEdge = true;
      done();
    }
  }

  function clearLassoSvg() {
    var svg = $("fi-lasso-svg");
    if (svg) svg.innerHTML = "";
  }

  function drawLassoLine(points, closed) {
    var svg = $("fi-lasso-svg");
    if (!svg || points.length < 2) return;
    svg.innerHTML = "";
    var poly = document.createElementNS("http://www.w3.org/2000/svg", closed ? "polygon" : "polyline");
    poly.setAttribute("points", points.map(function (p) { return p.x + "," + p.y; }).join(" "));
    poly.setAttribute("class", "fi-lasso-line" + (closed ? " closed" : ""));
    svg.appendChild(poly);
  }

  function finishLasso() {
    if (!state.lasso) return;
    var pts = state.lasso.points.map(function (p) { return { x: p.px, y: p.py }; });
    var edgeMap = state.lasso.edgeMap;
    if (pts.length <= 3 && pathLength(pts) < 16 && state.lasso.pixelData) {
      var canvas = $("fi-stage-canvas");
      var glassRect = canvas ? canvas.getBoundingClientRect() : null;
      var bedRect = acetateBedRect();
      var sel = getObject(state.selectedId);
      if (glassRect && sel && layerSupportsLasso(sel)) {
        var seedBedPx = glassRect.left - bedRect.left + state.lasso.seedPx;
        var seedBedPy = glassRect.top - bedRect.top + state.lasso.seedPy;
        var floodPts = floodFillContour(seedBedPx, seedBedPy, sel, state.lasso.pixelData, bedRect);
        if (floodPts) {
          pts = smoothLassoPath(
            floodPts.map(function (p) {
              return { x: p.x - (glassRect.left - bedRect.left), y: p.y - (glassRect.top - bedRect.top) };
            })
          );
        }
      }
    }
    applyLassoToSelected(pts, edgeMap);
    state.lasso = null;
    clearLassoSvg();
  }

  function onPointerDown(e) {
    if (state.tool === "draw") return;
    if (!e.target.closest("#fi-workspace")) return;
    if (e.button === 1) {
      startViewPanDrag(e);
      return;
    }
    var canvas = $("fi-stage-canvas");
    if (!canvas) return;
    var bedRect = acetateBedRect();

    if (state.tool === "lasso") {
      if (e.target.closest(".fi-handle")) return;
      var pt0 = glassPoint(e.clientX, e.clientY);
      var rect = canvas.getBoundingClientRect();
      var hitId = hitTestLayer(e.clientX - bedRect.left, e.clientY - bedRect.top, bedRect);
      if (hitId) selectObject(hitId, { scrollPanel: true, bringToFront: false });
      var sel = getObject(state.selectedId);
      state.lasso = { points: [pt0], edgeMap: null, pixelData: null, seedPx: pt0.px, seedPy: pt0.py };
      if (sel && layerSupportsLasso(sel)) {
        getEdgeMapForObject(sel).then(function (map) {
          if (state.lasso) state.lasso.edgeMap = map;
        });
        getPixelDataForObject(sel).then(function (px) {
          if (state.lasso) state.lasso.pixelData = px;
        });
        setComposerStatus("Draw around the region — release for a smooth cut.");
      } else {
        setComposerStatus("Select a layer on the glass, then draw your cut.");
      }
      clearLassoSvg();
      if (canvas.setPointerCapture) try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      return;
    }

    var tiltHandle = e.target.closest('[data-action="tilt-drag"]');
    if (tiltHandle && state.selectedId) {
      var tb = getObject(state.selectedId);
      if (tb && tb.locked) {
        setComposerStatus("Layer is locked — unlock to tilt.");
        setTimeout(function () { setComposerStatus(""); }, 1400);
        return;
      }
      if (tb && supportsPlaneTilt(tb)) {
        if (tb.type === "textbox") syncTextBoxFromDom(tb);
        state.tiltDrag = {
          id: state.selectedId,
          corner: tiltHandle.dataset.corner || "tl",
          startTilt: { tiltX: tb.tiltX || 0, tiltY: tb.tiltY || 0 },
          startLocal: clientToLocalPercent(tb, e.clientX, e.clientY, bedRect),
        };
        setTiltDragChrome(true);
        e.preventDefault();
        return;
      }
    }

    var stretchHandle = e.target.closest('[data-action="stretch-drag"]');
    if (stretchHandle && state.selectedId) {
      var tx = getObject(state.selectedId);
      if (tx && tx.locked) {
        setComposerStatus("Layer is locked — unlock to stretch.");
        setTimeout(function () { setComposerStatus(""); }, 1400);
        return;
      }
      if (tx && supportsEdgeStretch(tx)) {
        if (tx.type === "textbox") syncTextBoxFromDom(tx);
        state.stretchDrag = {
          id: state.selectedId,
          edge: stretchHandle.dataset.edge || "right",
          startCanvas: canvasPoint(e.clientX, e.clientY, bedRect),
          origW: tx.w,
          origH: tx.h,
          origX: tx.x,
          origY: tx.y,
          origFontSize: tx.type === "textbox" ? (tx.fontSize || 4.2) : null,
        };
        setTiltDragChrome(true);
        e.preventDefault();
        return;
      }
    }

    var cornerHandle = e.target.closest('[data-action="corner-drag"]');
    if (cornerHandle && state.selectedId) {
      var co = getObject(state.selectedId);
      if (co && co.locked) {
        setComposerStatus("Layer is locked — unlock to reshape.");
        setTimeout(function () { setComposerStatus(""); }, 1400);
        return;
      }
      if (co && supportsWarp(co)) {
        var lattice = ensureLattice(co);
        var ci = parseInt(cornerHandle.dataset.corner, 10) || 0;
        var cpt = lattice[ci];
        state.cornerDrag = {
          id: state.selectedId,
          corner: ci,
          startCorner: { x: cpt.x, y: cpt.y },
          startLocal: clientToLocalPercent(co, e.clientX, e.clientY, bedRect),
        };
        var elWarp = document.querySelector('.fi-pose-object[data-id="' + co.id + '"]');
        if (elWarp) warmWarpRaster(co, elWarp);
        e.preventDefault();
        return;
      }
    }

    var scaleArm = e.target.closest('[data-action="scale-drag"]');
    if (scaleArm && state.selectedId) {
      var so = getObject(state.selectedId);
      if (so && so.locked) {
        setComposerStatus("Layer is locked — unlock to resize.");
        setTimeout(function () { setComposerStatus(""); }, 1400);
        return;
      }
      var spt = canvasPoint(e.clientX, e.clientY);
      var srect = bedRect;
      var sbox = objectRectPx(so, srect);
      var scx = sbox.left + sbox.width / 2;
      var scy = sbox.top + sbox.height / 2;
      var startDist = Math.hypot(spt.px - scx, spt.py - scy);
      state.scaleDrag = {
        id: state.selectedId,
        cx: scx,
        cy: scy,
        startDist: Math.max(startDist, 20),
        centerX: so.x + so.w / 2,
        centerY: so.y + so.h / 2,
        origW: so.w,
        origH: so.h,
        origX: so.x,
        origY: so.y,
        origFontSize: so.type === "textbox" ? (so.fontSize || 4.2) : null,
      };
      setTiltDragChrome(true);
      e.preventDefault();
      return;
    }

    var rotateArm = e.target.closest('[data-action="rotate-drag"]');
    if (rotateArm && state.selectedId) {
      var ro = getObject(state.selectedId);
      if (ro && ro.locked) {
        setComposerStatus("Layer is locked — unlock to rotate.");
        setTimeout(function () { setComposerStatus(""); }, 1400);
        return;
      }
      var rpt = canvasPoint(e.clientX, e.clientY);
      var rect = bedRect;
      var box = objectRectPx(ro, rect);
      var cx = box.left + box.width / 2;
      var cy = box.top + box.height / 2;
      state.rotateDrag = {
        id: state.selectedId,
        cx: cx,
        cy: cy,
        startAngle: Math.atan2(rpt.py - cy, rpt.px - cx) * (180 / Math.PI),
        origRotation: ro.rotation || 0,
      };
      e.preventDefault();
      return;
    }

    var handle = e.target.closest(".fi-handle");
    if (handle) {
      var obj = getObject(state.selectedId);
      if (!obj) return;
      if (obj.locked && handle.dataset.action !== "delete") {
        setComposerStatus("Layer is locked — unlock to edit.");
        setTimeout(function () { setComposerStatus(""); }, 1400);
        return;
      }
      var action = handle.dataset.action;
      if (action === "delete") deleteSelected();
      if (action === "front") bringForward(state.selectedId);
      if (action === "back") sendBackward(state.selectedId);
      if (action === "rot-left") obj.rotation = (obj.rotation || 0) - 15;
      if (action === "rot-right") obj.rotation = (obj.rotation || 0) + 15;
      if (action === "scale") {
        if (obj.type === "textbox") {
          var oldW = obj.w;
          var oldH = obj.h;
          obj.w = clampSizePercent(obj.w + 4);
          obj.h = clampSizePercent(obj.h + 4);
          scaleTextBoxByRatio(obj, Math.sqrt((obj.w / oldW) * (obj.h / oldH)));
        } else {
          obj.w = clampSizePercent(obj.w + 4);
          obj.h = clampSizePercent(obj.h + 4);
        }
      }
      if (action === "shrink") {
        if (obj.type === "textbox") {
          var oldWs = obj.w;
          var oldHs = obj.h;
          obj.w = clampSizePercent(obj.w - 4);
          obj.h = clampSizePercent(obj.h - 4);
          scaleTextBoxByRatio(obj, Math.sqrt((obj.w / oldWs) * (obj.h / oldHs)));
        } else {
          obj.w = clampSizePercent(obj.w - 4);
          obj.h = clampSizePercent(obj.h - 4);
        }
      }
      if (action !== "delete") {
        renderObjects();
        composeMoment();
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (e.target.closest(".fi-textbox-inner[contenteditable='true']")) {
      return;
    }

    var objEl = e.target.closest(".fi-pose-object");
    if (objEl) {
      var id = objEl.dataset.id;
      var o = getObject(id);
      if (!o) return;
      if (
        o.type === "textbox" &&
        state.tool === "move" &&
        !e.target.closest(".fi-pose-tag") &&
        !e.target.closest(".fi-handle") &&
        !e.target.closest(".fi-corner-handle") &&
        !e.target.closest(".fi-edge-handle") &&
        !e.target.closest(".fi-rotate-arm") &&
        !e.target.closest(".fi-scale-arm")
      ) {
        if (o.locked) {
          selectObject(id, { scrollPanel: true, bringToFront: false });
          setComposerStatus("Layer is locked — unlock to move.");
          setTimeout(function () { setComposerStatus(""); }, 1400);
          return;
        }
        syncTextBoxFromDom(o);
        var freshTb = objEl;
        if (state.selectedId !== id) {
          selectObject(id, { scrollPanel: true, bringToFront: false });
          freshTb = document.querySelector('.fi-pose-object[data-id="' + id + '"]');
        }
        if (freshTb && freshTb.setPointerCapture) try { freshTb.setPointerCapture(e.pointerId); } catch (err) {}
        var ptTb = canvasPoint(e.clientX, e.clientY);
        state.textBoxGesture = {
          id: id,
          startClientX: e.clientX,
          startClientY: e.clientY,
          moved: false,
          origX: o.x,
          origY: o.y,
          startCanvas: { x: ptTb.x, y: ptTb.y },
          bedRect: bedRect,
        };
        e.preventDefault();
        return;
      }
      if (o.locked && state.tool === "move") {
        selectObject(id, { scrollPanel: true, bringToFront: false });
        setComposerStatus("Layer is locked — unlock to move.");
        setTimeout(function () { setComposerStatus(""); }, 1400);
        return;
      }
      selectObject(id, { scrollPanel: true, bringToFront: false });
      var freshEl = document.querySelector('.fi-pose-object[data-id="' + id + '"]');
      if (freshEl && freshEl.setPointerCapture) try { freshEl.setPointerCapture(e.pointerId); } catch (err) {}
      var pt = canvasPoint(e.clientX, e.clientY);
      state.drag = {
        id: id,
        startX: pt.x,
        startY: pt.y,
        origX: o.x,
        origY: o.y,
        bedRect: bedRect,
      };
      if (freshEl) applyObjectTransform(freshEl, o, { dragging: true });
      var building = $("fi-building-viewport");
      if (building) building.classList.add("is-sliding");
      updateHud();
      e.preventDefault();
      return;
    }

    if (
      e.target.closest(
        "#fi-stage-canvas, .fi-ohp-light, .fi-exterior-surface, #fi-exterior-stage, #fi-objects-layer, #fi-text-layer, #fi-acetate-mount, .fi-cube-wall-band, .fi-cube-floor-edge"
      )
    ) {
      state.selectedId = null;
      renderObjects();
    }
  }

  function onSheetsPanelPointerDown(e) {
    if (e.target.closest(".fi-layer-card-action")) return;
    var card = e.target.closest(".fi-sheet-card");
    var list = $("fi-sheets-list");
    if (!card || !card.dataset.id || !list || !list.contains(card)) return;
    state.panelDrag = {
      id: card.dataset.id,
      startY: e.clientY,
      moved: false,
      card: card,
      list: list,
    };
    if (card.setPointerCapture) try { card.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (state.drawStroke) {
      onDrawPointerMove(e);
      return;
    }
    if (state.panelDrag) {
      var drag = state.panelDrag;
      if (!drag.moved && Math.abs(e.clientY - drag.startY) < 6) return;
      if (!drag.moved) {
        drag.moved = true;
        drag.card.classList.add("fi-sheet-card-dragging");
        drag.list.classList.add("is-reordering");
      }
      panelDragInsertAt(drag.list, drag.card, e.clientY);
      return;
    }

    if (state.lasso) {
      var pt = glassPoint(e.clientX, e.clientY);
      var pts = state.lasso.points;
      var first = pts[0];
      if (pts.length > 8 && Math.hypot(pt.px - first.px, pt.py - first.py) < LASSO_CLOSE_PX) {
        finishLasso();
        return;
      }
      var last = pts[pts.length - 1];
      if (!last || Math.hypot(pt.px - last.px, pt.py - last.py) > LASSO_POINT_MIN_PX) {
        pts.push({ px: pt.px, py: pt.py, x: pt.x, y: pt.y });
        var drawPts = simplifyPoints(
          pts.map(function (p) { return { x: p.px, y: p.py }; }),
          LASSO_DRAW_SIMPLIFY
        );
        drawLassoLine(drawPts, false);
      }
      return;
    }

    if (state.viewPanDrag) {
      state.viewPan.x = state.viewPanDrag.origPanX + (e.clientX - state.viewPanDrag.startX);
      state.viewPan.y = state.viewPanDrag.origPanY + (e.clientY - state.viewPanDrag.startY);
      applyViewPan();
      updateHud();
      return;
    }

    if (state.textBoxGesture) {
      var g = state.textBoxGesture;
      var objG = getObject(g.id);
      var distG = Math.hypot(e.clientX - g.startClientX, e.clientY - g.startClientY);
      if (!g.moved && distG < 6) return;
      if (!g.moved) {
        g.moved = true;
        var activeInner = document.querySelector('.fi-textbox-object[data-id="' + g.id + '"] .fi-textbox-inner');
        if (activeInner) {
          if (objG) objG.text = readTextBoxInnerText(activeInner);
          activeInner.contentEditable = "false";
        }
        var buildingG = $("fi-building-viewport");
        if (buildingG) buildingG.classList.add("is-sliding");
      }
      if (!objG) return;
      var ptG = canvasPoint(e.clientX, e.clientY, g.bedRect);
      objG.x = clampPosePercent(g.origX + (ptG.x - g.startCanvas.x));
      objG.y = clampPosePercent(g.origY + (ptG.y - g.startCanvas.y));
      var elG = document.querySelector('.fi-pose-object[data-id="' + objG.id + '"]');
      if (elG) applyObjectTransform(elG, objG, { dragging: true });
      scheduleLiveCompose();
      updateHud();
      return;
    }

    if (state.stretchDrag) {
      var objX = getObject(state.stretchDrag.id);
      if (!objX) return;
      var rectStretch = acetateBedRect();
      var ptStretch = canvasPoint(e.clientX, e.clientY, rectStretch);
      var dragStretch = state.stretchDrag;
      applyEdgeStretchDrag(objX, dragStretch, {
        dx: ptStretch.x - dragStretch.startCanvas.x,
        dy: ptStretch.y - dragStretch.startCanvas.y,
      });
      var elX = document.querySelector('.fi-pose-object[data-id="' + objX.id + '"]');
      if (elX) applyResizeTransformFast(elX, objX);
      return;
    }

    if (state.tiltDrag) {
      var objT = getObject(state.tiltDrag.id);
      if (!objT) return;
      var nowLocalT = clientToLocalPercent(objT, e.clientX, e.clientY, acetateBedRect());
      var dxT = nowLocalT.x - state.tiltDrag.startLocal.x;
      var dyT = nowLocalT.y - state.tiltDrag.startLocal.y;
      var sensT = 0.85;
      var startT = state.tiltDrag.startTilt;
      var cornerT = state.tiltDrag.corner;
      if (cornerT === "tl") {
        objT.tiltX = clampTilt(startT.tiltX - dyT * sensT);
        objT.tiltY = clampTilt(startT.tiltY - dxT * sensT);
      } else if (cornerT === "tr") {
        objT.tiltX = clampTilt(startT.tiltX - dyT * sensT);
        objT.tiltY = clampTilt(startT.tiltY + dxT * sensT);
      } else if (cornerT === "bl") {
        objT.tiltX = clampTilt(startT.tiltX + dyT * sensT);
        objT.tiltY = clampTilt(startT.tiltY - dxT * sensT);
      } else {
        objT.tiltX = clampTilt(startT.tiltX + dyT * sensT);
        objT.tiltY = clampTilt(startT.tiltY + dxT * sensT);
      }
      var elT = document.querySelector('.fi-pose-object[data-id="' + objT.id + '"]');
      if (elT) applyPlaneTiltFast(elT, objT);
      return;
    }

    if (state.cornerDrag) {
      var objC = getObject(state.cornerDrag.id);
      if (!objC) return;
      var rectC = acetateBedRect();
      var nowLocal = clientToLocalPercent(objC, e.clientX, e.clientY, rectC);
      var dx = nowLocal.x - state.cornerDrag.startLocal.x;
      var dy = nowLocal.y - state.cornerDrag.startLocal.y;
      ensureLattice(objC)[state.cornerDrag.corner] = clampCorner({
        x: state.cornerDrag.startCorner.x + dx,
        y: state.cornerDrag.startCorner.y + dy,
      });
      syncLatticeAfterHandleDrag(ensureLattice(objC), state.cornerDrag.corner);
      var elC = document.querySelector('.fi-pose-object[data-id="' + objC.id + '"]');
      if (elC) {
        ensureWarpDom(elC, objC);
        var rectC2 = elC.getBoundingClientRect();
        var cw = Math.max(1, Math.round(rectC2.width));
        var ch = Math.max(1, Math.round(rectC2.height));
        var warpCanvas = elC.querySelector(".fi-warp-canvas");
        if (warpCanvas) {
          if (warpCanvas.width !== cw) warpCanvas.width = cw;
          if (warpCanvas.height !== ch) warpCanvas.height = ch;
          if (!paintWarpedLayer(objC, warpCanvas, cw, ch)) redrawWarpedLayer(objC, elC);
        }
        updateWarpHandles(elC, objC);
      }
      scheduleLiveCompose();
      updateHud();
      return;
    }

    if (state.scaleDrag) {
      var objS = getObject(state.scaleDrag.id);
      if (!objS) return;
      var sptM = canvasPoint(e.clientX, e.clientY);
      var dist = Math.hypot(sptM.px - state.scaleDrag.cx, sptM.py - state.scaleDrag.cy);
      var ratio = dist / state.scaleDrag.startDist;
      ratio = Math.max(0.25, Math.min(SCALE_RATIO_MAX, ratio));
      if (objS.type === "textbox") {
        objS.fitToText = false;
        objS.fontSize = clampTextBoxFont((state.scaleDrag.origFontSize || 4.2) * ratio);
      }
      objS.w = clampSizePercent(state.scaleDrag.origW * ratio);
      if (objS.type === "image" && objS.aspect) {
        objS.h = clampSizePercent(objS.w / objS.aspect);
      } else {
        objS.h = clampSizePercent(state.scaleDrag.origH * ratio);
      }
      objS.x = clampPosePercent(state.scaleDrag.centerX - objS.w / 2);
      objS.y = clampPosePercent(state.scaleDrag.centerY - objS.h / 2);
      var elS = document.querySelector('.fi-pose-object[data-id="' + objS.id + '"]');
      if (elS) applyResizeTransformFast(elS, objS);
      return;
    }

    if (state.rotateDrag) {
      var objR = getObject(state.rotateDrag.id);
      if (!objR) return;
      var rpt = canvasPoint(e.clientX, e.clientY);
      var angle = Math.atan2(rpt.py - state.rotateDrag.cy, rpt.px - state.rotateDrag.cx) * (180 / Math.PI);
      objR.rotation = state.rotateDrag.origRotation + (angle - state.rotateDrag.startAngle);
      var elR = document.querySelector('.fi-pose-object[data-id="' + objR.id + '"]');
      if (elR) applyObjectTransform(elR, objR);
      scheduleLiveCompose();
      updateHud();
      return;
    }

    if (!state.drag) return;
    var obj = getObject(state.drag.id);
    if (!obj) return;
    var pt = canvasPoint(e.clientX, e.clientY, state.drag.bedRect);
    obj.x = clampPosePercent(state.drag.origX + (pt.x - state.drag.startX));
    obj.y = clampPosePercent(state.drag.origY + (pt.y - state.drag.startY));
    var el = document.querySelector('.fi-pose-object[data-id="' + obj.id + '"]');
    if (el) applyObjectTransform(el, obj, { dragging: true });
    scheduleLiveCompose();
    updateHud();
  }

  function onPointerUp(e) {
    if (state.viewPanDrag) {
      state.viewPanDrag = null;
      var buildingPanUp = $("fi-building-viewport");
      if (buildingPanUp) buildingPanUp.classList.remove("is-view-panning");
      updateHud();
      return;
    }
    if (state.panelDrag) {
      var drag = state.panelDrag;
      drag.card.classList.remove("fi-sheet-card-dragging");
      drag.list.classList.remove("is-reordering");
      if (drag.moved) {
        var panelIds = Array.prototype.map.call(
          drag.list.querySelectorAll(".fi-sheet-card"),
          function (c) { return c.dataset.id; }
        );
        setLayerOrderFromPanel(panelIds);
        state.selectedId = drag.id;
        renderObjects();
        composeMoment();
        setComposerStatus("Layer order updated.");
        setTimeout(function () { setComposerStatus(""); }, 1200);
      } else {
        selectObject(drag.id, { scrollPanel: false });
      }
      state.panelDrag = null;
      return;
    }

    if (state.lasso) {
      finishLasso();
      return;
    }
    if (state.textBoxGesture) {
      var gUp = state.textBoxGesture;
      var elUp = document.querySelector('.fi-pose-object[data-id="' + gUp.id + '"]');
      var objUp = getObject(gUp.id);
      if (gUp.moved) {
        if (elUp && objUp) {
          elUp.classList.remove("dragging");
          elUp.classList.add("settling");
          applyObjectTransform(elUp, objUp);
          setTimeout(function () { if (elUp) elUp.classList.remove("settling"); }, 220);
        }
        composeMoment();
      } else {
        var innerUp = document.querySelector('.fi-textbox-object[data-id="' + gUp.id + '"] .fi-textbox-inner');
        if (innerUp) focusTextBoxEditor(innerUp, innerUp.classList.contains("is-placeholder"));
      }
      var buildingUp = $("fi-building-viewport");
      if (buildingUp) buildingUp.classList.remove("is-sliding");
      state.textBoxGesture = null;
      updateHud();
      return;
    }

    if (state.stretchDrag) {
      var endedStretch = getObject(state.stretchDrag.id);
      var endedStretchEl = endedStretch
        ? document.querySelector('.fi-pose-object[data-id="' + endedStretch.id + '"]')
        : null;
      if (endedStretch && endedStretch.type === "image" && endedStretch.w > 0 && endedStretch.h > 0) {
        endedStretch.aspect = endedStretch.w / endedStretch.h;
      }
      if (endedStretch && endedStretchEl) {
        invalidateWarpRasterCache(endedStretch.id);
        applyObjectTransform(endedStretchEl, endedStretch);
      }
      setTiltDragChrome(false);
      composeMoment();
      state.stretchDrag = null;
      updateHud();
      return;
    }

    if (state.tiltDrag) {
      var endedTilt = getObject(state.tiltDrag.id);
      var endedTiltEl = endedTilt
        ? document.querySelector('.fi-pose-object[data-id="' + endedTilt.id + '"]')
        : null;
      if (endedTilt && endedTiltEl) {
        invalidateWarpRasterCache(endedTilt.id);
        applyObjectTransform(endedTiltEl, endedTilt);
      }
      setTiltDragChrome(false);
      composeMoment();
      state.tiltDrag = null;
      updateHud();
      return;
    }

    if (state.cornerDrag) {
      var endedWarp = getObject(state.cornerDrag.id);
      var endedEl = endedWarp
        ? document.querySelector('.fi-pose-object[data-id="' + endedWarp.id + '"]')
        : null;
      if (endedWarp && endedEl) redrawWarpedLayer(endedWarp, endedEl);
      composeMoment();
      state.cornerDrag = null;
      updateHud();
      return;
    }
    if (state.scaleDrag) {
      var endedScale = getObject(state.scaleDrag.id);
      var endedScaleEl = endedScale
        ? document.querySelector('.fi-pose-object[data-id="' + endedScale.id + '"]')
        : null;
      if (endedScale && endedScale.type === "image" && endedScale.w > 0 && endedScale.h > 0) {
        endedScale.aspect = endedScale.w / endedScale.h;
      }
      if (endedScale && endedScaleEl) {
        invalidateWarpRasterCache(endedScale.id);
        applyObjectTransform(endedScaleEl, endedScale);
      }
      setTiltDragChrome(false);
      composeMoment();
      state.scaleDrag = null;
      updateHud();
      return;
    }
    if (state.rotateDrag) {
      composeMoment();
      state.rotateDrag = null;
      updateHud();
      return;
    }
    if (state.drag) {
      var el = document.querySelector('.fi-pose-object[data-id="' + state.drag.id + '"]');
      var obj = getObject(state.drag.id);
      if (el && obj) {
        el.classList.remove("dragging");
        el.classList.add("settling");
        applyObjectTransform(el, obj);
        setTimeout(function () { if (el) el.classList.remove("settling"); }, 220);
      }
      var building = $("fi-building-viewport");
      if (building) building.classList.remove("is-sliding");
      composeMoment();
      state.drag = null;
      updateHud();
    }
    onDrawPointerUp();
  }

  function parseClipToPath(ctx, clipPath, w, h) {
    if (!clipPath || clipPath.indexOf("polygon") < 0) return;
    var inner = clipPath.replace(/polygon\(|\)/g, "").trim();
    var pairs = inner.split(",");
    ctx.beginPath();
    pairs.forEach(function (pair, idx) {
      var parts = pair.trim().split(/\s+/);
      var px = (parseFloat(parts[0]) / 100) * w;
      var py = (parseFloat(parts[1]) / 100) * h;
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.clip();
  }

  function drawGlassBackground(ctx) {
    var g = ctx.createRadialGradient(CAP_W * 0.5, CAP_H * 0.55, 0, CAP_W * 0.5, CAP_H * 0.55, CAP_W * 0.75);
    g.addColorStop(0, "#f2f6fc");
    g.addColorStop(0.55, "#d8e4f4");
    g.addColorStop(1, "#a8bcd8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CAP_W, CAP_H);
  }

  function clipCornersPath(ctx, corners, w, h) {
    ctx.beginPath();
    corners.forEach(function (p, idx) {
      var px = (p.x / 100) * w - w / 2;
      var py = (p.y / 100) * h - h / 2;
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.clip();
  }

  function drawTextboxFlat(ctx, obj, w, h) {
    normalizeTextBoxObject(obj);
    if (obj.clipPath) parseClipToPath(ctx, obj.clipPath, w, h);
    var fontPx = textBoxFontPx(obj);
    ctx.fillStyle = obj.bg || TEXTBOX_CHROME.bg;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = obj.borderColor || TEXTBOX_CHROME.borderColor;
    ctx.lineWidth = Math.max(2, Math.floor(fontPx * 0.1));
    ctx.strokeRect(-w / 2 + ctx.lineWidth / 2, -h / 2 + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
    ctx.fillStyle = obj.color || TEXTBOX_CHROME.color;
    ctx.font = "600 " + fontPx + "px Cormorant Garamond, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(obj.text || "Your text", 0, 0, w * 0.9);
  }

  function drawObjectOnCapture(ctx, obj, img, raster, surfaceW, surfaceH) {
    surfaceW = surfaceW || CAP_W;
    surfaceH = surfaceH || CAP_H;
    var x = (obj.x / 100) * surfaceW;
    var y = (obj.y / 100) * surfaceH;
    var w = (obj.w / 100) * surfaceW;
    var h = (obj.h / 100) * surfaceH;
    var tilted = planeIsTilted(obj);
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(((obj.rotation || 0) * Math.PI) / 180);
    ctx.globalAlpha = obj.type === "image" ? 0.88 : 0.92;
    if (tilted && raster) {
      drawImageBilinearQuad(ctx, raster, planeTiltCorners(obj), w, h, true);
    } else if (obj.type === "image" && img) {
      if (obj.clipPath) parseClipToPath(ctx, obj.clipPath, w, h);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else if (obj.type === "stencil") {
      if (obj.clipPath) parseClipToPath(ctx, obj.clipPath, w, h);
      ctx.fillStyle = "rgba(30,40,60,0.82)";
      ctx.font = "600 " + Math.floor(h * 0.7) + "px Cormorant Garamond, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(obj.letter || state.letter, 0, 0);
    } else if (obj.type === "textbox") {
      drawTextboxFlat(ctx, obj, w, h);
    }
    ctx.restore();
  }

  function flashProjection() {
    var glow = $("fi-ohp-glow-plate");
    if (glow) {
      glow.classList.add("fi-flash");
      setTimeout(function () { if (glow) glow.classList.remove("fi-flash"); }, 520);
    }
  }

  function captureProjection(opts) {
    opts = opts || {};
    var visuals = state.objects.filter(function (o) {
      return o.type === "image" || o.type === "stencil" || o.type === "textbox";
    });
    if (!visuals.length) return Promise.reject(new Error("Add sheets, stencils, or text on the glass first."));
    if (opts.flash) flashProjection();
    var plate = glassPlateInBed();
    if (plate.w < 0.5 || plate.h < 0.5) {
      return Promise.reject(new Error("OHP workspace not ready — try again."));
    }
    var bedW = Math.round(CAP_W * (100 / plate.w));
    var bedH = Math.round(CAP_H * (100 / plate.h));
    var ceilX = Math.round((plate.x / 100) * bedW);
    var ceilY = Math.round((plate.y / 100) * bedH);
    var ceilW = Math.round((plate.w / 100) * bedW);
    var ceilH = Math.round((plate.h / 100) * bedH);
    var images = state.objects.filter(function (o) { return o.type === "image"; });
    return Promise.all(
      images.map(function (o) {
        return loadImage(o.url).then(function (img) { return { obj: o, img: img }; });
      })
    ).then(function (loaded) {
      var sorted = sortedObjects();
      var warped = sorted.filter(function (obj) {
        return planeIsTilted(obj);
      });
      return Promise.all(
        warped.map(function (obj) {
          var w = (obj.w / 100) * bedW;
          var h = (obj.h / 100) * bedH;
          return rasterForWarp(obj, w, h).then(function (raster) {
            return { id: obj.id, raster: raster };
          });
        })
      ).then(function (rasterRows) {
        var rasterMap = {};
        rasterRows.forEach(function (row) { rasterMap[row.id] = row.raster; });
        var bedCanvas = document.createElement("canvas");
        bedCanvas.width = bedW;
        bedCanvas.height = bedH;
        var bedCtx = bedCanvas.getContext("2d");
        bedCtx.fillStyle = "rgba(200, 212, 232, 0.42)";
        bedCtx.fillRect(0, 0, bedW, bedH);
        var drawCanvas = $("fi-draw-canvas");
        if (drawCanvas && drawCanvas.width > 0) {
          bedCtx.drawImage(drawCanvas, 0, 0, drawCanvas.width, drawCanvas.height, ceilX, ceilY, ceilW, ceilH);
        }
        sorted.forEach(function (obj) {
          if (obj.type === "image") {
            var row = loaded.find(function (l) { return l.obj.id === obj.id; });
            if (row) drawObjectOnCapture(bedCtx, obj, row.img, rasterMap[obj.id], bedW, bedH);
          } else if (obj.type === "stencil" || obj.type === "textbox") {
            drawObjectOnCapture(bedCtx, obj, null, rasterMap[obj.id], bedW, bedH);
          }
        });
        var canvas = document.createElement("canvas");
        canvas.width = CAP_W;
        canvas.height = CAP_H;
        var ctx = canvas.getContext("2d");
        drawGlassBackground(ctx);
        ctx.drawImage(bedCanvas, ceilX, ceilY, ceilW, ceilH, 0, 0, CAP_W, CAP_H);
        return canvas;
      });
    }).then(function (canvas) {
      var ctx = canvas.getContext("2d");
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(0, 0, CAP_W, CAP_H);
      ctx.restore();
      var dataUrl = canvas.toDataURL("image/jpeg", 0.88);
      state.lastCaptureUrl = dataUrl;
      return dataUrl;
    });
  }

  function setLetterIndex(idx) {
    state.cycleIndex = ((idx % TOTAL_FRAMES) + TOTAL_FRAMES) % TOTAL_FRAMES;
    state.letter = LETTERS.charAt(state.cycleIndex);
    var sel = getObject(state.selectedId);
    if (sel && sel.type === "stencil") sel.letter = state.letter;
    renderObjects();
    updateHud();
    composeMoment();
  }

  function pauseStencil() {
    state.held = true;
    stopCycle();
    updateHoldButton();
    updateHud();
  }

  function stepLetter(dir) {
    pauseStencil();
    setLetterIndex(state.cycleIndex + dir);
  }

  function advanceFrame() {
    if (state.held) return;
    setLetterIndex(state.cycleIndex + 1);
  }

  function stopCycle() {
    if (state.cycleTimer) clearInterval(state.cycleTimer);
    state.cycleTimer = null;
    state.cycling = false;
    updateHud();
  }

  function startCycle() {
    stopCycle();
    if (state.held) return;
    state.cycling = true;
    state.cycleTimer = setInterval(advanceFrame, CYCLE_MS);
    updateHud();
  }

  function setStageUrl(url, opts) {
    opts = opts || {};
    var addToGlass = opts.addToGlass !== false;
    state.stageUrl = url || "";
    if (url && (addToGlass || opts.label === "generated")) {
      state.stageGeneratedAt = Date.now();
    }
    if (addToGlass && url) {
      var existing = state.objects.find(function (o) { return o.type === "image" && o.url === url; });
      if (existing) {
        if (imageLayerLooksEmpty(existing)) {
          removeEmptyLayer(existing.id, { silent: true });
        } else {
          state.selectedId = existing.id;
          bringToFront(existing.id);
          renderObjects();
          syncStageChrome(true);
          composeMoment();
          return;
        }
      }
      addImageObject({ url: url, label: opts.label || "vision" }, null, { scrollPanel: true }).then(function (id) {
        if (!id) {
          setComposerStatus("Generated image was blank — not added to the glass.");
          setTimeout(function () { setComposerStatus(""); }, 2400);
          return;
        }
        syncStageChrome(true);
        composeMoment();
      });
      return;
    }
    syncStageChrome();
  }

  function bind() {
    setTool("move");
    updateHoldButton();

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    var workspace = $("fi-workspace");
    if (workspace && !workspace.dataset.bound) {
      workspace.dataset.bound = "1";
      workspace.addEventListener("pointerdown", onBuildingPointerDown);
      workspace.addEventListener("auxclick", function (e) {
        if (e.button === 1) e.preventDefault();
      });
    }

    var drawCanvas = $("fi-draw-canvas");
    if (drawCanvas && !drawCanvas.dataset.bound) {
      drawCanvas.dataset.bound = "1";
      drawCanvas.addEventListener("pointerdown", onDrawPointerDown);
    }

    ["fi-brush-shape", "fi-brush-texture", "fi-brush-size", "fi-brush-flow", "fi-brush-color"].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener("input", function () { readBrushFromUi(); });
      if (el) el.addEventListener("change", function () { readBrushFromUi(); });
    });

    initDrawCanvas();
    syncWorkspaceSize();
    migrateObjectsToBedCoords();

    var resizeRoot = $("fi-stage-layout") || $("fi-building-viewport");
    if (resizeRoot && !resizeRoot.dataset.resizeBound && typeof ResizeObserver !== "undefined") {
      resizeRoot.dataset.resizeBound = "1";
      var resizeObserver = new ResizeObserver(function () {
        syncWorkspaceSize();
        state.objects.filter(function (o) { return o.type === "textbox"; }).forEach(function (obj) {
          ensureTextBoxLayout(obj);
          var tbEl = document.querySelector('.fi-textbox-object[data-id="' + obj.id + '"]');
          if (!tbEl) return;
          applyObjectTransform(tbEl, obj);
          if (obj.fitToText !== false) {
            applyTextBoxStyles(tbEl, obj);
            fitTextBoxToContent(obj, tbEl, { preserveCenter: true });
          }
        });
      });
      resizeObserver.observe(resizeRoot);
    }

    if (typeof ResizeObserver !== "undefined") {
      var siteHeader = document.querySelector(".site-header");
      if (siteHeader && !siteHeader.dataset.fiHeaderObserved) {
        siteHeader.dataset.fiHeaderObserved = "1";
        var headerObserver = new ResizeObserver(function () {
          syncHeaderHeight();
        });
        headerObserver.observe(siteHeader);
      }
    }

    document.querySelectorAll(".fi-tool-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { setTool(btn.dataset.tool); });
    });

    var sheetsList = $("fi-sheets-list");
    if (sheetsList && !sheetsList.dataset.bound) {
      sheetsList.dataset.bound = "1";
      sheetsList.addEventListener("pointerdown", onSheetsPanelPointerDown);
      sheetsList.addEventListener("click", onSheetsPanelClick);
    }

    $("fi-place-equipped") && $("fi-place-equipped").addEventListener("click", placeEquipped);
    $("fi-drop-paper") && $("fi-drop-paper").addEventListener("click", dropActivePaper);
    $("fi-delete-sheet") && $("fi-delete-sheet").addEventListener("click", deleteSelected);
    $("fi-add-stencil") && $("fi-add-stencil").addEventListener("click", function () {
      addStencil();
      setComposerStatus("Added letter stencil.");
      setTimeout(function () { setComposerStatus(""); }, 1400);
    });
    $("fi-add-textbox") && $("fi-add-textbox").addEventListener("click", addTextBox);
    $("fi-delete-stencil") && $("fi-delete-stencil").addEventListener("click", deleteSelected);
    $("fi-inject-prompt") && $("fi-inject-prompt").addEventListener("click", function () {
      var p = getUserPrompt();
      if (!p) {
        setComposerStatus("Type something in the prompt index first.");
        setTimeout(function () { setComposerStatus(""); }, 1600);
        return;
      }
      composeMoment();
      setComposerStatus("Prompt woven into stasis.");
      setTimeout(function () { setComposerStatus(""); }, 1400);
    });
    var promptEl = $("fi-prompt");
    if (promptEl) {
      promptEl.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      promptEl.addEventListener("click", function (e) { e.stopPropagation(); });
      promptEl.addEventListener("input", function () { scheduleLiveCompose(); });
      promptEl.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          composeMoment();
          setComposerStatus("Prompt index applied.");
          setTimeout(function () { setComposerStatus(""); }, 1200);
        }
      });
    }
    $("fi-step-letter-prev") && $("fi-step-letter-prev").addEventListener("click", function () { stepLetter(-1); });
    $("fi-step-letter-next") && $("fi-step-letter-next").addEventListener("click", function () { stepLetter(1); });

    $("fi-shuffle-letter") && $("fi-shuffle-letter").addEventListener("click", function () {
      state.cycleIndex = 0;
      setLetterIndex(0);
      state.held = false;
      updateHoldButton();
      startCycle();
      setComposerStatus("Stencil cycling A → Z.");
      setTimeout(function () { setComposerStatus(""); }, 1400);
    });

    $("fi-hold-letter") && $("fi-hold-letter").addEventListener("click", function () {
      state.held = !state.held;
      updateHoldButton();
      if (state.held) stopCycle();
      else startCycle();
      updateHud();
    });

    $("fi-toggle-interface") &&
      $("fi-toggle-interface").addEventListener("click", function () {
        setInterfaceHidden(true);
      });
    $("fi-restore-interface") &&
      $("fi-restore-interface").addEventListener("click", function () {
        setInterfaceHidden(false);
      });
    bindPipLayer();
    $("fi-refresh-layers") && $("fi-refresh-layers").addEventListener("click", refreshLayers);
    $("fi-duplicate-layer") && $("fi-duplicate-layer").addEventListener("click", duplicateSelected);
    $("fi-delete-layer") && $("fi-delete-layer").addEventListener("click", deleteSelected);
    $("fi-lock-layer") && $("fi-lock-layer").addEventListener("click", toggleLayerLock);

    $("fi-reapply-stasis") && $("fi-reapply-stasis").addEventListener("click", function () {
      state.composeSeed = Date.now();
      composeMoment();
      setComposerStatus("Stasis reapplied for " + state.letter + ".");
      setTimeout(function () { setComposerStatus(""); }, 1600);
    });

    window.addEventListener("keydown", function (e) {
      if (!$("panel-fleeting-idea") || $("panel-fleeting-idea").hidden) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (
          document.activeElement &&
          (/input|textarea/i.test(document.activeElement.tagName) || document.activeElement.isContentEditable)
        ) return;
        e.preventDefault();
        deleteSelected();
      }
    });

    window.addEventListener("fi-slots-changed", function () {
      prefetchLod1AnalysesForSlots();
      composeMoment();
      requestAnimationFrame(syncEdgeInsets);
    });

    window.addEventListener("fi-stage-image", function (e) {
      if (e.detail && e.detail.url) {
        setStageUrl(e.detail.url, {
          addToGlass: e.detail.addToGlass,
          label: e.detail.label || "vision",
        });
      }
    });
    window.addEventListener("fi-generated-new", function (e) {
      var url = e.detail && e.detail.url;
      var n = parseLod1NumFromUrl(url);
      if (n) ensureLod1Analysis(n);
    });
  }

  function boot() {
    if (!$("panel-fleeting-idea")) return;
    setInterfaceHidden(false);
    resetViewPan();
    bind();
    enforceNoBlankImageLayers({ silent: true });
    renderObjects();
    composeMoment();
    Promise.all([loadAnalyses(), loadLod1Analyses()]).then(function () {
      prefetchLod1AnalysesForSlots();
      composeMoment();
    });
    window.dispatchEvent(new Event("fleeting-idea-ready"));
  }

  window.addEventListener("fleeting-idea-show", function () {
    setInterfaceHidden(false);
    syncHeaderHeight();
    syncEdgeInsets();
    syncWorkspaceSize();
    enforceNoBlankImageLayers({ silent: true });
    renderObjects();
    syncStageChrome();
    syncOverscaleToggle();
    syncExteriorPan();
    syncExteriorPortalSize();
    var overscaleBtn = $("fi-overscale-toggle");
    if (overscaleBtn) overscaleBtn.hidden = false;
  });
  window.addEventListener("fleeting-idea-hide", function () {
    stopCycle();
    var overscaleBtn = $("fi-overscale-toggle");
    if (overscaleBtn) overscaleBtn.hidden = true;
  });

  window.FleetingIdea = {
    getStasis: function () { return state.composed || ""; },
    getUserPrompt: getUserPrompt,
    getLastCapture: function () { return state.lastCaptureUrl || ""; },
    getLetter: function () { return state.letter; },
    getSheetPaintingNums: sheetPaintingNums,
    addStencil: addStencil,
    addTextBox: addTextBox,
    selectObject: selectObject,
    compressDataUrl: compressDataUrl,
    prepareCaptureForApi: function (url) { return compressDataUrl(url, 960, 0.78); },
    getTimelapse: function () {
      return { frame: state.cycleIndex + 1, totalFrames: TOTAL_FRAMES, letter: state.letter, cycleMs: CYCLE_MS };
    },
    setStageImage: setStageUrl,
    captureProjection: captureProjection,
    syncEdgeInsets: syncEdgeInsets,
    setInterfaceHidden: setInterfaceHidden,
    togglePipLayer: togglePipLayer,
    projectionPreviewUrl: projectionPreviewUrl,
    recompose: function () { state.composeSeed = Date.now(); composeMoment(); },
    refreshLayers: refreshLayers,
    getLayer: getObject,
    panToLayer: panToLayer,
    moveSelectedToLayer: moveSelectedToLayer,
    replaceLayerImage: replaceLayerImage,
    reloadLayerImage: reloadLayerImage,
    regenerateLayer: regenerateLayer,
    layerIsGenerated: layerIsGenerated,
    imageLayerLooksEmpty: imageLayerLooksEmpty,
    imageHasVisibleInk: imageHasVisibleInk,
    validateImageUrl: validateImageUrl,
    purgeEmptyImageLayers: purgeEmptyImageLayers,
    enforceNoBlankImageLayers: enforceNoBlankImageLayers,
    removeEmptyLayer: removeEmptyLayer,
    placeEquipped: placeEquipped,
    dropPaper: dropActivePaper,
    addSheet: dropActivePaper,
    dropPaper: dropActivePaper,
    addSheet: dropActivePaper,
    deleteSheet: deleteSelected,
    deleteSelected: deleteSelected,
    duplicateSelected: duplicateSelected,
    toggleLayerLock: toggleLayerLock,
    pauseStencil: pauseStencil,
    restartCycle: function () { state.cycleIndex = 0; setLetterIndex(0); if (!state.held) startCycle(); },
    holdLetter: function (on) { state.held = !!on; updateHoldButton(); if (state.held) stopCycle(); else startCycle(); },
    isHeld: function () { return state.held; },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();