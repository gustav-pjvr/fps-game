import * as THREE from 'three';
import type { LookPreset } from './look.ts';

/** GLSL shared by the sky dome and the patched fog (see installLookFog): the colour of the horizon
 * in a given direction. Using one function for both is what makes distant terrain fade into exactly
 * the sky behind it instead of into a flat fog colour. */
export const HORIZON_COLOR_GLSL = /* glsl */ `
vec3 lookHorizonColor(vec3 dir, vec3 sunDir, vec3 haze, vec3 horizonSun, float strength) {
  float toward = max(dot(normalize(vec3(dir.x, 0.0, dir.z) + vec3(0.0, 1e-4, 0.0)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0);
  return mix(haze, horizonSun, pow(toward, 3.0) * strength);
}
`;

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Pin the dome to the far plane so it never clips the world and never writes nearer depth.
  gl_Position = clip.xyww;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uBand;
uniform vec3 uHaze;
uniform vec3 uHorizonSun;
uniform float uHorizonSunStrength;
uniform vec3 uSunDir;
uniform vec3 uSunDisc;
uniform float uSunCos;
uniform vec3 uSunGlow;
uniform float uStars;
varying vec3 vDir;

${HORIZON_COLOR_GLSL}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  vec3 horizon = lookHorizonColor(dir, uSunDir, uHaze, uHorizonSun, uHorizonSunStrength);
  vec3 col = mix(horizon, uBand, smoothstep(0.0, 0.38, h));
  col = mix(col, uZenith, smoothstep(0.3, 0.95, h));

  float cosA = dot(dir, uSunDir);
  float disc = smoothstep(uSunCos, uSunCos + 0.00035, cosA);
  float glow = pow(max(cosA, 0.0), 180.0) * 1.4 + pow(max(cosA, 0.0), 12.0) * 0.35;
  col += uSunGlow * glow * smoothstep(-0.15, 0.05, h);
  col = mix(col, uSunDisc * 6.0, disc);

  if (uStars > 0.0) {
    vec3 cell = floor(dir * 420.0);
    float star = step(0.9975, hash13(cell)) * smoothstep(0.05, 0.4, h);
    col += vec3(star) * uStars * (0.6 + 0.8 * hash13(cell + 7.0));
  }

  // Break up 8-bit banding in the long gradients.
  col += (hash13(gl_FragCoord.xyx) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Gradient dome with a sun (or moon) disc and glow, replacing three's physical Sky so the sky
 * can be art-directed to the palette in look.ts. Follows the camera (see follow) so the 800 m world
 * never reaches its edge. */
export class StylizedSky extends THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  constructor(look: LookPreset) {
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uBand: { value: new THREE.Color() },
        uHaze: { value: new THREE.Color() },
        uHorizonSun: { value: new THREE.Color() },
        uHorizonSunStrength: { value: 0 },
        uSunDir: { value: new THREE.Vector3() },
        uSunDisc: { value: new THREE.Color() },
        uSunCos: { value: 1 },
        uSunGlow: { value: new THREE.Color() },
        uStars: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    super(new THREE.SphereGeometry(1, 48, 24), material);
    this.frustumCulled = false;
    this.renderOrder = -1000;
    this.applyLook(look);
  }

  applyLook(look: LookPreset): void {
    const u = this.material.uniforms;
    (u.uZenith!.value as THREE.Color).setHex(look.sky.zenith);
    (u.uBand!.value as THREE.Color).setHex(look.sky.band);
    (u.uHaze!.value as THREE.Color).setHex(look.sky.haze);
    (u.uHorizonSun!.value as THREE.Color).setHex(look.sky.horizonSun);
    u.uHorizonSunStrength!.value = look.sky.horizonSunStrength;
    (u.uSunDir!.value as THREE.Vector3).copy(look.sunDirection);
    (u.uSunDisc!.value as THREE.Color).setHex(look.sky.sunDisc);
    u.uSunCos!.value = Math.cos(look.sky.sunDiscRadius);
    (u.uSunGlow!.value as THREE.Color).setHex(look.sky.sunGlow);
    u.uStars!.value = look.sky.stars;
  }

  /** Centres the dome on the camera; the radius only has to sit inside the far plane, and the
   * vertex shader pins depth to the far plane anyway. */
  follow(camera: THREE.Camera): void {
    this.position.copy(camera.position);
  }
}

/** Rewrites three's fog shader chunks so fog takes the horizon colour in the direction being looked
 * at (HORIZON_COLOR_GLSL) instead of one flat colour: amber toward the sun, haze away from it.
 * ShaderChunk is global, so this must run before the match's materials compile; Renderer calls it
 * in its constructor, and every match builds a fresh WebGLRenderer, so a weather change between
 * matches recompiles against the new values. `fogColor` (scene.fog.color) still carries the haze. */
export function installLookFog(look: LookPreset): void {
  const c = (hex: number): string => {
    const color = new THREE.Color(hex);
    return `vec3(${color.r.toFixed(5)}, ${color.g.toFixed(5)}, ${color.b.toFixed(5)})`;
  };
  const d = look.sunDirection;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogViewPosition;
#endif
`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogViewPosition = mvPosition.xyz;
#endif
`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogViewPosition;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${HORIZON_COLOR_GLSL}
#endif
`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = max( smoothstep( fogNear, fogFar, vFogDepth ), 1.0 - exp( - vFogDepth * ${look.fog.haze.toFixed(5)} ) );
  #endif
  vec3 lookFogDir = ( vec4( vFogViewPosition, 0.0 ) * viewMatrix ).xyz;
  vec3 lookFogColor = lookHorizonColor( lookFogDir, vec3(${d.x.toFixed(5)}, ${d.y.toFixed(5)}, ${d.z.toFixed(5)}), fogColor, ${c(look.sky.horizonSun)}, ${look.sky.horizonSunStrength.toFixed(3)} );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, lookFogColor, fogFactor );
#endif
`;
}
