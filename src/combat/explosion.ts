/** Linear falloff: full `maxDamage` at distance 0, down to 0 at `radius` and beyond. Pure and
 * unit-testable on purpose (see explosion.test.ts) - the one new piece of damage math this
 * codebase didn't already have (no AOE/explosive weapon existed before the goose). */
export function computeExplosionDamage(distance: number, radius: number, maxDamage: number): number {
  if (distance >= radius) return 0;
  return maxDamage * (1 - distance / radius);
}
