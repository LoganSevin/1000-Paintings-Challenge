# Art Floor characters

Gallery patrons are built procedurally in `js/ge-artfloor-3d.js` as **continuous**
sculpted humanoids:

- Lathe torso that flares into shoulders and blends into the neck (one skin line)
- Arms / legs as tapered tube structures with overlapping elbow/knee joins (no Lego ball joints)
- Hands with thumb + 4 fingers (tapered segments), not spheres
- Outfit volumes (suit, coat, dress, streetwear, beret) layered on the body with calm solids

Photo cutouts / prism cards are intentionally not used.

- `glb/` — optional offline Mixamo human GLBs (Soldier / Xbot) kept for reference;
  the live Art Floor uses the procedural continuous mesh so outfit variety and hall
  calm stay under local control.
