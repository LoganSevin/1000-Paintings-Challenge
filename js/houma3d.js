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
import * as X from "./houma-tex.js?v=1";

const K = W.Kit, H = window.Houma;
const QUALITY = {
  low: { ratio: 1, shadows: false, map: 512, tex: 128, grass: 700, view: 280, people: 6, trees: 0.55, lampLights: "low" },
  med: { ratio: 1.5, shadows: true, map: 1024, tex: 256, grass: 2200, view: 440, people: 14, trees: 1, lampLights: "med" },
  high: { ratio: 2, shadows: true, map: 2048, tex: 256, grass: 4500, view: 620, people: 24, trees: 1.25, lampLights: "high" },
};
const isPhone = () => matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hash = (s) => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const pick = (arr, h) => arr[h % arr.length];

let aerial = null;
const viewR = () => (aerial ? Math.max(Q.view, (aerial.h || 420) * 1.3) : Q.view);
let S = null, renderer = null, scene = null, camera = null, sun = null, hemi = null, night = null, stage = null, labelsEl = null;
let qName = "med", qAuto = true, Q = QUALITY.med, tod = "live", built = false, building = false, active = false, failed = false;
let occN = 0, occDist = 99, nearTrees = [], lastP = {}, pZ = 0, builtHomes = -1, lastRefill = { x: 1e9, z: 1e9, t: -1e9 }, lastGrass = { x: 1e9, z: 1e9, t: 0 }, clock = 0, fpsAcc = { n: 0, t: 0, low: 0 };
const camPos = new T.Vector3(), camLook = new T.Vector3(), tmpV = new T.Vector3(), tmpM = new T.Matrix4(), tmpQ = new T.Quaternion(), tmpS = new T.Vector3(), tmpC = new T.Color(), UP = new T.Vector3(0, 1, 0);

