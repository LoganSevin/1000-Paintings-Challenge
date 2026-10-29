// sims-hifi.js — render quality layer for Sims: procedural-sky image-based lighting (PMREM),
// soft shadows, post (GTAO + bloom + SMAA on High, SMAA on Med, direct on Low),
// procedural PBR detail maps (wood grain, brushed metal, stone, plaster, shingles, upholstery)
// and architectural detail for the lot (baseboards, window frames with mullions + glass, panel doors).
// Everything is generated in code; no downloaded assets.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { normalFromHeight, noise2, rng, FABRIC_NORMAL } from "./sims-body.js?v=2";

// ---------------------------------------------------------------- sky environment
let pmrem = null, envRT = null, skyScene = null, skyMat = null, lastKey = "";
function makeSky() {
  skyScene = new THREE.Scene();
  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color("#6fa8e6") }, hor: { value: new THREE.Color("#dfeaf5") }, gnd: { value: new THREE.Color("#5b5348") }, sunDir: { value: new THREE.Vector3(0.3, 0.8, 0.4) }, sunCol: { value: new THREE.Color("#fff3df") }, sunI: { value: 30 } },
    vertexShader: "varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform vec3 top, hor, gnd, sunDir, sunCol; uniform float sunI; varying vec3 vD;
      void main(){ float y = vD.y; vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.55)) : mix(hor, gnd, pow(-y, 0.35));
        float s = max(0.0, dot(normalize(vD), normalize(sunDir))); c += sunCol * (pow(s, 900.0) * sunI + pow(s, 12.0) * 0.35);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), skyMat));
  // a few soft "bounce cards" so interiors get a window-ish key in reflections
  const card = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.55, 1.45) })); card.position.set(-20, 10, 18); card.lookAt(0, 0, 0); skyScene.add(card);
}
export function updateEnvironment(renderer, scene, sunDir, skyColor, dayK) {
  if (!pmrem) { pmrem = new THREE.PMREMGenerator(renderer); makeSky(); }
  const key = [sunDir.x, sunDir.y, sunDir.z].map((v) => v.toFixed(1)).join() + "|" + skyColor.getHexString() + "|" + dayK.toFixed(1);
  if (key === lastKey) return; lastKey = key;
  skyMat.uniforms.top.value.copy(skyColor).multiplyScalar(0.85 * (0.25 + dayK));
  skyMat.uniforms.hor.value.copy(skyColor).lerp(new THREE.Color("#ffffff"), 0.45).multiplyScalar(0.3 + dayK * 0.9);
  skyMat.uniforms.gnd.value.set("#4d463c").multiplyScalar(0.25 + dayK * 0.6);
  skyMat.uniforms.sunDir.value.copy(sunDir); skyMat.uniforms.sunI.value = 4 + dayK * 30;
  skyMat.uniforms.sunCol.value.set(sunDir.y < 0.25 ? "#ffb070" : "#fff1d6");
  const rt = pmrem.fromScene(skyScene, 0.02); if (envRT) envRT.dispose(); envRT = rt;
  scene.environment = rt.texture;
}
export function setEnvIntensity(scene, k) { scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) if ("envMapIntensity" in m) m.envMapIntensity = k; }); }

// ---------------------------------------------------------------- post-processing
let composer = null, cq = "", passes = {};
export function setupPost(renderer, scene, camera, quality, w, h) {
  if (quality === "low") { if (composer) { composer.dispose(); composer = null; } cq = quality; return null; }
  if (composer && cq === quality) return composer;
  if (composer) composer.dispose();
  composer = new EffectComposer(renderer); passes = {};
  composer.addPass(new RenderPass(scene, camera));
  if (quality === "high") {
    const ao = new GTAOPass(scene, camera, w, h); ao.output = GTAOPass.OUTPUT.Default; ao.blendIntensity = 0.85;
    // keep glow sprites, light pools, stars and the moon out of the AO depth/normal pass (they are not solid surfaces)
    ao.overrideVisibility = function () { const scn = this.scene, cache = this._visibilityCache; scn.traverse((o) => { cache.set(o, o.visible); if (o.isPoints || o.isLine || o.isSprite || (o.material && o.material.blending === THREE.AdditiveBlending) || o.name === "Moon") o.visible = false; }); };
    ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1, samples: 12 }); ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    composer.addPass(ao); passes.ao = ao;
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.5, 0.92); composer.addPass(bloom); passes.bloom = bloom;
  }
  composer.addPass(new OutputPass());
  const smaa = new SMAAPass(w * renderer.getPixelRatio(), h * renderer.getPixelRatio()); composer.addPass(smaa); passes.smaa = smaa;
  cq = quality; composer.setSize(w, h); return composer;
}
export function resizePost(w, h) { if (composer) composer.setSize(w, h); }
export function render(renderer, scene, camera) { if (composer) composer.render(); else renderer.render(scene, camera); }
export function postInfo() { return { quality: cq, passes: composer ? composer.passes.map((p) => p.constructor.name) : [] }; }

