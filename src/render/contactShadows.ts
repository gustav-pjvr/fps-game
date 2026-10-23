import * as THREE from 'three';

/** Lift off the ground, in metres, so the shadow never z-fights the terrain it lies on. */
const GROUND_LIFT = 0.04;
/** Contact shadows only matter up close; past this they fade out instead of leaving dark spots in
 * the haze (the fog chunk would tint a multiply quad the wrong way, so they skip fog). */
const FADE_START = 70;
const FADE_END = 150;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec4 local = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
    #endif
    vec4 view = modelViewMatrix * local;
    vDepth = -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uStrength;
  uniform float uRect;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    // Disc: a soft radial falloff. Rect: a soft edge on all four sides of a footprint.
    float disc = 1.0 - smoothstep(0.15, 1.0, length(p));
    vec2 edge = 1.0 - smoothstep(vec2(0.55), vec2(1.0), abs(p));
    float shade = mix(disc * (0.6 + 0.4 * disc), edge.x * edge.y, uRect);
    shade *= 1.0 - smoothstep(${FADE_START.toFixed(1)}, ${FADE_END.toFixed(1)}, vDepth);
    // Multiply blending: 1 leaves the ground as it is, lower darkens it.
    gl_FragColor = vec4(vec3(1.0 - uStrength * shade), 1.0);
  }
`;

/**
 * Soft contact shadows under trees, rocks, houses and towers (docs/visual-overhaul.md, phase 5).
 * Real shadow maps are off on Low and too coarse on Medium to ground a trunk or a wall, so each
 * object gets a cheap darkened patch where it meets the ground, the way the Opus 5.5 test build
 * baked AO under its props. Multiply-blended, unlit, no depth write.
 */
export function createContactShadowMaterial(shape: 'disc' | 'rect', strength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uStrength: { value: strength }, uRect: { value: shape === 'rect' ? 1 : 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.MultiplyBlending,
    premultipliedAlpha: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
  });
}

/** A unit ground quad (1 x 1 m, facing up, uv 0 to 1), scaled per use. */
export function createContactShadowGeometry(): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

const SLOPE_STEP = 0.75;
const up = new THREE.Vector3(0, 1, 0);
const normal = new THREE.Vector3();
const tilt = new THREE.Quaternion();
const scale = new THREE.Vector3();
const position = new THREE.Vector3();

/**
 * The matrix for a disc of `radius` metres at (x, z), tilted to the terrain's slope so it lies on
 * the ground instead of half sinking into a hillside and half floating off it.
 */
export function contactShadowMatrix(sampleHeight: (x: number, z: number) => number, x: number, z: number, radius: number, target = new THREE.Matrix4()): THREE.Matrix4 {
  const dx = (sampleHeight(x + SLOPE_STEP, z) - sampleHeight(x - SLOPE_STEP, z)) / (2 * SLOPE_STEP);
  const dz = (sampleHeight(x, z + SLOPE_STEP) - sampleHeight(x, z - SLOPE_STEP)) / (2 * SLOPE_STEP);
  normal.set(-dx, 1, -dz).normalize();
  tilt.setFromUnitVectors(up, normal);
  position.set(x, sampleHeight(x, z) + GROUND_LIFT, z);
  scale.set(radius * 2, 1, radius * 2);
  return target.compose(position, tilt, scale);
}

export { GROUND_LIFT as CONTACT_SHADOW_LIFT };
