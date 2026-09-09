/**
 * Grand Exchange Art Floor — third-person walkaround.
 * Style reference: assets/grand-exchange-art-floor.jpg (colors/layout only — NOT a wall mural).
 * - Local Three.js (importmap → vendor/three)
 * - Procedural 3D marble hall: columns, arched windows, chandeliers, green tables, easels
 * - Player + NPCs = proper 3D human meshes (suits/coats, optional yellow berets, walk cycles)
 * - Camera behind player; mouse look; WASD; wheel zoom; E at GE desk
 */
import * as THREE from "three";

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
 * Realistic-enough 3D gallery patron.
 * Continuous head mesh (no horizontal jaw hinge / South Park Canadian split).
 * Face features are small front-mounted meshes; beret optional.
 */
function buildHumanoid(opts) {
  opts = opts || {};
  var coatHex = opts.coat != null ? opts.coat : 0x2c3f5e;
  var pantsHex = opts.pants != null ? opts.pants : 0x1a2230;
  var skinHex = opts.skin != null ? opts.skin : 0xd4b896;
  var shirtHex = opts.shirt != null ? opts.shirt : 0xf0e6d8;
  var hairHex = opts.hair != null ? opts.hair : 0x3a2918;
  var tieHex = opts.tie != null ? opts.tie : 0x8a2030;
  var withBeret = opts.beret !== false;
  var beretHex = opts.beretColor != null ? opts.beretColor : 0xe8c030;
  var isPlayer = !!opts.isPlayer;
  var scale = opts.scale || 1;

  var root = new THREE.Group();
  var rig = new THREE.Group();
  root.add(rig);

  var skinMat = trackMat(new THREE.MeshStandardMaterial({
    color: skinHex, roughness: 0.55, metalness: 0.02,
  }));
  var coatMat = trackMat(new THREE.MeshStandardMaterial({
    color: coatHex, roughness: 0.72, metalness: 0.05,
  }));
  var pantsMat = trackMat(new THREE.MeshStandardMaterial({
    color: pantsHex, roughness: 0.78, metalness: 0.04,
  }));
  var shirtMat = trackMat(new THREE.MeshStandardMaterial({
    color: shirtHex, roughness: 0.85, metalness: 0,
  }));
  var hairMat = trackMat(new THREE.MeshStandardMaterial({
    color: hairHex, roughness: 0.9, metalness: 0,
  }));
  var shoeMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0x1a1410, roughness: 0.55, metalness: 0.15,
  }));
  var beretMat = trackMat(new THREE.MeshStandardMaterial({
    color: beretHex, roughness: 0.7, metalness: 0.05,
  }));

  function mesh(geo, mat, px, py, pz, sx, sy, sz) {
    var m = new THREE.Mesh(trackGeo(geo), mat);
    m.position.set(px || 0, py || 0, pz || 0);
    if (sx != null) m.scale.set(sx, sy != null ? sy : sx, sz != null ? sz : sx);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // —— Legs (hip → thigh → shin → foot) ——
  var lLeg = new THREE.Group();
  lLeg.position.set(-0.13, 0.95, 0);
  var lThigh = mesh(new THREE.CapsuleGeometry(0.09, 0.32, 6, 10), pantsMat, 0, -0.22, 0);
  lLeg.add(lThigh);
  var lShinG = new THREE.Group();
  lShinG.position.set(0, -0.44, 0);
  var lShin = mesh(new THREE.CapsuleGeometry(0.075, 0.3, 6, 10), pantsMat, 0, -0.2, 0);
  lShinG.add(lShin);
  var lFoot = mesh(new THREE.BoxGeometry(0.14, 0.08, 0.28), shoeMat, 0, -0.42, 0.05);
  lShinG.add(lFoot);
  lLeg.add(lShinG);
  rig.add(lLeg);

  var rLeg = new THREE.Group();
  rLeg.position.set(0.13, 0.95, 0);
  var rThigh = mesh(new THREE.CapsuleGeometry(0.09, 0.32, 6, 10), pantsMat, 0, -0.22, 0);
  rLeg.add(rThigh);
  var rShinG = new THREE.Group();
  rShinG.position.set(0, -0.44, 0);
  var rShin = mesh(new THREE.CapsuleGeometry(0.075, 0.3, 6, 10), pantsMat, 0, -0.2, 0);
  rShinG.add(rShin);
  var rFoot = mesh(new THREE.BoxGeometry(0.14, 0.08, 0.28), shoeMat, 0, -0.42, 0.05);
  rShinG.add(rFoot);
  rLeg.add(rShinG);
  rig.add(rLeg);

  // —— Torso / coat ——
  var torso = new THREE.Group();
  torso.position.y = 0.95;
  var hips = mesh(new THREE.BoxGeometry(0.42, 0.18, 0.28), pantsMat, 0, 0.05, 0);
  torso.add(hips);
  var coat = mesh(new THREE.BoxGeometry(0.48, 0.72, 0.32), coatMat, 0, 0.48, 0);
  torso.add(coat);
  // Coat flare / lapels
  var lapelL = mesh(new THREE.BoxGeometry(0.1, 0.42, 0.06), coatMat, -0.14, 0.55, 0.16);
  lapelL.rotation.z = 0.12; torso.add(lapelL);
  var lapelR = mesh(new THREE.BoxGeometry(0.1, 0.42, 0.06), coatMat, 0.14, 0.55, 0.16);
  lapelR.rotation.z = -0.12; torso.add(lapelR);
  // Shirt triangle + collar
  var shirt = mesh(new THREE.BoxGeometry(0.18, 0.28, 0.06), shirtMat, 0, 0.68, 0.15);
  torso.add(shirt);
  var collarL = mesh(new THREE.BoxGeometry(0.1, 0.06, 0.08), shirtMat, -0.08, 0.84, 0.14);
  collarL.rotation.z = 0.4; torso.add(collarL);
  var collarR = mesh(new THREE.BoxGeometry(0.1, 0.06, 0.08), shirtMat, 0.08, 0.84, 0.14);
  collarR.rotation.z = -0.4; torso.add(collarR);
  var tie = mesh(new THREE.BoxGeometry(0.06, 0.28, 0.03), trackMat(new THREE.MeshStandardMaterial({
    color: tieHex, roughness: 0.65, metalness: 0.05,
  })), 0, 0.62, 0.18);
  torso.add(tie);
  // Shoulders
  var shL = mesh(new THREE.SphereGeometry(0.12, 12, 10), coatMat, -0.28, 0.78, 0);
  torso.add(shL);
  var shR = mesh(new THREE.SphereGeometry(0.12, 12, 10), coatMat, 0.28, 0.78, 0);
  torso.add(shR);

  if (isPlayer) {
    var pin = mesh(new THREE.SphereGeometry(0.045, 10, 8), trackMat(new THREE.MeshStandardMaterial({
      color: 0xffe066, emissive: 0xaa8800, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3,
    })), 0.16, 0.55, 0.18);
    torso.add(pin);
  }

  // —— Arms ——
  var lArm = new THREE.Group();
  lArm.position.set(-0.3, 0.78, 0);
  var lUpper = mesh(new THREE.CapsuleGeometry(0.07, 0.28, 6, 10), coatMat, 0, -0.2, 0);
  lArm.add(lUpper);
  var lFore = new THREE.Group();
  lFore.position.set(0, -0.4, 0);
  var lForeMesh = mesh(new THREE.CapsuleGeometry(0.06, 0.26, 6, 10), coatMat, 0, -0.16, 0);
  lFore.add(lForeMesh);
  var lHand = mesh(new THREE.SphereGeometry(0.07, 10, 8), skinMat, 0, -0.34, 0);
  lFore.add(lHand);
  lArm.add(lFore);
  torso.add(lArm);

  var rArm = new THREE.Group();
  rArm.position.set(0.3, 0.78, 0);
  var rUpper = mesh(new THREE.CapsuleGeometry(0.07, 0.28, 6, 10), coatMat, 0, -0.2, 0);
  rArm.add(rUpper);
  var rFore = new THREE.Group();
  rFore.position.set(0, -0.4, 0);
  var rForeMesh = mesh(new THREE.CapsuleGeometry(0.06, 0.26, 6, 10), coatMat, 0, -0.16, 0);
  rFore.add(rForeMesh);
  var rHand = mesh(new THREE.SphereGeometry(0.07, 10, 8), skinMat, 0, -0.34, 0);
  rFore.add(rHand);
  rArm.add(rFore);
  torso.add(rArm);

  // —— Neck + continuous head (NO jaw hinge plane) ——
  var neck = mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.14, 12), skinMat, 0, 0.92, 0);
  torso.add(neck);

  var headG = new THREE.Group();
  headG.position.set(0, 1.12, 0);
  // Slightly elongated continuous skull — one mesh, no mouth split
  var skull = mesh(new THREE.SphereGeometry(0.175, 24, 20), skinMat, 0, 0.02, 0.01, 1, 1.12, 0.95);
  headG.add(skull);
  // Soft cheek fill (still continuous look)
  var jawFill = mesh(new THREE.SphereGeometry(0.12, 16, 12), skinMat, 0, -0.06, 0.04, 1.15, 0.85, 0.95);
  headG.add(jawFill);

  // Hair cap
  var hair = mesh(new THREE.SphereGeometry(0.178, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat, 0, 0.04, -0.01, 1.02, 1.05, 1.0);
  headG.add(hair);

  // Ears
  headG.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), skinMat, -0.17, 0.0, 0, 0.7, 1.1, 0.6));
  headG.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), skinMat, 0.17, 0.0, 0, 0.7, 1.1, 0.6));

  // Eyes — proper sockets, not a face card
  var eyeWhite = trackMat(new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.35 }));
  var irisMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.35 }));
  var pupilMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.25 }));
  function eye(ox) {
    var eg = new THREE.Group();
    eg.position.set(ox, 0.03, 0.145);
    eg.add(mesh(new THREE.SphereGeometry(0.028, 12, 10), eyeWhite, 0, 0, 0));
    eg.add(mesh(new THREE.SphereGeometry(0.016, 10, 8), irisMat, 0, 0, 0.016));
    eg.add(mesh(new THREE.SphereGeometry(0.008, 8, 6), pupilMat, 0, 0, 0.026));
    // brow
    var brow = mesh(new THREE.BoxGeometry(0.07, 0.012, 0.02), hairMat, 0, 0.038, 0.01);
    eg.add(brow);
    return eg;
  }
  headG.add(eye(-0.055));
  headG.add(eye(0.055));

  // Nose — small bridge, not a cartoon wedge across the face
  var nose = mesh(new THREE.BoxGeometry(0.03, 0.05, 0.045), skinMat, 0, -0.02, 0.165);
  headG.add(nose);
  var tip = mesh(new THREE.SphereGeometry(0.018, 10, 8), skinMat, 0, -0.04, 0.185);
  headG.add(tip);

  // Mouth — tiny lip strip ONLY (never a head-wide hinge)
  var lipMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0xb07070, roughness: 0.55, metalness: 0.05,
  }));
  var mouth = mesh(new THREE.BoxGeometry(0.055, 0.012, 0.018), lipMat, 0, -0.085, 0.155);
  headG.add(mouth);
  // Soft lip shade under (reads as closed mouth, not jaw seam)
  var mouthShade = mesh(new THREE.BoxGeometry(0.048, 0.006, 0.012), trackMat(new THREE.MeshStandardMaterial({
    color: 0x8a5050, roughness: 0.7,
  })), 0, -0.095, 0.152);
  headG.add(mouthShade);

  if (withBeret) {
    var beret = mesh(new THREE.SphereGeometry(0.2, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), beretMat, -0.02, 0.16, -0.02, 1.15, 0.45, 1.15);
    beret.rotation.z = -0.18;
    beret.rotation.x = -0.12;
    headG.add(beret);
    var beretTop = mesh(new THREE.SphereGeometry(0.06, 12, 10), beretMat, -0.06, 0.22, -0.02, 1, 0.5, 1);
    headG.add(beretTop);
  }

  torso.add(headG);
  rig.add(torso);

  if (isPlayer) {
    var arrow = buildFacingArrow();
    root.add(arrow);
    api._facingArrow = arrow;
  }

  root.scale.setScalar(scale);
  root.userData.limbs = {
    lLeg: lLeg, rLeg: rLeg, lShin: lShinG, rShin: rShinG,
    lArm: lArm, rArm: rArm, lFore: lFore, rFore: rFore,
    torso: torso, head: headG, phase: Math.random() * Math.PI * 2,
  };
  root.userData.isPlayer = isPlayer;
  root.userData.walkAmp = 0;
  return root;
}

