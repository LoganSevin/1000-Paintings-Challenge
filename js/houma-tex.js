// Houma tab: procedural surface textures for the 3D world (canvas-painted, no image assets).
// Each painter draws one tileable square; tex(kind, seed, opts) caches CanvasTextures by key.
import * as T from "three";

const cache = new Map();
let SIZE = 256;
export function setSize(s) { SIZE = s; }
function rng(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hex = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
function shade(c, d) { const [r, g, b] = hex(c); const f = (v) => Math.max(0, Math.min(255, d < 0 ? v * (1 + d) : v + (255 - v) * d)); return rgb(f(r), f(g), f(b)); }
function jit(c, r, a) { return shade(c, (r() - 0.5) * 2 * a); }
function noise(x, s, r, n, col, a, z) { x.fillStyle = col; for (let i = 0; i < n; i++) { x.globalAlpha = a * (0.3 + r() * 0.7); const q = z * (0.4 + r()); x.fillRect(r() * s, r() * s, q, q); } x.globalAlpha = 1; }
function blobs(x, s, r, n, c, amt, rmin, rmax, a = 0.3) { for (let i = 0; i < n; i++) { x.globalAlpha = a; x.fillStyle = jit(c, r, amt); const px = r() * s, py = r() * s, rad = rmin + r() * (rmax - rmin); for (const [ox, oy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) { x.beginPath(); x.arc(px + ox, py + oy, rad, 0, 7); x.fill(); } } x.globalAlpha = 1; }

const P = {
  // vinyl / wood lap siding: 10 courses with drop shadows and faint grain
  lap(x, s, r, c) { const n = 10, h = s / n; for (let i = 0; i < n; i++) { const g = x.createLinearGradient(0, i * h, 0, (i + 1) * h); g.addColorStop(0, shade(c, 0.1)); g.addColorStop(0.8, c); g.addColorStop(1, shade(c, -0.32)); x.fillStyle = g; x.fillRect(0, i * h, s, h); x.fillStyle = shade(c, -0.45); x.fillRect(0, (i + 1) * h - 1, s, 1); }
    noise(x, s, r, s * 2, shade(c, -0.2), 0.12, 1.5); for (let k = 0; k < 3; k++) { x.fillStyle = shade(c, -0.25); x.fillRect(r() * s, Math.floor(r() * n) * h, 1, h); } },
  // board and batten
  batten(x, s, r, c) { x.fillStyle = c; x.fillRect(0, 0, s, s); noise(x, s, r, s * 3, shade(c, -0.15), 0.18, 1.2); const n = 6, w = s / n; for (let i = 0; i < n; i++) { x.fillStyle = shade(c, -0.35); x.fillRect(i * w + w * 0.42, 0, 2, s); x.fillStyle = shade(c, 0.12); x.fillRect(i * w + w * 0.42 - w * 0.08, 0, w * 0.08, s); } },
  // running-bond brick with mortar, varied bricks and weathering
  brick(x, s, r, c) { const rows = 16, h = s / rows, w = s / 6; x.fillStyle = "#cfc8bb"; x.fillRect(0, 0, s, s); noise(x, s, r, s * 4, "#8f877a", 0.3, 1);
    for (let i = 0; i < rows; i++) for (let j = -1; j < 7; j++) { const bx = j * w + (i % 2) * w / 2; x.fillStyle = jit(c, r, r() < 0.08 ? 0.35 : 0.16); x.fillRect(bx + 1, i * h + 1, w - 2, h - 2); x.fillStyle = "rgba(0,0,0,0.12)"; x.fillRect(bx + 1, i * h + h - 2.5, w - 2, 1.5); }
    noise(x, s, r, s * 6, "#000", 0.08, 1.4); const g = x.createLinearGradient(0, 0, 0, s); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(40,30,20,0.12)"); x.fillStyle = g; x.fillRect(0, 0, s, s); },
  // architectural asphalt shingles
  shingle(x, s, r, c) { const rows = 12, h = s / rows; x.fillStyle = shade(c, -0.5); x.fillRect(0, 0, s, s);
    for (let i = 0; i < rows; i++) { let px = -r() * 20; while (px < s) { const w = 10 + r() * 22; x.fillStyle = jit(c, r, 0.2); x.fillRect(px, i * h, w - 1.5, h - 2); x.fillStyle = "rgba(0,0,0,0.28)"; x.fillRect(px, i * h + h - 4, w - 1.5, 2); px += w; } }
    noise(x, s, r, s * 10, "#fff", 0.07, 1); noise(x, s, r, s * 8, "#000", 0.12, 1); },
  // standing-seam metal roof
  seam(x, s, r, c) { x.fillStyle = c; x.fillRect(0, 0, s, s); const n = 8, w = s / n; for (let i = 0; i < n; i++) { const g = x.createLinearGradient(i * w, 0, (i + 1) * w, 0); g.addColorStop(0, shade(c, 0.22)); g.addColorStop(0.5, c); g.addColorStop(1, shade(c, -0.18)); x.fillStyle = g; x.fillRect(i * w, 0, w, s); x.fillStyle = shade(c, 0.45); x.fillRect(i * w, 0, 2, s); x.fillStyle = shade(c, -0.4); x.fillRect(i * w + 2, 0, 1, s); }
    for (let k = 0; k < 5; k++) { x.globalAlpha = 0.12; x.fillStyle = "#6b4a2a"; x.fillRect(r() * s, r() * s, 3 + r() * 6, 20 + r() * 60); } x.globalAlpha = 1; },
  // corrugated metal wall
  corr(x, s, r, c) { for (let i = 0; i < s; i += 4) { x.fillStyle = (i / 4) % 2 ? shade(c, -0.14) : shade(c, 0.1); x.fillRect(i, 0, 4, s); } noise(x, s, r, s * 2, "#5a4030", 0.08, 2); },
  // stucco / EIFS
  stucco(x, s, r, c) { x.fillStyle = c; x.fillRect(0, 0, s, s); noise(x, s, r, s * 10, shade(c, -0.15), 0.25, 1.6); noise(x, s, r, s * 6, shade(c, 0.15), 0.2, 1.6); x.fillStyle = shade(c, -0.2); x.fillRect(0, s - 2, s, 2); },
  // asphalt with aggregate, tar patches, cracks
  asphalt(x, s, r, c) { x.fillStyle = c; x.fillRect(0, 0, s, s); blobs(x, s, r, 10, c, 0.12, 12, 50, 0.3); noise(x, s, r, s * 16, "#ffffff", 0.07, 1.2); noise(x, s, r, s * 10, "#000000", 0.2, 1.4);
    x.strokeStyle = "rgba(15,15,15,0.55)"; x.lineWidth = 1; for (let k = 0; k < 4; k++) { x.beginPath(); let px = r() * s, py = r() * s; x.moveTo(px, py); for (let j = 0; j < 8; j++) { px += (r() - 0.5) * 30; py += (r() - 0.5) * 30; x.lineTo(px, py); } x.stroke(); }
    x.fillStyle = "rgba(10,10,10,0.25)"; for (let k = 0; k < 2; k++) x.fillRect(r() * s, r() * s, 20 + r() * 40, 10 + r() * 30); },
  // poured concrete panels with control joints (driveways, sidewalks, commercial lots)
  panels(x, s, r, c) { x.fillStyle = c; x.fillRect(0, 0, s, s); blobs(x, s, r, 14, c, 0.08, 10, 40, 0.25); noise(x, s, r, s * 6, "#000", 0.08, 1.2); x.fillStyle = shade(c, -0.4); x.fillRect(0, 0, s, 2); x.fillRect(0, 0, 2, s); x.fillRect(0, s / 2, s, 1); x.fillRect(s / 2, 0, 1, s);
    x.globalAlpha = 0.15; x.fillStyle = "#3a2a1a"; x.beginPath(); x.ellipse(r() * s, r() * s, 20, 10, r() * 3, 0, 7); x.fill(); x.globalAlpha = 1; },
  // mowed lawn with stripes and clover patches
  lawn(x, s, r, c) { x.fillStyle = c; x.fillRect(0, 0, s, s); const n = 4; for (let i = 0; i < n; i++) { x.fillStyle = i % 2 ? "rgba(255,255,220,0.06)" : "rgba(0,30,0,0.06)"; x.fillRect(i * s / n, 0, s / n, s); }
    blobs(x, s, r, 16, c, 0.16, 8, 30, 0.35); for (let i = 0; i < s * 9; i++) { const px = r() * s, py = r() * s; x.strokeStyle = jit(c, r, 0.3); x.globalAlpha = 0.5; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 2, py - 2 - r() * 3); x.stroke(); } x.globalAlpha = 1;
    blobs(x, s, r, 4, "#8a7a4a", 0.1, 4, 10, 0.18); },
  // marsh: tall streaky grass, dull olive/tan, muddy gaps
  marsh(x, s, r, c) { x.fillStyle = shade(c, -0.25); x.fillRect(0, 0, s, s); blobs(x, s, r, 8, "#5a5238", 0.1, 10, 30, 0.4);
    for (let i = 0; i < s * 14; i++) { const px = r() * s, py = r() * s, l = 4 + r() * 10; x.strokeStyle = r() < 0.25 ? jit("#b8a56a", r, 0.2) : jit(c, r, 0.3); x.globalAlpha = 0.65; x.lineWidth = 1; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 3, py - l); x.stroke(); } x.globalAlpha = 1; },
  // gravel / shell lot (common in south Louisiana)
  gravel(x, s, r, c) { x.fillStyle = shade(c, -0.15); x.fillRect(0, 0, s, s); for (let i = 0; i < s * 12; i++) { x.fillStyle = jit(c, r, 0.35); x.beginPath(); x.ellipse(r() * s, r() * s, 1 + r() * 2.2, 0.8 + r() * 1.6, r() * 3, 0, 7); x.fill(); } },
  // bayou water: brown-green with ripple bands
  water(x, s, r, c) { x.fillStyle = c; x.fillRect(0, 0, s, s); blobs(x, s, r, 12, c, 0.1, 20, 60, 0.3); x.strokeStyle = "rgba(255,255,255,0.10)"; x.lineWidth = 1.2; for (let i = 0; i < 40; i++) { const px = r() * s, py = r() * s, w = 10 + r() * 30; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + w / 2, py - 2, px + w, py); x.stroke(); } },
  // mulch bed
  mulch(x, s, r, c) { x.fillStyle = shade(c, -0.3); x.fillRect(0, 0, s, s); for (let i = 0; i < s * 6; i++) { x.fillStyle = jit(c, r, 0.3); x.save(); x.translate(r() * s, r() * s); x.rotate(r() * 3); x.fillRect(0, 0, 3 + r() * 5, 1 + r()); x.restore(); } },
};
export const KINDS = Object.keys(P);
export function tex(kind, seed = 1, { color = "#888888", rep = null, size = SIZE } = {}) {
  const key = kind + "|" + seed + "|" + color + "|" + (rep || "") + "|" + size;
  if (cache.has(key)) return cache.get(key);
  const cv = document.createElement("canvas"); cv.width = cv.height = size; const x = cv.getContext("2d");
  x.save(); x.scale(size / 256, size / 256); (P[kind] || P.stucco)(x, 256, rng(seed * 2654435761), color); x.restore();
  const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 8; t.name = "hx_" + kind + seed;
  if (rep) t.repeat.set(rep[0], rep[1]);
  cache.set(key, t); return t;
}
// material helper: textured standard material, map tinted by color (use white color + vertex/instance colors for variety)
export function mat(kind, seed, color, o = {}) {
  const m = new T.MeshStandardMaterial({ map: tex(kind, seed, { color, rep: o.rep, size: o.size }), color: o.tint || "#ffffff", roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, vertexColors: !!o.vc, side: o.side ? T.DoubleSide : T.FrontSide });
  m.name = o.name || "HX_" + kind; if (o.po) { m.polygonOffset = true; m.polygonOffsetFactor = o.po; m.polygonOffsetUnits = o.po; } return m;
}
