import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { isPointNearFootprint, type HouseFootprint } from './houseFootprint.ts';

describe('isPointNearFootprint', () => {
  const base: HouseFootprint = { originX: 10, originZ: -5, offsetX: 0, offsetZ: 0, halfWidth: 2, halfDepth: 4, rotationY: 0 };

  it('is true inside the footprint and false just outside it with no margin', () => {
    expect(isPointNearFootprint(10, -5, base, 0)).toBe(true);
    expect(isPointNearFootprint(11.9, -1.1, base, 0)).toBe(true);
    expect(isPointNearFootprint(12.1, -5, base, 0)).toBe(false);
    expect(isPointNearFootprint(10, -0.9, base, 0)).toBe(false);
  });

  it('reaches `margin` metres past each edge and rounds the corners', () => {
    expect(isPointNearFootprint(12.9, -5, base, 1)).toBe(true);
    expect(isPointNearFootprint(13.1, -5, base, 1)).toBe(false);
    // 0.8m past both the +X edge and the +Z edge: inside a squared-off margin, but 1.13m from the
    // corner, so outside the true 1m distance.
    expect(isPointNearFootprint(12.8, -0.2, base, 1)).toBe(false);
    expect(isPointNearFootprint(12.6, -0.4, base, 1)).toBe(true);
  });

  it('treats a negative margin as zero', () => {
    expect(isPointNearFootprint(11.9, -5, base, -3)).toBe(true);
    expect(isPointNearFootprint(12.1, -5, base, -3)).toBe(false);
  });

  it('swaps which world axis each dimension covers when the house is turned 90 degrees', () => {
    const turned: HouseFootprint = { ...base, rotationY: Math.PI / 2 };

    expect(isPointNearFootprint(10, -1.5, turned, 0)).toBe(false);
    expect(isPointNearFootprint(13.5, -5, turned, 0)).toBe(true);
  });

  it('matches where three.js actually draws the rotated, off-center model', () => {
    // An off-center footprint at an arbitrary rotation, checked against the same local-to-world
    // transform the visual group gets in BuildingManager.createBuilding.
    const footprint: HouseFootprint = { originX: 3, originZ: 7, offsetX: 1.5, offsetZ: -0.5, halfWidth: 1, halfDepth: 2.5, rotationY: 0.7 };
    const group = new THREE.Object3D();
    group.position.set(footprint.originX, 0, footprint.originZ);
    group.rotation.y = footprint.rotationY;
    group.updateMatrixWorld(true);
    const toWorld = (localX: number, localZ: number): THREE.Vector3 => group.localToWorld(new THREE.Vector3(localX, 0, localZ));

    const insideCorner = toWorld(footprint.offsetX + 0.95, footprint.offsetZ - 2.45);
    const outsideEdge = toWorld(footprint.offsetX + 1.05, footprint.offsetZ);
    const pastMargin = toWorld(footprint.offsetX, footprint.offsetZ + 2.5 + 0.6);
    const withinMargin = toWorld(footprint.offsetX, footprint.offsetZ + 2.5 + 0.4);

    expect(isPointNearFootprint(insideCorner.x, insideCorner.z, footprint, 0)).toBe(true);
    expect(isPointNearFootprint(outsideEdge.x, outsideEdge.z, footprint, 0)).toBe(false);
    expect(isPointNearFootprint(pastMargin.x, pastMargin.z, footprint, 0.5)).toBe(false);
    expect(isPointNearFootprint(withinMargin.x, withinMargin.z, footprint, 0.5)).toBe(true);
  });
});
