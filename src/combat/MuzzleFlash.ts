import * as THREE from 'three';
import { VIEW_MODEL_LAYER } from '../core/Renderer.ts';
import { MUZZLE_FLASH_LIFETIME, MUZZLE_FLASH_LIGHT_INTENSITY, MUZZLE_FLASH_LIGHT_RANGE } from '../core/config.ts';

const FLASH_COLOR = 0xffb04d;

/** A soft radial glow, generated once rather than shipped as an asset - the flash is a single
 * additive-blended sprite, not detailed enough to need a sourced texture. */
function createFlashTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,176,77,0.8)');
    gradient.addColorStop(1, 'rgba(255,176,77,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/** Brief flash at the muzzle on every ranged shot (VISUAL_REALISM.md §7 - previously entirely
 * absent). A PointLight for the momentary scene-lighting kick plus an additive sprite for the
 * visible glow itself, both held at the world-space muzzle point WeaponManager already computes
 * for the tracer's start position. Single reusable instance (not a pool) since only one shot's
 * flash is ever visible at a time - the previous one has always faded within a frame or two. */
export class MuzzleFlash {
  private readonly light: THREE.PointLight;
  private readonly sprite: THREE.Sprite;
  private remaining = 0;

  constructor(scene: THREE.Scene) {
    this.light = new THREE.PointLight(FLASH_COLOR, 0, MUZZLE_FLASH_LIGHT_RANGE);
    scene.add(this.light);

    const material = new THREE.SpriteMaterial({
      map: createFlashTexture(),
      color: FLASH_COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sprite = new THREE.Sprite(material);
    this.sprite.scale.setScalar(0.3);
    // Drawn with the weapon (Renderer's view-model pass when the post stack is on), so the gun
    // itself, rendered after the world, can't cover the flash at its own muzzle.
    this.sprite.layers.set(VIEW_MODEL_LAYER);
    scene.add(this.sprite);
  }

  spawn(point: THREE.Vector3): void {
    this.light.position.copy(point);
    this.light.intensity = MUZZLE_FLASH_LIGHT_INTENSITY;
    this.sprite.position.copy(point);
    // Random roll so repeated flashes from the same weapon don't look like a static decal reused
    // every shot.
    this.sprite.material.rotation = Math.random() * Math.PI * 2;
    this.sprite.material.opacity = 1;
    this.remaining = MUZZLE_FLASH_LIFETIME;
  }

  update(dt: number): void {
    if (this.remaining <= 0) return;
    this.remaining -= dt;
    const t = Math.max(0, this.remaining / MUZZLE_FLASH_LIFETIME);
    this.light.intensity = MUZZLE_FLASH_LIGHT_INTENSITY * t;
    this.sprite.material.opacity = t;
  }
}
