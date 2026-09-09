/**
 * Grand Exchange Art Floor — high-fidelity third-person walkaround.
 * Styled after assets/grand-exchange-art-floor.jpg.
 * - Local Three.js (importmap → vendor/three)
 * - High-res mural / marble / easel paintings (not prototype grey)
 * - People = high-res textured cards from Art Floor painting crops (not capsules / low-poly blocks)
 * - Camera locked behind player; mouse look turns facing; WASD relative to facing; wheel zoom
 */
import * as THREE from "three";

var MURAL_URL = "assets/grand-exchange-art-floor-hi.jpg";
var MURAL_FALLBACK = "assets/grand-exchange-art-floor.jpg";
var PEOPLE_URLS = [
  "assets/artfloor-people/p1.jpg",
  "assets/artfloor-people/p2.jpg",
  "assets/artfloor-people/p3.jpg",
  "assets/artfloor-people/p4.jpg",
  "assets/artfloor-people/p5.jpg",
  "assets/artfloor-people/p6.jpg",
  "assets/artfloor-people/p7.jpg",
  "assets/artfloor-people/p8.jpg",
];
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
  _peopleTex: [],
  _disposed: false,
  _facingArrow: null,
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
  c.width = size;
  c.height = size;
  var ctx = c.getContext("2d");
  var grd = ctx.createLinearGradient(0, 0, size, size);
  grd.addColorStop(0, "#f2ebe0");
  grd.addColorStop(0.35, "#e6ddd0");
  grd.addColorStop(0.7, "#efe6d8");
  grd.addColorStop(1, "#ddd2c2");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  var tile = size / 8;
  // Soft per-tile variation
  for (var ty = 0; ty < 8; ty++) {
    for (var tx = 0; tx < 8; tx++) {
      var n = Math.random();
      ctx.fillStyle = n > 0.5
        ? "rgba(255,252,245," + (0.03 + n * 0.05).toFixed(3) + ")"
        : "rgba(120,100,80," + ((0.5 - n) * 0.08).toFixed(3) + ")";
      ctx.fillRect(tx * tile + 2, ty * tile + 2, tile - 4, tile - 4);
    }
  }
  // Veining
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
  // Grout
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

