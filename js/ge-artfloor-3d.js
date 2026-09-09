/**
 * Grand Exchange Art Floor — third-person walkaround.
 * Style reference: assets/grand-exchange-art-floor.jpg (colors/layout only — NOT a wall mural).
 * - Local Three.js (importmap → vendor/three)
 * - Procedural 3D marble hall: columns, arched windows, chandeliers, green tables, easels
 * - Player + NPCs = photoreal fashion-photo dimensional characters (GLB + multi-angle photo meshes)
 * - Camera behind player; mouse look; WASD; wheel zoom; E at GE desk
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

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
  _charLibrary: null,
  _charTemplates: [],
  _mixers: [],
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
 * Photoreal / fashion-photo dimensional characters.
 * Prefers multi-angle photo meshes (true thickness + side/back maps) and optional GLB humans.
 * Single flat camera-facing billboards are banned.
 */
var CHAR_ASSET_BASE = "assets/artfloor-characters/";
var MAX_NPCS = 12;

var MESH_OUTFITS = [
  { id: "yellow_beret", coat: 0x2c3f5e, pants: 0x1a2230, shirt: 0xf0e6d8, beret: true, beretColor: 0xe8c030, tie: 0x8a2030, skirt: false, longCoat: false, dress: false, smock: false, tuxedo: false },
  { id: "tuxedo", coat: 0x101014, pants: 0x0a0a0e, shirt: 0xf7f4ef, beret: false, tie: 0xf0f0f0, tuxedo: true, longCoat: false, dress: false, smock: false },
  { id: "long_coat", coat: 0x3a2218, pants: 0x1a1410, shirt: 0xd8c8b0, beret: false, tie: 0x603020, longCoat: true, dress: false, smock: false, tuxedo: false },
  { id: "color_dress", coat: 0xc43a6e, pants: 0xc43a6e, shirt: 0xc43a6e, beret: false, dress: true, longCoat: false, smock: false, tuxedo: false, skin: 0xd4b896 },
  { id: "artist_smock", coat: 0xe8e0d0, pants: 0x3a4555, shirt: 0xe8e0d0, beret: true, beretColor: 0xe8c030, smock: true, dress: false, longCoat: false, tuxedo: false, tie: 0x4a7a3a },
  { id: "streetwear", coat: 0x2a6a4a, pants: 0x3a3a42, shirt: 0xe8d040, beret: false, hoodie: true, dress: false, longCoat: false, smock: false, tuxedo: false },
  { id: "gallery_red", coat: 0x8a2030, pants: 0x1a1214, shirt: 0xf2ebe0, beret: true, beretColor: 0xf0d050, longCoat: true, dress: false, smock: false, tuxedo: false },
  { id: "punk_mesh", coat: 0x2a2a30, pants: 0x1a3048, shirt: 0x203060, beret: false, spikes: true, overalls: true, dress: false, longCoat: false, smock: false, tuxedo: false },
];

function hexToThree(c) {
  return new THREE.Color(c);
}

