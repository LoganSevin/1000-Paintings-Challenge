// sims-body.js — code-generated, sculptable human for Sims.
// Everything here is built procedurally (no downloaded models):
//  * signed-distance "clay" anatomy polygonised with surface nets: body, finely sampled head,
//    hands (4 fingers × 3 phalanges + opposable thumb) and feet (5 toes, big toe largest)
//  * generated skeleton (spine chain, jaw, eyes, lids, every finger/thumb joint, toes) + skin weights
//  * procedural AnimationClips (idle, walk, sit, lie, paint, shower), grip, blink, look-at, jaw open
//  * morph targets (weight, muscle, chest, hips, face…) by re-projecting onto edited SDFs
//  * sculpt deltas (brushes) stored per vertex, compressed for saves / online, glb round trip
//  * smart clothing: offset shells grown from the body surface (gloves/shoes follow fingers/toes)
//  * hair cards with anisotropic shading, eyes with iris/pupil/cornea, teeth, tongue, brows
import * as THREE from "three";

export const MORPHS = ["weight", "muscle", "chest", "hips", "shoulders", "belly", "faceW", "jaw", "chin", "cheeks", "nose", "lips", "eyes", "ears", "head"];
export const MORPH_LABELS = { weight: "Weight", muscle: "Muscle", chest: "Chest", hips: "Hips", shoulders: "Shoulders", belly: "Belly", faceW: "Face width", jaw: "Jaw", chin: "Chin", cheeks: "Cheekbones", nose: "Nose", lips: "Lips", eyes: "Eye size", ears: "Ears", head: "Head size" };
// grid spacing (m) per part and LOD
export const LODS = {
  low: { body: 0.022, head: 0.0075, hand: 0.0062, foot: 0.009, hair: 380 },
  med: { body: 0.016, head: 0.006, hand: 0.005, foot: 0.0075, hair: 800 },
  high: { body: 0.0125, head: 0.0046, hand: 0.0042, foot: 0.006, hair: 1400 },
};
export const PARTS = ["body", "head", "handL", "handR", "footL", "footR"];
const lodH = (lod, part) => LODS[lod][part.replace(/[LR]$/, "")];
const BASE_P = Object.fromEntries(MORPHS.map((k) => [k, 0]));
const FINGERS = [ // name, offset across palm, MCP distance from wrist, phalanx lengths, radius, spread
  ["index", 0.024, 0.093, [0.043, 0.026, 0.02], 0.0088, 0.07],
  ["middle", 0.008, 0.096, [0.047, 0.029, 0.021], 0.0092, 0.01],
  ["ring", -0.009, 0.092, [0.044, 0.027, 0.02], 0.0086, -0.05],
  ["pinky", -0.025, 0.085, [0.034, 0.021, 0.018], 0.0075, -0.12],
];
const TOES = [[0.0125, 0.034, 0.12], [0.0086, 0.029, 0.117], [0.0079, 0.026, 0.11], [0.0072, 0.023, 0.101], [0.0066, 0.019, 0.091]]; // radius, length, base z
const v3 = { add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] };
const comb = (...t) => t.reduce((acc, [v, s]) => v3.add(acc, v3.mul(v, s)), [0, 0, 0]);

// joints and bone frames (bind pose: relaxed A-pose, ~7.5 heads tall: 1.785 m crown, head 0.237 m)
function joints(P) {
  const sw = 1 + 0.12 * P.shoulders + 0.04 * P.muscle, hw = 1 + 0.1 * P.hips + 0.05 * P.weight;
  const J = { pelvis: [0, 0.97, 0], spine1: [0, 1.07, 0], spine2: [0, 1.18, 0], chest: [0, 1.3, 0], neck: [0, 1.47, 0], head: [0, 1.56, 0], headTop: [0, 1.785, 0], jaw: [0, 1.627, -0.004], chinTip: [0, 1.565, 0.074] };
  J.hand = {}; J.foot = {};
  const ad = [Math.sin(0.33), -Math.cos(0.33), 0];
  for (const s of [1, -1]) {
    const L = s > 0 ? "L" : "R";
    J["eye" + L] = [s * 0.033, 1.6665, 0.0748]; J["lid" + L] = J["eye" + L];
    J["clav" + L] = [s * 0.025, 1.44, 0];
    const sh = [s * 0.172 * sw, 1.435, -0.005]; J["upperarm" + L] = sh;
    const el = [sh[0] + s * ad[0] * 0.29, sh[1] + ad[1] * 0.29, sh[2] - 0.01]; J["forearm" + L] = el;
    const wr = [el[0] + s * ad[0] * 0.25, el[1] + ad[1] * 0.25, el[2] + 0.025]; J["hand" + L] = wr;
    // hand frame: a = along hand, m = toward palm (medial), w = across palm (thumb side, +z)
    const a = v3.norm([s * ad[0], ad[1], 0.04]); let m = [-s, 0, 0]; m = v3.norm(v3.sub(m, v3.mul(a, v3.dot(m, a)))); const w = v3.norm(v3.cross(s > 0 ? m : a, s > 0 ? a : m));
    const W = w[2] < 0 ? v3.mul(w, -1) : w;
    const H = { a, m, w: W, wr, fingers: {} };
    for (const [f, off, mcp, lens, r, spread] of FINGERS) {
      let p = comb([wr, 1], [a, mcp], [W, off], [m, 0.004]), curl = 0; const pts = [p];
      lens.forEach((ln, k) => { curl += [0.12, 0.22, 0.3][k]; const d = v3.norm(comb([a, Math.cos(curl)], [m, Math.sin(curl)], [W, spread])); p = v3.add(p, v3.mul(d, ln)); pts.push(p); });
      H.fingers[f] = { pts, r };
      for (let k = 0; k < 3; k++) { J[f + (k + 1) + L] = pts[k]; }
      J[f + "Tip" + L] = pts[3];
    }
    { // thumb: metacarpal + 2 phalanges, set at the base of the palm
      const b0 = comb([wr, 1], [a, 0.02], [W, 0.019], [m, 0.009]);
      const dirs = [v3.norm(comb([a, 0.5], [W, 0.72], [m, 0.45])), v3.norm(comb([a, 0.62], [W, 0.52], [m, 0.58])), v3.norm(comb([a, 0.72], [W, 0.32], [m, 0.62]))];
      const pts = [b0]; let p = b0; [0.046, 0.033, 0.028].forEach((ln, k) => { p = v3.add(p, v3.mul(dirs[k], ln)); pts.push(p); });
      H.fingers.thumb = { pts, r: 0.0118 };
      for (let k = 0; k < 3; k++) J["thumb" + (k + 1) + L] = pts[k]; J["thumbTip" + L] = pts[3];
    }
    J.hand[L] = H; J["handEnd" + L] = H.fingers.middle.pts[0];
    J["thigh" + L] = [s * 0.088 * hw, 0.93, 0];
    J["shin" + L] = [s * 0.094 * hw, 0.51, 0.012];
    const x0 = s * 0.097 * hw;
    J["foot" + L] = [x0, 0.085, -0.015]; J["ball" + L] = [x0 - s * 0.004, 0.026, 0.105];
    const toes = [];
    TOES.forEach(([r, ln, z], k) => { const x = x0 + s * (-0.027 + k * 0.0135 + (k ? 0.004 : 0)); const base = [x, 0.006 + r, z - 0.018]; const tip = [x + s * k * 0.002, 0.004 + r * 0.8, z + ln - 0.018]; toes.push({ base, tip, r }); J["toe" + (k + 1) + L] = base; J["toeTip" + (k + 1) + L] = tip; });
    J.foot[L] = { toes, x0 };
  }
  return J;
}
// [name, parent, headKey, tailKey]
function boneList() {
  const B = [["pelvis", null, "pelvis", "spine1"], ["spine1", "pelvis", "spine1", "spine2"], ["spine2", "spine1", "spine2", "chest"], ["chest", "spine2", "chest", "neck"], ["neck", "chest", "neck", "head"], ["head", "neck", "head", "headTop"],
    ["jaw", "head", "jaw", "chinTip"], ["eyeL", "head", "eyeL", null], ["eyeR", "head", "eyeR", null], ["lidL", "head", "lidL", null], ["lidR", "head", "lidR", null]];
  for (const L of ["L", "R"]) {
    B.push(["clav" + L, "chest", "clav" + L, "upperarm" + L], ["upperarm" + L, "clav" + L, "upperarm" + L, "forearm" + L], ["forearm" + L, "upperarm" + L, "forearm" + L, "hand" + L], ["hand" + L, "forearm" + L, "hand" + L, "handEnd" + L]);
    for (const f of ["thumb", "index", "middle", "ring", "pinky"]) for (let k = 1; k <= 3; k++) B.push([f + k + L, k === 1 ? "hand" + L : f + (k - 1) + L, f + k + L, k < 3 ? f + (k + 1) + L : f + "Tip" + L]);
  }
  for (const L of ["L", "R"]) {
    B.push(["thigh" + L, "pelvis", "thigh" + L, "shin" + L], ["shin" + L, "thigh" + L, "shin" + L, "foot" + L], ["foot" + L, "shin" + L, "foot" + L, "ball" + L]);
    for (let k = 1; k <= 5; k++) B.push(["toe" + k + L, "foot" + L, "toe" + k + L, "toeTip" + k + L]);
  }
  B.push(["sway", "pelvis", "pelvis", null]);
  return B;
}
const BONES = boneList();
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
export const BONE_NAMES = BONES.map((b) => b[0]);

