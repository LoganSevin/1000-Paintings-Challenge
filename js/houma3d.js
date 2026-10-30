// Houma tab, 3D view: the real Terrebonne parcels + OpenStreetMap Houma, drawn with the Sims tab's
// look (sims-gen textures/materials, sims-world trees/lamps/cars/grass/water, sims-life sun + sky,
// sims-night moon/stars/fixture lights). js/houma.js keeps all the game state, keys and the minimap;
// this module only renders it. Loaded lazily by houma.js; if WebGL is missing the 2D view stays.
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as G from "./sims-gen.js?v=3";
import * as W from "./sims-world.js?v=8";
import * as Life from "./sims-life.js?v=5";
import * as NightMod from "./sims-night.js?v=1";

const K = W.Kit, H = window.Houma;
const QUALITY = {
  low: { ratio: 1, shadows: false, map: 512, tex: 128, grass: 1600, view: 280, people: 6, trees: 0.55, lampLights: "low" },
  med: { ratio: 1.5, shadows: true, map: 1024, tex: 256, grass: 6000, view: 440, people: 14, trees: 1, lampLights: "med" },
  high: { ratio: 2, shadows: true, map: 2048, tex: 256, grass: 12000, view: 620, people: 24, trees: 1.25, lampLights: "high" },
};
const isPhone = () => matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hash = (s) => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const pick = (arr, h) => arr[h % arr.length];

let S = null, renderer = null, scene = null, camera = null, sun = null, hemi = null, night = null, stage = null, labelsEl = null;
let qName = "med", qAuto = true, Q = QUALITY.med, tod = "live", built = false, building = false, active = false, failed = false;
let builtHomes = -1, lastRefill = { x: 1e9, z: 1e9, t: -1e9 }, lastGrass = { x: 1e9, z: 1e9, t: 0 }, clock = 0, fpsAcc = { n: 0, t: 0, low: 0 };
const camPos = new T.Vector3(), camLook = new T.Vector3(), tmpV = new T.Vector3(), tmpM = new T.Matrix4(), tmpQ = new T.Quaternion(), tmpS = new T.Vector3(), tmpC = new T.Color(), UP = new T.Vector3(0, 1, 0);

// ---------------------------------------------------------------- materials
let MAT = null;
function materials() {
  if (MAT) return MAT;
  const glass = new T.MeshStandardMaterial({ color: "#26313c", roughness: 0.12, metalness: 0.45, emissive: new T.Color("#ffb860"), emissiveIntensity: 0, name: "H_Glass" });
  MAT = {
    siding: G.TM("siding", 11, "#f3f1ec", null, { rough: 0.85, name: "H_Wall_Siding", rep: [0.4, 0.4] }),
    brick: G.TM("brick", 12, "#efe2da", null, { rough: 0.9, name: "H_Wall_Brick", rep: [0.45, 0.45] }),
    stucco: G.TM("plaster", 13, "#f1eee8", null, { rough: 0.92, name: "H_Wall_Stucco", rep: [0.3, 0.3] }),
    metalWall: G.TM("siding", 14, "#eceef0", null, { rough: 0.5, metal: 0.35, name: "H_Wall_Metal", rep: [0.9, 0.9] }),
    shingle: G.TM("shingle", 15, "#e2e2e2", null, { rough: 0.9, name: "H_Roof_Shingle", rep: [0.45, 0.45] }),
    tin: G.TM("siding", 16, "#e6e6e6", null, { rough: 0.38, metal: 0.55, name: "H_Roof_Tin", rep: [0.8, 0.8] }),
    flat: G.TM("concrete", 17, "#8e8c88", null, { rough: 0.95, name: "H_FlatRoof", rep: [0.12, 0.12] }),
    trim: G.M("#f6f3ec", { rough: 0.6, name: "H_Trim" }),
    found: G.TM("concrete", 18, "#a7a399", null, { name: "H_Found", rep: [0.5, 0.5] }),
    slab: G.TM("concrete", 19, "#bdb8ae", null, { name: "H_Slab", rep: [0.25, 0.25] }),
    lot: G.TM("asphalt", 20, "#3b3d40", null, { rough: 0.95, name: "H_Lot", rep: [0.15, 0.15] }),
    stripe: G.M("#e9e6dc", { rough: 0.7, name: "H_Stripe" }),
    doors: [G.M("#6b2f2a", { rough: 0.5, name: "H_Door_R" }), G.M("#2f4a3a", { rough: 0.5, name: "H_Door_G" }), G.M("#33476a", { rough: 0.5, name: "H_Door_B" }), G.M("#f2efe6", { rough: 0.5, name: "H_Door_W" })],
    shutter: G.M("#2f3b35", { rough: 0.7, name: "H_Shutter" }),
    awn: G.M("#ffffff", { rough: 0.8, name: "H_Awn" }),
    sign: G.M("#ffffff", { rough: 0.5, name: "H_Sign", emissive: "#ffffff", ei: 0.05 }),
    metal: G.M("#8f979d", { rough: 0.45, metal: 0.6, name: "H_Metal" }),
    rollup: G.TM("siding", 21, "#c9cdd1", null, { rough: 0.5, metal: 0.3, name: "H_Rollup", rep: [0.5, 0.5] }),
    post: G.M("#efece4", { rough: 0.6, name: "H_Post" }),
    glass,
  };
  return MAT;
}
const ROLE = (name) => (name.startsWith("H_Wall") ? "wall" : name.startsWith("H_Roof") ? "roof" : name === "H_Awn" ? "awn" : name === "H_Sign" ? "sign" : null);
const PAL = {
  wall: ["#f4efe6", "#e8dcc6", "#dfe6ea", "#cfdcc8", "#f1e2c6", "#d9c7b4", "#c8d3dc", "#efe7d8", "#e6d2c0", "#bcc9b8", "#f6f1e1", "#d6b9a3", "#e9d0b8", "#b9c4cf"],
  brick: ["#b3624a", "#9c5440", "#c27c5e", "#8e4a3a", "#c9a48a", "#a86a52"],
  roof: ["#4a4a4c", "#5a4a3e", "#3e4a56", "#6a4a3a", "#5e6266", "#3a3a3a", "#7a5a44", "#47524a", "#55575c"],
  tin: ["#a3abb0", "#8a4a3a", "#4f6f60", "#b8bcc0", "#5f6f80", "#9a9a92"],
  biz: ["#ece6da", "#d8d2c6", "#c9d2d8", "#e8dcc4", "#d6c2a8", "#bfc6c0", "#efefe9", "#cdb79e"],
  awn: ["#b33a2a", "#2f6b4f", "#3a6ea5", "#c9a227", "#7b4fa0", "#e07a2a", "#a32a4a", "#2a8a8a"],
};