// ---------------------------------------------------------------- materials
let MAT = null;
function materials() {
  if (MAT) return MAT;
  const glass = new T.MeshStandardMaterial({ color: "#26313c", roughness: 0.12, metalness: 0.45, emissive: new T.Color("#ffb860"), emissiveIntensity: 0, name: "H_Glass" });
  MAT = {
    siding: X.mat("lap", 11, "#f4f4f2", { rough: 0.8, name: "H_Wall_Siding", rep: [0.42, 0.42] }),
    batten: X.mat("batten", 22, "#f2f1ee", { rough: 0.85, name: "H_Wall_Batten", rep: [0.35, 0.35] }),
    brick: X.mat("brick", 12, "#a4553f", { rough: 0.92, name: "H_Wall_Brick", rep: [0.42, 0.42] }),
    stucco: X.mat("stucco", 13, "#f1eee8", { rough: 0.92, name: "H_Wall_Stucco", rep: [0.3, 0.3] }),
    metalWall: X.mat("corr", 14, "#eceef0", { rough: 0.5, metal: 0.35, name: "H_Wall_Metal", rep: [0.5, 0.5] }),
    shingle: X.mat("shingle", 15, "#d9d9d9", { rough: 0.9, name: "H_Roof_Shingle", rep: [0.4, 0.4] }),
    tin: X.mat("seam", 16, "#e8e8e8", { rough: 0.35, metal: 0.55, name: "H_Roof_Tin", rep: [0.45, 0.45] }),
    flat: X.mat("gravel", 17, "#9a968e", { rough: 0.95, name: "H_FlatRoof", rep: [0.15, 0.15] }),
    trim: G.M("#f6f3ec", { rough: 0.6, name: "H_Trim" }),
    found: X.mat("panels", 18, "#a7a399", { name: "H_Found", rep: [0.5, 0.5] }),
    slab: X.mat("panels", 19, "#c2bdb2", { name: "H_Slab", rep: [0.25, 0.25] }),
    lot: X.mat("asphalt", 20, "#3b3d40", { rough: 0.95, name: "H_Lot", rep: [0.15, 0.15] }),
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
  brick: ["#ffffff", "#f6e8e0", "#e9d8d0", "#fff2e6", "#d9c6bc", "#f0f0f0", "#e4c8b4"],
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
  const wall = style === "brick" || style === "ranch" ? M.brick : style === "acadian" ? M.batten : M.siding, door = M.doors[v % M.doors.length], sh = style !== "hip" && style !== "ranch";
  box(g, Wd + 0.25, raised, D + 0.25, M.found, 0, 0, 0, 0.02);
  if (style === "acadian") for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.3, raised, 0.3, M.found, sx * (Wd / 2 - 0.3), 0, sz * (D / 2 - 0.3));
  box(g, Wd, wallH, D, wall, 0, raised, 0, 0.02);
  plain(g, Wd + 0.12, 0.16, D + 0.12, M.trim, 0, top - 0.08, 0);
  const roofMat = style === "acadian" ? M.tin : M.shingle;
  if (style === "hip" || style === "ranch") { const r = new T.Mesh(hipRoof(Wd + 0.9, Wd * 0.22, D + 0.9), roofMat); r.position.y = top; g.add(r); }
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
  const drx = Wd / 2 - 1.7;
  plain(g, 1.0, 0.05, 3.2, M.slab, dx, 0, D / 2 + (style === "acadian" ? 3.4 : 1.0) + 1.6);
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
function addSeg(ax, ay, bx, by, hw, n) { const s = { ax, ay, bx, by, hw, n }; const x0 = Math.floor((Math.min(ax, bx) - hw) / SEG), x1 = Math.floor((Math.max(ax, bx) + hw) / SEG), y0 = Math.floor((Math.min(ay, by) - hw) / SEG), y1 = Math.floor((Math.max(ay, by) + hw) / SEG); for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const k = i * 100003 + j; let L = segGrid.get(k); if (!L) segGrid.set(k, (L = [])); L.push(s); } }
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
const ROADW = { motorway: 14, trunk: 14, primary: 10, secondary: 10, tertiary: 8.6, unclassified: 7, residential: 7, living_street: 6, service: 4.6, motorway_link: 6.5, trunk_link: 6.5, primary_link: 6.5, secondary_link: 6, tertiary_link: 6 };
const BIGROAD = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);
function ribbon(pts, hw, off, y, out, uvScale = 1) { // pts: [[x,y],...] houma coords; offset strip [off-hw, off+hw]
  const pos = out.pos, uv = out.uv; let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy); if (L < 0.01) continue;
    const nx = -dy / L, ny = dx / L, e = Math.min(hw * 0.6, 1.5), ex = dx / L * e, ey = dy / L * e; // small overlap hides joints
    const p = (x, yy, s) => [x + nx * (off + s), yy + ny * (off + s)];
    const a0 = p(ax - ex, ay - ey, -hw), a1 = p(ax - ex, ay - ey, hw), b0 = p(bx + ex, by + ey, -hw), b1 = p(bx + ex, by + ey, hw);
    const ya = typeof y === "number" ? y : y[i], yb = typeof y === "number" ? y : y[i + 1];
    pos.push(a0[0], ya, a0[1], b0[0], yb, b0[1], a1[0], ya, a1[1], a1[0], ya, a1[1], b0[0], yb, b0[1], b1[0], yb, b1[1]);
    const u0 = acc * uvScale, u1 = (acc + L) * uvScale, v0 = 0, v1 = hw * 2 * uvScale; uv.push(u0, v0, u1, v0, u0, v1, u0, v1, u1, v0, u1, v1); acc += L;
  }
}
function meshFrom(out, mat, name, { shadow = false } = {}) {
  if (!out.pos.length) return null;
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(out.pos, 3)); g.setAttribute("uv", new T.Float32BufferAttribute(out.uv, 2));
  if (out.col) g.setAttribute("color", new T.Float32BufferAttribute(out.col, 3));
  g.computeVertexNormals(); const m = new T.Mesh(g, mat); m.name = name; m.receiveShadow = true; m.castShadow = shadow; scene.add(m); return m;
}
// split a citywide buffer into ~600 m chunks so frustum culling works, and optionally hide chunks past `far` m (LOD)
let farChunks = [];
function meshChunks(out, mat, name, far = 0, C = 600) {
  if (!out.pos.length) return []; const groups = new Map(), P = out.pos, U = out.uv, Cl = out.col;
  for (let t = 0; t < P.length; t += 9) { const cx = (P[t] + P[t + 3] + P[t + 6]) / 3, cz = (P[t + 2] + P[t + 5] + P[t + 8]) / 3, k = Math.floor(cx / C) * 100003 + Math.floor(cz / C); let g = groups.get(k); if (!g) groups.set(k, (g = { pos: [], uv: [], col: Cl ? [] : null, x: (Math.floor(cx / C) + 0.5) * C, y: (Math.floor(cz / C) + 0.5) * C }));
    for (let v = 0; v < 3; v++) { const i = t / 3 + v; g.pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); g.uv.push(U[i * 2] || 0, U[i * 2 + 1] || 0); if (Cl) g.col.push(Cl[i * 3], Cl[i * 3 + 1], Cl[i * 3 + 2]); } }
  const ms = []; for (const g of groups.values()) { if (!g.col) delete g.col; const m = meshFrom(g, mat, name); if (!m) continue; m.geometry.computeBoundingSphere(); if (far) { m.userData.far = far; m.userData.cx = g.x; m.userData.cy = g.y; farChunks.push(m); } ms.push(m); }
  return ms;
}
// triangles produced by ribbon() wind clockwise seen from above when n points left; make both faces safe
const flatMat = (m) => { m.side = T.DoubleSide; return m; };
function buildGround() {
  const bd = S.bounds ? S.bounds() : [-2600, -2600, 2600, 2600], gw = bd[2] - bd[0] + 3000, gh = bd[3] - bd[1] + 3000;
  const seg = 160, geo = new T.PlaneGeometry(gw, gh, seg, seg); geo.rotateX(-Math.PI / 2); geo.translate((bd[0] + bd[2]) / 2, 0, (bd[1] + bd[3]) / 2);
  const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new T.Color(), A = new T.Color("#6f9a45"), B = new T.Color("#86a752"), C = new T.Color("#5f8a3e"), Dm = new T.Color("#9a9a5a");
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); const n = Math.sin(x * 0.011 + Math.sin(z * 0.007) * 2) * 0.5 + Math.sin(z * 0.013 - x * 0.004) * 0.5; c.copy(A).lerp(n > 0 ? B : C, Math.abs(n) * 0.8); if (Math.sin(x * 0.031 + z * 0.027) > 0.93) c.lerp(Dm, 0.35); col.set([c.r, c.g, c.b], i * 3); }
  geo.setAttribute("color", new T.BufferAttribute(col, 3));
  const tex = X.tex("lawn", 7, { color: "#c9d6b0", rep: [gw / 7, gh / 7] });
  const m = new T.Mesh(geo, new T.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.96, name: "H_Ground" })); m.receiveShadow = true; m.name = "Ground"; scene.add(m);
}
function buildWater() {
  const W1 = { pos: [], uv: [] }, shapes = [];
  for (const f of S.osm.water) {
    const pts = f.p; if (pts.length < 2) continue;
    const closed = f.wk ? f.wk === "area" : pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1;
    if (closed && pts.length > 2) { const s = new T.Shape(); pts.forEach((q, i) => (i ? s.lineTo(q[0], -q[1]) : s.moveTo(q[0], -q[1]))); shapes.push(s); }
    else ribbon(pts, Math.max(1.5, (f.w || 28) / 2), 0, 0.06, W1, 0.05);
  }
  const mud = meshFrom({ pos: W1.pos.map((v, i) => v), uv: W1.uv }, flatMat(X.mat("marsh", 31, "#7d7a52", { rough: 1, name: "H_Bank" })), "WaterBank");
  if (mud) { mud.scale.set(1, 1, 1); mud.position.y = -0.03; }
  const wm = meshFrom(W1, flatMat(K.WATER), "WaterLines"); if (wm) { wm.position.y = 0.02; wm.scale.set(1, 1, 1); }
  if (shapes.length) { const g = new T.ShapeGeometry(shapes); g.rotateX(-Math.PI / 2); const m = new T.Mesh(g, flatMat(K.WATER)); m.position.y = 0.08; m.receiveShadow = true; m.name = "WaterAreas"; scene.add(m); }
  // a wider muddy bank under the river ribbons
  if (mud) { const g = mud.geometry, pos = g.attributes.position; mud.geometry.dispose(); const B = { pos: [], uv: [] }; for (const f of S.osm.water) if (f.p.length >= 2 && f.wk !== "area") ribbon(f.p, Math.max(2.5, (f.w || 28) / 2 + 3), 0, 0.03, B, 0.2); mud.geometry = new T.BufferGeometry(); mud.geometry.setAttribute("position", new T.Float32BufferAttribute(B.pos, 3)); mud.geometry.setAttribute("uv", new T.Float32BufferAttribute(B.uv, 2)); mud.geometry.computeVertexNormals(); void pos; }
}
let lampSet = null, poolSet = null, eyeSet = null, lamps = [], elevGrid = new Map(), tunnels = [], lampsOnRoad = 0;
function addElev(ax, ay, az, bx, by, bz, hw) { const s = { ax, ay, az, bx, by, bz, hw }; const x0 = Math.floor((Math.min(ax, bx) - hw) / SEG), x1 = Math.floor((Math.max(ax, bx) + hw) / SEG), y0 = Math.floor((Math.min(ay, by) - hw) / SEG), y1 = Math.floor((Math.max(ay, by) + hw) / SEG); for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const k = i * 100003 + j; let L = elevGrid.get(k); if (!L) elevGrid.set(k, (L = [])); L.push(s); } }
// height of the drivable surface under (x, y) nearest to the current height `cur` (bridge decks + ramps; 0 = ground)
function deckY(x, y, cur = 0) {
  const L = elevGrid.get(Math.floor(x / SEG) * 100003 + Math.floor(y / SEG)); if (!L) return 0; let best = 0, bd = Math.abs(cur);
  for (const s of L) { const dx = s.bx - s.ax, dy = s.by - s.ay, LL = dx * dx + dy * dy || 1, t = clamp(((x - s.ax) * dx + (y - s.ay) * dy) / LL, 0, 1); if (Math.hypot(x - s.ax - dx * t, y - s.ay - dy * t) > s.hw + 0.6) continue; const z = s.az + (s.bz - s.az) * t; if (z - cur > 1.6) continue; const d = Math.abs(z - cur); if (d < bd) { bd = d; best = z; } }
  return best;
}
function densify(p, step) { const o = [p[0]]; for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step)); for (let k = 1; k <= n; k++) o.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } return o; }
const plen = (p) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return s; };
const roadHW = (f) => f.hw || (ROADW[f.h] || 6) / 2;
// OSM bridge=yes ways become raised decks: overpasses at 6.4 m per layer, bayou bridges low, long canal (Intracoastal) spans high;
// the connected approach roads ramp down at ~5.5 % so cars and the camera can drive up onto them.
function roadProfiles() {
  const roads = S.osm.roads.filter((f) => f.p && f.p.length >= 2), ends = new Map(), key = (q) => Math.round(q[0] / 3) + "," + Math.round(q[1] / 3);
  for (const f of roads) { f.p3 = null; f.zs = null; for (const e of [0, 1]) { const k = key(e ? f.p[f.p.length - 1] : f.p[0]); let L = ends.get(k); if (!L) ends.set(k, (L = [])); L.push({ f, e }); } }
  const prep = (f) => { if (!f.p3) { f.p3 = densify(f.p, 8); f.zs = new Array(f.p3.length).fill(0); } };
  const isBr = (f) => f.osm && f.lvl > 0;
  const out = (f, e) => { const p = f.p, n = p.length, a = e ? p[n - 1] : p[0], b = e ? p[n - 2] : p[1], L = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; return [(a[0] - b[0]) / L, (a[1] - b[1]) / L]; };
  const cont = (f, e, wantBridge) => { const v = out(f, e); let best = null, bs = 0.35; for (const c of ends.get(key(e ? f.p[f.p.length - 1] : f.p[0])) || []) { if (c.f === f || c.f.lvl === -1 || isBr(c.f) !== wantBridge) continue; const w = out(c.f, c.e), d = -(v[0] * w[0] + v[1] * w[1]) + (c.f.n && c.f.n === f.n ? 0.2 : 0); if (d > bs) { bs = d; best = c; } } return best; };
  const climb = (f, e, H, run, depth) => {
    prep(f); const pts = f.p3, n = pts.length, RL = H / 0.055; let s = run;
    for (let i = 0; i < n; i++) { const idx = e ? n - 1 - i : i; if (i) { const a = pts[e ? idx + 1 : idx - 1], b = pts[idx]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); } const k = clamp(1 - s / RL, 0, 1), z = H * k * k * (3 - 2 * k); if (z > f.zs[idx]) f.zs[idx] = z; if (!k) return; }
    if (depth < 4) { const c = cont(f, e ? 0 : 1, false); if (c) climb(c.f, c.e, H, s, depth + 1); }
  };
  const brs = roads.filter(isBr);
  // what does each bridge cross? another road below = overpass; water beside the deck = bayou / canal bridge; else a low culvert bridge
  const cg = new Map(), CG = 50; for (const f of roads) { if (isBr(f) || f.lvl === -1) continue; for (let i = 0; i < f.p.length - 1; i++) { const a = f.p[i], b = f.p[i + 1]; for (let x = Math.floor(Math.min(a[0], b[0]) / CG); x <= Math.floor(Math.max(a[0], b[0]) / CG); x++) for (let y = Math.floor(Math.min(a[1], b[1]) / CG); y <= Math.floor(Math.max(a[1], b[1]) / CG); y++) { const k = x * 100003 + y; let L = cg.get(k); if (!L) cg.set(k, (L = [])); L.push([a, b, f]); } } }
  const X2 = (a, b, c, d) => { const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
  for (const f of brs) {
    prep(f); const hw = roadHW(f); let wet = 0, over = false;
    for (let i = 0; i < f.p.length - 1 && !over; i++) { const a = f.p[i], b = f.p[i + 1], L = cg.get(Math.floor((a[0] + b[0]) / 2 / CG) * 100003 + Math.floor((a[1] + b[1]) / 2 / CG)) || []; for (const [c, d, g] of L) if (g.n !== f.n && X2(a, b, c, d)) { over = true; break; } }
    for (let i = 0; i < f.p3.length - 1; i++) { const a = f.p3[i], b = f.p3[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l; for (const o of [hw + 4, hw + 9, -hw - 4, -hw - 9]) if (tileAt(a[0] + nx * o, a[1] + ny * o) === S.T.WATER) { wet++; break; } }
    const L = plen(f.p3), water = wet > 0; f.bz = over ? 6.4 * Math.min(2, f.lvl || 1) : water ? (L > 320 ? 11 : L > 140 ? 4.5 : 2.4) : 1.2; f.zs.fill(f.bz); f.wet = water;
  }
  for (const f of brs) for (const e of [0, 1]) {
    if (cont(f, e, true)) continue; // continues as another bridge piece
    const c = cont(f, e, false); if (c) { climb(c.f, c.e, f.bz, 0, 0); continue; }
    const pts = f.p3, n = pts.length, RL = f.bz / 0.055; let s = 0; // dead end: ramp inside the bridge itself
    for (let i = 0; i < n; i++) { const idx = e ? n - 1 - i : i; if (i) { const a = pts[e ? idx + 1 : idx - 1], b = pts[idx]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); } const k = clamp(s / RL, 0, 1); f.zs[idx] = Math.min(f.zs[idx], f.bz * k * k * (3 - 2 * k)); }
  }
}
function buildRoads() {
  const asphalt = flatMat(X.mat("asphalt", 41, "#4a4c4f", { rough: 0.92, name: "H_Asphalt", rep: [0.12, 0.12] }));
  const walk = flatMat(X.mat("panels", 42, "#bdb8ad", { rough: 0.9, name: "H_Sidewalk", rep: [0.55, 0.55] }));
  const yellow = flatMat(G.M("#e2b53a", { rough: 0.6, name: "H_LineY" })), white = flatMat(G.M("#ecebe4", { rough: 0.6, name: "H_LineW" }));
  const R = { pos: [], uv: [] }, SW = { pos: [], uv: [] }, CB = { pos: [], uv: [] }, LY = { pos: [], uv: [] }, LW = { pos: [], uv: [] }, SH = { pos: [], uv: [] }, FA = { pos: [], uv: [] }, UN = { pos: [], uv: [] }, eyes = [], piers = [];
  lamps = []; tunnels = []; elevGrid = new Map(); const cand = [];
  roadProfiles();
  for (const f of S.osm.roads) {
    const cls = f.h || "residential", hw = roadHW(f), pts = f.p3 || f.p; if (!pts || pts.length < 2) continue;
    if (f.lvl === -1) { tunnels.push(f); continue; } // Houma Tunnel bore: drawn as portals, not as a road across the canal
    const zs = f.zs, Z = (i) => (zs ? zs[i] : 0), elev = zs && zs.some((z) => z > 0.4);
    for (let i = 0; i < pts.length - 1; i++) { const za = Z(i), zb = Z(i + 1); if (Math.max(za, zb) < 1.2) addSeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], hw, f.n); if (zs && Math.max(za, zb) > 0.02) addElev(pts[i][0], pts[i][1], za, pts[i + 1][0], pts[i + 1][1], zb, hw); }
    ribbon(pts, hw, 0, zs ? zs.map((z) => z + 0.04) : 0.04, R, 1);
    const hiway = f.osm && (cls === "motorway" || cls === "trunk" || cls.endsWith("_link") || (f.one && BIGROAD.has(cls)));
    if (elev) { // deck underside, fascia, parapets, piers
      ribbon(pts, hw + 0.5, 0, zs.map((z) => (z > 4.2 ? z - 0.9 : -1)), UN, 1);
      for (const sd of [-1, 1]) for (let i = 0; i < pts.length - 1; i++) {
        const za = Z(i), zb = Z(i + 1); if (Math.max(za, zb) < 0.5) continue; const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay); if (L < 0.05) continue; const nx = -(by - ay) / L * (hw + 0.5) * sd, ny = (bx - ax) / L * (hw + 0.5) * sd;
        const lo = (z) => Math.max(0, z - 0.9), hi = (z) => z + 1.0; FA.pos.push(ax + nx, lo(za), ay + ny, bx + nx, lo(zb), by + ny, ax + nx, hi(za), ay + ny, ax + nx, hi(za), ay + ny, bx + nx, lo(zb), by + ny, bx + nx, hi(zb), by + ny); FA.uv.push(0, 0, L, 0, 0, 1, 0, 1, L, 0, L, 1);
      }
      let acc = 0; for (let i = 0; i < pts.length - 1; i++) { const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (Z(i) > 2.4 && Math.floor((acc + L) / 24) > Math.floor(acc / 24)) piers.push(pts[i][0], pts[i][1], Z(i) - 0.9, Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]), hw); acc += L; }
    } else if (hiway) { ribbon(pts, 1.2, hw + 1.25, 0.03, SH, 1); ribbon(pts, 1.2, -hw - 1.25, 0.03, SH, 1); }
    else {
      if (cls !== "service" && cls !== "living_street") { ribbon(pts, 0.75, hw + 1.6, 0.025, SW, 1); ribbon(pts, 0.75, -hw - 1.6, 0.025, SW, 1); }
      ribbon(pts, 0.22, hw + 0.1, 0.045, CB, 1); ribbon(pts, 0.22, -hw - 0.1, 0.045, CB, 1);
    }
    // markings from the real lane count: oneway carriageways (divided highways) get yellow left edge + white right edge, two-way get the centre line
    const lanes = f.lanes || (f.one ? (BIGROAD.has(cls) ? 2 : 1) : cls === "trunk" || cls === "motorway" ? 4 : 2), lw = (hw * 2) / lanes, two = !f.one;
    let acc = 0; const total = plen(pts); let lampSide = hash(f.n || pts[0][0]) & 1;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay); if (L < 0.3) { acc += L; continue; }
      const ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux, ang = Math.atan2(uy, ux), za = Z(i), zb = Z(i + 1);
      for (let s = (9 - (acc % 9)); s < L; s += 9) {
        const at = acc + s; if (at < 9 || at > total - 9) continue; const x = ax + ux * s, y = ay + uy * s, Y = za + (zb - za) * (s / L) + 0.055, dash = ((at / 9) | 0) % 2 === 0;
        if (cls === "service" || cls === "living_street") continue;
        if (f.osm) {
          if (two) { const c0 = lanes % 2 ? lw / 2 : 0; for (const o of c0 ? [-c0, c0] : [-0.14, 0.14]) LY.pos.push(...quad(x + nx * o, y + ny * o, ux, uy, 4.6, 0.11, Y)); if (dash) for (let k = 1; k < Math.floor(lanes / 2); k++) for (const sd of [-1, 1]) { const o = sd * (c0 + k * lw); LW.pos.push(...quad(x + nx * o, y + ny * o, ux, uy, 3, 0.1, Y)); } }
          else { LY.pos.push(...quad(x - nx * (hw - 0.35), y - ny * (hw - 0.35), ux, uy, 4.6, 0.12, Y)); if (dash) for (let k = 1; k < lanes; k++) { const o = -hw + k * lw; LW.pos.push(...quad(x + nx * o, y + ny * o, ux, uy, 3, 0.1, Y)); } }
          if (BIGROAD.has(cls) || hiway) for (const o of two ? [-hw + 0.35, hw - 0.35] : [hw - 0.35]) LW.pos.push(...quad(x + nx * o, y + ny * o, ux, uy, 4.6, 0.13, Y));
        } else {
          if (BIGROAD.has(cls) && cls !== "tertiary") { for (const o of [-0.14, 0.14]) LY.pos.push(...quad(x + nx * o, y + ny * o, ux, uy, 4.6, 0.11, Y)); }
          else if (dash) LY.pos.push(...quad(x, y, ux, uy, 3, 0.1, Y));
          if (BIGROAD.has(cls)) for (const o of [-hw + 0.35, hw - 0.35]) LW.pos.push(...quad(x + nx * o, y + ny * o, ux, uy, 4.6, 0.13, Y));
        }
        if (BIGROAD.has(cls) && dash) eyes.push(x, y, ang, Y);
      }
      // lamp candidates: back of the sidewalk / outside the shoulder, never on the carriageway (filtered against every road below)
      const step = hiway ? 60 : 38;
      if (cls !== "service" && !elev) for (let s = (step - (acc % step)); s < L; s += step) { const at = acc + s; if (at < 6 || at > total - 6) continue; lampSide ^= 1; const sd = hiway ? 1 : lampSide ? 1 : -1, o = sd * (hw + (hiway ? 3.4 : 2.9)); cand.push({ x: ax + ux * s + nx * o, y: ay + uy * s + ny * o, a: Math.atan2(-ny * sd, -nx * sd) }); }
      acc += L;
    }
  }
  for (const l of cand) if (!onRoad(l.x, l.y, 0.9) && deckY(l.x, l.y, 0) < 0.3) lamps.push(l);
  lampsOnRoad = lamps.filter((l) => onRoad(l.x, l.y, 0)).length;
  for (const out of [LY, LW, FA]) if (!out.uv.length) out.uv = new Array(out.pos.length / 3 * 2).fill(0); for (const out of [LY, LW]) out.uv = new Array(out.pos.length / 3 * 2).fill(0);
  farChunks = farChunks.filter((m) => m.parent); meshChunks(SW, walk, "Sidewalks", 900); meshChunks(CB, flatMat(X.mat("panels", 44, "#d2cec4", { name: "H_Curb", rep: [0.5, 0.5] })), "Curbs", 600); const rms = meshChunks(R, asphalt, "Roads"); if (rms.length) rms[0].material.polygonOffset = true;
  meshFrom(SH, flatMat(X.mat("gravel", 45, "#8f8a7e", { rough: 1, name: "H_Shoulder", rep: [0.3, 0.3] })), "Shoulders");
  const conc = flatMat(X.mat("panels", 46, "#b9b5ac", { rough: 0.9, name: "H_BridgeConcrete", rep: [0.25, 0.25] }));
  meshFrom(FA, conc, "DeckFascia", { shadow: true }); meshFrom(UN, conc, "DeckUnderside", { shadow: true });
  if (piers.length) { const pg = new T.BoxGeometry(1, 1, 1); pg.translate(0, 0.5, 0); const pm = new T.InstancedMesh(pg, conc, piers.length / 5); pm.name = "BridgePiers"; pm.castShadow = true; pm.frustumCulled = false; for (let i = 0; i < piers.length; i += 5) { tmpQ.setFromAxisAngle(UP, -piers[i + 3]); tmpM.compose(tmpV.set(piers[i], 0, piers[i + 1]), tmpQ, tmpS.set(1.4, piers[i + 2], piers[i + 4] * 1.5)); pm.setMatrixAt(i / 5, tmpM); } scene.add(pm); }
  meshChunks(LY, yellow, "LinesYellow", 520); meshChunks(LW, white, "LinesWhite", 520);
  const eg = new T.PlaneGeometry(0.14, 0.1); eg.rotateX(-Math.PI / 2); eg.translate(0, 0.02, 0); const em = new T.InstancedMesh(eg, W.CATS_EYE, Math.max(1, eyes.length / 4)); em.name = "Reflectors"; em.frustumCulled = false;
  for (let i = 0; i < eyes.length; i += 4) { tmpQ.setFromAxisAngle(UP, -eyes[i + 2]); tmpM.compose(tmpV.set(eyes[i], eyes[i + 3] + 0.015, eyes[i + 1]), tmpQ, tmpS.set(1, 1, 1)); em.setMatrixAt(i / 4, tmpM); }
  em.count = eyes.length / 4; scene.add(em); eyeSet = em;
  const P = []; for (const f of S.osm.parking) { if (f.p.length < 3) continue; const s = new T.Shape(); f.p.forEach((q, i) => (i ? s.lineTo(q[0], -q[1]) : s.moveTo(q[0], -q[1]))); P.push(s); }
  if (P.length) { const g = new T.ShapeGeometry(P); g.rotateX(-Math.PI / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.15, uv.getY(i) * 0.15); const m = new T.Mesh(g, flatMat(G.TM("asphalt", 43, "#55575a", null, { name: "H_Parking" }))); m.position.y = 0.03; m.receiveShadow = true; m.name = "Parking"; scene.add(m); }
  const lm = W.lampModel(4.2); lampSet = new Instanced("Lamp", { group: lm.group }, lamps.length + 1, { noRoles: true });
  lampSet.begin(); lampSet.end();
  const pg = new T.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2); poolSet = new T.InstancedMesh(pg, K.LAMP_POOL, lamps.length + 1); poolSet.name = "LampPools"; poolSet.frustumCulled = false; poolSet.renderOrder = 2;
  for (const l of lamps) { l.hx = l.x + Math.cos(l.a) * 0.9; l.hy = l.y + Math.sin(l.a) * 0.9; }
  poolSet.count = 0; poolSet.visible = false; scene.add(poolSet);
}
function quad(x, y, ux, uy, len, hw, Y = 0.055) { const nx = -uy * hw, ny = ux * hw, lx = ux * len / 2, ly = uy * len / 2; const a = [x - lx - nx, Y, y - ly - ny], b = [x + lx - nx, Y, y + ly - ny], c = [x - lx + nx, Y, y - ly + ny], d = [x + lx + nx, Y, y + ly + ny]; return [...a, ...b, ...c, ...c, ...b, ...d]; }

