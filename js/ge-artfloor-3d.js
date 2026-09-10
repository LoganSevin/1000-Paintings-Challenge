/**
 * Grand Exchange Art Floor — third-person walkaround.
 * Style reference: assets/grand-exchange-art-floor.jpg (colors/layout only — NOT a wall mural).
 * - Local Three.js (importmap → vendor/three)
 * - Procedural 3D marble hall: columns, arched windows, chandeliers, green tables, easels
 * - Player: open-source image→3D custom-character.glb (TripoSR) gold jumpsuit — full body front+back
 * - Look: segmented PBR (skin/hair/gold/scarf/gun/shoes) + vertex-color reinforce; Y-up upright
 * - NPCs: offline Mixamo Soldier/Xbot gallery crowd (calm attire tints + walk mixer)
 * - Unskinned custom mesh: TPS bob/sway/idle breathe (no Mixamo skin). Skinned Mixamo fallback if GLB missing.
 * - Hook: CUSTOM_CHARACTER_GLB / ?customGlb= (default glb/custom-character.glb); CUSTOM_CHARACTER_URL palette ref
 * - NO yellow inflated cutout / ExtrudeGeometry silhouette; NO painting UV-wrap on back
 * - Camera yaw ≠ body yaw (no billboard snap); orbit shows side/back; WASD vs camera; LMB/F shoot; E at desk
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

var LOADER_ID = "ge-world-loader";
var ZOOM_MIN = 1.6;
var ZOOM_MAX = 16.0;
var ZOOM_DEFAULT = 3.8;

var api = {
  _ready: false,
  _running: false,
  _mounted: false,
  _raf: 0,
  _lastTs: 0,
  _opts: null,
  _renderer: null,
  _scene: null,
  _camera: null,
  _player: null,
  _playerYaw: 0,
  _camYaw: Math.PI,
  _lookPitch: 0.22,
  _camDist: ZOOM_DEFAULT,
  _camDistTarget: ZOOM_DEFAULT,
  _keys: Object.create(null),
  _pointerLocked: false,
  _projectiles: null,
  _muzzleLight: null,
  _shootCooldown: 0,
  _colliders: [],
  _booth: null,
  _npcs: [],
  _textures: [],
  _mats: [],
  _geos: [],
  _walkAcc: 0,
  _walkPhase: 0,
  _nearBooth: false,
  _hintEl: null,
  _container: null,
  _canvas: null,
  _loaderEl: null,
  _firstFrameDone: false,
  _onResize: null,
  _onKeyDown: null,
  _onKeyUp: null,
  _onMouseMove: null,
  _onWheel: null,
  _onPointerLockChange: null,
  _onClick: null,
  _onVis: null,
  _easelMeshes: [],
  _disposed: false,
  _facingArrow: null,
  _wasRunningBeforeHide: false,
  _mixers: [],
  _charLibrary: null,
};

function trackGeo(g) { api._geos.push(g); return g; }
function trackMat(m) { api._mats.push(m); return m; }
function trackTex(t) { if (t) api._textures.push(t); return t; }

function showLoader(visible, msg, pct) {
  var el = api._loaderEl || document.getElementById(LOADER_ID);
  if (!el) return;
  api._loaderEl = el;
  if (msg) {
    var label = el.querySelector(".ge-world-loader-label");
    if (label) label.textContent = msg;
    var sub = el.querySelector("#ge-world-loader-sub") || el.querySelector(".ge-world-loader-sub");
    if (sub && msg) {
      // Keep subline as detail when msg is the main title; otherwise mirror
      if (/character|glb|patron|art floor/i.test(msg)) sub.textContent = msg;
    }
  }
  var fill = el.querySelector("#ge-world-loader-bar-fill") || el.querySelector(".ge-world-loader-bar-fill");
  var pctEl = el.querySelector("#ge-world-loader-pct") || el.querySelector(".ge-world-loader-pct");
  if (fill) {
    if (pct == null || !isFinite(pct)) {
      fill.classList.add("is-indeterminate");
      if (pctEl) pctEl.textContent = "…";
    } else {
      fill.classList.remove("is-indeterminate");
      var p = Math.max(0, Math.min(100, Math.round(pct)));
      fill.style.width = p + "%";
      if (pctEl) pctEl.textContent = p + "%";
    }
  }
  if (visible) {
    el.hidden = false;
    el.setAttribute("aria-busy", "true");
    el.classList.remove("is-hidden");
  } else {
    if (fill) {
      fill.classList.remove("is-indeterminate");
      fill.style.width = "100%";
    }
    if (pctEl) pctEl.textContent = "100%";
    el.classList.add("is-hidden");
    el.setAttribute("aria-busy", "false");
    setTimeout(function () {
      if (el.classList.contains("is-hidden")) el.hidden = true;
    }, 450);
  }
}

function makeMarbleTexture(size) {
  size = size || 2048;
  var c = document.createElement("canvas");
  c.width = size; c.height = size;
  var ctx = c.getContext("2d");
  var grd = ctx.createLinearGradient(0, 0, size, size);
  grd.addColorStop(0, "#f2ebe0");
  grd.addColorStop(0.35, "#e6ddd0");
  grd.addColorStop(0.7, "#efe6d8");
  grd.addColorStop(1, "#ddd2c2");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  var tile = size / 8;
  for (var ty = 0; ty < 8; ty++) {
    for (var tx = 0; tx < 8; tx++) {
      var n = Math.random();
      ctx.fillStyle = n > 0.5
        ? "rgba(255,252,245," + (0.03 + n * 0.05).toFixed(3) + ")"
        : "rgba(120,100,80," + ((0.5 - n) * 0.08).toFixed(3) + ")";
      ctx.fillRect(tx * tile + 2, ty * tile + 2, tile - 4, tile - 4);
    }
  }
  for (var v = 0; v < 90; v++) {
    ctx.strokeStyle = "rgba(140,125,105," + (0.08 + Math.random() * 0.22).toFixed(3) + ")";
    ctx.lineWidth = 1 + Math.random() * 3 * (size / 1024);
    ctx.beginPath();
    var x = Math.random() * size;
    var y = Math.random() * size;
    ctx.moveTo(x, y);
    for (var s = 0; s < 10; s++) {
      x += (Math.random() - 0.5) * size * 0.12;
      y += (Math.random() - 0.5) * size * 0.12;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(110,95,75,0.38)";
  ctx.lineWidth = Math.max(2, size / 512);
  for (var i = 0; i <= size; i += tile) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  for (var j = 0; j < size; j += tile) {
    ctx.strokeRect(j + 6, 6, tile - 12, tile - 12);
  }
  var tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 10);
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return trackTex(tex);
}

function makeMarbleRoughness(size) {
  size = size || 1024;
  var c = document.createElement("canvas");
  c.width = size; c.height = size;
  var ctx = c.getContext("2d");
  ctx.fillStyle = "#6a6a6a";
  ctx.fillRect(0, 0, size, size);
  for (var i = 0; i < 4000; i++) {
    var g = 80 + Math.floor(Math.random() * 100);
    ctx.fillStyle = "rgb(" + g + "," + g + "," + g + ")";
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  var tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 10);
  tex.anisotropy = 8;
  return trackTex(tex);
}

function makeColumnMarbleTexture() {
  var c = document.createElement("canvas");
  c.width = 1024; c.height = 2048;
  var ctx = c.getContext("2d");
  ctx.fillStyle = "#f0e8dc";
  ctx.fillRect(0, 0, 1024, 2048);
  for (var v = 0; v < 60; v++) {
    ctx.strokeStyle = "rgba(155,135,115," + (0.12 + Math.random() * 0.28).toFixed(3) + ")";
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    var x = 40 + Math.random() * 944;
    ctx.moveTo(x, 0);
    for (var y = 0; y < 2048; y += 48) {
      x += (Math.random() - 0.5) * 36;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  var tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return trackTex(tex);
}

function makeClothTexture() {
  var c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  var ctx = c.getContext("2d");
  ctx.fillStyle = "#164a32";
  ctx.fillRect(0, 0, 512, 512);
  for (var y = 0; y < 512; y += 2) {
    ctx.fillStyle = "rgba(255,255,255," + (0.015 + (y % 4 === 0 ? 0.02 : 0)).toFixed(3) + ")";
    ctx.fillRect(0, y, 512, 1);
  }
  for (var x = 0; x < 512; x += 3) {
    ctx.fillStyle = "rgba(0,0,0,0.04)";
    ctx.fillRect(x, 0, 1, 512);
  }
  var tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return trackTex(tex);
}

function makeBannerTexture(text) {
  var c = document.createElement("canvas");
  c.width = 2048; c.height = 512;
  var ctx = c.getContext("2d");
  ctx.fillStyle = "#f7f2ea";
  ctx.fillRect(0, 0, 2048, 512);
  ctx.strokeStyle = "#2a2218";
  ctx.lineWidth = 18;
  ctx.strokeRect(14, 14, 2020, 484);
  ctx.strokeStyle = "#c9a227";
  ctx.lineWidth = 8;
  ctx.strokeRect(32, 32, 1984, 448);
  var label = text || "GRAND EXCHANGE - ART FLOOR";
  ctx.fillStyle = "#1a1610";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 120px Georgia, 'Times New Roman', serif";
  if (ctx.measureText(label).width > 1850) {
    ctx.font = "bold 96px Georgia, 'Times New Roman', serif";
  }
  ctx.fillText(label, 1024, 256);
  var cols = ["#2a5aad", "#d4a017", "#b03030"];
  for (var i = 0; i < 3; i++) {
    ctx.fillStyle = cols[i];
    ctx.beginPath();
    ctx.moveTo(100 + i * 70, 0);
    ctx.lineTo(145 + i * 70, 0);
    ctx.lineTo(165 + i * 70, 130);
    ctx.lineTo(120 + i * 70, 130);
    ctx.closePath();
    ctx.fill();
  }
  var tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return trackTex(tex);
}

/** Soft exterior city haze for arched windows (not solid white flats). */
function makeExteriorViewTexture() {
  var c = document.createElement("canvas");
  c.width = 1024; c.height = 1024;
  var ctx = c.getContext("2d");
  var sky = ctx.createLinearGradient(0, 0, 0, 1024);
  sky.addColorStop(0, "#c8d8ea");
  sky.addColorStop(0.45, "#e8dcc8");
  sky.addColorStop(0.72, "#d4c4a8");
  sky.addColorStop(1, "#b8a888");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, 1024);
  // Hazy city blocks
  for (var i = 0; i < 28; i++) {
    var bw = 40 + Math.random() * 90;
    var bh = 80 + Math.random() * 280;
    var bx = Math.random() * 1024;
    var by = 520 + Math.random() * 120;
    ctx.fillStyle = "rgba(90,85,95," + (0.18 + Math.random() * 0.28).toFixed(3) + ")";
    ctx.fillRect(bx, by - bh, bw, bh);
    // windows
    ctx.fillStyle = "rgba(255,230,180," + (0.08 + Math.random() * 0.2).toFixed(3) + ")";
    for (var wy = by - bh + 12; wy < by - 20; wy += 22) {
      for (var wx = bx + 8; wx < bx + bw - 8; wx += 16) {
        if (Math.random() > 0.35) ctx.fillRect(wx, wy, 8, 10);
      }
    }
  }
  // Soft sun glow
  var glow = ctx.createRadialGradient(780, 220, 20, 780, 220, 280);
  glow.addColorStop(0, "rgba(255,245,210,0.55)");
  glow.addColorStop(1, "rgba(255,245,210,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1024, 1024);
  var tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return trackTex(tex);
}

function makeWoodMat(hex) {
  return trackMat(new THREE.MeshStandardMaterial({
    color: hex || 0x5a4030, roughness: 0.82, metalness: 0.05,
  }));
}

function addCollider(x, z, halfW, halfD) {
  api._colliders.push({ x: x, z: z, hw: halfW, hd: halfD });
}

function collidesAt(x, z, rad) {
  rad = rad || 0.45;
  if (x < -11.2 || x > 11.2 || z < -13.5 || z > 13.5) return true;
  for (var i = 0; i < api._colliders.length; i++) {
    var c = api._colliders[i];
    if (Math.abs(x - c.x) < c.hw + rad && Math.abs(z - c.z) < c.hd + rad) return true;
  }
  return false;
}

function loadTex(url, onLoad, onErr) {
  var loader = new THREE.TextureLoader();
  loader.load(url, function (tex) {
    trackTex(tex);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    onLoad && onLoad(tex);
  }, undefined, function (e) { onErr && onErr(e); });
}

function buildColumn(x, z, h, mat) {
  var g = new THREE.Group();
  var shaft = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.05, h - 0.85, 1.05)), mat);
  shaft.position.y = (h - 0.85) / 2 + 0.4;
  shaft.castShadow = true; shaft.receiveShadow = true;
  g.add(shaft);
  // Base plinth
  var base = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.55, 0.28, 1.55)), mat);
  base.position.y = 0.14; base.receiveShadow = true; g.add(base);
  var base2 = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.35, 0.18, 1.35)), mat);
  base2.position.y = 0.35; g.add(base2);
  // Capital — abacus + echinus rings
  var abacus = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.55, 0.18, 1.55)), mat);
  abacus.position.y = h - 0.08; abacus.castShadow = true; g.add(abacus);
  var ech = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.72, 0.58, 0.28, 16)), mat);
  ech.position.y = h - 0.32; ech.castShadow = true; g.add(ech);
  var neck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.15, 0.12, 1.15)), mat);
  neck.position.y = h - 0.5; g.add(neck);
  // Corner volute nubs (reads as ornate capital from distance)
  var gold = trackMat(new THREE.MeshStandardMaterial({
    color: 0xc9b896, roughness: 0.45, metalness: 0.15,
  }));
  for (var i = 0; i < 4; i++) {
    var ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    var vol = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.12, 0.045, 8, 12)), gold);
    vol.position.set(Math.cos(ang) * 0.62, h - 0.28, Math.sin(ang) * 0.62);
    vol.rotation.x = Math.PI / 2;
    g.add(vol);
  }
  g.position.set(x, 0, z);
  addCollider(x, z, 0.75, 0.75);
  return g;
}

