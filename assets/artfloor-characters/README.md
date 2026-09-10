# Art Floor characters

Primary: offline **Mixamo-style human GLBs** under `glb/` loaded with Three.js
`GLTFLoader` + `AnimationMixer` (Walk / Idle).

- `glb/Michelle.glb` — Mixamo Michelle (female). **Player** with opaque metallic-gold jumpsuit materials (eyedropper palette from the painting). SambaDance ships in-file; Walk/Idle are borrowed at runtime from Soldier/Xbot (same `mixamorig:*` bones).
- `glb/Soldier.glb` — Mixamo Soldier (Idle/Walk/Run) — gallery NPC crowd + locomotion donor
- `glb/Xbot.glb` — Mixamo X Bot (idle/walk/run) — gallery NPC crowd

## Custom painting → gold look (front vs back)

- `custom/golden-stasis.jpg` — source painting (front-only reference)
- `custom/golden-stasis-cutout.png` — optional rembg cutout (not used as player mesh)

Because the source is **front-only**, the painting is **not** UV-wrapped onto Michelle (that put the front photo on her back). The body uses solid opaque metallic-gold `MeshStandardMaterial` from painting colors; hair/scarf/heels are solid invented materials that read correctly when orbiting behind. Mixamo gloss `metalnessMap` is stripped (it made the body invisible without an env map).

Reusable hook:

- `window.GE_CUSTOM_CHARACTER_URL` or `?customChar=assets/artfloor-characters/custom/your.jpg` (palette / look ref)
- `window.GE_CUSTOM_CHARACTER_GLB` or `?customGlb=glb/Michelle.glb`

NPCs keep calm gallery attire solids (navy, camel, charcoal, burgundy, slate, …).

Procedural fallback (if GLBs fail): MetaHuman-like proportions (head ≈ 1/7.5 body height), continuous lathe torso, tapered limbs, 5-finger hands.

Intentionally **not** used: inflated dual-face / extruded silhouette-box player, front-photo-on-back, “Golden Stasis” nameplate, green waffle “player uniform”, white collar plates, chest badge / pencil graphics, photo-cube / Lego ball-joint people.
