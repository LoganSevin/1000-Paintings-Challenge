// Houma v7 full-coverage grass: procedural lawn shader + dense near-camera blade carpet (no assets).
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
export function gritPass(scene) {
  let n = 0; scene.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) { if (!m || DONE.has(m) || !m.name) continue; const nm = m.name;
    if (nm === "H_Aerial") grassify(m, true); else if (nm === "H_Ground" || nm === "H_Lawn" || nm === "H_Parks") grassify(m, false); else continue; n++; } });
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
