// Sims neighborhood: an endless, seeded street grid streamed in chunks around the camera.
// Every chunk is rebuilt from its coordinates, so the same street always looks the same.
// Shared online lots are placed into nearby chunks with a name sign you can tap to visit.
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as G from "./sims-gen.js?v=3";

export const CH = 36;          // chunk size (meters)
const LOT = 13.5, WALK = 15, ROAD = 18; // lot edge, sidewalk outer edge, road center (chunk border)
const chunkKey = (i, j) => i + "," + j;
const seedOf = (i, j) => G.hashStr("chunk:" + i + ":" + j);

// windows glow at night: one shared material whose intensity the day cycle drives
export const WINDOW_GLOW = G.M("#ffd58a", { emissive: "#ffb85a", ei: 0.05, rough: 0.2, name: "Window_Glow" });
const WIN_DARK = G.M("#2a3440", { rough: 0.1, metal: 0.4, name: "Window_Glass" });

function addBox(g, w, h, d, mat, x, y, z, ry) { const m = G.mesh(G.rbox(w, h, d, 0.004), mat, x, y + h / 2, z, g); if (ry) m.rotation.y = ry; return m; }
function plane(g, w, d, mat, x, y, z) { const m = new T.Mesh(new T.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; g.add(m); return m; }

// merge every mesh under `src` into one mesh per material (fast to draw, cheap on phones)
function mergeByMaterial(src, keepNames) {
  src.updateMatrixWorld(true);
  const buckets = new Map(), keep = [];
  src.traverse((o) => {
    if (o.isLight) { keep.push(o); return; }
    if (!o.isMesh) return;
    if (keepNames && o.userData.keep) { keep.push(o); return; }
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute("uv", new T.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.applyMatrix4(o.matrixWorld);
    const list = buckets.get(o.material) || []; list.push(geo); buckets.set(o.material, list);
  });
  const out = new T.Group();
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false); geos.forEach((g) => g.dispose()); if (!merged) continue;
    const m = new T.Mesh(merged, mat); m.castShadow = !mat.transparent; m.receiveShadow = true; m.name = "Merged_" + mat.name; out.add(m);
  }
  for (const k of keep) { const wp = new T.Vector3(), wq = new T.Quaternion(), ws = new T.Vector3(); k.matrixWorld.decompose(wp, wq, ws); k.removeFromParent(); k.position.copy(wp); k.quaternion.copy(wq); k.scale.copy(ws); out.add(k); }
  return out;
}

const MAT = {
  grass: (s) => G.TM("grass", s % 5, ["#4f7a3a", "#5a8a3e", "#4a7238", "#62894a", "#557f3c"][s % 5], null, { rough: 1, name: "Grass", rep: [6, 6] }),
  walk: () => G.TM("sidewalk", 1, "#b8b2a6", null, { rough: 0.95, name: "Sidewalk", rep: [1, 12] }),
  walkZ: () => G.TM("sidewalk", 1, "#b8b2a6", null, { rough: 0.95, name: "Sidewalk", rep: [12, 1] }),
  road: () => G.TM("asphalt", 1, "#3a3a3c", null, { rough: 0.95, name: "Asphalt", rep: [3, 18] }),
  roadZ: () => G.TM("asphalt", 1, "#3a3a3c", null, { rough: 0.95, name: "Asphalt", rep: [18, 3] }),
  line: () => G.M("#e8c84a", { rough: 0.6, name: "Road_Line" }),
  path: () => G.TM("pavers", 2, "#a89a88", null, { rough: 0.9, name: "Path" }),
};

