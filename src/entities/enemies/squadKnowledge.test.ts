import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SquadKnowledge } from './squadKnowledge.ts';
import {
  ENEMY_FIRE_MEMORY_HALF_LIFE,
  ENEMY_KNOWLEDGE_DECAY_TIME,
  ENEMY_KNOWLEDGE_EVIDENCE_CONFIDENCE,
  ENEMY_KNOWLEDGE_GUNSHOT_CONFIDENCE,
  ENEMY_KNOWLEDGE_OVERRIDE_AGE,
} from '../../core/config.ts';

const at = (x: number, z: number) => new THREE.Vector3(x, 0, z);

describe('SquadKnowledge sightings', () => {
  it('starts with no belief and nobody watching', () => {
    const knowledge = new SquadKnowledge();
    expect(knowledge.belief).toBeNull();
    expect(knowledge.isThreatVisible).toBe(false);
    expect(knowledge.secondsSinceSeen()).toBe(Infinity);
  });

  it('a sighting sets an exact, fully confident belief and marks the player visible', () => {
    const knowledge = new SquadKnowledge();
    knowledge.reportSeen(1, at(10, 5));
    expect(knowledge.belief?.source).toBe('seen');
    expect(knowledge.belief?.confidence).toBe(1);
    expect(knowledge.belief?.position.x).toBe(10);
    expect(knowledge.isThreatVisible).toBe(true);
  });

  it('keeps the belief after sight is lost, until it decays away', () => {
    const knowledge = new SquadKnowledge();
    knowledge.reportSeen(1, at(0, 0));
    knowledge.reportLost(1);
    expect(knowledge.isThreatVisible).toBe(false);
    knowledge.advance(ENEMY_KNOWLEDGE_DECAY_TIME / 2);
    expect(knowledge.belief?.confidence).toBeCloseTo(0.5);
    knowledge.advance(ENEMY_KNOWLEDGE_DECAY_TIME / 2);
    expect(knowledge.belief).toBeNull();
  });

  it('stays visible while any one of several watchers still sees the player', () => {
    const knowledge = new SquadKnowledge();
    knowledge.reportSeen(1, at(0, 0));
    knowledge.reportSeen(2, at(0, 0));
    knowledge.reportLost(1);
    expect(knowledge.isThreatVisible).toBe(true);
    knowledge.forget(2);
    expect(knowledge.isThreatVisible).toBe(false);
  });

  it('relays only a fresh direct sighting', () => {
    const knowledge = new SquadKnowledge();
    knowledge.reportGunshot(at(3, 3));
    expect(knowledge.freshSighting(1)).toBeNull();
    knowledge.reportSeen(1, at(0, 0));
    expect(knowledge.freshSighting(1)).not.toBeNull();
    knowledge.advance(1.5);
    expect(knowledge.freshSighting(1)).toBeNull();
  });
});

describe('SquadKnowledge indirect evidence', () => {
  it('a gunshot sets a lower-confidence belief when there is none', () => {
    const knowledge = new SquadKnowledge();
    knowledge.reportGunshot(at(4, 4));
    expect(knowledge.belief?.source).toBe('gunshot');
    expect(knowledge.belief?.confidence).toBe(ENEMY_KNOWLEDGE_GUNSHOT_CONFIDENCE);
  });

  it('a gunshot does not overwrite a fresh sighting', () => {
    const knowledge = new SquadKnowledge();
    knowledge.reportSeen(1, at(0, 0));
    knowledge.advance(0.5);
    knowledge.reportGunshot(at(20, 20));
    expect(knowledge.belief?.source).toBe('seen');
    expect(knowledge.belief?.position.x).toBe(0);
  });

  it('fresh evidence replaces a sighting older than the override age', () => {
    const knowledge = new SquadKnowledge();
    knowledge.reportSeen(1, at(0, 0));
    knowledge.advance(ENEMY_KNOWLEDGE_OVERRIDE_AGE + 0.5);
    knowledge.reportGunshot(at(20, 20));
    expect(knowledge.belief?.source).toBe('gunshot');
    expect(knowledge.belief?.position.x).toBe(20);
  });

  it('damage and comrade deaths count as stronger evidence than a gunshot', () => {
    const knowledge = new SquadKnowledge();
    knowledge.reportGunshot(at(1, 1));
    knowledge.reportComradeDeath(at(7, 7));
    expect(knowledge.belief?.source).toBe('comradeDeath');
    expect(knowledge.belief?.confidence).toBe(ENEMY_KNOWLEDGE_EVIDENCE_CONFIDENCE);
    knowledge.reportGunshot(at(2, 2));
    expect(knowledge.belief?.source).toBe('comradeDeath');
  });
});

describe('SquadKnowledge fire direction', () => {
  it('has no direction without shots on record', () => {
    expect(new SquadKnowledge().fireDirectionFrom({ x: 0, z: 0 })).toBeNull();
  });

  it('points toward where fire has been coming from, weighted toward recent shots', () => {
    const knowledge = new SquadKnowledge();
    knowledge.reportGunshot(at(10, 0));
    knowledge.advance(ENEMY_FIRE_MEMORY_HALF_LIFE * 2);
    knowledge.reportGunshot(at(0, 10));
    const direction = knowledge.fireDirectionFrom({ x: 0, z: 0 })!;
    expect(Math.hypot(direction.x, direction.z)).toBeCloseTo(1);
    expect(direction.z).toBeGreaterThan(direction.x);
    expect(direction.x).toBeGreaterThan(0);
  });

  it('forgets old shots and resets cleanly', () => {
    const knowledge = new SquadKnowledge();
    knowledge.reportGunshot(at(10, 0));
    knowledge.advance(ENEMY_FIRE_MEMORY_HALF_LIFE * 10);
    expect(knowledge.fireDirectionFrom({ x: 0, z: 0 })).toBeNull();
    knowledge.reportSeen(1, at(1, 1));
    knowledge.reset();
    expect(knowledge.belief).toBeNull();
    expect(knowledge.now).toBe(0);
  });
});
