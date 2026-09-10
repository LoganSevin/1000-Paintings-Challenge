# Art Floor characters

Primary player: **`glb/Michelle.glb`** (Mixamo skinned) with **Soldier Walk/Idle** borrowed
onto the same `mixamorig:*` bones. Painting look comes from UV bake of Golden Stasis:

- `custom/michelle-gold-diffuse.png` — painting-projected albedo (bright lurex gold, face/hair/shoes)
- `custom/michelle-gold-metal.png` / `michelle-gold-rough.png` — soft PBR (no black blotch maps)

Props: hair bouffant, black scarf, gold gun on `RightHand`. LMB/F aims the right arm **forward**.

Optional override: `?customGlb=glb/custom-character.glb` (TripoSR unskinned — bob only, no arm swing).

Fallback Mixamo GLBs (gallery NPCs + player if Michelle missing):

- `glb/Soldier.glb` — native Idle/Walk/Run
- `glb/Xbot.glb` — native idle/walk/run

## Gold look (visibility-first)

- Michelle: painting UV bake + soft metal/rough (metalnessMap never Mixamo gloss-black)
- Solid opaque gold fallback if bake textures missing
- Front painting is **not** wrapped as a billboard card onto the back

Reusable hook:

- `window.GE_CUSTOM_CHARACTER_URL` or `?customChar=...`
- `window.GE_CUSTOM_CHARACTER_GLB` or `?customGlb=glb/Michelle.glb`

NPCs keep calm gallery attire solids. Procedural MetaHuman-ish fallback if all GLBs fail.

## Source assets

- `custom/golden-stasis.jpg` — painting
- `custom/golden-stasis-cutout.png` — rembg cutout (bake source)
- `glb/custom-character.glb` — TripoSR mesh (optional override only)
