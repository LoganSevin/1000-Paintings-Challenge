/**
 * Studio 3D — Blender-like modeling viewport (Three.js).
 * Primitives, transform tools, materials, outliner, GLB export,
 * Spellforge Plane (CSS3D iframe — real usable Spellforge in the scene).
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { CSS3DRenderer, CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";

(function () {
  "use strict";

  var SF_PLANE_W = 3.84;
  var SF_PLANE_H = 2.4;
  var SF_CSS_W = 1280;
  var SF_CSS_H = 800;
  var SF_CSS_SCALE = SF_PLANE_W / SF_CSS_W;

  var state = {
    ready: false,
    active: false,
    renderer: null,
    cssRenderer: null,
    scene: null,
    cssScene: null,
    camera: null,
    orbit: null,
    transform: null,
    grid: null,
    raycaster: null,
    pointer: null,
    objects: [],
    selected: null,
    tool: "select",
    animId: 0,
    objectId: 0,
    clock: null,
    /** When false, Spellforge iframe ignores pointers so the transform gimbal can be used. */
    sfInteract: true,
    activeSfGroup: null,
    printQueue: [],
    printBusy: false,
    snapEnabled: true,
    _snapRay: null,
    _snapBox: null,
    _snapN: null,
    _snapQ: null,
    _tmpV: null,
    /** null | 'x' | 'y' | 'z' — user-facing axis (Blender-style: Z up, Y depth) */
    axisLock: null,
    /** True when editing mesh components (Blender Edit Mode) */
    editMode: false,
    /** What LMB selects while in edit mode: face | edge | vertex */
    selectMode: "face",
    /** Primary mesh component selection (last picked) */
    meshSel: null,
    /** Multi-select list (Shift+click). Includes meshSel when set. */
    meshSels: [],
    /** Highlight helper(s) for selected face/edge/verts */
    meshHilite: null,
    meshHilites: [],
    /** 3D print style: auto|globe|flag|plaque|totem|crystal */
    printStyle: "auto",
    /** Last viewport screenshot (data URL) for generate-from-prompt */
    shotDataUrl: "",
    /**
     * Modal grab/rotate/scale (Blender G/R/S):
     * { mode:'g'|'r'|'s', axis:null|'x'|'y'|'z', startClient:{x,y},
     *   origPos, origQuat, origScale, confirmed:false }
     */
    modal: null,
    /** Box select drag */
    boxSelect: null,
    /** Undo / redo stacks */
    undoStack: [],
    redoStack: [],
    /** Clipboard for Ctrl+C / Ctrl+V */
    clipboard: null,
    /** Studio workspace: '3d' | 'uv' */
    workspace: "3d",
    /** Bevel profile: 'flat' | 'curved' */
    bevelProfile: "flat",
    /** Curved bevel profile segments (edge) */
    bevelSegments: 3,
    /** UV editor camera/interaction state */
    uvEditor: {
      panX: 0,
      panY: 0,
      zoom: 1,
      dragging: null,
      panning: false,
      lastX: 0,
      lastY: 0,
      dirty: true,
    },
  };

  var UNDO_MAX = 40;

  function findObjectByStudioId(id) {
    for (var i = 0; i < state.objects.length; i++) {
      if (state.objects[i].userData && state.objects[i].userData.studioId === id) {
        return state.objects[i];
      }
    }
    return null;
  }

  function findMeshByUuid(uuid) {
    var found = null;
    state.objects.forEach(function (obj) {
      if (found) return;
      obj.traverse(function (ch) {
        if (found) return;
        if (ch.uuid === uuid) found = ch;
      });
    });
    return found;
  }

  function snapshotMeshGeometry(mesh) {
    var geo = mesh.geometry;
    if (!geo || !geo.attributes || !geo.attributes.position) return null;
    return {
      type: "mesh-geo",
      meshUuid: mesh.uuid,
      position: Array.from(geo.attributes.position.array),
      index: geo.index ? Array.from(geo.index.array) : null,
      normal: geo.attributes.normal
        ? Array.from(geo.attributes.normal.array)
        : null,
      uv: geo.attributes.uv ? Array.from(geo.attributes.uv.array) : null,
    };
  }

  function restoreMeshGeometry(snap) {
    var mesh = findMeshByUuid(snap.meshUuid);
    if (!mesh || !mesh.geometry) return false;
    var geo = mesh.geometry;
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array(snap.position), 3)
    );
    if (snap.index) geo.setIndex(snap.index);
    else geo.setIndex(null);
    if (snap.normal) {
      geo.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(new Float32Array(snap.normal), 3)
      );
    } else {
      geo.computeVertexNormals();
    }
    if (snap.uv) {
      geo.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(new Float32Array(snap.uv), 2)
      );
    }
    geo.attributes.position.needsUpdate = true;
    if (geo.attributes.normal) geo.attributes.normal.needsUpdate = true;
    if (geo.attributes.uv) geo.attributes.uv.needsUpdate = true;
    geo.computeBoundingSphere();
    return true;
  }

  function snapshotObjectTransform(obj) {
    return {
      type: "object-xf",
      studioId: obj.userData.studioId,
      pos: obj.position.toArray(),
      quat: obj.quaternion.toArray(),
      scale: obj.scale.toArray(),
      name: obj.name,
    };
  }

  function restoreObjectTransform(snap) {
    var obj = findObjectByStudioId(snap.studioId);
    if (!obj) return false;
    obj.position.fromArray(snap.pos);
    obj.quaternion.fromArray(snap.quat);
    obj.scale.fromArray(snap.scale);
    if (snap.name) obj.name = snap.name;
    return true;
  }

  function pushUndo(entry) {
    if (!entry) return;
    state.undoStack.push(entry);
    if (state.undoStack.length > UNDO_MAX) {
      var dropped = state.undoStack.shift();
      // Dispose deleted objects that fall off the stack
      if (dropped && dropped.type === "delete" && dropped.obj) {
        try {
          disposeObject(dropped.obj);
        } catch (e) {}
      }
    }
    state.redoStack = [];
  }

  function pushMeshEditUndo(mesh, label) {
    if (!mesh) return;
    var snap = snapshotMeshGeometry(mesh);
    if (!snap) return;
    snap.label = label || "Mesh edit";
    pushUndo(snap);
  }

  function pushTransformUndo(obj, label) {
    if (!obj || (obj.userData && obj.userData.isSpellforgePlane)) return;
    var snap = snapshotObjectTransform(obj);
    snap.label = label || "Transform";
    pushUndo(snap);
  }

  function undo() {
    if (!state.undoStack.length) {
      setStatus("Nothing to undo.", "err");
      return;
    }
    var entry = state.undoStack.pop();
    // Capture redo state
    if (entry.type === "mesh-geo") {
      var mesh = findMeshByUuid(entry.meshUuid);
      if (mesh) {
        var redoSnap = snapshotMeshGeometry(mesh);
        if (redoSnap) {
          redoSnap.label = entry.label;
          state.redoStack.push(redoSnap);
        }
        restoreMeshGeometry(entry);
        clearMeshSelection();
        setStatus("Undo: " + (entry.label || "mesh edit"), "ok");
        return;
      }
    } else if (entry.type === "object-xf") {
      var obj = findObjectByStudioId(entry.studioId);
      if (obj) {
        var redoXf = snapshotObjectTransform(obj);
        redoXf.label = entry.label;
        state.redoStack.push(redoXf);
        restoreObjectTransform(entry);
        if (obj === state.selected) readNumericFromSelection();
        setStatus("Undo: " + (entry.label || "transform"), "ok");
        return;
      }
    } else if (entry.type === "delete") {
      // Re-add object
      if (entry.obj) {
        state.redoStack.push({
          type: "add",
          obj: entry.obj,
          label: "Delete",
        });
        state.scene.add(entry.obj);
        state.objects.push(entry.obj);
        selectObject(entry.obj);
        renderOutliner();
        setStatus("Undo: delete", "ok");
        return;
      }
    } else if (entry.type === "add") {
      // Remove object that was added (paste/duplicate)
      var o = entry.obj;
      if (o) {
        state.redoStack.push({
          type: "delete",
          obj: o,
          label: "Add",
        });
        freeShelfSlotIfAny(o);
        if (state.transform) state.transform.detach();
        state.scene.remove(o);
        state.objects = state.objects.filter(function (x) {
          return x !== o;
        });
        if (state.selected === o) selectObject(null);
        else renderOutliner();
        setStatus("Undo: add", "ok");
        return;
      }
    }
    setStatus("Undo failed (object gone).", "err");
  }

  function redo() {
    if (!state.redoStack.length) {
      setStatus("Nothing to redo.", "err");
      return;
    }
    var entry = state.redoStack.pop();
    if (entry.type === "mesh-geo") {
      var mesh = findMeshByUuid(entry.meshUuid);
      if (mesh) {
        var undoSnap = snapshotMeshGeometry(mesh);
        if (undoSnap) {
          undoSnap.label = entry.label;
          state.undoStack.push(undoSnap);
        }
        restoreMeshGeometry(entry);
        clearMeshSelection();
        setStatus("Redo: " + (entry.label || "mesh edit"), "ok");
        return;
      }
    } else if (entry.type === "object-xf") {
      var obj = findObjectByStudioId(entry.studioId);
      if (obj) {
        var undoXf = snapshotObjectTransform(obj);
        undoXf.label = entry.label;
        state.undoStack.push(undoXf);
        restoreObjectTransform(entry);
        if (obj === state.selected) readNumericFromSelection();
        setStatus("Redo: " + (entry.label || "transform"), "ok");
        return;
      }
    } else if (entry.type === "delete") {
      // Redo delete = remove again
      var o = entry.obj;
      if (o) {
        state.undoStack.push({ type: "delete", obj: o, label: entry.label });
        freeShelfSlotIfAny(o);
        if (state.transform) state.transform.detach();
        state.scene.remove(o);
        state.objects = state.objects.filter(function (x) {
          return x !== o;
        });
        if (state.selected === o) selectObject(null);
        else renderOutliner();
        setStatus("Redo: delete", "ok");
        return;
      }
    } else if (entry.type === "add") {
      var o2 = entry.obj;
      if (o2) {
        state.undoStack.push({ type: "add", obj: o2, label: entry.label });
        state.scene.add(o2);
        state.objects.push(o2);
        selectObject(o2);
        renderOutliner();
        setStatus("Redo: add", "ok");
        return;
      }
    }
    setStatus("Redo failed.", "err");
  }

  function copySelected() {
    if (!state.selected) {
      setStatus("Nothing to copy.", "err");
      return;
    }
    if (state.selected.userData && state.selected.userData.isSpellforgePlane) {
      setStatus("Can't copy Spellforge plane — use Duplicate.", "err");
      return;
    }
    if (state.selected.userData && state.selected.userData.isPrinter) {
      setStatus("Can't copy printers this way.", "err");
      return;
    }
    var src = state.selected;
    var clone = src.clone(true);
    src.traverse(function (ch) {
      if (!ch.isMesh || !ch.geometry) return;
      // deep clone geometries on clone by matching names/paths is hard — re-clone from src
    });
    // Proper deep clone: rebuild from src
    clone = src.clone(true);
    clone.traverse(function (ch) {
      if (ch.isMesh && ch.geometry) {
        ch.geometry = ch.geometry.clone();
      }
      if (ch.isMesh && ch.material) {
        ch.material = Array.isArray(ch.material)
          ? ch.material.map(function (m) {
              return m.clone();
            })
          : ch.material.clone();
      }
    });
    // Don't put in scene yet
    clone.userData = Object.assign({}, src.userData);
    clone.userData.studioId = null; // assigned on paste
    clone.userData.cssObject = null;
    clone.userData.isSpellforgePlane = false;
    clone.userData.shelfSlot = null;
    clone.userData.onShelf = false;
    if (clone.userData.spinRoot) {
      // keep spin flags but re-resolve on paste via userData.spinGlobe
    }
    state.clipboard = clone;
    setStatus("Copied “" + src.name + "”.", "ok");
  }

  function pasteClipboard() {
    if (!state.clipboard) {
      setStatus("Clipboard empty.", "err");
      return;
    }
    ensureInit();
    var clone = state.clipboard.clone(true);
    clone.traverse(function (ch) {
      if (ch.isMesh && ch.geometry) ch.geometry = ch.geometry.clone();
      if (ch.isMesh && ch.material) {
        ch.material = Array.isArray(ch.material)
          ? ch.material.map(function (m) {
              return m.clone();
            })
          : ch.material.clone();
      }
    });
    clone.userData = Object.assign({}, state.clipboard.userData);
    clone.userData.cssObject = null;
    clone.userData.shelfSlot = null;
    clone.userData.onShelf = false;
    clone.name = nextName(clone.userData.studioType || "mesh");
    clone.userData.studioId = state.objectId;
    clone.position.x += 0.4;
    clone.position.z += 0.2;
    state.scene.add(clone);
    state.objects.push(clone);
    pushUndo({ type: "add", obj: clone, label: "Paste" });
    selectObject(clone);
    renderOutliner();
    setStatus("Pasted “" + clone.name + "”.", "ok");
  }

  /**
   * Map user/Blender axis → Three.js axis.
   * Blender: X right, Y depth, Z up. Three: X right, Y up, Z depth.
   */
  function userAxisToThree(userAxis) {
    if (userAxis === "y") return "z";
    if (userAxis === "z") return "y";
    return userAxis || null;
  }

  function threeAxisToUser(threeAxis) {
    if (threeAxis === "y") return "z";
    if (threeAxis === "z") return "y";
    return threeAxis || null;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, kind) {
    var el = $("mod-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className =
      "mod-status" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
  }

  function nextName(type) {
    state.objectId += 1;
    return type + "_" + state.objectId;
  }

  function disposeObject(obj) {
    if (!obj) return;
    if (obj.userData && obj.userData.cssObject) {
      removeCssObject(obj.userData.cssObject);
      obj.userData.cssObject = null;
    }
    obj.traverse(function (child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(function (m) {
            m.dispose();
          });
        } else {
          child.material.dispose();
        }
      }
    });
  }

  function removeCssObject(cssObj) {
    if (!cssObj) return;
    if (state.cssScene) state.cssScene.remove(cssObj);
    var el = cssObj.element;
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function spellforgeEmbedUrl() {
    var u = new URL(location.href);
    u.searchParams.set("embed", "spellforge");
    u.searchParams.set("_sf", String(Date.now()));
    u.hash = "spellforge";
    return u.toString();
  }

  function ensureMathTemps() {
    if (!state._snapRay) {
      state._snapRay = new THREE.Raycaster();
      state._snapBox = new THREE.Box3();
      state._snapN = new THREE.Vector3();
      state._snapQ = new THREE.Quaternion();
      state._tmpV = new THREE.Vector3();
      state._tmpV2 = new THREE.Vector3();
      state._tmpV3 = new THREE.Vector3();
      state._ndcA = new THREE.Vector3();
      state._ndcB = new THREE.Vector3();
    }
  }

  /**
   * True only when the Spellforge plane is *substantially* covered by closer meshes.
   * A tiny mesh in a corner must NOT freeze the live UI into a still capture.
   * @param {number} minCover 0–1 fraction of sample rays that must hit a blocker
   */
  function isSpellforgeOccluded(group, minCover) {
    if (!state.camera || !group) return false;
    if (minCover == null) minCover = 0.55;
    ensureMathTemps();
    group.updateWorldMatrix(true, true);
    state.camera.updateMatrixWorld(true);
    var screen = group.userData.screenMesh || group;
    var blockers = state.objects.filter(function (o) {
      return (
        o !== group &&
        o.visible !== false &&
        !(o.userData && o.userData.isSpellforgePlane)
      );
    });
    if (!blockers.length) return false;

    var origin = state.camera.position;
    // Sample interior of plane (not just edges) — 5×5 grid
    var hw = SF_PLANE_W * 0.42;
    var hh = SF_PLANE_H * 0.42;
    var xs = [-hw, -hw * 0.5, 0, hw * 0.5, hw];
    var ys = [-hh, -hh * 0.5, 0, hh * 0.5, hh];
    var world = state._tmpV;
    var dir = state._tmpV2;
    var total = 0;
    var blocked = 0;
    var centerBlocked = false;

    for (var yi = 0; yi < ys.length; yi++) {
      for (var xi = 0; xi < xs.length; xi++) {
        world.set(xs[xi], ys[yi], 0.02);
        screen.localToWorld(world);
        dir.copy(world).sub(origin);
        var dist = dir.length();
        if (dist < 0.05) continue;
        dir.multiplyScalar(1 / dist);
        state._snapRay.set(origin, dir);
        state._snapRay.near = 0;
        state._snapRay.far = dist - 0.02;
        total += 1;
        var hits = state._snapRay.intersectObjects(blockers, true);
        if (hits.length > 0 && hits[0].distance < dist - 0.01) {
          blocked += 1;
          if (xi === 2 && yi === 2) centerBlocked = true;
        }
      }
    }
    if (total < 1) return false;
    var cover = blocked / total;
    // Need most of the plane covered; center should also be blocked for "heavy" occlusion
    if (cover >= minCover && (centerBlocked || cover >= 0.72)) return true;

    // Screen-space: only if a closer mesh covers a LARGE share of the plane on screen
    var planeBox = state._snapBox.setFromObject(screen);
    var planeCenter = planeBox.getCenter(state._tmpV3);
    var planeDist = origin.distanceTo(planeCenter);
    var pMin = { x: 1, y: 1 };
    var pMax = { x: -1, y: -1 };
    var corners = [
      new THREE.Vector3(planeBox.min.x, planeBox.min.y, planeBox.min.z),
      new THREE.Vector3(planeBox.min.x, planeBox.min.y, planeBox.max.z),
      new THREE.Vector3(planeBox.min.x, planeBox.max.y, planeBox.min.z),
      new THREE.Vector3(planeBox.min.x, planeBox.max.y, planeBox.max.z),
      new THREE.Vector3(planeBox.max.x, planeBox.min.y, planeBox.min.z),
      new THREE.Vector3(planeBox.max.x, planeBox.min.y, planeBox.max.z),
      new THREE.Vector3(planeBox.max.x, planeBox.max.y, planeBox.min.z),
      new THREE.Vector3(planeBox.max.x, planeBox.max.y, planeBox.max.z),
    ];
    for (var c = 0; c < corners.length; c++) {
      corners[c].project(state.camera);
      pMin.x = Math.min(pMin.x, corners[c].x);
      pMin.y = Math.min(pMin.y, corners[c].y);
      pMax.x = Math.max(pMax.x, corners[c].x);
      pMax.y = Math.max(pMax.y, corners[c].y);
    }
    var planeArea = Math.max(1e-6, (pMax.x - pMin.x) * (pMax.y - pMin.y));

    for (var bi = 0; bi < blockers.length; bi++) {
      var b = blockers[bi];
      if (!b.visible) continue;
      var bBox = new THREE.Box3().setFromObject(b);
      if (bBox.isEmpty()) continue;
      var bCenter = bBox.getCenter(state._tmpV);
      var bDist = origin.distanceTo(bCenter);
      if (bDist >= planeDist - 0.02) continue;
      var bMin = { x: 1, y: 1 };
      var bMax = { x: -1, y: -1 };
      var bc = [
        new THREE.Vector3(bBox.min.x, bBox.min.y, bBox.min.z),
        new THREE.Vector3(bBox.min.x, bBox.min.y, bBox.max.z),
        new THREE.Vector3(bBox.min.x, bBox.max.y, bBox.min.z),
        new THREE.Vector3(bBox.min.x, bBox.max.y, bBox.max.z),
        new THREE.Vector3(bBox.max.x, bBox.min.y, bBox.min.z),
        new THREE.Vector3(bBox.max.x, bBox.min.y, bBox.max.z),
        new THREE.Vector3(bBox.max.x, bBox.max.y, bBox.min.z),
        new THREE.Vector3(bBox.max.x, bBox.max.y, bBox.max.z),
      ];
      var anyFront = false;
      for (var k = 0; k < bc.length; k++) {
        bc[k].project(state.camera);
        if (bc[k].z < 1) anyFront = true;
        bMin.x = Math.min(bMin.x, bc[k].x);
        bMin.y = Math.min(bMin.y, bc[k].y);
        bMax.x = Math.max(bMax.x, bc[k].x);
        bMax.y = Math.max(bMax.y, bc[k].y);
      }
      if (!anyFront) continue;
      var ox0 = Math.max(bMin.x, pMin.x);
      var oy0 = Math.max(bMin.y, pMin.y);
      var ox1 = Math.min(bMax.x, pMax.x);
      var oy1 = Math.min(bMax.y, pMax.y);
      if (ox1 <= ox0 || oy1 <= oy0) continue;
      var overlapFrac = ((ox1 - ox0) * (oy1 - oy0)) / planeArea;
      // Tiny screen overlap must not freeze Spellforge
      if (overlapFrac >= Math.max(0.4, minCover * 0.75)) return true;
    }
    return false;
  }

  /**
   * Hysteresis: hard to freeze live UI, easy to restore it.
   */
  function updateSpellforgeOcclusionStable(group, rawOccluded) {
    var ud = group.userData;
    if (ud._occStable === undefined) ud._occStable = false;
    if (ud._occClearStreak === undefined) ud._occClearStreak = 0;
    if (ud._occBlockStreak === undefined) ud._occBlockStreak = 0;
    if (rawOccluded) {
      ud._occBlockStreak += 1;
      ud._occClearStreak = 0;
      // Need sustained heavy cover before killing live iframe
      if (ud._occBlockStreak >= 8) ud._occStable = true;
    } else {
      ud._occClearStreak += 1;
      ud._occBlockStreak = 0;
      // Restore live quickly when no longer heavily covered
      if (ud._occClearStreak >= 2) ud._occStable = false;
    }
    return ud._occStable;
  }

  /**
   * Live plane + occlusion:
   * - Select / Using plane → stay live unless the plane is mostly covered
   * - Small meshes in front no longer freeze the UI into a still capture
   * - G/R/S → iframe ignores clicks so gimbal works
   */
  function refreshSpellforgePointerMode() {
    var wantInteract = state.tool === "select" && state.sfInteract;
    var anyModeChanged = false;
    state.objects.forEach(function (obj) {
      if (!obj.userData || !obj.userData.isSpellforgePlane) return;
      // While using the plane, require heavy coverage before still-capture mode
      var rawOcc = isSpellforgeOccluded(obj, wantInteract ? 0.6 : 0.5);
      var occluded = updateSpellforgeOcclusionStable(obj, rawOcc);
      obj.userData.occluded = occluded;
      obj.userData.rawOccluded = rawOcc;
      // Live + clickable when Using plane, unless substantially occluded
      var showLive = wantInteract && !occluded;
      var thisChanged = obj.userData._showLive !== showLive;
      if (thisChanged) {
        obj.userData._showLive = showLive;
        anyModeChanged = true;
      }
      var css = obj.userData.cssObject;
      var frame = css && css.element;
      var iframe = obj.userData.iframe;
      var screen = obj.userData.screenMesh;

      if (css) {
        css.visible = showLive;
      }
      if (frame) {
        // Hard hide when occluded so HTML never composites over closer meshes
        frame.style.visibility = showLive ? "visible" : "hidden";
        frame.style.pointerEvents = showLive ? "auto" : "none";
        frame.style.opacity = showLive ? "1" : "0";
        frame.style.transition = "none";
      }
      if (iframe) {
        iframe.style.pointerEvents = showLive ? "auto" : "none";
      }
      if (screen && screen.material) {
        if (showLive) {
          // Proxy nearly invisible while live CSS3D is on top
          screen.material.transparent = true;
          screen.material.opacity = 0.01;
          screen.material.depthWrite = false;
          screen.material.depthTest = true;
        } else {
          // Solid depth-tested plane with last good frame
          screen.material.transparent = false;
          screen.material.opacity = 1;
          screen.material.depthWrite = true;
          screen.material.depthTest = true;
          if (thisChanged) promoteLastGoodCapture(obj);
        }
        screen.material.needsUpdate = true;
        screen.visible = true;
      }
    });
    var btn = $("mod-plane-ui");
    if (btn) {
      btn.classList.toggle("is-active", state.tool === "select" && state.sfInteract);
      btn.textContent =
        state.tool === "select" && state.sfInteract ? "Using plane" : "Gimbal free";
    }
    if (anyModeChanged) updateHud();
  }

  function syncCssObjects() {
    state.objects.forEach(function (obj) {
      var css = obj.userData && obj.userData.cssObject;
      if (!css) return;
      css.position.copy(obj.position);
      css.quaternion.copy(obj.quaternion);
      var base = obj.userData.cssScale || SF_CSS_SCALE;
      css.scale.set(base * obj.scale.x, base * obj.scale.y, base * obj.scale.z);
    });
  }

  function ensureHtml2Canvas() {
    if (state.html2canvas) return Promise.resolve(state.html2canvas);
    return import("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm")
      .then(function (mod) {
        state.html2canvas = mod.default || mod;
        return state.html2canvas;
      })
      .catch(function () {
        return null;
      });
  }

  function drawPlaceholderCapture(canvas, label) {
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#12141c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#9aa3c4";
    ctx.font = "18px system-ui,sans-serif";
    ctx.fillText(label || "Spellforge", 28, 48);
    ctx.fillStyle = "#6a7190";
    ctx.font = "14px system-ui,sans-serif";
    ctx.fillText("Waiting for first capture…", 28, 78);
  }

  /** Copy last-good buffer onto the live WebGL canvas texture. */
  function promoteLastGoodCapture(group) {
    var canvas = group.userData.captureCanvas;
    var good = group.userData.lastGoodCanvas;
    var tex = group.userData.screenTexture;
    if (!canvas || !good || !tex || !group.userData.hasGoodCapture) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(good, 0, 0, canvas.width, canvas.height);
    tex.needsUpdate = true;
  }

  /** Heuristic: capture looks like real UI, not empty/black/placeholder. */
  function captureLooksLoaded(snapCanvas) {
    if (!snapCanvas || snapCanvas.width < 8) return false;
    try {
      var c = document.createElement("canvas");
      c.width = 32;
      c.height = 20;
      var ctx = c.getContext("2d");
      if (!ctx) return false;
      ctx.drawImage(snapCanvas, 0, 0, 32, 20);
      var data = ctx.getImageData(0, 0, 32, 20).data;
      var sum = 0;
      var sumSq = 0;
      var n = 32 * 20;
      for (var i = 0; i < data.length; i += 4) {
        var g = (data[i] + data[i + 1] + data[i + 2]) / 3;
        sum += g;
        sumSq += g * g;
      }
      var mean = sum / n;
      var variance = sumSq / n - mean * mean;
      // Loaded Spellforge has contrast; pure black/near-uniform fails
      return variance > 80 || (mean > 18 && mean < 240 && variance > 25);
    } catch (e) {
      return true;
    }
  }

  function storeGoodCapture(group, snap) {
    var canvas = group.userData.captureCanvas;
    var good = group.userData.lastGoodCanvas;
    var tex = group.userData.screenTexture;
    if (!canvas || !tex || !snap) return;
    if (!captureLooksLoaded(snap)) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0c0c10";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(snap, 0, 0, canvas.width, canvas.height);
    if (good) {
      var gctx = good.getContext("2d");
      if (gctx) {
        gctx.drawImage(canvas, 0, 0, good.width, good.height);
      }
    }
    group.userData.hasGoodCapture = true;
    group.userData.lastCaptureOkAt = performance.now();
    tex.needsUpdate = true;
  }

  /**
   * Capture live iframe into WebGL texture.
   * Only updates texture on successful "loaded-looking" captures so we never
   * wipe a good frame with blank/loading. Prefer capturing while CSS3D is live.
   */
  function captureSpellforgePlanes(force) {
    if (state.captureBusy || !state.active) return;
    var planes = state.objects.filter(function (o) {
      return o.userData && o.userData.isSpellforgePlane && o.userData.captureCanvas;
    });
    if (!planes.length) return;

    // Prefer planes that are currently live (iframe painted). Still try others if never captured.
    var targets = planes.filter(function (g) {
      var live = state.tool === "select" && state.sfInteract && !g.userData.occluded;
      return force || live || !g.userData.hasGoodCapture;
    });
    if (!targets.length) return;

    state.captureBusy = true;
    ensureHtml2Canvas()
      .then(function (h2c) {
        if (!h2c) {
          state.captureBusy = false;
          return null;
        }
        var chain = Promise.resolve();
        targets.forEach(function (group) {
          chain = chain.then(function () {
            return captureOneSpellforge(group, h2c);
          });
        });
        return chain;
      })
      .then(function () {
        state.captureBusy = false;
        state.lastCaptureAt = performance.now();
      })
      .catch(function () {
        state.captureBusy = false;
      });
  }

  function captureOneSpellforge(group, h2c) {
    var iframe = group.userData.iframe;
    if (!iframe) return Promise.resolve();
    var doc = null;
    try {
      doc = iframe.contentDocument;
    } catch (e) {
      return Promise.resolve();
    }
    if (!doc || !doc.body) return Promise.resolve();

    // Capture iframe document directly (no need to un-hide CSS3D — that would flash over meshes)
    var root = doc.documentElement || doc.body;
    return h2c(root, {
      width: SF_CSS_W,
      height: SF_CSS_H,
      windowWidth: SF_CSS_W,
      windowHeight: SF_CSS_H,
      scale: 0.55,
      logging: false,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#0c0c10",
      removeContainer: true,
      foreignObjectRendering: false,
      imageTimeout: 4000,
      onclone: function (clonedDoc) {
        try {
          var b = clonedDoc.body;
          if (b) {
            b.style.width = SF_CSS_W + "px";
            b.style.height = SF_CSS_H + "px";
            b.style.overflow = "hidden";
          }
        } catch (e) {}
      },
    })
      .then(function (snap) {
        storeGoodCapture(group, snap);
      })
      .catch(function () {});
  }

  function bootSpellforgeIframe(iframe, group) {
    if (!iframe) return;
    function kick() {
      try {
        var win = iframe.contentWindow;
        if (!win) return;
        if (win.SpellforgeAPI && win.SpellforgeAPI.onShow) win.SpellforgeAPI.onShow();
        else win.dispatchEvent(new Event("spellforge-show"));
        if (win.SpellforgeAPI && win.SpellforgeAPI.refresh) win.SpellforgeAPI.refresh();
      } catch (e) {}
    }
    function scheduleCaptures() {
      [400, 900, 1600, 2800, 4500, 7000].forEach(function (ms) {
        setTimeout(function () {
          if (group) captureSpellforgePlanes(true);
        }, ms);
      });
    }
    iframe.addEventListener("load", function () {
      setTimeout(kick, 300);
      setTimeout(kick, 1000);
      setTimeout(kick, 2500);
      scheduleCaptures();
    });
    setTimeout(kick, 500);
    scheduleCaptures();
  }

  /**
   * Sharp live Spellforge as a CSS3D plane (usable). WebGL bezel + hit proxy for transforms.
   * Use Select tool to click Spellforge; G/R/S frees the gimbal through the plane.
   */
  function addSpellforgePlane() {
    ensureInit();
    if (!state.cssScene || !state.cssRenderer) {
      setStatus("3D layer not ready.", "err");
      return null;
    }

    var group = new THREE.Group();
    group.name = nextName("SpellforgePlane");
    group.userData.studioType = "spellforge-plane";
    group.userData.studioId = state.objectId;
    group.userData.isSpellforgePlane = true;
    group.userData.cssScale = SF_CSS_SCALE;

    var bezel = new THREE.Mesh(
      new THREE.PlaneGeometry(SF_PLANE_W + 0.14, SF_PLANE_H + 0.14),
      new THREE.MeshStandardMaterial({
        color: 0x1a1c24,
        metalness: 0.55,
        roughness: 0.4,
        side: THREE.DoubleSide,
      })
    );
    bezel.position.z = -0.03;
    bezel.castShadow = true;
    bezel.receiveShadow = true;
    group.add(bezel);

    // WebGL screen: live CSS3D when clear; last-good capture when a mesh occludes
    var captureCanvas = document.createElement("canvas");
    captureCanvas.width = 960;
    captureCanvas.height = 600;
    var lastGoodCanvas = document.createElement("canvas");
    lastGoodCanvas.width = 960;
    lastGoodCanvas.height = 600;
    drawPlaceholderCapture(captureCanvas, "Spellforge");
    drawPlaceholderCapture(lastGoodCanvas, "Spellforge");
    var texture = new THREE.CanvasTexture(captureCanvas);
    if ("colorSpace" in texture) texture.colorSpace = THREE.SRGBColorSpace;

    var screen = new THREE.Mesh(
      new THREE.PlaneGeometry(SF_PLANE_W, SF_PLANE_H),
      new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        toneMapped: false,
        transparent: true,
        opacity: 0.02,
        depthWrite: false,
        depthTest: true,
      })
    );
    screen.name = group.name + "_screen";
    group.add(screen);

    group.position.set(0, SF_PLANE_H * 0.5 + 0.15, -1.2);

    var frame = document.createElement("div");
    frame.className = "mod-sf-frame";
    frame.style.width = SF_CSS_W + "px";
    frame.style.height = SF_CSS_H + "px";

    var chrome = document.createElement("div");
    chrome.className = "mod-sf-chrome";
    chrome.innerHTML =
      "<span>Spellforge Plane</span><em>Select = use · G/R/S = gimbal · mesh in front = last frame (depth)</em>";
    frame.appendChild(chrome);

    var iframe = document.createElement("iframe");
    iframe.className = "mod-sf-iframe";
    iframe.title = "Spellforge";
    iframe.setAttribute("allow", "clipboard-read; clipboard-write");
    iframe.src = spellforgeEmbedUrl();
    frame.appendChild(iframe);

    var cssObj = new CSS3DObject(frame);
    cssObj.userData.linkedMesh = group;
    cssObj.visible = true;

    group.userData.cssObject = cssObj;
    group.userData.cssFrame = frame;
    group.userData.iframe = iframe;
    group.userData.screenMesh = screen;
    group.userData.captureCanvas = captureCanvas;
    group.userData.lastGoodCanvas = lastGoodCanvas;
    group.userData.screenTexture = texture;
    group.userData.hasGoodCapture = false;
    group.userData._occStable = false;
    group.userData._occClearStreak = 0;
    group.userData._occBlockStreak = 0;

    bootSpellforgeIframe(iframe, group);

    state.scene.add(group);
    state.cssScene.add(cssObj);
    state.objects.push(group);
    state.activeSfGroup = group;
    syncCssObjects();
    selectObject(group);
    setTool("select");
    state.sfInteract = true;
    refreshSpellforgePointerMode();
    setTimeout(function () {
      captureSpellforgePlanes(true);
    }, 800);

    setStatus(
      "Spellforge Plane live. Mesh in front → last loaded frame (depth). G/R/S for gimbal.",
      "ok"
    );
    return group;
  }

  /* —— Flat printer: ejects image prints onto a stable tray stack —— */
  function addPrinter() {
    ensureInit();
    var group = new THREE.Group();
    group.name = nextName("Printer");
    group.userData.studioType = "printer";
    group.userData.studioId = state.objectId;
    group.userData.isPrinter = true;
    group.userData.printKind = "flat";
    group.userData.printStack = 0;
    group.userData.printSlot = new THREE.Object3D();
    group.userData.printSlot.position.set(0, 0.42, 0.55);
    group.add(group.userData.printSlot);
    group.userData.trayAnchor = new THREE.Object3D();
    group.userData.trayAnchor.position.set(0, 0.16, 0.55);
    group.add(group.userData.trayAnchor);

    var body = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.55, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x3a3e4c, metalness: 0.35, roughness: 0.45 })
    );
    body.position.y = 0.35;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    var tray = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.06, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x2a2c36, metalness: 0.2, roughness: 0.6 })
    );
    tray.position.set(0, 0.12, 0.55);
    tray.castShadow = true;
    group.add(tray);

    var slot = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.04, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x111218, metalness: 0.5, roughness: 0.35 })
    );
    slot.position.set(0, 0.42, 0.48);
    group.add(slot);

    var light = makeStatusLight(0.42, 0.55, 0.2);
    group.add(light);
    group.userData.statusLight = light;

    group.position.set(2.2, 0, 0.5);
    state.scene.add(group);
    state.objects.push(group);
    selectObject(group);
    setTool("move");
    setStatus("Paper printer — Spellforge jobs stack flat on the tray.", "ok");
    return group;
  }

  /**
   * 3D printer: builds a heightmap mesh from the finished image (luminance → relief).
   */
  function addMeshPrinter() {
    ensureInit();
    var group = new THREE.Group();
    group.name = nextName("MeshPrinter");
    group.userData.studioType = "mesh-printer";
    group.userData.studioId = state.objectId;
    group.userData.isPrinter = true;
    group.userData.printKind = "mesh";
    group.userData.printStack = 0;

    // Build plate (print bed)
    var bed = new THREE.Mesh(
      new THREE.BoxGeometry(1.35, 0.06, 1.35),
      new THREE.MeshStandardMaterial({ color: 0x1e222c, metalness: 0.4, roughness: 0.5 })
    );
    bed.position.y = 0.03;
    bed.castShadow = true;
    bed.receiveShadow = true;
    group.add(bed);

    // Frame posts
    var postMat = new THREE.MeshStandardMaterial({
      color: 0x4a5060,
      metalness: 0.55,
      roughness: 0.35,
    });
    var posts = [
      [-0.62, 0.55, -0.62],
      [0.62, 0.55, -0.62],
      [-0.62, 0.55, 0.62],
      [0.62, 0.55, 0.62],
    ];
    posts.forEach(function (p) {
      var post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), postMat);
      post.position.set(p[0], p[1], p[2]);
      post.castShadow = true;
      group.add(post);
    });

    // Top gantry rail
    var rail = new THREE.Mesh(
      new THREE.BoxGeometry(1.35, 0.07, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x6a7080, metalness: 0.6, roughness: 0.3 })
    );
    rail.position.set(0, 1.05, 0);
    group.add(rail);

    // Print head (animates during mesh print)
    var head = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.14, 0.16),
      new THREE.MeshStandardMaterial({
        color: 0x88a0ff,
        metalness: 0.4,
        roughness: 0.4,
        emissive: 0x223355,
        emissiveIntensity: 0.4,
      })
    );
    head.position.set(0, 0.85, 0);
    group.add(head);
    group.userData.printHead = head;

    group.userData.bedAnchor = new THREE.Object3D();
    group.userData.bedAnchor.position.set(0, 0.08, 0);
    group.add(group.userData.bedAnchor);

    var light = makeStatusLight(0.55, 0.7, 0.55);
    group.add(light);
    group.userData.statusLight = light;

    group.position.set(-2.4, 0, 0.8);
    state.scene.add(group);
    state.objects.push(group);
    selectObject(group);
    setTool("move");
    setStatus("3D printer — Spellforge jobs become heightmap meshes on the bed.", "ok");
    return group;
  }

  function makeStatusLight(x, y, z) {
    var light = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 12, 12),
      new THREE.MeshStandardMaterial({
        color: 0x44cc88,
        emissive: 0x228855,
        emissiveIntensity: 0.8,
      })
    );
    light.position.set(x, y, z);
    return light;
  }

  function setPrinterLight(printer, mode) {
    var light = printer && printer.userData && printer.userData.statusLight;
    if (!light || !light.material) return;
    if (mode === "busy") {
      light.material.emissive.setHex(0xccaa22);
      light.material.color.setHex(0xffdd66);
    } else if (mode === "err") {
      light.material.emissive.setHex(0x882222);
      light.material.color.setHex(0xff5555);
    } else {
      light.material.emissive.setHex(0x228855);
      light.material.color.setHex(0x44cc88);
    }
  }

  /**
   * Make image URLs loadable from Studio 3D (parent page).
   * - data:/blob: unchanged
   * - localhost/127.0.0.1 absolute URLs rebased to current origin (Tailscale / phone)
   * - relative paths resolved against location
   */
  function rewritePrintImageUrl(url) {
    if (!url || typeof url !== "string") return "";
    var s = url.trim();
    if (!s) return "";
    if (s.indexOf("data:") === 0 || s.indexOf("blob:") === 0) return s;
    try {
      var u = new URL(s, location.href);
      var host = (u.hostname || "").toLowerCase();
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "0.0.0.0" ||
        host === "[::1]" ||
        host === "::1"
      ) {
        return location.origin + u.pathname + u.search + u.hash;
      }
      return u.href;
    } catch (e) {
      return s;
    }
  }

  /**
   * Load an image into a usable HTMLImageElement without TextureLoader CORS traps.
   * Tries: direct → same-origin fetch→blob → /api/proxy-media → plain img.
   */
  function loadPrintImageElement(url) {
    var resolved = rewritePrintImageUrl(url);
    if (!resolved) {
      return Promise.reject(new Error("No image URL"));
    }

    function fromObjectUrl(blob) {
      return new Promise(function (resolve, reject) {
        var obj = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
          resolve({ img: img, objectUrl: obj });
        };
        img.onerror = function () {
          URL.revokeObjectURL(obj);
          reject(new Error("Blob image decode failed"));
        };
        img.src = obj;
      });
    }

    function fromSrc(src, useAnon) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        if (useAnon && src.indexOf("data:") !== 0 && src.indexOf("blob:") !== 0) {
          img.crossOrigin = "anonymous";
        }
        img.onload = function () {
          resolve({ img: img, objectUrl: null });
        };
        img.onerror = function () {
          reject(new Error("Image element failed"));
        };
        img.src = src;
      });
    }

    // data / blob — never set crossOrigin
    if (resolved.indexOf("data:") === 0 || resolved.indexOf("blob:") === 0) {
      return fromSrc(resolved, false);
    }

    // 1) fetch as blob (same-origin / CORS-enabled)
    return fetch(resolved, { cache: "no-store", credentials: "same-origin", mode: "cors" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.blob();
      })
      .then(fromObjectUrl)
      .catch(function () {
        // 2) server proxy for remote CDNs (xAI, etc.)
        var proxy =
          location.origin + "/api/proxy-media?url=" + encodeURIComponent(resolved);
        return fetch(proxy, { cache: "no-store", credentials: "same-origin" }).then(
          function (r) {
            if (!r.ok) throw new Error("proxy HTTP " + r.status);
            return r.blob();
          }
        ).then(fromObjectUrl);
      })
      .catch(function () {
        // 3) plain img (same-origin assets often work without CORS flag)
        return fromSrc(resolved, false);
      })
      .catch(function () {
        // 4) last try with anonymous (some CDNs require it)
        return fromSrc(resolved, true);
      })
      .catch(function () {
        return Promise.reject(
          new Error("Failed to fetch print image: " + resolved.slice(0, 120))
        );
      });
  }

  function printImageToTexture(img) {
    var tex = new THREE.Texture(img);
    tex.needsUpdate = true;
    if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    return tex;
  }

  function enqueuePrintJob(imageUrl, meta) {
    if (!imageUrl) return;
    state.printQueue.push({
      imageUrl: rewritePrintImageUrl(imageUrl),
      meta: meta || {},
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    });
    setStatus("Print job queued (" + state.printQueue.length + " waiting).", "ok");
    processPrintQueue();
  }

  function getPrinters(kind) {
    return state.objects.filter(function (o) {
      if (!o.userData || !o.userData.isPrinter) return false;
      if (!kind) return true;
      return o.userData.printKind === kind;
    });
  }

  function processPrintQueue() {
    if (state.printBusy) return;
    if (!state.printQueue.length) return;
    var flats = getPrinters("flat");
    var meshes = getPrinters("mesh");
    // Legacy printers without printKind → treat as flat
    var legacy = state.objects.filter(function (o) {
      return o.userData && o.userData.isPrinter && !o.userData.printKind;
    });
    flats = flats.concat(legacy);
    if (!flats.length && !meshes.length) return;

    state.printBusy = true;
    var job = state.printQueue.shift();
    var pending = 0;
    function oneDone() {
      pending -= 1;
      if (pending <= 0) {
        state.printBusy = false;
        processPrintQueue();
      }
    }
    if (flats.length) {
      pending += 1;
      runFlatPrint(flats[0], job, oneDone);
    }
    if (meshes.length) {
      pending += 1;
      runMeshPrint(meshes[0], job, oneDone);
    }
    if (!pending) {
      state.printBusy = false;
    }
  }

  /** Lay paper flat on the printer tray in a neat stack (no face-snap chaos). */
  function placePrintOnTray(paper, printer) {
    var stack = printer.userData.printStack || 0;
    printer.userData.printStack = stack + 1;
    var anchor = printer.userData.trayAnchor;
    var local = new THREE.Vector3(0, stack * 0.014, 0);
    if (anchor) {
      anchor.updateWorldMatrix(true, false);
      paper.position.copy(local);
      anchor.localToWorld(paper.position);
    } else {
      paper.position.set(
        printer.position.x,
        0.16 + stack * 0.014,
        printer.position.z + 0.55
      );
    }
    // PlaneGeometry faces +Z — lay flat on tray (+Y up) so image faces up
    paper.quaternion.copy(printer.quaternion);
    paper.rotateX(-Math.PI / 2);
  }

  function runFlatPrint(printer, job, done) {
    setPrinterLight(printer, "busy");
    loadPrintImageElement(job.imageUrl)
      .then(function (loaded) {
        var tex = printImageToTexture(loaded.img);
        var paper = new THREE.Mesh(
          new THREE.PlaneGeometry(0.72, 0.72),
          new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.85,
            metalness: 0.05,
            side: THREE.DoubleSide,
          })
        );
        paper.name = nextName("Print");
        paper.userData.studioType = "print";
        paper.userData.studioId = state.objectId;
        paper.userData.isPrint = true;
        paper.userData.printJob = job;
        paper.userData._objectUrl = loaded.objectUrl;
        paper.castShadow = true;
        paper.receiveShadow = true;

        var slot = printer.userData.printSlot;
        var start = new THREE.Vector3();
        if (slot) {
          slot.getWorldPosition(start);
        } else {
          start.copy(printer.position);
          start.y += 0.42;
        }
        paper.position.copy(start);
        paper.quaternion.copy(printer.quaternion);
        paper.rotateX(-Math.PI / 2);

        var stack = printer.userData.printStack || 0;
        var end = new THREE.Vector3(0, stack * 0.014, 0);
        if (printer.userData.trayAnchor) {
          printer.userData.trayAnchor.updateWorldMatrix(true, false);
          printer.userData.trayAnchor.localToWorld(end);
        } else {
          end.copy(start);
          end.y = 0.16 + stack * 0.014;
          var out = new THREE.Vector3(0, 0, 0.75).applyQuaternion(printer.quaternion);
          end.add(out);
        }

        state.scene.add(paper);
        state.objects.push(paper);

        var t0 = performance.now();
        var dur = 1100;
        function step(now) {
          var u = Math.min(1, (now - t0) / dur);
          var e = 1 - Math.pow(1 - u, 3);
          paper.position.lerpVectors(start, end, e);
          if (u < 1) {
            requestAnimationFrame(step);
          } else {
            placePrintOnTray(paper, printer);
            setPrinterLight(printer, "ok");
            renderOutliner();
            setStatus("Printed “" + paper.name + "” on tray.", "ok");
            done();
          }
        }
        requestAnimationFrame(step);
      })
      .catch(function (err) {
        setPrinterLight(printer, "err");
        var msg = (err && err.message) || "Print failed to load image.";
        setStatus(msg, "err");
        done();
      });
  }

  /**
   * Build a relief mesh from image luminance (heightmap) and place it on the 3D printer bed.
   */
  function runMeshPrint(printer, job, done) {
    setPrinterLight(printer, "busy");
    var head = printer.userData.printHead;
    var headHome = head ? head.position.clone() : null;
    var tHead0 = performance.now();
    var headAnim = 0;
    if (head) {
      function wiggleHead(now) {
        if (!head || headAnim < 0) return;
        var t = (now - tHead0) / 1000;
        head.position.x = Math.sin(t * 7) * 0.35;
        head.position.z = Math.cos(t * 5.2) * 0.35;
        head.position.y = headHome.y - 0.08 + Math.sin(t * 11) * 0.04;
        if (headAnim) requestAnimationFrame(wiggleHead);
      }
      headAnim = 1;
      requestAnimationFrame(wiggleHead);
    }

    loadPrintImageElement(job.imageUrl)
      .then(function (loaded) {
        headAnim = 0;
        if (head && headHome) head.position.copy(headHome);

        var style = resolvePrintStyle(job.meta || {});
        var result = buildPrintByStyle(loaded.img, job.meta || {}, style);
        var mesh = result.mesh;
        mesh.name = nextName(result.label || style || "Print3D");
        mesh.userData.studioType = result.studioType || "print-3d";
        mesh.userData.studioId = state.objectId;
        mesh.userData.isReliefMesh = true;
        mesh.userData.isDioramaScene = true;
        mesh.userData.printStyle = style;
        mesh.userData.printJob = job;
        mesh.userData._objectUrl = loaded.objectUrl;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.traverse(function (ch) {
          ch.castShadow = true;
          ch.receiveShadow = true;
        });

        state.scene.add(mesh);
        state.objects.push(mesh);

        // Prefer empty shelf slots (display unit) over leaving pieces on the printer bed
        var shelved = placePrintOnShelfSlot(mesh);
        if (!shelved) {
          var stack = printer.userData.printStack || 0;
          printer.userData.printStack = stack + 1;
          var anchor = printer.userData.bedAnchor;
          mesh.position.set(0, 0, 0);
          mesh.scale.set(1, 1, 1);
          mesh.quaternion.identity();
          var bbox = new THREE.Box3().setFromObject(mesh);
          var size = bbox.getSize(new THREE.Vector3());
          var maxDim = Math.max(size.x, size.y, size.z, 0.01);
          mesh.scale.setScalar(1.1 / maxDim);
          mesh.quaternion.copy(printer.quaternion);
          bbox.setFromObject(mesh);
          var center = bbox.getCenter(new THREE.Vector3());
          var bed = new THREE.Vector3((stack % 2) * 0.1 - 0.05, 0, (stack % 3) * 0.08 - 0.08);
          if (anchor) {
            anchor.updateWorldMatrix(true, false);
            anchor.localToWorld(bed);
          } else {
            bed.add(printer.position);
            bed.y = 0.1;
          }
          mesh.position.set(
            bed.x - center.x,
            bed.y - bbox.min.y + 0.01,
            bed.z - center.z
          );
        }

        setPrinterLight(printer, "ok");
        renderOutliner();
        selectObject(mesh);
        setStatus(
          shelved
            ? "3D-printed “" + mesh.name + "” (" + style + ") → shelf slot."
            : "3D-printed “" + mesh.name + "” (" + style + "). Add a Shelf to auto-display prints.",
          "ok"
        );
        done();
      })
      .catch(function (err) {
        headAnim = 0;
        if (head && headHome) head.position.copy(headHome);
        setPrinterLight(printer, "err");
        var msg = (err && err.message) || "3D print failed to load image.";
        setStatus(msg, "err");
        done();
      });
  }

  /* —— Diorama scene from image (skybox + solid meshes + textures) —— */

  function dioramaIdx(x, y, w) {
    return y * w + x;
  }

  function dioramaBlur(field, w, h, radius, passes) {
    passes = passes || 2;
    radius = Math.max(1, radius | 0);
    var n = w * h;
    var src = field;
    var dst = new Float32Array(n);
    var tmp = new Float32Array(n);
    for (var p = 0; p < passes; p++) {
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var sum = 0;
          var c = 0;
          for (var k = -radius; k <= radius; k++) {
            var xx = x + k;
            if (xx < 0 || xx >= w) continue;
            sum += src[dioramaIdx(xx, y, w)];
            c++;
          }
          tmp[dioramaIdx(x, y, w)] = sum / c;
        }
      }
      for (var y2 = 0; y2 < h; y2++) {
        for (var x2 = 0; x2 < w; x2++) {
          var sum2 = 0;
          var c2 = 0;
          for (var k2 = -radius; k2 <= radius; k2++) {
            var yy = y2 + k2;
            if (yy < 0 || yy >= h) continue;
            sum2 += tmp[dioramaIdx(x2, yy, w)];
            c2++;
          }
          dst[dioramaIdx(x2, y2, w)] = sum2 / c2;
        }
      }
      src = dst;
      if (p < passes - 1) dst = new Float32Array(n);
    }
    return src;
  }

  function dioramaNormalize(field, loPct, hiPct) {
    var arr = Array.prototype.slice.call(field).sort(function (a, b) {
      return a - b;
    });
    var n = arr.length;
    if (!n) return field;
    var lo = arr[Math.max(0, Math.min(n - 1, Math.floor(n * loPct)))];
    var hi = arr[Math.max(0, Math.min(n - 1, Math.floor(n * hiPct)))];
    var span = Math.max(1e-6, hi - lo);
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var t = (field[i] - lo) / span;
      out[i] = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    return out;
  }

  function makeImageTexture(img, maxSide) {
    maxSide = maxSide || 1024;
    var iw = img.naturalWidth || img.width || 512;
    var ih = img.naturalHeight || img.height || 512;
    var scale = Math.min(1, maxSide / Math.max(iw, ih));
    var cw = Math.max(2, Math.round(iw * scale));
    var ch = Math.max(2, Math.round(ih * scale));
    var canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, cw, ch);
    var tex = new THREE.CanvasTexture(canvas);
    if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return { texture: tex, canvas: canvas, width: cw, height: ch, ctx: ctx };
  }

  /**
   * Subject-likelihood field (0 = sky/bg, 1 = figure/object).
   */
  function estimateSubjectField(imgData, w, h) {
    var n = w * h;
    var lum = new Float32Array(n);
    var sat = new Float32Array(n);
    var i;
    for (i = 0; i < n; i++) {
      var p = i * 4;
      var r = imgData[p] / 255;
      var g = imgData[p + 1] / 255;
      var b = imgData[p + 2] / 255;
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      var mx = Math.max(r, g, b);
      var mn = Math.min(r, g, b);
      sat[i] = mx > 1e-5 ? (mx - mn) / mx : 0;
    }
    var mean = dioramaBlur(lum, w, h, 5, 1);
    var contrast = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var d = lum[i] - mean[i];
      contrast[i] = Math.abs(d);
    }
    contrast = dioramaBlur(contrast, w, h, 2, 2);
    contrast = dioramaNormalize(contrast, 0.12, 0.9);
    var satN = dioramaNormalize(sat, 0.1, 0.9);
    var field = new Float32Array(n);
    for (var y = 0; y < h; y++) {
      var vNorm = y / Math.max(1, h - 1);
      for (var x = 0; x < w; x++) {
        var ii = dioramaIdx(x, y, w);
        // Sky: bright, desaturated, upper third
        var sky =
          (1 - vNorm) * 0.4 + (1 - satN[ii]) * 0.3 + lum[ii] * 0.2 + (1 - contrast[ii]) * 0.1;
        var subject =
          contrast[ii] * 0.42 +
          satN[ii] * 0.28 +
          vNorm * 0.12 +
          (1 - lum[ii]) * 0.08 +
          (vNorm > 0.35 ? 0.1 : 0);
        field[ii] = Math.max(0, Math.min(1, subject * 0.7 + (1 - sky) * 0.3));
      }
    }
    return dioramaNormalize(dioramaBlur(field, w, h, 1, 2), 0.05, 0.95);
  }

  /** Dilate binary mask (grows subject so limbs/edges aren't clipped). */
  function morphDilate(mask, w, h, r) {
    var n = w * h;
    var out = new Uint8Array(n);
    r = Math.max(1, r | 0);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var on = 0;
        for (var dy = -r; dy <= r && !on; dy++) {
          for (var dx = -r; dx <= r; dx++) {
            var xx = x + dx;
            var yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            if (mask[dioramaIdx(xx, yy, w)]) on = 1;
          }
        }
        out[dioramaIdx(x, y, w)] = on;
      }
    }
    return out;
  }

  function morphClose(mask, w, h, r) {
    return morphDilate(mask, w, h, r); // prefer grow-only so subjects stay complete
  }

  /** Connected components on binary mask. */
  function labelSubjectComponents(mask, w, h, minArea) {
    var n = w * h;
    var labels = new Int32Array(n);
    var comps = [];
    var id = 0;
    var stack = [];
    for (var i = 0; i < n; i++) {
      if (!mask[i] || labels[i]) continue;
      id += 1;
      stack.length = 0;
      stack.push(i);
      labels[i] = id;
      var pixels = [];
      var minX = w;
      var maxX = 0;
      var minY = h;
      var maxY = 0;
      while (stack.length) {
        var cur = stack.pop();
        pixels.push(cur);
        var cx = cur % w;
        var cy = (cur / w) | 0;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        var neigh = [cur - 1, cur + 1, cur - w, cur + w];
        for (var k = 0; k < 4; k++) {
          var nb = neigh[k];
          if (nb < 0 || nb >= n) continue;
          var nx = nb % w;
          var ny = (nb / w) | 0;
          if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
          if (!mask[nb] || labels[nb]) continue;
          labels[nb] = id;
          stack.push(nb);
        }
      }
      if (pixels.length < minArea) {
        for (var p = 0; p < pixels.length; p++) labels[pixels[p]] = 0;
        id -= 1;
        continue;
      }
      comps.push({
        id: id,
        pixels: pixels,
        area: pixels.length,
        minX: minX,
        maxX: maxX,
        minY: minY,
        maxY: maxY,
      });
    }
    comps.sort(function (a, b) {
      return b.area - a.area;
    });
    return { labels: labels, comps: comps };
  }

  /**
   * Moore-neighborhood outer boundary (pixel centers), clockwise-ish.
   * Returns list of {x,y} in pixel coords (y down).
   */
  function traceComponentBoundary(labels, w, h, compId, startIdx) {
    var sx = startIdx % w;
    var sy = (startIdx / w) | 0;
    var x0 = sx;
    var y0 = sy;
    // Neighbor order: E, NE, N, NW, W, SW, S, SE (clockwise from east)
    var dx = [1, 1, 0, -1, -1, -1, 0, 1];
    var dy = [0, -1, -1, -1, 0, 1, 1, 1];
    function inside(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      return labels[dioramaIdx(x, y, w)] === compId;
    }
    // Start direction: coming from west, so first look south… standard Moore
    var path = [];
    var x = x0;
    var y = y0;
    var dir = 0; // start looking east after entering from west conceptually
    // Find a boundary pixel with empty neighbor
    var foundStart = false;
    for (var yy = 0; yy < h && !foundStart; yy++) {
      for (var xx = 0; xx < w; xx++) {
        if (labels[dioramaIdx(xx, yy, w)] !== compId) continue;
        // has empty 4-neighbor?
        if (
          !inside(xx - 1, yy) ||
          !inside(xx + 1, yy) ||
          !inside(xx, yy - 1) ||
          !inside(xx, yy + 1)
        ) {
          x0 = xx;
          y0 = yy;
          foundStart = true;
          break;
        }
      }
    }
    if (!foundStart) {
      return [
        { x: sx, y: sy },
        { x: sx + 1, y: sy },
        { x: sx + 1, y: sy + 1 },
        { x: sx, y: sy + 1 },
      ];
    }
    x = x0;
    y = y0;
    // Initial backtrack direction: from left
    var backDir = 4; // came from west
    var guard = 0;
    var maxSteps = w * h * 4;
    do {
      path.push({ x: x, y: y });
      // Start search from backDir + 1 (turn left relative to entry) — classic
      var startDir = (backDir + 1) % 8;
      var stepped = false;
      for (var t = 0; t < 8; t++) {
        var nd = (startDir + t) % 8;
        var nx = x + dx[nd];
        var ny = y + dy[nd];
        if (inside(nx, ny)) {
          // New back direction is opposite of movement
          backDir = (nd + 4) % 8;
          x = nx;
          y = ny;
          stepped = true;
          break;
        }
      }
      if (!stepped) break;
      guard++;
    } while ((x !== x0 || y !== y0) && guard < maxSteps);

    if (path.length < 3) {
      return [
        { x: x0, y: y0 },
        { x: x0 + 1, y: y0 },
        { x: x0 + 1, y: y0 + 1 },
        { x: x0, y: y0 + 1 },
      ];
    }
    return path;
  }

  function simplifyPolyline(pts, epsilon) {
    if (pts.length <= 4) return pts;
    function perpDist(p, a, b) {
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
    }
    function dpr(points, eps) {
      if (points.length < 3) return points.slice();
      var maxD = 0;
      var idx = 0;
      var a = points[0];
      var b = points[points.length - 1];
      for (var i = 1; i < points.length - 1; i++) {
        var d = perpDist(points[i], a, b);
        if (d > maxD) {
          maxD = d;
          idx = i;
        }
      }
      if (maxD > eps) {
        var left = dpr(points.slice(0, idx + 1), eps);
        var right = dpr(points.slice(idx), eps);
        return left.slice(0, -1).concat(right);
      }
      return [a, b];
    }
    var out = dpr(pts, epsilon);
    if (out.length >= 2) {
      var f = out[0];
      var l = out[out.length - 1];
      if (f.x !== l.x || f.y !== l.y) out.push({ x: f.x, y: f.y });
    }
    return out;
  }

  /** Chaikin corner-cutting for organic silhouettes. */
  function chaikinSmooth(pts, iterations) {
    var cur = pts.slice();
    if (cur.length && (cur[0].x !== cur[cur.length - 1].x || cur[0].y !== cur[cur.length - 1].y)) {
      cur.push({ x: cur[0].x, y: cur[0].y });
    }
    for (var it = 0; it < iterations; it++) {
      var next = [];
      for (var i = 0; i < cur.length - 1; i++) {
        var p0 = cur[i];
        var p1 = cur[i + 1];
        next.push({
          x: 0.75 * p0.x + 0.25 * p1.x,
          y: 0.75 * p0.y + 0.25 * p1.y,
        });
        next.push({
          x: 0.25 * p0.x + 0.75 * p1.x,
          y: 0.25 * p0.y + 0.75 * p1.y,
        });
      }
      if (next.length) next.push({ x: next[0].x, y: next[0].y });
      cur = next;
    }
    return cur;
  }

  /**
   * Map extrude XY (local) onto a texture with upright image orientation.
   * Shape Y-up: y=0 feet → texture bottom; x left→right → u left→right.
   * Uses texture.flipY = true (Three default) — do NOT invert V again.
   */
  function projectExtrudeUVsLocal(geo, x0, y0, x1, y1) {
    var pos = geo.attributes.position;
    var uvs = new Float32Array(pos.count * 2);
    var xs = Math.max(1e-6, x1 - x0);
    var ys = Math.max(1e-6, y1 - y0);
    for (var i = 0; i < pos.count; i++) {
      var px = pos.getX(i);
      var py = pos.getY(i);
      var u = (px - x0) / xs;
      var v = (py - y0) / ys;
      uvs[i * 2] = Math.max(0, Math.min(1, u));
      uvs[i * 2 + 1] = Math.max(0, Math.min(1, v));
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  }

  function makeCanvasTexture(canvas, flipY) {
    var tex = new THREE.CanvasTexture(canvas);
    if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = flipY !== false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  /** Vertical image strip (x0–x1 as 0–1) for side walls. */
  function makeImageRegionTexture(img, u0, v0, u1, v1, outW, outH) {
    var iw = img.naturalWidth || img.width || 1;
    var ih = img.naturalHeight || img.height || 1;
    var c = document.createElement("canvas");
    c.width = outW || 512;
    c.height = outH || 512;
    var ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      img,
      u0 * iw,
      v0 * ih,
      Math.max(1, (u1 - u0) * iw),
      Math.max(1, (v1 - v0) * ih),
      0,
      0,
      c.width,
      c.height
    );
    return makeCanvasTexture(c, true);
  }

  /**
   * Build a complete subject mask (full figure, no floor/sky clipping).
   * Grows the mask so limbs and edges stay intact.
   */
  function buildFullSubjectMask(subjectField, w, h) {
    var n = w * h;
    var sorted = Array.prototype.slice.call(subjectField).sort(function (a, b) {
      return a - b;
    });
    // Inclusive threshold — keep the full figure (was cutting at ~0.58)
    var thr = sorted[Math.floor(n * 0.42)] || 0.35;
    thr = Math.max(0.28, Math.min(0.48, thr));

    // Center bias: boost middle of frame (where subjects usually are)
    var mask = new Uint8Array(n);
    var cx = (w - 1) * 0.5;
    var cy = (h - 1) * 0.52;
    var i;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        i = dioramaIdx(x, y, w);
        var nx = (x - cx) / (w * 0.55);
        var ny = (y - cy) / (h * 0.55);
        var centerBoost = Math.max(0, 1 - (nx * nx + ny * ny));
        var score = subjectField[i] + centerBoost * 0.12;
        mask[i] = score >= thr ? 1 : 0;
      }
    }

    // Grow only (no erode) so hands/feet/hair aren't clipped
    mask = morphDilate(mask, w, h, 2);
    mask = morphDilate(mask, w, h, 1);

    // Label and keep the main subject mass (largest + any touching neighbors)
    var labeled = labelSubjectComponents(mask, w, h, Math.max(24, (n * 0.002) | 0));
    if (!labeled.comps.length) {
      // Fallback: whole center ellipse
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          nx = (x - cx) / (w * 0.35);
          ny = (y - cy) / (h * 0.4);
          mask[dioramaIdx(x, y, w)] = nx * nx + ny * ny <= 1 ? 1 : 0;
        }
      }
      labeled = labelSubjectComponents(mask, w, h, 10);
    }

    // Union: primary component + any component that overlaps its dilated bbox
    // (keeps multi-part figures: head+body, person+held object)
    var primary = labeled.comps[0];
    var keepIds = {};
    keepIds[primary.id] = 1;
    var margin = Math.max(4, Math.min(w, h) * 0.04);
    for (var c = 1; c < labeled.comps.length; c++) {
      var o = labeled.comps[c];
      var near =
        o.minX <= primary.maxX + margin &&
        o.maxX >= primary.minX - margin &&
        o.minY <= primary.maxY + margin &&
        o.maxY >= primary.minY - margin;
      // Also keep large secondary figures (second character)
      if (near || o.area > primary.area * 0.35) keepIds[o.id] = 1;
    }

    var union = new Uint8Array(n);
    var minX = w;
    var maxX = 0;
    var minY = h;
    var maxY = 0;
    var pixels = [];
    for (i = 0; i < n; i++) {
      var id = labeled.labels[i];
      if (!id || !keepIds[id]) continue;
      union[i] = 1;
      pixels.push(i);
      var px = i % w;
      var py = (i / w) | 0;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    // Final grow for a complete outline
    union = morphDilate(union, w, h, 1);

    // Recompute bounds after dilate
    minX = w;
    maxX = 0;
    minY = h;
    maxY = 0;
    pixels = [];
    for (i = 0; i < n; i++) {
      if (!union[i]) continue;
      pixels.push(i);
      px = i % w;
      py = (i / w) | 0;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    // Fake single-id labels for boundary trace
    var labels = new Int32Array(n);
    for (i = 0; i < n; i++) if (union[i]) labels[i] = 1;

    return {
      mask: union,
      labels: labels,
      comp: {
        id: 1,
        pixels: pixels,
        area: pixels.length,
        minX: minX,
        maxX: maxX,
        minY: minY,
        maxY: maxY,
      },
    };
  }

  /**
   * Read palette + mood from the image (and optional stasis/prompt text)
   * so adornment feels subjective rather than a flat photo plaque.
   */
  function analyzeImageForCenterfold(img, meta) {
    var c = document.createElement("canvas");
    c.width = 48;
    c.height = 48;
    var ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, 48, 48);
    var data = ctx.getImageData(0, 0, 48, 48).data;
    var sumR = 0;
    var sumG = 0;
    var sumB = 0;
    var sumL = 0;
    var sumS = 0;
    var n = 48 * 48;
    var buckets = {};
    var i;
    for (i = 0; i < n; i++) {
      var p = i * 4;
      var r = data[p];
      var g = data[p + 1];
      var b = data[p + 2];
      sumR += r;
      sumG += g;
      sumB += b;
      var mx = Math.max(r, g, b) / 255;
      var mn = Math.min(r, g, b) / 255;
      var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      sumL += lum;
      sumS += mx > 1e-5 ? (mx - mn) / mx : 0;
      // quantize for accents
      var key =
        ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, c: 0 };
      buckets[key].r += r;
      buckets[key].g += g;
      buckets[key].b += b;
      buckets[key].c += 1;
    }
    var avgR = sumR / n / 255;
    var avgG = sumG / n / 255;
    var avgB = sumB / n / 255;
    var warmth = Math.max(0, Math.min(1, (avgR - avgB) * 1.5 + 0.5));
    var sat = sumS / n;
    var lum = sumL / n;
    var accents = Object.keys(buckets)
      .map(function (k) {
        var bkt = buckets[k];
        return {
          r: bkt.r / bkt.c / 255,
          g: bkt.g / bkt.c / 255,
          b: bkt.b / bkt.c / 255,
          c: bkt.c,
        };
      })
      .sort(function (a, b) {
        return b.c - a.c;
      })
      .slice(0, 6);

    var stasis = String((meta && (meta.stasis || meta.prompt || "")) || "").toLowerCase();
    var density = 1;
    var ornate = 1;
    var metalBias = warmth > 0.55 ? "gold" : warmth < 0.4 ? "silver" : "rose";
    if (/gold|gilded|ornate|baroque|lavish|jeweled|crown|royal/.test(stasis)) {
      metalBias = "gold";
      ornate = 1.35;
      density = 1.25;
    }
    if (/dark|void|night|shadow|obsidian|noir|gothic/.test(stasis)) {
      metalBias = "obsidian";
      ornate = 1.15;
    }
    if (/crystal|ice|glass|silver|moon|pearl/.test(stasis)) {
      metalBias = "silver";
      density = 1.1;
    }
    if (/soft|pastel|gentle|dream|mist/.test(stasis)) {
      ornate = 0.75;
      density = 0.85;
    }
    if (/fire|ember|blood|crimson|sun/.test(stasis)) {
      metalBias = "copper";
      density = 1.2;
    }

    var metalHex =
      metalBias === "gold"
        ? 0xc9a227
        : metalBias === "silver"
          ? 0xc0c8d4
          : metalBias === "obsidian"
            ? 0x2a2e38
            : metalBias === "copper"
              ? 0xb87333
              : 0xb76e79;

    return {
      avg: { r: avgR, g: avgG, b: avgB },
      warmth: warmth,
      sat: sat,
      lum: lum,
      accents: accents,
      metalHex: metalHex,
      metalBias: metalBias,
      density: density,
      ornate: ornate,
      stasis: stasis,
    };
  }

  function tubeAlongPoints(pts, radius, radialSegs) {
    var vectors = pts.map(function (p) {
      return new THREE.Vector3(p.x, p.y, p.z);
    });
    var curve = new THREE.CatmullRomCurve3(vectors, false, "catmullrom", 0.4);
    return new THREE.TubeGeometry(curve, Math.max(12, pts.length * 4), radius, radialSegs || 6, false);
  }

  /** Stable 32-bit seed from image pixels + mood so each image gets a different build. */
  function imageMeshSeed(img, mood, subjectComp) {
    var c = document.createElement("canvas");
    c.width = 16;
    c.height = 16;
    var ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, 16, 16);
    var d = ctx.getImageData(0, 0, 16, 16).data;
    var h = 2166136261;
    for (var i = 0; i < d.length; i += 4) {
      h ^= d[i] + d[i + 1] * 3 + d[i + 2] * 7;
      h = Math.imul(h, 16777619);
    }
    h ^= Math.floor(mood.warmth * 997) << 3;
    h ^= Math.floor(mood.sat * 991) << 7;
    h ^= Math.floor(mood.lum * 983) << 11;
    if (subjectComp) {
      h ^= (subjectComp.maxX - subjectComp.minX) * 13;
      h ^= (subjectComp.maxY - subjectComp.minY) * 17;
      h ^= subjectComp.area * 19;
    }
    return h >>> 0;
  }

  function seededRand(seedObj) {
    // xorshift
    var x = seedObj.s || 1;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    seedObj.s = x >>> 0;
    return (seedObj.s & 0xfffffff) / 0xfffffff;
  }

  /**
   * Complete observatory globe on a stand.
   * - Full sphere (not incomplete) with sharp image
   * - Spins slowly; armillary rings counter-rotate
   * - Structure still varies by image seed
   */
  function buildCenterfoldShowcase(img, meta) {
    var group = new THREE.Group();
    group.userData.isDioramaScene = true;
    group.userData.isReliefMesh = true;
    group.userData.isCenterfold = true;
    group.userData.isGlobe = true;
    group.userData.spinGlobe = true;

    var mood = analyzeImageForCenterfold(img, meta || {});
    var full = makeImageTexture(img, 1536);
    var iw = img.naturalWidth || img.width || 1;
    var ih = img.naturalHeight || img.height || 1;
    var aspect = iw / Math.max(1, ih);

    var cols = 64;
    var rows = Math.max(32, Math.round(cols / aspect));
    var sample = document.createElement("canvas");
    sample.width = cols;
    sample.height = rows;
    var sctx = sample.getContext("2d");
    sctx.drawImage(img, 0, 0, cols, rows);
    var subjectField = estimateSubjectField(
      sctx.getImageData(0, 0, cols, rows).data,
      cols,
      rows
    );
    var fullSub = buildFullSubjectMask(subjectField, cols, rows);
    var seed = imageMeshSeed(img, mood, fullSub.comp);
    var rng = { s: seed || 1 };
    var dens = mood.density;
    var ornate = mood.ornate;

    var R = 0.55 + seededRand(rng) * 0.14;
    var ringCount = 2 + Math.floor(seededRand(rng) * 3);
    var pedestalStyle = Math.floor(seededRand(rng) * 3);
    var jewelN = 5 + Math.floor(seededRand(rng) * 6 * dens);
    // rad/sec — each globe gets a slightly different tempo
    var spinY = 0.28 + seededRand(rng) * 0.35;
    var ringSpin = -(0.15 + seededRand(rng) * 0.25);

    var metalMat = new THREE.MeshStandardMaterial({
      color: mood.metalHex,
      metalness: mood.metalBias === "obsidian" ? 0.88 : 0.94,
      roughness: mood.metalBias === "obsidian" ? 0.32 : 0.18,
    });
    var darkMat = new THREE.MeshStandardMaterial({
      color: 0x161820,
      metalness: 0.45,
      roughness: 0.5,
    });
    var accent = mood.accents[1] || mood.accents[0] || { r: 0.85, g: 0.65, b: 0.35 };
    var jewelMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accent.r, accent.g, accent.b),
      metalness: 0.25,
      roughness: 0.12,
      emissive: new THREE.Color(accent.r * 0.25, accent.g * 0.25, accent.b * 0.25),
      emissiveIntensity: 0.35 + mood.sat * 0.25,
    });

    var cy = R * 0.12;

    // Spinning assembly (globe + rings); stand stays fixed
    var spinRoot = new THREE.Group();
    spinRoot.name = "SpinRoot";
    spinRoot.position.y = cy;
    spinRoot.userData.spinY = spinY;
    group.add(spinRoot);
    group.userData.spinRoot = spinRoot;

    var imgTex = full.texture;
    imgTex.flipY = true;
    imgTex.anisotropy = 8;
    imgTex.needsUpdate = true;
    if ("colorSpace" in imgTex) imgTex.colorSpace = THREE.SRGBColorSpace;

    // Complete sphere — sharp image, fully closed
    var globe = new THREE.Mesh(
      new THREE.SphereGeometry(R, 64, 48),
      new THREE.MeshBasicMaterial({
        map: imgTex,
        side: THREE.FrontSide,
        toneMapped: false,
      })
    );
    globe.name = "ImageGlobe";
    spinRoot.add(globe);
    group.userData.primaryMesh = globe;

    // Very light glass shell (does not hide the image)
    var glass = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.02, 48, 32),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.05,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        side: THREE.FrontSide,
      })
    );
    glass.name = "Glass";
    spinRoot.add(glass);

    // Armillary cage (counter-rotates for observatory feel)
    var ringsRoot = new THREE.Group();
    ringsRoot.name = "RingsRoot";
    ringsRoot.userData.spinY = ringSpin;
    spinRoot.add(ringsRoot);
    group.userData.ringsRoot = ringsRoot;

    var tubeW = 0.011 + ornate * 0.007 + seededRand(rng) * 0.005;
    for (var ri = 0; ri < ringCount; ri++) {
      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(
          R * (1.06 + ri * 0.05),
          tubeW * (1 - ri * 0.1),
          8,
          56
        ),
        metalMat
      );
      ring.rotation.set(
        seededRand(rng) * Math.PI,
        seededRand(rng) * Math.PI,
        seededRand(rng) * Math.PI
      );
      ring.name = "Armillary";
      ringsRoot.add(ring);
    }

    for (var j = 0; j < jewelN; j++) {
      var ang = (j / jewelN) * Math.PI * 2 + seededRand(rng);
      var elev = (seededRand(rng) - 0.5) * Math.PI * 0.7;
      var acc = mood.accents[j % Math.max(1, mood.accents.length)] || accent;
      var jm = jewelMat.clone();
      jm.color = new THREE.Color(acc.r, acc.g, acc.b);
      var jsize = 0.022 + seededRand(rng) * 0.02;
      var jewel = new THREE.Mesh(
        seededRand(rng) > 0.5
          ? new THREE.OctahedronGeometry(jsize, 0)
          : new THREE.IcosahedronGeometry(jsize, 0),
        jm
      );
      var jrad = R * 1.08;
      jewel.position.set(
        Math.cos(ang) * Math.cos(elev) * jrad,
        Math.sin(elev) * jrad,
        Math.sin(ang) * Math.cos(elev) * jrad
      );
      ringsRoot.add(jewel);
    }

    // Polar finial (spins with globe)
    if (seededRand(rng) > 0.3) {
      var finial = new THREE.Mesh(
        new THREE.ConeGeometry(0.04, 0.09, 6 + Math.floor(seededRand(rng) * 4)),
        metalMat
      );
      finial.position.y = R * 1.02;
      spinRoot.add(finial);
    }

    // —— Fixed stand ——
    var standTop = cy - R * 0.98;
    var neck = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.055 + seededRand(rng) * 0.025,
        0.085,
        0.1,
        8 + Math.floor(seededRand(rng) * 10)
      ),
      metalMat
    );
    neck.position.y = standTop;
    group.add(neck);

    if (pedestalStyle === 0) {
      var roundP = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.34, 0.12, 28),
        darkMat
      );
      roundP.position.y = standTop - 0.14;
      group.add(roundP);
      var pr = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 8, 28), metalMat);
      pr.rotation.x = Math.PI / 2;
      pr.position.y = standTop - 0.08;
      group.add(pr);
    } else if (pedestalStyle === 1) {
      var hexP = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.36, 0.14, 6),
        darkMat
      );
      hexP.position.y = standTop - 0.15;
      group.add(hexP);
    } else {
      var step1 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.24, 0.06, 20),
        darkMat
      );
      step1.position.y = standTop - 0.08;
      group.add(step1);
      var step2 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.34, 0.07, 20),
        darkMat
      );
      step2.position.y = standTop - 0.15;
      group.add(step2);
      var step3 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.38, 0.4, 0.05, 24),
        metalMat
      );
      step3.position.y = standTop - 0.22;
      group.add(step3);
    }

    var baseDisk = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.36 + seededRand(rng) * 0.08,
        0.4,
        0.045,
        12 + Math.floor(seededRand(rng) * 16)
      ),
      metalMat
    );
    baseDisk.position.y = standTop - 0.28;
    group.add(baseDisk);

    var key = new THREE.PointLight(0xffffff, 0.45, 5, 2);
    key.position.set(0.45, cy + 0.35, 0.85);
    group.add(key);

    return { mesh: group, heightMesh: group.userData.primaryMesh };
  }

  function updateSpinningGlobes(dt) {
    if (!state.objects || !state.objects.length) return;
    for (var i = 0; i < state.objects.length; i++) {
      var obj = state.objects[i];
      if (!obj || !obj.userData || !obj.userData.spinGlobe) continue;
      var root = obj.userData.spinRoot;
      if (root && root.userData.spinY) {
        root.rotation.y += root.userData.spinY * dt;
      }
      var rings = obj.userData.ringsRoot;
      if (rings && rings.userData.spinY) {
        rings.rotation.y += rings.userData.spinY * dt;
        rings.rotation.x += rings.userData.spinY * 0.35 * dt;
      }
    }
  }

  function resolvePrintStyle(meta) {
    var sel = $("mod-print-style");
    var style = (sel && sel.value) || state.printStyle || "auto";
    state.printStyle = style;
    if (style && style !== "auto") return style;
    var styles = ["globe", "flag", "plaque", "totem", "crystal"];
    var h = 0;
    var s =
      String((meta && meta.stasis) || "") +
      String((meta && meta.imageUrl) || "") +
      String(Date.now());
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return styles[h % styles.length];
  }

  function buildPrintByStyle(img, meta, style) {
    style = style || "globe";
    // "shelf" was a bad generative backdrop — shelves are scene primitives only
    if (style === "shelf") style = "globe";
    if (style === "flag") return buildFlagShowcase(img, meta);
    if (style === "plaque") return buildPlaqueShowcase(img, meta);
    if (style === "totem") return buildTotemShowcase(img, meta);
    if (style === "crystal") return buildCrystalShowcase(img, meta);
    var g = buildCenterfoldShowcase(img, meta);
    g.label = "Globe";
    g.studioType = "ornate-globe";
    return g;
  }

  /** Flag / centerfold open-spread (restored — user liked these). */
  function buildFlagShowcase(img, meta) {
    var group = new THREE.Group();
    group.userData.isReliefMesh = true;
    var mood = analyzeImageForCenterfold(img, meta || {});
    var full = makeImageTexture(img, 1280);
    var iw = img.naturalWidth || img.width || 1;
    var ih = img.naturalHeight || img.height || 1;
    var aspect = iw / Math.max(1, ih);
    var pageH = 1.1;
    var pageW = Math.min(1.5, pageH * aspect);
    var halfW = pageW * 0.5;
    var open = 0.36;
    var metalMat = new THREE.MeshStandardMaterial({
      color: mood.metalHex,
      metalness: 0.9,
      roughness: 0.22,
    });
    var tex = full.texture;
    tex.flipY = true;
    if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    function page(side) {
      var geo = new THREE.PlaneGeometry(halfW, pageH, 24, 18);
      var uvs = geo.attributes.uv;
      for (var i = 0; i < uvs.count; i++) {
        var u = uvs.getX(i);
        uvs.setX(i, side < 0 ? u * 0.5 : 0.5 + u * 0.5);
      }
      uvs.needsUpdate = true;
      var m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          map: tex,
          side: THREE.DoubleSide,
          toneMapped: false,
        })
      );
      m.position.x = side * (halfW * 0.5);
      m.rotation.y = -side * open;
      return m;
    }
    group.add(page(-1));
    group.add(page(1));
    var spine = new THREE.Mesh(new THREE.BoxGeometry(0.04, pageH * 1.02, 0.07), metalMat);
    spine.position.z = 0.02;
    group.add(spine);
    var pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.03, pageH * 1.25, 12),
      metalMat
    );
    pole.position.set(-pageW * 0.55, 0, 0);
    group.add(pole);
    var base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.28, 0.1, 20),
      new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.6 })
    );
    base.position.y = -pageH * 0.55;
    group.add(base);
    group.userData.primaryMesh = group.children[0];
    return { mesh: group, label: "Flag", studioType: "flag-print", heightMesh: group };
  }

  function buildPlaqueShowcase(img, meta) {
    var group = new THREE.Group();
    group.userData.isReliefMesh = true;
    var mood = analyzeImageForCenterfold(img, meta || {});
    var full = makeImageTexture(img, 1280);
    var tex = full.texture;
    tex.flipY = true;
    if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
    var iw = img.naturalWidth || img.width || 1;
    var ih = img.naturalHeight || img.height || 1;
    var aspect = iw / Math.max(1, ih);
    var w = 1.2;
    var h = w / aspect;
    var plate = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.08),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    group.add(plate);
    var frame = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.05),
      new THREE.MeshStandardMaterial({
        color: mood.metalHex,
        metalness: 0.85,
        roughness: 0.25,
      })
    );
    frame.position.z = -0.04;
    group.add(frame);
    var stand = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.08, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.65 })
    );
    stand.position.y = -h * 0.5 - 0.06;
    group.add(stand);
    group.userData.primaryMesh = plate;
    return { mesh: group, label: "Plaque", studioType: "plaque-print", heightMesh: plate };
  }

  function buildTotemShowcase(img, meta) {
    var group = new THREE.Group();
    group.userData.isReliefMesh = true;
    var mood = analyzeImageForCenterfold(img, meta || {});
    var full = makeImageTexture(img, 1024);
    var tex = full.texture;
    tex.flipY = true;
    if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
    var layers = 4 + Math.floor(mood.density * 2);
    var y = 0;
    for (var i = 0; i < layers; i++) {
      var r = 0.35 - i * 0.04;
      var hh = 0.22 + (i % 2) * 0.08;
      var disk = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 0.95, hh, 24),
        i === 0
          ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
          : new THREE.MeshStandardMaterial({
              color: mood.metalHex,
              metalness: 0.7,
              roughness: 0.3,
            })
      );
      disk.position.y = y + hh * 0.5;
      group.add(disk);
      y += hh + 0.02;
    }
    var base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.45, 0.1, 20),
      new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.6 })
    );
    base.position.y = -0.05;
    group.add(base);
    group.userData.primaryMesh = group.children[0];
    return { mesh: group, label: "Totem", studioType: "totem-print", heightMesh: group };
  }

  function buildCrystalShowcase(img, meta) {
    var group = new THREE.Group();
    group.userData.isReliefMesh = true;
    var mood = analyzeImageForCenterfold(img, meta || {});
    var full = makeImageTexture(img, 1024);
    var tex = full.texture;
    tex.flipY = true;
    if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
    var crystal = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.65, 1),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    group.add(crystal);
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.75, 0.03, 8, 40),
      new THREE.MeshStandardMaterial({
        color: mood.metalHex,
        metalness: 0.9,
        roughness: 0.2,
      })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.55;
    group.add(ring);
    var base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.4, 0.12, 16),
      new THREE.MeshStandardMaterial({ color: 0x1a1e28, metalness: 0.4, roughness: 0.5 })
    );
    base.position.y = -0.7;
    group.add(base);
    group.userData.primaryMesh = crystal;
    return { mesh: group, label: "Crystal", studioType: "crystal-print", heightMesh: crystal };
  }

  function buildDioramaSceneFromImage(img, meta) {
    return buildCenterfoldShowcase(img, meta || {});
  }

  function buildReliefMeshFromImage(img) {
    return buildCenterfoldShowcase(img, {});
  }

  /**
   * Snap object flat onto a nearby face (not edge-on).
   * Planes/prints align local +Z to the face normal so they lie flush.
   * Volumes align local +Y (up) to the face normal so they sit on the surface.
   */
  function snapObjectToNearbyFaces(obj, forceGround) {
    if (!obj || !state.snapEnabled || !state.scene) return false;
    if (obj.userData && (obj.userData.isSpellforgePlane || obj.userData.isPrinter)) {
      return false;
    }
    ensureMathTemps();
    obj.updateWorldMatrix(true, true);
    var box = state._snapBox.setFromObject(obj);
    var center = box.getCenter(new THREE.Vector3());
    var size = box.getSize(new THREE.Vector3());
    var half = Math.max(size.x, size.y, size.z) * 0.5;

    var isFlat =
      !!(obj.userData && obj.userData.isPrint) ||
      (obj.userData && obj.userData.studioType === "plane") ||
      (obj.geometry && obj.geometry.type === "PlaneGeometry");
    // Diorama scenes are volumetric (Y-up) — sit like solids, not paper prints

    var others = state.objects.filter(function (o) {
      if (o === obj) return false;
      if (o.userData && o.userData.isSpellforgePlane) return false;
      // Never snap onto other paper prints — that caused flying / 90° piles
      if (o.userData && o.userData.isPrint) return false;
      if (o.userData && o.userData.isReliefMesh) return false;
      return true;
    });

    // Prefer downward first (set on tops of things), then other axes
    var dirs = [
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ];
    var best = null;
    var maxSnap = Math.max(0.65, half + 0.45);

    for (var d = 0; d < dirs.length; d++) {
      state._snapRay.set(center, dirs[d]);
      state._snapRay.near = 0;
      state._snapRay.far = maxSnap;
      var hits = state._snapRay.intersectObjects(others, true);
      if (!hits.length) continue;
      var h = hits[0];
      // Prefer closer hits; slight bias for downward
      var score = h.distance + (d === 0 ? -0.02 : 0);
      if (!best || score < best.score) {
        best = { hit: h, score: score };
      }
    }

    // Ground y=0
    if (!best && (forceGround || center.y < half + 0.5)) {
      layObjectOnGround(obj, isFlat, size);
      return true;
    }
    if (!best || !best.hit || !best.hit.face) return false;

    var hit = best.hit;
    var n = hit.face.normal
      .clone()
      .transformDirection(hit.object.matrixWorld)
      .normalize();
    // Face normal should point toward the object (out of the surface)
    var toObj = center.clone().sub(hit.point);
    if (n.dot(toObj) < 0) n.negate();

    // Local axis that should match the surface normal:
    // - Flat objects (planes/prints): +Z is the face, so lie flush
    // - Volumes: +Y is "up", so sit on the surface
    var localAxis = isFlat
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0);

    if (localAxis.distanceToSquared(n) > 1e-8 && localAxis.clone().negate().distanceToSquared(n) > 1e-8) {
      state._snapQ.setFromUnitVectors(localAxis, n);
    } else if (localAxis.clone().negate().distanceToSquared(n) < 1e-8) {
      // 180° flip
      state._snapQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    } else {
      state._snapQ.identity();
    }
    obj.quaternion.copy(state._snapQ);

    // Seat flush: push along normal so the closest point sits on the surface
    obj.position.copy(hit.point);
    obj.updateWorldMatrix(true, true);
    var minAlong = Infinity;
    var tmp = state._tmpV;
    var corners = [
      new THREE.Vector3(1, 1, 1),
      new THREE.Vector3(1, 1, -1),
      new THREE.Vector3(1, -1, 1),
      new THREE.Vector3(1, -1, -1),
      new THREE.Vector3(-1, 1, 1),
      new THREE.Vector3(-1, 1, -1),
      new THREE.Vector3(-1, -1, 1),
      new THREE.Vector3(-1, -1, -1),
    ];
    var b2 = new THREE.Box3().setFromObject(obj);
    var c2 = b2.getCenter(new THREE.Vector3());
    var s2 = b2.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    for (var i = 0; i < 8; i++) {
      tmp.set(
        c2.x + corners[i].x * s2.x,
        c2.y + corners[i].y * s2.y,
        c2.z + corners[i].z * s2.z
      );
      var along = tmp.clone().sub(hit.point).dot(n);
      if (along < minAlong) minAlong = along;
    }
    // minAlong is how far the deepest point is along n from the hit; we want ~epsilon
    obj.position.addScaledVector(n, -minAlong + 0.004);
    return true;
  }

  function layObjectOnGround(obj, isFlat, size) {
    if (isFlat) {
      // Image face up on the floor
      obj.quaternion.identity();
      obj.rotateX(-Math.PI / 2);
      obj.updateWorldMatrix(true, true);
      var b = new THREE.Box3().setFromObject(obj);
      obj.position.y += 0.004 - b.min.y;
    } else {
      obj.rotation.x = 0;
      obj.rotation.z = 0;
      // Keep current Y rotation (yaw)
      obj.updateWorldMatrix(true, true);
      var b2 = new THREE.Box3().setFromObject(obj);
      obj.position.y += -b2.min.y;
    }
  }

  function onTransformDragEnd() {
    if (!state.selected) return;
    if (state.selected.userData && state.selected.userData.isSpellforgePlane) {
      refreshSpellforgePointerMode();
      return;
    }
    if (state.selected.userData && state.selected.userData.isPrinter) {
      refreshSpellforgePointerMode();
      return;
    }
    var snapped = snapObjectToNearbyFaces(state.selected, false);
    if (snapped) {
      setStatus("Snapped flat to nearby surface.", "ok");
    }
    refreshSpellforgePointerMode();
  }

  function defaultMaterial(color) {
    // Physical so opacity can map to transmission (light actually passes through)
    var m = new THREE.MeshPhysicalMaterial({
      color: color || 0x8a90a8,
      metalness: 0.15,
      roughness: 0.55,
      opacity: 1,
      transparent: false,
      transmission: 0,
      thickness: 0,
      ior: 1.45,
      flatShading: false,
      // Both sides — after extrude you look at wall backs / flipped winding often
      side: THREE.DoubleSide,
    });
    m.userData = m.userData || {};
    m.userData.fillMode = "color";
    return m;
  }

  /** Always show color/texture on both face sides (avoids invisible “see-through” backs). */
  function applyMaterialTwoSided(mat) {
    if (!mat) return;
    mat.side = THREE.DoubleSide;
    mat.needsUpdate = true;
  }

  /**
   * Shadow pass that respects opacity: dithered depth so shadows are fainter
   * when light can pass through (not a full black blocker).
   */
  function setupTranslucentShadowMaterial(mat, opacity) {
    if (!mat) return;
    var o = Math.max(0, Math.min(1, opacity));
    if (o >= 0.995) {
      if (mat.customDepthMaterial) {
        try {
          mat.customDepthMaterial.dispose();
        } catch (e) {}
        mat.customDepthMaterial = null;
      }
      if (mat.customDistanceMaterial) {
        try {
          mat.customDistanceMaterial.dispose();
        } catch (e2) {}
        mat.customDistanceMaterial = null;
      }
      mat.userData._depthMat = null;
      return;
    }
    var depthMat = mat.userData._depthMat;
    if (!depthMat) {
      depthMat = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
      });
      mat.userData._depthMat = depthMat;
    }
    depthMat.opacity = o;
    depthMat.transparent = true;
    // Stochastic discard ∝ (1 − opacity) → thinner / softer shadow density
    if ("alphaHash" in depthMat) {
      depthMat.alphaHash = true;
    } else {
      // Older fallback: hard cut (still better than full blocker at low opacity)
      depthMat.alphaTest = Math.max(0.02, 1 - o);
    }
    depthMat.depthWrite = true;
    depthMat.side = mat.side != null ? mat.side : THREE.DoubleSide;
    depthMat.needsUpdate = true;
    mat.customDepthMaterial = depthMat;
    mat.customDistanceMaterial = depthMat;
  }

  /** Cast shadows only when material still blocks a meaningful amount of light. */
  function syncMeshShadowCasting(root) {
    if (!root) root = state.selected;
    if (!root) return;
    root.traverse(function (ch) {
      if (!ch.isMesh) return;
      var mats = Array.isArray(ch.material) ? ch.material : [ch.material];
      var maxOp = 0;
      var any = false;
      mats.forEach(function (m) {
        if (!m) return;
        any = true;
        var op = m.opacity != null && isFinite(m.opacity) ? m.opacity : 1;
        // Transmission means less light blocked even at high opacity
        if (m.transmission != null && m.transmission > 0) {
          op *= 1 - Math.min(0.95, m.transmission);
        }
        if (op > maxOp) maxOp = op;
      });
      if (!any) return;
      // Nearly invisible materials cast no shadow
      ch.castShadow = maxOp > 0.07;
    });
  }

  /**
   * Apply opacity so light can pass through:
   *  - surface becomes translucent (transparent + optional transmission)
   *  - shadows thin out with opacity (not fully present)
   */
  function applyMaterialOpacity(mat, opacity) {
    if (!mat) return;
    var o = Number(opacity);
    if (!isFinite(o)) o = 1;
    o = Math.max(0, Math.min(1, o));

    if (o >= 0.999) {
      mat.opacity = 1;
      mat.transparent = false;
      mat.depthWrite = true;
      if ("transmission" in mat) {
        mat.transmission = 0;
        mat.thickness = 0;
      }
      setupTranslucentShadowMaterial(mat, 1);
      applyMaterialTwoSided(mat);
      mat.needsUpdate = true;
      syncMeshShadowCasting(state.selected);
      return;
    }

    mat.opacity = o;
    mat.transparent = true;
    // Don't write full depth when translucent — objects behind stay lit/visible
    mat.depthWrite = o >= 0.9;

    // Physical light pass-through (MeshPhysicalMaterial)
    if ("transmission" in mat) {
      // Lower opacity → higher transmission (light not fully displaced)
      var trans = Math.pow(1 - o, 0.85) * 0.92;
      mat.transmission = trans;
      mat.thickness = trans > 0.02 ? 0.45 : 0;
      if (mat.attenuationDistance == null || mat.attenuationDistance === Infinity) {
        mat.attenuationDistance = 2.5;
      }
      // Keep a bit of surface presence so color still reads
      if (trans > 0.4) {
        mat.opacity = Math.max(o, 0.12);
      }
    }

    setupTranslucentShadowMaterial(mat, o);
    applyMaterialTwoSided(mat);
    mat.needsUpdate = true;
    syncMeshShadowCasting(state.selected);
  }

  function getMaterialFillMode(mat) {
    if (!mat) return "color";
    if (mat.userData && mat.userData.fillMode === "image") return "image";
    if (mat.map) return "image";
    return "color";
  }

  function disposeMaterialMap(mat) {
    if (!mat || !mat.map) return;
    try {
      if (mat.map.dispose) mat.map.dispose();
    } catch (e) {}
    mat.map = null;
    mat.needsUpdate = true;
  }

  /** Ensure geometry has UVs so image maps display on primitives. */
  function ensureBasicUVs(geo) {
    if (!geo || !geo.attributes || !geo.attributes.position) return;
    if (geo.attributes.uv) return;
    geo.computeBoundingBox();
    var bb = geo.boundingBox;
    var pos = geo.attributes.position;
    var sx = Math.max(1e-6, bb.max.x - bb.min.x);
    var sy = Math.max(1e-6, bb.max.y - bb.min.y);
    var sz = Math.max(1e-6, bb.max.z - bb.min.z);
    var uvs = new Float32Array(pos.count * 2);
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i);
      var y = pos.getY(i);
      var z = pos.getZ(i);
      // Prefer XZ for top-down, fall back to XY if flat on XZ
      if (sz >= sx * 0.05 || sz >= sy * 0.05) {
        uvs[i * 2] = (x - bb.min.x) / sx;
        uvs[i * 2 + 1] = (z - bb.min.z) / sz;
      } else {
        uvs[i * 2] = (x - bb.min.x) / sx;
        uvs[i * 2 + 1] = (y - bb.min.y) / sy;
      }
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  }

  function setMaterialFillMode(mat, mode, mesh) {
    if (!mat) return;
    mat.userData = mat.userData || {};
    if (mode === "image") {
      mat.userData.fillMode = "image";
      // Image maps usually want white base so the texture shows true colors
      if (!mat.map) mat.color.set(0xffffff);
      if (mesh && mesh.geometry) ensureBasicUVs(mesh.geometry);
    } else {
      mat.userData.fillMode = "color";
      disposeMaterialMap(mat);
      mat.userData.imageDataUrl = "";
    }
    mat.needsUpdate = true;
  }

  function applyMaterialImageFromDataUrl(mat, dataUrl, mesh) {
    if (!mat || !dataUrl) return;
    mat.userData = mat.userData || {};
    mat.userData.fillMode = "image";
    mat.userData.imageDataUrl = dataUrl;
    if (mesh && mesh.geometry) ensureBasicUVs(mesh.geometry);
    var img = new Image();
    img.onload = function () {
      disposeMaterialMap(mat);
      var tex = new THREE.Texture(img);
      if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = true;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
      updateMaterialImagePreview(dataUrl);
      setStatus("Image applied to material.", "ok");
    };
    img.onerror = function () {
      setStatus("Could not load material image.", "err");
    };
    img.src = dataUrl;
  }

  function loadMaterialImageFromFile(file, mat, mesh) {
    if (!file || !mat) return;
    var reader = new FileReader();
    reader.onload = function () {
      applyMaterialImageFromDataUrl(mat, String(reader.result || ""), mesh);
    };
    reader.onerror = function () {
      setStatus("Failed to read image file.", "err");
    };
    reader.readAsDataURL(file);
  }

  function updateMaterialImagePreview(dataUrl) {
    var prev = $("mod-prop-image-preview");
    if (!prev) return;
    if (dataUrl) {
      prev.src = dataUrl;
      prev.hidden = false;
    } else {
      prev.removeAttribute("src");
      prev.hidden = true;
    }
  }

  function syncMaterialFillUi(mat) {
    var mode = getMaterialFillMode(mat);
    var colorRadio = $("mod-mat-mode-color");
    var imageRadio = $("mod-mat-mode-image");
    var colorRow = $("mod-prop-color-row");
    var imageRow = $("mod-prop-image-row");
    if (colorRadio) colorRadio.checked = mode === "color";
    if (imageRadio) imageRadio.checked = mode === "image";
    if (colorRow) colorRow.hidden = mode === "image";
    if (imageRow) imageRow.hidden = mode !== "image";
    var dataUrl =
      mat && mat.userData && mat.userData.imageDataUrl
        ? mat.userData.imageDataUrl
        : mat && mat.map && mat.map.image && mat.map.image.src
          ? mat.map.image.src
          : "";
    updateMaterialImagePreview(mode === "image" ? dataUrl : "");
  }

  function makeMesh(geometry, type) {
    var mesh = new THREE.Mesh(geometry, defaultMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = nextName(type);
    mesh.userData.studioType = type;
    mesh.userData.studioId = state.objectId;
    return mesh;
  }

  /**
   * Scene primitive: display shelf with empty slots.
   * Printed 3D pieces (globes, flags, etc.) auto-fill the next free slot.
   */
  function addShelfUnit() {
    ensureInit();
    var group = new THREE.Group();
    group.name = nextName("Shelf");
    group.userData.studioType = "shelf";
    group.userData.studioId = state.objectId;
    group.userData.isShelf = true;
    group.userData.shelfSlots = [];

    var wood = new THREE.MeshStandardMaterial({
      color: 0x6b5344,
      roughness: 0.75,
      metalness: 0.05,
    });
    var dark = new THREE.MeshStandardMaterial({
      color: 0x3a322c,
      roughness: 0.7,
      metalness: 0.08,
    });
    // Back panel
    var back = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 0.06), dark);
    back.position.set(0, 0.85, -0.28);
    back.castShadow = true;
    back.receiveShadow = true;
    back.userData.skipEdit = true;
    group.add(back);
    // Side panels
    var left = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.55), wood);
    left.position.set(-0.67, 0.85, 0);
    left.castShadow = true;
    left.userData.skipEdit = true;
    group.add(left);
    var right = left.clone();
    right.position.x = 0.67;
    group.add(right);

    // 3 boards × 3 slots each (left / mid / right)
    var boardYs = [0.28, 0.78, 1.28];
    var slotXs = [-0.4, 0, 0.4];
    for (var bi = 0; bi < boardYs.length; bi++) {
      var board = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.05, 0.5), wood);
      board.position.set(0, boardYs[bi], 0);
      board.castShadow = true;
      board.receiveShadow = true;
      board.userData.skipEdit = true;
      group.add(board);
      for (var si = 0; si < slotXs.length; si++) {
        var slot = new THREE.Object3D();
        // Rest point slightly above the board surface, centered in depth
        slot.position.set(slotXs[si], boardYs[bi] + 0.04, 0.05);
        slot.userData.isShelfSlot = true;
        slot.userData.occupied = false;
        slot.userData.heldObject = null;
        group.add(slot);
        group.userData.shelfSlots.push(slot);
      }
    }

    // Top crown
    var top = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.08, 0.58), wood);
    top.position.set(0, 1.68, 0);
    top.userData.skipEdit = true;
    group.add(top);

    group.position.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
    state.scene.add(group);
    state.objects.push(group);
    selectObject(group);
    setTool("move");
    setStatus(
      "Shelf added — " +
        group.userData.shelfSlots.length +
        " empty slots. Printed globes will fill them automatically.",
      "ok"
    );
    return group;
  }

  function getShelves() {
    return state.objects.filter(function (o) {
      return o.userData && o.userData.isShelf && o.userData.shelfSlots;
    });
  }

  /**
   * Place a finished 3D print on the next free shelf slot.
   * Returns true if shelved, false if no room (caller keeps printer-bed placement).
   */
  function placePrintOnShelfSlot(mesh) {
    if (!mesh) return false;
    var shelves = getShelves();
    if (!shelves.length) return false;

    var slot = null;
    var shelf = null;
    for (var s = 0; s < shelves.length && !slot; s++) {
      var sh = shelves[s];
      var slots = sh.userData.shelfSlots || [];
      for (var i = 0; i < slots.length; i++) {
        if (!slots[i].userData.occupied) {
          slot = slots[i];
          shelf = sh;
          break;
        }
      }
    }
    if (!slot || !shelf) return false;

    // Fit object to slot size (~0.32 world units wide)
    mesh.scale.set(1, 1, 1);
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.updateMatrixWorld(true);
    var bbox = new THREE.Box3().setFromObject(mesh);
    var size = bbox.getSize(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z, 0.01);
    var fit = 0.32 / maxDim;
    mesh.scale.setScalar(fit);
    mesh.updateMatrixWorld(true);
    bbox.setFromObject(mesh);
    var center = bbox.getCenter(new THREE.Vector3());
    // Slot world position
    shelf.updateWorldMatrix(true, true);
    slot.updateWorldMatrix(true, false);
    var worldPos = new THREE.Vector3();
    slot.getWorldPosition(worldPos);
    // Sit on slot: center XZ on slot, bottom on slot Y
    mesh.position.set(
      worldPos.x - center.x,
      worldPos.y - bbox.min.y + 0.002,
      worldPos.z - center.z
    );
    // Face outward (same yaw as shelf)
    mesh.quaternion.copy(shelf.quaternion);

    slot.userData.occupied = true;
    slot.userData.heldObject = mesh;
    mesh.userData.shelfSlot = slot;
    mesh.userData.onShelf = true;
    return true;
  }

  function addPrimitive(type) {
    ensureInit();
    if (type === "spellforge") {
      return addSpellforgePlane();
    }
    if (type === "printer") {
      return addPrinter();
    }
    if (type === "mesh-printer" || type === "meshprinter") {
      return addMeshPrinter();
    }
    if (type === "shelf") {
      return addShelfUnit();
    }
    var geo;
    switch (type) {
      case "sphere":
        geo = new THREE.SphereGeometry(0.6, 32, 24);
        break;
      case "cylinder":
        geo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 32);
        break;
      case "cone":
        geo = new THREE.ConeGeometry(0.55, 1.15, 32);
        break;
      case "plane":
        geo = new THREE.PlaneGeometry(2, 2);
        break;
      case "torus":
        geo = new THREE.TorusGeometry(0.55, 0.2, 16, 48);
        break;
      case "ico":
        geo = new THREE.IcosahedronGeometry(0.7, 0);
        break;
      case "cube":
      default:
        geo = new THREE.BoxGeometry(1, 1, 1);
        type = "cube";
        break;
    }
    var mesh = makeMesh(geo, type);
    if (type === "plane") {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.001;
    } else {
      mesh.position.y = type === "sphere" || type === "ico" ? 0.6 : 0.55;
    }
    mesh.position.x = (Math.random() - 0.5) * 0.4;
    mesh.position.z = (Math.random() - 0.5) * 0.4;
    state.scene.add(mesh);
    state.objects.push(mesh);
    selectObject(mesh);
    setStatus("Added " + mesh.name + ".", "ok");
    return mesh;
  }

  function selectObject(obj) {
    if (state.editMode && obj !== state.selected) {
      // Switching objects exits edit mode
      state.editMode = false;
      syncEditModeUi();
    }
    clearMeshSelection();
    state.selected = obj || null;
    if (obj && obj.userData && obj.userData.isSpellforgePlane) {
      state.activeSfGroup = obj;
    }
    if (state.transform) {
      if (obj && !state.editMode) {
        state.transform.attach(obj);
        state.transform.visible = true;
        state.transform.enabled = true;
        if (state.tool === "select") {
          state.transform.setMode("translate");
        }
        applyAxisLockToGimbal();
      } else {
        state.transform.detach();
        state.transform.visible = false;
        state.transform.enabled = false;
      }
    }
    renderOutliner();
    syncPropsFromSelection();
    readNumericFromSelection();
    refreshSpellforgePointerMode();
    if (state.workspace === "uv") refreshUvEditor(true);
    updateHud();
  }

  function freeShelfSlotIfAny(obj) {
    if (!obj || !obj.userData) return;
    var slot = obj.userData.shelfSlot;
    if (slot && slot.userData) {
      slot.userData.occupied = false;
      slot.userData.heldObject = null;
    }
    obj.userData.shelfSlot = null;
    obj.userData.onShelf = false;
  }

  function deleteSelected() {
    if (!state.selected) {
      setStatus("Nothing selected.", "err");
      return;
    }
    var obj = state.selected;
    if (obj.userData && obj.userData.isSpellforgePlane) {
      setStatus("Delete Spellforge plane from the outliner with care — use Clear for full wipe.", "err");
      // Still allow delete but without undo of iframe
    }
    freeShelfSlotIfAny(obj);
    if (obj.userData && obj.userData.isShelf && obj.userData.shelfSlots) {
      obj.userData.shelfSlots.forEach(function (slot) {
        if (slot.userData.heldObject) {
          freeShelfSlotIfAny(slot.userData.heldObject);
        }
      });
    }
    // Keep object alive for undo (do not dispose yet)
    pushUndo({ type: "delete", obj: obj, label: "Delete" });
    if (state.transform) state.transform.detach();
    state.scene.remove(obj);
    state.objects = state.objects.filter(function (o) {
      return o !== obj;
    });
    selectObject(null);
    setStatus("Deleted (Ctrl+Z to undo).", "ok");
  }

  function duplicateSelected() {
    if (!state.selected) {
      setStatus("Nothing selected.", "err");
      return;
    }
    if (state.selected.userData && state.selected.userData.isSpellforgePlane) {
      var p = addSpellforgePlane();
      if (p && state.selected) {
        p.position.copy(state.selected.position);
        p.position.x += 0.5;
        p.quaternion.copy(state.selected.quaternion);
        p.scale.copy(state.selected.scale);
        syncCssObjects();
      }
      return;
    }
    copySelected();
    pasteClipboard();
    setStatus("Duplicated (also on clipboard).", "ok");
  }

  function isMeshEditTool(tool) {
    // Legacy: also treat editMode as "in mesh edit"
    return state.editMode || tool === "face" || tool === "edge" || tool === "vertex";
  }

  function syncEditModeUi() {
    var btn = $("mod-edit-mode");
    if (btn) btn.classList.toggle("is-active", !!state.editMode);
    document.querySelectorAll("#panel-modeler .mod-select-mode").forEach(function (b) {
      b.classList.toggle("is-active", state.editMode && b.getAttribute("data-select-mode") === state.selectMode);
      b.disabled = !state.editMode;
    });
  }

  function setSelectMode(mode) {
    if (mode !== "face" && mode !== "edge" && mode !== "vertex") return;
    state.selectMode = mode;
    if (!state.editMode) enterEditMode();
    clearMeshSelection();
    syncEditModeUi();
    setStatus(
      "Edit mode · select " + mode + "s with LMB · E extrude (drag) · I inset · B bevel",
      "ok"
    );
    updateHud();
  }

  function enterEditMode() {
    if (!state.selected) {
      setStatus("Select a mesh object first, then Edit Mode (Tab).", "err");
      return;
    }
    var mesh = getEditableMesh(state.selected);
    if (!mesh) {
      setStatus("This object has no editable mesh (try a cube).", "err");
      return;
    }
    if (state.selected.userData && state.selected.userData.isSpellforgePlane) {
      setStatus("Can't edit Spellforge plane mesh this way.", "err");
      return;
    }
    state.editMode = true;
    prepareEditableGeometry(mesh);
    if (state.transform) {
      state.transform.detach();
      state.transform.visible = false;
      state.transform.enabled = false;
    }
    syncEditModeUi();
    setStatus("Edit Mode — 1/2/3 = face/edge/vertex select · LMB select · E drag extrude · Tab exit", "ok");
    updateHud();
  }

  function exitEditMode() {
    state.editMode = false;
    clearMeshSelection();
    if (
      state.modal &&
      (state.modal.mode === "extrude-mesh" ||
        state.modal.mode === "inset-mesh" ||
        state.modal.mode === "bevel-mesh" ||
        state.modal.mode === "g-mesh" ||
        state.modal.mode === "loop-cut")
    ) {
      cancelModal();
    }
    if (state.transform && state.selected) {
      state.transform.enabled = true;
      state.transform.visible = true;
      state.transform.attach(state.selected);
      applyAxisLockToGimbal();
    }
    syncEditModeUi();
    setStatus("Object Mode", "ok");
    updateHud();
  }

  function toggleEditMode() {
    if (state.editMode) exitEditMode();
    else enterEditMode();
  }

  function disposeHiliteObject(obj) {
    if (!obj) return;
    if (obj.parent) obj.parent.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(function (m) {
          if (m && m.dispose) m.dispose();
        });
      } else if (obj.material.dispose) {
        obj.material.dispose();
      }
    }
    if (obj.children && obj.children.length) {
      while (obj.children.length) {
        disposeHiliteObject(obj.children[0]);
      }
    }
  }

  function clearMeshHilite() {
    if (state.meshHilites && state.meshHilites.length) {
      state.meshHilites.forEach(disposeHiliteObject);
    }
    if (state.meshHilite) disposeHiliteObject(state.meshHilite);
    state.meshHilite = null;
    state.meshHilites = [];
  }

  function getAllMeshSels() {
    if (state.meshSels && state.meshSels.length) return state.meshSels;
    if (state.meshSel) return [state.meshSel];
    return [];
  }

  function meshSelKey(sel) {
    if (!sel) return "";
    if (sel.type === "face") {
      if (sel.quadTris && sel.quadTris.length) {
        return "f:" + sel.quadTris.slice().sort().join(",");
      }
      return "f:" + sel.faceIndex;
    }
    if (sel.type === "edge") {
      var lo = Math.min(sel.e0, sel.e1);
      var hi = Math.max(sel.e0, sel.e1);
      return "e:" + lo + "-" + hi;
    }
    if (sel.type === "vertex") return "v:" + sel.vi;
    return "x";
  }

  /** Replace or toggle (additive) component selection. */
  function commitMeshSelection(sel, additive) {
    if (!sel) {
      clearMeshSelection();
      return;
    }
    if (!additive) {
      state.meshSels = [sel];
      state.meshSel = sel;
      highlightMeshSelection();
      return;
    }
    var key = meshSelKey(sel);
    var list = state.meshSels && state.meshSels.length ? state.meshSels.slice() : [];
    var found = -1;
    for (var i = 0; i < list.length; i++) {
      if (meshSelKey(list[i]) === key) {
        found = i;
        break;
      }
    }
    if (found >= 0) list.splice(found, 1);
    else list.push(sel);
    state.meshSels = list;
    state.meshSel = list.length ? list[list.length - 1] : null;
    highlightMeshSelection();
  }

  function getSelectedVertIndices() {
    var set = {};
    var out = [];
    getAllMeshSels().forEach(function (sel) {
      var verts = [];
      if (sel.type === "face") verts = getSelectedFaceVerts(sel);
      else if (sel.type === "edge") verts = [sel.e0, sel.e1];
      else if (sel.type === "vertex") verts = [sel.vi];
      verts.forEach(function (vi) {
        if (set[vi] == null) {
          set[vi] = 1;
          out.push(vi);
        }
      });
    });
    return out;
  }

  /** Recompute normals and drop stale attribute so lighting stays stable. */
  function repairMeshNormals(mesh) {
    if (!mesh || !mesh.geometry) return;
    var geo = mesh.geometry;
    if (geo.attributes.normal) geo.deleteAttribute("normal");
    geo.computeVertexNormals();
    if (geo.attributes.normal) geo.attributes.normal.needsUpdate = true;
    if (geo.attributes.position) geo.attributes.position.needsUpdate = true;
  }

  /**
   * After extrude/inset/bevel/loop-cut: keep materials solid and normals valid.
   * Prevents black faces from flipped verts, stale groups, or vertexColors.
   */
  function finalizeMeshEdit(mesh) {
    if (!mesh) return;
    normalizeMeshMaterials(mesh);
    var list = ensureMaterialList(mesh);
    list.forEach(function (m) {
      if (!m) return;
      m.vertexColors = false;
      if (!m.color) m.color = new THREE.Color(0x8a90a8);
      if (m.flatShading) m.flatShading = false;
      // Solid default; only transparent when user lowered opacity
      if (m.opacity == null || !isFinite(m.opacity)) m.opacity = 1;
      if (m.opacity >= 0.999) {
        m.opacity = 1;
        m.transparent = false;
        if ("transmission" in m) {
          m.transmission = 0;
          m.thickness = 0;
        }
        setupTranslucentShadowMaterial(m, 1);
      } else {
        applyMaterialOpacity(m, m.opacity);
      }
      // Front + back so extruded walls / flipped faces never go see-through
      applyMaterialTwoSided(m);
      m.needsUpdate = true;
    });
    if (list.length <= 1) {
      mesh.material = list[0];
      if (mesh.geometry && mesh.geometry.groups) mesh.geometry.clearGroups();
    }
    repairMeshNormals(mesh);
    syncMeshShadowCasting(mesh);
  }

  /** Face normal from current positions (indices). */
  function triNormalFromIdx(geo, a, b, c) {
    var pos = geo.attributes.position;
    var va = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a));
    var vb = new THREE.Vector3(pos.getX(b), pos.getY(b), pos.getZ(b));
    var vc = new THREE.Vector3(pos.getX(c), pos.getY(c), pos.getZ(c));
    return new THREE.Vector3()
      .subVectors(vb, va)
      .cross(new THREE.Vector3().subVectors(vc, va))
      .normalize();
  }

  /**
   * Push a side quad (two tris) with winding matching expected outward normal.
   * Outer edge o0→o1, upper/inner edge i0→i1 (same ring direction).
   */
  function pushOrientedSide(indices, geo, o0, o1, i1, i0, expectedN) {
    var n = triNormalFromIdx(geo, o0, o1, i1);
    if (expectedN && n.dot(expectedN) < 0) {
      indices.push(o0, i1, o1, o0, i0, i1);
    } else {
      indices.push(o0, o1, i1, o0, i1, i0);
    }
  }

  /** Ensure a triangle's winding matches expectedN; returns [a,b,c] possibly swapped. */
  function orientTri(geo, a, b, c, expectedN) {
    var n = triNormalFromIdx(geo, a, b, c);
    if (expectedN && n.dot(expectedN) < 0) return [a, c, b];
    return [a, b, c];
  }

  /** World-space direction → mesh local direction (no translation). */
  function worldDirToLocal(mesh, worldDir) {
    var inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    return worldDir.clone().transformDirection(inv);
  }

  function getEditableMesh(obj) {
    if (!obj) return null;
    if (obj.isMesh && obj.geometry) return obj;
    var found = null;
    obj.traverse(function (ch) {
      if (found) return;
      if (ch.isMesh && ch.geometry && !ch.userData.skipEdit) found = ch;
    });
    return found;
  }

  /** Ensure BufferGeometry is indexed and writable for edit ops. */
  function prepareEditableGeometry(mesh) {
    if (!mesh || !mesh.geometry) return null;
    var geo = mesh.geometry;
    if (!geo.attributes || !geo.attributes.position) return null;
    if (!geo.index) {
      var n = geo.attributes.position.count;
      var idx = [];
      for (var i = 0; i < n; i++) idx.push(i);
      geo.setIndex(idx);
    }
    if (!mesh.userData._editReady) {
      mesh.geometry = geo.clone();
      mesh.userData._editReady = true;
      geo = mesh.geometry;
    }
    normalizeMeshMaterials(mesh);
    return mesh.geometry;
  }

  /** True only when the mesh intentionally has 2+ materials. */
  function isMultiMaterialMesh(mesh) {
    return Array.isArray(mesh.material) && mesh.material.length > 1;
  }

  /**
   * Materials as a list (for multi-mat UI). Does NOT force array on single-mat
   * meshes — that + incomplete groups was leaving faces uncolored.
   */
  function ensureMaterialList(mesh) {
    if (!mesh.material) {
      mesh.material = defaultMaterial();
    }
    var list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    list.forEach(function (m) {
      if (!m) return;
      // Preserve intentional translucency; only normalize fully-opaque mats
      if (m.opacity == null || !isFinite(m.opacity)) m.opacity = 1;
      if (m.opacity >= 0.999) {
        m.opacity = 1;
        m.transparent = false;
        if ("transmission" in m) {
          m.transmission = 0;
          m.thickness = 0;
        }
        setupTranslucentShadowMaterial(m, 1);
      } else {
        applyMaterialOpacity(m, m.opacity);
      }
      if (m.vertexColors) m.vertexColors = false;
      applyMaterialTwoSided(m);
      if (m.color) {
        /* keep material.color — paints every face using this mat */
      }
      m.needsUpdate = true;
    });
    return list;
  }

  /**
   * Single material → no groups (every face gets full color).
   * Multi material → groups must cover EVERY triangle with no gaps.
   */
  function normalizeMeshMaterials(mesh) {
    if (!mesh || !mesh.geometry) return;
    var geo = mesh.geometry;
    var list = ensureMaterialList(mesh);
    if (list.length <= 1) {
      // Keep as single material object so Three paints the whole mesh
      mesh.material = list[0];
      if (geo.groups && geo.groups.length) geo.clearGroups();
      return;
    }
    mesh.material = list;
    rebuildGroupsFullCoverage(geo, list.length);
  }

  /** Rebuild groups so every index triangle has a materialIndex (no gaps). */
  function rebuildGroupsFullCoverage(geo, matCount) {
    if (!geo || !geo.index) return;
    var triCount = (geo.index.count / 3) | 0;
    if (triCount <= 0) {
      geo.clearGroups();
      return;
    }
    // Read existing per-tri materials where possible
    var triMat = new Array(triCount);
    var t;
    for (t = 0; t < triCount; t++) {
      triMat[t] = getFaceMaterialIndex(geo, t);
      if (triMat[t] >= matCount) triMat[t] = 0;
    }
    geo.clearGroups();
    var runStart = 0;
    var runMat = triMat[0];
    for (t = 1; t <= triCount; t++) {
      if (t === triCount || triMat[t] !== runMat) {
        geo.addGroup(runStart * 3, (t - runStart) * 3, runMat);
        if (t < triCount) {
          runStart = t;
          runMat = triMat[t];
        }
      }
    }
  }

  function ensureGeometryGroups(mesh) {
    normalizeMeshMaterials(mesh);
  }

  /** Material index used by a triangle (faceIndex). */
  function getFaceMaterialIndex(geo, faceIndex) {
    if (!geo.groups || !geo.groups.length) return 0;
    var start = faceIndex * 3;
    for (var g = 0; g < geo.groups.length; g++) {
      var gr = geo.groups[g];
      if (start >= gr.start && start < gr.start + gr.count) {
        return gr.materialIndex || 0;
      }
    }
    // No group hit → default mat 0 (must still be colored)
    return 0;
  }

  /**
   * After topology change: keep every face painted.
   * Single material → clear groups (whole mesh one solid color).
   * Multi material → full-coverage groups; new tris use matIndexForNew.
   */
  function syncGroupsAfterIndexChange(meshOrGeo, oldIndexLen, matIndexForNew) {
    var mesh = null;
    var geo = meshOrGeo;
    if (meshOrGeo && meshOrGeo.isMesh) {
      mesh = meshOrGeo;
      geo = mesh.geometry;
    }
    if (!geo || !geo.index) return;
    var newLen = geo.index.count;
    var multi = mesh ? isMultiMaterialMesh(mesh) : false;

    if (!multi) {
      geo.clearGroups();
      if (mesh) {
        var list = ensureMaterialList(mesh);
        mesh.material = list[0];
        if (mesh.material) {
          if (mesh.material.opacity == null || mesh.material.opacity >= 0.999) {
            mesh.material.opacity = 1;
            mesh.material.transparent = false;
          }
          if (mesh.material.vertexColors) mesh.material.vertexColors = false;
          mesh.material.needsUpdate = true;
        }
      }
      return;
    }

    var oldTriCount = (oldIndexLen / 3) | 0;
    var newTriCount = (newLen / 3) | 0;
    var oldGroups = geo.groups ? geo.groups.slice() : [];
    function matAt(faceIdx) {
      var s = faceIdx * 3;
      for (var g = 0; g < oldGroups.length; g++) {
        var gr = oldGroups[g];
        if (s >= gr.start && s < gr.start + gr.count) return gr.materialIndex || 0;
      }
      return 0;
    }
    var triMat = [];
    var t;
    for (t = 0; t < oldTriCount; t++) triMat[t] = matAt(t);
    for (t = oldTriCount; t < newTriCount; t++) triMat[t] = matIndexForNew || 0;
    geo.clearGroups();
    if (newTriCount <= 0) return;
    var runStart = 0;
    var runMat = triMat[0];
    for (t = 1; t <= newTriCount; t++) {
      if (t === newTriCount || triMat[t] !== runMat) {
        geo.addGroup(runStart * 3, (t - runStart) * 3, runMat);
        if (t < newTriCount) {
          runStart = t;
          runMat = triMat[t];
        }
      }
    }
  }

  /**
   * Append vertices copied from source vertex indices (positions + color + uv).
   * Returns new vertex indices. Keeps material appearance on new geo.
   */
  function appendCopiedVertices(geo, sourceVertIndices) {
    var pos = geo.attributes.position;
    var oldCount = pos.count;
    var posArr = Array.from(pos.array);
    var hasColor = !!geo.attributes.color;
    var hasUv = !!geo.attributes.uv;
    var colArr = hasColor ? Array.from(geo.attributes.color.array) : null;
    var uvArr = hasUv ? Array.from(geo.attributes.uv.array) : null;
    var colItem = hasColor ? geo.attributes.color.itemSize : 3;
    var newVerts = [];
    sourceVertIndices.forEach(function (vi) {
      posArr.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
      if (hasColor) {
        if (colItem >= 3) {
          colArr.push(
            geo.attributes.color.getX(vi),
            geo.attributes.color.getY(vi),
            geo.attributes.color.getZ(vi)
          );
          if (colItem >= 4) colArr.push(geo.attributes.color.getW(vi));
        }
      }
      if (hasUv) {
        uvArr.push(geo.attributes.uv.getX(vi), geo.attributes.uv.getY(vi));
      }
      newVerts.push(oldCount + newVerts.length);
    });
    geo.setAttribute("position", new THREE.Float32BufferAttribute(posArr, 3));
    if (hasColor) {
      geo.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(colArr, colItem)
      );
    }
    if (hasUv) {
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvArr, 2));
    }
    // Drop stale normals — recompute after topology
    if (geo.attributes.normal) {
      geo.deleteAttribute("normal");
    }
    return newVerts;
  }

  function ensureVertexColorsFromMaterial(mesh) {
    var geo = mesh.geometry;
    if (!geo || !geo.attributes.position) return;
    if (geo.attributes.color) return;
    var mats = ensureMaterialList(mesh);
    var mat = mats[0];
    var c = mat && mat.color ? mat.color : new THREE.Color(0x8a90a8);
    var n = geo.attributes.position.count;
    var arr = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    // Enable vertex colors on materials so they tint with material map if any
    mats.forEach(function (m) {
      if (m && "vertexColors" in m) {
        m.vertexColors = false; // prefer material.color as source of truth for solid mats
      }
    });
  }

  function highlightMeshSelection() {
    clearMeshHilite();
    var sels = getAllMeshSels();
    if (!sels.length) return;
    var mat = new THREE.MeshBasicMaterial({
      color: 0xffcc44,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
    });
    var lineMat = new THREE.LineBasicMaterial({
      color: 0xffcc44,
      linewidth: 2,
      depthToScreenSpace: true,
    });
    var hilites = [];
    sels.forEach(function (sel) {
      if (!sel || !sel.mesh) return;
      var geo = sel.mesh.geometry;
      var pos = geo.attributes.position;
      if (sel.type === 'face' && sel.a != null) {
        var verts = getSelectedFaceVerts(sel);
        var g = new THREE.BufferGeometry();
        var arr;
        if (verts.length === 4) {
          arr = new Float32Array(18);
          var order = [0, 1, 2, 0, 2, 3];
          for (var qi = 0; qi < 6; qi++) {
            var v = verts[order[qi]];
            arr[qi * 3] = pos.getX(v);
            arr[qi * 3 + 1] = pos.getY(v);
            arr[qi * 3 + 2] = pos.getZ(v);
          }
        } else {
          arr = new Float32Array(9);
          arr[0] = pos.getX(sel.a);
          arr[1] = pos.getY(sel.a);
          arr[2] = pos.getZ(sel.a);
          arr[3] = pos.getX(sel.b);
          arr[4] = pos.getY(sel.b);
          arr[5] = pos.getZ(sel.b);
          arr[6] = pos.getX(sel.c);
          arr[7] = pos.getY(sel.c);
          arr[8] = pos.getZ(sel.c);
        }
        g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        var m = new THREE.Mesh(g, mat.clone());
        m.renderOrder = 10;
        sel.mesh.add(m);
        hilites.push(m);
        // Cyan loop-cut preview on quads (orange = source edge)
        if (!(state.modal && state.modal.mode === "loop-cut")) {
          var planF = loopCutPlanFromSelection(sel.mesh, sel);
          if (planF) {
            var ptsF = loopCutLinePoints(sel.mesh, planF, 0.5);
            var nOffF = planF.n.clone().multiplyScalar(0.008);
            ptsF.p0.add(nOffF);
            ptsF.p1.add(nOffF);
            addCutPreviewLine(sel.mesh, ptsF.p0, ptsF.p1, hilites, 0x44eeff);
            var seg = new THREE.BufferGeometry();
            var sa = new Float32Array(6);
            sa[0] = pos.getX(planF.a0);
            sa[1] = pos.getY(planF.a0);
            sa[2] = pos.getZ(planF.a0);
            sa[3] = pos.getX(planF.a1);
            sa[4] = pos.getY(planF.a1);
            sa[5] = pos.getZ(planF.a1);
            seg.setAttribute("position", new THREE.BufferAttribute(sa, 3));
            var srcLine = new THREE.Line(
              seg,
              new THREE.LineBasicMaterial({
                color: 0xff8844,
                depthTest: false,
                transparent: true,
                opacity: 0.9,
              })
            );
            srcLine.renderOrder = 11;
            sel.mesh.add(srcLine);
            hilites.push(srcLine);
          }
        }
      } else if (sel.type === "vertex" && sel.vi != null) {
        var sg = new THREE.SphereGeometry(0.04, 10, 10);
        var sm = new THREE.Mesh(sg, mat.clone());
        sm.position.set(pos.getX(sel.vi), pos.getY(sel.vi), pos.getZ(sel.vi));
        sm.renderOrder = 10;
        sel.mesh.add(sm);
        hilites.push(sm);
      } else if (sel.type === "edge" && sel.e0 != null) {
        var eg = new THREE.BufferGeometry();
        var ea = new Float32Array(6);
        ea[0] = pos.getX(sel.e0);
        ea[1] = pos.getY(sel.e0);
        ea[2] = pos.getZ(sel.e0);
        ea[3] = pos.getX(sel.e1);
        ea[4] = pos.getY(sel.e1);
        ea[5] = pos.getZ(sel.e1);
        eg.setAttribute("position", new THREE.BufferAttribute(ea, 3));
        var line = new THREE.Line(eg, lineMat.clone());
        line.renderOrder = 10;
        sel.mesh.add(line);
        hilites.push(line);
        // Cyan preview of where loop cut would go (parallel across opposite edge)
        if (!(state.modal && state.modal.mode === "loop-cut")) {
          var planPrev = buildLoopCutPlan(sel.mesh, sel.faceIndex, sel.e0, sel.e1);
          if (planPrev) {
            var pts = loopCutLinePoints(sel.mesh, planPrev, 0.5);
            var nOff = planPrev.n.clone().multiplyScalar(0.008);
            pts.p0.add(nOff);
            pts.p1.add(nOff);
            addCutPreviewLine(sel.mesh, pts.p0, pts.p1, hilites, 0x44eeff);
          }
        }
      }
    });
    state.meshHilites = hilites;
    state.meshHilite = hilites.length ? hilites[0] : null;
    if (state.workspace === "uv") refreshUvEditor(true);
  }

  function clearMeshSelection() {
    clearMeshHilite();
    state.meshSel = null;
    state.meshSels = [];
    if (state.workspace === "uv") refreshUvEditor(true);
  }

  /**
   * Pair triangle faces into quads when coplanar + share an edge (cubes stay quads).
   */
  function findQuadForTri(mesh, faceIndex) {
    var geo = mesh.geometry;
    var idx = geo.index;
    var pos = geo.attributes.position;
    if (!idx || faceIndex == null) return null;
    var a = idx.getX(faceIndex * 3);
    var b = idx.getX(faceIndex * 3 + 1);
    var c = idx.getX(faceIndex * 3 + 2);
    var n0 = faceNormalLocal(mesh, a, b, c);
    var faceCount = idx.count / 3;
    var edges0 = [
      [a, b],
      [b, c],
      [c, a],
    ];
    function sharesEdge(i0, i1, j0, j1) {
      return (
        (i0 === j0 && i1 === j1) ||
        (i0 === j1 && i1 === j0)
      );
    }
    for (var f = 0; f < faceCount; f++) {
      if (f === faceIndex) continue;
      var d = idx.getX(f * 3);
      var e = idx.getX(f * 3 + 1);
      var g = idx.getX(f * 3 + 2);
      var n1 = faceNormalLocal(mesh, d, e, g);
      if (n0.dot(n1) < 0.98) continue;
      var edges1 = [
        [d, e],
        [e, g],
        [g, d],
      ];
      var shared = null;
      for (var i = 0; i < 3; i++) {
        for (var j = 0; j < 3; j++) {
          if (sharesEdge(edges0[i][0], edges0[i][1], edges1[j][0], edges1[j][1])) {
            shared = edges0[i];
            break;
          }
        }
        if (shared) break;
      }
      if (!shared) continue;
      // Build ordered quad verts: start at non-shared of tri0, around
      var all = [a, b, c, d, e, g];
      var uniq = [];
      all.forEach(function (v) {
        if (uniq.indexOf(v) < 0) uniq.push(v);
      });
      if (uniq.length !== 4) continue;
      // Order around normal
      var center = new THREE.Vector3();
      uniq.forEach(function (vi) {
        center.x += pos.getX(vi);
        center.y += pos.getY(vi);
        center.z += pos.getZ(vi);
      });
      center.multiplyScalar(0.25);
      var tangent = new THREE.Vector3(1, 0, 0);
      if (Math.abs(n0.dot(tangent)) > 0.9) tangent.set(0, 1, 0);
      var bitan = new THREE.Vector3().crossVectors(n0, tangent).normalize();
      tangent.crossVectors(bitan, n0).normalize();
      uniq.sort(function (va, vb) {
        var ax = pos.getX(va) - center.x;
        var ay = pos.getY(va) - center.y;
        var az = pos.getZ(va) - center.z;
        var bx = pos.getX(vb) - center.x;
        var by = pos.getY(vb) - center.y;
        var bz = pos.getZ(vb) - center.z;
        var anga = Math.atan2(
          ax * bitan.x + ay * bitan.y + az * bitan.z,
          ax * tangent.x + ay * tangent.y + az * tangent.z
        );
        var angb = Math.atan2(
          bx * bitan.x + by * bitan.y + bz * bitan.z,
          bx * tangent.x + by * tangent.y + bz * tangent.z
        );
        return anga - angb;
      });
      // Keep winding aligned with original face normal (prevents black flipped faces)
      var checkN = faceNormalLocal(mesh, uniq[0], uniq[1], uniq[2]);
      if (checkN.dot(n0) < 0) uniq.reverse();
      return {
        verts: uniq,
        quadTris: [faceIndex, f],
        a: uniq[0],
        b: uniq[1],
        c: uniq[2],
        d: uniq[3],
      };
    }
    return null;
  }

  function pickMeshComponent(event) {
    if (!state.selected || !state.camera || !state.raycaster) return false;
    var mesh = getEditableMesh(state.selected);
    if (!mesh) {
      setStatus("Select a simple mesh (cube, etc.) for face/edge/vertex edit.", "err");
      return false;
    }
    if (mesh.parent && mesh.parent.userData && mesh.parent.userData.isSpellforgePlane) {
      return false;
    }
    prepareEditableGeometry(mesh);
    state.raycaster.params.Line = state.raycaster.params.Line || {};
    state.raycaster.params.Line.threshold = 0.08;
    state.raycaster.params.Points = state.raycaster.params.Points || {};
    state.raycaster.params.Points.threshold = 0.12;
    var rect = state.renderer.domElement.getBoundingClientRect();
    state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);
    var hits = state.raycaster.intersectObject(mesh, false);
    if (!hits.length) return false;
    var hit = hits[0];
    var geo = mesh.geometry;
    var idx = geo.index;
    var fi = hit.faceIndex;
    if (fi == null || !idx) return false;
    var a = idx.getX(fi * 3);
    var b = idx.getX(fi * 3 + 1);
    var c = idx.getX(fi * 3 + 2);
    var pos = geo.attributes.position;

    var additive = !!(event && event.shiftKey);
    var mode = state.selectMode || "face";
    var newSel = null;
    if (mode === "face") {
      var quad = findQuadForTri(mesh, fi);
      if (quad) {
        newSel = {
          type: "face",
          mesh: mesh,
          faceIndex: fi,
          a: quad.a,
          b: quad.b,
          c: quad.c,
          d: quad.d,
          verts: quad.verts,
          quadTris: quad.quadTris,
        };
      } else {
        newSel = { type: "face", mesh: mesh, faceIndex: fi, a: a, b: b, c: c, verts: [a, b, c] };
      }
    } else if (mode === "vertex") {
      var pts = [a, b, c];
      var best = a;
      var bestD = Infinity;
      var tmp = new THREE.Vector3();
      pts.forEach(function (vi) {
        tmp.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
        mesh.localToWorld(tmp);
        tmp.project(state.camera);
        var dx = tmp.x - state.pointer.x;
        var dy = tmp.y - state.pointer.y;
        var d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = vi;
        }
      });
      newSel = { type: "vertex", mesh: mesh, vi: best, faceIndex: fi };
    } else if (mode === "edge") {
      // Prefer quad perimeter edges — never the internal triangle diagonal
      var edges = [
        [a, b],
        [b, c],
        [c, a],
      ];
      var quadE = findQuadForTri(mesh, fi);
      if (quadE && quadE.verts && quadE.verts.length === 4) {
        edges = [];
        for (var qi = 0; qi < 4; qi++) {
          edges.push([quadE.verts[qi], quadE.verts[(qi + 1) % 4]]);
        }
      }
      var bestE = edges[0];
      var bestEd = Infinity;
      var mid = new THREE.Vector3();
      var p0 = new THREE.Vector3();
      var p1 = new THREE.Vector3();
      edges.forEach(function (ed) {
        p0.set(pos.getX(ed[0]), pos.getY(ed[0]), pos.getZ(ed[0]));
        p1.set(pos.getX(ed[1]), pos.getY(ed[1]), pos.getZ(ed[1]));
        mesh.localToWorld(p0);
        mesh.localToWorld(p1);
        mid.copy(p0).add(p1).multiplyScalar(0.5);
        mid.project(state.camera);
        var dx = mid.x - state.pointer.x;
        var dy = mid.y - state.pointer.y;
        var d = dx * dx + dy * dy;
        if (d < bestEd) {
          bestEd = d;
          bestE = ed;
        }
      });
      newSel = {
        type: "edge",
        mesh: mesh,
        e0: bestE[0],
        e1: bestE[1],
        faceIndex: fi,
      };
    }
    if (!newSel) return false;
    commitMeshSelection(newSel, additive);
    var nSel = getAllMeshSels().length;
    var multiHint = additive || nSel > 1 ? " · " + nSel + " selected (Shift multi)" : "";
    if (newSel.type === "face" && newSel.quadTris) {
      setStatus("Quad selected" + multiHint + " — G move · E extrude · I drag inset · B bevel.", "ok");
    } else if (newSel.type === "face") {
      setStatus("Face selected" + multiHint + " — G move · E extrude · I drag inset · B bevel.", "ok");
    } else if (newSel.type === "vertex") {
      setStatus("Vertex selected" + multiHint + " — G move · E extrude · B bevel.", "ok");
    } else {
      setStatus(
        "Edge selected" +
          multiHint +
          " — cyan = loop cut path · Ctrl+R to cut · G/E/B tools.",
        "ok"
      );
    }
    return true;
  }

  function getEditAmount() {
    var el = $("mod-edit-amount");
    var v = el ? parseFloat(el.value) : 0.15;
    if (!isFinite(v)) v = 0.15;
    return v;
  }

  function faceNormalLocal(mesh, a, b, c) {
    var pos = mesh.geometry.attributes.position;
    var va = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a));
    var vb = new THREE.Vector3(pos.getX(b), pos.getY(b), pos.getZ(b));
    var vc = new THREE.Vector3(pos.getX(c), pos.getY(c), pos.getZ(c));
    var n = new THREE.Vector3()
      .subVectors(vb, va)
      .cross(new THREE.Vector3().subVectors(vc, va))
      .normalize();
    return n;
  }

  function getSelectedFaceVerts(sel) {
    if (sel.verts && sel.verts.length) return sel.verts.slice();
    if (sel.d != null) return [sel.a, sel.b, sel.c, sel.d];
    return [sel.a, sel.b, sel.c];
  }

  /**
   * Build extrude topology at zero depth, then enter drag modal for depth.
   * amount applied only if options.fixed is true (legacy one-shot).
   */
  function extrudeSelectedFace(options) {
    options = options || {};
    var sel = state.meshSel;
    if (!sel || sel.type !== "face" || !sel.mesh) {
      setStatus("Select a face in Edit Mode, then E.", "err");
      return;
    }
    var mesh = sel.mesh;
    var geo = prepareEditableGeometry(mesh);
    if (!geo || !geo.index) return;
    if (!options.skipUndo) pushMeshEditUndo(mesh, "Extrude");
    ensureMaterialList(mesh);
    var pos = geo.attributes.position;
    var a = sel.a;
    var b = sel.b;
    var c = sel.c;
    var n = faceNormalLocal(mesh, a, b, c);
    var threeAx = userAxisToThree(state.axisLock);
    if (threeAx === "x") n.set(Math.sign(n.x) || 1, 0, 0);
    if (threeAx === "y") n.set(0, Math.sign(n.y) || 1, 0);
    if (threeAx === "z") n.set(0, 0, Math.sign(n.z) || 1);
    n.normalize();

    var verts = getSelectedFaceVerts(sel);
    var basePos = verts.map(function (vi) {
      return new THREE.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
    });
    var faceMat = getFaceMaterialIndex(geo, sel.faceIndex);
    var oldIndexLen = geo.index.count;
    // Zero-depth extrude: copy verts (position + color + uv)
    var newVerts = appendCopiedVertices(geo, verts);

    var indices = Array.from(geo.index.array);
    if (verts.length === 4 && sel.quadTris) {
      var t0 = sel.quadTris[0] * 3;
      var t1 = sel.quadTris[1] * 3;
      var a2 = newVerts[0];
      var b2 = newVerts[1];
      var c2 = newVerts[2];
      var d2 = newVerts[3];
      var top0 = orientTri(geo, a2, b2, c2, n);
      var top1 = orientTri(geo, a2, c2, d2, n);
      indices[t0] = top0[0];
      indices[t0 + 1] = top0[1];
      indices[t0 + 2] = top0[2];
      indices[t1] = top1[0];
      indices[t1 + 1] = top1[1];
      indices[t1 + 2] = top1[2];
      for (var si = 0; si < 4; si++) {
        var v0 = verts[si];
        var v1 = verts[(si + 1) % 4];
        var n0 = newVerts[si];
        var n1 = newVerts[(si + 1) % 4];
        // Side faces face outward (perpendicular to extrude; use edge×normal)
        var edge = new THREE.Vector3(
          geo.attributes.position.getX(v1) - geo.attributes.position.getX(v0),
          geo.attributes.position.getY(v1) - geo.attributes.position.getY(v0),
          geo.attributes.position.getZ(v1) - geo.attributes.position.getZ(v0)
        );
        // CCW ring: outward = faceNormal × edge
        var sideOut = new THREE.Vector3().crossVectors(n, edge).normalize();
        if (sideOut.lengthSq() < 1e-10) sideOut.copy(n);
        pushOrientedSide(indices, geo, v0, v1, n1, n0, sideOut);
      }
      sel.a = a2;
      sel.b = b2;
      sel.c = c2;
      sel.d = d2;
      sel.verts = [a2, b2, c2, d2];
    } else {
      var a2t = newVerts[0];
      var b2t = newVerts[1];
      var c2t = newVerts[2];
      var base = sel.faceIndex * 3;
      var topT = orientTri(geo, a2t, b2t, c2t, n);
      indices[base] = topT[0];
      indices[base + 1] = topT[1];
      indices[base + 2] = topT[2];
      var ring = [
        [a, b, b2t, a2t],
        [b, c, c2t, b2t],
        [c, a, a2t, c2t],
      ];
      ring.forEach(function (q) {
        var e = new THREE.Vector3(
          geo.attributes.position.getX(q[1]) - geo.attributes.position.getX(q[0]),
          geo.attributes.position.getY(q[1]) - geo.attributes.position.getY(q[0]),
          geo.attributes.position.getZ(q[1]) - geo.attributes.position.getZ(q[0])
        );
        var so = new THREE.Vector3().crossVectors(n, e).normalize();
        if (so.lengthSq() < 1e-10) so.copy(n);
        pushOrientedSide(indices, geo, q[0], q[1], q[2], q[3], so);
      });
      sel.a = a2t;
      sel.b = b2t;
      sel.c = c2t;
      sel.verts = [a2t, b2t, c2t];
    }
    geo.setIndex(indices);
    syncGroupsAfterIndexChange(mesh, oldIndexLen, faceMat);
    geo.attributes.position.needsUpdate = true;
    finalizeMeshEdit(mesh);

    if (options.fixed) {
      var amount = getEditAmount();
      var pos2 = geo.attributes.position;
      newVerts.forEach(function (vi, i) {
        pos2.setXYZ(
          vi,
          basePos[i].x + n.x * amount,
          basePos[i].y + n.y * amount,
          basePos[i].z + n.z * amount
        );
      });
      pos2.needsUpdate = true;
      finalizeMeshEdit(mesh);
      highlightMeshSelection();
      setStatus("Extruded face by " + amount.toFixed(3) + ".", "ok");
      return;
    }

    // Modal drag for depth
    var preSnapEx = null;
    if (state.undoStack && state.undoStack.length) {
      var uEx = state.undoStack[state.undoStack.length - 1];
      if (uEx && uEx.type === "mesh-geo") preSnapEx = uEx;
    }
    state.modal = {
      mode: "extrude-mesh",
      axis: state.axisLock,
      startClient: null,
      mesh: mesh,
      newVerts: newVerts,
      basePos: basePos,
      normal: n.clone(),
      sel: sel,
      preSnap: preSnapEx,
    };
    if (state.orbit) state.orbit.enabled = false;
    if (state.transform) {
      state.transform.enabled = false;
      state.transform.visible = false;
    }
    highlightMeshSelection();
    setStatus("Extrude — drag mouse for depth · LMB confirm · Esc cancel", "ok");
  }

  /** Extrude edge or vertex when E pressed without a face — also modal for edge/vert. */
  function extrudeSelected() {
    var sel = state.meshSel;
    if (!sel) {
      setStatus("Select a face, edge, or vertex in Edit Mode, then E.", "err");
      return;
    }
    if (sel.type === "face") {
      extrudeSelectedFace({ fixed: false });
      return;
    }
    var mesh = sel.mesh;
    var geo = prepareEditableGeometry(mesh);
    pushMeshEditUndo(mesh, "Extrude");
    var pos = geo.attributes.position;
    var n = new THREE.Vector3(0, 1, 0);
    if (sel.faceIndex != null && geo.index) {
      var ia = geo.index.getX(sel.faceIndex * 3);
      var ib = geo.index.getX(sel.faceIndex * 3 + 1);
      var ic = geo.index.getX(sel.faceIndex * 3 + 2);
      n = faceNormalLocal(mesh, ia, ib, ic);
    }
    n.normalize();
    if (sel.type === "vertex") {
      var vi = sel.vi;
      var base = new THREE.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
      var oldIdxLenV = geo.index.count;
      var newV = appendCopiedVertices(geo, [vi]);
      sel.vi = newV[0];
      state.modal = {
        mode: "extrude-mesh",
        axis: state.axisLock,
        startClient: null,
        mesh: mesh,
        newVerts: newV,
        basePos: [base],
        normal: n.clone(),
        sel: sel,
      };
      if (state.orbit) state.orbit.enabled = false;
      ensureMaterialList(mesh);
      highlightMeshSelection();
      setStatus("Extrude vertex — drag for depth · LMB confirm", "ok");
      return;
    }
    if (sel.type === "edge") {
      var e0 = sel.e0;
      var e1 = sel.e1;
      var b0 = new THREE.Vector3(pos.getX(e0), pos.getY(e0), pos.getZ(e0));
      var b1 = new THREE.Vector3(pos.getX(e1), pos.getY(e1), pos.getZ(e1));
      var oldIdxLenE = geo.index.count;
      var faceMatE = getFaceMaterialIndex(geo, sel.faceIndex || 0);
      var newE = appendCopiedVertices(geo, [e0, e1]);
      var indices = Array.from(geo.index.array);
      indices.push(e0, e1, newE[1], e0, newE[1], newE[0]);
      geo.setIndex(indices);
      syncGroupsAfterIndexChange(mesh, oldIdxLenE, faceMatE);
      sel.e0 = newE[0];
      sel.e1 = newE[1];
      finalizeMeshEdit(mesh);
      state.modal = {
        mode: "extrude-mesh",
        axis: state.axisLock,
        startClient: null,
        mesh: mesh,
        newVerts: newE,
        basePos: [b0, b1],
        normal: n.clone(),
        sel: sel,
      };
      if (state.orbit) state.orbit.enabled = false;
      highlightMeshSelection();
      setStatus("Extrude edge — drag for depth · LMB confirm", "ok");
    }
  }

  function applyExtrudeModalDepth(depth) {
    var m = state.modal;
    if (!m || m.mode !== "extrude-mesh" || !m.mesh) return;
    var geo = m.mesh.geometry;
    var pos = geo.attributes.position;
    var n = m.normal;
    m.newVerts.forEach(function (vi, i) {
      var b = m.basePos[i];
      pos.setXYZ(vi, b.x + n.x * depth, b.y + n.y * depth, b.z + n.z * depth);
    });
    pos.needsUpdate = true;
    finalizeMeshEdit(m.mesh);
    highlightMeshSelection();
  }

  /** Midpoint subdivide of selected face (or whole mesh if none). */
  function subdivideSelected() {
    var mesh = getEditableMesh(state.selected);
    if (!mesh) {
      setStatus("Select a mesh to subdivide.", "err");
      return;
    }
    var geo = prepareEditableGeometry(mesh);
    if (!geo || !geo.index) return;
    pushMeshEditUndo(mesh, "Subdivide");
    var pos = geo.attributes.position;
    var indices = Array.from(geo.index.array);
    var faceCount = indices.length / 3;
    var onlyFaces = null;
    if (state.meshSel && state.meshSel.mesh === mesh && state.meshSel.type === "face") {
      onlyFaces = {};
      if (state.meshSel.quadTris) {
        state.meshSel.quadTris.forEach(function (f) {
          onlyFaces[f] = 1;
        });
      } else {
        onlyFaces[state.meshSel.faceIndex] = 1;
      }
    }
    var arr = Array.from(pos.array);
    var midCache = {};
    function midKey(i, j) {
      return i < j ? i + "_" + j : j + "_" + i;
    }
    function getMid(i, j) {
      var k = midKey(i, j);
      if (midCache[k] != null) return midCache[k];
      var mx = (pos.getX(i) + pos.getX(j)) * 0.5;
      var my = (pos.getY(i) + pos.getY(j)) * 0.5;
      var mz = (pos.getZ(i) + pos.getZ(j)) * 0.5;
      var ni = arr.length / 3;
      arr.push(mx, my, mz);
      midCache[k] = ni;
      return ni;
    }
    var newIdx = [];
    for (var f = 0; f < faceCount; f++) {
      if (onlyFaces && !onlyFaces[f]) {
        newIdx.push(indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]);
        continue;
      }
      var a = indices[f * 3];
      var b = indices[f * 3 + 1];
      var c = indices[f * 3 + 2];
      var mab = getMid(a, b);
      var mbc = getMid(b, c);
      var mca = getMid(c, a);
      newIdx.push(a, mab, mca, mab, b, mbc, mca, mbc, c, mab, mbc, mca);
    }
    var mat0 = getFaceMaterialIndex(geo, 0);
    geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    if (geo.attributes.normal) geo.deleteAttribute("normal");
    geo.setIndex(newIdx);
    // Preserve materials: single group covering all with primary mat
    geo.clearGroups();
    geo.addGroup(0, newIdx.length, mat0);
    geo.computeVertexNormals();
    ensureMaterialList(mesh);
    clearMeshSelection();
    setStatus(onlyFaces ? "Subdivided selected face." : "Subdivided mesh faces.", "ok");
  }

  /**
   * Append a vertex lerped between two existing verts (pos + color + uv).
   * Returns new vertex index.
   */
  function appendLerpVertex(geo, i0, i1, t) {
    t = Math.max(0, Math.min(1, t));
    var pos = geo.attributes.position;
    var posArr = Array.from(pos.array);
    var x = pos.getX(i0) + (pos.getX(i1) - pos.getX(i0)) * t;
    var y = pos.getY(i0) + (pos.getY(i1) - pos.getY(i0)) * t;
    var z = pos.getZ(i0) + (pos.getZ(i1) - pos.getZ(i0)) * t;
    var ni = posArr.length / 3;
    posArr.push(x, y, z);
    geo.setAttribute("position", new THREE.Float32BufferAttribute(posArr, 3));

    if (geo.attributes.color) {
      var col = geo.attributes.color;
      var colArr = Array.from(col.array);
      var item = col.itemSize || 3;
      for (var c = 0; c < item; c++) {
        var ca = col.array[i0 * item + c];
        var cb = col.array[i1 * item + c];
        colArr.push(ca + (cb - ca) * t);
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colArr, item));
    }
    if (geo.attributes.uv) {
      var uv = geo.attributes.uv;
      var uvArr = Array.from(uv.array);
      uvArr.push(
        uv.getX(i0) + (uv.getX(i1) - uv.getX(i0)) * t,
        uv.getY(i0) + (uv.getY(i1) - uv.getY(i0)) * t
      );
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvArr, 2));
    }
    if (geo.attributes.normal) geo.deleteAttribute("normal");
    return ni;
  }

  /**
   * Resolve a proper loop-cut across a quad face.
   * Never uses the internal triangle diagonal — only perimeter edges.
   * midB uses reverse param so the cut stays parallel (not diagonal).
   */
  function buildLoopCutPlan(mesh, faceIndex, e0, e1) {
    var geo = mesh.geometry;
    var pos = geo.attributes.position;
    var quad = findQuadForTri(mesh, faceIndex);
    if (!quad || !quad.verts || quad.verts.length !== 4) return null;
    var verts = quad.verts;
    var edgeIdx = -1;
    var i;
    for (i = 0; i < 4; i++) {
      var a = verts[i];
      var b = verts[(i + 1) % 4];
      if ((a === e0 && b === e1) || (a === e1 && b === e0)) {
        edgeIdx = i;
        break;
      }
    }
    // Diagonal / non-ring edge → snap to nearest perimeter edge
    if (edgeIdx < 0) {
      var mx = (pos.getX(e0) + pos.getX(e1)) * 0.5;
      var my = (pos.getY(e0) + pos.getY(e1)) * 0.5;
      var mz = (pos.getZ(e0) + pos.getZ(e1)) * 0.5;
      var bestD = Infinity;
      for (i = 0; i < 4; i++) {
        var p0 = verts[i];
        var p1 = verts[(i + 1) % 4];
        var cx = (pos.getX(p0) + pos.getX(p1)) * 0.5 - mx;
        var cy = (pos.getY(p0) + pos.getY(p1)) * 0.5 - my;
        var cz = (pos.getZ(p0) + pos.getZ(p1)) * 0.5 - mz;
        var d = cx * cx + cy * cy + cz * cz;
        if (d < bestD) {
          bestD = d;
          edgeIdx = i;
        }
      }
    }
    var oppIdx = (edgeIdx + 2) % 4;
    var a0 = verts[edgeIdx];
    var a1 = verts[(edgeIdx + 1) % 4];
    var b0 = verts[oppIdx];
    var b1 = verts[(oppIdx + 1) % 4];
    var n = faceNormalLocal(mesh, verts[0], verts[1], verts[2]);
    return {
      mesh: mesh,
      faceIndex: faceIndex,
      verts: verts,
      quadTris: quad.quadTris.slice(),
      edgeIdx: edgeIdx,
      a0: a0,
      a1: a1,
      b0: b0,
      b1: b1,
      n: n,
      faceMat: getFaceMaterialIndex(geo, faceIndex),
    };
  }

  function loopCutPlanFromSelection(mesh, sel) {
    if (!sel || !mesh) return null;
    var faceIndex = sel.faceIndex;
    var e0;
    var e1;
    if (sel.type === "edge") {
      e0 = sel.e0;
      e1 = sel.e1;
    } else if (sel.type === "face") {
      var q = findQuadForTri(mesh, faceIndex);
      if (q && q.verts && q.verts.length === 4) {
        e0 = q.verts[0];
        e1 = q.verts[1];
      } else {
        e0 = sel.a;
        e1 = sel.b;
      }
    } else {
      return null;
    }
    return buildLoopCutPlan(mesh, faceIndex, e0, e1);
  }

  function loopCutLinePoints(mesh, plan, t) {
    var pos = mesh.geometry.attributes.position;
    t = Math.max(0.05, Math.min(0.95, t == null ? 0.5 : t));
    function lerpV(i0, i1, u) {
      return new THREE.Vector3(
        pos.getX(i0) + (pos.getX(i1) - pos.getX(i0)) * u,
        pos.getY(i0) + (pos.getY(i1) - pos.getY(i0)) * u,
        pos.getZ(i0) + (pos.getZ(i1) - pos.getZ(i0)) * u
      );
    }
    return {
      p0: lerpV(plan.a0, plan.a1, t),
      p1: lerpV(plan.b1, plan.b0, t),
      t: t,
    };
  }

  function addCutPreviewLine(mesh, p0, p1, hilites, color) {
    var eg = new THREE.BufferGeometry();
    var ea = new Float32Array([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z]);
    eg.setAttribute("position", new THREE.BufferAttribute(ea, 3));
    var line = new THREE.Line(
      eg,
      new THREE.LineBasicMaterial({
        color: color != null ? color : 0x44eeff,
        linewidth: 2,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      })
    );
    line.renderOrder = 12;
    mesh.add(line);
    hilites.push(line);
    var dotMat = new THREE.MeshBasicMaterial({
      color: color != null ? color : 0x44eeff,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    [p0, p1].forEach(function (p) {
      var d = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), dotMat.clone());
      d.position.copy(p);
      d.renderOrder = 13;
      mesh.add(d);
      hilites.push(d);
    });
    return line;
  }

  function pushOrientedQuad(indices, geo, q0, q1, q2, q3, expectedN) {
    var pos = geo.attributes.position;
    function fn(a, b, c) {
      var va = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a));
      var vb = new THREE.Vector3(pos.getX(b), pos.getY(b), pos.getZ(b));
      var vc = new THREE.Vector3(pos.getX(c), pos.getY(c), pos.getZ(c));
      return new THREE.Vector3()
        .subVectors(vb, va)
        .cross(new THREE.Vector3().subVectors(vc, va))
        .normalize();
    }
    var n = fn(q0, q1, q2);
    if (expectedN && n.dot(expectedN) < 0) {
      indices.push(q0, q2, q1, q0, q3, q2);
    } else {
      indices.push(q0, q1, q2, q0, q2, q3);
    }
  }

  function applyLoopCutTopology(mesh, plan, t) {
    var geo = mesh.geometry;
    t = Math.max(0.05, Math.min(0.95, t == null ? 0.5 : t));
    var oldIndexLen = geo.index.count;
    var mA = appendLerpVertex(geo, plan.a0, plan.a1, t);
    var mB = appendLerpVertex(geo, plan.b1, plan.b0, t);
    var indices = Array.from(geo.index.array);
    var t0 = plan.quadTris[0] * 3;
    var t1 = plan.quadTris[1] * 3;
    var left = [];
    var right = [];
    // Parallel split: left a0-mA-mB-b1, right mA-a1-b0-mB
    pushOrientedQuad(left, geo, plan.a0, mA, mB, plan.b1, plan.n);
    pushOrientedQuad(right, geo, mA, plan.a1, plan.b0, mB, plan.n);
    indices[t0] = left[0];
    indices[t0 + 1] = left[1];
    indices[t0 + 2] = left[2];
    indices[t1] = left[3];
    indices[t1 + 1] = left[4];
    indices[t1 + 2] = left[5];
    for (var i = 0; i < right.length; i++) indices.push(right[i]);
    geo.setIndex(indices);
    syncGroupsAfterIndexChange(mesh, oldIndexLen, plan.faceMat);
    normalizeMeshMaterials(mesh);
    repairMeshNormals(mesh);
    return { mA: mA, mB: mB, t: t };
  }

  function updateLoopCutMidPositions(mesh, plan, mA, mB, t) {
    var geo = mesh.geometry;
    var pos = geo.attributes.position;
    t = Math.max(0.05, Math.min(0.95, t));
    function setLerp(vi, i0, i1, u) {
      pos.setXYZ(
        vi,
        pos.getX(i0) + (pos.getX(i1) - pos.getX(i0)) * u,
        pos.getY(i0) + (pos.getY(i1) - pos.getY(i0)) * u,
        pos.getZ(i0) + (pos.getZ(i1) - pos.getZ(i0)) * u
      );
    }
    setLerp(mA, plan.a0, plan.a1, t);
    setLerp(mB, plan.b1, plan.b0, t);
    pos.needsUpdate = true;
    repairMeshNormals(mesh);
  }

  /**
   * Loop cut: select edge (preferred) or face, Ctrl+R / button.
   * Shows cyan cut line, drag to slide, LMB confirm, Esc cancel.
   */
  function loopCutSelected() {
    if (state.modal && state.modal.mode === "loop-cut") {
      confirmModal();
      return;
    }
    var sel = state.meshSel;
    if (!sel || !sel.mesh) {
      setStatus("Select an edge (Edit → Edge / 2), then Ctrl+R for loop cut.", "err");
      return;
    }
    var mesh = sel.mesh;
    var geo = prepareEditableGeometry(mesh);
    if (!geo || !geo.index) return;

    var plan = loopCutPlanFromSelection(mesh, sel);
    if (!plan) {
      if (sel.type !== "edge" && sel.type !== "face") {
        setStatus("Loop cut needs a face edge on a quad.", "err");
        return;
      }
      pushMeshEditUndo(mesh, "Loop cut");
      var e0 = sel.type === "edge" ? sel.e0 : sel.a;
      var e1 = sel.type === "edge" ? sel.e1 : sel.b;
      var faceIndex = sel.faceIndex;
      var oldLen = geo.index.count;
      var mid = appendLerpVertex(geo, e0, e1, 0.5);
      var indices = Array.from(geo.index.array);
      var a = geo.index.getX(faceIndex * 3);
      var b = geo.index.getX(faceIndex * 3 + 1);
      var c = geo.index.getX(faceIndex * 3 + 2);
      var base = faceIndex * 3;
      if ((a === e0 && b === e1) || (a === e1 && b === e0)) {
        indices[base] = a;
        indices[base + 1] = mid;
        indices[base + 2] = c;
        indices.push(mid, b, c);
      } else if ((b === e0 && c === e1) || (b === e1 && c === e0)) {
        indices[base] = a;
        indices[base + 1] = b;
        indices[base + 2] = mid;
        indices.push(a, mid, c);
      } else {
        indices[base] = a;
        indices[base + 1] = b;
        indices[base + 2] = mid;
        indices.push(b, c, mid);
      }
      geo.setIndex(indices);
      syncGroupsAfterIndexChange(mesh, oldLen, getFaceMaterialIndex(geo, faceIndex));
      normalizeMeshMaterials(mesh);
      repairMeshNormals(mesh);
      clearMeshSelection();
      setStatus("Edge split (triangle face — select a quad edge for a full loop cut).", "ok");
      return;
    }

    pushMeshEditUndo(mesh, "Loop cut");
    var preSnap = null;
    if (state.undoStack && state.undoStack.length) {
      var u = state.undoStack[state.undoStack.length - 1];
      if (u && u.type === "mesh-geo") preSnap = u;
    }
    var result = applyLoopCutTopology(mesh, plan, 0.5);
    state.modal = {
      mode: "loop-cut",
      axis: state.axisLock,
      startClient: null,
      mesh: mesh,
      plan: plan,
      mA: result.mA,
      mB: result.mB,
      t: 0.5,
      preSnap: preSnap,
    };
    if (state.orbit) state.orbit.enabled = false;
    if (state.transform) {
      state.transform.enabled = false;
      state.transform.visible = false;
    }
    state.meshSel = {
      type: "edge",
      mesh: mesh,
      e0: result.mA,
      e1: result.mB,
      faceIndex: plan.quadTris[0],
    };
    state.meshSels = [state.meshSel];
    highlightMeshSelection();
    setStatus("Loop cut — drag to slide · LMB confirm · Esc cancel (cyan line = cut)", "ok");
  }

  function applyLoopCutModalT(t) {
    var m = state.modal;
    if (!m || m.mode !== "loop-cut" || !m.mesh || !m.plan) return;
    m.t = Math.max(0.05, Math.min(0.95, t));
    updateLoopCutMidPositions(m.mesh, m.plan, m.mA, m.mB, m.t);
    if (state.meshSel && state.meshSel.type === "edge") {
      state.meshSel.e0 = m.mA;
      state.meshSel.e1 = m.mB;
    }
    highlightMeshSelection();
  }

  /**
   * Inset keeps the same edge count as the selected face.
   * Default: drag modal for amount (like extrude). options.fixed uses getEditAmount().
   */
  function insetSelectedFace(options) {
    options = options || {};
    var sel = state.meshSel;
    if (!sel || sel.type !== "face" || !sel.mesh) {
      setStatus("Select a face in Edit Mode, then I.", "err");
      return;
    }
    var mesh = sel.mesh;
    var geo = prepareEditableGeometry(mesh);
    if (!geo || !geo.index) return;
    if (!options.skipUndo) pushMeshEditUndo(mesh, "Inset");
    ensureMaterialList(mesh);
    var pos = geo.attributes.position;
    var verts = getSelectedFaceVerts(sel);
    var n = verts.length;
    if (n < 3) return;
    var faceMat = getFaceMaterialIndex(geo, sel.faceIndex);
    var oldIndexLen = geo.index.count;

    var cx = 0;
    var cy = 0;
    var cz = 0;
    verts.forEach(function (vi) {
      cx += pos.getX(vi);
      cy += pos.getY(vi);
      cz += pos.getZ(vi);
    });
    cx /= n;
    cy /= n;
    cz /= n;

    var inner = appendCopiedVertices(geo, verts);
    pos = geo.attributes.position;
    var baseInner = inner.map(function (vi) {
      return new THREE.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
    });

    var faceN = faceNormalLocal(mesh, verts[0], verts[1], verts[2]);
    var indices = Array.from(geo.index.array);

    if (n === 4 && sel.quadTris && sel.quadTris.length === 2) {
      var t0 = sel.quadTris[0] * 3;
      var t1 = sel.quadTris[1] * 3;
      var in0 = orientTri(geo, inner[0], inner[1], inner[2], faceN);
      var in1 = orientTri(geo, inner[0], inner[2], inner[3], faceN);
      indices[t0] = in0[0];
      indices[t0 + 1] = in0[1];
      indices[t0 + 2] = in0[2];
      indices[t1] = in1[0];
      indices[t1 + 1] = in1[1];
      indices[t1 + 2] = in1[2];
      for (var s = 0; s < 4; s++) {
        var o0 = verts[s];
        var o1 = verts[(s + 1) % 4];
        var i0 = inner[s];
        var i1 = inner[(s + 1) % 4];
        // Inset sides face up along face normal (coplanar ring)
        pushOrientedSide(indices, geo, o0, o1, i1, i0, faceN);
      }
      sel.a = inner[0];
      sel.b = inner[1];
      sel.c = inner[2];
      sel.d = inner[3];
      sel.verts = inner.slice();
    } else if (n === 3) {
      var base = sel.faceIndex * 3;
      var inT = orientTri(geo, inner[0], inner[1], inner[2], faceN);
      indices[base] = inT[0];
      indices[base + 1] = inT[1];
      indices[base + 2] = inT[2];
      for (var s3 = 0; s3 < 3; s3++) {
        var oa = verts[s3];
        var ob = verts[(s3 + 1) % 3];
        var ia = inner[s3];
        var ib = inner[(s3 + 1) % 3];
        pushOrientedSide(indices, geo, oa, ob, ib, ia, faceN);
      }
      sel.a = inner[0];
      sel.b = inner[1];
      sel.c = inner[2];
      sel.d = null;
      sel.verts = inner.slice();
    } else {
      var baseN = sel.faceIndex * 3;
      var inN = orientTri(geo, inner[0], inner[1], inner[2], faceN);
      indices[baseN] = inN[0];
      indices[baseN + 1] = inN[1];
      indices[baseN + 2] = inN[2];
      for (var t = 2; t < n - 1; t++) {
        var fan = orientTri(geo, inner[0], inner[t], inner[t + 1], faceN);
        indices.push(fan[0], fan[1], fan[2]);
      }
      for (var sn = 0; sn < n; sn++) {
        var oa2 = verts[sn];
        var ob2 = verts[(sn + 1) % n];
        var ia2 = inner[sn];
        var ib2 = inner[(sn + 1) % n];
        pushOrientedSide(indices, geo, oa2, ob2, ib2, ia2, faceN);
      }
      sel.verts = inner.slice();
      sel.a = inner[0];
      sel.b = inner[1];
      sel.c = inner[2];
      sel.d = n > 3 ? inner[3] : null;
    }

    geo.setIndex(indices);
    syncGroupsAfterIndexChange(mesh, oldIndexLen, faceMat);
    finalizeMeshEdit(mesh);

    if (state.meshSels && state.meshSels.length) {
      state.meshSels[state.meshSels.length - 1] = sel;
    } else {
      state.meshSels = [sel];
    }
    state.meshSel = sel;

    if (options.fixed) {
      var factor = Math.min(0.45, Math.max(0.05, getEditAmount()));
      applyInsetModalFactorOn(mesh, inner, baseInner, cx, cy, cz, factor);
      finalizeMeshEdit(mesh);
      highlightMeshSelection();
      setStatus("Inset " + n + "-gon (factor " + factor.toFixed(2) + ").", "ok");
      return;
    }

    state.modal = {
      mode: "inset-mesh",
      axis: state.axisLock,
      startClient: null,
      mesh: mesh,
      inner: inner,
      baseInner: baseInner,
      center: { x: cx, y: cy, z: cz },
      sel: sel,
      preSnap: null,
    };
    if (state.undoStack && state.undoStack.length) {
      var u = state.undoStack[state.undoStack.length - 1];
      // pushMeshEditUndo pushes the geometry snap directly
      if (u && u.type === "mesh-geo") state.modal.preSnap = u;
    }
    if (state.orbit) state.orbit.enabled = false;
    if (state.transform) {
      state.transform.enabled = false;
      state.transform.visible = false;
    }
    applyInsetModalFactor(0.12);
    highlightMeshSelection();
    setStatus("Inset — drag for amount · LMB confirm · Esc cancel", "ok");
  }

  function applyInsetModalFactorOn(mesh, inner, baseInner, cx, cy, cz, factor) {
    if (!mesh || !inner || !baseInner) return;
    factor = Math.max(0, Math.min(0.49, factor));
    var pos = mesh.geometry.attributes.position;
    for (var i = 0; i < inner.length; i++) {
      var b = baseInner[i];
      pos.setXYZ(
        inner[i],
        b.x + (cx - b.x) * factor,
        b.y + (cy - b.y) * factor,
        b.z + (cz - b.z) * factor
      );
    }
    pos.needsUpdate = true;
    finalizeMeshEdit(mesh);
  }

  function applyInsetModalFactor(factor) {
    var m = state.modal;
    if (!m || m.mode !== "inset-mesh" || !m.mesh) return;
    applyInsetModalFactorOn(
      m.mesh,
      m.inner,
      m.baseInner,
      m.center.x,
      m.center.y,
      m.center.z,
      factor
    );
    m.lastFactor = factor;
    highlightMeshSelection();
  }

  /**
   * Bevel:
   *  - Face  → modal extrude (scalar depth), not a fake chamfer.
   *  - Edge  → split 1 edge into 2 parallel edges + bevel face (slide along faces).
   *  - Vertex → 1 vertex becomes N verts (one per connected edge) + new face.
   * Profile: Flat (planar strips) or Curved (arc profile / bulged vertex).
   */
  function setBevelProfile(profile) {
    state.bevelProfile = profile === "curved" ? "curved" : "flat";
    var flatBtn = $("mod-bevel-flat");
    var curvedBtn = $("mod-bevel-curved");
    if (flatBtn) flatBtn.classList.toggle("is-active", state.bevelProfile === "flat");
    if (curvedBtn) curvedBtn.classList.toggle("is-active", state.bevelProfile === "curved");
    // Live-update open bevel modal profile if possible (rebuild not supported mid-modal)
    if (state.modal && state.modal.mode === "bevel-mesh") {
      state.modal.profile = state.bevelProfile;
      applyBevelModalAmount(state.modal.amount);
    }
    setStatus("Bevel profile: " + state.bevelProfile, "ok");
  }

  function bevelSelected() {
    if (state.modal && state.modal.mode === "bevel-mesh") {
      confirmModal();
      return;
    }
    var sel = state.meshSel;
    if (!sel || !sel.mesh) {
      setStatus("Select a face, edge, or vertex, then B to bevel.", "err");
      return;
    }
    if (sel.type === "face") {
      // Face bevel = modal extrude on a scalar
      setStatus("Face bevel = extrude — drag depth · LMB confirm · Esc cancel", "ok");
      extrudeSelectedFace({ fixed: false });
      return;
    }
    if (sel.type === "edge") {
      startBevelEdgeModal(sel);
      return;
    }
    if (sel.type === "vertex") {
      startBevelVertexModal(sel);
      return;
    }
    setStatus("Bevel needs a face, edge, or vertex selection.", "err");
  }

  /** Slerp unit vectors (or nlerp fallback). */
  function slerpUnit(a, b, t) {
    var va = a.clone().normalize();
    var vb = b.clone().normalize();
    var dot = Math.max(-1, Math.min(1, va.dot(vb)));
    if (dot > 0.9995) {
      return va.lerp(vb, t).normalize();
    }
    var theta = Math.acos(dot) * t;
    var rel = vb.clone().addScaledVector(va, -dot).normalize();
    return va.multiplyScalar(Math.cos(theta)).addScaledVector(rel, Math.sin(theta)).normalize();
  }

  function findFacesWithEdge(geo, e0, e1) {
    var out = [];
    if (!geo.index) return out;
    var idx = geo.index;
    var faceCount = (idx.count / 3) | 0;
    for (var f = 0; f < faceCount; f++) {
      var a = idx.getX(f * 3);
      var b = idx.getX(f * 3 + 1);
      var c = idx.getX(f * 3 + 2);
      var has0 = a === e0 || b === e0 || c === e0;
      var has1 = a === e1 || b === e1 || c === e1;
      if (!has0 || !has1) continue;
      var other = a !== e0 && a !== e1 ? a : b !== e0 && b !== e1 ? b : c;
      out.push({ faceIndex: f, a: a, b: b, c: c, other: other });
    }
    return out;
  }

  /** Inward unit dir from edge e0→e1 toward face third vertex (in face plane). */
  function edgeInwardOnFace(mesh, e0, e1, other) {
    var pos = mesh.geometry.attributes.position;
    var p0 = new THREE.Vector3(pos.getX(e0), pos.getY(e0), pos.getZ(e0));
    var p1 = new THREE.Vector3(pos.getX(e1), pos.getY(e1), pos.getZ(e1));
    var po = new THREE.Vector3(pos.getX(other), pos.getY(other), pos.getZ(other));
    var edge = new THREE.Vector3().subVectors(p1, p0);
    var el = edge.length();
    if (el < 1e-12) edge.set(1, 0, 0);
    else edge.multiplyScalar(1 / el);
    var mid = p0.clone().add(p1).multiplyScalar(0.5);
    var inward = po.clone().sub(mid);
    inward.addScaledVector(edge, -inward.dot(edge));
    if (inward.lengthSq() < 1e-12) {
      var n = faceNormalLocal(mesh, e0, e1, other);
      inward.crossVectors(n, edge);
    }
    if (inward.lengthSq() < 1e-12) inward.set(0, 1, 0);
    return inward.normalize();
  }

  function getVertexNeighbors(geo, vi) {
    var set = {};
    if (!geo.index) return [];
    var idx = geo.index;
    var faceCount = (idx.count / 3) | 0;
    for (var f = 0; f < faceCount; f++) {
      var a = idx.getX(f * 3);
      var b = idx.getX(f * 3 + 1);
      var c = idx.getX(f * 3 + 2);
      if (a === vi) {
        set[b] = 1;
        set[c] = 1;
      }
      if (b === vi) {
        set[a] = 1;
        set[c] = 1;
      }
      if (c === vi) {
        set[a] = 1;
        set[b] = 1;
      }
    }
    return Object.keys(set).map(function (k) {
      return parseInt(k, 10);
    });
  }

  /** Angular order of neighbor verts around vertex vi. */
  function orderNeighborsAround(mesh, vi, neighbors) {
    if (neighbors.length < 2) return neighbors.slice();
    var pos = mesh.geometry.attributes.position;
    var p = new THREE.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
    var nAcc = new THREE.Vector3();
    var idx = mesh.geometry.index;
    var faceCount = (idx.count / 3) | 0;
    for (var f = 0; f < faceCount; f++) {
      var a = idx.getX(f * 3);
      var b = idx.getX(f * 3 + 1);
      var c = idx.getX(f * 3 + 2);
      if (a === vi || b === vi || c === vi) {
        nAcc.add(faceNormalLocal(mesh, a, b, c));
      }
    }
    if (nAcc.lengthSq() < 1e-12) nAcc.set(0, 1, 0);
    nAcc.normalize();
    var tangent = new THREE.Vector3(1, 0, 0);
    if (Math.abs(nAcc.dot(tangent)) > 0.9) tangent.set(0, 1, 0);
    var bitan = new THREE.Vector3().crossVectors(nAcc, tangent).normalize();
    tangent.crossVectors(bitan, nAcc).normalize();
    var scored = neighbors.map(function (ni) {
      var d = new THREE.Vector3(
        pos.getX(ni) - p.x,
        pos.getY(ni) - p.y,
        pos.getZ(ni) - p.z
      );
      var ang = Math.atan2(d.dot(bitan), d.dot(tangent));
      return { ni: ni, ang: ang };
    });
    scored.sort(function (a, b) {
      return a.ang - b.ang;
    });
    return scored.map(function (s) {
      return s.ni;
    });
  }

  /**
   * Edge bevel: one edge → profile of edges + faces, sliding along incident faces.
   * Flat = single planar strip; Curved = multi-segment arc between face sides.
   */
  function startBevelEdgeModal(sel) {
    var mesh = sel.mesh;
    var geo = prepareEditableGeometry(mesh);
    if (!geo || !geo.index) return;
    var e0 = sel.e0;
    var e1 = sel.e1;
    var faces = findFacesWithEdge(geo, e0, e1);
    if (!faces.length) {
      setStatus("Edge has no faces to bevel.", "err");
      return;
    }
    pushMeshEditUndo(mesh, "Bevel");
    ensureMaterialList(mesh);
    var pos = geo.attributes.position;
    var p0 = new THREE.Vector3(pos.getX(e0), pos.getY(e0), pos.getZ(e0));
    var p1 = new THREE.Vector3(pos.getX(e1), pos.getY(e1), pos.getZ(e1));
    var edgeLen = p0.distanceTo(p1) || 1;
    var faceMat = getFaceMaterialIndex(
      geo,
      sel.faceIndex != null ? sel.faceIndex : faces[0].faceIndex
    );
    var oldIndexLen = geo.index.count;
    var profile = state.bevelProfile || "flat";
    var segs = profile === "curved" ? Math.max(2, state.bevelSegments | 0 || 3) : 1;

    // Face-inward dirs for each incident face
    var faceDirs = faces.map(function (fc) {
      return {
        faceIndex: fc.faceIndex,
        other: fc.other,
        dir: edgeInwardOnFace(mesh, e0, e1, fc.other),
        n: faceNormalLocal(mesh, e0, e1, fc.other),
      };
    });

    // Profile rows: each row is a parallel edge (aF–bF) with a unit dir from the original edge
    var rows = [];
    var ri;

    if (faceDirs.length === 1) {
      // Boundary: flat = one slid edge; curved = quarter-arc profile using face normal
      var fd = faceDirs[0];
      var bCount = profile === "curved" ? segs : 1;
      for (ri = 0; ri < bCount; ri++) {
        var u = bCount === 1 ? 1 : (ri + 1) / bCount;
        var dirB =
          profile === "curved" ? slerpUnit(fd.n, fd.dir, u) : fd.dir.clone();
        var nvB = appendCopiedVertices(geo, [e0, e1]);
        rows.push({ aF: nvB[0], bF: nvB[1], dir: dirB, u: u });
      }
    } else {
      // Manifold (typically 2 faces): flat = two end rows; curved = arc between inwards
      var d0 = faceDirs[0].dir;
      var d1 = faceDirs[1].dir;
      for (ri = 0; ri <= segs; ri++) {
        var uc = ri / segs;
        var dirM =
          profile === "curved" ? slerpUnit(d0, d1, uc) : ri === 0 ? d0.clone() : d1.clone();
        var nvM = appendCopiedVertices(geo, [e0, e1]);
        rows.push({
          aF: nvM[0],
          bF: nvM[1],
          dir: dirM,
          u: uc,
          faceIndex: ri === 0 ? faceDirs[0].faceIndex : ri === segs ? faceDirs[1].faceIndex : -1,
        });
      }
    }

    var indices = Array.from(geo.index.array);

    // Rewrite incident faces to use the profile end-rows
    if (faceDirs.length === 1) {
      // Face uses outermost slid row (last)
      var last = rows[rows.length - 1];
      var base1 = faceDirs[0].faceIndex * 3;
      for (var k1 = 0; k1 < 3; k1++) {
        if (indices[base1 + k1] === e0) indices[base1 + k1] = last.aF;
        else if (indices[base1 + k1] === e1) indices[base1 + k1] = last.bF;
      }
      // Boundary: chain original edge → profile rows
      pushOrientedSide(indices, geo, e0, e1, rows[0].bF, rows[0].aF, rows[0].dir);
      for (ri = 0; ri < rows.length - 1; ri++) {
        var ra = rows[ri];
        var rb = rows[ri + 1];
        var midNb = ra.dir.clone().add(rb.dir).normalize();
        if (midNb.lengthSq() < 1e-12) midNb.copy(ra.dir);
        pushOrientedQuad(indices, geo, ra.aF, ra.bF, rb.bF, rb.aF, midNb);
      }
    } else {
      // Face0 uses rows[0], face1 uses rows[last]
      var row0 = rows[0];
      var rowN = rows[rows.length - 1];
      var baseA = faceDirs[0].faceIndex * 3;
      var baseB = faceDirs[1].faceIndex * 3;
      for (var ka = 0; ka < 3; ka++) {
        if (indices[baseA + ka] === e0) indices[baseA + ka] = row0.aF;
        else if (indices[baseA + ka] === e1) indices[baseA + ka] = row0.bF;
      }
      for (var kb = 0; kb < 3; kb++) {
        if (indices[baseB + kb] === e0) indices[baseB + kb] = rowN.aF;
        else if (indices[baseB + kb] === e1) indices[baseB + kb] = rowN.bF;
      }
      // Profile strips
      for (ri = 0; ri < rows.length - 1; ri++) {
        var r0 = rows[ri];
        var r1 = rows[ri + 1];
        var midN = r0.dir.clone().add(r1.dir).normalize();
        if (midN.lengthSq() < 1e-12) midN.copy(r0.dir);
        pushOrientedQuad(indices, geo, r0.aF, r0.bF, r1.bF, r1.aF, midN);
      }
      // End caps at e0 / e1 through profile a's / b's
      var capN = faceDirs[0].dir.clone().add(faceDirs[1].dir).normalize();
      for (ri = 0; ri < rows.length - 1; ri++) {
        var tA = orientTri(geo, e0, rows[ri].aF, rows[ri + 1].aF, capN);
        indices.push(tA[0], tA[1], tA[2]);
        var tB = orientTri(geo, e1, rows[ri + 1].bF, rows[ri].bF, capN);
        indices.push(tB[0], tB[1], tB[2]);
      }
    }

    geo.setIndex(indices);
    syncGroupsAfterIndexChange(mesh, oldIndexLen, faceMat);
    finalizeMeshEdit(mesh);

    sel.e0 = rows[0].aF;
    sel.e1 = rows[0].bF;
    state.meshSel = sel;
    state.meshSels = [sel];

    var preSnap = null;
    if (state.undoStack && state.undoStack.length) {
      var u = state.undoStack[state.undoStack.length - 1];
      if (u && u.type === "mesh-geo") preSnap = u;
    }

    state.modal = {
      mode: "bevel-mesh",
      kind: "edge",
      profile: profile,
      startClient: null,
      mesh: mesh,
      rows: rows,
      base0: p0.clone(),
      base1: p1.clone(),
      edgeLen: edgeLen,
      amount: edgeLen * 0.12,
      preSnap: preSnap,
      sel: sel,
    };
    if (state.orbit) state.orbit.enabled = false;
    if (state.transform) {
      state.transform.enabled = false;
      state.transform.visible = false;
    }
    applyBevelModalAmount(edgeLen * 0.12);
    highlightMeshSelection();
    setStatus(
      "Edge bevel (" +
        profile +
        (profile === "curved" ? ", " + segs + " segs" : "") +
        ") — drag · LMB confirm · Esc cancel",
      "ok"
    );
  }

  /**
   * Vertex bevel: one vertex → one new vert per connected edge, new face fills the hole.
   * Flat = planar face; Curved = verts lifted along average normal for a rounder corner.
   */
  function startBevelVertexModal(sel) {
    var mesh = sel.mesh;
    var geo = prepareEditableGeometry(mesh);
    if (!geo || !geo.index) return;
    var vi = sel.vi;
    var neighbors = getVertexNeighbors(geo, vi);
    if (neighbors.length < 2) {
      setStatus("Vertex needs at least 2 edges to bevel.", "err");
      return;
    }
    neighbors = orderNeighborsAround(mesh, vi, neighbors);
    pushMeshEditUndo(mesh, "Bevel");
    ensureMaterialList(mesh);
    var pos = geo.attributes.position;
    var base = new THREE.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
    var neighborBases = neighbors.map(function (ni) {
      return new THREE.Vector3(pos.getX(ni), pos.getY(ni), pos.getZ(ni));
    });
    var profile = state.bevelProfile || "flat";

    var newVerts = appendCopiedVertices(
      geo,
      neighbors.map(function () {
        return vi;
      })
    );
    var nMap = {};
    neighbors.forEach(function (ni, i) {
      nMap[ni] = newVerts[i];
    });

    var faceMat = getFaceMaterialIndex(geo, sel.faceIndex || 0);
    var oldIndexLen = geo.index.count;
    var indices = Array.from(geo.index.array);
    var faceCount = (indices.length / 3) | 0;
    var f;
    var nAcc = new THREE.Vector3();
    for (f = 0; f < faceCount; f++) {
      var fa0 = indices[f * 3];
      var fb0 = indices[f * 3 + 1];
      var fc0 = indices[f * 3 + 2];
      if (fa0 === vi || fb0 === vi || fc0 === vi) {
        nAcc.add(faceNormalLocal(mesh, fa0, fb0, fc0));
      }
    }
    if (nAcc.lengthSq() < 1e-12) nAcc.set(0, 1, 0);
    nAcc.normalize();

    var extra = [];
    for (f = 0; f < faceCount; f++) {
      var a = indices[f * 3];
      var b = indices[f * 3 + 1];
      var c = indices[f * 3 + 2];
      if (a !== vi && b !== vi && c !== vi) continue;
      var triV = [a, b, c];
      var iVi = triV.indexOf(vi);
      var prev = triV[(iVi + 2) % 3];
      var next = triV[(iVi + 1) % 3];
      var vPrev = nMap[prev];
      var vNext = nMap[next];
      if (vPrev == null || vNext == null) continue;
      var baseI = f * 3;
      indices[baseI] = prev;
      indices[baseI + 1] = next;
      indices[baseI + 2] = vNext;
      extra.push(prev, vNext, vPrev);
    }
    for (var ex = 0; ex < extra.length; ex++) indices.push(extra[ex]);

    if (newVerts.length >= 3) {
      for (var t = 1; t < newVerts.length - 1; t++) {
        var tri = orientTri(geo, newVerts[0], newVerts[t], newVerts[t + 1], nAcc);
        indices.push(tri[0], tri[1], tri[2]);
      }
    }

    geo.setIndex(indices);
    syncGroupsAfterIndexChange(mesh, oldIndexLen, faceMat);
    finalizeMeshEdit(mesh);

    state.meshSel = {
      type: "vertex",
      mesh: mesh,
      vi: newVerts[0],
      faceIndex: sel.faceIndex,
    };
    state.meshSels = [state.meshSel];

    var preSnap = null;
    if (state.undoStack && state.undoStack.length) {
      var u = state.undoStack[state.undoStack.length - 1];
      if (u && u.type === "mesh-geo") preSnap = u;
    }

    state.modal = {
      mode: "bevel-mesh",
      kind: "vertex",
      profile: profile,
      startClient: null,
      mesh: mesh,
      vi: vi,
      newVerts: newVerts,
      neighbors: neighbors,
      base: base,
      neighborBases: neighborBases,
      normal: nAcc.clone(),
      amount: 0.15,
      preSnap: preSnap,
      sel: state.meshSel,
    };
    if (state.orbit) state.orbit.enabled = false;
    if (state.transform) {
      state.transform.enabled = false;
      state.transform.visible = false;
    }
    applyBevelModalAmount(0.15);
    highlightMeshSelection();
    setStatus(
      "Vertex bevel (" +
        profile +
        ", " +
        newVerts.length +
        " edges) — drag · LMB confirm · Esc cancel",
      "ok"
    );
  }

  function applyBevelModalAmount(amount) {
    var m = state.modal;
    if (!m || m.mode !== "bevel-mesh" || !m.mesh) return;
    var pos = m.mesh.geometry.attributes.position;
    var profile = m.profile || state.bevelProfile || "flat";

    if (m.kind === "edge") {
      var maxD = Math.max(0.001, (m.edgeLen || 1) * 0.45);
      amount = Math.max(0.001, Math.min(maxD, amount));
      m.amount = amount;
      var rows = m.rows || m.pairs;
      if (!rows) return;
      // Support legacy pairs shape
      if (m.pairs && !m.rows) {
        m.pairs.forEach(function (pr) {
          var d = pr.dir;
          pos.setXYZ(
            pr.aF,
            m.base0.x + d.x * amount,
            m.base0.y + d.y * amount,
            m.base0.z + d.z * amount
          );
          pos.setXYZ(
            pr.bF,
            m.base1.x + d.x * amount,
            m.base1.y + d.y * amount,
            m.base1.z + d.z * amount
          );
        });
      } else {
        rows.forEach(function (row) {
          var d = row.dir;
          // Flat: full amount on both ends. Curved: same radius along arc dirs (already unit).
          var scale = amount;
          pos.setXYZ(
            row.aF,
            m.base0.x + d.x * scale,
            m.base0.y + d.y * scale,
            m.base0.z + d.z * scale
          );
          pos.setXYZ(
            row.bF,
            m.base1.x + d.x * scale,
            m.base1.y + d.y * scale,
            m.base1.z + d.z * scale
          );
        });
      }
    } else if (m.kind === "vertex") {
      amount = Math.max(0.02, Math.min(0.49, amount));
      m.amount = amount;
      var i;
      for (i = 0; i < m.newVerts.length; i++) {
        var b0 = m.base;
        var b1 = m.neighborBases[i];
        var x = b0.x + (b1.x - b0.x) * amount;
        var y = b0.y + (b1.y - b0.y) * amount;
        var z = b0.z + (b1.z - b0.z) * amount;
        if (profile === "curved" && m.normal) {
          // Bulge along average normal — rounder corner (chord vs flat face)
          var edgeLen = b0.distanceTo(b1) || 1;
          var lift = Math.sin(Math.PI * amount) * edgeLen * amount * 0.55;
          x += m.normal.x * lift;
          y += m.normal.y * lift;
          z += m.normal.z * lift;
        }
        pos.setXYZ(m.newVerts[i], x, y, z);
      }
    }
    pos.needsUpdate = true;
    finalizeMeshEdit(m.mesh);
    highlightMeshSelection();
  }

  function ensureUVAttribute(geo) {
    var n = geo.attributes.position.count;
    if (!geo.attributes.uv || geo.attributes.uv.count !== n) {
      geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    return geo.attributes.uv;
  }

  /** Planar / box / spherical UV unwrap for whole mesh (or selected face verts). */
  function unwrapUVs(mode) {
    var mesh = getEditableMesh(state.selected);
    if (!mesh) {
      setStatus("Select a mesh to unwrap UVs.", "err");
      return;
    }
    var geo = prepareEditableGeometry(mesh);
    if (!geo) return;
    var pos = geo.attributes.position;
    var uv = ensureUVAttribute(geo);
    var n = pos.count;

    // Bounds for normalization
    var min = new THREE.Vector3(Infinity, Infinity, Infinity);
    var max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    var i;
    for (i = 0; i < n; i++) {
      min.x = Math.min(min.x, pos.getX(i));
      min.y = Math.min(min.y, pos.getY(i));
      min.z = Math.min(min.z, pos.getZ(i));
      max.x = Math.max(max.x, pos.getX(i));
      max.y = Math.max(max.y, pos.getY(i));
      max.z = Math.max(max.z, pos.getZ(i));
    }
    var size = new THREE.Vector3().subVectors(max, min);
    size.x = Math.max(size.x, 1e-6);
    size.y = Math.max(size.y, 1e-6);
    size.z = Math.max(size.z, 1e-6);
    var center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);

    // Limit to selected face verts if face selected
    var only = null;
    if (state.meshSel && state.meshSel.mesh === mesh && state.meshSel.type === "face") {
      only = {};
      getSelectedFaceVerts(state.meshSel).forEach(function (vi) {
        only[vi] = 1;
      });
    }

    mode = mode || "planar";
    for (i = 0; i < n; i++) {
      if (only && !only[i]) continue;
      var x = pos.getX(i);
      var y = pos.getY(i);
      var z = pos.getZ(i);
      var u = 0;
      var v = 0;
      if (mode === "box") {
        // Pick dominant axis for this vertex by distance from center
        var dx = Math.abs(x - center.x) / size.x;
        var dy = Math.abs(y - center.y) / size.y;
        var dz = Math.abs(z - center.z) / size.z;
        if (dx >= dy && dx >= dz) {
          u = (z - min.z) / size.z;
          v = (y - min.y) / size.y;
        } else if (dy >= dx && dy >= dz) {
          u = (x - min.x) / size.x;
          v = (z - min.z) / size.z;
        } else {
          u = (x - min.x) / size.x;
          v = (y - min.y) / size.y;
        }
      } else if (mode === "sphere") {
        var dxs = x - center.x;
        var dys = y - center.y;
        var dzs = z - center.z;
        var lon = Math.atan2(dzs, dxs);
        var lat = Math.atan2(dys, Math.sqrt(dxs * dxs + dzs * dzs));
        u = (lon / Math.PI + 1) * 0.5;
        v = lat / Math.PI + 0.5;
      } else {
        // planar: use face normal of selection or XY by default
        var axis = "xy";
        if (state.meshSel && state.meshSel.type === "face" && state.meshSel.mesh === mesh) {
          var fn = faceNormalLocal(mesh, state.meshSel.a, state.meshSel.b, state.meshSel.c);
          var ax = Math.abs(fn.x);
          var ay = Math.abs(fn.y);
          var az = Math.abs(fn.z);
          if (ax >= ay && ax >= az) axis = "yz";
          else if (ay >= ax && ay >= az) axis = "xz";
          else axis = "xy";
        }
        if (axis === "yz") {
          u = (z - min.z) / size.z;
          v = (y - min.y) / size.y;
        } else if (axis === "xz") {
          u = (x - min.x) / size.x;
          v = (z - min.z) / size.z;
        } else {
          u = (x - min.x) / size.x;
          v = (y - min.y) / size.y;
        }
      }
      uv.setXY(i, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
    }
    uv.needsUpdate = true;
    // Ensure material shows UVs if it has a map, else show wireframe check via status
    if (mesh.material && !mesh.material.map) {
      // Checker helper texture so unwrap is visible
      var cnv = document.createElement("canvas");
      cnv.width = 64;
      cnv.height = 64;
      var cx = cnv.getContext("2d");
      for (var yy = 0; yy < 8; yy++) {
        for (var xx = 0; xx < 8; xx++) {
          cx.fillStyle = (xx + yy) % 2 ? "#c8c4d8" : "#3a3a48";
          cx.fillRect(xx * 8, yy * 8, 8, 8);
        }
      }
      var check = new THREE.CanvasTexture(cnv);
      check.wrapS = check.wrapT = THREE.RepeatWrapping;
      check.repeat.set(2, 2);
      var mats = ensureMaterialList(mesh);
      var ai = mesh.userData.activeMaterialIndex || 0;
      var m = mats[ai] || mats[0];
      if (m) {
        mats[ai] = m.clone();
        mats[ai].map = check;
        mats[ai].needsUpdate = true;
        mesh.material = mats;
      }
    }
    setStatus("UV unwrap: " + mode + (only ? " (selected face verts)" : " (whole mesh)") + ".", "ok");
    refreshUvEditor(true);
  }

  /** Switch Studio 3D internal workspace (3D viewport vs UV Editor dock). */
  function setStudioWorkspace(mode) {
    mode = mode === "uv" ? "uv" : "3d";
    state.workspace = mode;
    var ws3d = $("mod-workspace-3d");
    var wsUv = $("mod-workspace-uv");
    var tab3d = $("mod-ws-3d");
    var tabUv = $("mod-ws-uv");
    if (ws3d) {
      ws3d.hidden = mode !== "3d";
      ws3d.classList.toggle("is-active", mode === "3d");
    }
    if (wsUv) {
      wsUv.hidden = mode !== "uv";
      wsUv.classList.toggle("is-active", mode === "uv");
    }
    if (tab3d) {
      tab3d.classList.toggle("is-active", mode === "3d");
      tab3d.setAttribute("aria-selected", mode === "3d" ? "true" : "false");
    }
    if (tabUv) {
      tabUv.classList.toggle("is-active", mode === "uv");
      tabUv.setAttribute("aria-selected", mode === "uv" ? "true" : "false");
    }
    if (mode === "uv") {
      // UV dock owns pointers; still keep 3D render in background when visible is off
      if (state.orbit) state.orbit.enabled = false;
      if (state.transform) {
        state.transform.enabled = false;
        state.transform.visible = false;
      }
      ensureInit();
      resizeUvCanvas();
      refreshUvEditor(true);
      setStatus("UV Editor workspace — project, drag verts, assign image.", "ok");
    } else {
      if (state.orbit) state.orbit.enabled = true;
      if (state.transform && state.selected && !state.editMode) {
        state.transform.enabled = true;
        state.transform.visible = true;
        state.transform.attach(state.selected);
        applyAxisLockToGimbal();
      }
      resize();
      setStatus("3D workspace.", "ok");
    }
    updateHud();
  }

  function getUvMesh() {
    return getEditableMesh(state.selected);
  }

  function applyUvChecker(mesh) {
    if (!mesh) return;
    var cnv = document.createElement("canvas");
    cnv.width = 64;
    cnv.height = 64;
    var cx = cnv.getContext("2d");
    for (var yy = 0; yy < 8; yy++) {
      for (var xx = 0; xx < 8; xx++) {
        cx.fillStyle = (xx + yy) % 2 ? "#c8c4d8" : "#3a3a48";
        cx.fillRect(xx * 8, yy * 8, 8, 8);
      }
    }
    var check = new THREE.CanvasTexture(cnv);
    if ("colorSpace" in check) check.colorSpace = THREE.SRGBColorSpace;
    check.wrapS = check.wrapT = THREE.RepeatWrapping;
    check.repeat.set(2, 2);
    check.needsUpdate = true;
    var mats = ensureMaterialList(mesh);
    var ai = mesh.userData.activeMaterialIndex || 0;
    var m = mats[ai] || mats[0];
    if (!m) return;
    var clone = m.clone();
    if (clone.map && clone.map.dispose) {
      try {
        clone.map.dispose();
      } catch (e) {}
    }
    clone.map = check;
    clone.color.set(0xffffff);
    clone.userData = clone.userData || {};
    clone.userData.fillMode = "image";
    applyMaterialTwoSided(clone);
    clone.needsUpdate = true;
    mats[ai] = clone;
    mesh.material = mats.length > 1 ? mats : clone;
    normalizeMeshMaterials(mesh);
  }

  function packUVsToUnit() {
    var mesh = getUvMesh();
    if (!mesh) {
      setStatus("Select a mesh first.", "err");
      return;
    }
    var geo = prepareEditableGeometry(mesh);
    if (!geo) return;
    pushMeshEditUndo(mesh, "UV pack");
    var uv = ensureUVAttribute(geo);
    var n = uv.count;
    var minU = Infinity;
    var minV = Infinity;
    var maxU = -Infinity;
    var maxV = -Infinity;
    var i;
    for (i = 0; i < n; i++) {
      minU = Math.min(minU, uv.getX(i));
      minV = Math.min(minV, uv.getY(i));
      maxU = Math.max(maxU, uv.getX(i));
      maxV = Math.max(maxV, uv.getY(i));
    }
    var du = Math.max(1e-6, maxU - minU);
    var dv = Math.max(1e-6, maxV - minV);
    for (i = 0; i < n; i++) {
      uv.setXY(i, (uv.getX(i) - minU) / du, (uv.getY(i) - minV) / dv);
    }
    uv.needsUpdate = true;
    setStatus("Packed UVs into 0–1.", "ok");
    refreshUvEditor(true);
  }

  function resizeUvCanvas() {
    var canvas = $("mod-uv-canvas");
    var wrap = $("mod-uv-canvas-wrap");
    if (!canvas || !wrap) return;
    var rect = wrap.getBoundingClientRect();
    var w = Math.max(64, Math.floor(rect.width));
    var h = Math.max(64, Math.floor(rect.height));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    state.uvEditor.dirty = true;
    drawUvEditor();
  }

  /** Map UV (0–1) → canvas pixel (css space). V flipped so 0 is bottom. */
  function uvToCanvas(u, v, cssW, cssH) {
    var ed = state.uvEditor;
    var pad = 40;
    var side = Math.min(cssW, cssH) - pad * 2;
    side = Math.max(80, side) * ed.zoom;
    var ox = cssW * 0.5 + ed.panX - side * 0.5;
    var oy = cssH * 0.5 + ed.panY - side * 0.5;
    return {
      x: ox + u * side,
      y: oy + (1 - v) * side,
      side: side,
      ox: ox,
      oy: oy,
    };
  }

  function canvasToUv(cx, cy, cssW, cssH) {
    var ed = state.uvEditor;
    var pad = 40;
    var side = Math.min(cssW, cssH) - pad * 2;
    side = Math.max(80, side) * ed.zoom;
    var ox = cssW * 0.5 + ed.panX - side * 0.5;
    var oy = cssH * 0.5 + ed.panY - side * 0.5;
    var u = (cx - ox) / side;
    var v = 1 - (cy - oy) / side;
    return { u: u, v: v };
  }

  function drawUvEditor() {
    var canvas = $("mod-uv-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var dpr = canvas.width / (parseFloat(canvas.style.width) || canvas.width) || 1;
    var cssW = canvas.width / dpr;
    var cssH = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Background checker
    var cell = 16;
    for (var gy = 0; gy < cssH; gy += cell) {
      for (var gx = 0; gx < cssW; gx += cell) {
        ctx.fillStyle = ((gx / cell) | 0) + ((gy / cell) | 0) & 1 ? "#1a1a22" : "#14141a";
        ctx.fillRect(gx, gy, cell, cell);
      }
    }

    var origin = uvToCanvas(0, 0, cssW, cssH);
    var corner = uvToCanvas(1, 1, cssW, cssH);
    var x0 = origin.x;
    var y1 = origin.y;
    var x1 = corner.x;
    var y0 = corner.y;
    var side = origin.side;

    // Unit square fill + border
    ctx.fillStyle = "rgba(50, 55, 75, 0.35)";
    ctx.fillRect(x0, y0, side, side);
    ctx.strokeStyle = "rgba(160, 175, 220, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, side, side);

    // Grid 0.1
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    var g;
    for (g = 0; g <= 10; g++) {
      var t = g / 10;
      var p0 = uvToCanvas(t, 0, cssW, cssH);
      var p1 = uvToCanvas(t, 1, cssW, cssH);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      p0 = uvToCanvas(0, t, cssW, cssH);
      p1 = uvToCanvas(1, t, cssW, cssH);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }

    var mesh = getUvMesh();
    var nameEl = $("mod-uv-mesh-name");
    var infoEl = $("mod-uv-info");
    var hud = $("mod-uv-hud");
    if (!mesh || !mesh.geometry) {
      if (nameEl) nameEl.textContent = "None selected";
      if (infoEl) infoEl.textContent = "Select a mesh in the 3D workspace, then return here.";
      if (hud) hud.textContent = "UV 0–1 · no mesh";
      ctx.fillStyle = "rgba(200,198,210,0.55)";
      ctx.font = "13px system-ui,sans-serif";
      ctx.fillText("No mesh selected — pick one in the 3D tab.", 16, 28);
      return;
    }

    var geo = mesh.geometry;
    var uv = ensureUVAttribute(geo);
    var idx = geo.index;
    var triCount = idx ? (idx.count / 3) | 0 : (geo.attributes.position.count / 3) | 0;

    if (nameEl) nameEl.textContent = (state.selected && state.selected.name) || mesh.name || "Mesh";
    if (infoEl) {
      infoEl.textContent =
        uv.count + " UV verts · " + triCount + " tris · zoom " + state.uvEditor.zoom.toFixed(2);
    }
    if (hud) {
      hud.textContent =
        "UV Editor · " +
        ((state.selected && state.selected.name) || "mesh") +
        " · wheel zoom · MMB pan · LMB drag";
    }

    var showSel = $("mod-uv-show-sel");
    var selSet = null;
    if ((!showSel || showSel.checked) && state.meshSel && state.meshSel.mesh === mesh) {
      selSet = {};
      if (state.meshSel.type === "face") {
        getSelectedFaceVerts(state.meshSel).forEach(function (vi) {
          selSet[vi] = 1;
        });
      } else if (state.meshSel.type === "edge") {
        selSet[state.meshSel.e0] = 1;
        selSet[state.meshSel.e1] = 1;
      } else if (state.meshSel.type === "vertex") {
        selSet[state.meshSel.vi] = 1;
      }
    }

    function drawEdge(a, b, selected) {
      var ua = uv.getX(a);
      var va = uv.getY(a);
      var ub = uv.getX(b);
      var vb = uv.getY(b);
      var pa = uvToCanvas(ua, va, cssW, cssH);
      var pb = uvToCanvas(ub, vb, cssW, cssH);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.strokeStyle = selected ? "rgba(255, 200, 80, 0.95)" : "rgba(140, 190, 255, 0.55)";
      ctx.lineWidth = selected ? 2 : 1;
      ctx.stroke();
    }

    var t;
    if (idx) {
      for (t = 0; t < triCount; t++) {
        var a = idx.getX(t * 3);
        var b = idx.getX(t * 3 + 1);
        var c = idx.getX(t * 3 + 2);
        var sel =
          selSet && (selSet[a] || selSet[b] || selSet[c]);
        drawEdge(a, b, sel);
        drawEdge(b, c, sel);
        drawEdge(c, a, sel);
      }
    }

    // Draw verts
    var vi;
    for (vi = 0; vi < uv.count; vi++) {
      var p = uvToCanvas(uv.getX(vi), uv.getY(vi), cssW, cssH);
      var isSel = selSet && selSet[vi];
      ctx.beginPath();
      ctx.arc(p.x, p.y, isSel ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? "#ffcc44" : "#9ec0ff";
      ctx.fill();
    }

    state.uvEditor.dirty = false;
  }

  function refreshUvEditor(force) {
    if (state.workspace !== "uv" && !force) return;
    if (force) state.uvEditor.dirty = true;
    drawUvEditor();
  }

  function hitUvVertex(cssX, cssY) {
    var mesh = getUvMesh();
    if (!mesh || !mesh.geometry) return null;
    var canvas = $("mod-uv-canvas");
    if (!canvas) return null;
    var cssW = parseFloat(canvas.style.width) || canvas.clientWidth;
    var cssH = parseFloat(canvas.style.height) || canvas.clientHeight;
    var uv = ensureUVAttribute(mesh.geometry);
    var best = null;
    var bestD = 10 * 10;
    for (var i = 0; i < uv.count; i++) {
      var p = uvToCanvas(uv.getX(i), uv.getY(i), cssW, cssH);
      var dx = p.x - cssX;
      var dy = p.y - cssY;
      var d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function bindUvEditorUi() {
    var canvas = $("mod-uv-canvas");
    if (!canvas || canvas._uvBound) return;
    canvas._uvBound = true;

    canvas.addEventListener("wheel", function (e) {
      if (state.workspace !== "uv") return;
      e.preventDefault();
      var z = state.uvEditor.zoom * (e.deltaY > 0 ? 0.9 : 1.1);
      state.uvEditor.zoom = Math.max(0.25, Math.min(8, z));
      drawUvEditor();
    }, { passive: false });

    canvas.addEventListener("pointerdown", function (e) {
      if (state.workspace !== "uv") return;
      canvas.setPointerCapture(e.pointerId);
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      state.uvEditor.lastX = x;
      state.uvEditor.lastY = y;
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
        state.uvEditor.panning = true;
        return;
      }
      if (e.button !== 0) return;
      var vi = hitUvVertex(x, y);
      if (vi == null) return;
      var mesh = getUvMesh();
      if (!mesh) return;
      pushMeshEditUndo(mesh, "UV move");
      var uv = ensureUVAttribute(mesh.geometry);
      state.uvEditor.dragging = {
        vi: vi,
        u0: uv.getX(vi),
        v0: uv.getY(vi),
      };
    });

    canvas.addEventListener("pointermove", function (e) {
      if (state.workspace !== "uv") return;
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      var dx = x - state.uvEditor.lastX;
      var dy = y - state.uvEditor.lastY;
      state.uvEditor.lastX = x;
      state.uvEditor.lastY = y;
      if (state.uvEditor.panning) {
        state.uvEditor.panX += dx;
        state.uvEditor.panY += dy;
        drawUvEditor();
        return;
      }
      if (!state.uvEditor.dragging) return;
      var mesh = getUvMesh();
      if (!mesh) return;
      var cssW = parseFloat(canvas.style.width) || canvas.clientWidth;
      var cssH = parseFloat(canvas.style.height) || canvas.clientHeight;
      var uvCoord = canvasToUv(x, y, cssW, cssH);
      var u = uvCoord.u;
      var v = uvCoord.v;
      var snapEl = $("mod-uv-snap");
      if (snapEl && snapEl.checked) {
        u = Math.round(u / 0.05) * 0.05;
        v = Math.round(v / 0.05) * 0.05;
      }
      var uv = mesh.geometry.attributes.uv;
      uv.setXY(state.uvEditor.dragging.vi, u, v);
      uv.needsUpdate = true;
      drawUvEditor();
    });

    function endUvPointer(e) {
      state.uvEditor.panning = false;
      state.uvEditor.dragging = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
    canvas.addEventListener("pointerup", endUvPointer);
    canvas.addEventListener("pointercancel", endUvPointer);
    canvas.addEventListener("contextmenu", function (e) {
      if (state.workspace === "uv") e.preventDefault();
    });
  }

  function captureViewportScreenshot() {
    if (!state.renderer || !state.scene || !state.camera) return null;
    // Hide edit hilites for clean shot
    var hiliteVis = [];
    if (state.meshHilites && state.meshHilites.length) {
      state.meshHilites.forEach(function (h) {
        hiliteVis.push(h.visible);
        h.visible = false;
      });
    } else if (state.meshHilite) {
      hiliteVis.push(state.meshHilite.visible);
      state.meshHilite.visible = false;
    }
    var tfVis = state.transform ? state.transform.visible : null;
    if (state.transform) state.transform.visible = false;
    state.renderer.render(state.scene, state.camera);
    if (state.cssRenderer && state.cssScene) {
      try {
        state.cssRenderer.render(state.cssScene, state.camera);
      } catch (e) {}
    }
    var dataUrl = null;
    try {
      dataUrl = state.renderer.domElement.toDataURL("image/png");
    } catch (e2) {
      dataUrl = null;
    }
    if (state.meshHilites && state.meshHilites.length && hiliteVis.length) {
      state.meshHilites.forEach(function (h, i) {
        if (hiliteVis[i] != null) h.visible = hiliteVis[i];
      });
    } else if (state.meshHilite && hiliteVis.length) {
      state.meshHilite.visible = hiliteVis[0];
    }
    if (state.transform && tfVis != null) state.transform.visible = tfVis;
    return dataUrl;
  }

  function compressDataUrl(dataUrl, maxSide, quality) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        var scale = Math.min(1, (maxSide || 1024) / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        var c = document.createElement("canvas");
        c.width = cw;
        c.height = ch;
        var ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, cw, ch);
        resolve(c.toDataURL("image/jpeg", quality != null ? quality : 0.85));
      };
      img.onerror = function () {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  function screenshotToPrompt() {
    var dataUrl = captureViewportScreenshot();
    if (!dataUrl) {
      setStatus("Could not capture viewport.", "err");
      return;
    }
    state.shotDataUrl = dataUrl;
    var prev = $("mod-shot-preview");
    if (prev) {
      prev.src = dataUrl;
      prev.hidden = false;
    }
    var ta = $("mod-shot-text");
    if (ta) ta.value = "Reading screenshot…";
    setStatus("Screenshot captured — writing generation prompt…", "ok");
    compressDataUrl(dataUrl, 896, 0.82)
      .then(function (compressed) {
        return fetch("/api/analyze-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: compressed,
            mode: "generation_prompt",
            emphasis: "Studio 3D viewport still — describe as a finished image to regenerate.",
          }),
          cache: "no-store",
        });
      })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Analyze failed (" + r.status + ")");
          return d;
        });
      })
      .then(function (d) {
        var analysis = d && d.analysis;
        var prompt =
          (analysis && (analysis.prompt || analysis.description)) ||
          (typeof analysis === "string" ? analysis : "") ||
          "";
        if (!prompt && analysis) {
          prompt = [analysis.title, analysis.description, analysis.style, analysis.mood]
            .filter(Boolean)
            .join(". ");
        }
        if (!prompt) throw new Error("No prompt returned from analysis.");
        if (ta) ta.value = prompt;
        setStatus("Prompt ready — edit if you like, then Generate from prompt.", "ok");
      })
      .catch(function (err) {
        if (ta) ta.value = "";
        setStatus((err && err.message) || "Screenshot → prompt failed.", "err");
      });
  }

  function generateFromShotPrompt() {
    var ta = $("mod-shot-text");
    var prompt = (ta && ta.value.trim()) || "";
    if (!prompt) {
      setStatus("No prompt yet — run Screenshot → prompt first.", "err");
      return;
    }
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "mod-" + Date.now();
    setStatus("Generating from prompt…", "ok");
    var body = {
      job_id: jobId,
      stasis: prompt,
      fused_prompt: prompt,
      aspect_ratio: "1:1",
      spells: [],
      buzz_words: [],
      source: "studio-3d-screenshot",
    };
    if (state.shotDataUrl) {
      body.reference_image = state.shotDataUrl;
      body.spell_reference_image = state.shotDataUrl;
      body.spell_cast = true;
    }
    fetch("/api/generate-stasis-vision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { r: r, d: d };
        });
      })
      .then(function (pack) {
        var r = pack.r;
        var d = pack.d;
        if (r.status === 202 || (d && (d.status === "queued" || d.status === "pending"))) {
          var id = (d && d.job_id) || jobId;
          setStatus("Queued generation — polling…", "ok");
          return pollStudioGenJob(id, 90);
        }
        if (!r.ok) {
          throw new Error(
            (d && d.error && (d.error.message || d.error)) || "Generate failed (" + r.status + ")"
          );
        }
        var img = d.image || (d.images && d.images[0]);
        if (img && img.url) return img.url;
        if (d && d.job_id) return pollStudioGenJob(d.job_id, 90);
        throw new Error("No image returned.");
      })
      .then(function (url) {
        if (!url) throw new Error("No image URL.");
        // Apply as a new textured plane in the scene
        var loader = new THREE.TextureLoader();
        loader.setCrossOrigin("anonymous");
        return new Promise(function (resolve, reject) {
          // Prefer absolute URL
          var abs = url;
          try {
            abs = new URL(url, location.href).href;
          } catch (e) {}
          loadPrintImageElement(abs)
            .then(function (loaded) {
              var tex = printImageToTexture(loaded.img);
              var plane = new THREE.Mesh(
                new THREE.PlaneGeometry(1.4, 1.4),
                new THREE.MeshBasicMaterial({
                  map: tex,
                  side: THREE.DoubleSide,
                  toneMapped: false,
                })
              );
              plane.name = nextName("GenShot");
              plane.userData.studioType = "generated-shot";
              plane.userData.studioId = state.objectId;
              plane.position.set(0, 0.8, 1.2);
              state.scene.add(plane);
              state.objects.push(plane);
              selectObject(plane);
              renderOutliner();
              setStatus("Generated image added as “" + plane.name + "”.", "ok");
              // Also queue 3D printers if any
              enqueuePrintJob(abs, { stasis: prompt.slice(0, 400), source: "studio-shot" });
              resolve(url);
            })
            .catch(function () {
              // Still ok if texture load fails — open URL in status
              setStatus("Generated: " + abs + " (could not load into scene).", "ok");
              resolve(url);
            });
        });
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Generate failed.", "err");
      });
  }

  function pollStudioGenJob(jobId, attemptsLeft) {
    if (attemptsLeft == null) attemptsLeft = 80;
    return fetch("/api/jobs/" + encodeURIComponent(jobId), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("Job status HTTP " + r.status);
        return r.json();
      })
      .then(function (job) {
        var st = String((job && job.status) || "");
        if (st === "done" || st === "completed" || st === "success") {
          if (job.images && job.images[0] && job.images[0].url) return job.images[0].url;
          if (job.image && job.image.url) return job.image.url;
          throw new Error("Job done but no image.");
        }
        if (st === "failed" || st === "error") {
          var err = job.error;
          throw new Error(
            (err && err.message) || (typeof err === "string" ? err : "Generate failed")
          );
        }
        if (attemptsLeft <= 0) throw new Error("Timed out waiting for generation.");
        setStatus("Generating… (" + st + ")", "ok");
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(pollStudioGenJob(jobId, attemptsLeft - 1));
          }, 2000);
        });
      });
  }

  function nudgeMeshSelection() {
    var sels = getAllMeshSels();
    if (!sels.length || !sels[0].mesh) {
      setStatus("Select a face, edge, or vertex first.", "err");
      return;
    }
    var amount = getEditAmount();
    var mesh = sels[0].mesh;
    var geo = prepareEditableGeometry(mesh);
    pushMeshEditUndo(mesh, "Nudge");
    var pos = geo.attributes.position;
    var delta = new THREE.Vector3(0, 0, 0);
    var threeAx = userAxisToThree(state.axisLock);
    var sel = state.meshSel || sels[0];
    if (threeAx === "x") delta.x = amount;
    else if (threeAx === "y") delta.y = amount;
    else if (threeAx === "z") delta.z = amount;
    else {
      if (sel.type === "face") {
        delta.copy(faceNormalLocal(mesh, sel.a, sel.b, sel.c)).multiplyScalar(amount);
      } else {
        delta.y = amount;
      }
    }
    getSelectedVertIndices().forEach(function (vi) {
      pos.setXYZ(vi, pos.getX(vi) + delta.x, pos.getY(vi) + delta.y, pos.getZ(vi) + delta.z);
    });
    pos.needsUpdate = true;
    repairMeshNormals(mesh);
    highlightMeshSelection();
    setStatus("Nudged selection.", "ok");
  }

  function setAxisLock(axis) {
    // axis is user-facing (Blender labels on buttons)
    if (axis === state.axisLock) state.axisLock = null;
    else state.axisLock = axis;
    document.querySelectorAll("#panel-modeler .mod-axis-btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-axis") === state.axisLock);
    });
    applyAxisLockToGimbal();
    // If modal active, constrain immediately
    if (state.modal) state.modal.axis = state.axisLock;
    setStatus(
      state.axisLock
        ? "Axis lock: " +
            state.axisLock.toUpperCase() +
            " (Blender · Three " +
            (userAxisToThree(state.axisLock) || "").toUpperCase() +
            ")"
        : "Axis lock: free",
      "ok"
    );
    updateHud();
  }

  function applyAxisLockToGimbal() {
    if (!state.transform) return;
    // Buttons labeled Blender Y/Z → show Three Z/Y
    var a = userAxisToThree(state.axisLock);
    state.transform.showX = !a || a === "x";
    state.transform.showY = !a || a === "y";
    state.transform.showZ = !a || a === "z";
  }

  function readNumericFromSelection() {
    var obj = state.selected;
    if (!obj) return;
    var e;
    // Fields show Blender axes: Y = Three Z, Z = Three Y
    e = $("mod-num-px");
    if (e) e.value = obj.position.x.toFixed(3);
    e = $("mod-num-py");
    if (e) e.value = obj.position.z.toFixed(3);
    e = $("mod-num-pz");
    if (e) e.value = obj.position.y.toFixed(3);
    e = $("mod-num-rx");
    if (e) e.value = THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(1);
    e = $("mod-num-ry");
    if (e) e.value = THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(1);
    e = $("mod-num-rz");
    if (e) e.value = THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(1);
    e = $("mod-num-sx");
    if (e) e.value = obj.scale.x.toFixed(3);
    e = $("mod-num-sy");
    if (e) e.value = obj.scale.z.toFixed(3);
    e = $("mod-num-sz");
    if (e) e.value = obj.scale.y.toFixed(3);
  }

  function applyNumericToSelection() {
    var obj = state.selected;
    if (!obj) {
      setStatus("Nothing selected.", "err");
      return;
    }
    // Mesh component nudge when in edit mode with selection
    if (state.editMode && getAllMeshSels().length) {
      nudgeMeshSelection();
      return;
    }
    pushTransformUndo(obj, "Numeric transform");
    function num(id, fallback) {
      var el = $(id);
      var v = el ? parseFloat(el.value) : NaN;
      return isFinite(v) ? v : fallback;
    }
    var px = num("mod-num-px", obj.position.x);
    var py = num("mod-num-py", obj.position.y);
    var pz = num("mod-num-pz", obj.position.z);
    // Numeric fields labeled Blender-style: Y=depth(Three Z), Z=up(Three Y)
    var threePos = {
      x: num("mod-num-px", obj.position.x),
      y: num("mod-num-pz", obj.position.y), // field Z → Three Y
      z: num("mod-num-py", obj.position.z), // field Y → Three Z
    };
    var ax = userAxisToThree(state.axisLock);
    if (ax === "x") obj.position.x = threePos.x;
    else if (ax === "y") obj.position.y = threePos.y;
    else if (ax === "z") obj.position.z = threePos.z;
    else obj.position.set(threePos.x, threePos.y, threePos.z);

    var rx = THREE.MathUtils.degToRad(num("mod-num-rx", THREE.MathUtils.radToDeg(obj.rotation.x)));
    var rUserY = THREE.MathUtils.degToRad(num("mod-num-ry", THREE.MathUtils.radToDeg(obj.rotation.z)));
    var rUserZ = THREE.MathUtils.degToRad(num("mod-num-rz", THREE.MathUtils.radToDeg(obj.rotation.y)));
    if (ax === "x") obj.rotation.x = rx;
    else if (ax === "y") obj.rotation.y = rUserZ;
    else if (ax === "z") obj.rotation.z = rUserY;
    else obj.rotation.set(rx, rUserZ, rUserY);

    var sx = num("mod-num-sx", obj.scale.x);
    var sUserY = num("mod-num-sy", obj.scale.z);
    var sUserZ = num("mod-num-sz", obj.scale.y);
    if (ax === "x") obj.scale.x = sx;
    else if (ax === "y") obj.scale.z = sUserY;
    else if (ax === "z") obj.scale.y = sUserZ;
    else obj.scale.set(sx, sUserZ, sUserY);

    setStatus("Applied numeric transform.", "ok");
    updateHud();
  }

  function setTool(tool) {
    // Map legacy face/edge/vertex tools → edit mode + select mode
    if (tool === "face" || tool === "edge" || tool === "vertex") {
      setSelectMode(tool);
      return;
    }
    state.tool = tool;
    document.querySelectorAll("#panel-modeler .mod-tool-btn").forEach(function (btn) {
      var t = btn.getAttribute("data-tool");
      if (t === "face" || t === "edge" || t === "vertex") return;
      btn.classList.toggle("is-active", t === tool);
    });
    if (state.editMode) {
      // Stay in edit mode; object G/R/S still available via modal
      if (state.transform) {
        state.transform.detach();
        state.transform.visible = false;
        state.transform.enabled = false;
      }
    } else {
      clearMeshSelection();
      if (state.transform) {
        state.transform.enabled = true;
        state.transform.visible = !!state.selected;
        if (state.selected) {
          state.transform.attach(state.selected);
          state.transform.setMode(
            tool === "rotate" ? "rotate" : tool === "scale" ? "scale" : "translate"
          );
          state.transform.setSize(
            state.selected.userData && state.selected.userData.isSpellforgePlane ? 1.25 : 0.9
          );
        }
      }
      applyAxisLockToGimbal();
    }
    if (tool === "select") state.sfInteract = true;
    refreshSpellforgePointerMode();
    updateHud();
  }

  function focusSelected() {
    if (!state.selected || !state.orbit || !state.camera) return;
    var box = new THREE.Box3().setFromObject(state.selected);
    var center = box.getCenter(new THREE.Vector3());
    var size = box.getSize(new THREE.Vector3());
    var max = Math.max(size.x, size.y, size.z, 0.5);
    state.orbit.target.copy(center);
    state.camera.position.set(
      center.x + max * 2.2,
      center.y + max * 1.6,
      center.z + max * 2.2
    );
    state.orbit.update();
  }

  function setView(preset) {
    if (!state.camera || !state.orbit) return;
    var t = state.orbit.target.clone();
    var d = state.camera.position.distanceTo(t) || 6;
    if (preset === "front") state.camera.position.set(t.x, t.y, t.z + d);
    else if (preset === "top") state.camera.position.set(t.x, t.y + d, t.z + 0.01);
    else if (preset === "right") state.camera.position.set(t.x + d, t.y, t.z);
    else if (preset === "persp")
      state.camera.position.set(t.x + d * 0.7, t.y + d * 0.55, t.z + d * 0.7);
    state.camera.lookAt(t);
    state.orbit.update();
  }

  function clearScene() {
    ensureInit();
    state.objects.slice().forEach(function (obj) {
      state.scene.remove(obj);
      disposeObject(obj);
    });
    state.objects = [];
    if (state.transform) state.transform.detach();
    selectObject(null);
    setStatus("Scene cleared.", "ok");
  }

  function exportGlb() {
    if (!state.scene || !state.objects.length) {
      setStatus("Add objects before export.", "err");
      return;
    }
    var exporter = new GLTFExporter();
    var root = new THREE.Group();
    root.name = "StudioExport";
    var count = 0;
    state.objects.forEach(function (o) {
      // Export mesh proxies only (iframe UI is not mesh data)
      if (o.userData && o.userData.isSpellforgePlane) {
        var proxy = new THREE.Mesh(
          new THREE.PlaneGeometry(SF_PLANE_W, SF_PLANE_H),
          new THREE.MeshStandardMaterial({ color: 0x222633, metalness: 0.4, roughness: 0.45 })
        );
        proxy.name = o.name || "SpellforgePlane";
        proxy.position.copy(o.position);
        proxy.quaternion.copy(o.quaternion);
        proxy.scale.copy(o.scale);
        root.add(proxy);
        count++;
        return;
      }
      root.add(o.clone(true));
      count++;
    });
    if (!count) {
      setStatus("Nothing to export.", "err");
      return;
    }
    exporter.parse(
      root,
      function (result) {
        var blob =
          result instanceof ArrayBuffer
            ? new Blob([result], { type: "model/gltf-binary" })
            : new Blob([JSON.stringify(result)], { type: "model/gltf+json" });
        var ext = result instanceof ArrayBuffer ? "glb" : "gltf";
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "studio-model." + ext;
        a.click();
        URL.revokeObjectURL(a.href);
        setStatus("Exported studio-model." + ext, "ok");
      },
      function (err) {
        setStatus((err && err.message) || "Export failed", "err");
      },
      { binary: true }
    );
  }

  function renderOutliner() {
    var box = $("mod-outliner");
    if (!box) return;
    box.innerHTML = "";
    if (!state.objects.length) {
      box.innerHTML = '<div class="mod-outliner-empty">No objects — add a mesh.</div>';
      return;
    }
    state.objects.forEach(function (obj) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "mod-outliner-item" + (obj === state.selected ? " is-selected" : "");
      btn.textContent = obj.name || "mesh";
      btn.addEventListener("click", function () {
        selectObject(obj);
      });
      box.appendChild(btn);
    });
  }

  function findMeshMaterial(obj) {
    if (!obj) return null;
    var mesh = getEditableMesh(obj) || (obj.isMesh ? obj : null);
    if (mesh && mesh.material) {
      if (Array.isArray(mesh.material)) {
        var idx = mesh.userData.activeMaterialIndex || 0;
        return mesh.material[idx] || mesh.material[0];
      }
      return mesh.material;
    }
    var found = null;
    obj.traverse(function (child) {
      if (found) return;
      if (child.isMesh && child.material) {
        found = Array.isArray(child.material) ? child.material[0] : child.material;
      }
    });
    return found;
  }

  function refreshMaterialSlotSelect(mesh) {
    var sel = $("mod-mat-slot");
    if (!sel || !mesh) return;
    var mats = ensureMaterialList(mesh);
    var active = mesh.userData.activeMaterialIndex || 0;
    if (active >= mats.length) active = 0;
    mesh.userData.activeMaterialIndex = active;
    sel.innerHTML = "";
    mats.forEach(function (m, i) {
      var opt = document.createElement("option");
      opt.value = String(i);
      var mode = getMaterialFillMode(m);
      var label;
      if (mode === "image") {
        label = "Mat " + i + " (image)";
      } else {
        var hex = m && m.color ? "#" + m.color.getHexString() : "#888";
        var op =
          m && m.opacity != null && m.opacity < 0.999
            ? " " + Math.round(m.opacity * 100) + "%"
            : "";
        label = "Mat " + i + " (" + hex + op + ")";
      }
      opt.textContent = label;
      if (i === active) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function addMaterialSlot() {
    var mesh = getEditableMesh(state.selected);
    if (!mesh) {
      setStatus("Select a mesh to add a material.", "err");
      return;
    }
    // Promote to multi-material array
    var existing = ensureMaterialList(mesh);
    var mats = existing.slice();
    var colorEl = $("mod-prop-color");
    var col = colorEl ? colorEl.value : "#8a90a8";
    var m = defaultMaterial();
    m.color.set(col);
    m.opacity = 1;
    m.transparent = false;
    var metalEl = $("mod-prop-metal");
    var roughEl = $("mod-prop-rough");
    if (metalEl) m.metalness = parseFloat(metalEl.value) || 0.15;
    if (roughEl) m.roughness = parseFloat(roughEl.value) || 0.55;
    mats.push(m);
    mesh.material = mats;
    mesh.userData.activeMaterialIndex = mats.length - 1;
    // Every face keeps mat 0 until assigned; full coverage groups
    var geo = mesh.geometry;
    if (geo && geo.index) {
      geo.clearGroups();
      geo.addGroup(0, geo.index.count, 0);
    }
    normalizeMeshMaterials(mesh);
    refreshMaterialSlotSelect(mesh);
    syncPropsFromSelection();
    setStatus("Added material slot " + (mats.length - 1) + ". Assign to selected faces.", "ok");
  }

  function setActiveMaterialSlot(idx) {
    var mesh = getEditableMesh(state.selected);
    if (!mesh) return;
    var mats = ensureMaterialList(mesh);
    idx = Math.max(0, Math.min(mats.length - 1, idx | 0));
    mesh.userData.activeMaterialIndex = idx;
    syncPropsFromSelection();
  }

  /** Paint selected face(s) with the active material slot. */
  function assignMaterialToSelectedFace() {
    var mesh = getEditableMesh(state.selected);
    if (!mesh) {
      setStatus("Select a mesh.", "err");
      return;
    }
    var sel = state.meshSel;
    if (!sel || sel.type !== "face" || sel.mesh !== mesh) {
      setStatus("Select a face in Edit Mode, then Assign material.", "err");
      return;
    }
    prepareEditableGeometry(mesh);
    var geo = mesh.geometry;
    // Need multi-mat array
    var mats = ensureMaterialList(mesh).slice();
    if (mats.length < 2) {
      setStatus("Add a second material (+ Material) first, then assign.", "err");
      return;
    }
    mesh.material = mats;
    var matIdx = mesh.userData.activeMaterialIndex || 0;
    if (matIdx >= mats.length) matIdx = 0;
    var faceTris = sel.quadTris ? sel.quadTris.slice() : [sel.faceIndex];
    var triCount = geo.index.count / 3;
    var oldGroups = geo.groups ? geo.groups.slice() : [];
    function matAt(faceIdx) {
      var s = faceIdx * 3;
      for (var g = 0; g < oldGroups.length; g++) {
        var gr = oldGroups[g];
        if (s >= gr.start && s < gr.start + gr.count) return gr.materialIndex || 0;
      }
      return 0;
    }
    var triMat = new Array(triCount);
    for (var t = 0; t < triCount; t++) triMat[t] = matAt(t);
    faceTris.forEach(function (f) {
      if (f >= 0 && f < triCount) triMat[f] = matIdx;
    });
    // Full coverage — every triangle has a color/material
    geo.clearGroups();
    var runStart = 0;
    var runMat = triMat[0];
    for (var t2 = 1; t2 <= triCount; t2++) {
      if (t2 === triCount || triMat[t2] !== runMat) {
        geo.addGroup(runStart * 3, (t2 - runStart) * 3, runMat);
        if (t2 < triCount) {
          runStart = t2;
          runMat = triMat[t2];
        }
      }
    }
    mats.forEach(function (m) {
      if (m) {
        if (m.opacity >= 0.999) {
          m.opacity = 1;
          m.transparent = false;
        }
        m.needsUpdate = true;
      }
    });
    setStatus("Assigned material " + matIdx + " to face (all faces still painted).", "ok");
  }

  function syncPropsFromSelection() {
    var nameEl = $("mod-prop-name");
    var colorEl = $("mod-prop-color");
    var metalEl = $("mod-prop-metal");
    var roughEl = $("mod-prop-rough");
    var wireEl = $("mod-prop-wire");
    var opacityEl = $("mod-prop-opacity");
    var opacityVal = $("mod-prop-opacity-val");
    var colorRadio = $("mod-mat-mode-color");
    var imageRadio = $("mod-mat-mode-image");
    var imageFile = $("mod-prop-image");
    var imageClear = $("mod-prop-image-clear");
    var obj = state.selected;
    var isSf = obj && obj.userData && obj.userData.isSpellforgePlane;
    var disabled = !obj;
    if (nameEl) nameEl.disabled = disabled;
    [colorEl, metalEl, roughEl, wireEl, opacityEl, colorRadio, imageRadio, imageFile, imageClear].forEach(
      function (el) {
        if (el) el.disabled = disabled || isSf;
      }
    );
    if (!obj) {
      if (nameEl) nameEl.value = "";
      updateMaterialImagePreview("");
      return;
    }
    if (nameEl) nameEl.value = obj.name || "";
    if (isSf) return;
    var mesh = getEditableMesh(obj);
    if (mesh) refreshMaterialSlotSelect(mesh);
    var mat = findMeshMaterial(obj);
    if (mat) {
      if (mat.color && colorEl) colorEl.value = "#" + mat.color.getHexString();
      if (metalEl) metalEl.value = String(mat.metalness != null ? mat.metalness : 0.15);
      if (roughEl) roughEl.value = String(mat.roughness != null ? mat.roughness : 0.55);
      if (wireEl) wireEl.checked = !!mat.wireframe;
      var op = mat.opacity != null ? mat.opacity : 1;
      if (opacityEl) opacityEl.value = String(op);
      if (opacityVal) opacityVal.textContent = Math.round(op * 100) + "%";
      syncMaterialFillUi(mat);
    }
  }

  function applyPropsToSelection() {
    var obj = state.selected;
    if (!obj) return;
    var nameEl = $("mod-prop-name");
    var colorEl = $("mod-prop-color");
    var metalEl = $("mod-prop-metal");
    var roughEl = $("mod-prop-rough");
    var wireEl = $("mod-prop-wire");
    var opacityEl = $("mod-prop-opacity");
    var opacityVal = $("mod-prop-opacity-val");
    if (nameEl && nameEl.value.trim()) {
      obj.name = nameEl.value.trim().slice(0, 48);
      renderOutliner();
    }
    if (obj.userData && obj.userData.isSpellforgePlane) return;
    var mesh = getEditableMesh(obj) || obj;
    if (mesh && mesh.isMesh) ensureMaterialList(mesh);
    var mat = findMeshMaterial(obj);
    if (!mat) return;
    var mode = getMaterialFillMode(mat);
    if (mode === "color" && mat.color && colorEl) {
      mat.color.set(colorEl.value);
    }
    if (metalEl) mat.metalness = parseFloat(metalEl.value) || 0;
    if (roughEl) mat.roughness = parseFloat(roughEl.value) || 0;
    if (wireEl) mat.wireframe = !!wireEl.checked;
    if (opacityEl) {
      applyMaterialOpacity(mat, parseFloat(opacityEl.value));
      if (opacityVal) opacityVal.textContent = Math.round((mat.opacity || 0) * 100) + "%";
    }
    applyMaterialTwoSided(mat);
    mat.needsUpdate = true;
    if (mesh && mesh.isMesh) refreshMaterialSlotSelect(mesh);
  }

  function onMaterialModeChange() {
    var obj = state.selected;
    if (!obj || (obj.userData && obj.userData.isSpellforgePlane)) return;
    var mesh = getEditableMesh(obj);
    var mat = findMeshMaterial(obj);
    if (!mat) return;
    var imageRadio = $("mod-mat-mode-image");
    var mode = imageRadio && imageRadio.checked ? "image" : "color";
    setMaterialFillMode(mat, mode, mesh);
    if (mode === "color") {
      var colorEl = $("mod-prop-color");
      if (colorEl && mat.color) mat.color.set(colorEl.value);
      updateMaterialImagePreview("");
      setStatus("Material fill: solid color.", "ok");
    } else {
      setStatus("Material fill: image — choose a file.", "ok");
    }
    syncMaterialFillUi(mat);
    if (mesh) refreshMaterialSlotSelect(mesh);
  }

  function onMaterialImagePicked(event) {
    var file = event && event.target && event.target.files && event.target.files[0];
    if (!file) return;
    var obj = state.selected;
    if (!obj) return;
    var mesh = getEditableMesh(obj);
    var mat = findMeshMaterial(obj);
    if (!mat) return;
    setMaterialFillMode(mat, "image", mesh);
    loadMaterialImageFromFile(file, mat, mesh);
    // allow re-picking same file later
    event.target.value = "";
  }

  function onMaterialImageClear() {
    var obj = state.selected;
    if (!obj) return;
    var mesh = getEditableMesh(obj);
    var mat = findMeshMaterial(obj);
    if (!mat) return;
    disposeMaterialMap(mat);
    mat.userData = mat.userData || {};
    mat.userData.imageDataUrl = "";
    mat.userData.fillMode = "image";
    updateMaterialImagePreview("");
    setStatus("Image cleared — pick another or switch to Color.", "ok");
    if (mesh) refreshMaterialSlotSelect(mesh);
  }

  function updateHud() {
    var el = $("mod-hud");
    if (!el) return;
    var sel = state.selected ? state.selected.name : "none";
    var sf =
      state.selected && state.selected.userData && state.selected.userData.isSpellforgePlane
        ? " · Spellforge plane"
        : "";
    var occl = "";
    if (
      state.selected &&
      state.selected.userData &&
      state.selected.userData.isSpellforgePlane &&
      state.selected.userData.occluded
    ) {
      occl = " · occluded";
    }
    el.textContent =
      (state.editMode ? "EDIT · " + state.selectMode : "Object · " + state.tool) +
      " · " +
      sel +
      sf +
      occl +
      " · n=" +
      state.objects.length +
      " · Axis " +
      (state.axisLock || "free") +
      " · Tab edit · G/R/S · E drag";
  }

  function resolveSelectable(obj) {
    var cur = obj;
    while (cur) {
      if (state.objects.indexOf(cur) >= 0) return cur;
      cur = cur.parent;
    }
    return null;
  }

  function startMeshGrabModal() {
    var mesh = getEditableMesh(state.selected);
    if (!mesh) {
      setStatus("No editable mesh.", "err");
      return;
    }
    var verts = getSelectedVertIndices();
    if (!verts.length) {
      setStatus("Select a face, edge, or vertex, then G.", "err");
      return;
    }
    var geo = prepareEditableGeometry(mesh);
    pushMeshEditUndo(mesh, "Move");
    var pos = geo.attributes.position;
    var basePos = verts.map(function (vi) {
      return new THREE.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
    });
    var centroid = new THREE.Vector3();
    basePos.forEach(function (p) {
      centroid.add(p);
    });
    centroid.multiplyScalar(1 / basePos.length);
    state.modal = {
      mode: "g-mesh",
      axis: state.axisLock,
      startClient: null,
      mesh: mesh,
      verts: verts,
      basePos: basePos,
      centroid: centroid,
    };
    if (state.transform) {
      state.transform.enabled = false;
      state.transform.visible = false;
    }
    if (state.orbit) state.orbit.enabled = false;
    setStatus(
      "Move selection (" +
        verts.length +
        " verts) — mouse · X/Y/Z · LMB confirm · Esc cancel",
      "ok"
    );
  }

  function applyMeshGrabDelta(dx, dy) {
    var m = state.modal;
    if (!m || m.mode !== "g-mesh" || !m.mesh) return;
    var mesh = m.mesh;
    var geo = mesh.geometry;
    var pos = geo.attributes.position;
    var sens = 0.01;
    var threeAx = userAxisToThree(m.axis);
    var dLocal = new THREE.Vector3();
    if (!threeAx) {
      var right = new THREE.Vector3();
      var up = new THREE.Vector3();
      right.setFromMatrixColumn(state.camera.matrixWorld, 0).normalize();
      up.setFromMatrixColumn(state.camera.matrixWorld, 1).normalize();
      var dWorld = right.multiplyScalar(dx * sens).add(up.multiplyScalar(-dy * sens));
      dLocal = worldDirToLocal(mesh, dWorld);
    } else {
      var axis = new THREE.Vector3(
        threeAx === "x" ? 1 : 0,
        threeAx === "y" ? 1 : 0,
        threeAx === "z" ? 1 : 0
      );
      var origin = m.centroid.clone();
      mesh.localToWorld(origin);
      var axisW = axis.clone().transformDirection(mesh.matrixWorld).normalize();
      var s0 = origin.clone().project(state.camera);
      var s1 = origin.clone().add(axisW).project(state.camera);
      var sdx = s1.x - s0.x;
      var sdy = s1.y - s0.y;
      var mag = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
      var along = (dx * sdx + -dy * sdy) / mag;
      dLocal.copy(axis).multiplyScalar(along * sens * 2.5);
    }
    m.verts.forEach(function (vi, i) {
      var b = m.basePos[i];
      pos.setXYZ(vi, b.x + dLocal.x, b.y + dLocal.y, b.z + dLocal.z);
    });
    pos.needsUpdate = true;
    repairMeshNormals(mesh);
    highlightMeshSelection();
  }

  function startModal(mode) {
    if (!state.selected) {
      setStatus("Nothing selected.", "err");
      return;
    }
    if (state.transform && state.transform.dragging) return;
    // Edit Mode G: move only selected components (verts of faces/edges/verts)
    if (state.editMode && mode === "g" && getAllMeshSels().length) {
      startMeshGrabModal();
      return;
    }
    pushTransformUndo(state.selected, mode === "g" ? "Move" : mode === "r" ? "Rotate" : "Scale");
    state.modal = {
      mode: mode,
      axis: state.axisLock,
      startClient: null,
      origPos: state.selected.position.clone(),
      origQuat: state.selected.quaternion.clone(),
      origScale: state.selected.scale.clone(),
      origEuler: state.selected.rotation.clone(),
    };
    if (state.transform) {
      state.transform.enabled = false;
      state.transform.visible = false;
    }
    if (state.orbit) state.orbit.enabled = false;
    var label = mode === "g" ? "Move" : mode === "r" ? "Rotate" : "Scale";
    setStatus(
      label +
        " — mouse to adjust · X/Y/Z constrain (Blender axes) · LMB confirm · RMB/Esc cancel",
      "ok"
    );
  }

  function cancelModal() {
    if (!state.modal) return;
    var m = state.modal;
    if (m.mode === "extrude-mesh") {
      if (m.preSnap) {
        restoreMeshGeometry(m.preSnap);
        if (m.mesh) finalizeMeshEdit(m.mesh);
      } else {
        applyExtrudeModalDepth(0);
        if (m.mesh) finalizeMeshEdit(m.mesh);
      }
      if (state.undoStack && state.undoStack.length) {
        var topE = state.undoStack[state.undoStack.length - 1];
        if (topE && topE.type === "mesh-geo" && topE.label === "Extrude") state.undoStack.pop();
      }
      state.modal = null;
      if (state.orbit) state.orbit.enabled = true;
      setStatus("Extrude cancelled.", "ok");
      updateHud();
      return;
    }
    if (m.mode === "inset-mesh") {
      if (m.preSnap) {
        restoreMeshGeometry(m.preSnap);
        if (m.mesh) finalizeMeshEdit(m.mesh);
      } else {
        applyInsetModalFactor(0);
        if (m.mesh) finalizeMeshEdit(m.mesh);
      }
      if (state.undoStack && state.undoStack.length) {
        var top = state.undoStack[state.undoStack.length - 1];
        if (top && top.type === "mesh-geo" && top.label === "Inset") state.undoStack.pop();
      }
      clearMeshSelection();
      state.modal = null;
      if (state.orbit) state.orbit.enabled = true;
      setStatus("Inset cancelled.", "ok");
      updateHud();
      return;
    }
    if (m.mode === "bevel-mesh") {
      if (m.preSnap) {
        restoreMeshGeometry(m.preSnap);
        if (m.mesh) finalizeMeshEdit(m.mesh);
      } else {
        applyBevelModalAmount(m.kind === "vertex" ? 0.02 : 0.001);
      }
      if (state.undoStack && state.undoStack.length) {
        var topB = state.undoStack[state.undoStack.length - 1];
        if (topB && topB.type === "mesh-geo" && topB.label === "Bevel") state.undoStack.pop();
      }
      clearMeshSelection();
      state.modal = null;
      if (state.orbit) state.orbit.enabled = true;
      setStatus("Bevel cancelled.", "ok");
      updateHud();
      return;
    }
    if (m.mode === "loop-cut") {
      if (m.preSnap) {
        restoreMeshGeometry(m.preSnap);
        if (m.mesh) {
          normalizeMeshMaterials(m.mesh);
          repairMeshNormals(m.mesh);
        }
      }
      if (state.undoStack && state.undoStack.length) {
        var topL = state.undoStack[state.undoStack.length - 1];
        if (topL && topL.type === "mesh-geo" && topL.label === "Loop cut") state.undoStack.pop();
      }
      clearMeshSelection();
      state.modal = null;
      if (state.orbit) state.orbit.enabled = true;
      setStatus("Loop cut cancelled.", "ok");
      updateHud();
      return;
    }
    if (m.mode === "g-mesh") {
      if (m.mesh && m.verts && m.basePos) {
        var pos = m.mesh.geometry.attributes.position;
        m.verts.forEach(function (vi, i) {
          var b = m.basePos[i];
          pos.setXYZ(vi, b.x, b.y, b.z);
        });
        pos.needsUpdate = true;
        repairMeshNormals(m.mesh);
        highlightMeshSelection();
      }
      if (state.undoStack && state.undoStack.length) {
        var topG = state.undoStack[state.undoStack.length - 1];
        if (topG && topG.type === "mesh-geo" && topG.label === "Move") state.undoStack.pop();
      }
      state.modal = null;
      if (state.orbit) state.orbit.enabled = true;
      setStatus("Move cancelled.", "ok");
      updateHud();
      return;
    }
    if (!state.selected) {
      state.modal = null;
      return;
    }
    if (m.origPos) state.selected.position.copy(m.origPos);
    if (m.origQuat) state.selected.quaternion.copy(m.origQuat);
    if (m.origScale) state.selected.scale.copy(m.origScale);
    state.modal = null;
    if (state.orbit) state.orbit.enabled = true;
    if (state.transform && state.selected && !state.editMode) {
      state.transform.enabled = true;
      state.transform.visible = true;
      state.transform.attach(state.selected);
      applyAxisLockToGimbal();
    }
    setStatus("Cancelled.", "ok");
    updateHud();
  }

  function confirmModal() {
    if (!state.modal) return;
    var mode = state.modal.mode;
    if (state.modal.mesh) finalizeMeshEdit(state.modal.mesh);
    state.modal = null;
    if (state.orbit) state.orbit.enabled = true;
    if (state.transform && state.selected && !state.editMode) {
      state.transform.enabled = true;
      state.transform.visible = true;
      state.transform.attach(state.selected);
      applyAxisLockToGimbal();
    }
    readNumericFromSelection();
    if (mode === "extrude-mesh") setStatus("Extrude confirmed.", "ok");
    else if (mode === "inset-mesh") setStatus("Inset confirmed.", "ok");
    else if (mode === "bevel-mesh") setStatus("Bevel confirmed.", "ok");
    else if (mode === "g-mesh") setStatus("Selection moved.", "ok");
    else if (mode === "loop-cut") setStatus("Loop cut confirmed.", "ok");
    else setStatus("Confirmed.", "ok");
    updateHud();
  }

  function applyModalFromMouse(clientX, clientY) {
    if (!state.modal || !state.camera) return;
    var m = state.modal;
    if (!m.startClient) {
      m.startClient = { x: clientX, y: clientY };
      return;
    }
    var dx = clientX - m.startClient.x;
    var dy = clientY - m.startClient.y;
    var sens = 0.01;

    if (m.mode === "extrude-mesh") {
      // Depth from mouse: mainly vertical drag (Blender-like), axis lock uses that axis
      var depth = -dy * 0.012 + dx * 0.004;
      var threeAxE = userAxisToThree(m.axis);
      if (threeAxE) {
        var originE = m.basePos[0].clone();
        m.mesh.localToWorld(originE);
        var axisWE = m.normal.clone().transformDirection(m.mesh.matrixWorld).normalize();
        var s0e = originE.clone().project(state.camera);
        var s1e = originE.clone().add(axisWE).project(state.camera);
        var sdxe = s1e.x - s0e.x;
        var sdye = s1e.y - s0e.y;
        var mage = Math.sqrt(sdxe * sdxe + sdye * sdye) || 1;
        depth = ((dx * sdxe + -dy * sdye) / mage) * 0.02;
      }
      applyExtrudeModalDepth(depth);
      return;
    }

    if (m.mode === "inset-mesh") {
      var factor = 0.12 + dx * 0.0015 - dy * 0.001;
      applyInsetModalFactor(factor);
      return;
    }

    if (m.mode === "bevel-mesh") {
      var amt;
      if (m.kind === "edge") {
        amt = (m.edgeLen || 1) * 0.12 + dx * 0.002 - dy * 0.0015;
      } else {
        amt = 0.15 + dx * 0.0015 - dy * 0.001;
      }
      applyBevelModalAmount(amt);
      return;
    }

    if (m.mode === "loop-cut") {
      var t = 0.5 + dx * 0.002;
      applyLoopCutModalT(t);
      return;
    }

    if (m.mode === "g-mesh") {
      applyMeshGrabDelta(dx, dy);
      return;
    }

    if (!state.selected) return;
    var threeAx = userAxisToThree(m.axis);
    var obj = state.selected;

    if (m.mode === "g") {
      obj.position.copy(m.origPos);
      if (!threeAx) {
        // View-plane free move
        var right = new THREE.Vector3();
        var up = new THREE.Vector3();
        right.setFromMatrixColumn(state.camera.matrixWorld, 0).normalize();
        up.setFromMatrixColumn(state.camera.matrixWorld, 1).normalize();
        obj.position.addScaledVector(right, dx * sens);
        obj.position.addScaledVector(up, -dy * sens);
      } else {
        var axis = new THREE.Vector3(
          threeAx === "x" ? 1 : 0,
          threeAx === "y" ? 1 : 0,
          threeAx === "z" ? 1 : 0
        );
        // Prefer the mouse delta that best matches screen projection of axis
        var axEnd = m.origPos.clone().add(axis);
        var s0 = m.origPos.clone().project(state.camera);
        var s1 = axEnd.project(state.camera);
        var sdx = s1.x - s0.x;
        var sdy = s1.y - s0.y;
        var along = dx * sdx + -dy * sdy;
        var mag = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
        obj.position.addScaledVector(axis, (along / mag) * sens * 2.5);
      }
    } else if (m.mode === "s") {
      obj.scale.copy(m.origScale);
      var factor = 1 + (-dy + dx) * 0.005;
      factor = Math.max(0.05, factor);
      if (!threeAx) {
        obj.scale.multiplyScalar(factor);
      } else if (threeAx === "x") obj.scale.x = Math.max(0.05, m.origScale.x * factor);
      else if (threeAx === "y") obj.scale.y = Math.max(0.05, m.origScale.y * factor);
      else if (threeAx === "z") obj.scale.z = Math.max(0.05, m.origScale.z * factor);
    } else if (m.mode === "r") {
      obj.quaternion.copy(m.origQuat);
      var ang = dx * 0.01;
      var axR = new THREE.Vector3(0, 1, 0);
      if (threeAx === "x") axR.set(1, 0, 0);
      else if (threeAx === "y") axR.set(0, 1, 0);
      else if (threeAx === "z") axR.set(0, 0, 1);
      else {
        // free rotate around view axis
        state.camera.getWorldDirection(axR);
        axR.negate();
      }
      var q = new THREE.Quaternion().setFromAxisAngle(axR, ang);
      obj.quaternion.copy(m.origQuat).premultiply(q);
    }
  }

  function ensureBoxOverlay() {
    var el = $("mod-box-select");
    if (el) return el;
    var wrap = $("mod-viewport-wrap");
    if (!wrap) return null;
    el = document.createElement("div");
    el.id = "mod-box-select";
    el.className = "mod-box-select";
    el.hidden = true;
    wrap.appendChild(el);
    return el;
  }

  function onPointerDown(event) {
    if (!state.active || !state.renderer) return;
    if (event.target !== state.renderer.domElement) return;

    // Modal confirm / cancel
    if (state.modal) {
      if (event.button === 0) {
        event.preventDefault();
        confirmModal();
      } else if (event.button === 2) {
        event.preventDefault();
        cancelModal();
      }
      return;
    }

    // LMB only for select / mesh pick / box select
    if (event.button !== 0) return;

    // Don't steal clicks on transform gizmo
    if (state.transform && (state.transform.dragging || state.transform.axis)) {
      return;
    }

    // Edit Mode: LMB selects face/edge/vertex based on selectMode
    if (state.editMode) {
      if (state.selected) {
        var picked = pickMeshComponent(event);
        if (!picked) {
          setStatus("Click the mesh (" + state.selectMode + " select).", "ok");
        }
      } else {
        setStatus("Select an object, then Tab into Edit Mode.", "err");
      }
      return;
    }

    // Box select start (object mode, Select tool)
    if (state.tool === "select" || state.tool === "move" || state.tool === "rotate" || state.tool === "scale") {
      if (state.tool !== "select") return;
      var rect = state.renderer.domElement.getBoundingClientRect();
      state.boxSelect = {
        x0: event.clientX - rect.left,
        y0: event.clientY - rect.top,
        x1: event.clientX - rect.left,
        y1: event.clientY - rect.top,
        additive: event.shiftKey,
      };
      var box = ensureBoxOverlay();
      if (box) {
        box.hidden = false;
        box.style.left = state.boxSelect.x0 + "px";
        box.style.top = state.boxSelect.y0 + "px";
        box.style.width = "0px";
        box.style.height = "0px";
      }
      if (state.orbit) state.orbit.enabled = false;
    }
  }

  function onPointerMove(event) {
    if (!state.active || !state.renderer) return;
    if (state.modal) {
      applyModalFromMouse(event.clientX, event.clientY);
      return;
    }
    if (state.boxSelect) {
      var rect = state.renderer.domElement.getBoundingClientRect();
      state.boxSelect.x1 = event.clientX - rect.left;
      state.boxSelect.y1 = event.clientY - rect.top;
      var box = ensureBoxOverlay();
      if (box) {
        var x = Math.min(state.boxSelect.x0, state.boxSelect.x1);
        var y = Math.min(state.boxSelect.y0, state.boxSelect.y1);
        var w = Math.abs(state.boxSelect.x1 - state.boxSelect.x0);
        var h = Math.abs(state.boxSelect.y1 - state.boxSelect.y0);
        box.style.left = x + "px";
        box.style.top = y + "px";
        box.style.width = w + "px";
        box.style.height = h + "px";
      }
    }
  }

  function onPointerUp(event) {
    if (!state.active || !state.renderer) return;
    if (state.boxSelect && event.button === 0) {
      finishBoxSelect();
    }
  }

  function finishBoxSelect() {
    var bs = state.boxSelect;
    state.boxSelect = null;
    var box = ensureBoxOverlay();
    if (box) box.hidden = true;
    if (state.orbit) state.orbit.enabled = true;
    if (!bs || !state.camera) return;
    var x0 = Math.min(bs.x0, bs.x1);
    var y0 = Math.min(bs.y0, bs.y1);
    var x1 = Math.max(bs.x0, bs.x1);
    var y1 = Math.max(bs.y0, bs.y1);
    var w = x1 - x0;
    var h = y1 - y0;
    var rect = state.renderer.domElement.getBoundingClientRect();

    // Tiny box = single click select
    if (w < 4 && h < 4) {
      state.pointer.x = ((x0 + x1) * 0.5 / rect.width) * 2 - 1;
      state.pointer.y = -((y0 + y1) * 0.5 / rect.height) * 2 + 1;
      state.raycaster.setFromCamera(state.pointer, state.camera);
      // Prefer meshes; improve accuracy with recursive + careful pick
      var hits = state.raycaster.intersectObjects(state.objects, true);
      // Filter out ground-like huge planes? keep all studio objects
      if (hits.length) {
        var obj = resolveSelectable(hits[0].object);
        if (obj) selectObject(obj);
        else selectObject(null);
      } else {
        selectObject(null);
      }
      return;
    }

    var picked = [];
    var tmp = new THREE.Vector3();
    state.objects.forEach(function (obj) {
      if (obj.userData && obj.userData.isSpellforgePlane) return;
      var box3 = new THREE.Box3().setFromObject(obj);
      if (box3.isEmpty()) return;
      box3.getCenter(tmp);
      tmp.project(state.camera);
      var sx = (tmp.x * 0.5 + 0.5) * rect.width;
      var sy = (-tmp.y * 0.5 + 0.5) * rect.height;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && tmp.z < 1) {
        picked.push(obj);
      }
    });
    if (picked.length) {
      selectObject(picked[picked.length - 1]);
      setStatus("Box select: " + picked.length + " object(s) — active “" + state.selected.name + "”.", "ok");
    } else {
      selectObject(null);
    }
  }

  function resize() {
    if (state.workspace === "uv") {
      resizeUvCanvas();
    }
    if (!state.renderer || !state.camera) return;
    var wrap = $("mod-viewport-wrap");
    if (!wrap) return;
    // When UV workspace is active, 3D panel is hidden — skip zero-size resize
    if (wrap.clientWidth < 8 || wrap.clientHeight < 8) return;
    var w = Math.max(200, wrap.clientWidth);
    var h = Math.max(320, wrap.clientHeight);
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h, false);
    state.renderer.domElement.style.width = "100%";
    state.renderer.domElement.style.height = "100%";
    if (state.cssRenderer) {
      state.cssRenderer.setSize(w, h);
      state.cssRenderer.domElement.style.width = "100%";
      state.cssRenderer.domElement.style.height = "100%";
    }
  }

  function animate() {
    if (!state.active) return;
    state.animId = requestAnimationFrame(animate);
    var now = performance.now();
    var dt = state._lastAnimAt ? Math.min(0.05, (now - state._lastAnimAt) / 1000) : 0.016;
    state._lastAnimAt = now;
    if (state.orbit) state.orbit.update();
    updateSpinningGlobes(dt);
    syncCssObjects();
    // Occlusion: hide CSS3D when meshes block the plane (depth realism)
    refreshSpellforgePointerMode();
    // Capture while live so occlusion switches to a real loaded frame, not "loading"
    var captureEvery = 550;
    if (now - (state.lastCaptureAt || 0) > captureEvery) {
      captureSpellforgePlanes(false);
    }
    if (state.renderer && state.scene && state.camera) {
      state.renderer.render(state.scene, state.camera);
    }
    // Only draw CSS3D for planes that are currently live (not occluded)
    if (state.cssRenderer && state.cssScene && state.camera) {
      state.cssRenderer.render(state.cssScene, state.camera);
    }
  }

  function ensureInit() {
    if (state.ready) {
      resize();
      return;
    }
    var wrap = $("mod-viewport-wrap");
    var canvas = $("mod-canvas");
    if (!wrap || !canvas) return;

    var renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x0d0d10, 1);
    renderer.shadowMap.enabled = true;
    // Soft edges help translucent (dithered) shadows read as weaker, not hard black
    if (THREE.PCFSoftShadowMap != null) {
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.zIndex = "1";

    var cssRenderer = new CSS3DRenderer();
    cssRenderer.domElement.className = "mod-css-layer";
    cssRenderer.domElement.style.position = "absolute";
    cssRenderer.domElement.style.inset = "0";
    cssRenderer.domElement.style.zIndex = "2";
    cssRenderer.domElement.style.pointerEvents = "none";
    wrap.appendChild(cssRenderer.domElement);

    var scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0d0d10, 18, 42);
    var cssScene = new THREE.Scene();

    var camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
    camera.position.set(4.2, 3.2, 5.2);

    var ambient = new THREE.AmbientLight(0xb0b4c8, 0.55);
    scene.add(ambient);
    var key = new THREE.DirectionalLight(0xfff2e0, 1.05);
    key.position.set(5, 8, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0x8899cc, 0.35);
    fill.position.set(-4, 2, -3);
    scene.add(fill);
    var hemi = new THREE.HemisphereLight(0x606880, 0x1a1a20, 0.35);
    scene.add(hemi);

    var grid = new THREE.GridHelper(20, 20, 0x4a5080, 0x2a2a35);
    grid.position.y = 0;
    scene.add(grid);

    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      // Slightly softer base so translucent casters don't look fully opaque
      new THREE.ShadowMaterial({ opacity: 0.22, transparent: true })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    var orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.target.set(0, 0.5, 0);
    // Blender-like: MMB orbit, RMB pan, scroll zoom — LMB free for box select
    orbit.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    orbit.update();

    var transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(1.0);
    transform.addEventListener("dragging-changed", function (e) {
      orbit.enabled = !e.value;
      if (e.value) {
        state.objects.forEach(function (obj) {
          if (!obj.userData || !obj.userData.isSpellforgePlane) return;
          var frame = obj.userData.cssObject && obj.userData.cssObject.element;
          if (frame) frame.style.pointerEvents = "none";
          if (obj.userData.iframe) obj.userData.iframe.style.pointerEvents = "none";
        });
      } else {
        onTransformDragEnd();
      }
    });
    scene.add(transform);

    window.addEventListener("message", function (ev) {
      var data = ev.data;
      if (!data || data.type !== "spellforge-job-done") return;
      if (!data.imageUrl) return;
      enqueuePrintJob(data.imageUrl, {
        stasis: data.stasis,
        spells: data.spells,
      });
    });
    window.addEventListener("spellforge-job-done", function (ev) {
      var d = ev.detail || {};
      if (d.imageUrl) enqueuePrintJob(d.imageUrl, d);
    });

    state.renderer = renderer;
    state.cssRenderer = cssRenderer;
    state.scene = scene;
    state.cssScene = cssScene;
    state.camera = camera;
    state.orbit = orbit;
    state.transform = transform;
    state.grid = grid;
    state.raycaster = new THREE.Raycaster();
    state.pointer = new THREE.Vector2();
    state.clock = new THREE.Clock();
    state.ready = true;

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("contextmenu", function (e) {
      if (state.modal) e.preventDefault();
    });
    window.addEventListener("resize", resize);
    resize();
    setTool("select");
    setStatus(
      "Studio 3D — MMB orbit · LMB box select · G/R/S grab · X/Y/Z (Blender: Z↑ Y depth).",
      "ok"
    );
  }

  function startLoop() {
    state.active = true;
    cancelAnimationFrame(state.animId);
    animate();
    resize();
    // delayed resize for layout
    setTimeout(resize, 50);
    setTimeout(resize, 200);
  }

  function stopLoop() {
    state.active = false;
    cancelAnimationFrame(state.animId);
  }

  function onKey(e) {
    if (!state.active) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) {
      return;
    }
    var k = e.key.toLowerCase();

    // Modal constraints / cancel
    if (state.modal) {
      if (k === "escape" || k === "q") {
        e.preventDefault();
        cancelModal();
        return;
      }
      if (k === "x" || k === "y" || k === "z") {
        e.preventDefault();
        state.modal.axis = k;
        state.axisLock = k;
        document.querySelectorAll("#panel-modeler .mod-axis-btn").forEach(function (btn) {
          btn.classList.toggle("is-active", btn.getAttribute("data-axis") === k);
        });
        applyAxisLockToGimbal();
        state.modal.startClient = null;
        if (state.modal.mode === "extrude-mesh") {
          applyExtrudeModalDepth(0);
          setStatus("Extrude · " + k.toUpperCase() + " — drag for depth", "ok");
        } else if (state.selected && state.modal.origPos) {
          state.selected.position.copy(state.modal.origPos);
          state.selected.quaternion.copy(state.modal.origQuat);
          state.selected.scale.copy(state.modal.origScale);
          setStatus(
            (state.modal.mode === "g" ? "Move" : state.modal.mode === "r" ? "Rotate" : "Scale") +
              " · " +
              k.toUpperCase() +
              " (Blender)",
            "ok"
          );
        }
        return;
      }
      if (k === "enter") {
        e.preventDefault();
        confirmModal();
        return;
      }
      return;
    }

    // Undo / redo / copy / paste
    if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === "z" && e.shiftKey) {
      e.preventDefault();
      redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === "c") {
      e.preventDefault();
      copySelected();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === "v") {
      e.preventDefault();
      pasteClipboard();
      return;
    }

    if (k === "tab") {
      e.preventDefault();
      toggleEditMode();
      return;
    }
    if (k === "g") {
      e.preventDefault();
      if (!state.editMode) setTool("move");
      startModal("g");
    } else if (k === "r") {
      e.preventDefault();
      if (!state.editMode) setTool("rotate");
      startModal("r");
    } else if (k === "s" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (!state.editMode) setTool("scale");
      startModal("s");
    } else if (k === "1") {
      e.preventDefault();
      setSelectMode("face");
    } else if (k === "2") {
      e.preventDefault();
      setSelectMode("edge");
    } else if (k === "3") {
      e.preventDefault();
      setSelectMode("vertex");
    } else if (k === "e" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (!state.editMode) enterEditMode();
      extrudeSelected();
    } else if (k === "i" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (!state.editMode) enterEditMode();
      insetSelectedFace();
    } else if (k === "b" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (!state.editMode) enterEditMode();
      bevelSelected();
    } else if (k === "x" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setAxisLock("x");
    } else if (k === "y" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setAxisLock("y");
    } else if (k === "z" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setAxisLock("z");
    } else if (k === "q" || k === "escape") {
      if (state.editMode) {
        exitEditMode();
      } else {
        setTool("select");
        clearMeshSelection();
      }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelected();
    } else if (k === "f") {
      e.preventDefault();
      focusSelected();
    } else if (k === "d" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      duplicateSelected();
    }
  }

  function onKeyDownCapture(e) {
    // Ctrl+R loop cut (R alone starts rotate modal)
    if (!state.active) return;
    if (e.ctrlKey && (e.key === "r" || e.key === "R")) {
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      e.preventDefault();
      e.stopPropagation();
      loopCutSelected();
    }
  }

  function bindUi() {
    if (state.uiBound) return;
    state.uiBound = true;

    document.querySelectorAll("#panel-modeler [data-add]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        addPrimitive(btn.getAttribute("data-add"));
      });
    });
    document.querySelectorAll("#panel-modeler .mod-tool-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTool(btn.getAttribute("data-tool") || "select");
      });
    });
    var editModeBtn = $("mod-edit-mode");
    if (editModeBtn) {
      editModeBtn.addEventListener("click", function () {
        toggleEditMode();
      });
    }
    document.querySelectorAll("#panel-modeler .mod-select-mode").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setSelectMode(btn.getAttribute("data-select-mode") || "face");
      });
    });
    document.querySelectorAll("#panel-modeler .mod-axis-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setAxisLock(btn.getAttribute("data-axis"));
      });
    });
    var axisClear = $("mod-axis-clear");
    if (axisClear) {
      axisClear.addEventListener("click", function () {
        state.axisLock = null;
        document.querySelectorAll("#panel-modeler .mod-axis-btn").forEach(function (b) {
          b.classList.remove("is-active");
        });
        applyAxisLockToGimbal();
        setStatus("Axis lock: free", "ok");
      });
    }
    var extBtn = $("mod-extrude");
    if (extBtn) extBtn.addEventListener("click", extrudeSelected);
    var insBtn = $("mod-inset");
    if (insBtn) insBtn.addEventListener("click", insetSelectedFace);
    var bevBtn = $("mod-bevel");
    if (bevBtn) bevBtn.addEventListener("click", bevelSelected);
    var bevFlat = $("mod-bevel-flat");
    if (bevFlat) {
      bevFlat.addEventListener("click", function () {
        setBevelProfile("flat");
      });
    }
    var bevCurved = $("mod-bevel-curved");
    if (bevCurved) {
      bevCurved.addEventListener("click", function () {
        setBevelProfile("curved");
      });
    }
    var loopBtn = $("mod-loopcut");
    if (loopBtn) loopBtn.addEventListener("click", loopCutSelected);
    var subBtn = $("mod-subdivide");
    if (subBtn) subBtn.addEventListener("click", subdivideSelected);
    document.querySelectorAll("#panel-modeler [data-mod-workspace]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setStudioWorkspace(btn.getAttribute("data-mod-workspace") || "3d");
      });
    });
    var openUv = $("mod-open-uv");
    if (openUv) {
      openUv.addEventListener("click", function () {
        setStudioWorkspace("uv");
      });
    }
    var uvBack = $("mod-uv-back-3d");
    if (uvBack) {
      uvBack.addEventListener("click", function () {
        setStudioWorkspace("3d");
      });
    }
    var uvP = $("mod-uv-planar");
    if (uvP) uvP.addEventListener("click", function () {
      unwrapUVs("planar");
    });
    var uvB = $("mod-uv-box");
    if (uvB) uvB.addEventListener("click", function () {
      unwrapUVs("box");
    });
    var uvS = $("mod-uv-sphere");
    if (uvS) uvS.addEventListener("click", function () {
      unwrapUVs("sphere");
    });
    var uvFit = $("mod-uv-fit");
    if (uvFit) {
      uvFit.addEventListener("click", function () {
        state.uvEditor.panX = 0;
        state.uvEditor.panY = 0;
        state.uvEditor.zoom = 1;
        drawUvEditor();
      });
    }
    var uvReset = $("mod-uv-reset-view");
    if (uvReset) {
      uvReset.addEventListener("click", function () {
        state.uvEditor.panX = 0;
        state.uvEditor.panY = 0;
        state.uvEditor.zoom = 1;
        drawUvEditor();
      });
    }
    var uvChecker = $("mod-uv-checker");
    if (uvChecker) {
      uvChecker.addEventListener("click", function () {
        var mesh = getUvMesh();
        if (!mesh) {
          setStatus("Select a mesh first.", "err");
          return;
        }
        applyUvChecker(mesh);
        setStatus("Checker texture applied (view seams in 3D).", "ok");
      });
    }
    var uvPack = $("mod-uv-pack");
    if (uvPack) uvPack.addEventListener("click", packUVsToUnit);
    var uvImg = $("mod-uv-image");
    if (uvImg) {
      uvImg.addEventListener("change", function (ev) {
        var file = ev.target.files && ev.target.files[0];
        if (!file) return;
        var mesh = getUvMesh();
        if (!mesh) {
          setStatus("Select a mesh first.", "err");
          return;
        }
        var mat = findMeshMaterial(mesh) || findMeshMaterial(state.selected);
        if (!mat) return;
        setMaterialFillMode(mat, "image", mesh);
        loadMaterialImageFromFile(file, mat, mesh);
        ev.target.value = "";
        setStatus("Image assigned to material (UV mapped).", "ok");
      });
    }
    var uvShowSel = $("mod-uv-show-sel");
    if (uvShowSel) uvShowSel.addEventListener("change", function () {
      drawUvEditor();
    });
    bindUvEditorUi();
    var shotP = $("mod-shot-prompt");
    if (shotP) shotP.addEventListener("click", screenshotToPrompt);
    var shotG = $("mod-shot-generate");
    if (shotG) shotG.addEventListener("click", generateFromShotPrompt);
    var applyNum = $("mod-apply-num");
    if (applyNum) applyNum.addEventListener("click", applyNumericToSelection);
    var readNum = $("mod-read-num");
    if (readNum) readNum.addEventListener("click", readNumericFromSelection);
    var printStyle = $("mod-print-style");
    if (printStyle) {
      printStyle.addEventListener("change", function () {
        state.printStyle = printStyle.value || "auto";
        setStatus("3D print style: " + state.printStyle, "ok");
      });
    }
    var del = $("mod-delete");
    if (del) del.addEventListener("click", deleteSelected);
    var dup = $("mod-duplicate");
    if (dup) dup.addEventListener("click", duplicateSelected);
    var focus = $("mod-focus");
    if (focus) focus.addEventListener("click", focusSelected);
    var clear = $("mod-clear");
    if (clear) clear.addEventListener("click", clearScene);
    var exp = $("mod-export");
    if (exp) exp.addEventListener("click", exportGlb);
    var planeUi = $("mod-plane-ui");
    if (planeUi) {
      planeUi.addEventListener("click", function () {
        if (state.tool === "select" && state.sfInteract) {
          setTool("move");
          setStatus("Gimbal free — drag the plane. Q = use Spellforge on the plane.", "ok");
        } else {
          setTool("select");
          state.sfInteract = true;
          refreshSpellforgePointerMode();
          setStatus("Select — use live Spellforge (hides when a mesh blocks the view).", "ok");
        }
      });
    }
    // Spellforge / printers use [data-add] → addPrimitive (avoid double-add handlers)
    var snapBtn = $("mod-toggle-snap");
    if (snapBtn) {
      snapBtn.addEventListener("click", function () {
        state.snapEnabled = !state.snapEnabled;
        snapBtn.classList.toggle("is-active", state.snapEnabled);
        setStatus(state.snapEnabled ? "Face snap on." : "Face snap off.", "ok");
      });
    }
    var gridBtn = $("mod-toggle-grid");
    if (gridBtn) {
      gridBtn.addEventListener("click", function () {
        if (state.grid) {
          state.grid.visible = !state.grid.visible;
          gridBtn.classList.toggle("is-active", state.grid.visible);
        }
      });
    }
    document.querySelectorAll("#panel-modeler [data-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setView(btn.getAttribute("data-view"));
      });
    });

    ["mod-prop-name", "mod-prop-color", "mod-prop-metal", "mod-prop-rough", "mod-prop-wire", "mod-prop-opacity"].forEach(
      function (id) {
        var el = $(id);
        if (!el) return;
        var ev = id === "mod-prop-name" ? "change" : "input";
        el.addEventListener(ev, applyPropsToSelection);
      }
    );
    var matModeColor = $("mod-mat-mode-color");
    var matModeImage = $("mod-mat-mode-image");
    if (matModeColor) matModeColor.addEventListener("change", onMaterialModeChange);
    if (matModeImage) matModeImage.addEventListener("change", onMaterialModeChange);
    var matImage = $("mod-prop-image");
    if (matImage) matImage.addEventListener("change", onMaterialImagePicked);
    var matImageClear = $("mod-prop-image-clear");
    if (matImageClear) matImageClear.addEventListener("click", onMaterialImageClear);
    var matSlot = $("mod-mat-slot");
    if (matSlot) {
      matSlot.addEventListener("change", function () {
        setActiveMaterialSlot(parseInt(matSlot.value, 10) || 0);
      });
    }
    var matAdd = $("mod-mat-add");
    if (matAdd) matAdd.addEventListener("click", addMaterialSlot);
    var matAssign = $("mod-mat-assign");
    if (matAssign) matAssign.addEventListener("click", assignMaterialToSelectedFace);

    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onKeyDownCapture, true);
  }

  function onShow() {
    bindUi();
    ensureInit();
    startLoop();
    if (!state.objects.length) {
      // gentle default cube so the viewport isn't empty
      // only once ever
      if (!state.seeded) {
        state.seeded = true;
        addPrimitive("cube");
        setTool("move");
        setStatus("Studio 3D — cube selected. G/R/S to transform, orbit with mouse.", "ok");
      }
    }
    updateHud();
  }

  function onHide() {
    stopLoop();
  }

  window.Modeler = {
    onShow: onShow,
    onHide: onHide,
    addPrimitive: addPrimitive,
    addSpellforgePlane: addSpellforgePlane,
    addPrinter: addPrinter,
    addMeshPrinter: addMeshPrinter,
    enqueuePrintJob: enqueuePrintJob,
    exportGlb: exportGlb,
  };
  window.addEventListener("modeler-show", onShow);
  window.addEventListener("modeler-hide", onHide);
})();
