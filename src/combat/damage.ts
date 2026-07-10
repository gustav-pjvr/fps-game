import type * as THREE from 'three';

export interface Damageable {
  /** Nominal marker, not just a structural duck-type check - Player also has takeDamage/isDead
   * for its own health system, and a plain "does it have takeDamage()" check would incorrectly
   * treat the player as a shootable target too (this is exactly how the self-hit bug happened). */
  readonly isDamageableTarget: true;
  readonly isDead: boolean;
  /** hitColliderHandle lets the entity work out which of its own colliders (e.g. head vs body) was
   * hit. `sourcePosition` (optional - most implementers ignore it) is roughly where the shot came
   * from, so a target with its own threat-perception (see Enemy.ts) can react toward the attacker
   * instead of only reacting once it independently spots them. */
  takeDamage(amount: number, hitColliderHandle: number, sourcePosition?: THREE.Vector3): void;
}

export function isDamageable(value: unknown): value is Damageable {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<Damageable>).isDamageableTarget === true &&
    typeof (value as Partial<Damageable>).takeDamage === 'function'
  );
}
