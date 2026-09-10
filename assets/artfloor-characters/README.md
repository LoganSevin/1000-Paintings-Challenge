# Art Floor characters

Primary player: **`glb/custom-character.glb`** (TripoSR image→3D) — Logan's Golden Stasis
painting silhouette (gold jumpsuit, face, hair, gun) with painting-projected albedo.

**Hard rules (2026-09-10):**
- **NOT upside down** — head +Y, feet on floor. If Y is already the long axis, do not rotate.
  Spurious `rotateX(π)` / walk-bob overwriting upright euler is what flipped her before.
- **Looks like the painting** — TripoSR mesh + `GoldenStasisPainted` albedo (not Michelle hybrid).
- **NO SambaDance / dance clips**
- **NO underground / shoes-only / butter blotches** — grounded bob; COLOR_0 stripped when map present
- Unskinned TPS: grounded bob/sway walk (no Mixamo skin on TripoSR)

## Player chain

1. TripoSR `glb/custom-character.glb` (default) — upright + painting albedo + bob
2. Soldier / Xbot opaque gold (native Walk/Idle)
3. Mixamo Michelle only if `?customGlb=glb/Michelle.glb`
4. Procedural gold humanoid

## Upright verify

After scale/ground: `max(size) === size.y`, `minY ≈ 0`, `maxY > minY + 1`.
Walk bob layers small deltas on stored `modelBaseEuler*` — never wipes upright.

## Source assets

- `custom/golden-stasis.jpg` — painting
- `custom/golden-stasis-cutout.png` — rembg cutout
- `glb/custom-character.glb` — TripoSR mesh with painting-projected PBR
- `glb/Michelle.glb` / `Soldier.glb` / `Xbot.glb` — Mixamo fallbacks / NPCs

Reusable hook:

- `window.GE_CUSTOM_CHARACTER_URL` or `?customChar=...`
- `window.GE_CUSTOM_CHARACTER_GLB` or `?customGlb=glb/custom-character.glb`
