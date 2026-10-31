// Houma trees: procedural branch skeletons + alpha-tested leaf cards (leaf/needle/moss cutouts drawn on canvases, so
// every asset is generated here — no third-party textures), species silhouettes, and crossed-quad impostors for distance.
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const rng = (s) => { s = s >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const texCache = new Map();
function cardTex(kind) {
  if (texCache.has(kind)) return texCache.get(kind);
  const N = 256, cv = document.createElement("canvas"); cv.width = cv.height = N; const g = cv.getContext("2d"), r = rng(kind.length * 977 + 13);
  const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
  if (kind === "broad" || kind === "oak" || kind === "tupelo") {
    // a twig with clustered leaves: oak = small dense elliptic leaves, tupelo = larger glossy obovate leaves
    const big = kind === "tupelo", n = big ? 34 : 70, base = kind === "oak" ? [92, 42, 30] : big ? [100, 46, 32] : [88, 48, 34];
    g.strokeStyle = "#4a3a28"; g.lineWidth = 3; g.beginPath(); g.moveTo(N / 2, N); g.quadraticCurveTo(N * 0.45, N * 0.5, N / 2, N * 0.08); g.stroke();
    for (let i = 0; i < n; i++) {
      const t = r(), cx = N / 2 + (r() - 0.5) * N * 0.85 * Math.sin(t * Math.PI), cy = N * (0.1 + t * 0.85), a = r() * 6.28, L = (big ? 26 : 15) * (0.7 + r() * 0.6), W = L * (big ? 0.5 : 0.42);
      g.save(); g.translate(cx, cy); g.rotate(a); g.fillStyle = hsl(base[0] + (r() - 0.5) * 18, base[1] + (r() - 0.5) * 14, base[2] + (r() - 0.5) * 16);
      g.beginPath(); g.ellipse(0, -L / 2, W / 2, L / 2, 0, 0, 6.283); g.fill(); g.strokeStyle = hsl(base[0], 30, base[2] + 14, 0.5); g.lineWidth = 1; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L); g.stroke();
      g.fillStyle = hsl(base[0] + 10, 50, base[2] + 18, 0.35); g.beginPath(); g.ellipse(-W * 0.12, -L * 0.6, W * 0.18, L * 0.25, 0, 0, 6.283); g.fill(); g.restore();
    }
  } else if (kind === "cypress") {
    // feathery bald-cypress sprays: a rachis with fine flat needle leaflets in two ranks, several sprays per card
    for (let k = 0; k < 7; k++) {
      const x0 = N * (0.15 + r() * 0.7), y0 = N * 0.98, x1 = x0 + (r() - 0.5) * N * 0.5, y1 = N * (0.05 + r() * 0.25), segs = 22;
      for (let i = 0; i < segs; i++) {
        const t = i / segs, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, dx = (x1 - x0) / Math.hypot(x1 - x0, y1 - y0), dy = (y1 - y0) / Math.hypot(x1 - x0, y1 - y0), L = 22 * (1 - t * 0.6);
        g.strokeStyle = hsl(84 + (r() - 0.5) * 16, 46, 34 + r() * 14); g.lineWidth = 2.2;
        for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + (-dy * sd + dx * 0.4) * L, y + (dx * sd + dy * 0.4) * L); g.stroke(); }
      }
      g.strokeStyle = "#5c4a32"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
  } else if (kind === "pine") {
    for (let k = 0; k < 9; k++) { const cx = N * (0.2 + r() * 0.6), cy = N * (0.2 + r() * 0.6); for (let i = 0; i < 60; i++) { const a = r() * 6.28, L = 30 + r() * 40; g.strokeStyle = hsl(110 + (r() - 0.5) * 20, 40, 22 + r() * 14); g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); g.stroke(); } }
  } else if (kind === "moss") {
    // Spanish moss: hanging grey-green strands, thin at the tips
    for (let i = 0; i < 46; i++) { let x = N * (0.1 + r() * 0.8), y = 0; const L = N * (0.4 + r() * 0.6); g.strokeStyle = hsl(70 + r() * 20, 10 + r() * 10, 58 + r() * 14, 0.95); g.lineWidth = 1 + r() * 2.2; g.beginPath(); g.moveTo(x, y); while (y < L) { y += 6; x += (r() - 0.5) * 5; g.lineTo(x, y); } g.stroke(); }
  }
  const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; texCache.set(kind, t); return t;
}
const matCache = new Map();
export function leafMat(kind, wrap) {
  const key = kind + (wrap ? 1 : 0); if (matCache.has(key)) return matCache.get(key);
  let m = new T.MeshStandardMaterial({ map: cardTex(kind), alphaTest: 0.42, side: T.DoubleSide, roughness: kind === "tupelo" ? 0.55 : 0.85, vertexColors: true, name: "H_Leaf_" + kind });
  m.emissiveMap = m.map; m.emissive = new T.Color(kind === "moss" ? "#6a6a52" : "#3c4a22"); m.emissiveIntensity = 0.55;
  if (wrap) m = wrap(m); matCache.set(key, m); return m;
}
const barkMat = (col) => new T.MeshStandardMaterial({ color: col, roughness: 0.95, name: "H_Bark" });