function streets(g, i, j) {
  const s = seedOf(i, j);
  plane(g, LOT * 2, LOT * 2, MAT.grass(s), 0, 0, 0);
  // sidewalks (ring between LOT and WALK) and half-roads (ring between WALK and ROAD)
  for (const sx of [-1, 1]) { plane(g, WALK - LOT, WALK * 2, MAT.walk(), sx * (LOT + WALK) / 2, 0.03, 0); plane(g, ROAD - WALK, ROAD * 2, MAT.road(), sx * (WALK + ROAD) / 2, 0.005, 0); }
  for (const sz of [-1, 1]) { plane(g, LOT * 2, WALK - LOT, MAT.walkZ(), 0, 0.03, sz * (LOT + WALK) / 2); plane(g, WALK * 2, ROAD - WALK, MAT.roadZ(), 0, 0.006, sz * (WALK + ROAD) / 2); }
  // curbs
  const curb = G.M("#9a958c", { rough: 0.9, name: "Curb" });
  for (const sx of [-1, 1]) addBox(g, 0.15, 0.12, WALK * 2, curb, sx * WALK, 0, 0);
  for (const sz of [-1, 1]) addBox(g, WALK * 2, 0.12, 0.15, curb, 0, 0, sz * WALK);
  // center dashes on the +x and +z borders (the neighbor draws the others)
  for (let k = -ROAD + 1; k < ROAD; k += 3) { addBox(g, 0.15, 0.01, 1.4, MAT.line(), ROAD, 0.006, k); addBox(g, 1.4, 0.01, 0.15, MAT.line(), k, 0.007, ROAD); }
  // street trees + lamp posts along the verge
  const t = G.tools(G.rng(s ^ 0x51ab));
  const leaf = G.TM("leaves", s % 7, t.pick(["#3c7a3a", "#4f8a3a", "#2f6b4f", "#6a8a2a", "#8a6a2a"]), null, { rough: 0.9, name: "Leaves" });
  for (const side of [0, 1, 2, 3]) for (let k = -10; k <= 10; k += 10) {
    const x = side < 2 ? (side ? 1 : -1) * (LOT + 0.75) : k + t.rr(-1, 1), z = side < 2 ? k + t.rr(-1, 1) : (side === 2 ? -1 : 1) * (LOT + 0.75);
    if (t.chance(0.65)) { const tg = new T.Group(); tg.position.set(x, 0, z); G.genTree(tg, t, 0, t.rr(3, 5.5), leaf); g.add(tg); }
  }
  for (const [x, z] of [[LOT + 1.1, LOT + 1.1], [-LOT - 1.1, -LOT - 1.1]]) {
    const pole = G.M("#2b2b2b", { metal: 0.6, rough: 0.4, name: "Lamp_Post" });
    G.mesh(G.cyl(0.06, 0.08, 4, 8), pole, x, 2, z, g); G.mesh(G.sph(0.22, 12, 8), WINDOW_GLOW, x, 4.1, z, g);
  }
}

