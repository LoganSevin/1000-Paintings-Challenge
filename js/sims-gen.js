// Sims procedural generators: seeded textures, furniture, sims. Pure client-side, no network.
// Every mesh uses MeshStandardMaterial with plain colors or canvas textures, so GLTFExporter
// bakes them into the .glb as PNG textures that Blender reads directly.
import * as T from "three";

// ---------------- seeded randomness ----------------
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashStr(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export const randSeed = () => (Math.random() * 1e9) | 0;
export const tools = (r) => ({ r, rr: (a, b) => a + r() * (b - a), ri: (a, b) => Math.floor(a + r() * (b - a + 1)), pick: (a) => a[Math.floor(r() * a.length)], chance: (p) => r() < p });

// ---------------- colors ----------------
function hexToRgb(h) { h = String(h || "#888").replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); const n = parseInt(h.slice(0, 6), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex(r, g, b) { const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"); return "#" + c(r) + c(g) + c(b); }
export function shade(hex, f) { const [r, g, b] = hexToRgb(hex); return f >= 0 ? rgbToHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f) : rgbToHex(r * (1 + f), g * (1 + f), b * (1 + f)); }
export function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
function jitter(hex, r, amt) { return shade(hex, (r() - 0.5) * 2 * amt); }

export const WOODS = { oak: "#b98a55", walnut: "#6b4a2e", maple: "#d9b98a", cherry: "#8e4a2e", ebony: "#2e221b", ash: "#cbb59a", teak: "#9a6a3a", whitewash: "#e2d8c8", pine: "#d4a86a", mahogany: "#5e2a1c" };
export const FABRICS = ["#6b3a2f", "#3a6ea5", "#2f6b4f", "#c9a227", "#8b3a3a", "#7b4fa0", "#d7c3a1", "#3c4a3e", "#a8574a", "#e8e0d2", "#2b2724", "#5d7a8c", "#c47a5a", "#9aa86a", "#d08aa0", "#46566b", "#e0b04a", "#7a8a6a", "#b04a6a", "#3a3f5c", "#cfa58a", "#5a9a96"];
export const METALS = { steel: "#b8bcc2", brass: "#c9a227", black: "#2b2b2b", chrome: "#dfe3e8", copper: "#b87333", white: "#eeeeee", gold: "#d4af37" };
export const LACQUER = ["#e8e4dc", "#1d1a18", "#c94a3a", "#3a6ea5", "#2f6b4f", "#e0b04a", "#7aa6b8", "#d08aa0", "#5a4632", "#9aa0a6", "#f0d6a0", "#4a5a3a"];
const ADJ = ["Cozy", "Modern", "Rustic", "Nordic", "Retro", "Grand", "Petite", "Classic", "Urban", "Breezy", "Mid-century", "Bohemian", "Sleek", "Vintage", "Coastal", "Industrial", "Art Deco", "Minimal", "Farmhouse", "Royal", "Studio", "Sunny", "Moody", "Cottage", "Loft", "Zen", "Prairie", "Neon", "Desert", "Alpine"];

// ---------------- textures ----------------
const Q = { tex: 256, aniso: 4 };
export function setQuality(q) { Object.assign(Q, q || {}); }
const texCache = new Map();
function canvas(s) { const c = document.createElement("canvas"); c.width = c.height = s; return c; }
function speckle(ctx, s, r, n, col, a, size) { ctx.fillStyle = col; for (let i = 0; i < n; i++) { ctx.globalAlpha = a * (0.4 + r() * 0.6); const z = size * (0.5 + r()); ctx.fillRect(r() * s, r() * s, z, z); } ctx.globalAlpha = 1; }
const PAINTERS = {
  wood(ctx, s, r, c) {
    const rows = 4 + Math.floor(r() * 3), h = s / rows;
    for (let i = 0; i < rows; i++) {
      const off = r() * s; for (let k = -1; k < 2; k++) { const x0 = off + k * s * (0.6 + r() * 0.5); ctx.fillStyle = jitter(c, r, 0.12); ctx.fillRect(x0, i * h, s, h); }
      ctx.strokeStyle = shade(c, -0.25); ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
      for (let g = 0; g < 7; g++) { ctx.beginPath(); const y = i * h + r() * h; ctx.moveTo(0, y); for (let x = 0; x <= s; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.03 + g + r()) * h * 0.08); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.fillStyle = shade(c, -0.45); ctx.fillRect(0, i * h, s, 1.5); ctx.fillRect(off % s, i * h, 1.5, h);
    }
  },
  herring(ctx, s, r, c) { const u = s / 8; for (let y = -2; y < 10; y++) for (let x = -2; x < 10; x++) { ctx.save(); ctx.translate(x * u * 2 + (y % 2) * u, y * u); ctx.rotate(((x + y) % 2 ? 1 : -1) * Math.PI / 4); ctx.fillStyle = jitter(c, r, 0.14); ctx.fillRect(0, 0, u * 1.9, u * 0.6); ctx.strokeStyle = shade(c, -0.4); ctx.strokeRect(0, 0, u * 1.9, u * 0.6); ctx.restore(); } },
  tile(ctx, s, r, c) { const n = [2, 4, 4, 8][Math.floor(r() * 4)], u = s / n, g = Math.max(1.5, s / 96); ctx.fillStyle = shade(c, -0.35); ctx.fillRect(0, 0, s, s); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { ctx.fillStyle = jitter(c, r, 0.06); ctx.fillRect(i * u + g, j * u + g, u - 2 * g, u - 2 * g); } speckle(ctx, s, r, 300, "#ffffff", 0.05, 2); },
  checker(ctx, s, r, c) { const n = 4, u = s / n, c2 = r() < 0.5 ? shade(c, 0.6) : shade(c, -0.55); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { ctx.fillStyle = (i + j) % 2 ? c : c2; ctx.fillRect(i * u, j * u, u, u); } speckle(ctx, s, r, 200, "#000", 0.05, 2); },
  marble(ctx, s, r, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); const vein = shade(c, r() < 0.5 ? -0.4 : 0.5); for (let v = 0; v < 9; v++) { ctx.strokeStyle = vein; ctx.globalAlpha = 0.15 + r() * 0.35; ctx.lineWidth = 0.5 + r() * 2; ctx.beginPath(); let x = r() * s, y = 0; ctx.moveTo(x, y); while (y < s) { x += (r() - 0.5) * 30; y += 8 + r() * 12; ctx.lineTo(x, y); } ctx.stroke(); } ctx.globalAlpha = 1; },
  carpet(ctx, s, r, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); speckle(ctx, s, r, s * 12, shade(c, 0.25), 0.25, 1.2); speckle(ctx, s, r, s * 12, shade(c, -0.3), 0.25, 1.2); if (r() < 0.5) { ctx.strokeStyle = shade(c, -0.2); ctx.globalAlpha = 0.4; ctx.lineWidth = 2; const u = s / 4; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { ctx.beginPath(); ctx.moveTo(i * u + u / 2, j * u); ctx.lineTo(i * u + u, j * u + u / 2); ctx.lineTo(i * u + u / 2, j * u + u); ctx.lineTo(i * u, j * u + u / 2); ctx.closePath(); ctx.stroke(); } ctx.globalAlpha = 1; } },
  concrete(ctx, s, r, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); for (let i = 0; i < 40; i++) { ctx.fillStyle = jitter(c, r, 0.08); ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(r() * s, r() * s, 6 + r() * 30, 0, 7); ctx.fill(); } ctx.globalAlpha = 1; speckle(ctx, s, r, s * 4, "#000", 0.12, 1); },
  terrazzo(ctx, s, r, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); const cols = [shade(c, -0.4), shade(c, 0.5), "#c94a3a", "#3a6ea5", "#e0b04a", "#2f6b4f"]; for (let i = 0; i < s * 0.9; i++) { ctx.fillStyle = cols[Math.floor(r() * cols.length)]; ctx.beginPath(); const x = r() * s, y = r() * s, z = 1 + r() * 4; ctx.moveTo(x, y); ctx.lineTo(x + z, y + r() * z); ctx.lineTo(x + r() * z, y + z); ctx.fill(); } },
  grass(ctx, s, r, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); for (let i = 0; i < 18; i++) { ctx.fillStyle = jitter(c, r, 0.12); ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(r() * s, r() * s, 10 + r() * 40, 0, 7); ctx.fill(); } ctx.globalAlpha = 0.55; for (let i = 0; i < s * 10; i++) { ctx.strokeStyle = jitter(c, r, 0.3); ctx.lineWidth = 1; const x = r() * s, y = r() * s; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4); ctx.stroke(); } ctx.globalAlpha = 1; },
  brick(ctx, s, r, c) { const rows = 8, h = s / rows, w = s / 4; ctx.fillStyle = shade(c, 0.55); ctx.fillRect(0, 0, s, s); for (let i = 0; i < rows; i++) for (let j = -1; j < 5; j++) { ctx.fillStyle = jitter(c, r, 0.15); ctx.fillRect(j * w + (i % 2) * w / 2 + 1.5, i * h + 1.5, w - 3, h - 3); } speckle(ctx, s, r, 500, "#000", 0.08, 2); },
  siding(ctx, s, r, c) { const rows = 8, h = s / rows; for (let i = 0; i < rows; i++) { const g = ctx.createLinearGradient(0, i * h, 0, (i + 1) * h); g.addColorStop(0, shade(c, 0.08)); g.addColorStop(0.85, c); g.addColorStop(1, shade(c, -0.35)); ctx.fillStyle = g; ctx.fillRect(0, i * h, s, h); } speckle(ctx, s, r, 200, "#000", 0.04, 2); },
  plaster(ctx, s, r, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); speckle(ctx, s, r, s * 3, shade(c, -0.12), 0.2, 2); speckle(ctx, s, r, s * 3, shade(c, 0.12), 0.2, 2); },
  wallpaper(ctx, s, r, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); const m = shade(c, r() < 0.5 ? -0.25 : 0.3), kind = Math.floor(r() * 4), n = 4, u = s / n; ctx.fillStyle = m; ctx.strokeStyle = m; ctx.lineWidth = 2;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = i * u + (j % 2) * u / 2, y = j * u + u / 2; ctx.beginPath();
      if (kind === 0) { ctx.arc(x, y, u * 0.12, 0, 7); ctx.fill(); }
      else if (kind === 1) { for (let p = 0; p < 5; p++) { const a = p * 1.2566; ctx.moveTo(x, y); ctx.arc(x + Math.cos(a) * u * 0.12, y + Math.sin(a) * u * 0.12, u * 0.09, 0, 7); } ctx.fill(); }
      else if (kind === 2) { ctx.moveTo(x, y - u * 0.3); ctx.lineTo(x + u * 0.2, y); ctx.lineTo(x, y + u * 0.3); ctx.lineTo(x - u * 0.2, y); ctx.closePath(); ctx.stroke(); }
      else { ctx.moveTo(x - u * 0.2, y); ctx.quadraticCurveTo(x, y - u * 0.3, x + u * 0.2, y); ctx.quadraticCurveTo(x, y + u * 0.3, x - u * 0.2, y); ctx.fill(); } } },
  stripes(ctx, s, r, c) { const n = [4, 6, 8, 12][Math.floor(r() * 4)], u = s / n, c2 = shade(c, r() < 0.5 ? -0.2 : 0.25); for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? c2 : c; ctx.fillRect(i * u, 0, u, s); } },
  panel(ctx, s, r, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); ctx.strokeStyle = shade(c, -0.3); ctx.lineWidth = 3; const n = 2, u = s / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) ctx.strokeRect(i * u + 8, j * u + 8, u - 16, u - 16); ctx.strokeStyle = shade(c, 0.3); ctx.lineWidth = 1; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) ctx.strokeRect(i * u + 11, j * u + 11, u - 22, u - 22); },
  stone(ctx, s, r, c) { ctx.fillStyle = shade(c, -0.45); ctx.fillRect(0, 0, s, s); const rows = 5, h = s / rows; for (let i = 0; i < rows; i++) { let x = -r() * 40; while (x < s) { const w = 30 + r() * 50; ctx.fillStyle = jitter(c, r, 0.18); ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x + 2, i * h + 2, w - 4, h - 4, 8); else ctx.rect(x + 2, i * h + 2, w - 4, h - 4); ctx.fill(); x += w; } } speckle(ctx, s, r, 400, "#000", 0.07, 2); },
  asphalt(ctx, s, r, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); speckle(ctx, s, r, s * 14, "#ffffff", 0.06, 1.3); speckle(ctx, s, r, s * 8, "#000000", 0.18, 1.5); },
  sidewalk(ctx, s, r, c) { PAINTERS.concrete(ctx, s, r, c); ctx.fillStyle = shade(c, -0.35); ctx.fillRect(0, 0, s, 2); ctx.fillRect(0, 0, 2, s); },
  shingle(ctx, s, r, c) { const rows = 8, h = s / rows, w = s / 6; for (let i = 0; i < rows; i++) for (let j = -1; j < 7; j++) { ctx.fillStyle = jitter(c, r, 0.12); ctx.fillRect(j * w + (i % 2) * w / 2, i * h, w - 1.5, h - 1); ctx.fillStyle = shade(c, -0.4); ctx.fillRect(j * w + (i % 2) * w / 2, i * h + h - 2, w, 2); } },
  pavers(ctx, s, r, c) { const n = 4, u = s / n; ctx.fillStyle = shade(c, -0.4); ctx.fillRect(0, 0, s, s); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { ctx.fillStyle = jitter(c, r, 0.12); ctx.fillRect(i * u + 2, j * u + 2, u - 4, u - 4); } },
  fabric(ctx, s, r, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); ctx.globalAlpha = 0.12; for (let i = 0; i < s; i += 2) { ctx.fillStyle = i % 4 ? shade(c, 0.3) : shade(c, -0.3); ctx.fillRect(0, i, s, 1); ctx.fillRect(i, 0, 1, s); } ctx.globalAlpha = 1; speckle(ctx, s, r, s * 3, shade(c, -0.2), 0.2, 1); },
  bark(ctx, s, r, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); for (let i = 0; i < 60; i++) { ctx.strokeStyle = shade(c, -0.35 - r() * 0.2); ctx.lineWidth = 1 + r() * 3; ctx.beginPath(); const x = r() * s; ctx.moveTo(x, 0); ctx.bezierCurveTo(x + (r() - 0.5) * 20, s / 3, x + (r() - 0.5) * 20, s * 2 / 3, x + (r() - 0.5) * 10, s); ctx.stroke(); } },
  leaves(ctx, s, r, c) { ctx.fillStyle = shade(c, -0.25); ctx.fillRect(0, 0, s, s); for (let i = 0; i < s * 1.5; i++) { ctx.fillStyle = jitter(c, r, 0.25); ctx.beginPath(); ctx.ellipse(r() * s, r() * s, 3 + r() * 6, 2 + r() * 3, r() * 3, 0, 7); ctx.fill(); } },
  art(ctx, s, r, c) {
    const pal = [c, shade(c, 0.5), shade(c, -0.5), FABRICS[Math.floor(r() * FABRICS.length)], LACQUER[Math.floor(r() * LACQUER.length)], "#f5f0e8"];
    ctx.fillStyle = pal[5]; ctx.fillRect(0, 0, s, s); const style = Math.floor(r() * 4);
    for (let i = 0; i < 26; i++) { ctx.fillStyle = pal[Math.floor(r() * pal.length)]; ctx.strokeStyle = ctx.fillStyle; ctx.globalAlpha = 0.6 + r() * 0.4; ctx.beginPath();
      if (style === 0) ctx.fillRect(r() * s, r() * s, r() * s * 0.5, r() * s * 0.5);
      else if (style === 1) { ctx.arc(r() * s, r() * s, r() * s * 0.25, 0, 7); ctx.fill(); }
      else if (style === 2) { ctx.lineWidth = 2 + r() * 12; ctx.moveTo(r() * s, r() * s); ctx.bezierCurveTo(r() * s, r() * s, r() * s, r() * s, r() * s, r() * s); ctx.stroke(); }
      else { const y = (i / 26) * s; ctx.fillRect(0, y, s, s / 26 + 1); } }
    ctx.globalAlpha = 1; },
  screen(ctx, s, r, c) { const g = ctx.createLinearGradient(0, 0, s, s); g.addColorStop(0, shade(c, 0.3)); g.addColorStop(1, shade(c, -0.5)); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); ctx.globalAlpha = 0.5; for (let i = 0; i < 8; i++) { ctx.fillStyle = r() < 0.5 ? "#ffffff" : shade(c, 0.6); ctx.fillRect(r() * s, r() * s, r() * s * 0.4, 4 + r() * 18); } ctx.globalAlpha = 1; },
  clockface(ctx, s, r, c) { ctx.fillStyle = "#f3ead8"; ctx.fillRect(0, 0, s, s); ctx.strokeStyle = "#2b2724"; ctx.lineWidth = s / 40; ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.45, 0, 7); ctx.stroke(); for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(s / 2 + Math.cos(a) * s * 0.36, s / 2 + Math.sin(a) * s * 0.36); ctx.lineTo(s / 2 + Math.cos(a) * s * 0.42, s / 2 + Math.sin(a) * s * 0.42); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + s * 0.2, s / 2 - s * 0.1); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2, s / 2 - s * 0.32); ctx.stroke(); },
  keys(ctx, s) { ctx.fillStyle = "#f5f2ea"; ctx.fillRect(0, 0, s, s); const n = 14, u = s / n; ctx.fillStyle = "#222"; for (let i = 0; i < n; i++) ctx.fillRect(i * u, 0, 1, s); for (let i = 0; i < n; i++) if ([0, 1, 3, 4, 5].includes(i % 7)) ctx.fillRect(i * u + u * 0.65, 0, u * 0.7, s * 0.6); },
  pat_solid(ctx, s, r, c) { PAINTERS.fabric(ctx, s, r, c); },
  pat_stripes(ctx, s, r, c, c2) { const n = 8; for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? c2 : c; ctx.fillRect(0, i * s / n, s, s / n); } },
  pat_vstripes(ctx, s, r, c, c2) { const n = 10; for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? c2 : c; ctx.fillRect(i * s / n, 0, s / n, s); } },
  pat_dots(ctx, s, r, c, c2) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); ctx.fillStyle = c2; const n = 8, u = s / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { ctx.beginPath(); ctx.arc(i * u + (j % 2) * u / 2, j * u + u / 2, u * 0.18, 0, 7); ctx.fill(); } },
  pat_plaid(ctx, s, r, c, c2) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); ctx.globalAlpha = 0.45; ctx.fillStyle = c2; const u = s / 6; for (let i = 0; i < 6; i++) { ctx.fillRect(i * u, 0, u * 0.35, s); ctx.fillRect(0, i * u, s, u * 0.35); } ctx.globalAlpha = 0.8; ctx.fillStyle = shade(c2, 0.5); for (let i = 0; i < 6; i++) { ctx.fillRect(i * u + u * 0.6, 0, 2, s); ctx.fillRect(0, i * u + u * 0.6, s, 2); } ctx.globalAlpha = 1; },
  pat_check(ctx, s, r, c, c2) { const n = 8, u = s / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { ctx.fillStyle = (i + j) % 2 ? c2 : c; ctx.fillRect(i * u, j * u, u, u); } },
  pat_floral(ctx, s, r, c, c2) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); for (let i = 0; i < 26; i++) { const x = r() * s, y = r() * s, z = 4 + r() * 6; ctx.fillStyle = c2; for (let p = 0; p < 5; p++) { ctx.beginPath(); ctx.arc(x + Math.cos(p * 1.2566) * z, y + Math.sin(p * 1.2566) * z, z * 0.6, 0, 7); ctx.fill(); } ctx.fillStyle = "#f3e2b3"; ctx.beginPath(); ctx.arc(x, y, z * 0.5, 0, 7); ctx.fill(); } },
  pat_camo(ctx, s, r, c, c2) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); for (const col of [c2, shade(c, -0.35), shade(c2, 0.3)]) for (let i = 0; i < 14; i++) { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(r() * s, r() * s, 10 + r() * 26, 6 + r() * 14, r() * 3, 0, 7); ctx.fill(); } },
  pat_zigzag(ctx, s, r, c, c2) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); ctx.strokeStyle = c2; ctx.lineWidth = s / 24; for (let y = 0; y < s + 20; y += s / 6) { ctx.beginPath(); for (let x = 0; x <= s; x += s / 8) ctx.lineTo(x, y + ((x / (s / 8)) % 2 ? s / 14 : 0)); ctx.stroke(); } },
  pat_gradient(ctx, s, r, c, c2) { const g = ctx.createLinearGradient(0, 0, 0, s); g.addColorStop(0, c); g.addColorStop(1, c2); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); },
};
export const FLOOR_KINDS = ["wood", "herring", "tile", "checker", "marble", "carpet", "concrete", "terrazzo", "stone", "pavers"];
export const WALL_KINDS = ["paint", "plaster", "brick", "siding", "wallpaper", "stripes", "panel", "tile", "stone", "wood"];
export const PATTERNS = ["solid", "stripes", "vstripes", "dots", "plaid", "check", "floral", "camo", "zigzag", "gradient"];
export function texture(kind, seed, color, c2, rep) {
  const key = kind + "|" + seed + "|" + color + "|" + (c2 || "") + "|" + (rep || "") + "|" + Q.tex;
  if (texCache.has(key)) return texCache.get(key);
  const s = Q.tex, cv = canvas(s), ctx = cv.getContext("2d");
  (PAINTERS[kind] || PAINTERS.plaster)(ctx, s, rng(hashStr(kind) ^ (seed >>> 0)), color, c2 || shade(color, 0.6));
  const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = Q.aniso; t.name = kind + "_" + seed;
  if (rep) t.repeat.set(rep[0], rep[1]);
  texCache.set(key, t); return t;
}

