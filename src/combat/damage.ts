export interface Damageable {
  readonly isDead: boolean;
  /** hitColliderHandle lets the entity work out which of its own colliders (e.g. head vs body) was hit. */
  takeDamage(amount: number, hitColliderHandle: number): void;
}

export function isDamageable(value: unknown): value is Damageable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'takeDamage' in value &&
    typeof (value as Damageable).takeDamage === 'function'
  );
}
