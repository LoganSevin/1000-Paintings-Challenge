// Sims tab — build a lot, buy furniture, create sims, live mode.
// Fully client-side: Three.js (vendored r160), no network APIs, no credits.
// Meshes are plain glTF-friendly groups with named parts so they round-trip through Blender.
const N = 24; // lot size in tiles
const SAVE_KEY = "logan7in.sims.save.v1";
const WALL_H = 2.6, WALL_T = 0.12;
const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const CATALOG = {
  bed:    { label: "Bed", price: 400, w: 1, d: 2, use: { energy: 3.2 }, dur: 30, pose: "lie" },
  sofa:   { label: "Sofa", price: 300, w: 2, d: 1, use: { energy: 0.8, fun: 1.2 }, dur: 20, pose: "sit" },
  chair:  { label: "Chair", price: 80, w: 1, d: 1, use: { energy: 0.6 }, dur: 10, pose: "sit" },
  table:  { label: "Table", price: 150, w: 1, d: 1, use: { hunger: 1.2, fun: 0.4 }, dur: 12, pose: "stand" },
  fridge: { label: "Fridge", price: 500, w: 1, d: 1, use: { hunger: 3.5 }, dur: 12, pose: "stand" },
  stove:  { label: "Stove", price: 450, w: 1, d: 1, use: { hunger: 4.5, fun: 0.3 }, dur: 15, pose: "stand" },
  toilet: { label: "Toilet", price: 250, w: 1, d: 1, use: { hygiene: 2.0 }, dur: 8, pose: "sit" },
  shower: { label: "Shower", price: 600, w: 1, d: 1, use: { hygiene: 5.0 }, dur: 15, pose: "inside" },
  tv:     { label: "TV", price: 350, w: 1, d: 1, use: { fun: 3.0 }, dur: 20, pose: "stand" },
  lamp:   { label: "Lamp", price: 60, w: 1, d: 1, use: { fun: 0.5 }, dur: 3, pose: "stand", toggle: true },
  plant:  { label: "Plant", price: 40, w: 1, d: 1, use: { fun: 1.0 }, dur: 6, pose: "stand" },
  easel:  { label: "Easel", price: 200, w: 1, d: 1, use: { fun: 4.0, energy: -0.3 }, dur: 25, pose: "stand" },
};
const NEEDS = ["hunger", "energy", "fun", "hygiene"];
const DECAY = { hunger: 7, energy: 4.5, fun: 6, hygiene: 3.5 }; // points per game hour
const SKINS = ["#f6d3b3", "#e8b48f", "#c98c62", "#a0673f", "#7a4a2a", "#4e2f1c"];
const HAIRS = ["#1b1410", "#4a2e1a", "#8a5a2b", "#d8b468", "#b33a2a", "#cfcfcf", "#3a5fcd"];
const FLOOR_COLORS = ["#8a6a4a", "#b89970", "#5d4a3a", "#cfc6b8", "#3e4a52", "#6f2f2a", "#2f4a3a"];
const WALL_COLORS = ["#e8e0d2", "#c9a227", "#7d8a96", "#a8574a", "#3c4a3e", "#2b2724", "#d7c3a1"];

let THREE, OrbitControls, GLTFExporter, GLTFLoader;
let started = false, visible = false, ready = false;
let renderer, scene, camera, controls, raycaster, clockObj;
let lotGroup, wallGroup, floorGroup, objGroup, simGroup, ghostGroup, helperGroup;
let rafId = 0;
const $ = (id) => document.getElementById(id);

// ---------------- state ----------------
let S = null; // save state
let undoStack = [];
let mode = "build", tool = "wall";
let floorColor = FLOOR_COLORS[1], wallColor = WALL_COLORS[0];
let buyItem = null, carry = null, buyRot = 0;
let selectedSimId = null;
let speed = 1, wallsMode = "up";
const runtime = new Map(); // simId -> {model, path, task, ...}
const objMeshes = new Map();

function defaultSim(name, i) {
  return {
    id: "s" + Date.now().toString(36) + i, name,
    skin: SKINS[i % SKINS.length], hair: HAIRS[i % HAIRS.length], hairStyle: i % 2 ? "long" : "short",
    top: ["#c9a227", "#3a6ea5", "#8b3a3a", "#2f6b4f"][i % 4], bottom: ["#2b2724", "#3b3f6b", "#5a4632"][i % 3],
    height: 1, build: 1, x: 10 + i, z: 12, rot: 0,
    needs: { hunger: 80, energy: 80, fun: 70, hygiene: 85 }, glb: null,
  };
}
function freshSave() {
  const s = { v: 1, N, walls: {}, floors: {}, objects: [], sims: [], minutes: 8 * 60, nextId: 1 };
  // starter house: 8x6 room
  const x0 = 8, z0 = 8, x1 = 16, z1 = 14;
  for (let x = x0; x < x1; x++) { s.walls["h:" + x + ":" + z0] = { t: "wall", c: WALL_COLORS[0] }; s.walls["h:" + x + ":" + z1] = { t: "wall", c: WALL_COLORS[0] }; }
  for (let z = z0; z < z1; z++) { s.walls["v:" + x0 + ":" + z] = { t: "wall", c: WALL_COLORS[0] }; s.walls["v:" + x1 + ":" + z] = { t: "wall", c: WALL_COLORS[0] }; }
  s.walls["h:12:" + z1].t = "door";
  s.walls["h:10:" + z0].t = "window"; s.walls["h:14:" + z0].t = "window";
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) s.floors[x + "," + z] = FLOOR_COLORS[1];
  const add = (type, x, z, rot) => s.objects.push({ id: "o" + s.nextId++, type, x, z, rot: rot || 0 });
  add("bed", 8, 8, 0); add("fridge", 15, 8, 0); add("stove", 14, 8, 0); add("sofa", 10, 12, 2);
  add("tv", 10, 9, 0); add("easel", 13, 12, 0); add("plant", 8, 13, 0); add("shower", 15, 13, 3); add("toilet", 15, 12, 3);
  add("lamp", 9, 8, 0); add("table", 12, 9, 0); add("chair", 12, 10, 2);
  s.sims.push(defaultSim("Logan", 0));
  return s;
}
function loadSave() {
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { const s = JSON.parse(raw); if (s && s.v === 1) return s; } } catch (e) {}
  return freshSave();
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); setStatus("Saved"); }
    catch (e) { setStatus("Save failed (storage full?) — use Export save"); }
  }, 300);
}
function snapshot() {
  undoStack.push(JSON.stringify({ walls: S.walls, floors: S.floors, objects: S.objects }));
  if (undoStack.length > 80) undoStack.shift();
}
function undo() {
  const prev = undoStack.pop();
  if (!prev) { setStatus("Nothing to undo"); return; }
  Object.assign(S, JSON.parse(prev));
  rebuildLot(); save(); setStatus("Undone");
}
function setStatus(t) { const el = $("sims-status"); if (el) el.textContent = t; }

