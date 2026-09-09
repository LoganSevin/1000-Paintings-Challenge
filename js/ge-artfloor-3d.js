/**
 * Grand Exchange Art Floor — third-person Three.js walkaround.
 * Marble hall matching assets/grand-exchange-art-floor.jpg.
 * Attaches window.GeArtFloor3D for the classic exchange.js IIFE.
 */
import * as THREE from "three";

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
  _lookPitch: 0.28,
  _keys: Object.create(null),
  _pointerLocked: false,
  _colliders: [],
  _booth: null,
  _npcs: [],
  _textures: [],
  _mats: [],
  _geos: [],
  _clock: null,
  _walkAcc: 0,
  _nearBooth: false,
  _hintEl: null,
  _container: null,
  _canvas: null,
  _onResize: null,
  _onKeyDown: null,
  _onKeyUp: null,
  _onMouseMove: null,
  _onPointerLockChange: null,
  _onClick: null,
  _onVis: null,
  _easelMeshes: [],
  _disposed: false,
};


function capsuleGeo(radius, length, capSegs, radSegs) {
  if (typeof THREE.CapsuleGeometry === "function") {
    return trackGeo(new THREE.CapsuleGeometry(radius, length, capSegs || 4, radSegs || 8));
  }
  // Fallback: cylinder + spheres
  var g = new THREE.CylinderGeometry(radius, radius, length, radSegs || 8);
  return trackGeo(g);
}

function trackGeo(g) {
  api._geos.push(g);
  return g;
}
function trackMat(m) {
  api._mats.push(m);
  return m;
}
function trackTex(t) {
  if (t) api._textures.push(t);
  return t;
}

function makeMarbleTexture() {
  var c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  var ctx = c.getContext("2d");
  ctx.fillStyle = "#e4ddd2";
  ctx.fillRect(0, 0, 256, 256);
  // Tile grid
  ctx.strokeStyle = "rgba(120,110,95,0.35)";
  ctx.lineWidth = 2;
  for (var i = 0; i <= 256; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }
  // Soft veining
  ctx.strokeStyle = "rgba(160,150,140,0.25)";
  ctx.lineWidth = 1.2;
  for (var v = 0; v < 18; v++) {
    ctx.beginPath();
    var x = Math.random() * 256;
    var y = Math.random() * 256;
    ctx.moveTo(x, y);
    for (var s = 0; s < 4; s++) {
      x += (Math.random() - 0.5) * 80;
      y += (Math.random() - 0.5) * 80;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Tile shading variation
  for (var ty = 0; ty < 4; ty++) {
    for (var tx = 0; tx < 4; tx++) {
      var shade = 0.92 + Math.random() * 0.1;
      ctx.fillStyle = "rgba(255,255,255," + ((shade - 1) * 0.4 + 0.04).toFixed(3) + ")";
      if (shade < 1) ctx.fillStyle = "rgba(80,70,60," + ((1 - shade) * 0.12).toFixed(3) + ")";
      ctx.fillRect(tx * 64 + 2, ty * 64 + 2, 60, 60);
    }
  }
  var tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 14);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return trackTex(tex);
}

function makeBannerTexture(text) {
  var c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  var ctx = c.getContext("2d");
  ctx.fillStyle = "#f4efe6";
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = "#2a2218";
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 1008, 240);
  ctx.strokeStyle = "#c9a227";
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, 988, 220);
  ctx.fillStyle = "#1a1610";
  ctx.font = "bold 72px Georgia, 'Times New Roman', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text || "GRAND EXCHANGE - ART FLOOR", 512, 128);
  // Ribbons
  var cols = ["#2a5aad", "#d4a017", "#b03030"];
  for (var i = 0; i < 3; i++) {
    ctx.fillStyle = cols[i];
    ctx.beginPath();
    ctx.moveTo(80 + i * 40, 0);
    ctx.lineTo(100 + i * 40, 0);
    ctx.lineTo(110 + i * 40, 70);
    ctx.lineTo(90 + i * 40, 70);
    ctx.closePath();
    ctx.fill();
  }
  var tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return trackTex(tex);
}

