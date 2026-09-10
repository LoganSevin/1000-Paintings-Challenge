# Art Floor characters

Primary player: **`glb/custom-character.glb`** — open-source image→3D (TripoSR CPU)
from the Golden Stasis gold-jumpsuit painting (rembg cutout). Full front **and** back
geometry with vertex colors. Unskinned mesh uses TPS root-bob walk.

Fallback Mixamo GLBs (gallery NPCs + player if custom missing):

- `glb/Soldier.glb` — native Idle/Walk/Run
- `glb/Xbot.glb` — native idle/walk/run
- `glb/Michelle.glb` — optional

## Gold look (visibility-first)

- Custom TripoSR mesh: keep vertex colors / albedo; **strip metalnessMap** (no env → black hole)
- Mixamo fallbacks: solid opaque gold `MeshStandardMaterial` (metalness ≤ 0.4)
- Front painting is **never** UV-wrapped onto the back
- Yellow inflated cutout / ExtrudeGeometry silhouette path removed

Reusable hook:

- `window.GE_CUSTOM_CHARACTER_URL` or `?customChar=...` (palette ref only)
- `window.GE_CUSTOM_CHARACTER_GLB` or `?customGlb=glb/custom-character.glb`

NPCs keep calm gallery attire solids. Procedural MetaHuman-ish fallback if all GLBs fail.

## Source assets

- `custom/golden-stasis.jpg` — painting
- `custom/golden-stasis-cutout.png` — rembg cutout used for TripoSR