function animateHumanoid(root, moving, dt) {
  var L = root && root.userData && root.userData.limbs;
  if (!L) return;
  var target = moving ? 1 : 0;
  root.userData.walkAmp += (target - root.userData.walkAmp) * Math.min(1, dt * 8);
  var amp = root.userData.walkAmp;
  L.phase += dt * (6.5 + amp * 4);
  var sw = Math.sin(L.phase) * amp;
  var sw2 = Math.sin(L.phase + Math.PI) * amp;
  L.lLeg.rotation.x = sw * 0.7;
  L.rLeg.rotation.x = sw2 * 0.7;
  L.lShin.rotation.x = Math.max(0, -sw) * 0.55;
  L.rShin.rotation.x = Math.max(0, -sw2) * 0.55;
  L.lArm.rotation.x = sw2 * 0.55;
  L.rArm.rotation.x = sw * 0.55;
  L.lFore.rotation.x = -0.15 - Math.max(0, sw2) * 0.25;
  L.rFore.rotation.x = -0.15 - Math.max(0, sw) * 0.25;
  L.torso.position.y = 0.95 + Math.abs(sw) * 0.035;
  L.head.rotation.y = sw * 0.04;
}

var NPC_PALETTES = [
  { coat: 0x2c3f5e, pants: 0x1a2230, beret: true, beretColor: 0xe8c030, tie: 0x8a2030 },
  { coat: 0x3a2450, pants: 0x241828, beret: true, beretColor: 0xe8c030, tie: 0x2a5080 },
  { coat: 0x2a2a2e, pants: 0x18181c, beret: false, tie: 0x4a3020 },
  { coat: 0x1e4a36, pants: 0x142820, beret: true, beretColor: 0xf0d050, tie: 0xc9a227 },
  { coat: 0x4a3420, pants: 0x2a1c10, beret: true, beretColor: 0xe8c030, tie: 0x303850 },
  { coat: 0x243048, pants: 0x141820, beret: false, tie: 0x803030 },
  { coat: 0x503028, pants: 0x281818, beret: true, beretColor: 0xd4a820, skin: 0xc4a070, tie: 0x203060 },
  { coat: 0x1a3048, pants: 0x101820, beret: true, beretColor: 0xe8c030, skin: 0xb89070, tie: 0x805020 },
];