function makeWoodMat(hex) {
  return trackMat(
    new THREE.MeshStandardMaterial({
      color: hex || 0x5a4030,
      roughness: 0.85,
      metalness: 0.05,
    })
  );
}

function makeMarbleMat(map) {
  return trackMat(
    new THREE.MeshStandardMaterial({
      map: map || null,
      color: map ? 0xffffff : 0xe4ddd2,
      roughness: 0.45,
      metalness: 0.08,
    })
  );
}

function addCollider(x, z, halfW, halfD) {
  api._colliders.push({ x: x, z: z, hw: halfW, hd: halfD });
}

function collidesAt(x, z, rad) {
  rad = rad || 0.45;
  // Hall bounds
  if (x < -11.2 || x > 11.2 || z < -13.5 || z > 13.5) return true;
  for (var i = 0; i < api._colliders.length; i++) {
    var c = api._colliders[i];
    if (Math.abs(x - c.x) < c.hw + rad && Math.abs(z - c.z) < c.hd + rad) return true;
  }
  return false;
}

function buildColumn(x, z, h, marbleMat) {
  var g = new THREE.Group();
  var shaft = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(1.1, h, 1.1)),
    marbleMat
  );
  shaft.position.y = h / 2;
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  g.add(shaft);
  var cap = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(1.45, 0.28, 1.45)),
    marbleMat
  );
  cap.position.y = h + 0.1;
  g.add(cap);
  var base = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(1.5, 0.35, 1.5)),
    marbleMat
  );
  base.position.y = 0.175;
  g.add(base);
  g.position.set(x, 0, z);
  addCollider(x, z, 0.75, 0.75);
  return g;
}

function buildTable(x, z, w, d, rotY) {
  var g = new THREE.Group();
  var wood = makeWoodMat(0x3a2818);
  var cloth = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1a4a32,
      roughness: 0.9,
      metalness: 0.0,
    })
  );
  var top = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, 0.08, d)), cloth);
  top.position.y = 0.85;
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);
  var skirt = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w * 0.98, 0.55, d * 0.98)), cloth);
  skirt.position.y = 0.55;
  g.add(skirt);
  var legGeo = trackGeo(new THREE.BoxGeometry(0.12, 0.85, 0.12));
  var offsets = [
    [-w / 2 + 0.15, -d / 2 + 0.15],
    [w / 2 - 0.15, -d / 2 + 0.15],
    [-w / 2 + 0.15, d / 2 - 0.15],
    [w / 2 - 0.15, d / 2 - 0.15],
  ];
  for (var i = 0; i < 4; i++) {
    var leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(offsets[i][0], 0.425, offsets[i][1]);
    g.add(leg);
  }
  g.position.set(x, 0, z);
  if (rotY) g.rotation.y = rotY;
  addCollider(x, z, w / 2 + 0.15, d / 2 + 0.15);
  return g;
}

function buildEasel(x, z, rotY, paintingUrl) {
  var g = new THREE.Group();
  var wood = makeWoodMat(0x5a4030);
  var legL = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.08, 1.8, 0.08)), wood);
  legL.position.set(-0.35, 0.9, 0);
  legL.rotation.z = 0.12;
  g.add(legL);
  var legR = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.08, 1.8, 0.08)), wood);
  legR.position.set(0.35, 0.9, 0);
  legR.rotation.z = -0.12;
  g.add(legR);
  var back = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.08, 1.6, 0.08)), wood);
  back.position.set(0, 0.85, -0.25);
  back.rotation.x = 0.2;
  g.add(back);
  var shelf = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.9, 0.06, 0.2)), wood);
  shelf.position.set(0, 0.55, 0.05);
  g.add(shelf);
  var frame = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.85, 1.05, 0.06)),
    trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xc9a227,
        roughness: 0.55,
        metalness: 0.35,
      })
    )
  );
  frame.position.set(0, 1.15, 0.08);
  g.add(frame);
  var canvasMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x2a2418,
      roughness: 0.7,
      metalness: 0.0,
    })
  );
  var canvas = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.75, 0.95)), canvasMat);
  canvas.position.set(0, 1.15, 0.12);
  g.add(canvas);
  g.userData.canvasMesh = canvas;
  g.userData.canvasMat = canvasMat;
  api._easelMeshes.push(g);
  if (paintingUrl) loadPaintingOnto(g, paintingUrl);
  g.position.set(x, 0, z);
  if (rotY) g.rotation.y = rotY;
  addCollider(x, z, 0.45, 0.35);
  return g;
}

