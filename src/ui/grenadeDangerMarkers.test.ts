import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { LiveGrenadeView } from '../combat/grenades/GrenadeSystem.ts';
import { GRENADE_DANGER_RANGE } from '../combat/grenades/grenadeTuning.ts';
import { dangerousFrags, placeMarker } from './grenadeDangerMarkers.ts';

function grenade(kind: 'frag' | 'flash', own: boolean, x: number): LiveGrenadeView {
  return { id: `${kind}${own}${x}`, kind, own, position: { x, y: 0, z: 0 }, fuseLeft: 1, resting: false };
}

describe('grenade danger markers', () => {
  it("marks only other players' frags within the danger range", () => {
    const eye = new THREE.Vector3();
    const live = [grenade('frag', false, 3), grenade('frag', true, 3), grenade('flash', false, 3), grenade('frag', false, GRENADE_DANGER_RANGE + 0.5)];
    expect(dangerousFrags(live, eye).map((g) => g.id)).toEqual([live[0]!.id]);
  });

  it('collects into the array it is given, emptied first, so a per-frame caller allocates none', () => {
    const eye = new THREE.Vector3();
    const into = [grenade('frag', false, 9)];
    const live = [grenade('frag', false, 3)];
    const result = dangerousFrags(live, eye, into);
    expect(result).toBe(into);
    expect(into.map((g) => g.id)).toEqual([live[0]!.id]);
  });

  it('sits on the frag when it is on screen', () => {
    const place = placeMarker(new THREE.Vector3(0.5, 0, -5), new THREE.Vector3(0.2, -0.1, 0.9), 1000, 800);
    expect(place.offscreen).toBe(false);
    expect(place.x).toBeCloseTo(100);
    expect(place.y).toBeCloseTo(40);
  });

  it('pins a frag behind to the edge on its side, never mirrored', () => {
    // Behind and to the right: perspective division would put it on the left.
    const place = placeMarker(new THREE.Vector3(2, 0, 3), new THREE.Vector3(-0.6, 0, 1.1), 1000, 800);
    expect(place.offscreen).toBe(true);
    expect(place.x).toBeGreaterThan(400);
    expect(place.angle).toBeCloseTo(90);
  });
});
