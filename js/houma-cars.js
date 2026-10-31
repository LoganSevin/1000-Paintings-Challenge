// Houma vehicles: procedurally modelled cars (no external assets). Side-profile body panels extruded with bevels
// (rounded edges, beveled hood/trunk), notched wheel arches, a glass greenhouse with painted pillars/roof, door seams,
// grille, bumpers, plates, mirrors, head/tail lights, and real wheels (tyre + rim + spokes) that spin and steer.
// Types: sedan, hatch, suv, pickup, van. Clearcoat metallic paint. Two-level LOD for distant traffic.
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// L length, W width, wr wheel radius, cl ground clearance, belt beltline, roof height, hood/trunk lengths, wb wheelbase frac
const SPEC = {
  sedan: { L: 4.7, W: 1.82, wr: 0.33, cl: 0.2, belt: 0.92, roof: 1.44, hood: 1.3, trunk: 0.95, ws: 0.62, rs: 0.5, wb: 0.6 },
  hatch: { L: 4.05, W: 1.76, wr: 0.31, cl: 0.19, belt: 0.92, roof: 1.48, hood: 0.95, trunk: 0.12, ws: 0.6, rs: 0.25, wb: 0.62 },
  suv: { L: 4.8, W: 1.92, wr: 0.38, cl: 0.27, belt: 1.08, roof: 1.76, hood: 1.15, trunk: 0.18, ws: 0.55, rs: 0.18, wb: 0.6 },
  pickup: { L: 5.5, W: 1.98, wr: 0.4, cl: 0.3, belt: 1.1, roof: 1.86, hood: 1.45, trunk: 0, cab: 1.85, ws: 0.5, rs: 0.08, wb: 0.64 },
  van: { L: 5.2, W: 1.98, wr: 0.34, cl: 0.22, belt: 1.05, roof: 2.25, hood: 0.75, trunk: 0.02, ws: 0.55, rs: 0.05, wb: 0.66 },
};
export const KINDS = Object.keys(SPEC);
// realistic US parking-lot palette (white/silver/grey/black dominate)
export const PALETTE = ["#ecebe7", "#e4e2dc", "#b9bcc0", "#a7aaad", "#6c7075", "#55595e", "#1c1e21", "#26292d", "#22324f", "#2f5d8a", "#7a1d1f", "#a3262b", "#b8a98a", "#3c5a45", "#8c8f92", "#5b3a2a", "#c9c3b4"];