// ---------------------------------------------------------------- real parcels (Terrebonne Assessor polygons), land use, fences, bridges, marsh
// Every lot is drawn at its true surveyed shape; its surface follows its land use, so the parcel fabric reads from the air
// (lawns of slightly different greens, concrete/asphalt commercial lots, gravel yards, church and civic grounds, marsh).
const LU_COL = {
  res: ["#86a650", "#7d9f4a", "#90ac58", "#7a9a46", "#8aa84f", "#95b05c", "#81a24e"], vacant: ["#9aa45c", "#a4a862", "#8f9a52"],
  church: ["#7fae52"], gov: ["#7aa84e"], school: ["#86ad52"], park: ["#72a44a"], cemetery: ["#80a650"],
  shop: ["#b9b5ad", "#aeaaa2", "#c2beb5"], office: ["#bdb9b1", "#b2aea6"], warehouse: ["#a9a397", "#9d978a"], marsh: ["#8f8f5a", "#848a52"],
};
let lotTiles = new Map(), fenceSet = null, lotLU = new Map(), LOTMATS = null, buildQ = [];
const LTILE = 250;
function poiIn(L) { const g = S.gis && S.gis(); if (!g) return null; for (const q of g.poi) { if (Math.abs(q.x - L.cx) > 120 || Math.abs(q.y - L.cy) > 120) continue; if (inPoly(L.p, q.x, q.y)) return q; } return null; }
function greenAt(x, y) { const g = S.gis && S.gis(); if (!g) return null; for (const z of g.green) { if (!z.bb) { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (const q of z.p) { a = Math.min(a, q[0]); b = Math.max(b, q[0]); c = Math.min(c, q[1]); d = Math.max(d, q[1]); } z.bb = [a, b, c, d]; } if (x < z.bb[0] || x > z.bb[1] || y < z.bb[2] || y > z.bb[3]) continue; if (inPoly(z.p, x, y)) return z; } return null; }
function landUse(L) {
  const q = poiIn(L);
  if (q) { if (q.k === "place_of_worship") return "church"; if (q.k === "school" || q.k === "college") return "school"; return "gov"; }
  const h = L.h, o = (h && h.p && h.p.owner) || "";
  if (/PARISH|CITY OF|STATE OF|CONSOLIDATED GOV|SCHOOL BOARD|LEVEE|DRAINAGE|SHERIFF|UNITED STATES/i.test(o)) return h && h.built ? "gov" : "park";
  if (h && h.biz) return BIZKIND(h);
  const z = greenAt(L.cx, L.cy); if (z) return z.k === "wetland" ? "marsh" : z.k === "cemetery" ? "cemetery" : z.k === "industrial" ? "warehouse" : z.k === "retail" || z.k === "commercial" ? "shop" : "park";
  if (h && h.built) return "res";
  if (L.area > 6000) { const t = tileAt(L.cx, L.cy); return t === S.T.WATER ? "marsh" : "vacant"; }
  return "vacant";
}
function tri(p) { const c = p.map((q) => new T.Vector2(q[0], q[1])); if (T.ShapeUtils.isClockWise(c)) c.reverse(); try { return { c, f: T.ShapeUtils.triangulateShape(c, []) }; } catch (e) { return null; } }
const tileKey = (x, y, S_) => Math.floor(x / S_) * 100003 + Math.floor(y / S_);
function disposeTile(t) { if (!t.meshes) return; for (const m of t.meshes) { m.removeFromParent(); m.geometry.dispose(); } t.meshes = null; t.fences = null; }
// every parcel is bucketed into 250 m tiles; a tile's geometry is only triangulated when the camera comes within range (streamed)
function buildLots() {
  for (const t of lotTiles.values()) disposeTile(t); lotTiles = new Map(); lotLU.clear();
  const g = S.gis && S.gis(); if (!g) return;
  if (!LOTMATS) LOTMATS = {
    lawn: flatMat(X.mat("lawn", 61, "#ffffff", { vc: true, rough: 0.96, name: "H_Lawn", rep: [0.16, 0.16] })),
    conc: flatMat(X.mat("panels", 62, "#ffffff", { vc: true, rough: 0.9, name: "H_LotConcrete", rep: [0.12, 0.12] })),
    asph: flatMat(X.mat("asphalt", 63, "#ffffff", { vc: true, rough: 0.92, name: "H_LotAsphalt", rep: [0.1, 0.1] })),
    gravel: flatMat(X.mat("gravel", 64, "#ffffff", { vc: true, rough: 1, name: "H_LotGravel", rep: [0.2, 0.2] })),
    marsh: flatMat(X.mat("marsh", 65, "#ffffff", { vc: true, rough: 1, name: "H_Marsh", rep: [0.08, 0.08] })),
    line: flatMat(G.M("#5e7a38", { rough: 1, name: "H_LotLine" })),
  };
  for (const L of g.lots) {
    const lu = landUse(L); L.lu = lu; lotLU.set(L.acct, lu);
    const k = tileKey(L.cx, L.cy, LTILE); let t = lotTiles.get(k); if (!t) lotTiles.set(k, (t = { lot: true, cx: (Math.floor(L.cx / LTILE) + 0.5) * LTILE, cy: (Math.floor(L.cy / LTILE) + 0.5) * LTILE, lots: [], meshes: null, fences: null }));
    t.lots.push(L);
  }
  if (!fenceSet) {
    const wood = X.mat("batten", 66, "#b08a5e", { rough: 0.9, name: "H_Fence_Wood", rep: [1, 0.5] }), pick2 = G.M("#efece4", { rough: 0.7, name: "H_Fence_Picket" }), chain = G.M("#9aa1a6", { rough: 0.5, metal: 0.5, opacity: 0.55, name: "H_Fence_Chain" });
    const geo = (h) => { const b = new T.BoxGeometry(1, h, 0.06); b.translate(0, h / 2, 0); return b; };
    fenceSet = [[geo(1.8), wood], [geo(0.95), pick2], [geo(1.2), chain]].map(([gg, m], i) => { const im = new T.InstancedMesh(gg, m, 6000); im.name = "Fence" + i; im.count = 0; im.frustumCulled = false; im.castShadow = i === 0; im.receiveShadow = true; scene.add(im); return im; });
  }
}
const SURF = { res: "lawn", vacant: "lawn", church: "lawn", gov: "lawn", school: "lawn", park: "lawn", cemetery: "lawn", shop: "asph", office: "conc", warehouse: "gravel", marsh: "marsh" };
function buildLotTile(t) {
  const b = {}, line = { pos: [], uv: [] }, c = new T.Color(); t.fences = [];
  for (const L of t.lots) {
    const lu = L.lu, tr = tri(L.p); if (!tr || !tr.f.length) continue;
    const sk = SURF[lu] || "lawn", out = b[sk] || (b[sk] = { pos: [], uv: [], col: [] }), hv = hash(L.acct + "|" + Math.round(L.cx)), y = sk === "lawn" || sk === "marsh" ? 0.012 : 0.018;
    c.set(pick(LU_COL[lu] || LU_COL.res, hv)); if (sk !== "lawn" && sk !== "marsh") c.lerp(tmpC.set("#ffffff"), 0.1); else c.multiplyScalar(1.25);
    for (const fc of tr.f) for (const i of fc) { const v = tr.c[i]; out.pos.push(v.x, y, v.y); out.uv.push(v.x, v.y); out.col.push(c.r, c.g, c.b); }
    ribbon(L.p.concat([L.p[0]]), 0.16, 0, 0.02, line, 1);
    if (lu === "res" && hv % 10 < 6) { const kind = hv % 3; for (let i = 0; i < L.p.length; i++) { const a = L.p[i], q = L.p[(i + 1) % L.p.length], len = Math.hypot(q[0] - a[0], q[1] - a[1]); if (len < 3 || len > 90) continue; const mx = (a[0] + q[0]) / 2, my = (a[1] + q[1]) / 2; if (onRoad(mx, my, 9) || nearestRoad(mx, my, 14)) continue; t.fences.push({ x: mx, y: my, a: Math.atan2(q[1] - a[1], q[0] - a[0]), len, kind }); } }
  }
  t.meshes = [];
  for (const [k, out] of Object.entries(b)) { const m = meshFrom(out, LOTMATS[k], "Lot_" + k); if (m) t.meshes.push(m); }
  const lm = meshFrom(line, LOTMATS.line, "LotLines"); if (lm) { lm.userData.near = true; t.meshes.push(lm); }
}
function refillFences(px, py, R) {
  if (!fenceSet) return; const n = [0, 0, 0], FR = Math.min(R, 260), FR2 = FR * FR;
  for (const t of lotTiles.values()) { if (!t.fences || Math.hypot(t.cx - px, t.cy - py) > FR + 200) continue; for (const f of t.fences) { const dx = f.x - px, dy = f.y - py; if (dx * dx + dy * dy > FR2) continue; const im = fenceSet[f.kind]; if (n[f.kind] >= 6000) continue; tmpQ.setFromAxisAngle(UP, -f.a); tmpM.compose(tmpV.set(f.x, 0, f.y), tmpQ, tmpS.set(f.len, 1, 1)); im.setMatrixAt(n[f.kind]++, tmpM); } }
  fenceSet.forEach((im, i) => { im.count = n[i]; im.instanceMatrix.needsUpdate = true; });
}
// streaming: tiles within view are queued (nearest first) and built a few ms per frame; far tiles are disposed; detail meshes (lot lines, porches) are LOD-hidden past 700 m
function streamTiles(px, py, R) {
  const want = [];
  for (const map of [lotTiles, bTiles]) for (const t of map.values()) {
    const d = Math.hypot(t.cx - px, t.cy - py);
    if (d < R + 200) { if (!t.meshes) { if (!t.q) { t.q = true; want.push([d, t]); } } else for (const m of t.meshes) m.visible = !m.userData.near || d < 700; }
    else if (t.meshes && d > R + 900) disposeTile(t);
    else if (t.meshes) for (const m of t.meshes) m.visible = false;
  }
  for (const w of buildQ) w[0] = Math.hypot(w[1].cx - px, w[1].cy - py);
  buildQ = buildQ.concat(want).sort((a, b) => a[0] - b[0]);
}
function pumpTiles(ms) { const t0 = performance.now(); let n = 0; while (buildQ.length && performance.now() - t0 < ms) { const [, t] = buildQ.shift(); t.q = false; if (t.meshes) continue; if (t.lot) buildLotTile(t); else buildBTile(t); n++; } if (n) { lastRefill.fence = true; } return n; }
function buildBridges() {
  const g = S.gis && S.gis(); if (!g || !g.bridges.length) return;
  const deck = { pos: [], uv: [] }, rail = { pos: [], uv: [] };
  for (const b of g.bridges) {
    if (b.p.length < 2) continue; const hw = (ROADW[b.h] || 8) / 2 + 0.6, mid = b.p[b.p.length >> 1];
    if (deckY(mid[0], mid[1], 3) > 0.5 || deckY(mid[0], mid[1], 11) > 0.5) continue; // the OSM bridge already carries this crossing
    ribbon(b.p, hw, 0, 0.13, deck, 1);
    for (const sd of [-1, 1]) for (let i = 0; i < b.p.length - 1; i++) { // parapet walls: vertical quads along both edges
      const [ax, ay] = b.p[i], [bx, by] = b.p[i + 1], L = Math.hypot(bx - ax, by - ay); if (L < 0.1) continue; const nx = -(by - ay) / L * hw * sd, ny = (bx - ax) / L * hw * sd;
      const A = [ax + nx, ay + ny], B = [bx + nx, by + ny], H = 1.05; rail.pos.push(A[0], 0.13, A[1], B[0], 0.13, B[1], A[0], H, A[1], A[0], H, A[1], B[0], 0.13, B[1], B[0], H, B[1]); rail.uv.push(0, 0, L, 0, 0, 1, 0, 1, L, 0, L, 1);
    }
  }
  const dm = meshFrom(deck, flatMat(X.mat("panels", 71, "#b5b1a8", { name: "H_BridgeDeck", rep: [0.2, 0.2] })), "BridgeDecks"); if (dm) dm.material.polygonOffset = true;
  meshFrom(rail, flatMat(X.mat("panels", 72, "#cfcbc2", { name: "H_BridgeRail", rep: [0.3, 1] })), "BridgeRails", { shadow: true });
}
function buildMarsh() {
  const g = S.gis && S.gis(); if (!g) return; const out = { pos: [], uv: [], col: [] }, c = new T.Color("#ffffff");
  for (const z of g.green) { if (z.k !== "wetland" && z.k !== "meadow" && z.k !== "grass" && z.k !== "park" && z.k !== "pitch" && z.k !== "cemetery") continue; const tr = tri(z.p); if (!tr) continue; const y = z.k === "wetland" ? 0.008 : 0.022; c.set(z.k === "wetland" ? "#ffffff" : z.k === "pitch" ? "#6faa48" : "#86ad58");
    const o = z.k === "wetland" ? out : (out.g || (out.g = { pos: [], uv: [], col: [] })); for (const fc of tr.f) for (const i of fc) { const v = tr.c[i]; o.pos.push(v.x, y, v.y); o.uv.push(v.x, v.y); o.col.push(c.r, c.g, c.b); } }
  meshFrom(out, flatMat(X.mat("marsh", 73, "#ffffff", { vc: true, rough: 1, name: "H_Wetland", rep: [0.07, 0.07] })), "Wetlands");
  if (out.g) meshFrom(out.g, flatMat(X.mat("lawn", 74, "#ffffff", { vc: true, rough: 0.95, name: "H_Parks", rep: [0.12, 0.12] })), "Parks");
}

