import * as THREE from 'three';
import {
  ENEMY_FIRE_MEMORY_HALF_LIFE,
  ENEMY_FIRE_MEMORY_SIZE,
  ENEMY_KNOWLEDGE_DECAY_TIME,
  ENEMY_KNOWLEDGE_EVIDENCE_CONFIDENCE,
  ENEMY_KNOWLEDGE_GUNSHOT_CONFIDENCE,
  ENEMY_KNOWLEDGE_OVERRIDE_AGE,
} from '../../core/config.ts';

export type KnowledgeSource = 'seen' | 'gunshot' | 'damage' | 'comradeDeath';

export interface ThreatBelief {
  readonly position: THREE.Vector3;
  /** Squad clock time (seconds) the belief was last set. */
  readonly at: number;
  readonly source: KnowledgeSource;
  /** 1 for a fresh sighting, lower for indirect evidence; decays linearly to 0 over
   * ENEMY_KNOWLEDGE_DECAY_TIME, when the belief is dropped. */
  readonly confidence: number;
}

interface StoredBelief {
  readonly position: THREE.Vector3;
  at: number;
  source: KnowledgeSource;
  baseConfidence: number;
}

interface ShotRecord {
  readonly x: number;
  readonly z: number;
  readonly at: number;
}

/** Shots older than this many half-lives weigh under 1/64 and are pruned. */
const SHOT_PRUNE_HALF_LIVES = 6;

/**
 * What the squad knows about the player (enemy AI v2, step 1 - docs/enemy-ai-v2.md). One instance
 * per match, owned by EntityManager and shared by every enemy - the Last of Us idea that one
 * enemy's sighting is everyone's. Holds a single belief about where the player is (how it was
 * learned, how sure), which enemies can see the player right now, and a short memory of recent
 * player shot origins for "which way is the fire coming from".
 *
 * Runs on its own clock (advanced by EntityManager once per tick), so it is fully deterministic
 * and needs no three.js scene or physics to test.
 */
export class SquadKnowledge {
  private clock = 0;
  private stored: StoredBelief | null = null;
  private readonly visibleBy = new Set<number>();
  private lastSeenAt = Number.NEGATIVE_INFINITY;
  private readonly shots: ShotRecord[] = [];

  /** Squad clock, in seconds since the match's first tick. */
  get now(): number {
    return this.clock;
  }

  get belief(): ThreatBelief | null {
    if (!this.stored) return null;
    return {
      position: this.stored.position,
      at: this.stored.at,
      source: this.stored.source,
      confidence: this.confidenceOf(this.stored),
    };
  }

  get isThreatVisible(): boolean {
    return this.visibleBy.size > 0;
  }

  get visibleCount(): number {
    return this.visibleBy.size;
  }

  /** Advances the clock, drops a belief that has fully decayed, and prunes old shot memory. */
  advance(dt: number): void {
    this.clock += dt;
    if (this.stored && this.clock - this.stored.at >= ENEMY_KNOWLEDGE_DECAY_TIME) this.stored = null;
    const oldest = this.clock - ENEMY_FIRE_MEMORY_HALF_LIFE * SHOT_PRUNE_HALF_LIVES;
    while (this.shots.length > 0 && this.shots[0]!.at < oldest) this.shots.shift();
  }

  /** An enemy has the player in sight right now: the belief becomes exact and fully confident. */
  reportSeen(enemyId: number, position: THREE.Vector3): void {
    this.visibleBy.add(enemyId);
    this.lastSeenAt = this.clock;
    this.setBelief(position, 'seen', 1);
  }

  /** An enemy that could see the player no longer can. The belief itself stays. */
  reportLost(enemyId: number): void {
    this.visibleBy.delete(enemyId);
  }

