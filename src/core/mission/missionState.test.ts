import { describe, expect, it } from 'vitest';
import {
  ALERT_MAX,
  ALERT_PER_KILL,
  ALERT_PER_SHOT,
  ALERT_SECONDS_PER_LEVEL,
  CARRY_WAVE_INTERVAL,
  CORE_PICKUP_RADIUS,
  EXTRACTION_RADIUS,
  EXTRACTION_SECONDS,
  HACK_DURATION,
  HACK_WAVE_AT,
  MissionState,
  missionMapMarkers,
  planOperation,
  REDEPLOYS,
  RELAY_PLUG_RADIUS,
  UPLOAD_DURATION,
  UPLOAD_WAVES,
  waveSize,
  ZONE_RADIUS,
  type MissionEvent,
  type MissionPlayer,
  type MissionSites,
} from './missionState.ts';

const SITES: MissionSites = {
  breach: { x: -100, z: 0 },
  core: { x: 0, z: 200, underground: true },
  relay: { x: 150, z: 0 },
  extraction: { x: 0, z: -300 },
};
const FAR: MissionPlayer = { x: 500, z: 500, alive: true };
const at = (point: { x: number; z: number }, underground = false): MissionPlayer => ({ x: point.x, z: point.z, alive: true, underground });
const dead = (point: { x: number; z: number }, underground = false): MissionPlayer => ({ x: point.x, z: point.z, alive: false, underground });

function tick(mission: MissionState, players: MissionPlayer | MissionPlayer[], dt = 0, extra: { interact?: number | null; kills?: number; shots?: number } = {}): MissionEvent[] {
  return mission.update({ dt, players: Array.isArray(players) ? players : [players], interact: extra.interact ?? null, kills: extra.kills ?? 0, shots: extra.shots ?? 0 });
}

/** Every event of `seconds` of play. The alert rising with time is left out unless `withAlert`. */
function run(mission: MissionState, players: MissionPlayer | MissionPlayer[], seconds: number, step = 0.5, withAlert = false): MissionEvent[] {
  const events: MissionEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += step) events.push(...tick(mission, players, step));
  return withAlert ? events : events.filter((event) => event.kind !== 'alertRaised');
}

const press = (mission: MissionState, player: MissionPlayer): MissionEvent[] => tick(mission, player, 0, { interact: 0 });
const kinds = (events: MissionEvent[]): string[] => events.map((event) => event.kind);
const waves = (events: MissionEvent[]) => events.filter((event) => event.kind === 'waveRequested');

/** A mission taken to the start of `stage` the way a player would. */
function missionAt(stage: 'fetch' | 'carrying' | 'defend' | 'extract'): MissionState {
  const mission = new MissionState(SITES);
  run(mission, at(SITES.breach), HACK_DURATION);
  if (stage === 'fetch') return mission;
  press(mission, at(SITES.core, true));
  if (stage === 'carrying') return mission;
  press(mission, at(SITES.relay));
  if (stage === 'defend') return mission;
  run(mission, at(SITES.relay), UPLOAD_DURATION);
  return mission;
}

describe('planOperation', () => {
  // Distances from the start: 100, 150, 200 and 300 m, given out of order.
  const points = [{ x: 0, z: -300 }, { x: 150, z: 0 }, { x: -100, z: 0 }, { x: 0, z: 200 }];

  it('makes the point nearest the start the terminal and the one farthest from it the core site', () => {
    const plan = planOperation(points, { x: 0, z: 0 });
    expect(plan.breach).toBe(2);
    // From (-100, 0): 316 m to (0, -300), 250 m to (150, 0), 224 m to (0, 200).
    expect(plan.core).toBe(0);
    // Of the other two, the relay is the one farther from the core, so the carry is the long way.
    expect(plan.relay).toBe(3);
    expect(plan.extraction).toBe(1);
  });

  it('only puts the core where it is allowed, and anywhere when nowhere is', () => {
    expect(planOperation(points, { x: 0, z: 0 }, (index) => index === 3).core).toBe(3);
    expect(planOperation(points, { x: 0, z: 0 }, () => false).core).toBe(0);
    expect(planOperation(points, { x: 0, z: 0 }, (index) => index !== 0).core).toBe(1);
  });

  it('uses four different points and refuses fewer', () => {
    const plan = planOperation(points, { x: 40, z: 40 });
    expect(new Set(Object.values(plan)).size).toBe(4);
    expect(() => planOperation(points.slice(0, 3), { x: 0, z: 0 })).toThrow();
  });
});

