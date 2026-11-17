import * as THREE from 'three';
import type { EnemyArchetype } from './archetypes.ts';

/** An elite's tinted copy of each shared character material, per archetype: made once and shared by
 * every enemy of that archetype, like the originals, so nothing is left to free per enemy. */
const tintedMaterials = new Map<string, Map<THREE.Material, THREE.Material>>();

/**
 * Dresses a freshly spawned enemy as its archetype's elite look (the Warden, docs/uplink.md): the
 * model grows by `look.scale` with its feet kept on the ground, and its kit is tinted, with a faint
 * glow of the same colour that reads at dusk and in the Facility's dark. No light is added. No-op
 * for an archetype without a look.
 *
 * The hit colliders grow with it, in Enemy's constructor (characterHitbox.ts's scaledHitShape).
 */
export function applyArchetypeLook(mesh: THREE.Object3D, archetype: EnemyArchetype): void {
  const look = archetype.look;
  const model = mesh.children[0];
  if (!look || !model) return;
  // The model's origin is at its feet (characterModels.ts), so it grows upward from the ground.
  model.scale.multiplyScalar(look.scale);
  let copies = tintedMaterials.get(archetype.name);
  if (!copies) {
    copies = new Map();
    tintedMaterials.set(archetype.name, copies);
  }
  const shared = copies;
  const tint = new THREE.Color(look.tint);
  const tinted = (material: THREE.Material): THREE.Material => {
    let copy = shared.get(material);
    if (!copy) {
      copy = material.clone();
      // The visor keeps its red glow: only kit that does not already light up takes the tint.
      if (copy instanceof THREE.MeshStandardMaterial && copy.emissiveIntensity <= 1) {
        copy.color.multiply(tint);
        copy.emissive.copy(tint);
        copy.emissiveIntensity = 0.12;
      }
      shared.set(material, copy);
    }
    return copy;
  };
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = Array.isArray(child.material) ? child.material.map(tinted) : tinted(child.material);
  });
}
