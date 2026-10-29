// Night lighting: real-date moon (phase + rise/set), stars, moonlight, and a small pool of real
// shadow-casting spotlights handed to the nearest lit fixtures (street lamps, porch lights, car
// headlights). Every other fixture keeps only its cheap additive light-pool decal + bloom halo.
import * as T from "three";

const SYNODIC = 29.530588853, NEW_MOON = Date.UTC(2000, 0, 6, 18, 14) / 864e5;
// 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter
export function moonAge(d = new Date()) { const x = (d.getTime() / 864e5 - NEW_MOON) / SYNODIC; return x - Math.floor(x); }
export function moonPhaseName(a) { return ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"][Math.round(a * 8) % 8]; }
// the moon trails the sun by age x 24h in hour angle and sits where the sun will be age x 1 year later in declination
export function moonAt(sunAt, d, hours) { const a = moonAge(d); const s = sunAt(new Date(d.getTime() + a * 365.25 * 864e5), hours - a * 24.84); return { elev: s.elev, az: s.az, age: a, name: moonPhaseName(a) }; }
export function dirFrom(elev, az, out = new T.Vector3()) { const er = elev * Math.PI / 180; return out.set(-Math.sin(az) * Math.cos(er), Math.sin(er), Math.cos(az) * Math.cos(er)).normalize(); }

const MAX_LIGHTS = { low: 2, med: 4, high: 8 };
export function createNight(scene, renderer) {
  const g = new T.Group(); g.name = "NightSky"; scene.add(g);
  // stars: fixed points on a big dome that follows the camera
  const n = 1400, pos = new Float32Array(n * 3), col = new Float32Array(n * 3); let s = 12345; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < n; k++) { const u = r() * 2 - 1, th = r() * Math.PI * 2, y = Math.abs(u) * 0.98 + 0.02, rr = Math.sqrt(1 - y * y); pos.set([Math.cos(th) * rr * 400, y * 400, Math.sin(th) * rr * 400], k * 3); const w = 0.6 + r() * 0.4, tint = r(); col.set([w * (tint > 0.8 ? 1 : 0.85), w * 0.9, w * (tint < 0.2 ? 0.8 : 1)], k * 3); }
  const sg = new T.BufferGeometry(); sg.setAttribute("position", new T.BufferAttribute(pos, 3)); sg.setAttribute("color", new T.BufferAttribute(col, 3));
  const starMat = new T.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const stars = new T.Points(sg, starMat); stars.name = "Stars"; stars.frustumCulled = false; stars.renderOrder = -2; g.add(stars);
  // moon disc: lit by the real sun direction, so its phase is whatever the real geometry gives
  const moonMat = new T.ShaderMaterial({ uniforms: { uSun: { value: new T.Vector3(1, 0, 0) }, uK: { value: 0 } }, transparent: true, depthWrite: false, fog: false,
    vertexShader: "varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix) * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 uSun; uniform float uK; varying vec3 vN; varying vec3 vP; float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }\n" +
      "void main(){ float lit = smoothstep(-0.04, 0.08, dot(vN, uSun)); float mare = 0.82 + 0.18 * smoothstep(0.35, 0.65, h(floor(vP*3.0))); vec3 c = vec3(0.93,0.95,1.0) * mare * lit + vec3(0.05,0.06,0.09); gl_FragColor = vec4(c * 1.6, uK); }" });
  const moon = new T.Mesh(new T.SphereGeometry(9, 32, 16), moonMat); moon.name = "Moon"; moon.renderOrder = -1; g.add(moon);
  const glowTex = radial(128, [[0, "rgba(200,215,255,0.55)"], [0.25, "rgba(160,180,255,0.18)"], [1, "rgba(0,0,0,0)"]]);
  const moonGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 })); moonGlow.scale.set(70, 70, 1); g.add(moonGlow);
  // real lights: a fixed-size pool (constant light count = no shader recompiles); only the nearest fixtures get one
  const pool = []; let cap = 0;
  function setQuality(q) {
    cap = MAX_LIGHTS[q] || 2;
    while (pool.length < 8) { const L = new T.SpotLight("#ffd29a", 0, 16, 0.9, 0.65, 1.4); L.name = "FixtureLight"; L.target.name = "FixtureLightTarget"; L.shadow.mapSize.set(256, 256); L.shadow.bias = -0.002; L.shadow.camera.near = 0.2; scene.add(L, L.target); pool.push(L); }
    pool.forEach((L, i) => { L.visible = i < cap; L.castShadow = i < cap && q !== "low" ? i < (q === "high" ? 8 : 2) : false; if (L.shadow.map) { L.shadow.map.dispose(); L.shadow.map = null; } });
  }
  const _p = new T.Vector3(), _q = new T.Vector3(), _f = new T.Vector3();
  let nightK = 0, acc = 1;
  // sources: [{ obj, kind: "lamp" | "porch" | "head", on: 0..1 }]
  function update({ sunDir, sunElev, moonInfo, camera, target, sources, dt }) {
    nightK = Math.max(0, Math.min(1, (2 - sunElev) / 8));
    g.position.copy(camera.position);
    starMat.opacity = Math.max(0, Math.min(1, (-sunElev - 2) / 8)) * 0.95; stars.visible = starMat.opacity > 0.01;
    const md = dirFrom(moonInfo.elev, moonInfo.az, _q);
    moon.position.copy(md).multiplyScalar(330); moonGlow.position.copy(moon.position);
    moonMat.uniforms.uSun.value.copy(sunDir); moonMat.uniforms.uK.value = Math.max(0.15, Math.min(1, 0.15 + nightK)) * (moonInfo.elev > -2 ? 1 : 0);
    const full = 0.5 - Math.abs(moonInfo.age - 0.5); // 0 new .. 0.5 full
    moon.visible = moonInfo.elev > -2; moonGlow.visible = moon.visible; moonGlow.material.opacity = nightK * (0.3 + full * 1.4);
    // hand real lights to the nearest active fixtures (a few times a second)
    acc += dt; if (acc < 0.25) return; acc = 0;
    const live = []; for (const s of sources) { if (s.on < 0.05 || !s.obj.parent) continue; s.obj.getWorldPosition(_p); const d = _p.distanceToSquared(target); if (d < 60 * 60) live.push({ s, d, p: _p.clone() }); }
    live.sort((a, b) => a.d - b.d);
    for (let i = 0; i < pool.length; i++) {
      const L = pool[i], e = i < cap ? live[i] : null; if (!e) { L.intensity = 0; continue; }
      L.position.copy(e.p);
      if (e.s.kind === "head") { e.s.obj.getWorldDirection(_f); _f.y = 0; _f.normalize(); L.target.position.copy(e.p).addScaledVector(_f, 9).setY(0); L.color.set("#fff1d8"); L.angle = 0.42; L.penumbra = 0.55; L.distance = 26; L.intensity = 38 * e.s.on; }
      else { L.target.position.set(e.p.x, 0, e.p.z); L.color.set(e.s.kind === "porch" ? "#ffcf8f" : "#ffd29a"); L.angle = e.s.kind === "porch" ? 1.0 : 0.95; L.penumbra = 0.7; L.distance = e.s.kind === "porch" ? 8 : 15; L.intensity = (e.s.kind === "porch" ? 9 : 26) * e.s.on; }
      L.target.updateMatrixWorld();
    }
  }
  setQuality("med");
  return { group: g, update, setQuality, get nightK() { return nightK; }, lights: () => pool.filter((L) => L.intensity > 0).length, cap: () => cap };
}
export function radial(size, stops) {
  const c = document.createElement("canvas"); c.width = c.height = size; const x = c.getContext("2d"), gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col); x.fillStyle = gr; x.fillRect(0, 0, size, size); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
