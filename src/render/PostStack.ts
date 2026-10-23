import * as THREE from 'three';
import { BlendFunction, BloomEffect, Effect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { LookPreset } from './look.ts';

/** Exposure, ACES, then the stylised-dusk grade (docs/visual-overhaul.md, "Grade"). The ACES fit
 * is three.js's own ACESFilmicToneMapping (RRT/ODT fit, exposure / 0.6), so the image keeps the
 * brightness the game was tuned at before the composer existed; the grade itself follows the Opus
 * 5.5 composite (reference/model-test/opus-5.5/renderer.js, compositeFS). Grade steps run in
 * display space and convert back to linear, because postprocessing encodes the final pass to sRGB. */
const gradeFragment = /* glsl */ `
uniform float uExposure;
uniform float uLift;
uniform float uGain;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform float uGrain;

vec3 lookRRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

vec3 lookAces(vec3 color) {
  const mat3 inputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = inputMat * color;
  color = lookRRTAndODTFit(color);
  color = outputMat * color;
  return clamp(color, 0.0, 1.0);
}

float lookHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = lookAces(inputColor.rgb);
  vec3 g = pow(c, vec3(1.0 / 2.2));
  float l = dot(g, vec3(0.2126, 0.7152, 0.0722));

  g = mix(vec3(l), g, uSaturation);
  g = clamp((g - 0.5) * uContrast + 0.5, 0.0, 1.0);
  // Teal lift in the shadows, warm gain in the highlights.
  g += uLift * (1.0 - l) * vec3(0.55, 0.95, 1.0);
  g *= mix(vec3(1.0), vec3(uGain, 1.0, 2.0 - uGain), smoothstep(0.35, 1.0, l));

  vec2 centred = (uv - 0.5) * vec2(aspect, 1.0);
  float vignette = smoothstep(0.35, 1.05, length(centred));
  g *= 1.0 - uVignette * vignette;

  float n = lookHash(uv * resolution + fract(time) * 1000.0) - 0.5;
  g += n * uGrain * (1.0 - 0.6 * l);

  outputColor = vec4(pow(clamp(g, 0.0, 1.0), vec3(2.2)), inputColor.a);
}
`;

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeFragment, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ['uExposure', new THREE.Uniform(1)],
        ['uLift', new THREE.Uniform(0)],
        ['uGain', new THREE.Uniform(1)],
        ['uSaturation', new THREE.Uniform(1)],
        ['uContrast', new THREE.Uniform(1)],
        ['uVignette', new THREE.Uniform(0)],
        ['uGrain', new THREE.Uniform(0)],
      ]),
    });
  }

  applyLook(look: LookPreset): void {
    const u = this.uniforms;
    u.get('uExposure')!.value = look.exposure;
    u.get('uLift')!.value = look.grade.lift;
    u.get('uGain')!.value = look.grade.gain;
    u.get('uSaturation')!.value = look.grade.saturation;
    u.get('uContrast')!.value = look.grade.contrast;
    u.get('uVignette')!.value = look.grade.vignette;
    u.get('uGrain')!.value = look.grade.grain;
  }
}

export interface PostStackOptions {
  /** Screen-space ambient occlusion (N8AO), High only. */
  readonly ambientOcclusion: boolean;
}

/** The composer pipeline for Medium and High (Low renders straight to the screen, see Renderer):
 * world -> AO (High) -> weapon view model (own pass, depth cleared, so it never clips into walls and
 * takes no AO) -> bloom + grade -> SMAA. Bloom reads the HDR buffer before tone mapping, so only
 * real light (emissive glow, the sun, tracers, muzzle flash) blooms, not bright paint. */
export class PostStack {
  readonly composer: EffectComposer;
  private readonly grade = new GradeEffect();
  private readonly bloom: BloomEffect;
  private readonly ao: N8AOPostPass | null;
  readonly ambientOcclusion: boolean;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    /** Null when nothing is parented to the camera (the title screen), which skips that pass. */
    viewModelCamera: THREE.PerspectiveCamera | null,
    look: LookPreset,
    options: PostStackOptions,
  ) {
    this.ambientOcclusion = options.ambientOcclusion;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));

    if (options.ambientOcclusion) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      this.ao = new N8AOPostPass(scene, camera, size.x, size.y);
      this.ao.configuration.aoRadius = 2.2;
      this.ao.configuration.distanceFalloff = 0.8;
      this.ao.configuration.intensity = 2.6;
      this.ao.configuration.color = new THREE.Color(0x0e1a1a);
      this.ao.configuration.gammaCorrection = false;
      this.ao.configuration.halfRes = true;
      this.ao.setQualityMode('Low');
      this.composer.addPass(this.ao);
    } else {
      this.ao = null;
    }

    if (viewModelCamera) {
      const viewModelPass = new RenderPass(scene, viewModelCamera);
      viewModelPass.clearPass.setClearFlags(false, true, false);
      viewModelPass.ignoreBackground = true;
      viewModelPass.skipShadowMapUpdate = true;
      this.composer.addPass(viewModelPass);
    }

    this.bloom = new BloomEffect({ blendFunction: BlendFunction.ADD, mipmapBlur: true, radius: 0.7, levels: 6 });
    this.composer.addPass(new EffectPass(camera, this.bloom, this.grade));
    this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));
    this.applyLook(look);
  }

  applyLook(look: LookPreset): void {
    this.grade.applyLook(look);
    this.bloom.intensity = look.bloom.intensity;
    this.bloom.luminanceMaterial.threshold = look.bloom.threshold;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  render(deltaSeconds?: number): void {
    this.composer.render(deltaSeconds);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
