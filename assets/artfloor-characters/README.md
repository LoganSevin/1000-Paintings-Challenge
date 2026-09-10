# Art Floor characters

Primary: offline **Mixamo-style human GLBs** under `glb/` loaded with Three.js
`GLTFLoader` + `AnimationMixer` (Walk / Idle).

- `glb/Soldier.glb` — **default player** (opaque gold MeshStandardMaterial) + gallery NPC. Native Idle/Walk/Run so arms and legs swing.
- `glb/Xbot.glb` — fallback player / gallery NPC (native idle/walk/run)
- `glb/Michelle.glb` — optional female; only used if she measures full standing height **without** borrowing Soldier clips (foreign Idle previously collapsed her to shoes-only)

## Gold look (visibility-first)

Solid opaque gold `MeshStandardMaterial` from painting eyedropper colors:
- metalness ≤ 0.4, roughness ≥ 0.5
- **NO** painting atlas / metalnessMap / gold-flake maps (those made the body invisible)
- Front painting is **never** UV-wrapped onto the back
- No "Golden Stasis" nameplate

Cutout / ExtrudeGeometry inflated silhouette player code has been removed.

Reusable hook:

- `window.GE_CUSTOM_CHARACTER_URL` or `?customChar=...` (palette ref only)
- `window.GE_CUSTOM_CHARACTER_GLB` or `?customGlb=glb/Soldier.glb`

NPCs keep calm gallery attire solids. Procedural MetaHuman-ish fallback if all GLBs fail.