// ---------------------------------------------------------------- procedural PBR detail maps
const N = {
  wood: () => normalFromHeight("wood", 256, (H, w, h) => { const n = noise2(31), m = noise2(32); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const r = Math.sin((j / 9 + n(i / 60, j / 10) * 3.5) * Math.PI) * 0.5 + m(i / 1.5, j / 40) * 0.5; H[j * w + i] = r; } }, 1.2),
  metal: () => normalFromHeight("metal", 256, (H, w, h) => { const n = noise2(41); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = n(i / 0.8, j / 60) * 0.5; }, 0.8),
  stone: () => normalFromHeight("stone", 256, (H, w, h) => { const n = noise2(51), m = noise2(52); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = n(i / 16, j / 16) * 0.8 + m(i / 3, j / 3) * 0.3; }, 1.5),
  plaster: () => normalFromHeight("plaster", 256, (H, w, h) => { const n = noise2(61), m = noise2(62); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = n(i / 7, j / 7) * 0.35 + m(i / 2, j / 2) * 0.12; }, 1.2, 2),
  shingle: () => normalFromHeight("shingle", 256, (H, w, h) => { const r = rng(71); const off = Array.from({ length: 16 }, () => r() * 32); for (let j = 0; j < h; j++) { const row = (j / 32) | 0, t = (j % 32) / 32; for (let i = 0; i < w; i++) { const c = ((i + off[row % 16]) % 40) / 40; H[j * w + i] = t * 1.2 - (c < 0.05 ? 0.8 : 0) + r() * 0.05; } } }, 2.4),
  tile: () => normalFromHeight("tile", 256, (H, w, h) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const a = Math.min(i % 64, 63 - (i % 64), j % 64, 63 - (j % 64)); H[j * w + i] = Math.min(1, a / 4); } }, 2.5),
};
const RULES = [
  [/^(Wood|Timber|Lacquer|Door|Trim|Floor_wood|Floor_Wood|Parquet|Plank)/i, "wood", 0.55], [/^(Metal|Lamp_Post|Chrome|Steel|Iron)/i, "metal", 0.35],
  [/^(Stone|Marble|Retaining_Wall|Promenade|Sidewalk|Path)/i, "stone", 0.45], [/^(Wall|Plaster)/i, "plaster", 0.35], [/^Roof/i, "shingle", 1.0],
  [/^(Shower_Tile|Tile|Porcelain|Tub)/i, "tile", 0.5], [/^(Rug|Mattress|Fabric|Upholstery|Cushion|Sofa|Bed|Curtain)/i, "knit", 0.5], [/^(Leather)/i, "leather", 0.6],
];
export function enhance(root, quality) {
  if (quality === "low") return;
  root.traverse((o) => {
    if (!o.isMesh || !o.material || o.isSkinnedMesh) return;
    for (const m of [].concat(o.material)) {
      if (!m.isMeshStandardMaterial || m.userData.hifi) continue; m.userData.hifi = true;
      const nm = m.name || o.name || ""; const r = RULES.find(([re]) => re.test(nm)); if (!r || m.normalMap) continue;
      const tex = (N[r[1]] || FABRIC_NORMAL[r[1]])(); m.normalMap = tex; m.normalScale = new THREE.Vector2(r[2], r[2]); m.needsUpdate = true;
    }
  });
}

