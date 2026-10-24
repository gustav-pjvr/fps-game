import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ADS_SIGHT_DISTANCE } from '../core/config.ts';
import { adsPositionForSight } from './viewModel.ts';

describe('adsPositionForSight', () => {
  it('moves the sight point onto the forward axis at ADS_SIGHT_DISTANCE in front of the eye', () => {
    const sight = new THREE.Vector3(-0.07, 0.159, 0.228);
    const position = adsPositionForSight(sight);
    expect(position.toArray()).toEqual([0.07, -0.159, -ADS_SIGHT_DISTANCE - 0.228]);
    const onScreen = position.clone().add(sight);
    expect(onScreen.x).toBeCloseTo(0, 12);
    expect(onScreen.y).toBeCloseTo(0, 12);
    expect(onScreen.z).toBeCloseTo(-ADS_SIGHT_DISTANCE, 12);
  });

  it('honours a custom distance and writes into the given vector', () => {
    const out = new THREE.Vector3(9, 9, 9);
    const result = adsPositionForSight(new THREE.Vector3(0.01, 0.1, -0.05), 0.5, out);
    expect(result).toBe(out);
    expect(out.x).toBeCloseTo(-0.01, 12);
    expect(out.y).toBeCloseTo(-0.1, 12);
    expect(out.z).toBeCloseTo(-0.45, 12);
  });
});