// ---------------------------------------------------------------- buildings
let extraHouses = [], facadeMat = null, tiles = [], houseSets = {}, bizSets = {};
function polyArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); }
function inPoly(p, x, y) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
const BIZKIND = (h) => { const o = (h.p && (h.p.owner || h.p.o || "")) + " " + (h.p && (h.p.desc || h.p.use || "")); if (/CHURCH|BAPTIST|METHODIST|CATHOLIC|MINISTR|DIOCESE|TEMPLE|GOSPEL|TABERNACLE/i.test(o)) return "church"; if (/BANK|CREDIT UNION|OFFICE|MEDICAL|CLINIC|LAW|INSURANCE|REALTY|HOSPITAL|PARISH|SCHOOL|BOARD|DENTAL|HEALTH|GOVERN|CITY OF|STATE OF|ATTORNEY|CPA|FINANCIAL/i.test(o)) return "office"; if (/WAREHOUSE|INDUSTR|MARINE|OIL|SUPPLY|EQUIP|FABRICAT|TRUCK|ENERG|DRILL|PIPE|STEEL|BOAT|OFFSHORE|MACHINE|TOWING|SHIPYARD|TRANSPORT|WELDING|ELECTRIC|RENTAL/i.test(o)) return "warehouse"; return "shop"; };
function homeSize(h) {
  const p = h.p || {}, sqft = +(p.sqft || p.livingArea || p.area || 0), acres = +(p.acres || 0);
  let a = sqft > 200 ? sqft * 0.0929 * 1.12 : h.biz ? 260 : 150; const lot = acres > 0 ? acres * 4047 : 0; if (lot) a = Math.min(a, lot * 0.55);
  return a;
}
function chooseHouse(h, a) { const hv = hash(h.p && (h.p.id || h.p.pid || h.p.a) || h.x * 7 + h.y), st = hv % 20, style = st < 6 ? "gable" : st < 9 ? "hip" : st < 14 ? "ranch" : st < 17 ? "brick" : "acadian"; const w = Math.sqrt(a * 1.3), size = w < 9.6 ? "S" : w < 12.6 ? "M" : "L"; return { key: style + size, hv }; }
const HOUSE_DIMS = { S: [8.5, 7], M: [11, 8.5], L: [14, 10] };
function colorsFor(hv, style, biz) {
  if (biz) return { wall: pick(PAL.biz, hv), roof: pick(PAL.roof, hv >>> 3), awn: pick(PAL.awn, hv >>> 5), sign: pick(PAL.awn, hv >>> 9) };
  return { wall: style === "brick" || style === "ranch" ? pick(PAL.brick, hv) : pick(PAL.wall, hv), roof: style === "acadian" ? pick(PAL.tin, hv >>> 4) : pick(PAL.roof, hv >>> 4) };
}
function faceRoad(x, y, fallback) { const r = nearestRoad(x, y, 75); if (!r) return { ry: fallback, road: null }; return { ry: Math.atan2(r.px - x, r.py - y), road: r }; }
// facade variants: a tileable wall texture with windows painted in (and a matching window-glow emissive map)
const facadeMats = {};
function facadeFor(kind) {
  if (facadeMats[kind]) return facadeMats[kind];
  const s = 256, cv = document.createElement("canvas"); cv.width = cv.height = s; const x = cv.getContext("2d");
  const ev = document.createElement("canvas"); ev.width = ev.height = s; const e = ev.getContext("2d"); e.fillStyle = "#000"; e.fillRect(0, 0, s, s);
  const base = { brick: ["brick", "#b0644c"], store: ["stucco", "#f2efe9"], metal: ["corr", "#e6e8ea"], office: ["stucco", "#e9e6df"], plain: ["lap", "#f2f0ea"], shed: ["corr", "#eef0f0"] }[kind] || ["stucco", "#f2efe9"];
  x.drawImage(X.tex(base[0], 81 + kind.length, { color: base[1] }).image, 0, 0, s, s);
  const win = (wx, wy, ww, wh, lit) => { x.fillStyle = "#e7e2d8"; x.fillRect(wx - 5, wy - 5, ww + 10, wh + 12); x.fillStyle = "#28333e"; x.fillRect(wx, wy, ww, wh); x.fillStyle = "rgba(255,255,255,0.18)"; x.fillRect(wx + 4, wy + 4, ww * 0.35, wh - 8); x.fillStyle = "#d9d4ca"; x.fillRect(wx + ww / 2 - 2, wy, 4, wh); e.fillStyle = lit ? "#fff" : "#444"; e.fillRect(wx, wy, ww, wh); };
  if (kind === "store") { x.fillStyle = "#26313b"; x.fillRect(10, 120, s - 20, 120); for (let i = 0; i < 5; i++) { x.fillStyle = "#8f979d"; x.fillRect(10 + i * (s - 20) / 4 - 2, 120, 5, 120); } e.fillStyle = "#fff"; e.fillRect(10, 120, s - 20, 120); x.fillStyle = "rgba(255,255,255,0.12)"; x.fillRect(20, 126, 60, 108); x.fillStyle = "#3a6ea5"; x.fillRect(0, 96, s, 16); }
  else if (kind === "office") { for (const wy of [30, 150]) { x.fillStyle = "#2b3a48"; x.fillRect(0, wy, s, 80); e.fillStyle = wy < 100 ? "#666" : "#fff"; e.fillRect(0, wy, s, 80); for (let i = 0; i < 4; i++) { x.fillStyle = "#c9ccce"; x.fillRect(i * 64, wy, 4, 80); } } }
  else if (kind === "metal") { x.fillStyle = "#c9cdd1"; x.fillRect(30, 90, 110, 166); x.strokeStyle = "#9aa0a6"; for (let y = 96; y < 256; y += 9) { x.beginPath(); x.moveTo(30, y); x.lineTo(140, y); x.stroke(); } win(180, 120, 46, 34, true); }
  else if (kind === "shed") { x.fillStyle = "#b9bdc1"; x.fillRect(60, 110, 136, 146); }
  else for (let k = 0; k < 2; k++) win(26 + k * 128, 72, 78, 92, (k + 1) % 2);
  x.fillStyle = "rgba(0,0,0,0.18)"; x.fillRect(0, s - 10, s, 10);
  const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 8;
  const et = new T.CanvasTexture(ev); et.colorSpace = T.SRGBColorSpace; et.wrapS = et.wrapT = T.RepeatWrapping;
  return (facadeMats[kind] = new T.MeshStandardMaterial({ map: t, emissiveMap: et, emissive: new T.Color("#ffc27a"), emissiveIntensity: 0, vertexColors: true, roughness: kind === "metal" || kind === "shed" ? 0.55 : 0.85, metalness: kind === "metal" ? 0.3 : 0, name: "H_Facade_" + kind, side: T.DoubleSide }));
}
function facadeMaterial() { return facadeFor("plain"); }
// oriented bounding box of a polygon along its longest edge
function obb(p) {
  let bestL = 0, ang = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > bestL) { bestL = L; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); } }
  let cx = 0, cy = 0; for (const q of p) { cx += q[0]; cy += q[1]; } cx /= p.length; cy /= p.length;
  const ca = Math.cos(ang), sa = Math.sin(ang); let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9; for (const q of p) { const dx = q[0] - cx, dy = q[1] - cy, u = dx * ca + dy * sa, v = -dx * sa + dy * ca; a0 = Math.min(a0, u); a1 = Math.max(a1, u); b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
  return { cx: cx + ca * (a0 + a1) / 2 - sa * (b0 + b1) / 2, cy: cy + sa * (a0 + a1) / 2 + ca * (b0 + b1) / 2, w: a1 - a0, d: b1 - b0, ang };
}
// rotation so the template's front (+z) faces the nearest street; if the lot has a box, snap to its axes
function frontTo(x, y, axisAng) {
  const r = nearestRoad(x, y, 90); if (!r) return { ry: -axisAng, road: null };
  const want = Math.atan2(r.px - x, r.py - y); if (axisAng == null) return { ry: want, road: r };
  let best = want, bd = 9; for (let k = 0; k < 4; k++) { const c = -axisAng + k * Math.PI / 2; const d = Math.abs(Math.atan2(Math.sin(c - want), Math.cos(c - want))); if (d < bd) { bd = d; best = c; } }
  return { ry: best, road: r };
}
let driveTiles = [], bTiles = new Map(), BMATS = null, bStats = { ext: 0, tpl: 0, gen: 0, checked: 0, overlap: 0, shifted: 0, porches: 0, carports: 0, metal: 0, osmAttr: 0 };
const BTILE = 250;
function bmats() {
  if (BMATS) return BMATS; const ds = (m) => { m.side = T.DoubleSide; return m; };
  BMATS = {
    shingle: ds(X.mat("shingle", 15, "#ffffff", { vc: true, rough: 0.9, name: "H_RoofShingleX", rep: [0.45, 0.45] })),
    metal: ds(X.mat("seam", 52, "#ffffff", { vc: true, rough: 0.38, metal: 0.5, name: "H_RoofMetalX", rep: [0.4, 0.4] })),
    gravel: ds(X.mat("gravel", 51, "#ffffff", { vc: true, rough: 0.95, name: "H_RoofFlatX", rep: [0.15, 0.15] })),
    found: ds(X.mat("panels", 18, "#ffffff", { vc: true, rough: 0.9, name: "H_FoundX", rep: [0.5, 0.5] })),
    misc: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, name: "H_Details", side: T.DoubleSide }),
    drive: flatMat(X.mat("panels", 91, "#c6c1b6", { name: "H_Driveway", rep: [0.28, 0.28] })),
  };
  return BMATS;
}
const bucket = (o, k) => o[k] || (o[k] = { pos: [], uv: [], col: [] });
function wallsOut(O, p, y0, y1, col, vr = 3.4, ur = 4.2) { let acc = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue; const u0 = acc / ur, u1 = (acc + L) / ur, v1 = (y1 - y0) / vr; O.pos.push(a[0], y0, a[1], b[0], y0, b[1], a[0], y1, a[1], a[0], y1, a[1], b[0], y0, b[1], b[0], y1, b[1]); O.uv.push(u0, 0, u1, 0, u0, v1, u0, v1, u1, 0, u1, v1); for (let k = 0; k < 6; k++) O.col.push(col.r, col.g, col.b); acc += L; } }
function capOut(O, p, y, col) { const tr = tri(p); if (!tr) return; for (const fc of tr.f) for (const i of fc) { const v = tr.c[i]; O.pos.push(v.x, y, v.y); O.uv.push(v.x, v.y); O.col.push(col.r, col.g, col.b); } }
function triOut(O, a, b, c, col) { O.pos.push(...a, ...b, ...c); const ex = b[0] - a[0], ez = b[2] - a[2], el = Math.hypot(ex, ez) || 1; for (const v of [a, b, c]) { const dx = v[0] - a[0], dz = v[2] - a[2]; O.uv.push((dx * ex + dz * ez) / el, Math.hypot((-dx * ez + dz * ex) / el, v[1] - a[1])); O.col.push(col.r, col.g, col.b); } }
// hip / gable roof over the TRUE footprint: every eave vertex is joined to its projection on the OBB ridge line
function pitchedOut(B, s) {
  const o = s.o, p = s.p, top = s.top, pitch = s.pitch; let ux = Math.cos(o.ang), uy = Math.sin(o.ang), Wh = o.w / 2, Dh = o.d / 2; if (o.d > o.w) { ux = -Math.sin(o.ang); uy = Math.cos(o.ang); Wh = o.d / 2; Dh = o.w / 2; }
  const gable = s.roof === "gable", rise = Math.min(Dh * pitch, 9), rl = gable ? Wh + 0.01 : Math.max(0, Wh - Dh), R = bucket(B.roof, s.rm), Wl = bucket(B.wall, s.fk), ov = s.rm === "gravel" ? 0 : 0.45;
  const proj = (q) => { const t = clamp((q[0] - o.cx) * ux + (q[1] - o.cy) * uy, -rl, rl); return [o.cx + ux * t, o.cy + uy * t, t]; };
  const eave = (q) => { const r = proj(q), dx = q[0] - r[0], dy = q[1] - r[1], L = Math.hypot(dx, dy) || 1; return [q[0] + dx / L * ov, top - ov * pitch, q[1] + dy / L * ov]; };
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], ra = proj(a), rb = proj(b), A = eave(a), Bq = eave(b), RA = [ra[0], top + rise, ra[1]], RB = [rb[0], top + rise, rb[1]];
    if (Math.abs(ra[2] - rb[2]) < 0.05) { if (gable) triOut(Wl, [a[0], top, a[1]], [b[0], top, b[1]], RA, s.col); else triOut(R, A, Bq, RA, s.rcol); }
    else { triOut(R, A, Bq, RB, s.rcol); triOut(R, A, RB, RA, s.rcol); }
  }
}
// axis-aligned (rotated by ang) box into a vertex-coloured bucket; centre x,y at height z0
function boxOut(O, x, y, z0, w, h, d, ang, col) {
  const c = Math.cos(ang), s = Math.sin(ang), P = (u, v, z) => [x + u * c - v * s, z, y + u * s + v * c], hw = w / 2, hd = d / 2, z1 = z0 + h;
  const v = [P(-hw, -hd, z0), P(hw, -hd, z0), P(hw, hd, z0), P(-hw, hd, z0), P(-hw, -hd, z1), P(hw, -hd, z1), P(hw, hd, z1), P(-hw, hd, z1)];
  for (const [a, b, cc, dd] of [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7], [0, 3, 2, 1]]) { triOut(O, v[a], v[b], v[cc], col); triOut(O, v[a], v[cc], v[dd], col); }
}
function pyrOut(O, x, y, z0, w, h, ang, col) { const c = Math.cos(ang), s = Math.sin(ang), P = (u, v) => [x + u * c - v * s, z0, y + u * s + v * c], q = [P(-w / 2, -w / 2), P(w / 2, -w / 2), P(w / 2, w / 2), P(-w / 2, w / 2)], tp = [x, z0 + h, y]; for (let i = 0; i < 4; i++) triOut(O, q[i], q[(i + 1) % 4], tp, col); }
const C = (hex) => new T.Color(hex);
function emitSpec(B, s) {
  if (s.k === "drive") { ribbon(s.pts, s.hw || 1.5, 0, 0.032, B.drive, 1); return; }
  const p = s.p;
  if (s.base > 0.05) wallsOut(bucket(B, "found"), p, 0, s.base, s.fcol || C("#9c978c"), 1, 1.2);
  wallsOut(bucket(B.wall, s.fk), p, s.base, s.top, s.col, s.fk === "office" ? 4.2 : 3.4);
  if (s.roof === "flat") { capOut(bucket(B.roof, s.rm), p, s.top, s.rcol); if (s.parapet) { const par = bucket(B, "found"); wallsOut(par, p, s.top, s.top + s.parapet, s.col, 1, 1.5); } }
  else pitchedOut(B, s);
  const M = B.misc;
  if (s.porch) { const q = s.porch, ang = Math.atan2(q.uy, q.ux); boxOut(M, q.x + q.nx * 1.1, q.y + q.ny * 1.1, 0, q.len, s.base + 0.06, 2.2, ang, C("#d8d3c8")); for (const sd of [-1, 1]) boxOut(M, q.x + q.ux * sd * (q.len / 2 - 0.2) + q.nx * 2.05, q.y + q.uy * sd * (q.len / 2 - 0.2) + q.ny * 2.05, s.base, 0.16, s.top - s.base - 0.2, 0.16, ang, C("#f3f1ea")); boxOut(M, q.x + q.nx * 1.2, q.y + q.ny * 1.2, s.top - 0.3, q.len + 0.3, 0.14, 2.5, ang, s.rcol); }
  if (s.carport) { const q = s.carport, metalC = C("#aab1b6"); for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) boxOut(M, q.x + Math.cos(q.a) * u * (q.w / 2 - 0.15) - Math.sin(q.a) * v * (q.d / 2 - 0.15), q.y + Math.sin(q.a) * u * (q.w / 2 - 0.15) + Math.cos(q.a) * v * (q.d / 2 - 0.15), 0, 0.12, 2.6, 0.12, q.a, C("#e9e9e6")); boxOut(M, q.x, q.y, 2.6, q.w + 0.3, 0.1, q.d + 0.3, q.a, metalC); boxOut(M, q.x, q.y, 0, q.w, 0.05, q.d, q.a, C("#cdc8be")); }
  if (s.awn) { const q = s.awn, ang = Math.atan2(q.uy, q.ux); boxOut(M, q.x + q.nx * 0.75, q.y + q.ny * 0.75, 3.0, q.len, 0.14, 1.5, ang, s.acol || C("#2f6b4f")); }
  if (s.extra) for (const e of s.extra) (e.pyr ? pyrOut(M, e.x, e.y, e.z, e.w, e.h, e.a, C(e.c)) : boxOut(M, e.x, e.y, e.z, e.w, e.h, e.d, e.a, C(e.c)));
}
function buildBTile(t) {
  const M = bmats(), B = { wall: {}, roof: {}, misc: { pos: [], uv: [], col: [] }, drive: { pos: [], uv: [] } };
  for (const s of t.specs) emitSpec(B, s);
  t.meshes = [];
  for (const [fk, w] of Object.entries(B.wall)) { const m = meshFrom(w, facadeFor(fk), "Facades_" + fk, { shadow: true }); if (m) t.meshes.push(m); }
  for (const [rm, w] of Object.entries(B.roof)) { const m = meshFrom(w, M[rm], "Roofs_" + rm, { shadow: true }); if (m) t.meshes.push(m); }
  if (B.found) { const m = meshFrom(B.found, M.found, "Foundations", { shadow: true }); if (m) t.meshes.push(m); }
  const mm = meshFrom(B.misc, M.misc, "PorchesCarportsDetails", { shadow: true }); if (mm) { mm.userData.near = true; t.meshes.push(mm); }
  const dm = meshFrom(B.drive, M.drive, "Driveways"); if (dm) t.meshes.push(dm);
}
function bTileFor(x, y) { const k = tileKey(x, y, BTILE); let t = bTiles.get(k); if (!t) bTiles.set(k, (t = { cx: (Math.floor(x / BTILE) + 0.5) * BTILE, cy: (Math.floor(y / BTILE) + 0.5) * BTILE, specs: [], meshes: null })); return t; }
// footprint / rectangle vs. every road segment
function polyOnRoad(p, pad) { for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; if (onRoad(a[0], a[1], pad) || onRoad((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pad)) return true; } return false; }
function rectPts(x, y, ry, r) { const c = Math.cos(ry), s = Math.sin(ry), out = []; for (const lx of [r[0], (r[0] + r[1]) / 2, r[1]]) for (const lz of [r[2], (r[2] + r[3]) / 2, r[3]]) out.push([x + lx * c + lz * s, y - lx * s + lz * c]); return out; }
function rectClear(x, y, ry, r, pad = 0.2) { for (const q of rectPts(x, y, ry, r)) if (onRoad(q[0], q[1], pad)) return false; return true; }
// move an instance away from its nearest road until its body (mask rect 0) is off every road; false = could not fit
function clearInst(inst, tpl) {
  const r0 = tpl.mask[0], r = [r0[0] * inst.sx, r0[1] * inst.sx, r0[2] * inst.sz, r0[3] * inst.sz]; bStats.checked++;
  if (rectClear(inst.x, inst.y, inst.ry, r)) return true;
  const n = nearestRoad(inst.x, inst.y, 80); if (!n) return false; let dx = inst.x - n.px, dy = inst.y - n.py; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
  for (let k = 1; k <= 6; k++) if (rectClear(inst.x + dx * k, inst.y + dy * k, inst.ry, r)) { inst.x += dx * k; inst.y += dy * k; bStats.shifted++; return true; }
  return false;
}
const BT = (bt) => /^(house|detached|residential|semidetached_house|bungalow|terrace|farm)$/.test(bt) ? "res" : bt === "static_caravan" ? "mobile" : /^(apartments|dormitory)$/.test(bt) ? "apt" : /^(commercial|retail|supermarket|kiosk)$/.test(bt) ? "shop" : bt === "office" ? "office" : /^(industrial|warehouse|hangar|manufacture|storage_tank)$/.test(bt) ? "warehouse" : /^(church|cathedral|chapel|mosque|temple)$/.test(bt) ? "church" : /^(school|college|university|kindergarten)$/.test(bt) ? "school" : bt === "hospital" ? "hospital" : /^(garage|garages|shed|carport|roof|hut)$/.test(bt) ? "shed" : /^(civic|government|public|fire_station|train_station)$/.test(bt) ? "gov" : null;
const LMS = {
  mall: { fk: "store", ht: 9.5, sign: "SOUTHLAND MALL", sc: "#8b1e3f", col: "#e3d6bf" }, hospital: { fk: "office", ht: 24, sign: "TERREBONNE GENERAL HEALTH", sc: "#1d4f91", col: "#ddd5c6", H: true },
  college: { fk: "brick", ht: 8.5, sign: "FLETCHER TECHNICAL COMMUNITY COLLEGE", sc: "#004b87", col: "#c99a7e" }, courthouse: { fk: "office", ht: 21, sign: "TERREBONNE PARISH COURTHOUSE", sc: "#33302c", col: "#efe6d2", portico: true },
  cathedral: { fk: "brick", ht: 12, roof: "gable", pitch: 0.95, rm: "shingle", sign: "ST. FRANCIS DE SALES CATHEDRAL", sc: "#5a2a1a", col: "#b9694a", spire: true },
  auditorium: { fk: "brick", ht: 10, roof: "gable", pitch: 0.22, rm: "metal", sign: "HOUMA MUNICIPAL AUDITORIUM", sc: "#2c5d3f", col: "#c8b49a" }, civic: { fk: "store", ht: 15, roof: "hip", pitch: 0.18, rm: "metal", sign: "HOUMA-TERREBONNE CIVIC CENTER", sc: "#0e5e8a", col: "#dcd8cf" },
  airport: { fk: "metal", ht: 9, roof: "gable", pitch: 0.12, rm: "metal", sign: "HOUMA-TERREBONNE AIRPORT", sc: "#22466e", tower: true },
  walmart: { fk: "store", ht: 9, sign: "Walmart", sc: "#0071ce", col: "#d6d2c8" }, sams: { fk: "store", ht: 9, sign: "Sam's Club", sc: "#0067a0", col: "#d9d6cf" }, target: { fk: "store", ht: 9, sign: "TARGET", sc: "#cc0000", col: "#e8e2d8" },
  lowes: { fk: "store", ht: 10, sign: "LOWE'S", sc: "#004990", col: "#d8d6d0" }, hobby: { fk: "store", ht: 10, sign: "THE HOME DEPOT", sc: "#f96302", col: "#dedad2" }, plaza: { fk: "store", ht: 6.2, sc: "#6b4f2a", col: "#e4dccb" },
};
let markHits = [];
function frontEdge(p, cx, cy, minL = 3) { const r = nearestRoad(cx, cy, 120); let best = null, bs = -2; const tx = r ? r.px - cx : 0, ty = r ? r.py - cy : 1, tl = Math.hypot(tx, ty) || 1; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < minL) continue; const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; let nx = uy, ny = -ux; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; } const sc = (nx * tx + ny * ty) / tl + L * 0.002; if (sc > bs) { bs = sc; best = { x: mx, y: my, ux, uy, nx, ny, len: L, road: r }; } } return best; }
function buildBuildings() {
  const homes = S.homes, g = S.gis && S.gis();
  if (!Object.keys(houseSets).length) {
    for (const st of ["gable", "hip", "ranch", "brick", "acadian"]) for (const sz of ["S", "M", "L"]) { const [w, d] = HOUSE_DIMS[sz]; houseSets[st + sz] = new Instanced(st + sz, houseTemplate(st, w, d, hash(st + sz)), 64); }
    for (const k of ["shop", "office", "warehouse", "church"]) bizSets[k] = new Instanced(k, bizTemplate(k), 32);
  }
  for (const k of Object.keys(bStats)) bStats[k] = 0;
  maskGrid = new Map(); extraHouses = []; for (const h of homes) { h.inst = null; h.fp = false; }
  for (const t of bTiles.values()) disposeTile(t); bTiles = new Map(); buildQ = [];
  const byAcct = new Map(); for (const h of homes) if (h.p && h.p.id) byAcct.set(String(h.p.id), h);
  buildLots();
  const blds = S.osm.buildings.map((f) => { let p = f.p; if (p && p.length > 3 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.5) p = p.slice(0, -1); let cx = 0, cy = 0; if (p) { for (const q of p) { cx += q[0]; cy += q[1]; } cx /= p.length; cy /= p.length; } return { f, p, cx, cy, area: p && p.length >= 3 ? polyArea(p) : 0 }; }).sort((a, b) => b.area - a.area);
  // landmarks: the parish footprints inside each OSM landmark outline (or nearest the point) get the landmark's look
  const markOf = new Map(); markHits = [];
  for (const m of (g && g.marks) || []) {
    const st = LMS[m.k]; if (!st) continue; const c = []; let near = null, nd = 90;
    for (const b of blds) { if (b.area < 30 || Math.abs(b.cx - m.x) > 900 || Math.abs(b.cy - m.y) > 900) continue; if (m.p && inPoly(m.p, b.cx, b.cy)) c.push(b); else { const d = Math.hypot(b.cx - m.x, b.cy - m.y) - Math.sqrt(b.area) / 2; if (d < nd) { nd = d; near = b; } } }
    if (!c.length && near) c.push(near); if (!c.length) { markHits.push({ m, b: null }); continue; }
    c.forEach((b, i) => { if (!markOf.has(b)) markOf.set(b, { m, st, primary: i === 0 }); }); markHits.push({ m, b: c[0], st });
  }
  const fpFit = [];
  for (const B of blds) {
    const { f, p, area, cx, cy } = B; if (!p || p.length < 3 || area < 8) continue;
    let own = f.acct && byAcct.get(f.acct) || null;
    if (!own) { let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9; for (const q of p) { minx = Math.min(minx, q[0]); maxx = Math.max(maxx, q[0]); miny = Math.min(miny, q[1]); maxy = Math.max(maxy, q[1]); } S.nearBuckets(cx, cy, Math.hypot(maxx - minx, maxy - miny) / 2 + 2, (h) => { if (!own && inPoly(p, h.x, h.y)) own = h; }); }
    const lu = own && own.lot ? own.lot.lu : f.acct ? lotLU.get(f.acct) : null, first = own && !own.fp; if (first) own.fp = true;
    const mk = markOf.get(B), o = obb(p), rect = area / Math.max(1, o.w * o.d), hv = hash(Math.round(cx * 13) + "," + Math.round(cy)), aspect = Math.max(o.w, o.d) / Math.max(0.5, Math.min(o.w, o.d));
    const isBiz = !!(own && own.biz) || lu === "shop" || lu === "office" || lu === "warehouse" || lu === "church" || lu === "gov" || lu === "school";
    let kind = BT(f.bt || ""); if (f.bt || f.lv || f.z || f.rf) bStats.osmAttr++;
    if (!kind) kind = area < 40 || (!first && !isBiz && area < 120) ? "shed" : isBiz ? (lu === "church" ? "church" : lu === "office" || lu === "gov" ? "office" : lu === "school" ? "school" : lu === "warehouse" ? "warehouse" : area > 1500 ? "warehouse" : "shop") : area > 700 ? "apt" : "res";
    if (kind === "res" && aspect > 2.6 && area > 45 && area < 130) kind = "mobile";
    // Downtown Main St: storefront rows (two-storey brick/stucco with parapets + awnings)
    const nr = nearestRoad(cx, cy, 30), mainSt = nr && /^(w |e )?main (st|street)/i.test(nr.s.n || "") && Math.abs(cx) < 2600 && Math.abs(cy) < 2600;
    if (mainSt && kind !== "church") kind = "main";
    if (!mk && kind === "res" && area >= 40 && area < 330 && rect > 0.88 && (f.lv || 1) <= 1 && !f.rf && first) { fpFit.push({ p, cx, cy, area, h: own, o }); continue; }
    if (!mk && kind === "res" && area >= 40 && area < 260 && rect > 0.88 && !own && !f.rf) { fpFit.push({ p, cx, cy, area, h: null, o }); continue; }
    // ---- extruded true-shape building spec
    const [rs, rmat] = String(f.rf || "").split("|"), lv = f.lv || 0;
    const fk = { res: hv % 10 < 4 ? "brick" : "plain", mobile: "plain", apt: hv % 2 ? "brick" : "plain", shop: "store", main: hv % 3 ? "brick" : "store", office: "office", warehouse: "metal", church: "brick", school: "brick", hospital: "office", gov: "brick", shed: "shed" }[kind];
    const base = kind === "res" ? (fk === "plain" && hv % 7 === 0 ? 1.0 : 0.45) : kind === "mobile" ? 0.75 : 0;
    const defH = { res: 2.8, mobile: 2.5, apt: 5.8, shop: area > 2500 ? 7.5 : 5.2, main: 7.4, office: area > 1200 ? 11.5 : 8.2, warehouse: 7.5, church: 6.5, school: 5.2, hospital: 14, gov: 7, shed: 2.6 }[kind];
    let ht = f.z ? clamp(f.z, 2.4, 80) : lv ? lv * (kind === "res" || kind === "apt" ? 2.9 : 3.6) + 0.4 : defH;
    let roof = rs === "flat" ? "flat" : rs === "gabled" ? "gable" : rs === "hipped" || rs === "pyramidal" ? "hip" : rs === "skillion" ? "gable" : null;
    if (!roof) roof = kind === "res" || kind === "apt" ? (hv % 9 < 5 ? "hip" : "gable") : kind === "mobile" || kind === "warehouse" || kind === "church" || kind === "shed" ? "gable" : "flat";
    if (roof !== "flat" && rect < 0.55 && area > 400) roof = "flat";
    let rm = rmat === "metal" || rmat === "tin" ? "metal" : rmat ? "shingle" : roof === "flat" ? "gravel" : kind === "warehouse" || kind === "mobile" || kind === "shed" ? "metal" : kind === "res" && hv % 11 < 2 ? "metal" : "shingle";
    const pitch = kind === "church" ? 0.85 : kind === "warehouse" || kind === "mobile" ? 0.13 : kind === "shed" ? 0.3 : kind === "apt" ? 0.38 : 0.45 + (hv % 5) * 0.04;
    let col = new T.Color(fk === "brick" ? pick(PAL.brick, hv) : fk === "metal" || fk === "shed" ? pick(["#ffffff", "#e8eef2", "#f2ede2", "#dfe6e0", "#c9d4dc", "#d8c9a8"], hv) : kind === "res" || kind === "mobile" || kind === "apt" ? pick(PAL.wall, hv) : pick(PAL.biz, hv));
    const s = { k: "ext", p, o, base, top: base + ht, fk, col, roof, rm, pitch, rcol: new T.Color(rm === "metal" ? pick(PAL.tin, hv >>> 3) : rm === "gravel" ? "#c9c5bc" : pick(PAL.roof, hv >>> 3)), parapet: roof === "flat" && kind !== "shed" ? (kind === "main" ? 1.1 : 0.6) : 0 };
    if (mk) { const st = mk.st; s.fk = st.fk; s.col = new T.Color(st.col || "#d8d4cc"); if (!f.z && !lv) s.top = s.base + (mk.primary ? st.ht : Math.min(st.ht, 7)); s.roof = st.roof || (s.roof === "flat" || mk.primary ? "flat" : s.roof); s.rm = st.rm || (s.roof === "flat" ? "gravel" : s.rm); s.pitch = st.pitch || s.pitch; s.rcol = new T.Color(s.rm === "metal" ? "#9aa3a8" : s.rm === "gravel" ? "#cfcac0" : "#5a4a3e"); s.parapet = s.roof === "flat" ? 1.0 : 0; s.mark = mk; }
    if (rm === "metal" || s.rm === "metal") bStats.metal++;
    const fe = (kind === "res" || kind === "main" || kind === "shop") && !mk ? frontEdge(p, cx, cy, kind === "res" ? 4 : 6) : null;
    if (fe && kind === "res" && hv % 10 < 6) { const len = Math.min(fe.len * 0.62, 8), q = { ...fe, len }; const tip = [fe.x + fe.nx * 2.5, fe.y + fe.ny * 2.5]; if (!onRoad(tip[0], tip[1], 0.6)) { s.porch = q; bStats.porches++; } }
    if ((kind === "main" || kind === "shop") && fe && s.top > 3.6) { s.awn = { ...fe, len: fe.len * 0.86 }; s.acol = new T.Color(pick(PAL.awn, hv >>> 5)); if (onRoad(fe.x + fe.nx * 1.6, fe.y + fe.ny * 1.6, 0.3)) s.awn = null; }
    if (kind === "res" && area < 260 && hv % 10 >= 6 && hv % 10 < 9 && fe) { // carport beside the house, opening to the street
      const sd = hv & 1 ? 1 : -1, hl = Math.max(o.w, o.d) / 2, cxp = cx + fe.ux * sd * (hl + 3.2) + fe.nx * 1.5, cyp = cy + fe.uy * sd * (hl + 3.2) + fe.ny * 1.5, cp = { x: cxp, y: cyp, a: Math.atan2(fe.uy, fe.ux), w: 5.6, d: 6.2 };
      if (rectClear(cxp, cyp, -cp.a, [-3, 3, -3.3, 3.3], 0.3) && !inPoly(p, cxp, cyp)) { s.carport = cp; bStats.carports++; addDriveFrom(cxp + fe.nx * 3, cyp + fe.ny * 3); }
    }
    bStats.checked++; if (polyOnRoad(p, -0.3)) bStats.overlap++;
    bStats.ext++; bTileFor(cx, cy).specs.push(s);
    if (own && own.biz && first) { own.label = true; own.inst = own.inst || { set: null, x: cx, y: cy }; }
  }
  // fitted houses in rectangular footprints (clear of every road, else true-shape extrusion)
  for (const fp of fpFit) {
    const b = fp.o; let Wd = b.w, D = b.d, phi = b.ang; if (D > Wd) { [Wd, D] = [D, Wd]; phi += Math.PI / 2; }
    const hh = fp.h || { x: b.cx, y: b.cy, p: { id: "fp" + Math.round(b.cx) + "," + Math.round(b.cy) } }, { key, hv } = chooseHouse(hh, Wd * D), [tw, td] = HOUSE_DIMS[key.replace(/^[a-z]+/, "")];
    let ry = -phi; const fx = Math.sin(ry), fz = Math.cos(ry), r = nearestRoad(b.cx, b.cy, 75); if (r && fx * (r.px - b.cx) + fz * (r.py - b.cy) < 0) ry += Math.PI;
    let sx = clamp(Wd / tw, 0.6, 1.6), sz = clamp(D / td, 0.6, 1.6);
    if (r) { const fx2 = Math.sin(ry), fz2 = Math.cos(ry), dx = r.px - b.cx, dy = r.py - b.cy, dd = Math.hypot(dx, dy) || 1, dot = (fx2 * dx + fz2 * dy) / dd; if (dot < 0.5) { const c1 = ry + Math.PI / 2, c2 = ry - Math.PI / 2; ry = Math.sin(c1) * dx + Math.cos(c1) * dy > 0 ? c1 : c2; sx = clamp(D / tw, 0.6, 1.6); sz = clamp(Wd / td, 0.6, 1.6); } }
    const inst = { set: key, x: b.cx, y: b.cy, ry, sx, sz, colors: colorsFor(hv, key.replace(/[SML]$/, ""), false) };
    if (!clearInst(inst, houseSets[key].tpl)) { // template + porch would touch a road: true-shape extrusion instead
      const col = new T.Color(pick(PAL.wall, hv)); bTileFor(b.cx, b.cy).specs.push({ k: "ext", p: fp.p, o: b, base: 0.45, top: 3.25, fk: "plain", col, roof: "hip", rm: "shingle", pitch: 0.45, rcol: new T.Color(pick(PAL.roof, hv >>> 3)) }); bStats.ext++; continue;
    }
    bStats.tpl++; if (fp.h) fp.h.inst = inst; else extraHouses.push(inst);
    addMask(inst.x, inst.y, inst.ry, inst.sx, inst.sz, houseSets[key].tpl.mask); addDrive(inst.x, inst.y, inst.ry, sx, sz, td);
  }
  // parcels with a building but no footprint get a generated house / business inside their own lot, kept clear of roads
  for (const h of homes) {
    if (h.fp || h.inst) continue; if (!h.built && !h.biz) continue;
    let a = homeSize(h); const hv = hash(h.p && (h.p.id || h.p.pid || h.p.a) || h.x * 7 + h.y), lb = h.lot ? obb(h.lot.p) : null;
    if (lb) a = Math.min(a, lb.w * lb.d * 0.45);
    const lx = lb ? lb.cx : h.x, ly = lb ? lb.cy : h.y;
    if (h.biz) {
      const kind = BIZKIND(h), tpl = bizSets[kind].tpl; let s = clamp(Math.sqrt(a / (tpl.w * tpl.d)), 0.6, 1.7); if (lb) s = Math.min(s, Math.max(0.5, Math.min(lb.w, lb.d) / (tpl.d + 12)));
      const f = frontTo(lx, ly, lb ? lb.ang : null); let x = lx, y = ly; if (f.road) { const need = f.road.s.hw + 1 + tpl.mask[0][3] * s; if (f.road.d < need) { const k = (need - f.road.d) / Math.max(1e-3, f.road.d); x -= (f.road.px - x) * k; y -= (f.road.py - y) * k; } }
      const inst = { set: "biz:" + kind, x, y, ry: f.ry, sx: s, sz: s, colors: colorsFor(hv, kind, true) }; if (!clearInst(inst, tpl)) { inst.sx = inst.sz = s * 0.7; if (!clearInst(inst, tpl)) continue; }
      h.inst = inst; bStats.gen++; addMask(inst.x, inst.y, inst.ry, inst.sx, inst.sz, tpl.mask); h.label = true; continue;
    }
    const { key } = chooseHouse(h, a), [tw, td] = HOUSE_DIMS[key.replace(/^[a-z]+/, "")], tpl = houseSets[key].tpl, w = Math.sqrt(a * 1.3), d = a / w; let sx = clamp(w / tw, 0.7, 1.3), sz = clamp(d / td, 0.7, 1.3);
    const f = frontTo(lx, ly, lb ? lb.ang : null); let x = lx, y = ly;
    if (lb) { const across = Math.abs(Math.cos(f.ry + lb.ang)) > 0.7 ? lb.w : lb.d, deep = across === lb.w ? lb.d : lb.w; sx = Math.min(sx, Math.max(0.55, (across - 2.5) / tw)); sz = Math.min(sz, Math.max(0.55, (deep - 6) / td)); }
    if (f.road) { const need = f.road.s.hw + 6 + td * sz / 2; if (f.road.d < need) { const k = (need - f.road.d) / Math.max(1e-3, f.road.d); x -= (f.road.px - x) * k; y -= (f.road.py - y) * k; } }
    const inst = { set: key, x, y, ry: f.ry, sx, sz, colors: colorsFor(hv, key.replace(/[SML]$/, ""), false) }; if (!clearInst(inst, tpl)) { inst.sx *= 0.75; inst.sz *= 0.75; if (!clearInst(inst, tpl)) continue; }
    h.inst = inst; bStats.gen++; addMask(inst.x, inst.y, inst.ry, inst.sx, inst.sz, tpl.mask); addDrive(inst.x, inst.y, inst.ry, inst.sx, inst.sz, td);
  }
  buildLandmarks();
  builtHomes = homes.length; lastRefill.x = 1e9; treeCache.clear();
}
function addDriveFrom(ax, ay) { const r = nearestRoad(ax, ay, 45); if (!r) return; const dx = r.px - ax, dy = r.py - ay, d = Math.hypot(dx, dy); if (d < r.s.hw + 0.5 || d > 44) return; const ux = dx / d, uy = dy / d; bTileFor(ax, ay).specs.push({ k: "drive", pts: [[ax - ux * 0.5, ay - uy * 0.5], [r.px - ux * (r.s.hw - 0.2), r.py - uy * (r.s.hw - 0.2)]], hw: 1.55 }); }
function addDrive(x, y, ry, sx, sz, tplD) { const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry), off = (HOUSE_DIMS.M[0] / 2 - 1.7) * sx; addDriveFrom(x + fx * (tplD / 2) * sz + rx * off, y + fz * (tplD / 2) * sz + rz * off); }
function refill(px, py) {
  const R = viewR(), R2 = R * R;
  for (const s of Object.values(houseSets)) s.begin(); for (const s of Object.values(bizSets)) s.begin();
  const TR = Math.min(R, aerial ? 900 : 560), TR2 = TR * TR; nearHouses = []; // LOD: detailed instanced templates only within 560 m on the street (900 m from the air)
  const put = (i) => { if (!i.set) return; const dx = i.x - px, dy = i.y - py; if (dx * dx + dy * dy > TR2) return; if (dx * dx + dy * dy < 4900) nearHouses.push({ x: i.x, y: i.y, r: 4.2 * Math.sqrt(i.sx * i.sz) }); const set = i.set.startsWith("biz:") ? bizSets[i.set.slice(4)] : houseSets[i.set]; set.add(i.x, 0, i.y, i.ry, i.sx, 1, i.sz, i.colors); };
  S.nearBuckets(px, py, TR, (h) => { if (h.inst) put(h.inst); });
  for (const i of extraHouses) put(i);
  for (const s of Object.values(houseSets)) s.end(); for (const s of Object.values(bizSets)) s.end();
  streamTiles(px, py, R); refillFences(px, py, R);
  refillTrees(px, py);
  const LR = Math.min(R, 360), LR2 = LR * LR; let n = 0; lampSet.begin();
  for (const l of lamps) { const dx = l.x - px, dy = l.y - py; if (dx * dx + dy * dy > LR2) continue; lampSet.add(l.x, 0, l.y, -l.a, 1, 1, 1); tmpM.compose(tmpV.set(l.hx, 0.09, l.hy), tmpQ.identity(), tmpS.set(9, 1, 9)); poolSet.setMatrixAt(n++, tmpM); }
  lampSet.end(); poolSet.count = n; poolSet.instanceMatrix.needsUpdate = true;
}
// chase-camera occlusion: trees between the player and the camera are hidden (instance scaled to 0); real
// footprints (extruded tile buildings) and templated houses in the way pull the camera in toward the player
const pip = (x, y, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1e-9) + a[0]) c = !c; } return c; };
function camOcclusion(px, py, fx, fy, dist, ht, z0) {
  const hz = 1.6, segHit = (x, y) => { const dx = x - px, dy = y - py, t = clamp(-(dx * fx + dy * fy) / dist, 0, 1); return Math.hypot(dx + fx * dist * t, dy + fy * dist * t); };
  // trees
  const touched = new Set();
  for (const n of nearTrees) { const hide = segHit(n.x, n.y) < n.r && -( (n.x - px) * fx + (n.y - py) * fy) > -1; if (hide !== n.hid) { n.hid = hide; tmpQ.setFromAxisAngle(UP, n.ry); tmpM.compose(tmpV.set(n.x, 0, n.y), tmpQ, hide ? tmpS.set(1e-4, 1e-4, 1e-4) : tmpS.set(n.sx, n.sy, n.sx)); for (const pp of n.set.parts) { pp.im.setMatrixAt(n.i, tmpM); touched.add(pp.im); } } }
  for (const im of touched) im.instanceMatrix.needsUpdate = true;
  // buildings: march from the player back toward the camera; stop before the first footprint whose roof is above the sight line
  const specs = []; for (const t of [bTiles.get(tileKey(px, py, BTILE)), bTiles.get(tileKey(px - fx * dist, py - fy * dist, BTILE))]) if (t) for (const sp of t.specs) if (sp.k === "ext" && sp.p) { if (!sp.bb) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const q of sp.p) { a = Math.min(a, q[0]); b = Math.min(b, q[1]); c = Math.max(c, q[0]); d = Math.max(d, q[1]); } sp.bb = [a, b, c, d]; } const bb = sp.bb; if (bb[2] < Math.min(px, px - fx * dist) - 1 || bb[0] > Math.max(px, px - fx * dist) + 1 || bb[3] < Math.min(py, py - fy * dist) - 1 || bb[1] > Math.max(py, py - fy * dist) + 1) continue; specs.push(sp); }
  for (let d = 2; d <= dist + 0.8; d += 0.7) { const x = px - fx * d, y = py - fy * d, h = z0 + hz + (ht - hz) * (d / dist);
    for (const sp of specs) if (x > sp.bb[0] && x < sp.bb[2] && y > sp.bb[1] && y < sp.bb[3] && (sp.top || 6) + (sp.roof === "flat" ? 1 : 3) > h && pip(x, y, sp.p)) return Math.max(2.2, d - 1.2);
    for (const hh of nearHouses) if (Math.hypot(x - hh.x, y - hh.y) < hh.r) return Math.max(2.2, d - 1.2); }
  return 99;
}
let nearHouses = [];
// ---------------------------------------------------------------- landmarks: signage, towers, spires, portals, runways
let lmGroup = null, gpsMesh = null, gpsArrow = null, gpsVer = -1;
function signMat(text, bg, fg = "#ffffff", w = 512, h = 128) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const x = cv.getContext("2d"); x.fillStyle = bg; x.fillRect(0, 0, w, h); x.strokeStyle = "rgba(255,255,255,0.85)"; x.lineWidth = 6; x.strokeRect(5, 5, w - 10, h - 10);
  let fs = h * 0.56; x.font = `bold ${fs}px Arial, Helvetica, sans-serif`; while (x.measureText(text).width > w - 30 && fs > 10) { fs -= 2; x.font = `bold ${fs}px Arial, Helvetica, sans-serif`; }
  x.fillStyle = fg; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, w / 2, h / 2 + 2);
  const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
  return new T.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new T.Color("#ffffff"), emissiveIntensity: 0.25, roughness: 0.5, side: T.DoubleSide, name: "H_SignText" });
}
function signBoard(text, bg, x, y, z, w, h, ang) { const m = new T.Mesh(new T.PlaneGeometry(w, h), signMat(text, bg)); m.position.set(x, z, y); m.rotation.y = -ang + Math.PI / 2; m.name = "Sign_" + text; lmGroup.add(m); return m; }
function buildLandmarks() {
  if (lmGroup) { lmGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); lmGroup.removeFromParent(); }
  lmGroup = new T.Group(); lmGroup.name = "Landmarks"; scene.add(lmGroup);
  const O = { pos: [], uv: [], col: [] }, g = S.gis && S.gis();
  const pylon = (text, bg, x, y, ang, H = 7.5, W = 7) => { boxOut(O, x, y, 0, 0.5, H, 0.5, ang, C("#6b6e72")); boxOut(O, x, y, H - 2.4, W + 0.4, 2.6, 0.5, ang, C("#2a2d31")); for (const sd of [-1, 1]) { const m = signBoard(text, bg, x + Math.cos(ang + Math.PI / 2) * 0.27 * sd, y + Math.sin(ang + Math.PI / 2) * 0.27 * sd, H - 1.1, W, 2.2, ang + (sd > 0 ? 0 : Math.PI)); void m; } };
  for (const { m, b, st } of markHits) {
    if (!b) continue; const fe = frontEdge(b.p, b.cx, b.cy, 4); if (!fe) continue; const top = st.ht, ang = Math.atan2(fe.uy, fe.ux);
    const text = st.sign || m.n;
    // wall sign over the entrance, facing the street
    signBoard(text, st.sc, fe.x + fe.nx * 0.2, fe.y + fe.ny * 0.2, Math.max(3.2, top - 1.6), Math.min(fe.len * 0.7, 3 + text.length * 0.9), Math.min(2.4, 1 + top * 0.08), ang);
    // street pylon / monument sign at the property edge, never on the road
    if (fe.road) { const r = fe.road, dx = b.cx - r.px, dy = b.cy - r.py, d = Math.hypot(dx, dy) || 1, off = r.s.hw + 5; let px = r.px + dx / d * off, py = r.py + dy / d * off; if (!onRoad(px, py, 1.5) && !inPoly(b.p, px, py)) pylon(text, st.sc, px, py, Math.atan2(r.s.by - r.s.ay, r.s.bx - r.s.ax)); }
    if (st.H) { boxOut(O, b.cx, b.cy, top + 1.0, 6, 6, 0.5, ang, C("#c8102e")); signBoard("H", "#c8102e", b.cx + fe.nx * 0.3, b.cy + fe.ny * 0.3, top + 4, 5, 5, ang); }
    if (st.spire) { const tx = fe.x - fe.nx * 3, ty = fe.y - fe.ny * 3; boxOut(O, tx, ty, 0, 6, 28, 6, ang, C("#b9694a")); boxOut(O, tx, ty, 28, 6.6, 0.6, 6.6, ang, C("#efe6d2")); boxOut(O, tx, ty, 28.6, 4.4, 4, 4.4, ang, C("#efe6d2")); pyrOut(O, tx, ty, 32.6, 4.6, 11, ang + Math.PI / 4, C("#5f6b6f")); boxOut(O, tx, ty, 43.4, 0.25, 2.4, 0.25, ang, C("#d4af37")); boxOut(O, tx, ty, 44.6, 1.3, 0.22, 0.25, ang, C("#d4af37")); }
    if (st.portico) { // courthouse: columned entrance + stepped art-deco crown
      for (let i = 0; i < 6; i++) { const u = (i / 5 - 0.5) * Math.min(fe.len * 0.6, 16); boxOut(O, fe.x + fe.ux * u + fe.nx * 2.6, fe.y + fe.uy * u + fe.ny * 2.6, 0.6, 0.9, 8.5, 0.9, ang, C("#f3eee2")); }
      boxOut(O, fe.x + fe.nx * 2.4, fe.y + fe.ny * 2.4, 9.1, Math.min(fe.len * 0.6, 16) + 2, 1.4, 4.6, ang, C("#e7dfcd")); boxOut(O, fe.x + fe.nx * 2.4, fe.y + fe.ny * 2.4, 0, Math.min(fe.len * 0.6, 16) + 3, 0.6, 5.6, ang, C("#d9d2c2"));
      boxOut(O, b.cx, b.cy, top, Math.min(fe.len * 0.45, 14), 4, Math.min(fe.len * 0.45, 14), ang, C("#efe6d2")); boxOut(O, b.cx, b.cy, top + 4, Math.min(fe.len * 0.28, 8), 3, Math.min(fe.len * 0.28, 8), ang, C("#efe6d2"));
      boxOut(O, fe.x + fe.nx * 9 + fe.ux * 10, fe.y + fe.ny * 9 + fe.uy * 10, 0, 0.18, 12, 0.18, 0, C("#d8d8d8"));
    }
    if (st.tower) { const run = (g.aero || []).filter((a) => a.k === "runway"); let tx = b.cx, ty = b.cy; if (run.length) { let best = null, bd = 1e9; for (const a of run) for (const q of a.p) { const d = Math.hypot(q[0] - b.cx, q[1] - b.cy); if (d < bd) { bd = d; best = q; } } const dx = b.cx - best[0], dy = b.cy - best[1], d = Math.hypot(dx, dy) || 1; tx = b.cx + dx / d * (Math.sqrt(b.area) / 2 + 18); ty = b.cy + dy / d * (Math.sqrt(b.area) / 2 + 18); } boxOut(O, tx, ty, 0, 3.2, 17, 3.2, 0, C("#e7e4dc")); boxOut(O, tx, ty, 17, 6, 3.2, 6, 0, C("#2c3a46")); boxOut(O, tx, ty, 20.2, 6.6, 0.5, 6.6, 0, C("#e7e4dc")); boxOut(O, tx, ty, 20.7, 0.15, 3, 0.15, 0, C("#c8102e")); }
  }
  // airport runways + taxiways (OSM aeroway lines, real widths)
  if (g && g.aero && g.aero.length) {
    const RW = { pos: [], uv: [] }, TW = { pos: [], uv: [] }, MK = { pos: [], uv: [] }, TY = { pos: [], uv: [] };
    for (const a of g.aero) {
      if (a.p.length < 2) continue; const hw = (a.w || (a.k === "runway" ? 30 : 15)) / 2; ribbon(a.p, hw, 0, a.k === "runway" ? 0.05 : 0.045, a.k === "runway" ? RW : TW, 0.1);
      const P = a.p, L = plen(P); let acc = 0;
      for (let i = 0; i < P.length - 1; i++) { const [ax, ay] = P[i], [bx, by] = P[i + 1], l = Math.hypot(bx - ax, by - ay); if (l < 1) continue; const ux = (bx - ax) / l, uy = (by - ay) / l, nx = -uy, ny = ux;
        for (let s = 0; s < l; s += a.k === "runway" ? 50 : 6) { const at = acc + s, x = ax + ux * s, y = ay + uy * s; if (a.k === "runway") { if (at > 60 && at < L - 60) MK.pos.push(...quad(x, y, ux, uy, 30, 0.45, 0.07)); } else TY.pos.push(...quad(x, y, ux, uy, 6, 0.12, 0.065)); }
        if (a.k === "runway" && i === 0) for (let k = -5; k <= 5; k++) if (k) { const o = k * hw / 6.5; MK.pos.push(...quad(ax + ux * 15 + nx * o, ay + uy * 15 + ny * o, ux, uy, 30, 0.9, 0.07)); }
        if (a.k === "runway" && i === P.length - 2) for (let k = -5; k <= 5; k++) if (k) { const o = k * hw / 6.5; MK.pos.push(...quad(bx - ux * 15 + nx * o, by - uy * 15 + ny * o, ux, uy, 30, 0.9, 0.07)); }
        acc += l; }
    }
    for (const o of [MK, TY]) o.uv = new Array(o.pos.length / 3 * 2).fill(0);
    const add = (o, m, n) => { const r = meshFrom(o, m, n); if (r) { r.removeFromParent(); lmGroup.add(r); } };
    add(RW, flatMat(X.mat("asphalt", 47, "#3c3e41", { rough: 0.95, name: "H_Runway", rep: [0.08, 0.08] })), "Runways"); add(TW, flatMat(X.mat("asphalt", 48, "#4a4c50", { rough: 0.95, name: "H_Taxiway", rep: [0.1, 0.1] })), "Taxiways");
    add(MK, flatMat(G.M("#f2f2ee", { rough: 0.6, name: "H_RunwayMark" })), "RunwayMarks"); add(TY, flatMat(G.M("#e2b53a", { rough: 0.6, name: "H_TaxiLine" })), "TaxiLines");
  }
  // Houma Tunnel (LA 3040 under the Intracoastal): concrete portals at each bore end + walls along the approach
  for (const f of tunnels) {
    const P = f.p, hw = roadHW(f) + 1;
    for (const e of [0, 1]) { const a = e ? P[P.length - 1] : P[0], b = e ? P[P.length - 2] : P[1], L = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, ux = (a[0] - b[0]) / L, uy = (a[1] - b[1]) / L, nx = -uy, ny = ux, ang = Math.atan2(uy, ux);
      if (onRoad(a[0] - ux * 2, a[1] - uy * 2, -0.5) && false) continue;
      for (const sd of [-1, 1]) boxOut(O, a[0] + nx * sd * (hw + 0.8), a[1] + ny * sd * (hw + 0.8), 0, 3, 6.5, 1.6, ang + Math.PI / 2, C("#c9c4b8"));
      boxOut(O, a[0], a[1], 4.8, 2.2, 1.9, hw * 2 + 3.2, ang, C("#c9c4b8")); boxOut(O, a[0] - ux * 0.9, a[1] - uy * 0.9, 0, 0.2, 4.8, hw * 2, ang, C("#101214"));
      signBoard("HOUMA TUNNEL", "#1f5f3a", a[0] + ux * 1.15, a[1] + uy * 1.15, 5.75, Math.min(hw * 2, 12), 1.5, ang + Math.PI / 2);
      for (const sd of [-1, 1]) for (let k = 1; k <= 6; k++) boxOut(O, a[0] + ux * k * 8 + nx * sd * (hw + 0.6), a[1] + uy * k * 8 + ny * sd * (hw + 0.6), 0, 8.2, Math.max(0.6, 4.6 - k * 0.7), 0.5, ang, C("#c9c4b8"));
    }
  }
  const mm = meshFrom(O, bmats().misc, "LandmarkModels", { shadow: true }); if (mm) { mm.removeFromParent(); lmGroup.add(mm); }
}
// ---------------------------------------------------------------- GPS route ribbon + guidance arrow
function syncGPS(P, pz) {
  const v = S.routeVer ? S.routeVer() : 0;
  if (v !== gpsVer || (gpsMesh && gpsMesh.parent !== scene)) {
    gpsVer = v; if (gpsMesh) { gpsMesh.geometry.dispose(); gpsMesh.removeFromParent(); gpsMesh = null; }
    const r = S.route && S.route();
    if (r && r.pts && r.pts.length > 1) {
      // densify, remembering which source vertex each piece came from so only the part ahead of the car is drawn
      const pts = [r.pts[0]], src = [0];
      for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1], b = r.pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4)); for (let k = 1; k <= n; k++) { pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); src.push(i - 1); } }
      // follow the drivable surface continuously (bridge ramps/decks included) and float just above it
      let cur = deckY(pts[0][0], pts[0][1], Math.abs(pz - deckY(pts[0][0], pts[0][1], 0)) < 2 ? 0 : pz); const ys = pts.map((q) => (cur = deckY(q[0], q[1], cur)) + 0.32);
      const o = { pos: [], uv: [] }; ribbon(pts, 1.3, 0, ys, o, 0.2);
      gpsMesh = meshFrom(o, new T.MeshBasicMaterial({ color: "#19b6ff", transparent: true, opacity: 0.85, depthWrite: false, side: T.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, name: "H_GPSRoute" }), "GPSRoute");
      if (gpsMesh) { gpsMesh.renderOrder = 10; gpsMesh.receiveShadow = false; gpsMesh.frustumCulled = false; gpsMesh.userData.src = src; gpsMesh.userData.k = -1; }
    }
  }
  if (gpsMesh) { // trim the part already driven: draw from a little behind the route vertex nearest the car
    const r = S.route && S.route(), k = r ? Math.max(0, (r.k || 0) - 1) : 0;
    if (k !== gpsMesh.userData.k) { gpsMesh.userData.k = k; const src = gpsMesh.userData.src; let j = 0; while (j < src.length - 1 && src[j] < k) j++; const tot = gpsMesh.geometry.attributes.position.count; gpsMesh.geometry.setDrawRange(Math.min(tot, j * 6), Infinity); }
    gpsMesh.visible = true;
  }
  if (!gpsArrow) { const s = new T.Shape(); s.moveTo(0, 1.6); s.lineTo(1.1, -0.6); s.lineTo(0, -0.1); s.lineTo(-1.1, -0.6); s.closePath(); const g = new T.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: false }); g.rotateX(-Math.PI / 2); gpsArrow = new T.Mesh(g, new T.MeshStandardMaterial({ color: "#19b6ff", emissive: "#0a6fa8", emissiveIntensity: 0.8, name: "H_GPSArrow" })); gpsArrow.name = "GPSArrow"; scene.add(gpsArrow); }
  const r = S.route && S.route(); if (!r || !r.pts || r.pts.length < 2) { gpsArrow.visible = false; return; }
  // aim at the route point ~25 m ahead of the closest point
  let bi = 0, bd = 1e9; for (let i = 0; i < r.pts.length; i++) { const d = Math.hypot(r.pts[i][0] - P.x, r.pts[i][1] - P.y); if (d < bd) { bd = d; bi = i; } }
  let j = bi; while (j < r.pts.length - 1 && Math.hypot(r.pts[j][0] - P.x, r.pts[j][1] - P.y) < 25) j++;
  const tx = r.pts[j][0], ty = r.pts[j][1]; gpsArrow.visible = !aerial; const ga = Math.atan2(ty - P.y, tx - P.x); gpsArrow.position.set(P.x + Math.cos(ga) * 7, pz + 0.9 + Math.sin(clock * 3) * 0.12, P.y + Math.sin(ga) * 7); gpsArrow.rotation.y = Math.atan2(tx - P.x, ty - P.y) + Math.PI;
}