function buildTable(x, z, w, d, rotY, clothMap) {
  var g = new THREE.Group();
  var wood = makeWoodMat(0x3a2818);
  var cloth = trackMat(new THREE.MeshStandardMaterial({
    map: clothMap || null,
    color: clothMap ? 0xffffff : 0x1a5538,
    roughness: 0.9, metalness: 0,
  }));
  var top = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, 0.08, d)), cloth);
  top.position.y = 0.85; top.castShadow = true; top.receiveShadow = true; g.add(top);
  var skirt = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w * 0.98, 0.52, d * 0.98)), cloth);
  skirt.position.y = 0.56; skirt.castShadow = true; g.add(skirt);
  var offs = [[-w/2+0.14,-d/2+0.14],[w/2-0.14,-d/2+0.14],[-w/2+0.14,d/2-0.14],[w/2-0.14,d/2-0.14]];
  for (var i = 0; i < 4; i++) {
    var leg = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.1, 0.85, 0.1)), wood);
    leg.position.set(offs[i][0], 0.425, offs[i][1]);
    leg.castShadow = true; g.add(leg);
  }
  var gold = trackMat(new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.45, metalness: 0.45 }));
  for (var pi = 0; pi < 2; pi++) {
    var mini = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.55, 0.04, 0.4)), gold);
    mini.position.set((pi - 0.5) * 0.9, 0.92, (pi % 2 === 0 ? 0.12 : -0.1));
    mini.rotation.y = (pi - 0.5) * 0.25;
    g.add(mini);
  }
  g.position.set(x, 0, z);
  if (rotY) g.rotation.y = rotY;
  addCollider(x, z, w / 2 + 0.12, d / 2 + 0.12);
  return g;
}

function buildEasel(x, z, rotY, paintingUrl) {
  var g = new THREE.Group();
  var wood = makeWoodMat(0x5a4030);
  function stick(sx, sy, sz, px, py, pz, rx, ry, rz) {
    var m = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(sx, sy, sz)), wood);
    m.position.set(px, py, pz);
    if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
    m.castShadow = true; g.add(m);
  }
  stick(0.07, 1.9, 0.07, -0.4, 0.95, 0, 0, 0, 0.14);
  stick(0.07, 1.9, 0.07, 0.4, 0.95, 0, 0, 0, -0.14);
  stick(0.07, 1.7, 0.07, 0, 0.9, -0.3, 0.22, 0, 0);
  stick(0.98, 0.06, 0.22, 0, 0.55, 0.06, 0, 0, 0);
  var frame = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.95, 1.2, 0.07)),
    trackMat(new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.45, metalness: 0.4 }))
  );
  frame.position.set(0, 1.2, 0.1); frame.castShadow = true; g.add(frame);
  var canvasMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x2a2418, roughness: 0.7 }));
  var canvas = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.82, 1.05)), canvasMat);
  canvas.position.set(0, 1.2, 0.145); g.add(canvas);
  g.userData.canvasMesh = canvas;
  g.userData.canvasMat = canvasMat;
  api._easelMeshes.push(g);
  if (paintingUrl) loadPaintingOnto(g, paintingUrl);
  g.position.set(x, 0, z);
  if (rotY) g.rotation.y = rotY;
  addCollider(x, z, 0.5, 0.4);
  return g;
}

function buildLeanCanvas(x, z, rotY) {
  var g = new THREE.Group();
  var wood = makeWoodMat(0x4a3424);
  var frame = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.05, 1.35, 0.08)), wood);
  frame.position.y = 0.78; frame.rotation.x = -0.38; frame.castShadow = true; g.add(frame);
  var canvasMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x1a1810, roughness: 0.75 }));
  var canvas = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.9, 1.18)), canvasMat);
  canvas.position.set(0, 0.78, 0.06); canvas.rotation.x = -0.38; g.add(canvas);
  g.userData.canvasMesh = canvas;
  g.userData.canvasMat = canvasMat;
  api._easelMeshes.push(g);
  g.position.set(x, 0, z);
  if (rotY) g.rotation.y = rotY;
  addCollider(x, z, 0.45, 0.35);
  return g;
}

function loadPaintingOnto(easelGroup, url) {
  if (!url || !easelGroup) return;
  loadTex(url, function (tex) {
    var mat = easelGroup.userData.canvasMat;
    if (mat) {
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    }
  });
}

function buildBanner(x, y, z, rotY) {
  var g = new THREE.Group();
  var tex = makeBannerTexture("GRAND EXCHANGE - ART FLOOR");
  var mat = trackMat(new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.75, side: THREE.DoubleSide,
  }));
  var plane = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(5.6, 1.25)), mat);
  g.add(plane);
  var wood = makeWoodMat(0x3a2818);
  var bar = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.04, 0.04, 5.8, 8)), wood);
  bar.rotation.z = Math.PI / 2; bar.position.y = 0.58; g.add(bar);
  g.position.set(x, y, z);
  if (rotY) g.rotation.y = rotY;
  return g;
}

function buildChandelier(x, y, z, castShadow) {
  var g = new THREE.Group();
  var gold = trackMat(new THREE.MeshStandardMaterial({
    color: 0xc9a227, roughness: 0.3, metalness: 0.78,
    emissive: 0x664400, emissiveIntensity: 0.45,
  }));
  var chain = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 8)), gold);
  chain.position.y = 0.55; g.add(chain);
  var bowl = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.4, 16, 12)), gold);
  bowl.scale.y = 0.42; bowl.castShadow = true; g.add(bowl);
  for (var i = 0; i < 6; i++) {
    var ang = (i / 6) * Math.PI * 2;
    var candle = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8)), gold);
    candle.position.set(Math.cos(ang) * 0.55, -0.1, Math.sin(ang) * 0.55); g.add(candle);
    var tip = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.07, 8, 8)),
      trackMat(new THREE.MeshStandardMaterial({
        color: 0xffe8a0, emissive: 0xffcc66, emissiveIntensity: 1.3, roughness: 1,
      }))
    );
    tip.position.set(Math.cos(ang) * 0.55, 0.05, Math.sin(ang) * 0.55); g.add(tip);
  }
  var light = new THREE.PointLight(0xffe2a0, 1.6, 22, 2);
  light.position.y = -0.2;
  light.castShadow = !!castShadow;
  if (castShadow) {
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.bias = -0.002;
  }
  g.add(light);
  g.position.set(x, y, z);
  return g;
}

function buildBooth(x, z) {
  var g = new THREE.Group();
  var wood = makeWoodMat(0x3a2818);
  var gold = trackMat(new THREE.MeshStandardMaterial({
    color: 0xc9a227, roughness: 0.4, metalness: 0.55,
    emissive: 0x553300, emissiveIntensity: 0.25,
  }));
  var desk = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.7, 1.1, 1.35)), wood);
  desk.position.y = 0.55; desk.castShadow = true; g.add(desk);
  var top = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.85, 0.08, 1.5)), gold);
  top.position.y = 1.14; g.add(top);
  var signC = document.createElement("canvas");
  signC.width = 512; signC.height = 256;
  var sctx = signC.getContext("2d");
  sctx.fillStyle = "#2a1a10"; sctx.fillRect(0, 0, 512, 256);
  sctx.strokeStyle = "#c9a227"; sctx.lineWidth = 14; sctx.strokeRect(10, 10, 492, 236);
  sctx.fillStyle = "#ffe066"; sctx.font = "bold 96px Georgia, serif";
  sctx.textAlign = "center"; sctx.textBaseline = "middle";
  sctx.fillText("GE", 256, 100);
  sctx.font = "bold 40px Georgia, serif"; sctx.fillStyle = "#e8d090";
  sctx.fillText("ART FLOOR DESK", 256, 180);
  var signTex = trackTex(new THREE.CanvasTexture(signC));
  signTex.colorSpace = THREE.SRGBColorSpace;
  var sign = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(1.8, 0.9)),
    trackMat(new THREE.MeshStandardMaterial({
      map: signTex, roughness: 0.65, emissive: 0x221100, emissiveIntensity: 0.4,
    }))
  );
  sign.position.set(0, 2.0, 0.1); g.add(sign);
  var glow = new THREE.PointLight(0xffcc66, 0.9, 10, 2);
  glow.position.set(0, 2.3, 0.6); g.add(glow);
  g.position.set(x, 0, z);
  addCollider(x, z, 1.45, 0.85);
  api._booth = { x: x, z: z, r: 3.2 };
  return g;
}

function buildBust(bx, bz) {
  var p = new THREE.Group();
  var pedMat = makeWoodMat(0x2a1a10);
  var stone = trackMat(new THREE.MeshStandardMaterial({ color: 0x8a7a68, roughness: 0.45, metalness: 0.3 }));
  var ped = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.4, 0.48, 1.0, 16)), pedMat);
  ped.position.y = 0.5; ped.castShadow = true; p.add(ped);
  var torso = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.5, 0.4, 0.3)), stone);
  torso.position.y = 1.2; p.add(torso);
  var head = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.28, 16, 12)), stone);
  head.position.y = 1.55; head.castShadow = true; p.add(head);
  p.position.set(bx, 0, bz);
  addCollider(bx, bz, 0.5, 0.5);
  return p;
}

function buildArchedWindow(x, y, z, exteriorTex) {
  var g = new THREE.Group();
  var frameMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xd4c8b4, roughness: 0.5, metalness: 0.08 }));
  var sillMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xc8bca8, roughness: 0.4, metalness: 0.1 }));
  // Deep recess into wall
  var recess = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.05, 3.7, 0.55)), frameMat);
  recess.position.z = -0.15; g.add(recess);
  // Exterior view plane (city haze) behind glass
  var viewMat = trackMat(new THREE.MeshStandardMaterial({
    map: exteriorTex || null,
    color: exteriorTex ? 0xffffff : 0xb8c8d8,
    emissive: 0xfff0d0,
    emissiveIntensity: 0.35,
    roughness: 0.85,
    metalness: 0,
  }));
  var view = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(1.55, 2.85)), viewMat);
  view.position.set(0, -0.05, -0.38); g.add(view);
  var archView = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(0.8, 24, 0, Math.PI)), viewMat);
  archView.position.set(0, 1.35, -0.37); g.add(archView);
  // Glass overlay
  var glassMat = trackMat(new THREE.MeshPhysicalMaterial({
    color: 0xd8e8f8,
    roughness: 0.12,
    metalness: 0.05,
    transmission: 0.55,
    transparent: true,
    opacity: 0.55,
    thickness: 0.2,
  }));
  var glass = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.52, 2.75, 0.04)), glassMat);
  glass.position.set(0, -0.08, 0.08); g.add(glass);
  var archGlass = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(0.78, 24, 0, Math.PI)), glassMat);
  archGlass.position.set(0, 1.35, 0.09); g.add(archGlass);
  // Mullions + arch frame
  var mullion = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.08, 2.75, 0.1)), frameMat);
  mullion.position.set(0, -0.08, 0.12); g.add(mullion);
  var cross = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.52, 0.08, 0.1)), frameMat);
  cross.position.set(0, 0.55, 0.12); g.add(cross);
  var sill = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.15, 0.12, 0.45)), sillMat);
  sill.position.set(0, -1.9, 0.05); g.add(sill);
  // Soft window light spilling inward
  var winGlow = new THREE.PointLight(0xfff2dc, 0.55, 9, 2);
  winGlow.position.set(0, 0.2, 0.6);
  g.add(winGlow);
  g.position.set(x, y, z);
  return g;
}

function buildFacingArrow() {
  var g = new THREE.Group();
  var mat = trackMat(new THREE.MeshStandardMaterial({
    color: 0xffe066, emissive: 0xaa8800, emissiveIntensity: 0.7,
    roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.9,
  }));
  var shaft = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.12, 0.025, 0.55)), mat);
  shaft.position.set(0, 0.04, -0.15); g.add(shaft);
  var head = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.14, 0.28, 8)), mat);
  head.rotation.x = -Math.PI / 2;
  head.position.set(0, 0.04, -0.52); g.add(head);
  return g;
}

/**
 * Gallery patrons — prefer offline Mixamo human GLBs (adult MetaHuman-like proportions).
 * Procedural fallback keeps continuous head→neck→shoulder→torso funnel, 5-finger hands,
 * calm solid gallery attire. Never: green waffle uniform, white collar plates, chest badge/pencil.
 */
var MAX_NPCS = 8;
var CHAR_ASSET_BASE = "assets/artfloor-characters/";
var TARGET_HUMAN_HEIGHT = 1.78; // adult meters — MetaHuman-ish

/**
 * Custom player hook (reusable for future paintings):
 * - CUSTOM_CHARACTER_GLB: TripoSR custom-character.glb (default) — unskinned TPS bob; Mixamo fallback
 * - CUSTOM_CHARACTER_URL: painting used as color reference only (NOT UV-wrapped on the mesh back)
 * Override via window.GE_CUSTOM_CHARACTER_URL / GE_CUSTOM_CHARACTER_GLB or ?customChar= / ?customGlb=
 */
var CUSTOM_CHARACTER_GLB = "glb/custom-character.glb";
var CUSTOM_CHARACTER_URL = "custom/golden-stasis.jpg";

function resolveCustomCharacterPaths() {
  try {
    if (typeof window !== "undefined") {
      if (window.GE_CUSTOM_CHARACTER_URL) CUSTOM_CHARACTER_URL = String(window.GE_CUSTOM_CHARACTER_URL);
      if (window.GE_CUSTOM_CHARACTER_GLB) CUSTOM_CHARACTER_GLB = String(window.GE_CUSTOM_CHARACTER_GLB);
      if (window.location && window.location.search) {
        var q = new URLSearchParams(window.location.search);
        if (q.get("customChar")) CUSTOM_CHARACTER_URL = q.get("customChar");
        if (q.get("customGlb")) CUSTOM_CHARACTER_GLB = q.get("customGlb");
      }
    }
  } catch (e) {}
  // Allow absolute or assets-relative paths
  function abs(p) {
    if (!p) return p;
    if (/^(https?:|data:|blob:|\/)/i.test(p) || p.indexOf("assets/") === 0) return p;
    return CHAR_ASSET_BASE + p.replace(/^\/+/, "");
  }
  // Bust CDN/browser cache when custom GLB/PBR maps change
  var bust = "v=19";
  function withBust(u) {
    if (!u) return u;
    return u + (u.indexOf("?") >= 0 ? "&" : "?") + bust;
  }
  return { glb: withBust(abs(CUSTOM_CHARACTER_GLB)), look: withBust(abs(CUSTOM_CHARACTER_URL)) };
}