// ---------------- materials & geometry (cached) ----------------
const matCache = new Map();
export function M(color, o = {}) {
  const key = color + "|" + JSON.stringify(o);
  if (matCache.has(key)) return matCache.get(key);
  const p = { color: o.map ? "#ffffff" : color, roughness: o.rough ?? 0.75, metalness: o.metal ?? 0 };
  if (o.map) p.map = o.map;
  if (o.emissive) { p.emissive = new T.Color(o.emissive); p.emissiveIntensity = o.ei ?? 1; }
  if (o.opacity != null) { p.transparent = true; p.opacity = o.opacity; }
  if (o.side) p.side = T.DoubleSide;
  const m = new T.MeshStandardMaterial(p); m.name = o.name || (o.map ? o.map.name : "m_" + String(color).replace("#", ""));
  matCache.set(key, m); return m;
}
export const TM = (kind, seed, color, c2, o = {}) => M(color, { ...o, map: texture(kind, seed, color, c2, o.rep) });
const geoCache = new Map();
function g(key, f) { if (!geoCache.has(key)) geoCache.set(key, f()); return geoCache.get(key); }
const r3 = (v) => Math.round(v * 1000) / 1000;
export function rbox(w, h, d, rad = 0.03) {
  w = r3(w); h = r3(h); d = r3(d); rad = r3(Math.min(rad, w / 2.2, h / 2.2, d / 2.2));
  if (rad < 0.006) return g(`b${w},${h},${d}`, () => new T.BoxGeometry(w, h, d));
  return g(`rb${w},${h},${d},${rad}`, () => {
    const sh = new T.Shape(), x = w / 2 - rad, y = d / 2 - rad;
    sh.moveTo(-x, -d / 2); sh.lineTo(x, -d / 2); sh.quadraticCurveTo(w / 2, -d / 2, w / 2, -y); sh.lineTo(w / 2, y); sh.quadraticCurveTo(w / 2, d / 2, x, d / 2); sh.lineTo(-x, d / 2); sh.quadraticCurveTo(-w / 2, d / 2, -w / 2, y); sh.lineTo(-w / 2, -y); sh.quadraticCurveTo(-w / 2, -d / 2, -x, -d / 2);
    const geo = new T.ExtrudeGeometry(sh, { depth: Math.max(0.001, h - rad * 2), bevelEnabled: true, bevelThickness: rad, bevelSize: rad * 0.6, bevelSegments: 2, curveSegments: 3 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, -(h - rad * 2) / 2, 0); geo.computeVertexNormals();
    // planar UVs so textures look right on top
    const pos = geo.attributes.position, uv = geo.attributes.uv; for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) + pos.getY(i) * 0.5, pos.getZ(i) + pos.getY(i) * 0.5);
    return geo;
  });
}
export const cyl = (rt, rb, h, seg = 16) => g(`c${r3(rt)},${r3(rb)},${r3(h)},${seg}`, () => new T.CylinderGeometry(rt, rb, h, seg));
export const sph = (r, ws = 16, hs = 12) => g(`s${r3(r)},${ws},${hs}`, () => new T.SphereGeometry(r, ws, hs));
export const cap = (r, l, seg = 12) => g(`p${r3(r)},${r3(l)},${seg}`, () => new T.CapsuleGeometry(r, l, 4, seg));
export const torus = (R, r, arc = Math.PI * 2) => g(`t${r3(R)},${r3(r)},${r3(arc)}`, () => new T.TorusGeometry(R, r, 8, 24, arc));
export const cone = (r, h, seg = 16) => g(`k${r3(r)},${r3(h)},${seg}`, () => new T.ConeGeometry(r, h, seg));
export const ico = (r, d = 1) => g(`i${r3(r)},${d}`, () => new T.IcosahedronGeometry(r, d));
export function lathe(pts, seg = 20) { const key = "l" + pts.map((p) => r3(p[0]) + ":" + r3(p[1])).join(";") + seg; return g(key, () => new T.LatheGeometry(pts.map((p) => new T.Vector2(p[0], p[1])), seg)); }
export function mesh(geo, mat, x = 0, y = 0, z = 0, parent, name) {
  const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; if (name) m.name = name; if (parent) parent.add(m); return m;
}
// a box placed by its bottom (y = bottom)
const B = (p, w, h, d, mat, x, y, z, rad) => mesh(rbox(w, h, d, rad ?? 0.02), mat, x, y + h / 2, z, p);
const C = (p, rt, rb, h, mat, x, y, z, seg) => mesh(cyl(rt, rb, h, seg), mat, x, y + h / 2, z, p);

// legs under a rectangle of size w x d at height h
export function legs(p, style, w, d, h, mat, inset = 0.06) {
  const xs = w / 2 - inset, zs = d / 2 - inset, pts = [[-xs, -zs], [xs, -zs], [-xs, zs], [xs, zs]];
  if (style === "pedestal") { C(p, 0.05, 0.07, h, mat, 0, 0, 0); C(p, Math.min(w, d) * 0.32, Math.min(w, d) * 0.36, 0.04, mat, 0, 0, 0, 24); return; }
  if (style === "plinth") { B(p, w - inset * 2, h, d - inset * 2, mat, 0, 0, 0, 0.01); return; }
  if (style === "sled") { for (const sx of [-xs, xs]) { B(p, 0.03, h, 0.03, mat, sx, 0, -zs); B(p, 0.03, h, 0.03, mat, sx, 0, zs); B(p, 0.03, 0.03, d - inset * 2, mat, sx, 0, 0); } return; }
  if (style === "x") { for (const sx of [-xs, xs]) for (const sgn of [1, -1]) { const L = Math.hypot(h, d - inset * 2), m = mesh(rbox(0.035, L, 0.035, 0.005), mat, sx, h / 2, 0, p); m.rotation.x = sgn * Math.atan2(d - inset * 2, h); } return; }
  for (const [x, z] of pts) {
    if (style === "round") C(p, 0.028, 0.028, h, mat, x, 0, z, 10);
    else if (style === "tapered") { const m = C(p, 0.032, 0.016, h, mat, x * 0.97, 0, z * 0.97, 10); m.rotation.z = -Math.sign(x) * 0.08; m.rotation.x = Math.sign(z) * 0.08; }
    else if (style === "hairpin") { const m1 = C(p, 0.008, 0.008, h, mat, x - 0.02, 0, z, 6), m2 = C(p, 0.008, 0.008, h, mat, x + 0.02, 0, z, 6); m1.rotation.z = 0.1; m2.rotation.z = -0.1; }
    else if (style === "bun") mesh(sph(Math.min(h, 0.06), 10, 8), mat, x, Math.min(h, 0.06), z, p);
    else B(p, 0.045, h, 0.045, mat, x, 0, z, 0.006);
  }
}
const LEG_STYLES = ["square", "round", "tapered", "hairpin", "pedestal", "sled", "plinth", "bun", "x"];