const matCache = new Map();
function paint(col) {
  const k = "p" + col; if (!matCache.has(k)) matCache.set(k, new T.MeshPhysicalMaterial({ color: col, metalness: 0.55, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.07, name: "Car_Paint" }));
  return matCache.get(k);
}
const M = {
  glass: new T.MeshPhysicalMaterial({ color: "#26323b", metalness: 0.2, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.82, name: "Car_TintGlass" }),
  trim: new T.MeshStandardMaterial({ color: "#151618", roughness: 0.55, name: "Car_Trim" }),
  chrome: new T.MeshStandardMaterial({ color: "#d9dcdf", metalness: 1, roughness: 0.18, name: "Car_Chrome" }),
  tyre: new T.MeshStandardMaterial({ color: "#161616", roughness: 0.92, name: "Car_Tyre" }),
  rim: new T.MeshStandardMaterial({ color: "#b8bcc0", metalness: 0.9, roughness: 0.28, name: "Car_Rim" }),
  plate: new T.MeshStandardMaterial({ color: "#eeeadb", roughness: 0.6, name: "Car_Plate" }),
  bed: new T.MeshStandardMaterial({ color: "#1d1e20", roughness: 0.85, name: "Car_Bed" }),
};
// rounded box via beveled extrusion (centred)
function rbox(w, h, d, r) {
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3); const s = new T.Shape(), x = w / 2 - r, y = h / 2 - r;
  s.moveTo(-x, -h / 2); s.lineTo(x, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -y); s.lineTo(w / 2, y); s.quadraticCurveTo(w / 2, h / 2, x, h / 2); s.lineTo(-x, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, y); s.lineTo(-w / 2, -y); s.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2);
  const g = new T.ExtrudeGeometry(s, { depth: Math.max(1e-3, d - 2 * r), bevelEnabled: true, bevelSize: r, bevelThickness: r, bevelSegments: 2, curveSegments: 3 }); g.translate(0, 0, -(d - 2 * r) / 2); return g;
}
const at = (g, x, y, z, ry = 0, rz = 0) => { if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); g.translate(x, y, z); return g; };
function profile(pts, depth, bevel) { // pts: closed outline in (x along car, y up); extruded across the width
  const g = new T.ExtrudeGeometry(pts, { depth: depth - 2 * bevel, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 10 }); g.translate(0, 0, -(depth - 2 * bevel) / 2); return g;
}
function lowerBody(S, xf, xr) {
  const { L, cl, belt, wr } = S, s = new T.Shape(), ra = wr + 0.07, hf = belt - 0.1, x0 = -L / 2, x1 = L / 2, tk = S.trunk;
  s.moveTo(x0 + 0.18, cl); s.lineTo(xr - ra, cl); s.absarc(xr, cl + 0.02, ra, Math.PI, 0, true); s.lineTo(xf - ra, cl); s.absarc(xf, cl + 0.02, ra, Math.PI, 0, true);
  s.lineTo(x1 - 0.2, cl); s.quadraticCurveTo(x1, cl, x1, cl + 0.22); s.lineTo(x1 - 0.02, hf - 0.12); s.quadraticCurveTo(x1 - 0.04, hf, x1 - 0.2, hf); // nose + bevelled hood edge
  s.lineTo(x1 - S.hood, belt); // hood rises to the cowl
  if (tk > 0.3) { s.lineTo(x0 + tk, belt); s.lineTo(x0 + 0.18, belt - 0.04); s.quadraticCurveTo(x0 + 0.02, belt - 0.06, x0 + 0.01, belt - 0.2); } // trunk deck
  else s.lineTo(x0 + 0.05, belt);
  s.lineTo(x0, cl + 0.25); s.quadraticCurveTo(x0, cl, x0 + 0.18, cl); return s;
}
// greenhouse outline (glass); returns [shape, roofX0, roofX1]
function house(S) {
  const x1 = S.L / 2 - S.hood, x0 = S.pickup ? x1 - S.cab : -S.L / 2 + Math.max(S.trunk, 0.06), r1 = x1 - S.ws * (S.roof - S.belt) / 0.55, r0 = x0 + S.rs * (S.roof - S.belt) / 0.55 + 0.05;
  const s = new T.Shape(); s.moveTo(x0, S.belt - 0.02); s.lineTo(x1, S.belt - 0.02); s.lineTo(r1, S.roof - 0.04); s.quadraticCurveTo(r1 - 0.12, S.roof, r1 - 0.25, S.roof); s.lineTo(r0 + 0.15, S.roof); s.quadraticCurveTo(r0, S.roof, r0, S.roof - 0.06); s.lineTo(x0, S.belt - 0.02);
  return { s, x0, x1, r0, r1 };
}
function beam(a, b, t, w) { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); return at(new T.BoxGeometry(L, t, w), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0, 0, Math.atan2(dy, dx)); }
function wheel(S) {
  const wr = S.wr, tw = 0.22, g = new T.Group(), spin = new T.Group(); g.add(spin);
  const tyre = new T.CylinderGeometry(wr, wr, tw, 22, 1); tyre.rotateX(Math.PI / 2);
  const side = new T.TorusGeometry(wr - 0.05, 0.05, 6, 22); const s2 = side.clone(); side.translate(0, 0, tw / 2 - 0.02); s2.translate(0, 0, -tw / 2 + 0.02);
  const tm = new T.Mesh(mergeGeometries([tyre, side, s2]), M.tyre);
  const parts = [at(new T.CylinderGeometry(wr * 0.64, wr * 0.64, tw + 0.012, 18).rotateX(Math.PI / 2), 0, 0, 0), at(new T.CylinderGeometry(wr * 0.16, wr * 0.2, tw + 0.05, 10).rotateX(Math.PI / 2), 0, 0, 0)];
  for (let i = 0; i < 5; i++) { const sp = new T.BoxGeometry(wr * 0.5, 0.05, tw + 0.035); sp.translate(wr * 0.3, 0, 0); sp.rotateZ(i * 1.2566); parts.push(sp); }
  const rim = new T.Mesh(mergeGeometries(parts.map((q) => q.index ? q.toNonIndexed() : q)), M.rim);
  // rim face is darker between spokes: a recessed dark disc
  const dish = new T.Mesh(new T.CylinderGeometry(wr * 0.58, wr * 0.58, tw + 0.02, 16).rotateX(Math.PI / 2), M.trim);
  spin.add(tm, dish, rim); tm.castShadow = true; return g;
}
const geoCache = new Map();
function bodyGeos(kind) {
  if (geoCache.has(kind)) return geoCache.get(kind);
  const S = Object.assign({ pickup: kind === "pickup" }, SPEC[kind]), W = S.W, xf = S.L / 2 - S.L * (1 - S.wb) / 2 - 0.05, xr = -S.L / 2 + S.L * (1 - S.wb) / 2 + 0.05;
  const P = [], G = [], Tm = [], C = [], H = [], Tl = [], Pl = [], B = [];
  let low = lowerBody(S, xf, xr);
  if (S.pickup) { // cab-and-bed: lower body runs full length, bed is an open box behind the cab
    const h = house(S); P.push(profile(low, W, 0.07)); const bx0 = -S.L / 2 + 0.05, bx1 = h.x0 - 0.08, bl = bx1 - bx0;
    for (const z of [-1, 1]) P.push(at(rbox(bl, 0.42, 0.08, 0.03), bx0 + bl / 2, S.belt + 0.17, z * (W / 2 - 0.04)));
    P.push(at(rbox(0.08, 0.42, W - 0.05, 0.03), bx0 + 0.02, S.belt + 0.17, 0)); B.push(at(new T.BoxGeometry(bl - 0.1, 0.04, W - 0.2), bx0 + bl / 2, S.belt + 0.0, 0));
  } else P.push(profile(low, W, 0.07));
  const h = house(S); G.push(profile(h.s, W - 0.26, 0.05));
  P.push(at(rbox(h.r1 - h.r0 - 0.1, 0.06, W - 0.22, 0.03), (h.r0 + h.r1) / 2, S.roof + 0.0, 0)); // roof skin
  for (const z of [-1, 1]) { const zz = z * (W / 2 - 0.135);
    const a = beam([h.x1, S.belt], [h.r1 - 0.05, S.roof - 0.02], 0.07, 0.05); a.translate(0, 0, zz); P.push(a); // A pillar
    const c = beam([h.x0 + 0.02, S.belt], [h.r0 + 0.05, S.roof - 0.02], S.rs < 0.2 ? 0.1 : 0.16, 0.05); c.translate(0, 0, zz); P.push(c); // C/D pillar
    const bp = (h.x0 + h.x1) / 2 + (S.rs - S.ws) * 0.2; Tm.push(at(new T.BoxGeometry(0.09, S.roof - S.belt - 0.05, 0.05), bp, (S.belt + S.roof) / 2, zz)); // B pillar (black)
    Tm.push(at(new T.BoxGeometry(h.x1 - h.x0, 0.03, 0.03), (h.x0 + h.x1) / 2, S.belt + 0.005, z * (W / 2 - 0.1))); // window seal
    for (const sx of [h.x1 - 0.02, bp, h.x0 + 0.05]) Tm.push(at(new T.BoxGeometry(0.012, S.belt - S.cl - 0.22, 0.012), sx, (S.belt + S.cl) / 2 + 0.06, z * (W / 2 + 0.004))); // door seams
    Tm.push(at(new T.BoxGeometry(0.18, 0.02, 0.025), (h.x1 + bp) / 2 - 0.2, S.belt - 0.16, z * (W / 2 + 0.01))); // handles
    Tm.push(at(new T.BoxGeometry(0.18, 0.02, 0.025), (bp + h.x0) / 2 + 0.05, S.belt - 0.16, z * (W / 2 + 0.01)));
    P.push(at(rbox(0.2, 0.12, 0.16, 0.04), h.x1 - 0.12, S.belt + 0.08, z * (W / 2 + 0.07))); Tm.push(at(new T.BoxGeometry(0.06, 0.06, 0.12), h.x1 - 0.06, S.belt + 0.04, z * (W / 2 + 0.01))); // mirrors
    for (const xw of [xf, xr]) Tm.push(at(new T.TorusGeometry(S.wr + 0.075, 0.025, 4, 16, Math.PI), xw, S.cl + 0.02, z * (W / 2 + 0.005))); // arch liners
    Tm.push(at(new T.BoxGeometry(xf - xr - 2 * (S.wr + 0.1), 0.06, 0.03), (xf + xr) / 2, S.cl + 0.05, z * (W / 2 - 0.01))); // rocker
    H.push(at(rbox(0.07, 0.13, 0.36, 0.03), S.L / 2 - 0.035, S.belt - 0.24, z * (W / 2 - 0.3)));
    Tl.push(at(rbox(0.06, S.pickup || kind === "van" ? 0.32 : 0.15, kind === "van" || S.pickup ? 0.14 : 0.34, 0.02), -S.L / 2 + 0.025, S.belt - (S.pickup ? 0.0 : 0.17), z * (W / 2 - (kind === "van" || S.pickup ? 0.1 : 0.27))));
  }
  Tm.push(at(rbox(0.06, 0.2, W * 0.44, 0.02), S.L / 2 + 0.005, S.belt - 0.3, 0)); // grille
  for (let i = 0; i < 3; i++) C.push(at(new T.BoxGeometry(0.02, 0.012, W * 0.42), S.L / 2 + 0.04, S.belt - 0.37 + i * 0.07, 0));
  Tm.push(at(rbox(0.16, 0.2, W + 0.02, 0.07), S.L / 2 - 0.02, S.cl + 0.12, 0), at(rbox(0.16, 0.2, W + 0.02, 0.07), -S.L / 2 + 0.02, S.cl + 0.14, 0)); // bumpers
  Pl.push(at(new T.BoxGeometry(0.02, 0.15, 0.3), S.L / 2 + 0.07, S.cl + 0.18, 0), at(new T.BoxGeometry(0.02, 0.15, 0.3), -S.L / 2 - 0.065, S.cl + 0.34, 0));
  Tm.push(at(new T.BoxGeometry(S.L - 0.8, 0.12, W - 0.3), 0, S.cl + 0.02, 0)); // underbody
  const mg = (a) => a.length ? mergeGeometries(a.map((q) => { const n = q.index ? q.toNonIndexed() : q; n.deleteAttribute("uv"); return n; })) : null;
  const out = { S, xf, xr, paint: mg(P), glass: mg(G), trim: mg(Tm), chrome: mg(C), head: mg(H), tail: mg(Tl), plate: mg(Pl), bed: mg(B), low: null };
  // LOD1: three boxes
  const lb = new T.BoxGeometry(S.L, S.belt - S.cl, W); lb.translate(0, (S.belt + S.cl) / 2, 0); const lc = new T.BoxGeometry(h.x1 - h.x0, S.roof - S.belt, W - 0.2); lc.translate((h.x0 + h.x1) / 2, (S.belt + S.roof) / 2, 0);
  const lw = []; for (const x of [xf, xr]) { const q = new T.BoxGeometry(S.wr * 1.8, S.wr * 1.8, W + 0.04); q.translate(x, S.wr, 0); lw.push(q); }
  out.low = { paint: mg([lb]), glass: mg([lc]), tyre: mg(lw) };
  geoCache.set(kind, out); return out;
}
function lightMats() {
  return { head: new T.MeshStandardMaterial({ color: "#f4f3ea", emissive: "#fff6dc", emissiveIntensity: 0.1, roughness: 0.1, metalness: 0.3, name: "Head_Light" }), tail: new T.MeshStandardMaterial({ color: "#7a1010", emissive: "#ff2020", emissiveIntensity: 0.35, roughness: 0.2, name: "Tail_Light" }) };
}
const BEAM_MAT = () => new T.MeshBasicMaterial({ color: "#fff1c8", transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, name: "Car_Beam" });
// build a car facing +x. Returns a Group: userData.lights (setCarLights-compatible), userData.wheels, userData.spec.
export function makeCar(kind, col) {
  if (!SPEC[kind]) kind = "sedan"; const B = bodyGeos(kind), S = B.S, root = new T.Group(), lod = new T.LOD(), hi = new T.Group(), lo = new T.Group();
  const L = lightMats(), pm = paint(col);
  for (const [k, m] of [["paint", pm], ["glass", M.glass], ["trim", M.trim], ["chrome", M.chrome], ["head", L.head], ["tail", L.tail], ["plate", M.plate], ["bed", M.bed]]) if (B[k]) { const me = new T.Mesh(B[k], m); me.castShadow = k !== "glass" && k !== "chrome"; hi.add(me); if (k === "paint") root.userData.body = me; }
  const wheels = [];
  for (const x of [B.xf, B.xr]) for (const z of [-1, 1]) { const w = wheel(S); w.position.set(x, S.wr, z * (S.W / 2 - 0.16)); if (z < 0) w.rotation.y = Math.PI; w.userData.front = x === B.xf; w.userData.side = z; hi.add(w); wheels.push(w); }
  for (const [k, m] of [["paint", pm], ["glass", M.glass], ["tyre", M.tyre]]) lo.add(new T.Mesh(B.low[k], m));
  lod.addLevel(hi, 0); lod.addLevel(lo, 75); root.add(lod);
  // headlight beams + halos (shared shape with the sims-world car lights)
  const beam = new T.Mesh(new T.ConeGeometry(2.2, 9, 12, 1, true).rotateZ(Math.PI / 2).translate(S.L / 2 + 4.5, S.belt - 0.45, 0), BEAM_MAT()); beam.renderOrder = 5;
  const halo = new T.Mesh(new T.SphereGeometry(0.1, 8, 6), BEAM_MAT()); halo.scale.set(0.5, 1, 1); const h2 = halo.clone(); halo.position.set(S.L / 2 + 0.06, S.belt - 0.24, S.W / 2 - 0.3); h2.position.set(S.L / 2 + 0.06, S.belt - 0.24, -S.W / 2 + 0.3);
  const thm = BEAM_MAT(); thm.color.set("#ff3020"); const th = new T.Mesh(new T.SphereGeometry(0.07, 8, 6), thm), th2 = th.clone(); th.scale.set(0.4, 1, 1.4); th2.scale.copy(th.scale); th.position.set(-S.L / 2 - 0.03, S.belt - 0.17, S.W / 2 - 0.27); th2.position.set(-S.L / 2 - 0.03, S.belt - 0.17, -S.W / 2 + 0.27);
  hi.add(beam, halo, h2, th, th2); h2.material = halo.material; th2.material = thm;
  root.userData.lights = { head: L.head, tail: L.tail, beam: beam.material, halo: halo.material, tailHalo: thm };
  root.userData.wheels = wheels; root.userData.spec = S; root.userData.kind = kind; root.userData.spin = 0; root.userData.steer = 0;
  return root;
}
// per-frame: ds metres travelled, dA heading change (rad) this frame
export function animate(o, ds, dA) {
  const S = o.userData.spec, W = o.userData.wheels; if (!W) return; o.userData.spin -= ds / S.wr;
  const st = Math.abs(ds) > 1e-3 ? Math.max(-0.6, Math.min(0.6, Math.atan((dA / ds) * S.L * S.wb))) : o.userData.steer; o.userData.steer += (st - o.userData.steer) * 0.3;
  for (const w of W) { w.children[0].rotation.z = w.userData.side < 0 ? -o.userData.spin : o.userData.spin; w.rotation.y = (w.userData.side < 0 ? Math.PI : 0) + (w.userData.front ? o.userData.steer : 0); }
}
// mud splatter shell over the lower body; amount 0..1 via shell.material.userData.u.value
export function addMud(o) {
  if (o.userData.mud) return o.userData.mud; const body = o.userData.body; if (!body) return null; const S = o.userData.spec;
  const u = { value: 0 }, top = { value: S.belt + 0.05 };
  const m = new T.MeshStandardMaterial({ color: "#5a4630", roughness: 1, name: "Car_Mud", polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => { sh.uniforms.uMud = u; sh.uniforms.uTop = top;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vMP;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvMP = position;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying vec3 vMP; uniform float uMud, uTop;
float mh(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
float mn(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(mh(i),mh(i+vec3(1,0,0)),f.x),mix(mh(i+vec3(0,1,0)),mh(i+vec3(1,1,0)),f.x),f.y),mix(mix(mh(i+vec3(0,0,1)),mh(i+vec3(1,0,1)),f.x),mix(mh(i+vec3(0,1,1)),mh(i+vec3(1,1,1)),f.x),f.y),f.z);}`)
      .replace("#include <alphatest_fragment>", `float hh = 1.0 - clamp(vMP.y / uTop, 0.0, 1.0); float nn = mn(vMP*7.0)*0.55 + mn(vMP*23.0)*0.3 + mn(vMP*61.0)*0.15;
if (nn + hh * 0.9 * uMud < 1.25 - uMud * 0.55) discard; diffuseColor.rgb *= 0.75 + 0.5 * mn(vMP*31.0);`); };
  m.customProgramCacheKey = () => "mud1"; const sh = new T.Mesh(body.geometry, m); sh.scale.set(1.006, 1.004, 1.01); sh.userData.u = u; body.parent.add(sh); o.userData.mud = sh; return sh;
}
// static (parked) car parts for instancing: [[geometry, material, paintable]] with wheels baked in
const partCache = new Map();
export function staticParts(kind) {
  if (partCache.has(kind)) return partCache.get(kind); const B = bodyGeos(kind), S = B.S, tyres = [], rims = [];
  for (const x of [B.xf, B.xr]) for (const z of [-1, 1]) { const w = wheel(S); w.position.set(x, S.wr, z * (S.W / 2 - 0.16)); if (z < 0) w.rotation.y = Math.PI; w.updateMatrixWorld(true);
    w.traverse((q) => { if (!q.isMesh) return; const g = q.geometry.clone(); g.applyMatrix4(q.matrixWorld); const n = g.index ? g.toNonIndexed() : g; if (n.attributes.uv) n.deleteAttribute("uv"); (q.material === M.tyre ? tyres : rims).push(n); }); }
  const L = { head: new T.MeshStandardMaterial({ color: "#e8e8e0", roughness: 0.1, metalness: 0.4, name: "Head_Light" }), tail: new T.MeshStandardMaterial({ color: "#8a1414", roughness: 0.25, name: "Tail_Light" }) };
  const out = [[B.paint, paint("#ffffff"), true], [B.glass, M.glass], [B.trim, M.trim], [B.chrome, M.chrome], [B.head, L.head], [B.tail, L.tail], [B.plate, M.plate], [B.bed, M.bed], [mergeGeometries(tyres), M.tyre], [mergeGeometries(rims), M.rim]].filter((p) => p[0]);
  partCache.set(kind, out); return out;
}
// boat on a trailer (bass boat / skiff), facing +x
let boatP = null;
export function boatTrailerParts() {
  if (boatP) return boatP; const hull = new T.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); hull.scale(2.6, 0.55, 0.95); hull.translate(0, 1.05, 0);
  const deck = new T.BoxGeometry(4.6, 0.06, 1.7); deck.translate(-0.2, 1.06, 0); const motor = new T.BoxGeometry(0.4, 0.8, 0.35); motor.translate(-2.7, 1.25, 0); const cons = new T.BoxGeometry(0.5, 0.5, 0.6); cons.translate(0.2, 1.3, 0.3);
  const fr = []; for (const z of [-0.55, 0.55]) { const b = new T.BoxGeometry(5.6, 0.1, 0.1); b.translate(0, 0.5, z); fr.push(b); } const tongue = new T.BoxGeometry(1.6, 0.1, 0.1); tongue.translate(3.5, 0.5, 0); fr.push(tongue); const ax = new T.BoxGeometry(0.1, 0.1, 1.6); ax.translate(-0.3, 0.3, 0); fr.push(ax);
  const ty = []; for (const z of [-0.85, 0.85]) { const t = new T.CylinderGeometry(0.3, 0.3, 0.18, 14); t.rotateX(Math.PI / 2); t.translate(-0.3, 0.3, z); ty.push(t); }
  const nn = (a) => mergeGeometries(a.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n.attributes.uv) n.deleteAttribute("uv"); return n; }));
  boatP = [[nn([hull]), paint("#ffffff"), true], [nn([deck, cons]), new T.MeshStandardMaterial({ color: "#d9d4c4", roughness: 0.7, name: "Boat_Deck" })], [nn([motor]), M.trim], [nn(fr), new T.MeshStandardMaterial({ color: "#8d9296", metalness: 0.7, roughness: 0.45, name: "Trailer" })], [nn(ty), M.tyre]];
  return boatP;
}