describe('Breach', () => {
  it('hacks the terminal while a player stands in its zone, with one wave of two, then starts Fetch', () => {
    const mission = new MissionState(SITES);
    expect(mission.view([FAR])).toMatchObject({ phase: 'breach', stageNumber: 1, hack: { progress: 0, paused: true } });
    const events = run(mission, at(SITES.breach), HACK_DURATION);
    expect(events).toEqual([
      { kind: 'waveRequested', count: 2, bias: 'mixed', warden: false },
      { kind: 'stageStarted', stage: 'fetch' },
    ]);
    expect(mission.view([FAR])).toMatchObject({ phase: 'fetch', stageNumber: 2, core: { state: 'home', x: 0, z: 200, underground: true } });
  });

  it('pauses outside the zone and underground, and resumes where it left off', () => {
    const mission = new MissionState(SITES);
    const edge = { x: SITES.breach.x + ZONE_RADIUS - 1, z: 0 };
    run(mission, at(edge), HACK_WAVE_AT - 2);
    expect(run(mission, at({ x: SITES.breach.x + ZONE_RADIUS + 1, z: 0 }), 60)).toEqual([]);
    expect(run(mission, at(SITES.breach, true), 60)).toEqual([]);
    const paused = mission.view([at(SITES.breach, true)]);
    expect(paused.hack.paused).toBe(true);
    expect(paused.hack.progress).toBeCloseTo((HACK_WAVE_AT - 2) / HACK_DURATION);
    expect(mission.view([at(edge)]).hack.paused).toBe(false);
    expect(kinds(run(mission, at(edge), HACK_DURATION - HACK_WAVE_AT + 2))).toEqual(['waveRequested', 'stageStarted']);
  });

  it('counts any living player of a squad in the zone, never a dead one', () => {
    const mission = new MissionState(SITES);
    run(mission, [FAR, at(SITES.breach)], 5);
    expect(mission.view([FAR, at(SITES.breach)]).hack.progress).toBeCloseTo(5 / HACK_DURATION);
    run(mission, [FAR, dead(SITES.breach)], 5);
    expect(mission.view([FAR]).hack.progress).toBeCloseTo(5 / HACK_DURATION);
  });
});