// ---------------- catalog categories ----------------
// w,d in tiles; front faces +z. use = need gains per game minute.
export const ROOMS = { living: "Living", bedroom: "Bedroom", kitchen: "Kitchen", dining: "Dining", bath: "Bath", office: "Office", studio: "Studio", electronics: "Electronics", lighting: "Lighting", decor: "Decor", plants: "Plants", outdoor: "Outdoor" };
const U = (o) => o;
export const CATS = {
  sofa: { room: "living", label: "Sofa", w: 2, d: 1, use: U({ energy: 0.8, fun: 1.2 }), dur: 20, pose: "sit", price: 300 },
  loveseat: { room: "living", label: "Loveseat", w: 2, d: 1, use: { energy: 0.7, fun: 1.4 }, dur: 18, pose: "sit", price: 240 },
  armchair: { room: "living", label: "Armchair", w: 1, d: 1, use: { energy: 0.7, fun: 0.8 }, dur: 14, pose: "sit", price: 180 },
  coffeetable: { room: "living", label: "Coffee Table", w: 2, d: 1, use: { fun: 0.5 }, dur: 6, pose: "stand", price: 120 },
  bookshelf: { room: "living", label: "Bookshelf", w: 1, d: 1, use: { fun: 2.2 }, dur: 18, pose: "stand", price: 160 },
  rug: { room: "living", label: "Rug", w: 2, d: 2, use: { fun: 0.3 }, dur: 3, pose: "stand", price: 90, flat: true },
  fireplace: { room: "living", label: "Fireplace", w: 2, d: 1, use: { fun: 1.6, energy: 0.4 }, dur: 14, pose: "stand", price: 900 },
  bed: { room: "bedroom", label: "Bed", w: 1, d: 2, use: { energy: 3.2 }, dur: 30, pose: "lie", price: 400 },
  dbed: { room: "bedroom", label: "Double Bed", w: 2, d: 2, use: { energy: 3.8 }, dur: 30, pose: "lie", price: 750 },
  nightstand: { room: "bedroom", label: "Nightstand", w: 1, d: 1, use: { fun: 0.3 }, dur: 4, pose: "stand", price: 70 },
  dresser: { room: "bedroom", label: "Dresser", w: 2, d: 1, use: { hygiene: 0.6, fun: 0.4 }, dur: 8, pose: "stand", price: 260 },
  wardrobe: { room: "bedroom", label: "Wardrobe", w: 1, d: 1, use: { hygiene: 0.8 }, dur: 6, pose: "stand", price: 320 },
  fridge: { room: "kitchen", label: "Fridge", w: 1, d: 1, use: { hunger: 3.5 }, dur: 12, pose: "stand", price: 500 },
  stove: { room: "kitchen", label: "Stove", w: 1, d: 1, use: { hunger: 4.5, fun: 0.3 }, dur: 15, pose: "stand", price: 450 },
  counter: { room: "kitchen", label: "Counter", w: 1, d: 1, use: { hunger: 1.5 }, dur: 8, pose: "stand", price: 140 },
  ksink: { room: "kitchen", label: "Kitchen Sink", w: 1, d: 1, use: { hygiene: 1.2, hunger: 0.4 }, dur: 6, pose: "stand", price: 200 },
  microwave: { room: "kitchen", label: "Microwave Cart", w: 1, d: 1, use: { hunger: 2.4 }, dur: 6, pose: "stand", price: 180 },
  dtable: { room: "dining", label: "Dining Table", w: 1, d: 1, use: { hunger: 1.2, fun: 0.4 }, dur: 12, pose: "stand", price: 150 },
  longtable: { room: "dining", label: "Long Table", w: 2, d: 1, use: { hunger: 1.4, fun: 0.6 }, dur: 12, pose: "stand", price: 280 },
  dchair: { room: "dining", label: "Chair", w: 1, d: 1, use: { energy: 0.6 }, dur: 10, pose: "sit", price: 80 },
  stool: { room: "dining", label: "Stool", w: 1, d: 1, use: { energy: 0.4 }, dur: 8, pose: "sit", price: 50 },
  toilet: { room: "bath", label: "Toilet", w: 1, d: 1, use: { hygiene: 2.0 }, dur: 8, pose: "sit", price: 250 },
  shower: { room: "bath", label: "Shower", w: 1, d: 1, use: { hygiene: 5.0 }, dur: 15, pose: "inside", price: 600 },
  bathtub: { room: "bath", label: "Bathtub", w: 1, d: 2, use: { hygiene: 4.2, energy: 0.6 }, dur: 20, pose: "lie", price: 700 },
  vanity: { room: "bath", label: "Vanity", w: 1, d: 1, use: { hygiene: 1.6 }, dur: 6, pose: "stand", price: 260 },
  desk: { room: "office", label: "Desk", w: 2, d: 1, use: { fun: 1.0 }, dur: 15, pose: "stand", price: 220 },
  officechair: { room: "office", label: "Office Chair", w: 1, d: 1, use: { energy: 0.6 }, dur: 10, pose: "sit", price: 140 },
  filing: { room: "office", label: "File Cabinet", w: 1, d: 1, use: { fun: 0.2 }, dur: 4, pose: "stand", price: 90 },
  easel: { room: "studio", label: "Easel", w: 1, d: 1, use: { fun: 4.0, energy: -0.3 }, dur: 25, pose: "paint", price: 200 },
  piano: { room: "studio", label: "Piano", w: 2, d: 1, use: { fun: 3.5 }, dur: 20, pose: "stand", price: 1200 },
  painting: { room: "studio", label: "Painting", w: 1, d: 1, use: { fun: 1.4 }, dur: 6, pose: "stand", price: 150 },
  sculpture: { room: "studio", label: "Sculpture", w: 1, d: 1, use: { fun: 1.6 }, dur: 6, pose: "stand", price: 350 },
  tv: { room: "electronics", label: "TV", w: 1, d: 1, use: { fun: 3.0 }, dur: 20, pose: "stand", price: 350 },
  computer: { room: "electronics", label: "Computer Desk", w: 1, d: 1, use: { fun: 3.2, energy: -0.2 }, dur: 20, pose: "stand", price: 800 },
  arcade: { room: "electronics", label: "Arcade Cabinet", w: 1, d: 1, use: { fun: 4.2 }, dur: 15, pose: "stand", price: 950 },
  stereo: { room: "electronics", label: "Stereo", w: 1, d: 1, use: { fun: 2.4 }, dur: 12, pose: "stand", price: 300 },
  floorlamp: { room: "lighting", label: "Floor Lamp", w: 1, d: 1, use: { fun: 0.5 }, dur: 3, pose: "stand", price: 60, toggle: true },
  tablelamp: { room: "lighting", label: "Lamp Table", w: 1, d: 1, use: { fun: 0.5 }, dur: 3, pose: "stand", price: 90, toggle: true },
  lantern: { room: "lighting", label: "Lantern", w: 1, d: 1, use: { fun: 0.5 }, dur: 3, pose: "stand", price: 50, toggle: true },
  clock: { room: "decor", label: "Grandfather Clock", w: 1, d: 1, use: { fun: 0.4 }, dur: 3, pose: "stand", price: 400 },
  vase: { room: "decor", label: "Vase", w: 1, d: 1, use: { fun: 0.8 }, dur: 4, pose: "stand", price: 45 },
  aquarium: { room: "decor", label: "Aquarium", w: 1, d: 1, use: { fun: 2.6 }, dur: 12, pose: "stand", price: 420 },
  plant: { room: "plants", label: "House Plant", w: 1, d: 1, use: { fun: 1.0 }, dur: 6, pose: "stand", price: 40 },
  cactus: { room: "plants", label: "Cactus", w: 1, d: 1, use: { fun: 0.8 }, dur: 5, pose: "stand", price: 30 },
  tree: { room: "plants", label: "Indoor Tree", w: 1, d: 1, use: { fun: 1.2 }, dur: 6, pose: "stand", price: 120 },
  bench: { room: "outdoor", label: "Bench", w: 2, d: 1, use: { energy: 0.6, fun: 0.6 }, dur: 12, pose: "sit", price: 110 },
  grill: { room: "outdoor", label: "Grill", w: 1, d: 1, use: { hunger: 3.8, fun: 0.8 }, dur: 15, pose: "stand", price: 380 },
  hottub: { room: "outdoor", label: "Hot Tub", w: 2, d: 2, use: { hygiene: 2.5, fun: 2.5, energy: 0.8 }, dur: 20, pose: "inside", price: 1500 },
  swing: { room: "outdoor", label: "Swing Set", w: 2, d: 1, use: { fun: 3.0, energy: -0.4 }, dur: 12, pose: "sit", price: 450 },
  planter: { room: "outdoor", label: "Flower Bed", w: 2, d: 1, use: { fun: 1.0 }, dur: 6, pose: "stand", price: 70 },
};
export const LEGACY = { bed: "bed", sofa: "sofa", chair: "dchair", table: "dtable", fridge: "fridge", stove: "stove", toilet: "toilet", shower: "shower", tv: "tv", lamp: "floorlamp", plant: "plant", easel: "easel" };
export function parseType(type) {
  const m = /^gen:([a-z]{2,14}):(\d{1,10})$/.exec(String(type || ""));
  if (m && CATS[m[1]]) return { cat: m[1], seed: Number(m[2]) >>> 0 };
  if (LEGACY[type]) return { cat: LEGACY[type], seed: 0, legacy: type };
  return null;
}
export const genType = (cat, seed) => "gen:" + cat + ":" + (seed >>> 0);
export function genInfo(type) {
  const p = parseType(type); if (!p) return null; const c = CATS[p.cat];
  const r = rng(p.seed ^ hashStr(p.cat)); const adj = p.seed === 0 ? "" : ADJ[Math.floor(r() * ADJ.length)] + " ";
  const f = p.seed === 0 ? 1 : 0.6 + r() * 1.2;
  return { ...c, cat: p.cat, seed: p.seed, label: adj + c.label, price: Math.max(5, Math.round(c.price * f / 5) * 5) };
}