function buildPlayer() {
  return buildHumanoid({
    coat: 0x2d6a4f,
    pants: 0x1a3328,
    shirt: 0xf2ebe0,
    tie: 0xc9a227,
    beret: true,
    beretColor: 0xe8c030,
    isPlayer: true,
    scale: 1.02,
  });
}

function buildNpc(x, z, palette) {
  var p = palette || NPC_PALETTES[0];
  var g = buildHumanoid({
    coat: p.coat,
    pants: p.pants,
    skin: p.skin,
    shirt: p.shirt,
    hair: p.hair,
    tie: p.tie,
    beret: p.beret,
    beretColor: p.beretColor,
    scale: 0.95 + Math.random() * 0.1,
  });
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
  for (var ni = 0; ni < paths.length; ni++) {
    var path = paths[ni];
    var start = path[0];
    if (collidesAt(start[0], start[1], 0.55)) continue;
    var npc = buildNpc(start[0], start[1], NPC_PALETTES[ni % NPC_PALETTES.length]);
    npc.path = path;
    npc.pathI = 0;
    npc.yaw = Math.atan2(-(path[1][0] - start[0]), -(path[1][1] - start[1]));
    npc.group.rotation.y = npc.yaw;
    scene.add(npc.group);
    api._npcs.push(npc);
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

  buildHall();
  var urls = (api._opts && api._opts.getPaintingUrls && api._opts.getPaintingUrls()) || defaultPaintingUrls();
  setPaintingUrls(urls);
  updateCamera(0.016);
  try { api._renderer.render(api._scene, api._camera); } catch (eR) {}

  preloadCritical(urls, function () {});

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
  api._ready = true;
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
