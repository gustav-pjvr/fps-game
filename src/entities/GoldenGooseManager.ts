import * as THREE from 'three';
import { buildGooseMesh, disposeProceduralMesh } from './Goose.ts';
import type { PlayerSlot } from '../network/protocol.ts';

const GOLDEN_TINT = 0xffd54a;

/** King of the Hill's single objective goose - unlike the exploding/wandering Goose class, this is
 * a carry-only prop with no physics collider (pickup/drop are resolved by a plain distance check
 * against the interact/fire keys, see Game.ts's updateGoldenGoose) and no per-mode AI. Every
 * client mirrors the exact same carrier/position state via relayed goldenGoosePickedUp/
 * goldenGooseDropped messages (self-reported, no host arbitration) - the same trust model as
 * GoosePickedUpMessage in Goose Toss, just for one persistent goose instead of many disposable
 * ones. While carried, the world mesh is hidden entirely rather than attached to a hand/view model
 * - a known simplification matching this project's existing precedent (Goose Toss's held-goose
 * view model isn't visible to other players either). */
export class GoldenGooseManager {
  readonly mesh: THREE.Group;
  private carrier: PlayerSlot | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    spawnPosition: THREE.Vector3,
  ) {
    this.mesh = buildGooseMesh();
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        child.material.color.setHex(GOLDEN_TINT);
        child.material.emissive.setHex(GOLDEN_TINT);
        child.material.emissiveIntensity = 0.35;
      }
    });
    this.mesh.position.copy(spawnPosition);
    this.scene.add(this.mesh);
  }

  get position(): THREE.Vector3 {
    return this.mesh.position;
  }

  get carrierSlot(): PlayerSlot | null {
    return this.carrier;
  }

  get isHeld(): boolean {
    return this.carrier !== null;
  }

  /** `slot` just claimed the goose (interact key, or applying another player's relayed pickup) -
   * hides the world mesh, since there's no visible held-item model for it (see class comment). */
  claim(slot: PlayerSlot): void {
    this.carrier = slot;
    this.mesh.visible = false;
  }

  /** Drops the goose at `position` (voluntary drop or the carrier's own death) - makes it visible
   * and claimable again. */
  drop(position: THREE.Vector3): void {
    this.carrier = null;
    this.mesh.position.copy(position);
    this.mesh.visible = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    disposeProceduralMesh(this.mesh);
  }
}
