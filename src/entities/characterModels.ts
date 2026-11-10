import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ACCENT_CYAN, THREAT_RED } from '../render/look.ts';

/**
 * The full-size characters (docs/visual-overhaul.md, phase 7): Quaternius "Ultimate Modular Men"
 * (CC0, see public/assets/models/characters/README.md), replacing the Kenney Mini Characters.
 * Enemies wear the SWAT kit with a red visor, other players the spacesuit with its trim lit cyan,
 * so a silhouette at dusk reads as friend or threat by its light.
 */
export interface CharacterKind {
  readonly path: string;
  /** The material that carries the character's accent light: the SWAT visor, the spacesuit trim. */
  readonly accentMaterial: string;
  readonly accent: number;
  readonly accentIntensity: number;
}

export const ENEMY_CHARACTER: CharacterKind = {
  path: '/assets/models/characters/swat.glb',
  accentMaterial: 'Visor',
  accent: THREAT_RED,
  accentIntensity: 2.2,
};
export const PLAYER_CHARACTER: CharacterKind = {
  path: '/assets/models/characters/spacesuit.glb',
  accentMaterial: 'SciFi_Light_Accent',
  accent: ACCENT_CYAN,
  accentIntensity: 0.9,
};

/** Both rigs stand about 1.85 m tall in their bind pose (measured with @gltf-transform getBounds:
 * 1.852 for the SWAT kit, 1.886 with the spacesuit's helmet), feet at local Y = 0. */
const BIND_HEIGHT = 1.852;

/** The clips the game plays, by role. */
export const CHARACTER_CLIPS = {
  idle: 'Idle_Gun',
  walk: 'Walk',
  run: 'Run',
  fire: 'Gun_Shoot',
  death: 'Death',
  /** Standing and running with the weapon up: how other players are shown (RemotePlayer). */
  aim: 'Idle_Gun_Pointing',
  runAim: 'Run_Shoot',
} as const;

export type CharacterClipRole = keyof typeof CHARACTER_CLIPS;

export interface CharacterInstance {
  /** The posed model, scaled to `height` with its feet at -height / 2 (a capsule-centred group). */
  readonly model: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  readonly actions: Partial<Record<CharacterClipRole, THREE.AnimationAction>>;
}

/**
 * A skinned copy of a loaded character, ready to add under a capsule-centred group. SkeletonUtils
 * clone is required for skinned meshes (a plain clone keeps the bones of the original). Materials
 * stay shared between copies, so the accent glow is set on the shared material.
 */
export function instantiateCharacter(gltf: GLTF, kind: CharacterKind, height: number): CharacterInstance {
  const model = cloneSkeleton(gltf.scene) as THREE.Group;
  model.scale.setScalar(height / BIND_HEIGHT);
  model.position.y = -height / 2;
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial && material.name === kind.accentMaterial) {
        material.color.setHex(kind.accent).multiplyScalar(0.35);
        material.emissive.setHex(kind.accent);
        material.emissiveIntensity = kind.accentIntensity;
      }
    }
  });

  const mixer = new THREE.AnimationMixer(model);
  const actions: Partial<Record<CharacterClipRole, THREE.AnimationAction>> = {};
  for (const [role, name] of Object.entries(CHARACTER_CLIPS) as [CharacterClipRole, string][]) {
    const clip = gltf.animations.find((candidate) => candidate.name === name);
    if (clip) actions[role] = mixer.clipAction(clip);
  }
  for (const role of ['fire', 'death'] as const) {
    const action = actions[role];
    if (!action) continue;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }
  return { model, mixer, actions };
}

/** Speed (m/s) above which a moving character runs rather than walks. */
export const RUN_SPEED_THRESHOLD = 2.6;

/** Cross-fades a character's looping base layer (idle, walk or run) to `next`. */
export function crossFadeBase(actions: CharacterInstance['actions'], from: CharacterClipRole | null, next: CharacterClipRole, seconds = 0.2): void {
  if (from === next) return;
  if (from) actions[from]?.fadeOut(seconds);
  actions[next]?.reset().fadeIn(seconds).play();
}