// ---------------- grid helpers ----------------
const tileCenter = (x, z) => new THREE.Vector3(x + 0.5 - N / 2, 0, z + 0.5 - N / 2);
const inLot = (x, z) => x >= 0 && z >= 0 && x < N && z < N;
function footprint(o) {
  const c = CATALOG[o.type] || { w: 1, d: 1 };
  const W = o.rot % 2 ? c.d : c.w, D = o.rot % 2 ? c.w : c.d;
  return { W, D };
}
function occupancy(exceptId) {
  const occ = new Map();
  for (const o of S.objects) {
    if (o.id === exceptId) continue;
    const { W, D } = footprint(o);
    for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) occ.set((o.x + i) + "," + (o.z + j), o.id);
  }
  return occ;
}
function canPlace(o, exceptId) {
  const occ = occupancy(exceptId);
  const { W, D } = footprint(o);
  for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) {
    const x = o.x + i, z = o.z + j;
    if (!inLot(x, z) || occ.has(x + "," + z)) return false;
    // no wall cutting through a multi-tile object
    if (i > 0 && blocks("v:" + x + ":" + z)) return false;
    if (j > 0 && blocks("h:" + x + ":" + z)) return false;
  }
  return true;
}
function blocks(edgeKey) { const w = S.walls[edgeKey]; return !!w && w.t !== "door"; }
function edgeBetween(ax, az, bx, bz) {
  if (bx === ax + 1) return "v:" + bx + ":" + az;
  if (bx === ax - 1) return "v:" + ax + ":" + az;
  if (bz === az + 1) return "h:" + ax + ":" + bz;
  return "h:" + ax + ":" + az;
}
function bfs(sx, sz, occ) {
  const dist = new Map(), prev = new Map();
  const k0 = sx + "," + sz; dist.set(k0, 0);
  const q = [[sx, sz]];
  while (q.length) {
    const [x, z] = q.shift(); const k = x + "," + z;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, nk = nx + "," + nz;
      if (!inLot(nx, nz) || dist.has(nk) || occ.has(nk)) continue;
      if (blocks(edgeBetween(x, z, nx, nz))) continue;
      dist.set(nk, dist.get(k) + 1); prev.set(nk, k); q.push([nx, nz]);
    }
  }
  return { dist, prev };
}
function pathTo(prev, k0, k) {
  const out = []; let cur = k;
  while (cur && cur !== k0) { out.unshift(cur.split(",").map(Number)); cur = prev.get(cur); }
  return cur === k0 ? out : null;
}
const FRONT = [[0, 1], [1, 0], [0, -1], [-1, 0]];
function approachTiles(o) {
  const { W, D } = footprint(o); const out = [];
  const [fx, fz] = FRONT[o.rot];
  for (let i = -1; i <= W; i++) for (let j = -1; j <= D; j++) {
    const inside = i >= 0 && j >= 0 && i < W && j < D; if (inside) continue;
    if ((i < 0 || i >= W) && (j < 0 || j >= D)) continue; // skip diagonals
    const x = o.x + i, z = o.z + j;
    // must not be separated by a wall from the object tile it touches
    const ix = Math.min(Math.max(i, 0), W - 1) + o.x, iz = Math.min(Math.max(j, 0), D - 1) + o.z;
    if (blocks(edgeBetween(ix, iz, x, z))) continue;
    const isFront = (fx === 1 && i === W) || (fx === -1 && i === -1) || (fz === 1 && j === D) || (fz === -1 && j === -1);
    out.push({ x, z, front: isFront });
  }
  return out;
}

// ---------------- meshes ----------------
const matCache = new Map();
function mat(color, name, extra) {
  const key = color + "|" + (name || "") + JSON.stringify(extra || {});
  if (!matCache.has(key)) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.75, metalness: 0.05 }, extra || {}));
    m.name = name || "Mat_" + color.replace("#", "");
    matCache.set(key, m);
  }
  return matCache.get(key);
}
function part(name, geo, material, x, y, z) {
  const m = new THREE.Mesh(geo, material); m.name = name; m.position.set(x || 0, y || 0, z || 0);
  m.castShadow = true; m.receiveShadow = true; return m;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s || 12);

function buildFurniture(type) {
  const g = new THREE.Group(); g.name = CATALOG[type] ? CATALOG[type].label : type;
  const wood = mat("#7a5232", "Wood"), dark = mat("#2b2724", "Dark"), white = mat("#e8e4dc", "Porcelain"), metal = mat("#9aa0a6", "Metal", { metalness: 0.6, roughness: 0.35 });
  switch (type) {
    case "bed":
      g.add(part("Frame", box(0.95, 0.3, 1.95), wood, 0, 0.15, 0));
      g.add(part("Mattress", box(0.9, 0.18, 1.85), mat("#efe9dd", "Linen"), 0, 0.39, 0));
      g.add(part("Blanket", box(0.92, 0.06, 1.1), mat("#3a6ea5", "Blanket"), 0, 0.5, 0.35));
      g.add(part("Pillow", box(0.6, 0.1, 0.3), white, 0, 0.53, -0.7));
      g.add(part("Headboard", box(0.95, 0.7, 0.08), wood, 0, 0.45, -0.95));
      break;
    case "sofa":
      g.add(part("Base", box(1.9, 0.4, 0.8), mat("#6b3a2f", "Fabric"), 0, 0.2, 0));
      g.add(part("Back", box(1.9, 0.5, 0.18), mat("#6b3a2f", "Fabric"), 0, 0.6, -0.31));
      g.add(part("ArmL", box(0.16, 0.3, 0.8), mat("#5a2f26", "Fabric2"), -0.87, 0.55, 0));
      g.add(part("ArmR", box(0.16, 0.3, 0.8), mat("#5a2f26", "Fabric2"), 0.87, 0.55, 0));
      break;
    case "chair":
      g.add(part("Seat", box(0.5, 0.06, 0.5), wood, 0, 0.45, 0));
      g.add(part("Back", box(0.5, 0.5, 0.06), wood, 0, 0.72, -0.22));
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) g.add(part("Leg", box(0.05, 0.45, 0.05), wood, x, 0.22, z));
      break;
    case "table":
      g.add(part("Top", box(0.9, 0.06, 0.9), wood, 0, 0.75, 0));
      for (const [x, z] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) g.add(part("Leg", box(0.06, 0.72, 0.06), wood, x, 0.36, z));
      g.add(part("Plate", cyl(0.14, 0.12, 0.02, 16), white, 0.1, 0.79, 0.1));
      break;
    case "fridge":
      g.add(part("Body", box(0.8, 1.8, 0.7), white, 0, 0.9, -0.05));
      g.add(part("Handle", box(0.04, 0.5, 0.04), metal, 0.3, 1.1, 0.32));
      g.add(part("Seam", box(0.8, 0.02, 0.01), dark, 0, 1.25, 0.305));
      break;
    case "stove":
      g.add(part("Body", box(0.85, 0.9, 0.7), metal, 0, 0.45, -0.05));
      g.add(part("Top", box(0.85, 0.03, 0.7), dark, 0, 0.91, -0.05));
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.1], [0.2, 0.1]]) g.add(part("Burner", cyl(0.1, 0.1, 0.02, 16), mat("#552", "Burner"), x, 0.93, z));
      g.add(part("OvenDoor", box(0.7, 0.5, 0.02), dark, 0, 0.4, 0.31));
      break;
    case "toilet":
      g.add(part("Bowl", cyl(0.22, 0.17, 0.4, 16), white, 0, 0.2, 0.05));
      g.add(part("Seat", cyl(0.23, 0.23, 0.04, 16), white, 0, 0.42, 0.05));
      g.add(part("Tank", box(0.45, 0.4, 0.18), white, 0, 0.6, -0.28));
      break;
    case "shower":
      g.add(part("Tray", box(0.95, 0.08, 0.95), white, 0, 0.04, 0));
      g.add(part("Glass", box(0.95, 2.0, 0.03), mat("#a8d0e6", "Glass", { transparent: true, opacity: 0.35 }), 0, 1.05, 0.46));
      g.add(part("Pipe", cyl(0.02, 0.02, 1.9, 8), metal, 0.35, 1.0, -0.44));
      g.add(part("Head", cyl(0.1, 0.06, 0.05, 12), metal, 0.35, 1.95, -0.38));
      break;
    case "tv":
      g.add(part("Stand", box(0.9, 0.45, 0.4), wood, 0, 0.22, -0.2));
      g.add(part("Screen", box(0.85, 0.5, 0.05), dark, 0, 0.75, -0.25));
      g.add(part("Glow", box(0.78, 0.43, 0.01), mat("#3d6f9e", "ScreenGlow", { emissive: "#21425f", emissiveIntensity: 0.8 }), 0, 0.75, -0.22));
      break;
    case "lamp": {
      g.add(part("Base", cyl(0.15, 0.18, 0.05, 16), dark, 0, 0.03, 0));
      g.add(part("Pole", cyl(0.02, 0.02, 1.4, 8), metal, 0, 0.72, 0));
      g.add(part("Shade", cyl(0.12, 0.25, 0.3, 16, true), mat("#f3e2b3", "Shade", { emissive: "#c9a227", emissiveIntensity: 0.5 }), 0, 1.45, 0));
      const l = new THREE.PointLight("#ffd58a", 0.9, 6, 1.5); l.name = "LampLight"; l.position.set(0, 1.35, 0); g.add(l);
      break;
    }
    case "plant":
      g.add(part("Pot", cyl(0.2, 0.15, 0.35, 12), mat("#a0522d", "Terracotta"), 0, 0.17, 0));
      g.add(part("Leaves", new THREE.IcosahedronGeometry(0.35, 1), mat("#3c7a3a", "Leaves", { flatShading: true }), 0, 0.65, 0));
      break;
    case "easel":
      g.add(part("LegL", box(0.04, 1.6, 0.04), wood, -0.25, 0.8, 0.05));
      g.add(part("LegR", box(0.04, 1.6, 0.04), wood, 0.25, 0.8, 0.05));
      g.add(part("LegBack", box(0.04, 1.6, 0.04), wood, 0, 0.75, -0.3));
      g.add(part("Canvas", box(0.6, 0.75, 0.03), mat("#f5f0e8", "Canvas"), 0, 1.15, 0.08));
      g.add(part("Paint", box(0.4, 0.3, 0.005), mat("#c9a227", "PaintDaub"), -0.05, 1.2, 0.1));
      break;
  }
  g.userData.kind = "furniture"; g.userData.type = type;
  return g;
}