function loadTextureAsync(url) {
  return new Promise(function (resolve) {
    var loader = new THREE.TextureLoader();
    loader.load(
      url,
      function (tex) {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        trackTex(tex);
        resolve(tex);
      },
      undefined,
      function () { resolve(null); }
    );
  });
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

async function loadCharacterLibrary() {
  if (api._charLibrary) return api._charLibrary;
  showLoader(true, "Loading gallery patrons…");
  var roster = null;
  try {
    var res = await fetch(CHAR_ASSET_BASE + "roster.json");
    if (res.ok) roster = await res.json();
  } catch (e) { roster = null; }

  var variants = (roster && roster.variants) || [];
  var kits = (roster && roster.kits) || [];
  var lib = { variants: [], kits: [], glbs: [], meshOutfits: MESH_OUTFITS.slice() };

  // Load photo variants (front cards)
  var vLoads = variants.map(async function (v) {
    var tex = await loadTextureAsync(CHAR_ASSET_BASE + v.file);
    if (tex) lib.variants.push({ id: v.id, tex: tex, src: v.src, hue: v.hue });
  });
  await Promise.all(vLoads);

  // Load multi-angle kits
  var kLoads = kits.map(async function (k) {
    var front = await loadTextureAsync(CHAR_ASSET_BASE + k.front);
    var side = k.side ? await loadTextureAsync(CHAR_ASSET_BASE + k.side) : null;
    var back = k.back ? await loadTextureAsync(CHAR_ASSET_BASE + k.back) : null;
    if (front) lib.kits.push({ id: k.id, front: front, side: side, back: back, label: k.label });
  });
  await Promise.all(kLoads);

  // Optional local GLB humans (offline)
  var glbFiles = ["glb/Soldier.glb", "glb/Xbot.glb"];
  for (var gi = 0; gi < glbFiles.length; gi++) {
    var g = await loadGltfAsync(CHAR_ASSET_BASE + glbFiles[gi]);
    if (g && g.scene) lib.glbs.push({ id: glbFiles[gi], gltf: g });
  }

  api._charLibrary = lib;
  return lib;
}

function makePhotoMat(map, opts) {
  opts = opts || {};
  var m = trackMat(new THREE.MeshStandardMaterial({
    map: map,
    transparent: true,
    alphaTest: 0.28,
    roughness: opts.roughness != null ? opts.roughness : 0.55,
    metalness: opts.metalness != null ? opts.metalness : 0.04,
    side: THREE.DoubleSide,
    depthWrite: true,
    emissive: new THREE.Color(0x101010),
    emissiveIntensity: 0.08,
  }));
  return m;
}

function makeSideFabricMat(fromTex) {
  // Sample a vertical strip look: reuse front tex with darker tint if no side
  var m = trackMat(new THREE.MeshStandardMaterial({
    map: fromTex || null,
    color: fromTex ? 0x8a8a8a : 0x2a2a30,
    transparent: !!fromTex,
    alphaTest: fromTex ? 0.35 : 0,
    roughness: 0.78,
    metalness: 0.03,
    side: THREE.DoubleSide,
  }));
  return m;
}

/**
 * Dimensional photo character: thick prism + diagonal photo shells + shadow volume.
 * Not a camera-facing billboard — orbits show real thickness and multi-angle maps.
 */
function buildPhotoCharacter(def, opts) {
  opts = opts || {};
  var isPlayer = !!opts.isPlayer;
  var scale = opts.scale || 1;
  var front = def.front || def.tex;
  var side = def.side || null;
  var back = def.back || null;
  if (!front) return buildDetailMeshCharacter(MESH_OUTFITS[0], opts);

  var root = new THREE.Group();
  var rig = new THREE.Group();
  root.add(rig);

  var img = front.image;
  var aspect = (img && img.width && img.height) ? (img.width / img.height) : 0.35;
  var height = 1.72 * scale;
  var width = Math.max(0.42, Math.min(0.95, height * aspect * 1.05));
  var depth = 0.38; // real volume — not paper-thin

  var frontMat = makePhotoMat(front, { roughness: 0.48 });
  var backMat = makePhotoMat(back || front, { roughness: 0.55 });
  if (!back) {
    backMat.color = new THREE.Color(0x5a5a60);
    backMat.emissiveIntensity = 0.02;
  }
  var sideMat = makeSideFabricMat(side || front);
  if (!side) sideMat.color = new THREE.Color(0x3a3a40);

  var topMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.9 }));
  var botMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.9 }));

  // Box face order: +x, -x, +y, -y, +z, -z
  var boxMats = [sideMat, sideMat, topMat, botMat, frontMat, backMat];
  var body = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(width, height, depth)), boxMats);
  body.position.y = height * 0.5;
  body.castShadow = true;
  body.receiveShadow = true;
  rig.add(body);

  // Diagonal photo shells — give continuous photoreal silhouette while orbiting
  function addShell(yaw, tex, inset) {
    if (!tex) return;
    var mat = makePhotoMat(tex, { roughness: 0.5 });
    mat.depthWrite = false;
    var plane = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(width * 0.98, height * 0.98)),
      mat
    );
    plane.position.set(Math.sin(yaw) * inset, height * 0.5, Math.cos(yaw) * inset);
    plane.rotation.y = yaw;
    plane.castShadow = false;
    rig.add(plane);
  }
  addShell(0, front, depth * 0.52);
  addShell(Math.PI, back || front, depth * 0.52);
  if (side) {
    addShell(Math.PI * 0.5, side, width * 0.42);
    addShell(-Math.PI * 0.5, side, width * 0.42);
  } else {
    // Soft cross for dimensionality when only one angle exists
    addShell(0.55, front, depth * 0.15);
    addShell(-0.55, front, depth * 0.15);
  }

  // Soft cylindrical rim so edges don't read as cardboard
  var rimMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0x2c2c32, roughness: 0.85, metalness: 0.02, transparent: true, opacity: 0.55,
  }));
  var rim = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(width * 0.28, width * 0.32, height * 0.92, 16)), rimMat);
  rim.position.y = height * 0.5;
  rim.scale.z = (depth * 0.55) / Math.max(0.01, width * 0.3);
  rim.castShadow = true;
  rig.add(rim);

  if (isPlayer) {
    var pin = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.05, 12, 10)),
      trackMat(new THREE.MeshStandardMaterial({
        color: 0xffe066, emissive: 0xaa8800, emissiveIntensity: 0.7, metalness: 0.55, roughness: 0.3,
      }))
    );
    pin.position.set(width * 0.28, height * 0.62, depth * 0.55);
    rig.add(pin);
    var arrow = buildFacingArrow();
    root.add(arrow);
    api._facingArrow = arrow;
  }

  root.userData.photoChar = true;
  root.userData.walkAmp = 0;
  root.userData.limbs = { phase: Math.random() * Math.PI * 2, rig: rig, height: height };
  root.userData.isPlayer = isPlayer;
  root.userData.charKind = "photo";
  return root;
}