// ---------------------------------------------------------------- template geometry helpers
function prism(w, h, d) { // gable roof: triangle across x, extruded along z, base at y=0
  const s = new T.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
  const g = new T.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); g.translate(0, 0, -d / 2);
  const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i) + p.getX(i) * 0.2, Math.hypot(p.getX(i), p.getY(i)));
  g.computeVertexNormals(); return g;
}
function hipRoof(w, h, d) { const g = new T.ConeGeometry(1, 1, 4, 1); g.rotateY(Math.PI / 4); g.translate(0, 0.5, 0); g.scale(w / Math.SQRT2 * 1, h, d / Math.SQRT2 * 1); g.computeVertexNormals(); const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + p.getZ(i), p.getY(i) * 1.6); return g; }
function gableEnd(w, h) { const s = new T.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath(); const g = new T.ShapeGeometry(s); const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getY(i)); return g; }
const box = (p, w, h, d, mat, x, y, z, rad = 0.02) => G.mesh(G.rbox(w, h, d, rad), mat, x, y + h / 2, z, p);
const plain = (p, w, h, d, mat, x, y, z) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); p.add(m); return m; };
function windowAt(p, M, x, y, z, ry, w = 1.1, h = 1.3, shutters = false) {
  const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = ry; p.add(g);
  plain(g, w + 0.22, h + 0.22, 0.05, M.trim, 0, -0.11, 0.0); plain(g, w, h, 0.06, M.glass, 0, 0, 0.02);
  plain(g, 0.05, h, 0.07, M.trim, 0, 0, 0.03); plain(g, w, 0.05, 0.07, M.trim, 0, h / 2 - 0.02, 0.03);
  if (shutters) { plain(g, 0.36, h + 0.1, 0.05, M.shutter, -w / 2 - 0.3, -0.05, 0.02); plain(g, 0.36, h + 0.1, 0.05, M.shutter, w / 2 + 0.3, -0.05, 0.02); }
}
// residential house. Local frame: front faces +Z, ground at y = 0, centred on the footprint
function houseTemplate(style, Wd, D, v) {
  const M = materials(), g = new T.Group(), raised = style === "acadian" ? 1.0 : 0.3, wallH = style === "acadian" ? 3.0 : 2.8, top = raised + wallH;
  const wall = style === "brick" ? M.brick : M.siding, door = M.doors[v % M.doors.length], sh = style !== "hip";
  box(g, Wd + 0.25, raised, D + 0.25, M.found, 0, 0, 0, 0.02);
  if (style === "acadian") for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.3, raised, 0.3, M.found, sx * (Wd / 2 - 0.3), 0, sz * (D / 2 - 0.3));
  box(g, Wd, wallH, D, wall, 0, raised, 0, 0.02);
  plain(g, Wd + 0.12, 0.16, D + 0.12, M.trim, 0, top - 0.08, 0);
  const roofMat = style === "acadian" ? M.tin : M.shingle;
  if (style === "hip") { const r = new T.Mesh(hipRoof(Wd + 0.9, Wd * 0.22, D + 0.9), roofMat); r.position.y = top; g.add(r); }
  else {
    const rh = style === "acadian" ? D * 0.5 : D * 0.34, r = new T.Mesh(prism(D + 0.9, rh * (D + 0.9) / D, Wd + 0.7), roofMat); // ridge runs along x (eaves front/back)
    r.rotation.y = Math.PI / 2; r.position.y = top; g.add(r);
    for (const sx of [-1, 1]) { const e = new T.Mesh(gableEnd(D, rh), wall); e.rotation.y = sx * Math.PI / 2; e.position.set(sx * Wd / 2, top, 0); g.add(e); }
    if (Wd > 12) box(g, 0.7, rh + 1.2, 0.7, M.brick, Wd * 0.3, top - 0.3, -D * 0.15);
  }
  // door + front windows
  const dx = style === "acadian" ? 0 : -Wd * 0.2;
  plain(g, 1.15, 2.25, 0.06, M.trim, dx, raised, D / 2 + 0.02); plain(g, 0.95, 2.12, 0.08, door, dx, raised, D / 2 + 0.04);
  const fw = []; for (let x = -Wd / 2 + 1.4; x <= Wd / 2 - 1.3; x += 2.3) if (Math.abs(x - dx) > 1.5) fw.push(x);
  for (const x of fw) windowAt(g, M, x, raised + 1.6, D / 2 + 0.03, 0, 1.1, 1.3, sh);
  for (let x = -Wd / 2 + 1.6; x <= Wd / 2 - 1.5; x += 3.2) windowAt(g, M, x, raised + 1.6, -D / 2 - 0.03, Math.PI, 1.0, 1.2);
  for (const sx of [-1, 1]) for (let z = -D / 2 + 1.8; z <= D / 2 - 1.6; z += 3.4) windowAt(g, M, sx * (Wd / 2 + 0.03), raised + 1.6, z, sx * Math.PI / 2, 1.0, 1.2);
  if (style === "acadian") { // full-width raised front porch
    box(g, Wd, 0.15, 2.6, M.post, 0, raised - 0.15, D / 2 + 1.3, 0.01);
    for (let i = 0; i < 4; i++) G.mesh(G.cyl(0.09, 0.09, wallH, 8), M.post, -Wd / 2 + 0.3 + i * (Wd - 0.6) / 3, raised + wallH / 2, D / 2 + 2.45, g);
    const pr = plain(g, Wd + 0.4, 0.12, 3.0, M.tin, 0, top - 0.25, D / 2 + 1.4); pr.rotation.x = 0.16;
    plain(g, Wd - 0.2, 0.08, 0.06, M.post, 0, raised + 0.85, D / 2 + 2.5);
    for (let i = 0; i < 3; i++) box(g, 1.5, 0.2, 0.32, M.found, 0, i * raised / 3, D / 2 + 2.75 + (2 - i) * 0.32, 0.01);
  } else {
    box(g, 1.6, raised, 1.0, M.found, dx, 0, D / 2 + 0.5, 0.01);
    const c = plain(g, 1.8, 0.1, 1.3, roofMat, dx, raised + 2.45, D / 2 + 0.6); c.rotation.x = 0.2;
  }
  // driveway + walk + mailbox
  const drx = Wd / 2 - 1.7; plain(g, 3.2, 0.05, 7.5, M.slab, drx, 0, D / 2 + 3.75 + (style === "acadian" ? 2.4 : 0));
  plain(g, 1.0, 0.05, 6.2, M.slab, dx, 0, D / 2 + (style === "acadian" ? 3.4 : 1.0) + 3.1);
  G.mesh(G.cyl(0.04, 0.04, 1.1, 6), M.post, drx - 2.0, 0.55, D / 2 + 7.2 + (style === "acadian" ? 2.4 : 0), g); plain(g, 0.25, 0.22, 0.45, M.metal, drx - 2.0, 1.05, D / 2 + 7.2 + (style === "acadian" ? 2.4 : 0));
  return { group: g, w: Wd, d: D, h: top, mask: [[-Wd / 2 - 0.4, Wd / 2 + 0.4, -D / 2 - 0.4, D / 2 + (style === "acadian" ? 3.2 : 1.2)], [drx - 1.7, drx + 1.7, D / 2, D / 2 + 7.6 + (style === "acadian" ? 2.4 : 0)]] };
}
function flatTop(g, M, Wd, D, Hh) { plain(g, Wd, 0.12, D, M.flat, 0, Hh, 0); for (const [w, d, x, z] of [[Wd + 0.2, 0.25, 0, D / 2], [Wd + 0.2, 0.25, 0, -D / 2], [0.25, D, Wd / 2, 0], [0.25, D, -Wd / 2, 0]]) plain(g, w, 0.7, d, M.trim, x, Hh, z); }
function lotSlab(g, M, Wd, zFront, depth) { plain(g, Wd, 0.04, depth, M.lot, 0, 0, zFront + depth / 2); for (let x = -Wd / 2 + 1.4; x < Wd / 2 - 1; x += 2.7) plain(g, 0.12, 0.05, 4.8, M.stripe, x, 0.005, zFront + depth - 2.6); }
function bizTemplate(kind) {
  const M = materials(), g = new T.Group();
  if (kind === "shop") {
    const Wd = 16, D = 12, Hh = 4.8; box(g, Wd, Hh, D, M.stucco, 0, 0, 0, 0.02); flatTop(g, M, Wd, D, Hh);
    plain(g, Wd * 0.82, 2.6, 0.06, M.glass, 0, 0.25, D / 2 + 0.03); for (let x = -Wd * 0.41; x <= Wd * 0.41 + 0.01; x += Wd * 0.82 / 4) plain(g, 0.12, 2.7, 0.1, M.metal, x, 0.2, D / 2 + 0.05);
    const a = plain(g, Wd * 0.86, 0.1, 1.7, M.awn, 0, 3.05, D / 2 + 0.8); a.rotation.x = 0.28;
    plain(g, Wd * 0.7, 0.85, 0.12, M.sign, 0, 3.6, D / 2 + 0.08);
    box(g, 1.6, 0.9, 1.2, M.metal, -3, Hh + 0.1, -2); box(g, 1.6, 0.9, 1.2, M.metal, 3.5, Hh + 0.1, 1);
    lotSlab(g, M, Wd + 4, D / 2, 11);
    return { group: g, w: Wd, d: D, h: Hh, mask: [[-Wd / 2 - 2.5, Wd / 2 + 2.5, -D / 2 - 0.5, D / 2 + 11.5]] };
  }
  if (kind === "office") {
    const Wd = 18, D = 14, Hh = 8.4; box(g, Wd, Hh, D, M.stucco, 0, 0, 0, 0.02); flatTop(g, M, Wd, D, Hh);
    for (const y of [1.1, 4.3]) { plain(g, Wd - 1.2, 1.9, 0.06, M.glass, 0, y, D / 2 + 0.03); plain(g, Wd - 1.2, 1.9, 0.06, M.glass, 0, y, -D / 2 - 0.03); for (const sx of [-1, 1]) plain(g, 0.06, 1.9, D - 1.2, M.glass, sx * (Wd / 2 + 0.03), y, 0); }
    plain(g, 4, 0.2, 2.4, M.metal, 0, 3.2, D / 2 + 1.2); for (const sx of [-1, 1]) plain(g, 0.15, 3.2, 0.15, M.metal, sx * 1.9, 0, D / 2 + 2.3);
    plain(g, 6, 0.9, 0.12, M.sign, 0, 6.8, D / 2 + 0.08);
    lotSlab(g, M, Wd + 6, D / 2 + 2.4, 12);
    return { group: g, w: Wd, d: D, h: Hh, mask: [[-Wd / 2 - 3.5, Wd / 2 + 3.5, -D / 2 - 0.5, D / 2 + 15]] };
  }
  if (kind === "church") {
    const Wd = 12, D = 22, Hh = 5.6; box(g, Wd, Hh, D, M.brick, 0, 0, 0, 0.02);
    const r = new T.Mesh(prism(Wd + 0.8, Wd * 0.6, D + 0.6), M.shingle); r.position.y = Hh; g.add(r);
    for (const sz of [-1, 1]) { const e = new T.Mesh(gableEnd(Wd, Wd * 0.55), M.brick); e.position.set(0, Hh, sz * D / 2); if (sz < 0) e.rotation.y = Math.PI; g.add(e); }
    box(g, 3.4, 11, 3.4, M.stucco, 0, 0, D / 2 + 1.2); const sp = G.mesh(G.cone(2.5, 7, 4), M.shingle, 0, 14.5, D / 2 + 1.2, g); sp.rotation.y = Math.PI / 4;
    plain(g, 1.8, 2.6, 0.08, M.doors[0], 0, 0, D / 2 + 2.92);
    for (const sx of [-1, 1]) for (let z = -D / 2 + 2.5; z < D / 2 - 1; z += 3.6) plain(g, 0.06, 2.8, 1.0, M.glass, sx * (Wd / 2 + 0.03), 1.4, z);
    lotSlab(g, M, Wd + 10, D / 2 + 3, 10);
    return { group: g, w: Wd, d: D + 3, h: Hh, mask: [[-Wd / 2 - 5, Wd / 2 + 5, -D / 2 - 0.5, D / 2 + 13.5]] };
  }
  // warehouse / marine / industrial
  const Wd = 24, D = 18, Hh = 6.5; box(g, Wd, Hh, D, M.metalWall, 0, 0, 0, 0.02);
  const r = new T.Mesh(prism(D + 0.6, 1.4, Wd + 0.6), M.tin); r.rotation.y = Math.PI / 2; r.position.y = Hh; g.add(r);
  for (const sx of [-1, 1]) { const e = new T.Mesh(gableEnd(D, 1.4 * D / (D + 0.6)), M.metalWall); e.rotation.y = sx * Math.PI / 2; e.position.set(sx * Wd / 2, Hh, 0); g.add(e); }
  for (const x of [-6, 1]) plain(g, 4, 4.4, 0.08, M.rollup, x, 0, D / 2 + 0.04);
  plain(g, 1, 2.1, 0.08, M.doors[2], 8, 0, D / 2 + 0.04); windowAt(g, M, 10, 1.6, D / 2 + 0.05, 0, 1.4, 1.0);
  plain(g, 7, 1.0, 0.12, M.sign, 6.5, 4.9, D / 2 + 0.08);
  plain(g, Wd + 4, 0.05, 12, M.slab, 0, 0, D / 2 + 6);
  return { group: g, w: Wd, d: D, h: Hh, mask: [[-Wd / 2 - 2.5, Wd / 2 + 2.5, -D / 2 - 0.5, D / 2 + 12.5]] };
}