function loadPaintingOnto(easelGroup, url) {
  if (!url || !easelGroup) return;
  var loader = new THREE.TextureLoader();
  loader.load(
    url,
    function (tex) {
      trackTex(tex);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      var mat = easelGroup.userData.canvasMat;
      if (mat) {
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      }
    },
    undefined,
    function () {
      /* keep placeholder */
    }
  );
}

function buildBanner(x, y, z, rotY) {
  var g = new THREE.Group();
  var tex = makeBannerTexture("GRAND EXCHANGE - ART FLOOR");
  var mat = trackMat(
    new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.8,
      metalness: 0.0,
      side: THREE.DoubleSide,
    })
  );
  var plane = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(4.2, 1.05)), mat);
  g.add(plane);
  var pole = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.03, 0.03, 4.4, 6)),
    makeWoodMat(0x3a2818)
  );
  pole.rotation.z = Math.PI / 2;
  pole.position.y = 0.55;
  g.add(pole);
  g.position.set(x, y, z);
  if (rotY) g.rotation.y = rotY;
  return g;
}

function buildChandelier(x, y, z) {
  var g = new THREE.Group();
  var gold = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc9a227,
      roughness: 0.35,
      metalness: 0.7,
      emissive: 0x664400,
      emissiveIntensity: 0.35,
    })
  );
  var stem = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6)), gold);
  stem.position.y = 0.4;
  g.add(stem);
  var bowl = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.35, 10, 8)), gold);
  bowl.scale.y = 0.45;
  g.add(bowl);
  for (var i = 0; i < 5; i++) {
    var ang = (i / 5) * Math.PI * 2;
    var arm = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.1, 6, 6)), gold);
    arm.position.set(Math.cos(ang) * 0.45, -0.15, Math.sin(ang) * 0.45);
    g.add(arm);
  }
  var light = new THREE.PointLight(0xffe2a0, 1.4, 18, 2);
  light.position.y = -0.2;
  light.castShadow = false;
  g.add(light);
  g.position.set(x, y, z);
  return g;
}

function buildBooth(x, z) {
  var g = new THREE.Group();
  var wood = makeWoodMat(0x3a2818);
  var gold = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc9a227,
      roughness: 0.4,
      metalness: 0.55,
      emissive: 0x553300,
      emissiveIntensity: 0.25,
    })
  );
  var desk = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.4, 1.1, 1.2)), wood);
  desk.position.y = 0.55;
  desk.castShadow = true;
  g.add(desk);
  var top = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.55, 0.08, 1.35)), gold);
  top.position.y = 1.14;
  g.add(top);
  // Sign
  var signC = document.createElement("canvas");
  signC.width = 256;
  signC.height = 128;
  var sctx = signC.getContext("2d");
  sctx.fillStyle = "#2a1a10";
  sctx.fillRect(0, 0, 256, 128);
  sctx.strokeStyle = "#c9a227";
  sctx.lineWidth = 8;
  sctx.strokeRect(6, 6, 244, 116);
  sctx.fillStyle = "#ffe066";
  sctx.font = "bold 48px Georgia, serif";
  sctx.textAlign = "center";
  sctx.textBaseline = "middle";
  sctx.fillText("GE", 128, 48);
  sctx.font = "bold 22px Georgia, serif";
  sctx.fillStyle = "#e8d090";
  sctx.fillText("ART FLOOR DESK", 128, 92);
  var signTex = trackTex(new THREE.CanvasTexture(signC));
  signTex.colorSpace = THREE.SRGBColorSpace;
  var sign = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(1.6, 0.8)),
    trackMat(
      new THREE.MeshStandardMaterial({
        map: signTex,
        roughness: 0.7,
        emissive: 0x221100,
        emissiveIntensity: 0.4,
      })
    )
  );
  sign.position.set(0, 1.9, 0.05);
  g.add(sign);
  var glow = new THREE.PointLight(0xffcc66, 0.7, 8, 2);
  glow.position.set(0, 2.2, 0.5);
  g.add(glow);
  g.position.set(x, 0, z);
  addCollider(x, z, 1.35, 0.75);
  api._booth = { x: x, z: z, r: 3.2 };
  return g;
}

