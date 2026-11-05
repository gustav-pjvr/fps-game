import { describe, expect, it } from 'vitest';
import { enemyInTorchBeam, flashLightsPlayer, visibility, visibilityForEnemy, type VisibilityInputs } from './playerVisibility.ts';
import { FLASH_LIGHT_RANGE, FLASH_LIGHT_SECONDS } from '../../combat/grenades/grenadeTuning.ts';
import { bakeFacility, sampleProbe } from '../../world/facility/facilityBake.ts';
import { cellCentre, generateFacilityLayout } from '../../world/facility/facilityLayout.ts';

const base: VisibilityInputs = {
  map: 'valley', weather: 'night', secondsSinceShot: Infinity, torchOn: false, enemyInTorchBeam: false,
};

describe('player visibility', () => {
  it.each([['day', 1], ['fog', 0.75], ['night', 0.4]] as const)('uses Valley %s visibility', (weather, expected) => {
    expect(visibility({ ...base, weather })).toBe(expected);
  });

  it('calibrates a real lit atrium and dark room using the same sampler as probeAt', () => {
    const layout = generateFacilityLayout(1);
    const { probes } = bakeFacility(layout, new Float32Array(), new Float32Array());
    const dark = layout.rooms.find(room => room.dark)!;
    const point = cellCentre(Math.floor((dark.i0 + dark.i1) / 2), Math.floor((dark.j0 + dark.j1) / 2));
    const lumaAt = (x: number, z: number): number => {
      const [r, g, b] = sampleProbe(layout, probes, x, z);
      return r * 0.2126 + g * 0.7152 + b * 0.0722;
    };
    const litLuma = lumaAt(0, 0), darkLuma = lumaAt(point.x, point.z);
    expect(litLuma).toBeCloseTo(0.36813, 5);
    expect(darkLuma).toBeCloseTo(0.12890, 5);
    expect(visibility({ ...base, map: 'facility', probeLuma: litLuma })).toBeCloseTo(1);
    expect(visibility({ ...base, map: 'facility', probeLuma: darkLuma })).toBeCloseTo(0.25);
  });

  it('clamps Facility darkness and ignores outdoor weather indoors', () => {
    expect(visibility({ ...base, map: 'facility', probeLuma: 0 })).toBe(0.2);
    expect(visibility({ ...base, map: 'facility', probeLuma: 10 })).toBe(1);
    for (const weather of ['day', 'fog', 'night'] as const) {
      expect(visibility({ ...base, map: 'facility', weather, probeLuma: 0.12890296173673124 })).toBe(0.25);
    }
  });

  it('reveals shots for 0.6 seconds and only reveals an active torch inside its beam', () => {
    for (const secondsSinceShot of [0, 0.3, 0.599]) expect(visibility({ ...base, secondsSinceShot })).toBe(1);
    expect(visibility({ ...base, secondsSinceShot: 0.6 })).toBe(0.4);
    expect(visibility({ ...base, torchOn: true })).toBe(0.4);
    expect(visibility({ ...base, enemyInTorchBeam: true })).toBe(0.4);
    expect(visibility({ ...base, torchOn: true, enemyInTorchBeam: true })).toBe(1);
    expect(visibility({ ...base, map: 'facility', probeLuma: 0, secondsSinceShot: 0 })).toBe(1);
  });
});