// ---------------------------------------------------------------- instanced template sets
// Each template is merged by material (sims-world mergeByMaterial) and drawn as one InstancedMesh per
// material; instances are refilled from the homes near the player, so the world is distance-culled.
class Instanced {
  constructor(name, tpl, cap, opts = {}) {
    this.name = name; this.tpl = tpl; this.cap = cap; this.n = 0; this.opts = opts; this.parts = [];
    const merged = K.mergeByMaterial(tpl.group);
    for (const m of merged.children) { if (!m.isMesh) continue; this.parts.push({ geo: m.geometry, mat: m.material, role: opts.noRoles ? null : ROLE(m.material.name || ""), im: null }); }
    this.alloc(cap);
  }
  alloc(cap) {
    this.cap = cap;
    for (const p of this.parts) {
      if (p.im) { p.im.removeFromParent(); p.im.dispose(); }
      const im = new T.InstancedMesh(p.geo, p.mat, cap); im.name = "H_" + this.name + "_" + (p.mat.name || "m"); im.count = 0; im.frustumCulled = false;
      im.castShadow = !p.mat.transparent && !this.opts.noShadow; im.receiveShadow = true; im.instanceMatrix.setUsage(T.DynamicDrawUsage);
      if (p.role) { im.instanceColor = new T.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); im.instanceColor.setUsage(T.DynamicDrawUsage); }
      p.im = im; scene.add(im);
    }
  }
  begin() { this.n = 0; this.pending = []; }
  add(x, y, z, ry, sx, sy, sz, colors) { this.pending.push([x, y, z, ry, sx, sy, sz, colors]); }
  end() {
    const list = this.pending; if (list.length > this.cap) this.alloc(Math.ceil(list.length * 1.4));
    for (let i = 0; i < list.length; i++) {
      const [x, y, z, ry, sx, sy, sz, colors] = list[i]; tmpQ.setFromAxisAngle(UP, ry); tmpS.set(sx, sy, sz); tmpV.set(x, y, z); tmpM.compose(tmpV, tmpQ, tmpS);
      for (const p of this.parts) { p.im.setMatrixAt(i, tmpM); if (p.role && colors && colors[p.role]) p.im.setColorAt(i, tmpC.set(colors[p.role])); }
    }
    for (const p of this.parts) { p.im.count = list.length; p.im.instanceMatrix.needsUpdate = true; if (p.im.instanceColor) p.im.instanceColor.needsUpdate = true; }
    this.n = list.length; this.pending = null;
  }
}

// ---------------------------------------------------------------- spatial helpers
let segGrid = new Map(); const SEG = 40;
function addSeg(ax, ay, bx, by, hw) { const s = { ax, ay, bx, by, hw }; const x0 = Math.floor((Math.min(ax, bx) - hw) / SEG), x1 = Math.floor((Math.max(ax, bx) + hw) / SEG), y0 = Math.floor((Math.min(ay, by) - hw) / SEG), y1 = Math.floor((Math.max(ay, by) + hw) / SEG); for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const k = i * 100003 + j; let L = segGrid.get(k); if (!L) segGrid.set(k, (L = [])); L.push(s); } }
function segDist(s, x, y) { const dx = s.bx - s.ax, dy = s.by - s.ay, L = dx * dx + dy * dy || 1; let t = ((x - s.ax) * dx + (y - s.ay) * dy) / L; t = clamp(t, 0, 1); const px = s.ax + dx * t, py = s.ay + dy * t; return [Math.hypot(x - px, y - py), px, py]; }
function nearestRoad(x, y, R) { let best = null, bd = R; const r = Math.ceil(R / SEG); const ci = Math.floor(x / SEG), cj = Math.floor(y / SEG); for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) { const L = segGrid.get(i * 100003 + j); if (!L) continue; for (const s of L) { const [d, px, py] = segDist(s, x, y); if (d < bd) { bd = d; best = { d, px, py, s }; } } } return best; }
function onRoad(x, y, pad) { const L = segGrid.get(Math.floor(x / SEG) * 100003 + Math.floor(y / SEG)); if (!L) return false; for (const s of L) if (segDist(s, x, y)[0] < s.hw + pad) return true; return false; }
// masks: rectangles (in each instance's local frame) that grass and trees must stay out of
let maskGrid = new Map(); const MG = 25;
function addMask(x, y, ry, sx, sz, rects) {
  const c = Math.cos(ry), s = Math.sin(ry), m = { x, y, c, s, sx, sz, rects }; let R = 0; for (const r of rects) R = Math.max(R, Math.hypot(Math.max(-r[0], r[1]) * sx, Math.max(-r[2], r[3]) * sz));
  for (let i = Math.floor((x - R) / MG); i <= Math.floor((x + R) / MG); i++) for (let j = Math.floor((y - R) / MG); j <= Math.floor((y + R) / MG); j++) { const k = i * 100003 + j; let L = maskGrid.get(k); if (!L) maskGrid.set(k, (L = [])); L.push(m); }
}
function masked(x, y) { const L = maskGrid.get(Math.floor(x / MG) * 100003 + Math.floor(y / MG)); if (!L) return false; for (const m of L) { const dx = x - m.x, dy = y - m.y; const lx = (dx * m.c - dy * m.s) / m.sx, lz = (dx * m.s + dy * m.c) / m.sz; for (const r of m.rects) if (lx > r[0] && lx < r[1] && lz > r[2] && lz < r[3]) return true; } return false; }
// three: rotation.y = ry maps local (lx, lz) to world (lx cos + lz sin, -lx sin + lz cos); world z == houma y
function tileAt(x, y) { return S.worldT(x, y); }