describe('Fetch', () => {
  it('prompts at the core and takes it only on interact, in reach and on its level', () => {
    const mission = missionAt('fetch');
    const beside = { x: SITES.core.x + CORE_PICKUP_RADIUS - 0.5, z: SITES.core.z };
    // Standing on the tower above the lab is not at the core.
    expect(mission.view([at(beside)]).prompt).toBeNull();
    expect(press(mission, at(beside))).toEqual([]);
    expect(press(mission, at({ x: SITES.core.x + CORE_PICKUP_RADIUS + 0.5, z: SITES.core.z }, true))).toEqual([]);
    expect(mission.view([at(beside, true)]).prompt).toBe('TAKE THE DATA CORE');
    expect(run(mission, at(beside, true), 3)).toEqual([]);
    expect(press(mission, at(beside, true))).toEqual([{ kind: 'corePicked', player: 0 }]);
    expect(mission.view([at(beside, true)])).toMatchObject({ prompt: null, core: { state: 'carried', carrier: 0 } });
  });

  it('moves the core with its carrier and sends a pursuit wave on the surface, then one every interval', () => {
    const mission = missionAt('carrying');
    // Still down in the lab: nobody comes.
    expect(run(mission, at(SITES.core, true), 10)).toEqual([]);
    const road = { x: 60, z: 90 };
    const events = run(mission, at(road), CARRY_WAVE_INTERVAL + 1);
    expect(waves(events)).toEqual([
      { kind: 'waveRequested', count: 2, bias: 'rusher', warden: false },
      { kind: 'waveRequested', count: 2, bias: 'mixed', warden: false },
    ]);
    expect(mission.view([at(road)]).core).toMatchObject({ state: 'carried', x: 60, z: 90, underground: false });
  });

  it('drops the core where its carrier dies, and anyone can take it from there', () => {
    const mission = missionAt('carrying');
    const fell = { x: 70, z: 80 };
    expect(tick(mission, [dead(fell), FAR])).toEqual([{ kind: 'coreDropped', player: 0, x: 70, z: 80 }]);
    expect(mission.view([dead(fell), FAR]).core).toEqual({ state: 'dropped', x: 70, z: 80, underground: false, carrier: null });
    // The second player picks it up; the prompt is the first player's own.
    expect(tick(mission, [dead(fell), at(fell)], 0, { interact: 1 })).toEqual([{ kind: 'corePicked', player: 1 }]);
    expect(mission.view([dead(fell), at(fell)]).core.carrier).toBe(1);
  });

  it('plugs the core into the relay on the carrier\'s interact, which starts Defend', () => {
    const mission = missionAt('carrying');
    const near = { x: SITES.relay.x + RELAY_PLUG_RADIUS - 1, z: 0 };
    expect(press(mission, at({ x: SITES.relay.x + RELAY_PLUG_RADIUS + 1, z: 0 }))).toEqual([]);
    expect(mission.view([at(near)]).prompt).toBe('PLUG IN THE DATA CORE');
    // A squad mate without the core cannot plug it in.
    expect(tick(mission, [at(near), at(near)], 0, { interact: 1 })).toEqual([]);
    expect(press(mission, at(near))).toEqual([{ kind: 'stageStarted', stage: 'defend' }]);
    expect(mission.view([at(near)])).toMatchObject({ phase: 'defend', stageNumber: 3, prompt: null, core: { state: 'plugged', carrier: null } });
  });
});

describe('Defend', () => {
  it('uploads in three waves, the last led by a Warden, then starts Extract', () => {
    const mission = missionAt('defend');
    const events = run(mission, at(SITES.relay), UPLOAD_DURATION);
    expect(events).toEqual([
      { kind: 'waveRequested', count: 2, bias: 'mixed', warden: false },
      { kind: 'waveRequested', count: 3, bias: 'rusher', warden: false },
      { kind: 'waveRequested', count: 2, bias: 'sniper', warden: true },
      { kind: 'stageStarted', stage: 'extract' },
    ]);
    expect(UPLOAD_WAVES.map((wave) => wave.at)).toEqual([0, 25, 50]);
    expect(mission.view([FAR])).toMatchObject({ phase: 'extract', stageNumber: 4, extractionLeft: EXTRACTION_SECONDS });
  });

  it('pauses the upload while nobody is in the zone', () => {
    const mission = missionAt('defend');
    run(mission, at(SITES.relay), 12);
    expect(run(mission, at({ x: SITES.relay.x + ZONE_RADIUS + 1, z: 0 }), 100)).toEqual([]);
    const paused = mission.view([FAR]).upload;
    expect(paused.paused).toBe(true);
    expect(paused.progress).toBeCloseTo(12 / UPLOAD_DURATION);
    expect(paused.wave).toBe(1);
    const back = run(mission, at({ x: SITES.relay.x + ZONE_RADIUS - 1, z: 0 }), UPLOAD_DURATION - 12);
    expect(kinds(back)).toEqual(['waveRequested', 'waveRequested', 'stageStarted']);
  });
});

