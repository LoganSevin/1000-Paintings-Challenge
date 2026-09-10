/**
 * Rig — manual 2D bone placement on images.
 * Place/edit a human skeleton template on gallery or uploaded stills; save/export JSON.
 */
(function () {
  "use strict";

  var LS_KEY = "logan-rig-v1";
  var LS_LAST = "logan-rig-last-v1";
  var HIT_R = 12;
  var JOINT_R = 7;

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
    imageKind: "", // upload | painting | generated | data
    paintingNum: 1,
    joints: [],
    bones: [],
    selectedId: null,
    dragId: null,
    opacity: 0.85,
    showNames: true,
    undoStack: [],
    ready: false,
    canvasW: 800,
    canvasH: 600,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function cloneJoints(joints) {
    return joints.map(function (j) {
      return { id: j.id, label: j.label, x: j.x, y: j.y };
    });
  }

  function cloneBones(bones) {
    return bones.map(function (b) {
      return [b[0], b[1]];
    });
  }

  function pushUndo() {
    state.undoStack.push({
      joints: cloneJoints(state.joints),
      bones: cloneBones(state.bones),
    });
    if (state.undoStack.length > 40) state.undoStack.shift();
  }

  function setStatus(msg, kind) {
    var el = $("rig-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "rig-status" + (kind ? " " + kind : "");
  }

  function jointById(id) {
    for (var i = 0; i < state.joints.length; i++) {
      if (state.joints[i].id === id) return state.joints[i];
    }
    return null;
  }

  function resetToTemplate() {
    pushUndo();
    state.joints = cloneJoints(TEMPLATE_JOINTS);
    state.bones = cloneBones(TEMPLATE_BONES);
    state.selectedId = "hips";
    renderJointList();
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
        fitCanvas();
        $("rig-empty").hidden = true;
        draw();
        setStatus("Loaded " + state.imageName + " — drag joints onto the figure.", "ok");
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

  function draw() {
    var canvas = $("rig-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (state.image) {
      ctx.save();
      ctx.globalAlpha = state.opacity;
      ctx.drawImage(state.image, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    } else {
      return;
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
      ctx.strokeStyle = "rgba(240, 190, 80, 0.92)";
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
      ctx.fillStyle = sel ? "#ffe08a" : "#f0c050";
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
        '<button type="button" class="rig-j-del" title="Remove joint" data-del="' +
        escapeAttr(j.id) +
        '">✕</button>';
      row.addEventListener("click", function (e) {
        if (e.target && e.target.dataset && e.target.dataset.del) return;
        state.selectedId = j.id;
        renderJointList();
        draw();
        setStatus("Selected " + (j.label || j.id) + " — drag on canvas to move.", "");
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
    return String(name || "joint")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 32) || "joint";
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
    draw();
    setStatus("Removed joint " + id + ".", "ok");
  }

  function addJoint() {
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
    draw();
    setStatus("Added " + raw + (state.bones.length ? " (boned to selection)" : "") + ".", "ok");
  }

  function addBoneBetween() {
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
    return {
      version: 1,
      type: "logan-2d-rig",
      createdAt: new Date().toISOString(),
      image: {
        name: state.imageName,
        kind: state.imageKind,
        src: state.imageKind === "upload" ? null : state.imageSrc,
        paintingNum: state.imageKind === "painting" ? state.paintingNum : null,
        width: iw,
        height: ih,
      },
      joints: cloneJoints(state.joints).map(function (j) {
        return {
          id: j.id,
          label: j.label,
          x: j.x,
          y: j.y,
          px: Math.round(j.x * iw),
          py: Math.round(j.y * ih),
        };
      }),
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
    state.joints = data.joints.map(function (j) {
      return {
        id: j.id,
        label: j.label || j.id,
        x: typeof j.x === "number" ? j.x : 0.5,
        y: typeof j.y === "number" ? j.y : 0.5,
      };
    });
    state.bones = (data.bones || []).map(function (b) {
      if (Array.isArray(b)) return [b[0], b[1]];
      return [b.from, b.to];
    });
    state.selectedId = state.joints[0] ? state.joints[0].id : null;
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
      setStatus("Saved rig to localStorage.", "ok");
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
    if (!jointById(state.selectedId)) {
      state.selectedId = state.joints[0] ? state.joints[0].id : null;
    }
    renderJointList();
    fillBoneSelects();
    draw();
    setStatus("Undid last change.", "ok");
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
    var j = jointById(state.dragId);
    if (!j) return;
    j.x = n.x;
    j.y = n.y;
    draw();
  }

  function onPointerUp() {
    if (state.dragId) {
      state.dragId = null;
      fillBoneSelects();
      draw();
      setStatus("Moved joint. Save or export when ready.", "");
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
    state.selectedId = "hips";

    bindCanvas();
    renderJointList();
    fillBoneSelects();

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
    wire("rig-undo", undo);
    wire("rig-save-local", saveLocal);
    wire("rig-load-local", loadLocal);
    wire("rig-download", downloadJson);
    wire("rig-add-joint", function () {
      addJoint();
      fillBoneSelects();
    });
    wire("rig-add-bone", addBoneBetween);
    wire("rig-remove-bones", removeSelectedBone);

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

    window.addEventListener("resize", function () {
      if (document.body.getAttribute("data-active-tab") !== "rig") return;
      fitCanvas();
      draw();
    });

    window.addEventListener("rig-show", onShow);
    window.addEventListener("rig-hide", function () {});

    setStatus("Load an image or pick a painting, then drag joints onto the character.", "");
  }

  window.Rig = {
    onShow: onShow,
    reset: resetToTemplate,
    exportPayload: buildExportPayload,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
