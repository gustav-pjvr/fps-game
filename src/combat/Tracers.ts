import * as THREE from 'three';
import { TRACER_COLOR, TRACER_LENGTH, TRACER_SPEED } from '../core/config.ts';

/** Most streaks in flight at once; a new shot past this replaces the oldest. */
const MAX_TRACERS = 128;
/** Half the ribbon's width in metres: the glow, with the white core much narrower inside it. */
const HALF_WIDTH = 0.045;
/** A far streak never draws thinner than this many pixels each side; it dims instead of shimmering. */
const MIN_HALF_WIDTH_PX = 1.4;
/** Peak brightness at the head. Well above 1, so the bloom pass catches it the way it catches the
 * weapon glow and the muzzle flash. */
const INTENSITY = 7;

const tracerVertex = /* glsl */ `
  attribute vec3 aTail;
  attribute vec3 aHead;
  attribute vec3 aColor;
  uniform float uViewportHeight;
  varying float vAcross;
  varying float vAlong;
  varying float vDim;
  varying vec3 vColor;
  void main() {
    vec3 point = mix(aTail, aHead, position.y);
    vec3 axis = aHead - aTail;
    float axisLength = length(axis);
    vec3 dir = axisLength > 1e-5 ? axis / axisLength : vec3(0.0, 0.0, 1.0);
    vec3 toCamera = normalize(cameraPosition - point);
    vec3 across = cross(dir, toCamera);
    float acrossLength = length(across);
    // A shot flying straight away from the camera has no side; fall back to the camera's right.
    vec3 cameraRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 side = acrossLength > 1e-3 ? across / acrossLength : cameraRight;

    float distanceToCamera = length(cameraPosition - point);
    float metresPerPixel = 2.0 * distanceToCamera / (projectionMatrix[1][1] * uViewportHeight);
    float halfWidth = max(${HALF_WIDTH.toFixed(3)}, ${MIN_HALF_WIDTH_PX.toFixed(2)} * metresPerPixel);
    vDim = clamp(${HALF_WIDTH.toFixed(3)} / halfWidth, 0.3, 1.0);

    point += side * position.x * halfWidth;
    vAcross = position.x;
    vAlong = position.y;
    vColor = aColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(point, 1.0);
  }
`;

const tracerFragment = /* glsl */ `
  varying float vAcross;
  varying float vAlong;
  varying float vDim;
  varying vec3 vColor;
  void main() {
    float edge = 1.0 - abs(vAcross);
    float glow = edge * edge;
    float core = pow(edge, 10.0);
    // Hot at the head, burning out toward the tail.
    float tail = vAlong * vAlong;
    vec3 colour = mix(vColor, vec3(1.0), core * 0.8);
    float energy = (glow * 0.55 + core) * tail * vDim * ${INTENSITY.toFixed(1)};
    gl_FragColor = vec4(colour * energy, 1.0);
  }
`;

interface ActiveTracer {
  readonly start: THREE.Vector3;
  readonly direction: THREE.Vector3;
  readonly distance: number;
  readonly color: THREE.Color;
  travelled: number;
}

/**
 * Bullet streaks from muzzle to impact, purely cosmetic (the hit already landed). Each is a
 * camera-facing ribbon drawn additively in HDR: a white-hot core with a coloured glow that fades
 * toward the tail, so bloom picks it out against the dusk the way it does the rest of the light in
 * the scene. The streak grows out of the muzzle, flies at TRACER_SPEED and is swallowed at the
 * impact point. All of them share one instanced draw.
 */
export class Tracers {
  private readonly active: ActiveTracer[] = [];
  private readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly tails: THREE.InstancedBufferAttribute;
  private readonly heads: THREE.InstancedBufferAttribute;
  private readonly colors: THREE.InstancedBufferAttribute;
  private readonly defaultColor = new THREE.Color(TRACER_COLOR);
  private readonly colorCache = new Map<number, THREE.Color>();
  private readonly drawingBufferSize = new THREE.Vector2();

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.InstancedBufferGeometry();
    // x runs across the ribbon (-1 to 1), y along it (0 at the tail, 1 at the head).
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.tails = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TRACERS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.heads = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TRACERS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TRACERS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aTail', this.tails);
    geometry.setAttribute('aHead', this.heads);
    geometry.setAttribute('aColor', this.colors);
    geometry.instanceCount = 0;

    const material = new THREE.ShaderMaterial({
      vertexShader: tracerVertex,
      fragmentShader: tracerFragment,
      uniforms: { uViewportHeight: { value: 1080 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.mesh.onBeforeRender = (renderer) => {
      material.uniforms.uViewportHeight!.value = renderer.getDrawingBufferSize(this.drawingBufferSize).y;
    };
    scene.add(this.mesh);
  }

  /** `color` defaults to the player's own tracer color - enemy fire (fair combat, Phase C) passes a
   * distinct color so the player has a real visual signal of incoming shots, not just a health bar
   * tick. */
  spawn(start: THREE.Vector3, end: THREE.Vector3, color?: number): void {
    const direction = end.clone().sub(start);
    const distance = direction.length();
    if (distance < 1e-3) return;
    direction.divideScalar(distance);
    if (this.active.length >= MAX_TRACERS) this.active.shift();
    this.active.push({ start: start.clone(), direction, distance, color: color === undefined ? this.defaultColor : this.colorFor(color), travelled: 0 });
  }

  update(dt: number): void {
    let count = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const tracer = this.active[i]!;
      tracer.travelled += TRACER_SPEED * dt;
      // Done once the tail has reached the impact point.
      if (tracer.travelled - TRACER_LENGTH >= tracer.distance) {
        this.active.splice(i, 1);
      }
    }
    for (const tracer of this.active) {
      const head = Math.min(tracer.travelled, tracer.distance);
      const tail = Math.min(Math.max(tracer.travelled - TRACER_LENGTH, 0), tracer.distance);
      const { start, direction, color } = tracer;
      this.tails.setXYZ(count, start.x + direction.x * tail, start.y + direction.y * tail, start.z + direction.z * tail);
      this.heads.setXYZ(count, start.x + direction.x * head, start.y + direction.y * head, start.z + direction.z * head);
      this.colors.setXYZ(count, color.r, color.g, color.b);
      count++;
    }
    this.mesh.geometry.instanceCount = count;
    this.mesh.visible = count > 0;
    if (count > 0) {
      this.tails.needsUpdate = true;
      this.heads.needsUpdate = true;
      this.colors.needsUpdate = true;
    }
  }

  private colorFor(color: number): THREE.Color {
    let cached = this.colorCache.get(color);
    if (!cached) {
      cached = new THREE.Color(color);
      this.colorCache.set(color, cached);
    }
    return cached;
  }

  clear(): void {
    this.active.length = 0;
    this.mesh.geometry.instanceCount = 0;
    this.mesh.visible = false;
  }

  /** In flight right now (for tests and the debug overlay). */
  get activeCount(): number {
    return this.active.length;
  }
}
