// Sims tab — build a lot, buy furniture, create sims, live mode.
// Fully client-side: Three.js (vendored r160), no network APIs, no credits.
// Meshes are plain glTF-friendly groups with named parts so they round-trip through Blender.
const N = 24; // lot size in tiles
const SAVE_KEY = "logan7in.sims.save.v1";
const WALL_H = 2.6, WALL_T = 0.12;
const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Built-in furniture is procedural (js/sims-gen.js): types look like "gen:sofa:12345" and old
// saves' plain types ("bed", "lamp", ...) map onto seed 0 of a category. CATALOG only holds imported .glb items.
const CATALOG = { gardenbed: { label: "Planter Bed", price: 60, w: 2, d: 1, use: { fun: 0.4 }, dur: 4, pose: "stand", cat: "gardenbed" } };
let G = null, World = null, world = null, Life = null, Plan = null, Body = null, Hifi = null, SkeletonUtils = null, NightMod = null, night = null, hourOverride = null, lastDt = 0.016;
function catInfo(type) { return CATALOG[type] || (G && G.genInfo(type)) || null; }
const NEEDS = ["hunger", "energy", "fun", "hygiene"];
const DECAY = { hunger: 7, energy: 4.5, fun: 6, hygiene: 3.5 }; // points per game hour
const SKINS = ["#f6d3b3", "#e8b48f", "#c98c62", "#a0673f", "#7a4a2a", "#4e2f1c"];
const HAIRS = ["#1b1410", "#4a2e1a", "#8a5a2b", "#d8b468", "#b33a2a", "#cfcfcf", "#3a5fcd"];
const FLOOR_COLORS = ["#8a6a4a", "#b89970", "#5d4a3a", "#cfc6b8", "#3e4a52", "#6f2f2a", "#2f4a3a", "#e8e4dc", "#7aa6b8", "#c47a5a"];
const WALL_COLORS = ["#e8e0d2", "#c9a227", "#7d8a96", "#a8574a", "#3c4a3e", "#2b2724", "#d7c3a1", "#9ab0c8", "#d08aa0", "#f5f2ea"];

let THREE, OrbitControls, GLTFExporter, GLTFLoader;
let started = false, visible = false, ready = false;
let renderer, scene, camera, controls, raycaster, clockObj;
let lotGroup, wallGroup, floorGroup, objGroup, simGroup, ghostGroup, helperGroup;
let rafId = 0, remoteGroup;
const $ = (id) => document.getElementById(id);

// ---------------- state ----------------
let S = null; // save state
let undoStack = [];
let mode = "build", tool = "wall";
let floorColor = FLOOR_COLORS[1], wallColor = WALL_COLORS[0];
let floorKind = "wood", floorSeed = 7, wallKind = "paint", wallSeed = 1;
const floorValue = () => floorKind + ":" + floorSeed + ":" + floorColor;
const wallPattern = () => (wallKind === "paint" ? undefined : wallKind + ":" + wallSeed);
let buyItem = null, carry = null, buyRot = 0;
let selectedSimId = null;
let speed = 1, wallsMode = "up";
const runtime = new Map(); // simId -> {model, path, task, ...}
const objMeshes = new Map();