// ---------------------------------------------------------------- static world: ground, water, roads
const ROADW = { motorway: 13, trunk: 12, primary: 11, secondary: 10, tertiary: 8.6, unclassified: 7, residential: 7, living_street: 6, service: 4.6, motorway_link: 6.5, trunk_link: 6.5, primary_link: 6.5, secondary_link: 6, tertiary_link: 6 };
const BIGROAD = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);
function ribbon(pts, hw, off, y, out, uvScale = 1) { // pts: [[x,y],...] houma coords; offset strip [off-hw, off+hw]
  const pos = out.pos, uv = out.uv; let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy); if (L < 0.01) continue;
    const nx = -dy / L, ny = dx / L, e = Math.min(hw * 0.6, 1.5), ex = dx / L * e, ey = dy / L * e; // small overlap hides joints
    const p = (x, yy, s) => [x + nx * (off + s), yy + ny * (off + s)];
    const a0 = p(ax - ex, ay - ey, -hw), a1 = p(ax - ex, ay - ey, hw), b0 = p(bx + ex, by + ey, -hw), b1 = p(bx + ex, by + ey, hw);
    pos.push(a0[0], y, a0[1], b0[0], y, b0[1], a1[0], y, a1[1], a1[0], y, a1[1], b0[0], y, b0[1], b1[0], y, b1[1]);
    const u0 = acc * uvScale, u1 = (acc + L) * uvScale, v0 = 0, v1 = hw * 2 * uvScale; uv.push(u0, v0, u1, v0, u0, v1, u0, v1, u1, v0, u1, v1); acc += L;
  }
}
function meshFrom(out, mat, name, { shadow = false } = {}) {
  if (!out.pos.length) return null;
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(out.pos, 3)); g.setAttribute("uv", new T.Float32BufferAttribute(out.uv, 2));
  if (out.col) g.setAttribute("color", new T.Float32BufferAttribute(out.col, 3));
  g.computeVertexNormals(); const m = new T.Mesh(g, mat); m.name = name; m.receiveShadow = true; m.castShadow = shadow; scene.add(m); return m;
}
// triangles produced by ribbon() wind clockwise seen from above when n points left; make both faces safe
const flatMat = (m) => { m.side = T.DoubleSide; return m; };
function buildGround() {
  const size = 5200, seg = 120, geo = new T.PlaneGeometry(size, size, seg, seg); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, 0);
  const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new T.Color(), A = new T.Color("#6f9a45"), B = new T.Color("#86a752"), C = new T.Color("#5f8a3e"), Dm = new T.Color("#9a9a5a");
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); const n = Math.sin(x * 0.011 + Math.sin(z * 0.007) * 2) * 0.5 + Math.sin(z * 0.013 - x * 0.004) * 0.5; c.copy(A).lerp(n > 0 ? B : C, Math.abs(n) * 0.8); if (Math.sin(x * 0.031 + z * 0.027) > 0.93) c.lerp(Dm, 0.35); col.set([c.r, c.g, c.b], i * 3); }
  geo.setAttribute("color", new T.BufferAttribute(col, 3));
  const tex = G.texture("grass", 7, "#d6e2c0", null, [900, 900]);
  const m = new T.Mesh(geo, new T.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.96, name: "H_Ground" })); m.receiveShadow = true; m.name = "Ground"; scene.add(m);
}
function buildWater() {
  const W1 = { pos: [], uv: [] }, shapes = [];
  for (const f of S.osm.water) {
    const pts = f.p; if (pts.length < 2) continue;
    const closed = pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1;
    if (closed && !/river|canal|stream|bayou/i.test(f.k || "")) { const s = new T.Shape(); pts.forEach((q, i) => (i ? s.lineTo(q[0], -q[1]) : s.moveTo(q[0], -q[1]))); shapes.push(s); }
    else ribbon(pts, 14, 0, 0.06, W1, 0.05);
  }
  const mud = meshFrom({ pos: W1.pos.map((v, i) => v), uv: W1.uv }, flatMat(G.TM("concrete", 31, "#7d7358", null, { rough: 1, name: "H_Bank" })), "WaterBank");
  if (mud) { mud.scale.set(1, 1, 1); mud.position.y = -0.03; }
  const wm = meshFrom(W1, flatMat(K.WATER), "WaterLines"); if (wm) { wm.position.y = 0.02; wm.scale.set(1, 1, 1); }
  if (shapes.length) { const g = new T.ShapeGeometry(shapes); g.rotateX(-Math.PI / 2); const m = new T.Mesh(g, flatMat(K.WATER)); m.position.y = 0.08; m.receiveShadow = true; m.name = "WaterAreas"; scene.add(m); }
  // a wider muddy bank under the river ribbons
  if (mud) { const g = mud.geometry, pos = g.attributes.position; mud.geometry.dispose(); const B = { pos: [], uv: [] }; for (const f of S.osm.water) if (f.p.length >= 2) ribbon(f.p, 17, 0, 0.03, B, 0.2); mud.geometry = new T.BufferGeometry(); mud.geometry.setAttribute("position", new T.Float32BufferAttribute(B.pos, 3)); mud.geometry.setAttribute("uv", new T.Float32BufferAttribute(B.uv, 2)); mud.geometry.computeVertexNormals(); void pos; }
}
let lampSet = null, poolSet = null, eyeSet = null, lamps = [];
function buildRoads() {
  const asphalt = flatMat(G.TM("asphalt", 41, "#45474a", null, { rough: 0.92, name: "H_Asphalt", rep: [0.12, 0.12] }));
  const walk = flatMat(G.TM("sidewalk", 42, "#b8b3a8", null, { rough: 0.9, name: "H_Sidewalk", rep: [0.5, 0.5] }));
  const yellow = flatMat(G.M("#e2b53a", { rough: 0.6, name: "H_LineY" })), white = flatMat(G.M("#ecebe4", { rough: 0.6, name: "H_LineW" }));
  const R = { pos: [], uv: [] }, SW = { pos: [], uv: [] }, LY = { pos: [], uv: [] }, LW = { pos: [], uv: [] }, eyes = [];
  lamps = [];
  for (const f of S.osm.roads) {
    const cls = f.h || "residential", w = ROADW[cls] || 6, hw = w / 2, pts = f.p; if (!pts || pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) addSeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], hw);
    ribbon(pts, hw, 0, 0.04, R, 1);
    if (cls !== "service") { ribbon(pts, 0.9, hw + 1.1, 0.025, SW, 1); ribbon(pts, 0.9, -hw - 1.1, 0.025, SW, 1); }
    // markings + reflectors + lamps along the polyline, skipping the ends (intersections)
    let acc = 0; const total = pts.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);
    let lampSide = hash(f.n || pts[0][0]) & 1;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay); if (L < 0.5) { acc += L; continue; }
      const ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux, ang = Math.atan2(uy, ux);
      for (let s = (9 - (acc % 9)); s < L; s += 9) {
        const at = acc + s; if (at < 9 || at > total - 9) continue; const x = ax + ux * s, y = ay + uy * s;
        if (cls === "service") continue;
        if (BIGROAD.has(cls) && cls !== "tertiary") { for (const o of [-0.14, 0.14]) LY.pos.push(...quad(x + nx * o, y + ny * o, ux, uy, 4.6, 0.11)); }
        else LY.pos.push(...quad(x, y, ux, uy, 3, 0.12));
        if (BIGROAD.has(cls)) for (const o of [-hw + 0.35, hw - 0.35]) LW.pos.push(...quad(x + nx * o, y + ny * o, ux, uy, 4.6, 0.13));
        if (BIGROAD.has(cls) && ((at / 9) | 0) % 2 === 0) eyes.push(x, y, ang);
      }
      if (cls !== "service") for (let s = (38 - (acc % 38)); s < L; s += 38) { const at = acc + s; if (at < 6 || at > total - 6) continue; lampSide ^= 1; const sd = lampSide ? 1 : -1, o = sd * (hw + 0.6); lamps.push({ x: ax + ux * s + nx * o, y: ay + uy * s + ny * o, a: Math.atan2(-ny * sd, -nx * sd) }); }
      acc += L;
    }
  }
  for (const out of [LY, LW]) out.uv = new Array(out.pos.length / 3 * 2).fill(0);
  meshFrom(SW, walk, "Sidewalks"); const rm = meshFrom(R, asphalt, "Roads"); if (rm) rm.material.polygonOffset = true;
  meshFrom(LY, yellow, "LinesYellow"); meshFrom(LW, white, "LinesWhite");
  // cat's-eye reflectors (sims-world CATS_EYE material, instanced)
  const eg = new T.BoxGeometry(0.14, 0.04, 0.1), em = new T.InstancedMesh(eg, W.CATS_EYE, Math.max(1, eyes.length / 3)); em.name = "Reflectors"; em.frustumCulled = false;
  for (let i = 0; i < eyes.length; i += 3) { tmpQ.setFromAxisAngle(UP, -eyes[i + 2]); tmpM.compose(tmpV.set(eyes[i], 0.07, eyes[i + 1]), tmpQ, tmpS.set(1, 1, 1)); em.setMatrixAt(i / 3, tmpM); }
  em.count = eyes.length / 3; scene.add(em); eyeSet = em;
  // parking lots
  const P = []; for (const f of S.osm.parking) { if (f.p.length < 3) continue; const s = new T.Shape(); f.p.forEach((q, i) => (i ? s.lineTo(q[0], -q[1]) : s.moveTo(q[0], -q[1]))); P.push(s); }
  if (P.length) { const g = new T.ShapeGeometry(P); g.rotateX(-Math.PI / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.15, uv.getY(i) * 0.15); const m = new T.Mesh(g, flatMat(G.TM("asphalt", 43, "#55575a", null, { name: "H_Parking" }))); m.position.y = 0.03; m.receiveShadow = true; m.name = "Parking"; scene.add(m); }
  // street lamps: the sims-world lamp, instanced; head faces the road
  const lm = W.lampModel(4.2); lampSet = new Instanced("Lamp", { group: lm.group }, lamps.length + 1, { noRoles: true });
  lampSet.begin(); lampSet.end();
  const pg = new T.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2); poolSet = new T.InstancedMesh(pg, K.LAMP_POOL, lamps.length + 1); poolSet.name = "LampPools"; poolSet.frustumCulled = false; poolSet.renderOrder = 2;
  for (const l of lamps) { l.hx = l.x + Math.cos(l.a) * 0.9; l.hy = l.y + Math.sin(l.a) * 0.9; }
  poolSet.count = 0; poolSet.visible = false; scene.add(poolSet);
}
function quad(x, y, ux, uy, len, hw) { const nx = -uy * hw, ny = ux * hw, lx = ux * len / 2, ly = uy * len / 2, Y = 0.055; const a = [x - lx - nx, Y, y - ly - ny], b = [x + lx - nx, Y, y + ly - ny], c = [x - lx + nx, Y, y - ly + ny], d = [x + lx + nx, Y, y + ly + ny]; return [...a, ...b, ...c, ...c, ...b, ...d]; }

