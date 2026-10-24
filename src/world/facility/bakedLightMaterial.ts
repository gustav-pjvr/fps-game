import type { MeshStandardMaterial } from 'three';

export function withBakedLight(material: MeshStandardMaterial): MeshStandardMaterial {
  const clone = material.clone();
  const originalCompile = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey();
  clone.onBeforeCompile = (shader, renderer) => {
    originalCompile.call(clone, shader, renderer);
    shader.vertexShader = 'attribute vec3 bakedLight;\nvarying vec3 vBakedLight;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBakedLight = bakedLight;');
    shader.fragmentShader = 'varying vec3 vBakedLight;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>',
      'reflectedLight.indirectDiffuse += vBakedLight * BRDF_Lambert( diffuseColor.rgb );\n#include <aomap_fragment>');
  };
  clone.customProgramCacheKey = () => `${originalKey}:facility-baked-light-v1`;
  return clone;
}
