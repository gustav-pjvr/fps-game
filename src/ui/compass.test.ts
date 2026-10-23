import { describe, expect, it } from 'vitest';
import { bearingDeg, relativeAngleDeg } from './compass.ts';

describe('compass bearings', () => {
  it.each([
    ['N', 0, -1, 0],
    ['E', 1, 0, 90],
    ['S', 0, 1, 180],
    ['W', -1, 0, 270],
    ['NE', 1, -1, 45],
  ] as const)('%s follows north -Z and east +X', (_name, dx, dz, expected) => {
    expect(bearingDeg(dx, dz)).toBe(expected);
  });

  it.each([
    [90, 0, 90],
    [0, 90, -90],
    [180, 180, 0],
    [10, 350, 20],
    [350, 10, -20],
    [180, 0, -180],
  ])('source %s relative to heading %s gives arc angle %s', (source, heading, angle) => {
    expect(relativeAngleDeg(source, heading)).toBe(angle);
  });
});