function buildSimModel(sim) {
  const root = new THREE.Group(); root.name = "Sim_" + (sim.name || "Sim").replace(/\W+/g, "_");
  const skin = mat(sim.skin, "Skin"), top = mat(sim.top, "Outfit_Top"), bottom = mat(sim.bottom, "Outfit_Bottom"), hair = mat(sim.hair, "Hair");
  const shoe = mat("#1d1a18", "Shoes"), eye = mat("#111111", "Eyes");
  const j = (name, x, y, z) => { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); return g; };
  const hips = j("Joint_Hips", 0, 0.92, 0); root.add(hips);
  hips.add(part("Pelvis", box(0.34, 0.18, 0.2), bottom, 0, 0, 0));
  const spine = j("Joint_Spine", 0, 0.08, 0); hips.add(spine);
  spine.add(part("Torso", box(0.38, 0.5, 0.22), top, 0, 0.25, 0));
  const neck = j("Joint_Neck", 0, 0.52, 0); spine.add(neck);
  neck.add(part("Neck", cyl(0.05, 0.06, 0.08, 10), skin, 0, 0.03, 0));
  const head = j("Joint_Head", 0, 0.08, 0); neck.add(head);
  head.add(part("Head", new THREE.SphereGeometry(0.14, 20, 16), skin, 0, 0.12, 0));
  head.add(part("EyeL", new THREE.SphereGeometry(0.018, 8, 6), eye, -0.05, 0.14, 0.125));
  head.add(part("EyeR", new THREE.SphereGeometry(0.018, 8, 6), eye, 0.05, 0.14, 0.125));
  if (sim.hairStyle !== "bald") {
    const cap = new THREE.SphereGeometry(0.152, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const h = part("Hair", cap, hair, 0, 0.14, -0.01); head.add(h);
    if (sim.hairStyle === "long") head.add(part("HairBack", box(0.28, 0.32, 0.08), hair, 0, 0.02, -0.11));
    if (sim.hairStyle === "bun") head.add(part("HairBun", new THREE.SphereGeometry(0.07, 12, 10), hair, 0, 0.27, -0.1));
  }
  for (const s of [-1, 1]) {
    const L = s < 0 ? "L" : "R";
    const sh = j("Joint_Shoulder" + L, s * 0.24, 0.46, 0); spine.add(sh);
    sh.add(part("Arm" + L, cyl(0.05, 0.045, 0.52, 10), top, 0, -0.26, 0));
    sh.add(part("Hand" + L, new THREE.SphereGeometry(0.05, 10, 8), skin, 0, -0.55, 0));
    const hp = j("Joint_Hip" + L, s * 0.095, -0.06, 0); hips.add(hp);
    hp.add(part("Leg" + L, box(0.13, 0.8, 0.14), bottom, 0, -0.4, 0));
    hp.add(part("Foot" + L, box(0.13, 0.07, 0.24), shoe, 0, -0.83, 0.04));
  }
  applyBody(root, sim);
  root.userData.kind = "sim"; root.userData.simId = sim.id;
  root.userData.sim = { name: sim.name, skin: sim.skin, hair: sim.hair, top: sim.top, bottom: sim.bottom, height: sim.height, build: sim.build };
  return root;
}
function applyBody(root, sim) {
  root.scale.setScalar(sim.height || 1);
  const b = sim.build || 1;
  const sp = root.getObjectByName("Joint_Spine"); if (sp) sp.scale.set(b, 1, Math.sqrt(b));
  const pel = root.getObjectByName("Pelvis"); if (pel) pel.scale.set(b, 1, Math.sqrt(b));
  for (const L of ["L", "R"]) { const leg = root.getObjectByName("Leg" + L); if (leg) leg.scale.set(Math.sqrt(b), 1, Math.sqrt(b)); const hp = root.getObjectByName("Joint_Hip" + L); if (hp) hp.position.x = (L === "L" ? -1 : 1) * 0.095 * b; }
}

// ---------------- lot rendering ----------------
function disposeChildren(g) { while (g.children.length) { const c = g.children.pop(); c.traverse((o) => o.geometry && o.geometry.dispose()); } }
function rebuildLot() {
  disposeChildren(floorGroup); disposeChildren(wallGroup);
  for (const k in S.floors) {
    const [x, z] = k.split(",").map(Number); const c = tileCenter(x, z);
    const m = part("Floor_" + k, box(1, 0.04, 1), mat(S.floors[k], "Floor"), c.x, 0.02, c.z); m.castShadow = false; floorGroup.add(m);
  }
  const hScale = wallsMode === "down" ? 0.12 : wallsMode === "cut" ? 0.4 : 1;
  for (const k in S.walls) {
    const w = S.walls[k]; const [o, xs, zs] = k.split(":"); const x = +xs, z = +zs;
    const g = new THREE.Group(); g.name = "Wall_" + k; g.userData.edge = k;
    const cx = o === "h" ? x + 0.5 - N / 2 : x - N / 2, cz = o === "h" ? z - N / 2 : z + 0.5 - N / 2;
    g.position.set(cx, 0, cz); if (o === "v") g.rotation.y = Math.PI / 2;
    const m = mat(w.c || WALL_COLORS[0], "Wall"); const H = WALL_H * hScale;
    const seg = (y0, y1) => { if (y1 <= y0) return; const p = part("WallPart", box(1.02, y1 - y0, WALL_T), m, 0, (y0 + y1) / 2, 0); p.userData.edge = k; g.add(p); };
    if (w.t === "wall") seg(0, H);
    else if (w.t === "door") {
      seg(Math.min(2.1, H), H);
      const fr = mat("#4a3322", "DoorFrame");
      for (const s of [-1, 1]) { const p = part("DoorJamb", box(0.08, Math.min(2.1, H), WALL_T + 0.04), fr, s * 0.46, Math.min(2.1, H) / 2, 0); p.userData.edge = k; g.add(p); }
      const sill = part("DoorSill", box(0.9, 0.02, WALL_T + 0.04), fr, 0, 0.01, 0); sill.userData.edge = k; g.add(sill);
    } else if (w.t === "window") {
      seg(0, Math.min(0.9, H)); seg(Math.min(1.9, H), H);
      if (H > 0.9) { const gl = part("WindowGlass", box(1, Math.min(1.9, H) - 0.9, 0.03), mat("#9cc6de", "Glass", { transparent: true, opacity: 0.35 }), 0, (0.9 + Math.min(1.9, H)) / 2, 0); gl.userData.edge = k; g.add(gl); }
    }
    wallGroup.add(g);
  }
  rebuildObjects();
}
function rebuildObjects() {
  disposeChildren(objGroup); objMeshes.clear();
  for (const o of S.objects) {
    const g = o.type.startsWith("custom:") ? customObject(o) : buildFurniture(o.type);
    placeMesh(g, o); g.userData.objId = o.id; g.traverse((c) => (c.userData.objId = o.id));
    if (o.type === "lamp") { const l = g.getObjectByName("LampLight"); if (l) l.visible = o.on !== false; }
    objGroup.add(g); objMeshes.set(o.id, g);
  }
}
function placeMesh(g, o) {
  const { W, D } = footprint(o);
  g.position.set(o.x + W / 2 - N / 2, 0, o.z + D / 2 - N / 2);
  g.rotation.y = o.rot * Math.PI / 2;
}
const customCache = new Map();
function customObject(o) {
  const g = new THREE.Group(); g.name = "Custom";
  const src = customCache.get(o.type);
  if (src) g.add(src.clone(true));
  else g.add(part("Missing", box(0.5, 0.5, 0.5), mat("#ff00aa", "Missing"), 0, 0.25, 0));
  return g;
}