/** High-res painted player card (front) — readable gallery patron, not a pill. */
function makePlayerCardTexture(back) {
  var c = document.createElement("canvas");
  c.width = 768; c.height = 1536;
  var ctx = c.getContext("2d");
  // Transparent bg
  ctx.clearRect(0, 0, 768, 1536);
  // Soft contact shadow
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(384, 1480, 160, 28, 0, 0, Math.PI * 2);
  ctx.fill();

  var suit = back ? "#1e4a36" : "#2d6a4f";
  var pants = "#1a3328";
  var skin = "#d4b896";
  var shirt = "#f2ebe0";

  // Legs
  ctx.fillStyle = pants;
  ctx.fillRect(280, 900, 90, 420);
  ctx.fillRect(400, 900, 90, 420);
  // Shoes
  ctx.fillStyle = "#1a1410";
  ctx.fillRect(265, 1300, 110, 50);
  ctx.fillRect(395, 1300, 110, 50);
  // Coat / torso
  ctx.fillStyle = suit;
  roundRect(ctx, 230, 480, 310, 460, 24);
  ctx.fill();
  // Shirt
  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.moveTo(384, 500);
  ctx.lineTo(340, 700);
  ctx.lineTo(428, 700);
  ctx.closePath();
  ctx.fill();
  // Arms
  ctx.fillStyle = suit;
  ctx.save();
  ctx.translate(230, 520);
  ctx.rotate(0.18);
  roundRect(ctx, -70, 0, 80, 380, 20); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(540, 520);
  ctx.rotate(-0.18);
  roundRect(ctx, -10, 0, 80, 380, 20); ctx.fill();
  ctx.restore();
  // Hands
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(175, 900, 36, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(595, 900, 36, 0, Math.PI * 2); ctx.fill();
  // Neck + head
  ctx.fillStyle = skin;
  ctx.fillRect(350, 400, 68, 90);
  ctx.beginPath(); ctx.ellipse(384, 320, 110, 130, 0, 0, Math.PI * 2); ctx.fill();
  if (!back) {
    // Face
    ctx.fillStyle = "rgba(60,40,30,0.55)";
    ctx.beginPath(); ctx.ellipse(345, 310, 12, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(423, 310, 12, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(90,60,45,0.45)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(384, 355, 28, 0.15, Math.PI - 0.15); ctx.stroke();
    // Nose
    ctx.fillStyle = "rgba(180,140,110,0.5)";
    ctx.beginPath(); ctx.ellipse(384, 335, 10, 14, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    // Hair back
    ctx.fillStyle = "#3a2918";
    ctx.beginPath(); ctx.ellipse(384, 280, 100, 70, 0, Math.PI, Math.PI * 2); ctx.fill();
  }
  // Yellow beret (flat, painting style)
  ctx.fillStyle = "#e8c030";
  ctx.beginPath();
  ctx.ellipse(370, 200, 130, 48, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f0d060";
  ctx.beginPath();
  ctx.ellipse(355, 175, 50, 22, -0.2, 0, Math.PI * 2);
  ctx.fill();
  // Gold chest pin (you-marker)
  if (!back) {
    ctx.fillStyle = "#ffe066";
    ctx.beginPath(); ctx.arc(470, 620, 16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#c9a227";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  var tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return trackTex(tex);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
  var shaft = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.15, h - 0.6, 1.15)), mat);
  shaft.position.y = (h - 0.6) / 2 + 0.3;
  shaft.castShadow = true; shaft.receiveShadow = true;
  g.add(shaft);
  var cap = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.5, 0.28, 1.5)), mat);
  cap.position.y = h - 0.05;
  cap.castShadow = true; g.add(cap);
  var base = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.55, 0.35, 1.55)), mat);
  base.position.y = 0.175;
  base.receiveShadow = true; g.add(base);
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

function buildArchedWindow(x, y, z) {
  var g = new THREE.Group();
  var frameMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xd4c8b4, roughness: 0.5, metalness: 0.08 }));
  var glassMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0xb0cce8, emissive: 0xfff2d0, emissiveIntensity: 0.65,
    roughness: 0.3, metalness: 0.05, transparent: true, opacity: 0.9,
  }));
  var recess = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.9, 3.5, 0.3)), frameMat);
  recess.position.z = -0.05; g.add(recess);
  var glass = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.5, 2.8, 0.05)), glassMat);
  glass.position.set(0, -0.1, 0.1); g.add(glass);
  var arch = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(0.78, 20, 0, Math.PI)), glassMat);
  arch.position.set(0, 1.4, 0.11); g.add(arch);
  var mullion = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.07, 2.8, 0.07)), frameMat);
  mullion.position.set(0, -0.1, 0.12); g.add(mullion);
  g.position.set(x, y, z);
  return g;
}

/**
 * High-res person card from Art Floor painting crop.
 * Rotates with yaw (NOT camera billboard) so facing is readable.
 */
function buildPersonCard(tex, opts) {
  opts = opts || {};
  var g = new THREE.Group();
  var w = opts.w || 0.95;
  var h = opts.h || 1.85;
  var mat = trackMat(new THREE.MeshStandardMaterial({
    map: tex || null,
    color: tex ? 0xffffff : 0x445566,
    roughness: 0.65,
    metalness: 0.05,
    transparent: true,
    alphaTest: 0.12,
    side: THREE.DoubleSide,
  }));
  var plane = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(w, h)), mat);
  plane.position.y = h / 2;
  plane.castShadow = true;
  plane.receiveShadow = true;
  g.add(plane);
  // Thin "body depth" so silhouette reads in profile
  var edge = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(w * 0.08, h * 0.92, 0.12)),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.8 }))
  );
  edge.position.y = h / 2; edge.castShadow = true; g.add(edge);
  g.userData.facePlane = plane;
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

