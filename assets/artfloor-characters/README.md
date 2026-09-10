# Art Floor characters

Primary player: **`glb/Michelle.glb`** (Mixamo skinned) with **Soldier Walk only** borrowed
onto the same `mixamorig:*` bones.

**Hard rules (2026-09-10):**
- **NO SambaDance / dance clips** — Michelle ships SambaDance; it is stripped and never played.
- **NO Soldier Idle on Michelle** — absolute pose mismatch collapsed her to shoes-only.
- Idle = bind / T-pose rest (no idle clip). Walk plays only while moving.
- **Feet grounded:** borrowed Walk has `Hips.position` tracks removed (Soldier hip height
  was burying Michelle), plus per-frame world bbox foot snap to `floorContactY`.
- If Walk probe collapses height, mixer is stripped and a grounded procedural bob is used.

Painting look: **albedo only** from UV bake of Golden Stasis:

- `custom/michelle-gold-diffuse.png` — painting-projected albedo (bright lurex gold)
- Metal/rough maps are intentionally **not** applied (metalnessMap + metalness=1 blacked out the body)

Props: hair bouffant, black scarf, gold gun on `RightHand`. LMB/F aims the right arm **forward**.

## Guaranteed visible body (fallback chain)

1. Michelle + diffuse bake + Soldier Walk (grounded) — no dance
2. Soldier / Xbot opaque gold (native Walk/Idle)
3. TripoSR `glb/custom-character.glb` (upright, textured, bob walk)
4. Procedural gold humanoid

Optional override: `?customGlb=glb/custom-character.glb` (TripoSR unskinned — bob only).

Gallery NPCs:

- `glb/Soldier.glb` — native Idle/Walk/Run
- `glb/Xbot.glb` — native idle/walk/run

## Gold look (visibility-first)

- Michelle: diffuse map + soft metalness ≤0.35, **no metalnessMap**
- Solid opaque gold for Soldier fallback
- Front painting is **not** wrapped as a billboard card onto the back

Reusable hook:

- `window.GE_CUSTOM_CHARACTER_URL` or `?customChar=...`
- `window.GE_CUSTOM_CHARACTER_GLB` or `?customGlb=glb/Michelle.glb`

## Source assets

- `custom/golden-stasis.jpg` — painting
- `custom/golden-stasis-cutout.png` — rembg cutout (bake source)
- `glb/custom-character.glb` — TripoSR mesh (hard fallback + optional override)