describe('Extract', () => {
  it('is won the moment a living player reaches the extraction point on the surface', () => {
    const mission = missionAt('extract');
    const events = run(mission, FAR, 31);
    expect(waves(events)).toEqual([
      { kind: 'waveRequested', count: 3, bias: 'mixed', warden: false },
      { kind: 'waveRequested', count: 2, bias: 'rusher', warden: false },
    ]);
    expect(mission.view([FAR]).extractionLeft).toBeCloseTo(EXTRACTION_SECONDS - 31);
    expect(tick(mission, at({ x: SITES.extraction.x + EXTRACTION_RADIUS + 1, z: SITES.extraction.z }), 0.5)).toEqual([]);
    expect(tick(mission, at(SITES.extraction, true), 0.5)).toEqual([]);
    expect(tick(mission, at({ x: SITES.extraction.x + EXTRACTION_RADIUS - 1, z: SITES.extraction.z }), 0.5)).toEqual([{ kind: 'won' }]);
    expect(mission.view([FAR]).phase).toBe('won');
    expect(run(mission, FAR, 100)).toEqual([]);
  });

  it('is lost when the countdown runs out, and stays lost', () => {
    const mission = missionAt('extract');
    const events = run(mission, FAR, EXTRACTION_SECONDS);
    expect(events.at(-1)).toEqual({ kind: 'lost', reason: 'extractionMissed' });
    expect(mission.view([FAR])).toMatchObject({ phase: 'lost', loss: 'extractionMissed', stage: 'extract', extractionLeft: 0 });
    expect(tick(mission, at(SITES.extraction), 1)).toEqual([]);
  });
});

describe('alert level', () => {
  it('starts at 1, rises a level every two minutes, and stops at 5', () => {
    const mission = new MissionState(SITES);
    expect(mission.view([FAR]).alert).toBe(1);
    expect(run(mission, FAR, ALERT_SECONDS_PER_LEVEL + 1, 1, true)).toEqual([{ kind: 'alertRaised', level: 2 }]);
    run(mission, FAR, ALERT_SECONDS_PER_LEVEL * 10, 1);
    expect(mission.view([FAR]).alert).toBe(ALERT_MAX);
  });

  it('rises with kills and with shots fired', () => {
    const byKills = new MissionState(SITES);
    expect(tick(byKills, FAR, 0, { kills: Math.ceil(1 / ALERT_PER_KILL) })).toEqual([{ kind: 'alertRaised', level: 2 }]);
    const byShots = new MissionState(SITES);
    expect(tick(byShots, FAR, 0, { shots: Math.ceil(1 / ALERT_PER_SHOT) })).toEqual([{ kind: 'alertRaised', level: 2 }]);
  });

  it('sizes the waves: one more enemy at level 3, two more at level 5', () => {
    expect([1, 2, 3, 4, 5].map((alert) => waveSize(2, alert))).toEqual([2, 2, 3, 3, 4]);
    const mission = missionAt('defend');
    tick(mission, FAR, 0, { kills: Math.ceil(4 / ALERT_PER_KILL) });
    expect(mission.view([FAR]).alert).toBe(ALERT_MAX);
    expect(waves(run(mission, at(SITES.relay), UPLOAD_DURATION)).map((wave) => wave.kind === 'waveRequested' && wave.count)).toEqual([4, 5, 4]);
  });
});