function house(g, t) {
  const stories = t.chance(0.35) ? 2 : 1, W = t.ri(7, 12), D = t.ri(6, 9), H = 2.8 * stories;
  const cx = t.rr(-2.5, 2.5), cz = t.rr(-4, -0.5);
  const kind = t.pick(["siding", "siding", "brick", "stone", "plaster", "panel"]);
  const wallC = t.pick(kind === "brick" ? ["#a8574a", "#8e4a3a", "#b87a5a", "#6b3a2f", "#c9b8a0"] : ["#e8e0d2", "#c9d6df", "#f0d6a0", "#a8c0a0", "#d7c3a1", "#7d8a96", "#f5f2ea", "#d08aa0", "#9ab0c8", "#e0b04a", "#5a6a7a"]);
  const wm = G.TM(kind, t.ri(1, 40), wallC, null, { rough: 0.9, name: "House_" + kind, rep: [Math.round(W / 3), stories] });
  const hg = new T.Group(); hg.position.set(cx, 0, cz); g.add(hg);
  addBox(hg, W + 0.4, 0.35, D + 0.4, G.M("#8a857c", { rough: 0.9, name: "Foundation" }), 0, 0, 0);
  addBox(hg, W, H, D, wm, 0, 0.3, 0);
  const trim = G.M(t.pick(["#f5f2ea", "#2b2724", "#5a4632", "#e8e0d2", "#3a4a5a"]), { rough: 0.6, name: "Trim" });
  // windows on all four sides
  for (let s = 0; s < stories; s++) {
    const y = 0.3 + s * 2.8 + 1.0;
    for (const [len, axis, sign] of [[W, "z", 1], [W, "z", -1], [D, "x", 1], [D, "x", -1]]) {
      const n = Math.max(1, Math.floor(len / 2.6));
      for (let k = 0; k < n; k++) {
        const off = -len / 2 + (k + 0.5) * len / n;
        if (axis === "z" && sign === 1 && s === 0 && Math.abs(off) < 1.2) continue; // door
        const glow = t.chance(0.45) ? WINDOW_GLOW : WIN_DARK;
        if (axis === "z") { addBox(hg, 1.1, 1.2, 0.06, glow, off, y, sign * (D / 2 + 0.01)); addBox(hg, 1.3, 0.1, 0.12, trim, off, y - 0.08, sign * (D / 2 + 0.03)); }
        else { addBox(hg, 0.06, 1.2, 1.1, glow, sign * (W / 2 + 0.01), y, off); addBox(hg, 0.12, 0.1, 1.3, trim, sign * (W / 2 + 0.03), y - 0.08, off); }
      }
    }
  }
  const doorC = t.pick(["#8b3a3a", "#2f6b4f", "#3a6ea5", "#1d1a18", "#c9a227", "#6b4a2e", "#f5f2ea"]);
  addBox(hg, 1.0, 2.1, 0.08, G.M(doorC, { rough: 0.5, name: "Front_Door" }), 0, 0.3, D / 2 + 0.02);
  addBox(hg, 1.25, 0.12, 0.14, trim, 0, 2.4, D / 2 + 0.04);
  if (t.chance(0.6)) { addBox(hg, 2.4, 0.12, 1.4, trim, 0, 2.85, D / 2 + 0.7); for (const s of [-1, 1]) addBox(hg, 0.12, 2.6, 0.12, trim, s * 1.1, 0.3, D / 2 + 1.3); }
  // roof
  const roofC = t.pick(["#4a3a32", "#3a3f4a", "#7a3a2a", "#2b2b2b", "#5a6a5a", "#8a6a4a", "#3a4a6a"]);
  const rm = G.TM("shingle", t.ri(1, 20), roofC, null, { rough: 0.95, name: "Roof", side: true });
  const style = t.pick(["gable", "gable", "hip", "flat", "shed"]), top = 0.3 + H, rh = t.rr(1.4, 2.6);
  if (style === "gable" || style === "shed") {
    const sh = new T.Shape(); const hw = W / 2 + 0.4;
    if (style === "gable") { sh.moveTo(-hw, 0); sh.lineTo(hw, 0); sh.lineTo(0, rh); sh.closePath(); }
    else { sh.moveTo(-hw, 0); sh.lineTo(hw, 0); sh.lineTo(hw, 0.3); sh.lineTo(-hw, rh); sh.closePath(); }
    const geo = new T.ExtrudeGeometry(sh, { depth: D + 0.8, bevelEnabled: false }); geo.translate(0, 0, -(D + 0.8) / 2);
    const m = new T.Mesh(geo, rm); m.position.set(0, top, 0); m.castShadow = true; m.receiveShadow = true; hg.add(m);
    if (t.chance(0.5)) addBox(hg, 0.6, rh + 0.6, 0.6, G.TM("brick", 3, "#8e4a3a", null, { name: "Chimney" }), W / 4, top, -D / 4);
  } else if (style === "hip") {
    const m = G.mesh(G.cone(1, 1, 4), rm, 0, top + rh / 2, 0, hg); m.rotation.y = Math.PI / 4; m.scale.set((W + 0.8) / Math.SQRT2, rh, (D + 0.8) / Math.SQRT2);
  } else { addBox(hg, W + 0.3, 0.25, D + 0.3, G.M("#6a6a6a", { rough: 0.9, name: "Roof_Flat" }), 0, top, 0); addBox(hg, W + 0.3, 0.5, 0.15, trim, 0, top, D / 2 + 0.1); }
  return { cx, cz, W, D };
}