function defaultSim(name, i, seed) {
  const look = G.randomSim(seed != null ? seed : G.hashStr("starter:" + name + ":" + i));
  return Object.assign(look, {
    id: "s" + Date.now().toString(36) + i + Math.floor(Math.random() * 1e4).toString(36), name,
    x: 10 + i, z: 12, rot: 0, needs: { hunger: 80, energy: 80, fun: 70, hygiene: 85 }, glb: null,
  });
}
function freshSave() {
  const s = { v: 1, N, walls: {}, floors: {}, objects: [], sims: [], minutes: 8 * 60, nextId: 1 };
  // starter house: 8x6 room
  const x0 = 8, z0 = 8, x1 = 16, z1 = 14;
  for (let x = x0; x < x1; x++) { s.walls["h:" + x + ":" + z0] = { t: "wall", c: WALL_COLORS[0] }; s.walls["h:" + x + ":" + z1] = { t: "wall", c: WALL_COLORS[0] }; }
  for (let z = z0; z < z1; z++) { s.walls["v:" + x0 + ":" + z] = { t: "wall", c: WALL_COLORS[0] }; s.walls["v:" + x1 + ":" + z] = { t: "wall", c: WALL_COLORS[0] }; }
  s.walls["h:12:" + z1].t = "door";
  s.walls["h:10:" + z0].t = "window"; s.walls["h:14:" + z0].t = "window";
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) s.floors[x + "," + z] = (z < 11 ? "wood:7:#b89970" : "tile:3:#cfc6b8");
  const add = (type, x, z, rot) => s.objects.push({ id: "o" + s.nextId++, type, x, z, rot: rot || 0 });
  add("bed", 8, 8, 0); add("fridge", 15, 8, 0); add("stove", 14, 8, 0); add("sofa", 10, 12, 2);
  add("tv", 10, 9, 0); add("easel", 13, 12, 0); add("plant", 8, 13, 0); add("shower", 15, 13, 3); add("toilet", 15, 12, 3);
  add("lamp", 9, 8, 0); add("table", 12, 9, 0); add("chair", 12, 10, 2);
  s.sims.push(defaultSim("Logan", 0)); s.fresh = true;
  return s;
}
function starterFromPlan(old) {
  const P = Plan.generatePlan(G.hashStr("starter"), G, { easel: true, beds: 2 });
  const s = { v: 1, N, walls: P.walls, floors: P.floors, objects: P.objects.map((o, k) => Object.assign({}, o, { id: "o" + (k + 1) })), sims: old.sims, minutes: old.minutes, nextId: P.objects.length + 1, drive: P.drive, plan: { beds: P.beds, baths: P.baths } };
  const hx = Math.floor((P.house.x0 + P.house.x1) / 2), hz = P.house.z1 - 1, occ = new Set(); for (const o of s.objects) { const { W, D } = footprint(o); for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) occ.add((o.x + i) + "," + (o.z + j)); }
  let best = [P.door.x, P.door.z - 1]; for (let r = 0; r < 6; r++) for (let dx = -r; dx <= r; dx++) { const x = hx + dx, z = hz - r; if (!occ.has(x + "," + z) && inLot(x, z)) { best = [x, z]; r = 99; break; } }
  for (const sim of s.sims) { sim.x = best[0]; sim.z = best[1]; }
  return s;
}
function loadSave() {
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { const s = JSON.parse(raw); if (s && s.v === 1) return s; } } catch (e) {}
  return freshSave();
}
let saveTimer = 0;
function save() {
  if (online.visiting) return; // visitors never write the host's lot (or their own) from here
  schedulePublish();
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
  const c = catInfo(o.type) || { w: 1, d: 1 };
  const W = o.rot % 2 ? c.d : c.w, D = o.rot % 2 ? c.w : c.d;
  return { W, D };
}
function occupancy(exceptId, L = S) {
  const occ = new Map();
  for (const o of L.objects) {
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
function blocks(edgeKey, L = S) { const w = L.walls[edgeKey]; return !!w && w.t !== "door"; }
function edgeBetween(ax, az, bx, bz) {
  if (bx === ax + 1) return "v:" + bx + ":" + az;
  if (bx === ax - 1) return "v:" + ax + ":" + az;
  if (bz === az + 1) return "h:" + ax + ":" + bz;
  return "h:" + ax + ":" + az;
}
function bfs(sx, sz, occ, L = S) {
  const dist = new Map(), prev = new Map();
  const k0 = sx + "," + sz; dist.set(k0, 0);
  const q = [[sx, sz]];
  while (q.length) {
    const [x, z] = q.shift(); const k = x + "," + z;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, nk = nx + "," + nz;
      if (!inLot(nx, nz) || dist.has(nk) || occ.has(nk)) continue;
      if (blocks(edgeBetween(x, z, nx, nz), L)) continue;
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
function approachTiles(o, L = S) {
  const { W, D } = footprint(o); const out = [];
  const [fx, fz] = FRONT[o.rot];
  for (let i = -1; i <= W; i++) for (let j = -1; j <= D; j++) {
    const inside = i >= 0 && j >= 0 && i < W && j < D; if (inside) continue;
    if ((i < 0 || i >= W) && (j < 0 || j >= D)) continue; // skip diagonals
    const x = o.x + i, z = o.z + j;
    // must not be separated by a wall from the object tile it touches
    const ix = Math.min(Math.max(i, 0), W - 1) + o.x, iz = Math.min(Math.max(j, 0), D - 1) + o.z;
    if (blocks(edgeBetween(ix, iz, x, z), L)) continue;
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
  const gen = G && G.buildGen(type); if (gen) return gen;
  return buildFurnitureLegacy(type);
}
function buildFurnitureLegacy(type) {
  const g = new THREE.Group(); g.name = catInfo(type) ? catInfo(type).label : type;
  const wood = mat("#7a5232", "Wood"), dark = mat("#2b2724", "Dark"), white = mat("#e8e4dc", "Porcelain"), metal = mat("#9aa0a6", "Metal", { metalness: 0.6, roughness: 0.35 });
  switch (type) {
    case "gardenbed": {
      const plank = mat("#7a5232", "Wood"), soil = mat("#4a3423", "Soil");
      g.add(part("Soil", box(1.9, 0.3, 0.9), soil, 0, 0.15, 0));
      for (const [x, z, w, d] of [[0, 0.47, 2, 0.07], [0, -0.47, 2, 0.07], [0.97, 0, 0.07, 1], [-0.97, 0, 0.07, 1]]) g.add(part("Plank", box(w, 0.36, d), plank, x, 0.18, z));
      break;
    }
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

// code-generated sculptable body (sims-body.js); falls back to the simple model if it isn't ready
const bodyLod = () => (quality === "high" ? "high" : quality === "low" ? "low" : "med");
const pendingSculpt = new Set();
function buildSimModel(sim) {
  if (!Body) return G.buildSim(sim);
  let deltas = null;
  if (sim.sculpt) { deltas = Body.cachedSculpt(sim.sculpt); if (!deltas && !pendingSculpt.has(sim.sculpt)) { const key = sim.sculpt; pendingSculpt.add(key); Body.loadSculpt(key).then(() => { pendingSculpt.delete(key); sculptLoaded(key); }).catch(() => pendingSculpt.delete(key)); } }
  const m = Body.buildBody(sim, { lod: bodyLod(), hi: quality === "high", deltas, tex: G.texture });
  m.userData.kind = "sim"; m.userData.simId = sim.id; m.userData.sim = { name: sim.name, skin: sim.skin, hair: sim.hair, hairStyle: sim.hairStyle, top: sim.top, bottom: sim.bottom, outfit: sim.outfit, height: sim.height, build: sim.build };
  return m;
}
function sculptLoaded(key) {
  if (!S) return;
  for (const sim of S.sims) if (sim.sculpt === key) { const rt = runtime.get(sim.id); if (rt) { setSimModel(rt, sim); if (sim.id === selectedSimId) selectSim(sim.id); } }
  for (const r of online.remotes.values()) if (r.sig && r.sig.includes(key.slice(0, 40))) r.sig = "";
}
function buildSimModelLegacy(sim) {
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
  if (root.userData.body) { root.scale.setScalar((sim.height || 1) * 0.97); Body.setMorph(root, "weight", Body.morphInfluencesFor(sim).weight || 0); return; }
  return G.applyBody(root, sim);
}
function applyBodyLegacy(root, sim) {
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
    const m = part("Floor_" + k, box(1, 0.04, 1), G.floorMat(S.floors[k]), c.x, 0.02, c.z); m.castShadow = false; floorGroup.add(m);
  }
  const hScale = wallsMode === "down" ? 0.12 : wallsMode === "cut" ? 0.4 : 1;
  for (const k in S.walls) {
    const w = S.walls[k]; const [o, xs, zs] = k.split(":"); const x = +xs, z = +zs;
    const g = new THREE.Group(); g.name = "Wall_" + k; g.userData.edge = k;
    const cx = o === "h" ? x + 0.5 - N / 2 : x - N / 2, cz = o === "h" ? z - N / 2 : z + 0.5 - N / 2;
    g.position.set(cx, 0, cz); if (o === "v") g.rotation.y = Math.PI / 2;
    const m = G.wallMat(w.c || WALL_COLORS[0], w.p); const H = WALL_H * hScale;
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
    if (Hifi) Hifi.wallDetail(g, w, H, WALL_T, quality);
    if (w.t === "door" && H > 2.2) for (const sd of [-1, 1]) { const f = World.makeFixture("porch", 2.25, 2.3); f.position.set(0.66, 2.25, sd * (WALL_T / 2 + 0.1)); const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 8), World.LAMP_GLASS); lamp.name = "Porch_Lamp"; f.add(lamp); g.add(f); }
    wallGroup.add(g);
  }
  rebuildObjects();
}
function rebuildObjects() {
  disposeChildren(objGroup); objMeshes.clear();
  for (const o of S.objects) {
    const g = o.type.startsWith("custom:") ? customObject(o) : buildFurniture(o.type);
    placeMesh(g, o); g.userData.objId = o.id; g.traverse((c) => (c.userData.objId = o.id));
    const info = catInfo(o.type);
    if (info && info.toggle) g.traverse((l) => { if (l.name === "LampLight") l.visible = o.on !== false; });
    if (info && !info.flat) g.add(aoDecal(info.w, info.d));
    objGroup.add(g); objMeshes.set(o.id, g);
  }
  if (Hifi) { Hifi.enhance(objGroup, quality); Hifi.enhance(wallGroup, quality); Hifi.enhance(floorGroup, quality); }
}
// cheap ambient occlusion: a soft dark blob under each piece (never exported)
let aoTex = null;
function aoDecal(w, d) {
  if (!aoTex) { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"); const gr = x.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); aoTex = new THREE.CanvasTexture(c); }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.15, d * 1.15), new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.047; m.name = "AO"; m.userData.noExport = true; m.renderOrder = 1; return m;
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
function commandSim(sim, target, keepQueue) {
  const rt = runtime.get(sim.id); if (!rt) return;
  if (rt.driving) { setStatus(sim.name + " is driving."); return; }
  endTask(sim, rt); rt.legs = null; rt.after = null; if (!keepQueue) rt.queue = null;
  if (Life && Life.isFishing && Life.isFishing(sim)) Life.cancelFishing();
  if (target.here) { startJob(sim, rt, target.job); return; }
  if (target.world) { const w = target.world; goWorld(sim, { point: w }, () => { if (w.y != null) rt.holder.position.y = w.y; if (w.face) face(rt, w.face); if (target.job) startJob(sim, rt, target.job); }); return; }
  const home = gridAt(0, 0);
  let obj = null, goals;
  if (target.objId) { obj = S.objects.find((o) => o.id === target.objId); if (!obj) return; const ap = approachTiles(obj); goals = ap.filter((t) => t.front).concat(ap.filter((t) => !t.front)).map((t) => t.x + "," + t.z); }
  else if (target.tile) goals = [target.tile[0] + "," + target.tile[1]];
  else goals = [target.x + "," + target.z];
  const after = () => {
    if (obj && target.job) { const g = objMeshes.get(obj.id); if (g) face(rt, g.position); startJob(sim, rt, target.job); }
    else if (obj) { rt.task = { objId: obj.id, t: 0, over: target.over, onDone: target.onDone }; startUse(sim, rt); }
    else if (target.job) startJob(sim, rt, target.job);
    else thought(sim, "Idle");
  };
  if (rt.away) { if (!goWorld(sim, { L: home, goals }, after)) return; thought(sim, obj ? "→ " + (catInfo(obj.type)?.label || "object") : "Walking"); return; }
  const occ = occupancy(); const [sx, sz] = simTile(sim); occ.delete(sx + "," + sz);
  const { dist, prev } = bfs(sx, sz, occ); dist.set(sx + "," + sz, 0);
  let best = null;
  if (obj) for (const t of approachTiles(obj)) { const k = t.x + "," + t.z; if (!dist.has(k)) continue; const score = dist.get(k) - (t.front ? 3 : 0); if (!best || score < best.score) best = { k, score }; }
  else if (dist.has(goals[0])) best = { k: goals[0] };
  if (!best) { setStatus(sim.name + " can't reach " + (obj ? "the " + (catInfo(obj.type)?.label || "object") : "there")); thought(sim, "Can't get there!"); return; }
  rt.path = pathTo(prev, sx + "," + sz, best.k) || []; rt.task = null; rt.after = after; rt.pose = "stand";
  thought(sim, obj ? "→ " + (catInfo(obj.type)?.label || "object") : "Walking");
  if (!rt.path.length) { rt.after = null; after(); }
}
function endTask(sim, rt) {
  if (rt.task && rt.task.using) { const p = tileCenter(sim.x, sim.z); rt.holder.position.copy(p); rt.holder.rotation.x = 0; }
  if (rt.job) finishJob(sim, rt, true);
  rt.task = null; rt.pose = "stand"; rt.path = [];
}
function thought(sim, t) { const rt = runtime.get(sim.id); if (rt) rt.thought = t; if (sim.id === selectedSimId) { const el = $("sims-thought"); if (el) el.textContent = sim.name + ": " + t; } }
function startUse(sim, rt) {
  const o = S.objects.find((x) => x.id === rt.task.objId); if (!o) { rt.task = null; return; }
  const c = Object.assign({ dur: 5, use: { fun: 1 }, pose: "stand" }, catInfo(o.type) || {}, rt.task.over || {});
  rt.task.using = true; rt.task.left = c.dur; rt.task.c = c;
  const g = objMeshes.get(o.id);
  const ctr = g ? g.position.clone() : tileCenter(o.x, o.z);
  const [fx, fz] = FRONT[o.rot];
  if (c.toggle && !(rt.task.over && rt.task.over.use)) { o.on = o.on === false; if (g) g.traverse((l) => { if (l.name === "LampLight") l.visible = o.on !== false; }); save(); }
  if (c.pose === "sit") { rt.holder.position.set(ctr.x + fx * 0.05, 0, ctr.z + fz * 0.05); rt.holder.rotation.y = Math.atan2(fx, fz); rt.pose = "sit"; }
  else if (c.pose === "lie") { rt.holder.position.set(ctr.x, 0.55, ctr.z); rt.holder.rotation.y = Math.atan2(fx, fz) + Math.PI; rt.pose = "lie"; }
  else if (c.pose === "inside") { rt.holder.position.set(ctr.x, 0.08, ctr.z); rt.holder.rotation.y = Math.atan2(fx, fz); rt.pose = "shower"; }
  else { const p = rt.holder.position; rt.holder.rotation.y = Math.atan2(ctr.x - p.x, ctr.z - p.z); rt.pose = c.pose === "paint" || o.type === "easel" ? "paint" : "stand"; }
  thought(sim, "Using " + (c.label || "object"));
}
function stepSims(dtReal) {
  const gameMin = dtReal * speed; // 1 real second = 1 game minute at 1x
  stepCar(dtReal);
  for (const sim of S.sims) { const rt = runtime.get(sim.id); if (rt && rt.legs && rt.legs.length && speed === 0) stepLegs(sim, rt, dtReal); }
  if (speed === 0) { animateSims(0); return; }
  S.minutes += gameMin;
  for (const sim of S.sims) {
    const rt = runtime.get(sim.id); if (!rt) continue;
    for (const n of NEEDS) sim.needs[n] = Math.max(0, sim.needs[n] - (DECAY[n] / 60) * gameMin);
    if (rt.driving || rt.wasd || (Life.isFishing && Life.isFishing(sim))) continue;
    if (rt.legs && rt.legs.length) stepLegs(sim, rt, dtReal);
    else if (rt.path.length) {
      const [tx, tz] = rt.path[0]; const target = tileCenter(tx, tz); const p = rt.holder.position;
      const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz);
      const step = 1.8 * dtReal * speed;
      rt.holder.rotation.y = Math.atan2(dx, dz);
      if (d <= step) { p.x = target.x; p.z = target.z; sim.x = tx; sim.z = tz; rt.path.shift(); }
      else { p.x += dx / d * step; p.z += dz / d * step; }
      rt.pose = "walk";
      if (!rt.path.length) { rt.pose = "stand"; const f = rt.after; rt.after = null; if (f) f(); else if (rt.task) startUse(sim, rt); else thought(sim, "Idle"); }
    } else if (rt.job) {
      const j = rt.job; if (j.use) for (const n in j.use) sim.needs[n] = Math.min(100, Math.max(0, sim.needs[n] + j.use[n] * gameMin));
      j.left -= gameMin; if (j.left <= 0) finishJob(sim, rt);
    } else if (rt.task && rt.task.using) {
      const c = rt.task.c; if (!c || !S.objects.find((x) => x.id === rt.task.objId)) { endTask(sim, rt); continue; }
      for (const n in c.use) sim.needs[n] = Math.min(100, Math.max(0, sim.needs[n] + c.use[n] * gameMin));
      rt.task.left -= gameMin;
      const full = !(rt.task.over && rt.task.over.dur) && Object.keys(c.use).every((n) => c.use[n] <= 0 || sim.needs[n] >= 99.5);
      if (rt.task.left <= 0 || full) { const done = rt.task.onDone; endTask(sim, rt); thought(sim, "Done with " + c.label); if (done) try { done(sim, rt); } catch (e) { console.error(e); } }
    } else if (rt.queue && rt.queue.length) { const f = rt.queue.shift(); try { f(sim, rt); } catch (e) { console.error(e); } }
    else if (!rt.away && $("sims-freewill") && $("sims-freewill").checked) {
      rt.idle = (rt.idle || 0) + gameMin;
      if (rt.idle > 4) { rt.idle = 0; autonomy(sim); }
    }
  }
  animateSims(dtReal * speed);
}
function autonomy(sim) {
  let worst = null; for (const n of NEEDS) if (sim.needs[n] < 45 && (!worst || sim.needs[n] < sim.needs[worst])) worst = n;
  if (!worst) return;
  const cands = S.objects.filter((o) => catInfo(o.type) && (catInfo(o.type).use[worst] || 0) > 0);
  cands.sort((a, b) => catInfo(b.type).use[worst] - catInfo(a.type).use[worst] || (Math.abs(a.x - sim.x) + Math.abs(a.z - sim.z)) - (Math.abs(b.x - sim.x) + Math.abs(b.z - sim.z)));
  for (const o of cands.slice(0, 3)) { commandSim(sim, { objId: o.id }); const r = runtime.get(sim.id); if (r.task || r.after || r.legs) return; }
}
function animateSims(dt) {
  for (const sim of S.sims) animateRt(runtime.get(sim.id), dt);
}
function animateRt(rt, dt) {
  if (rt && rt.model && rt.model.userData.body) {
    const m = rt.model, sim = rt.holder.userData.simId ? getSim(rt.holder.userData.simId) : null, cas = mode === "cas" && sim && sim.id === selectedSimId;
    const pose = cas && sculpt.on ? "rest" : { stand: "idle", walk: "walk", sit: "sit", lie: "lie", paint: "paint", shower: "shower" }[rt.pose] || "idle";
    const look = cas ? camera.position : null;
    const mouth = cas && sculpt.mouth ? 1 : { o: 0.22, grin: 0.1 }[sim ? sim.mouth : ""] ?? 0;
    m.rotation.x = 0; m.position.set(0, 0.04, 0); // stand on floor boards (top at 0.04)
    if (pose === "lie") { m.rotation.x = -Math.PI / 2; m.position.set(0, 0.1, -0.85); }
    Body.animate(m, pose, dt, reduceMotion, { lookAt: look, mouth, talk: !!(rt.say && rt.say.until > performance.now()), snap: cas && sculpt.on });
    return;
  }
  {
    if (!rt || !rt.model) return;
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


// ======================= OPEN WORLD: walk anywhere, drive, jobs, queues =======================
const HALF = N / 2, CHW = 36;
function gridAt(i, j) {
  if (i === 0 && j === 0) return { walls: S.walls, objects: S.objects, home: true, i, j, gate: homeGate() };
  const P = world && !online.visiting ? world.lotPlan(i, j) : world && world.lotPlan(i, j);
  if (!P) return null; return { walls: P.walls, objects: P.objects, i, j, gate: P.gate, plan: P };
}
function homeGate() { const occ = occupancy(); for (let k = 0; k < N; k++) { const x = 12 + (k % 2 ? -1 : 1) * Math.ceil(k / 2); if (x >= 0 && x < N && !occ.has(x + "," + (N - 1))) return { x, z: N - 1 }; } return { x: 12, z: N - 1 }; }
const tileWorld = (L, x, z) => ({ x: L.i * CHW + x + 0.5 - HALF, z: L.j * CHW + z + 0.5 - HALF });
function locate(p) {
  const i = Math.round(p.x / CHW), j = Math.round(p.z / CHW), lx = p.x - i * CHW, lz = p.z - j * CHW;
  if (Math.abs(lx) < HALF && Math.abs(lz) < HALF) { const L = gridAt(i, j); if (L) return { L, tile: [Math.min(N - 1, Math.floor(lx + HALF)), Math.min(N - 1, Math.floor(lz + HALF))] }; }
  return { point: { x: p.x, z: p.z } };
}
function gridPath(L, from, goals) {
  const occ = occupancy(null, L); occ.delete(from[0] + "," + from[1]);
  const { dist, prev } = bfs(from[0], from[1], occ, L); dist.set(from[0] + "," + from[1], 0);
  let best = null; for (const g of goals) if (dist.has(g) && (best === null || dist.get(g) < dist.get(best))) best = g;
  if (best === null) return null;
  return (pathTo(prev, from[0] + "," + from[1], best) || []).map(([x, z]) => tileWorld(L, x, z));
}
function planLegs(fromP, dest) {
  const a = locate(fromP), legs = []; let cur = { x: fromP.x, z: fromP.z };
  if (a.L && dest.L && a.L.i === dest.L.i && a.L.j === dest.L.j) return gridPath(a.L, a.tile, dest.goals);
  if (a.L) { const g = a.L.gate, p = gridPath(a.L, a.tile, [g.x + "," + g.z]); if (!p) return null; legs.push(...p); const gw = tileWorld(a.L, g.x, g.z); cur = { x: gw.x, z: a.L.j * CHW + HALF + 0.7 }; legs.push(cur); }
  let end, tail = [];
  if (dest.L) { const g = dest.L.gate, gw = tileWorld(dest.L, g.x, g.z); end = { x: gw.x, z: dest.L.j * CHW + HALF + 0.7 }; const p = gridPath(dest.L, [g.x, g.z], dest.goals); if (!p) return null; tail = [gw, ...p]; }
  else end = dest.point;
  legs.push(...Life.route(cur, end), ...tail);
  const out = []; for (const p of legs) { const q = out[out.length - 1]; if (!q || Math.hypot(q.x - p.x, q.z - p.z) > 0.05) out.push({ x: p.x, z: p.z }); }
  return out;
}
function goWorld(sim, dest, after) {
  const rt = runtime.get(sim.id); if (!rt) return false;
  if (rt.driving) { setStatus(sim.name + " is driving."); return false; }
  const legs = planLegs(rt.holder.position, dest);
  if (!legs) { setStatus(sim.name + " can't find a way there."); thought(sim, "Can't get there!"); return false; }
  rt.path = []; rt.legs = legs; rt.after = after || null; rt.pose = "walk"; rt.holder.position.y = 0;
  if (legs.length > 3) follow = true;
  thought(sim, "Walking"); return true;
}
const ROADZ = (v) => { const l = ((v % CHW) + CHW) % CHW; const d = Math.min(l, CHW - l); return d > 18 - 3.0; }; // within road band (|local| > 15)
function stepLegs(sim, rt, dtReal) {
  const t = rt.legs[0], p = rt.holder.position, dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
  const step = 2.0 * dtReal * Math.max(1, Math.min(speed, 4));
  const nx = p.x + (d ? dx / d : 0) * Math.min(d, step + 0.6), nz = p.z + (d ? dz / d : 0) * Math.min(d, step + 0.6);
  const onRoad = ROADZ(p.x) || ROADZ(p.z), intoRoad = ROADZ(nx) || ROADZ(nz);
  if (intoRoad && !onRoad && world && world.carNear(nx, nz, 5.5)) { rt.pose = "stand"; if (rt.thought !== "Waiting to cross…") thought(sim, "Waiting to cross…"); return; }
  if (d > 0.001) rt.holder.rotation.y = Math.atan2(dx, dz);
  if (d <= step) { p.x = t.x; p.z = t.z; rt.legs.shift(); } else { p.x += dx / d * step; p.z += dz / d * step; }
  rt.pose = "walk"; syncTile(sim, rt);
  if (!rt.legs.length) { rt.legs = null; rt.pose = "stand"; const f = rt.after; rt.after = null; if (f) f(); else thought(sim, "Idle"); }
}
// keep sim.x/z (home tile) and rt.away in step with the holder's world position
function syncTile(sim, rt) {
  const p = rt.holder.position, inHome = Math.abs(p.x) < HALF && Math.abs(p.z) < HALF;
  rt.away = !inHome; if (inHome) { const [x, z] = tileAt(p); if (inLot(x, z)) { sim.x = x; sim.z = z; } }
}
function face(rt, q) { const p = rt.holder.position; rt.holder.rotation.y = Math.atan2(q.x - p.x, q.z - p.z); }
// ---- jobs: timed actions with an optional prop and callback ----
function startJob(sim, rt, job) {
  if (!job) return; rt.job = Object.assign({ left: job.dur || 5 }, job);
  if (job.face) face(rt, job.face);
  rt.pose = job.pose === "paint" ? "paint" : job.pose === "sit" ? "sit" : job.pose === "lie" ? "lie" : job.pose === "inside" ? "shower" : "stand";
  if (job.prop === "can") { const can = part("WateringCan", box(0.22, 0.2, 0.14), mat("#3a8a5a", "Can"), 0.25, 0.9, 0.25); can.userData.noExport = true; rt.holder.add(can); rt.job.propObj = can; }
  thought(sim, job.label || "Busy");
}
function finishJob(sim, rt, cancelled) {
  const j = rt.job; if (!j) return; rt.job = null;
  if (j.propObj) rt.holder.remove(j.propObj);
  if (j.ret) { rt.holder.position.copy(j.ret); rt.holder.rotation.x = 0; }
  rt.pose = "stand"; if (!cancelled && j.onDone) try { j.onDone(sim, rt); } catch (e) { console.error(e); }
  if (!cancelled) thought(sim, "Done: " + (j.label || "task"));
}
// use a piece of furniture anywhere (home or a neighbor's house): walk there, take the pose, fill needs
function useObjAt(sim, L, o, over, onDone) {
  const rt = runtime.get(sim.id); if (!rt) return;
  const keys = approachTiles(o, L).map((t) => t.x + "," + t.z);
  const go = () => {
    const c = Object.assign({ dur: 6, use: { fun: 1 }, pose: "stand" }, catInfo(o.type) || {}, over || {});
    const { W, D } = footprint(o), base = tileWorld(L, 0, 0), cx = base.x - 0.5 + o.x + W / 2, cz = base.z - 0.5 + o.z + D / 2, [fx, fz] = FRONT[o.rot];
    const ret = rt.holder.position.clone(), job = { label: c.label || "Using", dur: c.dur, use: c.use, pose: c.pose, onDone, ret };
    if (c.pose === "sit") { rt.holder.position.set(cx + fx * 0.05, 0, cz + fz * 0.05); rt.holder.rotation.y = Math.atan2(fx, fz); }
    else if (c.pose === "lie") { rt.holder.position.set(cx, 0.55, cz); rt.holder.rotation.y = Math.atan2(fx, fz) + Math.PI; }
    else if (c.pose === "inside") { rt.holder.position.set(cx, 0.08, cz); rt.holder.rotation.y = Math.atan2(fx, fz); }
    else { face(rt, { x: cx, z: cz }); job.ret = null; }
    startJob(sim, rt, job);
  };
  endTask(sim, rt);
  if (!goWorld(sim, { L, goals: keys }, go)) return;
}
// ---- driving: your car follows the road lanes, yields to traffic, parks, and you get out ----
const myCar = { obj: null, state: "parked", pts: null, v: 0, wait: 0, home: null, away: false };
function homeParking() { const d = S.drive; return d ? { x: d.x0 + 1.5 - HALF, z: 9.5, ry: -Math.PI / 2 } : { x: -7.5, z: 14.3, ry: 0 }; }
function ensureCar() {
  if (!world || myCar.obj) return; const o = world.carModel("sedan", "#c9a227"); o.name = "MyCar"; o.userData.noExport = true; o.traverse((c) => (c.userData.myCar = true));
  const hp = homeParking(); o.position.set(hp.x, 0, hp.z); o.rotation.y = hp.ry; scene.add(o); myCar.obj = o;
}
function parkingFor(p) {
  const i = Math.round(p.x / CHW), j = Math.round(p.z / CHW);
  if (i === 0 && j === 0) { const hp = homeParking(); return { x: hp.x, z: hp.z, ry: hp.ry, i, j }; }
  const P = world.lotPlan(i, j); if (P) return { x: i * CHW + P.drive.x0 + 1.5 - HALF, z: j * CHW + 9, ry: -Math.PI / 2, i, j };
  const x = Math.max(i * CHW - 10, Math.min(i * CHW + 10, p.x)); return { x, z: j * CHW + 14.3, ry: 0, i, j };
}
const roadLine = (v) => Math.round((v - 18) / CHW) * CHW + 18;
function drivePoints(from, park) {
  const sgn = (v) => (v >= 0 ? 1 : -1);
  const rz0 = roadLine(from.z + 2), rx = roadLine(park.x), rzD = park.j * CHW + 18;
  const dx1 = sgn(rx - from.x), lz1 = rz0 + dx1 * 1.5, dzv = sgn(rzD - rz0), lx = rx - dzv * 1.5;
  const dx2 = sgn(park.x - lx), lzD = rzD + dx2 * 1.5;
  const pts = [{ x: from.x, z: lz1 }, { x: lx, z: lz1 }, { x: lx, z: lzD }, { x: park.x, z: lzD }, { x: park.x, z: park.z }];
  const out = []; for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(q.x - p.x, q.z - p.z) > 0.3) out.push(p); } return out;
}
function driveTo(dest) {
  const sim = getSim(selectedSimId); if (!sim || online.visiting) { setStatus(online.visiting ? "Driving is for your own household." : "Select a sim first"); return; }
  ensureCar(); const rt = runtime.get(sim.id), car = myCar.obj; if (myCar.state === "driving") { setStatus("Already driving."); return; }
  const park = parkingFor(dest);
  const side = { x: car.position.x - Math.sin(car.rotation.y + Math.PI / 2) * 1.4, z: car.position.z - Math.cos(car.rotation.y + Math.PI / 2) * 1.4 };
  const board = () => {
    rt.holder.visible = false; rt.driving = true; thought(sim, "Driving"); follow = true;
    myCar.pts = drivePoints(car.position, park); myCar.state = "driving"; myCar.v = 0; myCar.dest = dest; myCar.park = park; myCar.sim = sim; setStatus(sim.name + " is driving…");
  };
  endTask(sim, rt); rt.queue = null;
  if (Math.hypot(rt.holder.position.x - side.x, rt.holder.position.z - side.z) < 2.5) board(); else goWorld(sim, { point: side }, board);
}
function stepCar(dt) {
  if (myCar.state !== "driving") return; const car = myCar.obj, t = myCar.pts[0]; if (!t) return;
  const p = car.position, dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz), last = myCar.pts.length === 1;
  const hx = Math.cos(car.rotation.y), hz = -Math.sin(car.rotation.y); // carModel faces +x at ry 0
  let want = Math.min(10, (last ? d : d + 6) * 1.2 + 1.5);
  const ahead = world.carNear(p.x + hx * 5.5, p.z + hz * 5.5, 3.2);
  if (ahead && myCar.wait < 4) { want = 0; myCar.wait += dt; } else if (!ahead) myCar.wait = 0;
  myCar.v += Math.max(-12 * dt, Math.min(4 * dt, want - myCar.v)); const step = Math.max(0, myCar.v) * dt * Math.max(1, Math.min(speed, 3));
  const yaw = Math.atan2(-dz, dx); let dy = ((yaw - car.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI; car.rotation.y += dy * Math.min(1, dt * 6);
  if (d <= step || d < 0.15) { p.x = t.x; p.z = t.z; myCar.pts.shift(); } else { p.x += dx / d * step; p.z += dz / d * step; }
  const rt = runtime.get(myCar.sim.id); if (rt) rt.holder.position.set(p.x, 0, p.z);
  if (!myCar.pts.length) {
    myCar.state = "parked"; car.rotation.y = myCar.park.ry; myCar.away = !(myCar.park.i === 0 && myCar.park.j === 0);
    const sim = myCar.sim, r2 = runtime.get(sim.id); r2.driving = false; r2.holder.visible = true;
    r2.holder.position.set(p.x - Math.sin(car.rotation.y + Math.PI / 2) * 1.4, 0, p.z - Math.cos(car.rotation.y + Math.PI / 2) * 1.4); syncTile(sim, r2);
    thought(sim, "Arrived"); setStatus(sim.name + " parked. Walking to the door…");
    const dest = myCar.dest; const loc = locate(dest);
    if (loc.L && loc.L.plan) { const g = loc.L.gate; walkToPoint(sim, tileWorld(loc.L, g.x, g.z - 3 > 0 ? g.x : g.x, Math.max(0, loc.L.plan.door.z))); }
    else if (!(myCar.park.i === 0 && myCar.park.j === 0)) walkToPoint(sim, dest);
  }
}
function walkToPoint(sim, p) {
  const loc = locate(p);
  if (loc.L) return goWorld(sim, { L: loc.L, goals: [loc.tile[0] + "," + loc.tile[1]] });
  const z = world ? world.zoneAt(p.x, p.z) : "land"; if (z === "water") { setStatus("That's water — right-click it to fish."); return false; }
  return goWorld(sim, { point: p });
}
// ---- camera follow, keyboard (arrows = camera, WASD = walk, C = snap/follow, Shift+C = pan mode, ? = help) ----
let follow = false, camPan = false; const keys = new Set();
function followTick(dt) {
  const sim = getSim(selectedSimId), rt = sim && runtime.get(sim.id); if (!rt) return;
  const p0 = myCar.state === "driving" ? myCar.obj.position : rt.holder.position, w = world ? world.warpXZ(p0.x, p0.z) : [p0.x, p0.z], p = { x: w[0], z: w[1] };
  if (!follow) return; const t = controls.target, k = reduceMotion ? 1 : Math.min(1, dt * 4), dx = (p.x - t.x) * k, dz = (p.z - t.z) * k;
  t.x += dx; t.z += dz; camera.position.x += dx; camera.position.z += dz;
}
function keyActive() { const a = document.activeElement; return visible && ready && !(a && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable)); }
function cameraKeys(dt) {
  const t = controls.target, off = camera.position.clone().sub(t); let moved = false;
  const L = keys.has("ArrowLeft"), R = keys.has("ArrowRight"), U = keys.has("ArrowUp"), D = keys.has("ArrowDown"); if (!(L || R || U || D)) return;
  if (camPan) {
    const fwd = new THREE.Vector3(-off.x, 0, -off.z).normalize(), right = new THREE.Vector3(-fwd.z, 0, fwd.x), v = 14 * dt * Math.max(0.6, off.length() / 30), d = new THREE.Vector3();
    if (U) d.add(fwd); if (D) d.sub(fwd); if (R) d.add(right); if (L) d.sub(right); d.multiplyScalar(v); t.add(d); camera.position.add(d); follow = false; moved = true;
  } else {
    const sph = new THREE.Spherical().setFromVector3(off);
    if (L) sph.theta -= 1.6 * dt; if (R) sph.theta += 1.6 * dt;
    if (U) sph.phi = Math.max(0.15, sph.phi - 1.0 * dt); if (D) sph.phi = Math.min(controls.maxPolarAngle, sph.phi + 1.0 * dt);
    off.setFromSpherical(sph); camera.position.copy(t).add(off); moved = true;
  }
  if (moved) camera.lookAt(t);
}
function canWalk(from, to) {
  const a = locate(from), b = locate(to);
  if (a.L && b.L && a.L.i === b.L.i && a.L.j === b.L.j) {
    if (a.tile[0] === b.tile[0] && a.tile[1] === b.tile[1]) return true;
    const occ = occupancy(null, a.L); if (occ.has(b.tile[0] + "," + b.tile[1])) return false;
    if (Math.abs(a.tile[0] - b.tile[0]) + Math.abs(a.tile[1] - b.tile[1]) !== 1) return false;
    return !blocks(edgeBetween(a.tile[0], a.tile[1], b.tile[0], b.tile[1]), a.L);
  }
  if (b.L) { const occ = occupancy(null, b.L); if (occ.has(b.tile[0] + "," + b.tile[1])) return false; }
  const z = world ? world.zoneAt(to.x, to.z) : "lot"; return z !== "water" && z !== "unknown" && z !== "building";
}
function wasdTick(dt) {
  const f = (keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0), r = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
  const sim = getSim(selectedSimId), rt = sim && runtime.get(sim.id); if (!rt || rt.driving) return;
  if (!f && !r) { if (rt.wasd) { rt.wasd = false; rt.pose = "stand"; } return; }
  if (!rt.wasd) { endTask(sim, rt); rt.queue = null; rt.legs = null; rt.after = null; rt.wasd = true; if (mode !== "live") setMode("live"); }
  const off = camera.position.clone().sub(controls.target), fwd = new THREE.Vector3(-off.x, 0, -off.z).normalize(), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const dir = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).normalize(), step = 2.6 * dt, p = rt.holder.position;
  rt.holder.rotation.y = Math.atan2(dir.x, dir.z); rt.pose = "walk";
  for (const [mx, mz] of [[dir.x * step, dir.z * step], [dir.x * step, 0], [0, dir.z * step]]) { const to = { x: p.x + mx, z: p.z + mz }; if ((mx || mz) && canWalk(p, to)) { p.x = to.x; p.z = to.z; break; } }
  p.y = 0; syncTile(sim, rt);
}
function setCamPan(on) { camPan = on; const el = $("sims-cammode"); if (el) el.textContent = on ? "Arrows: pan" : "Arrows: orbit"; setStatus(on ? "Arrow keys now pan the camera (Shift+C to switch back)." : "Arrow keys orbit the camera (Shift+C to pan)."); }
function toggleHelp(force) {
  let el = $("sims-keyhelp");
  if (!el) { el = document.createElement("div"); el.id = "sims-keyhelp"; el.className = "sims-keyhelp"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Keyboard controls"); el.hidden = true;
    el.innerHTML = "<b>Controls</b><ul><li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk the selected sim (camera-relative)</li><li><kbd>←</kbd><kbd>→</kbd> rotate · <kbd>↑</kbd><kbd>↓</kbd> tilt the camera</li><li><kbd>Shift</kbd>+<kbd>C</kbd> arrows pan instead of orbit</li><li><kbd>C</kbd> snap the camera to your sim and follow</li><li>Right-click / long-press anything for actions</li><li><kbd>Esc</kbd> close menus · <kbd>?</kbd> this help</li></ul>";
    $("sims-stage").appendChild(el); }
  el.hidden = force != null ? !force : !el.hidden;
}
function bindKeys() {
  document.addEventListener("keydown", (e) => {
    if (!keyActive() || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k.startsWith("Arrow")) { e.preventDefault(); keys.add(k); return; }
    if ("wasd".includes(k) && k.length === 1) { keys.add(k); e.preventDefault(); return; }
    if (k === "c" && e.shiftKey) { e.preventDefault(); setCamPan(!camPan); return; }
    if (k === "c") { e.preventDefault(); const sim = getSim(selectedSimId), rt = sim && runtime.get(sim.id); if (rt) { follow = true; const p = rt.holder.position, t = controls.target, d = new THREE.Vector3(p.x - t.x, 0, p.z - t.z); t.add(d); camera.position.add(d); setStatus("Camera following " + sim.name + " (pan or press C again to re-snap)."); } return; }
    if (k === "?" || (k === "/" && e.shiftKey)) { e.preventDefault(); toggleHelp(); }
  });
  document.addEventListener("keyup", (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys.delete(k); });
  window.addEventListener("blur", () => keys.clear());
  controls.addEventListener("start", () => { if (pointers.size && drag && drag.button !== 0) follow = false; });
  const ov = document.querySelector("#sims-stage .sims-overlay");
  if (ov && !$("sims-cammode")) { const b = document.createElement("button"); b.type = "button"; b.id = "sims-cammode"; b.className = "sims-cammode"; b.textContent = "Arrows: orbit"; b.title = "Shift+C"; b.onclick = () => setCamPan(!camPan); ov.appendChild(b);
    const h = document.createElement("button"); h.type = "button"; h.className = "sims-cammode"; h.textContent = "?"; h.setAttribute("aria-label", "Keyboard controls"); h.onclick = () => toggleHelp(); ov.appendChild(h); }
}
// ---- right-click / long-press: find what's under the pointer and open its action menu ----
function upTo(o, set) { while (o) { if (set.has(o)) return o; o = o.parent; } return null; }
function objAtTile(L, x, z) { for (const o of L.objects) { const { W, D } = footprint(o); if (x >= o.x && x < o.x + W && z >= o.z && z < o.z + D) return o; } return null; }
function targetAt(ev) {
  raycaster.setFromCamera(ndc(ev), camera); const ray = raycaster;
  const first = (groups) => { const h = ray.intersectObjects(groups.filter(Boolean), true); return h.length ? h[0] : null; };
  const own = !online.visiting;
  let h = remoteGroup && first([remoteGroup]); if (h) { let o = h.object; while (o && !o.userData.remoteSid) o = o.parent; if (o) { const p = online.remotes.get(o.userData.remoteSid); return { kind: "remote", sid: o.userData.remoteSid, name: (p && p.name) || "Neighbor" }; } }
  h = first([simGroup]); if (h) { let o = h.object; while (o && !o.userData.simId) o = o.parent; const sim = o && getSim(o.userData.simId); if (sim) return { kind: "sim", sim }; }
  const stall = scene.getObjectByName("MarketStall"); h = stall && first([stall]); if (h) return { kind: "stall", point: h.point };
  if (myCar.obj) { h = first([myCar.obj]); if (h) return { kind: "mycar", parkedAway: myCar.away, point: h.point }; }
  h = first([objGroup]); if (h) { let o = h.object; while (o && !o.userData.objId) o = o.parent; const obj = o && S.objects.find((q) => q.id === o.userData.objId);
    if (obj) { const t = { kind: "furniture", obj, L: gridAt(0, 0) }; if (obj.type === "gardenbed") { const { W, D } = footprint(obj); t.bedTiles = []; for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) t.bedTiles.push((obj.x + i) + "," + (obj.z + j)); } return t; } }
  h = first([wallGroup]); if (h && h.object.userData.edge && S.walls[h.object.userData.edge] && S.walls[h.object.userData.edge].t === "door") { const k = h.object.userData.edge; return { kind: "door", edge: k, own, point: { x: h.point.x, z: h.point.z } }; }
  if (world) {
    const ak = world.actorKinds ? world.actorKinds() : []; const set = new Map(ak.map((a) => [a[0], a]));
    h = first(ak.map((a) => a[0])); if (h) { const a = set.get(upTo(h.object, new Set(set.keys()))); if (a) return a[1] === "npc" ? { kind: "npc", name: a[2] || "Neighbor", point: h.point } : { kind: a[1], point: h.point }; }
    h = first(world.houseSigns || []); if (h) { let o = h.object; while (o && !o.userData.house) o = o.parent; if (o) return houseTarget(o.userData.house.i, o.userData.house.j, toGrid(h.point)); }
    const sh = world.signs.length && pick(ev, world.signs); const sid = sh && world.lotOfSign(sh); if (sid) return { kind: "house", sid, name: "Shared lot", beds: "?", baths: "?", point: { x: sh.getWorldPosition(new THREE.Vector3()).x, z: sh.getWorldPosition(new THREE.Vector3()).z } };
  }
  const plotP = groundPoint(ev);
  if (plotP && own) { const [x, z] = tileAt(plotP); if (inLot(x, z) && Life.plotTiles().has(x + "," + z) && !Life.plotTiles().get(x + "," + z).bed) return { kind: "plot", key: x + "," + z }; }
  if (world) { h = first(world.chunkMeshes()); if (h) { const p = toGrid(h.point), z = world.zoneAt(p.x, p.z);
      if (z === "water" || p.y < -0.9) return { kind: "water", point: { x: p.x, z: p.z } };
      const loc = locate(p); if (loc.L && !loc.L.home) { const o = objAtTile(loc.L, loc.tile[0], loc.tile[1]); const hs = loc.L.plan.house;
        if (o && catInfo(o.type)) return { kind: "furniture", obj: o, L: loc.L, remote: true, houseName: lotName(loc.L) };
        if (loc.tile[0] >= hs.x0 && loc.tile[0] < hs.x1 && loc.tile[1] >= hs.z0 && loc.tile[1] < hs.z1) return houseTarget(loc.L.i, loc.L.j, p); }
      const far = !(Math.abs(p.x) < HALF && Math.abs(p.z) < HALF);
      return { kind: "terrain", point: { x: p.x, z: p.z }, far, own: own && !far, tile: far ? null : tileAt(p) }; } }
  if (plotP) return { kind: "terrain", point: { x: plotP.x, z: plotP.z }, own, tile: tileAt(plotP), far: false };
  return null;
}
function lotName(L) { const P = world.lotPlan(L.i, L.j); return (P && P.name) || "a neighbor's house"; }
function houseTarget(i, j, p) {
  const P = world.lotPlan(i, j); if (!P) return { kind: "terrain", point: { x: p.x, z: p.z }, far: true };
  const L = gridAt(i, j), door = tileWorld(L, P.door.x, P.door.z);
  return { kind: "house", i, j, name: P.name || "House", beds: P.beds, baths: P.baths, door: { x: door.x, z: door.z }, point: { x: p.x, z: p.z } };
}
function openContext(ev) {
  if (!ready) return; const t = targetAt(ev); if (!t) return;
  if (t.kind !== "sim" && t.kind !== "remote" && mode !== "live") setMode("live");
  Life.openMenu(t, ev.clientX, ev.clientY);
}
// ---- the host object handed to sims-life.js ----
function buildLifeHost() {
  return {
    THREE, scene, lotGroup, world, World, G, runtime, $, reduceMotion,
    S: () => S, home: () => S, visiting: () => !!online.visiting, selected: () => getSim(selectedSimId), select: (id) => selectSim(id), speed: () => speed, clock: () => Life.clockState(S),
    save: () => save(), setStatus, setNet: (t) => { const el = $("sims-net"); if (el) el.textContent = t; }, thought, sayLocal: (id, t, ms) => sayLocal(id, t, ms),
    tileCenter, inLot, occupied: (x, z) => occupancy().has(x + "," + z), catInfo, footprint, buildSimModel,
    command: (sim, t) => commandSim(sim, t, true), queue: (sim, fns) => { const rt = runtime.get(sim.id); if (rt) { rt.queue = (rt.queue || []).concat(fns); } },
    api: (m, body, q) => api(m, body, q), mySid: () => mySid(), myName: () => (getSim(selectedSimId) || S.sims[0] || { name: "Neighbor" }).name, ownerKey: () => ownerKey(),
    peers: () => [...online.remotes.entries()].map(([sid, r]) => ({ sid, name: r.name || "Neighbor" })),
    carry: (id) => { setMode("buy"); const o = S.objects.find((q) => q.id === id); if (o) { carry = Object.assign({}, o); buyRot = o.rot; renderBuy(); showObjGhost(carry); setStatus("Carrying — tap a tile to drop it."); } },
    sell: (id) => { const o = S.objects.find((q) => q.id === id); if (!o) return; snapshot(); S.objects = S.objects.filter((q) => q.id !== id); const pr = (catInfo(o.type) || {}).price || 0; Life.life().coins = (Life.life().coins || 0) + Math.round(pr * 0.5); rebuildLot(); save(); setStatus("Sold for §" + Math.round(pr * 0.5)); },
    inspect: (text) => { setStatus(text); const sim = getSim(selectedSimId); if (sim) thought(sim, text.slice(0, 80)); },
    useObj: (t, over, onDone) => { const sim = getSim(selectedSimId); if (!sim) { setStatus("Select a sim first"); return; }
      if (t.remote || t.L && !t.L.home) useObjAt(sim, t.L, t.obj, over, onDone); else commandSim(sim, { objId: t.obj.id, over, onDone }); },
    social: (t, label, gain, line) => { const sim = getSim(selectedSimId); if (!sim) return; const rt = runtime.get(sim.id);
      const tgt = t.sim ? runtime.get(t.sim.id)?.holder.position : t.point || null; const done = () => { for (const n in gain) sim.needs[n] = Math.min(100, sim.needs[n] + gain[n]); sayLocal(sim.id, line, 4000); thought(sim, label + "!"); };
      if (t.kind === "remote") { setDmTarget(t.sid); done(); return; }
      if (tgt && Math.hypot(tgt.x - rt.holder.position.x, tgt.z - rt.holder.position.z) > 2.2) goWorld(sim, { point: { x: tgt.x + 1, z: tgt.z + 0.6 } }, () => { face(rt, tgt); startJob(sim, rt, { label, dur: 3, onDone: done }); });
      else { if (tgt) face(rt, tgt); startJob(sim, rt, { label, dur: 3, onDone: done }); } },
    fishAt: (point) => { const sim = getSim(selectedSimId); if (!sim) { setStatus("Select a sim first"); return; } const rt = runtime.get(sim.id);
      const w = point || rt.holder.position, spot = Life.fishingSpot({ x: w.x, z: w.z }, rt.holder.position); if (!spot) { setStatus("No fishing spot near there — right-click the water by a bank or dock."); return; }
      endTask(sim, rt); rt.queue = null; goWorld(sim, { point: { x: spot.x, z: spot.z } }, () => { rt.holder.position.y = spot.y || 0; face(rt, spot.face); Life.castLine(sim, spot); }); },
    walkTo: (p) => { const sim = getSim(selectedSimId); if (!sim) { setStatus("Select a sim first"); return; } const rt = runtime.get(sim.id); endTask(sim, rt); rt.queue = null; walkToPoint(sim, p); },
    driveTo: (p) => driveTo(p), driveHome: () => { const hp = homeParking(); driveTo({ x: hp.x, z: hp.z }); },
    pickDriveTarget: () => setStatus("Right-click a house, sign or spot on the map and choose “Drive here”."),
    visitSign: (sid) => { if (sid === mySid()) { setStatus("That's your own lot."); return; } enterVisit(sid); },
    invite: (sid) => { setDmTarget(sid); const i = $("sims-dm-input") || $("sims-chat-input"); if (i) { i.value = "Come visit my lot! Find me on the map."; i.focus(); } },
    dm: (sid) => setDmTarget(sid),
    knock: (t) => { const sim = getSim(selectedSimId); if (!sim) return; const rt = runtime.get(sim.id); goWorld(sim, { point: t.point }, () => { startJob(sim, rt, { label: "Knock knock", dur: 2, onDone: () => sayLocal(sim.id, "*knock knock*", 2500) }); }); },
    removeDoor: (k) => { if (!S.walls[k]) return; snapshot(); S.walls[k].t = "wall"; rebuildLot(); save(); },
    reroll: (sim) => { const r = G.randomSim(G.randSeed()); for (const k of ["name", "id", "x", "z", "needs"]) delete r[k]; Object.assign(sim, r); spawnSim(sim); save(); },
  };
}
// ---- real-clock sky ----
function dayCycle() {
  const c = Life.clockState(S);
  const el = c.sun.elev, er = el * Math.PI / 180, az = c.sun.az, tgt = controls.target;
  const dir = new THREE.Vector3(-Math.sin(az) * Math.cos(er), Math.max(0.12, Math.sin(er)), Math.cos(az) * Math.cos(er)).normalize();
  const trueSun = NightMod ? NightMod.dirFrom(el, az) : dir, moonI = NightMod ? NightMod.moonAt(Life.sunAt, c.date, c.hours) : null; c.moon = moonI;
  const day = Math.max(0, Math.min(1, (el + 4) / 16));
  if (moonI && el < -2) {
    // night: the key light becomes cool moonlight from the real moon position, scaled by its phase
    const md = NightMod.dirFrom(Math.max(moonI.elev, 12), moonI.az), full = 1 - Math.abs(moonI.age - 0.5) * 2, up = moonI.elev > -1 ? 1 : 0.25;
    sun.position.copy(tgt).addScaledVector(md, 40); sun.target.position.copy(tgt); sun.color.set("#9db4ff"); sun.intensity = (0.12 + 0.55 * full) * up;
    hemi.intensity = 0.24; hemi.color.set("#3c4c7c");
  } else {
    sun.position.copy(tgt).addScaledVector(dir, 40); sun.target.position.copy(tgt);
    sun.intensity = 0.2 + day * 2.1; sun.color.set(el < 0 ? "#8aa0d8" : el < 8 ? "#ffb070" : "#fff1d6");
    hemi.intensity = 0.32 + day * 0.6; hemi.color.set(day > 0.3 ? "#cfe6ff" : "#5a6a9a");
  }
  // fixtures switch on at dusk (sun < ~2 degrees) and off at dawn
  const nk = Math.max(0, Math.min(1, (2 - el) / 8)); World.setNight(nk);
  if (myCar.obj) World.setCarLights(myCar.obj, myCar.state === "driving" ? Math.max(nk, world.inTunnel(myCar.obj.position.x, myCar.obj.position.z) ? 1 : 0) : 0, myCar.state === "driving" && myCar.v < 1);
  if (night) night.update({ sunDir: trueSun, sunElev: el, moonInfo: moonI, camera, target: controls.target, sources: world.lightSources().concat(lotFixtures()), dt: lastDt });
  const sky = Life.skyColor(el); scene.background = sky; if (scene.fog) scene.fog.color.copy(sky); world.setSky(sky);
  World.WINDOW_GLOW.emissiveIntensity = 0.05 + nk * 1.6;
  renderer.toneMappingExposure = 0.9 + day * 0.2;
  if (Hifi && quality !== "low") Hifi.updateEnvironment(renderer, scene, dir, sky, day);
  else if (scene.environment) scene.environment = null;
  lastClock = c;
}
let lastClock = null, lifeHost = null;

// ---------------- three setup ----------------
async function start() {
  started = true;
  setStatus("Loading 3D…");
  [THREE, { OrbitControls }, { GLTFExporter }, { GLTFLoader }] = await Promise.all([
    import("three"), import("three/addons/controls/OrbitControls.js"), import("three/addons/exporters/GLTFExporter.js"), import("three/addons/loaders/GLTFLoader.js"),
  ]);
  [G, World, Life, Plan] = await Promise.all([import("./sims-gen.js?v=3"), import("./sims-world.js?v=7"), import("./sims-life.js?v=4"), import("./sims-plan.js?v=1")]);
  quality = pickQuality(); G.setQuality({ tex: QUALITY[quality].tex, aniso: 4 });
  try {
    [Body, Hifi, SkeletonUtils, NightMod] = await Promise.all([import("./sims-body.js?v=1"), import("./sims-hifi.js?v=1"), import("three/addons/utils/SkeletonUtils.js"), import("./sims-night.js?v=1")]);
    setStatus("Generating sculptable bodies…"); await new Promise((r) => setTimeout(r, 30)); Body.baseFor(bodyLod());
  } catch (e) { console.warn("hifi bodies unavailable", e); Body = null; Hifi = null; }
  const wrap = $("sims-stage");
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.id = "sims-canvas"; renderer.domElement.setAttribute("aria-label", "Sims lot");
  wrap.appendChild(renderer.domElement);
  scene = new THREE.Scene(); scene.background = new THREE.Color("#141210"); scene.fog = new THREE.Fog("#141210", 30, 60);
  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200); camera.position.set(14, 16, 18);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0); controls.enableDamping = !reduceMotion; controls.maxPolarAngle = Math.PI * 0.45; controls.minDistance = 5; controls.maxDistance = 80; controls.screenSpacePanning = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  hemi = new THREE.HemisphereLight("#cfe6ff", "#5a4a32", 0.8); scene.add(hemi);
  sun = new THREE.DirectionalLight("#fff1d6", 2.2); sun.castShadow = true; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 120 }); scene.add(sun, sun.target);
  if (NightMod) { night = NightMod.createNight(scene, renderer); night.setQuality(quality); }
  world = World.createWorld(scene, { radius: QUALITY[quality].radius, npcs: QUALITY[quality].npcs, grass: QUALITY[quality].grass, cars: QUALITY[quality].cars, boats: QUALITY[quality].boats, reduceMotion });
  applyQuality(quality);
  const grid = new THREE.GridHelper(N, N, "#c9a227", "#5a6a48"); grid.position.y = 0.045; grid.material.transparent = true; grid.material.opacity = 0.35; grid.name = "Grid";
  helperGroup = new THREE.Group(); helperGroup.add(grid); scene.add(helperGroup);
  lotGroup = new THREE.Group(); lotGroup.name = "Lot"; scene.add(lotGroup);
  floorGroup = new THREE.Group(); floorGroup.name = "Floors"; wallGroup = new THREE.Group(); wallGroup.name = "Walls";
  objGroup = new THREE.Group(); objGroup.name = "Furniture"; simGroup = new THREE.Group(); simGroup.name = "Sims";
  lotGroup.add(floorGroup, wallGroup, objGroup, simGroup);
  ghostGroup = new THREE.Group(); scene.add(ghostGroup);
  raycaster = new THREE.Raycaster(); clockObj = new THREE.Clock();

  S = loadSave(); if (S.fresh) S = starterFromPlan(S);
  Life.setPreview(() => previewDate());
  await restoreCustomGlbs();
  rebuildLot();
  for (const sim of S.sims) spawnSim(sim);
  selectSim(S.sims[0] ? S.sims[0].id : null);
  remoteGroup = new THREE.Group(); remoteGroup.name = "RemoteSims"; scene.add(remoteGroup);
  lifeHost = buildLifeHost(); Life.init(lifeHost); Life.mountPanel(); Life.ensureStall(); world.setObstacles(obstaclePoints); ensureCar(); bindKeys();
  bindUI(); bindOnline(); setMode("build"); resize();
  new ResizeObserver(resize).observe(wrap);
  ready = true;
  publishLot(true); consumeVisit();
  setStatus("Ready — everything runs in your browser, no credits.");
  refreshNeighborhood(); setInterval(() => { if (visible && ready) refreshNeighborhood(); }, 30000);
  loop();
}
function resize() {
  const wrap = $("sims-stage"); if (!renderer || !wrap) return;
  const w = wrap.clientWidth || 300, h = wrap.clientHeight || 300;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (Hifi) { Hifi.setupPost(renderer, scene, camera, quality, w, h); Hifi.resizePost(w, h); }
}
// ---------------- quality presets + day cycle ----------------
const QUALITY = {
  low: { label: "Low", ratio: 1, shadows: false, map: 512, tex: 128, radius: 1, npcs: 3, grass: 1200, cars: 6, boats: 1 },
  med: { label: "Med", ratio: 1.5, shadows: true, map: 1024, tex: 256, radius: 1, npcs: 6, grass: 4000, cars: 12, boats: 3 },
  high: { label: "High", ratio: 2, shadows: true, map: 2048, tex: 512, radius: 2, npcs: 12, grass: 9000, cars: 24, boats: 6 },
};
const QUALITY_KEY = "logan7in.sims.quality.v1";
let quality = "med", qualityPref = "auto", hemi = null, sun = null;
const isPhone = () => window.innerWidth <= 700 || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820);
function pickQuality() {
  try { qualityPref = localStorage.getItem(QUALITY_KEY) || "auto"; } catch (e) {}
  if (QUALITY[qualityPref]) return qualityPref;
  return isPhone() ? "low" : "med";
}
function applyQuality(q) {
  if (night) night.setQuality(q);
  quality = q; const Q = QUALITY[q];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.ratio));
  const had = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = Q.shadows; renderer.shadowMap.type = q === "low" ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  if (sun) { sun.shadow.radius = q === "high" ? 4 : 2; sun.shadow.blurSamples = q === "high" ? 16 : 8; }
  if (Body && S && lastBodyLod && lastBodyLod !== bodyLod()) { lastBodyLod = bodyLod(); for (const sim of S.sims) { const rt = runtime.get(sim.id); if (rt && !sim.glb) setSimModel(rt, sim); } if (selectedSimId) selectSim(selectedSimId); }
  lastBodyLod = bodyLod();
  if (Hifi && S) rebuildLot();
  if (sun) { sun.castShadow = Q.shadows; if (sun.shadow.mapSize.x !== Q.map) { sun.shadow.mapSize.set(Q.map, Q.map); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } } }
  if (had !== Q.shadows && scene) scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
  if (world) { world.setRadius(Q.radius); world.setNpcs(Q.npcs); world.setDetail({ grass: Q.grass, cars: Q.cars, boats: Q.boats }); }
  scene.fog = new THREE.Fog(scene.background || "#9ec9ea", 30, (Q.radius + 0.6) * 36);
  const sel = $("sims-quality"); if (sel) sel.value = qualityPref;
  resize();
}
let lastBodyLod = "";
const perf = { frames: 0, t: 0, fps: 0, low: 0, history: [] };
function perfTick(dt) {
  perf.frames++; perf.t += dt;
  if (perf.t < 1) return;
  perf.fps = perf.frames / perf.t; perf.frames = 0; perf.t = 0; perf.history.push(Math.round(perf.fps)); if (perf.history.length > 60) perf.history.shift();
  const el = $("sims-fps"); if (el) el.textContent = Math.round(perf.fps) + " fps · " + QUALITY[quality].label;
  // Auto: step down when the frame rate stays low for 4 seconds
  if (qualityPref === "auto" && document.visibilityState === "visible") {
    perf.low = perf.fps < 28 ? perf.low + 1 : 0;
    if (perf.low >= 4 && quality !== "low") { perf.low = 0; applyQuality(quality === "high" ? "med" : "low"); setStatus("Graphics lowered to " + QUALITY[quality].label + " to keep things smooth."); }
  }
}
// ---------------- neighborhood ----------------
async function refreshNeighborhood() {
  try { const d = await api("GET", null, { op: "list" }); if (d.ok && Array.isArray(d.lots)) world.setShared(d.lots, online.lotId); } catch (e) {}
}
let lastSave = 0, lastLifeTick = 0;
function focusPoint() { const sim = getSim(selectedSimId), rt = sim && runtime.get(sim.id); return rt ? rt.holder.position : controls.target; }
function clockTick() { const el = $("sims-clock"); if (el && lastClock) el.textContent = Life.clockLabel(lastClock); }
function obstaclePoints() { const out = []; for (const sim of S.sims) { const rt = runtime.get(sim.id); if (rt && !rt.driving) { const p = rt.holder.position; out.push({ x: p.x, z: p.z }); } } if (myCar.obj && myCar.state === "driving") out.push({ x: myCar.obj.position.x, z: myCar.obj.position.z }); return out; }
function loop() {
  rafId = 0; if (!visible || !ready) return;
  const dt = Math.min(0.1, clockObj.getDelta());
  try { frame(dt); } catch (e) { if (!loopErr) { loopErr = true; console.error(e); } }
  rafId = requestAnimationFrame(loop);
}
let loopErr = false;
function lotFixtures() { const out = []; if (lotGroup) lotGroup.traverse((o) => { if (o.userData.fixture) out.push({ obj: o, kind: o.userData.fixture.kind, on: World.NIGHT_K() }); }); return out; }
function frame(dt) { lastDt = dt; timeTick(dt);
  if (keyActive()) { cameraKeys(dt); if (mode === "live" || keys.size) wasdTick(dt); }
  if (mode === "live") stepSims(dt); else { animateSims(mode === "cas" ? dt : 0); stepCar(dt); }
  stepRemotes(dt); netTick(); followTick(dt);
  controls.update(); dayCycle(); world.setFocus(focusPoint(), camera.position); world.update(controls.target, dt); thumbTick();
  Life.farmTick(); if (performance.now() - lastLifeTick > 1000) { lastLifeTick = performance.now(); Life.pollTrades(); clockTick(); }
  const bent = warpActors(); // the neighborhood's roads are bent; draw moving sims/cars at their bent spot
  if (Hifi) Hifi.render(renderer, scene, camera); else renderer.render(scene, camera);
  for (const [o, p, q] of bent) { o.position.copy(p); o.quaternion.copy(q); }
  updateBubbles(); perfTick(dt);
  if (mode === "live" && !online.visiting && performance.now() - lastSave > 5000) { lastSave = performance.now(); save(); renderNeeds(); }
  else if (mode === "live") renderNeedsLight();
}

