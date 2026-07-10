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
      { icon: 'pistol', text: 'Pistols only - no other weapon is in your loadout.' },
      { icon: 'skull', text: 'Every hit is lethal, no matter where it lands.' },
      { icon: 'trophy', text: 'First player to the kill limit wins the match.' },
    ],
  },
  sniperDuel: {
    title: 'Sniper Duel',
    steps: [
      { icon: 'scope', text: 'Sniper rifles only - no other weapon is in your loadout.' },
      { icon: 'skull', text: 'One shot drops your target instantly.' },
      { icon: 'trophy', text: 'First player to the kill limit wins the match.' },
    ],
  },
  gunGame: {
    title: 'Gun Game',
    steps: [
      { icon: 'pistol', text: 'You start with one random gun - the knife never appears in this mode.' },
      { icon: 'ladder', text: 'Every kill upgrades you to a new random weapon. Dying does not reset it.' },
      { icon: 'goose', text: 'One kill from winning? You are forced onto the Goose Launcher - land the final kill with it.' },
      { icon: 'trophy', text: 'Reach the kill limit to win.' },
    ],
  },
  knifeOnly: {
    title: 'Knife Only',
    steps: [
      { icon: 'knife', text: 'Blades only - no guns, no exceptions. Get in close.' },
      { icon: 'trophy', text: 'First player to the kill limit wins the match.' },
    ],
  },
  gooseToss: {
    title: 'Goose Toss',
    steps: [
      { icon: 'goose', text: 'No guns at all - grab a live goose and throw it at your opponents.' },
      { icon: 'explosion', text: 'A thrown goose explodes on impact, damaging everyone caught in the blast.' },
      { icon: 'trophy', text: 'First player to the kill limit wins the match.' },
    ],
  },
  kingOfTheHill: {
    title: 'King of the Hill',
    steps: [
      { icon: 'crown', text: 'Full arsenal - race everyone else to the golden goose at the map’s center.' },
      { icon: 'lock', text: 'Carrying the goose locks your weapons, but scores a point every second.' },
      { icon: 'goose', text: 'Killed while carrying it? The goose drops right where you fell, free for anyone.' },
      { icon: 'trophy', text: 'First player to the point target wins.' },
    ],
  },
  gooseHorde: {
    title: 'Goose Horde (Co-op)',
    steps: [
      { icon: 'shield', text: 'Co-op survival - your whole team fights the horde together, not each other.' },
      { icon: 'wave', text: 'Waves escalate: more geese, faster, with jumpers and flyers as you progress.' },
      { icon: 'heart', text: 'Each player gets 2 respawns. Burn through both and that death is permanent.' },
      { icon: 'trophy', text: 'Survive every wave to win. You only lose once every player is eliminated.' },
    ],
  },
};
