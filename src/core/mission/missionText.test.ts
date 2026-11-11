import { describe, expect, it } from 'vitest';
import { MissionState, missionMapMarkers, type MissionPlayer, type MissionSites } from './missionState.ts';
import { MISSION_MARKER_LABELS, missionMarkerPoint, missionObjective, redeployScreen } from './missionText.ts';

const SITES: MissionSites = {
  breach: { x: -100, z: 0 },
  core: { x: 0, z: 200, underground: true },
  relay: { x: 150, z: 0 },
  extraction: { x: 0, z: -300 },
};
const FAR: MissionPlayer = { x: 500, z: 500, alive: true };
const at = (point: { x: number; z: number }, underground = false): MissionPlayer => ({ x: point.x, z: point.z, alive: true, underground });
const step = (mission: MissionState, player: MissionPlayer, dt: number, interact = false) =>
  mission.update({ dt, players: [player], interact: interact ? 0 : null, kills: 0, shots: 0 });

/** The objective as it reads on screen: its non-breaking spaces as plain ones. */
const shown = (view: Parameters<typeof missionObjective>[0]) => {
  const { label, text, line } = missionObjective(view);
  return { label: label.replaceAll('\u00a0', ' '), text, line: line.replaceAll('\u00a0', ' ') };
};

describe('missionObjective', () => {
  it('names the stage, says what to do and shows its progress, the alert and the redeploys', () => {
    const mission = new MissionState(SITES);
    expect(shown(mission.view([FAR]))).toEqual({
      label: 'UPLINK 1/4 | BREACH',
      text: 'Reach the uplink terminal',
      line: 'HACK 0% | ALERT 1 | REDEPLOYS 2',
    });
    step(mission, at(SITES.breach), 5);
    expect(shown(mission.view([at(SITES.breach)]))).toMatchObject({ text: 'Hold the terminal while the hack runs', line: 'HACK 20% | ALERT 1 | REDEPLOYS 2' });
    expect(shown(mission.view([FAR])).text).toBe('Hack paused: get back to the terminal');

    mission.completeStage();
    expect(shown(mission.view([FAR]))).toMatchObject({ label: 'UPLINK 2/4 | FETCH', text: 'Take the data core from the lab' });
    step(mission, at(SITES.core, true), 0, true);
    expect(shown(mission.view([at(SITES.core, true)]))).toMatchObject({ text: 'Carry the core to the relay', line: 'CARRYING, NO SPRINT | ALERT 1 | REDEPLOYS 2' });
    step(mission, { ...FAR, alive: false }, 0);
    mission.redeploy();
    expect(shown(mission.view([FAR]))).toMatchObject({ text: 'Recover the dropped data core', line: 'CORE DROPPED | ALERT 1 | REDEPLOYS 1' });

    mission.completeStage();
    step(mission, at(SITES.relay), 30);
    expect(shown(mission.view([at(SITES.relay)]))).toMatchObject({ label: 'UPLINK 3/4 | DEFEND', text: 'Defend the relay', line: 'UPLOAD 40% | WAVE 2/3 | ALERT 1 | REDEPLOYS 1' });
    expect(shown(mission.view([FAR])).text).toBe('Upload paused: get back to the relay');

    mission.completeStage();
    step(mission, FAR, 17.5);
    expect(shown(mission.view([FAR]))).toMatchObject({ label: 'UPLINK 4/4 | EXTRACT', text: 'Reach the extraction point', line: 'TIME LEFT 0:43 | ALERT 1 | REDEPLOYS 1' });
    mission.completeStage();
    expect(shown(mission.view([FAR])).text).toBe('Operation complete');
  });

  it('only lets the line wrap between its parts', () => {
    const { label, line } = missionObjective(new MissionState(SITES).view([FAR]));
    expect(line.split(' ')).toEqual(['HACK\u00a00%\u00a0|', 'ALERT\u00a01\u00a0|', 'REDEPLOYS\u00a02']);
    expect(label.split(' ')).toEqual(['UPLINK\u00a01/4\u00a0|', 'BREACH']);
  });
});

describe('redeployScreen', () => {
  it('says where the redeploy goes and how many are left', () => {
    const mission = new MissionState(SITES);
    mission.completeStage();
    step(mission, { ...FAR, alive: false }, 0);
    expect(redeployScreen(mission.view([FAR]))).toEqual({
      title: 'Operative down',
      line: 'Redeploy at the terminal',
      stats: [['STAGE', '2 / 4'], ['REDEPLOYS LEFT', '2 / 2'], ['ALERT', '1']],
    });
  });
});

describe('mission markers', () => {
  it('has a label and a point for every marker the map shows', () => {
    const mission = new MissionState(SITES);
    for (let stage = 0; stage < 4; stage++) {
      const view = mission.view([FAR]);
      for (const marker of missionMapMarkers(view)) {
        expect(MISSION_MARKER_LABELS[marker.id], marker.id).toBeTruthy();
        expect(missionMarkerPoint(view, marker.id)).toMatchObject({ x: marker.x, z: marker.z });
      }
      mission.completeStage();
    }
  });
});
