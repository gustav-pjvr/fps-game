import * as THREE from 'three';
import type { LookPreset } from '../render/look.ts';

export const UNDERGROUND_LIGHT_POOL = 3;

/** Exponential fade, settled exactly at either end after about half a second. */
export function easeUndergroundAmount(amount: number, underground: boolean, dt: number): number {
  const target = underground ? 1 : 0;
  const next = target + (amount - target) * Math.exp(-14 * Math.max(0, dt));
  return Math.abs(next - target) < 0.001 ? target : next;
}

/** The haze below ground: a cold near-black, so the lab reads as a buried facility rather than the
 * outdoor dusk haze pulled in close. */
export const UNDERGROUND_FOG_COLOR = 0x0a1312;
const fogFrom = new THREE.Color();
const fogTo = new THREE.Color();

/** Always derive from the current outdoor look, never from last frame's faded values. */
export function undergroundLook(look: LookPreset, environmentLighting: boolean, amount: number) {
  const scale = 1 - 0.95 * amount;
  const fogColor = amount === 0 ? look.sky.haze : amount === 1 ? UNDERGROUND_FOG_COLOR
    : fogFrom.setHex(look.sky.haze).lerp(fogTo.setHex(UNDERGROUND_FOG_COLOR), amount).getHex();
  return {
    fogColor,
    sunIntensity: look.sunIntensity * scale,
    hemiIntensity: (environmentLighting ? 0 : look.hemiIntensity) * scale,
    environmentIntensity: look.environmentIntensity * scale,
    fogNear: amount === 1 ? 4 : look.fog.near + (4 - look.fog.near) * amount,
    fogFar: amount === 1 ? 40 : look.fog.far + (40 - look.fog.far) * amount,
  };
}

export interface UndergroundTower {
  readonly group: THREE.Group;
  readonly position: THREE.Vector3Like;
  readonly door: THREE.Vector3Like;
  readonly lamps: readonly THREE.Vector3[];
}

export function undergroundVisible(camera: THREE.Vector3Like, tower: UndergroundTower, amount: number): boolean {
  const nearby = (camera.x - tower.position.x) ** 2 + (camera.z - tower.position.z) ** 2 <= 45 ** 2;
  const atDoor = (camera.x - tower.door.x) ** 2 + (camera.y - tower.door.y) ** 2 + (camera.z - tower.door.z) ** 2 <= 8 ** 2;
  return nearby && (amount > 0 || atDoor);
}

/** Fixed scene lights, independent of streamed meshes and their visibility. */
export class UndergroundLights {
  private readonly lights: THREE.PointLight[] = [];

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < UNDERGROUND_LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffd49a, 0, 14, 2);
      light.name = `underground-light-${i}`;
      light.castShadow = false;
      this.lights.push(light);
      scene.add(light);
    }
  }

  update(camera: THREE.Vector3Like, amount: number, lamps: readonly THREE.Vector3[]): void {
    const nearest = amount > 0 ? lamps.map(lamp => ({ lamp, distance: lamp.distanceToSquared(camera) }))
      .filter(pick => pick.distance <= 30 ** 2).sort((a, b) => a.distance - b.distance).slice(0, UNDERGROUND_LIGHT_POOL) : [];
    this.lights.forEach((light, i) => {
      const pick = nearest[i];
      if (pick) light.position.copy(pick.lamp);
      light.intensity = pick ? 6 : 0;
    });
  }

  dispose(): void {
    for (const light of this.lights) {
      light.removeFromParent();
      light.dispose();
    }
  }
}