/** Calm solid gallery attire palettes (no costume graphics). */
var NPC_PALETTES = [
  { id: "navy_suit", silhouette: "suit", coat: 0x1e2a44, pants: 0x141820, shirt: 0xeee6da, skin: 0xc8a888, hair: 0x6a5850, tie: 0x8a3030 },
  { id: "camel_coat", silhouette: "coat", coat: 0xb89a6a, pants: 0x2a2418, shirt: 0xf2ebe0, skin: 0xd4b496, hair: 0x5a4838, tie: 0x4a3830, longCoat: true },
  { id: "charcoal_suit", silhouette: "suit", coat: 0x2a2a30, pants: 0x1a1a1e, shirt: 0xf4efe6, skin: 0xd4b090, hair: 0x3a3028, tie: 0x5a4050 },
  { id: "burgundy_coat", silhouette: "coat", coat: 0x6a3040, pants: 0x1a1418, shirt: 0xe8ddd0, skin: 0xd0b090, hair: 0x4a3828, tie: 0x2a3040, longCoat: true },
  { id: "violet_dress", silhouette: "dress", coat: 0x5a3a68, pants: 0x5a3a68, shirt: 0x5a3a68, skin: 0xc4a090, hair: 0x1a1818, tie: 0x5a3a68, dress: true },
  { id: "teal_blazer", silhouette: "street", coat: 0x2a5a58, pants: 0x1a1c22, shirt: 0xd8cfc4, skin: 0xc4a890, hair: 0x3a3428, tie: 0x8a4038 },
  { id: "slate_hoodie", silhouette: "street", coat: 0x3a4a58, pants: 0x222830, shirt: 0xe8e0d4, skin: 0xb89878, hair: 0x2a2828, tie: 0x203040, hoodie: true },
  { id: "olive_casual", silhouette: "street", coat: 0x4a5a40, pants: 0x2a3028, shirt: 0xe6ddd0, skin: 0xc4a878, hair: 0x4a3828, tie: 0x3a4030 },
];

/** Gallery-attire solid tints applied onto Mixamo GLB materials (variety without chaotic textures). */
var GLB_ATTIRE_TINTS = [
  0x2a3448, // navy
  0xb89a6a, // camel
  0x2a2a30, // charcoal
  0x6a3040, // burgundy
  0x3a4a58, // slate
  0x4a5a40, // olive muted
  0x5a3a68, // violet
  0x2a5a58, // teal
];

function matStd(hex, rough, metal) {
  return trackMat(new THREE.MeshStandardMaterial({
    color: hex,
    roughness: rough != null ? rough : 0.7,
    metalness: metal != null ? metal : 0.04,
  }));
}

function addMesh(parent, geo, mat, px, py, pz, sx, sy, sz) {
  var m = new THREE.Mesh(trackGeo(geo), mat);
  m.position.set(px || 0, py || 0, pz || 0);
  if (sx != null) m.scale.set(sx, sy != null ? sy : sx, sz != null ? sz : sx);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function loadGltfAsync(url, onProgress) {
  return new Promise(function (resolve) {
    var loader = new GLTFLoader();
    loader.load(
      url,
      function (gltf) { resolve(gltf); },
      function (ev) {
        if (!onProgress) return;
        try {
          if (ev && ev.lengthComputable && ev.total > 0) {
            onProgress(ev.loaded / ev.total);
          } else if (ev && ev.loaded) {
            onProgress(null); // indeterminate but active
          }
        } catch (e) {}
      },
      function () { resolve(null); }
    );
  });
}

function loadTextureAsync(url, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    if (!url) { resolve(null); return; }
    var loader = new THREE.TextureLoader();
    loader.load(
      url,
      function (tex) {
        tex.colorSpace = THREE.SRGBColorSpace;
        // Cutout planes want flipY true; GLB-style atlases want false
        tex.flipY = opts.flipY != null ? !!opts.flipY : false;
        tex.anisotropy = 8;
        if (opts.premultiplyAlpha != null) tex.premultiplyAlpha = !!opts.premultiplyAlpha;
        resolve(trackTex(tex));
      },
      undefined,
      function () { resolve(null); }
    );
  });
}

async function loadCharacterLibrary() {
  if (api._charLibrary && api._charLibrary.glbs && api._charLibrary.glbs.length) {
    return api._charLibrary;
  }
  showLoader(true, "Loading custom character GLB…", 5);
  var lib = { glbs: [], custom: null, customLook: null, donor: null,
    goldDiffuse: null, goldMetal: null, goldRough: null };
  var paths = resolveCustomCharacterPaths();

  // Featured player first: open-source image→3D custom-character.glb
  showLoader(true, "Loading character…", 8);
  try {
    var customGlb = await loadGltfAsync(paths.glb, function (t) {
      if (t == null) showLoader(true, "Loading custom character GLB…", null);
      else showLoader(true, "Loading custom character GLB…", 8 + t * 55);
    });
    if (customGlb && customGlb.scene) {
      lib.custom = { id: CUSTOM_CHARACTER_GLB, gltf: customGlb, lookUrl: paths.look };
      showLoader(true, "Character ready — loading gallery…", 65);
    } else {
      showLoader(true, "Character missing — loading fallback…", 40);
    }
  } catch (e) {
    showLoader(true, "Character load error — fallback…", 40);
  }

  // Gallery crowd (calm Mixamo walkers)
  var glbFiles = ["glb/Soldier.glb", "glb/Xbot.glb"];
  for (var gi = 0; gi < glbFiles.length; gi++) {
    var basePct = 65 + gi * 12;
    showLoader(true, "Loading gallery patrons…", basePct);
    var g = await loadGltfAsync(CHAR_ASSET_BASE + glbFiles[gi], function (t) {
      if (t == null) return;
      showLoader(true, "Loading gallery patrons…", basePct + t * 12);
    });
    if (g && g.scene) {
      var entry = { id: glbFiles[gi], gltf: g };
      lib.glbs.push(entry);
      if (!lib.donor && g.animations && g.animations.some(function (c) { return /walk/i.test(c.name); })) {
        lib.donor = entry;
      }
    }
  }

  // Front painting = palette reference only (never applied as mesh atlas / never wrapped onto back).
  showLoader(true, "Finishing Art Floor…", 92);
  lib.customLook = await loadTextureAsync(paths.look, { flipY: false });
  showLoader(true, "Almost ready…", 97);

  api._charLibrary = lib;
  return lib;
}

/**
 * Recolor Mixamo GLB materials toward calm gallery attire solids.
 * Keeps skin-like materials warmer; pushes clothing toward palette hex.
 */