// ---------------- sims runtime ----------------
function spawnSim(sim) {
  const old = runtime.get(sim.id); if (old) simGroup.remove(old.holder);
  const holder = new THREE.Group(); holder.name = "SimHolder"; holder.userData.simId = sim.id;
  const rt = { holder, model: null, path: [], task: null, phase: 0, pose: "stand", thought: "" };
  setSimModel(rt, sim);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 32), new THREE.MeshBasicMaterial({ color: "#c9a227", side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.name = "SelectRing"; ring.visible = false; holder.add(ring);
  const c = tileCenter(sim.x, sim.z); holder.position.copy(c); holder.rotation.y = sim.rot || 0;
  simGroup.add(holder); runtime.set(sim.id, rt);
}
function setSimModel(rt, sim) {
  if (rt.model) rt.holder.remove(rt.model);
  let m = null;
  if (sim.glb && customCache.has("sim:" + sim.id)) { m = customCache.get("sim:" + sim.id).clone(true); }
  else m = buildSimModel(sim);
  m.traverse((c) => { c.userData.simId = sim.id; if (c.isMesh) c.castShadow = true; });
  rt.model = m; rt.holder.add(m);
}
function getSim(id) { return S.sims.find((s) => s.id === id); }
function selectSim(id) {
  selectedSimId = id;
  for (const [sid, rt] of runtime) { const r = rt.holder.getObjectByName("SelectRing"); if (r) r.visible = sid === id; }
  renderSimList(); renderCas(); renderNeeds();
}
function simTile(sim) { return [sim.x, sim.z]; }
function commandSim(sim, target) {
  const rt = runtime.get(sim.id); if (!rt) return;
  endTask(sim, rt);
  const occ = occupancy();
  const [sx, sz] = simTile(sim);
  const { dist, prev } = bfs(sx, sz, occ);
  let goal = null, obj = null;
  if (target.objId) {
    obj = S.objects.find((o) => o.id === target.objId); if (!obj) return;
    let best = null;
    for (const t of approachTiles(obj)) {
      const k = t.x + "," + t.z; if (!dist.has(k)) continue;
      const score = dist.get(k) - (t.front ? 3 : 0);
      if (!best || score < best.score) best = { k, score };
    }
    if (!best) { setStatus(sim.name + " can't reach the " + CATALOG[obj.type]?.label || "object"); thought(sim, "Can't get there!"); return; }
    goal = best.k;
  } else {
    goal = target.x + "," + target.z;
    if (!dist.has(goal)) { setStatus(sim.name + " can't get there"); thought(sim, "Blocked…"); return; }
  }
  rt.path = pathTo(prev, sx + "," + sz, goal) || [];
  rt.task = obj ? { objId: obj.id, t: 0 } : null;
  rt.pose = "stand";
  thought(sim, obj ? "→ " + (CATALOG[obj.type]?.label || "object") : "Walking");
}
function endTask(sim, rt) {
  if (rt.task && rt.task.using) {
    const p = tileCenter(sim.x, sim.z); rt.holder.position.copy(p); rt.holder.rotation.x = 0;
  }
  rt.task = null; rt.pose = "stand"; rt.path = [];
}
function thought(sim, t) { const rt = runtime.get(sim.id); if (rt) rt.thought = t; if (sim.id === selectedSimId) { const el = $("sims-thought"); if (el) el.textContent = sim.name + ": " + t; } }
function startUse(sim, rt) {
  const o = S.objects.find((x) => x.id === rt.task.objId); if (!o) { rt.task = null; return; }
  const c = CATALOG[o.type] || { dur: 5, use: { fun: 1 }, pose: "stand" };
  rt.task.using = true; rt.task.left = c.dur;
  const g = objMeshes.get(o.id);
  const ctr = g ? g.position.clone() : tileCenter(o.x, o.z);
  const [fx, fz] = FRONT[o.rot];
  if (c.toggle) { o.on = o.on === false; const l = g && g.getObjectByName("LampLight"); if (l) l.visible = o.on !== false; save(); }
  if (c.pose === "sit") {
    rt.holder.position.set(ctr.x + fx * 0.05, o.type === "toilet" ? 0.0 : 0.0, ctr.z + fz * 0.05);
    rt.holder.rotation.y = Math.atan2(fx, fz); rt.pose = "sit";
  } else if (c.pose === "lie") {
    rt.holder.position.set(ctr.x, 0.55, ctr.z); rt.holder.rotation.y = Math.atan2(fx, fz) + Math.PI; rt.pose = "lie";
  } else if (c.pose === "inside") {
    rt.holder.position.set(ctr.x, 0.08, ctr.z); rt.holder.rotation.y = Math.atan2(fx, fz); rt.pose = "shower";
  } else {
    const p = rt.holder.position; rt.holder.rotation.y = Math.atan2(ctr.x - p.x, ctr.z - p.z); rt.pose = o.type === "easel" ? "paint" : "stand";
  }
  thought(sim, "Using " + (c.label || "object"));
}
function stepSims(dtReal) {
  const gameMin = dtReal * speed; // 1 real second = 1 game minute at 1x
  if (speed === 0) { animateSims(0); return; }
  S.minutes += gameMin;
  for (const sim of S.sims) {
    const rt = runtime.get(sim.id); if (!rt) continue;
    for (const n of NEEDS) sim.needs[n] = Math.max(0, sim.needs[n] - (DECAY[n] / 60) * gameMin);
    if (rt.path.length) {
      const [tx, tz] = rt.path[0]; const target = tileCenter(tx, tz); const p = rt.holder.position;
      const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz);
      const step = 1.8 * dtReal * speed;
      rt.holder.rotation.y = Math.atan2(dx, dz);
      if (d <= step) { p.x = target.x; p.z = target.z; sim.x = tx; sim.z = tz; rt.path.shift(); }
      else { p.x += dx / d * step; p.z += dz / d * step; }
      rt.pose = "walk";
      if (!rt.path.length) { rt.pose = "stand"; if (rt.task) startUse(sim, rt); else thought(sim, "Idle"); }
    } else if (rt.task && rt.task.using) {
      const o = S.objects.find((x) => x.id === rt.task.objId); const c = o && CATALOG[o.type];
      if (!c) { endTask(sim, rt); continue; }
      for (const n in c.use) sim.needs[n] = Math.min(100, Math.max(0, sim.needs[n] + c.use[n] * gameMin));
      rt.task.left -= gameMin;
      const full = Object.keys(c.use).every((n) => c.use[n] <= 0 || sim.needs[n] >= 99.5);
      if (rt.task.left <= 0 || full) { endTask(sim, rt); thought(sim, "Done with " + c.label); }
    } else if ($("sims-freewill") && $("sims-freewill").checked) {
      rt.idle = (rt.idle || 0) + gameMin;
      if (rt.idle > 4) { rt.idle = 0; autonomy(sim); }
    }
  }
  animateSims(dtReal * speed);
}
function autonomy(sim) {
  let worst = null; for (const n of NEEDS) if (sim.needs[n] < 45 && (!worst || sim.needs[n] < sim.needs[worst])) worst = n;
  if (!worst) return;
  const cands = S.objects.filter((o) => CATALOG[o.type] && (CATALOG[o.type].use[worst] || 0) > 0);
  cands.sort((a, b) => CATALOG[b.type].use[worst] - CATALOG[a.type].use[worst] || (Math.abs(a.x - sim.x) + Math.abs(a.z - sim.z)) - (Math.abs(b.x - sim.x) + Math.abs(b.z - sim.z)));
  for (const o of cands.slice(0, 3)) { commandSim(sim, { objId: o.id }); if (runtime.get(sim.id).task) return; }
}
function animateSims(dt) {
  for (const sim of S.sims) {
    const rt = runtime.get(sim.id); if (!rt || !rt.model) continue;
    const m = rt.model, J = (n) => m.getObjectByName(n);
    const hl = J("Joint_HipL"), hr = J("Joint_HipR"), sl = J("Joint_ShoulderL"), sr = J("Joint_ShoulderR"), hips = J("Joint_Hips");
    rt.phase += dt * 9;
    const sw = reduceMotion ? 0 : Math.sin(rt.phase);
    const set = (o, x, z) => { if (o) { o.rotation.x = x; o.rotation.z = z || 0; } };
    m.rotation.x = 0; m.position.set(0, 0, 0);
    if (rt.pose === "walk") { set(hl, sw * 0.55); set(hr, -sw * 0.55); set(sl, -sw * 0.45); set(sr, sw * 0.45); if (hips && !reduceMotion) hips.position.y = 0.92 + Math.abs(Math.cos(rt.phase)) * 0.025; }
    else if (rt.pose === "sit") { set(hl, -1.5); set(hr, -1.5); set(sl, -0.3); set(sr, -0.3); m.position.y = -0.47; m.position.z = 0; }
    else if (rt.pose === "lie") { set(hl, 0); set(hr, 0); set(sl, 0.1, 0.1); set(sr, 0.1, -0.1); m.rotation.x = -Math.PI / 2; m.position.set(0, 0.1, -0.85); }
    else if (rt.pose === "paint") { set(hl, 0); set(hr, 0); set(sl, 0); set(sr, -1.3 + (reduceMotion ? 0 : Math.sin(rt.phase * 0.7) * 0.25), 0); }
    else if (rt.pose === "shower") { set(hl, 0); set(hr, 0); set(sl, -2.6 + sw * 0.1); set(sr, -2.6 - sw * 0.1); }
    else { set(hl, 0); set(hr, 0); set(sl, 0, 0.05); set(sr, 0, -0.05); if (hips) hips.position.y = 0.92; }
  }
}

