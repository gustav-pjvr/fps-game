import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { worldBox } from './structureGeometry.ts';

describe('worldBox', () => {
  it('scales every face to the same world tile size', () => {
    const geometry = worldBox(4, 2, 1, 2);
    expect(geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect(geometry.parameters).toMatchObject({ width: 4, height: 2, depth: 1 });
    const uv = geometry.getAttribute('uv');
    const spans = [[0.5, 1], [0.5, 1], [2, 0.5], [2, 0.5], [2, 1], [2, 1]];
    spans.forEach(([u, v], face) => {
      const indices = [0, 1, 2, 3].map((vertex) => face * 4 + vertex);
      const us = indices.map((vertex) => uv.getX(vertex));
      const vs = indices.map((vertex) => uv.getY(vertex));
      expect(Math.min(...us)).toBe(0);
      expect(Math.max(...us)).toBe(u);
      expect(Math.min(...vs)).toBe(0);
      expect(Math.max(...vs)).toBe(v);
    });
    geometry.dispose();
  });
});