describe('redeploys', () => {
  it('waits for a redeploy when everyone is down, twice, and is lost the third time', () => {
    const mission = new MissionState(SITES);
    expect(mission.view([FAR]).redeploys).toBe(REDEPLOYS);
    expect(tick(mission, dead(FAR))).toEqual([{ kind: 'squadDown', redeploysLeft: 2 }]);
    expect(mission.view([dead(FAR)])).toMatchObject({ phase: 'breach', awaitingRedeploy: true });
    // Nothing moves until the redeploy is taken.
    expect(run(mission, at(SITES.breach), 5)).toEqual([]);
    expect(mission.redeploy()).toBeNull();
    expect(mission.view([FAR])).toMatchObject({ awaitingRedeploy: false, redeploys: 1 });
    expect(mission.redeploy()).toBeNull();
    expect(mission.view([FAR]).redeploys).toBe(1);

    expect(tick(mission, dead(FAR))).toEqual([{ kind: 'squadDown', redeploysLeft: 1 }]);
    mission.redeploy();
    expect(tick(mission, dead(FAR))).toEqual([{ kind: 'lost', reason: 'signalLost' }]);
    expect(mission.view([FAR])).toMatchObject({ phase: 'lost', loss: 'signalLost', redeploys: 0 });
    expect(tick(mission, at(SITES.breach), 1)).toEqual([]);
  });

  it('does not count a squad as down while one player lives', () => {
    const mission = new MissionState(SITES);
    expect(tick(mission, [dead(FAR), FAR], 1)).toEqual([]);
    expect(mission.view([dead(FAR), FAR]).awaitingRedeploy).toBe(false);
  });

  it('restarts Breach from nothing at the start', () => {
    const mission = new MissionState(SITES);
    run(mission, at(SITES.breach), HACK_WAVE_AT + 2);
    tick(mission, dead(SITES.breach));
    expect(mission.redeploy()).toBeNull();
    expect(mission.view([FAR]).hack.progress).toBe(0);
    expect(kinds(run(mission, at(SITES.breach), HACK_DURATION))).toEqual(['waveRequested', 'stageStarted']);
  });

  it('restarts Fetch at the terminal, the core staying where its carrier fell', () => {
    const mission = missionAt('carrying');
    const fell = { x: 70, z: 80 };
    expect(kinds(tick(mission, dead(fell)))).toEqual(['coreDropped', 'squadDown']);
    expect(mission.redeploy()).toEqual(SITES.breach);
    expect(mission.view([at(SITES.breach)])).toMatchObject({ phase: 'fetch', core: { state: 'dropped', x: 70, z: 80 } });
    expect(press(mission, at(fell))).toEqual([{ kind: 'corePicked', player: 0 }]);
  });

  it('restarts Defend at the relay from the start of the wave it fell in, sending that wave again', () => {
    const mission = missionAt('defend');
    run(mission, at(SITES.relay), 40);
    tick(mission, dead(SITES.relay));
    expect(mission.redeploy()).toEqual(SITES.relay);
    expect(mission.view([FAR]).upload.progress).toBeCloseTo(25 / UPLOAD_DURATION);
    const events = run(mission, at(SITES.relay), UPLOAD_DURATION - 25);
    expect(waves(events).map((wave) => wave.kind === 'waveRequested' && wave.bias)).toEqual(['rusher', 'sniper']);
    expect(events.at(-1)).toEqual({ kind: 'stageStarted', stage: 'extract' });
  });

  it('restarts Extract at the relay with the full countdown', () => {
    const mission = missionAt('extract');
    run(mission, FAR, 40);
    tick(mission, dead(FAR));
    expect(mission.redeploy()).toEqual(SITES.relay);
    expect(mission.view([FAR]).extractionLeft).toBe(EXTRACTION_SECONDS);
    expect(waves(run(mission, FAR, 1))).toHaveLength(1);
  });
});

describe('completeStage (the test hook)', () => {
  it('walks the four stages to the win with the events a played run gives', () => {
    const mission = new MissionState(SITES);
    expect(mission.completeStage()).toEqual([{ kind: 'stageStarted', stage: 'fetch' }]);
    expect(mission.completeStage()).toEqual([{ kind: 'stageStarted', stage: 'defend' }]);
    expect(mission.view([FAR]).core.state).toBe('plugged');
    expect(mission.completeStage()).toEqual([{ kind: 'stageStarted', stage: 'extract' }]);
    expect(mission.completeStage()).toEqual([{ kind: 'won' }]);
    expect(mission.completeStage()).toEqual([]);
  });
});

describe('missionMapMarkers', () => {
  it('marks where the current stage sends the player', () => {
    const ids = (mission: MissionState) => missionMapMarkers(mission.view([FAR])).map((marker) => marker.id);
    const mission = new MissionState(SITES);
    expect(missionMapMarkers(mission.view([FAR]))).toEqual([{ id: 'terminal', x: SITES.breach.x, z: SITES.breach.z }]);
    mission.completeStage();
    expect(ids(mission)).toEqual(['core', 'relay']);
    press(mission, at(SITES.core, true));
    expect(ids(mission)).toEqual(['relay']);
    mission.completeStage();
    expect(ids(mission)).toEqual(['relay']);
    mission.completeStage();
    expect(ids(mission)).toEqual(['extract']);
    mission.completeStage();
    expect(ids(mission)).toEqual([]);
  });
});
