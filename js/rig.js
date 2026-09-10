/**
 * Rig — manual 2D bone placement + pose / image deformation.
 * Edit bones (bind pose) or Pose (FK joints + SSD mesh deform).
 */
(function () {
  "use strict";

  var LS_KEY = "logan-rig-v1";
  var LS_LAST = "logan-rig-last-v1";
  var HIT_R = 12;
  var JOINT_R = 7;
  var MESH_COLS = 16;
  var MESH_ROWS = 16;
  var SKIN_INFLUENCES = 3;
  var SKIN_EPS = 1e-5;

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
    mesh: null, // { verts: [{x,y,u,v,weights}], tris: [[i,j,k],...] }
    cutoutImage: null, // HTMLImageElement / canvas with alpha subject
    cutoutMethod: "", // imgly | flood | alpha | ""
    cutting: false,
    cuttingPromise: null,
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

  function pushUndo() {
    state.undoStack.push({
      joints: cloneJoints(state.joints),
      bones: cloneBones(state.bones),
      bindJoints: cloneJoints(state.bindJoints),
      mode: state.mode,
    });
    if (state.undoStack.length > 40) state.undoStack.shift();
  }

  function setStatus(msg, kind) {
    var el = $("rig-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "rig-status" + (kind ? " " + kind : "");
  }

  /** Image used for display / mesh texturing. Pose always prefers cutout. */
  function getRenderImage() {
    if (state.mode === "pose" && state.cutoutImage) return state.cutoutImage;
    if (state.mode === "edit" && state.showCutoutInEdit && state.cutoutImage) {
      return state.cutoutImage;
    }
    return state.image;
  }

  function clearCutout() {
    state.cutoutImage = null;
    state.cutoutMethod = "";
    state.cutting = false;
    state.cuttingPromise = null;
    updateCutoutUI();
  }

  function updateCutoutUI() {
    var shell = document.querySelector(".rig-shell");
    if (shell) {
      shell.classList.toggle("rig-has-cutout", !!state.cutoutImage);
      shell.classList.toggle("rig-cutting", !!state.cutting);
    }
    var btn = $("rig-cutout");
    if (btn) {
      btn.disabled = !state.image || state.cutting;
      btn.textContent = state.cutting
        ? "Cutting…"
        : state.cutoutImage
          ? "Re-cut from background"
          : "Cut from background";
    }
    var badge = $("rig-cutout-badge");
    if (badge) {
      if (state.cutoutImage) {
        badge.hidden = false;
        badge.textContent =
          "Cutout: " + (state.cutoutMethod || "ready");
      } else {
        badge.hidden = true;
        badge.textContent = "";
      }
    }
    var showCb = $("rig-show-cutout");
    if (showCb) showCb.checked = !!state.showCutoutInEdit;
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

  /**
   * Produce alpha cutout of the subject. Prefers @imgly/background-removal (free,
   * in-browser), then canvas edge flood-fill. Reuses existing alpha if present.
   */
  function ensureCutout(force) {
    if (!state.image) return Promise.resolve(false);
    if (!force && state.cutoutImage) return Promise.resolve(true);
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
        state.cutoutImage = cutImg;
        state.cutting = false;
        state.cuttingPromise = null;
        updateCutoutUI();
        draw();
        setStatus(
          "Cutout ready (" +
            (state.cutoutMethod || "ok") +
            "). Pose deforms only the figure — background stays put.",
          "ok"
        );
        return true;
      })
      .catch(function (err) {
        console.warn("[rig] cutout failed", err);
        state.cutting = false;
        state.cuttingPromise = null;
        updateCutoutUI();
        setStatus(
          "Cutout failed — posing with full image (background may warp). Try a simpler BG or Re-cut.",
          "warn"
        );
        return false;
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
          ? "Pose: drag joints — children follow (FK). Only the cut-out figure deforms; background stays still. Reset Pose returns to bind."
          : "Edit bones: drag joints to set the bind pose. Cut from background (or auto on Pose) so the scene does not warp when you move.";
    }
    var toolbar = $("rig-toolbar-hint");
    if (toolbar) {
      toolbar.textContent =
        state.mode === "pose"
          ? "Pose · cutout mesh · drag a joint to move the limb"
          : "Edit bones · drag joints onto the figure · Cut from background, then Pose";
    }
    var resetPose = $("rig-reset-pose");
    if (resetPose) resetPose.disabled = state.mode !== "pose";
    // Dim edit-only controls in pose
    ["rig-add-joint", "rig-add-bone", "rig-remove-bones", "rig-reset", "rig-new-joint"].forEach(function (id) {
      var el = $(id);
      if (el) el.disabled = state.mode === "pose";
    });
    updateCutoutUI();
  }

  function finishEnterPose() {
    state.bindJoints = cloneJoints(state.joints);
    buildSkinMesh();
    state.mode = "pose";
    state.selectedId = state.joints[0] ? state.selectedId || state.joints[0].id : null;
    if (!jointById(state.selectedId)) {
      state.selectedId = state.joints[0] ? state.joints[0].id : null;
    }
    updateModeUI();
    renderJointList();
    fillBoneSelects();
    draw();
    setStatus(
      state.cutoutImage
        ? "Pose mode: cutout mesh — only the figure deforms. Reset Pose restores bind."
        : "Pose mode (no cutout): full image will warp. Use Cut from background.",
      state.cutoutImage ? "ok" : "warn"
    );
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
      // Auto-cut before posing so the scene behind the figure does not warp
      if (!state.cutoutImage) {
        setStatus("Cutting subject from background before Pose…", "");
        ensureCutout(false).then(function () {
          finishEnterPose();
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
          // Re-cut for the new image, then rebuild mesh
          ensureCutout(false).then(function () {
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

  function buildSkinMesh() {
    if (!state.bindJoints.length || !state.bones.length) {
      state.mesh = null;
      return;
    }
    var cols = MESH_COLS;
    var rows = MESH_ROWS;
    var verts = [];
    var bind = state.bindJoints;
    var bones = state.bones;

    for (var r = 0; r <= rows; r++) {
      for (var c = 0; c <= cols; c++) {
        var x = c / cols;
        var y = r / rows;
        var influences = [];
        for (var bi = 0; bi < bones.length; bi++) {
          var ba = jointInList(bind, bones[bi][0]);
          var bb = jointInList(bind, bones[bi][1]);
          if (!ba || !bb) continue;
          var d = distToSegment(x, y, ba.x, ba.y, bb.x, bb.y);
          var w = 1 / (d * d + SKIN_EPS);
          influences.push({ bone: bi, w: w, d: d });
        }
        influences.sort(function (a, b) {
          return a.d - b.d;
        });
        influences = influences.slice(0, SKIN_INFLUENCES);
        var sum = 0;
        for (var k = 0; k < influences.length; k++) sum += influences[k].w;
        var weights = [];
        if (sum > 0) {
          for (k = 0; k < influences.length; k++) {
            weights.push({ bone: influences[k].bone, w: influences[k].w / sum });
          }
        }
        verts.push({ x: x, y: y, u: x, v: y, weights: weights });
      }
    }

    var tris = [];
    var stride = cols + 1;
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        var i0 = r * stride + c;
        var i1 = i0 + 1;
        var i2 = i0 + stride;
        var i3 = i2 + 1;
        tris.push([i0, i1, i2]);
        tris.push([i1, i3, i2]);
      }
    }
    state.mesh = { verts: verts, tris: tris };
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
    // | a c e |   | s0x |   | p0.x |
    // | b d f | * | s0y | = | p0.y |
    // | 0 0 1 |   |  1  |   |  1   |
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

  function drawDeformedImage(ctx) {
    var src = getRenderImage();
    if (!src || !state.mesh) {
      if (src) {
        ctx.save();
        ctx.globalAlpha = state.opacity;
        ctx.drawImage(src, 0, 0, state.canvasW, state.canvasH);
        ctx.restore();
      }
      return;
    }
    var verts = state.mesh.verts;
    var skinned = new Array(verts.length);
    for (var i = 0; i < verts.length; i++) {
      var sp = skinVertex(verts[i]);
      skinned[i] = {
        x: sp.x * state.canvasW,
        y: sp.y * state.canvasH,
        u: verts[i].u,
        v: verts[i].v,
      };
    }

    ctx.save();
    ctx.globalAlpha = state.opacity;
    var tris = state.mesh.tris;
    for (var t = 0; t < tris.length; t++) {
      var tri = tris[t];
      var a = skinned[tri[0]];
      var b = skinned[tri[1]];
      var c = skinned[tri[2]];
      drawTexturedTriangle(ctx, src, a, b, c, a.u, a.v, b.u, b.v, c.u, c.v);
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

    if (state.mode === "pose" && state.mesh) {
      drawDeformedImage(ctx);
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
      version: 3,
      type: "logan-2d-rig",
      createdAt: new Date().toISOString(),
      mode: state.mode,
      cutout: {
        ready: !!state.cutoutImage,
        method: state.cutoutMethod || null,
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
    if (state.mode === "pose" && state.bindJoints.length) {
      buildSkinMesh();
    } else {
      state.mesh = null;
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
    if (!state.dragId || !state.image) return;
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
      ensureCutout(true).then(function (ok) {
        if (ok && state.mode === "pose") {
          buildSkinMesh();
          draw();
        }
      });
    });

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

    setStatus("Load an image, place bones, Cut from background (auto on Pose) so only the figure deforms.", "");
  }

  window.Rig = {
    onShow: onShow,
    reset: resetToTemplate,
    resetPose: resetPose,
    setMode: setMode,
    ensureCutout: ensureCutout,
    exportPayload: buildExportPayload,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