  /** A player gunshot: always remembered for the fire direction, and it moves the belief only if
   * the current one is weaker (see offer). */
  reportGunshot(origin: THREE.Vector3): void {
    this.shots.push({ x: origin.x, z: origin.z, at: this.clock });
    if (this.shots.length > ENEMY_FIRE_MEMORY_SIZE) this.shots.shift();
    this.offer(origin, 'gunshot', ENEMY_KNOWLEDGE_GUNSHOT_CONFIDENCE);
  }

  /** An enemy was hit; `estimate` is its own rough guess at where the shot came from. */
  reportDamage(estimate: THREE.Vector3): void {
    this.offer(estimate, 'damage', ENEMY_KNOWLEDGE_EVIDENCE_CONFIDENCE);
  }

  /** A comrade died; the killer's position at that moment. */
  reportComradeDeath(killerPosition: THREE.Vector3): void {
    this.offer(killerPosition, 'comradeDeath', ENEMY_KNOWLEDGE_EVIDENCE_CONFIDENCE);
  }

  /** An enemy is gone (killed or despawned) - it can no longer be one of the watchers. */
  forget(enemyId: number): void {
    this.visibleBy.delete(enemyId);
  }

  /** The belief, but only if it is a direct sighting no older than `maxAge` seconds - what gets
   * passed on to nearby comrades. Indirect evidence is not relayed. */
  freshSighting(maxAge: number): ThreatBelief | null {
    const belief = this.belief;
    if (!belief || belief.source !== 'seen' || this.clock - belief.at > maxAge) return null;
    return belief;
  }

  /** Seconds since any enemy last had the player in sight; Infinity if none ever has. */
  secondsSinceSeen(): number {
    return this.clock - this.lastSeenAt;
  }

  /** Unit XZ direction from `from` toward where recent player fire has been coming from (shot
   * origins averaged with a half-life of ENEMY_FIRE_MEMORY_HALF_LIFE, so recent shots dominate),
   * or null with no shots on record. */
  fireDirectionFrom(from: { x: number; z: number }): { x: number; z: number } | null {
    let weightSum = 0;
    let meanX = 0;
    let meanZ = 0;
    for (const shot of this.shots) {
      const weight = Math.pow(0.5, (this.clock - shot.at) / ENEMY_FIRE_MEMORY_HALF_LIFE);
      weightSum += weight;
      meanX += shot.x * weight;
      meanZ += shot.z * weight;
    }
    if (weightSum <= 0) return null;
    const dx = meanX / weightSum - from.x;
    const dz = meanZ / weightSum - from.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length < 1e-6) return null;
    return { x: dx / length, z: dz / length };
  }

  reset(): void {
    this.clock = 0;
    this.stored = null;
    this.visibleBy.clear();
    this.lastSeenAt = Number.NEGATIVE_INFINITY;
    this.shots.length = 0;
  }

  /** Indirect evidence replaces the belief only when there is none, when the current one has
   * decayed below the new evidence's confidence, or when it is older than
   * ENEMY_KNOWLEDGE_OVERRIDE_AGE. A sighting refreshed every few ticks therefore always wins over
   * a gunshot, but a stale sighting gives way to fresh evidence. */
  private offer(position: THREE.Vector3, source: KnowledgeSource, confidence: number): void {
    const current = this.stored;
    if (current && this.confidenceOf(current) >= confidence && this.clock - current.at <= ENEMY_KNOWLEDGE_OVERRIDE_AGE) {
      return;
    }
    this.setBelief(position, source, confidence);
  }

  private setBelief(position: THREE.Vector3, source: KnowledgeSource, confidence: number): void {
    if (this.stored) {
      this.stored.position.copy(position);
      this.stored.at = this.clock;
      this.stored.source = source;
      this.stored.baseConfidence = confidence;
    } else {
      this.stored = { position: position.clone(), at: this.clock, source, baseConfidence: confidence };
    }
  }

  private confidenceOf(belief: StoredBelief): number {
    const age = this.clock - belief.at;
    return Math.max(0, belief.baseConfidence * (1 - age / ENEMY_KNOWLEDGE_DECAY_TIME));
  }
}