function applyGalleryAttireTint(root, attireHex, skinBias) {
  var attire = new THREE.Color(attireHex);
  var warm = new THREE.Color(skinBias != null ? skinBias : 0xd4b896);
  root.traverse(function (o) {
    if (!o.isMesh || !o.material) return;
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    for (var i = 0; i < mats.length; i++) {
      var m = mats[i];
      if (!m || !m.color) continue;
      m = m.clone();
      trackMat(m);
      mats[i] = m;
      var name = ((m.name || "") + " " + (o.name || "")).toLowerCase();
      var isSkin = /skin|face|head|hand|arm|leg|body(?!mat)|flesh|beta_highlimbs|limb/i.test(name);
      var isVisor = /visor|eye|glass/i.test(name);
      if (isVisor) {
        m.color.setHex(0x1a1a22);
        m.metalness = Math.max(m.metalness || 0, 0.4);
        m.roughness = Math.min(m.roughness != null ? m.roughness : 0.5, 0.35);
      } else if (isSkin) {
        m.color.lerp(warm, 0.55);
        m.roughness = Math.max(m.roughness != null ? m.roughness : 0.6, 0.55);
        m.metalness = Math.min(m.metalness || 0, 0.08);
      } else {
        // Clothing / armor / joints → calm attire solid with slight map keep
        m.color.copy(attire);
        if (m.map) {
          // Mute textured military look toward solid gallery cloth
          m.color.lerp(new THREE.Color(0xffffff), 0.15);
          m.roughness = Math.max(m.roughness != null ? m.roughness : 0.7, 0.62);
        } else {
          m.roughness = 0.72;
        }
        m.metalness = Math.min(m.metalness || 0, 0.12);
        m.emissive && m.emissive.setHex(0x000000);
        if (m.emissiveIntensity != null) m.emissiveIntensity = 0;
      }
    }
    o.material = Array.isArray(o.material) ? mats : mats[0];
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

/**
 * Eyedropper palette from the custom gold-jumpsuit painting (look reference only — not a character name).
 * Visibility-first: Mixamo Michelle ships MeshPhysicalMaterial + gloss metalnessMap (B≈1) which, at
 * high metalness with no scene.environment, shades the whole body near-black/invisible. We rebuild
 * opaque MeshStandardMaterials so the contoured mesh stays fully visible while walking.
 */
var GOLDEN_STASIS_PALETTE = {
  gold: 0xd4af37,    // eyedropper mid gold from jumpsuit painting
  goldHi: 0xf7e69c,  // highlight gold
  goldLo: 0x7a5c2d,  // shadow bronze
  skin: 0xf5d1b0,    // face/hands
  hair: 0x1a120b,    // dark hair
  scarf: 0x0d0d0d,   // black scarf accent
  heel: 0x5a3e2b,
};

function findBone(root, re) {
  var found = null;
  root.traverse(function (o) {
    if (found || !o.isBone) return;
    if (re.test(o.name || "")) found = o;
  });
  return found;
}

/** Strip maps/flags that can wipe a skinned body when no env map is present. */
function forceOpaqueVisibleMat(mat) {
  if (!mat) return mat;
  mat.transparent = false;
  mat.opacity = 1;
  mat.alphaTest = 0;
  mat.depthWrite = true;
  mat.depthTest = true;
  mat.side = THREE.DoubleSide;
  mat.blending = THREE.NormalBlending;
  // CRITICAL: maps (esp. Mixamo gloss metalnessMap) black-out the body with no env map
  mat.map = null;
  mat.metalnessMap = null;
  mat.roughnessMap = null;
  mat.normalMap = null;
  mat.aoMap = null;
  mat.alphaMap = null;
  mat.emissiveMap = null;
  mat.bumpMap = null;
  mat.displacementMap = null;
  mat.envMap = null;
  if (mat.specularColorMap) mat.specularColorMap = null;
  if (mat.specularIntensityMap) mat.specularIntensityMap = null;
  if (mat.transmission != null) mat.transmission = 0;
  if (mat.emissive) mat.emissive.setHex(0x000000);
  if (mat.emissiveIntensity != null) mat.emissiveIntensity = 0;
  mat.needsUpdate = true;
  return mat;
}

/**
 * Visibility-first gold jumpsuit on ANY Mixamo GLB (Michelle / Soldier / Xbot).
 * Solid MeshStandardMaterial only — metalness ≤ 0.4, roughness ≥ 0.5, NO texture maps
 * (painting atlas / Mixamo metalnessMap / gold-flake maps all caused invisible or shoes-only bodies).
 * Front painting is never wrapped onto the mesh. No "Golden Stasis" nameplate.
 */
/**
 * Painting-projected albedo on TripoSR mesh (Golden Stasis). Soft metal/rough maps
 * for lurex sheen — never multiply COLOR_0 or high-contrast masks into albedo.
 * Falls back to opaque gold solids when the mesh has no color data.
 */
function applyTexturedCustomLook(root) {
  var hasColor = false;
  root.traverse(function (o) {
    if (!o.isMesh) return;
    o.visible = true;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    // TripoSR meshes may ship without normals
    if (o.geometry) {
      if (!o.geometry.attributes.normal) {
        try { o.geometry.computeVertexNormals(); } catch (eNorm) {}
      }
      // Painting-projected albedo must NOT multiply with COLOR_0 (old blotchy verts).
      // Drop color attr when a base map is present so MeshStandard never darkens gold.
      if (o.geometry.attributes.color && (o.material && (Array.isArray(o.material) ? o.material[0] : o.material) && (Array.isArray(o.material) ? o.material[0].map : o.material.map))) {
        try { o.geometry.deleteAttribute("color"); } catch (eDel) {}
      }
    }
    var mats = Array.isArray(o.material) ? o.material.slice() : [o.material];
    for (var i = 0; i < mats.length; i++) {
      var m = mats[i];
      if (!m) continue;
      var map = m.map || null;
      var metalMap = m.metalnessMap || null;
      var roughMap = m.roughnessMap || null;
      var normMap = m.normalMap || null;
      if (map) {
        map.colorSpace = THREE.SRGBColorSpace;
        map.flipY = false;
        map.anisotropy = 8;
        map.generateMipmaps = true;
        map.minFilter = THREE.LinearMipmapLinearFilter;
        map.magFilter = THREE.LinearFilter;
        map.needsUpdate = true;
        // Safe: remove COLOR_0 so mip filtering cannot multiply blotches
        if (o.geometry && o.geometry.attributes && o.geometry.attributes.color) {
          try { o.geometry.deleteAttribute("color"); } catch (eDel2) {}
        }
      }
      // Soft authored metal/rough (not high-contrast masks) — linear color space
      if (metalMap) { metalMap.colorSpace = THREE.NoColorSpace; metalMap.flipY = false; metalMap.needsUpdate = true; }
      if (roughMap) { roughMap.colorSpace = THREE.NoColorSpace; roughMap.flipY = false; roughMap.needsUpdate = true; }
      if (normMap) { normMap.colorSpace = THREE.NoColorSpace; normMap.flipY = false; normMap.needsUpdate = true; }
      var hasGeoColor = !!(o.geometry && o.geometry.attributes && o.geometry.attributes.color);
      // Prefer painting-projected albedo; never multiply vertexColors onto it
      var vertexColors = !map && !!(m.vertexColors || hasGeoColor);
      var color;
      if (map) {
        color = new THREE.Color(0xffffff);
      } else if (vertexColors) {
        color = new THREE.Color(0xffffff);
      } else if (m.color && m.color.clone) {
        color = m.color.clone();
      } else {
        color = new THREE.Color(GOLDEN_STASIS_PALETTE.gold);
      }
      if (map || metalMap || roughMap || normMap || vertexColors || hasGeoColor
          || (m.color && m.color.getHex && m.color.getHex() !== 0xffffff)) hasColor = true;
      // Soft PBR: maps already encode lurex sheen; keep factors at 1 so maps read true.
      // Without maps, use calm gold scalars (never near-0 roughness chrome black-out).
      var metalness = m.metalness != null ? m.metalness : (metalMap ? 1.0 : 0.62);
      if (!metalMap && metalness > 0.8) metalness = 0.8;
      if (metalness < 0.05 && !metalMap) metalness = 0.45;
      var roughness = m.roughness != null ? m.roughness : (roughMap ? 1.0 : 0.42);
      if (!roughMap && roughness < 0.22) roughness = 0.22;
      var nm = trackMat(new THREE.MeshStandardMaterial({
        color: color,
        map: map,
        metalnessMap: metalMap,
        roughnessMap: roughMap,
        normalMap: normMap,
        normalScale: new THREE.Vector2(0.48, 0.48),
        vertexColors: vertexColors,
        roughness: roughness,
        metalness: metalness,
        envMapIntensity: 1.18,
        transparent: false,
        opacity: 1,
        depthWrite: true,
        side: THREE.DoubleSide,
        flatShading: false,
      }));
      nm.aoMap = null;
      nm.alphaMap = null;
      nm.emissiveMap = null;
      // Tiny warm lift — painting gold stays readable without washing skin/makeup
      if (nm.emissive) nm.emissive.setHex(0x181008);
      nm.emissiveIntensity = 0.045;
      nm.needsUpdate = true;
      mats[i] = nm;
    }
    o.material = mats.length === 1 ? mats[0] : mats;
  });
  if (!hasColor) {
    applyOpaqueGoldPlayerLook(root);
  }
  var skinned = 0;
  root.traverse(function (o) { if (o.isSkinnedMesh) skinned++; });
  root.userData.skinnedMeshCount = skinned;
  root.userData.texturedCustom = true;
  return skinned;
}

function applyOpaqueGoldPlayerLook(root) {
  var goldMat = trackMat(new THREE.MeshStandardMaterial({
    color: GOLDEN_STASIS_PALETTE.gold,
    roughness: 0.58,
    metalness: 0.32,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    side: THREE.DoubleSide,
  }));
  forceOpaqueVisibleMat(goldMat);

  var skinMat = trackMat(new THREE.MeshStandardMaterial({
    color: GOLDEN_STASIS_PALETTE.skin,
    roughness: 0.72,
    metalness: 0.05,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    side: THREE.DoubleSide,
  }));
  forceOpaqueVisibleMat(skinMat);

  var hairMat = trackMat(new THREE.MeshStandardMaterial({
    color: GOLDEN_STASIS_PALETTE.hair,
    roughness: 0.9,
    metalness: 0.02,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    side: THREE.DoubleSide,
  }));
  forceOpaqueVisibleMat(hairMat);

  var shoeMat = trackMat(new THREE.MeshStandardMaterial({
    color: GOLDEN_STASIS_PALETTE.heel,
    roughness: 0.65,
    metalness: 0.15,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    side: THREE.DoubleSide,
  }));
  forceOpaqueVisibleMat(shoeMat);

  var skinned = 0;
  root.traverse(function (o) {
    if (!o.isMesh) return;
    o.visible = true;
    o.castShadow = true;
    o.receiveShadow = true;
    if (o.isSkinnedMesh) {
      skinned++;
      o.frustumCulled = false;
      // Force valid bind/skeleton state so the body stands on +Y
      if (o.skeleton) o.skeleton.update();
      o.computeBoundingSphere();
    }
    var name = (((o.material && o.material.name) || "") + " " + (o.name || "")).toLowerCase();
    var mat = goldMat;
    if (/hair|scalp|brow/i.test(name)) mat = hairMat;
    else if (/visor|eye|glass/i.test(name)) mat = hairMat;
    else if (/shoe|boot|heel|sole|footwear/i.test(name)) mat = shoeMat;
    // Michelle is a single Ch03_Body mesh — whole figure stays opaque gold (visible).
    // Soldier/Xbot mesh names rarely include "skin"; keep gold so the full body reads.
    o.material = mat;
  });
  root.userData.skinnedMeshCount = skinned;
  return skinned;
}

// Back-compat alias
function applyGoldenStasisLook(root, lookTex) {
  void lookTex;
  return applyOpaqueGoldPlayerLook(root);
}

/**
 * Michelle ships with SambaDance only — borrow Walk/Idle from Soldier/Xbot.
 * Same Mixamo mixamorig:* bone names, so clips bind directly on her mixer.
 */
function collectLocomotionClips(entry, donor) {
  var clips = { walk: null, idle: null };
  function dig(gltf) {
    if (!gltf || !gltf.animations) return;
    for (var i = 0; i < gltf.animations.length; i++) {
      var c = gltf.animations[i];
      if (!clips.walk && /walk/i.test(c.name)) clips.walk = c;
      if (!clips.idle && /idle/i.test(c.name)) clips.idle = c;
    }
  }
  dig(entry && entry.gltf);
  dig(donor && donor.gltf);
  return clips;
}


/** If a TripoSR mesh still ships X/Z-long (sideways), rotate so height is +Y. */
function uprightCustomIfNeeded(model) {
  model.updateMatrixWorld(true);
  var box = new THREE.Box3().setFromObject(model);
  var size = new THREE.Vector3();
  box.getSize(size);
  if (!(size.x > 0 && size.y > 0 && size.z > 0)) return;
  if (size.x >= size.y && size.x >= size.z) {
    // Long axis was X (feet/head along X) → +90° about Z → head +Y
    model.rotateZ(Math.PI / 2);
  } else if (size.z >= size.y && size.z >= size.x) {
    // Long axis was Z (Z-up source) → -90° about X → head +Y
    model.rotateX(-Math.PI / 2);
  }
  model.updateMatrixWorld(true);
}

function buildGltfCharacter(entry, opts) {
  opts = opts || {};
  var root = new THREE.Group();
  // Skinned Mixamo meshes need SkeletonUtils.clone (plain clone breaks bindings)
  var model = SkeletonUtils.clone(entry.gltf.scene);
  // Ensure model itself is visible / Y-up
  model.visible = true;
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.position.set(0, 0, 0);

  var isCustom = !!(opts.keepTexture || /custom-character/i.test(entry.id || ""));
  if (isCustom) {
    uprightCustomIfNeeded(model);
    // TripoSR front is +Z; game forward is -Z — yaw π so TPS-behind shows her back, orbit shows sides
    model.rotation.y = Math.PI;
  }

  if (isCustom) {
    applyTexturedCustomLook(model);
    root.userData.skinnedMeshCount = model.userData.skinnedMeshCount || 0;
    root.userData.unskinnedTps = !(root.userData.skinnedMeshCount > 0);
  } else if (opts.customLook || opts.opaqueGold) {
    applyOpaqueGoldPlayerLook(model);
    root.userData.skinnedMeshCount = model.userData.skinnedMeshCount || 0;
  } else {
    applyGalleryAttireTint(
      model,
      opts.attire != null ? opts.attire : GLB_ATTIRE_TINTS[0],
      opts.skin != null ? opts.skin : 0xd4b896
    );
    model.traverse(function (o) {
      if (!o.isMesh) return;
      o.visible = true;
      if (o.isSkinnedMesh) o.frustumCulled = false;
      // Strip dangerous maps on NPCs too when present
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      for (var mi = 0; mi < mats.length; mi++) {
        if (mats[mi] && mats[mi].metalnessMap) {
          mats[mi].metalnessMap = null;
          mats[mi].metalness = Math.min(mats[mi].metalness || 0, 0.2);
          mats[mi].needsUpdate = true;
        }
      }
    });
  }

  // Pose once so skinned bbox reflects standing bind, not a collapsed envelope
  model.updateMatrixWorld(true);
  model.traverse(function (o) {
    if (o.isSkinnedMesh && o.skeleton) o.skeleton.update();
  });
  model.updateMatrixWorld(true);

  var box = new THREE.Box3().setFromObject(model);
  var size = new THREE.Vector3();
  box.getSize(size);
  // Guard against degenerate / flat skinned bounds (shoes-only bug)
  var rawH = size.y;
  if (!isFinite(rawH) || rawH < 0.35) {
    // Fallback: estimate from hip→head bones (Mixamo Y-up)
    var hips = findBone(model, /Hips$/i);
    var head = findBone(model, /Head$/i);
    if (hips && head) {
      var hp = new THREE.Vector3();
      var hd = new THREE.Vector3();
      hips.getWorldPosition(hp);
      head.getWorldPosition(hd);
      rawH = Math.max(0.35, Math.abs(hd.y - hp.y) * 1.65);
    } else {
      rawH = 1.7;
    }
  }
  var targetH = TARGET_HUMAN_HEIGHT * (opts.scale || 1);
  var s = targetH / Math.max(0.35, rawH);
  // Never allow non-uniform / negative scale
  s = Math.abs(s) || 1;
  if (s > 8) s = targetH / 1.7; // insane bbox → assume ~1.7m source
  if (s < 0.05) s = targetH / 1.7;
  model.scale.set(s, s, s);
  model.updateMatrixWorld(true);
  model.traverse(function (o) {
    if (o.isSkinnedMesh && o.skeleton) o.skeleton.update();
  });
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  model.position.y = isFinite(box.min.y) ? -box.min.y : 0;
  root.add(model);

  // Locomotion: prefer NATIVE clips on this GLB. Only borrow Walk/Idle when the
  // entry has none (Michelle). Borrowing Soldier Idle onto Michelle previously
  // collapsed her into a floor pancake (shoes + facing-arrow only).
  var mixer = null;
  var actions = {};
  var donor = (api._charLibrary && api._charLibrary.donor) || null;
  var nativeHasWalk = !!(entry.gltf.animations || []).some(function (c) { return /walk/i.test(c.name); });
  var allowBorrow = opts.borrowLocomotion !== false && !nativeHasWalk;
  // Hard-disable borrow for known-fragile Michelle unless explicitly forced
  if (/michelle/i.test(entry.id || "") && opts.forceBorrow !== true) allowBorrow = false;
  var loco = collectLocomotionClips(entry, allowBorrow ? donor : null);
  var nativeAnims = (entry.gltf.animations && entry.gltf.animations.length) ? entry.gltf.animations : [];
  if (loco.walk || loco.idle || nativeAnims.length) {
    mixer = new THREE.AnimationMixer(model);
    var walkClip = loco.walk;
    var idleClip = loco.idle;
    // If no Walk (Michelle), use a gentle SambaDance weight as "walk" substitute only when moving
    if (!walkClip && /michelle/i.test(entry.id || "")) {
      for (var ai = 0; ai < nativeAnims.length; ai++) {
        if (/samba|dance/i.test(nativeAnims[ai].name)) { walkClip = nativeAnims[ai]; break; }
      }
    }
    var clip = walkClip || idleClip || nativeAnims[0];
    if (walkClip) actions.walk = mixer.clipAction(walkClip);
    if (idleClip) actions.idle = mixer.clipAction(idleClip);
    if (!actions.walk && clip) actions.walk = mixer.clipAction(clip);
    if (actions.idle) {
      actions.idle.play();
      actions.idle.setEffectiveWeight(1);
    } else if (actions.walk) {
      // No idle — hold walk at low weight so bind isn't overwritten by a foreign Idle
      actions.walk.play();
      actions.walk.setEffectiveWeight(0.01);
      actions.walk.paused = true;
    }
    if (actions.walk) {
      if (!actions.walk.isRunning || !actions.walk.isRunning()) actions.walk.play();
      if (actions.idle) actions.walk.setEffectiveWeight(0);
      actions.walk.setLoop(THREE.LoopRepeat, Infinity);
    }
    root.userData.mixer = mixer;
    root.userData.actions = actions;
    api._mixers.push(mixer);
  }

  if (opts.isPlayer) {
    var arrow = buildFacingArrow();
    arrow.position.set(0, 0.02, 0);
    root.add(arrow);
    api._facingArrow = arrow;
  }

  root.updateMatrixWorld(true);
  var bb = new THREE.Box3().setFromObject(root);
  var groundY = isFinite(bb.min.y) ? -bb.min.y : 0;
  if (groundY) root.position.y += groundY;
  bb.setFromObject(root);
  var finalSize = new THREE.Vector3();
  bb.getSize(finalSize);
  root.userData.bboxHeight = finalSize.y;
  try {
    console.info("[artfloor-player]", entry.id, "skinned=" + (root.userData.skinnedMeshCount || model.userData.skinnedMeshCount || "?"),
      "rawH=" + rawH.toFixed(3), "scale=" + s.toFixed(3),
      "bboxY=" + finalSize.y.toFixed(3), "walk=" + !!(actions && actions.walk), "idle=" + !!(actions && actions.idle));
  } catch (e) {}

  root.userData.charKind = "gltf";
  root.userData.walkAmp = 0;
  root.userData.limbs = { phase: 0, groundY: root.position.y };
  root.userData.isPlayer = !!opts.isPlayer;
  root.userData.modelId = entry.id;
  // Unskinned image→3D meshes get procedural TPS root bob (no Mixamo skeleton).
  if (!root.userData.mixer && (root.userData.unskinnedTps || !(root.userData.skinnedMeshCount > 0))) {
    root.userData.unskinnedTps = true;
    root.userData.bobBaseY = root.position.y;
  }
  return root;
}

/**
 * MetaHuman-ish lathe: hips → waist → chest → shoulder flare → continuous neck stump.
 * Head is ~1/7.5 of standing height (NOT bobblehead).
 */
function makeTorsoShellGeo() {
  var pts = [
    new THREE.Vector2(0.01, 0.00),
    new THREE.Vector2(0.17, 0.02),   // hips
    new THREE.Vector2(0.18, 0.10),
    new THREE.Vector2(0.15, 0.26),   // waist
    new THREE.Vector2(0.16, 0.38),
    new THREE.Vector2(0.19, 0.50),   // lower chest
    new THREE.Vector2(0.22, 0.62),   // chest
    new THREE.Vector2(0.26, 0.72),   // shoulder flare
    new THREE.Vector2(0.20, 0.78),
    new THREE.Vector2(0.10, 0.84),   // neck root (continuous funnel)
    new THREE.Vector2(0.068, 0.92),
    new THREE.Vector2(0.062, 1.00),  // neck top blends into head
    new THREE.Vector2(0.01, 1.02),
  ];
  return new THREE.LatheGeometry(pts, 24);
}

/** Palm + thumb + 4 fingers (tapered segments). side: -1 left, +1 right. */
function buildHand(skinMat, side) {
  var g = new THREE.Group();
  addMesh(g, new THREE.BoxGeometry(0.068, 0.088, 0.028), skinMat, 0, -0.045, 0.006);
  addMesh(g, new THREE.CapsuleGeometry(0.026, 0.045, 4, 8), skinMat, 0, -0.040, 0.002, 1.2, 1, 0.6);

  var specs = [
    { x: -0.026, z: 0.006, len: 0.048, r: 0.0078 },
    { x: -0.009, z: 0.012, len: 0.058, r: 0.0088 },
    { x: 0.009, z: 0.013, len: 0.062, r: 0.0092 },
    { x: 0.026, z: 0.008, len: 0.054, r: 0.0084 },
  ];
  for (var i = 0; i < specs.length; i++) {
    var s = specs[i];
    var fg = new THREE.Group();
    fg.position.set(s.x * side, -0.088, s.z);
    addMesh(fg, new THREE.CylinderGeometry(s.r * 0.72, s.r, s.len * 0.55, 6), skinMat, 0, -s.len * 0.28, 0);
    addMesh(fg, new THREE.CylinderGeometry(s.r * 0.55, s.r * 0.72, s.len * 0.45, 6), skinMat, 0, -s.len * 0.72, 0);
    addMesh(fg, new THREE.SphereGeometry(s.r * 0.5, 6, 5), skinMat, 0, -s.len, 0);
    g.add(fg);
  }
  var thumb = new THREE.Group();
  thumb.position.set(0.034 * side, -0.032, 0.016);
  thumb.rotation.z = side * 0.85;
  thumb.rotation.x = -0.55;
  thumb.rotation.y = side * 0.25;
  addMesh(thumb, new THREE.CylinderGeometry(0.007, 0.010, 0.026, 6), skinMat, 0, -0.012, 0);
  addMesh(thumb, new THREE.CylinderGeometry(0.0055, 0.007, 0.022, 6), skinMat, 0, -0.034, 0);
  addMesh(thumb, new THREE.SphereGeometry(0.0065, 6, 5), skinMat, 0, -0.048, 0);
  g.add(thumb);
  return g;
}

function buildArm(sleeveMat, skinMat, side) {
  var arm = new THREE.Group();
  arm.position.set(side * 0.28, 0.72, 0);
  addMesh(arm, new THREE.CapsuleGeometry(0.078, 0.07, 6, 12), sleeveMat, side * -0.02, 0.02, 0, 1.3, 0.72, 1.0);
  addMesh(arm, new THREE.CylinderGeometry(0.048, 0.072, 0.36, 12), sleeveMat, 0, -0.17, 0);
  addMesh(arm, new THREE.CapsuleGeometry(0.05, 0.04, 4, 10), sleeveMat, 0, -0.34, 0, 1.05, 0.7, 1.05);

  var fore = new THREE.Group();
  fore.position.set(0, -0.36, 0);
  addMesh(fore, new THREE.CylinderGeometry(0.038, 0.050, 0.34, 12), sleeveMat, 0, -0.12, 0);
  addMesh(fore, new THREE.CylinderGeometry(0.034, 0.040, 0.07, 10), sleeveMat, 0, -0.28, 0);
  addMesh(fore, new THREE.CylinderGeometry(0.030, 0.034, 0.035, 10), skinMat, 0, -0.32, 0);

  var hand = buildHand(skinMat, side);
  hand.position.set(0, -0.36, 0);
  fore.add(hand);
  arm.add(fore);
  return { arm: arm, fore: fore };
}

function buildLeg(pantsMat, shoeMat, side, hideMeshes) {
  var leg = new THREE.Group();
  leg.position.set(side * 0.10, 0.94, 0);
  addMesh(leg, new THREE.CapsuleGeometry(0.088, 0.05, 5, 10), pantsMat, side * -0.01, -0.02, 0, 1.12, 0.7, 1.05);
  addMesh(leg, new THREE.CylinderGeometry(0.066, 0.088, 0.42, 12), pantsMat, 0, -0.24, 0);
  addMesh(leg, new THREE.CapsuleGeometry(0.064, 0.04, 4, 10), pantsMat, 0, -0.45, 0, 1.05, 0.65, 1.05);

  var shin = new THREE.Group();
  shin.position.set(0, -0.47, 0);
  addMesh(shin, new THREE.CylinderGeometry(0.050, 0.066, 0.40, 12), pantsMat, 0, -0.17, 0);
  addMesh(shin, new THREE.CylinderGeometry(0.044, 0.050, 0.07, 10), pantsMat, 0, -0.36, 0);
  addMesh(shin, new THREE.BoxGeometry(0.11, 0.06, 0.24), shoeMat, 0, -0.42, 0.045);
  addMesh(shin, new THREE.BoxGeometry(0.10, 0.045, 0.07), shoeMat, 0, -0.38, -0.07);
  leg.add(shin);

  if (hideMeshes) {
    leg.traverse(function (o) { if (o.isMesh) o.visible = false; });
  }
  return { leg: leg, shin: shin };
}

/**
 * Procedural MetaHuman-proportion humanoid (fallback when GLB missing).
 * Continuous silhouette; plain gallery clothing volumes — no collar tabs / badge / pencil art.
 */
function buildHumanoid(opts) {
  opts = opts || {};
  var coatHex = opts.coat != null ? opts.coat : 0x2a2a30;
  var pantsHex = opts.pants != null ? opts.pants : 0x1a1a1e;
  var skinHex = opts.skin != null ? opts.skin : 0xd4b896;
  var shirtHex = opts.shirt != null ? opts.shirt : 0xf0e6d8;
  var hairHex = opts.hair != null ? opts.hair : 0x3a2918;
  var tieHex = opts.tie != null ? opts.tie : 0x5a4050;
  var isDress = !!opts.dress;
  var isLongCoat = !!opts.longCoat;
  var isHoodie = !!opts.hoodie;
  var isPlayer = !!opts.isPlayer;
  var scale = opts.scale || 1;

  var root = new THREE.Group();
  var rig = new THREE.Group();
  root.add(rig);

  var skinMat = matStd(skinHex, 0.52, 0.02);
  var coatMat = matStd(coatHex, isDress ? 0.62 : 0.74, 0.05);
  var pantsMat = matStd(pantsHex, 0.8, 0.03);
  var shirtMat = matStd(shirtHex, 0.88, 0);
  var hairMat = matStd(hairHex, 0.92, 0);
  var shoeMat = matStd(0x1a1410, 0.55, 0.15);
  var tieMat = matStd(tieHex, 0.65, 0.05);

  var Lleg = buildLeg(pantsMat, shoeMat, -1, isDress);
  var Rleg = buildLeg(pantsMat, shoeMat, 1, isDress);
  rig.add(Lleg.leg);
  rig.add(Rleg.leg);
  if (isDress) {
    var lShoe = addMesh(rig, new THREE.BoxGeometry(0.10, 0.05, 0.20), shoeMat, -0.10, 0.035, 0.035);
    lShoe.userData.dressShoe = "L";
    var rShoe = addMesh(rig, new THREE.BoxGeometry(0.10, 0.05, 0.20), shoeMat, 0.10, 0.035, 0.035);
    rShoe.userData.dressShoe = "R";
  }

  var torso = new THREE.Group();
  torso.position.y = 0.92;

  // Continuous body shell (skin or dress fabric)
  addMesh(torso, makeTorsoShellGeo(), isDress ? coatMat : skinMat, 0, 0, 0);

  if (isDress) {
    addMesh(torso, new THREE.CapsuleGeometry(0.20, 0.38, 8, 14), coatMat, 0, 0.38, 0, 1.06, 1, 0.92);
    addMesh(torso, new THREE.CylinderGeometry(0.34, 0.19, 0.55, 18), coatMat, 0, 0.00, 0);
    // soft neckline only — no collar plates
    addMesh(torso, new THREE.SphereGeometry(0.12, 14, 10), shirtMat, 0, 0.58, 0.06, 1.1, 0.45, 0.65);
  } else if (isLongCoat) {
    addMesh(torso, new THREE.CapsuleGeometry(0.21, 0.46, 8, 14), coatMat, 0, 0.38, 0, 1.06, 1.02, 0.95);
    addMesh(torso, new THREE.CylinderGeometry(0.26, 0.20, 0.52, 14), coatMat, 0, -0.02, 0.02);
    // plain shirt slit + slim tie (not a pencil graphic)
    addMesh(torso, new THREE.BoxGeometry(0.12, 0.24, 0.04), shirtMat, 0, 0.56, 0.16);
    addMesh(torso, new THREE.BoxGeometry(0.035, 0.22, 0.025), tieMat, 0, 0.50, 0.185);
    var lapL = addMesh(torso, new THREE.BoxGeometry(0.08, 0.36, 0.04), coatMat, -0.11, 0.48, 0.17);
    lapL.rotation.z = 0.12;
    var lapR = addMesh(torso, new THREE.BoxGeometry(0.08, 0.36, 0.04), coatMat, 0.11, 0.48, 0.17);
    lapR.rotation.z = -0.12;
  } else if (isHoodie) {
    addMesh(torso, new THREE.CapsuleGeometry(0.22, 0.44, 8, 14), coatMat, 0, 0.38, 0, 1.08, 1, 0.98);
    addMesh(torso, new THREE.BoxGeometry(0.26, 0.12, 0.07), coatMat, 0, 0.24, 0.18);
    addMesh(torso, new THREE.TorusGeometry(0.11, 0.03, 8, 14), coatMat, 0, 0.82, -0.06);
  } else {
    // plain suit / blazer — continuous torso, soft shirt V, slim tie; NO collar tabs / badge
    addMesh(torso, new THREE.CapsuleGeometry(0.205, 0.42, 8, 14), coatMat, 0, 0.38, 0, 1.08, 1.0, 0.92);
    addMesh(torso, new THREE.BoxGeometry(0.12, 0.26, 0.04), shirtMat, 0, 0.54, 0.16);
    addMesh(torso, new THREE.BoxGeometry(0.035, 0.22, 0.025), tieMat, 0, 0.48, 0.185);
    var lpl = addMesh(torso, new THREE.BoxGeometry(0.08, 0.34, 0.035), coatMat, -0.11, 0.46, 0.17);
    lpl.rotation.z = 0.10;
    var lpr = addMesh(torso, new THREE.BoxGeometry(0.08, 0.34, 0.035), coatMat, 0.11, 0.46, 0.17);
    lpr.rotation.z = -0.10;
  }

  // Soft shoulder pads elongated into sleeve line
  addMesh(torso, new THREE.CapsuleGeometry(0.082, 0.09, 6, 12), coatMat, -0.24, 0.68, 0, 1.35, 0.68, 1.0);
  addMesh(torso, new THREE.CapsuleGeometry(0.082, 0.09, 6, 12), coatMat, 0.24, 0.68, 0, 1.35, 0.68, 1.0);

  // NOTE: intentionally NO gold chest badge / pin / pencil / white collar plates

  var Larm = buildArm(coatMat, skinMat, -1);
  var Rarm = buildArm(coatMat, skinMat, 1);
  torso.add(Larm.arm);
  torso.add(Rarm.arm);

  // Head ~1/7.5 body: skull radius ~0.11 on ~1.75m figure
  var headG = new THREE.Group();
  headG.position.set(0, 1.00, 0);
  // Continuous neck→jaw blend (same skin — funnel into shoulders via torso lathe)
  addMesh(headG, new THREE.CylinderGeometry(0.055, 0.072, 0.12, 14), skinMat, 0, -0.10, 0.01);
  addMesh(headG, new THREE.SphereGeometry(0.07, 14, 12), skinMat, 0, -0.05, 0.015, 1.1, 0.65, 0.95);
  addMesh(headG, new THREE.SphereGeometry(0.112, 24, 20), skinMat, 0, 0.02, 0.01, 1, 1.12, 0.95);
  addMesh(headG, new THREE.SphereGeometry(0.08, 14, 12), skinMat, 0, -0.03, 0.025, 1.1, 0.75, 0.9);
  addMesh(headG, new THREE.SphereGeometry(0.116, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat, 0, 0.04, -0.01, 1.02, 1.05, 1.0);
  addMesh(headG, new THREE.SphereGeometry(0.022, 10, 8), skinMat, -0.11, 0.0, 0, 0.7, 1.1, 0.55);
  addMesh(headG, new THREE.SphereGeometry(0.022, 10, 8), skinMat, 0.11, 0.0, 0, 0.7, 1.1, 0.55);

  var eyeWhite = matStd(0xf5f2ea, 0.35, 0);
  var irisMat = matStd(0x3a4a5a, 0.35, 0);
  var pupilMat = matStd(0x101018, 0.25, 0);
  function eye(ox) {
    var eg = new THREE.Group();
    eg.position.set(ox, 0.025, 0.10);
    addMesh(eg, new THREE.SphereGeometry(0.018, 12, 10), eyeWhite, 0, 0, 0);
    addMesh(eg, new THREE.SphereGeometry(0.011, 10, 8), irisMat, 0, 0, 0.011);
    addMesh(eg, new THREE.SphereGeometry(0.005, 8, 6), pupilMat, 0, 0, 0.017);
    addMesh(eg, new THREE.BoxGeometry(0.042, 0.008, 0.012), hairMat, 0, 0.022, 0.006);
    headG.add(eg);
  }
  eye(-0.038);
  eye(0.038);

  addMesh(headG, new THREE.BoxGeometry(0.02, 0.032, 0.03), skinMat, 0, -0.01, 0.11);
  addMesh(headG, new THREE.SphereGeometry(0.012, 10, 8), skinMat, 0, -0.026, 0.125);
  var lipMat = matStd(0xb07070, 0.55, 0.04);
  addMesh(headG, new THREE.BoxGeometry(0.038, 0.008, 0.012), lipMat, 0, -0.058, 0.105);

  torso.add(headG);
  rig.add(torso);

  if (isPlayer) {
    var arrow = buildFacingArrow();
    root.add(arrow);
    api._facingArrow = arrow;
  }

  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  var bb = new THREE.Box3().setFromObject(root);
  if (isFinite(bb.min.y)) root.position.y -= bb.min.y;

  root.userData.limbs = {
    lLeg: Lleg.leg, rLeg: Rleg.leg, lShin: Lleg.shin, rShin: Rleg.shin,
    lArm: Larm.arm, rArm: Rarm.arm, lFore: Larm.fore, rFore: Rarm.fore,
    torso: torso, head: headG, phase: Math.random() * Math.PI * 2,
    dress: isDress,
    groundY: root.position.y,
  };
  root.userData.isPlayer = isPlayer;
  root.userData.walkAmp = 0;
  root.userData.charKind = "sculpt-metahuman";
  return root;
}

function animateHumanoid(root, moving, dt) {
  if (!root || !root.userData) return;

  if (root.userData.charKind === "gltf" && root.userData.mixer) {
    var actions = root.userData.actions || {};
    var w = root.userData.walkAmp || 0;
    var target = moving ? 1 : 0;
    root.userData.walkAmp = w + (target - w) * Math.min(1, dt * 6);
    w = root.userData.walkAmp;
    if (actions.walk && actions.idle) {
      if (actions.walk.paused) actions.walk.paused = false;
      actions.walk.setEffectiveWeight(w);
      actions.idle.setEffectiveWeight(1 - w);
      actions.walk.timeScale = 0.85 + w * 0.35;
    } else if (actions.walk) {
      actions.walk.paused = w < 0.05;
      if (!actions.walk.paused && (!actions.walk.isRunning || !actions.walk.isRunning())) actions.walk.play();
      actions.walk.setEffectiveWeight(0.3 + w * 0.7);
      actions.walk.timeScale = 0.7 + w * 0.6;
    }
    root.userData.mixer.update(dt);
    return;
  }

  // Unskinned custom GLB (TripoSR etc.): walk bob/sway + idle breathe (never frozen statue)
  if (root.userData.unskinnedTps || (root.userData.charKind === "gltf" && !root.userData.mixer)) {
    var targetU = moving ? 1 : 0;
    root.userData.walkAmp = (root.userData.walkAmp || 0) + (targetU - (root.userData.walkAmp || 0)) * Math.min(1, dt * 9);
    var ampU = root.userData.walkAmp || 0;
    var Lbob = root.userData.limbs || (root.userData.limbs = { phase: 0, idlePhase: 0 });
    Lbob.phase = (Lbob.phase || 0) + dt * (8.6 + ampU * 6.2);
    Lbob.idlePhase = (Lbob.idlePhase || 0) + dt * 1.7;
    var stride = Math.sin(Lbob.phase);
    var stride2 = Math.sin(Lbob.phase * 2);
    var idle = Math.sin(Lbob.idlePhase);
    var idle2 = Math.sin(Lbob.idlePhase * 2.1);
    var bob = Math.abs(stride) * ampU * 0.11 + (1 - ampU) * (idle * 0.012 + 0.006);
    var sway = stride * ampU * 0.09 + (1 - ampU) * idle * 0.018;
    var lean = ampU * 0.09;
    var baseY = root.userData.bobBaseY != null ? root.userData.bobBaseY : (Lbob.groundY || 0);
    root.position.y = baseY + bob;
    // Facing yaw is set by step() — never lookAt(camera). Layer sway on model child only.
    var model = root.children && root.children[0];
    if (model && model.isObject3D) {
      // Preserve custom mesh yaw offset (π); only layer walk roll/pitch
      var baseYaw = root.userData.modelBaseYaw != null ? root.userData.modelBaseYaw : (model.rotation.y || 0);
      if (root.userData.modelBaseYaw == null && Math.abs(model.rotation.y) > 0.01) {
        root.userData.modelBaseYaw = model.rotation.y;
        baseYaw = model.rotation.y;
      }
      model.rotation.y = baseYaw + (1 - ampU) * idle2 * 0.025;
      model.rotation.z = sway * 0.7;
      model.rotation.x = lean + stride2 * ampU * 0.045 + (1 - ampU) * idle * 0.02;
      model.position.x = sway * 0.035;
      model.position.z = ampU * stride * 0.012;
    } else {
      root.rotation.z = sway * 0.28;
      root.rotation.x = lean * 0.55 + stride * ampU * 0.03;
    }
    return;
  }

  var L = root.userData.limbs;
  if (!L || !L.lLeg) return;
  var targetP = moving ? 1 : 0;
  root.userData.walkAmp += (targetP - root.userData.walkAmp) * Math.min(1, dt * 8);
  var amp = root.userData.walkAmp;
  L.phase += dt * (6.5 + amp * 4);
  var sw = Math.sin(L.phase) * amp;
  var sw2 = Math.sin(L.phase + Math.PI) * amp;
  L.lLeg.rotation.x = sw * (L.dress ? 0.25 : 0.65);
  L.rLeg.rotation.x = sw2 * (L.dress ? 0.25 : 0.65);
  L.lShin.rotation.x = Math.max(0, -sw) * (L.dress ? 0.2 : 0.5);
  L.rShin.rotation.x = Math.max(0, -sw2) * (L.dress ? 0.2 : 0.5);
  L.lArm.rotation.x = sw2 * 0.5;
  L.rArm.rotation.x = sw * 0.5;
  L.lFore.rotation.x = -0.12 - Math.max(0, sw2) * 0.22;
  L.rFore.rotation.x = -0.12 - Math.max(0, sw) * 0.22;
  L.torso.position.y = 0.92 + Math.abs(sw) * 0.03;
  L.head.rotation.y = sw * 0.04;
  if (L.dress) {
    root.traverse(function (o) {
      if (o.userData && o.userData.dressShoe === "L") o.position.z = 0.035 + sw * 0.06;
      if (o.userData && o.userData.dressShoe === "R") o.position.z = 0.035 + sw2 * 0.06;
    });
  }
}

function pickGlbEntry(index) {
  var lib = api._charLibrary;
  if (!lib || !lib.glbs || !lib.glbs.length) return null;
  return lib.glbs[index % lib.glbs.length];
}

function buildPlayer() {
  var lib = api._charLibrary;

  function asGoldPlayer(entry, extra) {
    extra = extra || {};
    var isCustomMesh = /custom-character/i.test(entry.id || "");
    return buildGltfCharacter(entry, {
      isPlayer: true,
      scale: 1.0,
      customLook: !isCustomMesh,
      opaqueGold: !isCustomMesh,
      keepTexture: isCustomMesh || !!extra.keepTexture,
      borrowLocomotion: extra.borrowLocomotion,
      forceBorrow: !!extra.forceBorrow,
    });
  }

  function isStandingFullBody(root) {
    if (!root) return false;
    var h = root.userData.bboxHeight || 0;
    if (h < 1.2) return false;
    var meshCount = 0;
    var skinned = 0;
    root.traverse(function (o) {
      if (o.isMesh && o.visible) meshCount++;
      if (o.isSkinnedMesh && o.visible) skinned++;
    });
    // Accept unskinned image→3D meshes (TripoSR) as long as full height + visible geometry
    return meshCount > 0 && (skinned > 0 || root.userData.unskinnedTps || h >= 1.2);
  }

  // Prefer open-source image→3D custom character (gold jumpsuit with real front+back).
  if (lib && lib.custom) {
    var customPlayer = asGoldPlayer(lib.custom, { borrowLocomotion: false, forceBorrow: false, keepTexture: true });
    if (isStandingFullBody(customPlayer)) {
      customPlayer.userData.playerType = lib.custom.id;
      return customPlayer;
    }
    try { console.warn("[artfloor-player] custom GLB failed height check", lib.custom.id, customPlayer.userData.bboxHeight); } catch (e) {}
  }

  // Fallback: Mixamo Soldier/Xbot (native Walk + Idle).
  var soldier = null;
  var xbot = null;
  if (lib && lib.glbs) {
    for (var i = 0; i < lib.glbs.length; i++) {
      var id = (lib.glbs[i].id || "").toLowerCase();
      if (!soldier && id.indexOf("soldier") >= 0) soldier = lib.glbs[i];
      if (!xbot && id.indexOf("xbot") >= 0) xbot = lib.glbs[i];
    }
  }

  var primary = soldier || xbot || pickGlbEntry(0);
  if (primary) {
    var player = asGoldPlayer(primary, { borrowLocomotion: false });
    if (isStandingFullBody(player)) {
      player.userData.playerType = primary.id;
      return player;
    }
    try { console.warn("[artfloor-player] primary failed height check", primary.id, player.userData.bboxHeight); } catch (e) {}
  }

  // Secondary: other GLB
  var secondary = (primary === soldier) ? xbot : soldier;
  if (secondary) {
    var p2 = asGoldPlayer(secondary, { borrowLocomotion: false });
    if (isStandingFullBody(p2)) {
      p2.userData.playerType = secondary.id;
      return p2;
    }
  }

  // Last resort: procedural gold humanoid (always has height)
  var hum = buildHumanoid({
    coat: GOLDEN_STASIS_PALETTE.gold,
    pants: GOLDEN_STASIS_PALETTE.gold,
    shirt: GOLDEN_STASIS_PALETTE.gold,
    skin: GOLDEN_STASIS_PALETTE.skin,
    hair: GOLDEN_STASIS_PALETTE.hair,
    tie: GOLDEN_STASIS_PALETTE.scarf,
    isPlayer: true,
    scale: 1.0,
    dress: true,
  });
  hum.userData.playerType = "procedural-gold";
  return hum;
}

function buildNpc(x, z, palette, index) {
  var p = palette || NPC_PALETTES[0];
  var idx = index != null ? index : 0;
  var entry = pickGlbEntry(idx + 1);
  var g;
  if (entry) {
    g = buildGltfCharacter(entry, {
      scale: 0.96 + (idx % 5) * 0.02,
      attire: (p && p.coat) || GLB_ATTIRE_TINTS[idx % GLB_ATTIRE_TINTS.length],
      skin: (p && p.skin) || 0xd4b896,
    });
  } else {
    g = buildHumanoid({
      coat: p.coat,
      pants: p.pants,
      skin: p.skin,
      shirt: p.shirt,
      hair: p.hair,
      tie: p.tie,
      dress: !!p.dress,
      longCoat: !!p.longCoat,
      hoodie: !!p.hoodie,
      scale: 0.96 + Math.random() * 0.08,
    });
  }
  var gy = (g.userData.limbs && g.userData.limbs.groundY) || g.position.y || 0;
  g.position.set(x, gy, z);
  return {
    group: g,
    x: x, z: z,
    vx: 0, vz: 0,
    idle: Math.random() * 2,
    yaw: Math.random() * Math.PI * 2,
    path: null,
    pathI: 0,
    pathT: 0,
  };
}


/** Looping walk paths — fewer patrons for a calmer hall. */
function makeNpcPaths() {
  return [
    [[-7, 2], [-4, 3], [-2, 6], [-5, 8], [-8, 5], [-7, 2]],
    [[6, -3], [8, 0], [7, 4], [4, 5], [3, 1], [6, -3]],
    [[2, 4], [-1, 5], [-3, 3], [0, 1], [3, 2], [2, 4]],
    [[-8, -2], [-6, -4], [-3, -3], [-5, 0], [-9, 1], [-8, -2]],
    [[5, 7], [2, 8], [-1, 7], [1, 5], [4, 5], [5, 7]],
    [[8, 3], [9, 6], [6, 8], [4, 6], [6, 3], [8, 3]],
    [[-4, 7], [-7, 6], [-9, 4], [-6, 2], [-3, 4], [-4, 7]],
    [[1, -4], [4, -2], [2, 0], [-1, -2], [1, -4]],
  ];
}

function buildHall() {
  var scene = api._scene;
  var marbleMap = makeMarbleTexture(2048);
  var roughMap = makeMarbleRoughness(1024);
  var marbleMat = trackMat(new THREE.MeshStandardMaterial({
    map: marbleMap, roughnessMap: roughMap, roughness: 0.35, metalness: 0.08, color: 0xffffff,
  }));
  var colMat = trackMat(new THREE.MeshStandardMaterial({
    map: makeColumnMarbleTexture(), roughness: 0.4, metalness: 0.08, color: 0xffffff,
  }));
  var clothMap = makeClothTexture();
  var exteriorTex = makeExteriorViewTexture();
  var wallMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.65, metalness: 0.04 }));
  var ceilingMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xd8ccb8, roughness: 0.8 }));
  var trimMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xc9b896, roughness: 0.5, metalness: 0.1 }));

  var floor = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(24, 28)), marbleMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  var ceiling = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(24, 28)), ceilingMat);
  ceiling.rotation.x = Math.PI / 2; ceiling.position.y = 7.2; scene.add(ceiling);

  // Cream walls ONLY — no mural / photo wallpaper planes
  var back = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(24, 7.2)), wallMat);
  back.position.set(0, 3.6, -14); back.receiveShadow = true; scene.add(back);
  var front = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(24, 7.2)), wallMat);
  front.position.set(0, 3.6, 14); front.rotation.y = Math.PI; scene.add(front);
  var left = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(28, 7.2)), wallMat);
  left.position.set(-12, 3.6, 0); left.rotation.y = Math.PI / 2; left.receiveShadow = true; scene.add(left);
  var right = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(28, 7.2)), wallMat);
  right.position.set(12, 3.6, 0); right.rotation.y = -Math.PI / 2; right.receiveShadow = true; scene.add(right);

  // Cornice trim
  function cornice(px, pz, w, d, ry) {
    var m = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, 0.22, d)), trimMat);
    m.position.set(px, 7.0, pz);
    if (ry) m.rotation.y = ry;
    scene.add(m);
  }
  cornice(0, -13.85, 24, 0.25, 0);
  cornice(0, 13.85, 24, 0.25, 0);
  cornice(-11.85, 0, 28, 0.25, Math.PI / 2);
  cornice(11.85, 0, 28, 0.25, Math.PI / 2);

  for (var wi = -2; wi <= 2; wi++) scene.add(buildArchedWindow(wi * 3.6, 3.95, -13.65, exteriorTex));
  for (var si = -1; si <= 1; si++) {
    var lw = buildArchedWindow(-11.65, 3.95, si * 5, exteriorTex); lw.rotation.y = Math.PI / 2; scene.add(lw);
    var rw = buildArchedWindow(11.65, 3.95, si * 5, exteriorTex); rw.rotation.y = -Math.PI / 2; scene.add(rw);
  }

  var colXs = [-8.5, -3.2, 3.2, 8.5];
  var colZs = [-5.5, 1.5, 7.5];
  for (var ci = 0; ci < colXs.length; ci++) {
    for (var cj = 0; cj < colZs.length; cj++) {
      if (colZs[cj] === -5.5 && Math.abs(colXs[ci]) < 4) continue;
      scene.add(buildColumn(colXs[ci], colZs[cj], 6.6, colMat));
    }
  }

  var tableSpecs = [
    [-6.8, 0.2, 3.4, 1.45, 0.05], [5.8, -1.2, 3.6, 1.45, -0.08],
    [-2.0, 5.2, 2.8, 1.35, 0.1], [7.2, 5.5, 2.6, 1.3, 0.35],
    [-7.5, 6.5, 2.4, 1.25, -0.2], [1.5, -2.5, 2.2, 1.2, 0.15],
    [-5.0, 9.0, 2.5, 1.2, 0.02], [4.5, 9.2, 2.4, 1.2, -0.05],
    [-9.0, -1.5, 2.2, 1.15, 0.2],
  ];
  for (var ti = 0; ti < tableSpecs.length; ti++) {
    var ts = tableSpecs[ti];
    scene.add(buildTable(ts[0], ts[1], ts[2], ts[3], ts[4], clothMap));
  }

  var easelSpecs = [
    [-7.5, -0.7, 0.25], [-5.8, -0.8, -0.2], [4.8, -2.1, 0.35], [6.8, -2.0, -0.25],
    [-2.0, 4.3, 0.05], [7.6, 4.6, 0.45], [-8.2, 5.6, 0.5], [-9.6, 3.5, 0.7],
    [9.4, 1.2, -0.85], [-4.2, 8.2, Math.PI], [2.8, 8.4, Math.PI * 0.92],
    [0.8, -3.5, 0.2], [-6.0, -3.8, 0.4], [8.5, 7.5, -0.5], [-1.0, 7.0, Math.PI * 1.05],
    [5.2, 3.0, -0.3], [-3.5, 1.0, 0.15], [3.0, 6.0, -0.4],
  ];
  for (var ei = 0; ei < easelSpecs.length; ei++) {
    var es = easelSpecs[ei];
    scene.add(buildEasel(es[0], es[1], es[2]));
  }
  scene.add(buildLeanCanvas(-8.0, -4.2, 0.3));
  scene.add(buildLeanCanvas(8.2, -4.0, -0.4));
  scene.add(buildLeanCanvas(-3.0, 8.8, Math.PI));
  scene.add(buildLeanCanvas(9.0, 6.0, -1.0));

  scene.add(buildBust(-5.2, -3.8));
  scene.add(buildBust(6.8, 2.8));
  scene.add(buildBust(-9.0, 8.5));
  scene.add(buildBust(2.0, -6.5));

  scene.add(buildBanner(-5.8, 5.4, -10.1, 0));
  scene.add(buildBanner(5.8, 5.4, -10.1, 0));
  scene.add(buildBanner(0, 5.55, 11.2, Math.PI));

  scene.add(buildChandelier(0, 6.45, 1, true));
  scene.add(buildChandelier(-5.5, 6.35, -2.5, false));
  scene.add(buildChandelier(5.5, 6.35, -2.5, false));
  scene.add(buildChandelier(-2.5, 6.3, 7.5, false));
  scene.add(buildChandelier(3.5, 6.3, 7.0, false));

  scene.add(buildBooth(0, -9.5));

  scene.add(new THREE.AmbientLight(0xfff0e0, 0.42));
  scene.add(new THREE.HemisphereLight(0xfff2dc, 0x4a3830, 0.62));
  var sun = new THREE.DirectionalLight(0xffe8c8, 1.05);
  sun.position.set(5, 14, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 42;
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  var winLight = new THREE.DirectionalLight(0xfff6e8, 0.55);
  winLight.position.set(0, 4, -18); scene.add(winLight);
  var fill = new THREE.DirectionalLight(0xffd8b0, 0.4);
  fill.position.set(-8, 6, 8); scene.add(fill);
  var rim = new THREE.DirectionalLight(0xffe6b0, 0.35);
  rim.position.set(4, 5, 10); scene.add(rim);

  api._player = buildPlayer();
  var pgy = (api._player.userData.limbs && api._player.userData.limbs.groundY) || api._player.position.y || 0;
  api._player.position.set(0, pgy, 10);
  if (api._player.userData) api._player.userData.bobBaseY = pgy;
  api._playerYaw = Math.PI;
  api._camYaw = Math.PI;
  api._player.rotation.y = api._playerYaw;
  api._projectiles = [];
  api._shootCooldown = 0;
  scene.add(api._player);
  // Follow fill so custom textured mesh stays readable (no env map / metalness black-hole)
  var playerKey = new THREE.PointLight(0xffe2a8, 1.15, 7.5, 2);
  playerKey.position.set(0, 1.55, 0.35);
  api._player.add(playerKey);
  api._playerKeyLight = playerKey;

  api._npcs = [];
  var paths = makeNpcPaths();
  var spawned = 0;
  for (var ni = 0; ni < paths.length && spawned < MAX_NPCS; ni++) {
    var path = paths[ni];
    var start = path[0];
    if (collidesAt(start[0], start[1], 0.55)) continue;
    var npc = buildNpc(start[0], start[1], NPC_PALETTES[spawned % NPC_PALETTES.length], spawned);
    npc.path = path;
    npc.pathI = 0;
    npc.yaw = Math.atan2(-(path[1][0] - start[0]), -(path[1][1] - start[1]));
    npc.group.rotation.y = npc.yaw;
    scene.add(npc.group);
    api._npcs.push(npc);
    spawned++;
  }
}

