/**
 * Grand Exchange Art Floor — third-person walkaround.
 * Style reference: assets/grand-exchange-art-floor.jpg (colors/layout only — NOT a wall mural).
 * - Local Three.js (importmap → vendor/three)
 * - Procedural 3D marble hall: columns, arched windows, chandeliers, green tables, easels
 * - Player: alpha-cutout gold-jumpsuit painting, structurally inflated + walk bob (not Mixamo UV atlas)
 * - NPCs: offline Mixamo Soldier/Xbot gallery crowd (calm attire tints + walk mixer)
 * - Procedural fallback = continuous MetaHuman proportions (head ~1/7.5 body), 5-finger hands, calm gallery attire
 * - Hook: CUSTOM_CHARACTER_URL / ?customChar= (default custom/golden-stasis-cutout.png)
 * - NO green waffle "player uniform", NO white collar plates, NO chest badge/pencil graphics
 * - Camera behind player; mouse look; WASD; wheel zoom; E at GE desk
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

var LOADER_ID = "ge-world-loader";
var ZOOM_MIN = 2.0;
var ZOOM_MAX = 16.0;
var ZOOM_DEFAULT = 4.6;

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
  _lookPitch: 0.22,
  _camDist: ZOOM_DEFAULT,
  _camDistTarget: ZOOM_DEFAULT,
  _keys: Object.create(null),
  _pointerLocked: false,
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

function showLoader(visible, msg) {
  var el = api._loaderEl || document.getElementById(LOADER_ID);
  if (!el) return;
  api._loaderEl = el;
  if (msg) {
    var label = el.querySelector(".ge-world-loader-label");
    if (label) label.textContent = msg;
  }
  if (visible) {
    el.hidden = false;
    el.setAttribute("aria-busy", "true");
    el.classList.remove("is-hidden");
  } else {
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
 * Custom player look hook (reusable for future paintings):
 * - CUSTOM_CHARACTER_URL: alpha cutout PNG of the figure (default golden-stasis-cutout.png)
 * Override via window.GE_CUSTOM_CHARACTER_URL or ?customChar=
 * Michelle GLB path kept only as unused legacy override (?customGlb=) — player is inflated cutout.
 */
var CUSTOM_CHARACTER_GLB = "glb/Michelle.glb";
var CUSTOM_CHARACTER_URL = "custom/golden-stasis-cutout.png";

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
  return { glb: abs(CUSTOM_CHARACTER_GLB), look: abs(CUSTOM_CHARACTER_URL) };
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

