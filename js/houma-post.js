// Houma film look: HDR composer (MSAA) -> GTAO (Cinematic) -> bloom -> ACES output -> optional painterly Kuwahara ->
// colour grade (warm, saturated), vignette and film grain. All shaders are written here; no external assets.
import * as T from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";

const Kuwahara = {
  uniforms: { tDiffuse: { value: null }, res: { value: new T.Vector2(1, 1) }, radius: { value: 3 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  // 4-sector Kuwahara: each pixel takes the mean of the least-varying quadrant -> flat brush-like patches with crisp edges
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 res; uniform float radius; varying vec2 vUv;
    void main(){ vec2 px = 1.0 / res; vec3 m[4]; vec3 s[4]; for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s[k] = vec3(0.0); }
      const int R = 3; float n = float((R + 1) * (R + 1));
      for (int j = 0; j <= R; j++) for (int i = 0; i <= R; i++) {
        vec3 c0 = texture2D(tDiffuse, vUv + vec2(-i, -j) * px * radius / 3.0).rgb; m[0] += c0; s[0] += c0 * c0;
        vec3 c1 = texture2D(tDiffuse, vUv + vec2( i, -j) * px * radius / 3.0).rgb; m[1] += c1; s[1] += c1 * c1;
        vec3 c2 = texture2D(tDiffuse, vUv + vec2( i,  j) * px * radius / 3.0).rgb; m[2] += c2; s[2] += c2 * c2;
        vec3 c3 = texture2D(tDiffuse, vUv + vec2(-i,  j) * px * radius / 3.0).rgb; m[3] += c3; s[3] += c3 * c3; }
      float best = 1e9; vec3 col = vec3(0.0);
      for (int k = 0; k < 4; k++) { vec3 mu = m[k] / n; vec3 v = abs(s[k] / n - mu * mu); float sv = v.r + v.g + v.b; if (sv < best) { best = sv; col = mu; } }
      gl_FragColor = vec4(col, 1.0); }`,
};
const Grade = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, sat: { value: 1.15 }, warm: { value: 0.04 }, vig: { value: 0.35 }, grain: { value: 0.04 }, paint: { value: 0 }, res: { value: new T.Vector2(1, 1) } },
  vertexShader: Kuwahara.vertexShader,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, sat, warm, vig, grain, paint; uniform vec2 res; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, sat);
      c += vec3(warm, warm * 0.35, -warm * 0.6) * (1.0 - l);                 // warm the shadows/mids
      c = mix(c, smoothstep(0.0, 1.0, c), 0.25);                               // gentle film S-curve
      if (paint > 0.5) { float e = h(floor(vUv * res / 3.0)); c *= 0.97 + 0.06 * e; } // canvas weave
      vec2 d = vUv - 0.5; c *= 1.0 - vig * dot(d, d) * 1.6;
      c += (h(vUv * res + fract(time) * 91.7) - 0.5) * grain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0); }`,
};
export function createPost(renderer, scene, camera) {
  let composer = null, mode = "", paint = false, gtao = null, bloom = null, kuw = null, grade = null, w = 1, h = 1;
  function rebuild() {
    if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = null; }
    gtao = bloom = kuw = grade = null; if (mode === "none" && !paint) return;
    const rt = new T.WebGLRenderTarget(w, h, { type: T.HalfFloatType, samples: mode === "none" ? 0 : 4 });
    composer = new EffectComposer(renderer, rt); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
    composer.addPass(new RenderPass(scene, camera));
    if (mode === "cine") { try { gtao = new GTAOPass(scene, camera, w, h); gtao.output = 0; gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 1.5, scale: 1.1, samples: 12 }); gtao.blendIntensity = 0.85; composer.addPass(gtao); } catch (e) { gtao = null; } }
    if (mode === "high" || mode === "cine") { bloom = new UnrealBloomPass(new T.Vector2(w, h), mode === "cine" ? 0.32 : 0.22, 0.55, 0.92); composer.addPass(bloom); }
    composer.addPass(new OutputPass());
    if (paint) { kuw = new ShaderPass(Kuwahara); composer.addPass(kuw); }
    grade = new ShaderPass(Grade); composer.addPass(grade); setGrade();
  }
  function setGrade() { if (!grade) return; const u = grade.uniforms, cine = mode === "cine"; u.sat.value = paint ? 1.32 : cine ? 1.18 : 1.12; u.warm.value = cine || paint ? 0.05 : 0.03; u.vig.value = cine ? 0.42 : 0.25; u.grain.value = cine ? 0.075 : mode === "high" ? 0.05 : 0; u.paint.value = paint ? 1 : 0; }
  return {
    set(m, p) { if (m === mode && p === paint) return; mode = m; paint = p; rebuild(); },
    size(W, H) { w = W; h = H; if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(W, H); } if (kuw) kuw.uniforms.res.value.set(W * renderer.getPixelRatio(), H * renderer.getPixelRatio()); if (grade) grade.uniforms.res.value.set(W * renderer.getPixelRatio(), H * renderer.getPixelRatio()); },
    render(t) { if (!composer) { renderer.render(scene, camera); return; } if (grade) grade.uniforms.time.value = t; if (kuw && kuw.uniforms.res.value.x < 2) this.size(w, h); composer.render(); },
    info: () => ({ mode, paint, passes: composer ? composer.passes.map((p) => p.constructor.name) : [] }),
  };
}
