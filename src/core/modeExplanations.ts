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
}

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
      { icon: 'shield', text: 'Co-op: your team fights the horde together.' },
      { icon: 'wave', text: 'Waves get bigger and faster, with jumpers and flyers later.' },
      { icon: 'heart', text: 'Each player has 2 respawns. After that, a death is final.' },
      { icon: 'trophy', text: 'Survive every wave to win. You lose when everyone is out.' },
    ],
  },
};
