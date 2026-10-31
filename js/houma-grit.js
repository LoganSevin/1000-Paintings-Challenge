// Houma v7 full-coverage grass + grit/life: lawn shader, blade carpet, worn asphalt, weathered walls/roofs, ditch mud/puddles, leaf litter, dust motes, birds (no assets).
import * as T from "three";

export const NOISE = `
float gh1(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float gn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(gh1(i),gh1(i+vec2(1,0)),f.x), mix(gh1(i+vec2(0,1)),gh1(i+vec2(1,1)),f.x), f.y); }
float gfbm(vec2 p){ return gn(p)*0.5 + gn(p*2.03+7.1)*0.3 + gn(p*4.1+3.3)*0.2; }
float gvor(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=8.0, d2=8.0; for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y); vec2 o=vec2(gh1(i+g), gh1(i+g+17.0)); float d=length(g+o-f); if(d<d1){d2=d1;d1=d;} else if(d<d2) d2=d; } return d2-d1; }
`;
const VWP = (vs) => vs.replace("#include <common>", "#include <common>\nvarying vec3 vGWP;").replace("#include <project_vertex>", `#include <project_vertex>
{ vec4 gq = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
gq = instanceMatrix * gq;
#endif
vGWP = (modelMatrix * gq).xyz; }`);
const FHEAD = (fs) => fs.replace("#include <common>", "#include <common>\nvarying vec3 vGWP;\n" + NOISE);
const DONE = new WeakSet(), HOOKED = [];
export const hooked = () => HOOKED.join(",");
function hook(mat, key, fn) {
  if (!mat || DONE.has(mat)) return; DONE.add(mat); HOOKED.push(mat.name + ":" + key); const prev = mat.onBeforeCompile, pk = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => "";
  mat.onBeforeCompile = (sh, r) => { if (prev) prev.call(mat, sh, r); sh.vertexShader = VWP(sh.vertexShader); sh.fragmentShader = FHEAD(sh.fragmentShader); fn(sh); };
  mat.customProgramCacheKey = () => pk() + "|grit-" + key; mat.needsUpdate = true;
}
// full-coverage lawn: blade-level noise, clumps, colour variation, dry/brown patches, worn paths and mowing stripes.
// aerial = true: only where the aerial photo is green (keeps driveways, roofs, water, bare dirt from the photo).
export function grassify(mat, aerial) {
  hook(mat, aerial ? "lawnA" : "lawn", (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
{ vec3 c0 = diffuseColor.rgb; vec2 q = vGWP.xz; float dist = length(cameraPosition - vGWP);
  float gm = ${aerial ? "smoothstep(0.004, 0.022, c0.g - c0.b) * smoothstep(-0.012, 0.008, c0.g - c0.r * 0.92) * smoothstep(0.01, 0.035, c0.g) * (1.0 - smoothstep(0.2, 0.35, c0.g))" : "1.0"};
  float n1 = gfbm(q * 0.045), n2 = gfbm(q * 0.35), n3 = gn(q * 2.7), n4 = gn(q * 17.0 + n3), n5 = gn(vec2(q.x * 61.0, q.y * 47.0));
  float f4 = 1.0 - smoothstep(10.0, 45.0, dist), f5 = 1.0 - smoothstep(3.0, 14.0, dist);
  vec3 gc = mix(vec3(0.075, 0.15, 0.03), vec3(0.15, 0.24, 0.05), n2);
  gc = mix(gc, vec3(0.3, 0.26, 0.12), smoothstep(0.6, 0.8, n1) * 0.75);                 // dry / brown patches
  gc = mix(gc, vec3(0.2, 0.15, 0.09), smoothstep(0.05, 0.0, abs(gfbm(q * 0.06 + 31.0) - 0.5)) * 0.8 * step(0.6, gh1(floor(q / 40.0)))); // worn paths
  gc *= 0.78 + 0.44 * n3;                                                                // clumps
  float bl = mix(0.5, n4, f4); bl = mix(bl, n5, f5 * 0.7); gc *= 0.5 + 1.0 * bl;       // blades
  vec2 cell = floor(q / 28.0); float hs = gh1(cell + 3.7);
  if (hs > 0.5) { float a = gh1(cell) > 0.5 ? q.x : q.y; gc *= 1.0 + 0.16 * (step(0.5, fract(a / 1.4)) - 0.5) * (1.0 - smoothstep(60.0, 220.0, dist)); } // mowing stripes
  float tone = ${aerial ? "clamp(c0.g / 0.11, 0.55, 1.5)" : "1.0"};
  diffuseColor.rgb = mix(c0, gc * tone, gm * ${aerial ? "0.88" : "0.8"}); }`);
  });
}
// asphalt: cracks, oil stains, patches, skid/tyre marks, aggregate speckle
export function asphaltGrit(mat) {
  hook(mat, "asph", (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
float gOil = 0.0;
{ vec2 q = vGWP.xz; float dist = length(cameraPosition - vGWP); float k = 1.0;
  float cr = 1.0 - smoothstep(0.0, 0.035, gvor(q * 0.32)); cr *= smoothstep(0.45, 0.65, gfbm(q * 0.07)); k -= cr * 0.45 * (1.0 - smoothstep(30.0, 90.0, dist));
  float cr2 = 1.0 - smoothstep(0.0, 0.05, gvor(q * 1.3)); k -= cr2 * 0.2 * smoothstep(0.6, 0.8, gfbm(q * 0.11 + 9.0)) * (1.0 - smoothstep(15.0, 45.0, dist));
  gOil = smoothstep(0.68, 0.82, gfbm(q * 0.55 + 4.0)) * smoothstep(0.5, 0.7, gn(q * 0.08)); k -= gOil * 0.35;
  vec2 pc = floor(q / 7.0), pf = fract(q / 7.0); float ph = gh1(pc + 1.3);
  if (ph > 0.86) { vec2 e = step(vec2(0.15 + 0.2 * gh1(pc)), pf) * step(pf, vec2(0.75 + 0.2 * gh1(pc + 5.0))); k *= mix(1.0, ph > 0.93 ? 0.72 : 1.18, e.x * e.y); } // patched / fresh-sealed squares
  vec2 sc = floor(q / 24.0); float sh = gh1(sc + 8.1);
  if (sh > 0.78) { float an = gh1(sc + 2.0) * 3.1416; vec2 d = vec2(cos(an), sin(an)), r = q - (sc + 0.5) * 24.0; float along = dot(r, d), acr = dot(r, vec2(-d.y, d.x));
    float tm = (smoothstep(0.16, 0.0, abs(abs(acr) - 0.78))) * smoothstep(9.0, 2.0, abs(along)) * (0.6 + 0.4 * gn(vec2(along * 2.0, 0.0))); k -= tm * 0.4; } // skid marks
  k *= 0.8 + 0.4 * gfbm(q * 0.9);
  k *= mix(1.0, 0.7 + 0.6 * gh1(floor(q * 40.0)), 1.0 - smoothstep(2.0, 10.0, dist)); // aggregate
  diffuseColor.rgb *= clamp(k, 0.25, 1.3); }`).replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.35, gOil);");
  });
}
// walls/roofs: rain streaks, base grime/splashback, blotchy dirt; metal roofs get rust
export function weather(mat, kind) {
  hook(mat, "w" + kind, (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
float gRust = 0.0;
{ vec3 p = vGWP; float h = gn(vec2((p.x + p.z) * 2.2, p.y * 0.18)) * 0.6 + gn(vec2((p.x - p.z) * 7.0, p.y * 0.5)) * 0.4;
  float k = 1.0 - smoothstep(0.55, 0.9, h) * ${kind === "roof" || kind === "metal" ? 0.18 : 0.26};
  k -= (1.0 - smoothstep(0.05, 0.8, p.y)) * 0.28;                       // splashback / grime at the base
  k -= smoothstep(0.55, 0.85, gfbm(vec2(p.x + p.y, p.z - p.y) * 0.6)) * 0.15;
  ${kind === "metal" ? "gRust = smoothstep(0.58, 0.8, gfbm(vec2(p.x + p.y * 0.3, p.z) * 0.9) * 0.7 + gn(p.xz * 9.0 + p.y) * 0.3); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.12, 0.04) * (0.7 + 0.6 * gn(p.xz * 23.0)), gRust * 0.8);" : ""}
  diffuseColor.rgb *= clamp(k, 0.4, 1.0); }`).replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.95, gRust);").replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - gRust;");
  });
}
// wet mud / puddles along ditches and banks
export function mudGrit(mat) {
  hook(mat, "mud", (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
float gWet = 0.0;
{ vec2 q = vGWP.xz; float m = gfbm(q * 0.25); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.09, 0.05), smoothstep(0.45, 0.7, m) * 0.7);
  gWet = smoothstep(0.66, 0.72, gfbm(q * 0.18 + 5.0)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.05, 0.04), gWet * 0.6); diffuseColor.rgb *= 0.8 + 0.4 * gn(q * 6.0); }`).replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.06, gWet);");
  });
}
export function gritPass(scene) {
  let n = 0; scene.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) { if (!m || DONE.has(m) || !m.name) continue; const nm = m.name;
    if (nm === "H_Aerial") grassify(m, true); else if (nm === "H_Ground" || nm === "H_Lawn" || nm === "H_Parks") grassify(m, false);
    else if (nm === "H_Asphalt" || nm === "H_Lot") asphaltGrit(m);
    else if (/Roof_Tin|Wall_Metal|H_Metal|Rollup/.test(nm)) weather(m, "metal"); else if (nm.startsWith("H_Roof")) weather(m, "roof"); else if (nm.startsWith("H_Wall")) weather(m, "wall");
    else if (/Bank|Mud|Marsh|Ditch/i.test(nm) && !nm.startsWith("Car_")) mudGrit(m); else continue; n++; } });
  return n;
}
// ---------------------------------------------------------------- dense grass carpet patch (one instance = PATCH x PATCH m)
export const PATCH = 1.0;
export function carpetGeometry(blades) {
  const P = [], N = [], C = []; let s = 977;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let b = 0; b < blades; b++) {
    const x = (r() - 0.5) * PATCH, z = (r() - 0.5) * PATCH, h = 0.07 + r() * r() * 0.16, w = 0.012 + r() * 0.018, a = r() * 6.283, lx = (r() - 0.5) * 0.09, lz = (r() - 0.5) * 0.09;
    const cx = Math.cos(a) * w, cz = Math.sin(a) * w, dry = r() < 0.12 ? 1 : 0, tone = 0.7 + r() * 0.5;
    P.push(x - cx, 0, z - cz, x + cx, 0, z + cz, x + lx, h, z + lz);
    for (let i = 0; i < 3; i++) N.push(lx * 2, 1, lz * 2);
    const base = [0.05 * tone, 0.1 * tone, 0.02 * tone], tip = dry ? [0.42 * tone, 0.36 * tone, 0.16 * tone] : [0.2 * tone, 0.36 * tone, 0.07 * tone];
    C.push(...base, ...base, ...tip);
  }
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new T.Float32BufferAttribute(N, 3)); g.setAttribute("color", new T.Float32BufferAttribute(C, 3)); g.computeBoundingSphere(); return g;
}