function loadGltfAsync(url) {
  return new Promise(function (resolve) {
    var loader = new GLTFLoader();
    loader.load(
      url,
      function (gltf) { resolve(gltf); },
      undefined,
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
  showLoader(true, "Loading gallery patrons…");
  var lib = { glbs: [], custom: null, customLook: null, customCutout: null, donor: null };
  var paths = resolveCustomCharacterPaths();

  // Gallery crowd (calm Mixamo walkers)
  var glbFiles = ["glb/Soldier.glb", "glb/Xbot.glb"];
  for (var gi = 0; gi < glbFiles.length; gi++) {
    var g = await loadGltfAsync(CHAR_ASSET_BASE + glbFiles[gi]);
    if (g && g.scene) {
      var entry = { id: glbFiles[gi], gltf: g };
      lib.glbs.push(entry);
      if (!lib.donor && g.animations && g.animations.some(function (c) { return /walk/i.test(c.name); })) {
        lib.donor = entry;
      }
    }
  }

  // Player: alpha cutout of the gold-jumpsuit figure (transparent PNG). flipY for plane UVs.
  lib.customCutout = await loadTextureAsync(paths.look, { flipY: true });
  lib.customLook = lib.customCutout;
  // Legacy Michelle GLB only if explicitly requested via ?customGlb= (not used for default player)
  try {
    if (typeof window !== "undefined" && window.location && /(?:\?|&)customGlb=/i.test(window.location.search || "")) {
      var customGlb = await loadGltfAsync(paths.glb);
      if (customGlb && customGlb.scene) {
        lib.custom = { id: CUSTOM_CHARACTER_GLB, gltf: customGlb, lookUrl: paths.look };
      }
    }
  } catch (e) {}

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
  gold: 0xb59155,
  goldHi: 0xd4af37,
  skin: 0xcaa76b,
  hair: 0x1c1921,
  scarf: 0x141018,
  heel: 0x1a1410,
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
  mat.side = THREE.FrontSide;
  mat.blending = THREE.NormalBlending;
  if (mat.metalnessMap) mat.metalnessMap = null;
  if (mat.roughnessMap) mat.roughnessMap = null;
  if (mat.alphaMap) mat.alphaMap = null;
  if (mat.emissiveMap) mat.emissiveMap = null;
  if (mat.specularColorMap) mat.specularColorMap = null;
  if (mat.specularIntensityMap) mat.specularIntensityMap = null;
  if (mat.transmission != null) mat.transmission = 0;
  if (mat.emissive) mat.emissive.setHex(0x000000);
  if (mat.emissiveIntensity != null) mat.emissiveIntensity = 0;
  mat.needsUpdate = true;
  return mat;
}

/**
 * Gold-jumpsuit look on Michelle (or any custom Mixamo GLB).
 * Always installs opaque metallic-gold materials first (visible mesh). Optionally layers the
 * custom painting as albedo only with safe metalness — never keep Mixamo gloss metalnessMap.
 */
function applyGoldenStasisLook(root, lookTex) {
  var gold = new THREE.Color(GOLDEN_STASIS_PALETTE.gold);
  var hairCol = new THREE.Color(GOLDEN_STASIS_PALETTE.hair);
  root.traverse(function (o) {
    if (!o.isMesh || !o.material) return;
    o.visible = true;
    // Skinned bind-pose bounds can mis-cull after locomotion retarget
    if (o.isSkinnedMesh) o.frustumCulled = false;

    var prev = Array.isArray(o.material) ? o.material : [o.material];
    var next = [];
    for (var i = 0; i < prev.length; i++) {
      var src = prev[i];
      var name = (((src && src.name) || "") + " " + (o.name || "")).toLowerCase();
      var isHair = /hair|scalp|brow/i.test(name);
      var isEye = /eye|visor|lash|pupil|cornea/i.test(name);
      var isShoe = /shoe|boot|heel|sole|footwear/i.test(name);

      // Fresh standard material — drop MeshPhysical + KHR specular / gloss metalnessMap
      var m = trackMat(new THREE.MeshStandardMaterial({
        color: GOLDEN_STASIS_PALETTE.gold,
        roughness: 0.42,
        metalness: 0.48,
        transparent: false,
        opacity: 1,
        depthWrite: true,
        side: THREE.FrontSide,
      }));
      if (src && src.name) m.name = src.name;
      // Keep Mixamo normal for body contour when present
      if (src && src.normalMap) {
        m.normalMap = src.normalMap;
        if (src.normalScale) m.normalScale = src.normalScale.clone();
      }

      if (isEye) {
        m.color.setHex(0x1a1210);
        m.metalness = 0.12;
        m.roughness = 0.35;
        m.map = null;
        m.normalMap = null;
      } else if (isHair) {
        m.color.copy(hairCol);
        m.metalness = 0.04;
        m.roughness = 0.9;
        m.map = null;
      } else if (isShoe) {
        m.color.setHex(GOLDEN_STASIS_PALETTE.heel);
        m.metalness = 0.25;
        m.roughness = 0.5;
        m.map = null;
      } else {
        // Default single-atlas body (Ch03_Body): opaque gold jumpsuit — visible without env map
        m.color.copy(gold);
        m.metalness = 0.48;
        m.roughness = 0.4;
        // Painting-as-albedo only with safe opaque settings (no metalnessMap). If UVs scramble
        // the photo, gold tint still reads; mesh stays visible either way.
        if (lookTex) {
          m.map = lookTex;
          m.color.setHex(GOLDEN_STASIS_PALETTE.goldHi);
          m.color.lerp(new THREE.Color(0xffffff), 0.25);
          // Keep metalness moderate so albedo diffuse is not zeroed out
          m.metalness = 0.38;
          m.roughness = 0.45;
        }
        m.emissive.setHex(0x2a1c06);
        m.emissiveIntensity = 0.08;
      }
      forceOpaqueVisibleMat(m);
      next.push(m);
    }
    o.material = next.length === 1 ? next[0] : next;
    o.castShadow = true;
    o.receiveShadow = true;
  });

  // Dark curly updo volume on head bone (painting subject has a bouffant)
  var head = findBone(root, /Head$/i);
  if (head) {
    var hairMat = trackMat(new THREE.MeshStandardMaterial({
      color: GOLDEN_STASIS_PALETTE.hair, roughness: 0.92, metalness: 0.02,
      transparent: false, opacity: 1, depthWrite: true,
    }));
    var bun = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.11, 14, 12)), hairMat);
    bun.position.set(0, 0.12, -0.02);
    bun.scale.set(1.15, 1.35, 1.1);
    bun.castShadow = true;
    bun.visible = true;
    head.add(bun);
    var puff = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.085, 12, 10)), hairMat);
    puff.position.set(0, 0.06, 0.06);
    puff.scale.set(1.4, 0.9, 1.1);
    puff.castShadow = true;
    puff.visible = true;
    head.add(puff);
  }

  // Black neckerchief near neck
  var neck = findBone(root, /Neck$/i) || head;
  if (neck) {
    var scarfMat = trackMat(new THREE.MeshStandardMaterial({
      color: GOLDEN_STASIS_PALETTE.scarf, roughness: 0.7, metalness: 0.05,
      transparent: false, opacity: 1, depthWrite: true,
    }));
    var knot = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.035, 10, 8)), scarfMat);
    knot.position.set(0.02, 0.02, 0.06);
    knot.visible = true;
    neck.add(knot);
    var tail = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.04, 0.01, 0.22)), scarfMat);
    tail.position.set(0.08, 0.0, 0.12);
    tail.rotation.y = -0.5;
    tail.rotation.z = 0.25;
    tail.visible = true;
    neck.add(tail);
    var tail2 = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.035, 0.008, 0.16)), scarfMat);
    tail2.position.set(0.12, -0.02, 0.08);
    tail2.rotation.y = -0.85;
    tail2.visible = true;
    neck.add(tail2);
  }
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