function buildNpc(x, z, color, beret) {
  var g = new THREE.Group();
  var bodyMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: color || 0x4a5568,
      roughness: 0.75,
      metalness: 0.1,
    })
  );
  var body = new THREE.Mesh(capsuleGeo(0.28, 0.7, 4, 8), bodyMat);
  body.position.y = 0.85;
  body.castShadow = true;
  g.add(body);
  var head = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.22, 10, 8)),
    trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xc4a882,
        roughness: 0.8,
      })
    )
  );
  head.position.y = 1.55;
  g.add(head);
  if (beret) {
    var hat = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.24, 10, 8)),
      trackMat(
        new THREE.MeshStandardMaterial({
          color: 0xe8c030,
          roughness: 0.7,
        })
      )
    );
    hat.scale.y = 0.45;
    hat.position.y = 1.72;
    g.add(hat);
  }
  g.position.set(x, 0, z);
  return {
    group: g,
    x: x,
    z: z,
    vx: 0,
    vz: 0,
    idle: Math.random() * 2,
    yaw: Math.random() * Math.PI * 2,
  };
}

function buildPlayer() {
  var g = new THREE.Group();
  var body = new THREE.Mesh(
    capsuleGeo(0.3, 0.75, 4, 8),
    trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x2d6a4f,
        roughness: 0.65,
        metalness: 0.15,
        emissive: 0x0a2818,
        emissiveIntensity: 0.2,
      })
    )
  );
  body.position.y = 0.9;
  body.castShadow = true;
  g.add(body);
  var head = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.24, 10, 8)),
    trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xd4b896,
        roughness: 0.8,
      })
    )
  );
  head.position.y = 1.62;
  g.add(head);
  // Tiny cape / marker so third-person reads as "you"
  var marker = new THREE.Mesh(
    trackGeo(new THREE.ConeGeometry(0.12, 0.25, 6)),
    trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffe066,
        emissive: 0xaa8800,
        emissiveIntensity: 0.5,
      })
    )
  );
  marker.position.y = 2.0;
  g.add(marker);
  return g;
}

