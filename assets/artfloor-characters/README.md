# Art Floor characters

Primary: offline **Mixamo-style human GLBs** under `glb/` loaded with Three.js
`GLTFLoader` + `AnimationMixer` (Walk / Idle).

- `glb/Michelle.glb` — Mixamo Michelle (female, adult MetaHuman-like proportions). Used as the **player** with a custom painting look. SambaDance ships in-file; Walk/Idle are borrowed at runtime from Soldier/Xbot (same `mixamorig:*` bones).
- `glb/Soldier.glb` — Mixamo Soldier (Idle/Walk/Run) — gallery NPC crowd + locomotion donor
- `glb/Xbot.glb` — Mixamo X Bot (idle/walk/run) — gallery NPC crowd

## Custom painting → contoured body

Drop a character image under `custom/` (default: `custom/golden-stasis.jpg`) and it is mapped as albedo onto Michelle with a metallic-gold jumpsuit shader, dark hair volumes, and a black neckerchief accent.

Reusable hook (no rebuild required for a new image):

- `window.GE_CUSTOM_CHARACTER_URL` or `?customChar=assets/artfloor-characters/custom/your.jpg`
- `window.GE_CUSTOM_CHARACTER_GLB` or `?customGlb=glb/Michelle.glb`

NPCs keep calm gallery attire solids (navy, camel, charcoal, burgundy, slate, …).

Procedural fallback (if GLBs fail): MetaHuman-like proportions (head ≈ 1/7.5 body height), continuous lathe torso, tapered limbs, 5-finger hands.

Intentionally **not** used: green waffle “player uniform”, white collar plates, chest badge / pencil graphics, photo-cube / Lego ball-joint people, Epic MetaHumans (not embeddable in a browser without the MetaHuman runtime).