/**
 * High-detail procedural mesh outfits (NOT Lego boxes) — drastic silhouette variety.
 * Used to diversify beyond photo clones: dress, tuxedo, long coat, smock, streetwear, etc.
 */
function buildDetailMeshCharacter(outfit, opts) {
  opts = opts || {};
  outfit = outfit || MESH_OUTFITS[0];
  var isPlayer = !!opts.isPlayer;
  var scale = opts.scale || 1;
  var skinHex = outfit.skin != null ? outfit.skin : 0xd4b896;
  var coatHex = outfit.coat != null ? outfit.coat : 0x2c3f5e;
  var pantsHex = outfit.pants != null ? outfit.pants : 0x1a2230;
  var shirtHex = outfit.shirt != null ? outfit.shirt : 0xf0e6d8;
  var hairHex = outfit.hair != null ? outfit.hair : 0x3a2918;

  var root = new THREE.Group();
  var rig = new THREE.Group();
  root.add(rig);

  var skinMat = trackMat(new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.62, metalness: 0.02 }));
  var coatMat = trackMat(new THREE.MeshStandardMaterial({ color: coatHex, roughness: 0.78, metalness: 0.04 }));
  var pantsMat = trackMat(new THREE.MeshStandardMaterial({ color: pantsHex, roughness: 0.82, metalness: 0.03 }));
  var shirtMat = trackMat(new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.7, metalness: 0 }));
  var hairMat = trackMat(new THREE.MeshStandardMaterial({ color: hairHex, roughness: 0.92, metalness: 0 }));
  var shoeMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.35, metalness: 0.25 }));

  function add(mesh, parent) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    (parent || rig).add(mesh);
    return mesh;
  }

  // Hips / pelvis — rounded
  var hips = add(new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.16, 16, 12)), pantsMat));
  hips.position.set(0, 0.92, 0);
  hips.scale.set(1.35, 0.55, 0.9);

  // Legs with fabric-stack suggestion (tapered capsules + knee bulge)
  var lLeg = new THREE.Group(); lLeg.position.set(-0.11, 0.92, 0); rig.add(lLeg);
  var rLeg = new THREE.Group(); rLeg.position.set(0.11, 0.92, 0); rig.add(rLeg);
  function buildLeg(leg) {
    var thigh = add(new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.075, 0.34, 8, 12)), pantsMat), leg);
    thigh.position.set(0, -0.22, 0);
    var knee = add(new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.07, 12, 10)), pantsMat), leg);
    knee.position.set(0, -0.42, 0.01);
    var shinG = new THREE.Group(); shinG.position.set(0, -0.44, 0); leg.add(shinG);
    var shin = add(new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.06, 0.32, 8, 12)), pantsMat), shinG);
    shin.position.set(0, -0.2, 0);
    // ankle fabric stack rings
    for (var i = 0; i < 3; i++) {
      var ring = add(new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.065 - i * 0.004, 0.012, 8, 14)), pantsMat), shinG);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, -0.38 - i * 0.03, 0.01);
    }
    var foot = add(new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.12, 0.07, 0.26)), shoeMat), shinG);
    foot.position.set(0, -0.46, 0.05);
    return shinG;
  }
  var lShin = buildLeg(lLeg);
  var rShin = buildLeg(rLeg);

  var torso = new THREE.Group(); torso.position.y = 0.92; rig.add(torso);

  if (outfit.dress) {
    // Flared dress via lathe-like scaled spheres / cones
    var bodice = add(new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.2, 0.35, 10, 16)), coatMat), torso);
    bodice.position.set(0, 0.42, 0);
    var skirt = add(new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.42, 0.18, 0.7, 20, 1, true)), coatMat), torso);
    skirt.position.set(0, 0.05, 0);
    var skirt2 = add(new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.4, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5)), coatMat), torso);
    skirt2.position.set(0, -0.2, 0); skirt2.scale.set(1, 0.55, 1);
  } else if (outfit.smock) {
    var smock = add(new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.24, 0.55, 10, 16)), coatMat), torso);
    smock.position.set(0, 0.4, 0); smock.scale.set(1.05, 1, 0.85);
    var pocket = add(new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.16, 0.14, 0.04)), shirtMat), torso);
    pocket.position.set(0.12, 0.25, 0.2);
  } else if (outfit.tuxedo) {
    var tux = add(new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.2, 0.5, 10, 16)), coatMat), torso);
    tux.position.set(0, 0.45, 0);
    var lapelL = add(new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.1, 0.38, 0.05)), coatMat), torso);
    lapelL.position.set(-0.12, 0.55, 0.16); lapelL.rotation.z = 0.25;
    var lapelR = add(new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.1, 0.38, 0.05)), coatMat), torso);
    lapelR.position.set(0.12, 0.55, 0.16); lapelR.rotation.z = -0.25;
    var shirt = add(new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.14, 0.35, 0.05)), shirtMat), torso);
    shirt.position.set(0, 0.55, 0.18);
    var bow = add(new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.14, 0.04, 0.04)), trackMat(new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.5 }))), torso);
    bow.position.set(0, 0.72, 0.2);
  } else if (outfit.longCoat) {
    var coat = add(new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.22, 0.7, 10, 16)), coatMat), torso);
    coat.position.set(0, 0.28, 0); coat.scale.set(1.15, 1.15, 0.9);
    var flare = add(new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.28, 0.2, 0.5, 16, 1, true)), coatMat), torso);
    flare.position.set(0, -0.05, 0);
  } else if (outfit.hoodie) {
    var hoodBody = add(new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.22, 0.45, 10, 16)), coatMat), torso);
    hoodBody.position.set(0, 0.42, 0);
    var hood = add(new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.18, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.65)), coatMat), torso);
    hood.position.set(0, 0.95, -0.02);
    var pouch = add(new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.28, 0.14, 0.08)), coatMat), torso);
    pouch.position.set(0, 0.28, 0.18);
  } else if (outfit.overalls) {
    var overall = add(new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.2, 0.5, 10, 16)), pantsMat), torso);
    overall.position.set(0, 0.4, 0);
    var bib = add(new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.28, 0.22, 0.08)), pantsMat), torso);
    bib.position.set(0, 0.7, 0.14);
    var blazer = add(new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.23, 0.35, 10, 16)), coatMat), torso);
    blazer.position.set(0, 0.55, 0); blazer.scale.set(1.15, 0.85, 1.05);
  } else {
    var coatDef = add(new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.21, 0.48, 10, 16)), coatMat), torso);
    coatDef.position.set(0, 0.45, 0);
    var shirtDef = add(new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.16, 0.28, 0.05)), shirtMat), torso);
    shirtDef.position.set(0, 0.62, 0.16);
  }

  // Shoulders + arms
  add(new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.1, 12, 10)), coatMat), torso).position.set(-0.26, 0.78, 0);
  add(new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.1, 12, 10)), coatMat), torso).position.set(0.26, 0.78, 0);
  var lArm = new THREE.Group(); lArm.position.set(-0.28, 0.76, 0); torso.add(lArm);
  var rArm = new THREE.Group(); rArm.position.set(0.28, 0.76, 0); torso.add(rArm);
  function buildArm(arm) {
    add(new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.055, 0.26, 8, 12)), coatMat), arm).position.set(0, -0.18, 0);
    var fore = new THREE.Group(); fore.position.set(0, -0.38, 0); arm.add(fore);
    add(new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.048, 0.24, 8, 12)), coatMat), fore).position.set(0, -0.14, 0);
    add(new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.055, 10, 8)), skinMat), fore).position.set(0, -0.32, 0);
    return fore;
  }
  var lFore = buildArm(lArm);
  var rFore = buildArm(rArm);

  // Neck + continuous head
  add(new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.055, 0.07, 0.12, 12)), skinMat), torso).position.set(0, 0.92, 0);
  var headG = new THREE.Group(); headG.position.set(0, 1.12, 0); torso.add(headG);
  add(new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.15, 24, 20)), skinMat), headG).scale.set(1, 1.15, 0.95);
  add(new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.11, 16, 12)), skinMat), headG).position.set(0, -0.05, 0.03);
  add(new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.155, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55)), hairMat), headG).position.set(0, 0.04, -0.01);

  if (outfit.spikes) {
    for (var s = 0; s < 10; s++) {
      var spike = add(new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.03, 0.22 + (s % 3) * 0.04, 6)), hairMat), headG);
      var ang = (s / 10) * Math.PI * 2;
      spike.position.set(Math.cos(ang) * 0.08, 0.16 + (s % 2) * 0.05, Math.sin(ang) * 0.08 - 0.02);
      spike.rotation.x = 0.4; spike.rotation.z = Math.cos(ang) * 0.5;
    }
  }
  if (outfit.beret) {
    var beretMat = trackMat(new THREE.MeshStandardMaterial({ color: outfit.beretColor || 0xe8c030, roughness: 0.7, metalness: 0.05 }));
    var beret = add(new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.17, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55)), beretMat), headG);
    beret.position.set(-0.02, 0.14, -0.02); beret.scale.set(1.15, 0.4, 1.15); beret.rotation.z = -0.2;
  }

  // Face features (small, continuous — no jaw hinge)
  var eyeW = trackMat(new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.35 }));
  var iris = trackMat(new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.35 }));
  function eye(ox) {
    var eg = new THREE.Group(); eg.position.set(ox, 0.03, 0.13); headG.add(eg);
    add(new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.024, 12, 10)), eyeW), eg);
    add(new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.014, 10, 8)), iris), eg).position.set(0, 0, 0.014);
  }
  eye(-0.05); eye(0.05);
  add(new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.02, 10, 8)), skinMat), headG).position.set(0, -0.02, 0.15);
  add(new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.05, 0.012, 0.015)), trackMat(new THREE.MeshStandardMaterial({ color: 0xb07070, roughness: 0.55 }))), headG).position.set(0, -0.08, 0.14);

  if (isPlayer) {
    var arrow = buildFacingArrow();
    root.add(arrow);
    api._facingArrow = arrow;
  }

  root.scale.setScalar(scale);
  root.userData.limbs = {
    lLeg: lLeg, rLeg: rLeg, lShin: lShin, rShin: rShin,
    lArm: lArm, rArm: rArm, lFore: lFore, rFore: rFore,
    torso: torso, head: headG, phase: Math.random() * Math.PI * 2, rig: rig,
  };
  root.userData.isPlayer = isPlayer;
  root.userData.walkAmp = 0;
  root.userData.charKind = "mesh";
  root.userData.photoChar = false;
  return root;
}