// ---------------- three setup ----------------
async function start() {
  started = true;
  setStatus("Loading 3D…");
  [THREE, { OrbitControls }, { GLTFExporter }, { GLTFLoader }] = await Promise.all([
    import("three"), import("three/addons/controls/OrbitControls.js"), import("three/addons/exporters/GLTFExporter.js"), import("three/addons/loaders/GLTFLoader.js"),
  ]);
  const wrap = $("sims-stage");
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = window.innerWidth > 700; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.id = "sims-canvas"; renderer.domElement.setAttribute("aria-label", "Sims lot");
  wrap.appendChild(renderer.domElement);
  scene = new THREE.Scene(); scene.background = new THREE.Color("#141210"); scene.fog = new THREE.Fog("#141210", 30, 60);
  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200); camera.position.set(14, 16, 18);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0); controls.enableDamping = !reduceMotion; controls.maxPolarAngle = Math.PI * 0.45; controls.minDistance = 5; controls.maxDistance = 45;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  scene.add(new THREE.HemisphereLight("#fff6e6", "#3a3226", 0.9));
  const sun = new THREE.DirectionalLight("#fff1d6", 1.6); sun.position.set(10, 20, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16 }); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(N, N), mat("#3d4a2f", "Grass")); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = "Ground"; scene.add(ground);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: "#1a1816" })); outer.rotation.x = -Math.PI / 2; outer.position.y = -0.01; scene.add(outer);
  const grid = new THREE.GridHelper(N, N, "#c9a227", "#5a6a48"); grid.position.y = 0.045; grid.material.transparent = true; grid.material.opacity = 0.35; grid.name = "Grid";
  helperGroup = new THREE.Group(); helperGroup.add(grid); scene.add(helperGroup);
  lotGroup = new THREE.Group(); lotGroup.name = "Lot"; scene.add(lotGroup);
  floorGroup = new THREE.Group(); floorGroup.name = "Floors"; wallGroup = new THREE.Group(); wallGroup.name = "Walls";
  objGroup = new THREE.Group(); objGroup.name = "Furniture"; simGroup = new THREE.Group(); simGroup.name = "Sims";
  lotGroup.add(floorGroup, wallGroup, objGroup, simGroup);
  ghostGroup = new THREE.Group(); scene.add(ghostGroup);
  raycaster = new THREE.Raycaster(); clockObj = new THREE.Clock();

  S = loadSave();
  await restoreCustomGlbs();
  rebuildLot();
  for (const sim of S.sims) spawnSim(sim);
  selectSim(S.sims[0] ? S.sims[0].id : null);
  bindUI(); setMode("build"); resize();
  new ResizeObserver(resize).observe(wrap);
  ready = true;
  setStatus("Ready — everything runs in your browser, no credits.");
  loop();
}
function resize() {
  const wrap = $("sims-stage"); if (!renderer || !wrap) return;
  const w = wrap.clientWidth || 300, h = wrap.clientHeight || 300;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
let lastSave = 0;
function loop() {
  rafId = 0; if (!visible || !ready) return;
  const dt = Math.min(0.1, clockObj.getDelta());
  if (mode === "live") stepSims(dt); else animateSims(0);
  controls.update(); renderer.render(scene, camera);
  if (mode === "live" && performance.now() - lastSave > 5000) { lastSave = performance.now(); save(); renderNeeds(); }
  else if (mode === "live") renderNeedsLight();
  rafId = requestAnimationFrame(loop);
}

// ---------------- picking ----------------
function ndc(ev) { const r = renderer.domElement.getBoundingClientRect(); return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); }
function groundPoint(ev) {
  raycaster.setFromCamera(ndc(ev), camera);
  const p = new THREE.Vector3(); return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
}
function pick(ev, groups) {
  raycaster.setFromCamera(ndc(ev), camera);
  const hits = raycaster.intersectObjects(groups, true);
  return hits.length ? hits[0].object : null;
}
function tileAt(p) { return [Math.floor(p.x + N / 2), Math.floor(p.z + N / 2)]; }
function vertexAt(p) { return [Math.round(p.x + N / 2), Math.round(p.z + N / 2)]; }
function edgeAt(ev) {
  const w = pick(ev, [wallGroup]); if (w && w.userData.edge) return w.userData.edge;
  const p = groundPoint(ev); if (!p) return null;
  const fx = p.x + N / 2, fz = p.z + N / 2;
  const dx = Math.abs(fx - Math.round(fx)), dz = Math.abs(fz - Math.round(fz));
  if (Math.min(dx, dz) > 0.35) return null;
  let k = dx < dz ? "v:" + Math.round(fx) + ":" + Math.floor(fz) : "h:" + Math.floor(fx) + ":" + Math.round(fz);
  const [o, a, b] = k.split(":").map((v, i) => (i ? +v : v));
  if (a < 0 || b < 0 || a > N || b > N || (o === "h" && a >= N) || (o === "v" && b >= N)) return null;
  return k;
}
function wallLineEdges(a, b) {
  const out = []; const dx = b[0] - a[0], dz = b[1] - a[1];
  if (Math.abs(dx) >= Math.abs(dz)) { const z = a[1]; for (let x = Math.min(a[0], b[0]); x < Math.max(a[0], b[0]); x++) out.push("h:" + x + ":" + z); }
  else { const x = a[0]; for (let z = Math.min(a[1], b[1]); z < Math.max(a[1], b[1]); z++) out.push("v:" + x + ":" + z); }
  return out.filter((k) => { const [o, p, q] = k.split(":"); return +p >= 0 && +q >= 0 && +p <= N && +q <= N; });
}