// ---------------------------------------------------------------- SDF
// prim: [type, op, k, ...data]; 0 ellipsoid(c,r) 1 round cone(a,b,ra,rb) 2 oriented ellipsoid(c,r,axisA,axisB,axisC)
function prims(P, part) {
  const L = [], J = joints(P);
  const E = (c, r, k = 0.03, op = 0) => { if (r[0] > 1e-4 && r[1] > 1e-4 && r[2] > 1e-4) L.push([0, op, k, c[0], c[1], c[2], r[0], r[1], r[2]]); };
  const C = (a, b, ra, rb, k = 0.03, op = 0) => L.push([1, op, k, a[0], a[1], a[2], b[0], b[1], b[2], ra, rb]);
  const O = (c, r, A, B, Cc, k = 0.01, op = 0) => L.push([2, op, k, c[0], c[1], c[2], r[0], r[1], r[2], ...A, ...B, ...Cc]);
  const W = P.weight, Mu = P.muscle, sw = 1 + 0.12 * P.shoulders + 0.04 * Mu, hw = 1 + 0.1 * P.hips + 0.05 * W;
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const side = part.endsWith("L") ? 1 : part.endsWith("R") ? -1 : 0, S = side > 0 ? "L" : "R";
  if (part === "body") {
    E([0, 0.95, -0.005], [0.152 * hw, 0.11, 0.104 * (1 + 0.15 * W)], 0.04);
    E([0, 1.08, 0.012], [0.132 * (1 + 0.18 * W), 0.12, 0.098 * (1 + 0.35 * P.belly + 0.16 * W)], 0.05);
    E([0, 1.16, -0.002], [0.128 * (1 + 0.12 * W), 0.08, 0.093 * (1 + 0.1 * W)], 0.05);
    E([0, 1.3, -0.006], [0.152 * sw, 0.16, 0.104 * (1 + 0.06 * Mu + 0.06 * W)], 0.05);
    E([0, 1.39, -0.004], [0.162 * sw, 0.07, 0.088], 0.04);
    E([0, 1.24, 0.07], [0.07, 0.07, 0.03], 0.04); // abdomen wall
    for (const s of [1, -1]) {
      const Sd = s > 0 ? "L" : "R";
      E([s * 0.062 * sw, 1.335, 0.05], [0.066 * (1 + 0.15 * Mu), 0.05, 0.042 * (1 + 0.55 * Mu)], 0.03);
      const ch = P.chest; if (ch > 0.01) E([s * 0.068 * sw, 1.295, 0.066 + 0.01 * ch], [0.062 * ch + 0.001, 0.057 * ch + 0.001, 0.05 * ch + 0.001], 0.035);
      E([s * 0.064 * hw, 0.9, -0.062], [0.084 * hw, 0.095, 0.07 * (1 + 0.2 * W + 0.15 * P.hips)], 0.04);
      E([s * 0.05, 1.33, -0.07], [0.06, 0.09, 0.03 * (1 + 0.3 * Mu)], 0.04); // scapula / lats
      C([s * 0.03, 1.475, -0.012], [s * 0.15 * sw, 1.44, -0.012], 0.047 * (1 + 0.15 * Mu), 0.04, 0.04);
      const sh = J["upperarm" + Sd], el = J["forearm" + Sd], wr = J["hand" + Sd];
      E([sh[0] + s * 0.012, sh[1] - 0.025, sh[2]], [0.052 * (1 + 0.25 * Mu + 0.1 * W), 0.07, 0.055 * (1 + 0.2 * Mu)], 0.03); // deltoid
      C(sh, el, 0.045 * (1 + 0.25 * W + 0.12 * Mu), 0.036, 0.03);
      const mid = lerp(sh, el, 0.45);
      E([mid[0], mid[1], mid[2] + 0.017], [0.03 * (1 + 0.45 * Mu), 0.075, 0.03 * (1 + 0.6 * Mu)], 0.025); // biceps
      E([mid[0], mid[1] + 0.02, mid[2] - 0.02], [0.031 * (1 + 0.35 * Mu), 0.085, 0.028 * (1 + 0.5 * Mu)], 0.025); // triceps
      E([el[0], el[1], el[2] - 0.024], [0.016, 0.018, 0.012], 0.015); // olecranon (elbow point)
      const fe = lerp(el, wr, 0.97);
      C(el, fe, 0.039 * (1 + 0.15 * W + 0.18 * Mu), 0.026, 0.02);
      E(lerp(el, wr, 0.22).map((v, i) => v + (i === 2 ? 0.006 : 0)), [0.034 * (1 + 0.25 * Mu), 0.07, 0.032], 0.03); // forearm flexors
      const hp = J["thigh" + Sd], kn = J["shin" + Sd], an = J["foot" + Sd];
      C([hp[0], 0.95, hp[2]], kn, 0.086 * (1 + 0.24 * W + 0.1 * Mu) * (1 + 0.07 * P.hips), 0.054, 0.05);
      E(lerp(hp, kn, 0.35).map((v, i) => v + (i === 2 ? 0.022 : 0)), [0.06 * (1 + 0.2 * Mu + 0.15 * W), 0.15, 0.06 * (1 + 0.2 * Mu)], 0.04);
      E([kn[0], kn[1], kn[2] + 0.008], [0.046, 0.05, 0.048], 0.03);
      E([kn[0], kn[1] + 0.005, kn[2] + 0.047], [0.024, 0.027, 0.012], 0.012); // patella
      C(kn, lerp(kn, an, 0.94), 0.051 * (1 + 0.15 * W + 0.15 * Mu), 0.032, 0.03);
      E([kn[0], kn[1] - 0.12, kn[2] - 0.022], [0.044 * (1 + 0.25 * Mu), 0.085, 0.046 * (1 + 0.3 * Mu)], 0.035); // calf
      C([kn[0], kn[1] - 0.04, kn[2] + 0.03], [an[0], an[1] + 0.06, an[2] + 0.02], 0.012, 0.009, 0.02); // tibia ridge
    }
    C([0, 1.4, -0.006], [0, 1.6, 0.004], 0.058 * (1 + 0.12 * W + 0.1 * Mu), 0.049, 0.04);
  } else if (part === "head") {
    const hs = 1 + 0.07 * P.head, fw = 1 + 0.08 * P.faceW, ey = 1 + 0.18 * P.eyes, ns = 1 + 0.3 * P.nose, lp = 1 + 0.32 * P.lips;
    C([0, 1.49, -0.008], [0, 1.6, 0.0], 0.043, 0.054 * (1 + 0.1 * W + 0.08 * Mu), 0.03);
    E([0, 1.685, -0.012], [0.075 * fw * hs, 0.098 * hs, 0.097 * hs], 0.03);
    E([0, 1.7, 0.033], [0.068 * fw, 0.064 * hs, 0.06], 0.03);
    E([0, 1.636, 0.035], [0.061 * (1 + 0.1 * P.faceW + 0.05 * P.cheeks + 0.06 * W), 0.06, 0.07], 0.03);
    E([0, 1.596, 0.024], [0.057 * (1 + 0.16 * P.jaw + 0.06 * W), 0.034, 0.064], 0.03);
    for (const s of [1, -1]) E([s * 0.049 * (1 + 0.16 * P.jaw), 1.603, -0.006], [0.022, 0.03, 0.03], 0.03);
    E([0, 1.567, 0.071 + 0.005 * P.chin], [0.022 * (1 + 0.15 * P.chin), 0.02, 0.02 * (1 + 0.25 * P.chin)], 0.02);
    for (const s of [1, -1]) {
      E([s * 0.046, 1.646, 0.066], [0.022 * (1 + 0.3 * P.cheeks + 0.2 * W), 0.016, 0.018 * (1 + 0.3 * P.cheeks)], 0.02);
      E([s * 0.032, 1.689, 0.082], [0.024, 0.0075, 0.012], 0.014); // brow ridge
    }
    C([0, 1.68, 0.087], [0, 1.633, 0.106 + 0.005 * P.nose], 0.008, 0.0105 * ns, 0.012);
    E([0, 1.628, 0.104 + 0.006 * P.nose], [0.012 * ns, 0.011 * ns, 0.011 * ns], 0.008);
    for (const s of [1, -1]) E([s * 0.0125 * ns, 1.625, 0.095], [0.0085 * ns, 0.0075, 0.008], 0.007);
    E([0, 1.6055, 0.0905], [0.0225, 0.0072 * lp, 0.0115 * lp], 0.006); // upper lip
    E([0, 1.5915, 0.0885], [0.0205, 0.0085 * lp, 0.0118 * lp], 0.006); // lower lip
    for (const s of [1, -1]) {
      E([s * 0.033, 1.6705, 0.0775], [0.0158 * ey, 0.0105 * ey, 0.0125 * ey], 0.004); // upper lid
      E([s * 0.033, 1.6625, 0.0775], [0.0152 * ey, 0.009 * ey, 0.012 * ey], 0.004); // lower lid
      const ef = 1 + 0.12 * P.ears;
      E([s * 0.077 * fw * hs, 1.662, -0.006], [0.0115, 0.03 * ef, 0.019 * ef], 0.006); // ear
      E([s * 0.084 * fw * hs, 1.637, -0.004], [0.007, 0.01 * ef, 0.009], 0.004); // lobe
    }
    // carve: mouth opening + oral cavity, nostrils, eye openings, ear bowls
    E([0, 1.598, 0.096], [0.0212 * lp, 0.0024, 0.014], 0.0016, 1);
    E([0, 1.598, 0.068], [0.024, 0.011, 0.024], 0.004, 1);
    for (const s of [1, -1]) {
      E([s * 0.0085 * ns, 1.6185, 0.103], [0.0038 * ns, 0.0028, 0.006], 0.002, 1);
      E([s * 0.033, 1.6665, 0.091], [0.0138 * ey, 0.0049 * ey, 0.02], 0.0018, 1);
      E([s * 0.0845 * fw * hs, 1.662, -0.002], [0.0055, 0.019 * (1 + 0.12 * P.ears), 0.011], 0.003, 1);
    }
  } else if (part.startsWith("hand")) {
    const H = J.hand[S], { a, m, w, wr } = H, fat = 1 + 0.1 * W;
    C(v3.sub(wr, v3.mul(a, 0.022)), v3.add(wr, v3.mul(a, 0.012)), 0.0235, 0.0225 * fat, 0.012);
    O(comb([wr, 1], [a, 0.052], [m, 0.002]), [0.05, 0.043 * fat, 0.0145 * fat], a, w, m, 0.015);
    O(comb([wr, 1], [a, 0.04], [w, 0.022], [m, 0.008]), [0.03, 0.018, 0.015 * fat], a, w, m, 0.012); // thenar
    O(comb([wr, 1], [a, 0.046], [w, -0.03], [m, 0.006]), [0.035, 0.012, 0.012 * fat], a, w, m, 0.012); // hypothenar
    for (const f of ["thumb", "index", "middle", "ring", "pinky"]) {
      const { pts, r } = H.fingers[f], rr = r * fat;
      if (f !== "thumb") E(v3.sub(pts[0], v3.mul(m, 0.003)), [rr * 1.1, rr * 1.1, rr * 1.1], 0.006); // knuckle
      for (let k = 0; k < 3; k++) {
        C(pts[k], pts[k + 1], rr * (1 - 0.07 * k), rr * (1 - 0.07 * (k + 1)), 0.0035);
        if (k > 0) E(pts[k], [rr * 1.04, rr * 1.04, rr * 1.04], 0.003); // finger joint
      }
      const d = v3.norm(v3.sub(pts[3], pts[2])), nb = v3.norm(v3.sub(v3.mul(m, -1), v3.mul(d, v3.dot(v3.mul(m, -1), d)))), across = v3.cross(d, nb);
      O(v3.add(v3.add(pts[2], v3.mul(d, v3.dot(v3.sub(pts[3], pts[2]), d) * 0.62)), v3.mul(nb, rr * 0.78)), [0.0075, rr * 0.62, 0.0018], d, across, nb, 0.0015); // nail
    }
  } else if (part.startsWith("foot")) {
    const F = J.foot[S], x0 = F.x0, an = J["foot" + S], fat = 1 + 0.08 * W;
    C([x0, 0.165, -0.012], an, 0.029, 0.03, 0.02);
    for (const sd of [1, -1]) E([an[0] + sd * 0.019, an[1] + 0.004, an[2] - 0.004], [0.009, 0.012, 0.011], 0.012); // malleoli
    E([x0, 0.036, -0.045], [0.031 * fat, 0.036, 0.036], 0.02); // heel
    E([x0 - side * 0.003, 0.033, 0.035], [0.04 * fat, 0.03, 0.085], 0.025); // foot body
    C(an, J["ball" + S], 0.03, 0.02, 0.03); // instep
    E(J["ball" + S], [0.046 * fat, 0.022, 0.026], 0.02);
    F.toes.forEach(({ base, tip, r }, k) => {
      const rr = r * fat;
      C(base, tip, rr, rr * 0.92, 0.004);
      E(tip, [rr * 0.95, rr * 0.85, rr * 0.95], 0.003);
      if (k === 0) E(v3.add(base, [0, 0, 0.016]), [rr * 1.05, rr * 1.0, rr], 0.003); // big toe joint
      E(v3.add(tip, [0, rr * 0.72, -rr * 0.4]), [rr * 0.7, 0.0015, rr * 0.75], 0.0015); // toenail
    });
  }
  return L;
}
function clipFor(part) {
  if (part === "head") return [[0, -1, 0, -1.493]];
  if (part.startsWith("hand")) { const J = joints(BASE_P), H = J.hand[part.slice(-1)]; const n = v3.mul(H.a, -1); return [[...n, v3.dot(n, H.wr) + 0.02]]; }
  if (part.startsWith("foot")) return [[0, 1, 0, 0.16], [0, -1, 0, 0.0]];
  return [];
}
function boxFor(part) {
  if (part === "body") return [[-0.5, 0.06, -0.2], [0.5, 1.61, 0.21]];
  if (part === "head") return [[-0.105, 1.485, -0.125], [0.105, 1.795, 0.13]];
  const J = joints(BASE_P);
  if (part.startsWith("hand")) { const H = J.hand[part.slice(-1)], pts = [v3.sub(H.wr, v3.mul(H.a, 0.03))]; for (const f in H.fingers) pts.push(...H.fingers[f].pts); const lo = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i])) - 0.03), hi = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])) + 0.03); return [lo, hi]; }
  const x0 = J.foot[part.slice(-1)].x0; return [[x0 - 0.065, -0.004, -0.095], [x0 + 0.065, 0.17, 0.165]];
}
function compile(list, clips = []) {
  const n = list.length, T = new Uint8Array(n), O = new Uint8Array(n), K = new Float64Array(n), D = new Float64Array(n * 16), B = new Float64Array(n * 4);
  list.forEach((p, i) => {
    T[i] = p[0]; O[i] = p[1]; K[i] = p[2];
    for (let j = 3; j < p.length; j++) D[i * 16 + j - 3] = p[j];
    if (p[0] !== 1) { B[i * 4] = p[3]; B[i * 4 + 1] = p[4]; B[i * 4 + 2] = p[5]; B[i * 4 + 3] = Math.max(p[6], p[7], p[8]); }
    else { B[i * 4] = (p[3] + p[6]) / 2; B[i * 4 + 1] = (p[4] + p[7]) / 2; B[i * 4 + 2] = (p[5] + p[8]) / 2; B[i * 4 + 3] = Math.hypot(p[6] - p[3], p[7] - p[4], p[8] - p[5]) / 2 + Math.max(p[9], p[10]); }
  });
  const nc = clips.length, CL = new Float64Array(clips.flat());
  return function sdf(x, y, z) {
    let d = 1e9;
    for (let i = 0; i < n; i++) {
      const o = i * 16, k = K[i];
      const bx = x - B[i * 4], by = y - B[i * 4 + 1], bz = z - B[i * 4 + 2];
      const bd = Math.sqrt(bx * bx + by * by + bz * bz) - B[i * 4 + 3];
      if (O[i] === 0) { if (bd > d + k) continue; } else if (bd > k || -d > 0.05) continue;
      let e;
      if (T[i] === 1) {
        const ax = D[o], ay = D[o + 1], az = D[o + 2], vx = D[o + 3] - ax, vy = D[o + 4] - ay, vz = D[o + 5] - az;
        const wx = x - ax, wy = y - ay, wz = z - az, l2 = vx * vx + vy * vy + vz * vz;
        let t = (wx * vx + wy * vy + wz * vz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = wx - vx * t, dy = wy - vy * t, dz = wz - vz * t;
        e = Math.sqrt(dx * dx + dy * dy + dz * dz) - (D[o + 6] + (D[o + 7] - D[o + 6]) * t);
      } else {
        let px = x - D[o], py = y - D[o + 1], pz = z - D[o + 2];
        if (T[i] === 2) { const a = px * D[o + 6] + py * D[o + 7] + pz * D[o + 8], b = px * D[o + 9] + py * D[o + 10] + pz * D[o + 11], c = px * D[o + 12] + py * D[o + 13] + pz * D[o + 14]; px = a; py = b; pz = c; }
        px /= D[o + 3]; py /= D[o + 4]; pz /= D[o + 5];
        const k0 = Math.sqrt(px * px + py * py + pz * pz);
        const qx = px / D[o + 3], qy = py / D[o + 4], qz = pz / D[o + 5];
        e = (k0 * (k0 - 1)) / (Math.sqrt(qx * qx + qy * qy + qz * qz) || 1e-9);
      }
      if (O[i] === 0) { const h = Math.max(k - Math.abs(d - e), 0) / k; d = Math.min(d, e) - h * h * k * 0.25; }
      else { const h = Math.max(k - Math.abs(d + e), 0) / k; d = Math.max(d, -e) + h * h * k * 0.25; }
    }
    for (let c = 0; c < nc; c++) d = Math.max(d, CL[c * 4] * x + CL[c * 4 + 1] * y + CL[c * 4 + 2] * z - CL[c * 4 + 3]);
    return d;
  };
}
const sdfFor = (P, part) => compile(prims(P, part), clipFor(part));

// ---------------------------------------------------------------- polygonise (surface nets)
function polygonize(sdf, part, h) {
  const [lo, hi] = boxFor(part);
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nz), id = (i, j, k) => (k * ny + j) * nx + i;
  const cs = 4, cnx = Math.ceil(nx / cs) + 1, cny = Math.ceil(ny / cs) + 1, cnz = Math.ceil(nz / cs) + 1, CF = new Float32Array(cnx * cny * cnz);
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) CF[(k * cny + j) * cnx + i] = sdf(lo[0] + i * cs * h, lo[1] + j * cs * h, lo[2] + k * cs * h);
  const lim = cs * h * (part === "body" || part === "head" ? 1.8 : 3.2); // small parts: ellipsoid SDF bound is loose, sample finely to avoid holes
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = CF[(Math.round(k / cs) * cny + Math.round(j / cs)) * cnx + Math.round(i / cs)];
    F[id(i, j, k)] = Math.abs(c) > lim ? c : sdf(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  }
  // keep the outer shell of the grid positive so every surface closes
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!i || !j || !k || i === nx - 1 || j === ny - 1 || k === nz - 1) F[id(i, j, k)] = Math.max(F[id(i, j, k)], h);
  const vid = new Int32Array(nx * ny * nz).fill(-1), pos = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { v[c] = F[id(i + corners[c][0], j + corners[c][1], k + corners[c][2])]; if (v[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [a, b] of edges) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t; sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t; sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t; cnt++;
    }
    vid[id(i, j, k)] = pos.length / 3;
    pos.push(lo[0] + (i + sx / cnt) * h, lo[1] + (j + sy / cnt) * h, lo[2] + (k + sz / cnt) * h);
  }
  const idx = [];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = F[id(i, j, k)] < 0;
    for (let ax = 0; ax < 3; ax++) {
      const ii = i + (ax === 0), jj = j + (ax === 1), kk = k + (ax === 2);
      if (a === (F[id(ii, jj, kk)] < 0)) continue;
      let q;
      if (ax === 0) q = [id(i, j - 1, k - 1), id(i, j, k - 1), id(i, j, k), id(i, j - 1, k)];
      else if (ax === 1) q = [id(i - 1, j, k - 1), id(i - 1, j, k), id(i, j, k), id(i, j, k - 1)];
      else q = [id(i - 1, j - 1, k), id(i, j - 1, k), id(i, j, k), id(i - 1, j, k)];
      const Q = q.map((x) => vid[x]); if (Q.some((x) => x < 0)) continue;
      if (a) Q.reverse();
      const P = (n) => [pos[n * 3], pos[n * 3 + 1], pos[n * 3 + 2]], d02 = dist2(P(Q[0]), P(Q[2])), d13 = dist2(P(Q[1]), P(Q[3]));
      if (d02 < d13) idx.push(Q[0], Q[1], Q[2], Q[0], Q[2], Q[3]); else idx.push(Q[0], Q[1], Q[3], Q[1], Q[2], Q[3]);
    }
  }
  // orient outward: closed surfaces must have positive signed volume (some clip/box combos flip the winding)
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const bx = pos[b] - pos[a], by = pos[b + 1] - pos[a + 1], bz = pos[b + 2] - pos[a + 2], cx = pos[c] - pos[a], cy = pos[c + 1] - pos[a + 1], cz = pos[c + 2] - pos[a + 2];
    vol += pos[a] * (by * cz - bz * cy) + pos[a + 1] * (bz * cx - bx * cz) + pos[a + 2] * (bx * cy - by * cx);
  }
  if (vol < 0) for (let t = 0; t < idx.length; t += 3) { const k = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = k; }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function grad(sdf, x, y, z, e = 0.0006) {
  const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1; return [gx / l, gy / l, gz / l];
}
function project(sdf, pos, iters = 2) {
  for (let i = 0; i < pos.length; i += 3) for (let it = 0; it < iters; it++) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2], d = sdf(x, y, z); if (Math.abs(d) < 1e-5) break;
    const g = grad(sdf, x, y, z); pos[i] -= g[0] * d; pos[i + 1] -= g[1] * d; pos[i + 2] -= g[2] * d;
  }
}
function smoothPass(pos, nbr, keep = 0.5) {
  const out = new Float32Array(pos.length), { off, list } = nbr;
  for (let v = 0; v < pos.length / 3; v++) {
    let sx = 0, sy = 0, sz = 0, c = 0;
    for (let k = off[v]; k < off[v + 1]; k++) { const u = list[k]; sx += pos[u * 3]; sy += pos[u * 3 + 1]; sz += pos[u * 3 + 2]; c++; }
    if (!c) { out[v * 3] = pos[v * 3]; out[v * 3 + 1] = pos[v * 3 + 1]; out[v * 3 + 2] = pos[v * 3 + 2]; continue; }
    out[v * 3] = pos[v * 3] * keep + (sx / c) * (1 - keep); out[v * 3 + 1] = pos[v * 3 + 1] * keep + (sy / c) * (1 - keep); out[v * 3 + 2] = pos[v * 3 + 2] * keep + (sz / c) * (1 - keep);
  }
  pos.set(out);
}
function neighbors(idx, n) {
  const sets = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < idx.length; i += 3) { const a = idx[i], b = idx[i + 1], c = idx[i + 2]; sets[a].add(b).add(c); sets[b].add(a).add(c); sets[c].add(a).add(b); }
  const off = new Uint32Array(n + 1); let t = 0; for (let i = 0; i < n; i++) { off[i] = t; t += sets[i].size; } off[n] = t;
  const list = new Uint32Array(t); let p = 0; for (const s of sets) for (const x of s) list[p++] = x;
  return { off, list };
}
function hashGrid(pos, cell = 0.01) {
  const m = new Map(), key = (x, y, z) => ((Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663) ^ (Math.floor(z / cell) * 83492791));
  for (let i = 0; i < pos.length / 3; i++) { const k = key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(i); }
  return {
    near(x, y, z, r = 1) {
      let best = -1, bd = 1e9;
      for (let R = r; R <= 4 && best < 0; R++) for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
        const a = m.get(key(x + dx * cell, y + dy * cell, z + dz * cell)); if (!a) continue;
        for (const i of a) { const d = (pos[i * 3] - x) ** 2 + (pos[i * 3 + 1] - y) ** 2 + (pos[i * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = i; } }
      }
      return best;
    },
  };
}