// ---------------------------------------------------------------- buildings
let extraHouses = [], facadeMat = null, tiles = [], houseSets = {}, bizSets = {};
function facadeMaterial() {
  if (facadeMat) return facadeMat;
  const s = 256, cv = document.createElement("canvas"); cv.width = cv.height = s; const x = cv.getContext("2d");
  const ev = document.createElement("canvas"); ev.width = ev.height = s; const e = ev.getContext("2d"); e.fillStyle = "#000"; e.fillRect(0, 0, s, s);
  x.fillStyle = "#f2efe9"; x.fillRect(0, 0, s, s); for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; x.fillRect(Math.random() * s, Math.random() * s, 3, 3); }
  x.fillStyle = "#d9d4ca"; x.fillRect(0, s - 14, s, 14);
  for (let k = 0; k < 2; k++) { const wx = 24 + k * 128, wy = 70, ww = 82, wh = 96; x.fillStyle = "#e7e2d8"; x.fillRect(wx - 6, wy - 6, ww + 12, wh + 14); x.fillStyle = "#2b3743"; x.fillRect(wx, wy, ww, wh); x.fillStyle = "rgba(255,255,255,0.18)"; x.fillRect(wx + 4, wy + 4, ww * 0.35, wh - 8); x.fillStyle = "#e7e2d8"; x.fillRect(wx + ww / 2 - 2, wy, 4, wh); if ((k + 1) % 2) { e.fillStyle = "#fff"; e.fillRect(wx, wy, ww, wh); } else { e.fillStyle = "#555"; e.fillRect(wx, wy, ww, wh); } }
  const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4;
  const et = new T.CanvasTexture(ev); et.colorSpace = T.SRGBColorSpace; et.wrapS = et.wrapT = T.RepeatWrapping;
  facadeMat = new T.MeshStandardMaterial({ map: t, emissiveMap: et, emissive: new T.Color("#ffc27a"), emissiveIntensity: 0, vertexColors: true, roughness: 0.85, name: "H_Facade", side: T.DoubleSide });
  return facadeMat;
}
function polyArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); }
function inPoly(p, x, y) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
const BIZKIND = (h) => { const o = (h.p && (h.p.owner || h.p.o || "")) + " " + (h.p && (h.p.desc || h.p.use || "")); if (/CHURCH|BAPTIST|METHODIST|CATHOLIC|MINISTR|DIOCESE|TEMPLE|GOSPEL|TABERNACLE/i.test(o)) return "church"; if (/BANK|CREDIT UNION|OFFICE|MEDICAL|CLINIC|LAW|INSURANCE|REALTY|HOSPITAL|PARISH|SCHOOL|BOARD|DENTAL|HEALTH|GOVERN|CITY OF|STATE OF|ATTORNEY|CPA|FINANCIAL/i.test(o)) return "office"; if (/WAREHOUSE|INDUSTR|MARINE|OIL|SUPPLY|EQUIP|FABRICAT|TRUCK|ENERG|DRILL|PIPE|STEEL|BOAT|OFFSHORE|MACHINE|TOWING|SHIPYARD|TRANSPORT|WELDING|ELECTRIC|RENTAL/i.test(o)) return "warehouse"; return "shop"; };
function homeSize(h) {
  const p = h.p || {}, sqft = +(p.sqft || p.livingArea || p.area || 0), acres = +(p.acres || 0);
  let a = sqft > 200 ? sqft * 0.0929 * 1.12 : h.biz ? 260 : 150; const lot = acres > 0 ? acres * 4047 : 0; if (lot) a = Math.min(a, lot * 0.55);
  return a;
}
function chooseHouse(h, a) { const hv = hash(h.p && (h.p.id || h.p.pid || h.p.a) || h.x * 7 + h.y), st = hv % 20, style = st < 8 ? "gable" : st < 13 ? "hip" : st < 16 ? "brick" : "acadian"; const w = Math.sqrt(a * 1.3), size = w < 9.6 ? "S" : w < 12.6 ? "M" : "L"; return { key: style + size, hv }; }
const HOUSE_DIMS = { S: [8.5, 7], M: [11, 8.5], L: [14, 10] };
function colorsFor(hv, style, biz) {
  if (biz) return { wall: pick(PAL.biz, hv), roof: pick(PAL.roof, hv >>> 3), awn: pick(PAL.awn, hv >>> 5), sign: pick(PAL.awn, hv >>> 9) };
  return { wall: style === "brick" ? pick(PAL.brick, hv) : pick(PAL.wall, hv), roof: style === "acadian" ? pick(PAL.tin, hv >>> 4) : pick(PAL.roof, hv >>> 4) };
}
function faceRoad(x, y, fallback) { const r = nearestRoad(x, y, 75); if (!r) return { ry: fallback, road: null }; return { ry: Math.atan2(r.px - x, r.py - y), road: r }; }
function buildBuildings() {
  const homes = S.homes;
  // templates (once)
  if (!Object.keys(houseSets).length) {
    for (const st of ["gable", "hip", "brick", "acadian"]) for (const sz of ["S", "M", "L"]) { const [w, d] = HOUSE_DIMS[sz]; houseSets[st + sz] = new Instanced(st + sz, houseTemplate(st, w, d, hash(st + sz)), 64); }
    for (const k of ["shop", "office", "warehouse", "church"]) bizSets[k] = new Instanced(k, bizTemplate(k), 32);
  }
  maskGrid = new Map(); extraHouses = []; for (const h of homes) { h.inst = null; h.fp = false; }
  // OSM footprints: houses that sit in a small footprint get a generated house fitted to it; the rest are extruded
  const fac = facadeMaterial(), roofM = G.TM("concrete", 51, "#d6d3cc", null, { rough: 0.95, name: "H_RoofTile" }), TILE = 250, tileMap = new Map(), fpFit = [];
  for (const f of S.osm.buildings) {
    let p = f.p; if (!p || p.length < 4) continue; if (Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.5) p = p.slice(0, -1);
    const area = polyArea(p); if (area < 12) continue;
    let cx = 0, cy = 0, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9; for (const q of p) { cx += q[0]; cy += q[1]; minx = Math.min(minx, q[0]); maxx = Math.max(maxx, q[0]); miny = Math.min(miny, q[1]); maxy = Math.max(maxy, q[1]); } cx /= p.length; cy /= p.length;
    let res = null, bizH = null; S.nearBuckets(cx, cy, Math.hypot(maxx - minx, maxy - miny) / 2 + 2, (h) => { if (h.fp || !inPoly(p, h.x, h.y)) return; if (h.biz) bizH = bizH || h; else res = res || h; h.fp = true; });
    if (area < 330 && !bizH && (f.z || 0) < 9) { fpFit.push({ p, cx, cy, area, h: res }); continue; }
    // extrude
    const ht = f.z ? clamp(f.z, 3, 60) : area > 2500 ? 7.5 : area > 800 ? 6 : 4.6, hv = hash(cx * 13 + cy), col = new T.Color(pick(PAL.biz, hv));
    const key = Math.floor(cx / TILE) * 1000 + Math.floor(cy / TILE); let t = tileMap.get(key); if (!t) tileMap.set(key, (t = { cx: (Math.floor(cx / TILE) + 0.5) * TILE, cy: (Math.floor(cy / TILE) + 0.5) * TILE, wall: { pos: [], uv: [], col: [] }, roof: [] }));
    let acc = 0; const Wl = t.wall;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue; const u0 = acc / 4.2, u1 = (acc + L) / 4.2, v1 = ht / 3.4; Wl.pos.push(a[0], 0, a[1], b[0], 0, b[1], a[0], ht, a[1], a[0], ht, a[1], b[0], 0, b[1], b[0], ht, b[1]); Wl.uv.push(u0, 0, u1, 0, u0, v1, u0, v1, u1, 0, u1, v1); for (let k = 0; k < 6; k++) Wl.col.push(col.r, col.g, col.b); acc += L; }
    const s = new T.Shape(); p.forEach((q, i) => (i ? s.lineTo(q[0], -q[1]) : s.moveTo(q[0], -q[1]))); const rg = new T.ShapeGeometry(s); rg.rotateX(-Math.PI / 2); rg.translate(0, ht, 0); const uv = rg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.12, uv.getY(i) * 0.12); t.roof.push(rg);
    if (bizH) bizH.label = true;
  }
  for (const t of tiles) { for (const m of t.meshes) { m.removeFromParent(); m.geometry.dispose(); } } tiles = [];
  for (const t of tileMap.values()) { const meshes = [], wm = meshFrom(t.wall, fac, "Facades", { shadow: true }); if (wm) meshes.push(wm); if (t.roof.length) { const g = mergeGeometries(t.roof.map((g) => (g.index ? g.toNonIndexed() : g)), false); const m = new T.Mesh(g, roofM); m.castShadow = true; m.receiveShadow = true; m.name = "FlatRoofs"; scene.add(m); meshes.push(m); } tiles.push({ cx: t.cx, cy: t.cy, meshes }); }
  // fitted houses in small footprints
  for (const fp of fpFit) {
    const p = fp.p; let bestL = 0, ang = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > bestL) { bestL = L; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); } }
    const ca = Math.cos(ang), sa = Math.sin(ang); let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9; for (const q of p) { const dx = q[0] - fp.cx, dy = q[1] - fp.cy, u = dx * ca + dy * sa, v = -dx * sa + dy * ca; a0 = Math.min(a0, u); a1 = Math.max(a1, u); b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
    const cx = fp.cx + ca * (a0 + a1) / 2 - sa * (b0 + b1) / 2, cy = fp.cy + sa * (a0 + a1) / 2 + ca * (b0 + b1) / 2; let Wd = a1 - a0, D = b1 - b0, phi = ang; if (D > Wd) { [Wd, D] = [D, Wd]; phi += Math.PI / 2; }
    const hh = fp.h || { x: cx, y: cy, p: { id: "fp" + Math.round(cx) + "," + Math.round(cy) } }, { key, hv } = chooseHouse(hh, Wd * D), [tw, td] = HOUSE_DIMS[key.replace(/^[a-z]+/, "")];
    let ry = -phi; const fx = Math.sin(ry), fz = Math.cos(ry), r = nearestRoad(cx, cy, 75); if (r && fx * (r.px - cx) + fz * (r.py - cy) < 0) ry += Math.PI;
    const inst = { set: key, x: cx, y: cy, ry, sx: clamp(Wd / tw, 0.6, 1.6), sz: clamp(D / td, 0.6, 1.6), colors: colorsFor(hv, key.replace(/[SML]$/, ""), false) };
    if (fp.h) fp.h.inst = inst; else extraHouses.push(inst);
    addMask(cx, cy, ry, inst.sx, inst.sz, houseSets[key].tpl.mask);
  }
  // every other parcel with a building gets a generated house (or a shop/office/warehouse/church if business-owned)
  for (const h of homes) {
    if (h.fp || h.inst) continue; if (!h.built && !h.biz) continue;
    const a = homeSize(h), hv = hash(h.p && (h.p.id || h.p.pid || h.p.a) || h.x * 7 + h.y);
    if (h.biz) {
      const kind = BIZKIND(h), tpl = bizSets[kind].tpl, s = clamp(Math.sqrt(a / (tpl.w * tpl.d)), 0.7, 1.7);
      const f = faceRoad(h.x, h.y, (hv % 4) * Math.PI / 2); let x = h.x, y = h.y; if (f.road) { const need = f.road.s.hw + 1 + tpl.mask[0][3] * s; if (f.road.d < need) { const k = (need - f.road.d) / Math.max(1e-3, f.road.d); x -= (f.road.px - x) * k; y -= (f.road.py - y) * k; } }
      h.inst = { set: "biz:" + kind, x, y, ry: f.ry, sx: s, sz: s, colors: colorsFor(hv, kind, true) }; addMask(x, y, f.ry, s, s, tpl.mask); h.label = true; continue;
    }
    const { key } = chooseHouse(h, a), [tw, td] = HOUSE_DIMS[key.replace(/^[a-z]+/, "")], tpl = houseSets[key].tpl, w = Math.sqrt(a * 1.3), d = a / w, sx = clamp(w / tw, 0.75, 1.3), sz = clamp(d / td, 0.75, 1.3);
    const f = faceRoad(h.x, h.y, (hv % 4) * Math.PI / 2); let x = h.x, y = h.y;
    if (f.road) { const need = f.road.s.hw + 2.2 + tpl.mask[1][3] * sz; if (f.road.d < need) { const k = (need - f.road.d) / Math.max(1e-3, f.road.d); x -= (f.road.px - x) * k; y -= (f.road.py - y) * k; } }
    h.inst = { set: key, x, y, ry: f.ry, sx, sz, colors: colorsFor(hv, key.replace(/[SML]$/, ""), false) }; addMask(x, y, f.ry, sx, sz, tpl.mask);
  }
  builtHomes = homes.length; lastRefill.x = 1e9; treeCache.clear();
}
function refill(px, py) {
  const R = Q.view, R2 = R * R;
  for (const s of Object.values(houseSets)) s.begin(); for (const s of Object.values(bizSets)) s.begin();
  const put = (i) => { const dx = i.x - px, dy = i.y - py; if (dx * dx + dy * dy > R2) return; const set = i.set.startsWith("biz:") ? bizSets[i.set.slice(4)] : houseSets[i.set]; set.add(i.x, 0, i.y, i.ry, i.sx, 1, i.sz, i.colors); };
  S.nearBuckets(px, py, R, (h) => { if (h.inst) put(h.inst); });
  for (const i of extraHouses) put(i);
  for (const s of Object.values(houseSets)) s.end(); for (const s of Object.values(bizSets)) s.end();
  for (const t of tiles) { const vis = Math.hypot(t.cx - px, t.cy - py) < R + 200; for (const m of t.meshes) m.visible = vis; }
  refillTrees(px, py);
  // street lamps + their light pools, only near the player
  const LR = Math.min(R, 360), LR2 = LR * LR; let n = 0; lampSet.begin();
  for (const l of lamps) { const dx = l.x - px, dy = l.y - py; if (dx * dx + dy * dy > LR2) continue; lampSet.add(l.x, 0, l.y, -l.a, 1, 1, 1); tmpM.compose(tmpV.set(l.hx, 0.09, l.hy), tmpQ.identity(), tmpS.set(9, 1, 9)); poolSet.setMatrixAt(n++, tmpM); }
  lampSet.end(); poolSet.count = n; poolSet.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- trees (sims-world species, instanced) + grass tufts
let treeSets = [], treeCache = new Map(); const TB = 100;
const TREES = [["decid", 9.5], ["decid", 6.5], ["palm", 7.5], ["willow", 8], ["pine", 10], ["shrub", 1.3], ["birch", 8]];
function buildTreeSets() { treeSets = TREES.map(([sp, h], i) => new Instanced("Tree_" + sp + i, { group: W.treeModel(sp, 101 + i * 17, h) }, 128, { noRoles: true })); }
function treesIn(bi, bj) {
  const key = bi * 100003 + bj; if (treeCache.has(key)) return treeCache.get(key);
  const out = [], r = G.rng(hash(key) || 1), x0 = bi * TB, y0 = bj * TB, step = 13;
  for (let x = x0 + step / 2; x < x0 + TB; x += step) for (let y = y0 + step / 2; y < y0 + TB; y += step) {
    const px = x + (r() - 0.5) * step * 0.9, py = y + (r() - 0.5) * step * 0.9, roll = r(), sel = r(), sc = 0.75 + r() * 0.5, ry = r() * 6.28;
    const t = tileAt(px, py); if (t !== S.T.GRASS && t !== S.T.PARK) continue;
    if (roll > (t === S.T.PARK ? 0.5 : 0.24)) continue;
    if (onRoad(px, py, 3) || masked(px, py)) continue;
    const kind = sel < 0.34 ? 0 : sel < 0.52 ? 1 : sel < 0.62 ? 2 : sel < 0.7 ? 3 : sel < 0.76 ? 4 : sel < 0.94 ? 5 : 6; out.push(px, py, kind, ry, sc);
  }
  treeCache.set(key, out); return out;
}
function refillTrees(px, py) {
  const R = Math.min(Q.view, 420), R2 = R * R, dens = Q.trees; for (const s of treeSets) s.begin();
  for (let i = Math.floor((px - R) / TB); i <= Math.floor((px + R) / TB); i++) for (let j = Math.floor((py - R) / TB); j <= Math.floor((py + R) / TB); j++) {
    const L = treesIn(i, j); for (let k = 0; k < L.length; k += 5) { const dx = L[k] - px, dy = L[k + 1] - py, d2 = dx * dx + dy * dy; if (d2 > R2) continue; if (dens < 1 && ((k / 5) % 10) / 10 >= dens && L[k + 2] !== 0) continue; treeSets[L[k + 2]].add(L[k], 0, L[k + 1], L[k + 3], L[k + 4], L[k + 4], L[k + 4]); }
  }
  for (const s of treeSets) s.end();
}
let grass = null;
function buildGrass() {
  const geo = W.grassTuftGeometry(), base = G.M("#ffffff", { rough: 0.95, name: "H_Grass" }), mat = K.sway(base, 0.35, 0.3, "vc");
  grass = new T.InstancedMesh(geo, mat, 14000); grass.name = "GrassTufts"; grass.count = 0; grass.frustumCulled = false; grass.receiveShadow = true; grass.instanceMatrix.setUsage(T.DynamicDrawUsage); scene.add(grass);
}
function scatterGrass(px, py, fwdx, fwdy) {
  const n = Q.grass, Rg = Math.sqrt(n) * 0.75 + 12, r = G.rng(1); let c = 0, tries = 0;
  const cx = px + fwdx * Rg * 0.45, cy = py + fwdy * Rg * 0.45; // biased ahead of the camera
  while (c < n && tries < n * 3) {
    tries++; const ox = Math.floor((cx + (r() - 0.5) * 2 * Rg) / 1.1), oy = Math.floor((cy + (r() - 0.5) * 2 * Rg) / 1.1); // snap to a 1.1 m lattice so tufts don't swim as you move
    const hh = ((ox * 73856093) ^ (oy * 19349663)) >>> 0, x = (ox + ((hh & 255) / 255)) * 1.1, y = (oy + (((hh >>> 8) & 255) / 255)) * 1.1;
    const t = tileAt(x, y); if (t !== S.T.GRASS && t !== S.T.PARK) continue; if (onRoad(x, y, 2.2) || masked(x, y)) continue;
    const s = 0.7 + ((hh >>> 16) & 255) / 255 * 0.7; tmpQ.setFromAxisAngle(UP, ((hh >>> 4) & 255) / 40); tmpM.compose(tmpV.set(x, 0, y), tmpQ, tmpS.set(s, s * (0.8 + ((hh >>> 20) & 15) / 30), s)); grass.setMatrixAt(c++, tmpM);
  }
  grass.count = c; grass.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- vehicles + people
const carObjs = new Map(); const CARKIND = { car: "sedan", truck: "pickup", cop: "sedan", bus: "bus", van: "van", taxi: "taxi" };
function syncCars(px, py, nk) {
  const seen = new Set();
  for (const c of S.cars) {
    if (c.kind === "boat") continue; seen.add(c); let o = carObjs.get(c);
    if (!o) { const kind = c.cop ? "sedan" : CARKIND[c.kind] || pick(["sedan", "hatch", "sedan", "van", "pickup"], hash(c.color || "") ); o = K.carModel(kind, c.cop ? "#e9ebef" : c.color || "#b23a3a"); o.name = "Car"; scene.add(o); carObjs.set(c, o); }
    const far = Math.hypot(c.x - px, c.y - py) > Q.view; o.visible = !far; if (far) continue;
    o.position.set(c.x, 0, c.y); o.rotation.y = -c.a; W.setCarLights(o, nk, (c.v || 0) < 0.3 && nk > 0.2);
  }
  for (const [c, o] of carObjs) if (!seen.has(c)) { o.removeFromParent(); carObjs.delete(c); }
}
const simCache = new Map(); let simLRU = [];
function simFor(key, seed, name) {
  let o = simCache.get(key); if (o) return o;
  const sim = G.randomSim(seed >>> 0 || 7); if (name) sim.name = name; o = G.buildSim(sim); o.traverse((m) => { if (m.isMesh) { m.castShadow = true; } }); o.userData.ph = (seed % 100) / 16;
  simCache.set(key, o); simLRU.push(key); scene.add(o);
  if (simLRU.length > 80) { const k = simLRU.shift(), old = simCache.get(k); if (old) { old.removeFromParent(); simCache.delete(k); } }
  return o;
}
function poseSim(o, moving, t) {
  const sw = moving ? Math.sin(t * 7 + o.userData.ph) * 0.55 : 0;
  o.traverse((j) => { if (!j.name) return; if (j.name === "Joint_HipL") j.rotation.x = sw; else if (j.name === "Joint_HipR") j.rotation.x = -sw; else if (j.name === "Joint_ShoulderL") j.rotation.x = -sw * 0.8; else if (j.name === "Joint_ShoulderR") j.rotation.x = sw * 0.8; });
}
let people = [];
function syncPeople(px, py, t) {
  const want = [], maxD = 90;
  if (!S.player.veh) want.push({ key: "player", seed: 4242, x: S.player.x, y: S.player.y, a: S.player.a, mv: Math.abs(S.player.v || 0) > 0.2, d: 0 });
  for (const r of S.residents) { const d = Math.hypot(r.x - px, r.y - py); if (d < maxD) want.push({ key: r, seed: hash(r.home && r.home.p && (r.home.p.id || r.home.p.a) || r.name), name: r.name, x: r.x, y: r.y, a: r.a, mv: Math.abs(r.v || 0) > 0.05, d, res: r }); }
  for (const p of S.peds) { const d = Math.hypot(p.x - px, p.y - py); if (d < maxD) want.push({ key: p, seed: hash(String(p.hue || 0) + (p.seed || 0)) + (S.peds.indexOf(p) * 977), x: p.x, y: p.y, a: p.a, mv: true, d }); }
  want.sort((a, b) => a.d - b.d); const use = want.slice(0, Q.people + 1), live = new Set();
  for (const w of use) { const o = simFor(w.key, w.seed, w.name); live.add(o); o.visible = true; o.position.set(w.x, 0, w.y); o.rotation.y = Math.atan2(Math.cos(w.a || 0), Math.sin(w.a || 0)); poseSim(o, w.mv, t); }
  for (const o of simCache.values()) if (!live.has(o)) o.visible = false;
  people = use;
}
function updateLabels() {
  if (!labelsEl) return; const out = [], w = stage.clientWidth, h = stage.clientHeight;
  const add = (x, y, z, html, cls) => { tmpV.set(x, y, z).project(camera); if (tmpV.z > 1 || tmpV.z < -1) return; const sx = (tmpV.x + 1) / 2 * w, sy = (1 - tmpV.y) / 2 * h; if (sx < -50 || sx > w + 50 || sy < 0 || sy > h) return; out.push(`<div class="hm3-label ${cls}" style="transform:translate(${sx.toFixed(0)}px,${sy.toFixed(0)}px) translate(-50%,-100%)">${html}</div>`); };
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let n = 0; for (const w of people) { if (!w.res || w.d > 26 || n >= 6) continue; n++; const p = w.res.home && w.res.home.p || {}; add(w.x, 2.25, w.y, `<b>${esc(w.res.name)}</b><span>${esc(p.site || p.addr || p.a || "")}</span>`, "res"); }
  let b = 0; S.nearBuckets(S.player.x, S.player.y, 45, (hm) => { if (b >= 3 || !hm.biz || !hm.inst) return; const d = Math.hypot(hm.inst.x - S.player.x, hm.inst.y - S.player.y); if (d > 45) return; b++; const p = hm.p || {}; add(hm.inst.x, 7.5, hm.inst.y, `<b>${esc(p.owner || p.o || "Business")}</b><span>${esc(p.site || p.addr || "")}</span>`, "biz"); });
  labelsEl.innerHTML = out.join("");
}

// ---------------------------------------------------------------- lighting / sky / quality
const fixtures = []; // dummy objects placed at the nearest lamp heads for sims-night's spotlight pool
function hoursNow() { if (tod === "day") return 13.2; if (tod === "dusk") return null; if (tod === "night") return 22.5; if (typeof tod === "number") return tod; const d = new Date(); return d.getHours() + d.getMinutes() / 60; }
function duskHour(d) { for (let h = 16; h < 21; h += 0.05) if (Life.sunAt(d, h).elev < 1.5) return h; return 18.5; }
let sunDir = new T.Vector3(0, 1, 0), nightK = 0;
function lighting(dt, target) {
  const d = new Date(); let hrs = hoursNow(); if (hrs == null) hrs = duskHour(d);
  const s = Life.sunAt(d, hrs), el = s.elev; NightMod.dirFrom(el, s.az, sunDir);
  const nk = clamp((2 - el) / 8, 0, 1); nightK = nk;
  const sky = Life.skyColor(el); scene.background.copy(sky); scene.fog.color.copy(sky); K.U.uSky.value.copy(sky);
  const dayK = clamp((el + 4) / 18, 0, 1), sunK = clamp(el / 10, 0, 1);
  sun.intensity = 0.15 + sunK * 2.4; sun.color.set(el < 12 ? "#ffc98e" : "#fff4e2"); sun.color.lerp(new T.Color("#9fb4ff"), nk * 0.6);
  hemi.intensity = 0.18 + dayK * 0.85; hemi.color.copy(sky).lerp(new T.Color("#ffffff"), 0.4); hemi.groundColor.set("#4d5a3a").lerp(new T.Color("#141a22"), nk);
  const lightDir = el > -2 ? sunDir : tmpV.set(0.3, 0.9, 0.2).normalize(); sun.position.copy(target).addScaledVector(lightDir, 120); sun.target.position.copy(target); sun.target.updateMatrixWorld();
  renderer.toneMappingExposure = 0.95 + nk * 0.15;
  W.setNight(nk); W.WINDOW_GLOW.emissiveIntensity = 0.05 + nk * 1.6; materials().glass.emissiveIntensity = nk * 1.25; facadeMat && (facadeMat.emissiveIntensity = nk * 1.1); materials().sign.emissiveIntensity = 0.05 + nk * 0.5;
  if (poolSet) poolSet.visible = nk > 0.15;
  // nearest lamps feed the night module's real spotlights
  if (night) {
    const near = lamps.map((l) => [Math.hypot(l.hx - target.x, l.hy - target.z), l]).filter((a) => a[0] < 70).sort((a, b) => a[0] - b[0]).slice(0, 8);
    while (fixtures.length < 8) { const o = new T.Object3D(); o.name = "LampFixture"; scene.add(o); fixtures.push(o); }
    const sources = []; near.forEach(([, l], i) => { fixtures[i].position.set(l.hx, 4.2, l.hy); fixtures[i].updateMatrixWorld(); sources.push({ obj: fixtures[i], kind: "lamp", on: nk }); });
    night.update({ sunDir, sunElev: el, moonInfo: NightMod.moonAt(Life.sunAt, d, hrs), camera, target, sources, dt });
  }
}
function applyQuality(name) {
  qName = name; Q = QUALITY[name]; renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.ratio)); renderer.shadowMap.enabled = Q.shadows;
  sun.castShadow = Q.shadows; sun.shadow.mapSize.set(Q.map, Q.map); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  const sc = name === "high" ? 80 : 60; Object.assign(sun.shadow.camera, { left: -sc, right: sc, top: sc, bottom: -sc, near: 1, far: 320 }); sun.shadow.camera.updateProjectionMatrix();
  camera.far = Q.view + 450; camera.updateProjectionMatrix(); scene.fog.near = Q.view * 0.35; scene.fog.far = Q.view;
  if (night) night.setQuality(Q.lampLights); lastRefill.x = 1e9; lastGrass.x = 1e9; resize(); scene.traverse((o) => { if (o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; });
  const sel = document.getElementById("hm3-qual"); if (sel && !qAuto) sel.value = name;
}
function resize() { if (!renderer || !stage) return; const w = stage.clientWidth || 1, h = stage.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }

// ---------------------------------------------------------------- setup + frame
function init() {
  stage = document.getElementById("hm-stage"); const c2d = document.getElementById("hm-canvas"); if (!stage || !c2d) throw new Error("no stage");
  renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); renderer.domElement.className = "hm-gl"; renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.shadowMap.type = T.PCFSoftShadowMap;
  stage.insertBefore(renderer.domElement, c2d); stage.classList.add("hm-3d");
  labelsEl = document.createElement("div"); labelsEl.className = "hm3-labels"; stage.appendChild(labelsEl);
  scene = new T.Scene(); scene.background = new T.Color("#9ec9ea"); scene.fog = new T.Fog("#9ec9ea", 150, 440);
  camera = new T.PerspectiveCamera(60, 1, 0.3, 900);
  hemi = new T.HemisphereLight("#cfe6ff", "#4d5a3a", 0.8); scene.add(hemi);
  sun = new T.DirectionalLight("#fff4e2", 2.2); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03; scene.add(sun); scene.add(sun.target);
  G.setQuality({ tex: 256 });
  try { night = NightMod.createNight(scene, renderer); } catch (e) { night = null; }
  qName = isPhone() ? "low" : "med"; applyQuality(qName);
  new ResizeObserver(resize).observe(stage);
  wireControls();
}
function wireControls() {
  const tsel = document.getElementById("hm3-time"), qsel = document.getElementById("hm3-qual");
  if (tsel) tsel.addEventListener("change", () => { tod = tsel.value; tsel.blur(); });
  if (qsel) qsel.addEventListener("change", () => { qAuto = qsel.value === "auto"; applyQuality(qAuto ? (isPhone() ? "low" : "med") : qsel.value); qsel.blur(); });
}
async function build() {
  building = true; buildGround(); buildWater(); buildRoads(); buildTreeSets(); buildGrass(); buildBuildings(); built = true; building = false;
}
function frame(dt) {
  if (failed) return; S = H.state(); if (!S || !S.ready()) return;
  if (!renderer) { try { init(); } catch (e) { failed = true; console.warn("Houma 3D unavailable", e); return; } }
  if (!built) { if (!building) build(); active = true; }
  if (!stage.offsetParent) return; // view hidden (Properties tab etc.)
  if (S.homes.length !== builtHomes && S.homesReady()) buildBuildings();
  clock += dt; K.U.uTime.value = clock;
  const P = S.player, mode = S.camMode(); const fx = Math.cos(P.a), fy = Math.sin(P.a), dist = mode === 1 ? 9 : 18, ht = mode === 1 ? 3.4 : 7.5;
  camPos.set(P.x - fx * dist, ht, P.y - fy * dist); const look = tmpV.set(P.x + fx * 6, 1.4, P.y + fy * 6);
  const k = 1 - Math.exp(-dt * 6); if (camera.position.lengthSq() < 1 || camera.position.distanceTo(camPos) > 80) { camera.position.copy(camPos); camLook.copy(look); } else { camera.position.lerp(camPos, k); camLook.lerp(look, k); }
  camera.lookAt(camLook);
  if (Math.hypot(P.x - lastRefill.x, P.y - lastRefill.z) > 40) { lastRefill.x = P.x; lastRefill.z = P.y; refill(P.x, P.y); }
  if (Math.hypot(P.x - lastGrass.x, P.y - lastGrass.z) > 5 && clock - lastGrass.t > 0.25) { lastGrass.x = P.x; lastGrass.z = P.y; lastGrass.t = clock; scatterGrass(P.x, P.y, fx, fy); }
  syncCars(P.x, P.y, nightK); syncPeople(P.x, P.y, clock);
  lighting(dt, tmpS.set(P.x, 0, P.y).clone());
  renderer.render(scene, camera); updateLabels();
  // auto quality: drop a preset after ~4 s under 24 fps
  fpsAcc.n++; fpsAcc.t += dt; if (fpsAcc.t > 1) { const fps = fpsAcc.n / fpsAcc.t; fpsAcc.n = 0; fpsAcc.t = 0; const el = document.getElementById("hm3-fps"); if (el) el.textContent = Math.round(fps) + " fps · " + qName; if (qAuto && fps < 24) { if (++fpsAcc.low >= 4 && qName !== "low") { applyQuality(qName === "high" ? "med" : "low"); fpsAcc.low = 0; } } else fpsAcc.low = 0; }
}
window.Houma3D = {
  frame, active: () => active && !failed,
  setHour: (h) => { tod = h == null ? "live" : h; },
  setQuality: (q) => { qAuto = false; applyQuality(q); },
  stats: () => ({ quality: qName, built, houses: Object.values(houseSets).reduce((a, s) => a + s.n, 0), biz: Object.values(bizSets).reduce((a, s) => a + s.n, 0), trees: treeSets.reduce((a, s) => a + s.n, 0), grass: grass ? grass.count : 0, lamps: lamps.length, calls: renderer ? renderer.info.render.calls : 0, tris: renderer ? renderer.info.render.triangles : 0 }),
};