function updateCamera(dt) {
  if (!api._player || !api._camera) return;
  var lerp = 1 - Math.exp(-(dt || 0.016) * 10);
  api._camDist += (api._camDistTarget - api._camDist) * lerp;

  var p = api._player.position;
  // Camera yaw is independent of body yaw — orbiting must reveal side/back (no billboard)
  var yaw = api._camYaw != null ? api._camYaw : api._playerYaw;
  var pitch = api._lookPitch;
  var dist = api._camDist;
  var behindX = Math.sin(yaw);
  var behindZ = Math.cos(yaw);
  var cp = Math.cos(pitch);
  var sp = Math.sin(pitch);
  // TPS over-shoulder: slight right offset so body stays visible ahead of crosshair line
  var shoulder = 0.28;
  var rightX = Math.cos(yaw);
  var rightZ = -Math.sin(yaw);
  var cx = p.x + behindX * dist * cp + rightX * shoulder;
  var cy = p.y + 1.48 + dist * sp * 0.75 + 0.28;
  var cz = p.z + behindZ * dist * cp + rightZ * shoulder;
  cx = Math.max(-11.5, Math.min(11.5, cx));
  cz = Math.max(-13.8, Math.min(13.8, cz));
  cy = Math.max(0.8, Math.min(6.5, cy));
  api._camera.position.set(cx, cy, cz);
  api._camera.lookAt(p.x + rightX * 0.12, p.y + 1.42, p.z + rightZ * 0.12);
}