// ---------------- furniture generators ----------------
function palette(t) {
  const wk = t.pick(Object.keys(WOODS)), wc = jitter(WOODS[wk], t.r, 0.08);
  const fc = t.pick(FABRICS), fk = t.pick(["fabric", "fabric", "fabric", "pat_stripes", "pat_check", "pat_dots", "pat_plaid", "pat_floral"]);
  const mk = t.pick(Object.keys(METALS));
  const lc = t.pick(LACQUER);
  const seed = t.ri(1, 1e6);
  return {
    seed, legStyle: t.pick(LEG_STYLES),
    wood: TM("wood", seed % 97, wc, null, { rough: 0.6, name: "Wood_" + wk }),
    woodC: wc,
    fabric: TM(fk, seed % 89, fc, shade(fc, t.chance(0.5) ? 0.5 : -0.4), { rough: 0.95, name: "Fabric" }),
    fabric2: M(shade(fc, -0.15), { rough: 0.95, name: "Fabric_Trim" }), fabC: fc,
    accent: M(t.pick(FABRICS), { rough: 0.9, name: "Accent" }),
    metal: M(METALS[mk], { metal: 0.85, rough: 0.3, name: "Metal_" + mk }),
    lacq: M(lc, { rough: 0.35, name: "Lacquer" }), lacC: lc,
    white: M("#eeeae2", { rough: 0.25, name: "Porcelain" }),
    dark: M("#1d1a18", { rough: 0.5, name: "Dark" }),
    glass: M("#a8d0e6", { opacity: 0.35, rough: 0.05, name: "Glass" }),
    leaf: TM("leaves", seed % 31, t.pick(["#3c7a3a", "#4f8a3a", "#2f6b4f", "#6a9a3a", "#3a5a2a"]), null, { rough: 0.9, name: "Leaves" }),
    pot: M(t.pick(["#a0522d", "#e8e4dc", "#2b2724", "#3a6ea5", "#c9a227", "#7a8a6a", "#c47a5a"]), { rough: 0.7, name: "Pot" }),
  };
}
const body = (t, P) => t.pick([P.wood, P.wood, P.lacq, P.white]);
function cushions(g, n, w, d, h, y, mat, t) { const cw = w / n; for (let i = 0; i < n; i++) B(g, cw - 0.03, h, d, mat, -w / 2 + cw * (i + 0.5), y, 0, Math.min(0.06, h / 2.5)); }
function seat(g, t, P, w, arms) {
  const lh = t.rr(0.08, 0.2), sh = t.rr(0.16, 0.24), d = t.rr(0.75, 0.9), backH = t.rr(0.3, 0.6), round = t.rr(0.02, 0.09);
  if (P.legStyle === "plinth" || t.chance(0.25)) B(g, w - 0.1, lh, d - 0.1, P.dark, 0, 0, 0, 0.01); else legs(g, t.pick(["round", "tapered", "square", "bun"]), w - 0.05, d - 0.05, lh, P.wood);
  B(g, w, sh, d, P.fabric2, 0, lh, 0, round);
  cushions(g, w > 1.5 ? t.ri(2, 3) : 1, w - (arms ? 0.3 : 0.05), d - 0.2, t.rr(0.1, 0.16), lh + sh, P.fabric, t);
  const back = B(g, w, backH, t.rr(0.14, 0.22), P.fabric, 0, lh + sh, -d / 2 + 0.1, round); back.rotation.x = -t.rr(0, 0.18);
  if (arms) { const ah = t.rr(0.15, 0.35), at = t.rr(0.1, 0.2); for (const s of [-1, 1]) B(g, at, sh + ah, d, P.fabric2, s * (w / 2 - at / 2), lh, 0, t.chance(0.5) ? at / 2.2 : round); }
  if (t.chance(0.6)) for (let i = 0; i < t.ri(1, 3); i++) { const p = B(g, 0.32, 0.28, 0.1, P.accent, t.rr(-w / 2 + 0.3, w / 2 - 0.3), lh + sh + 0.1, -d / 2 + 0.28, 0.05); p.rotation.x = -0.25; p.rotation.y = t.rr(-0.3, 0.3); }
}
function cabinet(g, t, P, w, h, d, drawers, cols) {
  const m = body(t, P), lh = t.chance(0.5) ? t.rr(0.08, 0.22) : 0;
  if (lh) legs(g, t.pick(["tapered", "round", "hairpin", "square", "bun"]), w, d, lh, P.wood, 0.05);
  B(g, w, h - lh, d, m, 0, lh, 0, 0.015);
  const rows = drawers, ch = (h - lh - 0.06) / rows, cw = (w - 0.06) / cols, hm = t.pick([P.metal, P.dark, P.wood]), knob = t.chance(0.5);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const x = -w / 2 + 0.03 + cw * (j + 0.5), y = lh + 0.03 + ch * i;
    B(g, cw - 0.03, ch - 0.03, 0.02, m === P.wood ? P.lacq : P.wood, x, y + 0.015, d / 2, 0.005);
    if (knob) mesh(sph(0.018, 8, 6), hm, x, y + ch / 2, d / 2 + 0.025, g); else B(g, Math.min(0.2, cw * 0.4), 0.02, 0.025, hm, x, y + ch * 0.7, d / 2 + 0.02, 0.005);
  }
  B(g, w + 0.02, 0.03, d + 0.02, m, 0, h - 0.01, 0, 0.01);
  return h + 0.02;
}
function tabletop(g, t, P, w, d, h, roundTop) {
  const th = t.rr(0.03, 0.07), m = t.pick([P.wood, P.wood, P.lacq, M("#e8e4dc", { rough: 0.2, name: "Stone_Top", map: texture("marble", P.seed % 13, "#e8e4dc") })]);
  if (roundTop) C(g, Math.min(w, d) / 2 - 0.04, Math.min(w, d) / 2 - 0.04, th, m, 0, h - th, 0, 32); else B(g, w - 0.08, th, d - 0.08, m, 0, h - th, 0, t.rr(0.005, 0.03));
  legs(g, roundTop && t.chance(0.6) ? "pedestal" : P.legStyle === "plinth" || P.legStyle === "bun" ? "square" : P.legStyle, w - 0.14, d - 0.14, h - th, t.chance(0.6) ? P.wood : P.metal, 0.05);
}
function clutter(g, t, P, w, d, y, n) {
  for (let i = 0; i < n; i++) { const x = t.rr(-w / 2 + 0.12, w / 2 - 0.12), z = t.rr(-d / 2 + 0.12, d / 2 - 0.12), k = t.ri(0, 4);
    if (k === 0) C(g, 0.12, 0.1, 0.02, P.white, x, y, z, 16);
    else if (k === 1) { C(g, 0.05, 0.04, 0.12, M(t.pick(LACQUER), { rough: 0.3 }), x, y, z, 12); }
    else if (k === 2) { const b = B(g, t.rr(0.12, 0.2), 0.04, t.rr(0.16, 0.24), M(t.pick(FABRICS)), x, y, z, 0.005); b.rotation.y = t.rr(0, 3); }
    else if (k === 3) { mesh(lathe([[0, 0], [0.05, 0.01], [0.06, 0.08], [0.03, 0.16], [0.035, 0.2], [0, 0.2]], 14), P.pot, x, y, z, g); }
    else mesh(sph(0.06, 10, 8), M(t.pick(["#c94a3a", "#e0b04a", "#7aa63a", "#e07a3a"])), x, y + 0.06, z, g); }
}
function lampHead(g, t, P, y, size) {
  const shadeCol = t.pick(["#f3e2b3", "#e8e4dc", "#d08aa0", "#7aa6b8", "#c9a227", "#e8c8a0"]);
  const k = t.ri(0, 3), sm = M(shadeCol, { emissive: shadeCol, ei: 0.45, rough: 0.9, side: true, name: "Lamp_Shade" });
  if (k === 0) mesh(cyl(size * 0.5, size, size * 1.1, 20), sm, 0, y, 0, g);
  else if (k === 1) mesh(sph(size * 0.8, 18, 12), sm, 0, y, 0, g);
  else if (k === 2) { const m = mesh(cone(size, size * 1.1, 20), sm, 0, y, 0, g); m.rotation.x = Math.PI; }
  else mesh(cyl(size * 0.8, size * 0.8, size * 1.4, 6), sm, 0, y, 0, g);
  const l = new T.PointLight("#ffd58a", 0.9, 6, 1.5); l.name = "LampLight"; l.position.set(0, y - 0.05, 0); g.add(l);
}
function bookRow(g, t, w, y, z, h) { let x = -w / 2 + 0.02; while (x < w / 2 - 0.05) { const bw = t.rr(0.025, 0.06), bh = h * t.rr(0.6, 0.95); if (t.chance(0.9)) { const b = B(g, bw, bh, 0.18, M(t.pick(FABRICS), { rough: 0.8, name: "Book" }), x + bw / 2, y, z, 0.004); if (t.chance(0.1)) b.rotation.z = 0.2; } x += bw + 0.004; } }

