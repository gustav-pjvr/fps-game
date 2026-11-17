import { MISSION_STAGES, REDEPLOYS, UPLOAD_WAVES, type MissionPoint, type MissionStage, type MissionView } from './missionState.ts';

// Operation Uplink's words (docs/uplink.md): the headline at each stage change, the objective
// panel, the world marker labels and the redeploy screen. Pure, so the HUD wording is unit tested.

/** The headline as each stage starts (BigAnnouncement). */
export const MISSION_HEADLINES: Readonly<Record<MissionStage, string>> = {
  breach: 'BREACH THE UPLINK TERMINAL',
  fetch: 'TERMINAL BREACHED: FETCH THE DATA CORE',
  defend: 'CORE PLUGGED IN: DEFEND THE UPLOAD',
  extract: 'UPLOAD COMPLETE: GET TO EXTRACTION',
};

const STAGE_NAMES: Readonly<Record<MissionStage, string>> = { breach: 'BREACH', fetch: 'FETCH', defend: 'DEFEND', extract: 'EXTRACT' };

/** The world and compass markers: id (the one missionMapMarkers uses) to label. */
export const MISSION_MARKER_LABELS: Readonly<Record<string, string>> = {
  terminal: 'TERMINAL',
  core: 'DATA CORE',
  relay: 'RELAY',
  extract: 'EXTRACT',
};

/** A space that does not break, and the bar between the objective line's parts ("HACK 40%",
 * "ALERT 2"): a narrow panel wraps between parts, never inside one or before a bar. */
const NB = '\u00a0';
const BAR = `${NB}| `;

/** The panel's label per stage, built once: `UPLINK 2/4 | FETCH`. */
const STAGE_LABELS = Object.fromEntries(
  MISSION_STAGES.map((stage, index) => [stage, `UPLINK${NB}${index + 1}/${MISSION_STAGES.length}${BAR}${STAGE_NAMES[stage]}`]),
) as Readonly<Record<MissionStage, string>>;

function clock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function percent(progress: number): string {
  return `${Math.floor(Math.min(1, progress) * 100)}%`;
}

/** The objective panel: the stage as its label, what to do now, and a line with the stage's
 * progress, the alert level and the redeploys left. */
export function missionObjective(view: MissionView): { label: string; text: string; line: string } {
  const label = STAGE_LABELS[view.stage];
  const status = `ALERT${NB}${view.alert}${BAR}REDEPLOYS${NB}${view.redeploys}`;
  if (view.phase === 'won') return { label, text: 'Operation complete', line: status };
  if (view.phase === 'lost') return { label, text: 'Signal lost', line: status };
  if (view.phase === 'breach') {
    const text = !view.hack.paused ? 'Hold the terminal while the hack runs' : view.hack.progress > 0 ? 'Hack paused: get back to the terminal' : 'Reach the uplink terminal';
    return { label, text, line: `HACK${NB}${percent(view.hack.progress)}${BAR}${status}` };
  }
  if (view.phase === 'fetch') {
    const { state, underground } = view.core;
    if (state === 'carried') return { label, text: 'Carry the core to the relay', line: `CARRYING,${NB}NO${NB}SPRINT${BAR}${status}` };
    if (state === 'dropped') return { label, text: 'Recover the dropped data core', line: `CORE${NB}DROPPED${BAR}${status}` };
    return { label, text: underground ? 'Take the data core from the lab' : 'Take the data core', line: `CORE${NB}WAITING${BAR}${status}` };
  }
  if (view.phase === 'defend') {
    return {
      label,
      text: view.upload.paused ? 'Upload paused: get back to the relay' : 'Defend the relay',
      line: `UPLOAD${NB}${percent(view.upload.progress)}${BAR}WAVE${NB}${view.upload.wave}/${UPLOAD_WAVES.length}${BAR}${status}`,
    };
  }
  return { label, text: 'Reach the extraction point', line: `TIME${NB}LEFT${NB}${clock(view.extractionLeft)}${BAR}${status}` };
}

/** The screen after a death with a redeploy left: its title, the line under it and its numbers.
 * Respawn takes the redeploy. */
export function redeployScreen(view: MissionView): { title: string; line: string; stats: [string, string][] } {
  const back: Readonly<Record<MissionStage, string>> = { breach: 'the start', fetch: 'the terminal', defend: 'the relay', extract: 'the relay' };
  return {
    title: 'Operative down',
    line: `Redeploy at ${back[view.stage]}`,
    stats: [
      ['STAGE', `${view.stageNumber} / ${MISSION_STAGES.length}`],
      ['REDEPLOYS LEFT', `${view.redeploys} / ${REDEPLOYS}`],
      ['ALERT', String(view.alert)],
    ],
  };
}

/** Where a marker points: the core marker follows the core, the others their sites. */
export function missionMarkerPoint(view: MissionView, id: string): MissionPoint {
  if (id === 'terminal') return view.sites.breach;
  if (id === 'relay') return view.sites.relay;
  if (id === 'extract') return view.sites.extraction;
  return view.core;
}
