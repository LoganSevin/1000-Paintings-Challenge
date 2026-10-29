// Sims neighborhood: an endless, seeded town streamed in chunks around the camera.
// Every chunk is rebuilt from its coordinates, so the same street always looks the same.
// Layout: a street grid on chunk borders; some columns carry rivers and some rows carry canals
// (with bridges where roads cross them); some road segments run through hills in tunnels;
// the rest are houses, parks and lakes. Plants are placed with a zoning mask so they only grow
// on open land, never on sidewalks, roads, paths, driveways, water or buildings.
// Cars drive the grid in lanes (over bridges and through tunnels); boats cruise the waterways.
// Shared online lots are placed into nearby house chunks with a name sign you can tap to visit.
import { generatePlan } from "./sims-plan.js?v=1";
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as G from "./sims-gen.js?v=3";

export const CH = 36;          // chunk size (meters)
const LOT = 13.5, WALK = 15, ROAD = 18; // lot edge, sidewalk outer edge, road center (chunk border)
const WATER_Y = -1.4, BED_Y = -2.3, RIVER_HW = 4, CANAL_HW = 3;
const chunkKey = (i, j) => i + "," + j;
const seedOf = (i, j) => G.hashStr("chunk:" + i + ":" + j);
const H = (s) => G.hashStr(s);
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// windows glow at night: one shared material whose intensity the day cycle drives
export const WINDOW_GLOW = G.M("#ffd58a", { emissive: "#ffb85a", ei: 0.05, rough: 0.2, name: "Window_Glow" });
const WIN_DARK = G.M("#2a3440", { rough: 0.1, metal: 0.4, name: "Window_Glass" });