function updateHint() {
  if (!api._hintEl) return;
  api._hintEl.hidden = !(api._nearBooth && api._running);
}

function stepNpc(n, dt) {
  if (n.path && n.path.length > 1) {
    var a = n.path[n.pathI % n.path.length];
    var b = n.path[(n.pathI + 1) % n.path.length];
    var dx = b[0] - a[0];
    var dz = b[1] - a[1];
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    var spd = 0.85 + (n.pathI % 3) * 0.15;
    n.pathT += (spd * dt) / len;
    if (n.pathT >= 1) {
      n.pathT = 0;
      n.pathI = (n.pathI + 1) % n.path.length;
      a = n.path[n.pathI % n.path.length];
      b = n.path[(n.pathI + 1) % n.path.length];
      dx = b[0] - a[0]; dz = b[1] - a[1];
    }
    n.x = a[0] + dx * n.pathT;
    n.z = a[1] + dz * n.pathT;
    n.yaw = Math.atan2(-dx, -dz);
    var gy = (n.group.userData.limbs && n.group.userData.limbs.groundY) || 0;
    n.group.position.set(n.x, gy, n.z);
    n.group.rotation.y = n.yaw;
    animateHumanoid(n.group, true, dt);
    return;
  }
  // Fallback wander
  n.idle -= dt;
  if (n.idle <= 0) {
    if (Math.random() < 0.4) {
      n.vx = 0; n.vz = 0; n.idle = 1.2 + Math.random() * 2.5;
    } else {
      var ang = Math.random() * Math.PI * 2;
      var spd2 = 0.7 + Math.random() * 1.0;
      n.vx = Math.cos(ang) * spd2;
      n.vz = Math.sin(ang) * spd2;
      n.yaw = Math.atan2(-n.vx, -n.vz);
      n.idle = 1.5 + Math.random() * 3;
    }
  }
  var nxx = n.x + n.vx * dt;
  var nzz = n.z + n.vz * dt;
  var moving = !!(n.vx || n.vz);
  if (collidesAt(nxx, nzz, 0.45) || Math.abs(nxx) > 10.5 || Math.abs(nzz) > 12.5) {
    n.vx *= -1; n.vz *= -1;
    n.yaw = Math.atan2(-n.vx, -n.vz);
  } else {
    n.x = nxx; n.z = nzz;
  }
  var gy2 = (n.group.userData.limbs && n.group.userData.limbs.groundY) || 0;
  n.group.position.set(n.x, gy2, n.z);
  n.group.rotation.y = n.yaw;
  animateHumanoid(n.group, moving, dt);
}