// ---------------- ghosts ----------------
function clearGhost() { disposeChildren(ghostGroup); }
function ghostMat(ok) { return new THREE.MeshBasicMaterial({ color: ok ? "#c9a227" : "#d04a3a", transparent: true, opacity: 0.45, depthWrite: false }); }
function showWallGhost(edges) {
  clearGhost(); const m = ghostMat(true);
  for (const k of edges) { const [o, x, z] = k.split(":"); const g = new THREE.Mesh(box(1, 0.4, 0.14), m);
    g.position.set(o === "h" ? +x + 0.5 - N / 2 : +x - N / 2, 0.2, o === "h" ? +z - N / 2 : +z + 0.5 - N / 2); if (o === "v") g.rotation.y = Math.PI / 2; ghostGroup.add(g); }
}
function showRectGhost(a, b, color) {
  clearGhost(); const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
  const g = new THREE.Mesh(box(x1 - x0 + 1, 0.06, z1 - z0 + 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }));
  g.position.set((x0 + x1 + 1) / 2 - N / 2, 0.05, (z0 + z1 + 1) / 2 - N / 2); ghostGroup.add(g);
}
function showObjGhost(o) {
  clearGhost(); const ok = canPlace(o, carry && carry.id);
  const g = o.type.startsWith("custom:") ? customObject(o) : buildFurniture(o.type);
  const gm = ghostMat(ok); g.traverse((c) => { if (c.isMesh) c.material = gm; if (c.isLight) c.visible = false; });
  placeMesh(g, o); ghostGroup.add(g);
  const { W, D } = footprint(o); const pad = new THREE.Mesh(box(W, 0.02, D), gm); pad.position.set(g.position.x, 0.06, g.position.z); ghostGroup.add(pad);
  return ok;
}

// ---------------- input ----------------
let drag = null; const pointers = new Set();
const DRAG_TOOLS = ["wall", "floor", "paint"];
function updateControlsForTool() {
  const dragTool = (mode === "build" && DRAG_TOOLS.includes(tool));
  controls.mouseButtons.LEFT = dragTool ? null : THREE.MOUSE.ROTATE;
  controls.touches.ONE = dragTool ? null : THREE.TOUCH.ROTATE;
  renderer.domElement.style.cursor = dragTool ? "crosshair" : "grab";
}
function onDown(ev) {
  pointers.add(ev.pointerId);
  if (pointers.size > 1) { drag = null; clearGhost(); return; }
  if (ev.button !== 0) return;
  drag = { x: ev.clientX, y: ev.clientY, moved: false };
  if (mode === "build" && DRAG_TOOLS.includes(tool)) {
    const p = groundPoint(ev); if (!p) { drag = null; return; }
    drag.kind = tool; drag.a = tool === "wall" ? vertexAt(p) : tileAt(p); drag.b = drag.a; drag.painted = new Set();
    if (tool === "paint") { snapshot(); paintAt(ev, drag); }
    try { renderer.domElement.setPointerCapture(ev.pointerId); } catch (e) {}
  }
}
function onMove(ev) {
  if (drag && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 8) drag.moved = true;
  if (drag && drag.kind) {
    const p = groundPoint(ev); if (!p) return;
    if (drag.kind === "wall") { drag.b = vertexAt(p); showWallGhost(wallLineEdges(drag.a, drag.b)); }
    else if (drag.kind === "floor") { drag.b = tileAt(p); showRectGhost(drag.a, drag.b, floorColor); }
    else if (drag.kind === "paint") paintAt(ev, drag);
    return;
  }
  if (!drag || ev.pointerType === "mouse") hover(ev);
}
function onUp(ev) {
  pointers.delete(ev.pointerId);
  const d = drag; drag = null; if (!d) return;
  if (d.kind === "wall") {
    clearGhost(); const edges = wallLineEdges(d.a, d.b);
    if (edges.length) { snapshot(); for (const k of edges) if (!S.walls[k]) S.walls[k] = { t: "wall", c: wallColor }; rebuildLot(); save(); setStatus(edges.length + " wall segment(s)"); }
    return;
  }
  if (d.kind === "floor") {
    clearGhost(); snapshot();
    const x0 = Math.min(d.a[0], d.b[0]), x1 = Math.max(d.a[0], d.b[0]), z0 = Math.min(d.a[1], d.b[1]), z1 = Math.max(d.a[1], d.b[1]);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (inLot(x, z)) S.floors[x + "," + z] = floorColor;
    rebuildLot(); save(); return;
  }
  if (d.kind === "paint") { if (!d.painted.size) undoStack.pop(); save(); return; }
  if (!d.moved) tap(ev);
}
function paintAt(ev, d) {
  const k = edgeAt(ev); if (!k || !S.walls[k] || d.painted.has(k)) return;
  d.painted.add(k); S.walls[k].c = wallColor; rebuildLot();
}
function hover(ev) {
  if (mode === "buy" && (buyItem || carry)) {
    const p = groundPoint(ev); if (!p) return; const [x, z] = tileAt(p);
    const o = carry ? Object.assign({}, carry, { x, z, rot: buyRot }) : { type: buyItem, x, z, rot: buyRot };
    showObjGhost(o);
  } else if (mode === "build" && (tool === "door" || tool === "window" || tool === "delete")) {
    const k = edgeAt(ev); if (k) showWallGhost([k]); else clearGhost();
  }
}
function tap(ev) {
  if (mode === "build") {
    if (tool === "door" || tool === "window") {
      const k = edgeAt(ev); if (!k) return; snapshot();
      S.walls[k] = { t: S.walls[k] && S.walls[k].t === tool ? "wall" : tool, c: (S.walls[k] && S.walls[k].c) || wallColor };
      rebuildLot(); save();
    } else if (tool === "delete") {
      const hit = pick(ev, [objGroup]); snapshot();
      if (hit && hit.userData.objId) { S.objects = S.objects.filter((o) => o.id !== hit.userData.objId); rebuildLot(); save(); setStatus("Deleted object"); return; }
      const k = edgeAt(ev); if (k && S.walls[k]) { delete S.walls[k]; rebuildLot(); save(); setStatus("Deleted wall"); clearGhost(); return; }
      const p = groundPoint(ev); if (p) { const [x, z] = tileAt(p); if (S.floors[x + "," + z]) { delete S.floors[x + "," + z]; rebuildLot(); save(); setStatus("Removed floor"); return; } }
      undoStack.pop();
    }
    return;
  }
  if (mode === "buy") {
    const p = groundPoint(ev);
    if (buyItem || carry) {
      if (!p) return; const [x, z] = tileAt(p);
      const o = carry ? Object.assign({}, carry, { x, z, rot: buyRot }) : { id: "o" + S.nextId++, type: buyItem, x, z, rot: buyRot };
      if (!canPlace(o, carry && carry.id)) { setStatus("Can't place there"); return; }
      snapshot();
      if (carry) { const i = S.objects.findIndex((q) => q.id === carry.id); if (i >= 0) S.objects[i] = o; else S.objects.push(o); carry = null; setStatus("Moved"); }
      else { S.objects.push(o); setStatus("Placed " + (CATALOG[o.type] ? CATALOG[o.type].label : "item")); }
      clearGhost(); rebuildObjects(); save(); renderBuy(); return;
    }
    const hit = pick(ev, [objGroup]);
    if (hit && hit.userData.objId) { const o = S.objects.find((q) => q.id === hit.userData.objId); if (o) { carry = Object.assign({}, o); buyRot = o.rot; setStatus("Carrying " + (CATALOG[o.type]?.label || "item") + " — tap a tile to drop, Rotate to turn, Sell to delete"); renderBuy(); showObjGhost(carry); } }
    return;
  }
  if (mode === "live" || mode === "cas") {
    const simHit = pick(ev, [simGroup]);
    if (simHit && simHit.userData.simId) { selectSim(simHit.userData.simId); return; }
    if (mode !== "live") return;
    const sim = getSim(selectedSimId); if (!sim) { setStatus("Tap a sim first"); return; }
    const hit = pick(ev, [objGroup]);
    if (hit && hit.userData.objId) { commandSim(sim, { objId: hit.userData.objId }); return; }
    const p = groundPoint(ev); if (p) { const [x, z] = tileAt(p); if (inLot(x, z)) commandSim(sim, { x, z }); }
  }
}

