import { describe, expect, it } from 'vitest';
import { CalloutDirector, type IntentEvent, type IntentKind } from './calloutDirector.ts';

const OPTIONS = { kindCooldown: 4, globalCooldown: 1.2, audibleRange: 45 };
const LISTENER = { x: 0, z: 0 };
const event = (kind: IntentKind, enemyId: number, x: number, z = 0): IntentEvent => ({ kind, enemyId, x, y: 1, z });

describe('CalloutDirector voiced callouts', () => {
  it('voices one callout per tick, from the speaker nearest the player', () => {
    const director = new CalloutDirector(OPTIONS);
    director.emit(event('spotted', 1, 30));
    director.emit(event('spotted', 2, 10));
    director.emit(event('spotted', 3, 20));
    expect(director.flush(0, LISTENER).voiced).toMatchObject({ kind: 'spotted', enemyId: 2 });
  });

  it('puts the most urgent kind first', () => {
    const director = new CalloutDirector(OPTIONS);
    director.emit(event('lostThem', 1, 5));
    director.emit(event('flanking', 2, 5));
    director.emit(event('spotted', 3, 40));
    expect(director.flush(0, LISTENER).voiced?.kind).toBe('spotted');
  });

  it('keeps each kind and any two callouts apart by their cooldowns', () => {
    const director = new CalloutDirector(OPTIONS);
    director.emit(event('spotted', 1, 5));
    expect(director.flush(0, LISTENER).voiced?.kind).toBe('spotted');

    director.emit(event('flanking', 2, 5));
    expect(director.flush(1, LISTENER).voiced).toBeNull(); // inside the global cooldown
    director.emit(event('flanking', 2, 5));
    expect(director.flush(1.3, LISTENER).voiced?.kind).toBe('flanking');

    director.emit(event('spotted', 3, 5));
    expect(director.flush(3, LISTENER).voiced).toBeNull(); // 'spotted' again within 4 s
    director.emit(event('spotted', 3, 5));
    expect(director.flush(4.1, LISTENER).voiced?.kind).toBe('spotted');
  });

  it('drops callouts from beyond earshot, and forgets unvoiced ones', () => {
    const director = new CalloutDirector(OPTIONS);
    director.emit(event('spotted', 1, 60));
    expect(director.flush(0, LISTENER).voiced).toBeNull();
    expect(director.flush(10, LISTENER).voiced).toBeNull();
  });
});

describe('CalloutDirector visual cues', () => {
  it('passes every glint and stagger on, unrationed, alongside a voiced callout', () => {
    const director = new CalloutDirector(OPTIONS);
    director.emit(event('glint', 1, 30));
    director.emit(event('glint', 2, 30));
    director.emit(event('staggered', 3, 8));
    director.emit(event('spotted', 4, 8));
    const result = director.flush(0, LISTENER);
    expect(result.cues.map((cue) => cue.kind)).toEqual(['glint', 'glint', 'staggered']);
    expect(result.voiced?.kind).toBe('spotted');
    expect(director.counts()).toMatchObject({ glint: 2, staggered: 1, spotted: 1 });
  });
});
