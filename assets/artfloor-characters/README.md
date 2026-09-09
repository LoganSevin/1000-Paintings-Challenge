# Art Floor characters

Primary: offline **Mixamo-style human GLBs** under `glb/` loaded with Three.js
`GLTFLoader` + `AnimationMixer` (Walk / Idle).

- `glb/Soldier.glb` — Mixamo Soldier (adult human proportions, Idle/Walk/Run)
- `glb/Xbot.glb` — Mixamo X Bot (adult human proportions, idle/walk/run)

Materials are recolored at runtime toward calm gallery attire solids (navy, camel,
charcoal, burgundy, slate, …) so patrons are not identical military clones.

Procedural fallback (if GLBs fail to load): MetaHuman-like proportions
(head ≈ 1/7.5 body height), continuous lathe torso (hips→waist→chest→shoulder→neck),
tapered limbs, 5-finger hands, plain suit/coat/dress/hoodie volumes.

Intentionally **not** used: green waffle “player uniform”, white collar plates,
chest badge / pencil graphics, photo-cube / Lego ball-joint people, Epic MetaHumans
(not embeddable in a browser without the MetaHuman runtime).