describe('player visibility in Valley houses and under a flash', () => {
  it('drops to 0.3 in a house room with its lamp off at night or in fog, not with it lit or by day', () => {
    for (const weather of ['night', 'fog'] as const) {
      expect(visibility({ ...base, weather, houseRoomLit: false })).toBe(0.3);
      expect(visibility({ ...base, weather, houseRoomLit: true })).toBe(weather === 'night' ? 0.4 : 0.75);
      expect(visibility({ ...base, weather, houseRoomLit: null })).toBe(weather === 'night' ? 0.4 : 0.75);
    }
    expect(visibility({ ...base, weather: 'day', houseRoomLit: false })).toBe(1);
    // A shot still gives the player away in the dark room.
    expect(visibility({ ...base, houseRoomLit: false, secondsSinceShot: 0.1 })).toBe(1);
  });

  it.each(['day', 'fog', 'night'] as const)('counts underground as an unlit room in %s', (weather) => {
    expect(visibility({ ...base, weather, underground: true })).toBe(0.3);
    expect(visibility({ ...base, weather, underground: false })).toBe(visibility({ ...base, weather }));
    // Shots, flashes and the torch beam still raise it.
    expect(visibility({ ...base, weather, underground: true, secondsSinceShot: 0.1 })).toBe(1);
    expect(visibility({ ...base, weather, underground: true, flashLit: true })).toBe(1);
    expect(visibility({ ...base, weather, underground: true, torchOn: true, enemyInTorchBeam: true })).toBe(1);
  });

  it('is 1 while the light of a flash grenade is on the player', () => {
    expect(visibility({ ...base, flashLit: true })).toBe(1);
    expect(visibility({ ...base, map: 'facility', probeLuma: 0, flashLit: true })).toBe(1);
    expect(visibility({ ...base, houseRoomLit: false, flashLit: true })).toBe(1);
  });

  it('finds a flash lighting the player only while its light lasts and within its range', () => {
    const player = { x: 0, y: 1, z: 0 };
    const flash = (at: number, x = 5) => ({ kind: 'flash', position: { x, y: 1, z: 0 }, at });
    expect(flashLightsPlayer([flash(10)], 10, player)).toBe(true);
    expect(flashLightsPlayer([flash(10)], 10 + FLASH_LIGHT_SECONDS * 0.9, player)).toBe(true);
    expect(flashLightsPlayer([flash(10)], 10 + FLASH_LIGHT_SECONDS, player)).toBe(false);
    expect(flashLightsPlayer([flash(10, FLASH_LIGHT_RANGE + 1)], 10, player)).toBe(false);
    expect(flashLightsPlayer([{ ...flash(10), kind: 'frag' }], 10, player)).toBe(false);
    expect(flashLightsPlayer([], 10, player)).toBe(false);
  });
});

describe('torch visibility per enemy', () => {
  const eye = { x: 0, y: 1.6, z: 0 }, aim = { x: 0, y: 0, z: -1 };

  it('bounds the beam to 28 metres and 25 degrees, including vertical aim', () => {
    expect(enemyInTorchBeam(eye, aim, { ...eye, z: -28 })).toBe(true);
    expect(enemyInTorchBeam(eye, aim, { ...eye, z: -28.001 })).toBe(false);
    expect(enemyInTorchBeam(eye, aim, { ...eye, z: 1 })).toBe(false);
    for (const angle of [24.99, 25.01]) {
      const r = angle * Math.PI / 180;
      expect(enemyInTorchBeam(eye, aim, { x: 10 * Math.sin(r), y: eye.y, z: -10 * Math.cos(r) })).toBe(angle < 25);
      expect(enemyInTorchBeam(eye, aim, { x: 0, y: eye.y + 10 * Math.sin(r), z: -10 * Math.cos(r) })).toBe(angle < 25);
    }
    expect(enemyInTorchBeam(eye, { x: 0, y: 1, z: 0 }, { ...eye, y: 20 })).toBe(true);
  });

  it('shares ambient visibility without revealing the player to enemies outside the beam', () => {
    const player = { value: 0.4, torchOn: true, eye, aim };
    expect(visibilityForEnemy(player, { ...eye, z: -10 })).toBe(1);
    expect(visibilityForEnemy(player, { ...eye, z: 10 })).toBe(0.4);
    expect(visibilityForEnemy({ ...player, torchOn: false }, { ...eye, z: -10 })).toBe(0.4);
    expect(player.value).toBe(0.4);
  });
});