export const GEN = {
  sofa(g, t, P) { seat(g, t, P, t.rr(1.7, 1.95), true); },
  loveseat(g, t, P) { seat(g, t, P, t.rr(1.3, 1.6), t.chance(0.7)); },
  armchair(g, t, P) { seat(g, t, P, t.rr(0.75, 0.92), true); },
  bench(g, t, P) { const w = t.rr(1.5, 1.9), h = 0.42; legs(g, t.pick(["square", "sled", "x", "plinth"]), w, 0.45, h - 0.05, t.chance(0.5) ? P.metal : P.wood, 0.1); for (let i = 0; i < 4; i++) B(g, w, 0.03, 0.1, P.wood, 0, h - 0.05, -0.17 + i * 0.115, 0.01); if (t.chance(0.6)) { for (let i = 0; i < 3; i++) B(g, w, 0.08, 0.03, P.wood, 0, h + 0.15 + i * 0.13, -0.26, 0.01); } },
  coffeetable(g, t, P) { tabletop(g, t, P, t.rr(1.1, 1.6), t.rr(0.55, 0.8), t.rr(0.32, 0.45), t.chance(0.2)); clutter(g, t, P, 1, 0.5, 0.45, t.ri(0, 3)); },
  dtable(g, t, P) { const rnd = t.chance(0.4); tabletop(g, t, P, 0.92, 0.92, 0.76, rnd); clutter(g, t, P, 0.6, 0.6, 0.76, t.ri(1, 3)); },
  longtable(g, t, P) { tabletop(g, t, P, t.rr(1.7, 1.95), t.rr(0.8, 0.92), 0.76, false); clutter(g, t, P, 1.4, 0.6, 0.76, t.ri(1, 4)); },
  nightstand(g, t, P) { const h = cabinet(g, t, P, t.rr(0.4, 0.55), t.rr(0.45, 0.6), 0.4, t.ri(1, 3), 1); if (t.chance(0.6)) { C(g, 0.06, 0.08, 0.04, P.dark, 0, h, 0, 12); C(g, 0.012, 0.012, 0.25, P.metal, 0, h + 0.04, 0, 6); lampHead(g, t, P, h + 0.33, 0.1); } else clutter(g, t, P, 0.35, 0.3, h, 2); },
  dresser(g, t, P) { const h = cabinet(g, t, P, t.rr(1.4, 1.85), t.rr(0.75, 1.0), 0.48, t.ri(3, 4), t.ri(2, 3)); clutter(g, t, P, 1.2, 0.3, h, t.ri(1, 3)); if (t.chance(0.5)) { B(g, 0.7, 0.6, 0.03, P.wood, 0, h, -0.22, 0.01); mesh(rbox(0.6, 0.5, 0.01, 0.004), M("#cfe3ef", { metal: 0.9, rough: 0.05, name: "Mirror" }), 0, h + 0.3, -0.2, g); } },
  wardrobe(g, t, P) { const h = t.rr(1.8, 2.1), m = body(t, P); B(g, 0.92, h, 0.6, m, 0, 0, 0, 0.015); for (const s of [-1, 1]) { B(g, 0.43, h - 0.12, 0.02, m === P.wood ? P.lacq : P.wood, s * 0.225, 0.06, 0.3, 0.005); B(g, 0.02, 0.25, 0.03, P.metal, s * 0.04, h * 0.5, 0.33, 0.005); } B(g, 0.98, 0.06, 0.64, m, 0, h, 0, 0.015); },
  filing(g, t, P) { const m = t.pick([P.metal, P.lacq]); B(g, 0.5, 1.2, 0.6, m, 0, 0, 0, 0.01); for (let i = 0; i < 4; i++) { B(g, 0.46, 0.27, 0.02, m, 0, 0.04 + i * 0.29, 0.3, 0.005); B(g, 0.14, 0.03, 0.03, P.dark, 0, 0.22 + i * 0.29, 0.32, 0.005); } },
  bookshelf(g, t, P) { const h = t.rr(1.4, 2.1), w = t.rr(0.8, 0.95), m = body(t, P), n = t.ri(3, 6), sh = (h - 0.06) / n; B(g, 0.03, h, 0.35, m, -w / 2, 0, 0, 0.005); B(g, 0.03, h, 0.35, m, w / 2, 0, 0, 0.005); B(g, w, h, 0.02, m, 0, 0, -0.17, 0.003); for (let i = 0; i <= n; i++) B(g, w, 0.03, 0.35, m, 0, i * sh, 0, 0.005); for (let i = 0; i < n; i++) if (t.chance(0.85)) bookRow(g, t, w - 0.05, i * sh + 0.03, 0, sh - 0.05); else clutter(g, t, P, w - 0.1, 0.2, i * sh + 0.03, 2); },
  rug(g, t, P) { const k = t.pick(["carpet", "pat_stripes", "pat_check", "pat_zigzag", "pat_dots", "pat_floral", "terrazzo"]), c = t.pick(FABRICS), w = t.rr(1.4, 1.9), d = t.rr(1.2, 1.9); const m = TM(k, t.ri(1, 999), c, shade(c, 0.45), { rough: 1, name: "Rug" }); if (t.chance(0.35)) { const r = mesh(cyl(Math.min(w, d) / 2, Math.min(w, d) / 2, 0.015, 32), m, 0, 0.008, 0, g); r.castShadow = false; } else { const r = mesh(rbox(w, 0.015, d, 0.004), m, 0, 0.008, 0, g); r.castShadow = false; } },
  fireplace(g, t, P) { const k = t.pick(["brick", "stone", "marble", "plaster"]), c = t.pick(["#a8574a", "#9a9a92", "#e8e4dc", "#7a6a5a", "#c9b8a0"]), m = TM(k, t.ri(1, 99), c, null, { rough: 0.9, name: "Hearth" }); B(g, 1.7, 1.2, 0.5, m, 0, 0, -0.2, 0.01); B(g, 0.8, 0.6, 0.1, P.dark, 0, 0.1, 0.03, 0.01); B(g, 1.9, 0.08, 0.6, t.pick([P.wood, m]), 0, 1.2, -0.18, 0.01); for (let i = 0; i < 3; i++) { const l = C(g, 0.05, 0.05, 0.5, M("#5a3a22"), t.rr(-0.15, 0.15), 0.15 + i * 0.05, 0.05); l.rotation.z = Math.PI / 2; l.rotation.y = t.rr(-0.4, 0.4); } mesh(cone(0.16, 0.35, 10), M("#ff9a3a", { emissive: "#ff6a1a", ei: 1.4, name: "Fire" }), 0, 0.42, 0.05, g); clutter(g, t, P, 1.5, 0.3, 1.28, t.ri(2, 4)); },
  bed(g, t, P) { bedGen(g, t, P, t.rr(0.9, 0.98)); },
  dbed(g, t, P) { bedGen(g, t, P, t.rr(1.6, 1.9)); },
  bathtub(g, t, P) { const m = t.pick([P.white, P.white, P.lacq]); if (t.chance(0.5)) { legs(g, "bun", 0.75, 1.7, 0.08, P.metal, 0.12); mesh(lathe([[0.0, 0], [0.34, 0.02], [0.4, 0.3], [0.42, 0.5], [0.36, 0.5], [0.3, 0.12], [0, 0.1]], 24), m, 0, 0.08, 0, g).scale.set(1, 1, 2.1); } else { B(g, 0.85, 0.55, 1.85, m, 0, 0, 0, 0.06); B(g, 0.65, 0.02, 1.6, M("#9ec9e0", { opacity: 0.7, rough: 0.05, name: "Water" }), 0, 0.5, 0, 0.01); } C(g, 0.02, 0.02, 0.25, P.metal, 0, 0.5, -0.85, 8); },
  toilet(g, t, P) { const m = t.pick([P.white, P.white, P.dark]); mesh(lathe([[0, 0], [0.15, 0], [0.17, 0.2], [0.23, 0.38], [0.2, 0.4], [0, 0.38]], 20), m, 0, 0, 0.05, g).scale.set(1, 1, 1.25); C(g, 0.23, 0.23, 0.04, t.pick([m, P.wood]), 0, 0.4, 0.06, 20).scale.set(1, 1, 1.25); B(g, 0.45, t.rr(0.3, 0.45), 0.18, m, 0, 0.42, -0.28, 0.04); },
  shower(g, t, P) { const tile = TM("tile", t.ri(1, 99), t.pick(["#e8e4dc", "#7aa6b8", "#2f6b4f", "#d08aa0", "#1d1a18"]), null, { rough: 0.3, name: "Shower_Tile" }); B(g, 0.95, 0.08, 0.95, P.white, 0, 0, 0, 0.02); B(g, 0.95, 2.1, 0.05, tile, 0, 0, -0.45, 0.005); B(g, 0.05, 2.1, 0.95, tile, -0.45, 0, 0, 0.005); B(g, 0.9, 2.0, 0.02, P.glass, 0.02, 0.08, 0.46, 0.005); B(g, 0.02, 2.0, 0.9, P.glass, 0.46, 0.08, 0.02, 0.005); C(g, 0.015, 0.015, 1.9, P.metal, 0.3, 0.08, -0.42, 8); mesh(cyl(t.rr(0.06, 0.12), 0.05, 0.03, 16), P.metal, 0.3, 1.97, -0.32, g); },
  vanity(g, t, P) { const h = cabinet(g, t, P, 0.85, 0.82, 0.5, 2, 2); mesh(cyl(0.18, 0.12, 0.08, 20), P.white, 0, h - 0.02, 0.02, g); C(g, 0.015, 0.015, 0.2, P.metal, 0, h, -0.18, 8); B(g, 0.7, 0.8, 0.03, P.wood, 0, h + 0.25, -0.24, 0.01); mesh(rbox(0.62, 0.72, 0.01, 0.004), M("#cfe3ef", { metal: 0.9, rough: 0.05, name: "Mirror" }), 0, h + 0.65, -0.22, g); },
  fridge(g, t, P) { const m = t.pick([P.white, P.metal, P.lacq, P.dark]), h = t.rr(1.6, 2.0), two = t.chance(0.4); B(g, 0.82, h, 0.7, m, 0, 0, -0.05, 0.04); B(g, 0.8, 0.015, 0.01, P.dark, 0, h * 0.62, 0.305, 0.003); if (two) B(g, 0.015, h * 0.62, 0.01, P.dark, 0, 0, 0.305, 0.003); for (const y of [h * 0.35, h * 0.78]) B(g, 0.03, h * 0.2, 0.04, t.pick([P.metal, P.dark]), two ? 0.06 : 0.33, y - h * 0.1, 0.33, 0.01); if (t.chance(0.5)) for (let i = 0; i < 4; i++) B(g, 0.06, 0.06, 0.01, M(t.pick(LACQUER)), t.rr(-0.3, 0.2), t.rr(h * 0.65, h * 0.95), 0.31, 0.003); },
  stove(g, t, P) { const m = t.pick([P.white, P.metal, P.lacq, P.dark]); B(g, 0.86, 0.9, 0.7, m, 0, 0, -0.05, 0.02); B(g, 0.86, 0.03, 0.7, P.dark, 0, 0.9, -0.05, 0.005); for (const [x, z] of [[-0.2, -0.22], [0.2, -0.22], [-0.2, 0.1], [0.2, 0.1]]) mesh(torus(t.rr(0.06, 0.1), 0.012), M("#4a4a4a", { metal: 0.6 }), x, 0.94, z, g).rotation.x = Math.PI / 2; B(g, 0.7, 0.5, 0.02, P.dark, 0, 0.15, 0.31, 0.01); B(g, 0.6, 0.03, 0.04, P.metal, 0, 0.7, 0.33, 0.01); if (t.chance(0.5)) { C(g, 0.12, 0.12, 0.14, t.pick([P.metal, P.lacq]), -0.2, 0.95, -0.22, 16); } },
  counter(g, t, P) { const top = TM(t.pick(["marble", "terrazzo", "concrete", "wood"]), t.ri(1, 99), t.pick(["#e8e4dc", "#2b2724", "#9a9a92", "#b98a55"]), null, { rough: 0.3, name: "Countertop" }); B(g, 0.95, 0.86, 0.62, body(t, P), 0, 0, -0.04, 0.01); B(g, 0.43, 0.7, 0.02, P.lacq, -0.22, 0.08, 0.27, 0.005); B(g, 0.43, 0.7, 0.02, P.lacq, 0.22, 0.08, 0.27, 0.005); B(g, 1, 0.05, 0.68, top, 0, 0.86, -0.04, 0.008); clutter(g, t, P, 0.8, 0.5, 0.91, t.ri(0, 3)); },
  ksink(g, t, P) { GEN.counter(g, t, P); B(g, 0.5, 0.02, 0.36, P.metal, 0, 0.9, -0.04, 0.01); const f = mesh(torus(0.12, 0.012, Math.PI), P.metal, 0, 0.92, -0.26, g); C(g, 0.015, 0.015, 0.1, P.metal, 0.12, 0.91, -0.26, 8); f.rotation.y = Math.PI / 2; },
  microwave(g, t, P) { legs(g, "round", 0.6, 0.45, 0.7, P.metal, 0.03); B(g, 0.6, 0.03, 0.45, P.wood, 0, 0.7, 0, 0.005); B(g, 0.6, 0.03, 0.45, P.wood, 0, 0.2, 0, 0.005); B(g, 0.5, 0.3, 0.38, t.pick([P.white, P.dark, P.metal]), 0, 0.73, 0, 0.02); B(g, 0.32, 0.22, 0.01, M("#1a2a2a", { rough: 0.1 }), -0.05, 0.77, 0.19, 0.003); },
  dchair(g, t, P) { const h = 0.45, m = t.chance(0.6) ? P.wood : P.lacq; legs(g, t.pick(["square", "round", "tapered", "hairpin", "x", "sled"]), 0.45, 0.45, h - 0.04, t.chance(0.7) ? m : P.metal, 0.03); B(g, 0.48, 0.05, 0.46, m, 0, h - 0.04, 0, 0.015); if (t.chance(0.5)) B(g, 0.42, 0.04, 0.4, P.fabric, 0, h + 0.01, 0, 0.015); const k = t.ri(0, 2); if (k === 0) B(g, 0.48, t.rr(0.3, 0.5), 0.04, m, 0, h + 0.03, -0.22, 0.01); else if (k === 1) for (let i = 0; i < 4; i++) B(g, 0.03, 0.45, 0.03, m, -0.18 + i * 0.12, h, -0.22, 0.005); else { B(g, 0.48, 0.08, 0.04, m, 0, h + 0.38, -0.22, 0.01); B(g, 0.48, 0.08, 0.04, m, 0, h + 0.18, -0.22, 0.01); for (const s of [-1, 1]) B(g, 0.04, 0.5, 0.04, m, s * 0.22, h, -0.22, 0.005); } },
  stool(g, t, P) { const h = t.rr(0.45, 0.75), r = t.rr(0.16, 0.22); C(g, r, r, 0.06, t.pick([P.wood, P.fabric, P.lacq]), 0, h - 0.06, 0, 20); if (t.chance(0.5)) { C(g, 0.03, 0.03, h - 0.06, P.metal, 0, 0, 0, 10); C(g, 0.2, 0.22, 0.03, P.metal, 0, 0, 0, 20); } else { for (let i = 0; i < 3; i++) { const a = i * 2.094, l = C(g, 0.02, 0.025, h - 0.04, P.wood, Math.cos(a) * r * 0.7, 0, Math.sin(a) * r * 0.7, 8); l.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12); } mesh(torus(r * 0.75, 0.012), P.wood, 0, h * 0.35, 0, g).rotation.x = Math.PI / 2; } },
  officechair(g, t, P) { const m = t.pick([P.dark, P.fabric, P.lacq]); for (let i = 0; i < 5; i++) { const a = i * 1.2566, l = B(g, 0.04, 0.03, 0.3, P.metal, Math.sin(a) * 0.14, 0.05, Math.cos(a) * 0.14, 0.01); l.rotation.y = a; mesh(sph(0.03, 8, 6), P.dark, Math.sin(a) * 0.28, 0.03, Math.cos(a) * 0.28, g); } C(g, 0.025, 0.025, 0.35, P.metal, 0, 0.06, 0, 10); B(g, 0.5, 0.08, 0.48, m, 0, 0.42, 0, 0.04); const b = B(g, 0.46, t.rr(0.45, 0.7), 0.07, m, 0, 0.52, -0.24, 0.04); b.rotation.x = -0.1; if (t.chance(0.6)) for (const s of [-1, 1]) B(g, 0.05, 0.2, 0.3, P.dark, s * 0.26, 0.5, -0.02, 0.02); },
  desk(g, t, P) { const w = t.rr(1.4, 1.9), d = t.rr(0.6, 0.75); B(g, w, 0.04, d, t.pick([P.wood, P.lacq]), 0, 0.73, 0, 0.01); if (t.chance(0.5)) { legs(g, t.pick(["square", "hairpin", "tapered", "round"]), w - 0.04, d - 0.04, 0.73, P.metal, 0.04); } else { B(g, 0.45, 0.73, d - 0.04, body(t, P), w / 2 - 0.25, 0, 0, 0.01); for (let i = 0; i < 3; i++) B(g, 0.4, 0.2, 0.02, P.wood, w / 2 - 0.25, 0.06 + i * 0.23, d / 2 - 0.01, 0.004); B(g, 0.04, 0.73, d - 0.04, P.wood, -w / 2 + 0.04, 0, 0, 0.005); } clutter(g, t, P, w - 0.4, d - 0.2, 0.77, t.ri(1, 4)); if (t.chance(0.6)) { B(g, 0.35, 0.02, 0.25, P.dark, -0.2, 0.77, 0.05, 0.005); const s = B(g, 0.34, 0.22, 0.01, M("#2a3a4a", { emissive: "#21425f", ei: 0.5 }), -0.2, 0.78, -0.08, 0.004); s.rotation.x = -0.3; } },
  computer(g, t, P) { B(g, 0.95, 0.04, 0.6, t.pick([P.wood, P.lacq, P.dark]), 0, 0.73, 0, 0.01); legs(g, t.pick(["square", "hairpin", "x"]), 0.92, 0.56, 0.73, P.metal, 0.04); const n = t.ri(1, 2); for (let i = 0; i < n; i++) { const x = n === 1 ? 0 : (i - 0.5) * 0.42; C(g, 0.02, 0.02, 0.15, P.dark, x, 0.77, -0.18, 8); mesh(rbox(0.42, 0.26, 0.03, 0.01), P.dark, x, 1.05, -0.18, g); mesh(rbox(0.39, 0.23, 0.005, 0.002), M("#3d6f9e", { emissive: "#284c6e", ei: 0.9, map: texture("screen", t.ri(1, 999), t.pick(["#3d6f9e", "#2f6b4f", "#7b4fa0", "#a8574a"])), name: "Screen" }), x, 1.05, -0.163, g); } B(g, 0.4, 0.02, 0.13, M("#2b2b2b"), 0, 0.77, 0.08, 0.005); B(g, 0.18, 0.45, 0.4, t.pick([P.dark, P.white]), 0.36, 0, -0.05, 0.01); },
  arcade(g, t, P) { const c = t.pick(LACQUER), m = TM("pat_zigzag", t.ri(1, 99), c, shade(c, 0.4), { rough: 0.5, name: "Arcade_Art" }); B(g, 0.7, 1.75, 0.7, m, 0, 0, -0.05, 0.015); B(g, 0.72, 0.05, 0.4, P.dark, 0, 0.98, 0.15, 0.01); const s = mesh(rbox(0.55, 0.42, 0.02, 0.005), M("#3d6f9e", { emissive: "#7b4fa0", ei: 0.9, map: texture("screen", t.ri(1, 999), t.pick(["#7b4fa0", "#c94a3a", "#2f6b4f"])), name: "Arcade_Screen" }), 0, 1.3, 0.24, g); s.rotation.x = -0.25; mesh(rbox(0.6, 0.12, 0.02, 0.005), M(t.pick(["#e0b04a", "#ff6a6a", "#7aa6ff"]), { emissive: "#c9a227", ei: 0.8, name: "Marquee" }), 0, 1.65, 0.3, g); C(g, 0.015, 0.015, 0.06, P.metal, -0.15, 1.03, 0.2, 8); mesh(sph(0.03, 8, 6), M("#c94a3a"), -0.15, 1.1, 0.2, g); for (let i = 0; i < 3; i++) C(g, 0.025, 0.025, 0.02, M(t.pick(LACQUER)), 0.03 + i * 0.07, 1.02, 0.22, 10); },
  stereo(g, t, P) { const h = cabinet(g, t, P, 0.8, 0.5, 0.42, 1, 2); B(g, 0.45, 0.12, 0.3, P.dark, 0, h, 0, 0.01); C(g, 0.12, 0.12, 0.01, M("#111"), 0, h + 0.12, 0, 24); for (const s of [-1, 1]) { B(g, 0.2, 0.42, 0.2, t.pick([P.wood, P.dark]), s * 0.3, h, -0.02, 0.01); mesh(cyl(0.06, 0.06, 0.01, 16), P.dark, s * 0.3, h + 0.27, 0.085, g).rotation.x = Math.PI / 2; } },
  tv(g, t, P) { const stand = t.ri(0, 2), wtv = t.rr(0.7, 0.95), htv = wtv * 0.58; let y; if (stand === 0) y = cabinet(g, t, P, 0.95, 0.45, 0.42, 1, 2); else if (stand === 1) { B(g, 0.95, 0.04, 0.4, P.wood, 0, 0.42, 0, 0.01); legs(g, t.pick(["hairpin", "tapered", "round"]), 0.92, 0.38, 0.42, P.metal, 0.03); y = 0.46; } else { B(g, 0.3, 0.02, 0.2, P.dark, 0, 0, -0.15, 0.01); C(g, 0.02, 0.02, 1.0, P.metal, 0, 0, -0.18, 8); y = 0.9; } C(g, 0.02, 0.03, 0.06, P.dark, 0, y, -0.15, 8); mesh(rbox(wtv, htv, 0.04, 0.01), P.dark, 0, y + 0.06 + htv / 2, -0.18, g); mesh(rbox(wtv - 0.04, htv - 0.04, 0.005, 0.002), M("#3d6f9e", { emissive: "#21425f", ei: 0.9, map: texture("screen", t.ri(1, 999), t.pick(["#3d6f9e", "#2f6b4f", "#c94a3a", "#c9a227"])), name: "ScreenGlow" }), 0, y + 0.06 + htv / 2, -0.157, g); },
  piano(g, t, P) { const m = t.pick([M("#121010", { rough: 0.15, name: "Piano_Black" }), P.wood, P.lacq]); B(g, 1.5, 1.2, 0.5, m, 0, 0, -0.2, 0.02); B(g, 1.5, 0.08, 0.32, m, 0, 0.68, 0.2, 0.01); mesh(rbox(1.3, 0.02, 0.15, 0.003), M("#fff", { map: texture("keys", 1, "#fff"), rough: 0.3, name: "Keys" }), 0, 0.77, 0.26, g); B(g, 0.06, 0.68, 0.06, m, -0.68, 0, 0.32, 0.01); B(g, 0.06, 0.68, 0.06, m, 0.68, 0, 0.32, 0.01); B(g, 0.7, 0.06, 0.32, m, 0, 0.45, 0.72, 0.02); legs(g, "square", 0.66, 0.28, 0.45, m, 0.03); }, 
  easel(g, t, P) { const h = t.rr(1.5, 1.8); for (const s of [-1, 1]) { const l = B(g, 0.04, h, 0.04, P.wood, s * 0.25, 0, 0.05, 0.005); l.rotation.z = -s * 0.08; } const b = B(g, 0.04, h, 0.04, P.wood, 0, 0, -0.32, 0.005); b.rotation.x = -0.2; B(g, 0.6, 0.03, 0.08, P.wood, 0, 0.75, 0.08, 0.005); mesh(rbox(t.rr(0.5, 0.65), t.rr(0.55, 0.8), 0.03, 0.004), M("#fff", { map: texture("art", t.ri(1, 1e5), t.pick(FABRICS)), rough: 0.9, name: "Canvas" }), 0, 1.15, 0.09, g); },
  painting(g, t, P) { const w = t.rr(0.5, 0.95), h = t.rr(0.45, 0.95); for (const s of [-1, 1]) { const l = B(g, 0.03, 1.2, 0.03, P.wood, s * 0.15, 0, -0.1, 0.004); l.rotation.z = -s * 0.1; } mesh(rbox(w + 0.08, h + 0.08, 0.04, 0.01), t.pick([P.wood, P.metal, P.dark, M("#d4af37", { metal: 0.8, rough: 0.3 })]), 0, 1.0 + h / 2, -0.05, g); mesh(rbox(w, h, 0.01, 0.002), M("#fff", { map: texture("art", t.ri(1, 1e5), t.pick(FABRICS)), rough: 0.9, name: "Art" }), 0, 1.0 + h / 2, -0.025, g); },
  sculpture(g, t, P) { B(g, 0.45, t.rr(0.7, 1.0), 0.45, t.pick([P.white, P.dark, M("#9a9a92", { map: texture("marble", 3, "#e8e4dc") })]), 0, 0, 0, 0.01); const y = g.children[g.children.length - 1].position.y * 2; const m = t.pick([M("#d4af37", { metal: 0.9, rough: 0.25, name: "Bronze" }), M("#e8e4dc", { rough: 0.4, name: "Marble" }), P.lacq, M("#b87333", { metal: 0.9, rough: 0.35 })]); const k = t.ri(0, 3); if (k === 0) mesh(torus(0.2, 0.06), m, 0, y + 0.28, 0, g); else if (k === 1) { for (let i = 0; i < 4; i++) { const c = mesh(ico(0.14 - i * 0.025, 0), m, t.rr(-0.04, 0.04), y + 0.12 + i * 0.18, 0, g); c.rotation.set(t.rr(0, 3), t.rr(0, 3), 0); } } else if (k === 2) mesh(lathe([[0, 0], [0.12, 0.02], [0.05, 0.25], [0.16, 0.45], [0, 0.6]], 18), m, 0, y, 0, g); else { const c = mesh(torus(0.16, 0.04), m, 0, y + 0.22, 0, g); c.rotation.y = 1.2; mesh(sph(0.08, 14, 10), m, 0, y + 0.22, 0, g); } },
  floorlamp(g, t, P) { const h = t.rr(1.3, 1.7), base = t.pick([P.dark, P.metal, P.wood]); C(g, 0.15, 0.18, 0.05, base, 0, 0, 0, 20); if (t.chance(0.3)) { const a = C(g, 0.015, 0.015, h, P.metal, 0, 0, 0, 8); a.rotation.z = 0.15; g.children[g.children.length - 1].position.x = -h * 0.07; } else C(g, 0.018, 0.018, h, P.metal, 0, 0, 0, 8); lampHead(g, t, P, h + 0.1, t.rr(0.16, 0.26)); },
  tablelamp(g, t, P) { const h = cabinet(g, t, P, 0.5, 0.55, 0.45, t.ri(1, 2), 1); mesh(lathe([[0, 0], [0.09, 0], [0.11, 0.1], [0.06, 0.25], [0.02, 0.3], [0, 0.3]], 16), P.pot, 0, h, 0, g); lampHead(g, t, P, h + 0.42, 0.14); },
  lantern(g, t, P) { const h = t.rr(0.9, 1.4); C(g, 0.12, 0.14, 0.04, P.metal, 0, 0, 0, 12); C(g, 0.02, 0.02, h, P.metal, 0, 0, 0, 8); B(g, 0.2, 0.28, 0.2, M("#ffe2a0", { emissive: "#ffb84a", ei: 0.9, opacity: 0.85, name: "Lantern_Glass" }), 0, h, 0, 0.01); mesh(cone(0.17, 0.12, 4), P.metal, 0, h + 0.34, 0, g).rotation.y = Math.PI / 4; const l = new T.PointLight("#ffc46a", 0.8, 5, 1.6); l.name = "LampLight"; l.position.set(0, h + 0.14, 0); g.add(l); },
  clock(g, t, P) { const m = body(t, P); B(g, 0.5, 1.9, 0.35, m, 0, 0, -0.05, 0.015); mesh(cyl(0.18, 0.18, 0.02, 24), M("#fff", { map: texture("clockface", 1, "#fff"), name: "Clock_Face" }), 0, 1.6, 0.13, g).rotation.x = Math.PI / 2; B(g, 0.3, 0.8, 0.01, P.glass, 0, 0.5, 0.13, 0.003); const pend = C(g, 0.006, 0.006, 0.5, M("#d4af37", { metal: 0.9, rough: 0.3 }), 0, 0.7, 0.1, 6); pend.name = "Pendulum"; mesh(cyl(0.06, 0.06, 0.015, 16), M("#d4af37", { metal: 0.9, rough: 0.3 }), 0, 0.72, 0.1, g).rotation.x = Math.PI / 2; mesh(cone(0.32, 0.18, 4), m, 0, 2.0, -0.05, g).rotation.y = Math.PI / 4; },
  vase(g, t, P) { B(g, 0.35, t.rr(0.6, 0.9), 0.35, t.pick([P.wood, P.lacq, P.white]), 0, 0, 0, 0.01); const y = g.children[0].geometry.parameters ? 0 : 0; const top = g.children[0].position.y * 2; const pts = [[0, 0]]; const k = t.rr(0.06, 0.12); pts.push([k, 0.01], [k * t.rr(1.1, 1.8), t.rr(0.08, 0.15)], [k * t.rr(0.4, 0.8), t.rr(0.2, 0.3)], [k * t.rr(0.6, 1.1), 0.34], [0, 0.33]); mesh(lathe(pts, 20), M(t.pick(LACQUER), { rough: 0.25, name: "Ceramic", map: t.chance(0.4) ? texture(t.pick(["pat_stripes", "pat_dots", "pat_zigzag", "pat_floral"]), t.ri(1, 99), t.pick(LACQUER)) : undefined }), 0, top + y, 0, g); if (t.chance(0.7)) for (let i = 0; i < t.ri(3, 7); i++) { const st = C(g, 0.004, 0.004, 0.3, M("#3c7a3a"), t.rr(-0.04, 0.04), top + 0.3, t.rr(-0.04, 0.04), 4); st.rotation.set(t.rr(-0.3, 0.3), 0, t.rr(-0.3, 0.3)); mesh(sph(0.035, 8, 6), M(t.pick(["#c94a3a", "#e0b04a", "#d08aa0", "#fff", "#7b4fa0"])), st.position.x + t.rr(-0.06, 0.06), top + 0.6, st.position.z + t.rr(-0.06, 0.06), g); } },
  aquarium(g, t, P) { const h = cabinet(g, t, P, 0.95, 0.7, 0.45, 1, 2); B(g, 0.92, 0.5, 0.42, M("#7ac0e0", { opacity: 0.35, rough: 0.05, name: "Tank_Water" }), 0, h, 0, 0.005); B(g, 0.9, 0.05, 0.4, M("#d9c39a", { map: texture("terrazzo", 5, "#d9c39a") }), 0, h, 0, 0.003); for (let i = 0; i < t.ri(3, 7); i++) { const f = mesh(sph(0.03, 8, 6), M(t.pick(["#ff8a3a", "#ffd23a", "#3a9aff", "#ff4a6a"]), { name: "Fish" }), t.rr(-0.38, 0.38), h + t.rr(0.12, 0.42), t.rr(-0.14, 0.14), g); f.scale.set(1.8, 1, 0.6); } for (let i = 0; i < 4; i++) C(g, 0.01, 0.02, t.rr(0.15, 0.4), M("#3c9a5a"), t.rr(-0.4, 0.4), h + 0.05, t.rr(-0.15, 0.15), 5); B(g, 0.95, 0.06, 0.45, P.dark, 0, h + 0.5, 0, 0.005); },
  plant(g, t, P) { const ph = t.rr(0.25, 0.5); mesh(lathe([[0, 0], [0.13, 0], [0.2, ph], [0.18, ph], [0, ph - 0.03]], 18), P.pot, 0, 0, 0, g); const k = t.ri(0, 3); if (k === 0) { for (let i = 0; i < t.ri(2, 4); i++) mesh(ico(t.rr(0.18, 0.32), 1), P.leaf, t.rr(-0.1, 0.1), ph + t.rr(0.15, 0.45), t.rr(-0.1, 0.1), g); } else if (k === 1) { for (let i = 0; i < t.ri(6, 12); i++) { const a = t.rr(0, 6.28), l = mesh(rbox(0.1, 0.02, t.rr(0.35, 0.6), 0.008), P.leaf, Math.cos(a) * 0.12, ph + 0.15, Math.sin(a) * 0.12, g); l.rotation.set(t.rr(-0.9, -0.3), a, 0); l.position.y += 0.1; } } else if (k === 2) { const tr = C(g, 0.02, 0.03, t.rr(0.6, 1.1), M("#6b4a2e", { map: texture("bark", 1, "#6b4a2e") }), 0, ph, 0, 8); const th = tr.position.y * 2 - ph; for (let i = 0; i < 7; i++) { const a = i * 0.9, l = mesh(rbox(0.12, 0.015, 0.5, 0.006), P.leaf, Math.cos(a) * 0.2, ph + th, Math.sin(a) * 0.2, g); l.rotation.set(0.5, -a + Math.PI / 2, 0); } } else mesh(sph(t.rr(0.22, 0.32), 14, 10), P.leaf, 0, ph + 0.25, 0, g); },
  cactus(g, t, P) { C(g, 0.15, 0.12, 0.22, P.pot, 0, 0, 0, 14); const cm = M(t.pick(["#4f8a3a", "#3a6a3a", "#6a9a5a"]), { rough: 0.8, name: "Cactus" }); const h = t.rr(0.4, 0.9); mesh(cap(0.08, h, 10), cm, 0, 0.22 + h / 2 + 0.08, 0, g); for (let i = 0; i < t.ri(0, 3); i++) { const s = t.chance(0.5) ? 1 : -1, y = 0.3 + t.rr(0.1, h * 0.7); const a = mesh(cap(0.05, 0.18, 8), cm, s * 0.12, y + 0.1, 0, g); mesh(cap(0.05, 0.05, 8), cm, s * 0.07, y, 0, g).rotation.z = Math.PI / 2; a.rotation.y = t.rr(0, 3); } if (t.chance(0.5)) mesh(sph(0.04, 8, 6), M("#d08aa0"), 0, 0.22 + h + 0.15, 0, g); },
  tree(g, t, P) { C(g, 0.25, 0.2, 0.4, P.pot, 0, 0, 0, 16); genTree(g, t, 0.4, t.rr(0.9, 1.4), P.leaf); },
  grill(g, t, P) { const m = t.pick([P.dark, P.lacq, P.metal]); legs(g, t.chance(0.5) ? "round" : "x", 0.6, 0.45, 0.8, P.metal, 0.03); mesh(sph(0.32, 18, 10, 0), m, 0, 0.95, 0, g).scale.set(1.1, 0.6, 0.8); B(g, 0.65, 0.02, 0.4, P.metal, 0, 0.93, 0, 0.005); B(g, 0.2, 0.025, 0.4, P.wood, 0.45, 0.85, 0, 0.005); C(g, 0.02, 0.02, 0.2, P.metal, 0, 1.15, 0, 6); },
  hottub(g, t, P) { const m = TM(t.pick(["wood", "tile", "stone"]), t.ri(1, 99), t.pick(["#9a6a3a", "#e8e4dc", "#7aa6b8", "#5a4632"]), null, { name: "Tub_Shell" }); const rnd = t.chance(0.5); if (rnd) { C(g, 0.95, 0.95, 0.9, m, 0, 0, 0, 32); C(g, 0.82, 0.82, 0.02, M("#5ac0e0", { opacity: 0.8, rough: 0.05, emissive: "#1a6a8a", ei: 0.4, name: "Water" }), 0, 0.82, 0, 32); } else { B(g, 1.9, 0.9, 1.9, m, 0, 0, 0, 0.06); B(g, 1.65, 0.02, 1.65, M("#5ac0e0", { opacity: 0.8, rough: 0.05, emissive: "#1a6a8a", ei: 0.4, name: "Water" }), 0, 0.82, 0, 0.01); } },
  swing(g, t, P) { const m = t.pick([P.wood, P.metal, P.lacq]); for (const s of [-1, 1]) for (const z of [-0.35, 0.35]) { const l = B(g, 0.06, 2.0, 0.06, m, s * 0.85, 0, z * 0.5, 0.01); l.rotation.x = z > 0 ? -0.3 : 0.3; l.position.z = z; } B(g, 1.9, 0.08, 0.08, m, 0, 1.92, 0, 0.01); for (const x of [-0.4, 0.4]) { for (const sx of [-0.18, 0.18]) C(g, 0.008, 0.008, 1.45, P.metal, x + sx, 0.47, 0, 4); B(g, 0.42, 0.04, 0.2, t.pick([P.accent, P.wood, P.lacq]), x, 0.45, 0, 0.015); } },
  planter(g, t, P) { const m = TM(t.pick(["wood", "brick", "stone"]), t.ri(1, 99), t.pick(["#9a6a3a", "#a8574a", "#9a9a92"]), null, { name: "Planter" }); B(g, 1.8, 0.3, 0.7, m, 0, 0, 0, 0.02); B(g, 1.7, 0.02, 0.6, M("#4a3424", { rough: 1, name: "Soil" }), 0, 0.29, 0, 0.005); flowers(g, t, 1.6, 0.5, 0.31, t.ri(10, 22)); },
};
function bedGen(g, t, P, w) {
  const frameH = t.rr(0.18, 0.35), m = t.pick([P.wood, P.wood, P.lacq, P.fabric2]);
  if (t.chance(0.5)) B(g, w, frameH, 1.95, m, 0, 0, 0, 0.02); else { legs(g, t.pick(["square", "round", "tapered"]), w, 1.95, frameH, P.wood, 0.04); B(g, w, 0.08, 1.95, m, 0, frameH - 0.08, 0, 0.02); }
  B(g, w - 0.06, 0.2, 1.88, M("#f2eee6", { rough: 0.95, name: "Mattress" }), 0, frameH, 0.02, 0.06);
  const bc = t.pick(FABRICS), bk = t.pick(["fabric", "pat_stripes", "pat_check", "pat_plaid", "pat_floral", "pat_dots", "pat_zigzag"]);
  B(g, w - 0.02, 0.07, t.rr(1.0, 1.35), TM(bk, t.ri(1, 999), bc, shade(bc, 0.5), { rough: 1, name: "Blanket" }), 0, frameH + 0.17, 0.3, 0.03);
  const np = w > 1.3 ? 2 : 1; for (let i = 0; i < np; i++) B(g, np === 2 ? w / 2 - 0.12 : 0.6, 0.12, 0.32, M(t.pick(["#f5f2ea", "#e8e0d2", bc])), np === 2 ? (i - 0.5) * w / 2 : 0, frameH + 0.18, -0.72, 0.05);
  const hb = t.rr(0.5, 1.1), k = t.ri(0, 3);
  if (k === 0) B(g, w + 0.04, hb, 0.08, m, 0, 0, -0.98, 0.02);
  else if (k === 1) { B(g, w + 0.04, hb, 0.1, P.fabric, 0, 0.1, -0.98, 0.06); }
  else if (k === 2) { for (const s of [-1, 1]) B(g, 0.05, hb, 0.05, P.metal, s * w / 2, 0, -0.97, 0.01); for (let i = 0; i < 6; i++) B(g, 0.02, hb * 0.5, 0.02, P.metal, -w / 2 + (i + 0.5) * w / 6, hb * 0.4, -0.97, 0.005); B(g, w, 0.04, 0.04, P.metal, 0, hb - 0.04, -0.97, 0.01); }
  else { const r = mesh(cyl(w / 2, w / 2, 0.08, 24, ), m, 0, frameH + 0.1, -0.98, g); r.rotation.x = Math.PI / 2; r.scale.set(1, 1, 1); }
}
export function flowers(g, t, w, d, y, n) {
  const stem = M("#3c7a3a", { rough: 0.9, name: "Stem" });
  for (let i = 0; i < n; i++) { const x = t.rr(-w / 2, w / 2), z = t.rr(-d / 2, d / 2), h = t.rr(0.1, 0.3); C(g, 0.006, 0.006, h, stem, x, y, z, 4); const c = t.pick(["#c94a3a", "#e0b04a", "#d08aa0", "#ffffff", "#7b4fa0", "#ff8a3a", "#5a7aff"]); mesh(t.chance(0.5) ? sph(0.04, 8, 6) : ico(0.045, 0), M(c, { rough: 0.8, name: "Petal" }), x, y + h, z, g); }
}
export function genTree(g, t, y0, h, leafMat) {
  const bark = M("#6b4a2e", { map: texture("bark", 1, "#6b4a2e"), rough: 0.95, name: "Bark" });
  C(g, h * 0.035, h * 0.06, h * 0.6, bark, 0, y0, 0, 8);
  const k = t.ri(0, 2);
  if (k === 0) for (let i = 0; i < t.ri(3, 5); i++) mesh(ico(h * t.rr(0.22, 0.34), 1), leafMat, t.rr(-0.15, 0.15) * h, y0 + h * t.rr(0.6, 0.95), t.rr(-0.15, 0.15) * h, g);
  else if (k === 1) for (let i = 0; i < 3; i++) mesh(cone(h * (0.38 - i * 0.09), h * 0.4, 10), leafMat, 0, y0 + h * (0.5 + i * 0.22), 0, g);
  else mesh(sph(h * 0.38, 14, 10), leafMat, 0, y0 + h * 0.8, 0, g).scale.set(1, t.rr(0.8, 1.3), 1);
}
export function buildFence(len, t, kind) {
  const g = new T.Group(); g.name = "Fence";
  const col = t.pick(["#f2eee6", "#9a6a3a", "#5a4632", "#2b2b2b", "#7a8a6a"]), m = M(col, { rough: 0.8, name: "Fence" });
  kind = kind || t.pick(["picket", "rail", "hedge"]);
  if (kind === "hedge") { mesh(rbox(len, 0.8, 0.5, 0.15), TM("leaves", 7, "#3c7a3a", null, { name: "Hedge" }), 0, 0.4, 0, g); return g; }
  for (let x = -len / 2; x <= len / 2 + 0.001; x += kind === "picket" ? 0.18 : 1) { const p = B(g, kind === "picket" ? 0.08 : 0.1, kind === "picket" ? 0.75 : 0.9, 0.04, m, x, 0, 0, 0.01); }
  for (const y of kind === "picket" ? [0.2, 0.55] : [0.3, 0.6, 0.85]) B(g, len, 0.05, 0.03, m, 0, y, -0.03, 0.005);
  return g;
}
const genCache = new Map();
export function buildGen(type) {
  const p = parseType(type); if (!p) return null;
  const key = p.cat + ":" + p.seed;
  if (!genCache.has(key)) {
    const g = new T.Group(); const info = genInfo(type); g.name = info.label.replace(/\W+/g, "_");
    const t = tools(rng(p.seed === 0 ? hashStr("legacy" + p.cat) : p.seed ^ hashStr(p.cat)));
    const P = palette(t);
    try { (GEN[p.cat] || GEN.plant)(g, t, P); } catch (e) { console.warn("gen failed", type, e); }
    if (genCache.size > 400) genCache.delete(genCache.keys().next().value);
    genCache.set(key, g);
  }
  const out = genCache.get(key).clone(true);
  out.userData.kind = "furniture"; out.userData.type = type;
  return out;
}