function yard(g, t, h, s) {
  // path from the front door to the sidewalk
  const pz0 = h.cz + h.D / 2, len = LOT - pz0;
  if (len > 0) { const p = plane(g, 1.4, len, MAT.path(), h.cx, 0.02, pz0 + len / 2); p.material = G.TM("pavers", 2, "#a89a88", null, { name: "Path", rep: [1, Math.max(1, Math.round(len / 1.4))] }); }
  if (t.chance(0.5)) { const dl = LOT - (h.cz - h.D / 2); plane(g, 3, dl, G.TM("concrete", 4, "#8a8780", null, { name: "Driveway", rep: [1, Math.round(dl / 3)] }), h.cx + (h.cx > 0 ? -1 : 1) * (h.W / 2 + 2), 0.015, h.cz - h.D / 2 + dl / 2); }
  // fence on sides and back (front sometimes)
  const fk = t.pick(["picket", "rail", "hedge", "none"]);
  if (fk !== "none") {
    const f = (len, x, z, ry) => { const fg = G.buildFence(len, t, fk); fg.position.set(x, 0, z); fg.rotation.y = ry; g.add(fg); };
    f(LOT * 2 - 0.6, 0, -LOT + 0.4, 0); f(LOT * 2 - 0.6, -LOT + 0.4, 0, Math.PI / 2); f(LOT * 2 - 0.6, LOT - 0.4, 0, Math.PI / 2);
    if (t.chance(0.4)) { f(LOT - 1.4 + h.cx, (-LOT + h.cx - 1) / 2 + 0.3, LOT - 0.4, 0); f(LOT - 1.4 - h.cx, (LOT + h.cx + 1) / 2 - 0.3, LOT - 0.4, 0); }
  }
  // trees, bushes, flower beds, avoiding the house
  const leaf = G.TM("leaves", s % 9, t.pick(["#3c7a3a", "#4f8a3a", "#2f6b4f", "#6a9a3a", "#7a5a2a", "#a04a3a"]), null, { rough: 0.9, name: "Leaves" });
  const inHouse = (x, z, pad) => Math.abs(x - h.cx) < h.W / 2 + pad && Math.abs(z - h.cz) < h.D / 2 + pad;
  for (let k = 0; k < t.ri(2, 7); k++) { const x = t.rr(-LOT + 1.5, LOT - 1.5), z = t.rr(-LOT + 1.5, LOT - 1.5); if (inHouse(x, z, 2) || Math.abs(x - h.cx) < 1.5 && z > h.cz) continue; const tg = new T.Group(); tg.position.set(x, 0, z); G.genTree(tg, t, 0, t.rr(2.5, 6), leaf); g.add(tg); }
  for (let k = 0; k < t.ri(2, 8); k++) { const x = t.rr(-LOT + 1, LOT - 1), z = t.rr(-LOT + 1, LOT - 1); if (inHouse(x, z, 0.6)) continue; G.mesh(G.ico(t.rr(0.4, 0.8), 1), leaf, x, 0.35, z, g).scale.y = 0.7; }
  const bed = new T.Group(); bed.position.set(h.cx - h.W / 4, 0, h.cz + h.D / 2 + 0.8); G.flowers(bed, t, Math.max(1, h.W / 2 - 1.5), 0.8, 0, t.ri(8, 20)); g.add(bed);
  if (t.chance(0.6)) { const mb = new T.Group(); mb.position.set(h.cx + 1.4, 0, LOT - 0.5); G.mesh(G.cyl(0.04, 0.04, 1.1, 6), G.M("#5a4632"), 0, 0.55, 0, mb); G.mesh(G.rbox(0.25, 0.25, 0.45, 0.06), G.M(t.pick(["#2b2b2b", "#3a6ea5", "#8b3a3a"]), { name: "Mailbox" }), 0, 1.2, 0, mb); g.add(mb); }
  // a few procedural yard items
  for (let k = 0; k < t.ri(0, 3); k++) { const cat = t.pick(["bench", "grill", "planter", "swing", "lantern", "hottub"]); const o = G.buildGen(G.genType(cat, t.ri(1, 1e6))); const x = t.rr(-LOT + 2.5, LOT - 2.5), z = t.rr(-LOT + 2.5, h.cz - h.D / 2 - 1); if (inHouse(x, z, 1.5) || z > LOT - 3) continue; o.position.set(x, 0, z); o.rotation.y = t.ri(0, 3) * Math.PI / 2; o.traverse((c) => { if (c.isLight) c.visible = false; }); g.add(o); }
}

function signTexture(text) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64; const x = c.getContext("2d");
  x.fillStyle = "#f5f0e8"; x.fillRect(0, 0, 256, 64); x.strokeStyle = "#c9a227"; x.lineWidth = 6; x.strokeRect(3, 3, 250, 58);
  x.fillStyle = "#1d1a18"; x.font = "bold 28px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(String(text).slice(0, 16), 128, 34);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
