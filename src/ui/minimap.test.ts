import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Minimap, minimapDotStyle, minimapTransform } from './minimap.ts';

const apply = (m: readonly number[], x: number, z: number): { sx: number; sy: number } => ({
  sx: m[0]! * x + m[2]! * z + m[4]!,
  sy: m[1]! * x + m[3]! * z + m[5]!,
});

describe('minimapDotStyle', () => {
  it('draws underground players as hollow rings and surface players as filled dots', () => {
    expect(minimapDotStyle(true, 'red')).toEqual({ background: 'transparent', border: '2px solid red' });
    expect(minimapDotStyle(false, 'red')).toEqual({ background: 'red', border: '2px solid transparent' });
  });
});

describe('minimapTransform', () => {
  it('matches the dots: the offset rotated by -yaw about Y, scaled, around the centre', () => {
    const scale = 70 / 26;
    for (const [px, pz, yaw, x, z] of [
      [0, 0, 0, 5, -3],
      [10, -4, 1.1, 2, 7],
      [-20, 13, -2.4, -25, 0],
      [3, 3, Math.PI, 3, -10],
    ] as const) {
      const rotated = new THREE.Vector3(x - px, 0, z - pz).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -yaw, 0, 'YXZ')));
      const { sx, sy } = apply(minimapTransform(px, pz, yaw, scale, 70), x, z);
      expect(sx).toBeCloseTo(70 + rotated.x * scale);
      expect(sy).toBeCloseTo(70 + rotated.z * scale);
    }
  });

  it('puts the player at the centre and their forward straight up', () => {
    const yaw = 0.7;
    const m = minimapTransform(4, -9, yaw, 2, 70);
    const centre = apply(m, 4, -9);
    expect(centre.sx).toBeCloseTo(70);
    expect(centre.sy).toBeCloseTo(70);
    // Player forward is (0, 0, -1) turned by yaw, as Player builds it.
    const ahead = apply(m, 4 - Math.sin(yaw) * 10, -9 - Math.cos(yaw) * 10);
    expect(ahead.sx).toBeCloseTo(70);
    expect(ahead.sy).toBeCloseTo(50);
  });
});

describe('Minimap zoom', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeElement(): Record<string, unknown> {
    const element: Record<string, unknown> = {
      style: {}, dataset: {}, width: 0, height: 0,
      appendChild: () => {}, insertBefore: () => {}, remove: () => {},
      getContext: () => ({ setTransform: () => {}, clearRect: () => {} }),
    };
    return element;
  }

  it('changes opponent dots and the local marker back when players return to the surface', () => {
    vi.stubGlobal('document', { createElement: fakeElement });
    const map = new Minimap(fakeElement() as unknown as HTMLElement);
    map.addDot(1);
    const player = new THREE.Vector3();
    const internals = map as unknown as {
      dots: Map<number, { style: { background: string; border: string } }>;
      forwardWedge: { style: { display: string } };
      localDot: { style: { display: string } };
    };
    const opponent = { x: 4, z: 2, underground: true };
    map.update(player, new Map([[1, opponent]]), 0, undefined, undefined, true);
    expect(internals.dots.get(1)!.style.background).toBe('transparent');
    expect(internals.dots.get(1)!.style.border).toContain('2px solid');
    expect(internals.forwardWedge.style.display).toBe('none');
    expect(internals.localDot.style.display).toBe('');
    opponent.underground = false;
    map.update(player, new Map([[1, opponent]]), 0);
    expect(internals.dots.get(1)!.style.background).not.toBe('transparent');
    expect(internals.dots.get(1)!.style.border).toBe('2px solid transparent');
    expect(internals.forwardWedge.style.display).toBe('');
    expect(internals.localDot.style.display).toBe('none');
  });

  it('places pickups and objective markers at the zoomed radius inside a house, like every other dot', () => {
    vi.stubGlobal('document', { createElement: fakeElement });
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const layer = { testId: 'layer', update: () => {}, draw: () => {}, zoomRadius: () => 14 };
    const map = new Minimap(fakeElement() as unknown as HTMLElement, { layer });
    map.setMarkers([{ id: 'objective', x: 7, z: 0 }]);
    const player = new THREE.Vector3(0, 0, 0);
    map.update(player, new Map(), 0);
    map.updatePickups(player, 0, [{ id: 1, kind: 'health', x: 7, z: 0 }]);
    const left = (name: string): number => {
      const element = (map as unknown as Record<string, Map<unknown, unknown>>)[name]!;
      const entry = [...element.values()][0] as { dot?: { style: { left: string } }; style?: { left: string } };
      return parseFloat((entry.dot ?? entry).style!.left);
    };
    // Half the zoomed radius away: halfway from the centre (70 px) to the rim (140 px).
    expect(left('pickupIcons')).toBeCloseTo(105);
    expect(left('markers')).toBeCloseTo(105);
  });
});
