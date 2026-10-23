import { describe, expect, it } from 'vitest';
import {
  EXTRACTION_HOLD,
  EXTRACTION_RADIUS,
  MissionState,
  UPLINK_DURATION,
  UPLINK_HOLD_RADIUS,
  UPLINK_START_RADIUS,
  type MissionEvent,
  type MissionPoint,
} from './missionState.ts';

const SPAWN = { x: 0, z: 0 };
// Distances from spawn: 100, 150, 200 and 300 m, given out of order.
const TOWERS: MissionPoint[] = [
  { x: 0, z: -300 },
  { x: 150, z: 0 },
  { x: -100, z: 0 },
  { x: 0, z: 200 },
];

function run(mission: MissionState, player: MissionPoint, seconds: number, step = 0.5, interactFirst = false): MissionEvent[] {
  const events: MissionEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += step) {
    events.push(...mission.update({ dt: step, player, interactPressed: interactFirst && t === 0, playerDead: false }));
  }
  return events;
}

const press = (mission: MissionState, player: MissionPoint): MissionEvent[] =>
  mission.update({ dt: 0, player, interactPressed: true, playerDead: false });

describe('MissionState', () => {
  it('makes the three towers nearest the spawn the uplinks, A nearest, and the fourth the extraction', () => {
    const mission = new MissionState(TOWERS, SPAWN);
    const view = mission.view(SPAWN);
    expect(view.uplinks.map((u) => [u.label, u.x, u.z])).toEqual([
      ['A', -100, 0],
      ['B', 150, 0],
      ['C', 0, 200],
    ]);
    expect(mission.extraction).toEqual({ x: 0, z: -300 });
    expect(view.phase).toBe('uplinks');
  });

  it('refuses a map with fewer than four towers', () => {
    expect(() => new MissionState(TOWERS.slice(0, 3), SPAWN)).toThrow();
  });

  it('prompts at an idle uplink and starts it only on E within the start radius', () => {
    const mission = new MissionState(TOWERS, SPAWN);
    const outside = { x: -100 + UPLINK_START_RADIUS + 1, z: 0 };
    expect(mission.view(outside).prompt).toBeNull();
    expect(press(mission, outside)).toEqual([]);

    const atA = { x: -100 + UPLINK_START_RADIUS - 1, z: 0 };
    expect(mission.view(atA).prompt).toBe('START UPLINK');
    expect(run(mission, atA, 5)).toEqual([]);
    expect(press(mission, atA)).toEqual([{ kind: 'uploadStarted', label: 'A' }]);
    expect(mission.view(atA).prompt).toBeNull();
    expect(mission.view(atA).active).toEqual({ label: 'A', progress: 0, paused: false });
  });

  it('calls a wave of two at 10, 20 and 30 seconds of upload, biased mixed, rusher, sniper, then brings the uplink online', () => {
    const mission = new MissionState(TOWERS, SPAWN);
    const atA = { x: -100, z: 0 };
    press(mission, atA);
    const events = run(mission, atA, UPLINK_DURATION);
    expect(events).toEqual([
      { kind: 'waveRequested', count: 2, bias: 'mixed' },
      { kind: 'waveRequested', count: 2, bias: 'rusher' },
      { kind: 'waveRequested', count: 2, bias: 'sniper' },
      { kind: 'uplinkOnline', label: 'A', online: 1, total: 3 },
    ]);
    const view = mission.view(atA);
    expect(view.uplinks[0]!.status).toBe('online');
    expect(view.active).toBeNull();
    expect(view.prompt).toBeNull();
  });

  it('pauses outside the hold radius and resumes where it left off', () => {
    const mission = new MissionState(TOWERS, SPAWN);
    const atA = { x: -100, z: 0 };
    const away = { x: -100 + UPLINK_HOLD_RADIUS + 1, z: 0 };
    press(mission, atA);
    run(mission, atA, 12);
    expect(run(mission, away, 30)).toEqual([]);
    const paused = mission.view(away).active!;
    expect(paused.paused).toBe(true);
    expect(paused.progress).toBeCloseTo(12 / UPLINK_DURATION);
    // Within the hold radius but outside the start radius it advances again without pressing E.
    const holding = { x: -100 + UPLINK_HOLD_RADIUS - 1, z: 0 };
    const events = run(mission, holding, 28);
    expect(events.filter((e) => e.kind === 'waveRequested')).toHaveLength(2);
    expect(events.at(-1)).toEqual({ kind: 'uplinkOnline', label: 'A', online: 1, total: 3 });
  });

  it('switches uploads on E at another uplink, keeping the first one\'s progress', () => {
    const mission = new MissionState(TOWERS, SPAWN);
    press(mission, { x: -100, z: 0 });
    run(mission, { x: -100, z: 0 }, 15);
    expect(press(mission, { x: 150, z: 0 })).toEqual([{ kind: 'uploadStarted', label: 'B' }]);
    const view = mission.view({ x: -100, z: 0 });
    expect(view.uplinks[0]).toMatchObject({ status: 'pending', progress: 15 / UPLINK_DURATION });
    expect(view.prompt).toBe('RESUME UPLINK');
    // Back at A, the waves already sent for its first 15 seconds are not sent again.
    press(mission, { x: -100, z: 0 });
    const events = run(mission, { x: -100, z: 0 }, 25);
    expect(events.filter((e) => e.kind === 'waveRequested').map((e) => (e.kind === 'waveRequested' ? e.bias : ''))).toEqual(['rusher', 'sniper']);
  });

  it('opens extraction with a wave of three after the third uplink, and wins after standing in the ring', () => {
    const mission = new MissionState(TOWERS, SPAWN);
    for (const tower of [{ x: -100, z: 0 }, { x: 150, z: 0 }]) {
      press(mission, tower);
      run(mission, tower, UPLINK_DURATION);
    }
    press(mission, { x: 0, z: 200 });
    const events = run(mission, { x: 0, z: 200 }, UPLINK_DURATION);
    expect(events.slice(-3)).toEqual([
      { kind: 'uplinkOnline', label: 'C', online: 3, total: 3 },
      { kind: 'extractionOpen' },
      { kind: 'waveRequested', count: 3, bias: 'mixed' },
    ]);
    expect(mission.view(SPAWN).phase).toBe('extract');

    const ring = { x: 0, z: -300 + EXTRACTION_RADIUS - 1 };
    expect(run(mission, ring, EXTRACTION_HOLD - 1)).toEqual([]);
    // Stepping out resets the count.
    run(mission, { x: 0, z: -300 + EXTRACTION_RADIUS + 1 }, 0.5);
    expect(mission.view(ring).extractionProgress).toBe(0);
    expect(run(mission, ring, EXTRACTION_HOLD)).toEqual([{ kind: 'won' }]);
    expect(mission.view(ring).phase).toBe('won');
    expect(run(mission, ring, 5)).toEqual([]);
  });

  it('is lost when the player dies, and stays lost', () => {
    const mission = new MissionState(TOWERS, SPAWN);
    press(mission, { x: -100, z: 0 });
    expect(mission.update({ dt: 0.1, player: SPAWN, interactPressed: false, playerDead: true })).toEqual([{ kind: 'lost' }]);
    expect(mission.view(SPAWN).phase).toBe('lost');
    expect(mission.update({ dt: 0.1, player: SPAWN, interactPressed: true, playerDead: true })).toEqual([]);
  });
});