function buildGltfCharacter(entry, opts) {

  opts = opts || {};
  var root = new THREE.Group();
  // Skinned Mixamo meshes need SkeletonUtils.clone (plain clone breaks bindings)
  var model = SkeletonUtils.clone(entry.gltf.scene);
  if (opts.customLook) {
    applyGoldenStasisLook(model, opts.lookTexture || (api._charLibrary && api._charLibrary.customLook));
  } else {
    applyGalleryAttireTint(
      model,
      opts.attire != null ? opts.attire : GLB_ATTIRE_TINTS[0],
      opts.skin != null ? opts.skin : 0xd4b896
    );
  }

  // Normalize adult height (~1.78m) — MetaHuman-like standing scale
  model.updateMatrixWorld(true);
  var box = new THREE.Box3().setFromObject(model);
  var size = new THREE.Vector3();
  box.getSize(size);
  var s = (TARGET_HUMAN_HEIGHT * (opts.scale || 1)) / Math.max(0.001, size.y);
  model.scale.setScalar(s);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  model.position.y = -box.min.y;
  root.add(model);

  var mixer = null;
  var actions = {};
  var donor = (api._charLibrary && api._charLibrary.donor) || null;
  var loco = collectLocomotionClips(entry, opts.borrowLocomotion !== false ? donor : null);
  var nativeAnims = (entry.gltf.animations && entry.gltf.animations.length) ? entry.gltf.animations : [];
  if (loco.walk || loco.idle || nativeAnims.length) {
    mixer = new THREE.AnimationMixer(model);
    var walkClip = loco.walk;
    var idleClip = loco.idle;
    var clip = walkClip || idleClip || nativeAnims[0];
    if (walkClip) actions.walk = mixer.clipAction(walkClip);
    if (idleClip) actions.idle = mixer.clipAction(idleClip);
    if (!actions.walk && clip) actions.walk = mixer.clipAction(clip);
    if (actions.idle) {
      actions.idle.play();
      actions.idle.setEffectiveWeight(1);
    }
    if (actions.walk) {
      actions.walk.play();
      actions.walk.setEffectiveWeight(actions.idle ? 0 : 0.35);
      actions.walk.setLoop(THREE.LoopRepeat, Infinity);
    }
    root.userData.mixer = mixer;
    root.userData.actions = actions;
    api._mixers.push(mixer);
  }

  if (opts.isPlayer) {
    var arrow = buildFacingArrow();
    // Place arrow at feet in front — not a chest badge
    arrow.position.set(0, 0.02, 0);
    root.add(arrow);
    api._facingArrow = arrow;
  }

  root.updateMatrixWorld(true);
  var bb = new THREE.Box3().setFromObject(root);
  var groundY = isFinite(bb.min.y) ? -bb.min.y : 0;
  if (groundY) root.position.y += groundY;

  root.userData.charKind = "gltf";
  root.userData.walkAmp = 0;
  root.userData.limbs = { phase: 0, groundY: root.position.y };
  root.userData.isPlayer = !!opts.isPlayer;
  root.userData.modelId = entry.id;
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

  if (root.userData.charKind === "inflated-cutout") {
    var Lc = root.userData.limbs || {};
    var targetC = moving ? 1 : 0;
    root.userData.walkAmp = (root.userData.walkAmp || 0) + (targetC - (root.userData.walkAmp || 0)) * Math.min(1, dt * 8);
    var ampC = root.userData.walkAmp || 0;
    Lc.phase = (Lc.phase || 0) + dt * (7.2 + ampC * 5.5);
    var bob = Math.abs(Math.sin(Lc.phase)) * ampC * 0.05;
    var sway = Math.sin(Lc.phase) * ampC;
    var h = Lc.height || TARGET_HUMAN_HEIGHT;
    if (Lc.rig) {
      Lc.rig.position.y = h * 0.5 + bob;
      Lc.rig.rotation.z = sway * 0.08;
      Lc.rig.rotation.x = -ampC * 0.05;
      var squash = 1 + Math.sin(Lc.phase * 2) * ampC * 0.02;
      Lc.rig.scale.set(1 - ampC * 0.01, squash, 1 - ampC * 0.01);
    }
    return;
  }

  if (root.userData.charKind === "gltf" && root.userData.mixer) {
    var actions = root.userData.actions || {};
    var w = root.userData.walkAmp || 0;
    var target = moving ? 1 : 0;
    root.userData.walkAmp = w + (target - w) * Math.min(1, dt * 6);
    w = root.userData.walkAmp;
    if (actions.walk && actions.idle) {
      actions.walk.setEffectiveWeight(w);
      actions.idle.setEffectiveWeight(1 - w);
      actions.walk.timeScale = 0.85 + w * 0.35;
    } else if (actions.walk) {
      actions.walk.setEffectiveWeight(0.3 + w * 0.7);
      actions.walk.timeScale = 0.7 + w * 0.6;
    }
    root.userData.mixer.update(dt);
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

/**
 * Build a silhouette Shape from cutout alpha (row min/max spans).
 * Normalized: x in ~[-0.5,0.5], y in [0,1] (feet→head). Used for extrusion volume.
 */
function sampleSilhouetteShape(image, maxW) {
  var iw = (image && (image.naturalWidth || image.width)) || 0;
  var ih = (image && (image.naturalHeight || image.height)) || 0;
  if (!iw || !ih) return null;
  var tw = Math.min(maxW || 56, iw);
  var th = Math.max(12, Math.round((tw * ih) / iw));
  var canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  var ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, tw, th);
  ctx.drawImage(image, 0, 0, tw, th);
  var data = ctx.getImageData(0, 0, tw, th).data;
  var thresh = 40;
  var left = [];
  var right = [];
  for (var y = 0; y < th; y++) {
    var minX = -1;
    var maxX = -1;
    var row = y * tw * 4;
    for (var x = 0; x < tw; x++) {
      if (data[row + x * 4 + 3] > thresh) {
        if (minX < 0) minX = x;
        maxX = x;
      }
    }
    if (minX >= 0) {
      left.push([minX, y]);
      right.push([maxX, y]);
    }
  }
  if (left.length < 4) return null;
  var step = Math.max(1, Math.floor(left.length / 40));
  function toPt(x, y) {
    var px = x / Math.max(1, tw - 1) - 0.5;
    var py = 1 - y / Math.max(1, th - 1);
    return new THREE.Vector2(px, py);
  }
  var pts = [];
  for (var i = 0; i < left.length; i += step) pts.push(toPt(left[i][0], left[i][1]));
  if ((left.length - 1) % step !== 0) {
    pts.push(toPt(left[left.length - 1][0], left[left.length - 1][1]));
  }
  for (var j = right.length - 1; j >= 0; j -= step) pts.push(toPt(right[j][0], right[j][1]));
  if (pts.length < 6) return null;
  return new THREE.Shape(pts);
}

/**
 * Player from alpha-cutout painting: dual textured faces + extruded silhouette hull
 * so she reads as a 3D inflated figure when orbiting (not a flat card / not Michelle atlas).
 */
function buildInflatedCutoutCharacter(cutoutTex, opts) {
  opts = opts || {};
  var root = new THREE.Group();
  var rig = new THREE.Group();
  root.add(rig);

  if (cutoutTex) {
    cutoutTex.colorSpace = THREE.SRGBColorSpace;
    cutoutTex.flipY = true;
    cutoutTex.anisotropy = Math.max(cutoutTex.anisotropy || 1, 8);
    cutoutTex.needsUpdate = true;
  }

  var img = cutoutTex && cutoutTex.image;
  var aspect = 0.55;
  if (img && (img.width || img.naturalWidth) && (img.height || img.naturalHeight)) {
    aspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height);
  }
  var height = TARGET_HUMAN_HEIGHT * (opts.scale || 1);
  var width = height * aspect;
  var depth = Math.max(0.14, Math.min(0.24, width * 0.32));

  var hullMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0xc9a227,
    metalness: 0.42,
    roughness: 0.42,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    side: THREE.FrontSide,
  }));
  var shape = img ? sampleSilhouetteShape(img, 64) : null;
  var hull;
  if (shape) {
    var hullGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 1,
      bevelEnabled: true,
      bevelThickness: 0.045,
      bevelSize: 0.03,
      bevelOffset: 0,
      bevelSegments: 2,
      curveSegments: 1,
    });
    hullGeo.translate(0, 0, -0.5);
    hull = new THREE.Mesh(trackGeo(hullGeo), hullMat);
    hull.scale.set(width * 0.98, height * 0.98, depth);
  } else {
    hull = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(width * 0.55, height * 0.92, depth)),
      hullMat
    );
  }
  hull.castShadow = true;
  hull.receiveShadow = true;
  hull.visible = true;
  hull.frustumCulled = false;
  rig.add(hull);

  if (cutoutTex) {
    var planeMat = trackMat(new THREE.MeshStandardMaterial({
      map: cutoutTex,
      color: 0xffffff,
      metalness: 0.22,
      roughness: 0.5,
      transparent: false,
      alphaTest: 0.4,
      depthWrite: true,
      side: THREE.FrontSide,
    }));
    var planeGeo = trackGeo(new THREE.PlaneGeometry(width, height));
    var front = new THREE.Mesh(planeGeo, planeMat);
    front.position.z = depth * 0.52;
    front.castShadow = true;
    front.visible = true;
    front.frustumCulled = false;
    rig.add(front);

    var backMat = trackMat(planeMat.clone());
    backMat.map = cutoutTex;
    backMat.alphaTest = 0.4;
    backMat.transparent = false;
    backMat.depthWrite = true;
    var back = new THREE.Mesh(planeGeo, backMat);
    back.position.z = -depth * 0.52;
    back.rotation.y = Math.PI;
    back.castShadow = true;
    back.visible = true;
    back.frustumCulled = false;
    rig.add(back);
  }

  rig.position.y = height * 0.5;

  if (opts.isPlayer) {
    var arrow = buildFacingArrow();
    arrow.position.set(0, 0.02, Math.max(0.12, depth * 0.35));
    root.add(arrow);
    api._facingArrow = arrow;
  }

  root.userData.charKind = "inflated-cutout";
  root.userData.walkAmp = 0;
  root.userData.limbs = {
    phase: Math.random() * Math.PI * 2,
    groundY: 0,
    rig: rig,
    height: height,
    width: width,
    depth: depth,
  };
  root.userData.isPlayer = !!opts.isPlayer;
  root.userData.modelId = "inflated-cutout";
  return root;
}

