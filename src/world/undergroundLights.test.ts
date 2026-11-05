import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { lookFor } from '../render/look.ts';
import { setHeightOverride } from './TerrainGenerator.ts';
import { buildTowerLab } from './towerUnderground.ts';
import { clearUnderground, isUnderground, registerUndergroundVolume, setCutZones } from './underground.ts';
import { UndergroundLights, UNDERGROUND_FOG_COLOR, UNDERGROUND_LIGHT_POOL, easeUndergroundAmount, undergroundLook, undergroundVisible, type UndergroundTower } from './undergroundLights.ts';

afterEach(() => { clearUnderground(); setHeightOverride(null); });

describe('underground look', () => {
  it('detects the core room and underground volumes, but not above the room', () => {
    setHeightOverride(() => 10);
    setCutZones([{ cx: 0, cz: 0, halfX: 2.7, halfZ: 2.7 }]);
    registerUndergroundVolume({ minX: 10, maxX: 20, minZ: 10, maxZ: 20, floorY: -9, ceilY: -3 });
    expect(isUnderground(0, 11.5, 0)).toBe(true);
    expect(isUnderground(0, 14, 0)).toBe(false);
    expect(isUnderground(15, -7, 15)).toBe(true);
    expect(isUnderground(15, 11.5, 15)).toBe(false);
  });

  it('eases in both directions, independently of frame rate, and settles exactly', () => {
    const first = easeUndergroundAmount(0, true, 0.1);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(1);
    expect(easeUndergroundAmount(first, true, 0.1)).toBeCloseTo(easeUndergroundAmount(0, true, 0.2), 12);
    let amount = 0;
    for (let i = 0; i < 30; i++) amount = easeUndergroundAmount(amount, true, 1 / 60);
    expect(amount).toBe(1);
    expect(easeUndergroundAmount(amount, false, 0.1)).toBeGreaterThan(0);
    expect(easeUndergroundAmount(amount, false, 0.1)).toBeLessThan(1);
    for (let i = 0; i < 30; i++) amount = easeUndergroundAmount(amount, false, 1 / 60);
    expect(amount).toBe(0);
  });

  it.each(['day', 'night', 'fog'] as const)('restores the exact %s look with and without environment lighting', weather => {
    const look = lookFor(weather);
    for (const environment of [false, true]) {
      let amount = 0;
      const outdoor = undergroundLook(look, environment, amount);
      for (let i = 0; i < 30; i++) amount = easeUndergroundAmount(amount, true, 1 / 60);
      const dark = undergroundLook(look, environment, amount);
      expect(dark.sunIntensity).toBeCloseTo(look.sunIntensity * 0.05);
      expect(dark.hemiIntensity).toBeCloseTo(environment ? 0 : look.hemiIntensity * 0.05);
      expect(dark.environmentIntensity).toBeCloseTo(look.environmentIntensity * 0.05);
      expect([dark.fogNear, dark.fogFar]).toEqual([4, 40]);
      expect(dark.fogColor).toBe(UNDERGROUND_FOG_COLOR);
      for (let i = 0; i < 120; i++) expect(undergroundLook(look, environment, amount)).toEqual(dark);
      for (let i = 0; i < 30; i++) amount = easeUndergroundAmount(amount, false, 1 / 60);
      expect(undergroundLook(look, environment, amount)).toEqual(outdoor);
      expect(outdoor).toEqual({ sunIntensity: look.sunIntensity, hemiIntensity: environment ? 0 : look.hemiIntensity,
        environmentIntensity: look.environmentIntensity, fogNear: look.fog.near, fogFar: look.fog.far, fogColor: look.sky.haze });
      const halfway = undergroundLook(look, environment, 0.5);
      expect(halfway.fogNear).toBe((look.fog.near + 4) / 2);
      expect(halfway.fogFar).toBe((look.fog.far + 40) / 2);
    }
  });
});

