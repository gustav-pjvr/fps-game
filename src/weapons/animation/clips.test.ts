import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addClip, defaultMagazineReload, GUN_TRACK, inspectTurn, sampleTrack, zeroOffset, type Clip, type PartOffset } from './clips.ts';
import { PartAnimator } from './PartAnimator.ts';

describe('sampleTrack', () => {
  const keys = [{ t: 1 }, { t: 2, p: [0, 0, -0.1] as const, ease: 'linear' as const }, { t: 4, r: [0.4, 0, 0] as const, ease: 'linear' as const }];

  it('holds the first key before it and the last key after it', () => {
    expect(sampleTrack(keys, 0)).toEqual(zeroOffset());
    expect(sampleTrack(keys, 9)).toMatchObject({ pf: -0.1, pitch: 0.4 });
  });

  it('moves between keys, and a key that names no value keeps the last one', () => {
    expect(sampleTrack(keys, 1.5).pf).toBeCloseTo(-0.05);
    const late = sampleTrack(keys, 3);
    expect(late.pf).toBeCloseTo(-0.1);
    expect(late.pitch).toBeCloseTo(0.2);
  });

  it('eases by default: slow out of a key and slow into the next', () => {
    const eased = [{ t: 0 }, { t: 1, p: [1, 0, 0] as const }];
    expect(sampleTrack(eased, 0.25).px).toBeLessThan(0.25);
    expect(sampleTrack(eased, 0.5).px).toBeCloseTo(0.5);
    expect(sampleTrack(eased, 0.75).px).toBeGreaterThan(0.75);
  });
});

describe('addClip', () => {
  it('adds clips together part by part and scales by weight', () => {
    const clip: Clip = { duration: 1, tracks: { bolt: [{ t: 0, p: [0, 0, -0.04] }], gun: [{ t: 0, r: [0.1, 0, 0] }] } };
    const offsets = new Map<string, PartOffset>();
    addClip(offsets, clip, 0.5);
    addClip(offsets, clip, 0.5, 0.5);
    addClip(offsets, undefined, 0.5);
    expect(offsets.get('bolt')!.pf).toBeCloseTo(-0.06);
    expect(offsets.get(GUN_TRACK)!.pitch).toBeCloseTo(0.15);
    expect([...offsets.keys()].sort()).toEqual(['bolt', 'gun']);
  });
});

describe('stock clips', () => {
  it('starts and ends the default reload at rest, with the magazine out in the middle', () => {
    const reload = defaultMagazineReload();
    for (const track of Object.values(reload.tracks)) {
      expect(sampleTrack(track, 0)).toEqual(zeroOffset());
      const end = sampleTrack(track, 1);
      for (const value of Object.values(end)) expect(value).toBeCloseTo(0);
    }
    expect(sampleTrack(reload.tracks.magazine!, 0.4).py).toBeLessThan(-0.15);
  });

  it('returns every inspect turn to where it began (a whole turn counts)', () => {
    for (const style of ['standard', 'showcase', 'flick'] as const) {
      const turn = inspectTurn(style);
      const end = sampleTrack(turn.tracks[GUN_TRACK]!, turn.duration);
      expect(end.px).toBeCloseTo(0);
      expect(end.py).toBeCloseTo(0);
      expect(end.pf).toBeCloseTo(0);
      expect(Math.sin(end.roll)).toBeCloseTo(0);
      expect(Math.cos(end.roll)).toBeCloseTo(1);
      expect(end.pitch).toBeCloseTo(0);
      expect(end.yaw).toBeCloseTo(0);
      expect(sampleTrack(turn.tracks[GUN_TRACK]!, 0)).toEqual(zeroOffset());
    }
  });
});

describe('PartAnimator', () => {
  it('poses from rest every time, so offsets never build up and an unnamed part returns to rest', () => {
    const bolt = new THREE.Object3D();
    bolt.position.set(0.02, 0.01, -0.05);
    const model = new THREE.Object3D();
    const animator = new PartAnimator(new Map([['bolt', bolt]]), model);
    const offsets = new Map<string, PartOffset>([['bolt', { ...zeroOffset(), pf: -0.04, pitch: 0.3 }]]);
    animator.apply(offsets);
    animator.apply(offsets);
    // Forward is three's -z, so a move back along the barrel is +z.
    expect(bolt.position.z).toBeCloseTo(-0.01);
    expect(new THREE.Euler().setFromQuaternion(bolt.quaternion, 'YXZ').x).toBeCloseTo(0.3);
    animator.apply(new Map());
    expect(bolt.position.toArray()).toEqual([0.02, 0.01, -0.05]);
    expect(bolt.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0);
  });

  it('moves the whole model with the gun track', () => {
    const model = new THREE.Object3D();
    model.position.set(-0.07, 0.05, 0.14);
    const animator = new PartAnimator(new Map(), model);
    animator.apply(new Map([[GUN_TRACK, { ...zeroOffset(), py: -0.02, roll: 0.3 }]]));
    expect(model.position.y).toBeCloseTo(0.03);
    // Roll tips the top to the right: a negative turn about three's z.
    expect(new THREE.Euler().setFromQuaternion(model.quaternion, 'YXZ').z).toBeCloseTo(-0.3);
  });
});