// ---------------- picking ----------------
function ndc(ev) { const r = renderer.domElement.getBoundingClientRect(); return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); }
// winding roads: game logic lives on the straight grid, the world is drawn bent (see World.warpXZ)
function toGrid(p) { if (!p || !world) return p; const [x, z] = world.unwarpXZ(p.x, p.z); return new THREE.Vector3(x, p.y, z); }
function warpActors() {
  const out = []; if (!world) return out;
  const list = [...simGroup.children, ...(remoteGroup ? remoteGroup.children : [])]; if (myCar.obj) list.push(myCar.obj);
  for (const o of list) { const x = o.position.x, z = o.position.z; if (Math.abs(x) < 30 && Math.abs(z) < 30) continue; out.push([o, o.position.clone(), o.quaternion.clone()]); World.warpObject(o); o.updateMatrixWorld(true); }
  return out;
}
function groundPoint(ev) {
  raycaster.setFromCamera(ndc(ev), camera);
  const p = new THREE.Vector3(); return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? toGrid(p) : null;
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
let rdown = null, lpTimer = 0, lpFired = false;
function onDown(ev) {
  pointers.add(ev.pointerId); clearTimeout(lpTimer); lpFired = false;
  if (pointers.size > 1) { drag = null; clearGhost(); return; }
  if (ev.button === 2) { rdown = { x: ev.clientX, y: ev.clientY }; return; }
  if (ev.button !== 0) return;
  if (ev.pointerType !== "mouse") { const cx = ev.clientX, cy = ev.clientY; lpTimer = setTimeout(() => { if (pointers.size === 1 && drag && !drag.moved && !drag.kind) { lpFired = true; drag = null; openContext({ clientX: cx, clientY: cy }); } }, 550); }
  drag = { x: ev.clientX, y: ev.clientY, moved: false };
  if (mode === "build" && DRAG_TOOLS.includes(tool)) {
    const p = groundPoint(ev); if (!p) { drag = null; return; }
    drag.kind = tool; drag.a = tool === "wall" ? vertexAt(p) : tileAt(p); drag.b = drag.a; drag.painted = new Set();
    if (tool === "paint") { snapshot(); paintAt(ev, drag); }
    try { renderer.domElement.setPointerCapture(ev.pointerId); } catch (e) {}
  }
}
function onMove(ev) {
  if (drag && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 8) { drag.moved = true; clearTimeout(lpTimer); }
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
  pointers.delete(ev.pointerId); clearTimeout(lpTimer);
  if (ev.button === 2) { const r = rdown; rdown = null; if (r && Math.hypot(ev.clientX - r.x, ev.clientY - r.y) < 6) openContext(ev); return; }
  if (lpFired) { lpFired = false; drag = null; return; }
  const d = drag; drag = null; if (!d) return;
  if (d.kind === "wall") {
    clearGhost(); const edges = wallLineEdges(d.a, d.b);
    if (edges.length) { snapshot(); for (const k of edges) if (!S.walls[k]) { S.walls[k] = { t: "wall", c: wallColor }; if (wallPattern()) S.walls[k].p = wallPattern(); } rebuildLot(); save(); setStatus(edges.length + " wall segment(s)"); }
    return;
  }
  if (d.kind === "floor") {
    clearGhost(); snapshot();
    const x0 = Math.min(d.a[0], d.b[0]), x1 = Math.max(d.a[0], d.b[0]), z0 = Math.min(d.a[1], d.b[1]), z1 = Math.max(d.a[1], d.b[1]);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (inLot(x, z)) S.floors[x + "," + z] = floorValue();
    rebuildLot(); save(); return;
  }
  if (d.kind === "paint") { if (!d.painted.size) undoStack.pop(); save(); return; }
  if (!d.moved) tap(ev);
}
function paintAt(ev, d) {
  const k = edgeAt(ev); if (!k || !S.walls[k] || d.painted.has(k)) return;
  d.painted.add(k); S.walls[k].c = wallColor; if (wallPattern()) S.walls[k].p = wallPattern(); else delete S.walls[k].p; rebuildLot();
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
  if (world && world.signs.length && !(mode === "buy" && (buyItem || carry))) {
    const sh = pick(ev, world.signs); const sid = sh && world.lotOfSign(sh);
    if (sid) { if (sid === mySid()) { setStatus("That's your own lot."); return; } setStatus("Walking over to visit…"); enterVisit(sid); return; }
  }
  if (mode === "build") {
    if (tool === "garden") {
      const p = groundPoint(ev); if (!p) return; const [x, z] = tileAt(p); if (!inLot(x, z)) return;
      if (Life.plotTiles().has(x + "," + z) && !Life.plotTiles().get(x + "," + z).bed) Life.removePlot(x + "," + z); else if (!occupancy().has(x + "," + z)) Life.digPlots([x, z], [x, z]); else setStatus("Something's in the way.");
      Life.farmTick(true); return;
    }
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
      else { S.objects.push(o); setStatus("Placed " + (catInfo(o.type) ? catInfo(o.type).label : "item")); }
      clearGhost(); rebuildObjects(); save(); renderBuy(); return;
    }
    const hit = pick(ev, [objGroup]);
    if (hit && hit.userData.objId) { const o = S.objects.find((q) => q.id === hit.userData.objId); if (o) { carry = Object.assign({}, o); buyRot = o.rot; setStatus("Carrying " + (catInfo(o.type)?.label || "item") + " — tap a tile to drop, Rotate to turn, Sell to delete"); renderBuy(); showObjGhost(carry); } }
    return;
  }
  if (mode === "live" || mode === "cas") {
    const remoteHit = pick(ev, [remoteGroup]);
    if (remoteHit && remoteHit.userData.remoteSid) { setDmTarget(remoteHit.userData.remoteSid); return; }
    const simHit = pick(ev, [simGroup]);
    if (simHit && simHit.userData.simId) { selectSim(simHit.userData.simId); return; }
    if (mode !== "live") return;
    const sim = getSim(selectedSimId); if (!sim) { setStatus("Tap a sim first"); return; }
    const hit = pick(ev, [objGroup]);
    if (hit && hit.userData.objId) { commandSim(sim, { objId: hit.userData.objId }); return; }
    const stallHit = scene.getObjectByName("MarketStall") && pick(ev, [scene.getObjectByName("MarketStall")]); if (stallHit) { Life.goMarket(() => Life.openTab("market")); return; }
    const pl = Life.plotTiles(), gp = groundPoint(ev); if (gp) { const [x, z] = tileAt(gp); if (pl.has(x + "," + z)) { Life.openMenu({ kind: "plot", key: x + "," + z }, ev.clientX, ev.clientY); return; } }
    if (world) { raycaster.setFromCamera(ndc(ev), camera); const h = raycaster.intersectObjects(world.chunkMeshes(), true)[0]; if (h) h.point = toGrid(h.point);
      if (h && (world.zoneAt(h.point.x, h.point.z) === "water" || h.point.y < -0.9)) { lifeHost.fishAt({ x: h.point.x, z: h.point.z }); return; }
      if (h && !(Math.abs(h.point.x) < N / 2 && Math.abs(h.point.z) < N / 2)) { const rt = runtime.get(sim.id); endTask(sim, rt); rt.queue = null; walkToPoint(sim, h.point); return; } }
    const p = gp; if (p) { const [x, z] = tileAt(p); if (inLot(x, z)) commandSim(sim, { x, z }); }
  }
}

