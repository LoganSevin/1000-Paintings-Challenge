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
import PC from "./vendor-polyclip.js?v=1";
import * as TR from "./houma-trees.js?v=2";
import * as GR from "./houma-grit.js?v=3";
import { createPost } from "./houma-post.js?v=2";

const K = W.Kit, H = window.Houma;
const QUALITY = {
  low: { ratio: 1, shadows: false, map: 512, tex: 128, grass: 700, view: 280, people: 6, trees: 0.55, lampLights: "low", carpet: 0 },
  med: { ratio: 1.5, shadows: true, map: 1024, tex: 256, grass: 2200, view: 440, people: 14, trees: 1, lampLights: "med", carpet: 7 },
  high: { ratio: 2, shadows: true, map: 2048, tex: 256, grass: 4500, view: 620, people: 24, trees: 1.25, lampLights: "high", post: "high", env: true, imp: 150, carpet: 12, motes: true },
  cine: { ratio: 2, shadows: true, map: 4096, tex: 256, grass: 7000, view: 700, people: 24, trees: 1.35, lampLights: "high", post: "cine", env: true, imp: 200, carpet: 16, motes: true },
};
QUALITY.low.imp = 70; QUALITY.med.imp = 110; QUALITY.med.env = true;
const QORDER = ["low", "med", "high", "cine"];
let cineT = 0, cineShot = -1, post = null, painterly = false, cineCam = true, envKey = "", envRT = null, pmrem = null;
const defaultQ = () => (isPhone() ? "low" : "high");
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
  roof: ["#6a6a6c", "#7a6a5e", "#5e6a76", "#7e5a48", "#7e8286", "#58585a", "#8a6a54", "#67726a", "#75777c"],
  tin: ["#c9cdd0", "#b8bcc0", "#dfe2e3", "#a3abb0", "#8a4a3a", "#4f7fa8", "#9a9a92", "#a8463a", "#d4d0c4"],
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
// ---------------------------------------------------------------- aerial ground drape
// USDA NAIP orthoimagery (public domain, USGS National Map image service) draped over the ground near the player, so the real
// lawns, driveways, gravel, ditches, tree lines and bayou banks show where the parish/OSM vectors have no data. 900 m tile at ~0.9 m/px,
// refetched when the player moves ~250 m; edges fade into the procedural ground. Opt out with localStorage hm-naip = "0".
const NAIP = { mesh: null, cx: 1e9, cy: 1e9, busy: false, fail: 0, R: 900, PX: 1024 };
const NAIP_URL = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage";
function naipOn() { try { return localStorage.getItem("hm-naip") !== "0"; } catch (e) { return true; } }
// Tree canopy mask from the same aerial tile: dark, green, textured pixels on a 4 m grid are woods; trees are placed
// only there (plus sparse yard trees), so stands follow the real tree lines and open lawns stay open.
const FOREST = { cx: 1e9, cy: 1e9, N: 225, R: 900, m: null, ver: 0 };
function naipForest(img, cx, cy) {
  const N = FOREST.N, c = document.createElement("canvas"); c.width = c.height = N * 2; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, N * 2, N * 2);
  const d = g.getImageData(0, 0, N * 2, N * 2).data, m = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let sr = 0, sg = 0, sb = 0, lo = 1e9, hi = -1e9;
    for (let v = 0; v < 2; v++) for (let u = 0; u < 2; u++) { const k = ((j * 2 + v) * N * 2 + i * 2 + u) * 4, r = d[k], gg = d[k + 1], b = d[k + 2]; sr += r; sg += gg; sb += b; const L = r + gg + b; lo = Math.min(lo, L); hi = Math.max(hi, L); }
    sr /= 4; sg /= 4; sb /= 4; const L = (sr + sg + sb) / 3, tex = hi - lo;
    const green = sg >= sr - 2 && sg > sb + 2;
    m[j * N + i] = green && L < 92 ? (L < 70 || tex > 40 ? 2 : 1) : 0;
  }
  // close small holes / drop speckles (one 3x3 majority pass)
  const o = new Uint8Array(N * N);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { let n = 0; for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) n += m[(j + v) * N + i + u] ? 1 : 0; o[j * N + i] = n >= 5 ? Math.max(1, m[j * N + i]) : 0; }
  FOREST.m = o; FOREST.cx = cx; FOREST.cy = cy; FOREST.ver++;
  treeCache.clear(); lastRefill.x = 1e9;
}
function forestAt(x, y) { // -1 unknown, 0 open, 1 trees, 2 dense woods
  if (!FOREST.m) return -1; const N = FOREST.N, i = Math.floor(((x - FOREST.cx) / FOREST.R + 0.5) * N), j = Math.floor(((y - FOREST.cy) / FOREST.R + 0.5) * N);
  if (i < 2 || j < 2 || i >= N - 2 || j >= N - 2) return -1; const dx = i - N / 2, dy = j - N / 2; if (dx * dx + dy * dy > (N * 0.46) ** 2) return -1; return FOREST.m[j * N + i];
}
function naipPump(px, py) {
  if (NAIP.busy || NAIP.fail > 3 || !naipOn() || Math.hypot(px - NAIP.cx, py - NAIP.cy) < 250) return;
  const O = S.origin ? S.origin() : [29.59007223, -90.72057], kx = 111320 * Math.cos((O[0] * Math.PI) / 180), ky = 110540, h = NAIP.R / 2;
  const cx = Math.round(px / 50) * 50, cy = Math.round(py / 50) * 50;
  const w = O[1] + (cx - h) / kx, e = O[1] + (cx + h) / kx, n = O[0] - (cy - h) / ky, so = O[0] - (cy + h) / ky;
  const url = NAIP_URL + "?bbox=" + [w, so, e, n].map((v) => v.toFixed(6)).join(",") + "&bboxSR=4326&imageSR=4326&size=" + NAIP.PX + "," + NAIP.PX + "&format=jpg&compressionQuality=80&f=image";
  NAIP.busy = true; const img = new Image(); img.crossOrigin = "anonymous";
  img.onload = () => {
    NAIP.busy = false; NAIP.cx = cx; NAIP.cy = cy;
    const c = document.createElement("canvas"); c.width = c.height = NAIP.PX; const g = c.getContext("2d"); g.drawImage(img, 0, 0, NAIP.PX, NAIP.PX);
    try { naipForest(img, cx, cy); } catch (e) { /* tainted or unavailable: keep the old tree layout */ }
    // soft circular fade so the tile edge never shows as a hard square
    g.globalCompositeOperation = "destination-in"; const r = NAIP.PX / 2, gr = g.createRadialGradient(r, r, r * 0.62, r, r, r * 0.98); gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, NAIP.PX, NAIP.PX);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    if (!NAIP.mesh) { const geo = new T.PlaneGeometry(NAIP.R, NAIP.R); geo.rotateX(-Math.PI / 2); NAIP.mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ transparent: true, depthWrite: false, roughness: 0.97, name: "H_Aerial" })); cutMat(NAIP.mesh.material); NAIP.mesh.name = "AerialDrape"; NAIP.mesh.receiveShadow = true; scene.add(NAIP.mesh); }
    const m = NAIP.mesh.material; if (m.map) m.map.dispose(); m.map = tex; m.needsUpdate = true; NAIP.mesh.position.set(cx, 0.033, cy);
  };
  img.onerror = () => { NAIP.busy = false; NAIP.fail++; NAIP.cx = cx; NAIP.cy = cy; };
  img.src = url;
}
// Bayous are carved: a stencil cap over every channel cuts the flat ground/lots/aerial away, sloped mud banks drop
// to a murky water surface a metre or so below the land, so the channels read as real cuts in the marsh.
const WATER_Y = -1.15, BED_Y = -2.4;
const CUT_MATS = new Set();
function cutMat(m) { if (!m || CUT_MATS.has(m)) return m; m.stencilWrite = true; m.stencilRef = 1; m.stencilFunc = T.NotEqualStencilFunc; m.stencilFail = T.KeepStencilOp; m.stencilZFail = T.KeepStencilOp; m.stencilZPass = T.KeepStencilOp; CUT_MATS.add(m); return m; }
const MURK = new T.MeshStandardMaterial({ color: "#5a5a3a", roughness: 0.35, metalness: 0.0, emissive: "#14160c", name: "H_BayouWater" });
function disc(cx, cy, r, y, out, n = 10) { for (let i = 0; i < n; i++) { const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2; out.pos.push(cx, y, cy, cx + Math.cos(a1) * r, y, cy + Math.sin(a1) * r, cx + Math.cos(a0) * r, y, cy + Math.sin(a0) * r); out.uv.push(cx, cy, cx, cy, cx, cy); } }
function bankStrip(pts, o1, o2, y1, y2, out) { // strip between offsets o1 (height y1) and o2 (height y2)
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy); if (L < 0.01) continue;
    const nx = -dy / L, ny = dx / L, e = Math.min(1.2, L * 0.2), ex = dx / L * e, ey = dy / L * e;
    const P = (x, y, o) => [x + nx * o, y + ny * o];
    const a1 = P(ax - ex, ay - ey, o1), a2 = P(ax - ex, ay - ey, o2), b1 = P(bx + ex, by + ey, o1), b2 = P(bx + ex, by + ey, o2);
    out.pos.push(a1[0], y1, a1[1], b1[0], y1, b1[1], a2[0], y2, a2[1], a2[0], y2, a2[1], b1[0], y1, b1[1], b2[0], y2, b2[1]);
    out.uv.push(ax * 0.2, y1, bx * 0.2, y1, ax * 0.2, y2 * 3, ax * 0.2, y2 * 3, bx * 0.2, y1, bx * 0.2, y2 * 3);
  }
}
// at-grade roads crossing a carved channel ride on an earthen causeway (culvert fill) instead of floating over the cut
function buildCulverts() {
  const E = { pos: [], uv: [] };
  for (const f of S.osm.roads) {
    if (f.lvl === -1) continue; const pts = f.p3 || f.p; if (!pts || pts.length < 2) continue; const hw = roadHW(f) + 1.2;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay); if (L < 0.2) continue; const ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux;
      for (let s0 = 0; s0 < L; s0 += 3) {
        const s1 = Math.min(L, s0 + 3), mx = ax + ux * (s0 + s1) / 2, my = ay + uy * (s0 + s1) / 2; if (tileAt(mx, my) !== S.T.WATER && !bankAt(mx, my, hw)) continue; if (deckY(mx, my, 0) > 0.3) continue;
        const p0 = [ax + ux * (s0 - 0.5), ay + uy * (s0 - 0.5)], p1 = [ax + ux * (s1 + 0.5), ay + uy * (s1 + 0.5)];
        for (const sd of [-1, 1]) { const o1 = sd * hw, o2 = sd * (hw + 3.2), q = (p, o) => [p[0] + nx * o, p[1] + ny * o];
          const a1 = q(p0, o1), b1 = q(p1, o1), a2 = q(p0, o2), b2 = q(p1, o2); E.pos.push(a1[0], 0.035, a1[1], b1[0], 0.035, b1[1], a2[0], BED_Y, a2[1], a2[0], BED_Y, a2[1], b1[0], 0.035, b1[1], b2[0], BED_Y, b2[1]); E.uv.push(0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1);
          const t1 = q(p0, sd * 0.01), t2 = q(p1, sd * 0.01); E.pos.push(a1[0], 0.03, a1[1], t1[0], 0.03, t1[1], b1[0], 0.03, b1[1], b1[0], 0.03, b1[1], t1[0], 0.03, t1[1], t2[0], 0.03, t2[1]); E.uv.push(0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1); }
      }
    }
  }
  const m = new T.MeshStandardMaterial({ map: X.mat("marsh", 32, "#ffffff", { rough: 1 }).map, color: "#8a7a5a", roughness: 1, side: T.DoubleSide, name: "H_Causeway" });
  const o = meshFrom(E, m, "Causeways"); if (o) { o.geometry.computeVertexNormals(); o.receiveShadow = false; }
}
function buildWater() {
  const CAP = { pos: [], uv: [] }, WS = { pos: [], uv: [] }, BK = { pos: [], uv: [] }, shapes = [], capShapes = [];
  for (const f of S.osm.water) {
    const pts = f.p; if (pts.length < 2) continue;
    const closed = f.wk ? f.wk === "area" : pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1;
    if (closed && pts.length > 2) {
      const s = new T.Shape(); pts.forEach((q, i) => (i ? s.lineTo(q[0], -q[1]) : s.moveTo(q[0], -q[1]))); shapes.push(s);
      // inward bank ring
      const [ax, ay] = pts[0], [bx, by] = pts[1], L = Math.hypot(bx - ax, by - ay) || 1, tx = (ax + bx) / 2 - (by - ay) / L * 0.6, ty = (ay + by) / 2 + (bx - ax) / L * 0.6;
      const sg = inPoly(pts, tx, ty) ? 1 : -1; bankStrip(pts, 0, sg * 5, 0, BED_Y, BK);
    } else {
      const hw = Math.max(1.5, (f.w || 28) / 2), bw = Math.min(4.5, hw * 0.75);
      ribbon(pts, hw, 0, 0, CAP, 0.05); ribbon(pts, hw, 0, WATER_Y, WS, 0.05);
      for (const q of pts) { disc(q[0], q[1], hw, 0, CAP); disc(q[0], q[1], hw, WATER_Y, WS); }
      bankStrip(pts, hw, hw - bw, 0, BED_Y, BK); bankStrip(pts, -hw, -hw + bw, 0, BED_Y, BK);
    }
  }
  const capM = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: T.DoubleSide, name: "H_WaterCut" });
  capM.stencilWrite = true; capM.stencilRef = 1; capM.stencilFunc = T.AlwaysStencilFunc; capM.stencilZPass = T.ReplaceStencilOp;
  const cap = meshFrom(CAP, capM, "WaterCut"); if (cap) { cap.renderOrder = -10; cap.position.y = 0.002; cap.receiveShadow = false; }
  if (shapes.length) { const g = new T.ShapeGeometry(shapes); g.rotateX(-Math.PI / 2); const m = new T.Mesh(g, capM); m.renderOrder = -10; m.position.y = 0.002; m.name = "WaterAreaCut"; scene.add(m);
    const w = new T.Mesh(g, MURK); w.position.y = WATER_Y; w.receiveShadow = false; w.name = "WaterAreas"; scene.add(w); }
  const bm = new T.MeshStandardMaterial({ map: X.mat("marsh", 31, "#ffffff", { rough: 1 }).map, color: "#8f7a55", roughness: 1, side: T.DoubleSide, name: "H_Bank" });
  const bank = meshFrom(BK, bm, "WaterBank"); if (bank) { bank.geometry.computeVertexNormals(); bank.receiveShadow = false; }
  const wm = meshFrom(WS, MURK, "WaterLines"); if (wm) wm.receiveShadow = false; // below grade: the uncut ground would shadow them
  for (const n of ["Ground", "Wetlands", "Parks", "Parking"]) { const o = scene.getObjectByName(n); if (o && o.material) cutMat(o.material); }
}
let lampSet = null, poolSet = null, eyeSet = null, lamps = [], elevGrid = new Map(), tunnels = [], lampsOnRoad = 0;
function addElev(ax, ay, az, bx, by, bz, hw) { const s = { ax, ay, az, bx, by, bz, hw }; const x0 = Math.floor((Math.min(ax, bx) - hw) / SEG), x1 = Math.floor((Math.max(ax, bx) + hw) / SEG), y0 = Math.floor((Math.min(ay, by) - hw) / SEG), y1 = Math.floor((Math.max(ay, by) + hw) / SEG); for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const k = i * 100003 + j; let L = elevGrid.get(k); if (!L) elevGrid.set(k, (L = [])); L.push(s); } }
// height of the drivable surface under (x, y) nearest to the current height `cur` (bridge decks + ramps; 0 = ground)
function deckY(x, y, cur = 0) {
  // inside a ramp/deck footprint the deck wins over the ground (a ramp starts at z~0, so a tie must go to the ramp);
  // the ground only wins when every deck here is well above us (driving under an overpass) or far below (no snapping down)
  const L = elevGrid.get(Math.floor(x / SEG) * 100003 + Math.floor(y / SEG)); if (!L) return 0; let best = null, bd = 1e9;
  for (const s of L) { const dx = s.bx - s.ax, dy = s.by - s.ay, LL = dx * dx + dy * dy || 1, t = clamp(((x - s.ax) * dx + (y - s.ay) * dy) / LL, 0, 1); if (Math.hypot(x - s.ax - dx * t, y - s.ay - dy * t) > s.hw + 0.9) continue; const z = s.az + (s.bz - s.az) * t; if (z - cur > 2.2) continue; const d = Math.abs(z - cur); if (d < bd) { bd = d; best = z; } }
  if (best == null) return 0; if (Math.abs(cur) + 0.05 < bd && cur < 0.6) return 0; return best;
}
function densify(p, step) { const o = [p[0]]; for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step)); for (let k = 1; k <= n; k++) o.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } return o; }
const plen = (p) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return s; };
const roadHW = (f) => f.hw || (ROADW[f.h] || 6) / 2;
// OSM bridge=yes ways become raised decks: overpasses at 6.4 m per layer, bayou bridges low, long canal (Intracoastal) spans high;
// the connected approach roads ramp down at ~5.5 % so cars and the camera can drive up onto them.
let bridgeList = [];
function roadProfiles() {
  const roads = S.osm.roads.filter((f) => f.p && f.p.length >= 2), ends = new Map(), key = (q) => Math.round(q[0] / 3) + "," + Math.round(q[1] / 3);
  for (const f of roads) { f.p3 = null; f.zs = null; for (const e of [0, 1]) { const k = key(e ? f.p[f.p.length - 1] : f.p[0]); let L = ends.get(k); if (!L) ends.set(k, (L = [])); L.push({ f, e }); } }
  const prep = (f) => { if (!f.p3) { f.p3 = densify(f.p, 8); f.zs = new Array(f.p3.length).fill(0); } };
  const isBr = (f) => f.osm && f.lvl > 0;
  const out = (f, e) => { const p = f.p, n = p.length, a = e ? p[n - 1] : p[0], b = e ? p[n - 2] : p[1], L = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; return [(a[0] - b[0]) / L, (a[1] - b[1]) / L]; };
  const cont = (f, e, wantBridge) => { const v = out(f, e); let best = null, bs = 0.35; for (const c of ends.get(key(e ? f.p[f.p.length - 1] : f.p[0])) || []) { if (c.f === f || c.f.lvl === -1 || isBr(c.f) !== wantBridge) continue; const w = out(c.f, c.e), d = -(v[0] * w[0] + v[1] * w[1]) + (c.f.n && c.f.n === f.n ? 0.2 : 0); if (d > bs) { bs = d; best = c; } } return best; };
  const climb = (f, e, H, run, depth, chain) => { if (chain) chain.push({ f, e });
    prep(f); const pts = f.p3, n = pts.length, RL = H / (H > 12 ? 0.05 : 0.06); let s = run;
    for (let i = 0; i < n; i++) { const idx = e ? n - 1 - i : i; if (i) { const a = pts[e ? idx + 1 : idx - 1], b = pts[idx]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); } const k = clamp(1 - s / RL, 0, 1), z = H * k * k * (3 - 2 * k); if (z > f.zs[idx]) f.zs[idx] = z; if (!k) return; }
    if (depth < 14) { const c = cont(f, e ? 0 : 1, false); if (c) climb(c.f, c.e, H, s, depth + 1, chain);
      // a ramp that is still raised at a junction lifts every road leaving it (else a side street meets the ramp at a vertical step)
      const zEnd = f.zs[e ? 0 : n - 1]; if (zEnd > 0.3) for (const o of ends.get(key(e ? f.p[0] : f.p[f.p.length - 1])) || []) if (o.f !== f && (!c || o.f !== c.f) && !isBr(o.f) && o.f.lvl !== -1) climb(o.f, o.e, H, s, depth + 3, null); }
  };
  const brs = roads.filter(isBr); bridgeList = brs;
  // what does each bridge cross? another road below = overpass; water beside the deck = bayou / canal bridge; else a low culvert bridge
  const cg = new Map(), CG = 50; for (const f of roads) { if (isBr(f) || f.lvl === -1) continue; for (let i = 0; i < f.p.length - 1; i++) { const a = f.p[i], b = f.p[i + 1]; for (let x = Math.floor(Math.min(a[0], b[0]) / CG); x <= Math.floor(Math.max(a[0], b[0]) / CG); x++) for (let y = Math.floor(Math.min(a[1], b[1]) / CG); y <= Math.floor(Math.max(a[1], b[1]) / CG); y++) { const k = x * 100003 + y; let L = cg.get(k); if (!L) cg.set(k, (L = [])); L.push([a, b, f]); } } }
  const X2 = (a, b, c, d) => { const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
  for (const f of brs) {
    prep(f); const hw = roadHW(f); let wet = 0, over = false;
    for (let i = 0; i < f.p.length - 1 && !over; i++) { const a = f.p[i], b = f.p[i + 1], L = cg.get(Math.floor((a[0] + b[0]) / 2 / CG) * 100003 + Math.floor((a[1] + b[1]) / 2 / CG)) || []; for (const [c, d, g] of L) if (g.n !== f.n && X2(a, b, c, d)) { over = true; break; } }
    for (let i = 0; i < f.p3.length - 1; i++) { const a = f.p3[i], b = f.p3[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l; for (const o of [hw + 4, hw + 9, -hw - 4, -hw - 9]) if (tileAt(a[0] + nx * o, a[1] + ny * o) === S.T.WATER) { wet++; break; } }
    const L = plen(f.p3), water = wet > 0; f.bz = over ? 7.2 * Math.min(2, f.lvl || 1) : water ? (L > 320 ? 21 : L > 140 ? 11 : L > 60 ? 6.5 : 3.6) : 1.6; f.wet = water;
    // arched span: smooth crown over the deck (higher for longer water spans), joined to the approach ramps at bz
    f.crown = water ? Math.min(9, L * 0.035) : over ? Math.min(1.5, L * 0.01) : 0;
  }
  // a bridge split into several OSM ways must be one level deck: every piece of a connected chain takes the chain's highest bz
  // (otherwise a wet span meets a dry span with a several-metre step that stops cars dead)
  { const seen = new Set(); for (const f0 of brs) { if (seen.has(f0)) continue; const grp = [], st = [f0]; seen.add(f0);
      while (st.length) { const f = st.pop(); grp.push(f); for (const e of [0, 1]) for (const c of ends.get(key(e ? f.p[f.p.length - 1] : f.p[0])) || []) if (c.f !== f && isBr(c.f) && !seen.has(c.f)) { seen.add(c.f); st.push(c.f); } }
      if (grp.length > 1) { const z = Math.max(...grp.map((g) => g.bz)); for (const g of grp) { if (g.bz < z) g.crown = 0; g.bz = z; } } } }
  for (const f of brs) {
    const L = plen(f.p3), crown = f.crown; let s0 = 0;
    for (let i = 0; i < f.p3.length; i++) { if (i) s0 += Math.hypot(f.p3[i][0] - f.p3[i - 1][0], f.p3[i][1] - f.p3[i - 1][1]); const u = L ? s0 / L : 0.5; f.zs[i] = f.bz + crown * Math.sin(Math.PI * u); }
  }
  for (const f of brs) for (const e of [0, 1]) {
    if (cont(f, e, true)) continue; // continues as another bridge piece
    const c = cont(f, e, false); if (c) { const chain = []; climb(c.f, c.e, f.bz, 0, 0, chain); (f.ramps || (f.ramps = [])).push({ f: c.f, e: c.e, be: e, chain });
      // every other surface road meeting this deck end ramps up too (OSM splits / skewed joins), so no road ends at a vertical step
      for (const o of ends.get(key(e ? f.p[f.p.length - 1] : f.p[0])) || []) if (o.f !== f && o.f !== c.f && !isBr(o.f) && o.f.lvl !== -1) climb(o.f, o.e, f.bz, 0, 0, null);
      continue; }
    const pts = f.p3, n = pts.length, RL = f.bz / 0.06; let s = 0; // dead end: ramp inside the bridge itself
    for (let i = 0; i < n; i++) { const idx = e ? n - 1 - i : i; if (i) { const a = pts[e ? idx + 1 : idx - 1], b = pts[idx]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); } const k = clamp(s / RL, 0, 1); f.zs[idx] = Math.min(f.zs[idx], f.zs[idx] * k * k * (3 - 2 * k)); }
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
  farChunks = farChunks.filter((m) => m.parent); meshChunks(SW, walk, "Sidewalks", 900); meshChunks(CB, flatMat(X.mat("panels", 44, "#d2cec4", { name: "H_Curb", rep: [0.5, 0.5] })), "Curbs", 600); const rms = meshChunks(R, asphalt, "Roads");
  // roads sit ON the land: depth-biased toward the camera over ground / lots / aerial drape so they never z-fight or sink at grazing angles
  const bias = (m, f) => { if (m) { m.polygonOffset = true; m.polygonOffsetFactor = f; m.polygonOffsetUnits = f * 2; } };
  bias(asphalt, -2); bias(walk, -1); bias(yellow, -4); bias(white, -4); for (const n of ["Curbs", "Sidewalks", "Roads"]) scene.traverse((o) => { if (o.isMesh && o.name.startsWith(n)) bias(o.material, n === "Roads" ? -2 : -1); });
  buildCulverts();
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
  return { wall: style === "brick" || style === "ranch" ? pick(PAL.brick, hv) : pick(PAL.wall, hv), roof: style === "acadian" || hv % 5 < 2 ? pick(PAL.tin, hv >>> 4) : pick(PAL.roof, hv >>> 4) }; // ~half of bayou-country houses wear light metal roofs
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
  else { for (let k = 0; k < 2; k++) { const wx = 26 + k * 128; win(wx, 72, 78, 92, (k + 1) % 2); if (kind === "plain" || kind === "brick") { x.fillStyle = kind === "brick" ? "#2e3a2f" : "#33495e"; x.fillRect(wx - 26, 66, 18, 104); x.fillRect(wx + 86, 66, 18, 104); x.fillStyle = "rgba(255,255,255,0.12)"; for (let yy = 70; yy < 168; yy += 8) { x.fillRect(wx - 24, yy, 14, 2); x.fillRect(wx + 88, yy, 14, 2); } x.fillStyle = "#e9e5dc"; x.fillRect(wx - 8, 172, 94, 6); } } }
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
let mailPts = [], mailSet = null, driveGrid = new Map();
function addDriveMask(a, b, hw) { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4) + 1; for (let i = 0; i <= n; i++) { const x = a[0] + (b[0] - a[0]) * i / n, y = a[1] + (b[1] - a[1]) * i / n, k = Math.floor(x / 10) * 100003 + Math.floor(y / 10); let L = driveGrid.get(k); if (!L) driveGrid.set(k, (L = [])); L.push(x, y, hw); } }
function nearDrive(x, y, r) { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const L = driveGrid.get((Math.floor(x / 10) + i) * 100003 + Math.floor(y / 10) + j); if (L) for (let k = 0; k < L.length; k += 3) if (Math.hypot(L[k] - x, L[k + 1] - y) < L[k + 2] + r) return true; } return false; }
// overlapping footprints: same parcel -> one conjoined building (polygon union, tallest storey count);
// different parcels -> the smaller one is trimmed back to the larger one's wall (polygon difference)
const mergeStats = { merged: 0, trimmed: 0, dropped: 0 };
function bbOf(p) { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (const q of p) { a = Math.min(a, q[0]); b = Math.max(b, q[0]); c = Math.min(c, q[1]); d = Math.max(d, q[1]); } return [a, b, c, d]; }
function bestRing(mp) { let best = null, ba = 0; for (const poly of mp || []) { const r = poly[0].slice(0, -1); const a = r.length >= 3 ? polyArea(r) : 0; if (a > ba) { ba = a; best = r; } } return best; }
function mergeOverlaps(blds) {
  mergeStats.merged = mergeStats.trimmed = mergeStats.dropped = 0; const CG = 40, grid = new Map();
  for (const b of blds) { if (!b.p || b.p.length < 3) continue; b.bb = bbOf(b.p); const [a0, a1, c0, c1] = b.bb; const cand = new Set();
    for (let i = Math.floor(a0 / CG); i <= Math.floor(a1 / CG); i++) for (let j = Math.floor(c0 / CG); j <= Math.floor(c1 / CG); j++) for (const o of grid.get(i * 100003 + j) || []) cand.add(o);
    for (const o of cand) { if (o.dead || b.dead || !o.bb || o.bb[0] > b.bb[1] || o.bb[1] < b.bb[0] || o.bb[2] > b.bb[3] || o.bb[3] < b.bb[2]) continue;
      let ia = 0; try { ia = PC.intersection([b.p], [o.p]).reduce((s, poly) => s + polyArea(poly[0].slice(0, -1)), 0); } catch (e) { continue; } if (ia < 0.8) continue;
      const same = (b.f.acct || "") === (o.f.acct || "");
      if (same) { let u = null; try { u = bestRing(PC.union([o.p], [b.p])); } catch (e) {} if (!u) continue; o.p = u; o.f = Object.assign({}, o.f, { lv: Math.max(o.f.lv || 0, b.f.lv || 0) || undefined, z: Math.max(o.f.z || 0, b.f.z || 0) || undefined, acct: o.f.acct || b.f.acct }); o.area = polyArea(u); o.bb = bbOf(u); let cx = 0, cy = 0; for (const q of u) { cx += q[0]; cy += q[1]; } o.cx = cx / u.length; o.cy = cy / u.length; b.dead = true; mergeStats.merged++; break; }
      let d = null; try { d = bestRing(PC.difference([b.p], [o.p])); } catch (e) {} if (!d || polyArea(d) < 8) { b.dead = true; mergeStats.dropped++; break; } b.p = d; b.area = polyArea(d); b.bb = bbOf(d); mergeStats.trimmed++; }
    if (b.dead) continue; const [x0, x1, y0, y1] = b.bb; for (let i = Math.floor(x0 / CG); i <= Math.floor(x1 / CG); i++) for (let j = Math.floor(y0 / CG); j <= Math.floor(y1 / CG); j++) { const k = i * 100003 + j; let L = grid.get(k); if (!L) grid.set(k, (L = [])); L.push(b); } }
}
// 2D collision against the (merged) footprints: point-in-polygon or within r of a wall
let colGrid = new Map(); const CC = 25;
function buildCollide(blds) { colGrid = new Map(); for (const b of blds) { if (!b.p || b.p.length < 3 || b.area < 8) continue; const [x0, x1, y0, y1] = b.bb || bbOf(b.p); for (let i = Math.floor((x0 - 4) / CC); i <= Math.floor((x1 + 4) / CC); i++) for (let j = Math.floor((y0 - 4) / CC); j <= Math.floor((y1 + 4) / CC); j++) { const k = i * 100003 + j; let L = colGrid.get(k); if (!L) colGrid.set(k, (L = [])); L.push(b.p); } } }
function hitBldg(x, y, r = 1.1, noTrees = false) {
  for (const p of colGrid.get(Math.floor(x / CC) * 100003 + Math.floor(y / CC)) || []) { if (inPoly(p, x, y)) return true; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L, 0, 1); if (Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t) < r) return true; } }
  if (!noTrees) for (const n of nearTrees) if (n.trunk && Math.abs(n.x - x) < 2 && Math.abs(n.y - y) < 2 && Math.hypot(n.x - x, n.y - y) < n.trunk + r * 0.6) return true;
  return false;
}
function buildBuildings() {
  mailPts = []; driveGrid = new Map();
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
  mergeOverlaps(blds); for (let i = blds.length - 1; i >= 0; i--) if (blds[i].dead) blds.splice(i, 1); blds.sort((a, b) => b.area - a.area); buildCollide(blds);
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
    if ((kind === "warehouse" || (kind === "shop" && area > 900)) && nearWater(cx, cy)) { kind = "warehouse"; }
    const fk = { res: hv % 10 < 4 ? "brick" : "plain", mobile: "plain", apt: hv % 2 ? "brick" : "plain", shop: "store", main: hv % 3 ? "brick" : "store", office: "office", warehouse: "metal", church: "brick", school: "brick", hospital: "office", gov: "brick", shed: "shed" }[kind];
    const base = kind === "res" ? (fk === "plain" && hv % 7 === 0 ? 1.0 : 0.45) : kind === "mobile" ? 0.75 : 0;
    const defH = { res: 2.8, mobile: 2.5, apt: 5.8, shop: area > 2500 ? 7.5 : 5.2, main: 7.4, office: area > 1200 ? 11.5 : 8.2, warehouse: 7.5, church: 6.5, school: 5.2, hospital: 14, gov: 7, shed: 2.6 }[kind];
    let ht = f.z ? clamp(f.z, 2.4, 80) : lv ? lv * (kind === "res" || kind === "apt" ? 2.9 : 3.6) + 0.4 : defH;
    let roof = rs === "flat" ? "flat" : rs === "gabled" ? "gable" : rs === "hipped" || rs === "pyramidal" ? "hip" : rs === "skillion" ? "gable" : null;
    if (!roof) roof = kind === "res" || kind === "apt" ? (hv % 9 < 5 ? "hip" : "gable") : kind === "mobile" || kind === "warehouse" || kind === "church" || kind === "shed" ? "gable" : "flat";
    if (roof !== "flat" && rect < 0.55 && area > 400) roof = "flat";
    let rm = rmat === "metal" || rmat === "tin" ? "metal" : rmat ? "shingle" : roof === "flat" ? "gravel" : kind === "warehouse" || kind === "mobile" || kind === "shed" ? "metal" : kind === "res" && hv % 11 < (Math.hypot(cx, cy) > 3500 ? 7 : 3) ? "metal" : "shingle";
    const pitch = kind === "church" ? 0.85 : kind === "warehouse" || kind === "mobile" ? 0.13 : kind === "shed" ? 0.3 : kind === "apt" ? 0.38 : 0.45 + (hv % 5) * 0.04;
    let col = new T.Color(fk === "brick" ? pick(PAL.brick, hv) : fk === "metal" || fk === "shed" ? pick(["#ffffff", "#e8eef2", "#f2ede2", "#dfe6e0", "#c9d4dc", "#d8c9a8"], hv) : kind === "res" || kind === "mobile" || kind === "apt" ? pick(PAL.wall, hv) : pick(PAL.biz, hv));
    const s = { k: "ext", p, o, base, top: base + ht, fk, col, roof, rm, pitch, rcol: new T.Color(rm === "metal" ? pick(PAL.tin, hv >>> 3) : rm === "gravel" ? "#c9c5bc" : pick(PAL.roof, hv >>> 3)), parapet: roof === "flat" && kind !== "shed" ? (kind === "main" ? 1.1 : 0.6) : 0 };
    if (mk) { const st = mk.st; s.fk = st.fk; s.col = new T.Color(st.col || "#d8d4cc"); if (!f.z && !lv) s.top = s.base + (mk.primary ? st.ht : Math.min(st.ht, 7)); s.roof = st.roof || (s.roof === "flat" || mk.primary ? "flat" : s.roof); s.rm = st.rm || (s.roof === "flat" ? "gravel" : s.rm); s.pitch = st.pitch || s.pitch; s.rcol = new T.Color(s.rm === "metal" ? "#9aa3a8" : s.rm === "gravel" ? "#cfcac0" : "#5a4a3e"); s.parapet = s.roof === "flat" ? 1.0 : 0; s.mark = mk; }
    if (rm === "metal" || s.rm === "metal") bStats.metal++;
    const fe = (kind === "res" || kind === "main" || kind === "shop") && !mk ? frontEdge(p, cx, cy, kind === "res" ? 4 : 6) : null;
    if (fe && kind === "res" && hv % 10 < 6) { const len = Math.min(fe.len * 0.62, 8), q = { ...fe, len }; const tip = [fe.x + fe.nx * 2.5, fe.y + fe.ny * 2.5]; if (!onRoad(tip[0], tip[1], 0.6)) { s.porch = q; bStats.porches++; } }
    if ((kind === "main" || kind === "shop") && fe && s.top > 3.6) { s.awn = { ...fe, len: fe.len * 0.86 }; s.acol = new T.Color(pick(PAL.awn, hv >>> 5)); if (onRoad(fe.x + fe.nx * 1.6, fe.y + fe.ny * 1.6, 0.3)) s.awn = null; }
    // regional detail: steeples, sign bands, garage doors, waterfront metal sheds
    { const ex = s.extra || (s.extra = []); const ang = fe ? Math.atan2(fe.uy, fe.ux) : o.a || 0;
      if (kind === "church") { const fe2 = fe || frontEdge(p, cx, cy, 4); if (fe2) { const a2 = Math.atan2(fe2.uy, fe2.ux), tx = fe2.x - fe2.nx * 2.2, ty = fe2.y - fe2.ny * 2.2, tw = 3.2, th = s.top + 5.5; ex.push({ x: tx, y: ty, z: 0, w: tw, h: th, d: tw, a: a2, c: "#efece4" }, { x: tx, y: ty, z: th, w: tw * 0.95, h: 7.5, a: a2, c: "#5d6166", pyr: true }, { x: tx, y: ty, z: th + 7.4, w: 0.12, h: 1.6, d: 0.12, a: a2, c: "#d9c27a" }, { x: tx, y: ty, z: th + 8.3, w: 0.9, h: 0.12, d: 0.12, a: a2, c: "#d9c27a" }); bStats.steeples = (bStats.steeples || 0) + 1; } }
      if ((kind === "shop" || kind === "main" || kind === "office") && fe && s.roof === "flat") { ex.push({ x: fe.x + fe.nx * 0.12, y: fe.y + fe.ny * 0.12, z: s.top - 1.25, w: fe.len * 0.9, h: 1.0, d: 0.18, a: ang, c: pick(["#b3262b", "#1f4e8c", "#2f6b4f", "#e0a526", "#3a3a3a", "#7a2f6b"], hv >>> 7) }); bStats.signBands = (bStats.signBands || 0) + 1; }
      if (kind === "res" && fe && area > 150 && hv % 4 === 0 && fe.len > 9) { const gx = fe.x + fe.ux * (fe.len / 2 - 2.2) + fe.nx * 0.06, gy = fe.y + fe.uy * (fe.len / 2 - 2.2) + fe.ny * 0.06; ex.push({ x: gx, y: gy, z: s.base, w: 3.0, h: 2.2, d: 0.1, a: ang, c: "#f1efe9" }); addDriveFrom(gx + fe.nx * 1.5, gy + fe.ny * 1.5); bStats.garages = (bStats.garages || 0) + 1; }
    }
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
  buildMailboxes();
  builtHomes = homes.length; lastRefill.x = 1e9; treeCache.clear();
}
// roadside mailboxes at each driveway (post + box + flag, one instanced mesh per material)
function buildMailboxes() {
  if (mailSet) for (const m of mailSet) { m.removeFromParent(); m.dispose(); } mailSet = []; const n = mailPts.length / 3; if (!n) return;
  const post = new T.BoxGeometry(0.1, 1.05, 0.1); post.translate(0, 0.52, 0); const box = new T.BoxGeometry(0.24, 0.26, 0.5); box.translate(0, 1.15, 0); const flag = new T.BoxGeometry(0.03, 0.18, 0.06); flag.translate(0.14, 1.3, -0.12);
  for (const [geo, col, nm] of [[post, "#7a5a3a", "Post"], [box, "#2d2f33", "Box"], [flag, "#c7322b", "Flag"]]) { const im = new T.InstancedMesh(geo, G.M(col, { rough: 0.7, name: "H_Mail" + nm }), n); im.name = "Mailbox" + nm; im.frustumCulled = false;
    for (let i = 0; i < n; i++) { tmpQ.setFromAxisAngle(UP, mailPts[i * 3 + 2]); tmpM.compose(tmpV.set(mailPts[i * 3], 0, mailPts[i * 3 + 1]), tmpQ, tmpS.set(1, 1, 1)); im.setMatrixAt(i, tmpM); } scene.add(im); mailSet.push(im); }
  // wheelie bins beside ~60% of mailboxes
  const can = new T.CylinderGeometry(0.33, 0.29, 1.0, 10); can.translate(0, 0.5, 0); const lid = new T.BoxGeometry(0.72, 0.06, 0.72); lid.translate(0, 1.03, 0);
  for (const [geo, nm] of [[can, "Bin"], [lid, "BinLid"]]) { const im = new T.InstancedMesh(geo, G.M("#ffffff", { rough: 0.75, name: "H_" + nm }), n); im.name = nm; im.frustumCulled = false; im.castShadow = true; let k = 0;
    for (let i = 0; i < n; i++) { const hh = hash(String(i * 7919 + 3)); if (hh % 10 > 5) continue; const a = mailPts[i * 3 + 2]; tmpQ.setFromAxisAngle(UP, a + (hh % 7) * 0.1); tmpM.compose(tmpV.set(mailPts[i * 3] + Math.cos(a) * 1.1, 0.03, mailPts[i * 3 + 1] - Math.sin(a) * 1.1), tmpQ, tmpS.set(1, 1, 1)); im.setMatrixAt(k, tmpM); im.setColorAt(k, tmpC.set(["#2f4a36", "#2a2d31", "#2d4c78", "#3a3d40"][hh % 4])); k++; }
    im.count = k; scene.add(im); mailSet.push(im); }
}
function addDriveFrom(ax, ay) { const r = nearestRoad(ax, ay, 45); if (!r) return; const dx = r.px - ax, dy = r.py - ay, d = Math.hypot(dx, dy); if (d < r.s.hw + 0.5 || d > 44) return; const ux = dx / d, uy = dy / d; const dp = [[ax - ux * 0.5, ay - uy * 0.5], [r.px - ux * (r.s.hw - 0.2), r.py - uy * (r.s.hw - 0.2)]]; bTileFor(ax, ay).specs.push({ k: "drive", pts: dp, hw: 1.55 }); addDriveMask(dp[0], dp[1], 1.55); const mx = r.px - ux * (r.s.hw + 0.9) - uy * 2.3, my = r.py - uy * (r.s.hw + 0.9) + ux * 2.3; if (!onRoad(mx, my, 0.3)) mailPts.push(mx, my, Math.atan2(ux, uy)); }
function addDrive(x, y, ry, sx, sz, tplD) { const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry), off = (HOUSE_DIMS.M[0] / 2 - 1.7) * sx; addDriveFrom(x + fx * (tplD / 2) * sz + rx * off, y + fz * (tplD / 2) * sz + rz * off); }
function refill(px, py) {
  try { refillPoles(px, py); } catch (e) { console.warn("props", e); }
  const R = viewR(), R2 = R * R;
  for (const s of Object.values(houseSets)) s.begin(); for (const s of Object.values(bizSets)) s.begin();
  const TR = Math.min(R, aerial ? 900 : 560), TR2 = TR * TR; nearHouses = []; // LOD: detailed instanced templates only within 560 m on the street (900 m from the air)
  const put = (i) => { if (!i.set) return; const dx = i.x - px, dy = i.y - py; if (dx * dx + dy * dy > TR2) return; if (dx * dx + dy * dy < 4900) nearHouses.push({ x: i.x, y: i.y, r: 4.2 * Math.sqrt(i.sx * i.sz) }); const set = i.set.startsWith("biz:") ? bizSets[i.set.slice(4)] : houseSets[i.set]; set.add(i.x, 0, i.y, i.ry, i.sx, 1, i.sz, i.colors); };
  S.nearBuckets(px, py, TR, (h) => { if (h.inst) put(h.inst); });
  for (const i of extraHouses) put(i);
  for (const s of Object.values(houseSets)) s.end(); for (const s of Object.values(bizSets)) s.end();
  streamTiles(px, py, R); refillFences(px, py, R);
  refillTrees(px, py); refillBizSigns(px, py);
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
// Business frontage: a roadside pylon sign with the business (OSM name, else parcel owner) name as generated text, and
// fuel canopies with pumps at gas stations. Only the nearest few dozen are built, cached per business.
const bizSigns = new Map(); let bizSignGroup = null; const BIZ_BG = ["#1d4f91", "#8c1d1d", "#1f6b3a", "#5b2c83", "#a35a00", "#22313f", "#7a1f4d", "#0f6c74"];
const GAS_RE = /\b(GAS|FUEL|PETRO|CHEVRON|EXXON|SHELL|VALERO|TEXACO|CONOCO|CITGO|MARATHON|MOBIL|CIRCLE K|RACETRAC|MURPHY|TRUCK STOP|TRUCKSTOP|FOOD ?MART|FOOD STORE|QUICK ?STOP|STOP ?N|KWIK|CONVENIENCE)\b/i;
function bizName(h) {
  const L = h.lot, q = L && L.p ? (() => { const b = obb(L.p); return poiIn({ p: L.p, cx: b.cx, cy: b.cy }); })() : null; let n = q && q.n ? q.n : (h.p && (h.p.owner || h.p.o)) || "";
  n = String(n).replace(/\b(L\.?L\.?C|INC|CORP(ORATION)?|CO|LTD|L\.?P|PLLC|ET AL|ETAL|ETUX|TRUST|&)\b\.?/gi, " ").replace(/[,.]+/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return null; if (n.length > 26) n = n.slice(0, 26).replace(/\s\S*$/, "");
  return { text: n.replace(/\w\S*/g, (w) => (w.length <= 3 && /^[A-Z]+$/.test(w) && !/^(THE|AND|OF)$/.test(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase())), gas: (q && q.k === "fuel") || GAS_RE.test(n) };
}
function makeBizSign(h) {
  const nm = bizName(h); if (!nm) return null; const I = h.inst, r = nearestRoad(I.x, I.y, 90); if (!r) return null;
  const g = new T.Group(), dx = I.x - r.px, dy = I.y - r.py, dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl, off = Math.min(dl * 0.45, r.s.hw + 3.2);
  const sx = r.px + ux * off, sy = r.py + uy * off, ang = Math.atan2(uy, ux); // board faces along the road (readable to traffic both ways)
  if (hitBldg(sx, sy, 1, true)) return null;
  const bg = BIZ_BG[hash(nm.text) % BIZ_BG.length], post = G.M("#5d6166", { rough: 0.6, metal: 0.5, name: "H_SignPost" });
  const mat = signMat(nm.text.toUpperCase(), bg, "#ffffff", 512, 160), bw = Math.min(5.2, 2.4 + nm.text.length * 0.16), bh = bw * 160 / 512 * 1.15;
  const H = nm.gas ? 6.2 : 4.4;
  for (const sd of [-1, 1]) { const p = new T.Mesh(new T.BoxGeometry(0.18, H, 0.18), post); p.position.set(sd * bw * 0.38, H / 2, 0); g.add(p); }
  const box = new T.Mesh(new T.BoxGeometry(bw + 0.2, bh + 0.2, 0.3), G.M("#e8e6e0", { rough: 0.5, name: "H_SignBox" })); box.position.y = H + bh / 2; g.add(box);
  for (const sd of [-1, 1]) { const f = new T.Mesh(new T.PlaneGeometry(bw, bh), mat); f.position.set(0, H + bh / 2, sd * 0.16); if (sd < 0) f.rotation.y = Math.PI; g.add(f); }
  if (nm.gas) { const pm = signMat("REGULAR  3.09", "#1b1b1b", "#ffd23a", 512, 128); for (const sd of [-1, 1]) { const f = new T.Mesh(new T.PlaneGeometry(bw * 0.8, bw * 0.2), pm); f.position.set(0, H - bw * 0.14, sd * 0.1); if (sd < 0) f.rotation.y = Math.PI; g.add(f); } }
  g.position.set(sx, 0, sy); g.lookAt( // local z along the road, so the faces look up/down the street
    sx + Math.cos(ang + Math.PI / 2), 0, sy + Math.sin(ang + Math.PI / 2));
  if (nm.gas) { // canopy over the pumps between the store and the road
    const cg = new T.Group(), cx = r.px + ux * Math.min(dl * 0.62, r.s.hw + 11), cy = r.py + uy * Math.min(dl * 0.62, r.s.hw + 11), W = 16, D = 9, roof = G.M("#f2f2f0", { rough: 0.5, name: "H_Canopy" }), band = signMat(nm.text.toUpperCase(), bg, "#ffffff", 1024, 96);
    const top = new T.Mesh(new T.BoxGeometry(W, 0.9, D), roof); top.position.y = 5.2; cg.add(top);
    for (const sd of [-1, 1]) { const b = new T.Mesh(new T.PlaneGeometry(W, 0.85), band); b.position.set(0, 5.2, sd * (D / 2 + 0.01)); if (sd < 0) b.rotation.y = Math.PI; cg.add(b); }
    const col = G.M("#d9d9d6", { rough: 0.5, name: "H_CanopyCol" }), pump = G.M("#c8302c", { rough: 0.5, name: "H_Pump" });
    for (const px of [-W / 3, W / 3]) { const c = new T.Mesh(new T.BoxGeometry(0.45, 4.8, 0.45), col); c.position.set(px, 2.4, 0); cg.add(c); const isl = new T.Mesh(new T.BoxGeometry(1.2, 0.2, 4), col); isl.position.set(px, 0.1, 0); cg.add(isl); for (const pz of [-1.2, 1.2]) { const p = new T.Mesh(new T.BoxGeometry(0.7, 1.7, 0.5), pump); p.position.set(px, 1.05, pz); cg.add(p); } }
    cg.position.set(cx, 0, cy); cg.lookAt(cx + ux, 0, cy + uy); if (!hitBldg(cx, cy, 4, true)) g.userData.canopy = cg;
  }
  g.name = "BizSign_" + nm.text; g.userData.text = nm.text; g.userData.gas = nm.gas; return g;
}
function refillBizSigns(px, py) {
  if (!bizSignGroup) { bizSignGroup = new T.Group(); bizSignGroup.name = "BizSigns"; scene.add(bizSignGroup); }
  const list = []; S.nearBuckets(px, py, 240, (h) => { if (!h.biz || !h.inst) return; const d = Math.hypot(h.inst.x - px, h.inst.y - py); if (d < 240) list.push([d, h]); });
  list.sort((a, b) => a[0] - b[0]); const want = new Set();
  for (const [, h] of list.slice(0, 24)) { want.add(h); if (!bizSigns.has(h)) { let g = null; try { g = makeBizSign(h); } catch (e) { g = null; } bizSigns.set(h, g); } const g = bizSigns.get(h); if (g && !g.parent) { bizSignGroup.add(g); if (g.userData.canopy) bizSignGroup.add(g.userData.canopy); } }
  for (const [h, g] of bizSigns) if (!want.has(h) && g && g.parent) { g.removeFromParent(); if (g.userData.canopy) g.userData.canopy.removeFromParent(); }
  if (bizSigns.size > 120) for (const [h, g] of bizSigns) { if (want.has(h)) continue; if (g) g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } }); bizSigns.delete(h); if (bizSigns.size <= 80) break; }
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
const TREES = [["oak", 9], ["tupelo", 8], ["palm", 7.5], ["willow", 8], ["pine", 14], ["shrub", 1.3], ["tupelo", 11], ["oak", 11], ["pine", 19], ["cypressW", 17], ["cypress", 14], ["reeds", 1], ["cypressW", 22], ["tupelo", 13], ["palmetto", 1.4], ["cane", 3.2], ["oakmoss", 10]];
const TREE_SCALE = [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1.1, 1], [1, 1], [1, 1], [1, 1], [1, 1]]; // [horizontal, vertical]: 7 = live oak, 8 = bald cypress
function nearWater(x, y) { for (const [ox, oy] of [[0, 0], [18, 0], [-18, 0], [0, 18], [0, -18]]) if (tileAt(x + ox, y + oy) === S.T.WATER) return true; return false; }
// bald cypress (Taxodium distichum): straight tapering trunk with a flared, fluted buttress base, short horizontal limbs,
// flat-topped layered feathery canopy, optional Spanish moss and cypress knees (wet variant). ~400 tris, instanced.
function cypressModel(seed, h, wet) {
  const r = G.rng(seed), g = new T.Group();
  const bark = G.M("#6b5444", { rough: 0.95, name: "H_CypBark" }), leaf = G.M(wet ? "#5d7a3a" : "#6a8a3e", { rough: 0.9, name: "H_CypLeaf" }), leaf2 = G.M("#7f9a48", { rough: 0.9, name: "H_CypLeaf2" }), moss = G.M("#9aa08a", { rough: 1, name: "H_CypMoss" });
  const prof = []; const B = 0.32 * h / 14; for (let i = 0; i <= 10; i++) { const y = (i / 10) * h * 0.92, u = i / 10; prof.push(new T.Vector2(B * (1 - 0.65 * u) + B * 2.2 * Math.exp(-u * 18), y)); }
  const tg = new T.LatheGeometry(prof, 7); const tp = tg.attributes.position; for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); if (y < h * 0.12) { const a = Math.atan2(tp.getZ(i), tp.getX(i)), f = 1 + 0.35 * Math.sin(a * 5) * (1 - y / (h * 0.12)); tp.setX(i, tp.getX(i) * f); tp.setZ(i, tp.getZ(i) * f); } } tg.computeVertexNormals();
  const add = (geo, m, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rz = 0) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.set(0, ry, rz); g.add(o); return o; };
  add(tg, bark, 0, 0, 0);
  const pad = new T.IcosahedronGeometry(1, 1); const limb = new T.CylinderGeometry(0.05, 0.1, 1, 4); limb.translate(0, 0.5, 0);
  const tiers = 4 + Math.floor(r() * 2);
  for (let k = 0; k < tiers; k++) { const u = k / (tiers - 1), y = h * (0.5 + 0.42 * u), rad = h * (0.2 + 0.1 * (1 - Math.abs(u - 0.55) * 1.6)) * (0.8 + r() * 0.3), a = r() * 6.28, off = h * 0.06 * (1 - u);
    const ox = Math.cos(a) * off, oz = Math.sin(a) * off; add(limb, bark, 0, y - h * 0.04, 0, 1, Math.hypot(ox, oz) + rad * 0.6, 1, -a, Math.PI / 2 - 0.25);
    for (let q = 0; q < 3; q++) { const b2 = r() * 6.28, d2 = rad * (q ? 0.45 : 0.1); add(pad, (k + q) % 2 ? leaf2 : leaf, ox + Math.cos(b2) * d2, y + (r() - 0.5) * h * 0.03, oz + Math.sin(b2) * d2, rad * (q ? 0.6 : 0.85), rad * 0.2, rad * (q ? 0.55 : 0.8), r() * 6); } }
  add(pad, leaf, 0, h * 0.96, 0, h * 0.22, h * 0.07, h * 0.2); // flat top
  if (wet || r() < 0.5) { const mg = new T.ConeGeometry(0.16, 1, 4, 1, true); mg.rotateX(Math.PI); mg.translate(0, -0.5, 0); for (let i = 0; i < 12; i++) { const a = r() * 6.28, d = h * (0.1 + r() * 0.2); add(mg, moss, Math.cos(a) * d, h * (0.5 + r() * 0.35), Math.sin(a) * d, 1, 0.9 + r() * 1.4, 1); } }
  if (wet) { const kg = new T.ConeGeometry(0.16, 0.7, 5); kg.translate(0, 0.3, 0); for (let i = 0; i < 6; i++) { const a = r() * 6.28, d = 1.4 + r() * 2.6; add(kg, bark, Math.cos(a) * d, 0, Math.sin(a) * d, 1, 0.6 + r() * 0.9, 1); } }
  return g;
}
function reedModel(seed) { const r = G.rng(seed), g = new T.Group(), m = G.M("#7d8f45", { rough: 1, name: "H_Reed" }), hd = G.M("#5a3f26", { rough: 1, name: "H_Cattail" }), bl = new T.ConeGeometry(0.05, 1, 3), cat = new T.CylinderGeometry(0.05, 0.05, 0.25, 4);
  for (let i = 0; i < 14; i++) { const a = r() * 6.28, d = r() * 0.9, hh = 0.9 + r() * 1.1, o = new T.Mesh(bl, m); o.position.set(Math.cos(a) * d, hh / 2, Math.sin(a) * d); o.scale.set(1, hh, 1); o.rotation.set((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3); g.add(o); if (i % 4 === 0) { const c = new T.Mesh(cat, hd); c.position.set(Math.cos(a) * d, hh * 0.92, Math.sin(a) * d); g.add(c); } }
  return g; }
// Spanish moss: grey-green drapes hung from the lower canopy of live oaks / tupelo
function addMoss(g, seed, h, n) { const r = G.rng(seed), moss = G.M("#a3a68f", { rough: 1, name: "H_OakMoss" }), mg = new T.ConeGeometry(0.22, 1, 4, 1, true); mg.rotateX(Math.PI); mg.translate(0, -0.5, 0);
  for (let i = 0; i < n; i++) { const a = r() * 6.28, d = h * (0.15 + r() * 0.3), o = new T.Mesh(mg, moss); o.position.set(Math.cos(a) * d, h * (0.45 + r() * 0.3), Math.sin(a) * d); o.scale.set(1, 1 + r() * 1.8, 1); g.add(o); } return g; }
// dwarf palmetto: a low clump of fan leaves on short stalks
function palmettoModel(seed) { const r = G.rng(seed), g = new T.Group(), m = G.M("#4f6e34", { rough: 0.9, name: "H_Palmetto" }), st = G.M("#6a7a3e", { rough: 1, name: "H_PalmStem" }), fan = new T.CircleGeometry(0.55, 7, 0, Math.PI * 1.1), stem = new T.CylinderGeometry(0.02, 0.03, 1, 3); stem.translate(0, 0.5, 0);
  for (let i = 0; i < 9; i++) { const a = r() * 6.28, tilt = 0.5 + r() * 0.7, L = 0.5 + r() * 0.6, s = new T.Mesh(stem, st); s.scale.set(1, L, 1); s.rotation.set(0, -a, tilt); s.rotation.order = "YXZ"; g.add(s);
    const f = new T.Mesh(fan, m); f.position.set(Math.cos(a) * Math.sin(tilt) * L, Math.cos(tilt) * L, Math.sin(a) * Math.sin(tilt) * L); f.rotation.set(-Math.PI / 2 + tilt * 0.6, -a + Math.PI / 2, 0); f.rotation.order = "YXZ"; f.material.side = T.DoubleSide; g.add(f); }
  return g; }
// switch cane / tall marsh grass clump
function caneModel(seed) { const r = G.rng(seed), g = new T.Group(), m = G.M("#8a9a4e", { rough: 1, name: "H_Cane" }), m2 = G.M("#a7a35e", { rough: 1, name: "H_Cane2" }), bl = new T.ConeGeometry(0.04, 1, 3);
  for (let i = 0; i < 18; i++) { const a = r() * 6.28, d = r() * 0.8, hh = 1.6 + r() * 1.8, o = new T.Mesh(bl, i % 3 ? m : m2); o.position.set(Math.cos(a) * d, hh / 2, Math.sin(a) * d); o.scale.set(1, hh, 1); o.rotation.set((r() - 0.5) * 0.35, 0, (r() - 0.5) * 0.35); g.add(o); } return g; }
const leafWrap = (m) => K.sway(m, 0.011, 0.35);
const TR_OPT = { cypressW: ["cypress", { moss: 0.55, knees: true }], cypress: ["cypress", { moss: 0.2 }], oak: ["oak", { moss: 0.25 }], oakmoss: ["oak", { moss: 0.85 }], tupelo: ["tupelo", { moss: 0.25 }], pine: ["pine", {}] };
function treeGroup(sp, i, h) {
  if (TR_OPT[sp]) { const [k, o] = TR_OPT[sp]; return TR.makeTree(k, 300 + i * 31, h, { ...o, wrap: leafWrap }); }
  if (sp === "cypressW") return cypressModel(901 + i, h, true); if (sp === "cypress") return cypressModel(733 + i, h, false); if (sp === "reeds") return reedModel(55);
  if (sp === "tupelo") return addMoss(W.treeModel("birch", 611, h), 612, h, 6); if (sp === "oakmoss") return addMoss(W.treeModel("decid", 271, h), 272, h, 14);
  if (sp === "palmetto") return palmettoModel(77); if (sp === "cane") return caneModel(78); return W.treeModel(sp, 101 + i * 17, h);
}
const UNDER = new Set([5, 11, 14, 15]);
let impSets = [];
function buildTreeSets() {
  const groups = TREES.map(([sp, h], i) => treeGroup(sp, i, h));
  treeSets = TREES.map(([sp], i) => new Instanced("Tree_" + sp + i, { group: groups[i] }, 256, { noRoles: true, noShadow: UNDER.has(i) }));
  // distant LOD: a pre-rendered side view of the same tree on crossed alpha-tested quads
  impSets = TREES.map(([sp, h], i) => { if (!TR_OPT[sp]) return null; const bb = new T.Box3().setFromObject(groups[i]), w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 1.05, hh = bb.max.y; try { return new Instanced("TreeImp_" + sp + i, { group: TR.makeImpostor(renderer, groups[i], hh, w, leafWrap) }, 256, { noRoles: true }); } catch (e) { return null; } });
  for (const s of treeSets) for (const p of s.parts) p.mat.alphaToCoverage = qName !== "low";
}
function bankAt(x, y, d) { const W_ = S.T.WATER; return tileAt(x + d, y) === W_ || tileAt(x - d, y) === W_ || tileAt(x, y + d) === W_ || tileAt(x, y - d) === W_; }
function treesIn(bi, bj) {
  const key = bi * 100003 + bj; if (treeCache.has(key)) return treeCache.get(key);
  const out = [], r = G.rng(hash(key) || 1), x0 = bi * TB, y0 = bj * TB, step = 5.5;
  const bad = (px, py, rr) => onRoad(px, py, rr) || masked(px, py) || deckY(px, py, 0) > 0.3 || hitBldg(px, py, rr, true) || nearDrive(px, py, 2.4);
  for (let x = x0 + step / 2; x < x0 + TB; x += step) for (let y = y0 + step / 2; y < y0 + TB; y += step) {
    const px = x + (r() - 0.5) * step * 0.9, py = y + (r() - 0.5) * step * 0.9, roll = r(), sel = r(), sc = 0.75 + r() * 0.5, ry = r() * 6.28, u = r();
    const t = tileAt(px, py);
    if (t !== S.T.GRASS && t !== S.T.PARK) continue;
    const f = forestAt(px, py), bank = bankAt(px, py, 4.5), wet = nearWater(px, py);
    if (bank) { // muddy bank: grasses, cane, the odd cypress leaning over the water
      if (roll < 0.55 && !bad(px, py, 1.5)) out.push(px, py, roll < 0.12 && f !== 0 ? 9 : u < 0.6 ? 11 : 15, ry, sc);
      continue;
    }
    if (f >= 1) { // real woods from the aerial canopy mask: dense mixed swamp forest + undergrowth
      if (roll > (f === 2 ? 0.9 : 0.6) || bad(px, py, 2.6)) { if (u < 0.35 && !bad(px, py, 1)) out.push(px, py, wet ? 15 : 14, ry, sc); continue; }
      const kind = wet ? (sel < 0.34 ? 9 : sel < 0.52 ? 12 : sel < 0.74 ? 13 : sel < 0.88 ? 16 : 3) : sel < 0.3 ? 16 : sel < 0.5 ? 10 : sel < 0.7 ? 13 : sel < 0.8 ? 7 : sel < 0.9 ? 8 : 0;
      out.push(px, py, kind, ry, sc * (0.85 + r() * 0.3));
      if (u < 0.55) { const a = r() * 6.28, d = 2 + r() * 1.5, qx = px + Math.cos(a) * d, qy = py + Math.sin(a) * d; if (!bad(qx, qy, 1)) out.push(qx, qy, u < 0.3 ? 14 : 15, r() * 6.28, 0.8 + r() * 0.5); }
      continue;
    }
    if (f === 0) continue; // open lawn / field in the aerial: leave it open
    // no aerial mask here (far away / offline): sparse cover, denser along the water
    if (roll > (wet ? 0.45 : t === S.T.PARK ? 0.25 : 0.1) || bad(px, py, 3.2)) continue;
    const kind = wet ? (sel < 0.45 ? 9 : sel < 0.75 ? 12 : sel < 0.85 ? 13 : 16) : sel < 0.45 ? 10 : sel < 0.65 ? 16 : sel < 0.75 ? 0 : sel < 0.85 ? 13 : 8;
    out.push(px, py, kind, ry, sc);
  }
  treeCache.set(key, out); return out;
}
function refillTrees(px, py) {
  const R = Math.min(Q.view, 420), R2 = R * R, dens = Q.trees; nearTrees = []; for (const s of treeSets) s.begin(); for (const s of impSets) if (s) s.begin(); const IMP2 = (Q.imp || 120) ** 2;
  for (let i = Math.floor((px - R) / TB); i <= Math.floor((px + R) / TB); i++) for (let j = Math.floor((py - R) / TB); j <= Math.floor((py + R) / TB); j++) {
    const L = treesIn(i, j); for (let k = 0; k < L.length; k += 5) { const dx = L[k] - px, dy = L[k + 1] - py, d2 = dx * dx + dy * dy; if (d2 > R2) continue; const kd = L[k + 2], ki = k / 5; if (dens < 1 && (ki % 10) / 10 >= dens && kd !== 9) continue; if (UNDER.has(kd) && d2 > 14400) continue; if (d2 > 22500 && ki % 2 === 1) continue; if (d2 > 62500 && ki % 3 === 1) continue; // LOD: undergrowth to 120 m, thin trees past 150 / 250 m (fog hides the gaps)
      const ts = TREE_SCALE[L[k + 2]], sc = L[k + 4], set = treeSets[L[k + 2]]; if (d2 > IMP2 && impSets[kd]) { impSets[kd].add(L[k], 0, L[k + 1], L[k + 3], sc * ts[0], sc * ts[1], sc * ts[0]); continue; } if (d2 < 3600) nearTrees.push({ set, i: set.pending.length, x: L[k], y: L[k + 1], ry: L[k + 3], sx: sc * ts[0], sy: sc * ts[1], r: 2.2 + 3 * sc * ts[0], hid: false, trunk: (kd === 9 || kd === 10 || kd === 12) ? 0.55 * sc : UNDER.has(kd) ? 0 : 0.35 * sc }); set.add(L[k], 0, L[k + 1], L[k + 3], sc * ts[0], sc * ts[1], sc * ts[0]); }
  }
  for (const s of impSets) if (s) s.end(); for (const s of treeSets) s.end();
}
// ---------------------------------------------------------------- v7 power poles + sagging lines
let poleList = null, poleSet = null, armSet = null, wires = null;
const POLE_ROADS = { residential: 1, tertiary: 1, secondary: 1, unclassified: 1, primary: 1, living_street: 1 };
function buildPoleList() {
  poleList = []; const roads = S.osm && S.osm.roads || [];
  for (const f of roads) { if (!POLE_ROADS[f.h] || !f.p || f.p.length < 2) continue; const off = roadHW(f) + 2.4, run = []; let carry = 17;
    for (let i = 0; i < f.p.length - 1; i++) { const a = f.p[i], b = f.p[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 0.1) continue; const ux = dx / L, uy = dy / L;
      for (let t = carry; t < L; t += 38) { const x = a[0] + ux * t - uy * off, y = a[1] + uy * t + ux * off;
        const ok = !onRoad(x, y, 0.8) && tileAt(x, y) !== S.T.WATER && !bankAt(x, y, 2) && !masked(x, y) && deckY(x, y, 0) < 0.3; if (ok) run.push([x, y, Math.atan2(uy, ux)]); else if (run.length) { poleList.push(run.splice(0)); } }
      carry = (carry - L) % 38; if (carry < 0) carry += 38; }
    if (run.length) poleList.push(run); }
}
function refillPoles(px, py) {
  if (!S.osm || !segGrid.size) return; if (!poleList) buildPoleList();
  if (!poleSet) { const pg = new T.CylinderGeometry(0.11, 0.15, 9.5, 7); pg.translate(0, 4.75, 0); poleSet = new T.InstancedMesh(pg, G.M("#5b4632", { rough: 0.95, name: "H_Pole" }), 900); const ag = new T.BoxGeometry(0.1, 0.1, 2.2); ag.translate(0, 9.0, 0); armSet = new T.InstancedMesh(ag, G.M("#4a3a2a", { rough: 0.95, name: "H_Arm" }), 900);
    for (const im of [poleSet, armSet]) { im.frustumCulled = false; im.castShadow = true; im.name = im === poleSet ? "PowerPoles" : "PoleArms"; scene.add(im); }
    wires = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ color: "#1d1d1f", name: "H_Wire" })); wires.frustumCulled = false; wires.name = "PowerLines"; scene.add(wires); }
  const R = Math.min(Q.view, 420), R2 = R * R, W = []; let c = 0;
  for (const run of poleList) { let prev = null; for (const q of run) { const dx = q[0] - px, dy = q[1] - py, inR = dx * dx + dy * dy < R2;
      if (inR && c < 900) { tmpQ.setFromAxisAngle(UP, -q[2]); tmpM.compose(tmpV.set(q[0], 0, q[1]), tmpQ, tmpS.set(1, 1, 1)); poleSet.setMatrixAt(c, tmpM); armSet.setMatrixAt(c, tmpM); c++; }
      if (inR && prev) { const L = Math.hypot(q[0] - prev[0], q[1] - prev[1]); if (L < 60) for (const o of [-1, 0, 1]) { const ox = -Math.sin(-q[2]) * 0, nx = Math.sin(q[2]) * o * 1.0, ny = -Math.cos(q[2]) * o * 1.0; for (let s = 0; s < 8; s++) { for (const t of [s / 8, (s + 1) / 8]) W.push(prev[0] + (q[0] - prev[0]) * t + nx + ox, 9.05 - (o === 0 ? 0.6 : 0) - 4 * 0.55 * t * (1 - t) * (L / 38), prev[1] + (q[1] - prev[1]) * t + ny); } } }
      prev = q; } }
  poleSet.count = armSet.count = c; poleSet.instanceMatrix.needsUpdate = armSet.instanceMatrix.needsUpdate = true;
  wires.geometry.dispose(); const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(W, 3)); wires.geometry = g;
}
// ---------------------------------------------------------------- v7 dense grass carpet (full-coverage lawns) + leaf litter, dust motes, birds
let carpet = null, litter = null, motes = null, birds = null, gritT = -9, mudFx = null, ruts = null, rutN = 0, rutBirth = null, rutLast = { x: 1e9, y: 0 };
function buildCarpet() {
  const base = G.M("#ffffff", { rough: 1, name: "H_Carpet" }); base.vertexColors = true; base.metalness = 0; base.envMapIntensity = 0.4; base.side = T.DoubleSide; const mat = K.sway(base, 0.3, 0.25, "vc");
  carpet = new T.InstancedMesh(GR.carpetGeometry(420), mat, 1100); carpet.name = "GrassCarpet"; carpet.count = 0; carpet.frustumCulled = false; carpet.receiveShadow = true; carpet.instanceMatrix.setUsage(T.DynamicDrawUsage); carpet.setColorAt(0, tmpC.set("#ffffff")); scene.add(carpet);
  const lm = G.M("#ffffff", { rough: 0.95, name: "H_Litter" }); lm.vertexColors = true; lm.polygonOffset = true; lm.polygonOffsetFactor = -1; lm.polygonOffsetUnits = -1;
  litter = new T.InstancedMesh(GR.litterGeometry(150), lm, 900); litter.name = "LeafLitter"; litter.count = 0; litter.frustumCulled = false; litter.receiveShadow = true; scene.add(litter);
  motes = GR.makeMotes(scene); birds = GR.makeBirds(scene); mudFx = GR.makeMudSpray(scene);
  const rg = new T.PlaneGeometry(0.5, 0.42); rg.rotateX(-Math.PI / 2); const rm = new T.MeshStandardMaterial({ color: "#2e2216", roughness: 0.6, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, name: "H_Rut" });
  ruts = new T.InstancedMesh(rg, rm, 1600); ruts.name = "TyreRuts"; ruts.count = 0; ruts.frustumCulled = false; ruts.receiveShadow = true; rutBirth = new Float32Array(1600).fill(-1e9); scene.add(ruts);
}
function scatterCarpet(px, py, fwdx, fwdy) {
  const R = Q.carpet || 0; let c = 0, l = 0; if (!carpet) return; const PS = GR.PATCH, cx = px + fwdx * R * 0.25, cy = py + fwdy * R * 0.25;
  if (R > 0) for (let i = Math.floor((cx - R) / PS); i <= Math.floor((cx + R) / PS); i++) for (let j = Math.floor((cy - R) / PS); j <= Math.floor((cy + R) / PS); j++) {
    if (c >= 1100 && l >= 900) break; const x = (i + 0.5) * PS, y = (j + 0.5) * PS, d = Math.hypot(x - cx, y - cy); if (d > R) continue;
    const t = tileAt(x, y); if (t === S.T.WATER) continue; if (t === S.T.BLDG && hitBldg(x, y, 0.4)) continue; if (onRoad(x, y, 0.7) || masked(x, y) || bankAt(x, y, 1.2)) continue;
    const hh = ((i * 73856093) ^ (j * 19349663)) >>> 0, fa = forestAt(x, y), fade = Math.min(1, (R - d) / (R * 0.35));
    tmpQ.setFromAxisAngle(UP, (hh & 3) * 1.5708 + ((hh >>> 3) & 7) * 0.05);
    if (fa >= 1) { if (l < 900) { tmpM.compose(tmpV.set(x, 0.035, y), tmpQ, tmpS.set(1, 1, 1)); litter.setMatrixAt(l++, tmpM); } if (fa === 2) continue; }
    if (c >= 1100) continue;
    const sy = fade * (0.75 + ((hh >>> 8) & 255) / 255 * 0.55) * (fa >= 1 ? 0.6 : 1); tmpM.compose(tmpV.set(x, 0.03, y), tmpQ, tmpS.set(1, sy, 1)); carpet.setMatrixAt(c, tmpM);
    const dry = Math.sin(x * 0.07 + Math.sin(y * 0.05) * 2) * Math.sin(y * 0.09 - x * 0.03); tmpC.setRGB(0.85 + dry * 0.25 + ((hh >>> 16) & 15) / 60, 0.95 + ((hh >>> 20) & 15) / 80, 0.8 - dry * 0.15); carpet.setColorAt(c, tmpC); c++;
  }
  carpet.count = c; litter.count = l; litter.instanceMatrix.needsUpdate = true; carpet.instanceMatrix.needsUpdate = true; if (carpet.instanceColor) carpet.instanceColor.needsUpdate = true;
}
let mudLive = 0;
function updateLife(dt) {
  if (!mudFx) return; const V = S.player.veh;
  if (V && !V.boat && !V._sink) { const sp = Math.abs(V.v || 0), a = V.a, fx = Math.cos(a), fy = Math.sin(a), off = !onRoad(V.x, V.y, 0.3) && tileAt(V.x, V.y) !== S.T.WATER && (V._z || 0) < 0.3 && deckY(V.x, V.y, 0) < 0.3;
    if (off && sp > 1.2) { const Sp = { L: 4.4, W: 1.8, wr: 0.33 }; V._mud = Math.min(1, (V._mud || 0) + dt * sp * 0.01);
      for (const sd of [-1, 1]) for (const ax of [0.3, -0.3]) { const wx = V.x + fx * Sp.L * ax - fy * sd * (Sp.W / 2 - 0.16), wy = V.y + fy * Sp.L * ax + fx * sd * (Sp.W / 2 - 0.16); const n = Math.min(16, Math.round(sp * dt * (ax < 0 ? 55 : 18) + Math.random()));
        if (n > 0) mudFx.emit(wx - fx * Sp.wr, Sp.wr * 0.6, wy - fy * Sp.wr, -fx * sp * 0.35 * Math.sign(V.v), 1.6 + sp * 0.18, -fy * sp * 0.35 * Math.sign(V.v), n, 1.2 + sp * 0.08);
        if (ax < 0 && Math.hypot(V.x - rutLast.x, V.y - rutLast.y) > 0.4) { const k = rutN % 1600; rutN++; tmpQ.setFromAxisAngle(UP, -a); tmpM.compose(tmpV.set(wx, 0.046, wy), tmpQ, tmpS.set(1, 1, 1)); ruts.setMatrixAt(k, tmpM); rutBirth[k] = clock; ruts.count = Math.min(1600, rutN); ruts.instanceMatrix.needsUpdate = true; } }
      if (Math.hypot(V.x - rutLast.x, V.y - rutLast.y) > 0.4) { rutLast.x = V.x; rutLast.y = V.y; }
    } else if (!off) V._mud = Math.max(0, (V._mud || 0) - dt * 0.0015);
  }
  mudLive = mudFx.update(dt); mudFx.setScale(renderer.domElement.height);
  if (ruts.count && Math.floor(clock * 2) !== Math.floor((clock - dt) * 2)) { let ch = false; for (let k = 0; k < ruts.count; k++) { const age = clock - rutBirth[k]; if (age > 40 && age < 70) { ruts.getMatrixAt(k, tmpM); tmpM.decompose(tmpV, tmpQ, tmpS); const w = Math.max(0.001, 1 - (age - 40) / 25); tmpM.compose(tmpV, tmpQ, tmpS.set(w, 1, w)); ruts.setMatrixAt(k, tmpM); ch = true; } } if (ch) ruts.instanceMatrix.needsUpdate = true; }
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
    const t = tileAt(x, y); if (t !== S.T.GRASS && t !== S.T.PARK) continue; if (onRoad(x, y, 2.2) || masked(x, y) || bankAt(x, y, 2.5)) continue;
    const s = 0.7 + ((hh >>> 16) & 255) / 255 * 0.7; tmpQ.setFromAxisAngle(UP, ((hh >>> 4) & 255) / 40); tmpM.compose(tmpV.set(x, 0, y), tmpQ, tmpS.set(s, s * (0.8 + ((hh >>> 20) & 15) / 30), s)); grass.setMatrixAt(c++, tmpM);
  }
  grass.count = c; grass.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- vehicles + people
