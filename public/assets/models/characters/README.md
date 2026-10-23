# Characters

From Quaternius, "Ultimate Modular Men" (February 2022), CC0 1.0 (public domain dedication,
https://creativecommons.org/publicdomain/zero/1.0/). Pack page:
https://quaternius.com/packs/ultimatemodularcharacters.html, downloaded 2026-10-23 from the pack's
public Google Drive folder (Individual Characters / glTF).

| File | Source | Used for |
|---|---|---|
| `swat.glb` | `Swat.gltf` | Enemies |
| `spacesuit.glb` | `Spacesuit.gltf` | Remote players and the loadout preview |

Changes: packed to GLB with @gltf-transform 4.1.1 (`pack-characters.mjs`), keeping only the clips the
game plays (Idle, Idle_Gun, Idle_Gun_Pointing, Idle_Gun_Shoot, Gun_Shoot, Walk, Run, Run_Shoot,
HitRecieve, Death) and pruning unused data. Geometry, rig and materials are unchanged; the visor
colour is set at runtime (src/entities/characterModels.ts).