// tapered limb from a to b (radius r0 -> r1) as a 6-sided tube
function limb(out, a, b, r0, r1) {
  const d = new T.Vector3().subVectors(b, a), L = d.length(); if (L < 1e-3) return;
  const g = new T.CylinderGeometry(r1, r0, L, 6, 1, true); g.translate(0, L / 2, 0);
  const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); g.applyQuaternion(q); g.translate(a.x, a.y, a.z); out.push(g);
}
// a leaf card centred at p, facing a random-ish direction biased outward from the crown centre c
function card(out, p, c, size, r, shade, hang = false) {
  const g = new T.PlaneGeometry(size, size * (hang ? 1.8 : 1)); if (hang) g.translate(0, -size * 0.9, 0);
  const o = new T.Object3D(); o.position.copy(p);
  if (hang) o.rotation.set(0, r() * 6.28, 0); else { const out_ = new T.Vector3().subVectors(p, c); out_.y *= 0.4; out_.normalize(); o.lookAt(p.clone().add(out_)); o.rotateZ(r() * 6.28); o.rotateX((r() - 0.5) * 1.2); }
  o.updateMatrix(); g.applyMatrix4(o.matrix);
  // fake canopy AO / painterly light: darker inside & underneath, warmer on top
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const y = g.attributes.position.getY(i), k = shade * (0.75 + 0.25 * Math.min(1, Math.max(0, (y - c.y) / (size * 3) + 0.5))); col[i * 3] = k * (1.02 + r() * 0.06); col[i * 3 + 1] = k; col[i * 3 + 2] = k * 0.9; }
  // canopy-style normals (outward from crown + up) so both card faces light like foliage instead of going black from behind
  const nv = new T.Vector3().subVectors(p, c); nv.y = Math.max(nv.y, 0) + nv.length() * 0.6 + 0.01; nv.normalize(); const na = g.attributes.normal;
  for (let i = 0; i < n; i++) na.setXYZ(i, nv.x, nv.y, nv.z);
  g.setAttribute("color", new T.BufferAttribute(col, 3)); out.push(g);
}
// species skeletons. h = height (m). Returns a Group of merged meshes: bark, leaves, (moss)
export function makeTree(sp, seed, h, opt = {}) {
  const r = rng(seed * 7919 + 17), B = [], Lf = [], Ms = [], V = (x, y, z) => new T.Vector3(x, y, z);
  let leafKind = "broad", bark = "#5a4a3a", moss = opt.moss || 0;
  if (sp === "cypress") { // straight tapering trunk + buttress, short level limbs, narrow conical crown flattening with age
    leafKind = "cypress"; bark = "#7a5f4a"; const R0 = 0.022 * h + 0.12;
    limb(B, V(0, 0, 0), V(0, h * 0.12, 0), R0 * 2.4, R0); limb(B, V(0, h * 0.12, 0), V(0, h, 0), R0, 0.04);
    const tiers = 9 + Math.floor(r() * 4);
    for (let i = 0; i < tiers; i++) { const t = i / (tiers - 1), y = h * (0.38 + 0.6 * t), len = h * (0.24 * (1 - t) + 0.06) * (0.8 + r() * 0.4), a = r() * 6.28, droop = -0.05 - r() * 0.12;
      const p0 = V(0, y, 0), p1 = V(Math.cos(a) * len, y + len * droop + len * 0.15, Math.sin(a) * len); limb(B, p0, p1, R0 * 0.3 * (1 - t * 0.6), 0.02);
      const nc = 3 + Math.floor(len * 0.9); for (let k = 0; k < nc; k++) { const u = 0.25 + 0.75 * (k / nc), p = p0.clone().lerp(p1, u).add(V((r() - 0.5) * 0.8, (r() - 0.3) * 0.8, (r() - 0.5) * 0.8)); card(Lf, p, V(0, y, 0), 1.6 + r() * 1.2, r, 0.85 + r() * 0.2); }
      if (moss && r() < moss) card(Ms, p0.clone().lerp(p1, 0.6), V(0, y, 0), 0.9 + r() * 0.6, r, 1, true); }
    for (let k = 0; k < 5; k++) card(Lf, V((r() - 0.5) * 1.2, h * (0.93 + r() * 0.07), (r() - 0.5) * 1.2), V(0, h * 0.8, 0), 1.8, r, 1.05);
    if (opt.knees) { for (let k = 0; k < 6; k++) { const a = r() * 6.28, d = 1.5 + r() * 2.5; limb(B, V(Math.cos(a) * d, 0, Math.sin(a) * d), V(Math.cos(a) * d, 0.3 + r() * 0.5, Math.sin(a) * d), 0.14, 0.05); } }
  } else if (sp === "oak") { // live oak: short massive trunk, long low near-horizontal limbs, broad flat-topped spreading crown
    leafKind = "oak"; bark = "#4e4337"; const R0 = 0.05 * h + 0.2, ty = h * 0.28; limb(B, V(0, 0, 0), V(0, ty, 0), R0 * 1.3, R0);
    const nl = 5 + Math.floor(r() * 3);
    for (let i = 0; i < nl; i++) { const a = (i / nl) * 6.28 + r() * 0.6, len = h * (0.8 + r() * 0.5), up = 0.12 + r() * 0.35;
      const p0 = V(0, ty * (0.8 + r() * 0.3), 0), mid = V(Math.cos(a) * len * 0.5, p0.y + len * up * 0.8, Math.sin(a) * len * 0.5), p1 = V(Math.cos(a) * len, p0.y + len * up * 0.6 + h * 0.15, Math.sin(a) * len);
      limb(B, p0, mid, R0 * 0.55, R0 * 0.32); limb(B, mid, p1, R0 * 0.32, 0.05);
      for (let s = 0; s < 3; s++) { const u = 0.4 + r() * 0.6, q0 = mid.clone().lerp(p1, u), q1 = q0.clone().add(V((r() - 0.5) * h * 0.4, h * (0.1 + r() * 0.2), (r() - 0.5) * h * 0.4)); limb(B, q0, q1, R0 * 0.12, 0.03);
        for (let k = 0; k < 7; k++) card(Lf, q0.clone().lerp(q1, r()).add(V((r() - 0.5) * 2.4, (r() - 0.2) * 1.4, (r() - 0.5) * 2.4)), V(0, ty + h * 0.2, 0), 2.2 + r() * 1.4, r, 0.8 + r() * 0.25); }
      if (moss) for (let k = 0; k < 3; k++) if (r() < moss) card(Ms, mid.clone().lerp(p1, r()), V(0, ty, 0), 1 + r() * 0.8, r, 1, true); }
  } else if (sp === "tupelo") { // water tupelo: swollen base, straight bole, narrow oval crown of ascending branches
    leafKind = "tupelo"; bark = "#6b6056"; const R0 = 0.025 * h + 0.12; limb(B, V(0, 0, 0), V(0, h * 0.1, 0), R0 * 1.9, R0); limb(B, V(0, h * 0.1, 0), V(0, h * 0.95, 0), R0, 0.05);
    for (let i = 0; i < 12; i++) { const t = i / 11, y = h * (0.45 + 0.45 * t), a = r() * 6.28, len = h * 0.22 * Math.sin(Math.PI * (0.25 + t * 0.7)) + 0.6, p0 = V(0, y, 0), p1 = V(Math.cos(a) * len, y + len * 0.7, Math.sin(a) * len);
      limb(B, p0, p1, R0 * 0.3, 0.03); for (let k = 0; k < 4; k++) card(Lf, p0.clone().lerp(p1, 0.4 + r() * 0.6).add(V((r() - 0.5) * 1.4, (r() - 0.5), (r() - 0.5) * 1.4)), V(0, h * 0.7, 0), 1.7 + r() * 0.9, r, 0.85 + r() * 0.2);
      if (moss && r() < moss * 0.5) card(Ms, p0.clone().lerp(p1, 0.5), V(0, y, 0), 0.8, r, 1, true); }
  } else { // loblolly pine: tall clear bole, crown of whorled upturned branches in the top third
    leafKind = "pine"; bark = "#6e4e36"; const R0 = 0.02 * h + 0.12; limb(B, V(0, 0, 0), V(0, h, 0), R0, 0.05);
    for (let i = 0; i < 10; i++) { const t = i / 9, y = h * (0.6 + 0.38 * t), len = h * 0.16 * (1 - t * 0.6) + 0.4; for (let w = 0; w < 3; w++) { const a = r() * 6.28, p0 = V(0, y, 0), p1 = V(Math.cos(a) * len, y + len * 0.25, Math.sin(a) * len); limb(B, p0, p1, R0 * 0.22, 0.03); card(Lf, p1, V(0, y, 0), 1.6 + r() * 0.8, r, 0.85 + r() * 0.2); card(Lf, p0.clone().lerp(p1, 0.5), V(0, y, 0), 1.3, r, 0.8); } }
  }
  const grp = new T.Group(), mk = (geos, m, nm) => { if (!geos.length) return; const g = mergeGeometries(geos.map((q) => (q.index ? q.toNonIndexed() : q)).map((q) => { for (const k of Object.keys(q.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) q.deleteAttribute(k); if (!q.attributes.color) { const c = new Float32Array(q.attributes.position.count * 3).fill(1); q.setAttribute("color", new T.BufferAttribute(c, 3)); } return q; })); const o = new T.Mesh(g, m); o.name = nm; grp.add(o); };
  const bm = barkMat(bark); bm.vertexColors = true;
  mk(B, bm, "bark"); mk(Lf, leafMat(leafKind, opt.wrap), "leaves"); if (Ms.length) mk(Ms, leafMat("moss", opt.wrap), "moss");
  grp.userData.h = h; return grp;
}
// impostor: render the tree from the side into a texture once, then show it on two crossed alpha-tested quads
export function makeImpostor(renderer, tree, h, w, wrap) {
  const RT = new T.WebGLRenderTarget(256, 384, { samples: 0 }); const sc = new T.Scene(); sc.add(new T.HemisphereLight("#eaf2ff", "#556040", 1.6)); const dl = new T.DirectionalLight("#fff2dd", 2.2); dl.position.set(4, 8, 6); sc.add(dl);
  const t = tree.clone(); sc.add(t); const cam = new T.OrthographicCamera(-w / 2, w / 2, h * 1.04, 0, -50, 50); cam.position.set(0, 0, 10); cam.lookAt(0, 0, 0);
  const prevT = renderer.getRenderTarget(), prevC = new T.Color(), prevA = renderer.getClearAlpha(); renderer.getClearColor(prevC); renderer.setRenderTarget(RT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, cam); renderer.setRenderTarget(prevT); renderer.setClearColor(prevC, prevA);
  let m = new T.MeshStandardMaterial({ map: RT.texture, alphaTest: 0.5, side: T.DoubleSide, roughness: 0.9, name: "H_TreeImpostor" }); if (wrap) m = wrap(m);
  const geos = []; for (const a of [0, Math.PI / 2]) { const g = new T.PlaneGeometry(w, h * 1.04); g.translate(0, h * 0.52, 0); g.rotateY(a); geos.push(g); }
  const grp = new T.Group(); const o = new T.Mesh(mergeGeometries(geos), m); o.name = "impostor"; grp.add(o); return grp;
}
