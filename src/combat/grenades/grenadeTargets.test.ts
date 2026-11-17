import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { GrenadeTargets } from './GrenadeSystem.ts';
import { withBlastTargets } from './grenadeTargets.ts';

function enemies() {
  return { applyBlast: vi.fn(), applyFlash: vi.fn(() => 2), notifyGunshot: vi.fn() };
}

describe('grenade blast targets', () => {
  it('is the enemies alone without geese', () => {
    const targets = enemies();
    expect(withBlastTargets(targets as unknown as GrenadeTargets, null)).toBe(targets);
  });

  it('sends a frag blast to the enemies and the geese, a flash and its noise only to the enemies', () => {
    const targets = enemies();
    const geese = { applyBlast: vi.fn() };
    const combined = withBlastTargets(targets as unknown as GrenadeTargets, geese);
    const position = new THREE.Vector3(1, 0, 2);
    const damageFor = (): number => 50;
    combined.applyBlast(position, damageFor);
    expect(targets.applyBlast).toHaveBeenCalledWith(position, damageFor);
    expect(geese.applyBlast).toHaveBeenCalledWith(position, damageFor);
    expect(combined.applyFlash(() => 1)).toBe(2);
    combined.notifyGunshot(position, 'frag');
    expect(targets.notifyGunshot).toHaveBeenCalledWith(position, 'frag');
  });
});