function buildGltfCharacter(entry, opts) {
  opts = opts || {};
  var root = new THREE.Group();
  var model = entry.gltf.scene.clone(true);
  model.traverse(function (o) {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) {
        o.material = o.material.clone();
        trackMat(o.material);
        // Fashion-tint military/default GLBs away from olive drab clones
        if (opts.tint != null) {
          if (o.material.color) o.material.color.offsetHSL(opts.tint, 0.15, 0.05);
        }
      }
    }
  });
  // Normalize height ~1.75
  var box = new THREE.Box3().setFromObject(model);
  var size = new THREE.Vector3();
  box.getSize(size);
  var s = (1.75 * (opts.scale || 1)) / Math.max(0.001, size.y);
  model.scale.setScalar(s);
  box.setFromObject(model);
  model.position.y = -box.min.y;
  root.add(model);

  var mixer = null;
  if (entry.gltf.animations && entry.gltf.animations.length) {
    mixer = new THREE.AnimationMixer(model);
    var clip = entry.gltf.animations.find(function (c) {
      return /walk|run|idle/i.test(c.name);
    }) || entry.gltf.animations[0];
    var walkClip = entry.gltf.animations.find(function (c) { return /walk/i.test(c.name); });
    var idleClip = entry.gltf.animations.find(function (c) { return /idle/i.test(c.name); });
    var actions = {};
    if (walkClip) actions.walk = mixer.clipAction(walkClip);
    if (idleClip) actions.idle = mixer.clipAction(idleClip);
    if (!actions.walk) actions.walk = mixer.clipAction(clip);
    if (actions.idle) { actions.idle.play(); actions.idle.setEffectiveWeight(1); }
    if (actions.walk) { actions.walk.play(); actions.walk.setEffectiveWeight(0); }
    root.userData.mixer = mixer;
    root.userData.actions = actions;
    api._mixers.push(mixer);
  }

  if (opts.isPlayer) {
    var arrow = buildFacingArrow();
    root.add(arrow);
    api._facingArrow = arrow;
  }
  root.userData.charKind = "gltf";
  root.userData.walkAmp = 0;
  root.userData.limbs = { phase: 0 };
  root.userData.isPlayer = !!opts.isPlayer;
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
      actions.walk.setEffectiveWeight(w);
      actions.idle.setEffectiveWeight(1 - w);
    } else if (actions.walk) {
      actions.walk.setEffectiveWeight(0.35 + w * 0.65);
      actions.walk.timeScale = 0.7 + w * 0.6;
    }
    root.userData.mixer.update(dt);
    return;
  }
  if (root.userData.photoChar) {
    var L = root.userData.limbs;
    if (!L || !L.rig) return;
    var targetP = moving ? 1 : 0;
    root.userData.walkAmp += (targetP - root.userData.walkAmp) * Math.min(1, dt * 8);
    var amp = root.userData.walkAmp;
    L.phase += dt * (7 + amp * 4);
    var bob = Math.abs(Math.sin(L.phase)) * amp * 0.045;
    var sway = Math.sin(L.phase) * amp * 0.04;
    L.rig.position.y = bob;
    L.rig.rotation.z = sway * 0.35;
    L.rig.rotation.x = Math.sin(L.phase * 2) * amp * 0.03;
    return;
  }
  var Lm = root.userData.limbs;
  if (!Lm || !Lm.lLeg) return;
  var targetM = moving ? 1 : 0;
  root.userData.walkAmp += (targetM - root.userData.walkAmp) * Math.min(1, dt * 8);
  var ampm = root.userData.walkAmp;
  Lm.phase += dt * (6.5 + ampm * 4);
  var sw = Math.sin(Lm.phase) * ampm;
  var sw2 = Math.sin(Lm.phase + Math.PI) * ampm;
  Lm.lLeg.rotation.x = sw * 0.7;
  Lm.rLeg.rotation.x = sw2 * 0.7;
  Lm.lShin.rotation.x = Math.max(0, -sw) * 0.55;
  Lm.rShin.rotation.x = Math.max(0, -sw2) * 0.55;
  Lm.lArm.rotation.x = sw2 * 0.55;
  Lm.rArm.rotation.x = sw * 0.55;
  Lm.lFore.rotation.x = -0.15 - Math.max(0, sw2) * 0.25;
  Lm.rFore.rotation.x = -0.15 - Math.max(0, sw) * 0.25;
  Lm.torso.position.y = 0.92 + Math.abs(sw) * 0.035;
  Lm.head.rotation.y = sw * 0.04;
}

