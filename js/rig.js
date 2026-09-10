/**
 * Rig — manual 2D bone placement + pose / image deformation.
 * Edit bones (bind pose) or Pose (FK joints + per-bone segment meshes).
 * Each bone owns a capsule cutout mesh; limbs slide over torso (2.5D) without rubber-warping the body.
 */
(function () {
  "use strict";

  var LS_KEY = "logan-rig-v1";
  var LS_LAST = "logan-rig-last-v1";
  var HIT_R = 12;
  var JOINT_R = 7;
  var MESH_COLS = 36;
  var MESH_ROWS = 36;
  var SKIN_EPS = 1e-6;
  var CUTOUT_ALPHA_MIN = 24; // mesh vert opaque threshold (0-255)
  // Per-bone capsule radii (normalized image space)
  var SEG_HAND_R = 0.048;
  var SEG_LIMB_R = 0.072;
  var SEG_TORSO_R = 0.13;
  var SEG_HEAD_R = 0.085;
  var SEG_FOOT_R = 0.055;
  var SEG_SOFT = 1.25; // soft edge beyond hard radius still assignable if nearest
  var PROP_SEARCH_R = 0.11; // look for disconnected props near hands
  var PROP_MIN_CELLS = 3;

  /** Normalized (0–1) starter human template relative to image bounds. */
  var TEMPLATE_JOINTS = [
    { id: "hips", label: "Hips", x: 0.5, y: 0.52 },
    { id: "spine", label: "Spine", x: 0.5, y: 0.42 },
    { id: "chest", label: "Chest", x: 0.5, y: 0.32 },
    { id: "neck", label: "Neck", x: 0.5, y: 0.22 },
    { id: "head", label: "Head", x: 0.5, y: 0.12 },
    { id: "l_upper_arm", label: "L Upper Arm", x: 0.38, y: 0.3 },
    { id: "l_forearm", label: "L Forearm", x: 0.3, y: 0.42 },
    { id: "l_hand", label: "L Hand", x: 0.26, y: 0.52 },
    { id: "r_upper_arm", label: "R Upper Arm", x: 0.62, y: 0.3 },
    { id: "r_forearm", label: "R Forearm", x: 0.7, y: 0.42 },
    { id: "r_hand", label: "R Hand", x: 0.74, y: 0.52 },
    { id: "l_thigh", label: "L Thigh", x: 0.45, y: 0.62 },
    { id: "l_shin", label: "L Shin", x: 0.44, y: 0.78 },
    { id: "l_foot", label: "L Foot", x: 0.43, y: 0.92 },
    { id: "r_thigh", label: "R Thigh", x: 0.55, y: 0.62 },
    { id: "r_shin", label: "R Shin", x: 0.56, y: 0.78 },
    { id: "r_foot", label: "R Foot", x: 0.57, y: 0.92 },
  ];

  var TEMPLATE_BONES = [
    ["hips", "spine"],
    ["spine", "chest"],
    ["chest", "neck"],
    ["neck", "head"],
    ["chest", "l_upper_arm"],
    ["l_upper_arm", "l_forearm"],
    ["l_forearm", "l_hand"],
    ["chest", "r_upper_arm"],
    ["r_upper_arm", "r_forearm"],
    ["r_forearm", "r_hand"],
    ["hips", "l_thigh"],
    ["l_thigh", "l_shin"],
    ["l_shin", "l_foot"],
    ["hips", "r_thigh"],
    ["r_thigh", "r_shin"],
    ["r_shin", "r_foot"],
  ];

  var state = {
    image: null,
    imageSrc: "",
    imageName: "",
    imageKind: "",
    paintingNum: 1,
    joints: [],
    bones: [],
    bindJoints: [],
    mode: "edit", // edit | pose
    selectedId: null,
    dragId: null,
    opacity: 0.85,
    showNames: true,
    showCutoutInEdit: false,
    undoStack: [],
    ready: false,
    canvasW: 800,
    canvasH: 600,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    mesh: null, // { segments:[{id,kind,side,bone,verts,tris,drawOrder}], cutoutOnly }
    frontSide: "right", // which arm/leg draws on top when overlapping body
    cutoutImage: null, // HTMLImageElement / canvas with alpha subject
    cutoutMethod: "", // imgly | flood | alpha | manual | ""
    cutoutReady: false, // quality gate passed — Pose unlocked
    cutoutFailReason: "",
    cutting: false,
    cuttingPromise: null,
    workCanvas: null, // live bitmap for manual erase / restore
    eraseTool: null, // null | "erase" | "restore"
    brushSize: 32, // canvas pixels
    eraseDragging: false,
    eraseLast: null, // {x,y} image-space
  };

  function $(id) {
    return document.getElementById(id);
  }

  function cloneJoints(joints) {
    return (joints || []).map(function (j) {
      return { id: j.id, label: j.label, x: j.x, y: j.y };
    });
  }

  function cloneBones(bones) {
    return (bones || []).map(function (b) {
      return [b[0], b[1]];
    });
  }

  function pushUndo(opts) {
    var entry = {
      joints: cloneJoints(state.joints),
      bones: cloneBones(state.bones),
      bindJoints: cloneJoints(state.bindJoints),
      mode: state.mode,
    };
    if (opts && opts.cutout && state.workCanvas) {
      try {
        entry.cutoutDataUrl = state.workCanvas.toDataURL("image/png");
        entry.cutoutMethod = state.cutoutMethod;
        entry.cutoutReady = !!state.cutoutReady;
        entry.cutoutFailReason = state.cutoutFailReason || "";
      } catch (e) {
        /* ignore snapshot failure */
      }
    }
    state.undoStack.push(entry);
    if (state.undoStack.length > 40) state.undoStack.shift();
  }

  function setStatus(msg, kind) {
    var el = $("rig-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "rig-status" + (kind ? " " + kind : "");
  }

  /** Image used for display / mesh texturing. Pose uses cutout ONLY (never full BG). */
  function getRenderImage() {
    if (state.mode === "pose") {
      // Hard rule: pose mesh must not texture the uncut background image.
      return state.cutoutReady ? state.cutoutImage || null : null;
    }
    if (state.eraseTool || state.showCutoutInEdit) {
      if (state.workCanvas) return state.workCanvas;
      if (state.cutoutImage) return state.cutoutImage;
    }
    return state.image;
  }

  function clearCutout() {
    state.cutoutImage = null;
    state.cutoutMethod = "";
    state.cutoutReady = false;
    state.cutoutFailReason = "";
    state.workCanvas = null;
    state.eraseTool = null;
    state.eraseDragging = false;
    state.eraseLast = null;
    state.cutting = false;
    state.cuttingPromise = null;
    updateCutoutUI();
  }

  function updateCutoutUI() {
    var shell = document.querySelector(".rig-shell");
    if (shell) {
      shell.classList.toggle("rig-has-cutout", !!state.cutoutReady);
      shell.classList.toggle("rig-cutout-draft", !!(state.cutoutImage || state.workCanvas) && !state.cutoutReady);
      shell.classList.toggle("rig-cutting", !!state.cutting);
      shell.classList.toggle("rig-erasing", state.eraseTool === "erase");
      shell.classList.toggle("rig-restoring", state.eraseTool === "restore");
    }
    var btn = $("rig-cutout");
    if (btn) {
      btn.disabled = !state.image || state.cutting;
      btn.textContent = state.cutting
        ? "Cutting…"
        : state.cutoutImage || state.workCanvas
          ? "Re-cut from background"
          : "Cut from background";
    }
    var badge = $("rig-cutout-badge");
    if (badge) {
      badge.classList.remove("err", "warn");
      if (state.cutoutReady && state.cutoutImage) {
        badge.hidden = false;
        badge.textContent =
          "Cutout: " +
          (state.cutoutMethod || "ready") +
          " — Pose unlocked";
      } else if ((state.cutoutImage || state.workCanvas) && !state.cutoutReady) {
        badge.hidden = false;
        badge.classList.add("warn");
        badge.textContent =
          "Cutout incomplete — Erase leftover BG" +
          (state.cutoutFailReason ? " (" + state.cutoutFailReason + ")" : "") +
          ". Pose blocked.";
      } else if (state.cutting) {
        badge.hidden = false;
        badge.textContent = "Cutting subject…";
      } else {
        badge.hidden = false;
        badge.classList.add("err");
        badge.textContent = "No cutout — Pose blocked (background must not warp)";
      }
    }
    var showCb = $("rig-show-cutout");
    if (showCb) showCb.checked = !!state.showCutoutInEdit;
    var eraseBtn = $("rig-erase");
    var restoreBtn = $("rig-restore");
    var brush = $("rig-brush-size");
    var canPaint = !!state.image && state.mode !== "pose" && !state.cutting;
    if (eraseBtn) {
      eraseBtn.disabled = !canPaint;
      eraseBtn.classList.toggle("rig-tool-active", state.eraseTool === "erase");
    }
    if (restoreBtn) {
      restoreBtn.disabled = !canPaint || !(state.workCanvas || state.cutoutImage);
      restoreBtn.classList.toggle("rig-tool-active", state.eraseTool === "restore");
    }
    if (brush) {
      brush.disabled = !canPaint;
      brush.value = String(state.brushSize);
    }
    var brushLab = $("rig-brush-label");
    if (brushLab) brushLab.textContent = String(state.brushSize);
  }

  function blobToImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("cutout image load failed"));
      };
      img.src = url;
    });
  }

  function canvasToImage(canvas) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (blob) {
          if (!blob) {
            // Fallback via data URL
            var img = new Image();
            img.onload = function () {
              resolve(img);
            };
            img.onerror = reject;
            img.src = canvas.toDataURL("image/png");
            return;
          }
          blobToImage(blob).then(resolve, reject);
        }, "image/png");
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Zero RGB where alpha is low so accidental samples stay empty (checkerboard).
   * Also returns {opaque, cleared, borderClearFrac} stats.
   */
  function scrubAndMeasureCutout(img) {
    var w0 = img.naturalWidth || img.width;
    var h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) throw new Error("empty cutout");
    var c = document.createElement("canvas");
    c.width = w0;
    c.height = h0;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, w0, h0);
    ctx.drawImage(img, 0, 0, w0, h0);
    var id = ctx.getImageData(0, 0, w0, h0);
    var d = id.data;
    var opaque = 0;
    var cleared = 0;
    var borderClear = 0;
    var borderTotal = 0;
    var x, y, i, a;
    for (y = 0; y < h0; y++) {
      for (x = 0; x < w0; x++) {
        i = (y * w0 + x) * 4;
        a = d[i + 3];
        if (a < CUTOUT_ALPHA_MIN) {
          d[i] = 0;
          d[i + 1] = 0;
          d[i + 2] = 0;
          d[i + 3] = 0;
          cleared++;
        } else {
          opaque++;
        }
        if (x === 0 || y === 0 || x === w0 - 1 || y === h0 - 1) {
          borderTotal++;
          if (a < CUTOUT_ALPHA_MIN) borderClear++;
        }
      }
    }
    ctx.putImageData(id, 0, 0);
    return {
      canvas: c,
      opaque: opaque,
      cleared: cleared,
      fracClear: cleared / (w0 * h0),
      borderClearFrac: borderTotal ? borderClear / borderTotal : 0,
      w: w0,
      h: h0,
    };
  }

  /** Reject cutouts that still contain most of the background plate. */
  function validateCutoutStats(stats, method) {
    if (!stats || stats.opaque < 64) {
      return "cutout has no visible subject";
    }
    if (stats.fracClear < 0.08) {
      return "cutout left almost no transparent pixels (background still present)";
    }
    if (stats.fracClear > 0.97) {
      return "cutout removed nearly everything";
    }
    // Border should be largely empty — otherwise posters/floor remain attached
    if (stats.borderClearFrac < 0.45) {
      return "cutout border still opaque (background not removed)";
    }
    return null;
  }

  function imageHasUsefulAlpha(img) {

    try {
      var w0 = img.naturalWidth || img.width;
      var h0 = img.naturalHeight || img.height;
      if (!w0 || !h0) return false;
      var max = 256;
      var s = Math.min(1, max / Math.max(w0, h0));
      var w = Math.max(1, Math.round(w0 * s));
      var h = Math.max(1, Math.round(h0 * s));
      var c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      var ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      var d = ctx.getImageData(0, 0, w, h).data;
      var t = 0;
      for (var i = 3; i < d.length; i += 4) {
        if (d[i] < 240) t++;
      }
      return t > w * h * 0.02;
    } catch (e) {
      return false;
    }
  }

  function colorDist(r0, g0, b0, r1, g1, b1) {
    var dr = r0 - r1;
    var dg = g0 - g1;
    var db = b0 - b1;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  /**
   * Client-side fallback: edge flood-fill of near-uniform / plate-like background.
   * Works well for studio plates & simple BGs; complex photos may leave more BG.
   */
  function canvasFloodCutout(img) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h) return Promise.reject(new Error("empty image"));
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    var id = ctx.getImageData(0, 0, w, h);
    var d = id.data;

    // Sample border mean
    var mr = 0,
      mg = 0,
      mb = 0,
      n = 0;
    var step = Math.max(1, (Math.min(w, h) / 24) | 0);
    var x, y, i;
    function sample(sx, sy) {
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
      var ii = (sy * w + sx) * 4;
      if (d[ii + 3] < 8) return;
      mr += d[ii];
      mg += d[ii + 1];
      mb += d[ii + 2];
      n++;
    }
    for (x = 0; x < w; x += step) {
      sample(x, 0);
      sample(x, 1);
      sample(x, h - 1);
      sample(x, h - 2);
    }
    for (y = 0; y < h; y += step) {
      sample(0, y);
      sample(1, y);
      sample(w - 1, y);
      sample(w - 2, y);
    }
    if (n < 4) return Promise.reject(new Error("could not sample background"));
    mr = (mr / n) | 0;
    mg = (mg / n) | 0;
    mb = (mb / n) | 0;

    // Border chroma variance — if very mixed, still try with tighter thresh
    var varSum = 0;
    var vn = 0;
    function varSample(sx, sy) {
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
      var ii = (sy * w + sx) * 4;
      if (d[ii + 3] < 8) return;
      varSum += colorDist(d[ii], d[ii + 1], d[ii + 2], mr, mg, mb);
      vn++;
    }
    for (x = 0; x < w; x += step * 2) {
      varSample(x, 0);
      varSample(x, h - 1);
    }
    for (y = 0; y < h; y += step * 2) {
      varSample(0, y);
      varSample(w - 1, y);
    }
    var meanVar = vn ? varSum / vn : 40;
    var thresh = meanVar < 18 ? 42 : meanVar < 35 ? 34 : 28;

    function isBg(ii) {
      var r = d[ii],
        g = d[ii + 1],
        b = d[ii + 2];
      var chroma = Math.max(r, g, b) - Math.min(r, g, b);
      var dist = colorDist(r, g, b, mr, mg, mb);
      if (dist < thresh) return true;
      if (chroma <= 20 && dist < thresh + 14) return true;
      // Near-white / near-black plates
      var lum = (r + g + b) / 3;
      if (chroma <= 16 && lum >= 200 && dist < 70) return true;
      if (chroma <= 14 && lum <= 28 && dist < 50) return true;
      return false;
    }

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
      if (!isBg(ii)) return;
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
    }

    // Soften fringe: any opaque pixel neighboring cleared BG → slight alpha drop
    var soft = new Uint8ClampedArray(d);
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        var p = y * w + x;
        var ii = p * 4;
        if (d[ii + 3] === 0) continue;
        var cleared = 0;
        if (d[((y - 1) * w + x) * 4 + 3] === 0) cleared++;
        if (d[((y + 1) * w + x) * 4 + 3] === 0) cleared++;
        if (d[(y * w + (x - 1)) * 4 + 3] === 0) cleared++;
        if (d[(y * w + (x + 1)) * 4 + 3] === 0) cleared++;
        if (cleared >= 1) soft[ii + 3] = Math.min(soft[ii + 3], cleared >= 2 ? 120 : 200);
      }
    }
    for (i = 0; i < d.length; i++) d[i] = soft[i];

    // Quality gate: need meaningful cut without deleting the subject
    var cleared = 0;
    var opaque = 0;
    for (i = 3; i < d.length; i += 4) {
      if (d[i] < 8) cleared++;
      else opaque++;
    }
    var frac = cleared / (w * h);
    if (frac < 0.04 || frac > 0.92 || opaque < w * h * 0.04) {
      return Promise.reject(new Error("flood cutout quality check failed"));
    }

    ctx.putImageData(id, 0, 0);
    state.cutoutMethod = "flood";
    return canvasToImage(c);
  }

  var _imglyMod = null;
  var IMGLY_URLS = [
    "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/browser.mjs",
    "https://esm.sh/@imgly/background-removal@1.7.0/dist/browser.mjs",
  ];

  function loadImglyModule() {
    if (_imglyMod) return Promise.resolve(_imglyMod);
    var i = 0;
    function next() {
      if (i >= IMGLY_URLS.length) {
        return Promise.reject(new Error("imgly module unavailable"));
      }
      var url = IMGLY_URLS[i++];
      return import(url)
        .then(function (mod) {
          _imglyMod = mod;
          return mod;
        })
        .catch(function () {
          return next();
        });
    }
    return next();
  }

  function tryImglyCutout(img) {
    return loadImglyModule().then(function (mod) {
      var removeBackground = mod.default || mod.removeBackground;
      if (typeof removeBackground !== "function") {
        throw new Error("imgly removeBackground missing");
      }
      setStatus("AI cutout loading model (first time may take a bit)…", "");
      return removeBackground(img, {
        model: "small",
        output: { format: "image/png", quality: 0.9 },
        progress: function (key, current, total) {
          if (!total) return;
          var pct = Math.max(0, Math.min(100, Math.round((100 * current) / total)));
          setStatus("Cutting background… " + key + " " + pct + "%", "");
        },
      }).then(function (blob) {
        state.cutoutMethod = "imgly";
        return blobToImage(blob);
      });
    });
  }

  function cloneCanvas(src) {
    var c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    c.getContext("2d").drawImage(src, 0, 0);
    return c;
  }

  function adoptWorkCanvas(canvas) {
    if (!canvas) {
      state.workCanvas = null;
      return;
    }
    state.workCanvas = cloneCanvas(canvas);
  }

  function measureFromWorkOrImage(imgOrCanvas) {
    return scrubAndMeasureCutout(imgOrCanvas);
  }

  function applyCutoutStats(stats, method, bad) {
    adoptWorkCanvas(stats.canvas);
    state.cutoutMethod = method || state.cutoutMethod || "";
    state.cutoutFailReason = bad || "";
    state.cutoutReady = !bad;
    return canvasToImage(stats.canvas).then(function (cleanImg) {
      state.cutoutImage = cleanImg;
      updateCutoutUI();
      return !bad;
    });
  }

  /** Seed a full-plate working cutout so Erase can clear BG by hand. */
  function seedManualWorkingCutout() {
    if (!state.image) return Promise.resolve(false);
    var src = state.image;
    var w = src.naturalWidth || src.width;
    var h = src.naturalHeight || src.height;
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(src, 0, 0);
    var stats = scrubAndMeasureCutout(c);
    // Full plate will fail quality — keep as draft for erase
    var bad = validateCutoutStats(stats, "manual") || "manual erase needed";
    state.cutoutMethod = "manual";
    state.showCutoutInEdit = true;
    return applyCutoutStats(stats, "manual", bad).then(function () {
      return false;
    });
  }

  function ensureWorkCanvas() {
    if (state.workCanvas) return Promise.resolve(true);
    if (state.cutoutImage) {
      var img = state.cutoutImage;
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0);
      state.workCanvas = c;
      return Promise.resolve(true);
    }
    return seedManualWorkingCutout().then(function () {
      return !!state.workCanvas;
    });
  }

  /** Commit workCanvas → cutoutImage and re-run quality gate. */
  function syncCutoutFromWork() {
    if (!state.workCanvas) {
      return Promise.resolve(false);
    }
    var stats = scrubAndMeasureCutout(state.workCanvas);
    // put scrubbed pixels back into work canvas
    adoptWorkCanvas(stats.canvas);
    var method = state.cutoutMethod || "manual";
    if (method === "imgly" || method === "flood" || method === "alpha") {
      method = method + "+erase";
    } else if (!method || method === "") {
      method = "manual";
    }
    var bad = validateCutoutStats(stats, method);
    return applyCutoutStats(stats, method, bad).then(function (ok) {
      draw();
      if (ok) {
        setStatus(
          "Cutout quality OK (" +
            (state.cutoutMethod || "ok") +
            "). Pose unlocked — only the figure will deform.",
          "ok"
        );
      } else {
        setStatus(
          "Still blocked: " +
            (bad || "need more transparent BG") +
            ". Keep erasing posters/floor, then try Pose.",
          "warn"
        );
      }
      return ok;
    });
  }

  function canvasPtToImage(cx, cy) {
    var wc = state.workCanvas;
    if (!wc || !state.canvasW || !state.canvasH) return { x: 0, y: 0 };
    return {
      x: (cx / state.canvasW) * wc.width,
      y: (cy / state.canvasH) * wc.height,
    };
  }

  function brushRadiusImage() {
    var wc = state.workCanvas;
    if (!wc || !state.canvasW) return state.brushSize;
    return Math.max(1, (state.brushSize * wc.width) / state.canvasW);
  }

  function paintEraseDab(ix, iy, from) {
    var wc = state.workCanvas;
    if (!wc) return;
    var ctx = wc.getContext("2d");
    var r = brushRadiusImage();
    function restoreAt(x, y) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(state.image, 0, 0, wc.width, wc.height);
      ctx.restore();
    }
    if (state.eraseTool === "restore" && state.image) {
      if (from) {
        var dx = ix - from.x;
        var dy = iy - from.y;
        var dist = Math.hypot(dx, dy);
        var step = Math.max(1, r * 0.45);
        var n = Math.max(1, Math.ceil(dist / step));
        for (var s = 1; s <= n; s++) {
          restoreAt(from.x + (dx * s) / n, from.y + (dy * s) / n);
        }
      } else {
        restoreAt(ix, iy);
      }
      return;
    }
    // Erase → transparent
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = r * 2;
    if (from) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(ix, iy);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(ix, iy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function setEraseTool(tool) {
    if (state.mode === "pose") {
      setStatus("Switch to Edit bones to erase background.", "warn");
      return;
    }
    if (!state.image) {
      setStatus("Load an image first.", "warn");
      return;
    }
    if (state.eraseTool === tool) {
      state.eraseTool = null;
      updateCutoutUI();
      draw();
      setStatus("Erase tool off — drag joints again.", "");
      return;
    }
    ensureWorkCanvas().then(function (ok) {
      if (!ok) {
        setStatus("Could not start working cutout for erase.", "err");
        return;
      }
      state.eraseTool = tool;
      state.showCutoutInEdit = true;
      var showCb = $("rig-show-cutout");
      if (showCb) showCb.checked = true;
      updateCutoutUI();
      draw();
      setStatus(
        tool === "restore"
          ? "Restore: paint to bring original pixels back. Brush size adjusts dab."
          : "Erase: paint to clear background (transparent). Clear posters/floor until Pose unlocks.",
        "ok"
      );
    });
  }

  /**
   * Produce alpha cutout of the subject. Prefers @imgly/background-removal (free,
   * in-browser), then canvas edge flood-fill. Reuses existing alpha if present.
   */
  function ensureCutout(force) {
    if (!state.image) return Promise.resolve(false);
    if (!force && state.cutoutReady && state.cutoutImage) return Promise.resolve(true);
    if (state.cutting && state.cuttingPromise) return state.cuttingPromise;

    state.cutting = true;
    updateCutoutUI();
    setStatus("Cutting subject from background…", "");

    var src = state.image;
    var work = Promise.resolve()
      .then(function () {
        if (!force && imageHasUsefulAlpha(src)) {
          state.cutoutMethod = "alpha";
          // Clone via canvas so we own a stable bitmap
          var w = src.naturalWidth || src.width;
          var h = src.naturalHeight || src.height;
          var c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          c.getContext("2d").drawImage(src, 0, 0);
          return canvasToImage(c);
        }
        return tryImglyCutout(src).catch(function (err) {
          console.warn("[rig] imgly cutout failed, trying flood-fill", err);
          setStatus("AI cutout unavailable — trying edge flood-fill…", "warn");
          return canvasFloodCutout(src);
        });
      })
      .then(function (cutImg) {
        var stats = scrubAndMeasureCutout(cutImg);
        var method = state.cutoutMethod || "ok";
        var bad = validateCutoutStats(stats, method);
        state.cutting = false;
        state.cuttingPromise = null;
        state.showCutoutInEdit = true;
        var showCb = $("rig-show-cutout");
        if (showCb) showCb.checked = true;
        return applyCutoutStats(stats, method, bad).then(function (ok) {
          draw();
          if (ok) {
            setStatus(
              "Cutout ready (" +
                (state.cutoutMethod || "ok") +
                "). Pose deforms only the figure — background stays put.",
              "ok"
            );
            return true;
          }
          setStatus(
            "Auto cut incomplete: " +
              bad +
              ". Use Erase to clear leftover BG, then Pose.",
            "warn"
          );
          return false;
        });
      })
      .catch(function (err) {
        console.warn("[rig] cutout failed", err);
        state.cutting = false;
        state.cuttingPromise = null;
        var msg = (err && err.message) || "Try Re-cut / simpler BG.";
        return seedManualWorkingCutout().then(function () {
          updateCutoutUI();
          draw();
          setStatus(
            "Cutout failed (" +
              msg +
              "). Use Erase to clear background manually, then Pose. Background must NOT warp.",
            "err"
          );
          return false;
        });
      });

    state.cuttingPromise = work;
    return work;
  }

  function jointById(id) {
    for (var i = 0; i < state.joints.length; i++) {
      if (state.joints[i].id === id) return state.joints[i];
    }
    return null;
  }

  function jointInList(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function parentOf(id) {
    for (var i = 0; i < state.bones.length; i++) {
      if (state.bones[i][1] === id) return state.bones[i][0];
    }
    return null;
  }

  function childrenOf(id) {
    var out = [];
    for (var i = 0; i < state.bones.length; i++) {
      if (state.bones[i][0] === id) out.push(state.bones[i][1]);
    }
    return out;
  }

  function descendantsOf(id) {
    var out = [];
    function walk(cur) {
      var kids = childrenOf(cur);
      for (var i = 0; i < kids.length; i++) {
        out.push(kids[i]);
        walk(kids[i]);
      }
    }
    walk(id);
    return out;
  }

  function updateModeUI() {
    var editBtn = $("rig-mode-edit");
    var poseBtn = $("rig-mode-pose");
    if (editBtn) editBtn.classList.toggle("active", state.mode === "edit");
    if (poseBtn) poseBtn.classList.toggle("active", state.mode === "pose");
    var shell = document.querySelector(".rig-shell");
    if (shell) shell.classList.toggle("rig-mode-pose", state.mode === "pose");
    var hint = $("rig-mode-hint");
    if (hint) {
      hint.textContent =
        state.mode === "pose"
          ? "Pose: drag joints — children follow (FK). Per-bone meshes deform independently (2.5D layers). Reset Pose returns to bind."
          : "Edit bones: drag joints to set the bind pose. Cut from background (or Erase leftover BG by hand) — Pose unlocks when cutout quality passes.";
    }
    var toolbar = $("rig-toolbar-hint");
    if (toolbar) {
      toolbar.textContent =
        state.mode === "pose"
          ? "Pose · per-bone segments · front limb slides over body · Rebuild after bone tweaks"
          : state.eraseTool === "erase"
            ? "Erase background · paint transparent · Brush size · Undo strokes · Pose when quality OK"
            : state.eraseTool === "restore"
              ? "Restore · paint original pixels back · Brush size · Undo"
              : "Edit bones · Cut / Erase BG · then Pose — only the figure warps";
    }
    var resetPose = $("rig-reset-pose");
    if (resetPose) resetPose.disabled = state.mode !== "pose";
    var rebuildBtn = $("rig-rebuild-segments");
    if (rebuildBtn) {
      rebuildBtn.disabled = !state.cutoutReady || !state.cutoutImage || !state.bones.length;
    }
    var frontBtn = $("rig-front-side");
    if (frontBtn) {
      frontBtn.textContent = "Front: " + (state.frontSide === "left" ? "Left" : "Right");
    }
    // Dim edit-only controls in pose
    ["rig-add-joint", "rig-add-bone", "rig-remove-bones", "rig-reset", "rig-new-joint"].forEach(function (id) {
      var el = $(id);
      if (el) el.disabled = state.mode === "pose";
    });
    updateCutoutUI();
  }

  function finishEnterPose() {
    if (!state.cutoutReady || !state.cutoutImage) {
      setStatus(
        "Pose blocked: cutout required. Cut from background, or Erase leftover BG until quality passes.",
        "err"
      );
      updateModeUI();
      return false;
    }
    state.eraseTool = null;
    state.bindJoints = cloneJoints(state.joints);
    buildSkinMesh();
    if (!meshHasGeometry(state.mesh)) {
      setStatus(
        "Pose blocked: no opaque segment triangles. Re-cut / rebuild segments, then try again.",
        "err"
      );
      state.mesh = null;
      updateModeUI();
      return false;
    }
    state.mode = "pose";
    state.selectedId = state.joints[0] ? state.selectedId || state.joints[0].id : null;
    if (!jointById(state.selectedId)) {
      state.selectedId = state.joints[0] ? state.joints[0].id : null;
    }
    updateModeUI();
    renderJointList();
    fillBoneSelects();
    draw();
    var nSeg = state.mesh.segments ? state.mesh.segments.length : 0;
    var nProp = 0;
    if (state.mesh.segments) {
      for (var si = 0; si < state.mesh.segments.length; si++) {
        if (state.mesh.segments[si].isProp) nProp++;
      }
    }
    setStatus(
      "Pose mode: " +
        nSeg +
        " bone segments (" +
        meshTriCount(state.mesh) +
        " tris" +
        (nProp ? ", " + nProp + " prop(s)" : "") +
        ") — limbs slide over body, no torso rubber-warp. Front: " +
        state.frontSide +
        ".",
      "ok"
    );
    return true;
  }

  function setMode(mode) {
    if (mode !== "edit" && mode !== "pose") return;
    if (mode === state.mode) {
      updateModeUI();
      return;
    }
    if (mode === "pose") {
      if (!state.image) {
        setStatus("Load an image before posing.", "warn");
        return;
      }
      if (!state.joints.length) {
        setStatus("Need joints before posing.", "warn");
        return;
      }
      // Hard gate: never enter Pose until cutout quality passes
      if (!state.cutoutReady) {
        if (!state.cutoutImage && !state.workCanvas) {
          setStatus("Cutting subject from background before Pose…", "");
          ensureCutout(false).then(function (ok) {
            if (ok && state.cutoutReady) {
              finishEnterPose();
              return;
            }
            setStatus(
              "Pose blocked — cutout incomplete. Use Erase to clear leftover BG, then Pose.",
              "err"
            );
            updateModeUI();
          });
          return;
        }
        setStatus("Checking cutout quality…", "");
        syncCutoutFromWork().then(function (ok) {
          if (ok && state.cutoutReady) {
            finishEnterPose();
            return;
          }
          setStatus(
            "Pose blocked — " +
              (state.cutoutFailReason || "need more transparent BG") +
              ". Keep erasing, then Pose.",
            "err"
          );
          updateModeUI();
        });
        return;
      }
      finishEnterPose();
    } else {
      // Return to editing the bind pose
      if (state.bindJoints.length) {
        state.joints = cloneJoints(state.bindJoints);
      }
      state.mode = "edit";
      state.mesh = null;
      setStatus("Edit bones: adjust bind pose, then switch to Pose to move.", "");
      state.selectedId = state.joints[0] ? state.selectedId || state.joints[0].id : null;
      if (!jointById(state.selectedId)) {
        state.selectedId = state.joints[0] ? state.joints[0].id : null;
      }
      updateModeUI();
      renderJointList();
      fillBoneSelects();
      draw();
    }
  }

  function resetPose() {
    if (state.mode !== "pose") {
      setStatus("Switch to Pose mode first.", "warn");
      return;
    }
    if (!state.bindJoints.length) {
      setStatus("No bind pose locked yet.", "warn");
      return;
    }
    pushUndo();
    state.joints = cloneJoints(state.bindJoints);
    draw();
    setStatus("Pose reset to bind.", "ok");
  }

  function resetToTemplate() {
    if (state.mode === "pose") {
      setStatus("Switch to Edit bones to reset the template.", "warn");
      return;
    }
    pushUndo();
    state.joints = cloneJoints(TEMPLATE_JOINTS);
    state.bones = cloneBones(TEMPLATE_BONES);
    state.bindJoints = [];
    state.mesh = null;
    state.selectedId = "hips";
    renderJointList();
    fillBoneSelects();
    draw();
    setStatus("Reset to human starter template.", "ok");
  }

  function loadImageFromUrl(url, meta) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        state.image = img;
        state.imageSrc = url;
        state.imageName = (meta && meta.name) || url.split("/").pop() || "image";
        state.imageKind = (meta && meta.kind) || "url";
        if (meta && meta.paintingNum != null) state.paintingNum = meta.paintingNum;
        clearCutout();
        fitCanvas();
        $("rig-empty").hidden = true;
        if (state.mode === "pose") {
          // Re-cut for the new image; leave Pose if cutout fails (never warp full BG)
          ensureCutout(false).then(function (ok) {
            if (!ok || !state.cutoutReady) {
              state.mode = "edit";
              state.mesh = null;
              updateModeUI();
              setStatus(
                "Cutout incomplete on new image — back in Edit. Erase leftover BG or Re-cut before Pose.",
                "err"
              );
              draw();
              return;
            }
            state.bindJoints = cloneJoints(state.joints);
            buildSkinMesh();
            draw();
          });
        } else {
          state.mesh = null;
        }
        draw();
        setStatus(
          "Loaded " +
            state.imageName +
            (state.mode === "pose"
              ? " — cutting subject, then pose."
              : " — place bones, Cut from background (or auto on Pose)."),
          "ok"
        );
        resolve(true);
      };
      img.onerror = function () {
        setStatus("Failed to load image.", "err");
        resolve(false);
      };
      img.src = url;
    });
  }

  function fitCanvas() {
    var wrap = $("rig-stage");
    var canvas = $("rig-canvas");
    if (!wrap || !canvas || !state.image) return;
    var maxW = Math.max(280, wrap.clientWidth - 8);
    var maxH = Math.max(220, wrap.clientHeight - 8);
    var iw = state.image.naturalWidth || state.image.width;
    var ih = state.image.naturalHeight || state.image.height;
    var s = Math.min(maxW / iw, maxH / ih, 1.5);
    state.scale = s;
    state.canvasW = Math.round(iw * s);
    state.canvasH = Math.round(ih * s);
    state.offsetX = 0;
    state.offsetY = 0;
    canvas.width = state.canvasW;
    canvas.height = state.canvasH;
    canvas.style.width = state.canvasW + "px";
    canvas.style.height = state.canvasH + "px";
    if (state.mode === "pose" && state.bindJoints.length) {
      buildSkinMesh();
    }
  }

  function normToCanvas(nx, ny) {
    return {
      x: nx * state.canvasW,
      y: ny * state.canvasH,
    };
  }

  function canvasToNorm(cx, cy) {
    return {
      x: Math.max(0, Math.min(1, cx / state.canvasW)),
      y: Math.max(0, Math.min(1, cy / state.canvasH)),
    };
  }

  function eventToCanvas(e) {
    var canvas = $("rig-canvas");
    var rect = canvas.getBoundingClientRect();
    var clientX = e.clientX;
    var clientY = e.clientY;
    if (e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function hitJoint(cx, cy) {
    var best = null;
    var bestD = HIT_R * HIT_R;
    for (var i = 0; i < state.joints.length; i++) {
      var j = state.joints[i];
      var p = normToCanvas(j.x, j.y);
      var dx = p.x - cx;
      var dy = p.y - cy;
      var d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  }

  /** Distance from point to segment (normalized space). */
  function distToSegment(px, py, ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = 0;
    if (len2 > 1e-12) {
      t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    }
    var qx = ax + t * dx;
    var qy = ay + t * dy;
    return Math.hypot(px - qx, py - qy);
  }

  function boneKind(fromId, toId) {
    var id = String(toId || "");
    var from = String(fromId || "");
    if (/hand/i.test(id)) return "hand";
    if (/forearm|lower.?arm/i.test(id)) return "forearm";
    if (/upper.?arm|shoulder/i.test(id)) return "upper_arm";
    if (/foot|ankle/i.test(id)) return "foot";
    if (/shin|lower.?leg|calf/i.test(id)) return "shin";
    if (/thigh|upper.?leg|hip/i.test(id) && id !== "hips") return "thigh";
    if (id === "head" || /head/i.test(id)) return "head";
    if (id === "neck" || /neck/i.test(id)) return "neck";
    if (
      id === "chest" ||
      id === "spine" ||
      id === "hips" ||
      from === "hips" ||
      /spine|torso|pelvis|chest/i.test(id) ||
      /spine|torso|pelvis|chest/i.test(from)
    ) {
      return "torso";
    }
    return "limb";
  }

  function boneSideFromIds(fromId, toId) {
    var s = String(toId || "") + " " + String(fromId || "");
    if (/\bl_/.test(s) || /\bleft\b/i.test(s)) return "l";
    if (/\br_/.test(s) || /\bright\b/i.test(s)) return "r";
    return "c";
  }

  function radiusForKind(kind) {
    if (kind === "hand") return SEG_HAND_R;
    if (kind === "foot") return SEG_FOOT_R;
    if (kind === "head" || kind === "neck") return SEG_HEAD_R;
    if (kind === "torso") return SEG_TORSO_R;
    if (kind === "forearm" || kind === "upper_arm" || kind === "shin" || kind === "thigh" || kind === "limb") {
      return SEG_LIMB_R;
    }
    return SEG_LIMB_R;
  }

  /** Draw-order key: back limbs → torso → head → front limbs → props. */
  function segmentDrawOrder(kind, side, isProp) {
    var front = state.frontSide === "left" ? "l" : "r";
    var back = front === "l" ? "r" : "l";
    var base;
    if (isProp) {
      base = 900;
    } else if (kind === "torso") {
      base = 400;
    } else if (kind === "neck") {
      base = 500;
    } else if (kind === "head") {
      base = 510;
    } else if (side === back) {
      if (kind === "upper_arm") base = 100;
      else if (kind === "forearm") base = 110;
      else if (kind === "hand") base = 120;
      else if (kind === "thigh") base = 200;
      else if (kind === "shin") base = 210;
      else if (kind === "foot") base = 220;
      else base = 150;
    } else if (side === front) {
      if (kind === "thigh") base = 700;
      else if (kind === "shin") base = 710;
      else if (kind === "foot") base = 720;
      else if (kind === "upper_arm") base = 800;
      else if (kind === "forearm") base = 810;
      else if (kind === "hand") base = 820;
      else base = 750;
    } else {
      // center / unknown limbs sit with torso band
      base = 450;
    }
    return base;
  }

  function meshTriCount(mesh) {
    if (!mesh) return 0;
    if (mesh.segments && mesh.segments.length) {
      var n = 0;
      for (var i = 0; i < mesh.segments.length; i++) {
        n += (mesh.segments[i].tris && mesh.segments[i].tris.length) || 0;
      }
      return n;
    }
    return (mesh.tris && mesh.tris.length) || 0;
  }

  function meshHasGeometry(mesh) {
    return meshTriCount(mesh) > 0;
  }

  /**
   * Sample cutout alpha into a grid matching mesh resolution.
   * Returns Float32Array length (cols+1)*(rows+1) with 0..1 opacity, or null.
   */
  function sampleCutoutAlphaGrid(cols, rows) {
    var img = state.cutoutImage;
    if (!img) return null;
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    if (!iw || !ih) return null;
    var c = document.createElement("canvas");
    c.width = cols + 1;
    c.height = rows + 1;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    var data = ctx.getImageData(0, 0, c.width, c.height).data;
    var out = new Float32Array((cols + 1) * (rows + 1));
    for (var i = 0, p = 0; i < data.length; i += 4, p++) {
      out[p] = data[i + 3] / 255;
    }
    return out;
  }

  /** Rigid single-bone weight (segment only follows its own bone). */
  function rigidBoneWeights(boneIndex) {
    return [{ bone: boneIndex, w: 1 }];
  }

  /**
   * Soft 1–2 bone bind along a segment axis: mostly this bone, slight parent blend near proximal end.
   * Still never bleeds to unrelated bones (no global nearest-of-all).
   */
  function chainBoneWeights(x, y, boneIndex, parentBoneIndex, bind, bones) {
    if (parentBoneIndex < 0) return rigidBoneWeights(boneIndex);
    var bone = bones[boneIndex];
    if (!bone) return rigidBoneWeights(boneIndex);
    var a = jointInList(bind, bone[0]);
    var b = jointInList(bind, bone[1]);
    if (!a || !b) return rigidBoneWeights(boneIndex);
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    var t = 0.5;
    if (len2 > 1e-12) {
      t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    }
    // Near parent joint (t~0) blend a little with parent bone; distal end fully this bone
    var wParent = (1 - t) * 0.35;
    var wSelf = 1 - wParent;
    if (wParent < 0.05) return rigidBoneWeights(boneIndex);
    return [
      { bone: boneIndex, w: wSelf },
      { bone: parentBoneIndex, w: wParent },
    ];
  }

  function findParentBoneIndex(bones, boneIndex) {
    var bone = bones[boneIndex];
    if (!bone) return -1;
    var parentJoint = bone[0];
    for (var i = 0; i < bones.length; i++) {
      if (i === boneIndex) continue;
      if (bones[i][1] === parentJoint) return i;
    }
    return -1;
  }

  function buildTrisFromOwnerMask(owner, boneIndex, cols, rows, alpha, bind, bones, parentBoneIndex, kind) {
    var stride = cols + 1;
    var thresh = CUTOUT_ALPHA_MIN / 255;
    var keep = new Uint8Array(stride * (rows + 1));
    var r, c, idx;

    for (r = 0; r <= rows; r++) {
      for (c = 0; c <= cols; c++) {
        idx = r * stride + c;
        if (owner[idx] === boneIndex + 1 && alpha[idx] >= thresh * 0.35) keep[idx] = 1;
      }
    }
    // Dilate one pixel so silhouette edges stay connected
    var keep2 = new Uint8Array(keep);
    for (r = 0; r <= rows; r++) {
      for (c = 0; c <= cols; c++) {
        idx = r * stride + c;
        if (keep[idx]) continue;
        if (owner[idx] !== boneIndex + 1 && owner[idx] !== 0) continue;
        var n =
          (r > 0 && keep[idx - stride]) ||
          (r < rows && keep[idx + stride]) ||
          (c > 0 && keep[idx - 1]) ||
          (c < cols && keep[idx + 1]);
        if (n && alpha[idx] >= thresh * 0.15) keep2[idx] = 1;
      }
    }
    keep = keep2;

    var oldToNew = new Int32Array(stride * (rows + 1));
    for (var i = 0; i < oldToNew.length; i++) oldToNew[i] = -1;
    var verts = [];
    for (r = 0; r <= rows; r++) {
      for (c = 0; c <= cols; c++) {
        idx = r * stride + c;
        if (!keep[idx]) continue;
        var x = c / cols;
        var y = r / rows;
        oldToNew[idx] = verts.length;
        var weights =
          kind === "hand" || kind === "prop" || kind === "torso" || kind === "head"
            ? rigidBoneWeights(boneIndex)
            : chainBoneWeights(x, y, boneIndex, parentBoneIndex, bind, bones);
        verts.push({
          x: x,
          y: y,
          u: x,
          v: y,
          a: alpha[idx],
          weights: weights,
        });
      }
    }

    var tris = [];
    function pushTri(ia, ib, ic) {
      var na = oldToNew[ia];
      var nb = oldToNew[ib];
      var nc = oldToNew[ic];
      if (na < 0 || nb < 0 || nc < 0) return;
      var aa = verts[na].a + verts[nb].a + verts[nc].a;
      if (aa < thresh * 1.0) return;
      tris.push([na, nb, nc]);
    }
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        var i0 = r * stride + c;
        var i1 = i0 + 1;
        var i2 = i0 + stride;
        var i3 = i2 + 1;
        var owned =
          owner[i0] === boneIndex + 1 ||
          owner[i1] === boneIndex + 1 ||
          owner[i2] === boneIndex + 1 ||
          owner[i3] === boneIndex + 1;
        if (!owned) continue;
        var cellA = (alpha[i0] + alpha[i1] + alpha[i2] + alpha[i3]) * 0.25;
        if (cellA < thresh * 0.4) continue;
        pushTri(i0, i1, i2);
        pushTri(i1, i3, i2);
      }
    }
    return { verts: verts, tris: tris };
  }

  /**
   * Build per-bone (and optional prop) cutout meshes.
   * Each opaque pixel is claimed by at most one bone capsule — limbs do not skin the torso.
   */
  function buildSkinMesh() {
    if (!state.bindJoints.length || !state.bones.length) {
      state.mesh = null;
      return;
    }
    if (!state.cutoutImage) {
      state.mesh = null;
      return;
    }
    var cols = MESH_COLS;
    var rows = MESH_ROWS;
    var alpha = sampleCutoutAlphaGrid(cols, rows);
    if (!alpha) {
      state.mesh = null;
      return;
    }
    var bind = state.bindJoints;
    var bones = state.bones;
    var stride = cols + 1;
    var thresh = CUTOUT_ALPHA_MIN / 255;
    var meta = [];
    var bi, kind, side, rad, fromId, toId, m, built, handBi, ci;

    for (bi = 0; bi < bones.length; bi++) {
      fromId = bones[bi][0];
      toId = bones[bi][1];
      kind = boneKind(fromId, toId);
      side = boneSideFromIds(fromId, toId);
      rad = radiusForKind(kind);
      // Hands: tighter focus on the hand joint (disk-ish capsule)
      if (kind === "hand") rad = SEG_HAND_R;
      meta.push({
        bone: bi,
        fromId: fromId,
        toId: toId,
        kind: kind,
        side: side,
        radius: rad,
        parentBone: findParentBoneIndex(bones, bi),
      });
    }

    // owner[idx] = boneIndex+1, or 0 unassigned / transparent
    var owner = new Int16Array(stride * (rows + 1));
    var bestDist = new Float32Array(stride * (rows + 1));
    for (var i = 0; i < bestDist.length; i++) bestDist[i] = 1e9;

    var r, c, idx, x, y, a;
    for (r = 0; r <= rows; r++) {
      for (c = 0; c <= cols; c++) {
        idx = r * stride + c;
        a = alpha[idx];
        if (a < thresh) continue;
        x = c / cols;
        y = r / rows;
        var bestBi = -1;
        var bestD = 1e9;
        var bestScore = 1e9;
        for (bi = 0; bi < meta.length; bi++) {
          var m = meta[bi];
          var ba = jointInList(bind, bones[m.bone][0]);
          var bb = jointInList(bind, bones[m.bone][1]);
          if (!ba || !bb) continue;
          var d = distToSegment(x, y, ba.x, ba.y, bb.x, bb.y);
          // Hands also claim a disk around the distal joint
          if (m.kind === "hand") {
            var dh = Math.hypot(x - bb.x, y - bb.y);
            if (dh < d) d = dh;
          }
          if (d > m.radius * SEG_SOFT) continue;
          // Prefer limbs over torso when both cover the pixel (stops arm bleed into chest)
          var score = d;
          if (m.kind === "torso") score += 0.012;
          if (m.kind === "hand") score -= 0.008;
          if (m.kind === "forearm" || m.kind === "upper_arm") score -= 0.004;
          if (m.kind === "thigh" || m.kind === "shin" || m.kind === "foot") score -= 0.004;
          if (score < bestScore) {
            bestScore = score;
            bestD = d;
            bestBi = m.bone;
          }
        }
        if (bestBi >= 0) {
          owner[idx] = bestBi + 1;
          bestDist[idx] = bestD;
        }
      }
    }

    // --- Prop detection: disconnected opaque blobs near hands ---
    var visited = new Uint8Array(stride * (rows + 1));
    var components = []; // {cells:[{idx,x,y}], cx, cy, count}

    function floodComponent(startIdx) {
      var stack = [startIdx];
      visited[startIdx] = 1;
      var cells = [];
      var sx = 0;
      var sy = 0;
      while (stack.length) {
        var cur = stack.pop();
        var cy = (cur / stride) | 0;
        var cx = cur - cy * stride;
        cells.push({ idx: cur, x: cx / cols, y: cy / rows });
        sx += cx / cols;
        sy += cy / rows;
        var neigh = [cur - 1, cur + 1, cur - stride, cur + stride];
        for (var ni = 0; ni < 4; ni++) {
          var nidx = neigh[ni];
          if (nidx < 0 || nidx >= visited.length) continue;
          if (visited[nidx]) continue;
          var ny = (nidx / stride) | 0;
          var nx = nidx - ny * stride;
          if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
          if (alpha[nidx] < thresh) continue;
          visited[nidx] = 1;
          stack.push(nidx);
        }
      }
      return {
        cells: cells,
        cx: sx / cells.length,
        cy: sy / cells.length,
        count: cells.length,
      };
    }

    for (r = 0; r <= rows; r++) {
      for (c = 0; c <= cols; c++) {
        idx = r * stride + c;
        if (visited[idx] || alpha[idx] < thresh) continue;
        components.push(floodComponent(idx));
      }
    }

    // Largest component = main body
    var mainCount = 0;
    for (i = 0; i < components.length; i++) {
      if (components[i].count > mainCount) mainCount = components[i].count;
    }

    var propOwnerBase = bones.length + 1; // synthetic ids for prop masks
    var props = []; // {handBone, ownerId, cells}

    function nearestHandBone(px, py) {
      var best = -1;
      var bestD = PROP_SEARCH_R;
      for (bi = 0; bi < meta.length; bi++) {
        if (meta[bi].kind !== "hand") continue;
        var hj = jointInList(bind, bones[meta[bi].bone][1]);
        if (!hj) continue;
        var d = Math.hypot(px - hj.x, py - hj.y);
        if (d < bestD) {
          bestD = d;
          best = meta[bi].bone;
        }
      }
      return best;
    }

    for (i = 0; i < components.length; i++) {
      var comp = components[i];
      if (comp.count >= mainCount) continue; // skip main body
      if (comp.count < PROP_MIN_CELLS) continue;
      var handBi = nearestHandBone(comp.cx, comp.cy);
      if (handBi < 0) continue;
      // Also require most cells near that hand
      var near = 0;
      var hj2 = jointInList(bind, bones[handBi][1]);
      for (var ci = 0; ci < comp.cells.length; ci++) {
        if (Math.hypot(comp.cells[ci].x - hj2.x, comp.cells[ci].y - hj2.y) <= PROP_SEARCH_R) near++;
      }
      if (near < comp.count * 0.45) continue;
      var propId = propOwnerBase + props.length;
      for (ci = 0; ci < comp.cells.length; ci++) {
        owner[comp.cells[ci].idx] = propId;
      }
      props.push({
        handBone: handBi,
        ownerId: propId,
        kind: "prop",
        side: boneSideFromIds(bones[handBi][0], bones[handBi][1]),
        cells: comp.cells,
      });
    }

    // Unassigned opaque near hand → fold into hand or prop
    for (r = 0; r <= rows; r++) {
      for (c = 0; c <= cols; c++) {
        idx = r * stride + c;
        if (alpha[idx] < thresh || owner[idx]) continue;
        x = c / cols;
        y = r / rows;
        handBi = nearestHandBone(x, y);
        if (handBi < 0) continue;
        owner[idx] = handBi + 1;
      }
    }

    var segments = [];
    for (bi = 0; bi < meta.length; bi++) {
      m = meta[bi];
      var built = buildTrisFromOwnerMask(
        owner,
        m.bone,
        cols,
        rows,
        alpha,
        bind,
        bones,
        m.parentBone,
        m.kind
      );
      if (!built.verts.length || !built.tris.length) continue;
      segments.push({
        id: m.fromId + "→" + m.toId,
        kind: m.kind,
        side: m.side,
        bone: m.bone,
        parentBone: m.parentBone,
        verts: built.verts,
        tris: built.tris,
        drawOrder: segmentDrawOrder(m.kind, m.side, false),
        isProp: false,
      });
    }

    // Prop meshes: separate mesh parented to hand bone (rigid follow)
    for (i = 0; i < props.length; i++) {
      var pr = props[i];
      var propMaskOwner = new Int16Array(owner.length);
      for (ci = 0; ci < pr.cells.length; ci++) {
        propMaskOwner[pr.cells[ci].idx] = pr.handBone + 1;
      }
      built = buildTrisFromOwnerMask(
        propMaskOwner,
        pr.handBone,
        cols,
        rows,
        alpha,
        bind,
        bones,
        -1,
        "prop"
      );
      if (!built.verts.length || !built.tris.length) continue;
      for (var vi = 0; vi < built.verts.length; vi++) {
        built.verts[vi].weights = rigidBoneWeights(pr.handBone);
      }
      segments.push({
        id: "prop:" + bones[pr.handBone][1] + ":" + i,
        kind: "prop",
        side: pr.side,
        bone: pr.handBone,
        parentBone: -1,
        verts: built.verts,
        tris: built.tris,
        drawOrder: segmentDrawOrder("prop", pr.side, true) + i,
        isProp: true,
      });
    }

    segments.sort(function (a, b) {
      return a.drawOrder - b.drawOrder;
    });

    if (!segments.length) {
      state.mesh = null;
      return;
    }

    // Flat tris/verts for legacy length checks / status
    var allTris = [];
    for (i = 0; i < segments.length; i++) {
      allTris = allTris.concat(segments[i].tris);
    }

    state.mesh = {
      segments: segments,
      tris: allTris,
      cutoutOnly: true,
      segmented: true,
      frontSide: state.frontSide,
    };
  }

  function rebuildSegments() {
    if (!state.cutoutReady || !state.cutoutImage) {
      setStatus("Cutout required before rebuilding segments.", "warn");
      return;
    }
    if (!state.bindJoints.length) {
      state.bindJoints = cloneJoints(state.joints);
    }
    if (!state.bones.length) {
      setStatus("Need bones before rebuilding segments.", "warn");
      return;
    }
    // Rebuild against current bind if in edit; in pose keep locked bind
    if (state.mode !== "pose") {
      state.bindJoints = cloneJoints(state.joints);
    }
    buildSkinMesh();
    var nSeg = state.mesh && state.mesh.segments ? state.mesh.segments.length : 0;
    var nTri = meshTriCount(state.mesh);
    if (!nTri) {
      setStatus("Rebuild failed — no opaque segment triangles. Adjust bones or cutout.", "err");
      draw();
      return;
    }
    var props = 0;
    if (state.mesh && state.mesh.segments) {
      for (var i = 0; i < state.mesh.segments.length; i++) {
        if (state.mesh.segments[i].isProp) props++;
      }
    }
    setStatus(
      "Rebuilt " +
        nSeg +
        " segments (" +
        nTri +
        " tris" +
        (props ? ", " + props + " prop(s)" : "") +
        "). Front side: " +
        state.frontSide +
        ".",
      "ok"
    );
    draw();
  }

  function toggleFrontSide() {
    state.frontSide = state.frontSide === "left" ? "right" : "left";
    var btn = $("rig-front-side");
    if (btn) {
      btn.textContent = "Front: " + (state.frontSide === "left" ? "Left" : "Right");
    }
    if (state.mesh && state.mesh.segments) {
      for (var i = 0; i < state.mesh.segments.length; i++) {
        var seg = state.mesh.segments[i];
        seg.drawOrder = segmentDrawOrder(seg.kind, seg.side, !!seg.isProp);
      }
      state.mesh.segments.sort(function (a, b) {
        return a.drawOrder - b.drawOrder;
      });
      state.mesh.frontSide = state.frontSide;
    }
    setStatus("Front limbs: " + state.frontSide + " (drawn on top when overlapping).", "ok");
    draw();
  }

  /** Apply bone rigid transform: p' = a1 + R(dang)*s*(p - a0) */
  function transformByBone(px, py, a0, b0, a1, b1) {
    var dx0 = b0.x - a0.x;
    var dy0 = b0.y - a0.y;
    var dx1 = b1.x - a1.x;
    var dy1 = b1.y - a1.y;
    var len0 = Math.hypot(dx0, dy0) || 1e-8;
    var len1 = Math.hypot(dx1, dy1) || 1e-8;
    var ang0 = Math.atan2(dy0, dx0);
    var ang1 = Math.atan2(dy1, dx1);
    var dang = ang1 - ang0;
    var s = len1 / len0;
    var cos = Math.cos(dang);
    var sin = Math.sin(dang);
    var lx = px - a0.x;
    var ly = py - a0.y;
    return {
      x: a1.x + (lx * cos - ly * sin) * s,
      y: a1.y + (lx * sin + ly * cos) * s,
    };
  }

  function skinVertex(v) {
    if (!v.weights || !v.weights.length) {
      return { x: v.x, y: v.y };
    }
    var sx = 0;
    var sy = 0;
    var bind = state.bindJoints;
    for (var i = 0; i < v.weights.length; i++) {
      var inf = v.weights[i];
      var bone = state.bones[inf.bone];
      if (!bone) continue;
      var a0 = jointInList(bind, bone[0]);
      var b0 = jointInList(bind, bone[1]);
      var a1 = jointById(bone[0]);
      var b1 = jointById(bone[1]);
      if (!a0 || !b0 || !a1 || !b1) continue;
      var p = transformByBone(v.x, v.y, a0, b0, a1, b1);
      sx += p.x * inf.w;
      sy += p.y * inf.w;
    }
    return { x: sx, y: sy };
  }

  /**
   * Affine-map image triangle (u,v in 0–1) onto destination triangle (canvas px).
   * Classic canvas clip + setTransform trick.
   */
  function drawTexturedTriangle(ctx, img, p0, p1, p2, u0, v0, u1, v1, u2, v2) {
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    // Source points in image pixels
    var s0x = u0 * iw;
    var s0y = v0 * ih;
    var s1x = u1 * iw;
    var s1y = v1 * ih;
    var s2x = u2 * iw;
    var s2y = v2 * ih;

    var denom = s0x * (s1y - s2y) + s1x * (s2y - s0y) + s2x * (s0y - s1y);
    if (Math.abs(denom) < 1e-6) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.clip();

    // Solve affine: dest = M * src
    var m11 = (p0.x * (s1y - s2y) + p1.x * (s2y - s0y) + p2.x * (s0y - s1y)) / denom;
    var m21 = (p0.y * (s1y - s2y) + p1.y * (s2y - s0y) + p2.y * (s0y - s1y)) / denom;
    var m12 = (p0.x * (s2x - s1x) + p1.x * (s0x - s2x) + p2.x * (s1x - s0x)) / denom;
    var m22 = (p0.y * (s2x - s1x) + p1.y * (s0x - s2x) + p2.y * (s1x - s0x)) / denom;
    var m13 =
      (p0.x * (s1x * s2y - s2x * s1y) +
        p1.x * (s2x * s0y - s0x * s2y) +
        p2.x * (s0x * s1y - s1x * s0y)) /
      denom;
    var m23 =
      (p0.y * (s1x * s2y - s2x * s1y) +
        p1.y * (s2x * s0y - s0x * s2y) +
        p2.y * (s0x * s1y - s1x * s0y)) /
      denom;

    ctx.setTransform(m11, m21, m12, m22, m13, m23);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  function drawSegmentMesh(ctx, src, seg) {
    if (!seg || !seg.tris || !seg.tris.length) return;
    var verts = seg.verts;
    var skinned = new Array(verts.length);
    for (var i = 0; i < verts.length; i++) {
      var sp = skinVertex(verts[i]);
      skinned[i] = {
        x: sp.x * state.canvasW,
        y: sp.y * state.canvasH,
        u: verts[i].u,
        v: verts[i].v,
        a: verts[i].a || 0,
      };
    }
    var amin = CUTOUT_ALPHA_MIN / 255;
    var tris = seg.tris;
    for (var t = 0; t < tris.length; t++) {
      var tri = tris[t];
      var a = skinned[tri[0]];
      var b = skinned[tri[1]];
      var c = skinned[tri[2]];
      if ((a.a + b.a + c.a) / 3 < amin * 0.35) continue;
      drawTexturedTriangle(ctx, src, a, b, c, a.u, a.v, b.u, b.v, c.u, c.v);
    }
  }

  function drawDeformedImage(ctx) {
    // Pose textures the cutout only — never the full uncut painting
    var src = state.cutoutImage;
    if (!src || !state.mesh) return;

    ctx.save();
    ctx.globalAlpha = state.opacity;
    ctx.globalCompositeOperation = "source-over";

    if (state.mesh.segments && state.mesh.segments.length) {
      // 2.5D: draw back limbs, then torso, then front limbs / props
      for (var s = 0; s < state.mesh.segments.length; s++) {
        drawSegmentMesh(ctx, src, state.mesh.segments[s]);
      }
    } else if (state.mesh.tris && state.mesh.tris.length && state.mesh.verts) {
      // Legacy single-mesh fallback
      var verts = state.mesh.verts;
      var skinned = new Array(verts.length);
      for (var i = 0; i < verts.length; i++) {
        var sp = skinVertex(verts[i]);
        skinned[i] = {
          x: sp.x * state.canvasW,
          y: sp.y * state.canvasH,
          u: verts[i].u,
          v: verts[i].v,
          a: verts[i].a || 0,
        };
      }
      var tris = state.mesh.tris;
      var amin = CUTOUT_ALPHA_MIN / 255;
      for (var t = 0; t < tris.length; t++) {
        var tri = tris[t];
        var a = skinned[tri[0]];
        var b = skinned[tri[1]];
        var c = skinned[tri[2]];
        if ((a.a + b.a + c.a) / 3 < amin * 0.35) continue;
        drawTexturedTriangle(ctx, src, a, b, c, a.u, a.v, b.u, b.v, c.u, c.v);
      }
    }

    ctx.restore();
  }

  function draw() {
    var canvas = $("rig-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!state.image) return;

    if (state.mode === "pose") {
      if (state.cutoutImage && state.mesh) {
        drawDeformedImage(ctx);
      } else if (state.cutoutImage) {
        // Cutout present but mesh missing — still show cutout (no BG warp)
        ctx.save();
        ctx.globalAlpha = state.opacity;
        ctx.drawImage(state.cutoutImage, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
      // else: leave canvas clear so checkerboard shows — never draw full plate in Pose
    } else {
      var src = getRenderImage() || state.image;
      ctx.save();
      ctx.globalAlpha = state.opacity;
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    // bones
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (var b = 0; b < state.bones.length; b++) {
      var bone = state.bones[b];
      var a = jointById(bone[0]);
      var c = jointById(bone[1]);
      if (!a || !c) continue;
      var pa = normToCanvas(a.x, a.y);
      var pc = normToCanvas(c.x, c.y);
      ctx.strokeStyle = "rgba(40, 30, 10, 0.75)";
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pc.x, pc.y);
      ctx.stroke();
      ctx.strokeStyle =
        state.mode === "pose" ? "rgba(120, 210, 255, 0.92)" : "rgba(240, 190, 80, 0.92)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pc.x, pc.y);
      ctx.stroke();
      ctx.lineWidth = 3;
    }

    // joints
    for (var i = 0; i < state.joints.length; i++) {
      var j = state.joints[i];
      var p = normToCanvas(j.x, j.y);
      var sel = j.id === state.selectedId || j.id === state.dragId;
      ctx.beginPath();
      ctx.arc(p.x, p.y, sel ? JOINT_R + 2 : JOINT_R, 0, Math.PI * 2);
      if (state.mode === "pose") {
        ctx.fillStyle = sel ? "#b8ecff" : "#6ec8f0";
      } else {
        ctx.fillStyle = sel ? "#ffe08a" : "#f0c050";
      }
      ctx.fill();
      ctx.strokeStyle = sel ? "#fff8e0" : "#3a2a10";
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.stroke();

      if (state.showNames) {
        ctx.font = "600 11px system-ui, sans-serif";
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillText(j.label || j.id, p.x + 10, p.y - 8);
        ctx.fillStyle = "#f8f0d8";
        ctx.fillText(j.label || j.id, p.x + 9, p.y - 9);
      }
    }
  }

  function renderJointList() {
    var list = $("rig-joint-list");
    if (!list) return;
    list.innerHTML = "";
    state.joints.forEach(function (j) {
      var row = document.createElement("div");
      row.className = "rig-joint-item" + (j.id === state.selectedId ? " selected" : "");
      row.dataset.id = j.id;
      row.innerHTML =
        '<span class="rig-j-name">' +
        escapeHtml(j.label || j.id) +
        "</span>" +
        (state.mode === "edit"
          ? '<button type="button" class="rig-j-del" title="Remove joint" data-del="' +
            escapeAttr(j.id) +
            '">✕</button>'
          : "");
      row.addEventListener("click", function (e) {
        if (e.target && e.target.dataset && e.target.dataset.del) return;
        state.selectedId = j.id;
        renderJointList();
        draw();
        setStatus(
          "Selected " +
            (j.label || j.id) +
            (state.mode === "pose" ? " — drag on canvas to pose (FK)." : " — drag on canvas to move."),
          ""
        );
      });
      list.appendChild(row);
    });
    list.querySelectorAll("[data-del]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        removeJoint(btn.getAttribute("data-del"));
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function slugify(name) {
    return (
      String(name || "joint")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 32) || "joint"
    );
  }

  function uniqueId(base) {
    var id = base;
    var n = 2;
    while (jointById(id)) {
      id = base + "_" + n;
      n++;
    }
    return id;
  }

  function removeJoint(id) {
    if (state.mode === "pose") return;
    if (!jointById(id)) return;
    pushUndo();
    state.joints = state.joints.filter(function (j) {
      return j.id !== id;
    });
    state.bones = state.bones.filter(function (b) {
      return b[0] !== id && b[1] !== id;
    });
    if (state.selectedId === id) state.selectedId = state.joints[0] ? state.joints[0].id : null;
    renderJointList();
    fillBoneSelects();
    draw();
    setStatus("Removed joint " + id + ".", "ok");
  }

  function addJoint() {
    if (state.mode === "pose") return;
    var nameInput = $("rig-new-joint");
    var raw = (nameInput && nameInput.value.trim()) || "Custom";
    var id = uniqueId(slugify(raw));
    pushUndo();
    var x = 0.5;
    var y = 0.5;
    if (state.selectedId) {
      var sel = jointById(state.selectedId);
      if (sel) {
        x = Math.min(0.95, sel.x + 0.04);
        y = Math.min(0.95, sel.y + 0.04);
      }
    }
    state.joints.push({ id: id, label: raw, x: x, y: y });
    if (state.selectedId && jointById(state.selectedId)) {
      state.bones.push([state.selectedId, id]);
    }
    state.selectedId = id;
    if (nameInput) nameInput.value = "";
    renderJointList();
    fillBoneSelects();
    draw();
    setStatus("Added " + raw + (state.bones.length ? " (boned to selection)" : "") + ".", "ok");
  }

  function addBoneBetween() {
    if (state.mode === "pose") return;
    var fromEl = $("rig-bone-from");
    var toEl = $("rig-bone-to");
    if (!fromEl || !toEl) return;
    var a = fromEl.value;
    var b = toEl.value;
    if (!a || !b || a === b) {
      setStatus("Pick two different joints for a bone.", "warn");
      return;
    }
    if (!jointById(a) || !jointById(b)) return;
    var exists = state.bones.some(function (bn) {
      return (bn[0] === a && bn[1] === b) || (bn[0] === b && bn[1] === a);
    });
    if (exists) {
      setStatus("That bone already exists.", "warn");
      return;
    }
    pushUndo();
    state.bones.push([a, b]);
    draw();
    setStatus("Bone " + a + " → " + b + " added.", "ok");
  }

  function removeSelectedBone() {
    if (state.mode === "pose") return;
    if (!state.selectedId) {
      setStatus("Select a joint first, then remove a bone connected to it.", "warn");
      return;
    }
    var before = state.bones.length;
    pushUndo();
    state.bones = state.bones.filter(function (b) {
      return b[0] !== state.selectedId && b[1] !== state.selectedId;
    });
    if (state.bones.length === before) {
      state.undoStack.pop();
      setStatus("No bones connected to selection.", "warn");
      return;
    }
    draw();
    setStatus("Removed bones connected to " + state.selectedId + ".", "ok");
  }

  function fillBoneSelects() {
    var fromEl = $("rig-bone-from");
    var toEl = $("rig-bone-to");
    if (!fromEl || !toEl) return;
    var opts = state.joints
      .map(function (j) {
        return '<option value="' + escapeAttr(j.id) + '">' + escapeHtml(j.label || j.id) + "</option>";
      })
      .join("");
    var fv = fromEl.value;
    var tv = toEl.value;
    fromEl.innerHTML = opts;
    toEl.innerHTML = opts;
    if (fv) fromEl.value = fv;
    if (tv) toEl.value = tv;
    if (!fromEl.value && state.joints[0]) fromEl.value = state.joints[0].id;
    if (!toEl.value && state.joints[1]) toEl.value = state.joints[1].id;
  }

  function buildExportPayload() {
    var iw = state.image ? state.image.naturalWidth || state.image.width : 0;
    var ih = state.image ? state.image.naturalHeight || state.image.height : 0;
    var bind =
      state.bindJoints.length > 0
        ? cloneJoints(state.bindJoints)
        : cloneJoints(state.joints);
    var pose = cloneJoints(state.joints);
    function mapJoint(j) {
      return {
        id: j.id,
        label: j.label,
        x: j.x,
        y: j.y,
        px: Math.round(j.x * iw),
        py: Math.round(j.y * ih),
      };
    }
    return {
      version: 4,
      type: "logan-2d-rig",
      createdAt: new Date().toISOString(),
      mode: state.mode,
      frontSide: state.frontSide === "left" ? "left" : "right",
      cutout: {
        ready: !!state.cutoutReady,
        method: state.cutoutMethod || null,
        failReason: state.cutoutFailReason || null,
      },
      image: {
        name: state.imageName,
        kind: state.imageKind,
        src: state.imageKind === "upload" ? null : state.imageSrc,
        paintingNum: state.imageKind === "painting" ? state.paintingNum : null,
        width: iw,
        height: ih,
      },
      // Back-compat: joints = bind pose
      joints: bind.map(mapJoint),
      bindJoints: bind.map(mapJoint),
      poseJoints: pose.map(mapJoint),
      bones: cloneBones(state.bones).map(function (b) {
        return { from: b[0], to: b[1] };
      }),
    };
  }

  function applyPayload(data) {
    if (!data || !Array.isArray(data.joints)) {
      setStatus("Invalid rig JSON.", "err");
      return false;
    }
    pushUndo();
    var bindSrc = Array.isArray(data.bindJoints) && data.bindJoints.length ? data.bindJoints : data.joints;
    var poseSrc =
      Array.isArray(data.poseJoints) && data.poseJoints.length ? data.poseJoints : data.joints;
    function mapIn(j) {
      return {
        id: j.id,
        label: j.label || j.id,
        x: typeof j.x === "number" ? j.x : 0.5,
        y: typeof j.y === "number" ? j.y : 0.5,
      };
    }
    state.bindJoints = bindSrc.map(mapIn);
    state.bones = (data.bones || []).map(function (b) {
      if (Array.isArray(b)) return [b[0], b[1]];
      return [b.from, b.to];
    });
    if (data.frontSide === "left" || data.frontSide === "right") {
      state.frontSide = data.frontSide;
    }
    var wantPose = data.mode === "pose";
    state.joints = wantPose ? poseSrc.map(mapIn) : cloneJoints(state.bindJoints);
    state.mode = wantPose ? "pose" : "edit";
    if (state.mode === "pose") {
      buildSkinMesh();
    } else {
      state.mesh = null;
    }
    state.selectedId = state.joints[0] ? state.joints[0].id : null;
    updateModeUI();
    renderJointList();
    fillBoneSelects();
    draw();
    return true;
  }

  function saveLocal() {
    try {
      var payload = buildExportPayload();
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
      localStorage.setItem(LS_LAST, JSON.stringify({ imageName: state.imageName, at: payload.createdAt }));
      setStatus("Saved rig to localStorage (bind + pose).", "ok");
    } catch (e) {
      setStatus("localStorage save failed: " + (e.message || e), "err");
    }
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) {
        setStatus("No saved rig in localStorage.", "warn");
        return;
      }
      var data = JSON.parse(raw);
      if (applyPayload(data)) {
        setStatus("Loaded rig from localStorage.", "ok");
        if (data.image && data.image.src && data.image.kind !== "upload") {
          loadImageFromUrl(data.image.src, {
            name: data.image.name,
            kind: data.image.kind,
            paintingNum: data.image.paintingNum,
          });
        }
      }
    } catch (e) {
      setStatus("Failed to load localStorage rig.", "err");
    }
  }

  function downloadJson() {
    if (!state.image) {
      setStatus("Load an image first.", "warn");
      return;
    }
    var payload = buildExportPayload();
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    var base = (state.imageName || "rig").replace(/\.[^.]+$/, "");
    a.href = URL.createObjectURL(blob);
    a.download = base + "-rig.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
    setStatus("Downloaded " + a.download, "ok");
  }

  function importJsonFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result || ""));
        if (applyPayload(data)) setStatus("Imported rig JSON.", "ok");
      } catch (e) {
        setStatus("Could not parse JSON.", "err");
      }
    };
    reader.readAsText(file);
  }

  function undo() {
    var snap = state.undoStack.pop();
    if (!snap) {
      setStatus("Nothing to undo.", "warn");
      return;
    }
    state.joints = snap.joints;
    state.bones = snap.bones;
    state.bindJoints = snap.bindJoints || [];
    state.mode = snap.mode || "edit";
    function finishUndo() {
      if (state.mode === "pose" && state.bindJoints.length && state.cutoutReady) {
        buildSkinMesh();
      } else {
        state.mesh = null;
        if (state.mode === "pose" && !state.cutoutReady) {
          state.mode = "edit";
        }
      }
      if (!jointById(state.selectedId)) {
        state.selectedId = state.joints[0] ? state.joints[0].id : null;
      }
      updateModeUI();
      renderJointList();
      fillBoneSelects();
      draw();
      setStatus("Undid last change.", "ok");
    }
    if (snap.cutoutDataUrl) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        state.workCanvas = c;
        state.cutoutImage = img;
        state.cutoutMethod = snap.cutoutMethod || state.cutoutMethod;
        state.cutoutReady = !!snap.cutoutReady;
        state.cutoutFailReason = snap.cutoutFailReason || "";
        // Re-measure so badge stays honest
        try {
          var stats = scrubAndMeasureCutout(c);
          var bad = validateCutoutStats(stats, state.cutoutMethod);
          state.cutoutReady = !bad;
          state.cutoutFailReason = bad || "";
          adoptWorkCanvas(stats.canvas);
        } catch (e) {}
        finishUndo();
      };
      img.onerror = function () {
        finishUndo();
      };
      img.src = snap.cutoutDataUrl;
      return;
    }
    finishUndo();
  }

  /** FK: rotate joint + descendants around parent; translate subtree for roots. */
  function applyPoseDrag(dragId, nx, ny) {
    var j = jointById(dragId);
    if (!j) return;
    var pid = parentOf(dragId);
    var desc = descendantsOf(dragId);

    if (!pid) {
      var dx = nx - j.x;
      var dy = ny - j.y;
      j.x = Math.max(0, Math.min(1, nx));
      j.y = Math.max(0, Math.min(1, ny));
      for (var i = 0; i < desc.length; i++) {
        var d = jointById(desc[i]);
        if (!d) continue;
        d.x = Math.max(0, Math.min(1, d.x + dx));
        d.y = Math.max(0, Math.min(1, d.y + dy));
      }
      return;
    }

    var p = jointById(pid);
    if (!p) return;
    var oldAng = Math.atan2(j.y - p.y, j.x - p.x);
    var newAng = Math.atan2(ny - p.y, nx - p.x);
    var dAng = newAng - oldAng;
    var boneLen = Math.hypot(j.x - p.x, j.y - p.y) || 1e-6;
    // Preserve bone length (classic FK); aim toward pointer
    j.x = p.x + Math.cos(newAng) * boneLen;
    j.y = p.y + Math.sin(newAng) * boneLen;

    function rotateAround(joint, ox, oy, ang) {
      var cos = Math.cos(ang);
      var sin = Math.sin(ang);
      var rx = joint.x - ox;
      var ry = joint.y - oy;
      joint.x = ox + rx * cos - ry * sin;
      joint.y = oy + rx * sin + ry * cos;
    }

    for (i = 0; i < desc.length; i++) {
      d = jointById(desc[i]);
      if (d) rotateAround(d, p.x, p.y, dAng);
    }

    // Soft clamp into frame
    j.x = Math.max(-0.05, Math.min(1.05, j.x));
    j.y = Math.max(-0.05, Math.min(1.05, j.y));
    for (i = 0; i < desc.length; i++) {
      d = jointById(desc[i]);
      if (!d) continue;
      d.x = Math.max(-0.05, Math.min(1.05, d.x));
      d.y = Math.max(-0.05, Math.min(1.05, d.y));
    }
  }

  function onPointerDown(e) {
    if (!state.image) return;
    e.preventDefault();
    var pt = eventToCanvas(e);

    if (state.eraseTool && state.mode !== "pose") {
      ensureWorkCanvas().then(function (ok) {
        if (!ok) return;
        pushUndo({ cutout: true });
        state.eraseDragging = true;
        var ip = canvasPtToImage(pt.x, pt.y);
        state.eraseLast = ip;
        paintEraseDab(ip.x, ip.y, null);
        draw();
      });
      return;
    }

    var hit = hitJoint(pt.x, pt.y);
    if (hit) {
      pushUndo();
      state.dragId = hit.id;
      state.selectedId = hit.id;
      renderJointList();
      draw();
    }
  }

  function onPointerMove(e) {
    if (!state.image) return;

    if (state.eraseDragging && state.eraseTool && state.workCanvas) {
      e.preventDefault();
      var ptE = eventToCanvas(e);
      var ip = canvasPtToImage(ptE.x, ptE.y);
      paintEraseDab(ip.x, ip.y, state.eraseLast);
      state.eraseLast = ip;
      draw();
      return;
    }

    if (!state.dragId) return;
    e.preventDefault();
    var pt = eventToCanvas(e);
    var n = canvasToNorm(pt.x, pt.y);
    if (state.mode === "pose") {
      applyPoseDrag(state.dragId, n.x, n.y);
    } else {
      var j = jointById(state.dragId);
      if (!j) return;
      j.x = n.x;
      j.y = n.y;
    }
    draw();
  }

  function onPointerUp() {
    if (state.eraseDragging) {
      state.eraseDragging = false;
      state.eraseLast = null;
      syncCutoutFromWork();
      return;
    }
    if (state.dragId) {
      state.dragId = null;
      fillBoneSelects();
      draw();
      setStatus(
        state.mode === "pose"
          ? "Posed joint. Reset Pose to restore bind, or Save when ready."
          : "Moved joint. Switch to Pose when the bind looks right.",
        ""
      );
    }
  }

  function bindCanvas() {
    var canvas = $("rig-canvas");
    if (!canvas || canvas._rigBound) return;
    canvas._rigBound = true;
    canvas.addEventListener("mousedown", onPointerDown);
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
    canvas.addEventListener(
      "touchstart",
      function (e) {
        onPointerDown(e);
      },
      { passive: false }
    );
    canvas.addEventListener(
      "touchmove",
      function (e) {
        onPointerMove(e);
      },
      { passive: false }
    );
    canvas.addEventListener("touchend", onPointerUp);
    canvas.addEventListener("touchcancel", onPointerUp);
  }

  function loadPainting(num) {
    num = Math.max(1, Math.min(1000, parseInt(num, 10) || 1));
    state.paintingNum = num;
    var nEl = $("rig-painting-num");
    if (nEl) nEl.value = String(num);
    return loadImageFromUrl("paintings/" + num + ".jpg", {
      name: "painting-" + num + ".jpg",
      kind: "painting",
      paintingNum: num,
    });
  }

  function onShow() {
    if (!state.ready) init();
    fitCanvas();
    draw();
  }

  function init() {
    if (state.ready) return;
    state.ready = true;
    state.joints = cloneJoints(TEMPLATE_JOINTS);
    state.bones = cloneBones(TEMPLATE_BONES);
    state.bindJoints = [];
    state.mode = "edit";
    state.selectedId = "hips";

    bindCanvas();
    renderJointList();
    fillBoneSelects();
    updateModeUI();

    var upload = $("rig-upload");
    if (upload) {
      upload.addEventListener("change", function () {
        var file = upload.files && upload.files[0];
        if (!file) return;
        var url = URL.createObjectURL(file);
        loadImageFromUrl(url, { name: file.name, kind: "upload" });
      });
    }

    var jsonIn = $("rig-import-json");
    if (jsonIn) {
      jsonIn.addEventListener("change", function () {
        var file = jsonIn.files && jsonIn.files[0];
        if (file) importJsonFile(file);
        jsonIn.value = "";
      });
    }

    function wire(id, fn) {
      var el = $(id);
      if (el) el.addEventListener("click", fn);
    }

    wire("rig-load-painting", function () {
      loadPainting(($("rig-painting-num") && $("rig-painting-num").value) || 1);
    });
    wire("rig-prev-painting", function () {
      loadPainting((state.paintingNum || 1) - 1);
    });
    wire("rig-next-painting", function () {
      loadPainting((state.paintingNum || 1) + 1);
    });
    wire("rig-rand-painting", function () {
      loadPainting(1 + Math.floor(Math.random() * 1000));
    });
    wire("rig-reset", resetToTemplate);
    wire("rig-reset-pose", resetPose);
    wire("rig-rebuild-segments", rebuildSegments);
    wire("rig-front-side", toggleFrontSide);
    wire("rig-undo", undo);
    wire("rig-save-local", saveLocal);
    wire("rig-load-local", loadLocal);
    wire("rig-download", downloadJson);
    wire("rig-add-joint", function () {
      addJoint();
    });
    wire("rig-add-bone", addBoneBetween);
    wire("rig-remove-bones", removeSelectedBone);
    wire("rig-mode-edit", function () {
      setMode("edit");
    });
    wire("rig-mode-pose", function () {
      setMode("pose");
    });
    wire("rig-cutout", function () {
      if (!state.image) {
        setStatus("Load an image first.", "warn");
        return;
      }
      state.eraseTool = null;
      ensureCutout(true).then(function (ok) {
        if (ok && state.mode === "pose") {
          buildSkinMesh();
          draw();
        }
      });
    });
    wire("rig-erase", function () {
      setEraseTool("erase");
    });
    wire("rig-restore", function () {
      setEraseTool("restore");
    });
    var brushEl = $("rig-brush-size");
    if (brushEl) {
      brushEl.addEventListener("input", function () {
        state.brushSize = Math.max(4, Math.min(160, parseInt(brushEl.value, 10) || 32));
        var lab = $("rig-brush-label");
        if (lab) lab.textContent = String(state.brushSize);
      });
    }

    var op = $("rig-opacity");
    if (op) {
      op.addEventListener("input", function () {
        state.opacity = parseInt(op.value, 10) / 100;
        var lab = $("rig-opacity-label");
        if (lab) lab.textContent = Math.round(state.opacity * 100) + "%";
        draw();
      });
    }

    var names = $("rig-show-names");
    if (names) {
      names.addEventListener("change", function () {
        state.showNames = !!names.checked;
        draw();
      });
    }

    var showCut = $("rig-show-cutout");
    if (showCut) {
      showCut.addEventListener("change", function () {
        state.showCutoutInEdit = !!showCut.checked;
        draw();
      });
    }

    updateCutoutUI();

    window.addEventListener("resize", function () {
      if (document.body.getAttribute("data-active-tab") !== "rig") return;
      fitCanvas();
      draw();
    });

    window.addEventListener("rig-show", onShow);
    window.addEventListener("rig-hide", function () {});

    setStatus("Load an image, place bones, Cut from background (or Erase BG by hand). Pose unlocks when cutout quality passes.", "");
  }

  window.Rig = {
    onShow: onShow,
    reset: resetToTemplate,
    resetPose: resetPose,
    setMode: setMode,
    ensureCutout: ensureCutout,
    syncCutoutFromWork: syncCutoutFromWork,
    setEraseTool: setEraseTool,
    rebuildSegments: rebuildSegments,
    toggleFrontSide: toggleFrontSide,
    exportPayload: buildExportPayload,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
