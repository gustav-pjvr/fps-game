import * as THREE from 'three';

const GLINT_COLOR = 0xfff4d6;
/** Several Ridge Walkers can be lining up at once; more than this in view at the same moment is
 * not a case worth a bigger pool. */
const POOL_SIZE = 6;
const GLINT_SCALE = 0.8;
/** Twinkles per second while a glint is showing - a flicker reads as a lens catching the light,
 * where a steady dot reads as a lamp. */
const TWINKLE_RATE = 9;

/** A four-point star of light, generated once rather than shipped as an asset (like MuzzleFlash's
 * glow): a soft core plus two thin cross streaks. */
function createGlintTexture(): THREE.CanvasTexture {
  const size = 64;
  const half = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const core = ctx.createRadialGradient(half, half, 0, half, half, half * 0.45);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(1, 'rgba(255,244,214,0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, size, size);
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const streak = ctx.createLinearGradient(half - dx * half, half - dy * half, half + dx * half, half + dy * half);
      streak.addColorStop(0, 'rgba(255,244,214,0)');
      streak.addColorStop(0.5, 'rgba(255,255,255,0.95)');
      streak.addColorStop(1, 'rgba(255,244,214,0)');
      ctx.fillStyle = streak;
      if (dx) ctx.fillRect(0, half - 1.5, size, 3);
      else ctx.fillRect(half - 1.5, 0, 3, size);
    }
  }
  return new THREE.CanvasTexture(canvas);
}

interface GlintSlot {
  readonly sprite: THREE.Sprite;
  remaining: number;
  duration: number;
}

/**
 * The Ridge Walker's warning (enemy AI v2, step 5 - docs/enemy-ai-v2.md): a scope glint at its head
 * for a moment before each long shot, so a player at range gets a fair tell to duck, the Halo lesson
 * that readable enemies feel smarter, not easier. Additive sprites held at a world point (the
 * sniper stands still while it aims), recycled round-robin from a small pool.
 */
export class GlintMarkers {
  private readonly slots: GlintSlot[] = [];
  private readonly texture: THREE.CanvasTexture;
  private cursor = 0;
  private elapsed = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.texture = createGlintTexture();
    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.SpriteMaterial({
        map: this.texture,
        color: GLINT_COLOR,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.setScalar(GLINT_SCALE);
      sprite.visible = false;
      scene.add(sprite);
      this.slots.push({ sprite, remaining: 0, duration: 1 });
    }
  }

  /** Shows a glint at `point` for `duration` seconds. */
  spawn(point: THREE.Vector3, duration: number): void {
    const slot = this.slots[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.slots.length;
    slot.sprite.position.copy(point);
    slot.sprite.visible = true;
    slot.remaining = duration;
    slot.duration = Math.max(duration, 1e-3);
  }

  update(dt: number): void {
    this.elapsed += dt;
    const twinkle = 0.65 + 0.35 * Math.sin(this.elapsed * TWINKLE_RATE * Math.PI * 2);
    for (const slot of this.slots) {
      if (slot.remaining <= 0) continue;
      slot.remaining -= dt;
      if (slot.remaining <= 0) {
        slot.sprite.visible = false;
        slot.sprite.material.opacity = 0;
        continue;
      }
      // Brightens toward the shot, so the last moment before it reads as the most urgent.
      const progress = 1 - slot.remaining / slot.duration;
      slot.sprite.material.opacity = Math.min(1, (0.4 + 0.6 * progress) * twinkle);
    }
  }

  dispose(): void {
    for (const slot of this.slots) {
      this.scene.remove(slot.sprite);
      slot.sprite.material.dispose();
    }
    this.texture.dispose();
  }
}
