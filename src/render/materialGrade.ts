import * as THREE from 'three';

/** What a surface is, for the palette regrade. The Kenney kits paint every model from a bright
 * flat-colour palette texture; the stylised dusk look wants muted, related hues, so each kind of
 * surface is pulled toward one palette colour (docs/visual-overhaul.md, palette table) while
 * keeping its own light and dark detail. */
export type SurfaceKind = 'foliage' | 'bark' | 'rock' | 'building' | 'roof' | 'ground' | 'road' | 'concrete' | 'character';

interface SurfaceGrade {
  /** Palette colour the surface leans toward (sRGB hex). */
  readonly tint: number;
  /** 0 keeps the original hue, 1 replaces it with the tint at the original brightness. */
  readonly colorize: number;
  readonly saturation: number;
  readonly brightness: number;
}

export const SURFACE_GRADES: Record<SurfaceKind, SurfaceGrade> = {
  foliage: { tint: 0x46583e, colorize: 0.78, saturation: 0.55, brightness: 0.58 },
  bark: { tint: 0x5a4a3a, colorize: 0.7, saturation: 0.6, brightness: 0.7 },
  rock: { tint: 0x8a8578, colorize: 0.5, saturation: 0.6, brightness: 0.9 },
  building: { tint: 0xa99d84, colorize: 0.62, saturation: 0.55, brightness: 0.9 },
  roof: { tint: 0x3a4040, colorize: 0.35, saturation: 0.7, brightness: 0.95 },
  ground: { tint: 0x6b6a4a, colorize: 0.55, saturation: 0.6, brightness: 1.2 },
  road: { tint: 0x6a604c, colorize: 0.3, saturation: 0.8, brightness: 0.95 },
  concrete: { tint: 0x8e8b7e, colorize: 0.4, saturation: 0.7, brightness: 0.95 },
  character: { tint: 0x7d7a6a, colorize: 0.2, saturation: 0.82, brightness: 0.95 },
};

const LUMA = new THREE.Vector3(0.2126, 0.7152, 0.0722);

/** Tint divided by its own luminance, so colourising keeps each texel's original brightness. */
function normalisedTint(hex: number): THREE.Vector3 {
  const color = new THREE.Color(hex);
  const v = new THREE.Vector3(color.r, color.g, color.b);
  return v.divideScalar(Math.max(v.dot(LUMA), 1e-4));
}

const graded = new WeakSet<THREE.Material>();

/** Patches a standard material's shader so its base colour (texture times vertex colour times
 * .color) is regraded toward the surface kind's palette colour. Idempotent per material instance,
 * and shared materials compile once per kind thanks to customProgramCacheKey. Works on any
 * MeshStandardMaterial or MeshLambertMaterial; other material types are left alone. */
export function gradeMaterial(material: THREE.Material, kind: SurfaceKind): void {
  if (graded.has(material)) return;
  if (!(material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshLambertMaterial)) return;
  graded.add(material);
  const grade = SURFACE_GRADES[kind];
  const tint = normalisedTint(grade.tint);
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uGradeTint = { value: tint };
    shader.uniforms.uGradeParams = { value: new THREE.Vector3(grade.colorize, grade.saturation, grade.brightness) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGradeTint;\nuniform vec3 uGradeParams;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    float gradeLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 graded = mix(vec3(gradeLuma), diffuseColor.rgb, uGradeParams.y);
    graded = mix(graded, gradeLuma * uGradeTint, uGradeParams.x);
    diffuseColor.rgb = graded * uGradeParams.z;
  }`,
      );
  };
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousKey()}|grade:${kind}`;
  material.needsUpdate = true;
}

/** Grades every mesh material under `root`. */
export function gradeObject(root: THREE.Object3D, kind: SurfaceKind | ((mesh: THREE.Mesh, material: THREE.Material) => SurfaceKind | null)): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      const resolved = typeof kind === 'function' ? kind(child, material) : kind;
      if (resolved) gradeMaterial(material, resolved);
    }
  });
}