// ---------------- sims ----------------
export const SKINS = ["#fbe3cf", "#f6d3b3", "#eec19a", "#e8b48f", "#d6a07a", "#c98c62", "#b07850", "#a0673f", "#8a5634", "#7a4a2a", "#5e3820", "#4e2f1c", "#3a2214"];
export const HAIR_COLORS = ["#1b1410", "#2e1f16", "#4a2e1a", "#6b4426", "#8a5a2b", "#b07a3a", "#d8b468", "#efd9a0", "#b33a2a", "#e07a3a", "#cfcfcf", "#f5f5f0", "#3a5fcd", "#c94aa0", "#4ac0a0", "#7b4fa0"];
export const HAIR_STYLES = ["short", "long", "bun", "bald", "buzz", "bob", "ponytail", "pigtails", "afro", "mohawk", "spiky", "curly", "sidepart", "braids", "topknot"];
export const OUTFITS = ["tee", "hoodie", "dress", "suit", "tank", "sweater", "overalls", "robe"];
export const BOTTOMS = ["pants", "shorts", "skirt"];
export const ACCESSORIES = ["glasses", "sunglasses", "hat", "beanie", "cap", "earrings", "necklace", "scarf", "backpack", "beard", "mustache", "headphones", "bowtie", "crown", "gloves"];
export const BODY_TYPES = { slim: [0.85, 1.0], average: [1, 1], athletic: [1.1, 1.02], round: [1.3, 0.98], tall: [0.95, 1.12], petite: [0.9, 0.88] };
export const EYE_COLORS = ["#3a2a1a", "#5a3a1a", "#2a5a8a", "#3a7a4a", "#6a6a6a", "#1a1a1a", "#7a5a2a"];
export const BROWS = ["flat", "arched", "angry", "worried", "thick"];
export const MOUTHS = ["smile", "grin", "flat", "o", "smirk"];
const NAMES = ["Ava", "Bea", "Cal", "Dex", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jun", "Kai", "Lux", "Max", "Nia", "Oz", "Pip", "Quin", "Rae", "Sol", "Tess", "Uma", "Vic", "Wren", "Xia", "Yuri", "Zed", "Mona", "Remy", "Lola", "Ezra", "Iris", "Otto", "Nova", "Theo", "Juno", "Milo", "Rosa", "Sage", "Finn", "Ada"];
export function randomSim(seed, keep = {}) {
  const t = tools(rng(seed >>> 0 || 1));
  const bt = t.pick(Object.keys(BODY_TYPES));
  const top = t.pick(FABRICS), bottom = t.pick(["#2b2724", "#3b3f6b", "#5a4632", "#46566b", "#d7c3a1", "#3c4a3e", "#8b3a3a", "#e8e0d2", t.pick(FABRICS)]);
  const acc = []; const nAcc = t.ri(0, 3); for (let i = 0; i < nAcc; i++) { const a = t.pick(ACCESSORIES); if (!acc.includes(a)) acc.push(a); }
  return Object.assign({
    name: t.pick(NAMES), skin: t.pick(SKINS), hair: t.pick(HAIR_COLORS), hairStyle: t.pick(HAIR_STYLES),
    top, bottom, outfit: t.pick(OUTFITS), bottomStyle: t.pick(BOTTOMS), pattern: t.chance(0.5) ? "solid" : t.pick(PATTERNS), pat2: t.pick(FABRICS),
    shoes: t.pick(["#1d1a18", "#f2eee6", "#6b3a2f", "#c94a3a", "#3a6ea5", "#c9a227"]),
    eyes: t.pick(EYE_COLORS), brows: t.pick(BROWS), mouth: t.pick(MOUTHS), acc, accColor: t.pick(LACQUER),
    bodyType: bt, build: BODY_TYPES[bt][0] * t.rr(0.95, 1.05), height: BODY_TYPES[bt][1] * t.rr(0.94, 1.06),
  }, keep);
}
function hairMeshes(head, st, hm, t) {
  const y = 0.12;
  const capGeo = (frac) => g("hc" + frac, () => new T.SphereGeometry(0.168, 22, 14, 0, Math.PI * 2, 0, Math.PI * frac));
  if (st === "bald") return;
  if (st === "buzz") { mesh(capGeo(0.5), hm, 0, y, -0.005, head).scale.set(0.98, 0.95, 0.98); return; }
  if (st === "afro") { mesh(sph(0.25, 18, 14), hm, 0, y + 0.06, -0.03, head).scale.set(1, 0.95, 0.95); return; }
  mesh(capGeo(0.56), hm, 0, y + 0.005, -0.01, head);
  if (st === "long" || st === "braids") { mesh(rbox(0.32, 0.36, 0.1, 0.05), hm, 0, y - 0.12, -0.11, head); if (st === "braids") for (const s of [-1, 1]) for (let i = 0; i < 4; i++) mesh(sph(0.035, 8, 6), hm, s * 0.15, y - 0.06 - i * 0.07, 0.02, head); }
  if (st === "bob") mesh(rbox(0.36, 0.2, 0.32, 0.09), hm, 0, y - 0.02, -0.03, head);
  if (st === "bun") mesh(sph(0.075, 12, 10), hm, 0, y + 0.15, -0.1, head);
  if (st === "topknot") mesh(sph(0.07, 12, 10), hm, 0, y + 0.19, -0.02, head);
  if (st === "ponytail") { mesh(sph(0.04, 8, 6), hm, 0, y + 0.05, -0.17, head); mesh(cap(0.045, 0.2, 8), hm, 0, y - 0.1, -0.2, head).rotation.x = 0.3; }
  if (st === "pigtails") for (const s of [-1, 1]) mesh(cap(0.045, 0.16, 8), hm, s * 0.17, y - 0.04, -0.06, head).rotation.z = s * 0.4;
  if (st === "mohawk") for (let i = 0; i < 6; i++) mesh(cone(0.03, 0.1, 6), hm, 0, y + 0.16 - Math.abs(i - 2.5) * 0.015, 0.1 - i * 0.05, head);
  if (st === "spiky") for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28, c = mesh(cone(0.035, 0.1, 6), hm, Math.cos(a) * 0.09, y + 0.14, Math.sin(a) * 0.09 - 0.02, head); c.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); }
  if (st === "curly") for (let i = 0; i < 14; i++) { const a = i / 14 * 6.28; mesh(sph(0.05, 8, 6), hm, Math.cos(a) * 0.15, y + 0.06 + (i % 2) * 0.05, Math.sin(a) * 0.15 - 0.02, head); }
  if (st === "sidepart") mesh(rbox(0.2, 0.06, 0.12, 0.03), hm, 0.05, y + 0.14, 0.08, head).rotation.z = -0.25;
  if (st === "short") mesh(rbox(0.3, 0.06, 0.08, 0.03), hm, 0, y + 0.1, 0.11, head).rotation.x = 0.4;
}
export function buildSim(sim) {
  const root = new T.Group(); root.name = "Sim_" + String(sim.name || "Sim").replace(/\W+/g, "_");
  const skin = M(sim.skin || "#e8b48f", { rough: 0.6, name: "Skin" });
  const pat = sim.pattern && sim.pattern !== "solid" ? texture("pat_" + sim.pattern, 7, sim.top, sim.pat2 || shade(sim.top, 0.5)) : null;
  const top = M(sim.top || "#3a6ea5", { rough: 0.9, map: pat || texture("fabric", 3, sim.top || "#3a6ea5"), name: "Outfit_Top" });
  const bottom = M(sim.bottom || "#2b2724", { rough: 0.9, map: texture("fabric", 4, sim.bottom || "#2b2724"), name: "Outfit_Bottom" });
  const hm = M(sim.hair || "#4a2e1a", { rough: 0.7, name: "Hair" }), shoe = M(sim.shoes || "#1d1a18", { rough: 0.5, name: "Shoes" });
  const eyeW = M("#ffffff", { rough: 0.2, name: "Eye_White" }), iris = M(sim.eyes || "#3a2a1a", { rough: 0.2, name: "Eyes" }), dark = M("#2a1a14", { rough: 0.6, name: "Brow" });
  const acc = M(sim.accColor || "#c9a227", { rough: 0.5, name: "Accessory" });
  const outfit = sim.outfit || "tee", bstyle = sim.bottomStyle || (sim.outfit === "dress" ? "skirt" : "pants");
  const J = (name, x, y, z, p) => { const gg = new T.Group(); gg.name = name; gg.position.set(x, y, z); p.add(gg); return gg; };
  const hips = J("Joint_Hips", 0, 0.92, 0, root);
  mesh(sph(0.17, 16, 12), outfit === "dress" || outfit === "robe" ? top : bottom, 0, 0.02, 0, hips, "Pelvis").scale.set(1.05, 0.7, 0.75);
  const spine = J("Joint_Spine", 0, 0.06, 0, hips);
  mesh(cap(0.16, 0.26, 14), top, 0, 0.25, 0, spine, "Torso").scale.set(1.12, 1, 0.75);
  if (outfit === "hoodie") { mesh(torus(0.11, 0.045), top, 0, 0.47, -0.06, spine).rotation.x = 1.3; mesh(rbox(0.18, 0.1, 0.03, 0.01), M(shade(sim.top, -0.2)), 0, 0.12, 0.12, spine); }
  if (outfit === "suit") { mesh(rbox(0.08, 0.3, 0.01, 0.004), M("#f5f2ea"), 0, 0.3, 0.125, spine); mesh(rbox(0.035, 0.22, 0.012, 0.004), acc, 0, 0.29, 0.132, spine); }
  if (outfit === "overalls") { mesh(rbox(0.22, 0.2, 0.02, 0.01), bottom, 0, 0.18, 0.12, spine); for (const s of [-1, 1]) mesh(rbox(0.04, 0.26, 0.02, 0.005), bottom, s * 0.08, 0.33, 0.115, spine); }
  if (outfit === "sweater") mesh(torus(0.085, 0.03), top, 0, 0.48, 0, spine).rotation.x = Math.PI / 2;
  if (outfit === "dress" || outfit === "robe" || bstyle === "skirt") { const L = outfit === "robe" ? 0.75 : outfit === "dress" ? 0.48 : 0.34; mesh(lathe([[0.15, 0], [0.19, -L * 0.5], [0.24, -L], [0, -L]], 18), outfit === "dress" || outfit === "robe" ? top : bottom, 0, 0.02, 0, hips, "Skirt"); }
  const neck = J("Joint_Neck", 0, 0.5, 0, spine);
  mesh(cyl(0.05, 0.06, 0.1, 10), skin, 0, 0.03, 0, neck, "Neck");
  const head = J("Joint_Head", 0, 0.08, 0, neck);
  mesh(sph(0.16, 24, 18), skin, 0, 0.12, 0, head, "Head").scale.set(1, 1.05, 0.98);
  mesh(sph(0.03, 8, 6), skin, 0, 0.1, 0.16, head, "Nose");
  for (const s of [-1, 1]) {
    mesh(sph(0.035, 8, 6), skin, s * 0.158, 0.11, 0, head).scale.set(0.5, 1, 0.8);
    mesh(sph(0.03, 12, 10), eyeW, s * 0.055, 0.15, 0.135, head).scale.set(1, 1.1, 0.6);
    mesh(sph(0.017, 10, 8), iris, s * 0.055, 0.15, 0.152, head, s < 0 ? "EyeL" : "EyeR");
    const br = mesh(rbox(0.06, sim.brows === "thick" ? 0.022 : 0.012, 0.01, 0.004), sim.brows === "thick" ? hm : dark, s * 0.058, 0.2, 0.148, head);
    br.rotation.z = { flat: 0, arched: s * -0.25, angry: s * 0.35, worried: s * -0.4, thick: 0 }[sim.brows || "flat"] || 0;
    mesh(sph(0.025, 8, 6), M(shade(sim.skin || "#e8b48f", -0.06), { opacity: 0.5, name: "Blush" }), s * 0.1, 0.08, 0.13, head).scale.set(1, 0.6, 0.3);
  }
  const mo = sim.mouth || "smile", mm = M("#7a2a2a", { rough: 0.5, name: "Mouth" });
  if (mo === "o") mesh(torus(0.018, 0.007), mm, 0, 0.045, 0.152, head);
  else if (mo === "flat") mesh(rbox(0.06, 0.01, 0.01, 0.004), mm, 0, 0.045, 0.152, head);
  else { const m = mesh(torus(mo === "grin" ? 0.04 : 0.032, 0.008, Math.PI), mm, mo === "smirk" ? 0.015 : 0, 0.065, 0.148, head); m.rotation.z = Math.PI + (mo === "smirk" ? 0.3 : 0); if (mo === "grin") mesh(rbox(0.06, 0.015, 0.005, 0.003), M("#fff"), 0, 0.04, 0.152, head); }
  hairMeshes(head, sim.hairStyle || "short", hm);
  const A = new Set(sim.acc || []);
  if (A.has("glasses") || A.has("sunglasses")) { const fm = M(A.has("sunglasses") ? "#111" : sim.accColor || "#2b2b2b", { metal: 0.3, rough: 0.3, name: "Glasses" }); for (const s of [-1, 1]) { const r = mesh(torus(0.035, 0.007), fm, s * 0.058, 0.15, 0.165, head); if (A.has("sunglasses")) mesh(cyl(0.035, 0.035, 0.005, 14), M("#111", { rough: 0.1 }), s * 0.058, 0.15, 0.165, head).rotation.x = Math.PI / 2; } mesh(rbox(0.04, 0.008, 0.008, 0.002), fm, 0, 0.155, 0.168, head); }
  if (A.has("hat")) { mesh(cyl(0.26, 0.26, 0.015, 24), acc, 0, 0.26, 0, head); mesh(cyl(0.14, 0.15, 0.14, 20), acc, 0, 0.33, 0, head); }
  if (A.has("beanie")) mesh(g("beanie", () => new T.SphereGeometry(0.178, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5)), M(sim.accColor || "#c94a3a", { map: texture("pat_stripes", 2, sim.accColor || "#c94a3a", "#f5f2ea"), name: "Beanie" }), 0, 0.15, -0.005, head);
  if (A.has("cap")) { mesh(g("capc", () => new T.SphereGeometry(0.172, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.45)), acc, 0, 0.15, 0, head); mesh(rbox(0.2, 0.012, 0.14, 0.006), acc, 0, 0.21, 0.16, head); }
  if (A.has("crown")) { mesh(cyl(0.12, 0.12, 0.06, 12, ), M("#d4af37", { metal: 0.9, rough: 0.25, name: "Crown" }), 0, 0.31, 0, head); for (let i = 0; i < 6; i++) { const a = i * 1.047; mesh(cone(0.02, 0.05, 4), M("#d4af37", { metal: 0.9, rough: 0.25 }), Math.cos(a) * 0.11, 0.36, Math.sin(a) * 0.11, head); } }
  if (A.has("headphones")) { mesh(torus(0.175, 0.012, Math.PI), acc, 0, 0.13, 0, head); for (const s of [-1, 1]) mesh(cyl(0.05, 0.05, 0.04, 14), acc, s * 0.17, 0.12, 0, head).rotation.z = Math.PI / 2; }
  if (A.has("earrings")) for (const s of [-1, 1]) mesh(sph(0.012, 6, 5), M("#d4af37", { metal: 0.9, rough: 0.2 }), s * 0.16, 0.06, 0.01, head);
  if (A.has("beard")) mesh(sph(0.12, 14, 10), hm, 0, 0.03, 0.07, head).scale.set(1.1, 0.8, 0.8);
  if (A.has("mustache")) mesh(rbox(0.08, 0.02, 0.02, 0.008), hm, 0, 0.075, 0.158, head);
  if (A.has("necklace")) mesh(torus(0.08, 0.008), M("#d4af37", { metal: 0.9, rough: 0.2, name: "Necklace" }), 0, 0.46, 0.04, spine).rotation.x = 1.2;
  if (A.has("scarf")) mesh(torus(0.085, 0.035), M(sim.accColor || "#c94a3a", { map: texture("pat_plaid", 3, sim.accColor || "#c94a3a", "#f5f2ea"), name: "Scarf" }), 0, 0.5, 0, spine).rotation.x = Math.PI / 2;
  if (A.has("backpack")) mesh(rbox(0.26, 0.32, 0.12, 0.05), acc, 0, 0.25, -0.17, spine);
  if (A.has("bowtie")) for (const s of [-1, 1]) mesh(cone(0.03, 0.05, 4), acc, s * 0.025, 0.46, 0.12, spine).rotation.z = s * Math.PI / 2;
  const sleeve = outfit === "tank" || outfit === "dress" ? skin : top, shortSleeve = outfit === "tee" || outfit === "overalls";
  for (const s of [-1, 1]) {
    const L = s < 0 ? "L" : "R";
    const sh = J("Joint_Shoulder" + L, s * 0.22, 0.42, 0, spine);
    mesh(sph(0.055, 10, 8), sleeve === skin ? skin : top, 0, 0, 0, sh);
    mesh(cap(0.045, 0.2, 10), shortSleeve ? top : sleeve, 0, -0.14, 0, sh, "Arm" + L);
    mesh(cap(0.04, 0.18, 10), shortSleeve ? skin : sleeve, 0, -0.36, 0, sh, "Forearm" + L);
    mesh(sph(0.048, 10, 8), skin, 0, -0.52, 0, sh, "Hand" + L).scale.set(0.8, 1, 1);
    const hp = J("Joint_Hip" + L, s * 0.09, -0.04, 0, hips);
    const legMat = bstyle === "shorts" || bstyle === "skirt" || outfit === "dress" ? skin : bottom;
    mesh(cap(0.065, 0.3, 10), bstyle === "shorts" ? bottom : legMat, 0, -0.2, 0, hp, "Leg" + L);
    mesh(cap(0.055, 0.32, 10), legMat, 0, -0.56, 0, hp, "Shin" + L);
    mesh(rbox(0.11, 0.08, 0.24, 0.035), shoe, 0, -0.84, 0.04, hp, "Foot" + L);
  }
  applyBody(root, sim);
  root.userData.kind = "sim"; root.userData.simId = sim.id;
  root.userData.sim = { name: sim.name, skin: sim.skin, hair: sim.hair, hairStyle: sim.hairStyle, top: sim.top, bottom: sim.bottom, outfit, height: sim.height, build: sim.build };
  return root;
}
export function applyBody(root, sim) {
  root.scale.setScalar(sim.height || 1);
  const b = sim.build || 1;
  const sp = root.getObjectByName("Joint_Spine"); if (sp) sp.scale.set(b, 1, Math.sqrt(b));
  const pel = root.getObjectByName("Pelvis"); if (pel) pel.scale.set(1.05 * b, 0.7, 0.75 * Math.sqrt(b));
  for (const L of ["L", "R"]) { const hp = root.getObjectByName("Joint_Hip" + L); if (hp) { hp.position.x = (L === "L" ? -1 : 1) * 0.09 * b; hp.scale.set(Math.sqrt(b), 1, Math.sqrt(b)); } }
}