function buildPlayer() {
  var g = new THREE.Group();
  var frontTex = makePlayerCardTexture(false);
  var backTex = makePlayerCardTexture(true);
  var front = buildPersonCard(frontTex, { w: 1.0, h: 1.9 });
  // Remove inner edge from nested group — re-parent plane only feel
  g.add(front);
  var backMat = trackMat(new THREE.MeshStandardMaterial({
    map: backTex, roughness: 0.65, transparent: true, alphaTest: 0.12, side: THREE.FrontSide,
  }));
  var back = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(1.0, 1.9)), backMat);
  back.position.set(0, 0.95, -0.04);
  back.rotation.y = Math.PI;
  back.castShadow = true;
  g.add(back);
  // Facing arrow on ground — always shows forward
  var arrow = buildFacingArrow();
  g.add(arrow);
  api._facingArrow = arrow;
  g.userData.isPlayer = true;
  return g;
}

function buildNpcFromTex(tex, x, z) {
  var card = buildPersonCard(tex, { w: 0.9 + Math.random() * 0.15, h: 1.7 + Math.random() * 0.25 });
  card.position.set(x, 0, z);
  return {
    group: card,
    x: x, z: z,
    vx: 0, vz: 0,
    idle: Math.random() * 2,
    yaw: Math.random() * Math.PI * 2,
  };
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
  var wallMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.65, metalness: 0.04 }));
  var ceilingMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xd8ccb8, roughness: 0.8 }));

  var floor = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(24, 28)), marbleMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  var ceiling = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(24, 28)), ceilingMat);
  ceiling.rotation.x = Math.PI / 2; ceiling.position.y = 7.2; scene.add(ceiling);

  var back = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(24, 7.2)), wallMat);
  back.position.set(0, 3.6, -14); back.receiveShadow = true; scene.add(back);
  var front = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(24, 7.2)), wallMat);
  front.position.set(0, 3.6, 14); front.rotation.y = Math.PI; scene.add(front);
  var left = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(28, 7.2)), wallMat);
  left.position.set(-12, 3.6, 0); left.rotation.y = Math.PI / 2; left.receiveShadow = true; scene.add(left);
  var right = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(28, 7.2)), wallMat);
  right.position.set(12, 3.6, 0); right.rotation.y = -Math.PI / 2; right.receiveShadow = true; scene.add(right);

  // Large curved mural cylinder segment (immersive painting plate)
  loadTex(MURAL_URL, function (tex) {
    placeMural(tex);
  }, function () {
    loadTex(MURAL_FALLBACK, function (tex) { placeMural(tex); });
  });
  function placeMural(tex) {
    var muralMat = trackMat(new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.85, metalness: 0,
      emissive: 0x1a1410, emissiveIntensity: 0.12,
    }));
    var mural = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(20, 6.2)), muralMat);
    mural.position.set(0, 3.9, -13.7);
    scene.add(mural);
    // Side wrap plates for immersion
    var leftM = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(10, 5.5)), muralMat.clone());
    leftM.position.set(-11.6, 3.7, -8);
    leftM.rotation.y = Math.PI / 2;
    scene.add(leftM);
    var rightM = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(10, 5.5)), muralMat.clone());
    rightM.position.set(11.6, 3.7, -8);
    rightM.rotation.y = -Math.PI / 2;
    scene.add(rightM);
  }

  for (var wi = -2; wi <= 2; wi++) scene.add(buildArchedWindow(wi * 3.6, 3.95, -13.65));
  for (var si = -1; si <= 1; si++) {
    var lw = buildArchedWindow(-11.65, 3.95, si * 5); lw.rotation.y = Math.PI / 2; scene.add(lw);
    var rw = buildArchedWindow(11.65, 3.95, si * 5); rw.rotation.y = -Math.PI / 2; scene.add(rw);
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
  var winLight = new THREE.DirectionalLight(0xfff6e8, 0.5);
  winLight.position.set(0, 4, -18); scene.add(winLight);
  var fill = new THREE.DirectionalLight(0xffd8b0, 0.25);
  fill.position.set(-8, 6, 8); scene.add(fill);

  // Player first so camera works even before NPC tex load
  api._player = buildPlayer();
  api._player.position.set(0, 0, 10);
  api._playerYaw = Math.PI; // face toward desk / windows (-Z)
  api._player.rotation.y = api._playerYaw;
  scene.add(api._player);

  api._npcs = [];
  var npcSpawns = [
    [-7.2, 2.2], [6.2, -3.5], [3.2, 4.2], [-3.5, 7.2],
    [8.2, 3.2], [-8.5, -2.5], [1.5, 6.5], [-5.5, 4.0],
    [4.0, 0.5], [-1.5, -4.0], [7.0, 8.0], [-9.0, 5.5],
  ];
  // Load high-res people from painting crops
  PEOPLE_URLS.forEach(function (url, idx) {
    loadTex(url, function (tex) {
      api._peopleTex.push(tex);
      // Place 1–2 NPCs per texture
      for (var k = 0; k < 2; k++) {
        var si = (idx * 2 + k) % npcSpawns.length;
        var sp = npcSpawns[si];
        var ox = sp[0] + (k ? 0.8 : 0);
        var oz = sp[1] + (k ? -0.6 : 0);
        if (collidesAt(ox, oz, 0.5)) continue;
        var npc = buildNpcFromTex(tex, ox, oz);
        npc.yaw = Math.random() * Math.PI * 2;
        npc.group.rotation.y = npc.yaw;
        scene.add(npc.group);
        api._npcs.push(npc);
      }
    });
  });
}