let treeSets = [], treeCache = new Map(); const TB = 100;
const TREES = [["decid", 9.5], ["decid", 6.5], ["palm", 7.5], ["willow", 8], ["pine", 10], ["shrub", 1.3], ["birch", 8], ["decid", 10], ["pine", 15]];
const TREE_SCALE = [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [2.1, 0.95], [0.55, 1.1]]; // [horizontal, vertical]: 7 = live oak, 8 = bald cypress
function nearWater(x, y) { for (const [ox, oy] of [[0, 0], [18, 0], [-18, 0], [0, 18], [0, -18]]) if (tileAt(x + ox, y + oy) === S.T.WATER) return true; return false; }
function buildTreeSets() { treeSets = TREES.map(([sp, h], i) => new Instanced("Tree_" + sp + i, { group: W.treeModel(sp, 101 + i * 17, h) }, 128, { noRoles: true })); }
function treesIn(bi, bj) {
  const key = bi * 100003 + bj; if (treeCache.has(key)) return treeCache.get(key);
  const out = [], r = G.rng(hash(key) || 1), x0 = bi * TB, y0 = bj * TB, step = 13;
  for (let x = x0 + step / 2; x < x0 + TB; x += step) for (let y = y0 + step / 2; y < y0 + TB; y += step) {
    const px = x + (r() - 0.5) * step * 0.9, py = y + (r() - 0.5) * step * 0.9, roll = r(), sel = r(), sc = 0.75 + r() * 0.5, ry = r() * 6.28;
    const t = tileAt(px, py); if (t !== S.T.GRASS && t !== S.T.PARK) continue;
    if (roll > (t === S.T.PARK ? 0.5 : 0.24)) continue;
    if (onRoad(px, py, 3) || masked(px, py)) continue;
    const wet = nearWater(px, py);
    const kind = wet && sel < 0.55 ? 8 : wet && sel < 0.7 ? 3 : sel < 0.24 ? 7 : sel < 0.4 ? 0 : sel < 0.52 ? 1 : sel < 0.58 ? 2 : sel < 0.64 ? 3 : sel < 0.7 ? 4 : sel < 0.93 ? 5 : 6; out.push(px, py, kind, ry, sc);
  }
  treeCache.set(key, out); return out;
}
function refillTrees(px, py) {
  const R = Math.min(Q.view, 420), R2 = R * R, dens = Q.trees; nearTrees = []; for (const s of treeSets) s.begin();
  for (let i = Math.floor((px - R) / TB); i <= Math.floor((px + R) / TB); i++) for (let j = Math.floor((py - R) / TB); j <= Math.floor((py + R) / TB); j++) {
    const L = treesIn(i, j); for (let k = 0; k < L.length; k += 5) { const dx = L[k] - px, dy = L[k + 1] - py, d2 = dx * dx + dy * dy; if (d2 > R2) continue; if (dens < 1 && ((k / 5) % 10) / 10 >= dens && L[k + 2] !== 0) continue; if (d2 > 48400 && (k / 5) % 3 === 1) continue; // LOD: thin trees past 220 m (fog hides the gaps)
      const ts = TREE_SCALE[L[k + 2]], sc = L[k + 4], set = treeSets[L[k + 2]]; if (d2 < 3600) nearTrees.push({ set, i: set.pending.length, x: L[k], y: L[k + 1], ry: L[k + 3], sx: sc * ts[0], sy: sc * ts[1], r: 2.2 + 3 * sc * ts[0], hid: false }); set.add(L[k], 0, L[k + 1], L[k + 3], sc * ts[0], sc * ts[1], sc * ts[0]); }
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
    c._z = deckY(c.x, c.y, c._z || 0); o.position.set(c.x, c._z, c.y); o.rotation.y = -c.a; W.setCarLights(o, nk, (c.v || 0) < 0.3 && nk > 0.2);
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
  for (const w of use) { const o = simFor(w.key, w.seed, w.name); live.add(o); o.visible = true; o.position.set(w.x, w.key === "player" ? pZ : 0, w.y); o.rotation.y = Math.atan2(Math.cos(w.a || 0), Math.sin(w.a || 0)); poseSim(o, w.mv, t); }
  for (const o of simCache.values()) if (!live.has(o)) o.visible = false;
  people = use;
}
function updateLabels() {
  if (!labelsEl) return; const out = [], w = stage.clientWidth, h = stage.clientHeight;
  const add = (x, y, z, html, cls) => { tmpV.set(x, y, z).project(camera); if (tmpV.z > 1 || tmpV.z < -1) return; const sx = (tmpV.x + 1) / 2 * w, sy = (1 - tmpV.y) / 2 * h; if (sx < -50 || sx > w + 50 || sy < 0 || sy > h) return; out.push(`<div class="hm3-label ${cls}" style="transform:translate(${sx.toFixed(0)}px,${sy.toFixed(0)}px) translate(-50%,-100%)">${html}</div>`); };
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let n = 0; for (const w of people) { if (!w.res || w.d > 26 || n >= 6) continue; n++; const p = w.res.home && w.res.home.p || {}; add(w.x, 2.25, w.y, `<b>${esc(w.res.name)}</b><span>${esc(p.site || p.addr || p.a || "")}</span>`, "res"); }
  let b = 0; S.nearBuckets(S.player.x, S.player.y, 45, (hm) => { if (b >= 3 || !hm.biz || !hm.inst) return; const d = Math.hypot(hm.inst.x - S.player.x, hm.inst.y - S.player.y); if (d > 45) return; b++; const p = hm.p || {}; add(hm.inst.x, 7.5, hm.inst.y, `<b>${esc(p.owner || p.o || "Business")}</b><span>${esc(p.site || p.addr || "")}</span>`, "biz"); });
  for (const { m } of markHits) { const d = Math.hypot(m.x - S.player.x, m.y - S.player.y); if (d < 420 && out.length < 12) add(m.x, 14, m.y, `<b>${esc(m.n)}</b>`, "biz"); }
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
  W.setNight(nk); W.WINDOW_GLOW.emissiveIntensity = 0.05 + nk * 1.6; materials().glass.emissiveIntensity = nk * 1.25; for (const fm of Object.values(facadeMats)) fm.emissiveIntensity = nk * 1.1; materials().sign.emissiveIntensity = 0.05 + nk * 0.5;
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
  building = true; buildGround(); buildMarsh(); buildWater(); buildRoads(); buildBridges(); buildTreeSets(); buildGrass(); buildBuildings(); built = true; building = false;
}
function frame(dt) {
  if (failed) return; S = H.state(); if (!S || !S.ready()) return;
  if (!renderer) { try { init(); } catch (e) { failed = true; console.warn("Houma 3D unavailable", e); return; } }
  if (!built) { if (!building) build(); active = true; }
  if (!stage.offsetParent) return; // view hidden (Properties tab etc.)
  if (S.homes.length !== builtHomes && S.homesReady()) buildBuildings();
  clock += dt; K.U.uTime.value = clock;
  const P = S.player, mode = S.camMode();
  if (aerial) {
    const ax = aerial.x ?? P.x, ay = aerial.y ?? P.y, hgt = aerial.h || 420; camera.up.set(0, 0, -1); camera.position.set(ax, hgt, ay + (aerial.tilt || 0)); camera.lookAt(ax, 0, ay); camera.up.set(0, 1, 0);
    scene.fog.near = 1e5; scene.fog.far = 1e6; if (camera.far < hgt * 3) { camera.far = hgt * 3; camera.updateProjectionMatrix(); }
    if (Math.hypot(ax - lastRefill.x, ay - lastRefill.z) > 40 || aerial.dirty) { aerial.dirty = false; lastRefill.x = ax; lastRefill.z = ay; refill(ax, ay); for (const m of farChunks) m.visible = Math.hypot(m.userData.cx - ax, m.userData.cy - ay) < m.userData.far + hgt * 1.6 + 424; }
    pumpTiles(40); syncGPS(P, 0);
    lighting(dt, tmpS.set(ax, 0, ay).clone()); scene.fog.near = 1e5; scene.fog.far = 1e6; renderer.render(scene, camera); if (labelsEl) labelsEl.innerHTML = ""; return;
  }
  pumpTiles(6); if (lastRefill.fence) { lastRefill.fence = false; refillFences(P.x, P.y, viewR()); }
  if (Math.hypot(P.x - (lastP.x ?? 1e9), P.y - (lastP.y ?? 1e9)) > 25) pZ = deckY(P.x, P.y, 99); lastP.x = P.x; lastP.y = P.y; // spawned/teleported: land on the top deck, not under it
  pZ += (deckY(P.x, P.y, pZ) - pZ) * Math.min(1, dt * 8); syncGPS(P, pZ);
  const fx = Math.cos(P.a), fy = Math.sin(P.a); let dist = mode === 1 ? 7 : 11, ht = mode === 1 ? 2.6 : 4.0;
  if (++occN % 3 === 0) occDist = camOcclusion(P.x, P.y, fx, fy, dist, ht, pZ); dist = Math.min(dist, occDist); ht = Math.min(ht, 1.9 + dist * 0.2);
  camPos.set(P.x - fx * dist, ht + pZ, P.y - fy * dist); const look = tmpV.set(P.x + fx * 8, 1.7 + pZ, P.y + fy * 8);
  const k = 1 - Math.exp(-dt * 6); if (camera.position.lengthSq() < 1 || camera.position.distanceTo(camPos) > 80) { camera.position.copy(camPos); camLook.copy(look); } else { camera.position.lerp(camPos, k); camLook.lerp(look, k); }
  camera.lookAt(camLook);
  if (Math.hypot(P.x - lastRefill.x, P.y - lastRefill.z) > 40) { lastRefill.x = P.x; lastRefill.z = P.y; refill(P.x, P.y); for (const m of farChunks) m.visible = Math.hypot(m.userData.cx - P.x, m.userData.cy - P.y) < m.userData.far + 424; }
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
  // overhead map view: Houma3D.aerial({ h: 400, x, y }) centers on world meters (default: player); Houma3D.aerial(null) returns to the chase cam
  probe: () => { const rc = new T.Raycaster(), out = []; for (const d of [[0, 1, 0], [0, 0, -1]]) { rc.camera = camera; rc.set(camera.position, new T.Vector3(...d).applyQuaternion(d[1] ? new T.Quaternion() : camera.quaternion)); const h = rc.intersectObjects(scene.children, true)[0]; out.push(h ? [h.object.name, h.object.material && h.object.material.name, +h.distance.toFixed(1), [h.point.x, h.point.y, h.point.z].map((v) => +v.toFixed(1))] : null); } return { cam: camera.position.toArray().map((v) => +v.toFixed(1)), out }; },
  deckY: (x, y, z) => deckY(x, y, z),
  snapZ: (z) => { pZ = z; },
  gpsDbg: () => [typeof S.routeVer, gpsVer, !!gpsMesh, !!gpsArrow, gpsArrow && gpsArrow.visible, gpsMesh && gpsMesh.geometry.attributes.position.count, gpsMesh && gpsMesh.geometry.drawRange.start, gpsMesh && gpsMesh.parent === scene],
  triStats: () => { const m = {}; scene.traverseVisible((o) => { if (!o.geometry) return; const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); const k = (o.name || "?").replace(/\d+$/, ""); m[k] = (m[k] || 0) + n; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => k + ":" + Math.round(v / 1000) + "k"); },
  aerial: (o) => { aerial = o ? { ...o, dirty: true } : null; lastRefill.x = 1e9; if (!o && scene) applyQuality(qName); },
  setQuality: (q) => { qAuto = false; applyQuality(q); },
  stats: () => ({ quality: qName, built, houses: Object.values(houseSets).reduce((a, s) => a + s.n, 0), biz: Object.values(bizSets).reduce((a, s) => a + s.n, 0), trees: treeSets.reduce((a, s) => a + s.n, 0), grass: grass ? grass.count : 0, lamps: lamps.length, lampsOnRoad, bld: { ...bStats }, tilesBuilt: [...bTiles.values()].filter((t) => t.meshes).length, tilesTotal: bTiles.size, lotTilesBuilt: [...lotTiles.values()].filter((t) => t.meshes).length, queue: buildQ.length, landmarks: markHits.map((h) => [h.m.k, h.m.n, !!h.b]), tunnels: tunnels.length, elevated: S && S.osm ? S.osm.roads.filter((f) => f.bz).length : 0, calls: renderer ? renderer.info.render.calls : 0, tris: renderer ? renderer.info.render.triangles : 0 }),
};