function sharedLot(g, L, t) {
  const lot = L.lot || {}, NN = 24, tc = (x) => x + 0.5 - NN / 2;
  for (const k in lot.floors || {}) { const [x, z] = k.split(",").map(Number); addBox(g, 1, 0.04, 1, G.floorMat(lot.floors[k]), tc(x), 0, tc(z)); }
  for (const k in lot.walls || {}) {
    const w = lot.walls[k]; const [o, xs, zs] = k.split(":"); const x = +xs, z = +zs; const m = G.wallMat(w.c, w.p);
    const cx = o === "h" ? x + 0.5 - NN / 2 : x - NN / 2, cz = o === "h" ? z - NN / 2 : z + 0.5 - NN / 2, ry = o === "v" ? Math.PI / 2 : 0;
    if (w.t === "door") addBox(g, 1.02, 0.5, 0.12, m, cx, 2.1, cz, ry);
    else if (w.t === "window") { addBox(g, 1.02, 0.9, 0.12, m, cx, 0, cz, ry); addBox(g, 1.02, 0.7, 0.12, m, cx, 1.9, cz, ry); addBox(g, 1, 1, 0.03, WINDOW_GLOW, cx, 0.9, cz, ry); }
    else addBox(g, 1.02, 2.6, 0.12, m, cx, 0, cz, ry);
  }
  for (const o of (lot.objects || []).slice(0, 200)) {
    const info = G.genInfo(o.type); if (!info) continue; const m = G.buildGen(o.type); if (!m) continue;
    const W = o.rot % 2 ? info.d : info.w, D = o.rot % 2 ? info.w : info.d;
    m.position.set(o.x + W / 2 - NN / 2, 0, o.z + D / 2 - NN / 2); m.rotation.y = o.rot * Math.PI / 2; m.traverse((c) => { if (c.isLight) c.visible = false; }); g.add(m);
  }
  // their sim, standing by the sign
  const sg = new T.Group(); sg.position.set(0, 0, LOT - 0.6);
  G.mesh(G.cyl(0.05, 0.05, 1.6, 6), G.M("#5a4632"), 0, 0.8, 0, sg);
  const board = new T.Mesh(new T.BoxGeometry(2, 0.5, 0.06), [G.M("#5a4632"), G.M("#5a4632"), G.M("#5a4632"), G.M("#5a4632"), new T.MeshStandardMaterial({ map: signTexture(L.name || "neighbor"), roughness: 0.8, name: "Sign" }), G.M("#5a4632")]);
  board.position.set(0, 1.7, 0); board.castShadow = true; board.userData.keep = true; board.userData.visitSid = L.sid; board.name = "VisitSign"; sg.add(board);
  g.add(sg);
}