export function litterGeometry(n) { // fallen leaves / needles / twigs
  const P = [], N = [], C = []; let s = 4211; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const cols = [[0.32, 0.18, 0.07], [0.42, 0.26, 0.09], [0.22, 0.14, 0.06], [0.5, 0.34, 0.12], [0.26, 0.22, 0.1]];
  for (let i = 0; i < n; i++) { const x = (r() - 0.5) * PATCH, z = (r() - 0.5) * PATCH, sz = 0.025 + r() * 0.04, a = r() * 6.283, c = cols[Math.floor(r() * cols.length)], y = 0.004 + r() * 0.01;
    const ca = Math.cos(a) * sz, sa = Math.sin(a) * sz; P.push(x - ca, y, z - sa, x + sa * 0.5, y, z - ca * 0.5, x + ca, y + 0.004, z + sa, x - ca, y, z - sa, x + ca, y + 0.004, z + sa, x - sa * 0.5, y, z + ca * 0.5);
    for (let k = 0; k < 6; k++) { N.push(0, 1, 0); C.push(...c); } }
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new T.Float32BufferAttribute(N, 3)); g.setAttribute("color", new T.Float32BufferAttribute(C, 3)); g.computeBoundingSphere(); return g;
}
// ---------------------------------------------------------------- particles: dust motes, birds
export function makeMotes(scene, n = 900) {
  const pos = new Float32Array(n * 3), seed = new Float32Array(n); for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 40; pos[i * 3 + 1] = Math.random() * 8; pos[i * 3 + 2] = (Math.random() - 0.5) * 40; seed[i] = Math.random(); }
  const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.BufferAttribute(pos, 3)); geo.setAttribute("seed", new T.BufferAttribute(seed, 1));
  const U = { uT: { value: 0 }, uC: { value: new T.Vector3() }, uI: { value: 1 }, uScale: { value: 600 } };
  const mat = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, uniforms: U,
    vertexShader: `attribute float seed; uniform float uT, uScale; uniform vec3 uC; varying float vA;
void main(){ vec3 p = position; p.x += sin(uT * (0.13 + seed * 0.2) + seed * 40.0) * 1.5 + uT * 0.35; p.y += sin(uT * (0.21 + seed * 0.3) + seed * 13.0) * 0.6; p.z += cos(uT * (0.17 + seed * 0.2) + seed * 27.0) * 1.5;
  p.xz = mod(p.xz - uC.xz + 20.0, 40.0) - 20.0 + uC.xz; p.y = mod(p.y, 8.0) + uC.y * 0.0 + 0.2;
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; float d = -mv.z; vA = smoothstep(1.0, 3.0, d) * (1.0 - smoothstep(14.0, 22.0, d)) * (0.5 + 0.5 * sin(uT * 2.0 + seed * 60.0));
  gl_PointSize = (0.025 + seed * 0.035) * uScale / max(0.5, d); }`,
    fragmentShader: "uniform float uI; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; gl_FragColor = vec4(vec3(1.0, 0.92, 0.7) * (1.0 - r * 2.0) * vA * uI * 0.55, 1.0); }" });
  const pts = new T.Points(geo, mat); pts.frustumCulled = false; pts.name = "DustMotes"; pts.renderOrder = 8; scene.add(pts);
  return { pts, U };
}
export function makeBirds(scene, flocks = 4, per = 9) {
  const g = new T.BufferGeometry(), P = [], A = []; // each bird: two wing triangles; attribute a = (flock, index, wing side)
  for (let f = 0; f < flocks; f++) for (let i = 0; i < per; i++) for (const s of [-1, 1]) { P.push(0, 0, 0.12, 0, 0, -0.12, s * 0.55, 0, -0.05); for (let k = 0; k < 3; k++) A.push(f, i, k === 2 ? s : 0); }
  g.setAttribute("position", new T.Float32BufferAttribute(P, 3)); g.setAttribute("a", new T.Float32BufferAttribute(A, 3));
  const U = { uT: { value: 0 }, uC: { value: new T.Vector3() } };
  const mat = new T.ShaderMaterial({ side: T.DoubleSide, uniforms: U,
    vertexShader: `attribute vec3 a; uniform float uT; uniform vec3 uC;
void main(){ float f = a.x, i = a.y; float ph = uT * (0.07 + f * 0.013) + f * 1.7; vec3 c = uC + vec3(cos(ph) * (60.0 + f * 25.0), 28.0 + f * 9.0 + sin(uT * 0.3 + f) * 4.0, sin(ph * 1.3) * (70.0 + f * 20.0));
  vec3 dir = normalize(vec3(-sin(ph) * (60.0 + f * 25.0), 0.0, cos(ph * 1.3) * 1.3 * (70.0 + f * 20.0)));
  float row = floor((i + 1.0) / 2.0), side = mod(i, 2.0) * 2.0 - 1.0; vec3 rgt = normalize(cross(dir, vec3(0, 1, 0)));
  vec3 off = -dir * row * 1.6 + rgt * side * row * 1.4 + vec3(0.0, sin(i * 3.1 + uT) * 0.3, 0.0);
  vec3 p = position; p.y += abs(a.z) * sin(uT * 9.0 + i * 1.3) * 0.35 * abs(p.x) / 0.55;
  vec3 w = c + off + rgt * p.x * 1.0 + vec3(0, p.y, 0) + dir * p.z * 2.5;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
    fragmentShader: "void main(){ gl_FragColor = vec4(0.06, 0.06, 0.07, 1.0); }" });
  const m = new T.Mesh(g, mat); m.frustumCulled = false; m.name = "Birds"; scene.add(m); return { m, U };
}