// ---------------- UI ----------------
function setMode(m) {
  if (online.visiting && m !== "live") { setStatus("You're visiting — only Live mode. The host's lot is read-only."); m = "live"; }
  if (mode === "cas" && m !== "cas") leaveCas();
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
  fillSelect($("sims-floor-kind"), G.FLOOR_KINDS, floorKind); fillSelect($("sims-wall-kind"), G.WALL_KINDS, wallKind);
  // pattern previews on the swatches
  document.querySelectorAll("#sims-floor-colors .sims-swatch").forEach((b) => { b.style.backgroundImage = "url(" + surfacePreview(floorKind, floorSeed, b.title) + ")"; b.style.backgroundSize = "cover"; });
  if (wallKind !== "paint") document.querySelectorAll("#sims-wall-colors .sims-swatch").forEach((b) => { b.style.backgroundImage = "url(" + surfacePreview(wallKind === "wood" ? "panel" : wallKind, wallSeed, b.title) + ")"; b.style.backgroundSize = "cover"; });
}
const previewCache = new Map();
function surfacePreview(kind, seed, color) {
  const k = kind + seed + color; if (previewCache.has(k)) return previewCache.get(k);
  const t = G.texture(kind, seed, color); const c = document.createElement("canvas"); c.width = c.height = 48; c.getContext("2d").drawImage(t.image, 0, 0, 48, 48);
  const u = c.toDataURL("image/png"); previewCache.set(k, u); return u;
}
function fillSelect(el, list, cur, labels) {
  if (!el) return; if (el.dataset.filled !== list.join()) { el.innerHTML = list.map((v) => '<option value="' + v + '">' + (labels && labels[v] || v[0].toUpperCase() + v.slice(1)) + "</option>").join(""); el.dataset.filled = list.join(); }
  el.value = cur;
}
function setTool(t) {
  tool = t; clearGhost();
  document.querySelectorAll("#panel-sims [data-sims-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.simsTool === t)));
  updateControlsForTool();
}
// ---------------- Buy: endless seeded catalog ----------------
const FAV_KEY = "logan7in.sims.favs.v1";
let buyRoom = "all", buyCat = "", buySeed = (Math.random() * 1e9) | 0, buyCount = 24, buyList = [];
function favs() { try { const a = JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); return Array.isArray(a) ? a.filter((t) => G.parseType(t)) : []; } catch (e) { return []; } }
function setFavs(a) { try { localStorage.setItem(FAV_KEY, JSON.stringify(a.slice(0, 300))); } catch (e) {} }
function catsInRoom(room) { return Object.keys(G.CATS).filter((c) => room === "all" || room === "fav" || G.CATS[c].room === room); }
function makeBuyList() {
  if (buyRoom === "fav") return favs();
  const r = G.rng(buySeed ^ G.hashStr(buyRoom + "|" + buyCat)), cats = buyCat ? [buyCat] : catsInRoom(buyRoom), out = [];
  for (let i = 0; i < buyCount; i++) out.push(G.genType(cats[Math.floor(r() * cats.length)], Math.floor(r() * 1e9) + 1));
  return out;
}
function chip(el, val, label, cur, on) { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.setAttribute("aria-pressed", String(val === cur)); b.onclick = () => on(val); el.appendChild(b); }
function renderBuy() {
  const el = $("sims-catalog"); if (!el) return;
  const rooms = $("sims-rooms"), cats = $("sims-cats");
  if (rooms) { rooms.innerHTML = ""; chip(rooms, "all", "All", buyRoom, pickRoom); chip(rooms, "fav", "\u2605 Saved", buyRoom, pickRoom); for (const k in G.ROOMS) chip(rooms, k, G.ROOMS[k], buyRoom, pickRoom); }
  if (cats) { cats.innerHTML = ""; cats.hidden = buyRoom === "fav"; chip(cats, "", "Any", buyCat, pickCat); for (const c of catsInRoom(buyRoom)) chip(cats, c, G.CATS[c].label, buyCat, pickCat); }
  buyList = makeBuyList(); el.innerHTML = "";
  const F = new Set(favs());
  const add = (type, label, sub) => {
    const b = document.createElement("div"); b.className = "sims-item"; b.setAttribute("role", "button"); b.tabIndex = 0; b.dataset.type = type; b.setAttribute("aria-pressed", String(buyItem === type));
    b.innerHTML = '<img alt="" src="' + (thumbs.get(type) || THUMB_BLANK) + '" data-thumb="' + type + '" /><strong>' + escapeHtml(label) + "</strong><span>" + sub + "</span>";
    const pickIt = () => { buyItem = buyItem === type ? null : type; carry = null; clearGhost(); el.querySelectorAll(".sims-item").forEach((q) => q.setAttribute("aria-pressed", String(q.dataset.type === buyItem))); setStatus(buyItem ? "Tap a tile to place the " + label + " (seed " + (G.parseType(type) ? G.parseType(type).seed : "custom") + ")" : "Tap furniture to move it"); };
    b.onclick = pickIt; b.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickIt(); } };
    if (G.parseType(type)) { const f = document.createElement("button"); f.type = "button"; f.className = "sims-fav"; f.textContent = F.has(type) ? "\u2605" : "\u2606"; f.setAttribute("aria-label", "Save " + label); f.setAttribute("aria-pressed", String(F.has(type)));
      f.onclick = (e) => { e.stopPropagation(); const a = favs(); const i = a.indexOf(type); if (i >= 0) a.splice(i, 1); else a.unshift(type); setFavs(a); f.textContent = i >= 0 ? "\u2606" : "\u2605"; f.setAttribute("aria-pressed", String(i < 0)); if (buyRoom === "fav") renderBuy(); };
      b.appendChild(f); }
    el.appendChild(b); if (!thumbs.has(type)) queueThumb(type);
  };
  if (buyRoom === "fav" && !buyList.length) el.innerHTML = '<p class="sims-small">Tap \u2606 on any item to save it here. Saved items keep their seed, so they always look the same.</p>';
  for (const type of buyList) { const i = G.genInfo(type); if (i) add(type, i.label, "\u00a7" + i.price + " \u00b7 " + i.w + "\u00d7" + i.d); }
  if (buyRoom === "all" || buyRoom === "outdoor" || buyRoom === "garden") add("gardenbed", "Planter Bed", "\u00a760 \u00b7 2\u00d71 \u00b7 grow crops");
  if (buyRoom === "all") for (const k in CATALOG) if (k.startsWith("custom:")) add(k, k.slice(7), "imported .glb");
  const more = $("sims-more"); if (more) more.hidden = buyRoom === "fav";
  const c = $("sims-carry"); if (c) c.hidden = !carry;
}
function pickRoom(r) { buyRoom = r; buyCat = ""; buyCount = 24; renderBuy(); }
function pickCat(c) { buyCat = c; buyCount = 24; renderBuy(); }
// thumbnails: rendered on a small offscreen renderer, a couple per frame
const thumbs = new Map(), thumbQueue = [];
const THUMB_BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
let thumbR = null, thumbScene = null, thumbCam = null;
function queueThumb(t) { if (!thumbQueue.includes(t)) thumbQueue.push(t); }
function thumbTick() {
  if (!thumbQueue.length || mode !== "buy") return;
  if (!thumbR) {
    try { thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (e) { thumbQueue.length = 0; return; }
    thumbR.setSize(128, 128, false); thumbR.outputColorSpace = THREE.SRGBColorSpace; thumbR.toneMapping = THREE.ACESFilmicToneMapping;
    thumbScene = new THREE.Scene(); thumbScene.add(new THREE.HemisphereLight("#ffffff", "#6a5a4a", 1.4)); const d = new THREE.DirectionalLight("#ffffff", 2.2); d.position.set(3, 5, 4); thumbScene.add(d);
    thumbCam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  }
  for (let n = 0; n < 2 && thumbQueue.length; n++) {
    const type = thumbQueue.shift(); if (thumbs.has(type)) continue;
    const obj = type.startsWith("custom:") ? customObject({ type }) : buildFurniture(type); obj.traverse((c) => { if (c.isLight) c.visible = false; });
    thumbScene.add(obj);
    const bb = new THREE.Box3().setFromObject(obj), ctr = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3()).length() || 1;
    thumbCam.position.set(ctr.x + sz * 0.95, ctr.y + sz * 0.75, ctr.z + sz * 1.25); thumbCam.lookAt(ctr);
    thumbR.render(thumbScene, thumbCam); thumbScene.remove(obj);
    const url = thumbR.domElement.toDataURL("image/png"); thumbs.set(type, url);
    document.querySelectorAll('#sims-catalog img[data-thumb="' + CSS.escape(type) + '"]').forEach((im) => (im.src = url));
  }
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
function setLook(sim, patch) { Object.assign(sim, patch); sim.glb = null; customCache.delete("sim:" + sim.id); spawnSim(sim); selectSim(sim.id); save(); }
function renderCas() {
  const sim = getSim(selectedSimId); const pane = $("sims-cas-fields"); if (!pane) return;
  pane.hidden = !sim; if (!sim) return;
  $("sims-name").value = sim.name; $("sims-height").value = sim.height; $("sims-build").value = sim.build;
  fillSelect($("sims-hairstyle"), G.HAIR_STYLES, sim.hairStyle || "short");
  fillSelect($("sims-outfit"), G.OUTFITS, sim.outfit || "tee");
  fillSelect($("sims-bottomstyle"), G.BOTTOMS, sim.bottomStyle || "pants");
  fillSelect($("sims-pattern"), G.PATTERNS, sim.pattern || "solid");
  fillSelect($("sims-bodytype"), Object.keys(G.BODY_TYPES), sim.bodyType || "average");
  fillSelect($("sims-brows"), G.BROWS, sim.brows || "flat");
  fillSelect($("sims-mouth"), G.MOUTHS, sim.mouth || "smile");
  const upd = (k) => (c) => setLook(sim, { [k]: c });
  swatches($("sims-skin"), G.SKINS, sim.skin, upd("skin"));
  swatches($("sims-hair"), G.HAIR_COLORS, sim.hair, upd("hair"));
  swatches($("sims-top"), G.FABRICS.slice(0, 14), sim.top, upd("top"));
  swatches($("sims-bottom"), ["#2b2724", "#3b3f6b", "#5a4632", "#8a8f96", "#6b2f3a", "#d7c3a1", "#46566b", "#e8e0d2", "#3c4a3e"], sim.bottom, upd("bottom"));
  swatches($("sims-eyes"), G.EYE_COLORS, sim.eyes || "#3a2a1a", upd("eyes"));
  const acc = $("sims-acc"); acc.innerHTML = ""; const A = new Set(sim.acc || []);
  for (const a of G.ACCESSORIES) chip(acc, a, a, A.has(a) ? a : "", () => { const s2 = new Set(sim.acc || []); s2.has(a) ? s2.delete(a) : s2.add(a); setLook(sim, { acc: [...s2].slice(0, 6) }); });
  if (Body) renderSculptPanel();
  $("sims-glb-note").textContent = sim.glb ? "Using an imported .glb mesh (colors/sliders reset it to the built-in body)." : "Built-in rounded body with a face and named joints (Joint_HipL, Joint_ShoulderR…).";
}
let lastNeedsRender = 0;
function renderNeedsLight() { if (performance.now() - lastNeedsRender > 500) renderNeeds(); }
function renderNeeds() {
  lastNeedsRender = performance.now();
  const el = $("sims-needs"); if (!el || !S) return; const sim = getSim(selectedSimId);
  if (lifeHost) $("sims-clock").textContent = Life.clockLabel(Life.clockState(S));
  if (!sim) { el.innerHTML = "<p>No sim selected.</p>"; return; }
  el.innerHTML = "<h4>" + escapeHtml(sim.name) + "</h4>" + NEEDS.map((n) => { const v = Math.round(sim.needs[n]); const col = v > 60 ? "#6fae5a" : v > 30 ? "#c9a227" : "#d04a3a";
    return '<div class="sims-need"><span>' + n[0].toUpperCase() + n.slice(1) + '</span><div class="sims-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + v + '" aria-label="' + n + '"><b style="width:' + v + "%;background:" + col + '"></b></div><em>' + v + "</em></div>"; }).join("");
  const rt = runtime.get(sim.id); const t = $("sims-thought"); if (t && rt) t.textContent = sim.name + ": " + (rt.thought || "Idle");
}
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
function exportGlb(object, name) {
  const ex = new GLTFExporter();
  const isBody = !!object.userData.body, clone = isBody && SkeletonUtils ? SkeletonUtils.clone(object) : object.clone(true); clone.position.set(0, 0, 0); clone.rotation.set(0, 0, 0);
  if (isBody) { clone.traverse((o) => { o.userData = {}; }); clone.userData = { simBody: 1, lod: object.userData.body.lod }; } // generator caches stay out of the file
  if (isBody) { clone.traverse((b) => { if (b.isBone) { b.quaternion.identity(); } }); const pel = clone.getObjectByName("pelvis"); if (pel) pel.position.y = object.userData.body.base.J.pelvis[1]; }
  const drop = []; clone.traverse((o) => { if (o.userData.noExport || o.name === "SelectRing") drop.push(o); }); drop.forEach((o) => o.removeFromParent());
  const tmp = new THREE.Scene(); tmp.add(clone);
  ex.parse(clone, (res) => { download(new Blob([res], { type: "model/gltf-binary" }), name); setStatus("Exported " + name + " — open in Blender: File › Import › glTF 2.0"); },
    (err) => setStatus("Export failed: " + (err && err.message)), { binary: true, onlyVisible: true, maxTextureSize: 512, animations: isBody ? Body.makeClips() : [] });
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
  const imp = Body && Body.fromImported(sceneObj);
  if (imp) {
    const str = await Body.encodeSculpt(imp.deltas); Body.rememberSculpt(str, imp.deltas);
    if (str) sim.sculpt = str; else delete sim.sculpt; sim.morph = Object.assign({}, sim.morph, imp.morph); sim.glb = null; customCache.delete("sim:" + sim.id);
    spawnSim(sim); selectSim(sim.id); save(); schedulePublish(); setStatus("Imported the sculpted body back onto " + sim.name + " (shape + " + Object.keys(imp.morph).length + " sliders)."); return;
  }
  customCache.set("sim:" + sim.id, sceneObj); sim.glb = bufToB64(buf);
  spawnSim(sim); selectSim(sim.id); save();
  const hasJoints = !!sceneObj.getObjectByName("Joint_HipL");
  setStatus("Imported mesh onto " + sim.name + (hasJoints ? " — joints found, walk cycle active." : " — no Joint_* nodes found, it will glide instead of walk."));
}
function bindUI() {
  const cv = renderer.domElement;
  cv.addEventListener("pointerdown", sculptDown, true); cv.addEventListener("pointermove", sculptMove, true); cv.addEventListener("pointerup", sculptUp, true);
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
  for (const [id, key] of [["sims-hairstyle", "hairStyle"], ["sims-outfit", "outfit"], ["sims-bottomstyle", "bottomStyle"], ["sims-pattern", "pattern"], ["sims-brows", "brows"], ["sims-mouth", "mouth"]])
    $(id).onchange = (e) => { const s = getSim(selectedSimId); if (s) setLook(s, { [key]: e.target.value }); };
  $("sims-bodytype").onchange = (e) => { const s = getSim(selectedSimId); if (!s) return; const [b, h] = G.BODY_TYPES[e.target.value] || [1, 1]; setLook(s, { bodyType: e.target.value, build: b, height: h }); };
  $("sims-randomize").onclick = () => { const s = getSim(selectedSimId); if (!s) return; const r = G.randomSim(G.randSeed()); delete r.name; delete r.id; setLook(s, r); setStatus("Rerolled " + s.name); };
  $("sims-randomize-look").onclick = () => { const s = getSim(selectedSimId); if (!s) return; const r = G.randomSim(G.randSeed()); setLook(s, { top: r.top, bottom: r.bottom, outfit: r.outfit, bottomStyle: r.bottomStyle, pattern: r.pattern, pat2: r.pat2, shoes: r.shoes, acc: r.acc, accColor: r.accColor, hairStyle: r.hairStyle }); };
  $("sims-shuffle").onclick = () => { buySeed = G.randSeed(); buyCount = 24; if (buyRoom === "fav") buyRoom = "all"; renderBuy(); $("sims-catalog").scrollTop = 0; };
  $("sims-more").onclick = () => { buyCount += 24; const el = $("sims-catalog"), top = el.scrollTop; renderBuy(); el.scrollTop = top; };
  $("sims-catalog").addEventListener("scroll", (e) => { const el = e.target; if (buyRoom !== "fav" && el.scrollTop + el.clientHeight > el.scrollHeight - 40 && buyCount < 600) { buyCount += 24; const top = el.scrollTop; renderBuy(); el.scrollTop = top; } }, { passive: true });
  $("sims-seed-go").onclick = () => { const v = $("sims-seed").value.trim(); const m = /^(?:gen:)?([a-z]+)?:?(\d{1,10})$/.exec(v); if (!m) { setStatus("Seed: a number, or category:number (e.g. sofa:42)"); return; } const cat = m[1] && G.CATS[m[1]] ? m[1] : buyCat || "sofa"; const t = G.genType(cat, +m[2]); buyItem = t; carry = null; renderBuy(); setStatus("Tap a tile to place " + G.genInfo(t).label + " (" + t.slice(4) + ")"); };
  $("sims-floor-kind").onchange = (e) => { floorKind = e.target.value; renderBuildColors(); setTool("floor"); };
  $("sims-wall-kind").onchange = (e) => { wallKind = e.target.value; renderBuildColors(); setTool("paint"); };
  $("sims-floor-seed").onclick = () => { floorSeed = (Math.random() * 1e6) | 0; renderBuildColors(); setTool("floor"); setStatus("New floor pattern #" + floorSeed + " — drag to lay it"); };
  $("sims-wall-seed").onclick = () => { wallSeed = (Math.random() * 1e6) | 0; if (wallKind === "paint") wallKind = "wallpaper"; renderBuildColors(); setTool("paint"); setStatus("New wall finish #" + wallSeed + " — drag across walls"); };
  $("sims-recenter").onclick = () => { controls.target.set(0, 0, 0); camera.position.set(14, 16, 18); controls.update(); };
  $("sims-quality").onchange = (e) => window.SimsTab.setQuality(e.target.value);
  $("sims-new").onclick = () => { const s = defaultSim("Sim", S.sims.length, G.randSeed()); s.name = G.randomSim(G.randSeed()).name; const occ = occupancy(); for (let t = 0; t < N * N; t++) { const x = (11 + t) % N, z = (11 + Math.floor(t / N)) % N; if (!occ.has(x + "," + z)) { s.x = x; s.z = z; break; } } S.sims.push(s); spawnSim(s); selectSim(s.id); save(); };
  $("sims-delete-sim").onclick = () => { const s = getSim(selectedSimId); if (!s || S.sims.length <= 1) { setStatus("Keep at least one sim"); return; } const rt = runtime.get(s.id); if (rt) simGroup.remove(rt.holder); runtime.delete(s.id); S.sims = S.sims.filter((q) => q !== s); selectSim(S.sims[0].id); save(); };
  $("sims-export-sim").onclick = () => { const s = getSim(selectedSimId); const rt = s && runtime.get(s.id); if (rt) exportGlb(rt.model, (s.name || "sim").replace(/\W+/g, "_") + ".glb"); };
  $("sims-export-lot").onclick = () => exportGlb(lotGroup, "lot.glb");
  for (const id of ["sims-import-glb", "sims-import-glb2"]) $(id).onchange = (e) => { const f = e.target.files[0]; if (f) importGlb(f); e.target.value = ""; };
  $("sims-export-json").onclick = () => download(new Blob([JSON.stringify(S, null, 1)], { type: "application/json" }), "sims-save.json");
  $("sims-import-json").onchange = async (e) => { const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { const s = JSON.parse(await f.text()); if (!s || s.v !== 1 || !s.walls) throw 0; snapshot(); for (const rt of runtime.values()) simGroup.remove(rt.holder); runtime.clear(); S = s; await restoreCustomGlbs(); rebuildLot(); for (const sim of S.sims) spawnSim(sim); selectSim(S.sims[0] && S.sims[0].id); save(); setStatus("Save loaded"); }
    catch (err) { setStatus("That file isn't a Sims save"); } };
  $("sims-reset").onclick = () => { if (!confirm("Reset the lot to the starter house? (Export a save first if you want to keep this one.)")) return; for (const rt of runtime.values()) simGroup.remove(rt.holder); runtime.clear(); S = starterFromPlan(freshSave()); undoStack = []; rebuildLot(); for (const sim of S.sims) spawnSim(sim); selectSim(S.sims[0].id); save(); };
  document.addEventListener("keydown", (e) => {
    if (!visible || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    else if (e.key.toLowerCase() === "r" && mode === "buy") $("sims-rotate").click();
    else if (e.key === "Escape") { carry = null; buyItem = null; clearGhost(); renderBuy(); }
  });
  renderBuildColors();
}


// ---------------- Create-a-Sim: sculpt mode + body/face morph sliders ----------------
const sculpt = { on: false, brush: "inflate", radius: 0.025, strength: 0.5, mirror: true, mouth: false, stroke: null, tool: null };
function sculptModel() { const sim = getSim(selectedSimId), rt = sim && runtime.get(sim.id); return rt && rt.model && rt.model.userData.body ? rt.model : null; }
function sculptTool() { const m = sculptModel(); if (!m) return null; if (!sculpt.tool || sculpt.tool.root !== m) sculpt.tool = new Body.Sculptor(m); return sculpt.tool; }
function renderSculptPanel() {
  const host = $("sims-cas-fields"); if (!host || !Body) return;
  let el = $("sims-sculpt");
  if (!el) {
    el = document.createElement("div"); el.id = "sims-sculpt"; el.className = "sims-sculpt";
    el.innerHTML = '<h4>Sculpt &amp; shape</h4>' +
      '<label class="sims-check"><input type="checkbox" id="sims-sculpt-on" /> Sculpt mode (drag on the body; right-drag orbits)</label>' +
      '<div class="sims-tools" role="group" aria-label="Brush" id="sims-brushes"></div>' +
      '<label class="sims-label" for="sims-brush-radius">Brush radius</label><input id="sims-brush-radius" type="range" min="0.006" max="0.12" step="0.002" />' +
      '<label class="sims-label" for="sims-brush-strength">Strength</label><input id="sims-brush-strength" type="range" min="0.05" max="1" step="0.05" />' +
      '<label class="sims-check"><input type="checkbox" id="sims-brush-mirror" /> X-mirror (left ↔ right)</label>' +
      '<div class="sims-tools"><button type="button" id="sims-sculpt-undo">Undo stroke</button><button type="button" id="sims-sculpt-reset">Reset sculpt</button></div>' +
      '<div class="sims-tools" role="group" aria-label="Camera"><button type="button" data-sims-cv="body">Body</button><button type="button" data-sims-cv="face">Face</button><button type="button" data-sims-cv="mouth">Mouth</button><button type="button" data-sims-cv="hand">Hand</button><button type="button" data-sims-cv="foot">Foot</button></div>' +
      '<div id="sims-morphs" class="sims-morphs"></div><p class="sims-small" id="sims-sculpt-note"></p>';
    const blender = [...host.querySelectorAll("h4")].find((h) => /Blender/.test(h.textContent)); host.insertBefore(el, blender || null);
    const br = $("sims-brushes");
    for (const b of Body.BRUSHES) { const btn = document.createElement("button"); btn.type = "button"; btn.textContent = b[0].toUpperCase() + b.slice(1); btn.dataset.brush = b; btn.onclick = () => { sculpt.brush = b; renderSculptPanel(); }; br.appendChild(btn); }
    $("sims-sculpt-on").onchange = (e) => { sculpt.on = e.target.checked; controls.mouseButtons.LEFT = sculpt.on ? null : THREE.MOUSE.ROTATE; if (sculpt.on) casView("body"); setStatus(sculpt.on ? "Sculpt: drag on the sim. Right-drag to orbit, wheel to zoom." : "Create-a-Sim"); };
    $("sims-brush-radius").oninput = (e) => (sculpt.radius = +e.target.value);
    $("sims-brush-strength").oninput = (e) => (sculpt.strength = +e.target.value);
    $("sims-brush-mirror").onchange = (e) => (sculpt.mirror = e.target.checked);
    $("sims-sculpt-undo").onclick = () => { const t = sculptTool(); if (t && t.undo()) commitSculpt(); };
    $("sims-sculpt-reset").onclick = () => { const t = sculptTool(); if (t) { t.reset(); commitSculpt(); } };
    el.querySelectorAll("[data-sims-cv]").forEach((b) => (b.onclick = () => casView(b.dataset.simsCv)));
    const mp = $("sims-morphs");
    for (const k of Body.MORPHS) { const id = "sims-morph-" + k; const lab = document.createElement("label"); lab.className = "sims-label"; lab.htmlFor = id; lab.textContent = Body.MORPH_LABELS[k]; const inp = document.createElement("input"); inp.type = "range"; inp.id = id; inp.min = "-1"; inp.max = "1.5"; inp.step = "0.02"; inp.dataset.morph = k;
      inp.oninput = () => { const sim = getSim(selectedSimId), m = sculptModel(); if (!sim) return; sim.morph = Object.assign({}, sim.morph, { [k]: +inp.value }); if (m) Body.setMorph(m, k, +inp.value); sim.glb = null; clearTimeout(sculpt.saveT); sculpt.saveT = setTimeout(() => { save(); schedulePublish(); }, 600); };
      mp.append(lab, inp); }
  }
  const sim = getSim(selectedSimId); el.hidden = !sim;
  $("sims-sculpt-on").checked = sculpt.on; $("sims-brush-radius").value = sculpt.radius; $("sims-brush-strength").value = sculpt.strength; $("sims-brush-mirror").checked = sculpt.mirror;
  el.querySelectorAll("[data-brush]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.brush === sculpt.brush)));
  if (sim) { const inf = Body.morphInfluencesFor(sim); el.querySelectorAll("[data-morph]").forEach((i) => (i.value = inf[i.dataset.morph] || 0)); }
  const m = sculptModel(); $("sims-sculpt-note").textContent = m ? "Generated body: " + Object.values(m.userData.body.parts).reduce((a, p) => a + p.geometry.index.count / 3, 0).toLocaleString() + " triangles (" + m.userData.body.lod + "), " + m.userData.body.skeleton.bones.length + " bones. Sculpts are saved, shared online and exported in the .glb." : "";
}
function casView(v) {
  const m = sculptModel(); if (!m) return; sculpt.mouth = v === "mouth";
  const B = m.userData.body.bones, p = new THREE.Vector3(), sc = m.scale.x;
  m.updateMatrixWorld(true);
  const tgt = { body: B.spine2, face: B.head, mouth: B.jaw, hand: B.handL, foot: B.footL }[v] || B.spine2; tgt.getWorldPosition(p);
  if (v === "face") p.y += 0.1 * sc; if (v === "mouth") p.y -= 0.035 * sc; if (v === "hand") { B.middle1L.getWorldPosition(p); } if (v === "foot") p.y -= 0.03 * sc;
  const dist = { body: 2.6, face: 0.5, mouth: 0.36, hand: 0.42, foot: 0.55 }[v] * sc;
  const eM = new THREE.Vector3(), hp = new THREE.Vector3(), tmp = new THREE.Vector3(); B.eyeL.getWorldPosition(eM); B.eyeR.getWorldPosition(tmp); eM.add(tmp).multiplyScalar(0.5); B.head.getWorldPosition(hp);
  const fwd = eM.sub(hp).setY(0).normalize(), out = new THREE.Vector3(); B.spine2.getWorldPosition(tmp);
  if (v === "hand") { out.copy(p).sub(tmp).setY(0).normalize(); }
  const dir = v === "hand" ? fwd.clone().multiplyScalar(0.9).add(out.multiplyScalar(0.7)).add(new THREE.Vector3(0, 0.15, 0)).normalize() : v === "foot" ? fwd.clone().add(new THREE.Vector3(0, 0.75, 0)).add(new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).multiplyScalar(0.35)).normalize() : fwd.clone().add(new THREE.Vector3(0, 0.06, 0)).normalize();
  if (wallGroup) wallGroup.visible = false; // close-up views see through the house walls
  controls.minDistance = 0.15; controls.maxPolarAngle = Math.PI * 0.95; follow = false;
  controls.target.copy(p); camera.position.copy(p).addScaledVector(dir, dist); camera.near = 0.01; camera.updateProjectionMatrix(); controls.update();
}
function sculptHit(ev) {
  const m = sculptModel(); if (!m) return null; raycaster.setFromCamera(ndc(ev), camera);
  // sculpt mode holds the rest pose, so the bind-space surface is the visible surface: ray-test static proxies that
  // share each part's geometry (and morphs) instead of skinning every vertex per pointer move
  const proxies = m.userData.sculptProxies || (m.userData.sculptProxies = Object.values(m.userData.body.parts).map((p) => { const q = new THREE.Mesh(p.geometry, p.material); q.name = p.name; q.matrixAutoUpdate = false; q.morphTargetInfluences = p.morphTargetInfluences; q.morphTargetDictionary = p.morphTargetDictionary; q.userData.part = p; return q; }));
  for (const q of proxies) { q.matrixWorld.copy(q.userData.part.matrixWorld); q.geometry.boundingSphere = null; }
  const h = raycaster.intersectObjects(proxies, false); return h[0] || null;
}
function sculptDown(ev) {
  if (!(mode === "cas" && sculpt.on && ev.button === 0)) return;
  const h = sculptHit(ev); if (!h) return; const t = sculptTool(); if (!t) return;
  ev.stopImmediatePropagation(); ev.preventDefault(); controls.enabled = false;
  t.begin(); sculpt.stroke = { last: h.point.clone(), plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), h.point) };
  if (sculpt.brush !== "grab") t.apply(h.point, { brush: sculpt.brush, radius: sculpt.radius, strength: sculpt.strength * 0.5, mirror: sculpt.mirror });
  try { renderer.domElement.setPointerCapture(ev.pointerId); } catch (e) {}
}
function sculptMove(ev) {
  if (!sculpt.stroke) return; ev.stopImmediatePropagation(); const t = sculptTool(); if (!t) return;
  if (sculpt.brush === "grab") { raycaster.setFromCamera(ndc(ev), camera); const p = new THREE.Vector3(); if (!raycaster.ray.intersectPlane(sculpt.stroke.plane, p)) return; const d = p.clone().sub(sculpt.stroke.last); t.apply(sculpt.stroke.last, { brush: "grab", drag: d, radius: sculpt.radius, strength: 1, mirror: sculpt.mirror }); sculpt.stroke.last.copy(p); return; }
  const h = sculptHit(ev); if (!h) return; if (h.point.distanceTo(sculpt.stroke.last) < sculpt.radius * 0.15) return; sculpt.stroke.last.copy(h.point);
  t.apply(h.point, { brush: sculpt.brush, radius: sculpt.radius, strength: sculpt.strength * 0.5, mirror: sculpt.mirror });
}
function sculptUp(ev) { if (!sculpt.stroke) return; ev.stopImmediatePropagation(); sculpt.stroke = null; controls.enabled = true; commitSculpt(); }
async function commitSculpt() {
  const sim = getSim(selectedSimId), m = sculptModel(); if (!sim || !m) return;
  const D = Body.currentDeltasMed(m), str = await Body.encodeSculpt(D);
  if (str.length > Body.SCULPT_MAX) { setStatus("That sculpt is too detailed to save — try Smooth or Undo."); return; }
  Body.rememberSculpt(str, D); sim.sculpt = str || undefined; if (!str) delete sim.sculpt; sim.glb = null; save(); schedulePublish();
}
function leaveCas() { sculpt.on = false; sculpt.mouth = false; if (wallGroup) wallGroup.visible = true; if (controls) { controls.minDistance = 5; controls.maxPolarAngle = Math.PI * 0.45; controls.enabled = true; controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; camera.near = 0.1; camera.updateProjectionMatrix(); } }

// ---------------- time preview: scrub the sim's displayed time of day; bookmark moments ----------------
function tp() { if (!S.timePreview) S.timePreview = { mode: "live", t: Date.now(), play: false, speed: 60, moments: [] }; return S.timePreview; }
function previewDate() { const P = S && S.timePreview; return P && P.mode === "preview" ? new Date(P.t) : null; }
const pad2 = (n) => String(n).padStart(2, "0");
function timebarCss() {
  if ($("sims-timebar-css")) return; const st = document.createElement("style"); st.id = "sims-timebar-css";
  st.textContent = `.sims-timebar{position:absolute;left:8px;right:8px;bottom:8px;z-index:5;background:rgba(14,14,18,.82);border:1px solid rgba(201,162,39,.5);border-radius:10px;padding:6px 8px;color:#f2eee6;font:12px/1.3 system-ui,sans-serif;backdrop-filter:blur(4px)}
.sims-timebar .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.sims-timebar button,.sims-timebar select,.sims-timebar input[type=date],.sims-timebar input[type=text]{background:#1d1a18;color:#f2eee6;border:1px solid #555;border-radius:6px;padding:2px 7px;font:inherit}
.sims-timebar button[aria-pressed=true]{border-color:#c9a227;color:#c9a227}.sims-tl{position:relative;flex:1 1 320px;height:30px;min-width:220px}.sims-tl canvas{position:absolute;inset:0;width:100%;height:100%;border-radius:6px}
.sims-tl input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:.0001;cursor:ew-resize}.sims-tl .knob{position:absolute;top:-3px;bottom:-3px;width:3px;margin-left:-1px;background:#c9a227;box-shadow:0 0 6px #c9a227;pointer-events:none}
.sims-moments{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}.sims-moments span{display:inline-flex;border:1px solid #6a5a2a;border-radius:12px;overflow:hidden}.sims-moments span button{border:0;border-radius:0}
.sims-tread{min-width:210px;font-variant-numeric:tabular-nums}`; document.head.appendChild(st);
}
function renderTimebar() {
  const stage = $("sims-stage"); if (!stage || !Life || !S) return; timebarCss(); const P = tp();
  let el = $("sims-timebar");
  if (!el) {
    el = document.createElement("div"); el.id = "sims-timebar"; el.className = "sims-timebar"; el.setAttribute("role", "group"); el.setAttribute("aria-label", "Time of day preview");
    el.innerHTML = '<div class="row"><button type="button" id="sims-tb-live" title="Snap back to the real clock">● Live (real clock)</button><button type="button" id="sims-tb-play" title="Play the previewed time forward">▶</button>' +
      '<select id="sims-tb-speed" aria-label="Playback speed"><option value="1">1×</option><option value="60">60×</option><option value="600">600×</option></select>' +
      '<div class="sims-tl"><canvas id="sims-tb-canvas" width="720" height="60"></canvas><div class="knob" id="sims-tb-knob"></div><input type="range" id="sims-tb-range" min="0" max="1439" step="1" aria-label="Time of day" /></div>' +
      '<input type="date" id="sims-tb-date" aria-label="Preview date (season + moon phase)" /><span class="sims-tread" id="sims-tb-read"></span></div>' +
      '<div class="row sims-moments" id="sims-tb-moments"></div>';
    stage.appendChild(el);
    const toPreview = () => { if (P.mode !== "preview") { P.mode = "preview"; P.t = Date.now(); } };
    $("sims-tb-live").onclick = () => { P.mode = "live"; P.play = false; save(); renderTimebar(); };
    $("sims-tb-play").onclick = () => { toPreview(); P.play = !P.play; save(); renderTimebar(); };
    $("sims-tb-speed").onchange = (e) => { P.speed = +e.target.value; save(); };
    $("sims-tb-range").oninput = (e) => { toPreview(); const d = new Date(P.t); d.setHours(0, +e.target.value, 0, 0); P.t = d.getTime(); renderTimebar(); };
    $("sims-tb-range").onchange = () => save();
    $("sims-tb-date").onchange = (e) => { if (!e.target.value) return; toPreview(); const [y, m, dd] = e.target.value.split("-").map(Number), d = new Date(P.t); d.setFullYear(y, m - 1, dd); P.t = d.getTime(); save(); renderTimebar(true); };
  }
  const d = previewDate() || new Date(), mins = d.getHours() * 60 + d.getMinutes(), moon = NightMod ? NightMod.moonAt(Life.sunAt, d, mins / 60) : null;
  $("sims-tb-live").setAttribute("aria-pressed", String(P.mode === "live")); $("sims-tb-play").textContent = P.play ? "❚❚" : "▶"; $("sims-tb-play").setAttribute("aria-pressed", String(!!P.play)); $("sims-tb-speed").value = String(P.speed || 60);
  if (document.activeElement !== $("sims-tb-range")) $("sims-tb-range").value = mins;
  $("sims-tb-knob").style.left = (mins / 1440 * 100) + "%";
  const ds = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); if (document.activeElement !== $("sims-tb-date")) $("sims-tb-date").value = ds;
  $("sims-tb-read").textContent = (P.mode === "live" ? "Live · " : "Preview · ") + d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + (moon ? " · " + moonGlyph(moon.age) + " " + moon.name : "");
  const key = ds + (moon ? Math.round(moon.age * 60) : ""); if (el.dataset.drawn !== key) { el.dataset.drawn = key; drawTimeline(d); }
  const mb = $("sims-tb-moments"); const mk = JSON.stringify(P.moments || []);
  if (mb.dataset.k !== mk) { mb.dataset.k = mk; mb.innerHTML = "";
    const add = document.createElement("button"); add.type = "button"; add.textContent = "＋ Save moment"; add.onclick = () => { const n = prompt("Name this moment (memory reference):", "Moment " + ((P.moments || []).length + 1)); if (n != null) saveMoment(n); }; mb.appendChild(add);
    (P.moments || []).forEach((m, i) => { const sp = document.createElement("span"), b = document.createElement("button"), x = document.createElement("button"); b.type = x.type = "button"; const md = new Date(m.t);
      b.textContent = m.name + " · " + md.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) + " " + pad2(md.getHours()) + ":" + pad2(md.getMinutes()); b.title = "Jump to this moment"; b.onclick = () => jumpMoment(i);
      x.textContent = "×"; x.setAttribute("aria-label", "Delete moment " + m.name); x.onclick = () => { P.moments.splice(i, 1); save(); renderTimebar(); }; sp.append(b, x); mb.appendChild(sp); }); }
}
function moonGlyph(a) { return ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"][Math.round(a * 8) % 8]; }
function drawTimeline(d) {
  const cv = $("sims-tb-canvas"); if (!cv) return; const x = cv.getContext("2d"), W = cv.width, Hh = cv.height;
  for (let px = 0; px < W; px++) { const h = px / W * 24, el = Life.sunAt(d, h).elev, c = Life.skyColor(el); x.fillStyle = "#" + c.getHexString(); x.fillRect(px, 0, 1, Hh); }
  const s = Life.sunAt(d, 12), mark = (h, label, col) => { const px = ((h % 24) + 24) % 24 / 24 * W; x.fillStyle = col; x.fillRect(px - 1, 0, 2, Hh); x.font = "bold 15px system-ui"; x.fillStyle = "#111"; x.fillText(label, Math.min(W - 70, px + 4), 17); x.fillStyle = "#fff"; x.fillText(label, Math.min(W - 70, px + 3), 16); };
  mark(s.sunrise, "☀↑ " + fmtH(s.sunrise), "#ffb070"); mark(s.noon, "noon", "#fff1d6"); mark(s.sunset, "☀↓ " + fmtH(s.sunset), "#ff8a50");
  x.font = "14px system-ui"; x.fillStyle = "#cfe0ff"; x.fillText("night", 6, Hh - 8); x.fillText("night", W - 44, Hh - 8);
  if (NightMod) { let best = -1, bh = 0; for (let h = 0; h < 24; h += 0.25) { const m = NightMod.moonAt(Life.sunAt, d, h); if (m.elev > best) { best = m.elev; bh = h; } } if (best > 0) { x.font = "18px system-ui"; x.fillText(moonGlyph(NightMod.moonAge(d)), bh / 24 * W - 9, Hh - 6); } }
  for (let h = 0; h <= 24; h += 3) { x.fillStyle = "rgba(255,255,255,.35)"; x.fillRect(h / 24 * W, Hh - 6, 1, 6); }
}
const fmtH = (h) => pad2(Math.floor(h)) + ":" + pad2(Math.floor((h % 1) * 60));
function saveMoment(name) {
  const P = tp(), d = previewDate() || new Date(); P.moments = P.moments || [];
  P.moments.push({ name: String(name || "Moment").slice(0, 32), t: d.getTime(), cam: { p: camera.position.toArray().map((v) => +v.toFixed(2)), t: controls.target.toArray().map((v) => +v.toFixed(2)) } });
  if (P.moments.length > 24) P.moments.shift(); save(); renderTimebar(); setStatus("Saved moment “" + name + "”.");
}
function jumpMoment(i) {
  const P = tp(), m = P.moments && P.moments[i]; if (!m) return; P.mode = "preview"; P.t = m.t; P.play = false;
  if (m.cam) { follow = false; controls.target.fromArray(m.cam.t); camera.position.fromArray(m.cam.p); controls.update(); }
  save(); renderTimebar(true); setStatus("Jumped to “" + m.name + "”.");
}
let tbAcc = 0;
function timeTick(dt) { const P = S && S.timePreview; if (P && P.mode === "preview" && P.play) P.t += dt * 1000 * (P.speed || 1); tbAcc += dt; if (tbAcc > 0.25) { tbAcc = 0; renderTimebar(); } }

// ---------------- tab lifecycle ----------------
function show() {
  visible = true;
  if (!started) start().catch((e) => { console.error(e); setStatus("3D failed to start: " + e.message); });
  else if (ready) { resize(); clockObj.getDelta(); consumeVisit(); if (!rafId) loop(); }
}
function hide() { netLeave(); visible = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; const home = online.visiting ? online.homeS : S; if (home) try { localStorage.setItem(SAVE_KEY, JSON.stringify(home)); } catch (e) {} }
window.addEventListener("sims-show", show);
window.addEventListener("sims-hide", hide);
window.SimsTab = { onShow: show, onHide: hide, get state() { return S; },
  perf() { return { fps: Math.round(perf.fps), history: perf.history.slice(), quality, pref: qualityPref, draws: renderer && renderer.info.render.calls, tris: renderer && renderer.info.render.triangles, world: world && world.stats(), shared: world && world.sharedSlots() }; },
  view(x, z, d = 1) { const off = camera.position.clone().sub(controls.target).normalize().multiplyScalar(30 * d); controls.target.set(x, 0, z); camera.position.set(x, 0, z).add(off); controls.update(); },
  get world() { return world; },
  setQuality(q) { qualityPref = q; try { localStorage.setItem(QUALITY_KEY, q); } catch (e) {} applyQuality(QUALITY[q] ? q : pickQuality()); },
  exportLotBlob() { return new Promise((res, rej) => { const clone = lotGroup.clone(true); const drop = []; clone.traverse((o) => { if (o.userData.noExport || o.name === "SelectRing") drop.push(o); }); drop.forEach((o) => o.removeFromParent()); new GLTFExporter().parse(clone, res, rej, { binary: true, onlyVisible: true }); }); },
  get life() { return Life; }, get lifeHost() { return lifeHost; },
  sim() { const sim = getSim(selectedSimId), rt = sim && runtime.get(sim.id); if (!rt) return null; const p = rt.holder.position; return { id: sim.id, name: sim.name, x: +p.x.toFixed(2), z: +p.z.toFixed(2), tx: sim.x, tz: sim.z, away: !!rt.away, driving: !!rt.driving, legs: rt.legs ? rt.legs.length : 0, path: rt.path.length, job: rt.job && rt.job.label, task: !!rt.task, pose: rt.pose, thought: rt.thought, needs: sim.needs }; },
  walk(x, z) { return lifeHost.walkTo({ x, z }); }, drive(x, z) { return driveTo({ x, z }); },
  car() { return myCar.obj && { state: myCar.state, x: +myCar.obj.position.x.toFixed(2), z: +myCar.obj.position.z.toFixed(2), pts: myCar.pts ? myCar.pts.length : 0, away: myCar.away }; },
  cam() { return { tx: controls.target.x, tz: controls.target.z, x: camera.position.x, y: camera.position.y, z: camera.position.z, pan: camPan, follow }; },
  setSpeed(v) { speed = v; }, setMode(m) { setMode(m); }, setHour(h) { const d = new Date(); d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0); tp().mode = "preview"; tp().t = d.getTime(); tp().play = false; renderTimebar(); },
  timePreview() { return tp(); }, simData() { const s = getSim(selectedSimId); return s && JSON.parse(JSON.stringify(s)); }, saveMoment(n) { saveMoment(n); }, jumpMoment(i) { jumpMoment(i); }, nightInfo() { return night && { k: night.nightK, realLights: night.lights(), cap: night.cap(), moon: lastClock && lastClock.moon, sources: world.lightSources().length }; },
  body() { const m = sculptModel(); return m && { report: Body.anatomyReport(m), post: Hifi && Hifi.postInfo(), lod: m.userData.body.lod }; },
  casView(v) { casView(v); }, sculptState() { return sculpt; }, get Body() { return Body; }, model() { return sculptModel(); },
  worldToScreen(x, y, z) { const v = new THREE.Vector3(x, y, z).project(camera); const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
  targetAt(cx, cy) { const t = targetAt({ clientX: cx, clientY: cy }); return t && { kind: t.kind, name: t.name || (t.obj && t.obj.type) || (t.sim && t.sim.name) }; },
  // test helper: screen position of a tile corner/center
  net() { return { lotId: currentLotId(), visiting: online.visiting && { host: online.visiting.hostSid, name: online.visiting.hostName }, remotes: [...online.remotes].map(([sid, r]) => ({ sid, name: r.name, host: r.host, x: +(r.holder.position.x + N / 2 - 0.5).toFixed(2), z: +(r.holder.position.z + N / 2 - 0.5).toFixed(2), say: r.say && r.say.text })), me: mySid() }; },
  tileToScreen(x, z) { const v = new THREE.Vector3(x - N / 2, 0, z - N / 2).project(camera); const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; } };

// ======================= ONLINE: shared lots, visiting, bubbles, DMs =======================
// Backend: /api/sims-lot (Netlify Blobs; same function on the Cloudflare worker) for lots and
// positions, and the existing /api/server-people mail for DMs (via window.L7inPeople).
const OWNER_KEY = "logan7in.sims.ownerKey.v1";
const SHARE_KEY = "logan7in.sims.share.v1";
const online = { lotId: "", visiting: null, homeS: null, remotes: new Map(), lastPost: 0, lastPoll: 0, polling: false, posting: false,
  pendingSay: "", dmTarget: "", seenMail: new Set(), lastMailPoll: 0, publishTimer: 0 };
function people() { return window.L7inPeople || null; }
function mySid() { const p = people(); if (p) return p.selfId(); try { return sessionStorage.getItem("tabPresenceSid") || ""; } catch (e) { return ""; } }
function myName() { const p = people(); if (p) return p.name(); try { return localStorage.getItem("pageChatName") || "guest"; } catch (e) { return "guest"; } }
function ownerKey() {
  try {
    let k = localStorage.getItem(OWNER_KEY);
    if (!k || !/^[A-Za-z0-9_-]{20,80}$/.test(k)) {
      const b = new Uint8Array(24); crypto.getRandomValues(b);
      k = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); localStorage.setItem(OWNER_KEY, k);
    }
    return k;
  } catch (e) { return ""; }
}
function sharing() { try { return localStorage.getItem(SHARE_KEY) !== "off"; } catch (e) { return true; } }
const LOOK_KEYS = ["name", "skin", "hair", "top", "bottom", "hairStyle", "height", "build", "outfit", "bottomStyle", "pattern", "pat2", "shoes", "eyes", "brows", "mouth", "acc", "accColor", "morph", "sculpt"];
function appearance(sim) { if (!sim) return null; const o = {}; for (const k of LOOK_KEYS) if (sim[k] != null) o[k] = sim[k]; return o; }
async function api(method, body, query) {
  const url = "/api/sims-lot" + (query ? "?" + new URLSearchParams(query) : "");
  const r = await fetch(url, method === "GET" ? { cache: "no-store" } : { method, cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch (e) {}
  return data || { ok: false, error: "HTTP " + r.status };
}
function schedulePublish() { clearTimeout(online.publishTimer); online.publishTimer = setTimeout(() => publishLot(false), 4000); }
async function publishLot(force) {
  if (online.visiting || !S || !sharing()) return;
  const sid = mySid(), key = ownerKey(); if (!sid || !key) return;
  const sim = getSim(selectedSimId) || S.sims[0];
  const body = { op: "publish", sid, key, name: myName(), lot: { walls: S.walls, floors: S.floors, objects: S.objects.filter((o) => !o.type.startsWith("custom:")) }, sim: appearance(sim) };
  if (sim && sim.glb && sim.glb.length <= 160000) body.glb = sim.glb;
  try {
    const d = await api("POST", body);
    if (d.lot) online.lotId = d.lot;
    if (d.ok) setNet("Your lot is shared — others can tap Go to on you in Here." + (d.glbDropped ? " (Custom mesh too big; visitors see the default body.)" : ""));
    else if (force && d.error) setNet("Couldn't share lot: " + d.error);
  } catch (e) { setNet("Offline — lot not shared (still playable locally)."); }
}
setInterval(() => { if (visible && ready) publishLot(false); }, 60000);
function setNet(t) { const el = $("sims-net"); if (el) el.textContent = t; }

// ---- visiting ----
function consumeVisit() {
  let sid = ""; try { sid = sessionStorage.getItem("simsVisit") || ""; sessionStorage.removeItem("simsVisit"); } catch (e) {}
  if (sid && sid !== mySid()) enterVisit(sid);
}
window.addEventListener("sims-visit", () => { if (ready && visible) consumeVisit(); });
async function enterVisit(hostSid) {
  setNet("Finding their lot…");
  let d; try { d = await api("GET", null, { op: "lot", sid: hostSid }); } catch (e) { d = { ok: false, error: "network" }; }
  if (!d.ok) { setNet("Can't visit: " + (d.error || "no lot") + ". They need the Sims tab open once."); return; }
  if (online.visiting) await leaveVisit(true);
  netLeave();
  online.homeS = S;
  const home = getSim(selectedSimId) || S.sims[0];
  const me = Object.assign({}, home || defaultSim(myName(), 0), { id: "me", glb: null, needs: Object.assign({}, home ? home.needs : { hunger: 80, energy: 80, fun: 80, hygiene: 80 }) });
  const L = d.lot && typeof d.lot === "object" ? d.lot : { walls: {}, floors: {}, objects: [] };
  S = { v: 1, N, walls: L.walls || {}, floors: L.floors || {}, objects: L.objects || [], sims: [me], minutes: online.homeS.minutes, nextId: 1 };
  // arrive at the first free tile at the lot's front edge
  const occ = occupancy(); let sx = 12, sz = N - 1;
  for (let i = 0; i < N; i++) { const x = (12 + (i % 2 ? -1 : 1) * Math.ceil(i / 2) + N) % N; if (!occ.has(x + "," + (N - 1))) { sx = x; break; } }
  me.x = sx; me.z = sz;
  online.visiting = { lotId: d.lotId, hostSid, hostName: d.name || "host", glb: d.glb || null };
  for (const rt of runtime.values()) simGroup.remove(rt.holder); runtime.clear(); clearRemotes();
  if (d.glb) { try { customCache.set("remote:" + hostSid, prepImported(await parseGlb(b64ToBuf(d.glb)))); } catch (e) {} }
  rebuildLot(); spawnSim(me); selectSim("me"); setMode("live"); focusSim(me);
  setDmTarget(hostSid);
  document.querySelectorAll("#panel-sims [data-sims-mode]").forEach((b) => (b.disabled = b.dataset.simsMode !== "live"));
  $("sims-home").hidden = false;
  setNet("Visiting " + (d.name || "their") + "'s lot (read-only). Tap tiles to walk, tap a sim to DM them.");
  online.lastPost = 0; online.lastPoll = 0;
}
async function leaveVisit(silent) {
  if (!online.visiting) return;
  netLeave();
  S = online.homeS; online.homeS = null; online.visiting = null;
  for (const rt of runtime.values()) simGroup.remove(rt.holder); runtime.clear(); clearRemotes();
  rebuildLot(); for (const sim of S.sims) spawnSim(sim); selectSim(S.sims[0] && S.sims[0].id);
  document.querySelectorAll("#panel-sims [data-sims-mode]").forEach((b) => (b.disabled = false));
  $("sims-home").hidden = true;
  if (!silent) { setMode("live"); setNet("Back home."); publishLot(false); }
}
function currentLotId() { return online.visiting ? online.visiting.lotId : online.lotId; }

// ---- position sync ----
function myNetSim() { return online.visiting ? getSim("me") : getSim(selectedSimId) || S.sims[0]; }
function netLeave() {
  const lot = currentLotId(); const sid = mySid();
  if (!lot || !sid) return;
  try { fetch("/api/sims-lot", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "pos", sid, lot, leave: true }) }); } catch (e) {}
}
function netTick() {
  const lot = currentLotId(); if (!lot || !S) return;
  if (!online.visiting && !sharing()) return;
  const now = performance.now(); const sim = myNetSim(); const rt = sim && runtime.get(sim.id);
  const moving = rt && rt.path && rt.path.length;
  const every = online.pendingSay ? 400 : moving ? 600 : 3000;
  if (rt && !online.posting && now - online.lastPost > every) {
    online.posting = true; online.lastPost = now;
    const p = rt.holder.position;
    const body = { op: "pos", sid: mySid(), lot, name: myName(), sim: (({ sculpt, ...r }) => r)(appearance(sim) || {}), x: +(p.x + N / 2 - 0.5).toFixed(2), z: +(p.z + N / 2 - 0.5).toFixed(2), rot: +rt.holder.rotation.y.toFixed(2), pose: rt.pose, host: !online.visiting };
    if (online.pendingSay) body.say = online.pendingSay;
    api("POST", body).then((d) => { if (d.ok) { if (body.say) online.pendingSay = ""; applyPeople(d.people); } else if (body.say && d.error === "Slow down") {/* retry next tick */} })
      .catch(() => {}).finally(() => (online.posting = false));
  }
  if (!online.polling && now - online.lastPoll > 1000) {
    online.polling = true; online.lastPoll = now;
    api("GET", null, { op: "pos", lot }).then((d) => { if (d.ok) applyPeople(d.people); }).catch(() => {}).finally(() => (online.polling = false));
  }
  if (now - online.lastMailPoll > 4000 && people()) { online.lastMailPoll = now; people().refresh(); }
}
function clearRemotes() { for (const r of online.remotes.values()) remoteGroup.remove(r.holder); online.remotes.clear(); renderOnlineList(); }
function applyPeople(map) {
  if (!map || typeof map !== "object" || !remoteGroup) return;
  const me = mySid(); const seen = new Set();
  for (const [sid, p] of Object.entries(map)) {
    if (sid === me || !p) continue; seen.add(sid);
    let r = online.remotes.get(sid);
    const sig = JSON.stringify(p.sim || {});
    if (!r || r.sig !== sig) {
      if (r) remoteGroup.remove(r.holder);
      const app = Object.assign({ id: "r:" + sid }, p.sim || {});
      const holder = new THREE.Group(); holder.userData.remoteSid = sid;
      const glbSrc = p.host && online.visiting && sid === online.visiting.hostSid ? customCache.get("remote:" + sid) : null;
      const model = glbSrc ? glbSrc.clone(true) : buildSimModel(app);
      model.traverse((c) => (c.userData.remoteSid = sid)); holder.add(model);
      const tag = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 24), new THREE.MeshBasicMaterial({ color: p.host ? "#6fae5a" : "#3a8ee6", side: THREE.DoubleSide }));
      tag.rotation.x = -Math.PI / 2; tag.position.y = 0.06; holder.add(tag);
      const pos = tileCenter(p.x, p.z); holder.position.set(pos.x, 0, pos.z);
      remoteGroup.add(holder);
      r = { holder, model, sig, phase: 0, pose: p.pose, path: [], say: null, sayShownTs: 0 };
      online.remotes.set(sid, r);
    }
    r.name = p.name; r.host = !!p.host; r.target = { x: p.x + 0.5 - N / 2, z: p.z + 0.5 - N / 2, rot: p.rot, pose: p.pose };
    if (p.say && p.say.ts !== r.sayShownTs) { r.sayShownTs = p.say.ts; r.say = { text: p.say.text, until: performance.now() + 6000 }; }
  }
  for (const [sid, r] of online.remotes) if (!seen.has(sid)) { remoteGroup.remove(r.holder); online.remotes.delete(sid); }
  renderOnlineList();
}
function stepRemotes(dt) {
  for (const r of online.remotes.values()) {
    if (!r.target) continue;
    const p = r.holder.position, t = r.target;
    const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
    const yFor = t.pose === "lie" ? 0.55 : t.pose === "shower" ? 0.08 : 0;
    if (d > 6 || reduceMotion && d > 0.01) { p.x = t.x; p.z = t.z; }
    else if (d > 0.02) { const step = Math.min(d, Math.max(2.2, d * 2.5) * dt); p.x += dx / d * step; p.z += dz / d * step; r.holder.rotation.y = Math.atan2(dx, dz); }
    p.y += (yFor - p.y) * Math.min(1, dt * 8);
    if (d <= 0.05) r.holder.rotation.y += (((t.rot - r.holder.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 6);
    r.pose = d > 0.05 ? "walk" : t.pose === "walk" ? "stand" : t.pose;
    animateRt(r, dt);
  }
}

// ---- speech bubbles (textContent only: never HTML) ----
const bubbles = new Map();
function bubbleFor(key) {
  let el = bubbles.get(key);
  if (!el) { el = document.createElement("div"); el.className = "sims-bubble"; $("sims-stage").appendChild(el); bubbles.set(key, el); }
  return el;
}
function sayLocal(simId, text, ms) { const rt = runtime.get(simId); if (rt) rt.say = { text, until: performance.now() + (ms || 6000) }; }
function updateBubbles() {
  const now = performance.now(); const live = new Set(); const rect = renderer.domElement.getBoundingClientRect(); const wrap = $("sims-stage").getBoundingClientRect();
  const place = (key, holder, say, name) => {
    if (!say || say.until < now) return;
    live.add(key); const el = bubbleFor(key);
    const v = new THREE.Vector3(); holder.getWorldPosition(v); v.y += 2.1; v.project(camera);
    if (v.z > 1) { el.hidden = true; return; }
    el.hidden = false;
    const label = (name ? name + ": " : "") + say.text;
    if (el.textContent !== label) el.textContent = label;
    el.style.left = (rect.left - wrap.left + (v.x + 1) / 2 * rect.width) + "px";
    el.style.top = (rect.top - wrap.top + (1 - v.y) / 2 * rect.height) + "px";
  };
  for (const [id, rt] of runtime) place("l:" + id, rt.holder, rt.say, "");
  for (const [sid, r] of online.remotes) place("r:" + sid, r.holder, r.say, r.name);
  for (const [k, el] of bubbles) if (!live.has(k)) { el.remove(); bubbles.delete(k); }
}

// ---- DMs (existing server-people mail) ----
function setDmTarget(sid) {
  online.dmTarget = sid || ""; const sel = $("sims-dm-to"); renderOnlineList(); if (sel) sel.value = online.dmTarget; renderDmThread();
}
function nameOfSid(sid) {
  const r = online.remotes.get(sid); if (r && r.name) return r.name;
  if (online.visiting && sid === online.visiting.hostSid) return online.visiting.hostName;
  const p = people(); const row = p && p.people().find((x) => x.sid === sid); return row ? row.name : "guest";
}
function renderOnlineList() {
  const sel = $("sims-dm-to"); if (!sel) return;
  const opts = new Map();
  if (online.visiting) opts.set(online.visiting.hostSid, online.visiting.hostName + " (host)");
  for (const [sid, r] of online.remotes) opts.set(sid, (r.name || "guest") + (r.host ? " (host)" : ""));
  const p = people(); if (p) for (const row of p.people()) if (row.online && row.sid !== mySid() && !opts.has(row.sid)) opts.set(row.sid, row.name + " · " + (row.tab || ""));
  if (online.dmTarget && !opts.has(online.dmTarget)) opts.set(online.dmTarget, nameOfSid(online.dmTarget));
  const sig = JSON.stringify([...opts]) + online.dmTarget;
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig; sel.textContent = "";
    const none = document.createElement("option"); none.value = ""; none.textContent = opts.size ? "Choose someone…" : "Nobody online yet"; sel.appendChild(none);
    for (const [sid, label] of opts) { const o = document.createElement("option"); o.value = sid; o.textContent = label; sel.appendChild(o); }
    sel.value = online.dmTarget;
  }
  const here = $("sims-here"); if (here) here.textContent = online.remotes.size ? online.remotes.size + " other" + (online.remotes.size > 1 ? "s" : "") + " on this lot" : currentLotId() ? "Nobody else on this lot right now" : "";
}
function renderDmThread() {
  const box = $("sims-dm-thread"); if (!box) return; const p = people(); const me = mySid(); const them = online.dmTarget;
  box.textContent = "";
  if (!p || !them) return;
  const rows = p.mail().filter((m) => (m.from === me && m.to === them) || (m.from === them && m.to === me)).slice(-20);
  for (const m of rows) { const li = document.createElement("li"); li.className = m.from === me ? "is-me" : ""; const b = document.createElement("b"); b.textContent = (m.from === me ? "You" : m.fromName || nameOfSid(them)) + ": "; li.appendChild(b); li.appendChild(document.createTextNode(m.text || "")); box.appendChild(li); }
  box.scrollTop = box.scrollHeight;
}
window.addEventListener("l7in-mail", (e) => {
  const mail = (e.detail && e.detail.mail) || []; const me = mySid(); const first = !online.mailPrimed; online.mailPrimed = true;
  for (const m of mail) {
    if (!m || online.seenMail.has(m.id)) continue; online.seenMail.add(m.id);
    if (first || m.to !== me) continue;
    const r = online.remotes.get(m.from);
    if (r) r.say = { text: "(DM) " + m.text, until: performance.now() + 7000 };
    else if (ready) setNet("DM from " + (m.fromName || "someone") + ": " + m.text);
    if (!online.dmTarget) setDmTarget(m.from);
  }
  renderDmThread(); renderOnlineList();
});
const sendGate = { at: 0 };
async function sendDm() {
  const inp = $("sims-dm-text"); const text = inp.value.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!text || !online.dmTarget) { setNet(online.dmTarget ? "Type a message" : "Choose who to message"); return; }
  if (performance.now() - sendGate.at < 1500) { setNet("Slow down a moment…"); return; }
  const p = people(); if (!p) { setNet("Messaging isn't available on this page."); return; }
  sendGate.at = performance.now();
  const d = await p.sendDm(online.dmTarget, text).catch(() => null);
  if (d && d.ok) { inp.value = ""; const me = myNetSim(); if (me) sayLocal(me.id, "(DM → " + nameOfSid(online.dmTarget) + ") " + text); renderDmThread(); }
  else setNet("DM failed: " + ((d && d.error) || "network"));
}
function sayOut() {
  const inp = $("sims-say-text"); const text = inp.value.replace(/\s+/g, " ").trim().slice(0, 140); if (!text) return;
  if (!currentLotId()) { setNet("Share your lot (or visit one) to talk out loud."); return; }
  if (performance.now() - sendGate.at < 1500) { setNet("Slow down a moment…"); return; }
  sendGate.at = performance.now(); online.pendingSay = text; online.lastPost = 0; inp.value = "";
  const me = myNetSim(); if (me) sayLocal(me.id, text);
}
function bindOnline() {
  $("sims-home").onclick = () => leaveVisit(false);
  $("sims-dm-to").onchange = (e) => setDmTarget(e.target.value);
  $("sims-dm-send").onclick = sendDm; $("sims-say-send").onclick = sayOut;
  $("sims-dm-text").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); sendDm(); } };
  $("sims-say-text").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); sayOut(); } };
  const share = $("sims-share"); share.checked = sharing();
  share.onchange = () => { try { localStorage.setItem(SHARE_KEY, share.checked ? "on" : "off"); } catch (e) {} if (share.checked) publishLot(true); else { netLeave(); setNet("Lot not shared."); } };
  window.addEventListener("pagehide", netLeave);
  setInterval(renderOnlineList, 5000);
}

const panel = document.getElementById("panel-sims");
if (panel && !panel.hidden) show();