function pickGlbEntry(index) {
  var lib = api._charLibrary;
  if (!lib || !lib.glbs || !lib.glbs.length) return null;
  return lib.glbs[index % lib.glbs.length];
}

function buildPlayer() {
  var lib = api._charLibrary;
  // Featured: alpha-cutout gold-jumpsuit figure, structurally inflated + walk bob
  if (lib && lib.customCutout) {
    return buildInflatedCutoutCharacter(lib.customCutout, {
      isPlayer: true,
      scale: 1.0,
    });
  }
  if (lib && lib.custom) {
    return buildGltfCharacter(lib.custom, {
      isPlayer: true,
      scale: 1.0,
      customLook: true,
      lookTexture: lib.customLook,
      borrowLocomotion: true,
    });
  }
  var entry = pickGlbEntry(0);
  if (entry) {
    return buildGltfCharacter(entry, {
      isPlayer: true,
      scale: 1.0,
      attire: 0x2a2a30,
      skin: 0xd4b896,
    });
  }
  return buildHumanoid({
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

  scene.add(new THREE.AmbientLight(0xfff0e0, 0.28));
  scene.add(new THREE.HemisphereLight(0xfff2dc, 0x4a3830, 0.45));
  var sun = new THREE.DirectionalLight(0xffe8c8, 0.85);
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
  var fill = new THREE.DirectionalLight(0xffd8b0, 0.25);
  fill.position.set(-8, 6, 8); scene.add(fill);

  api._player = buildPlayer();
  var pgy = (api._player.userData.limbs && api._player.userData.limbs.groundY) || api._player.position.y || 0;
  api._player.position.set(0, pgy, 10);
  api._playerYaw = Math.PI;
  api._player.rotation.y = api._playerYaw;
  scene.add(api._player);

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
  var yaw = api._playerYaw;
  var pitch = api._lookPitch;
  var dist = api._camDist;
  var behindX = Math.sin(yaw);
  var behindZ = Math.cos(yaw);
  var cp = Math.cos(pitch);
  var sp = Math.sin(pitch);
  var cx = p.x + behindX * dist * cp;
  var cy = p.y + 1.55 + dist * sp * 0.85 + 0.35;
  var cz = p.z + behindZ * dist * cp;
  cx = Math.max(-11.5, Math.min(11.5, cx));
  cz = Math.max(-13.8, Math.min(13.8, cz));
  cy = Math.max(0.8, Math.min(6.5, cy));
  api._camera.position.set(cx, cy, cz);
  api._camera.lookAt(p.x, p.y + 1.35, p.z);
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

function step(dt) {
  if (!api._running || !api._player) return;
  var mx = 0, mz = 0;
  var k = api._keys;
  if (k.KeyW || k.ArrowUp) mz -= 1;
  if (k.KeyS || k.ArrowDown) mz += 1;
  if (k.KeyA || k.ArrowLeft) mx -= 1;
  if (k.KeyD || k.ArrowRight) mx += 1;

  var moved = 0;
  var yaw = api._playerYaw;
  if (mx || mz) {
    var len = Math.sqrt(mx * mx + mz * mz) || 1;
    mx /= len; mz /= len;
    var speed = 5.0;
    var fx = -Math.sin(yaw);
    var fz = -Math.cos(yaw);
    var rx = Math.cos(yaw);
    var rz = -Math.sin(yaw);
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
    api._walkAcc += moved;
    while (api._walkAcc >= 2.5) {
      api._walkAcc -= 2.5;
      if (api._opts && typeof api._opts.onWalkXp === "function") {
        try { api._opts.onWalkXp(1); } catch (e) {}
      }
    }
  }

  api._player.rotation.y = yaw;
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
    api._playerYaw -= e.movementX * sens;
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

  showLoader(true, "Loading Art Floor…");

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

  api._scene = new THREE.Scene();
  api._scene.background = new THREE.Color(0xd4c8b4);
  api._scene.fog = new THREE.Fog(0xd8cfc0, 28, 55);
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
    if (!api._firstFrameDone) showLoader(true, "Loading Art Floor…");
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
  if (!api._firstFrameDone) showLoader(true, "Loading Art Floor…");
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
