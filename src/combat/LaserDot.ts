import * as THREE from 'three';

/** How far the laser reaches, and the dot's size as a fraction of its distance (so it reads the
 * same at arm's length and across a yard). */
const LASER_RANGE = 200;
const DOT_SIZE = 0.017;
const DOT_MIN = 0.02;

function createDotTexture(): THREE.CanvasTexture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,235,225,1)');
    gradient.addColorStop(0.22, 'rgba(255,70,50,1)');
    gradient.addColorStop(0.5, 'rgba(255,40,30,0.55)');
    gradient.addColorStop(1, 'rgba(255,40,30,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/** The laser sight's dot (docs/attachments.md): one sprite on whatever the gun points at,
 * drawn in the world, so walls and enemies wear it. Only the player's own; it changes no handling. */
export class LaserDot {
  private readonly sprite: THREE.Sprite;
  private readonly forward = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {
    const material = new THREE.SpriteMaterial({
      map: createDotTexture(),
      transparent: true,
      // Drawn as its own colour, not added to what is behind it and not dimmed by the tone
      // mapping: an additive dot vanished on sunlit grass.
      toneMapped: false,
      depthWrite: false,
    });
    this.sprite = new THREE.Sprite(material);
    this.sprite.name = 'laser-dot';
    this.sprite.visible = false;
    scene.add(this.sprite);
  }

  get range(): number {
    return LASER_RANGE;
  }

  /** `hitDistance`: how far along the camera's forward the gun's line meets something, or null
   * when the laser is off or nothing is in reach. */
  update(camera: THREE.Camera, hitDistance: number | null): void {
    this.sprite.visible = hitDistance !== null;
    if (hitDistance === null) return;
    camera.getWorldDirection(this.forward);
    // A hair toward the eye, so the surface it lands on does not swallow it.
    const distance = Math.max(0.1, hitDistance - 0.03);
    this.sprite.position.copy(camera.position).addScaledVector(this.forward, distance);
    this.sprite.scale.setScalar(Math.max(DOT_MIN, distance * DOT_SIZE));
  }

  dispose(): void {
    this.scene.remove(this.sprite);
    this.sprite.material.map?.dispose();
    this.sprite.material.dispose();
  }
}
