import { describe, expect, it } from 'vitest';
import { bakeFacility, sampleProbe } from './facilityBake.ts';
import { buildFacilityGeometry } from './facilityGeometry.ts';
import { generateFacilityLayout, OPEN, PROP, SOLID, type FacilityLayout } from './facilityLayout.ts';

function room(): FacilityLayout {
  const size = 9, kinds = new Uint8Array(size * size).fill(SOLID), ceiling = new Float32Array(size * size);
  for (let j = 1; j < size - 1; j++) for (let i = 1; i < size - 1; i++) { kinds[j * size + i] = OPEN; ceiling[j * size + i] = 5; }
  return { seed: 0, size, cell: 1.5, kinds, ceiling, region: new Int16Array(size * size),
    rooms: [], crates: [], doorways: [], lamps: [{ x: 0, y: 4.85, z: 0, color: 0xffffff, intensity: 1, kind: 'panel' }] };
}

describe('Facility bake', () => {
  it('bakes seed 1 within 4000 ms with finite nonnegative light and probes', () => {
    const layout = generateFacilityLayout(1), geometry = buildFacilityGeometry(layout);
    const length = [...geometry.byMaterial.values()].reduce((sum, g) => sum + g.getAttribute('position').array.length, 0);
    const positions = new Float32Array(length), normals = new Float32Array(length);
    let offset = 0;
    for (const g of geometry.byMaterial.values()) {
      positions.set(g.getAttribute('position').array, offset); normals.set(g.getAttribute('normal').array, offset);
      offset += g.getAttribute('position').array.length;
    }
    const result = bakeFacility(layout, positions, normals);
    expect(result.light.length).toBe(length); expect(result.probes.length).toBe(layout.kinds.length * 3);
    expect(result.light.every(value => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(result.probes.every(value => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(result.light.some(value => value > 0)).toBe(true);
    expect(result.ms).toBeLessThan(4000);
    console.log(`Facility seed 1 bake: ${result.ms.toFixed(1)} ms; vertices: ${length / 3}`);
    for (const g of geometry.byMaterial.values()) g.dispose();
  }, 10000);

  it('lights the floor beneath a lamp more than the floor across a solid wall', () => {
    const base = room();
    for (let j = 1; j < 8; j++) { base.kinds[j * 9 + 4] = SOLID; base.ceiling[j * 9 + 4] = 0; }
    const layout = { ...base, lamps: [{ ...base.lamps[0]!, x: -3 }] };
    const positions = new Float32Array([-3, 0, 0, 3, 0, 0]), normals = new Float32Array([0, 1, 0, 0, 1, 0]);
    const result = bakeFacility(layout, positions, normals);
    expect(result.light[0]!).toBeGreaterThan(result.light[3]! + 0.05);
    expect(result.probes[(4 * 9 + 6) * 3]).toBe(0);
  });

  it('uses crate slabs, allowing light through the cell above and beside the crate', () => {
    const base = room(), positions = new Float32Array([-3, 0, 0, -3, 0, 0.7]), normals = new Float32Array([0, 1, 0, 0, 1, 0]);
    base.kinds[4 * 9 + 4] = PROP;
    const layout = { ...base, crates: [{ i: 4, j: 4, height: 1.8 }], lamps: [{ ...base.lamps[0]!, x: 3, y: 2, z: 0.7 }] };
    const blocked = bakeFacility(layout, positions, normals), clear = bakeFacility({ ...layout, crates: [] }, positions, normals);
    expect(blocked.light[0]!).toBeLessThan(clear.light[0]! * 0.5);
    expect(blocked.light[3]!).toBeGreaterThan(blocked.light[0]!);
    const tallLamp = { ...layout, lamps: [{ ...layout.lamps[0]!, y: 4.85 }] };
    const high = bakeFacility(tallLamp, positions, normals), highClear = bakeFacility({ ...tallLamp, crates: [] }, positions, normals);
    expect(high.light[0]!).toBeGreaterThan(highClear.light[0]! * 0.9);
  });

  it('blocks a ray that crosses a lower ceiling, even if it enters below the ceiling', () => {
    const base = room();
    for (let j = 1; j < 8; j++) base.ceiling[j * 9 + 4] = 2.9;
    const layout = { ...base, lamps: [{ ...base.lamps[0]!, x: 3 }] };
    const low = bakeFacility(layout, new Float32Array(), new Float32Array());
    const id = (4 * 9 + 2) * 3;
    expect(low.probes[id]).toBe(0);
    base.ceiling.fill(5);
    const high = bakeFacility(layout, new Float32Array(), new Float32Array());
    expect(high.probes[id]!).toBeGreaterThan(0);
  });

  it('has lower AO in a floor and wall corner than at the open floor centre', () => {
    const layout = room(), positions = new Float32Array([-5.1, 0, -5.1, 0, 0, 0]);
    const result = bakeFacility(layout, positions, new Float32Array([0, 1, 0, 0, 1, 0]));
    // Divide out independently calculated direct and bounce contributions to isolate AO.
    const aoAt = (offset: number): number => {
      const x = positions[offset]!, z = positions[offset + 2]!, dy = layout.lamps[0]!.y;
      const d2 = x * x + z * z + dy * dy, d = Math.sqrt(d2), fade = Math.max(0, Math.min(1, (14 - d) / 6));
      const direct = dy / d * (0.35 + 0.65 * dy / d) * fade * fade * (3 - 2 * fade) / (1 + d2 / 2.56);
      const i = Math.floor(x / 1.5 + 4.5), j = Math.floor(z / 1.5 + 4.5);
      let fill = 0;
      for (let b = j - 1; b <= j + 1; b++) for (let a = i - 1; a <= i + 1; a++) fill += result.probes[(b * 9 + a) * 3]!;
      return result.light[offset]! / (direct + fill * 0.12 / 9);
    };
    expect(aoAt(0)).toBeLessThan(aoAt(3) - 0.2);
    expect(aoAt(3)).toBeCloseTo(1, 5);
  });

  it('samples exact cell centres, interpolates all four neighbours and clamps the edges', () => {
    const layout = room(), { probes } = bakeFacility(layout, new Float32Array(), new Float32Array());
    for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) {
      const id = (j * 9 + i) * 3;
      expect(sampleProbe(layout, probes, (i - 4) * 1.5, (j - 4) * 1.5)).toEqual(Array.from(probes.subarray(id, id + 3)));
    }
    const middle = sampleProbe(layout, probes, 0.75, 0.75);
    for (let c = 0; c < 3; c++) expect(middle[c]).toBeCloseTo(
      (probes[(4 * 9 + 4) * 3 + c]! + probes[(4 * 9 + 5) * 3 + c]! + probes[(5 * 9 + 4) * 3 + c]! + probes[(5 * 9 + 5) * 3 + c]!) / 4, 7);
    expect(sampleProbe(layout, probes, -100, -100)).toEqual(Array.from(probes.subarray(0, 3)));
    expect(sampleProbe(layout, probes, NaN, 0)).toEqual([0, 0, 0]);
  });
});