const CAR_GLASS = new T.MeshStandardMaterial({ color: "#5d7080", roughness: 0.12, metalness: 0.25, name: "Car_Glass" }); // lighter tint so cabins read as glass, not a black block
const carObjs = new Map(); const CARKIND = { car: "sedan", truck: "pickup", cop: "sedan", bus: "bus", van: "van", taxi: "taxi" };
const MUD_C = new T.Color("#4a3a26");
function mudTint(o, k) { // mud buildup on the player's car: own copies of its paint/body materials, blended toward dried mud
  let L = o.userData.mudMats; if (!L) { if (k <= 0.01) return; L = o.userData.mudMats = []; o.traverse((q) => { if (!q.isMesh || !q.material || !q.material.color || /Glass|Light|Lamp/i.test(q.material.name || "")) return; q.material = q.material.clone(); L.push([q.material, q.material.color.clone(), q.material.roughness]); }); }
  for (const [m, c0, r0] of L) { m.color.copy(c0).lerp(MUD_C, Math.min(0.75, k * 0.8)); m.roughness = r0 + (1 - r0) * Math.min(1, k); }
}
function syncCars(px, py, nk) {
  const seen = new Set();
  for (const c of S.cars) {
    if (c.kind === "boat") continue; seen.add(c); let o = carObjs.get(c);
    if (!o) { const kind = c.cop ? "sedan" : CARKIND[c.kind] || pick(["sedan", "hatch", "sedan", "van", "pickup"], hash(c.color || "") ); o = K.carModel(kind, c.cop ? "#e9ebef" : c.color || "#b23a3a"); o.traverse((q) => { if (!q.isMesh) return; if (q.material.name === "Car_Paint") { q.material.metalness = 0.15; q.material.roughness = 0.4; } else if (q.material.name === "Car_Glass") q.material = CAR_GLASS; }); o.name = "Car"; scene.add(o); carObjs.set(c, o); }
    const far = Math.hypot(c.x - px, c.y - py) > Q.view; o.visible = !far; if (far) continue;
    if (c === S.player.veh || o.userData.mudMats) mudTint(o, c === S.player.veh ? c._mud || 0 : 0);
    c._z = deckY(c.x, c.y, c._z || 0); o.position.set(c.x, c._z - (c._sink || 0), c.y); o.rotation.y = -c.a; W.setCarLights(o, nk, (c.v || 0) < 0.3 && nk > 0.2);
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
  renderer.toneMappingExposure = (Q.env ? 0.9 : 0.95) + nk * 0.15;
  if (Q.env) { updateEnv(sky, dayK, el < 15 ? 1 : 0); hemi.intensity *= 0.45; scene.fog.color.lerp(new T.Color("#e9d8bc"), 0.22 * dayK); } // warm atmospheric haze
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
  if (post) post.set(Q.post || "none", painterly); resize(); envKey = ""; if (!Q.env) { scene.environment = null; }
  for (const s of treeSets) for (const p of s.parts) p.mat.alphaToCoverage = name !== "low";
  const sel = document.getElementById("hm3-qual"); if (sel && !qAuto) sel.value = name;
}
// image-based light: a procedural sky dome (zenith -> warm horizon -> marsh-green ground) prefiltered with PMREM
function updateEnv(sky, dayK, warmK) {
  if (!Q.env) return; const key = sky.getHexString() + (dayK * 10 | 0); if (key === envKey) return; envKey = key;
  if (!pmrem) pmrem = new T.PMREMGenerator(renderer);
  const es = new T.Scene(), top = sky.clone().multiplyScalar(0.55 + dayK * 0.9), hor = sky.clone().lerp(new T.Color("#ffd9a8"), 0.35 + warmK * 0.3).multiplyScalar(0.6 + dayK * 1.0), gnd = new T.Color("#4f5a36").multiplyScalar(0.25 + dayK * 0.6);
  const m = new T.ShaderMaterial({ side: T.BackSide, uniforms: { a: { value: top }, b: { value: hor }, c: { value: gnd } }, vertexShader: "varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }", fragmentShader: "uniform vec3 a,b,c; varying vec3 p; void main(){ float y = p.y; vec3 col = y > 0.0 ? mix(b, a, pow(y, 0.6)) : mix(b, c, pow(-y, 0.4)); gl_FragColor = vec4(col, 1.0); }" });
  es.add(new T.Mesh(new T.SphereGeometry(10, 32, 16), m)); const rt = pmrem.fromScene(es, 0.02); if (envRT) envRT.dispose(); envRT = rt; scene.environment = rt.texture; m.dispose();
}
function resize() { if (!renderer || !stage) return; const w = stage.clientWidth || 1, h = stage.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (post) post.size(w, h); }

// ---------------------------------------------------------------- setup + frame
function init() {
  stage = document.getElementById("hm-stage"); const c2d = document.getElementById("hm-canvas"); if (!stage || !c2d) throw new Error("no stage");
  renderer = new T.WebGLRenderer({ antialias: true, stencil: true, powerPreference: "high-performance" }); renderer.domElement.className = "hm-gl"; renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.shadowMap.type = T.PCFSoftShadowMap;
  stage.insertBefore(renderer.domElement, c2d); stage.classList.add("hm-3d");
  labelsEl = document.createElement("div"); labelsEl.className = "hm3-labels"; stage.appendChild(labelsEl);
  scene = new T.Scene(); scene.background = new T.Color("#9ec9ea"); scene.fog = new T.Fog("#9ec9ea", 150, 440);
  camera = new T.PerspectiveCamera(60, 1, 0.3, 900);
  hemi = new T.HemisphereLight("#cfe6ff", "#4d5a3a", 0.8); scene.add(hemi);
  sun = new T.DirectionalLight("#fff4e2", 2.2); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03; scene.add(sun); scene.add(sun.target);
  G.setQuality({ tex: 256 });
  try { night = NightMod.createNight(scene, renderer); } catch (e) { night = null; }
  post = createPost(renderer, scene, camera); qName = defaultQ(); applyQuality(qName);
  new ResizeObserver(resize).observe(stage);
  wireControls();
}
function wireControls() {
  const tsel = document.getElementById("hm3-time"), qsel = document.getElementById("hm3-qual");
  if (tsel) tsel.addEventListener("change", () => { tod = tsel.value; tsel.blur(); });
  if (qsel) qsel.addEventListener("change", () => { qAuto = qsel.value === "auto"; applyQuality(qAuto ? defaultQ() : qsel.value); qsel.blur(); });
  const pt = document.getElementById("hm3-paint"), cc = document.getElementById("hm3-cine");
  if (pt) pt.addEventListener("change", () => { painterly = pt.checked; applyQuality(qName); pt.blur(); });
  if (cc) { cc.checked = cineCam; cc.addEventListener("change", () => { cineCam = cc.checked; cc.blur(); }); }
}
async function build() {
  building = true; buildGround(); buildMarsh(); buildWater(); buildRoads(); buildBridges(); buildTreeSets(); buildGrass(); buildCarpet(); buildBuildings(); built = true; building = false;
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
    pumpTiles(40); syncGPS(P, 0); naipPump(ax, ay);
    lighting(dt, tmpS.set(ax, 0, ay).clone()); scene.fog.near = 1e5; scene.fog.far = 1e6; post.render(clock); if (labelsEl) labelsEl.innerHTML = ""; return;
  }
  naipPump(P.x, P.y);
  pumpTiles(6); if (lastRefill.fence) { lastRefill.fence = false; refillFences(P.x, P.y, viewR()); }
  if (Math.hypot(P.x - (lastP.x ?? 1e9), P.y - (lastP.y ?? 1e9)) > 70) { pZ = deckY(P.x, P.y, 99); if (P.veh) P.veh._z = pZ; } lastP.x = P.x; lastP.y = P.y; // spawned/teleported: land on the top deck, not under it
  { const tz = P.veh && P.veh._z != null ? P.veh._z : deckY(P.x, P.y, pZ); pZ = Math.abs(tz - pZ) > 3 ? tz : pZ + (tz - pZ) * Math.min(1, dt * 20); } syncGPS(P, pZ);
  const fx = Math.cos(P.a), fy = Math.sin(P.a); let dist = mode === 1 ? 7 : 11, ht = mode === 1 ? 2.6 : 4.0;
  if (++occN % 3 === 0) occDist = camOcclusion(P.x, P.y, fx, fy, dist, ht, pZ); dist = Math.min(dist, occDist); ht = Math.min(ht, 1.9 + dist * 0.2);
  camPos.set(P.x - fx * dist, ht + pZ, P.y - fy * dist); const look = tmpV.set(P.x + fx * 8, 1.7 + pZ, P.y + fy * 8);
  let k = 1 - Math.exp(-dt * 6);
  const cine = cineCam && P.veh && S.auto && S.auto().on; let fov = 60;
  if (cine) { // "life on autopilot": slow alternating film shots — low chase, drone, side tracking, lead shot looking back
    cineT += dt; const shot = Math.floor(cineT / 9) % 4, px = -fy, py = fx, v = Math.max(0, P.veh.v || 0), sw = Math.sin(cineT * 0.21);
    if (shot === 0) { camPos.set(P.x - fx * 13 + px * 2.5 * sw, pZ + 2.2, P.y - fy * 13 + py * 2.5 * sw); look.set(P.x + fx * 18, pZ + 1.4, P.y + fy * 18); fov = 48; }
    else if (shot === 1) { camPos.set(P.x - fx * 34 + px * 10, pZ + 24, P.y - fy * 34 + py * 10); look.set(P.x + fx * 25, pZ, P.y + fy * 25); fov = 52; }
    else if (shot === 2) { camPos.set(P.x + px * 11 + fx * (2 + v * 0.1), pZ + 1.7, P.y + py * 11 + fy * (2 + v * 0.1)); look.set(P.x + fx * 2, pZ + 1.0, P.y + fy * 2); fov = 40; }
    else { camPos.set(P.x + fx * (20 + v * 0.3) + px * 3, pZ + 1.3, P.y + fy * (20 + v * 0.3) + py * 3); look.set(P.x, pZ + 1.0, P.y); fov = 38; }
    if (shot !== cineShot) { cineShot = shot; camera.position.copy(camPos); camLook.copy(look); } // hard cut between shots, smooth within
    k = 1 - Math.exp(-dt * 2.2);
  } else cineShot = -1;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  if (camera.position.lengthSq() < 1 || camera.position.distanceTo(camPos) > 80) { camera.position.copy(camPos); camLook.copy(look); } else { camera.position.lerp(camPos, k); camLook.lerp(look, k); }
  camera.lookAt(camLook);
  if (Math.hypot(P.x - lastRefill.x, P.y - lastRefill.z) > 40) { lastRefill.x = P.x; lastRefill.z = P.y; refill(P.x, P.y); for (const m of farChunks) m.visible = Math.hypot(m.userData.cx - P.x, m.userData.cy - P.y) < m.userData.far + 424; }
  if (Math.hypot(P.x - lastGrass.x, P.y - lastGrass.z) > 5 && clock - lastGrass.t > 0.25) { lastGrass.x = P.x; lastGrass.z = P.y; lastGrass.t = clock; scatterGrass(P.x, P.y, fx, fy); scatterCarpet(P.x, P.y, fx, fy); }
  if (clock - gritT > 2) { gritT = clock; GR.gritPass(scene); }
  if (motes) { motes.pts.visible = !!Q.motes; motes.U.uT.value = clock; motes.U.uC.value.copy(camera.position); motes.U.uI.value = (1 - nightK) * 0.9 + 0.1; motes.U.uScale.value = renderer.domElement.height; birds.m.visible = nightK < 0.6; birds.U.uT.value = clock; birds.U.uC.value.set(P.x, 0, P.y); }
  syncCars(P.x, P.y, nightK); syncPeople(P.x, P.y, clock); updateLife(dt);
  lighting(dt, tmpS.set(P.x, 0, P.y).clone());
  post.render(clock); updateLabels();
  // auto quality: drop a preset after ~4 s under 24 fps
  fpsAcc.n++; fpsAcc.t += dt; if (fpsAcc.t > 1) { const fps = fpsAcc.n / fpsAcc.t; fpsAcc.n = 0; fpsAcc.t = 0; const el = document.getElementById("hm3-fps"); if (el) el.textContent = Math.round(fps) + " fps · " + qName; if (qAuto && fps < 24) { if (++fpsAcc.low >= 4 && qName !== "low") { applyQuality(QORDER[Math.max(0, QORDER.indexOf(qName) - 1)]); fpsAcc.low = 0; } } else fpsAcc.low = 0; }
}
window.Houma3D = {
  frame, active: () => active && !failed,
  setHour: (h) => { tod = h == null ? "live" : h; },
  // overhead map view: Houma3D.aerial({ h: 400, x, y }) centers on world meters (default: player); Houma3D.aerial(null) returns to the chase cam
  probe: () => { const rc = new T.Raycaster(), out = []; for (const d of [[0, 1, 0], [0, 0, -1]]) { rc.camera = camera; rc.set(camera.position, new T.Vector3(...d).applyQuaternion(d[1] ? new T.Quaternion() : camera.quaternion)); const h = rc.intersectObjects(scene.children, true)[0]; out.push(h ? [h.object.name, h.object.material && h.object.material.name, +h.distance.toFixed(1), [h.point.x, h.point.y, h.point.z].map((v) => +v.toFixed(1))] : null); } return { cam: camera.position.toArray().map((v) => +v.toFixed(1)), out }; },
  deckY: (x, y, z) => deckY(x, y, z),
  // test helper: drivable polylines ground -> approach ramp -> deck for the tallest bridges
  bridgeRoutes: (n = 3) => bridgeList.filter((f) => f.ramps && f.zs).sort((a, b) => Math.max(...b.zs) - Math.max(...a.zs)).slice(0, n).map((f) => { const r = f.ramps[0]; let rp = [], rz = []; for (const c of r.chain) { const q = c.f.p3.slice(), z = c.f.zs.slice(); if (!c.e) { q.reverse(); z.reverse(); } rp = q.concat(rp); rz = z.concat(rz); } const bp = f.p3.slice(), bz = f.zs.slice(); if (r.be) { bp.reverse(); bz.reverse(); } return { n: f.n, top: Math.max(...f.zs), pts: rp.concat(bp), zs: rz.concat(bz), nr: rp.length, sameP3: r.f.p3 === (S.osm.roads.find((g) => g === r.f) || {}).p3 }; }),
  hitBldg: (x, y, r) => hitBldg(x, y, r),
  forestAt: (x, y) => forestAt(x, y), forestInfo: () => ({ ver: FOREST.ver, cx: FOREST.cx, cy: FOREST.cy, n: FOREST.m ? FOREST.m.reduce((a, v) => a + (v ? 1 : 0), 0) : 0 }),
  bizSignList: () => [...bizSigns.values()].filter((g) => g && g.parent).map((g) => ({ text: g.userData.text, gas: g.userData.gas, x: g.position.x, y: g.position.z })),
  carInfo: () => [...carObjs].slice(0, 6).map(([c, o]) => { const m = []; o.traverse((q) => { if (q.isMesh) m.push((q.material.name || "") + ":" + (q.material.color ? q.material.color.getHexString() : "") + ":" + q.material.metalness); }); return { color: c.color, kind: c.kind, mats: m.slice(0, 4), y: o.position.y }; }),
  treeAudit: () => { let n = 0, inF = 0; for (const L of treeCache.values()) for (let k = 0; k < L.length; k += 5) { n++; if (hitBldg(L[k], L[k + 1], 0, true)) inF++; } return { trees: n, insideFootprints: inF }; }, mergeStats: () => ({ ...mergeStats }),
  snapZ: (z) => { pZ = z; }, grassInfo: () => ({ carpet: carpet && carpet.count, lawn: GR.hooked() }), offRoad: (x, y) => !onRoad(x, y, 0.3) && deckY(x, y, 0) < 0.3, mudInfo: () => ({ mud: S.player.veh && S.player.veh._mud, ruts: ruts && ruts.count, spray: mudLive }), gritInfo: () => ({ grit: GR.hooked(), litter: litter && litter.count, poles: poleSet && poleSet.count }), postInfo: () => post && post.info(), setPainterly: (on) => { painterly = !!on; applyQuality(qName); }, setCineCam: (on) => { cineCam = !!on; }, setCineT: (t) => { cineT = t; },
  gpsDbg: () => [typeof S.routeVer, gpsVer, !!gpsMesh, !!gpsArrow, gpsArrow && gpsArrow.visible, gpsMesh && gpsMesh.geometry.attributes.position.count, gpsMesh && gpsMesh.geometry.drawRange.start, gpsMesh && gpsMesh.parent === scene],
  triStats: () => { const m = {}; scene.traverseVisible((o) => { if (!o.geometry) return; const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); const k = (o.name || "?").replace(/\d+$/, ""); m[k] = (m[k] || 0) + n; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => k + ":" + Math.round(v / 1000) + "k"); },
  aerial: (o) => { aerial = o ? { ...o, dirty: true } : null; lastRefill.x = 1e9; if (!o && scene) applyQuality(qName); },
  setQuality: (q) => { qAuto = false; applyQuality(q); },
  stats: () => ({ quality: qName, built, houses: Object.values(houseSets).reduce((a, s) => a + s.n, 0), biz: Object.values(bizSets).reduce((a, s) => a + s.n, 0), trees: treeSets.reduce((a, s) => a + s.n, 0), grass: grass ? grass.count : 0, lamps: lamps.length, lampsOnRoad, bld: { ...bStats }, tilesBuilt: [...bTiles.values()].filter((t) => t.meshes).length, tilesTotal: bTiles.size, lotTilesBuilt: [...lotTiles.values()].filter((t) => t.meshes).length, queue: buildQ.length, landmarks: markHits.map((h) => [h.m.k, h.m.n, !!h.b]), tunnels: tunnels.length, elevated: S && S.osm ? S.osm.roads.filter((f) => f.bz).length : 0, calls: renderer ? renderer.info.render.calls : 0, tris: renderer ? renderer.info.render.triangles : 0 }),
};