export function createWorld(scene, opts = {}) {
  const root = new T.Group(); root.name = "Neighborhood"; scene.add(root);
  const chunks = new Map(), signs = [];
  let radius = opts.radius ?? 1, shared = [], slots = new Map(), queue = [], ownLot = "";
  const npcs = []; let npcMax = opts.npcs ?? 6;
  // shared lots go into the nearest non-home chunks, in a stable order
  const ORDER = []; for (let r = 1; r <= 4; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (Math.max(Math.abs(i), Math.abs(j)) === r) ORDER.push([i, j]);
  ORDER.sort((a, b) => (Math.hypot(...a) - Math.hypot(...b)) || (a[0] - b[0]) || (a[1] - b[1]));
  function buildChunk(i, j) {
    const t = G.tools(G.rng(seedOf(i, j)));
    const raw = new T.Group(); streets(raw, i, j);
    const L = slots.get(chunkKey(i, j));
    if (i === 0 && j === 0) { /* the player's own lot is drawn by the game */ }
    else if (L) sharedLot(raw, L, t);
    else { const content = new T.Group(); content.rotation.y = t.ri(0, 3) * Math.PI / 2; const h = house(content, t); yard(content, t, h, seedOf(i, j)); raw.add(content); }
    const merged = mergeByMaterial(raw, true);
    raw.traverse((o) => { if (o.isMesh && o.geometry && !o.userData.keep) {} });
    merged.position.set(i * CH, 0, j * CH); merged.name = "Chunk_" + i + "_" + j;
    merged.traverse((o) => { if (o.userData.visitSid) signs.push(o); });
    root.add(merged); chunks.set(chunkKey(i, j), merged);
  }
  function dropChunk(k) {
    const c = chunks.get(k); if (!c) return; root.remove(c);
    c.traverse((o) => { if (o.isMesh && o.name.startsWith("Merged_")) o.geometry.dispose(); const si = signs.indexOf(o); if (si >= 0) signs.splice(si, 1); });
    chunks.delete(k);
  }
  function update(center, dt, timeMin) {
    const ci = Math.round(center.x / CH), cj = Math.round(center.z / CH);
    const want = new Set();
    for (let i = ci - radius; i <= ci + radius; i++) for (let j = cj - radius; j <= cj + radius; j++) want.add(chunkKey(i, j));
    for (const k of [...chunks.keys()]) if (!want.has(k)) dropChunk(k);
    queue = [...want].filter((k) => !chunks.has(k)).sort((a, b) => { const [ai, aj] = a.split(",").map(Number), [bi, bj] = b.split(",").map(Number); return Math.hypot(ai - ci, aj - cj) - Math.hypot(bi - ci, bj - cj); });
    if (queue.length) { const [i, j] = queue[0].split(",").map(Number); buildChunk(i, j); } // one chunk per frame keeps it smooth
    stepNpcs(dt, ci, cj);
  }
  // ---- wandering neighbors on the sidewalks ----
  function spawnNpc(ci, cj) {
    const seed = G.randSeed(); const sim = G.randomSim(seed); const model = G.buildSim(sim);
    const holder = new T.Group(); holder.add(model); holder.name = "NPC";
    const i = ci + Math.floor(Math.random() * (2 * radius + 1)) - radius, j = cj + Math.floor(Math.random() * (2 * radius + 1)) - radius;
    const npc = { holder, model, i, j, s: Math.random() * 4 * 29, dir: Math.random() < 0.5 ? 1 : -1, speed: 0.9 + Math.random() * 0.6, phase: Math.random() * 6, J: {} };
    for (const n of ["Joint_HipL", "Joint_HipR", "Joint_ShoulderL", "Joint_ShoulderR"]) npc.J[n] = model.getObjectByName(n);
    root.add(holder); npcs.push(npc);
  }
  const RING = (WALK + LOT) / 2, SIDE = RING * 2, PER = SIDE * 4;
  function ringPos(s) { s = ((s % PER) + PER) % PER; const k = Math.floor(s / SIDE), u = s - k * SIDE - RING; return [[u, -RING, 0], [RING, u, Math.PI / 2], [-u, RING, Math.PI], [-RING, -u, -Math.PI / 2]][k]; }
  function stepNpcs(dt, ci, cj) {
    while (npcs.length < npcMax) spawnNpc(ci, cj);
    while (npcs.length > npcMax) { const n = npcs.pop(); root.remove(n.holder); }
    for (const n of npcs) {
      if (Math.abs(n.i - ci) > radius || Math.abs(n.j - cj) > radius) { n.i = ci + Math.floor(Math.random() * (2 * radius + 1)) - radius; n.j = cj + Math.floor(Math.random() * (2 * radius + 1)) - radius; }
      n.s += n.dir * n.speed * dt; n.phase += dt * 8 * n.speed;
      const [x, z, rot] = ringPos(n.s); n.holder.position.set(n.i * CH + x, 0, n.j * CH + z); n.holder.rotation.y = rot + (n.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      const sw = opts.reduceMotion ? 0 : Math.sin(n.phase) * 0.5;
      if (n.J.Joint_HipL) { n.J.Joint_HipL.rotation.x = sw; n.J.Joint_HipR.rotation.x = -sw; n.J.Joint_ShoulderL.rotation.x = -sw * 0.8; n.J.Joint_ShoulderR.rotation.x = sw * 0.8; }
    }
  }
  function setShared(list, own) {
    ownLot = own || ownLot;
    const next = (list || []).filter((L) => L && L.lotId && L.lotId !== ownLot).sort((a, b) => a.lotId < b.lotId ? -1 : 1).slice(0, ORDER.length);
    const sig = (arr) => arr.map((L) => L.lotId + ":" + L.updatedAt).join("|");
    if (sig(next) === sig(shared)) return;
    shared = next; const old = slots; slots = new Map();
    next.forEach((L, idx) => slots.set(chunkKey(...ORDER[idx]), L));
    for (const k of new Set([...old.keys(), ...slots.keys()])) if (chunks.has(k) && old.get(k) !== slots.get(k)) dropChunk(k);
  }
  function lotOfSign(obj) { let o = obj; while (o) { if (o.userData && o.userData.visitSid) return o.userData.visitSid; o = o.parent; } return null; }
  return {
    root, signs, update, setShared, lotOfSign,
    setRadius(r) { radius = r; }, setNpcs(n) { npcMax = n; },
    sharedSlots: () => [...slots].map(([k, L]) => ({ chunk: k, name: L.name, sid: L.sid })),
    stats: () => ({ chunks: chunks.size, npcs: npcs.length, shared: shared.length, queued: queue.length }),
  };
}