function getAimForward() {
  var yaw = api._camYaw != null ? api._camYaw : api._playerYaw;
  // Camera looks opposite behind-vector ≈ walk forward
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

function getMuzzleWorld() {
  var p = api._player.position;
  var yaw = api._playerYaw;
  // Gun hand is raised on mesh +X before π flip → world left of facing after flip ≈ character's right
  var fx = -Math.sin(yaw);
  var fz = -Math.cos(yaw);
  var rx = Math.cos(yaw);
  var rz = -Math.sin(yaw);
  return {
    x: p.x + fx * 0.18 + rx * 0.22,
    y: p.y + 1.42,
    z: p.z + fz * 0.18 + rz * 0.22,
  };
}

function playerShoot() {
  if (!api._running || !api._player || !api._scene) return;
  if (api._shootCooldown > 0) return;
  api._shootCooldown = 0.28;
  if (!api._projectiles) api._projectiles = [];

  var aim = getAimForward();
  var muzzle = getMuzzleWorld();

  // Muzzle flash sprite (simple emissive sphere)
  var flashMat = trackMat(new THREE.MeshBasicMaterial({
    color: 0xffe08a,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  }));
  var flash = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.07, 8, 8)), flashMat);
  flash.position.set(muzzle.x, muzzle.y, muzzle.z);
  api._scene.add(flash);

  if (!api._muzzleLight) {
    api._muzzleLight = new THREE.PointLight(0xffcc66, 0, 4.5, 2);
    api._scene.add(api._muzzleLight);
  }
  api._muzzleLight.position.copy(flash.position);
  api._muzzleLight.intensity = 2.8;

  // Small gold projectile
  var boltMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0xf0d060,
    emissive: 0xffaa33,
    emissiveIntensity: 1.2,
    metalness: 0.6,
    roughness: 0.35,
  }));
  var bolt = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.045, 8, 8)), boltMat);
  bolt.position.set(muzzle.x, muzzle.y, muzzle.z);
  api._scene.add(bolt);

  api._projectiles.push({
    mesh: bolt,
    flash: flash,
    vx: aim.x * 22,
    vz: aim.z * 22,
    life: 0.7,
    flashLife: 0.08,
  });

  // Soften pose kick: brief model pitch nudge
  var model = api._player.children && api._player.children[0];
  if (model && model.isObject3D) {
    api._player.userData.shootKick = 0.12;
  }
}

function updateProjectiles(dt) {
  if (api._shootCooldown > 0) api._shootCooldown = Math.max(0, api._shootCooldown - dt);
  if (api._player && api._player.userData && api._player.userData.shootKick) {
    api._player.userData.shootKick = Math.max(0, api._player.userData.shootKick - dt);
  }
  if (!api._projectiles || !api._projectiles.length) {
    if (api._muzzleLight) api._muzzleLight.intensity = Math.max(0, (api._muzzleLight.intensity || 0) - dt * 18);
    return;
  }
  var kept = [];
  for (var i = 0; i < api._projectiles.length; i++) {
    var pr = api._projectiles[i];
    pr.life -= dt;
    if (pr.flashLife != null) {
      pr.flashLife -= dt;
      if (pr.flash) {
        pr.flash.material.opacity = Math.max(0, pr.flashLife / 0.08);
        pr.flash.scale.setScalar(1 + (0.08 - Math.max(0, pr.flashLife)) * 8);
      }
      if (pr.flashLife <= 0 && pr.flash) {
        api._scene.remove(pr.flash);
        pr.flash = null;
      }
    }
    if (pr.mesh) {
      pr.mesh.position.x += pr.vx * dt;
      pr.mesh.position.z += pr.vz * dt;
      pr.mesh.position.y += Math.sin((0.7 - pr.life) * 10) * 0.002;
    }
    if (pr.life <= 0 || Math.abs(pr.mesh.position.x) > 14 || Math.abs(pr.mesh.position.z) > 16) {
      if (pr.mesh) api._scene.remove(pr.mesh);
      if (pr.flash) api._scene.remove(pr.flash);
    } else {
      kept.push(pr);
    }
  }
  api._projectiles = kept;
  if (api._muzzleLight) {
    api._muzzleLight.intensity = kept.some(function (p) { return p.flash; }) ? 2.2 : Math.max(0, api._muzzleLight.intensity - dt * 18);
  }
}