// ---------------------------------------------------------------- base generation
const bases = new Map();
const segDist = (p, a, b) => { const v = v3.sub(b, a), w = v3.sub(p, a); const l2 = v3.dot(v, v) || 1e-9; let t = v3.dot(w, v) / l2; t = Math.max(0, Math.min(1, t)); return [Math.hypot(w[0] - v[0] * t, w[1] - v[1] * t, w[2] - v[2] * t), t]; };
const DIGIT = /thumb|index|middle|ring|pinky|toe/;
function allowedBones(part) {
  const S = part.slice(-1);
  return BONES.map((b, i) => {
    const nm = b[0]; if (!b[3]) return false;
    if (part === "body") return !DIGIT.test(nm) && !/^(jaw|head)$/.test(nm);
    if (part === "head") return nm === "neck" || nm === "head";
    if (part.startsWith("hand")) return nm.endsWith(S) && (nm === "forearm" + S || nm === "hand" + S || /thumb|index|middle|ring|pinky/.test(nm));
    return nm.endsWith(S) && (nm === "shin" + S || nm === "foot" + S || /^toe/.test(nm));
  });
}
const sstep = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
export function baseFor(lod) {
  if (bases.has(lod)) return bases.get(lod);
  const t0 = performance.now(), J = joints(BASE_P), out = { lod, parts: {} };
  const segs = BONES.map((b) => (b[3] ? [J[b[2]], J[b[3]]] : null));
  const kids = BONES.map((b) => BONES.map((c, j) => (c[1] === b[0] ? j : -1)).filter((j) => j >= 0));
  for (const part of PARTS) {
    const sdf = sdfFor(BASE_P, part);
    const { pos, idx } = polygonize(sdf, part, lodH(lod, part));
    const n = pos.length / 3, nbr = neighbors(idx, n);
    smoothPass(pos, nbr, 0.4); project(sdf, pos, 2); smoothPass(pos, nbr, 0.7); project(sdf, pos, 1);
    const nor = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const g = grad(sdf, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], Math.min(0.0012, lodH(lod, part) * 0.4)); nor[i * 3] = g[0]; nor[i * 3 + 1] = g[1]; nor[i * 3 + 2] = g[2]; }
    const morph = {}, sig0 = JSON.stringify(prims(BASE_P, part));
    for (const k of MORPHS) {
      if (JSON.stringify(prims({ ...BASE_P, [k]: 1 }, part)) === sig0) continue;
      const s2 = sdfFor({ ...BASE_P, [k]: 1 }, part), p2 = pos.slice();
      project(s2, p2, 3);
      const d = new Float32Array(n * 3); let any = false;
      for (let i = 0; i < n * 3; i++) { d[i] = p2[i] - pos[i]; if (Math.abs(d[i]) > 1e-4) any = true; }
      if (any) { smoothPass(d, nbr, 0.5); morph[k] = d; }
    }
    const allow = allowedBones(part);
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), dom = new Uint8Array(n), tAlong = new Float32Array(n), uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      const ds = segs.map((s, j) => (s && allow[j] ? segDist(p, s[0], s[1]) : [9, 0]));
      let best = 0; for (let j = 1; j < ds.length; j++) if (ds[j][0] < ds[best][0]) best = j;
      const nm = BONES[best][0], par = BONES[best][1] ? BI[BONES[best][1]] : -1;
      const al = new Set([best, ...kids[best]]); if (par >= 0) { al.add(par); if (BONES[par][1]) al.add(BI[BONES[par][1]]); }
      const sig = DIGIT.test(nm) ? 0.0055 : /thigh|pelvis/.test(nm) ? 0.03 : /spine|chest|neck/.test(nm) ? 0.035 : /hand|foot/.test(nm) ? 0.012 : 0.02;
      const ws = []; for (const j of al) if (allow[j]) ws.push([j, Math.exp(-(ds[j][0] - ds[best][0]) / sig)]);
      ws.sort((a, b) => b[1] - a[1]); let top = ws.slice(0, part === "head" ? 3 : 4);
      if (part === "head") { // jaw: everything below the mouth line, in front of the ear
        const x = p[0], y = p[1], z = p[2];
        const jw = sstep((1.5985 - y) / 0.004 + 0.5) * sstep((z + 0.01) / 0.035) * sstep((y - 1.53) / 0.025) * (1 - sstep((Math.abs(x) - 0.05) / 0.02) * sstep((y - 1.585) / 0.02));
        const tot = top.reduce((a, b) => a + b[1], 0); top = top.map(([j, w]) => [j, (w / tot) * (1 - jw)]); top.push([BI.jaw, jw]);
      }
      const tot = top.reduce((a, b) => a + b[1], 0);
      top.forEach(([j, w], q) => { si[i * 4 + q] = j; sw[i * 4 + q] = w / tot; });
      dom[i] = best; tAlong[i] = ds[best][1];
      const s = segs[best], ax = v3.sub(s[1], s[0]), len = Math.hypot(...ax);
      const limb = /arm|hand|thigh|shin|foot|thumb|index|middle|ring|pinky|toe/.test(nm);
      const c0 = v3.add(s[0], v3.mul(ax, tAlong[i]));
      const ang = limb ? Math.atan2(p[0] - c0[0], p[2] - c0[2]) : Math.atan2(p[0], p[2]);
      uv[i * 2] = (ang / (Math.PI * 2) + 0.5) * (limb ? 1.5 : 4); uv[i * 2 + 1] = limb ? tAlong[i] * len * 6 + (/forearm|shin/.test(nm) ? 2 : 0) : p[1] * 6;
    }
    const col = new Float32Array(n * 3).fill(1);
    if (part === "head") for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const lip = Math.max(0, 1 - Math.hypot(x / 0.024, (y - 1.598) / 0.014, Math.max(0, 0.085 - z) / 0.008));
      const cheek = Math.max(0, 1 - Math.hypot((Math.abs(x) - 0.048) / 0.02, (y - 1.635) / 0.018, (z - 0.075) / 0.03)) * 0.5;
      const lid = Math.max(0, 1 - Math.hypot((Math.abs(x) - 0.033) / 0.018, (y - 1.668) / 0.012, (z - 0.088) / 0.01)) * 0.4;
      const mouth = Math.hypot(x / 0.026, (y - 1.598) / 0.013, (z - 0.068) / 0.026) < 1.05 && z < 0.089 ? 1 : 0;
      const l = Math.min(1, lip * 2.2);
      col[i * 3] = mouth ? 0.42 : 1 - 0.05 * l + 0.04 * cheek - 0.12 * lid; col[i * 3 + 1] = mouth ? 0.16 : 1 - 0.32 * l - 0.06 * cheek - 0.14 * lid; col[i * 3 + 2] = mouth ? 0.17 : 1 - 0.28 * l - 0.05 * cheek - 0.08 * lid;
    }
    out.parts[part] = { pos, idx, nor, morph, si, sw, dom, tAlong, uv, col, nbr, n };
  }
  for (const part of PARTS) { const P = out.parts[part]; P.hash = hashGrid(P.pos, lodH(lod, part) * 1.5); }
  // mirror maps for symmetric sculpting (L hand ↔ R hand etc.)
  for (const part of PARTS) {
    const P = out.parts[part], other = part.endsWith("L") ? part.slice(0, -1) + "R" : part.endsWith("R") ? part.slice(0, -1) + "L" : part, Q = out.parts[other], mir = new Int32Array(P.n);
    for (let i = 0; i < P.n; i++) mir[i] = Q.hash.near(-P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2]);
    P.mirror = mir; P.mirrorPart = other;
  }
  out.J = J; out.ms = performance.now() - t0;
  bases.set(lod, out); return out;
}

