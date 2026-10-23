import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Hit shapes fitted to the posed full-size characters (characterModels.ts) rather than the old
 * capsules sized for the chunky Kenney figure, which were nearly twice as wide as the new bodies.
 * Each shape is a capsule from the feet to the shoulders plus a ball for the head, both set
 * forward of the centre line where the Idle_Gun stance carries them. Measured from the skinned
 * vertices in the Idle_Gun, Walk and Run clips at the character's game height (script:
 * reference/characters/measure-hitbox.mjs). Swinging arms and the SWAT rifle reach past these in
 * motion and are deliberately left out, so a hit means the body was hit.
 *
 * Heights are above the feet; forward is +Z in the body's frame, the way the model faces. The
 * rigid body sits at the capsule centre, `height / 2` above the feet, and has to turn with the
 * model (see yawRotation) for the forward offsets to follow it.
 */
export interface CharacterHitShape {
  /** The character's game height (the rigid body sits at half of it). */
  readonly height: number;
  readonly bodyRadius: number;
  /** Feet to shoulders: the capsule ends where the head ball begins, with no gap at the neck. */
  readonly bodyTop: number;
  readonly bodyForward: number;
  readonly headRadius: number;
  readonly headHeight: number;
  readonly headForward: number;
}

/** SWAT kit at ENEMY_HEIGHT 1.7 m: torso and legs within 0.25 to 0.28 m of the centre line,
 * centred 0.06 m forward; the helmeted head a 0.17 m sphere (95% of its vertices) 1.48 m up and
 * 0.12 m forward; crown at 1.65 to 1.67 m. */
export const ENEMY_HIT_SHAPE: CharacterHitShape = {
  height: 1.7,
  bodyRadius: 0.27,
  bodyTop: 1.36,
  bodyForward: 0.06,
  headRadius: 0.17,
  headHeight: 1.48,
  headForward: 0.12,
};

/** Spacesuit at PLAYER_HEIGHT 1.8 m (other players in multiplayer): torso within 0.27 to 0.29 m,
 * centred 0.07 m forward; the helmet a 0.18 m sphere 1.61 m up and 0.11 m forward standing (0.14
 * to 0.16 running, so 0.12 splits it); crown at 1.80 m. */
export const PLAYER_HIT_SHAPE: CharacterHitShape = {
  height: 1.8,
  bodyRadius: 0.28,
  bodyTop: 1.47,
  bodyForward: 0.07,
  headRadius: 0.18,
  headHeight: 1.61,
  headForward: 0.12,
};

export interface CharacterHitColliders {
  readonly body: RAPIER.Collider;
  readonly head: RAPIER.Collider;
}

export function createHitColliders(world: RAPIER.World, rigidBody: RAPIER.RigidBody, shape: CharacterHitShape): CharacterHitColliders {
  const centre = shape.height / 2;
  const halfHeight = shape.bodyTop / 2 - shape.bodyRadius;
  const body = world.createCollider(
    RAPIER.ColliderDesc.capsule(halfHeight, shape.bodyRadius).setTranslation(0, shape.bodyTop / 2 - centre, shape.bodyForward),
    rigidBody,
  );
  const head = world.createCollider(
    RAPIER.ColliderDesc.ball(shape.headRadius).setTranslation(0, shape.headHeight - centre, shape.headForward),
    rigidBody,
  );
  return { body, head };
}

/** The rotation that turns the body's +Z to face `yaw` (the model's rotation.y), so the forward
 * offsets above follow the character as it turns. */
export function yawRotation(yaw: number): RAPIER.Rotation {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