function pickCharacterDef(index, preferKit) {
  var lib = api._charLibrary;
  if (!lib) return { kind: "mesh", outfit: MESH_OUTFITS[index % MESH_OUTFITS.length] };
  // Mix heavily toward photoreal photo people + drastically different mesh outfits.
  // Lane layout (12 NPCs): photo, mesh, photo, photo, mesh, photo, mesh, photo, gltf?, photo, mesh, photo
  if (preferKit && lib.kits.length) {
    return { kind: "photo", def: lib.kits[index % lib.kits.length] };
  }
  var lane = index % 6;
  if ((lane === 0 || lane === 2 || lane === 3 || lane === 5) && lib.variants.length) {
    var v = lib.variants[index % lib.variants.length];
    // Prefer multi-angle kit every few for better orbit dimensionality
    if (lane === 0 && lib.kits.length) {
      return { kind: "photo", def: lib.kits[index % lib.kits.length] };
    }
    return { kind: "photo", def: { front: v.tex, id: v.id } };
  }
  if (lane === 4 && lib.glbs.length) {
    return { kind: "gltf", entry: lib.glbs[index % lib.glbs.length], tint: (index * 0.21) % 1 };
  }
  // lane 1 (and fallback): high-detail mesh with drastically different silhouette/outfit
  return { kind: "mesh", outfit: MESH_OUTFITS[index % MESH_OUTFITS.length] };
}