// ---------------- UI ----------------
function setMode(m) {
  mode = m; carry = null; clearGhost();
  document.querySelectorAll("#panel-sims [data-sims-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.simsMode === m)));
  document.querySelectorAll("#panel-sims .sims-pane").forEach((p) => (p.hidden = p.dataset.pane !== m));
  helperGroup.visible = m === "build" || m === "buy";
  if (m !== "live") for (const sim of S.sims) { const rt = runtime.get(sim.id); if (rt) { endTask(sim, rt); const c = tileCenter(sim.x, sim.z); rt.holder.position.copy(c); } }
  updateControlsForTool(); renderBuy(); renderCas(); renderSimList(); renderNeeds();
  setStatus({ build: "Build: drag on the grid to draw walls. Right-drag / two fingers to move the camera.", buy: "Buy: pick an item, tap a tile to place. Tap placed furniture to move it.", cas: "Create-a-Sim: style the selected sim.", live: "Live: tap a sim, then tap furniture or a tile." }[m]);
}
function swatches(el, colors, current, onPick) {
  el.innerHTML = "";
  for (const c of colors) { const b = document.createElement("button"); b.type = "button"; b.className = "sims-swatch"; b.style.background = c; b.title = c; b.setAttribute("aria-label", "Color " + c); b.setAttribute("aria-pressed", String(c === current)); b.onclick = () => onPick(c); el.appendChild(b); }
  const inp = document.createElement("input"); inp.type = "color"; inp.value = current; inp.className = "sims-color"; inp.setAttribute("aria-label", "Custom color"); inp.oninput = () => onPick(inp.value); el.appendChild(inp);
}
function renderBuildColors() {
  swatches($("sims-floor-colors"), FLOOR_COLORS, floorColor, (c) => { floorColor = c; renderBuildColors(); setTool("floor"); });
  swatches($("sims-wall-colors"), WALL_COLORS, wallColor, (c) => { wallColor = c; renderBuildColors(); setTool("paint"); });
}
function setTool(t) {
  tool = t; clearGhost();
  document.querySelectorAll("#panel-sims [data-sims-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.simsTool === t)));
  updateControlsForTool();
}
function renderBuy() {
  const el = $("sims-catalog"); if (!el) return; el.innerHTML = "";
  for (const k in CATALOG) { const c = CATALOG[k]; const b = document.createElement("button"); b.type = "button"; b.className = "sims-item"; b.setAttribute("aria-pressed", String(buyItem === k));
    b.innerHTML = "<strong>" + c.label + "</strong><span>§" + c.price + " · " + c.w + "×" + c.d + "</span>";
    b.onclick = () => { buyItem = buyItem === k ? null : k; carry = null; clearGhost(); renderBuy(); setStatus(buyItem ? "Tap a tile to place the " + c.label : "Tap furniture to move it"); };
    el.appendChild(b); }
  for (const k of customCache.keys()) if (k.startsWith("custom:")) { const b = document.createElement("button"); b.type = "button"; b.className = "sims-item"; b.setAttribute("aria-pressed", String(buyItem === k)); b.innerHTML = "<strong>" + k.slice(7) + "</strong><span>imported .glb</span>"; b.onclick = () => { buyItem = buyItem === k ? null : k; renderBuy(); }; el.appendChild(b); }
  const c = $("sims-carry"); if (c) c.hidden = !carry;
}
function renderSimList() {
  for (const id of ["sims-simlist", "sims-simlist-live"]) {
    const el = $(id); if (!el) continue; el.innerHTML = "";
    for (const s of S.sims) { const b = document.createElement("button"); b.type = "button"; b.className = "sims-chip"; b.setAttribute("aria-pressed", String(s.id === selectedSimId));
      b.innerHTML = '<i style="background:' + s.top + '"></i>' + escapeHtml(s.name); b.onclick = () => { selectSim(s.id); focusSim(s); }; el.appendChild(b); }
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function focusSim(s) { const rt = runtime.get(s.id); if (rt) controls.target.copy(rt.holder.position); }
function renderCas() {
  const sim = getSim(selectedSimId); const pane = $("sims-cas-fields"); if (!pane) return;
  pane.hidden = !sim; if (!sim) return;
  $("sims-name").value = sim.name; $("sims-height").value = sim.height; $("sims-build").value = sim.build; $("sims-hairstyle").value = sim.hairStyle || "short";
  const upd = (k) => (c) => { sim[k] = c; sim.glb = null; customCache.delete("sim:" + sim.id); spawnSim(sim); selectSim(sim.id); save(); };
  swatches($("sims-skin"), SKINS, sim.skin, upd("skin"));
  swatches($("sims-hair"), HAIRS, sim.hair, upd("hair"));
  swatches($("sims-top"), ["#c9a227", "#3a6ea5", "#8b3a3a", "#2f6b4f", "#e8e0d2", "#1d1a18", "#7b4fa0"], sim.top, upd("top"));
  swatches($("sims-bottom"), ["#2b2724", "#3b3f6b", "#5a4632", "#8a8f96", "#6b2f3a", "#d7c3a1"], sim.bottom, upd("bottom"));
  $("sims-glb-note").textContent = sim.glb ? "Using an imported .glb mesh (colors/sliders reset it to the built-in body)." : "Built-in segmented body with named joints (Joint_HipL, Joint_ShoulderR…).";
}
let lastNeedsRender = 0;
function renderNeedsLight() { if (performance.now() - lastNeedsRender > 500) renderNeeds(); }
function renderNeeds() {
  lastNeedsRender = performance.now();
  const el = $("sims-needs"); if (!el || !S) return; const sim = getSim(selectedSimId);
  const h = Math.floor(S.minutes / 60) % 24, mi = Math.floor(S.minutes % 60), day = Math.floor(S.minutes / 1440) + 1;
  $("sims-clock").textContent = "Day " + day + " · " + String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
  if (!sim) { el.innerHTML = "<p>No sim selected.</p>"; return; }
  el.innerHTML = "<h4>" + escapeHtml(sim.name) + "</h4>" + NEEDS.map((n) => { const v = Math.round(sim.needs[n]); const col = v > 60 ? "#6fae5a" : v > 30 ? "#c9a227" : "#d04a3a";
    return '<div class="sims-need"><span>' + n[0].toUpperCase() + n.slice(1) + '</span><div class="sims-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + v + '" aria-label="' + n + '"><b style="width:' + v + "%;background:" + col + '"></b></div><em>' + v + "</em></div>"; }).join("");
  const rt = runtime.get(sim.id); const t = $("sims-thought"); if (t && rt) t.textContent = sim.name + ": " + (rt.thought || "Idle");
}
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
function exportGlb(object, name) {
  const ex = new GLTFExporter();
  const clone = object.clone(true); clone.position.set(0, 0, 0); clone.rotation.set(0, 0, 0);
  const tmp = new THREE.Scene(); tmp.add(clone);
  ex.parse(clone, (res) => { download(new Blob([res], { type: "model/gltf-binary" }), name); setStatus("Exported " + name + " — open in Blender: File › Import › glTF 2.0"); },
    (err) => setStatus("Export failed: " + (err && err.message)), { binary: true, onlyVisible: true });
}
function bufToB64(buf) { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
function b64ToBuf(b64) { const s = atob(b64); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; }
function parseGlb(buf) { return new Promise((res, rej) => new GLTFLoader().parse(buf, "", (g) => res(g.scene), rej)); }
function prepImported(scene) { scene.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return scene; }
async function restoreCustomGlbs() {
  for (const sim of S.sims) if (sim.glb) { try { customCache.set("sim:" + sim.id, prepImported(await parseGlb(b64ToBuf(sim.glb)))); } catch (e) { sim.glb = null; } }
  for (const k in S.customModels || {}) { try { const sc = prepImported(await parseGlb(b64ToBuf(S.customModels[k]))); const bb = new THREE.Box3().setFromObject(sc); const c = bb.getCenter(new THREE.Vector3()); sc.position.set(-c.x, -bb.min.y, -c.z); const w = new THREE.Group(); w.add(sc); customCache.set(k, w); CATALOG[k] = { label: k.slice(7), price: 0, w: 1, d: 1, use: { fun: 1 }, dur: 5, pose: "stand" }; } catch (e) {} }
}
async function importGlb(file) {
  const buf = await file.arrayBuffer();
  let sceneObj; try { sceneObj = prepImported(await parseGlb(buf)); } catch (e) { setStatus("Could not read that .glb"); return; }
  const sim = getSim(selectedSimId);
  if (mode === "buy" || !sim) {
    const key = "custom:" + file.name.replace(/\.glb$/i, "").slice(0, 24);
    // drop onto the ground: center x/z, base at y=0
    const bb = new THREE.Box3().setFromObject(sceneObj); const c = bb.getCenter(new THREE.Vector3()); sceneObj.position.set(-c.x, -bb.min.y, -c.z);
    const wrapG = new THREE.Group(); wrapG.add(sceneObj); customCache.set(key, wrapG);
    S.customModels = S.customModels || {}; S.customModels[key] = bufToB64(buf);
    CATALOG[key] = { label: key.slice(7), price: 0, w: 1, d: 1, use: { fun: 1 }, dur: 5, pose: "stand" };
    buyItem = key; setMode("buy"); setStatus("Imported " + key.slice(7) + " — tap a tile to place it"); save(); return;
  }
  customCache.set("sim:" + sim.id, sceneObj); sim.glb = bufToB64(buf);
  spawnSim(sim); selectSim(sim.id); save();
  const hasJoints = !!sceneObj.getObjectByName("Joint_HipL");
  setStatus("Imported mesh onto " + sim.name + (hasJoints ? " — joints found, walk cycle active." : " — no Joint_* nodes found, it will glide instead of walk."));
}
function bindUI() {
  const cv = renderer.domElement;
  cv.addEventListener("pointerdown", onDown); cv.addEventListener("pointermove", onMove); cv.addEventListener("pointerup", onUp);
  cv.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); drag = null; clearGhost(); });
  cv.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !drag) clearGhost(); });
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  document.querySelectorAll("#panel-sims [data-sims-mode]").forEach((b) => (b.onclick = () => setMode(b.dataset.simsMode)));
  document.querySelectorAll("#panel-sims [data-sims-tool]").forEach((b) => (b.onclick = () => setTool(b.dataset.simsTool)));
  document.querySelectorAll("#panel-sims [data-sims-speed]").forEach((b) => (b.onclick = () => { speed = +b.dataset.simsSpeed; document.querySelectorAll("#panel-sims [data-sims-speed]").forEach((q) => q.setAttribute("aria-pressed", String(q === b))); }));
  document.querySelectorAll("#panel-sims [data-sims-walls]").forEach((b) => (b.onclick = () => { wallsMode = b.dataset.simsWalls; document.querySelectorAll("#panel-sims [data-sims-walls]").forEach((q) => q.setAttribute("aria-pressed", String(q === b))); rebuildLot(); }));
  $("sims-undo").onclick = undo; $("sims-undo2").onclick = undo;
  $("sims-rotate").onclick = () => { buyRot = (buyRot + 1) % 4; if (carry) { carry.rot = buyRot; showObjGhost(carry); } setStatus("Rotation " + buyRot * 90 + "°"); };
  $("sims-sell").onclick = () => { if (!carry) return; snapshot(); S.objects = S.objects.filter((o) => o.id !== carry.id); carry = null; clearGhost(); rebuildObjects(); save(); renderBuy(); setStatus("Sold"); };
  $("sims-name").oninput = (e) => { const s = getSim(selectedSimId); if (!s) return; s.name = e.target.value.slice(0, 24) || "Sim"; renderSimList(); save(); };
  $("sims-name").onchange = () => { const s = getSim(selectedSimId); if (s && !s.glb) { spawnSim(s); selectSim(s.id); } };
  for (const k of ["height", "build"]) $("sims-" + k).oninput = (e) => { const s = getSim(selectedSimId); if (!s) return; s[k] = +e.target.value; const rt = runtime.get(s.id); if (rt && rt.model) applyBody(rt.model, s); save(); };
  $("sims-hairstyle").onchange = (e) => { const s = getSim(selectedSimId); if (!s) return; s.hairStyle = e.target.value; s.glb = null; customCache.delete("sim:" + s.id); spawnSim(s); selectSim(s.id); save(); };
  $("sims-new").onclick = () => { const s = defaultSim("Sim " + (S.sims.length + 1), S.sims.length); const occ = occupancy(); for (let t = 0; t < N * N; t++) { const x = (11 + t) % N, z = (11 + Math.floor(t / N)) % N; if (!occ.has(x + "," + z)) { s.x = x; s.z = z; break; } } S.sims.push(s); spawnSim(s); selectSim(s.id); save(); };
  $("sims-delete-sim").onclick = () => { const s = getSim(selectedSimId); if (!s || S.sims.length <= 1) { setStatus("Keep at least one sim"); return; } const rt = runtime.get(s.id); if (rt) simGroup.remove(rt.holder); runtime.delete(s.id); S.sims = S.sims.filter((q) => q !== s); selectSim(S.sims[0].id); save(); };
  $("sims-export-sim").onclick = () => { const s = getSim(selectedSimId); const rt = s && runtime.get(s.id); if (rt) exportGlb(rt.model, (s.name || "sim").replace(/\W+/g, "_") + ".glb"); };
  $("sims-export-lot").onclick = () => exportGlb(lotGroup, "lot.glb");
  for (const id of ["sims-import-glb", "sims-import-glb2"]) $(id).onchange = (e) => { const f = e.target.files[0]; if (f) importGlb(f); e.target.value = ""; };
  $("sims-export-json").onclick = () => download(new Blob([JSON.stringify(S, null, 1)], { type: "application/json" }), "sims-save.json");
  $("sims-import-json").onchange = async (e) => { const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { const s = JSON.parse(await f.text()); if (!s || s.v !== 1 || !s.walls) throw 0; snapshot(); for (const rt of runtime.values()) simGroup.remove(rt.holder); runtime.clear(); S = s; await restoreCustomGlbs(); rebuildLot(); for (const sim of S.sims) spawnSim(sim); selectSim(S.sims[0] && S.sims[0].id); save(); setStatus("Save loaded"); }
    catch (err) { setStatus("That file isn't a Sims save"); } };
  $("sims-reset").onclick = () => { if (!confirm("Reset the lot to the starter house? (Export a save first if you want to keep this one.)")) return; for (const rt of runtime.values()) simGroup.remove(rt.holder); runtime.clear(); S = freshSave(); undoStack = []; rebuildLot(); for (const sim of S.sims) spawnSim(sim); selectSim(S.sims[0].id); save(); };
  document.addEventListener("keydown", (e) => {
    if (!visible || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    else if (e.key.toLowerCase() === "r" && mode === "buy") $("sims-rotate").click();
    else if (e.key === "Escape") { carry = null; buyItem = null; clearGhost(); renderBuy(); }
  });
  renderBuildColors();
}

// ---------------- tab lifecycle ----------------
function show() {
  visible = true;
  if (!started) start().catch((e) => { console.error(e); setStatus("3D failed to start: " + e.message); });
  else if (ready) { resize(); clockObj.getDelta(); if (!rafId) loop(); }
}
function hide() { visible = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; if (S) try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }
window.addEventListener("sims-show", show);
window.addEventListener("sims-hide", hide);
window.SimsTab = { onShow: show, onHide: hide, get state() { return S; },
  // test helper: screen position of a tile corner/center
  tileToScreen(x, z) { const v = new THREE.Vector3(x - N / 2, 0, z - N / 2).project(camera); const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; } };
const panel = document.getElementById("panel-sims");
if (panel && !panel.hidden) show();