// ---------------------------------------------------------------- procedural materials
const texCache = new Map();
function canvasTex(key, w, h, paint, color = true, rep = 1) {
  const k = key + ":" + rep; if (texCache.has(k)) return texCache.get(k);
  const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); paint(x, w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 4;
  if (color) t.colorSpace = THREE.SRGBColorSpace; texCache.set(k, t); return t;
}
export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function normalFromHeight(key, size, heightFn, strength = 2, rep = 1) {
  return canvasTex("n:" + key, size, size, (x, w, h) => {
    const H = new Float32Array(w * h); heightFn(H, w, h);
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const g = (a, b) => H[((b + h) % h) * w + ((a + w) % w)];
      const dx = (g(i + 1, j) - g(i - 1, j)) * strength, dy = (g(i, j + 1) - g(i, j - 1)) * strength;
      const l = Math.hypot(dx, dy, 1), o = (j * w + i) * 4;
      img.data[o] = (-dx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  }, false, rep);
}
export const noise2 = (seed) => { const r = rng(seed), g = new Float32Array(64 * 64).map(() => r()); return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, s = (a, b) => g[((b & 63) * 64) + (a & 63)]; const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return (s(xi, yi) * (1 - u) + s(xi + 1, yi) * u) * (1 - v) + (s(xi, yi + 1) * (1 - u) + s(xi + 1, yi + 1) * u) * v; }; };
export const FABRIC_NORMAL = {
  cotton: () => normalFromHeight("cotton", 256, (H, w, h) => { const n = noise2(3); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = Math.sin(i * Math.PI / 2) * (((j >> 2) & 1) ? 1 : -1) * 0.3 + Math.sin(j * Math.PI / 2) * (((i >> 2) & 1) ? 1 : -1) * 0.3 + n(i / 8, j / 8) * 0.6; }, 1.4),
  denim: () => normalFromHeight("denim", 256, (H, w, h) => { const n = noise2(5); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = Math.sin((i + j) * Math.PI / 3) * 0.6 + n(i / 4, j / 16) * 0.8; }, 1.6),
  knit: () => normalFromHeight("knit", 256, (H, w, h) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const cx = i % 16 - 8, cy = j % 12 - 6; H[j * w + i] = Math.max(0, Math.cos((cx + (cx > 0 ? -1 : 1) * Math.abs(cy) * 0.6) / 4 * Math.PI)) * 1.6; } }, 1.8),
  leather: () => normalFromHeight("leather", 256, (H, w, h) => { const n = noise2(11), m = noise2(12); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = Math.abs(n(i / 6, j / 6) - 0.5) * 1.6 + m(i / 2, j / 2) * 0.25; }, 1.2),
  skin: () => normalFromHeight("skin", 256, (H, w, h) => { const n = noise2(21), m = noise2(22), r = rng(9); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = n(i / 5, j / 5) * 0.35 + m(i / 1.6, j / 1.6) * 0.25; for (let k = 0; k < 900; k++) { const x = (r() * w) | 0, y = (r() * h) | 0; H[y * w + x] -= 0.6; } }, 1.0, 6),
};
const FABRIC = { cotton: { rough: 0.86, sheen: 0.5 }, denim: { rough: 0.8, sheen: 0.25 }, knit: { rough: 0.95, sheen: 0.7 }, leather: { rough: 0.42, sheen: 0, clearcoat: 0.25 } };
const matCache = new Map();
export function fabricMat(kind, color, mapTex, hi) {
  const k = kind + color + (mapTex ? mapTex.uuid : "") + hi; if (matCache.has(k)) return matCache.get(k);
  const f = FABRIC[kind] || FABRIC.cotton, c = new THREE.Color(color);
  const p = { color: c, roughness: f.rough, map: mapTex || null, normalMap: FABRIC_NORMAL[kind] ? FABRIC_NORMAL[kind]() : null, normalScale: new THREE.Vector2(0.7, 0.7) };
  const m = hi ? new THREE.MeshPhysicalMaterial({ ...p, sheen: f.sheen, sheenRoughness: 0.6, sheenColor: c.clone().lerp(new THREE.Color(1, 1, 1), 0.5), clearcoat: f.clearcoat || 0, clearcoatRoughness: 0.5 }) : new THREE.MeshStandardMaterial(p);
  m.name = "Fabric_" + kind; matCache.set(k, m); return m;
}
function skinMat(color, hi) {
  const k = "skin" + color + hi; if (matCache.has(k)) return matCache.get(k);
  const c = new THREE.Color(color);
  const p = { color: c, roughness: 0.52, vertexColors: true, normalMap: FABRIC_NORMAL.skin(), normalScale: new THREE.Vector2(0.18, 0.18) };
  const m = hi ? new THREE.MeshPhysicalMaterial({ ...p, sheen: 0.35, sheenRoughness: 0.45, sheenColor: c.clone().lerp(new THREE.Color("#ff8a70"), 0.55), clearcoat: 0.06, clearcoatRoughness: 0.4, specularIntensity: 0.6 }) : new THREE.MeshStandardMaterial(p);
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace("#include <dithering_fragment>", "#include <dithering_fragment>\n gl_FragColor.rgb += diffuseColor.rgb * vec3(0.10, 0.025, 0.015) * (1.0 - abs(dot(normalize(vNormal), vec3(0.0,0.0,1.0))));"); };
  m.customProgramCacheKey = () => "simskin";
  m.name = "Skin"; matCache.set(k, m); return m;
}
const hairTex = () => canvasTex("hairstrands", 128, 512, (x, w, h) => {
  x.clearRect(0, 0, w, h); const r = rng(77);
  for (let i = 0; i < 180; i++) {
    const px = r() * w, wd = 0.6 + r() * 1.6, ln = h * (0.55 + r() * 0.45), a = 0.5 + r() * 0.5;
    const g = x.createLinearGradient(0, 0, 0, ln); g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.85, `rgba(255,255,255,${a * 0.8})`); g.addColorStop(1, "rgba(255,255,255,0)");
    x.strokeStyle = g; x.lineWidth = wd; x.beginPath(); x.moveTo(px, 0); x.bezierCurveTo(px + (r() - 0.5) * 10, ln * 0.3, px + (r() - 0.5) * 12, ln * 0.7, px + (r() - 0.5) * 14, ln); x.stroke();
  }
}, false);
const hairShade = () => canvasTex("hairshade", 4, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#5a5a5a"); g.addColorStop(0.25, "#e0e0e0"); g.addColorStop(1, "#ffffff"); x.fillStyle = g; x.fillRect(0, 0, w, h); }, true);
function hairMat(color, hi) {
  const k = "hair" + color + hi; if (matCache.has(k)) return matCache.get(k);
  const p = { color: new THREE.Color(color), map: hairShade(), alphaMap: hairTex(), alphaTest: 0.32, side: THREE.DoubleSide, roughness: 0.42 };
  const m = hi ? new THREE.MeshPhysicalMaterial({ ...p, anisotropy: 0.85, sheen: 0.4, sheenColor: new THREE.Color(color).lerp(new THREE.Color("#fff"), 0.4), specularIntensity: 0.8 }) : new THREE.MeshStandardMaterial(p);
  // Kajiya-Kay style highlights along the strand tangent
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec3 hairT;\nvarying vec3 vHairT;").replace("#include <begin_vertex>", "#include <begin_vertex>\n vHairT = normalize(normalMatrix * hairT);");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vHairT;").replace("#include <dithering_fragment>", `#include <dithering_fragment>
      { vec3 V = normalize(vViewPosition); vec3 Lh = normalize(vec3(0.3, 0.8, 0.5)); vec3 Hh = normalize(Lh + V); vec3 Th = normalize(vHairT);
        float t1 = dot(Th, Hh); float s1 = pow(sqrt(max(0.0, 1.0 - t1*t1)), 80.0) * 0.3; float t2 = dot(Th, normalize(Hh + 0.25*normal)); float s2 = pow(sqrt(max(0.0, 1.0 - t2*t2)), 24.0) * 0.25;
        gl_FragColor.rgb += (vec3(s1) + diffuseColor.rgb * s2) * 0.6; }`);
  };
  m.customProgramCacheKey = () => "simhair";
  m.name = "Hair"; matCache.set(k, m); return m;
}
const irisTex = (color) => canvasTex("iris" + color, 256, 256, (x, w, h) => {
  const c = w / 2, r = rng(5), base = new THREE.Color(color);
  x.fillStyle = "#f2eee8"; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) { x.strokeStyle = "rgba(190,60,60,0.25)"; x.lineWidth = 0.8; const a = r() * 7; x.beginPath(); x.moveTo(c + Math.cos(a) * c * 0.98, c + Math.sin(a) * c * 0.98); x.quadraticCurveTo(c + Math.cos(a + 0.1) * c * 0.8, c + Math.sin(a - 0.1) * c * 0.8, c + Math.cos(a + 0.2) * c * 0.6, c + Math.sin(a + 0.2) * c * 0.6); x.stroke(); }
  const R = c * 0.42, g = x.createRadialGradient(c, c, 4, c, c, R);
  g.addColorStop(0, "#" + base.clone().multiplyScalar(0.45).getHexString()); g.addColorStop(0.55, "#" + base.getHexString()); g.addColorStop(0.9, "#" + base.clone().multiplyScalar(0.7).getHexString()); g.addColorStop(1, "#140f0b");
  x.fillStyle = g; x.beginPath(); x.arc(c, c, R, 0, 7); x.fill();
  for (let i = 0; i < 260; i++) { const a = r() * Math.PI * 2, r0 = R * (0.35 + r() * 0.15), r1 = R * (0.7 + r() * 0.28); x.strokeStyle = `rgba(${r() > 0.5 ? "255,236,190" : "18,10,4"},${0.1 + r() * 0.2})`; x.lineWidth = 0.6 + r(); x.beginPath(); x.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); x.lineTo(c + Math.cos(a + (r() - 0.5) * 0.15) * r1, c + Math.sin(a) * r1); x.stroke(); }
  x.fillStyle = "#040303"; x.beginPath(); x.arc(c, c, R * 0.36, 0, 7); x.fill(); // pupil
});

// ---------------------------------------------------------------- hair cards
const SCALP = { c: [0, 1.685, -0.012], r: [0.079, 0.102, 0.101] };
function hairStrands(style, count, seed) {
  const R = rng(seed), cards = [], sc = SCALP;
  const inside = (p, pad) => { const x = (p[0] - sc.c[0]) / (sc.r[0] + pad), y = (p[1] - sc.c[1]) / (sc.r[1] + pad), z = (p[2] - sc.c[2]) / (sc.r[2] + pad); return x * x + y * y + z * z < 1; };
  const pushOut = (p, pad) => {
    for (let k = 0; k < 8 && inside(p, pad); k++) { const d = v3.norm(v3.sub(p, sc.c)); p[0] += d[0] * 0.004; p[1] += d[1] * 0.004; p[2] += d[2] * 0.004; }
    if (p[1] < 1.6 && p[1] > 1.3 && Math.abs(p[0]) < 0.17) { const back = -0.105 - Math.max(0, 1.5 - p[1]) * 0.12; if (p[2] > back && p[2] < 0.0) p[2] = back; }
    if (p[1] < 1.71 && p[1] > 1.3 && p[2] > -0.03 && Math.abs(p[0]) < 0.115) p[0] = Math.sign(p[0] || 1) * 0.115; // keep the face clear: front strands part to the sides
    if (p[1] < 1.5 && p[1] > 1.3 && Math.abs(p[0]) < 0.24 && p[2] > -0.1 && p[2] < 0.1) p[0] = Math.sign(p[0] || 1) * Math.max(Math.abs(p[0]), 0.16 + (1.5 - p[1]) * 0.3);
  };
  const S = {
    short: { len: [0.04, 0.075], grav: 0.9, lay: 0.85 }, sidepart: { len: [0.05, 0.09], grav: 0.9, lay: 0.85, part: 0.035 }, spiky: { len: [0.04, 0.07], grav: -0.6, lay: 0.1 },
    mohawk: { len: [0.06, 0.1], grav: -0.8, lay: 0.0, strip: 0.022 }, long: { len: [0.26, 0.38], grav: 1.4, lay: 0.75 }, bob: { len: [0.12, 0.15], grav: 1.4, lay: 0.75 },
    curly: { len: [0.09, 0.14], grav: 0.5, lay: 0.4, curl: 0.03 }, afro: { len: [0.06, 0.08], grav: -0.1, lay: 0.0, curl: 0.02, puff: 0.075 }, braids: { len: [0.3, 0.4], grav: 1.5, lay: 0.85, braid: true },
    ponytail: { len: [0.04, 0.06], grav: 0.5, lay: 0.95, gather: [0, 1.672, -0.112], tail: 0.24 }, pigtails: { len: [0.04, 0.06], grav: 0.5, lay: 0.95, gather2: true, tail: 0.18 },
    bun: { len: [0.04, 0.06], grav: 0.3, lay: 0.95, bun: [0, 1.755, -0.085] }, topknot: { len: [0.03, 0.05], grav: 0.6, lay: 0.95, bun: [0, 1.79, -0.02] },
  }[style];
  if (!S) return cards;
  if (S.len[1] > 0.2) count = Math.round(count * 0.5); // long styles: fewer, wider cards read as hair instead of a bristle curtain
  const golden = Math.PI * (3 - Math.sqrt(5)), N = count * 3;
  for (let i = 0; i < N && cards.length < count; i++) {
    const y = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - y * y), th = golden * i;
    const nx = Math.cos(th) * rr, nz = Math.sin(th) * rr, ny = y, az = Math.atan2(nx, nz), front = Math.cos(az);
    if (ny < (front > 0 ? 0.22 + 0.25 * front : 0.2 + front * 0.6)) continue;
    if (S.strip && Math.abs(nx) > S.strip / 0.08) continue;
    const root = [sc.c[0] + nx * sc.r[0], sc.c[1] + ny * sc.r[1], sc.c[2] + nz * sc.r[2]], nrm = [nx, ny, nz];
    const L = S.len[0] + R() * (S.len[1] - S.len[0]), segs = L > 0.2 ? 10 : L > 0.1 ? 7 : 5, sl = L / segs;
    const tgt = S.bun || (S.gather2 ? [Math.sign(nx || 1) * 0.085, 1.68, -0.07] : S.gather);
    let dir;
    if (tgt) dir = v3.norm(v3.sub(tgt, root));
    else if (S.part != null) dir = v3.norm([(root[0] > S.part ? 1 : -1) * 0.8 + nx * 0.2, -0.2, -0.3 + nz * 0.3]);
    else dir = v3.norm([nx * (1 - S.lay), ny * (1 - S.lay) - S.lay * 0.7 + 0.3 * front * S.lay, nz * (1 - S.lay) - S.lay * front * 0.9]);
    if (!tgt && S.part == null && S.len[1] > 0.1 && front > 0) dir = v3.norm(v3.add(dir, [Math.sign(nx || 1) * front * 1.1, 0.1 * front, -front * 0.6])); // longer hair sweeps back off the face from a centre part
    let p = v3.add(root, v3.mul(nrm, 0.001)); const pts = [p.slice()];
    for (let s = 1; s <= (tgt ? 8 : segs); s++) {
      if (tgt) { const d = v3.sub(tgt, p), dl = Math.hypot(...d); if (dl < 0.008) break; dir = v3.mul(d, 1 / dl); p = v3.add(p, v3.mul(dir, Math.min(0.02, dl))); pushOut(p, 0.005); pts.push(p.slice()); continue; }
      dir[1] -= S.grav * 0.1; if (S.curl) { dir[0] += Math.sin(s * 2.1 + i) * S.curl * 6; dir[2] += Math.cos(s * 2.1 + i) * S.curl * 6; }
      dir = v3.norm(dir); p = v3.add(p, v3.mul(dir, sl)); pushOut(p, 0.005 + (S.puff || 0) * (s / segs)); pts.push(p.slice());
    }
    if (pts.length > 1) cards.push({ pts, w: S.braid ? 0.009 : L > 0.2 ? 0.026 : 0.018, nrm });
  }
  const tail = (center, n, len, spread, wid) => { for (let k = 0; k < n; k++) { const a = R() * 7, rr = R() * spread; let p = [center[0] + Math.cos(a) * rr, center[1] + Math.sin(a) * rr, center[2]]; const pts = [p.slice()]; let dir = [0, -0.3, -0.6]; for (let s = 1; s <= 9; s++) { dir[1] -= 0.18; dir = v3.norm(dir); p = v3.add(p, v3.mul(dir, len / 9)); p[0] += (R() - 0.5) * 0.004; pushOut(p, 0.008); pts.push(p.slice()); } cards.push({ pts, w: wid, nrm: [0, 0, -1] }); } };
  if (S.gather) tail(S.gather, Math.round(count * 0.25), S.tail, 0.012, 0.016);
  if (S.gather2) for (const s of [-1, 1]) tail([s * 0.085, 1.68, -0.07], Math.round(count * 0.12), S.tail, 0.01, 0.014);
  if (S.bun) { const [cx, cy, cz] = S.bun, br = 0.045; for (let k = 0; k < count * 0.3; k++) { const a = R() * 7, b = Math.acos(2 * R() - 1), pts = []; for (let s = 0; s <= 6; s++) { const aa = a + s * 0.35; pts.push([cx + Math.cos(aa) * Math.sin(b) * br, cy + Math.cos(b) * br * 0.8, cz + Math.sin(aa) * Math.sin(b) * br]); } cards.push({ pts, w: 0.016, nrm: [Math.cos(a) * Math.sin(b), Math.cos(b), Math.sin(a) * Math.sin(b)] }); } }
  return cards;
}
function cardsGeometry(cards, origin) {
  const pos = [], nor = [], uv = [], tan = [], idx = [];
  for (const c of cards) {
    const base = pos.length / 3, n = c.pts.length;
    for (let s = 0; s < n; s++) {
      const p = c.pts[s], t = v3.norm(v3.sub(c.pts[Math.min(n - 1, s + 1)], c.pts[Math.max(0, s - 1)]));
      const b = v3.norm(v3.cross(t, c.nrm)), w = c.w * (1 - 0.55 * (s / (n - 1)));
      for (const sd of [-1, 1]) { pos.push(p[0] + b[0] * w * sd * 0.5 - origin[0], p[1] + b[1] * w * sd * 0.5 - origin[1], p[2] + b[2] * w * sd * 0.5 - origin[2]); nor.push(...c.nrm); uv.push(sd < 0 ? 0 : 1, s / (n - 1)); tan.push(...t); }
      if (s < n - 1) { const a = base + s * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute("hairT", new THREE.Float32BufferAttribute(tan, 3)); g.setIndex(idx); return g;
}
function scalpShell(origin, pad, color, cut = 0.2) {
  const g = new THREE.SphereGeometry(1, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.62), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, SCALP.c[0] + x * (SCALP.r[0] + pad) - origin[0], SCALP.c[1] + Math.max(y, z > 0 ? cut : -0.25) * (SCALP.r[1] + pad) - origin[1], SCALP.c[2] + z * (SCALP.r[2] + pad) - origin[2]); }
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, map: canvasTex("buzz", 256, 256, (x, w, h) => { x.fillStyle = "#808080"; x.fillRect(0, 0, w, h); const r = rng(3); for (let i = 0; i < 9000; i++) { x.fillStyle = r() > 0.5 ? "#2a2a2a" : "#b0b0b0"; x.fillRect(r() * w, r() * h, 1, 2); } }), name: "HairBuzz" });
  return new THREE.Mesh(g, m);
}

// ---------------------------------------------------------------- skeleton + skinned part geometry
function makeSkeleton(J) {
  const bones = BONES.map(([name]) => { const b = new THREE.Bone(); b.name = name; return b; });
  BONES.forEach(([name, parent, hk], i) => {
    const h = J[hk], ph = parent ? J[BONES[BI[parent]][2]] : [0, 0, 0];
    bones[i].position.set(h[0] - ph[0], h[1] - ph[1], h[2] - ph[2]);
    if (parent) bones[BI[parent]].add(bones[i]);
  });
  return { bones, skeleton: new THREE.Skeleton(bones), root: bones[0] };
}
const restWorld = (J, name) => J[BONES[BI[name]][2]];
function partGeometry(P, delta) {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(P.pos);
  if (delta) for (let i = 0; i < pos.length; i++) pos[i] += delta[i];
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(P.nor), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(P.uv, 2));
  g.setAttribute("color", new THREE.BufferAttribute(P.col, 3));
  g.setAttribute("skinIndex", new THREE.BufferAttribute(P.si, 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(P.sw, 4));
  const vid = new Float32Array(P.n); for (let i = 0; i < P.n; i++) vid[i] = i; g.setAttribute("_vid", new THREE.BufferAttribute(vid, 1));
  g.setIndex(new THREE.BufferAttribute(P.idx, 1));
  const keys = MORPHS.filter((k) => P.morph[k]);
  g.morphAttributes.position = keys.map((k) => { const a = new THREE.BufferAttribute(P.morph[k], 3); a.name = k; return a; });
  g.morphTargetsRelative = true; g.userData.morphKeys = keys;
  if (delta && hasDelta(delta)) g.computeVertexNormals();
  g.computeBoundingSphere(); g.boundingSphere.radius *= 1.6; return g;
}
const hasDelta = (d) => { for (let i = 0; i < d.length; i++) if (d[i]) return true; return false; };
function applyMorphs(mesh, inf) { const keys = mesh.geometry.userData.morphKeys || []; mesh.morphTargetInfluences = keys.map((k) => inf[k] || 0); mesh.morphTargetDictionary = Object.fromEntries(keys.map((k, i) => [k, i])); }

// ---------------------------------------------------------------- smart clothing
// region masks are decided from the generated rig: dominant bone + position along it (+ height)
export function regionMask(base, part, region) {
  const P = base.parts[part], n = P.n, out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const nm = BONES[P.dom[i]][0], t = P.tAlong[i], x = P.pos[i * 3], y = P.pos[i * 3 + 1], z = P.pos[i * 3 + 2];
    let on = false;
    if (part === "body") {
      const core = /^(pelvis|spine1|spine2|chest|clav[LR])$/.test(nm) || (nm === "neck" && t < 0.3);
      const ua = /^upperarm/.test(nm), fa = /^forearm/.test(nm), th = /^thigh/.test(nm), sh = /^shin/.test(nm);
      switch (region) {
        case "torso": on = (core && y > 0.885) || (ua && t < 0.14); break;
        case "torsoTank": on = core && y > 0.885 && !(y > 1.36 && Math.abs(x) > 0.085) && !(nm === "neck"); break;
        case "sleeveShort": on = ua && t < 0.5; break;
        case "sleeveLong": on = ua || (fa && t < 0.95); break;
        case "collarHigh": on = nm === "neck" && t < 0.6; break;
        case "pants": on = (th || (sh && t < 0.92) || (/^(pelvis|spine1)$/.test(nm) && y < 1.0)) ; break;
        case "shorts": on = ((th && t < 0.5) || (/^(pelvis|spine1)$/.test(nm) && y < 1.0)); break;
        case "brief": on = ((th && t < 0.12) || (nm === "pelvis" && y < 0.99)); break;
        case "bib": on = core && y > 0.9 && y < 1.33 && z > 0.02 && Math.abs(x) < 0.12; break;
        case "socks": on = sh && t > 0.8; break;
      }
    } else if (part.startsWith("hand")) on = region === "gloves" && !(/^forearm/.test(nm) && t < 0.9);
    else if (part.startsWith("foot")) on = (region === "shoes" && y < 0.118) || region === "socks";
    out[i] = on ? 1 : 0;
  }
  return out;
}
// offset shell grown from the (sculpted) skin; keeps skin weights + morphs so it follows bones and body shape
function shellGeometry(base, part, mask, thick, smooth = 0) {
  const P = base.parts[part], map = new Int32Array(P.n).fill(-1), src = [];
  const idx = [];
  for (let f = 0; f < P.idx.length; f += 3) { const a = P.idx[f], b = P.idx[f + 1], c = P.idx[f + 2]; if (mask[a] && mask[b] && mask[c]) for (const v of [a, b, c]) { if (map[v] < 0) { map[v] = src.length; src.push(v); } idx.push(map[v]); } }
  if (!idx.length) return null;
  const m = src.length, g = new THREE.BufferGeometry(), sub = (arr, w) => { const o = new arr.constructor(m * w); for (let i = 0; i < m; i++) for (let k = 0; k < w; k++) o[i * w + k] = arr[src[i] * w + k]; return o; };
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(m * 3), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(m * 3), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(sub(P.uv, 2), 2));
  g.setAttribute("skinIndex", new THREE.BufferAttribute(sub(P.si, 4), 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(sub(P.sw, 4), 4));
  g.setIndex(idx);
  const keys = MORPHS.filter((k) => P.morph[k]);
  g.morphAttributes.position = keys.map((k) => { const a = new THREE.BufferAttribute(sub(P.morph[k], 3), 3); a.name = k; return a; });
  g.morphTargetsRelative = true; g.userData.morphKeys = keys;
  // local neighbour list for smoothing (toe box / mitten softening)
  let nbr = null; if (smooth) { const s = Array.from({ length: m }, () => new Set()); for (let f = 0; f < idx.length; f += 3) for (let k = 0; k < 3; k++) { s[idx[f + k]].add(idx[f + (k + 1) % 3]); s[idx[f + k]].add(idx[f + (k + 2) % 3]); } nbr = s.map((x) => [...x]); }
  g.userData.shell = { part, src: Int32Array.from(src), thick, smooth, nbr };
  return g;
}
// thickness may be a number or fn(vertexIndex, pos) ; reads current skin positions/normals
export function refitShell(shellGeom, skinGeom) {
  const S = shellGeom.userData.shell, pa = skinGeom.attributes.position.array, na = skinGeom.attributes.normal.array;
  const out = shellGeom.attributes.position.array, on = shellGeom.attributes.normal.array;
  for (let i = 0; i < S.src.length; i++) {
    const v = S.src[i], th = typeof S.thick === "function" ? S.thick(pa[v * 3], pa[v * 3 + 1], pa[v * 3 + 2]) : S.thick;
    for (let k = 0; k < 3; k++) { out[i * 3 + k] = pa[v * 3 + k] + na[v * 3 + k] * th; on[i * 3 + k] = na[v * 3 + k]; }
  }
  if (S.smooth && S.nbr) for (let it = 0; it < S.smooth; it++) {
    const tmp = out.slice();
    for (let i = 0; i < S.src.length; i++) { const nb = S.nbr[i]; if (!nb.length) continue; let x = 0, y = 0, z = 0; for (const j of nb) { x += tmp[j * 3]; y += tmp[j * 3 + 1]; z += tmp[j * 3 + 2]; } const l = nb.length; out[i * 3] = tmp[i * 3] * 0.35 + x / l * 0.65; out[i * 3 + 1] = tmp[i * 3 + 1] * 0.35 + y / l * 0.65; out[i * 3 + 2] = tmp[i * 3 + 2] * 0.35 + z / l * 0.65; }
  }
  shellGeom.attributes.position.needsUpdate = true; shellGeom.attributes.normal.needsUpdate = true;
  if (S.smooth) shellGeom.computeVertexNormals();
  shellGeom.computeBoundingSphere(); shellGeom.boundingSphere.radius *= 1.6;
}
// loose skirt / dress hem: lathe skinned to pelvis, thighs and the sway spring bone
function skirtGeometry(J, len, flare, top = 0.99, rTop = 0.165, segs = 48, rows = 18) {
  const pos = [], uv = [], si = [], sw = [], idx = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows, y = top - t * len, rad = rTop * (1 + t * flare) + 0.012 * Math.sin(t * Math.PI);
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2, x = Math.sin(a) * rad * 1.03, z = Math.cos(a) * rad * 0.86 - 0.008 + (t < 0.3 ? -0.02 * Math.cos(a) * (0.3 - t) : 0);
      const fold = 1 + 0.03 * t * Math.sin(a * 12); pos.push(x * fold, y, z * fold); uv.push(s / segs * 4, t * 3);
      const side = x > 0 ? "thighL" : "thighR", wl = Math.min(1, Math.abs(x) / (rad + 1e-4) * 1.2) * sstep(t * 1.5) * 0.45, wsw = t * 0.5;
      si.push(BI.pelvis, BI[side], BI.sway, 0); sw.push(1 - wl - wsw, wl, wsw, 0);
      if (r < rows && s < segs) { const a0 = r * (segs + 1) + s; idx.push(a0, a0 + segs + 1, a0 + 1, a0 + 1, a0 + segs + 1, a0 + segs + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
// garment recipe per outfit: [part(s), region, fabric, colorKey, thickness, layer]
const OUTFIT_SPEC = {
  tee: [["torso", "cotton", "top", 0.0035], ["sleeveShort", "cotton", "top", 0.0035]],
  hoodie: [["torso", "knit", "top", 0.011], ["sleeveLong", "knit", "top", 0.009], ["collarHigh", "knit", "top", 0.012]],
  dress: [["torsoTank", "cotton", "top", 0.003]],
  suit: [["torso", "cotton", "top", 0.009], ["sleeveLong", "cotton", "top", 0.008]],
  tank: [["torsoTank", "cotton", "top", 0.003]],
  sweater: [["torso", "knit", "top", 0.008], ["sleeveLong", "knit", "top", 0.007], ["collarHigh", "knit", "top", 0.008]],
  overalls: [["torso", "cotton", "top", 0.0035], ["sleeveShort", "cotton", "top", 0.0035], ["bib", "denim", "bottom", 0.008]],
  robe: [["torso", "knit", "top", 0.012], ["sleeveLong", "knit", "top", 0.011]],
};
const BOTTOM_SPEC = { pants: ["pants", "denim", 0.005], shorts: ["shorts", "denim", 0.005], skirt: ["brief", "cotton", 0.002] };

// ---------------------------------------------------------------- face: eyes, lids, teeth, gums, tongue, brows, facial hair
function roundedBlock(sx, sy, sz, p = 0.45, ws = 12, hs = 10) {
  const g = new THREE.SphereGeometry(1, ws, hs), a = g.attributes.position;
  for (let i = 0; i < a.count; i++) { const f = (v) => Math.sign(v) * Math.pow(Math.abs(v), p); a.setXYZ(i, f(a.getX(i)) * sx, f(a.getY(i)) * sy, f(a.getZ(i)) * sz); }
  g.computeVertexNormals(); return g;
}
function mergeInto(list) {
  const pos = [], nor = [], idx = []; let off = 0;
  for (const { g, m } of list) {
    const gg = g.index ? g : g; const a = gg.attributes.position, n = gg.attributes.normal, nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3();
    for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(m); pos.push(v.x, v.y, v.z); v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z); }
    if (gg.index) for (let i = 0; i < gg.index.count; i++) idx.push(gg.index.getX(i) + off); else for (let i = 0; i < a.count; i++) idx.push(i + off);
    off += a.count;
  }
  const out = new THREE.BufferGeometry(); out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); out.setIndex(idx); return out;
}
// dental arch: 12 teeth per row (incisors → canines → premolars → molars)
function teethRow(upper, origin) {
  const list = [];
  for (let k = 0; k < 12; k++) {
    const t = (k - 5.5) / 5.5, at = Math.abs(t), kind = at < 0.3 ? "inc" : at < 0.5 ? "can" : at < 0.8 ? "pre" : "mol";
    const w = { inc: 0.0034, can: 0.0031, pre: 0.0034, mol: 0.0042 }[kind] * (upper ? 1 : 0.88), h = { inc: 0.0052, can: 0.0056, pre: 0.0046, mol: 0.0042 }[kind] * (upper ? 1 : 0.9), d = { inc: 0.0016, can: 0.0026, pre: 0.0034, mol: 0.0042 }[kind];
    const x = t * 0.0205, z = 0.0838 - at * at * 0.026 - (upper ? 0 : 0.0015);
    const y = upper ? 1.6035 : 1.5925;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x - origin[0], y - origin[1], z - origin[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(upper ? -0.12 : 0.12, Math.atan(t * 1.6) * 0.9, 0)), new THREE.Vector3(1, 1, 1));
    list.push({ g: roundedBlock(w * 0.5, h * 0.5, d * 0.5, 0.42), m });
  }
  const g = mergeInto(list); g.name = upper ? "TeethUpper" : "TeethLower"; return g;
}
function gumArch(upper, origin) {
  const pts = []; for (let k = 0; k <= 16; k++) { const t = (k - 8) / 8; pts.push(new THREE.Vector3(t * 0.022 - origin[0], (upper ? 1.6075 : 1.5885) - origin[1], 0.0832 - t * t * 0.027 - (upper ? 0 : 0.0015) - origin[2])); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.0028, 8, false);
}
const projector = new Map();
function onHead(p, off = 0.0006) { // project a point onto the generated head surface
  if (!projector.has("h")) projector.set("h", sdfFor(BASE_P, "head"));
  const sdf = projector.get("h"), q = new Float32Array(p); project(sdf, q, 3); const g = grad(sdf, q[0], q[1], q[2]);
  return { p: [q[0] + g[0] * off, q[1] + g[1] * off, q[2] + g[2] * off], n: g };
}
function browCards(style, seed) {
  const R = rng(seed), cards = [], arch = { flat: 0.001, arched: 0.005, angry: -0.004, worried: 0.002, thick: 0.002 }[style] ?? 0.002, thick = style === "thick" ? 1.8 : 1, tilt = { angry: -0.006, worried: 0.006 }[style] || 0;
  for (const s of [1, -1]) for (let i = 0; i < 70 * thick; i++) {
    const u = R(), x = s * (0.014 + u * 0.038), y = 1.6835 + Math.sin(u * Math.PI) * arch + (1 - u) * tilt * -1 + (u * tilt) + (R() - 0.5) * 0.004 * thick * (1 - u * 0.5);
    const { p, n } = onHead([x, y, 0.1], 0.0004); const dir = v3.norm([s * (0.6 + u * 0.3), 0.35 - u * 0.5, 0]);
    const ln = 0.006 + R() * 0.004, pts = [p, v3.add(v3.add(p, v3.mul(dir, ln * 0.5)), v3.mul(n, 0.0006)), v3.add(v3.add(p, v3.mul(dir, ln)), v3.mul(n, 0.0004))];
    cards.push({ pts, w: 0.0012 * thick, nrm: n });
  }
  return cards;
}
function facialHair(kind, seed, jawSide) {
  const R = rng(seed), cards = [];
  const N = kind === "beard" ? 900 : 260;
  for (let i = 0; i < N; i++) {
    let x, y;
    if (kind === "beard") { const a = (R() - 0.5) * 2.6; x = Math.sin(a) * 0.07; y = 1.535 + R() * 0.075 - Math.abs(Math.sin(a)) * -0.03; if (Math.abs(x) < 0.03 && y > 1.585 && y < 1.612) continue; if (y > 1.63 - Math.abs(x) * 0.3) continue; }
    else { x = (R() - 0.5) * 0.054; y = 1.6045 + R() * 0.01 - Math.abs(x) * 0.15; }
    const { p, n } = onHead([x * 1.2, y, 0.13], 0.0003);
    if (n[2] < -0.2 && kind === "beard") continue;
    const jaw = y < 1.5985; if (jawSide !== undefined && jaw !== jawSide) continue;
    const ln = kind === "beard" ? 0.008 + R() * 0.008 : 0.006 + R() * 0.004, dir = v3.norm(v3.add([0, -1, 0.15], v3.mul(n, 0.6)));
    cards.push({ pts: [p, v3.add(p, v3.mul(dir, ln * 0.5)), v3.add(p, v3.mul(dir, ln))], w: 0.0026, nrm: n });
  }
  return cards;
}

// ---------------------------------------------------------------- poses (procedural clips)
let CURL = null;
function curlAxes() {
  if (CURL) return CURL; const J = joints(BASE_P); CURL = {};
  for (const L of ["L", "R"]) { const H = J.hand[L]; for (const f of ["thumb", "index", "middle", "ring", "pinky"]) for (let k = 0; k < 3; k++) { const pts = H.fingers[f].pts, d = v3.norm(v3.sub(pts[k + 1], pts[k])); CURL[f + (k + 1) + L] = new THREE.Vector3(...v3.norm(v3.cross(d, H.m))); } }
  return CURL;
}
const qa = (axis, ang) => new THREE.Quaternion().setFromAxisAngle(axis, ang);
const qe = (x, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "XYZ"));
export const POSES = ["idle", "walk", "sit", "lie", "paint", "shower"];
// returns { q: {bone: Quaternion}, py: pelvis height offset, pz }
export function poseAt(pose, t, o = {}) {
  if (pose === "rest") return { q: {}, py: 0, pz: 0 };
  const A = curlAxes(), q = {}, set = (b, x, y, z) => { q[b] = qe(x, y, z); };
  const ph = t * 2 * Math.PI, gripL = o.gripL ?? 0, gripR = o.gripR ?? 0;
  let py = 0, pz = 0;
  const breathe = Math.sin(t * 1.6) * 0.012;
  set("spine2", breathe * 0.5); set("chest", -breathe);
  for (const [L, s] of [["L", 1], ["R", -1]]) { set("upperarm" + L, 0.02, 0, -s * 0.16); set("forearm" + L, -0.18, s * 0.25, 0); set("hand" + L, 0, 0, -s * 0.05); }
  const curl = (L, amt, thumb) => { for (const f of ["index", "middle", "ring", "pinky"]) for (let k = 1; k <= 3; k++) q[f + k + L] = qa(A[f + k + L], amt * [0.95, 1.1, 0.75][k - 1] * (1 + (f === "pinky" ? 0.12 : 0))); for (let k = 1; k <= 3; k++) q["thumb" + k + L] = qa(A["thumb" + k + L], thumb * [0.35, 0.6, 0.7][k - 1]); };
  curl("L", 0.18 + gripL * 0.9, 0.15 + gripL * 0.85); curl("R", 0.18 + gripR * 0.9, 0.15 + gripR * 0.85);
  if (pose === "walk") {
    const w = Math.sin(ph * 1.6), c = Math.cos(ph * 1.6);
    set("thighL", -w * 0.5); set("thighR", w * 0.5); set("shinL", Math.max(0, c) * 0.75 + 0.06); set("shinR", Math.max(0, -c) * 0.75 + 0.06);
    set("footL", w * 0.18); set("footR", -w * 0.18);
    for (let k = 1; k <= 5; k++) { set("toe" + k + "L", Math.max(0, w) * -0.4); set("toe" + k + "R", Math.max(0, -w) * -0.4); }
    set("upperarmL", w * 0.42, 0, -0.14); set("upperarmR", -w * 0.42, 0, 0.14); set("forearmL", -0.3 - Math.max(0, w) * 0.3, 0.25, 0); set("forearmR", -0.3 - Math.max(0, -w) * 0.3, -0.25, 0);
    set("pelvis", 0, w * 0.08, 0); set("spine2", 0.03, -w * 0.06, 0); set("chest", -0.02, -w * 0.05, 0); py = Math.abs(c) * 0.02 - 0.015;
  } else if (pose === "sit") {
    set("thighL", -1.52, 0, 0.06); set("thighR", -1.52, 0, -0.06); set("shinL", 1.5); set("shinR", 1.5); set("footL", 0.02); set("footR", 0.02);
    set("upperarmL", -0.25, 0, -0.12); set("upperarmR", -0.25, 0, 0.12); set("forearmL", -0.9, 0.3, 0); set("forearmR", -0.9, -0.3, 0); set("spine1", 0.05);
    py = -0.46; pz = 0.02;
  } else if (pose === "lie") {
    set("upperarmL", 0.05, 0, -0.05); set("upperarmR", 0.05, 0, 0.05); set("head", -0.1);
  } else if (pose === "paint") {
    set("upperarmR", -1.25 + (o.reduce ? 0 : Math.sin(ph * 0.7) * 0.2), 0.2, 0.25); set("forearmR", -0.5, -0.3, 0); set("handR", 0.25, 0, 0);
    curl("R", 1.0, 0.9); set("chest", 0, -0.08, 0); set("head", 0.06, -0.1, 0);
  } else if (pose === "shower") {
    const w = o.reduce ? 0 : Math.sin(ph * 2) * 0.1;
    set("upperarmL", -2.5 + w, 0, -0.3); set("upperarmR", -2.5 - w, 0, 0.3); set("forearmL", -1.1, 0.3, 0); set("forearmR", -1.1, -0.3, 0); set("head", -0.2);
  } else {
    set("head", Math.sin(t * 0.4) * 0.03, Math.sin(t * 0.27) * 0.08, 0); set("pelvis", 0, 0, Math.sin(t * 0.5) * 0.01);
  }
  return { q, py, pz };
}
export function makeClips(dur = 2) {
  const clips = [];
  for (const pose of POSES) {
    const D = pose === "walk" ? 1.25 : dur * 2, times = [], N = 30, tracks = {}, py = [];
    for (let i = 0; i <= N; i++) { const t = (i / N) * D; times.push(t); const P = poseAt(pose, t); for (const [b, qq] of Object.entries(P.q)) (tracks[b] ||= []).push(qq.x, qq.y, qq.z, qq.w); py.push(0, 0.97 + P.py, P.pz); }
    const tr = Object.entries(tracks).map(([b, v]) => new THREE.QuaternionKeyframeTrack(b + ".quaternion", times, v));
    tr.push(new THREE.VectorKeyframeTrack("pelvis.position", times, py));
    clips.push(new THREE.AnimationClip(pose, D, tr));
  }
  return clips;
}

// ---------------------------------------------------------------- build a whole Sim
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function morphInfluencesFor(sim) {
  const m = { ...(sim.morph || {}) };
  if (m.weight == null && sim.build != null) m.weight = typeof sim.build === "number" ? clamp((sim.build - 1) * 3.2, -1, 1.5) : { slim: -0.6, average: 0, sturdy: 0.7, athletic: 0, heavy: 1 }[sim.build] ?? 0;
  if (m.muscle == null && sim.build === "athletic") m.muscle = 0.8;
  if (m.chest == null) m.chest = sim.outfit === "dress" ? 0.6 : 0;
  for (const k of Object.keys(m)) m[k] = clamp(+m[k] || 0, -1, 1.6);
  return m;
}
const stdMat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: o.rough ?? 0.5, metalness: o.metal ?? 0, name: o.name || "Mat", ...(o.extra || {}) });
function childAt(bone, J, name, geom, mat, world, meshName) {
  const m = new THREE.Mesh(geom, mat), o = restWorld(J, name); m.position.set(world[0] - o[0], world[1] - o[1], world[2] - o[2]); if (meshName) m.name = meshName; bone.add(m); return m;
}
const darken = (c, k) => "#" + new THREE.Color(c).multiplyScalar(k).getHexString();
export function buildBody(sim, opts = {}) {
  const lod = opts.lod || "med", hi = !!opts.hi, base = baseFor(lod), J = base.J;
  const root = new THREE.Group(); root.name = "Sim_" + String(sim.name || "Sim").replace(/\W+/g, "_");
  const { bones, skeleton, root: rb } = makeSkeleton(J); root.add(rb);
  const B = Object.fromEntries(bones.map((b) => [b.name, b]));
  const inf = morphInfluencesFor(sim), D = opts.deltas ? transferDeltas(opts.deltas, "med", lod) : {};
  const skin = skinMat(sim.skin || "#e8b48f", hi), skinned = [], parts = {}, garments = [];
  for (const part of PARTS) {
    const m = new THREE.SkinnedMesh(partGeometry(base.parts[part], D[part]), skin); m.name = "SimPart_" + part; applyMorphs(m, inf);
    root.add(m); parts[part] = m; skinned.push(m);
  }
  const tex = opts.tex || null, pat = sim.pattern && sim.pattern !== "solid" && tex ? tex("pat_" + sim.pattern, 7, sim.top || "#3a6ea5", sim.pat2 || darken(sim.top || "#3a6ea5", 0.5)) : null;
  const colors = { top: sim.top || "#3a6ea5", bottom: sim.bottom || "#2b2724" };
  const garment = (part, region, kind, color, thick, smooth, map, layer = 1) => {
    const g = shellGeometry(base, part, regionMask(base, part, region), thick, smooth); if (!g) return;
    refitShell(g, parts[part].geometry);
    let mat = fabricMat(kind, map ? "#ffffff" : color, map, hi);
    if (layer > 1) { mat = mat.clone(); mat.polygonOffset = true; mat.polygonOffsetFactor = -layer; mat.polygonOffsetUnits = -layer; }
    const m = new THREE.SkinnedMesh(g, mat); m.name = "Cloth_" + region + "_" + part; applyMorphs(m, inf); root.add(m); skinned.push(m); garments.push(m);
  };
  const outfit = OUTFIT_SPEC[sim.outfit] ? sim.outfit : "tee", bstyle = sim.bottomStyle || (outfit === "dress" ? "skirt" : "pants");
  if (!(outfit === "dress" || outfit === "robe")) { const [reg, kind, th] = BOTTOM_SPEC[bstyle] || BOTTOM_SPEC.pants; garment("body", reg, kind, colors.bottom, th, 0, null, 1); }
  OUTFIT_SPEC[outfit].forEach(([reg, kind, ck, th], i) => garment("body", reg, kind, colors[ck], th + (reg === "bib" ? 0.004 : 0), 0, ck === "top" ? pat : null, reg === "bib" ? 3 : 2));
  for (const s of ["L", "R"]) garment("foot" + s, "shoes", "leather", sim.shoes || "#1d1a18", (x, y) => 0.0065 + (y < 0.022 ? (0.022 - y) * 0.45 : 0), 2);
  const A = new Set(sim.acc || []);
  if (A.has("gloves")) for (const s of ["L", "R"]) garment("hand" + s, "gloves", "leather", sim.accColor || "#3a2a20", 0.0013, 0);
  const skirtLen = outfit === "robe" ? 0.8 : outfit === "dress" ? 0.5 : bstyle === "skirt" ? 0.36 : 0;
  if (skirtLen) {
    const sm = new THREE.SkinnedMesh(skirtGeometry(J, skirtLen, outfit === "robe" ? 0.35 : 0.6), fabricMat(outfit === "dress" || outfit === "robe" ? "cotton" : "denim", outfit === "dress" || outfit === "robe" ? (pat ? "#ffffff" : colors.top) : colors.bottom, outfit === "dress" ? pat : null, hi).clone());
    sm.material.side = THREE.DoubleSide; sm.name = "Cloth_skirt"; root.add(sm); skinned.push(sm); garments.push(sm);
  }
  root.updateMatrixWorld(true);
  skeleton.calculateInverses(); // bind inverses from the real rest pose (bone matrixWorld is only valid now)
  for (const m of skinned) { m.bind(skeleton, new THREE.Matrix4()); m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; }
  // eyes (iris / pupil / cornea), lids, teeth, gums, tongue
  const ey = 1 + 0.1 * (inf.eyes || 0);
  for (const L of ["L", "R"]) {
    const eg = new THREE.SphereGeometry(0.0122 * ey, hi ? 32 : 20, hi ? 24 : 14), p = eg.attributes.position, uv = eg.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getX(i) / (0.0122 * ey) * 0.5, 0.5 + p.getY(i) / (0.0122 * ey) * 0.5 * (p.getZ(i) > 0 ? 1 : 0) + (p.getZ(i) > 0 ? 0 : 0.49));
    const eye = new THREE.Mesh(eg, new THREE.MeshPhysicalMaterial({ map: irisTex(sim.eyes || "#4a3420"), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, name: "Eye" })); eye.name = "Eye_" + L; B["eye" + L].add(eye);
    if (hi) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.0072 * ey, 24, 12, 0, Math.PI * 2, 0, 1.0), new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.12, roughness: 0, clearcoat: 1, specularIntensity: 1, name: "Cornea" })); c.rotation.x = Math.PI / 2; c.position.z = 0.0122 * ey - 0.0072 * ey * 0.62; c.name = "Cornea_" + L; eye.add(c); }
    const lg = new THREE.SphereGeometry(0.0129 * ey, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2); lg.rotateX(0); lg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(lg.attributes.position.count * 3).fill(0.93), 3));
    const lid = new THREE.Mesh(lg, skin); lid.name = "Eyelid_" + L; B["lid" + L].add(lid); B["lid" + L].rotation.x = -0.5;
  }
  const toothMat = new THREE.MeshPhysicalMaterial({ color: "#f3efe4", roughness: 0.25, clearcoat: 0.5, name: "Teeth" }), gumMat = stdMat("#b85a5c", { rough: 0.4, name: "Gums" });
  const tu = new THREE.Mesh(teethRow(true, J.head), toothMat); tu.name = "Teeth_Upper"; tu.userData.count = 12; B.head.add(tu);
  const tl = new THREE.Mesh(teethRow(false, J.jaw), toothMat); tl.name = "Teeth_Lower"; tl.userData.count = 12; B.jaw.add(tl);
  const gu = new THREE.Mesh(gumArch(true, J.head), gumMat); gu.name = "Gums_Upper"; B.head.add(gu);
  const gl = new THREE.Mesh(gumArch(false, J.jaw), gumMat); gl.name = "Gums_Lower"; B.jaw.add(gl);
  const tg = childAt(B.jaw, J, "jaw", new THREE.SphereGeometry(1, 24, 14), stdMat("#c4606a", { rough: 0.45, name: "Tongue" }), [0, 1.5905, 0.064], "Tongue"); tg.scale.set(0.0175, 0.0055, 0.024);
  // hair, brows, facial hair
  const hc = sim.hair || "#4a2e1a", style = sim.hairStyle || "short", seed = [...String(sim.id || sim.name || "s")].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  if (style === "buzz") { const b = scalpShell(J.head, 0.0012, hc, 0.25); b.name = "Hair"; B.head.add(b); }
  else if (style !== "bald") {
    const under = scalpShell(J.head, 0.0015, darken(hc, 0.8), 0.25); under.name = "HairBase"; B.head.add(under);
    const h = new THREE.Mesh(cardsGeometry(hairStrands(style, LODS[lod].hair, seed), J.head), hairMat(hc, hi)); h.name = "Hair"; h.castShadow = true; B.head.add(h);
  }
  const bm = new THREE.Mesh(cardsGeometry(browCards(sim.brows || "flat", seed + 1), J.head), hairMat(sim.brows === "thick" ? hc : darken(hc, 0.6), hi)); bm.name = "Brows"; B.head.add(bm);
  for (const kind of ["beard", "mustache"]) if (A.has(kind)) {
    const top = new THREE.Mesh(cardsGeometry(facialHair(kind, seed + 2, false), J.head), hairMat(hc, hi)); top.name = kind; B.head.add(top);
    const low = new THREE.Mesh(cardsGeometry(facialHair(kind, seed + 2, true), J.jaw), hairMat(hc, hi)); low.name = kind + "_jaw"; B.jaw.add(low);
  }
  addAccessories(A, sim, B, J);
  root.traverse((c) => { if (c.isMesh) c.castShadow = true; });
  root.userData.body = { lod, hi, base, parts, garments, bones: B, skeleton, deltas: Object.fromEntries(PARTS.map((p) => [p, D[p] || new Float32Array(base.parts[p].n * 3)])), inf };
  root.userData.anim = { t: Math.random() * 10, blinkT: 1 + Math.random() * 3, blink: 0, sv: 0, sx: 0, look: [0, 0], lookT: 0 };
  root.scale.setScalar((sim.height || 1) * 0.97);
  return root;
}
function addAccessories(A, sim, B, J) {
  const acc = sim.accColor || "#c9a227", gold = stdMat("#d4af37", { metal: 0.9, rough: 0.25, name: "Gold" }), am = stdMat(acc, { rough: 0.5, name: "Accessory" });
  const at = (bone, g, m, w, name) => childAt(B[bone], J, bone, g, m, w, name);
  if (A.has("glasses") || A.has("sunglasses")) {
    const fm = stdMat(A.has("sunglasses") ? "#111" : acc, { metal: 0.4, rough: 0.3, name: "Glasses" });
    for (const s of [1, -1]) { at("head", new THREE.TorusGeometry(0.0205, 0.0018, 8, 32), fm, [s * 0.034, 1.667, 0.097], "Glasses"); if (A.has("sunglasses")) at("head", new THREE.CircleGeometry(0.02, 24), stdMat("#0b0b0b", { rough: 0.05, metal: 0.5 }), [s * 0.034, 1.667, 0.0965]); const tmp = at("head", new THREE.CylinderGeometry(0.0013, 0.0013, 0.09, 6), fm, [s * 0.072, 1.67, 0.05]); tmp.rotation.x = Math.PI / 2; }
    const br = at("head", new THREE.CylinderGeometry(0.0015, 0.0015, 0.016, 6), fm, [0, 1.671, 0.1]); br.rotation.z = Math.PI / 2;
  }
  if (A.has("hat")) { at("head", new THREE.CylinderGeometry(0.17, 0.17, 0.008, 40), am, [0, 1.745, -0.01]); at("head", new THREE.CylinderGeometry(0.088, 0.094, 0.1, 32), am, [0, 1.795, -0.012]); }
  if (A.has("beanie")) { const b = at("head", new THREE.SphereGeometry(0.106, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), stdMat(acc, { rough: 0.95, name: "Beanie" }), [0, 1.69, -0.012]); b.scale.set(0.82, 1.05, 1.02); }
  if (A.has("cap")) { const c = at("head", new THREE.SphereGeometry(0.104, 32, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), am, [0, 1.7, -0.012]); c.scale.set(0.84, 0.95, 1.02); const v = at("head", new THREE.CylinderGeometry(0.07, 0.07, 0.006, 24, 1, false, -Math.PI / 2, Math.PI), am, [0, 1.71, 0.08]); v.rotation.x = 0.12; }
  if (A.has("crown")) { at("head", new THREE.CylinderGeometry(0.072, 0.072, 0.035, 24, 1, true), gold, [0, 1.79, -0.01]); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; at("head", new THREE.ConeGeometry(0.01, 0.03, 4), gold, [Math.sin(a) * 0.072, 1.82, -0.01 + Math.cos(a) * 0.072]); } }
  if (A.has("headphones")) { const band = at("head", new THREE.TorusGeometry(0.093, 0.006, 8, 40, Math.PI), am, [0, 1.67, -0.005]); band.scale.y = 1.25; for (const s of [1, -1]) { const e = at("head", new THREE.CylinderGeometry(0.03, 0.03, 0.022, 24), am, [s * 0.09, 1.665, -0.005]); e.rotation.z = Math.PI / 2; } }
  if (A.has("earrings")) for (const s of [1, -1]) at("head", new THREE.TorusGeometry(0.006, 0.0012, 6, 16), gold, [s * 0.086, 1.624, -0.002]);
  if (A.has("necklace")) { const n = at("chest", new THREE.TorusGeometry(0.068, 0.0022, 6, 48), gold, [0, 1.405, 0.02]); n.rotation.x = 1.25; }
  if (A.has("scarf")) { const n = at("neck", new THREE.TorusGeometry(0.06, 0.022, 12, 32), stdMat(acc, { rough: 0.95, name: "Scarf" }), [0, 1.47, 0.005]); n.rotation.x = Math.PI / 2 - 0.15; }
  if (A.has("backpack")) { const g = roundedBlock(0.13, 0.17, 0.06, 0.3, 16, 12); at("chest", g, am, [0, 1.24, -0.17], "Backpack"); }
  if (A.has("bowtie")) for (const s of [1, -1]) { const c = at("neck", new THREE.ConeGeometry(0.014, 0.03, 4), am, [s * 0.014, 1.43, 0.075]); c.rotation.z = s * Math.PI / 2; }
}

// ---------------------------------------------------------------- per-frame animation: clips, crossfade, cloth sway, blink, look-at, jaw
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), IDQ = new THREE.Quaternion();
export function animate(root, pose, dt, reduce, o = {}) {
  const body = root.userData.body; if (!body) return; const S = root.userData.anim, B = body.bones, J = body.base.J;
  S.t += dt; const P = poseAt(pose, S.t, { reduce, gripL: o.gripL, gripR: o.gripR }), k = o.snap ? 1 : 1 - Math.exp(-dt * 9);
  for (const name in B) {
    if (/^(eye|lid)[LR]$|^jaw$|^sway$/.test(name)) continue;
    B[name].quaternion.slerp(P.q[name] || IDQ, k);
  }
  B.pelvis.position.y += (J.pelvis[1] + P.py - B.pelvis.position.y) * k; B.pelvis.position.z += (P.pz - B.pelvis.position.z) * k;
  // cloth: spring on sway bone driven by gait / pelvis turn
  const tgt = pose === "walk" && !reduce ? -0.1 + Math.sin(S.t * 2 * Math.PI * 1.6 * 2) * 0.05 : pose === "sit" ? -0.9 : 0;
  S.sv += ((tgt - S.sx) * 60 - S.sv * 8) * Math.min(dt, 0.05); S.sx += S.sv * Math.min(dt, 0.05); B.sway.rotation.x = S.sx;
  // blink
  S.blinkT -= dt; if (S.blinkT < 0) { S.blink = 0.16; S.blinkT = 2 + Math.random() * 4; }
  let b = 0; if (S.blink > 0) { S.blink -= dt; b = Math.sin(clamp(1 - S.blink / 0.16, 0, 1) * Math.PI); }
  if (o.eyesClosed || pose === "lie") b = 1;
  // look-at (world target) or idle saccades
  let yaw = 0, pitch = 0;
  if (o.lookAt) {
    root.updateMatrixWorld(true); _v.copy(o.lookAt); B.head.worldToLocal(_v); const e = B.eyeL.position;
    const dx = _v.x - e.x * 0, dy = _v.y - e.y, dz = _v.z - e.z; yaw = clamp(Math.atan2(dx, dz), -0.55, 0.55); pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.4, 0.4);
  } else { S.lookT -= dt; if (S.lookT < 0) { S.look = reduce ? [0, 0] : [(Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.15]; S.lookT = 0.6 + Math.random() * 2.2; } [yaw, pitch] = S.look; }
  for (const L of ["L", "R"]) { B["eye" + L].rotation.set(-pitch, yaw, 0); B["lid" + L].rotation.x = -0.5 - pitch * 0.35 + b * 0.95; }
  // jaw: explicit mouth value, or talking
  const open = o.mouth != null ? o.mouth : o.talk && !reduce ? 0.25 + 0.25 * Math.sin(S.t * 13) * Math.sin(S.t * 3.1) : 0;
  B.jaw.rotation.x += (clamp(open, 0, 1) * 0.36 - B.jaw.rotation.x) * (o.snap ? 1 : 1 - Math.exp(-dt * 18));
}

// ---------------------------------------------------------------- sculpting (vertex deltas on every part: body, face, hands, feet)
export const BRUSHES = ["inflate", "deflate", "grab", "smooth", "pinch", "flatten"];
export class Sculptor {
  constructor(root) { this.root = root; this.body = root.userData.body; this.undoStack = []; this.dirty = false; }
  begin() { this.undoStack.push(Object.fromEntries(PARTS.map((p) => [p, this.body.deltas[p].slice()]))); if (this.undoStack.length > 30) this.undoStack.shift(); }
  get canUndo() { return this.undoStack.length > 0; }
  undo() { const s = this.undoStack.pop(); if (!s) return false; for (const p of PARTS) this.body.deltas[p].set(s[p]); this.refresh(PARTS); return true; }
  reset() { this.begin(); for (const p of PARTS) this.body.deltas[p].fill(0); this.refresh(PARTS); }
  // worldPoint: brush centre (THREE.Vector3), drag: world-space motion for grab; radius in metres (world)
  apply(worldPoint, o = {}) {
    const sc = this.root.scale.x || 1, c = this.root.worldToLocal(worldPoint.clone()), r = (o.radius || 0.03) / sc, st = o.strength ?? 0.5;
    let drag = null; if (o.drag) { const a = this.root.worldToLocal(worldPoint.clone().add(o.drag)); drag = a.sub(c); }
    const touched = new Set();
    const one = (cx, cy, cz, dg) => { for (const p of PARTS) if (this.stroke(p, cx, cy, cz, r, st, o.brush || "inflate", dg)) touched.add(p); };
    one(c.x, c.y, c.z, drag);
    if (o.mirror && Math.abs(c.x) > r * 0.25) one(-c.x, c.y, c.z, drag ? new THREE.Vector3(-drag.x, drag.y, drag.z) : null);
    this.refresh([...touched]); if (touched.size) this.dirty = true; return touched.size > 0;
  }
  stroke(part, cx, cy, cz, r, st, brush, drag) {
    const P = this.body.base.parts[part], d = this.body.deltas[part], g = this.body.parts[part].geometry, pa = g.attributes.position.array, na = g.attributes.normal.array, r2 = r * r;
    const hit = []; for (let i = 0; i < P.n; i++) { const dx = pa[i * 3] - cx, dy = pa[i * 3 + 1] - cy, dz = pa[i * 3 + 2] - cz, q = dx * dx + dy * dy + dz * dz; if (q < r2) { const f = 1 - q / r2; hit.push(i, f * f); } }
    if (!hit.length) return false;
    let ax = 0, ay = 0, az = 0, px = 0, py = 0, pz = 0, wsum = 0;
    for (let h = 0; h < hit.length; h += 2) { const i = hit[h], w = hit[h + 1]; ax += na[i * 3] * w; ay += na[i * 3 + 1] * w; az += na[i * 3 + 2] * w; px += pa[i * 3] * w; py += pa[i * 3 + 1] * w; pz += pa[i * 3 + 2] * w; wsum += w; }
    const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al; px /= wsum; py /= wsum; pz /= wsum;
    const amt = st * r * 0.12;
    for (let h = 0; h < hit.length; h += 2) {
      const i = hit[h], w = hit[h + 1], o3 = i * 3; let mx = 0, my = 0, mz = 0;
      switch (brush) {
        case "inflate": case "deflate": { const s = brush === "inflate" ? 1 : -1; mx = na[o3] * amt * w * s; my = na[o3 + 1] * amt * w * s; mz = na[o3 + 2] * amt * w * s; break; }
        case "grab": if (drag) { mx = drag.x * w * st; my = drag.y * w * st; mz = drag.z * w * st; } break;
        case "smooth": { const nb = P.nbr[i]; if (!nb || !nb.length) break; let sx = 0, sy = 0, sz = 0; for (const j of nb) { sx += pa[j * 3]; sy += pa[j * 3 + 1]; sz += pa[j * 3 + 2]; } const l = nb.length, k = w * st * 0.6; mx = (sx / l - pa[o3]) * k; my = (sy / l - pa[o3 + 1]) * k; mz = (sz / l - pa[o3 + 2]) * k; break; }
        case "pinch": { const k = w * st * 0.15; mx = (cx - pa[o3]) * k; my = (cy - pa[o3 + 1]) * k; mz = (cz - pa[o3 + 2]) * k; const dn = mx * na[o3] + my * na[o3 + 1] + mz * na[o3 + 2]; mx -= na[o3] * dn; my -= na[o3 + 1] * dn; mz -= na[o3 + 2] * dn; break; }
        case "flatten": { const dist = (pa[o3] - px) * ax + (pa[o3 + 1] - py) * ay + (pa[o3 + 2] - pz) * az, k = w * st * 0.5; mx = -ax * dist * k; my = -ay * dist * k; mz = -az * dist * k; break; }
      }
      d[o3] = clamp(d[o3] + mx, -0.08, 0.08); d[o3 + 1] = clamp(d[o3 + 1] + my, -0.08, 0.08); d[o3 + 2] = clamp(d[o3 + 2] + mz, -0.08, 0.08);
    }
    return true;
  }
  refresh(parts) { for (const p of parts) applyDeltas(this.root, p); }
}
export function applyDeltas(root, part) {
  const body = root.userData.body, P = body.base.parts[part], d = body.deltas[part], g = body.parts[part].geometry, pa = g.attributes.position.array;
  for (let i = 0; i < pa.length; i++) pa[i] = P.pos[i] + d[i];
  g.attributes.position.needsUpdate = true;
  if (hasDelta(d)) g.computeVertexNormals(); else { g.attributes.normal.array.set(P.nor); g.attributes.normal.needsUpdate = true; }
  for (const m of body.garments) if (m.geometry.userData.shell && m.geometry.userData.shell.part === part) refitShell(m.geometry, g);
}
export function setMorph(root, key, value) {
  const body = root.userData.body; body.inf[key] = value;
  root.traverse((m) => { if (m.isSkinnedMesh && m.morphTargetDictionary && key in m.morphTargetDictionary) m.morphTargetInfluences[m.morphTargetDictionary[key]] = value; });
}
// nearest-vertex transfer between LODs (saves always use the "med" layout)
export function transferDeltas(D, from, to) {
  if (!D) return {}; if (from === to) return D;
  const A = baseFor(from), Bb = baseFor(to), out = {};
  for (const p of PARTS) {
    const src = D[p]; if (!src || !hasDelta(src)) continue; const T = Bb.parts[p], o = new Float32Array(T.n * 3);
    for (let i = 0; i < T.n; i++) { const j = A.parts[p].hash.near(T.pos[i * 3], T.pos[i * 3 + 1], T.pos[i * 3 + 2]); if (j >= 0) { o[i * 3] = src[j * 3]; o[i * 3 + 1] = src[j * 3 + 1]; o[i * 3 + 2] = src[j * 3 + 2]; } }
    out[p] = o;
  }
  return out;
}
export function currentDeltasMed(root) { const b = root.userData.body; return transferDeltas(b.deltas, b.lod, "med"); }
// compact encoding: [u32 count][u32 part<<24|idx, i16 dx,dy,dz @0.1mm]* → deflate-raw → base64
const b64 = { enc: (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }, dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) };
async function pipe(u8, Stream, fmt) { const r = new Response(new Blob([u8]).stream().pipeThrough(new Stream(fmt))); return new Uint8Array(await r.arrayBuffer()); }
export const SCULPT_MAX = 120000;
export async function encodeSculpt(Dmed) {
  const rows = [];
  PARTS.forEach((p, pi) => { const d = Dmed[p]; if (!d) return; for (let i = 0; i < d.length / 3; i++) { const x = Math.round(d[i * 3] * 1e4), y = Math.round(d[i * 3 + 1] * 1e4), z = Math.round(d[i * 3 + 2] * 1e4); if (x || y || z) rows.push([(pi << 24) | i, x, y, z]); } });
  if (!rows.length) return "";
  const buf = new DataView(new ArrayBuffer(4 + rows.length * 10)); buf.setUint32(0, rows.length, true);
  rows.forEach(([k, x, y, z], i) => { const o = 4 + i * 10; buf.setUint32(o, k >>> 0, true); buf.setInt16(o + 4, clamp(x, -32767, 32767), true); buf.setInt16(o + 6, clamp(y, -32767, 32767), true); buf.setInt16(o + 8, clamp(z, -32767, 32767), true); });
  const raw = new Uint8Array(buf.buffer);
  if (typeof CompressionStream !== "undefined") { try { return "z1:" + b64.enc(await pipe(raw, CompressionStream, "deflate-raw")); } catch {} }
  return "r1:" + b64.enc(raw);
}
export async function decodeSculpt(str) {
  if (!str || typeof str !== "string") return null;
  let raw = b64.dec(str.slice(3)); if (str.startsWith("z1:")) raw = await pipe(raw, DecompressionStream, "deflate-raw");
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), n = dv.getUint32(0, true), base = baseFor("med"), D = {};
  for (let i = 0; i < n; i++) { const o = 4 + i * 10, k = dv.getUint32(o, true), p = PARTS[k >>> 24], v = k & 0xffffff; if (!p || v >= base.parts[p].n) continue; const d = (D[p] ||= new Float32Array(base.parts[p].n * 3)); d[v * 3] = dv.getInt16(o + 4, true) / 1e4; d[v * 3 + 1] = dv.getInt16(o + 6, true) / 1e4; d[v * 3 + 2] = dv.getInt16(o + 8, true) / 1e4; }
  return D;
}
const sculptCache = new Map();
export function cachedSculpt(str) { return str ? sculptCache.get(str) : null; }
export async function loadSculpt(str) { if (!str) return null; if (sculptCache.has(str)) return sculptCache.get(str); const D = await decodeSculpt(str); sculptCache.set(str, D); if (sculptCache.size > 40) sculptCache.delete(sculptCache.keys().next().value); return D; }
export function rememberSculpt(str, D) { if (str) sculptCache.set(str, D); }
// .glb round trip: export keeps SimPart_<part> meshes (+ _vid ids + morph names); import recovers deltas + morphs
export function fromImported(obj) {
  const found = {}, morph = {}; let any = false;
  obj.traverse((m) => { if (!m.isMesh) return; const nm = (m.name || "").replace(/[^A-Za-z0-9_]/g, ""); const k = PARTS.find((p) => nm === "SimPart_" + p || nm.startsWith("SimPart_" + p + "_") || nm.endsWith("SimPart_" + p)); if (k && !found[k]) { found[k] = m; any = true; } });
  if (!any) return null;
  const D = {};
  for (const p of PARTS) {
    const m = found[p]; if (!m) continue; const pos = m.geometry.attributes.position, nv = pos.count;
    const matched = Object.keys(LODS).find((l) => baseFor(l).parts[p].n === nv), lod = matched || "med", base = baseFor(lod).parts[p];
    const vidA = Object.entries(m.geometry.attributes).find(([k]) => /vid/i.test(k)); const d = new Float32Array(base.n * 3);
    for (let i = 0; i < nv; i++) { const v = vidA ? Math.round(vidA[1].getX(i)) : matched ? i : base.hash.near(pos.getX(i), pos.getY(i), pos.getZ(i)); if (v < 0 || v >= base.n) continue; d[v * 3] = pos.getX(i) - base.pos[v * 3]; d[v * 3 + 1] = pos.getY(i) - base.pos[v * 3 + 1]; d[v * 3 + 2] = pos.getZ(i) - base.pos[v * 3 + 2]; }
    for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) < 2e-5) d[i] = 0;
    D[p] = transferDeltas({ [p]: d }, lod, "med")[p] || new Float32Array(baseFor("med").parts[p].n * 3);
    if (m.morphTargetDictionary && m.morphTargetInfluences) for (const [k, i] of Object.entries(m.morphTargetDictionary)) if (MORPHS.includes(k) && m.morphTargetInfluences[i]) morph[k] = +m.morphTargetInfluences[i].toFixed(3);
  }
  return { deltas: D, morph };
}

// ---------------------------------------------------------------- automated anatomy check
export function anatomyReport(root) {
  const body = root.userData.body, B = body.bones, J = body.base.J, names = Object.keys(B), has = (n) => !!B[n];
  const parts = body.parts, near = (part, pt, r) => { const a = parts[part].geometry.attributes.position.array; let c = 0; for (let i = 0; i < a.length; i += 3) if ((a[i] - pt[0]) ** 2 + (a[i + 1] - pt[1]) ** 2 + (a[i + 2] - pt[2]) ** 2 < r * r) c++; return c; };
  const fingerBones = (L) => ["index", "middle", "ring", "pinky"].filter((f) => [1, 2, 3].every((k) => has(f + k + L))).length;
  const thumbBones = (L) => [1, 2, 3].filter((k) => has("thumb" + k + L)).length;
  const tips = (L) => ["index", "middle", "ring", "pinky"].filter((f) => near("hand" + L, J[f + "Tip" + L], 0.012) > 3).length;
  const thumbTip = (L) => (near("hand" + L, J["thumbTip" + L], 0.014) > 3 ? 1 : 0);
  const toes = (L) => [1, 2, 3, 4, 5].filter((k) => has("toe" + k + L) && near("foot" + L, J["toeTip" + k + L], 0.016) > 2).length;
  const ears = [1, -1].filter((s) => { const a = parts.head.geometry.attributes.position.array; let c = 0; for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i]) > 0.079 && Math.sign(a[i]) === s && Math.abs(a[i + 1] - 1.66) < 0.03) c++; return c > 20; }).length;
  const meshes = (re) => { let n = 0; root.traverse((m) => { if (m.isMesh && re.test(m.name)) n++; }); return n; };
  const tbones = BONE_NAMES.filter((n) => /^toe\d/.test(n)), toeR = [J.toeTip1L, J.toeTip2L, J.toeTip3L, J.toeTip4L, J.toeTip5L].map((p, i) => TOES[i][0]);
  const hp = parts.head.geometry.attributes.position.array; let chin = 9; for (let i = 0; i < hp.length; i += 3) if (Math.abs(hp[i]) < 0.015 && hp[i + 2] > 0.07) chin = Math.min(chin, hp[i + 1]);
  const tris = Object.fromEntries(PARTS.map((p) => [p, parts[p].geometry.index.count / 3]));
  const R = {
    heightM: +J.headTop[1].toFixed(3), headHeightM: +(J.headTop[1] - chin).toFixed(3), headsTall: +(J.headTop[1] / (J.headTop[1] - chin)).toFixed(2),
    eyes: meshes(/^Eye_[LR]$/), eyelids: meshes(/^Eyelid_/), irisPupilTexture: !!root.getObjectByName("Eye_L")?.material.map, ears, nose: true,
    teethUpper: root.getObjectByName("Teeth_Upper")?.userData.count || 0, teethLower: root.getObjectByName("Teeth_Lower")?.userData.count || 0, tongue: meshes(/^Tongue$/), gums: meshes(/^Gums_/), brows: meshes(/^Brows$/),
    fingers: fingerBones("L") + fingerBones("R"), fingerTipsInMesh: tips("L") + tips("R"), thumbs: (thumbBones("L") === 3 ? 1 : 0) + (thumbBones("R") === 3 ? 1 : 0), thumbTipsInMesh: thumbTip("L") + thumbTip("R"),
    toes: tbones.length, toeTipsInMesh: toes("L") + toes("R"), bigToeLargest: toeR.every((r, i) => i === 0 || r < toeR[i - 1]),
    bones: names.length, spineChain: ["spine1", "spine2", "chest"].filter(has).length, neck: has("neck"), head: has("head"), jaw: has("jaw"), eyeBones: ["eyeL", "eyeR"].filter(has).length, lidBones: ["lidL", "lidR"].filter(has).length, clavicles: ["clavL", "clavR"].filter(has).length,
    arms: ["upperarm", "forearm", "hand"].every((b) => has(b + "L") && has(b + "R")), legs: ["thigh", "shin", "foot"].every((b) => has(b + "L") && has(b + "R")),
    fingerJointBones: BONE_NAMES.filter((n) => /^(index|middle|ring|pinky)\d/.test(n)).length, thumbJointBones: BONE_NAMES.filter((n) => /^thumb\d/.test(n)).length,
    morphTargets: Object.fromEntries(PARTS.map((p) => [p, parts[p].geometry.userData.morphKeys.length])), tris, totalTris: Object.values(tris).reduce((a, b) => a + b, 0), lod: body.lod,
  };
  const checks = [["2 eyes", R.eyes === 2], ["2 eyelids", R.eyelids === 2], ["2 ears", R.ears === 2], ["teeth upper+lower", R.teethUpper > 0 && R.teethLower > 0], ["tongue", R.tongue === 1],
    ["8 fingers", R.fingers === 8 && R.fingerTipsInMesh === 8], ["2 opposable thumbs", R.thumbs === 2 && R.thumbTipsInMesh === 2], ["10 toes", R.toes === 10 && R.toeTipsInMesh === 10], ["big toe largest", R.bigToeLargest],
    ["spine ≥3", R.spineChain >= 3], ["jaw/neck/head", R.jaw && R.neck && R.head], ["eye bones", R.eyeBones === 2], ["clavicles", R.clavicles === 2], ["arms+legs", R.arms && R.legs], ["finger joints 24", R.fingerJointBones === 24], ["thumb joints 6", R.thumbJointBones === 6],
    ["~7.5 heads tall", R.headsTall > 7 && R.headsTall < 8.1]];
  R.checks = Object.fromEntries(checks.map(([k, v]) => [k, v ? "PASS" : "FAIL"])); R.pass = checks.every(([, v]) => v);
  return R;
}
export { OUTFIT_SPEC, BOTTOM_SPEC };