// ---------------------------------------------------------------- architectural detail
function bevelBox(w, h, d, r = 0.008) {
  const s = new THREE.Shape(), x = w / 2 - r, y = h / 2 - r;
  s.moveTo(-x, -h / 2); s.lineTo(x, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -y); s.lineTo(w / 2, y); s.quadraticCurveTo(w / 2, h / 2, x, h / 2); s.lineTo(-x, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, y); s.lineTo(-w / 2, -y); s.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.6, bevelSegments: 3, curveSegments: 3 });
  g.translate(0, 0, -(d - 2 * r) / 2); return g;
}
const gcache = new Map(); const G = (k, f) => (gcache.has(k) ? gcache.get(k) : (gcache.set(k, f()), gcache.get(k)));
const mcache = new Map(); const M = (k, f) => (mcache.has(k) ? mcache.get(k) : (mcache.set(k, f()), mcache.get(k)));
const trimMat = () => M("trim", () => new THREE.MeshStandardMaterial({ color: "#f1ece2", roughness: 0.42, name: "Trim", normalMap: N.wood(), normalScale: new THREE.Vector2(0.15, 0.15) }));
const doorMat = () => M("door", () => new THREE.MeshStandardMaterial({ color: "#6b4a30", roughness: 0.5, name: "Door_Leaf", normalMap: N.wood(), normalScale: new THREE.Vector2(0.6, 0.6) }));
const glassMat = (hi) => M("glass" + hi, () => hi ? new THREE.MeshPhysicalMaterial({ color: "#dfeff7", roughness: 0.02, metalness: 0, transmission: 0.92, thickness: 0.01, ior: 1.5, transparent: true, opacity: 0.35, envMapIntensity: 1.4, name: "Window_Glass" }) : new THREE.MeshStandardMaterial({ color: "#a9cfe2", roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.3, name: "Window_Glass" }));
const brass = () => M("brass", () => new THREE.MeshStandardMaterial({ color: "#c8a24a", roughness: 0.3, metalness: 1, name: "Metal_Brass" }));
// g: wall group (local x along the wall, z through it), w: wall record, H: wall height, T: thickness
export function wallDetail(g, w, H, T, quality) {
  if (quality === "low") return;
  const hi = quality === "high", add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; m.userData.edge = g.userData.edge; g.add(m); return m; };
  const base = G("base", () => bevelBox(1.02, 0.09, 0.016, 0.004));
  if (H > 0.3) for (const s of [-1, 1]) {
    if (w.t === "door") { for (const sx of [-1, 1]) add(G("baseS", () => bevelBox(0.07, 0.09, 0.016, 0.004)), trimMat(), sx * 0.475, 0.045, s * (T / 2 + 0.008)); }
    else add(base, trimMat(), 0, 0.045, s * (T / 2 + 0.008));
  }
  if (w.t === "window" && H > 0.9) {
    const top = Math.min(1.9, H), hh = top - 0.9, cy = 0.9 + hh / 2;
    g.children.filter((c) => c.name === "WindowGlass").forEach((c) => { c.visible = false; c.userData.noExport = true; });
    add(G("wg" + hh, () => new THREE.BoxGeometry(0.9, hh - 0.06, 0.012)), glassMat(hi), 0, cy, 0).name = "WindowGlassHifi";
    for (const s of [-1, 1]) {
      add(G("fv" + hh, () => bevelBox(0.06, hh + 0.08, T + 0.05, 0.006)), trimMat(), s * 0.47, cy, 0); // jambs
      add(G("mv" + hh, () => bevelBox(0.03, hh - 0.04, 0.03, 0.004)), trimMat(), 0, cy, s * 0.012); // mullion
    }
    add(G("fh", () => bevelBox(1.0, 0.06, T + 0.05, 0.006)), trimMat(), 0, top + 0.01, 0);
    add(G("sill", () => bevelBox(1.06, 0.035, T + 0.12, 0.008)), trimMat(), 0, 0.9 - 0.012, 0);
    add(G("mh", () => bevelBox(0.9, 0.025, 0.03, 0.004)), trimMat(), 0, cy, 0);
  }
  if (w.t === "door" && H > 0.9) {
    const dh = Math.min(2.1, H) - 0.02;
    const leaf = new THREE.Group(); leaf.position.set(-0.43, 0, T / 2 + 0.02); leaf.rotation.y = -1.45; leaf.name = "DoorLeaf"; g.add(leaf);
    const slab = new THREE.Mesh(G("leaf" + dh, () => bevelBox(0.84, dh, 0.04, 0.006)), doorMat()); slab.position.set(0.42, dh / 2, 0); slab.castShadow = true; leaf.add(slab);
    for (const [py, ph] of [[dh * 0.72, dh * 0.38], [dh * 0.27, dh * 0.38]]) for (const s of [-1, 1]) { const p = new THREE.Mesh(G("pan" + ph, () => bevelBox(0.3, ph, 0.012, 0.005)), doorMat()); p.position.set(0.42 + (s * 0.17), py, s * 0); for (const z of [-1, 1]) { const q = p.clone(); q.position.z = z * 0.022; leaf.add(q); } }
    const knob = new THREE.Mesh(G("knob", () => new THREE.SphereGeometry(0.03, 16, 12)), brass()); knob.position.set(0.76, 1.0, 0.04); leaf.add(knob);
    leaf.traverse((c) => (c.userData.edge = g.userData.edge));
    add(G("dh", () => bevelBox(1.0, 0.08, T + 0.06, 0.006)), trimMat(), 0, dh + 0.04, 0);
  }
}