function buildHall() {
  var scene = api._scene;
  var marbleMap = makeMarbleTexture();
  var marbleMat = makeMarbleMat(marbleMap);
  var wallMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd8d0c4,
      roughness: 0.7,
      metalness: 0.05,
    })
  );
  var ceilingMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xcfc6b8,
      roughness: 0.85,
      metalness: 0.0,
    })
  );

  // Floor
  var floor = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(24, 28)), marbleMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Ceiling
  var ceiling = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(24, 28)), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 7.2;
  scene.add(ceiling);

  // Walls
  var back = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(24, 7.2)), wallMat);
  back.position.set(0, 3.6, -14);
  scene.add(back);
  var front = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(24, 7.2)), wallMat);
  front.position.set(0, 3.6, 14);
  front.rotation.y = Math.PI;
  scene.add(front);
  var left = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(28, 7.2)), wallMat);
  left.position.set(-12, 3.6, 0);
  left.rotation.y = Math.PI / 2;
  scene.add(left);
  var right = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(28, 7.2)), wallMat);
  right.position.set(12, 3.6, 0);
  right.rotation.y = -Math.PI / 2;
  scene.add(right);

  // Arched window panels (emissive glow on back wall)
  var winMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xb8d0e8,
      emissive: 0xfff0c8,
      emissiveIntensity: 0.85,
      roughness: 0.4,
      metalness: 0.1,
    })
  );
  for (var wi = -3; wi <= 3; wi++) {
    var win = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(1.6, 3.2)), winMat);
    win.position.set(wi * 2.8, 4.0, -13.92);
    scene.add(win);
    // Arch top
    var arch = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(0.8, 12, 0, Math.PI)), winMat);
    arch.position.set(wi * 2.8, 5.6, -13.91);
    scene.add(arch);
  }

  // Columns — two rows
  var colXs = [-8, -3, 3, 8];
  var colZs = [-6, 2, 8];
  for (var ci = 0; ci < colXs.length; ci++) {
    for (var cj = 0; cj < colZs.length; cj++) {
      // Leave a clear aisle near booth (0, -9)
      if (colZs[cj] === -6 && Math.abs(colXs[ci]) < 4) continue;
      scene.add(buildColumn(colXs[ci], colZs[cj], 6.5, marbleMat));
    }
  }

  // Tables + easels
  scene.add(buildTable(-6.5, 0.5, 3.2, 1.4, 0));
  scene.add(buildEasel(-7.2, -0.4, 0.2));
  scene.add(buildEasel(-5.5, -0.5, -0.15));

  scene.add(buildTable(5.5, -1.5, 3.6, 1.4, 0.1));
  scene.add(buildEasel(4.6, -2.4, 0.3));
  scene.add(buildEasel(6.4, -2.3, -0.2));

  scene.add(buildTable(-1.5, 5.5, 2.6, 1.3, -0.05));
  scene.add(buildEasel(-1.5, 4.6, 0));

  scene.add(buildTable(7, 6, 2.4, 1.2, 0.4));
  scene.add(buildEasel(7.5, 5.1, 0.5));

  // Free-standing easels / lean canvases
  scene.add(buildEasel(-9.5, 4, 0.6));
  scene.add(buildEasel(9.2, 1.5, -0.8));
  scene.add(buildEasel(-4, 9, Math.PI));
  scene.add(buildEasel(2.5, 9.5, Math.PI * 0.9));

  // Bust pedestals
  var pedMat = makeWoodMat(0x2a1a10);
  function bust(bx, bz) {
    var p = new THREE.Group();
    var ped = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.35, 0.4, 0.9, 8)), pedMat);
    ped.position.y = 0.45;
    p.add(ped);
    var head = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.28, 10, 8)),
      trackMat(
        new THREE.MeshStandardMaterial({
          color: 0x8a7a68,
          roughness: 0.55,
          metalness: 0.3,
        })
      )
    );
    head.position.y = 1.2;
    p.add(head);
    p.position.set(bx, 0, bz);
    addCollider(bx, bz, 0.45, 0.45);
    scene.add(p);
  }
  bust(-5, -4);
  bust(6.5, 3.5);

  // Banners
  scene.add(buildBanner(-5.5, 5.2, -10, 0));
  scene.add(buildBanner(5.5, 5.2, -10, 0));
  scene.add(buildBanner(0, 5.4, 10.5, Math.PI));

  // Chandeliers
  scene.add(buildChandelier(-5, 6.4, -2));
  scene.add(buildChandelier(0, 6.5, 3));
  scene.add(buildChandelier(5, 6.4, -2));
  scene.add(buildChandelier(-2, 6.3, 8));
  scene.add(buildChandelier(4, 6.3, 7));

  // GE desk near back-center (like painting focal desk)
  scene.add(buildBooth(0, -9.5));

  // Ambient + window window light
  scene.add(new THREE.AmbientLight(0xfff5e6, 0.45));
  var hemi = new THREE.HemisphereLight(0xfff0d0, 0x4a4030, 0.55);
  scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xffe8c8, 0.65);
  sun.position.set(4, 12, -6);
  sun.castShadow = false;
  scene.add(sun);
  var winLight = new THREE.DirectionalLight(0xfff8e0, 0.5);
  winLight.position.set(0, 5, -20);
  scene.add(winLight);

  // NPCs
  var npcSpecs = [
    { x: -7, z: 2, c: 0x3a4555, b: false },
    { x: 6, z: -4, c: 0x5a3a5a, b: true },
    { x: 3, z: 4, c: 0x4a3a28, b: false },
    { x: -3, z: 7, c: 0x2a4060, b: true },
    { x: 8, z: 3, c: 0x553322, b: false },
    { x: -8, z: -3, c: 0x3a4a3a, b: true },
  ];
  api._npcs = [];
  for (var ni = 0; ni < npcSpecs.length; ni++) {
    var ns = npcSpecs[ni];
    var npc = buildNpc(ns.x, ns.z, ns.c, ns.b);
    scene.add(npc.group);
    api._npcs.push(npc);
  }

  // Player
  api._player = buildPlayer();
  api._player.position.set(0, 0, 10);
  api._playerYaw = Math.PI; // face toward desk / windows
  api._player.rotation.y = api._playerYaw;
  scene.add(api._player);
}