// ---------------- shared animated uniforms (wind, season, sky) ----------------
const U = { uTime: { value: 0 }, uWind: { value: 1 }, uSeason: { value: new T.Color(1, 1, 1) }, uSky: { value: new T.Color("#9ec9ea") } };
const SEASONS = { spring: [0.92, 1.08, 0.86], summer: [1, 1, 1], autumn: [1.45, 0.86, 0.42], winter: [0.86, 0.88, 0.84] };
export function seasonOf(d = new Date()) { const m = d.getMonth(); return m < 2 || m === 11 ? "winter" : m < 5 ? "spring" : m < 8 ? "summer" : "autumn"; }
export function setSeason(name) { U.uSeason.value.setRGB(...(SEASONS[name] || SEASONS.summer)); }
setSeason(seasonOf());
// foliage: sways with the wind (more toward the top) and takes the seasonal tint
const swayCache = new Map();
function sway(base, amt, tint, extra) {
  const key = base.uuid + "|" + amt + "|" + tint + "|" + (extra || "");
  if (swayCache.has(key)) return swayCache.get(key);
  const m = base.clone(); m.name = base.name; if (extra === "vc") m.vertexColors = true; if (extra === "vc") m.side = T.DoubleSide;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTime: U.uTime, uWind: U.uWind, uSeason: U.uSeason });
    sh.vertexShader = "uniform float uTime;\nuniform float uWind;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      {
        #ifdef USE_INSTANCING
          vec4 wo = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0); float hy = max(0.0, position.y);
        #else
          vec4 wo = modelMatrix * vec4(transformed, 1.0); float hy = clamp(transformed.y - 0.6, 0.0, 8.0);
        #endif
        float k = hy * ${amt.toFixed(4)} * uWind;
        transformed.x += (sin(uTime * 1.6 + wo.x * 0.31 + wo.z * 0.17) + 0.4 * sin(uTime * 3.7 + wo.z * 0.9)) * k;
        transformed.z += cos(uTime * 1.25 + wo.z * 0.27 - wo.x * 0.11) * k * 0.6;
      }`);
    if (tint > 0) sh.fragmentShader = "uniform vec3 uSeason;\n" + sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      diffuseColor.rgb *= mix(vec3(1.0), uSeason, ${tint.toFixed(3)});`);
  };
  m.customProgramCacheKey = () => "sway" + amt + "|" + tint + "|" + (extra || "");
  swayCache.set(key, m); return m;
}
// water: fresnel tint toward the sky colour with animated ripple normals (no extra render passes)
const WATER = new T.MeshStandardMaterial({ color: "#2f6f80", roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.86, name: "Water" });
WATER.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, { uTime: U.uTime, uSky: U.uSky });
  sh.vertexShader = "varying vec3 vWP;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
  sh.fragmentShader = "uniform float uTime;\nuniform vec3 uSky;\nvarying vec3 vWP;\n" + sh.fragmentShader
    .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
      { float t = uTime; vec2 p = vWP.xz;
        float dx = cos(p.x * 0.9 + t * 1.3) * 0.07 + cos(p.x * 2.3 + p.y * 1.1 + t * 2.1) * 0.07 + cos(p.x * 5.1 - p.y * 3.3 + t * 3.0) * 0.03;
        float dz = cos(p.y * 1.1 + t * 1.0) * 0.08 + cos(p.x * 1.7 - p.y * 2.6 + t * 1.7) * 0.07 + cos(p.y * 4.7 + p.x * 2.9 - t * 2.6) * 0.03;
        normal = normalize((viewMatrix * vec4(normalize(vec3(-dx, 1.0, -dz)), 0.0)).xyz); }`)
    .replace("#include <opaque_fragment>", `#include <opaque_fragment>
      { vec3 V = normalize(vViewPosition); float fr = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 3.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uSky * 0.95, clamp(fr * 0.85, 0.0, 0.9));
        gl_FragColor.a = mix(0.8, 1.0, fr); }`);
};
WATER.customProgramCacheKey = () => "water1";

// ---------------- layout: which chunks hold water, tunnels, parks, lakes ----------------
export function riverCol(i) { return i !== 0 && (i === 2 || i === -5 || H("rcol" + i) % 9 === 0); }
export function canalRow(j) { return j !== 0 && (j === -2 || j === 5 || H("crow" + j) % 9 === 0); }
// tunnel on the x-running road between chunk (i,j) and (i,j+1)
export function tunnelAt(i, j) {
  if (i === 0 && (j === 0 || j === -1)) return false;
  if (riverCol(i) || canalRow(j) || canalRow(j + 1)) return false;
  return (i === -1 && j === 0) || (i === 1 && j === -3) || H("tun" + i + ":" + j) % 7 === 0;
}
// bridge style for the crossing on a chunk border (both halves agree)
const BRIDGES = ["stone", "girder", "truss", "cable", "wood"];
function bridgeStyle(key) { return BRIDGES[H("br" + key) % BRIDGES.length]; }
const infoCache = new Map();
const PONDS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const plainChunk = (i, j) => !riverCol(i) && !canalRow(j) && !tunnelAt(i, j) && !tunnelAt(i, j - 1);
function pondChunk(i, j) {
  if (PONDS.some(([a, b]) => riverCol(a) || canalRow(b))) return false; // a river or canal is already next door
  const p = PONDS.find(([a, b]) => plainChunk(a, b)); return !!p && p[0] === i && p[1] === j;
}
export function chunkInfo(i, j) {
  const k = chunkKey(i, j); if (infoCache.has(k)) return infoCache.get(k);
  const t = G.tools(G.rng(seedOf(i, j) ^ 0x7a11));
  const info = { i, j, river: riverCol(i), canal: canalRow(j), tunN: tunnelAt(i, j), tunS: tunnelAt(i, j - 1), rects: [], plants: [] };
  info.rA = info.river ? (t.chance(0.5) ? 1 : -1) * t.rr(1.5, 3.5) : 0;
  if (i === 0 && j === 0) info.biome = "home";
  else if (info.river || info.canal) info.biome = "water";
  else if (info.tunN || info.tunS) info.biome = "park";
  else if (pondChunk(i, j)) info.biome = "lake"; // home always has fishing water one block away
  else { const r = H("biome" + k) % 100; info.biome = r < 9 ? "lake" : r < 25 ? "park" : "house"; }
  if (info.biome === "lake") { const R = t.rr(5.5, 7.5); info.lake = { x: t.rr(-2, 2), z: t.rr(-2, 2), R, p1: t.rr(0, 6), p2: t.rr(0, 6) }; }
  if (info.biome === "park") { info.hump = { x: t.rr(-6, 6), z: t.rr(-6, 6), h: t.rr(0.4, 1.4), s: t.rr(3, 5) }; if (info.tunN || info.tunS) info.hump.z = 0; }
  if (infoCache.size > 4000) infoCache.clear();
  infoCache.set(k, info); return info;
}
const riverOff = (info, z) => (Math.abs(z) < LOT ? info.rA * (1 + Math.cos((2 * Math.PI * z) / (LOT * 2))) / 2 : 0);
const lakeR = (L, a) => L.R * (1 + 0.12 * Math.sin(3 * a + L.p1) + 0.08 * Math.sin(5 * a + L.p2));
const bank = (d, hw) => BED_Y * (1 - sstep(hw - 0.6, hw + 2.2, d));
// ground height inside the lot (chunk-local)
export function heightAt(info, x, z) {
  let h = 0;
  if (info.river) h = Math.min(h, bank(Math.abs(x - riverOff(info, z)), RIVER_HW));
  if (info.canal && Math.abs(z) < CANAL_HW + 0.2) h = Math.min(h, BED_Y);
  if (info.lake) { const L = info.lake, dx = x - L.x, dz = z - L.z; h = Math.min(h, bank(Math.hypot(dx, dz), lakeR(L, Math.atan2(dz, dx)))); }
  if (info.hump && h === 0) h += info.hump.h * Math.exp(-((x - info.hump.x) ** 2 + (z - info.hump.z) ** 2) / (2 * info.hump.s ** 2));
  return h;
}
const HILL_U = 9.2, HILL_X = 11;
function hillTop(u) { return 7.2 * Math.pow(Math.max(0, Math.cos((u / HILL_U) * Math.PI / 2)), 0.8); }
// zoning mask (chunk-local): road, walk, building, path, drive, fence, item, hill, water, bank, lot, land
export function zoneLocal(info, x, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax > WALK || az > WALK) return "road";
  if (ax > LOT || az > LOT) return "walk";
  for (const r of info.rects) if (Math.abs(x - r.x) < r.w / 2 && Math.abs(z - r.z) < r.d / 2) return r.k;
  if (ax < HILL_X + 0.5 && ((info.tunN && z > ROAD - HILL_U - 0.3) || (info.tunS && z < -(ROAD - HILL_U - 0.3)))) return "hill";
  if (info.biome === "home" && ax < 12.8 && az < 12.8) return "lot";
  if (info.shared && ax < 12.6 && az < 12.6) return "lot";
  const h = heightAt(info, x, z);
  if (h < WATER_Y + 0.15) return "water";
  if (h < -0.35 || (info.canal && Math.abs(z) < CANAL_HW + 0.9)) return "bank";
  return "land";
}
const rot90 = (x, z, ry) => { const c = Math.round(Math.cos(ry)), s = Math.round(Math.sin(ry)); return [x * c + z * s, -x * s + z * c]; };
function addRect(info, k, x, z, w, d, ry = 0) { const [cx, cz] = rot90(x, z, ry); const odd = Math.abs(Math.round(Math.sin(ry))) === 1; info.rects.push({ k, x: cx, z: cz, w: odd ? d : w, d: odd ? w : d }); }

// ---------------- merge helper ----------------
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
// ---------------- materials ----------------
const MAT = {
  walk: () => G.TM("sidewalk", 1, "#b8b2a6", null, { rough: 0.95, name: "Sidewalk", rep: [1, 12] }),
  walkZ: () => G.TM("sidewalk", 1, "#b8b2a6", null, { rough: 0.95, name: "Sidewalk", rep: [12, 1] }),
  road: () => G.TM("asphalt", 1, "#3a3a3c", null, { rough: 0.95, name: "Asphalt", rep: [3, 18] }),
  roadZ: () => G.TM("asphalt", 1, "#3a3a3c", null, { rough: 0.95, name: "Asphalt", rep: [18, 3] }),
  line: () => G.M("#e8c84a", { rough: 0.6, name: "Road_Line" }),
  path: () => G.TM("pavers", 2, "#a89a88", null, { rough: 0.9, name: "Path" }),
  stone: () => G.TM("stone", 5, "#9a948a", null, { rough: 0.95, name: "Stone" }),
  concrete: () => G.TM("concrete", 2, "#9a968e", null, { rough: 0.95, name: "Concrete" }),
  wood: () => G.TM("wood", 11, "#7a5a3a", null, { rough: 0.85, name: "Timber" }),
  mud: () => G.M("#4a4234", { rough: 1, name: "Riverbed" }),
  curb: () => G.M("#9a958c", { rough: 0.9, name: "Curb" }),
};
const terrainMats = new Map();
function terrainMat(s) {
  const k = s % 4; if (terrainMats.has(k)) return terrainMats.get(k);
  const m = new T.MeshStandardMaterial({ map: G.texture("grass", k, "#c8d8b0", null, [7, 7]), vertexColors: true, roughness: 1, name: "Ground" });
  terrainMats.set(k, m); return m;
}
function addBox(g, w, h, d, mat, x, y, z, ry) { const m = G.mesh(G.rbox(w, h, d, 0.004), mat, x, y + h / 2, z, g); if (ry) m.rotation.y = ry; return m; }
function plane(g, w, d, mat, x, y, z) { const m = new T.Mesh(new T.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; g.add(m); return m; }
const UP = new T.Vector3(0, 1, 0);
function strut(g, mat, a, b, r = 0.06, seg = 6) {
  const A = new T.Vector3(...a), B = new T.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const m = G.mesh(G.cyl(r, r, len, seg), mat, 0, 0, 0, g); m.position.copy(A).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); return m;
}

// ---------------- smooth value noise in world space (continuous across chunks) ----------------
function hash2(x, z) { let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function noise(x, z) { const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
const fbm = (x, z) => noise(x, z) * 0.6 + noise(x * 2.1 + 7, z * 2.1 + 3) * 0.3 + noise(x * 4.3 - 5, z * 4.3 + 9) * 0.1;

// ---------------- terrain: textured, colour-varied heightfield for the lot ----------------
const C_ = (h) => new T.Color(h);
const GR = [C_("#5d8a3e"), C_("#6f9a46"), C_("#4f7d3a"), C_("#7f9f4a")], CLOVER = C_("#3f7038"), DRY = C_("#a3a457"), MUD = C_("#7a6a4c"), SAND = C_("#c8b88a"), BED = C_("#4a4234"), GRAVEL = C_("#b9a988");
function terrain(g, info, ox, oz) {
  const flat = !info.river && !info.canal && !info.lake && !info.hump;
  const seg = flat ? 18 : 54, size = LOT * 2;
  const geo = new T.PlaneGeometry(size, size, seg, seg); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new T.Color();
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v), z = pos.getZ(v), h = heightAt(info, x, z); pos.setY(v, h);
    const wx = x + ox, wz = z + oz, n = fbm(wx * 0.12, wz * 0.12), n2 = noise(wx * 0.31 + 40, wz * 0.31 - 11), n3 = noise(wx * 0.07 - 9, wz * 0.07 + 2);
    c.copy(GR[0]).lerp(GR[1], n).lerp(GR[2], sstep(0.55, 0.9, n3) * 0.7);
    if (n2 > 0.66) c.lerp(CLOVER, sstep(0.66, 0.8, n2) * 0.8);
    if (n3 < 0.25) c.lerp(DRY, sstep(0.25, 0.08, n3) * 0.6);
    for (const r of info.rects) if (r.paint) { const e = Math.max(Math.abs(x - r.x) - r.w / 2, Math.abs(z - r.z) - r.d / 2); if (e < 0.3) c.lerp(GRAVEL, sstep(0.3, -0.3, e) * 0.9); }
    if (h < -0.05) c.lerp(info.lake ? SAND : MUD, sstep(-0.05, -0.9, h));
    if (h < WATER_Y) c.lerp(BED, sstep(WATER_Y, BED_Y, h));
    col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new T.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const m = new T.Mesh(geo, terrainMat(seedOf(info.i, info.j))); m.receiveShadow = true; m.userData.keep = true; m.name = "Terrain"; g.add(m);
}

// ---------------- procedural trees ----------------
const LEAF_COLS = { decid: ["#3f7a34", "#4f8a3a", "#2f6b3f", "#5f8f2f", "#3a6a2a"], pine: ["#24513a", "#2d5e3e", "#1f4a34"], birch: ["#7aa040", "#8aaa48", "#6a9a3c"], palm: ["#4a8a3a", "#5a9a3a"], willow: ["#6a9a46", "#7aa84e", "#5a8a40"], shrub: ["#3c7a3a", "#4f8a3a", "#5a7f34", "#2f6b4f"] };
const TINT = { decid: 1, birch: 1, willow: 0.8, shrub: 0.6, pine: 0.12, palm: 0.15 };
function leafMat(sp, t, dark) {
  const col = t.pick(LEAF_COLS[sp]); const base = G.TM("leaves", (H(col) % 5) + (dark ? 10 : 0), dark ? G.shade(col, -0.18) : col, null, { rough: 0.9, name: "Leaves_" + sp });
  return sway(base, sp === "shrub" ? 0.012 : sp === "pine" ? 0.009 : 0.016, TINT[sp]);
}
const barkMat = (sp) => sp === "birch" ? G.TM("bark", 7, "#e8e4da", "#2a2522", { rough: 0.9, name: "Bark_Birch" }) : sp === "palm" ? G.TM("bark", 3, "#8a7254", null, { rough: 0.95, name: "Bark_Palm" }) : G.TM("bark", 1, sp === "pine" ? "#5a4030" : "#6b4a2e", null, { rough: 0.95, name: "Bark" });
function clump(g, mat, r, x, y, z, t) { const m = G.mesh(G.ico(1, 1), mat, x, y, z, g); m.scale.set(r * t.rr(0.85, 1.2), r * t.rr(0.7, 1), r * t.rr(0.85, 1.2)); m.rotation.set(t.rr(0, 3), t.rr(0, 3), 0); return m; }
const TREE = {
  decid(g, t, h) {
    const bark = barkMat("decid"), L1 = leafMat("decid", t, true), L2 = leafMat("decid", t, false), th = h * t.rr(0.42, 0.55);
    G.mesh(G.cyl(h * 0.035, h * 0.065, th, 8), bark, 0, th / 2, 0, g);
    const nb = t.ri(3, 5);
    for (let b = 0; b < nb; b++) {
      const a = (b / nb) * Math.PI * 2 + t.rr(-0.4, 0.4), y0 = th * t.rr(0.75, 1), len = h * t.rr(0.25, 0.38), up = t.rr(0.35, 0.8);
      const tip = [Math.cos(a) * len, y0 + len * up, Math.sin(a) * len]; strut(g, bark, [0, y0, 0], tip, h * 0.022);
      for (let k = 0; k < t.ri(2, 3); k++) clump(g, k ? L2 : L1, h * t.rr(0.16, 0.24), tip[0] + t.rr(-0.4, 0.4), tip[1] + t.rr(-0.1, 0.5) * h * 0.2, tip[2] + t.rr(-0.4, 0.4), t);
    }
    for (let k = 0; k < t.ri(2, 3); k++) clump(g, L2, h * t.rr(0.2, 0.28), t.rr(-0.3, 0.3), th + h * t.rr(0.32, 0.45), t.rr(-0.3, 0.3), t);
  },
  pine(g, t, h) {
    const bark = barkMat("pine"), L1 = leafMat("pine", t, true), L2 = leafMat("pine", t, false);
    G.mesh(G.cyl(h * 0.025, h * 0.05, h * 0.85, 7), bark, 0, h * 0.425, 0, g);
    const tiers = t.ri(4, 6), w = t.rr(0.26, 0.36);
    for (let k = 0; k < tiers; k++) { const f = k / tiers, r = h * w * (1 - f * 0.75), ch = h * 0.3 * (1 - f * 0.35), m = G.mesh(G.cone(1, 1, 9), k % 2 ? L2 : L1, t.rr(-0.05, 0.05), h * (0.22 + f * 0.66) + ch / 2, t.rr(-0.05, 0.05), g); m.scale.set(r, ch, r * t.rr(0.9, 1.1)); m.rotation.y = t.rr(0, 3); }
  },
  birch(g, t, h) {
    const bark = barkMat("birch"), L1 = leafMat("birch", t, false), L2 = leafMat("birch", t, true), n = t.ri(1, 3);
    for (let s = 0; s < n; s++) {
      const lx = n > 1 ? t.rr(-0.6, 0.6) : t.rr(-0.2, 0.2), lz = t.rr(-0.5, 0.5), hh = h * t.rr(0.8, 1);
      strut(g, bark, [s * 0.25 - 0.25, 0, t.rr(-0.1, 0.1)], [lx, hh * 0.8, lz], h * 0.022, 7);
      for (let k = 0; k < t.ri(5, 8); k++) { const f = t.rr(0.45, 1); clump(g, k % 3 ? L1 : L2, h * t.rr(0.1, 0.15), lx * f + t.rr(-0.6, 0.6), hh * (0.45 + f * 0.45), lz * f + t.rr(-0.6, 0.6), t); }
    }
  },
  palm(g, t, h) {
    const bark = barkMat("palm"), L = leafMat("palm", t, false), seg = 6, bend = t.rr(0.6, 1.6), a = t.rr(0, 6.28);
    let prev = [0, 0, 0];
    for (let k = 1; k <= seg; k++) { const f = k / seg, p = [Math.cos(a) * bend * f * f, h * f, Math.sin(a) * bend * f * f]; strut(g, bark, prev, p, h * 0.03 * (1.2 - f * 0.4), 7); prev = p; }
    const n = t.ri(7, 10);
    for (let k = 0; k < n; k++) { const ang = (k / n) * Math.PI * 2 + t.rr(-0.2, 0.2), len = h * t.rr(0.32, 0.45), fr = new T.Group(); fr.position.set(...prev); fr.rotation.y = -ang; g.add(fr);
      const m = G.mesh(G.cone(0.32, len, 4), L, len / 2, 0, 0, fr); m.rotation.z = -Math.PI / 2 - t.rr(0.25, 0.7); m.position.y = -len * 0.18; m.scale.z = 0.22; }
    for (let k = 0; k < t.ri(0, 4); k++) G.mesh(G.sph(0.12, 8, 6), G.M("#5a4022", { name: "Coconut" }), prev[0] + t.rr(-0.25, 0.25), prev[1] - 0.2, prev[2] + t.rr(-0.25, 0.25), g);
  },
  willow(g, t, h) {
    const bark = barkMat("willow"), L1 = leafMat("willow", t, false), L2 = leafMat("willow", t, true), th = h * 0.45;
    G.mesh(G.cyl(h * 0.05, h * 0.085, th, 8), bark, 0, th / 2, 0, g);
    const R = h * t.rr(0.38, 0.48);
    for (let k = 0; k < 4; k++) clump(g, L2, h * 0.24, t.rr(-0.5, 0.5), th + h * t.rr(0.15, 0.3), t.rr(-0.5, 0.5), t);
    const n = t.ri(12, 18);
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 + t.rr(-0.15, 0.15), len = h * t.rr(0.45, 0.65), x = Math.cos(a) * R, z = Math.sin(a) * R, m = G.mesh(G.cone(1, 1, 5), L1, x, th + h * 0.28 - len / 2, z, g); m.scale.set(h * 0.08, len, h * 0.08); m.rotation.x = Math.PI; }
  },
  shrub(g, t, h) {
    const L1 = leafMat("shrub", t, false), L2 = leafMat("shrub", t, true);
    for (let k = 0; k < t.ri(3, 6); k++) clump(g, k % 2 ? L1 : L2, h * t.rr(0.3, 0.5), t.rr(-0.5, 0.5) * h, h * t.rr(0.25, 0.5), t.rr(-0.5, 0.5) * h, t);
    if (t.chance(0.35)) { const fc = G.M(t.pick(["#e86a8a", "#ffffff", "#e0b04a", "#b07ad0"]), { rough: 0.7, name: "Blossom" }); for (let k = 0; k < 10; k++) G.mesh(G.ico(0.06, 0), fc, t.rr(-0.6, 0.6) * h, h * t.rr(0.4, 0.85), t.rr(-0.6, 0.6) * h, g); }
  },
};
const SIZES = { decid: [4, 7], pine: [5, 9], birch: [4.5, 7], palm: [5, 7.5], willow: [4.5, 6.5], shrub: [0.8, 1.6] };
const MIX = { yard: ["decid", "decid", "decid", "birch", "birch", "pine", "pine", "palm", "shrub", "shrub", "shrub"], street: ["decid", "decid", "birch", "pine"], park: ["decid", "decid", "birch", "pine", "pine", "willow", "shrub", "shrub"], bank: ["willow", "willow", "birch", "decid", "shrub"], hill: ["pine", "pine", "pine", "birch", "shrub"] };
function plantTree(g, info, t, x, z, mix, sp) {
  sp = sp || t.pick(MIX[mix]); const [a, b] = SIZES[sp], h = t.rr(a, b), y = heightAt(info, x, z);
  const tg = new T.Group(); tg.position.set(x, y, z); tg.rotation.y = t.rr(0, 6.28); TREE[sp](tg, t, h); g.add(tg);
  info.plants.push({ x, z, sp, r: sp === "shrub" ? 0.8 : 1.6 }); return tg;
}
// rejection-sample spots where the zoning mask says open land (and keep spacing from other plants)
function freeSpot(info, x, z, r, allow = ["land"]) {
  if (!allow.includes(zoneLocal(info, x, z))) return false;
  for (const [dx, dz] of [[r * 0.7, 0], [-r * 0.7, 0], [0, r * 0.7], [0, -r * 0.7]]) if (!allow.includes(zoneLocal(info, x + dx, z + dz))) return false;
  for (const p of info.plants) if (Math.hypot(p.x - x, p.z - z) < Math.max(r, p.r) + 0.4) return false;
  return true;
}
function scatterTrees(g, info, t, n, mix, area = LOT - 1, allow) {
  let placed = 0;
  for (let k = 0; k < n * 6 && placed < n; k++) { const x = t.rr(-area, area), z = t.rr(-area, area), sp = t.pick(MIX[mix]); if (!freeSpot(info, x, z, sp === "shrub" ? 0.8 : 1.6, allow)) continue; plantTree(g, info, t, x, z, mix, sp); placed++; }
}
function wildflowers(g, info, t, n) {
  for (let k = 0; k < n * 4 && n > 0; k++) { const x = t.rr(-LOT + 1.5, LOT - 1.5), z = t.rr(-LOT + 1.5, LOT - 1.5); if (!freeSpot(info, x, z, 1.1)) continue; const b = new T.Group(); b.position.set(x, heightAt(info, x, z), z); G.flowers(b, t, t.rr(1.2, 2.4), t.rr(1.2, 2.4), 0, t.ri(10, 22)); g.add(b); info.plants.push({ x, z, sp: "flowers", r: 1 }); n--; }
}
function reeds(g, info, t, n) {
  const m = sway(G.M("#6a8a3a", { rough: 0.9, name: "Reeds" }), 0.05, 0.7);
  for (let k = 0; k < n * 8 && n > 0; k++) { const x = t.rr(-LOT + 1, LOT - 1), z = t.rr(-LOT + 1, LOT - 1), h = heightAt(info, x, z); if (h > WATER_Y + 0.25 || h < WATER_Y - 0.35 || zoneLocal(info, x, z) !== "water" && zoneLocal(info, x, z) !== "bank") continue;
    for (let q = 0; q < 7; q++) { const r = G.mesh(G.cone(0.035, 1, 4), m, x + t.rr(-0.4, 0.4), WATER_Y + 0.4, z + t.rr(-0.4, 0.4), g); r.scale.y = t.rr(0.7, 1.3); r.rotation.z = t.rr(-0.15, 0.15); } n--; }
}

// ---------------- bridges (each chunk draws its half of the crossing) ----------------
// canonical frame: the road runs along x on the border z = side*ROAD; water flows along z with half-opening W
function bridgeHalf(g, side, W, style, cx = 0) {
  const z0 = side * LOT, z1 = side * ROAD, zm = (z0 + z1) / 2, len = ROAD - LOT, ez = side * (LOT + 0.12);
  const stone = MAT.stone(), conc = MAT.concrete();
  for (const sx of [-1, 1]) addBox(g, 1.2, -BED_Y + 0.02, len, style === "stone" ? stone : conc, cx + sx * (W + 0.6), BED_Y, zm); // abutments
  addBox(g, 2 * W, 0.1, len, MAT.mud(), cx, BED_Y - 0.05, zm);
  const deckM = style === "wood" ? MAT.wood() : conc;
  addBox(g, 2 * W + 2.4, 0.62, len, deckM, cx, -0.62, zm);
  const span = 2 * W + 2.4, x0 = cx - span / 2;
  if (style === "stone") {
    const sh = new T.Shape(); sh.moveTo(-span / 2, WATER_Y - 0.35); sh.lineTo(span / 2, WATER_Y - 0.35); sh.lineTo(span / 2, 0.12); sh.lineTo(-span / 2, 0.12); sh.closePath();
    const hole = new T.Path(); hole.absellipse(0, WATER_Y - 0.1, W - 0.05, 0.85, 0, Math.PI, false); sh.holes.push(hole);
    const geo = new T.ExtrudeGeometry(sh, { depth: 0.35, bevelEnabled: false, curveSegments: 14 }); const m = new T.Mesh(geo, stone); m.position.set(cx, 0, ez - (side > 0 ? 0 : 0.35)); g.add(m);
    for (let x = x0 + 0.3; x < x0 + span; x += 0.55) G.mesh(G.lathe([[0, 0], [0.09, 0.05], [0.06, 0.35], [0.1, 0.55], [0.07, 0.75], [0, 0.78]], 8), stone, x, 0.12, ez, g);
    addBox(g, span, 0.12, 0.3, stone, cx, 0.9, ez);
  } else if (style === "wood") {
    for (let x = x0; x <= x0 + span + 0.01; x += span / 6) { addBox(g, 0.16, 1.05, 0.16, MAT.wood(), x, 0, ez); addBox(g, 0.2, -BED_Y, 0.2, MAT.wood(), x, BED_Y, ez); }
    addBox(g, span, 0.1, 0.1, MAT.wood(), cx, 0.95, ez); addBox(g, span, 0.08, 0.08, MAT.wood(), cx, 0.5, ez);
    addBox(g, span, 0.3, 0.2, MAT.wood(), cx, -0.35, ez);
  } else {
    const steel = G.M(["#3a6ea5", "#8b3a3a", "#2b2b2b", "#5a6a5a", "#c9a227"][H("st" + style + W) % 5], { metal: 0.6, rough: 0.45, name: "Bridge_Steel" });
    addBox(g, span, 0.9, 0.25, steel, cx, -0.85, ez); // girder fascia
    for (let x = x0; x <= x0 + span + 0.01; x += 1.2) addBox(g, 0.06, 1.0, 0.06, steel, x, 0.05, ez);
    addBox(g, span, 0.07, 0.09, steel, cx, 1.0, ez); addBox(g, span, 0.05, 0.07, steel, cx, 0.55, ez);
    if (style === "truss") {
      const n = Math.max(3, Math.round(span / 2.2)), dx = span / n, top = 3.3;
      for (let k = 0; k <= n; k++) strut(g, steel, [x0 + k * dx, 0, ez], [x0 + k * dx, top, ez], 0.09, 6);
      for (let k = 0; k < n; k++) strut(g, steel, k % 2 ? [x0 + k * dx, 0, ez] : [x0 + k * dx, top, ez], k % 2 ? [x0 + (k + 1) * dx, top, ez] : [x0 + (k + 1) * dx, 0, ez], 0.07, 6);
      strut(g, steel, [x0, top, ez], [x0 + span, top, ez], 0.1, 6);
      for (let k = 0; k <= n; k += 2) strut(g, steel, [x0 + k * dx, top, ez], [x0 + k * dx, top, side * (ROAD + 0.05)], 0.06, 5); // cross-bracing to the middle (the other half meets it)
    }
    if (style === "cable") {
      const towerH = 7.5;
      for (const sx of [-1, 1]) { const tx = cx + sx * (span / 2 - 0.2); addBox(g, 0.5, towerH, 0.5, conc, tx, 0, ez); addBox(g, 0.6, 0.4, side * (ROAD - LOT) * 2, conc, tx, towerH - 0.4, (ez + side * ROAD) / 2);
        for (let k = 1; k <= 5; k++) { const ax = tx - sx * k * (span / 2 - 0.2) / 5.5; strut(g, steel, [tx, towerH - 0.3 - k * 0.35, ez], [ax, 0.9, ez], 0.025, 4); } }
    }
  }
}
// ---------------- tunnel hill: half profile on this chunk's side of the border ----------------
const TUN_W = 4.9, TUN_WALL = 3.1, TUN_TOP = 5.0;
function archY(u) { return TUN_WALL + (TUN_TOP - TUN_WALL) * Math.sqrt(Math.max(0, 1 - (u / TUN_W) ** 2)); }
function tunnelHalf(g, info, side, t) {
  const sh = new T.Shape(); sh.moveTo(TUN_W, 0); sh.lineTo(HILL_U, 0);
  for (let k = 1; k <= 14; k++) { const u = HILL_U * (1 - k / 14); sh.lineTo(u, Math.max(hillTop(u), 0.05)); }
  sh.lineTo(0, TUN_TOP); for (let k = 1; k <= 10; k++) { const u = TUN_W * k / 10; sh.lineTo(u, archY(u)); } sh.closePath();
  const L = HILL_X * 2, geo = new T.ExtrudeGeometry(sh, { depth: L, bevelEnabled: false }).toNonIndexed();
  const p = geo.attributes.position, uv = geo.attributes.uv, out = { top: [], arch: [], cap: [] }, outUv = { top: [], arch: [], cap: [] };
  for (let tri = 0; tri < p.count; tri += 3) {
    let su = 0, sy = 0, capA = true, capB = true;
    for (let v = 0; v < 3; v++) { su += p.getX(tri + v); sy += p.getY(tri + v); if (Math.abs(p.getZ(tri + v)) > 1e-4) capA = false; if (Math.abs(p.getZ(tri + v) - L) > 1e-4) capB = false; }
    su /= 3; sy /= 3; const bucket = capA || capB ? "cap" : su < TUN_W + 0.01 && sy < archY(Math.min(su, TUN_W)) + 0.06 ? "arch" : "top";
    for (let v = 0; v < 3; v++) { const u = p.getX(tri + v), y = p.getY(tri + v), w = p.getZ(tri + v); out[bucket].push(w - L / 2, y, side * (ROAD - u)); outUv[bucket].push(uv.getX(tri + v) * 0.25, uv.getY(tri + v) * 0.25); }
  }
  geo.dispose();
  const mats = { top: sway(G.TM("grass", 2, "#5d8a3e", null, { rough: 1, name: "Hill_Grass", side: true }), 0, 0.25), arch: G.TM("concrete", 6, "#6a665e", null, { rough: 0.95, name: "Tunnel_Lining", side: true }), cap: G.TM("stone", 8, "#8a847a", null, { rough: 0.95, name: "Retaining_Wall", side: true }) };
  for (const k of ["top", "arch", "cap"]) { if (!out[k].length) continue; const bg = new T.BufferGeometry(); bg.setAttribute("position", new T.Float32BufferAttribute(out[k], 3)); bg.setAttribute("uv", new T.Float32BufferAttribute(outUv[k], 2)); bg.computeVertexNormals(); const m = new T.Mesh(bg, mats[k]); m.castShadow = true; m.receiveShadow = true; g.add(m); }
  // portals with a keystone arch and lights inside
  const ps = new T.Shape(); ps.moveTo(0, 0); ps.lineTo(TUN_W + 1.1, 0); ps.lineTo(TUN_W + 1.1, TUN_TOP + 1.4); ps.lineTo(0, TUN_TOP + 1.4); ps.lineTo(0, TUN_TOP); for (let k = 1; k <= 10; k++) { const u = TUN_W * k / 10; ps.lineTo(u, archY(u)); } ps.lineTo(TUN_W, 0); ps.closePath();
  const pg = new T.ExtrudeGeometry(ps, { depth: 0.5, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1 });
  const pm = G.TM("stone", 4, t.pick(["#b0a898", "#8a7a6a", "#a8a49a"]), null, { rough: 0.9, name: "Portal" });
  for (const ex of [-1, 1]) { const m = new T.Mesh(pg, pm); m.rotation.y = side * Math.PI / 2; const px = side > 0 ? (ex > 0 ? HILL_X : -HILL_X - 0.5) : (ex > 0 ? HILL_X + 0.5 : -HILL_X); m.position.set(px, 0, side * ROAD); m.castShadow = true; g.add(m); }
  for (let x = -HILL_X + 2; x < HILL_X; x += 4) G.mesh(G.rbox(0.6, 0.12, 0.25, 0.03), WINDOW_GLOW, x, TUN_TOP - 0.15, side * (ROAD - 0.2), g);
  // pines and shrubs on top of the hill
  for (let k = 0; k < 4; k++) { const u = t.rr(5.2, 8.4), xx = t.rr(-HILL_X + 1.5, HILL_X - 1.5), sp = t.pick(MIX.hill), [a, b] = SIZES[sp], tg = new T.Group(); tg.position.set(xx, hillTop(u) - 0.1, side * (ROAD - u)); TREE[sp](tg, t, t.rr(a, b) * 0.8); g.add(tg); info.plants.push({ x: xx, z: side * (ROAD - u), sp, r: 1, hill: true }); }
}
function footbridge(g, x0, x1, z, t) {
  const wood = MAT.wood(), span = x1 - x0, n = 10, rise = 1.0, w = 1.7;
  const yAt = (f) => 0.08 + rise * Math.sin(Math.PI * f);
  for (let k = 0; k < n; k++) { const fa = k / n, fb = (k + 1) / n, xa = x0 + span * fa, xb = x0 + span * fb, ya = yAt(fa), yb = yAt(fb), seg = Math.hypot(xb - xa, yb - ya);
    const m = G.mesh(G.rbox(seg + 0.04, 0.12, w, 0.02), wood, (xa + xb) / 2, (ya + yb) / 2, z, g); m.rotation.z = Math.atan2(yb - ya, xb - xa); }
  for (const sz of [-1, 1]) { for (let k = 0; k <= n; k += 2) { const f = k / n; strut(g, wood, [x0 + span * f, yAt(f), z + sz * w / 2], [x0 + span * f, yAt(f) + 0.95, z + sz * w / 2], 0.045, 5); }
    for (let k = 0; k < n; k++) { const fa = k / n, fb = (k + 1) / n; strut(g, wood, [x0 + span * fa, yAt(fa) + 0.95, z + sz * w / 2], [x0 + span * fb, yAt(fb) + 0.95, z + sz * w / 2], 0.04, 5); } }
  for (const x of [x0 + 0.3, x1 - 0.3]) addBox(g, 0.4, -BED_Y + 0.2, 0.4, MAT.stone(), x, BED_Y, z);
  void t;
}

// ---------------- streets ----------------
function streets(g, info) {
  const s = seedOf(info.i, info.j);
  for (const sx of [-1, 1]) { plane(g, WALK - LOT, WALK * 2, MAT.walk(), sx * (LOT + WALK) / 2, 0.03, 0); plane(g, ROAD - WALK, ROAD * 2, MAT.road(), sx * (WALK + ROAD) / 2, 0.005, 0); }
  for (const sz of [-1, 1]) { plane(g, LOT * 2, WALK - LOT, MAT.walkZ(), 0, 0.03, sz * (LOT + WALK) / 2); plane(g, WALK * 2, ROAD - WALK, MAT.roadZ(), 0, 0.006, sz * (WALK + ROAD) / 2); }
  const curb = MAT.curb();
  for (const sx of [-1, 1]) addBox(g, 0.15, 0.12, WALK * 2, curb, sx * WALK, 0, 0);
  for (const sz of [-1, 1]) addBox(g, WALK * 2, 0.12, 0.15, curb, 0, 0, sz * WALK);
  for (let k = -ROAD + 1; k < ROAD; k += 3) { addBox(g, 0.15, 0.01, 1.4, MAT.line(), ROAD, 0.006, k); addBox(g, 1.4, 0.01, 0.15, MAT.line(), k, 0.007, ROAD); }
  // lot edge: a low kerb between grass and sidewalk so the lot reads as land
  for (const sx of [-1, 1]) addBox(g, 0.12, 0.08, LOT * 2, curb, sx * (LOT - 0.06), 0, 0);
  for (const sz of [-1, 1]) addBox(g, LOT * 2, 0.08, 0.12, curb, 0, 0, sz * (LOT - 0.06));
  // bridges where this chunk's water meets a road
  if (info.river) for (const side of [-1, 1]) { const key = info.i + ":" + (side > 0 ? info.j : info.j - 1) + ":r"; const b = new T.Group(); bridgeHalf(b, side, RIVER_HW + 2.2, bridgeStyle(key)); g.add(b); }
  if (info.canal) for (const side of [-1, 1]) { const key = (side > 0 ? info.i : info.i - 1) + ":" + info.j + ":c"; const b = new T.Group(); b.rotation.y = Math.PI / 2; bridgeHalf(b, side, CANAL_HW + 0.4, bridgeStyle(key)); g.add(b); }
  const t = G.tools(G.rng(s ^ 0x51ab));
  if (info.tunN) tunnelHalf(g, info, 1, t);
  if (info.tunS) tunnelHalf(g, info, -1, t);
  // street lamps on the sidewalk (not trees)
  const pole = G.M("#2b2b2b", { metal: 0.6, rough: 0.4, name: "Lamp_Post" });
  for (const [x, z] of [[LOT + 1.1, LOT + 1.1], [-LOT - 1.1, -LOT - 1.1]]) { G.mesh(G.cyl(0.06, 0.08, 4, 8), pole, x, 2, z, g); G.mesh(G.sph(0.22, 12, 8), WINDOW_GLOW, x, 4.1, z, g); }
  return t;
}
// street trees grow on the grass verge just inside the lot edge, only where the mask is open land
function vergeTrees(g, info, t) {
  if (info.biome === "home" || info.shared) return;
  for (let side = 0; side < 4; side++) for (let k = -10; k <= 10; k += t.ri(5, 7)) {
    if (!t.chance(0.7)) continue; const e = LOT - 1.4, x = side < 2 ? (side ? e : -e) : k + t.rr(-1, 1), z = side < 2 ? k + t.rr(-1, 1) : (side === 2 ? -e : e);
    if (freeSpot(info, x, z, 1.3)) plantTree(g, info, t, x, z, "street");
  }
}

// ---------------- houses ----------------
// ---------------- lot content by biome ----------------
// ---------------- planned houses (rooms, hallway, porch, yard, driveway, parked cars) ----------------
export function lotPlan(i, j) {
  const info = chunkInfo(i, j); if (info.biome !== "house") return null;
  if (!info.plan) { info.plan = generatePlan(seedOf(i, j) ^ 0x51ab, G); info.house = { beds: info.plan.beds, baths: info.plan.baths, name: houseName(i, j) }; info.plan.name = info.house.name; }
  return info.plan;
}
const SURN = ["Alvarez", "Brooks", "Chen", "Dubois", "Evans", "Fischer", "Garcia", "Hughes", "Ito", "Jensen", "Khan", "Lopez", "Moreau", "Nguyen", "Okafor", "Patel", "Quinn", "Rossi", "Silva", "Tanaka", "Ueda", "Volkov", "Walsh", "Young", "Zhang"];
function houseName(i, j) { return "The " + SURN[H("sur" + i + "," + j) % SURN.length] + " House"; }
const TC = (x) => x + 0.5 - 12, EX = (x) => x - 12; // lot tile -> chunk-local
function wallPos(k) { const [o, xs, zs] = k.split(":"); const x = +xs, z = +zs; return o === "h" ? [TC(x), EX(z), 0] : [EX(x), TC(z), Math.PI / 2]; }
// door leaf hinged at one jamb: rotate around the mesh origin
const DOOR_GEO = (() => { const g = new T.BoxGeometry(0.86, 2.02, 0.05); g.translate(0.43, 1.01, 0); return g; })();
function doorLeaf(k, mat) { const [x, z, ry] = wallPos(k); const m = new T.Mesh(DOOR_GEO, mat); m.name = "Door"; m.position.set(x - Math.cos(ry) * 0.43, 0.02, z + Math.sin(ry) * 0.43); m.rotation.y = ry; m.userData.door = { base: ry, open: 0, edge: k }; m.castShadow = true; return m; }
function planLot(g, info, t, near, extras) {
  const P = lotPlan(info.i, info.j), hs = P.house, WH = 2.6;
  const ext = G.wallMat(P.ext.c, P.ext.p), trim = G.M("#f2eee6", { rough: 0.6, name: "Trim" });
  // foundation + floors
  addBox(g, hs.x1 - hs.x0 + 0.3, 0.08, hs.z1 - hs.z0 + 0.3, G.M("#8a857c", { rough: 0.9, name: "Foundation" }), (hs.x0 + hs.x1) / 2 - 12, -0.06, (hs.z0 + hs.z1) / 2 - 12);
  for (const k in P.floors) { const [x, z] = k.split(",").map(Number); const inside = x >= hs.x0 && x < hs.x1 && z >= hs.z0 && z < hs.z1; if (!near && inside) continue; addBox(g, 1, 0.04, 1, G.floorMat(P.floors[k]), TC(x), 0, TC(z)); }
  for (const k in P.walls) {
    const w = P.walls[k]; if (!near && !w.ext) continue;
    const [x, z, ry] = wallPos(k), m = w.ext ? ext : G.wallMat(w.c, w.p), th = w.ext ? 0.16 : 0.1;
    if (w.t === "door") { addBox(g, 1.02, WH - 2.1, th, m, x, 2.1, z, ry); if (near || w.ext) extras.doors.push(doorLeaf(k, w.ext ? G.M("#6b3a2a", { rough: 0.5, name: "Front_Door" }) : G.M("#c9b49a", { rough: 0.6, name: "Door_Int" }))); }
    else if (w.t === "window") { addBox(g, 1.02, 0.9, th, m, x, 0, z, ry); addBox(g, 1.02, WH - 1.9, th, m, x, 1.9, z, ry); addBox(g, 0.98, 1.0, 0.03, t.chance(0.5) ? WINDOW_GLOW : WIN_DARK, x, 0.9, z, ry); addBox(g, 1.1, 0.06, th + 0.06, trim, x, 0.87, z, ry); }
    else addBox(g, 1.02, WH, th, m, x, 0, z, ry);
  }
  if (near) for (const o of P.objects) {
    const gi = G.genInfo(o.type); if (!gi) continue; const m = G.buildGen(o.type); if (!m) continue;
    const W = o.rot % 2 ? gi.d : gi.w, D = o.rot % 2 ? gi.w : gi.d; m.position.set(o.x + W / 2 - 12, 0, o.z + D / 2 - 12); m.rotation.y = o.rot * Math.PI / 2; m.traverse((c) => { if (c.isLight) c.visible = false; }); g.add(m);
  }
  // porch roof on posts
  const pr = P.porch, pcx = (pr.x0 + pr.x1) / 2 - 12, pcz = (pr.z0 + pr.z1) / 2 - 12, pw = pr.x1 - pr.x0;
  addBox(g, pw + 0.3, 0.12, 2.2, trim, pcx, WH - 0.05, pcz); for (const s of [-1, 1]) addBox(g, 0.12, WH - 0.05, 0.12, trim, pcx + s * (pw / 2 - 0.1), 0, pcz + 0.9);
  // roof (own mesh so it can hide when you look inside)
  const W = hs.x1 - hs.x0, D = hs.z1 - hs.z0, rh = Math.min(W, D) * 0.32 + 0.6, rm = G.TM("shingle", 3, P.roof.c, null, { rough: 0.95, name: "Roof", side: true });
  let roof;
  if (P.roof.style === "hip") { roof = new T.Mesh(G.cone(1, 1, 4), rm); roof.rotation.y = Math.PI / 4; roof.scale.set((W + 0.9) / Math.SQRT2, rh, (D + 0.9) / Math.SQRT2); roof.position.y = WH + rh / 2; }
  else { const sh = new T.Shape(), hw = W / 2 + 0.45; sh.moveTo(-hw, 0); sh.lineTo(hw, 0); sh.lineTo(0, rh); sh.closePath(); const geo = new T.ExtrudeGeometry(sh, { depth: D + 0.9, bevelEnabled: false }); geo.translate(0, 0, -(D + 0.9) / 2); roof = new T.Mesh(geo, rm); roof.position.y = WH; }
  roof.position.x = (hs.x0 + hs.x1) / 2 - 12; roof.position.z = (hs.z0 + hs.z1) / 2 - 12; roof.name = "Roof"; roof.castShadow = true; roof.userData.roof = { x0: hs.x0 - 12, z0: hs.z0 - 12, x1: hs.x1 - 12, z1: hs.z1 - 12 }; extras.roofs.push(roof);
  // parked cars on the driveway
  for (const c of P.cars) { const obj = carModel(c.kind, c.col); obj.position.set(c.x - 12, 0, c.z - 12); obj.rotation.y = -Math.PI / 2; obj.name = "ParkedCar"; extras.cars.push(obj); }
  // sign with bed/bath count
  const sg = new T.Group(); const sx = Math.min(10.5, Math.max(-10.5, P.gate.x - 12 + 1.4)); sg.position.set(sx, 0, LOT - 1.2); G.mesh(G.cyl(0.04, 0.04, 1.0, 6), G.M("#5a4632"), 0, 0.5, 0, sg);
  const board = new T.Mesh(new T.BoxGeometry(1.5, 0.42, 0.05), [G.M("#5a4632"), G.M("#5a4632"), G.M("#5a4632"), G.M("#5a4632"), new T.MeshStandardMaterial({ map: signTexture(P.beds + " bd · " + P.baths + " ba"), roughness: 0.8, name: "Sign" }), G.M("#5a4632")]);
  board.position.y = 1.1; board.name = "HouseSign"; board.userData.house = { i: info.i, j: info.j }; sg.add(board); extras.signs.push(sg);
  // yard: zoning so trees stay out of the house, porch, path and driveway
  addRect(info, "building", (hs.x0 + hs.x1) / 2 - 12, (hs.z0 + hs.z1) / 2 - 12, W + 1.5, D + 1.5);
  addRect(info, "path", pcx, pcz + 0.5, pw + 1, 3.5); addRect(info, "path", P.gate.x + 0.5 - 12, (pr.z1 + 24) / 2 - 12, 1.6, 24 - pr.z1 + 0.5);
  addRect(info, "drive", (P.drive.x0 + P.drive.x1) / 2 - 12, (P.drive.z0 + P.drive.z1) / 2 - 12, 3.8, P.drive.z1 - P.drive.z0 + 0.5);
  for (const o of P.objects) if (o.room === "yard" || o.room === "porch") addRect(info, "item", o.x + 1 - 12, o.z + 1 - 12, 2.6, 2.6);
  if (P.fenced) { const fk = t.pick(["picket", "rail", "hedge"]); const f = (fl, x, z, r) => { const fg = G.buildFence(fl, t, fk); fg.position.set(x, 0, z); fg.rotation.y = r; g.add(fg); addRect(info, "fence", x, z, r ? 1 : fl, r ? fl : 1); }; f(LOT * 2 - 0.6, 0, -LOT + 0.4, 0); f(LOT * 2 - 0.6, -LOT + 0.4, 0, Math.PI / 2); f(LOT * 2 - 0.6, LOT - 0.4, 0, Math.PI / 2); }
  const bed = new T.Group(); bed.position.set(pcx - pw / 2 - 1.2, 0, pcz - 0.2); G.flowers(bed, t, 1.2, 0.6, 0, t.ri(6, 14)); g.add(bed);
  scatterTrees(g, info, t, t.ri(2, 5), "yard", LOT - 1.6);
}
function benchAt(g, info, t, x, z, ry) { const o = G.buildGen(G.genType("bench", t.ri(1, 1e6))); o.position.set(x, heightAt(info, x, z), z); o.rotation.y = ry; o.traverse((c) => { if (c.isLight) c.visible = false; }); g.add(o); info.rects.push({ k: "item", x, z, w: 2.2, d: 2.2 }); }
function lampAt(g, info, x, z) { const pole = G.M("#2b2b2b", { metal: 0.6, rough: 0.4, name: "Lamp_Post" }), y = heightAt(info, x, z); G.mesh(G.cyl(0.05, 0.07, 3.2, 8), pole, x, y + 1.6, z, g); G.mesh(G.sph(0.18, 12, 8), WINDOW_GLOW, x, y + 3.3, z, g); info.rects.push({ k: "item", x, z, w: 0.8, d: 0.8 }); }
function parkLot(g, info, t) {
  // a winding gravel path painted into the ground from one sidewalk to the other
  const alongZ = t.chance(0.5), a = t.rr(1.5, 4), ph = t.rr(0, 6), b = t.rr(-3, 3);
  for (let u = -LOT; u <= LOT; u += 1) { const v = b + a * Math.sin(u * 0.22 + ph); const [x, z] = alongZ ? [v, u] : [u, v]; info.rects.push({ k: "path", x, z, w: 2.1, d: 2.1, paint: true }); }
  for (let k = 0; k < t.ri(1, 3); k++) { const u = t.rr(-9, 9), v = b + a * Math.sin(u * 0.22 + ph) + 2.2; const [x, z] = alongZ ? [v, u] : [u, v]; if (zoneLocal(info, x, z) === "land") benchAt(g, info, t, x, z, alongZ ? -Math.PI / 2 : 0); }
  { const u = t.rr(-6, 6), v = b + a * Math.sin(u * 0.22 + ph) - 1.9; const [x, z] = alongZ ? [v, u] : [u, v]; if (zoneLocal(info, x, z) === "land") lampAt(g, info, x, z); }
  scatterTrees(g, info, t, t.ri(9, 15), "park");
  wildflowers(g, info, t, t.ri(3, 6));
}
function waterLot(g, info, t) {
  const W = new T.Mesh(new T.PlaneGeometry(CH, CH), WATER); W.rotation.x = -Math.PI / 2; W.position.y = WATER_Y; W.receiveShadow = true; W.name = "Water"; g.add(W);
  if (info.canal) {
    const stone = MAT.stone(), cw = CANAL_HW + 0.2;
    const gaps = info.river ? [riverOff(info, cw) - RIVER_HW - 2.4, riverOff(info, cw) + RIVER_HW + 2.4] : null;
    const segs = gaps ? [[-LOT, gaps[0]], [gaps[1], LOT]] : [[-LOT, LOT]];
    for (const sz of [-1, 1]) for (const [xa, xb] of segs) { if (xb - xa < 0.5) continue; addBox(g, xb - xa, -BED_Y + 0.12, 0.4, stone, (xa + xb) / 2, BED_Y, sz * cw); addBox(g, xb - xa, 0.1, 0.6, MAT.concrete(), (xa + xb) / 2, 0.08, sz * (cw + 0.05));
      plane(g, xb - xa, 1.6, G.TM("pavers", 5, "#b0a48e", null, { name: "Promenade", rep: [Math.round((xb - xa) / 1.6), 1] }), (xa + xb) / 2, 0.02, sz * (cw + 1.1)); info.rects.push({ k: "path", x: (xa + xb) / 2, z: sz * (cw + 1.1), w: xb - xa, d: 2.0 });
      for (let x = xa + 3; x < xb - 1; x += 8) lampAt(g, info, x, sz * (cw + 2.2)); }
    let xb = t.rr(-9, 9); if (info.river && Math.abs(xb - riverOff(info, 0)) < RIVER_HW + 4) xb = riverOff(info, 0) + (xb < riverOff(info, 0) ? -1 : 1) * (RIVER_HW + 5);
    if (Math.abs(xb) < LOT - 2) { const fb = new T.Group(); fb.rotation.y = Math.PI / 2; fb.position.x = xb; footbridge(fb, -(cw + 1.4), cw + 1.4, 0, t); g.add(fb); info.rects.push({ k: "path", x: xb, z: 0, w: 2.4, d: 2 * cw + 4 }); }
  }
  if (info.river) {
    const zf = t.pick([-8, 8]), cx = riverOff(info, zf), hw = RIVER_HW + 2.4;
    if (!(info.canal && Math.abs(zf) < CANAL_HW + 3)) { footbridge(g, cx - hw, cx + hw, zf, t); info.rects.push({ k: "path", x: cx, z: zf, w: hw * 2 + 1.5, d: 2.4 }); }
    for (let k = 0; k < 2; k++) { const z = t.rr(-10, 10), x = riverOff(info, z) + (k ? 1 : -1) * (RIVER_HW + 3.2); if (zoneLocal(info, x, z) === "land") benchAt(g, info, t, x, z, k ? -Math.PI / 2 : Math.PI / 2); }
    reeds(g, info, t, 6);
  }
  scatterTrees(g, info, t, t.ri(5, 8), "bank");
  scatterTrees(g, info, t, t.ri(3, 6), "park");
  wildflowers(g, info, t, t.ri(1, 3));
}
function lakeLot(g, info, t) {
  const L = info.lake, W = new T.Mesh(new T.PlaneGeometry(LOT * 2, LOT * 2), WATER); W.rotation.x = -Math.PI / 2; W.position.y = WATER_Y; W.name = "Water"; g.add(W);
  // a timber dock reaching into the lake, with a moored rowboat
  const a = t.rr(0, 6.28), r0 = lakeR(L, a) + 1.6, dir = [-Math.cos(a), -Math.sin(a)], dk = new T.Group(); dk.position.set(L.x + Math.cos(a) * r0, 0, L.z + Math.sin(a) * r0); dk.rotation.y = -a + Math.PI; g.add(dk);
  const len = Math.min(4.5, L.R * 0.6);
  addBox(dk, len + 1.2, 0.12, 1.4, MAT.wood(), (len + 1.2) / 2 - 1.0, -0.95, 0);
  for (let k = 0; k <= 3; k++) for (const sz of [-0.6, 0.6]) addBox(dk, 0.14, 1.5, 0.14, MAT.wood(), -1 + k * (len + 1) / 3, BED_Y + 0.4, sz);
  const boat = boatModel(t, "row"); boat.position.set(len * 0.6, WATER_Y + 0.02, 1.4); boat.rotation.y = 0.1; dk.add(boat);
  info.rects.push({ k: "path", x: dk.position.x, z: dk.position.z, w: 3, d: 3 });
  info.dock = { x: dk.position.x + dir[0] * len, z: dk.position.z + dir[1] * len, y: -0.89 };
  void dir;
  reeds(g, info, t, 7);
  for (let k = 0; k < 2; k++) { const b2 = t.rr(0, 6.28), rr = lakeR(L, b2) + 3.4, x = L.x + Math.cos(b2) * rr, z = L.z + Math.sin(b2) * rr; if (Math.abs(x) < LOT - 1.5 && Math.abs(z) < LOT - 1.5 && zoneLocal(info, x, z) === "land") benchAt(g, info, t, x, z, -b2 - Math.PI / 2); }
  scatterTrees(g, info, t, t.ri(4, 7), "bank");
  scatterTrees(g, info, t, t.ri(3, 6), "park");
  wildflowers(g, info, t, t.ri(2, 4));
}

// ---------------- vehicles ----------------
const CAR_COLS = ["#c94a3a", "#3a6ea5", "#f2eee6", "#2b2b2b", "#8a8f96", "#c9a227", "#2f6b4f", "#6b2f3a", "#e07a2a", "#5a7aa0", "#d7c3a1", "#1d3a5a"];
const CAR_KINDS = { sedan: { L: 4.3, h1: 0.55, h2: 0.5, cab: 2.2, off: -0.2 }, hatch: { L: 3.7, h1: 0.6, h2: 0.55, cab: 2.0, off: -0.4 }, van: { L: 4.9, h1: 1.2, h2: 0.0, cab: 0, off: 0 }, pickup: { L: 5.0, h1: 0.65, h2: 0.6, cab: 1.6, off: 0.9 }, bus: { L: 9.5, h1: 2.3, h2: 0, cab: 0, off: 0 }, taxi: { L: 4.3, h1: 0.55, h2: 0.5, cab: 2.2, off: -0.2 } };
const carCache = new Map();
function carModel(kind, col) {
  const key = kind + col; if (carCache.has(key)) return carCache.get(key).clone();
  const K = CAR_KINDS[kind] || CAR_KINDS.sedan, g = new T.Group(), wb = kind === "bus" ? 2.4 : 1.8, body = G.M(kind === "taxi" ? "#f2c32e" : kind === "bus" ? "#c9a227" : col, { rough: 0.35, metal: 0.4, name: "Car_Paint" });
  const glass = G.M("#1e2830", { rough: 0.05, metal: 0.6, name: "Car_Glass" }), tyre = G.M("#141414", { rough: 0.9, name: "Tyre" }), tail = G.M("#8a1a1a", { emissive: "#ff2a2a", ei: 0.6, name: "Tail_Light" });
  G.mesh(G.rbox(K.L, K.h1, wb, 0.18), body, 0, 0.3 + K.h1 / 2, 0, g);
  if (K.cab) { G.mesh(G.rbox(K.cab, K.h2, wb - 0.16, 0.22), glass, K.off, 0.3 + K.h1 + K.h2 / 2 - 0.02, 0, g); G.mesh(G.rbox(K.cab - 0.3, 0.07, wb - 0.2, 0.03), body, K.off, 0.3 + K.h1 + K.h2, 0, g); }
  else { for (const sz of [-1, 1]) G.mesh(G.rbox(K.L * 0.82, 0.45, 0.04, 0.01), glass, -K.L * 0.04, 0.3 + K.h1 * 0.68, sz * (wb / 2 + 0.005), g); G.mesh(G.rbox(0.04, 0.5, wb - 0.3, 0.01), glass, K.L / 2 + 0.005, 0.3 + K.h1 * 0.65, 0, g); }
  if (kind === "taxi") G.mesh(G.rbox(0.5, 0.15, 0.25, 0.03), WINDOW_GLOW, K.off, 0.3 + K.h1 + K.h2 + 0.1, 0, g);
  const wr = kind === "bus" ? 0.45 : 0.32;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const w = G.mesh(G.cyl(wr, wr, 0.24, 12), tyre, sx * K.L * 0.32, wr, sz * (wb / 2 - 0.05), g); w.rotation.x = Math.PI / 2; }
  for (const sz of [-1, 1]) { G.mesh(G.rbox(0.06, 0.14, 0.3, 0.02), WINDOW_GLOW, K.L / 2, 0.55, sz * (wb / 2 - 0.3), g); G.mesh(G.rbox(0.06, 0.14, 0.3, 0.02), tail, -K.L / 2, 0.6, sz * (wb / 2 - 0.3), g); }
  const merged = mergeByMaterial(g); merged.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  carCache.set(key, merged); return merged.clone();
}
const HULL = new T.SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
function boatModel(t, kind) {
  const g = new T.Group(), hull = G.M(t.pick(["#f2eee6", "#3a6ea5", "#8b3a3a", "#2f6b4f", "#c9a227"]), { rough: 0.5, name: "Boat_Hull" }), deck = MAT.wood();
  const len = kind === "row" ? 2.6 : t.rr(3.6, 5);
  const h = G.mesh(HULL, hull, 0, 0.3, 0, g); h.scale.set(len / 2, 0.4, 0.75);
  G.mesh(G.rbox(len * 0.8, 0.05, 1.2, 0.02), deck, 0, 0.3, 0, g);
  if (kind !== "row") { G.mesh(G.rbox(len * 0.35, 0.32, 0.95, 0.08), G.M("#f2eee6", { rough: 0.5, name: "Boat_Cabin" }), -len * 0.1, 0.48, 0, g); G.mesh(G.rbox(0.05, 0.16, 0.8, 0.01), G.M("#1e2830", { rough: 0.05, metal: 0.6, name: "Car_Glass" }), len * 0.08, 0.5, 0, g); }
  return g;
}

// ---------------- shared online lots ----------------
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
// ---------------- the streamed world ----------------
export function createWorld(scene, opts = {}) {
  const root = new T.Group(); root.name = "Neighborhood"; scene.add(root);
  const chunks = new Map(), signs = [];
  let radius = opts.radius ?? 1, shared = [], slots = new Map(), queue = [], ownLot = "", time = 0;
  const reduce = !!opts.reduceMotion;
  const detail = { grass: opts.grass ?? 3000, cars: opts.cars ?? 10, boats: opts.boats ?? 3 };
  const npcs = []; let npcMax = opts.npcs ?? 6;
  // shared lots go into the nearest house chunks, in a stable order
  const ORDER = []; for (let r = 1; r <= 5; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (Math.max(Math.abs(i), Math.abs(j)) === r && chunkInfo(i, j).biome === "house") ORDER.push([i, j]);
  ORDER.sort((a, b) => (Math.hypot(...a) - Math.hypot(...b)) || (a[0] - b[0]) || (a[1] - b[1]));
  let grassDirty = true;
  let focus = { x: 0, z: 0 }, camPos = new T.Vector3(), lodC = [0, 0];
  const roofs = [], doors = [], parked = [], houseSigns = [];
  function buildChunk(i, j) {
    const info = chunkInfo(i, j); info.rects = []; info.plants = [];
    const L = slots.get(chunkKey(i, j)); info.shared = !!L;
    const near = Math.max(Math.abs(i - lodC[0]), Math.abs(j - lodC[1])) <= 1;
    const raw = new T.Group(); const t = streets(raw, info), extras = { roofs: [], doors: [], cars: [], signs: [] };
    if (info.biome === "home") { /* the player's own lot is drawn by the game */ }
    else if (L) sharedLot(raw, L, t);
    else if (info.biome === "house") planLot(raw, info, t, near, extras);
    else if (info.biome === "park") parkLot(raw, info, t);
    else if (info.biome === "lake") lakeLot(raw, info, t);
    else if (info.biome === "water") waterLot(raw, info, t);
    vergeTrees(raw, info, t);
    terrain(raw, info, i * CH, j * CH);
    const merged = mergeByMaterial(raw, true);
    merged.position.set(i * CH, 0, j * CH); merged.name = "Chunk_" + i + "_" + j; merged.userData.near = near; merged.userData.ij = [i, j];
    for (const r of extras.roofs) { merged.add(r); roofs.push(r); }
    for (const d of extras.doors) { merged.add(d); doors.push(d); }
    for (const c of extras.cars) { merged.add(c); parked.push({ obj: c, i, j, state: "park", timer: 20 + Math.random() * 90 }); }
    for (const sg of extras.signs) { merged.add(sg); sg.traverse((o) => { if (o.userData.house) houseSigns.push(o); }); }
    merged.traverse((o) => { if (o.userData.visitSid) signs.push(o); });
    root.add(merged); chunks.set(chunkKey(i, j), merged); grassDirty = true;
  }
  function dropChunk(k) {
    const c = chunks.get(k); if (!c) return; root.remove(c);
    const drop = (arr, o) => { const ix = arr.indexOf(o); if (ix >= 0) arr.splice(ix, 1); };
    c.traverse((o) => { if (o.isMesh && (o.name.startsWith("Merged_") || o.name === "Terrain" || (o.name === "Roof" && o.geometry.type === "ExtrudeGeometry"))) o.geometry.dispose(); drop(signs, o); drop(roofs, o); drop(doors, o); drop(houseSigns, o); });
    for (let k2 = parked.length - 1; k2 >= 0; k2--) if (parked[k2].obj.parent === c) parked.splice(k2, 1);
    chunks.delete(k); grassDirty = true;
  }
  // world-space zone lookup (only for built chunks; unknown elsewhere)
  function zoneAt(x, z) { const i = Math.round(x / CH), j = Math.round(z / CH); if (!chunks.has(chunkKey(i, j))) return "unknown"; return zoneLocal(chunkInfo(i, j), x - i * CH, z - j * CH); }
  function groundAt(x, z) { const i = Math.round(x / CH), j = Math.round(z / CH), lx = x - i * CH, lz = z - j * CH; return Math.abs(lx) < LOT && Math.abs(lz) < LOT ? heightAt(chunkInfo(i, j), lx, lz) : 0; }

  // ---- instanced grass tufts near the camera ----
  let grass = null, grassCenter = new T.Vector3(1e9, 0, 0), grassCount = 0;
  function makeGrass(n) {
    if (grass) { root.remove(grass); grass.geometry.dispose(); grass.dispose && grass.dispose(); grass = null; }
    if (n <= 0) return;
    const blades = [];
    for (let b = 0; b < 5; b++) { const a = (b / 5) * Math.PI + (b % 2) * 0.3, h = 0.26 + (b % 3) * 0.08, w = 0.045, lean = 0.06 * (b % 2 ? 1 : -1), ox = Math.cos(a * 2.3) * 0.08, oz = Math.sin(a * 1.7) * 0.08;
      const geo = new T.BufferGeometry(), ca = Math.cos(a), sa = Math.sin(a);
      geo.setAttribute("position", new T.Float32BufferAttribute([ox - ca * w, 0, oz - sa * w, ox + ca * w, 0, oz + sa * w, ox + lean * sa, h, oz - lean * ca], 3));
      geo.setAttribute("normal", new T.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      geo.setAttribute("color", new T.Float32BufferAttribute([0.32, 0.48, 0.2, 0.32, 0.48, 0.2, 0.66, 0.84, 0.38], 3)); blades.push(geo); }
    const geo = mergeGeometries(blades); blades.forEach((b) => b.dispose());
    const mat = sway(new T.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, name: "Grass_Blades" }), 0.35, 0.3, "vc");
    grass = new T.InstancedMesh(geo, mat, n); grass.name = "GrassTufts"; grass.frustumCulled = false; grass.receiveShadow = true; grass.castShadow = false; grass.count = 0; grass.userData.noExport = true;
    root.add(grass); grassCenter.set(1e9, 0, 0); grassDirty = true;
  }
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _p = new T.Vector3(), _s = new T.Vector3(), _c = new T.Color(), _e = new T.Euler();
  function scatterGrass(center) {
    if (!grass) return;
    const n = detail.grass, R = n > 5000 ? 24 : n > 2000 ? 19 : 14, cell = Math.max(0.35, (2 * R) / Math.sqrt(n * 1.15));
    const x0 = Math.floor((center.x - R) / cell), x1 = Math.ceil((center.x + R) / cell), z0 = Math.floor((center.z - R) / cell), z1 = Math.ceil((center.z + R) / cell);
    let k = 0;
    for (let a = x0; a <= x1 && k < n; a++) for (let b = z0; b <= z1 && k < n; b++) {
      const r1 = hash2(a, b), r2 = hash2(b + 911, a - 37), x = (a + r1) * cell, z = (b + r2) * cell;
      if ((x - center.x) ** 2 + (z - center.z) ** 2 > R * R) continue;
      if (zoneAt(x, z) !== "land") continue;
      const s = 0.7 + hash2(a * 3, b * 7) * 0.8; _p.set(x, groundAt(x, z), z); _q.setFromEuler(_e.set(0, r1 * 6.28, 0)); _s.set(s, s * (0.8 + r2 * 0.6), s);
      grass.setMatrixAt(k, _m.compose(_p, _q, _s)); const n2 = noise(x * 0.31 + 40, z * 0.31 - 11); _c.setRGB(0.85 + r1 * 0.3, 0.9 + r2 * 0.2, 0.8 + n2 * 0.3); grass.setColorAt(k, _c); k++;
    }
    grass.count = k; grassCount = k; grass.instanceMatrix.needsUpdate = true; if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    grassCenter.copy(center); grassDirty = false;
  }

  // ---- cars: straight lanes on the grid, keep distance, take turns at crossings ----
  const cars = [], reserve = new Map(); let carSeq = 0;
  const laneOf = (c) => (c.axis === "x" ? c.line + c.dir * 1.5 : c.line - c.dir * 1.5);
  function carXZ(c) { return c.axis === "x" ? [c.p, laneOf(c)] : [laneOf(c), c.p]; }
  function spawnCar(ci, cj, t) {
    const axis = t.chance(0.5) ? "x" : "z", m = (axis === "x" ? cj : ci) + t.ri(-radius - 1, radius), line = m * CH + ROAD, dir = t.chance(0.5) ? 1 : -1;
    const base = (axis === "x" ? ci : cj) * CH, span = (radius + 0.5) * CH; let p = base + t.rr(-span, span);
    const q = Math.round((p - ROAD) / CH) * CH + ROAD; if (Math.abs(p - q) < 7) p = q + (p < q ? -7 : 7);
    for (const o of cars) if (o.axis === axis && o.line === line && o.dir === dir && Math.abs(o.p - p) < 12) return;
    const kind = t.pick(["sedan", "sedan", "hatch", "hatch", "van", "pickup", "taxi", "sedan", "bus"]), obj = carModel(kind, t.pick(CAR_COLS));
    const c = { id: ++carSeq, axis, line, dir, p, v: 0, vmax: kind === "bus" ? 6 : t.rr(7, 10.5), len: CAR_KINDS[kind].L, obj, held: null };
    obj.name = "Car"; root.add(obj); cars.push(c); placeCar(c);
  }
  function placeCar(c) { const [x, z] = carXZ(c); c.obj.position.set(x, 0, z); c.obj.rotation.y = c.axis === "x" ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? -Math.PI / 2 : Math.PI / 2); }
  function release(c) { if (!c.held) return; const r = reserve.get(c.held); if (r) { r.cars.delete(c.id); if (!r.cars.size) reserve.delete(c.held); } c.held = null; }
  function stepCars(dt, ci, cj) {
    const rnd = G.tools(Math.random);
    let tries = 4; while (cars.length < detail.cars && tries--) spawnCar(ci, cj, rnd);
    while (cars.length > detail.cars) { const c = cars.pop(); release(c); root.remove(c.obj); }
    const lim = (radius + 1) * CH;
    for (let k = cars.length - 1; k >= 0; k--) { const c = cars[k], [x, z] = carXZ(c); if (Math.abs(x - ci * CH) > lim || Math.abs(z - cj * CH) > lim) { release(c); root.remove(c.obj); cars.splice(k, 1); } }
    const lanes = new Map(); for (const c of cars) { const key = c.axis + c.line + ":" + c.dir; if (!lanes.has(key)) lanes.set(key, []); lanes.get(key).push(c); }
    for (const list of lanes.values()) { list.sort((a, b) => (b.p - a.p) * a.dir); for (let k = 0; k < list.length; k++) list[k].ahead = k ? list[k - 1] : null; }
    const BOX = 3.4, obs = obstacles();
    for (const c of cars) {
      let maxAdv = Infinity;
      if (c.ahead) maxAdv = (c.ahead.p - c.p) * c.dir - (c.ahead.len + c.len) / 2 - 2.2;
      const rear = c.p - c.dir * c.len / 2, front = c.p + c.dir * c.len / 2;
      const m = c.dir > 0 ? Math.ceil((rear - ROAD - BOX) / CH) : Math.floor((rear - ROAD + BOX) / CH), q = m * CH + ROAD;
      const key = c.axis === "x" ? q + "," + c.line : c.line + "," + q;
      if (c.held && c.held !== key) release(c);
      const entry = q - c.dir * BOX, inBox = (front - entry) * c.dir > 0;
      if (inBox) { if (!c.held) { const r = reserve.get(key) || { axis: c.axis, cars: new Set() }; r.cars.add(c.id); reserve.set(key, r); c.held = key; } }
      else {
        const dist = (entry - front) * c.dir;
        if (dist < 2 + c.v * 0.9) { const r = reserve.get(key); if (!r || !r.cars.size || r.axis === c.axis) { const rr = r || { axis: c.axis, cars: new Set() }; rr.axis = c.axis; rr.cars.add(c.id); reserve.set(key, rr); c.held = key; } else maxAdv = Math.min(maxAdv, dist - 0.4); }
      }
      for (const ob of obs) { const along = ((c.axis === "x" ? ob.x : ob.z) - c.p) * c.dir, lat = Math.abs((c.axis === "x" ? ob.z : ob.x) - laneOf(c)); if (lat < 1.7 && along > 0 && along < 14) maxAdv = Math.min(maxAdv, along - c.len / 2 - 1.6); }
      const want = maxAdv < 0.5 ? 0 : Math.min(c.vmax, Math.max(0, (maxAdv - 0.5) * 1.2));
      c.v += Math.max(-9 * dt, Math.min(3 * dt, want - c.v)); if (c.v < 0) c.v = 0;
      c.p += c.dir * Math.min(c.v * dt, Math.max(0, maxAdv)); placeCar(c);
    }
  }

  // ---- boats on rivers and canals ----
  const boats = [];
  function boatPos(b) {
    if (b.kind === "r") { const j = Math.round(b.p / CH), info = chunkInfo(b.line, j), lz = b.p - j * CH, off = riverOff(info, lz), off2 = riverOff(info, lz + 0.5); return [b.line * CH + off + b.lane, b.p, Math.atan2(off2 - off, 0.5)]; }
    return [b.p, b.line * CH + b.lane, 0];
  }
  function stepBoats(dt, ci, cj) {
    const cols = [], rows = []; for (let k = -radius; k <= radius; k++) { if (riverCol(ci + k)) cols.push(ci + k); if (canalRow(cj + k)) rows.push(cj + k); }
    const lim = (radius + 1) * CH;
    for (let k = boats.length - 1; k >= 0; k--) { const b = boats[k], [x, z] = boatPos(b); if (Math.abs(x - ci * CH) > lim || Math.abs(z - cj * CH) > lim || (b.kind === "r" ? !cols.includes(b.line) : !rows.includes(b.line))) { root.remove(b.obj); boats.splice(k, 1); } }
    if (boats.length < detail.boats && (cols.length || rows.length)) {
      const t = G.tools(Math.random), useR = cols.length && (!rows.length || t.chance(0.6)), dir = t.chance(0.5) ? 1 : -1;
      const b = { kind: useR ? "r" : "c", line: useR ? t.pick(cols) : t.pick(rows), dir, lane: dir * (useR ? 1.6 : 1.1) * (useR ? -1 : 1), p: (useR ? cj : ci) * CH + t.rr(-radius - 0.5, radius + 0.5) * CH, v: t.rr(1.6, 3), phase: t.rr(0, 6), obj: boatModel(t, t.chance(0.3) ? "row" : "cabin") };
      b.obj.name = "Boat"; root.add(b.obj); boats.push(b);
    }
    for (const b of boats) {
      b.p += b.dir * b.v * dt; b.phase += dt; const [x, z, slope] = boatPos(b);
      b.obj.position.set(x, WATER_Y - 0.12 + (reduce ? 0 : Math.sin(b.phase * 2) * 0.03), z);
      b.obj.rotation.set(0, b.kind === "r" ? (b.dir > 0 ? -Math.PI / 2 : Math.PI / 2) - slope * b.dir : (b.dir > 0 ? 0 : Math.PI), reduce ? 0 : Math.sin(b.phase * 1.3) * 0.03);
    }
  }

  function update(center, dt) {
    const ci = Math.round(center.x / CH), cj = Math.round(center.z / CH);
    if (!reduce) time += dt; U.uTime.value = time;
    const want = new Set();
    for (let i = ci - radius; i <= ci + radius; i++) for (let j = cj - radius; j <= cj + radius; j++) want.add(chunkKey(i, j));
    for (const k of [...chunks.keys()]) if (!want.has(k)) dropChunk(k);
    if (lodC[0] !== ci || lodC[1] !== cj) { lodC = [ci, cj]; for (const [k, c] of [...chunks]) { const [i, j] = c.userData.ij, near = Math.max(Math.abs(i - ci), Math.abs(j - cj)) <= 1; if (near !== c.userData.near && chunkInfo(i, j).biome === "house" && !slots.has(k)) dropChunk(k); } }
    queue = [...want].filter((k) => !chunks.has(k)).sort((a, b) => { const [ai, aj] = a.split(",").map(Number), [bi, bj] = b.split(",").map(Number); return Math.hypot(ai - ci, aj - cj) - Math.hypot(bi - ci, bj - cj); });
    if (queue.length) { const [i, j] = queue[0].split(",").map(Number); buildChunk(i, j); } // one chunk per frame keeps it smooth
    if (grass && (grassDirty && !queue.length || Math.hypot(center.x - grassCenter.x, center.z - grassCenter.z) > 4)) scatterGrass(center);
    stepNpcs(dt, ci, cj); stepCars(Math.min(dt, 0.1), ci, cj); stepBoats(Math.min(dt, 0.1), ci, cj); stepHouses(Math.min(dt, 0.1));
  }
  // roofs hide when you look inside; doors swing open for anyone nearby; parked cars sometimes pull out
  const _w = new T.Vector3();
  function stepHouses(dt) {
    for (const r of roofs) { const c = r.parent.position, b = r.userData.roof, fx = focus.x - c.x, fz = focus.z - c.z;
      const inside = fx > b.x0 - 1 && fx < b.x1 + 1 && fz > b.z0 - 1 && fz < b.z1 + 1; const cx = (b.x0 + b.x1) / 2 + c.x, cz = (b.z0 + b.z1) / 2 + c.z;
      r.visible = !(inside || (Math.hypot(camPos.x - cx, camPos.z - cz) < 13 && camPos.y < 16)); }
    const people = obstacles();
    for (const d of doors) { d.getWorldPosition(_w); let want = 0; for (const p of people) if (Math.abs(p.x - _w.x) < 1.6 && Math.abs(p.z - _w.z) < 1.6) { want = 1; break; }
      const u = d.userData.door; u.open += Math.max(-dt * 3, Math.min(dt * 3, want - u.open)); d.rotation.y = u.base + (reduce ? Math.round(u.open) : u.open) * 1.45; }
    for (let k = parked.length - 1; k >= 0; k--) { const pc = parked[k]; pc.timer -= dt;
      if (pc.state === "park" && pc.timer < 0) { if (Math.random() < 0.35) { pc.state = "out"; pc.v = 0; } else pc.timer = 40 + Math.random() * 120; }
      else if (pc.state === "out") { const o = pc.obj; pc.v = Math.min(3, pc.v + dt * 1.5); o.position.z += pc.v * dt; o.rotation.y = -Math.PI / 2;
        if (o.position.z > ROAD - 3.2) { // hand off to traffic
          o.getWorldPosition(_w); o.removeFromParent(); const dir = Math.random() < 0.5 ? 1 : -1, line = pc.j * CH + ROAD;
          const c = { id: ++carSeq, axis: "x", line, dir, p: _w.x, v: 2, vmax: 8, len: 4.3, obj: o, held: null }; o.name = "Car"; root.add(o); cars.push(c); placeCar(c); parked.splice(k, 1); } }
    }
  }
  // things cars must stop for: sims crossing, the player's car, etc. (set by the game)
  let obstacleFn = () => [];
  const obstacles = () => { try { return obstacleFn() || []; } catch (e) { return []; } };
  function carNear(x, z, r) { for (const c of cars) { const p = c.obj.position; if (Math.abs(p.x - x) < r && Math.abs(p.z - z) < r) return c; } return null; }
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
      const sw = reduce ? 0 : Math.sin(n.phase) * 0.5;
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
  // audit: where did every tree/shrub/flower patch land? (used by tests)
  function auditPlants() {
    const out = {}; for (const k of chunks.keys()) { const [i, j] = k.split(",").map(Number), info = chunkInfo(i, j);
      for (const p of info.plants) { const z = p.hill ? "hilltop" : zoneLocal(info, p.x, p.z); out[z] = (out[z] || 0) + 1; } }
    return out;
  }
  function auditCars() { let overlaps = 0; for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) { const A = cars[a].obj.position, B = cars[b].obj.position; if (Math.abs(A.x - B.x) < 1.9 && Math.abs(A.z - B.z) < 1.9) overlaps++; } return overlaps; }
  makeGrass(detail.grass);
  return {
    actors: () => [...cars.map((c) => c.obj), ...boats.map((b) => b.obj), ...npcs.map((n) => n.holder)],
    actorKinds: () => [...cars.map((c) => [c.obj, "car"]), ...boats.map((b) => [b.obj, "boat"]), ...npcs.map((n) => [n.holder, "npc", n.name])],
    root, signs, houseSigns, update, carNear, lotPlan,
    setFocus(p, cam) { focus = { x: p.x, z: p.z }; if (cam) camPos.copy(cam); }, setObstacles(fn) { obstacleFn = fn; },
    chunkMeshes: () => [...chunks.values()], carModel, parkedCars: () => parked.map((p) => p.obj), setShared, lotOfSign, zoneAt, auditPlants, auditCars,
    setRadius(r) { radius = r; }, setNpcs(n) { npcMax = n; },
    setDetail(d) { const g0 = detail.grass; Object.assign(detail, d); if (detail.grass !== g0) makeGrass(detail.grass); },
    setSky(c) { U.uSky.value.copy(c); }, setSeason, season: () => seasonOf(),
    sharedSlots: () => [...slots].map(([k, L]) => ({ chunk: k, name: L.name, sid: L.sid })),
    stats: () => ({ chunks: chunks.size, npcs: npcs.length, shared: shared.length, queued: queue.length, cars: cars.length, boats: boats.length, grass: grassCount }),
  };
}
