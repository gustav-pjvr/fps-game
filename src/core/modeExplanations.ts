import type { GameMode } from './gameModes.ts';

/** One of a small, reusable icon set (see ui/modeExplanationScreen.ts's ICONS map) - kept as an id
 * rather than inline markup here so the actual SVG lives in exactly one place. */
export type ModeExplanationIcon =
  | 'pistol'
  | 'scope'
  | 'ladder'
  | 'knife'
  | 'goose'
  | 'explosion'
  | 'crown'
  | 'lock'
  | 'shield'
  | 'wave'
  | 'heart'
  | 'skull'
  | 'trophy';

export interface ModeExplanationStep {
  icon: ModeExplanationIcon;
  text: string;
}

export interface ModeExplanation {
  title: string;
  steps: readonly ModeExplanationStep[];
  /** The briefing for a player on their own, where the mode plays differently alone. */
  solo?: { title: string; steps: readonly ModeExplanationStep[] };
}

/** Operation Uplink's briefing (docs/uplink.md). The mission is a single-player match option, not a
 * GameMode, so it has no entry in MODE_EXPLANATIONS: Game.startMission shows this one itself. */
export const MISSION_EXPLANATION: ModeExplanation = {
  title: 'Operation Uplink',
  steps: [
    { icon: 'lock', text: 'Breach: reach the uplink terminal and stay beside it while the hack runs.' },
    { icon: 'shield', text: 'Fetch: take the data core (E) and carry it to the relay. No sprinting with it, and it drops where you fall.' },
    { icon: 'wave', text: 'Defend: plug the core in and hold the relay through three waves. A Warden leads the last.' },
    { icon: 'trophy', text: 'Extract: reach the extraction point before the countdown ends. Two redeploys. Time, damage and redeploys set your grade.' },
  ],
};

/** Showdown's briefing (docs/showdown.md). Like the mission, the solo Director mode is a match
 * option and not a GameMode: Game shows this one itself. */
export const SHOWDOWN_EXPLANATION: ModeExplanation = {
  title: 'Showdown',
  steps: [
    { icon: 'wave', text: 'Five acts. Enemies come in waves from where you are not looking; each act brings more of them.' },
    { icon: 'shield', text: 'Clear what is left after an act\'s peak to earn a breather and a supply crate.' },
    { icon: 'ladder', text: 'Kills score more while you stay in the fight: the multiplier climbs to x5 and resets when you fall.' },
    { icon: 'trophy', text: 'Act five ends with the Warden and its escorts. Kill them to win. Two redeploys.' },
  ],
};

/** Shown once, at the start of a match (and again on rematch - see MultiplayerSession.
 * showModeExplanation), for every mode except 'default' - per explicit user request, grounded in
 * each mode's actual rules (FIXED_LOADOUTS/win-condition/config.ts values) rather than generic
 * copy, 3-4 steps each. No entry for 'default' - ModeExplanationScreen simply never shows for it. */
export const MODE_EXPLANATIONS: Partial<Record<GameMode, ModeExplanation>> = {
  oneShotOneKill: {
    title: '1 Shot 1 Kill',
    steps: [
      { icon: 'pistol', text: 'Pistols only.' },
      { icon: 'skull', text: 'Every hit kills.' },
      { icon: 'trophy', text: 'First to the kill limit wins.' },
    ],
  },
  sniperDuel: {
    title: 'Sniper Duel',
    steps: [
      { icon: 'scope', text: 'Sniper rifles only.' },
      { icon: 'skull', text: 'One shot, one kill.' },
      { icon: 'trophy', text: 'First to the kill limit wins.' },
    ],
  },
  gunGame: {
    title: 'Gun Game',
    steps: [
      { icon: 'pistol', text: 'You start with a random gun. No knife in this mode.' },
      { icon: 'ladder', text: 'Each kill gives you a new random weapon. Dying keeps your progress.' },
      { icon: 'goose', text: 'One kill from winning, you get the Goose Launcher. Finish with it.' },
      { icon: 'trophy', text: 'Reach the kill limit to win.' },
    ],
  },
  knifeOnly: {
    title: 'Knife Only',
    steps: [
      { icon: 'knife', text: 'Knives only. Get close.' },
      { icon: 'trophy', text: 'First to the kill limit wins.' },
    ],
  },
  gooseToss: {
    title: 'Goose Toss',
    steps: [
      { icon: 'goose', text: 'No guns. Grab a goose and throw it.' },
      { icon: 'explosion', text: 'A thrown goose explodes on impact and hurts everyone nearby.' },
      { icon: 'trophy', text: 'First to the kill limit wins.' },
    ],
  },
  kingOfTheHill: {
    title: 'King of the Hill',
    steps: [
      { icon: 'shield', text: 'Stand on the hill alone to score a point a second. With an enemy on it, nobody scores.' },
      { icon: 'crown', text: 'Take the golden goose in its middle (E) to be crowned: double points, no sprinting, everyone sees you.' },
      { icon: 'wave', text: 'The hill moves every minute. Four players fight two against two.' },
      { icon: 'trophy', text: 'First to 120 points wins. Kills clear the hill but score nothing.' },
    ],
  },
  gooseHorde: {
    title: 'Goose Horde (Co-op)',
    steps: [
      { icon: 'wave', text: 'Twelve waves, each bigger and faster. Red brutes take the whole squad\'s fire; a boss leads waves 6 and 12.' },
      { icon: 'heart', text: 'A fallen teammate can be revived: stand by them and hold E. Everyone gets back up when the next wave starts.' },
      { icon: 'shield', text: 'Kills earn the squad supply drops: ammo, health and a grenade. Mark a target or a crate for your team with V.' },
      { icon: 'trophy', text: 'Survive every wave to win. You lose when the whole squad is down at once.' },
    ],
    solo: {
      title: 'Goose Horde',
      steps: [
        { icon: 'wave', text: 'Twelve waves, each bigger and faster. Red brutes take real damage to stop; a boss leads waves 6 and 12.' },
        { icon: 'heart', text: 'A Second Wind saves you from one death and clears the geese around you. You earn another every four waves.' },
        { icon: 'shield', text: 'Kills earn supply drops: health and a grenade.' },
        { icon: 'trophy', text: 'Survive every wave to win. Fall with no Second Wind left and the run starts over.' },
      ],
    },
  },
};