// ---------------- surfaces ----------------
// floor value: "#hex" (legacy) or "kind:seed:#hex"; wall pattern p: "kind:seed"
export function parseSurface(v, def) {
  const m = /^([a-z]{2,12}):(\d{1,9}):(#[0-9a-fA-F]{3,6})$/.exec(String(v || ""));
  if (m) return { kind: m[1], seed: Number(m[2]), color: m[3] };
  return { kind: def, seed: 1, color: /^#[0-9a-fA-F]{3,6}$/.test(v) ? v : "#b89970" };
}
export function floorMat(v) { const s = parseSurface(v, "wood"); return TM(FLOOR_KINDS.includes(s.kind) ? s.kind : "wood", s.seed, s.color, null, { rough: s.kind === "marble" || s.kind === "tile" ? 0.35 : 0.8, name: "Floor_" + s.kind }); }
export function wallMat(color, p) {
  const m = /^([a-z]{2,12}):(\d{1,9})$/.exec(String(p || "")); const kind = m ? m[1] : "paint", seed = m ? Number(m[2]) : 1;
  if (kind === "paint" || !WALL_KINDS.includes(kind)) return TM("plaster", 1, color || "#e8e0d2", null, { rough: 0.9, name: "Wall_Paint" });
  return TM(kind === "wood" ? "panel" : kind, seed, color || "#e8e0d2", null, { rough: 0.85, name: "Wall_" + kind });
}