function step(dt) {
  if (!api._running || !api._player) return;
  var mx = 0, mz = 0;
  var k = api._keys;
  if (k.KeyW || k.ArrowUp) mz -= 1;
  if (k.KeyS || k.ArrowDown) mz += 1;
  if (k.KeyA || k.ArrowLeft) mx -= 1;
  if (k.KeyD || k.ArrowRight) mx += 1;

  var moved = 0;
  var camYaw = api._camYaw != null ? api._camYaw : api._playerYaw;
  // WASD relative to camera facing (not body) so orbit + strafe feel correct
  if (mx || mz) {
    var len = Math.sqrt(mx * mx + mz * mz) || 1;
    mx /= len; mz /= len;
    var speed = 5.0;
    var fx = -Math.sin(camYaw);
    var fz = -Math.cos(camYaw);
    var rx = Math.cos(camYaw);
    var rz = -Math.sin(camYaw);
    var dx = (fx * -mz + rx * mx) * speed * dt;
    var dz = (fz * -mz + rz * mx) * speed * dt;
    var nx = api._player.position.x + dx;
    var nz = api._player.position.z + dz;
    if (!collidesAt(nx, api._player.position.z)) {
      api._player.position.x = nx; moved += Math.abs(dx);
    }
    if (!collidesAt(api._player.position.x, nz)) {
      api._player.position.z = nz; moved += Math.abs(dz);
    }
    // Body yaw follows move direction — does NOT snap to camera each frame
    if (moved > 1e-6) {
      var wantYaw = Math.atan2(-dx, -dz);
      var cur = api._playerYaw;
      var diff = wantYaw - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      api._playerYaw = cur + diff * Math.min(1, dt * 10);
    }
    api._walkAcc += moved;
    while (api._walkAcc >= 2.5) {
      api._walkAcc -= 2.5;
      if (api._opts && typeof api._opts.onWalkXp === "function") {
        try { api._opts.onWalkXp(1); } catch (e) {}
      }
    }
  }

  api._player.rotation.y = api._playerYaw;
  animateHumanoid(api._player, !!(mx || mz), dt);
  if (api._facingArrow) {
    api._facingArrow.visible = true;
    api._facingArrow.position.y = (mx || mz) ? 0.02 : 0;
  }

  api._walkPhase += dt;
  for (var i = 0; i < api._npcs.length; i++) {
    stepNpc(api._npcs[i], dt);
  }

  var bx = api._booth ? api._booth.x : 0;
  var bz = api._booth ? api._booth.z : -9.5;
  var dxb = api._player.position.x - bx;
  var dzb = api._player.position.z - bz;
  api._nearBooth = Math.sqrt(dxb * dxb + dzb * dzb) < (api._booth ? api._booth.r : 3.2);
  updateHint();
  updateProjectiles(dt);
  updateCamera(dt);
}

function loop(ts) {
  if (!api._running) { api._raf = 0; return; }
  if (!api._lastTs) api._lastTs = ts;
  var dt = Math.min(0.05, (ts - api._lastTs) / 1000);
  api._lastTs = ts;
  step(dt);
  if (api._renderer && api._scene && api._camera) {
    api._renderer.render(api._scene, api._camera);
    if (!api._firstFrameDone && api._ready && api._player) {
      api._firstFrameDone = true;
      showLoader(false);
      var splash = document.getElementById("ge-world-splash");
      if (splash) splash.hidden = true;
    }
  }
  api._raf = requestAnimationFrame(loop);
}

function bindInput() {
  api._onKeyDown = function (e) {
    if (!api._running) return;
    var panel = document.getElementById("panel-exchange");
    if (panel && panel.hidden) return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    var code = e.code;
    if (
      code === "KeyW" || code === "KeyA" || code === "KeyS" || code === "KeyD" ||
      code === "ArrowUp" || code === "ArrowDown" || code === "ArrowLeft" || code === "ArrowRight"
    ) {
      api._keys[code] = true;
      e.preventDefault();
    } else if (code === "KeyE") {
      if (api._nearBooth) { e.preventDefault(); openExchangeFromWorld(); }
    } else if (code === "KeyF") {
      e.preventDefault();
      playerShoot();
    } else if (code === "Escape") {
      if (document.pointerLockElement) document.exitPointerLock();
    }
  };
  api._onKeyUp = function (e) {
    if (e.code in api._keys) delete api._keys[e.code];
  };
  api._onMouseMove = function (e) {
    if (!api._running || !api._pointerLocked) return;
    var sens = 0.0024;
    // Orbit camera only — do NOT rotate body to face camera (kills billboard snap)
    if (api._camYaw == null) api._camYaw = api._playerYaw;
    api._camYaw -= e.movementX * sens;
    api._lookPitch += e.movementY * sens;
    api._lookPitch = Math.max(-0.15, Math.min(0.55, api._lookPitch));
  };
  api._onWheel = function (e) {
    if (!api._running) return;
    var panel = document.getElementById("panel-exchange");
    if (panel && panel.hidden) return;
    var stage = api._container;
    if (!api._pointerLocked && stage) {
      var t = e.target;
      if (!(t === api._canvas || (stage.contains && stage.contains(t)))) return;
    }
    e.preventDefault();
    var delta = e.deltaY;
    if (e.ctrlKey) delta *= 3;
    var stepZ = delta > 0 ? 0.55 : -0.55;
    stepZ *= Math.min(3, Math.abs(delta) / 100);
    api._camDistTarget = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, api._camDistTarget + stepZ));
  };
  api._onPointerLockChange = function () {
    api._pointerLocked = document.pointerLockElement === api._canvas;
  };
  api._onClick = function (e) {
    if (!api._running || !api._canvas) return;
    if (api._nearBooth && e.target === api._canvas) {
      openExchangeFromWorld();
      return;
    }
    if (api._pointerLocked) {
      // Left click fires when already looking around
      if (e.button === 0) playerShoot();
      return;
    }
    if (api._canvas.requestPointerLock) {
      try { api._canvas.requestPointerLock(); } catch (err) {}
    }
    try { api._container && api._container.focus && api._container.focus(); } catch (err2) {}
  };
  window.addEventListener("keydown", api._onKeyDown, true);
  window.addEventListener("keyup", api._onKeyUp, true);
  document.addEventListener("mousemove", api._onMouseMove, false);
  document.addEventListener("pointerlockchange", api._onPointerLockChange, false);
  if (api._canvas) {
    api._canvas.addEventListener("click", api._onClick, false);
    api._canvas.addEventListener("wheel", api._onWheel, { passive: false });
  }
  if (api._container) {
    api._container.addEventListener("wheel", api._onWheel, { passive: false });
  }
}

function unbindInput() {
  if (api._onKeyDown) window.removeEventListener("keydown", api._onKeyDown, true);
  if (api._onKeyUp) window.removeEventListener("keyup", api._onKeyUp, true);
  if (api._onMouseMove) document.removeEventListener("mousemove", api._onMouseMove, false);
  if (api._onPointerLockChange) document.removeEventListener("pointerlockchange", api._onPointerLockChange, false);
  if (api._canvas && api._onClick) api._canvas.removeEventListener("click", api._onClick, false);
  if (api._canvas && api._onWheel) api._canvas.removeEventListener("wheel", api._onWheel);
  if (api._container && api._onWheel) api._container.removeEventListener("wheel", api._onWheel);
  api._keys = Object.create(null);
  if (document.pointerLockElement) {
    try { document.exitPointerLock(); } catch (e) {}
  }
  api._pointerLocked = false;
}

function openExchangeFromWorld() {
  if (api._opts && typeof api._opts.onOpenExchange === "function") {
    try { api._opts.onOpenExchange(); } catch (e) {}
  }
}

function resize() {
  if (!api._renderer || !api._camera || !api._container) return;
  var w = api._container.clientWidth || 800;
  var h = api._container.clientHeight || 400;
  api._renderer.setSize(w, h, false);
  api._camera.aspect = w / Math.max(1, h);
  api._camera.updateProjectionMatrix();
}

function defaultPaintingUrls() {
  var ids = [1, 7, 12, 24, 36, 48, 64, 81, 100, 128, 256, 512, 3, 9, 15, 42, 55, 77, 90, 110];
  return ids.map(function (n) { return "paintings/" + n + ".jpg"; });
}

function preloadCritical(urls, done) {
  var list = (urls || []).slice(0, 8);
  var left = list.length || 1;
  var finished = false;
  function one() {
    left--;
    if (left <= 0 && !finished) { finished = true; done && done(); }
  }
  if (!list.length) { done && done(); return; }
  list.forEach(function (u) {
    var img = new Image();
    img.onload = one; img.onerror = one; img.src = u;
  });
  setTimeout(function () {
    if (!finished) { finished = true; done && done(); }
  }, 2200);
}

function mount(container, options) {
  if (!container) return false;
  if (api._mounted) {
    api._opts = options || api._opts;
    return true;
  }
  api._disposed = false;
  api._opts = options || {};
  api._container = container;
  api._hintEl = document.getElementById("ge-world-interact-hint");
  api._loaderEl = document.getElementById(LOADER_ID);
  api._colliders = [];
  api._easelMeshes = [];
  api._npcs = [];
  api._textures = [];
  api._mats = [];
  api._geos = [];
  api._firstFrameDone = false;
  api._camDist = ZOOM_DEFAULT;
  api._camDistTarget = ZOOM_DEFAULT;

  showLoader(true, "Loading character…", 2);

  var canvas = document.getElementById("ge-world-canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "ge-world-canvas";
    canvas.className = "ge-world-canvas";
    container.appendChild(canvas);
  }
  api._canvas = canvas;

  var w = container.clientWidth || 800;
  var h = container.clientHeight || 400;
  var renderer = new THREE.WebGLRenderer({
    canvas: canvas, antialias: true, alpha: false, powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x3a3024, 1);
  api._renderer = renderer;

  // Soft warm gallery env so MeshStandard metalnessMap reads as gold (not black) without RoomEnvironment
  try {
    var pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    var envSc = new THREE.Scene();
    envSc.background = new THREE.Color(0xc9a86a);
    envSc.add(new THREE.HemisphereLight(0xfff2dc, 0x4a3020, 1.35));
    var el1 = new THREE.DirectionalLight(0xffe8c8, 0.9); el1.position.set(2, 4, 3); envSc.add(el1);
    var el2 = new THREE.DirectionalLight(0xffd0a0, 0.45); el2.position.set(-3, 2, -2); envSc.add(el2);
    var envTex = pmrem.fromScene(envSc, 0.04).texture;
    api._sceneEnv = envTex;
    pmrem.dispose();
  } catch (eEnv) { api._sceneEnv = null; }

  api._scene = new THREE.Scene();
  api._scene.background = new THREE.Color(0xd4c8b4);
  api._scene.fog = new THREE.Fog(0xd8cfc0, 28, 55);
  if (api._sceneEnv) {
    api._scene.environment = api._sceneEnv;
  }
  api._camera = new THREE.PerspectiveCamera(55, w / Math.max(1, h), 0.1, 100);
  api._mixers = [];
  api._charLibrary = null;

  api._onResize = function () { resize(); };
  window.addEventListener("resize", api._onResize);
  api._onVis = function () {
    if (document.visibilityState === "hidden") {
      if (api._raf) { cancelAnimationFrame(api._raf); api._raf = 0; }
      api._wasRunningBeforeHide = api._running;
      if (api._running) api._lastTs = 0;
    } else if (api._wasRunningBeforeHide && api._mounted) {
      api._wasRunningBeforeHide = false;
      if (api._running && !api._raf) {
        api._lastTs = 0;
        api._raf = requestAnimationFrame(loop);
      }
    }
  };
  document.addEventListener("visibilitychange", api._onVis);
  api._mounted = true;
  api._ready = false;

  function finishMount() {
    if (api._disposed) return;
    buildHall();
    var urls = (api._opts && api._opts.getPaintingUrls && api._opts.getPaintingUrls()) || defaultPaintingUrls();
    setPaintingUrls(urls);
    updateCamera(0.016);
    try { api._renderer.render(api._scene, api._camera); } catch (eR) {}
    preloadCritical(urls, function () {});
    api._ready = true;
    if (!api._firstFrameDone) showLoader(true, "Loading character…", 2);
  }

  loadCharacterLibrary().then(function () {
    finishMount();
  }).catch(function () {
    api._charLibrary = { glbs: [] };
    finishMount();
  });

  return true;
}

function setPaintingUrls(urls) {
  if (!urls || !urls.length) urls = defaultPaintingUrls();
  for (var i = 0; i < api._easelMeshes.length; i++) {
    loadPaintingOnto(api._easelMeshes[i], urls[i % urls.length]);
  }
}

function start() {
  if (!api._mounted) return;
  if (api._running) {
    if (!api._raf) api._raf = requestAnimationFrame(loop);
    return;
  }
  api._running = true;
  api._lastTs = 0;
  bindInput();
  resize();
  if (!api._firstFrameDone) showLoader(true, "Loading character…", 2);
  if (!api._raf) api._raf = requestAnimationFrame(loop);
  try { api._container && api._container.focus && api._container.focus(); } catch (e) {}
}

function pause() {
  api._running = false;
  if (api._raf) { cancelAnimationFrame(api._raf); api._raf = 0; }
  unbindInput();
  updateHint();
}

function resume() { if (!api._mounted) return; start(); }

function dispose() {
  pause();
  api._disposed = true;
  if (api._onResize) window.removeEventListener("resize", api._onResize);
  if (api._onVis) document.removeEventListener("visibilitychange", api._onVis);
  if (api._scene) {
    api._scene.traverse(function (obj) {
      if (obj.geometry) obj.geometry.dispose && obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(function (m) { m.dispose && m.dispose(); });
        else if (obj.material.dispose) obj.material.dispose();
      }
    });
  }
  for (var i = 0; i < api._textures.length; i++) {
    try { api._textures[i].dispose(); } catch (e) {}
  }
  if (api._renderer) { try { api._renderer.dispose(); } catch (e2) {} }
  api._scene = null; api._camera = null; api._renderer = null; api._player = null;
  api._mounted = false; api._ready = false; api._firstFrameDone = false;
  api._colliders = []; api._easelMeshes = []; api._npcs = [];
  api._textures = []; api._mats = []; api._geos = [];
  api._mixers = []; api._charLibrary = null; api._facingArrow = null;
  api._projectiles = null; api._muzzleLight = null; api._shootCooldown = 0;
}

window.GeArtFloor3D = {
  mount: mount,
  start: start,
  pause: pause,
  resume: resume,
  dispose: dispose,
  setPaintingUrls: setPaintingUrls,
  isNearBooth: function () { return !!api._nearBooth; },
  isRunning: function () { return !!api._running; },
  isMounted: function () { return !!api._mounted; },
  isReady: function () { return !!api._ready; },
};

export default window.GeArtFloor3D;