/**
 * RuneScape / Toontown-style third person:
 * - Camera locked BEHIND the player's back (along facing yaw)
 * - Mouse look rotates facing yaw + pitch
 * - Zoom via wheel on cam distance
 */
function updateCamera(dt) {
  if (!api._player || !api._camera) return;
  // Smooth zoom toward target
  var lerp = 1 - Math.exp(-(dt || 0.016) * 10);
  api._camDist += (api._camDistTarget - api._camDist) * lerp;

  var p = api._player.position;
  var yaw = api._playerYaw;
  var pitch = api._lookPitch;
  var dist = api._camDist;
  // Behind the back: offset opposite to facing forward
  // Facing forward in XZ is (-sin(yaw), -cos(yaw)) when rotation.y = yaw with Three default...
  // We set player.rotation.y = yaw, and move with (-sin, -cos) for forward.
  // Camera sits behind: opposite of forward = (+sin, +cos) * dist? 
  // If forward = (-sin(yaw), -cos(yaw)), behind = (sin(yaw), cos(yaw)).
  var behindX = Math.sin(yaw);
  var behindZ = Math.cos(yaw);
  var cp = Math.cos(pitch);
  var sp = Math.sin(pitch);
  var cx = p.x + behindX * dist * cp;
  var cy = p.y + 1.55 + dist * sp * 0.85 + 0.35;
  var cz = p.z + behindZ * dist * cp;
  // Keep camera inside hall soft clamp
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

function step(dt) {
  if (!api._running || !api._player) return;
  var mx = 0, mz = 0;
  var k = api._keys;
  // W/S forward/back along facing; A/D strafe — classic third-person
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
    // Forward vector (where chest/face points): (-sin yaw, -cos yaw)
    var fx = -Math.sin(yaw);
    var fz = -Math.cos(yaw);
    // Right vector: cross with up → (cos yaw, -sin? ) : right = (cos(yaw), -sin? wait)
    // right = (fz, -fx)? Standard: right = (cos(yaw), -sin(yaw)) when forward=(-sin,-cos)
    var rx = Math.cos(yaw);
    var rz = -Math.sin(yaw);
    // mz negative is forward (W), so move += forward * (-mz) ... with mz=-1 for W:
    // desire: W → along fx,fz. Our mz=-1 when W, so contrib = fx * (-mz) when using mz as "back amount"
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

  // Body always matches look/facing yaw (critical for readable direction)
  api._player.rotation.y = yaw;
  // Bob facing arrow slightly when moving
  if (api._facingArrow) {
    api._facingArrow.visible = true;
    api._facingArrow.position.y = (mx || mz) ? 0.02 : 0;
  }

  api._walkPhase += dt;
  for (var i = 0; i < api._npcs.length; i++) {
    var n = api._npcs[i];
    n.idle -= dt;
    if (n.idle <= 0) {
      if (Math.random() < 0.45) {
        n.vx = 0; n.vz = 0; n.idle = 1.2 + Math.random() * 2.5;
      } else {
        var ang = Math.random() * Math.PI * 2;
        var spd = 0.7 + Math.random() * 1.2;
        n.vx = Math.cos(ang) * spd;
        n.vz = Math.sin(ang) * spd;
        n.yaw = Math.atan2(-n.vx, -n.vz);
        n.idle = 1.5 + Math.random() * 3;
      }
    }
    var nxx = n.x + n.vx * dt;
    var nzz = n.z + n.vz * dt;
    if (collidesAt(nxx, nzz, 0.45) || Math.abs(nxx) > 10.5 || Math.abs(nzz) > 12.5) {
      n.vx *= -1; n.vz *= -1;
      n.yaw = Math.atan2(-n.vx, -n.vz);
    } else {
      n.x = nxx; n.z = nzz;
    }
    n.group.position.set(n.x, 0, n.z);
    // NPC cards face their walk yaw (readable facing)
    n.group.rotation.y = n.yaw;
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
    // Mouse X rotates facing (and thus camera behind)
    api._playerYaw -= e.movementX * sens;
    // Mouse Y pitch (not inverted): look up = negative movementY typically → decrease pitch? 
    // Standard FPS: movementY>0 (mouse down) → look down → increase pitch toward floor.
    api._lookPitch += e.movementY * sens;
    api._lookPitch = Math.max(-0.15, Math.min(0.55, api._lookPitch));
  };
  api._onWheel = function (e) {
    if (!api._running) return;
    var panel = document.getElementById("panel-exchange");
    if (panel && panel.hidden) return;
    // Only zoom when pointer over stage / locked
    var stage = api._container;
    if (!api._pointerLocked && stage) {
      var t = e.target;
      if (!(t === api._canvas || (stage.contains && stage.contains(t)))) return;
    }
    e.preventDefault();
    var delta = e.deltaY;
    // Trackpad pinch often surfaces as ctrl+wheel
    if (e.ctrlKey) delta *= 3;
    var stepZ = delta > 0 ? 0.55 : -0.55;
    // Larger notches for big deltas
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
  // Wheel on canvas + container (non-passive so preventDefault works)
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
  var list = [MURAL_URL, MURAL_FALLBACK].concat(PEOPLE_URLS.slice(0, 4)).concat((urls || []).slice(0, 6));
  var left = list.length;
  var finished = false;
  function one() {
    left--;
    if (left <= 0 && !finished) { finished = true; done && done(); }
  }
  list.forEach(function (u) {
    var img = new Image();
    img.onload = one; img.onerror = one; img.src = u;
  });
  setTimeout(function () {
    if (!finished) { finished = true; done && done(); }
  }, 2800);
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
  api._peopleTex = [];
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
  api._textures = []; api._mats = []; api._geos = []; api._peopleTex = [];
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