function buildCharacterFromPick(pick, opts) {
  opts = opts || {};
  if (pick.kind === "photo") return buildPhotoCharacter(pick.def, opts);
  if (pick.kind === "gltf") return buildGltfCharacter(pick.entry, Object.assign({}, opts, { tint: pick.tint }));
  return buildDetailMeshCharacter(pick.outfit, opts);
}

function buildPlayer() {
  var pick = pickCharacterDef(0, true);
  // Player: prefer multi-angle kit for max dimensionality, else first photo variant
  var lib = api._charLibrary;
  if (lib && lib.kits.length) {
    return buildPhotoCharacter(lib.kits[0], { isPlayer: true, scale: 1.04 });
  }
  if (lib && lib.variants.length) {
    return buildPhotoCharacter({ front: lib.variants[0].tex }, { isPlayer: true, scale: 1.04 });
  }
  return buildDetailMeshCharacter(MESH_OUTFITS[0], { isPlayer: true, scale: 1.04 });
}

function buildNpc(x, z, index) {
  var pick = pickCharacterDef(index + 1, false);
  var g = buildCharacterFromPick(pick, { scale: 0.94 + (index % 5) * 0.025 });
  g.position.set(x, 0, z);
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

/** Simple looping walk paths around the hall (avoids random jitter into props). */
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
    [[-2, 8], [2, 9], [5, 8], [3, 6], [-2, 8]],
    [[7, -1], [5, -4], [8, -4], [9, -1], [7, -1]],
    [[-5, 4], [-2, 2], [0, 4], [-3, 6], [-5, 4]],
    [[3, 3], [6, 2], [8, 5], [5, 6], [3, 3]],
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
  api._player.position.set(0, 0, 10);
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
    var npc = buildNpc(start[0], start[1], spawned);
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
    n.group.position.set(n.x, 0, n.z);
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
  n.group.position.set(n.x, 0, n.z);
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
    if (!api._firstFrameDone) {
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

  var urls = (api._opts && api._opts.getPaintingUrls && api._opts.getPaintingUrls()) || defaultPaintingUrls();
  showLoader(true, "Loading gallery patrons…");
  loadCharacterLibrary().then(function () {
    if (api._disposed) return;
    buildHall();
    setPaintingUrls(urls);
    updateCamera(0.016);
    try { api._renderer.render(api._scene, api._camera); } catch (eR) {}
    api._ready = true;
    showLoader(true, "Loading Art Floor…");
    preloadCritical(urls, function () {});
    // If start() was already called, kick the loop now
    if (api._running && !api._raf) {
      api._lastTs = 0;
      api._raf = requestAnimationFrame(loop);
    }
  }).catch(function (err) {
    console.warn("[ArtFloor] character load failed, using mesh outfits", err);
    if (api._disposed) return;
    api._charLibrary = { variants: [], kits: [], glbs: [], meshOutfits: MESH_OUTFITS.slice() };
    buildHall();
    setPaintingUrls(urls);
    updateCamera(0.016);
    api._ready = true;
    if (api._running && !api._raf) {
      api._lastTs = 0;
      api._raf = requestAnimationFrame(loop);
    }
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
    if (api._ready && !api._raf) api._raf = requestAnimationFrame(loop);
    return;
  }
  api._running = true;
  api._lastTs = 0;
  bindInput();
  resize();
  if (!api._firstFrameDone) showLoader(true, "Loading Art Floor…");
  if (api._ready && !api._raf) api._raf = requestAnimationFrame(loop);
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
  api._mixers = []; api._charLibrary = null; api._charTemplates = [];
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