function updateCamera() {
  var p = api._player.position;
  var dist = 4.2;
  var height = 2.35;
  var yaw = api._playerYaw;
  var pitch = api._lookPitch;
  var cx = p.x - Math.sin(yaw) * dist * Math.cos(pitch);
  var cy = p.y + height + Math.sin(pitch) * 2.2;
  var cz = p.z - Math.cos(yaw) * dist * Math.cos(pitch);
  api._camera.position.set(cx, cy, cz);
  api._camera.lookAt(p.x, p.y + 1.35, p.z);
}

function updateHint() {
  if (!api._hintEl) return;
  if (api._nearBooth && api._running) {
    api._hintEl.hidden = false;
  } else {
    api._hintEl.hidden = true;
  }
}

function step(dt) {
  if (!api._running || !api._player) return;
  var mx = 0;
  var mz = 0;
  var k = api._keys;
  if (k.KeyW || k.ArrowUp) mz -= 1;
  if (k.KeyS || k.ArrowDown) mz += 1;
  if (k.KeyA || k.ArrowLeft) mx -= 1;
  if (k.KeyD || k.ArrowRight) mx += 1;
  var moved = 0;
  if (mx || mz) {
    var len = Math.sqrt(mx * mx + mz * mz) || 1;
    mx /= len;
    mz /= len;
    var speed = 4.8;
    var yaw = api._playerYaw;
    var dx = (mx * Math.cos(yaw) + mz * Math.sin(yaw)) * speed * dt;
    var dz = (-mx * Math.sin(yaw) + mz * Math.cos(yaw)) * speed * dt;
    var nx = api._player.position.x + dx;
    var nz = api._player.position.z + dz;
    if (!collidesAt(nx, api._player.position.z)) {
      api._player.position.x = nx;
      moved += Math.abs(dx);
    }
    if (!collidesAt(api._player.position.x, nz)) {
      api._player.position.z = nz;
      moved += Math.abs(dz);
    }
    // Face move direction gently
    api._player.rotation.y = yaw;
    api._walkAcc += moved;
    while (api._walkAcc >= 2.5) {
      api._walkAcc -= 2.5;
      if (api._opts && typeof api._opts.onWalkXp === "function") {
        try {
          api._opts.onWalkXp(1);
        } catch (e) {}
      }
    }
  }

  // NPCs wander
  for (var i = 0; i < api._npcs.length; i++) {
    var n = api._npcs[i];
    n.idle -= dt;
    if (n.idle <= 0) {
      if (Math.random() < 0.4) {
        n.vx = 0;
        n.vz = 0;
        n.idle = 1 + Math.random() * 2.5;
      } else {
        var ang = Math.random() * Math.PI * 2;
        var spd = 0.8 + Math.random() * 1.4;
        n.vx = Math.cos(ang) * spd;
        n.vz = Math.sin(ang) * spd;
        n.yaw = ang;
        n.idle = 1.5 + Math.random() * 3;
      }
    }
    var nxx = n.x + n.vx * dt;
    var nzz = n.z + n.vz * dt;
    if (collidesAt(nxx, nzz, 0.4) || Math.abs(nxx) > 10.5 || Math.abs(nzz) > 12.5) {
      n.vx *= -1;
      n.vz *= -1;
      n.yaw += Math.PI;
    } else {
      n.x = nxx;
      n.z = nzz;
    }
    n.group.position.set(n.x, 0, n.z);
    n.group.rotation.y = -n.yaw + Math.PI / 2;
  }

  // Booth proximity
  var bx = api._booth ? api._booth.x : 0;
  var bz = api._booth ? api._booth.z : -9.5;
  var dxb = api._player.position.x - bx;
  var dzb = api._player.position.z - bz;
  api._nearBooth = Math.sqrt(dxb * dxb + dzb * dzb) < (api._booth ? api._booth.r : 3.2);
  updateHint();
  updateCamera();
}