describe('underground light pool', () => {
  it('keeps the same three lights, picks the nearest in 3D within 30 m, and parks unused lights', () => {
    const scene = new THREE.Scene(), pool = new UndergroundLights(scene);
    const lights = scene.children.filter((child): child is THREE.PointLight => child instanceof THREE.PointLight);
    expect(lights).toHaveLength(UNDERGROUND_LIGHT_POOL);
    expect(lights.every(light => light.intensity === 0 && light.distance === 14 && !light.castShadow)).toBe(true);
    const camera = new THREE.Vector3();
    const lamps = [new THREE.Vector3(10, 0, 0), new THREE.Vector3(0, 40, 0), new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 0, 3)];
    pool.update(camera, 1, lamps);
    expect(lights.map(light => light.position.toArray())).toEqual([[1, 0, 0], [0, 2, 0], [0, 0, 3]]);
    expect(lights.every(light => light.intensity === 6 && light.visible)).toBe(true);
    pool.update(new THREE.Vector3(0, 39, 0), 0.5, lamps);
    expect(lights[0]!.position.toArray()).toEqual([0, 40, 0]);
    expect(lights.map(light => light.intensity)).toEqual([6, 0, 0]);
    pool.update(camera, 1, [new THREE.Vector3(30, 0, 0), new THREE.Vector3(30.01, 0, 0)]);
    expect(lights.map(light => light.intensity)).toEqual([6, 0, 0]);
    pool.update(camera, 0, lamps);
    expect(lights.every(light => light.intensity === 0 && light.visible)).toBe(true);
    pool.update(camera, 1, []);
    expect(scene.children).toEqual(lights);
    pool.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it.each(['south', 'west', 'north'] as const)('places corridor and lab lamps inside the %s layout in world space', orientation => {
    setHeightOverride(() => 7);
    for (const kind of ['full', 'compact'] as const) {
      const lab = buildTowerLab(0, { x: 100, z: 50 }, orientation, 3, kind);
      expect(lab.lamps).toHaveLength(kind === 'full' ? 7 : 4);
      lab.lamps.forEach((lamp, i) => {
        const volume = lab.volumes[lab.volumes.length - (i === 0 ? 2 : 1)]!;
        expect(lamp.x).toBeGreaterThan(volume.minX);
        expect(lamp.x).toBeLessThan(volume.maxX);
        expect(lamp.z).toBeGreaterThan(volume.minZ);
        expect(lamp.z).toBeLessThan(volume.maxZ);
        expect(lamp.y).toBeGreaterThan(volume.floorY);
        expect(lamp.y).toBeLessThan(volume.ceilY);
      });
    }
    expect(buildTowerLab(0, { x: 100, z: 50 }, orientation, 1, 'dead-end').lamps).toEqual([]);
  });
});

describe('underground culling', () => {
  const tower: UndergroundTower = { group: new THREE.Group(), position: new THREE.Vector3(), door: new THREE.Vector3(3, 1.1, 0), lamps: [] };
  it('requires the horizontal tower radius even while underground, including during the fade', () => {
    expect(undergroundVisible(new THREE.Vector3(45, -20, 0), tower, 1)).toBe(true);
    expect(undergroundVisible(new THREE.Vector3(45.01, -20, 0), tower, 1)).toBe(false);
    expect(undergroundVisible(new THREE.Vector3(20, -20, 0), tower, 0.001)).toBe(true);
    expect(undergroundVisible(new THREE.Vector3(20, -20, 0), tower, 0)).toBe(false);
  });
  it('shows meshes near the door outdoors, but not high above the door', () => {
    expect(undergroundVisible(new THREE.Vector3(11, 1.1, 0), tower, 0)).toBe(true);
    expect(undergroundVisible(new THREE.Vector3(11.01, 1.1, 0), tower, 0)).toBe(false);
    expect(undergroundVisible(new THREE.Vector3(3, 20, 0), tower, 0)).toBe(false);
  });
});
