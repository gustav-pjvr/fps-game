import { ShaderChunk, type MeshStandardMaterial } from 'three';

const HEMISPHERE_TERM = 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );';

/** Static facility surfaces take their lamp light from the bake. The hemisphere fill stands in for
 * that light on moving things only (Game.updateFacilityLight), so it is left out here; otherwise it
 * lit every wall evenly and flattened the pools of lamp light. */
const LIGHTS_WITHOUT_HEMISPHERE = ShaderChunk.lights_fragment_begin.replace(HEMISPHERE_TERM, '');

export function withBakedLight(material: MeshStandardMaterial): MeshStandardMaterial {
  const clone = material.clone();
  const originalCompile = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey();
  clone.onBeforeCompile = (shader, renderer) => {
    originalCompile.call(clone, shader, renderer);
    shader.vertexShader = 'attribute vec3 bakedLight;\nvarying vec3 vBakedLight;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBakedLight = bakedLight;');
    shader.fragmentShader = 'varying vec3 vBakedLight;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', LIGHTS_WITHOUT_HEMISPHERE);
    shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>',
      'reflectedLight.indirectDiffuse += vBakedLight * BRDF_Lambert( diffuseColor.rgb );\n#include <aomap_fragment>');
  };
  clone.customProgramCacheKey = () => `${originalKey}:facility-baked-light-v2`;
  return clone;
}