function loop(ts) {
  if (!api._running) {
    api._raf = 0;
    return;
  }
  if (!api._lastTs) api._lastTs = ts;
  var dt = Math.min(0.05, (ts - api._lastTs) / 1000);
  api._lastTs = ts;
  step(dt);
  if (api._renderer && api._scene && api._camera) {
    api._renderer.render(api._scene, api._camera);
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
      code === "KeyW" ||
      code === "KeyA" ||
      code === "KeyS" ||
      code === "KeyD" ||
      code === "ArrowUp" ||
      code === "ArrowDown" ||
      code === "ArrowLeft" ||
      code === "ArrowRight"
    ) {
      api._keys[code] = true;
      e.preventDefault();
    } else if (code === "KeyE") {
      if (api._nearBooth) {
        e.preventDefault();
        openExchangeFromWorld();
      }
    } else if (code === "Escape") {
      if (document.pointerLockElement) document.exitPointerLock();
    }
  };
  api._onKeyUp = function (e) {
    if (e.code in api._keys) delete api._keys[e.code];
  };
  api._onMouseMove = function (e) {
    if (!api._running || !api._pointerLocked) return;
    var sens = 0.0022;
    api._playerYaw -= e.movementX * sens;
    api._lookPitch -= e.movementY * sens;
    api._lookPitch = Math.max(-0.35, Math.min(0.55, api._lookPitch));
  };
  api._onPointerLockChange = function () {
    api._pointerLocked = document.pointerLockElement === api._canvas;
  };
  api._onClick = function (e) {
    if (!api._running) return;
    if (!api._canvas) return;
    // Click near booth ray? Simple: if near booth, open; else request pointer lock
    if (api._nearBooth && e.target === api._canvas) {
      openExchangeFromWorld();
      return;
    }
    if (api._canvas.requestPointerLock) {
      try {
        api._canvas.requestPointerLock();
      } catch (err) {}
    }
    try {
      api._container && api._container.focus && api._container.focus();
    } catch (err2) {}
  };
  window.addEventListener("keydown", api._onKeyDown, true);
  window.addEventListener("keyup", api._onKeyUp, true);
  document.addEventListener("mousemove", api._onMouseMove, false);
  document.addEventListener("pointerlockchange", api._onPointerLockChange, false);
  if (api._canvas) api._canvas.addEventListener("click", api._onClick, false);
}

function unbindInput() {
  if (api._onKeyDown) window.removeEventListener("keydown", api._onKeyDown, true);
  if (api._onKeyUp) window.removeEventListener("keyup", api._onKeyUp, true);
  if (api._onMouseMove) document.removeEventListener("mousemove", api._onMouseMove, false);
  if (api._onPointerLockChange)
    document.removeEventListener("pointerlockchange", api._onPointerLockChange, false);
  if (api._canvas && api._onClick) api._canvas.removeEventListener("click", api._onClick, false);
  api._keys = Object.create(null);
  if (document.pointerLockElement) {
    try {
      document.exitPointerLock();
    } catch (e) {}
  }
  api._pointerLocked = false;
}

