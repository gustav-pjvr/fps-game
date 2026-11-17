export type MissionGrade = 'S' | 'A' | 'B' | 'C';

/** A run this fast or faster loses nothing for time. */
export const GRADE_PAR_SECONDS = 360;
/** Past par, a point goes every this many seconds, up to GRADE_TIME_MAX_LOSS. */
export const GRADE_SECONDS_PER_POINT = 6;
export const GRADE_TIME_MAX_LOSS = 30;
/** A point goes for every this much damage taken, up to GRADE_DAMAGE_MAX_LOSS. */
export const GRADE_DAMAGE_PER_POINT = 12;
export const GRADE_DAMAGE_MAX_LOSS = 30;
/** Each redeploy used costs this many points, so one redeploy rules out an S. */
export const GRADE_REDEPLOY_LOSS = 20;
const GRADE_FLOORS: readonly (readonly [MissionGrade, number])[] = [['S', 90], ['A', 75], ['B', 55]];

export interface MissionRun {
  readonly seconds: number;
  readonly damageTaken: number;
  readonly redeploysUsed: number;
}

/** A finished operation's score out of 100: time over par, damage taken and redeploys used each
 * take points away. */
export function missionScore(run: MissionRun): number {
  const time = Math.min(GRADE_TIME_MAX_LOSS, Math.max(0, run.seconds - GRADE_PAR_SECONDS) / GRADE_SECONDS_PER_POINT);
  const damage = Math.min(GRADE_DAMAGE_MAX_LOSS, Math.max(0, run.damageTaken) / GRADE_DAMAGE_PER_POINT);
  return Math.max(0, Math.round(100 - time - damage - Math.max(0, run.redeploysUsed) * GRADE_REDEPLOY_LOSS));
}

/** The grade on the end screen (docs/uplink.md): S from 90, A from 75, B from 55, C below. */
export function missionGrade(run: MissionRun): MissionGrade {
  const score = missionScore(run);
  return GRADE_FLOORS.find(([, floor]) => score >= floor)?.[0] ?? 'C';
}