function openExchangeFromWorld() {
  if (api._opts && typeof api._opts.onOpenExchange === "function") {
    try {
      api._opts.onOpenExchange();
    } catch (e) {}
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
  var ids = [1, 7, 12, 24, 36, 48, 64, 81, 100, 128, 256, 512];
  return ids.map(function (n) {
    return "paintings/" + n + ".jpg";
  });
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
  api._colliders = [];
  api._easelMeshes = [];
  api._npcs = [];
  api._textures = [];
  api._mats = [];
  api._geos = [];

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
    canvas: canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(w, h, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x2a2418, 1);
  api._renderer = renderer;

  api._scene = new THREE.Scene();
  api._scene.fog = new THREE.Fog(0xd8d0c4, 22, 42);
  api._camera = new THREE.PerspectiveCamera(60, w / Math.max(1, h), 0.1, 80);

  buildHall();
  setPaintingUrls((api._opts && api._opts.getPaintingUrls && api._opts.getPaintingUrls()) || defaultPaintingUrls());

  updateCamera();
  api._onResize = function () {
    resize();
  };
  window.addEventListener("resize", api._onResize);
  api._onVis = function () {
    if (document.visibilityState === "hidden") {
      if (api._raf) {
        cancelAnimationFrame(api._raf);
        api._raf = 0;
      }
      api._wasRunningBeforeHide = api._running;
      // Keep _running flag but stop RAF to save GPU; input stays if still "active" session
      if (api._running) {
        api._lastTs = 0;
      }
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
    var u = urls[i % urls.length];
    loadPaintingOnto(api._easelMeshes[i], u);
  }
}

function start() {
  if (!api._mounted) return;
  if (api._running) return;
  api._running = true;
  api._lastTs = 0;
  bindInput();
  resize();
  if (!api._raf) api._raf = requestAnimationFrame(loop);
  try {
    api._container && api._container.focus && api._container.focus();
  } catch (e) {}
}

function pause() {
  api._running = false;
  if (api._raf) {
    cancelAnimationFrame(api._raf);
    api._raf = 0;
  }
  unbindInput();
  updateHint();
}

function resume() {
  if (!api._mounted) return;
  start();
}

function dispose() {
  pause();
  api._disposed = true;
  if (api._onResize) window.removeEventListener("resize", api._onResize);
  if (api._onVis) document.removeEventListener("visibilitychange", api._onVis);
  if (api._scene) {
    api._scene.traverse(function (obj) {
      if (obj.geometry) obj.geometry.dispose && obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(function (m) {
            m.dispose && m.dispose();
          });
        } else if (obj.material.dispose) obj.material.dispose();
      }
    });
  }
  for (var i = 0; i < api._textures.length; i++) {
    try {
      api._textures[i].dispose();
    } catch (e) {}
  }
  if (api._renderer) {
    try {
      api._renderer.dispose();
    } catch (e2) {}
  }
  api._scene = null;
  api._camera = null;
  api._renderer = null;
  api._player = null;
  api._mounted = false;
  api._ready = false;
  api._colliders = [];
  api._easelMeshes = [];
  api._npcs = [];
  api._textures = [];
  api._mats = [];
  api._geos = [];
}

function isNearBooth() {
  return !!api._nearBooth;
}

window.GeArtFloor3D = {
  mount: mount,
  start: start,
  pause: pause,
  resume: resume,
  dispose: dispose,
  setPaintingUrls: setPaintingUrls,
  isNearBooth: isNearBooth,
  isRunning: function () {
    return !!api._running;
  },
  isMounted: function () {
    return !!api._mounted;
  },
};

export default window.GeArtFloor3D;
