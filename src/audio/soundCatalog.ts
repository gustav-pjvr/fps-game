import type { SoundEngine } from './SoundEngine.ts';
import type { Vec3Like } from './spatial.ts';
import type { Surface } from './surfaces.ts';
import { BLADE_SWINGS, GUN_SOUNDS } from './weaponSounds.ts';

/**
 * Every sound the game makes, by name, for the sound test page (soundlab.html) and the offline
 * measurements (docs/sound.md). The game itself calls the engine's methods directly; this list
 * exists so that every one of them can be played and measured without a match.
 */
export interface CatalogSound {
  readonly id: string;
  readonly label: string;
  readonly group: 'Gunshots' | 'Weapon handling' | 'Bullets' | 'Footsteps' | 'Glass and world' | 'Explosions and grenades' | 'Voices' | 'Interface';
  /** `own`: only ever the player's own (no position). `world`: only ever somewhere in the world.
   * `both`: the player makes it and so do others. */
  readonly where: 'own' | 'world' | 'both';
  /** Seconds the sound lasts with its reverb, for the offline render's length. */
  readonly seconds: number;
  /** `at` absent: the player's own. */
  readonly play: (engine: SoundEngine, at?: Vec3Like) => void;
}

const GUN_LABELS: Readonly<Record<string, string>> = {
  pistol: 'Pistol', mp5: 'MP5', revolver: 'Revolver', machinePistol: 'Machine pistol', sawnOff: 'Sawn-off', rifle: 'Rifle',
  smg: 'SMG', battleRifle: 'Battle rifle', lmg: 'Machine gun', dmr: 'Marksman rifle', shotgun: 'Shotgun (with pump)',
  sniper: 'Sniper (with bolt)', gooseLauncher: 'Goose launcher', 'enemy-rifle': 'Enemy rifle',
};

const SURFACES: readonly Surface[] = ['earth', 'wood', 'concrete', 'metal', 'glass', 'flesh'];
const STEP_SURFACES: readonly Surface[] = ['earth', 'wood', 'concrete', 'metal', 'glass'];
const title = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
/** A world-only sound needs a place: the lab always gives one, this guards a direct call. */
const AHEAD: Vec3Like = { x: 0, y: 0, z: -3 };

export const SOUND_CATALOG: readonly CatalogSound[] = [
  ...Object.keys(GUN_SOUNDS).map((id): CatalogSound => ({
    id: `gunshot:${id}`, label: GUN_LABELS[id] ?? id, group: 'Gunshots', where: id === 'enemy-rifle' ? 'world' : 'both', seconds: 3.4,
    play: (engine, at) => engine.playGunshot(id, at ?? (id === 'enemy-rifle' ? AHEAD : undefined)),
  })),

  ...Object.keys(BLADE_SWINGS).map((id): CatalogSound => ({
    id: `swing:${id}`, label: `${title(id)} swing`, group: 'Weapon handling', where: 'both', seconds: 0.6,
    play: (engine, at) => engine.playKnifeSwing(id, at),
  })),
  { id: 'knifeHit', label: 'Blade hits a body', group: 'Weapon handling', where: 'own', seconds: 0.4, play: (engine) => engine.playKnifeHit() },
  { id: 'meleeSwing', label: 'Enemy melee swing', group: 'Weapon handling', where: 'world', seconds: 0.6, play: (engine, at) => engine.playMeleeSwing(at ?? AHEAD) },
  ...(['rifle', 'pistol', 'revolver', 'sawnOff', 'shotgun', 'lmg'] as const).map((id): CatalogSound => ({
    id: `reload:${id}`, label: `Reload: ${GUN_LABELS[id]}`, group: 'Weapon handling', where: 'own', seconds: 4.5,
    play: (engine) => engine.playReloadClick(id),
  })),
  { id: 'casing:concrete', label: 'Casing on concrete', group: 'Weapon handling', where: 'own', seconds: 1.2, play: (engine) => engine.playCasing('concrete') },
  { id: 'casing:metal', label: 'Casing on metal', group: 'Weapon handling', where: 'own', seconds: 1.2, play: (engine) => engine.playCasing('metal') },

  { id: 'whizz', label: 'Bullet passing close', group: 'Bullets', where: 'world', seconds: 0.5, play: (engine, at) => engine.playBulletWhizz(at ?? AHEAD) },
  ...SURFACES.map((surface): CatalogSound => ({
    id: `impact:${surface}`, label: `Bullet hits ${surface === 'flesh' ? 'a body' : surface}`, group: 'Bullets', where: 'world', seconds: 0.9,
    play: (engine, at) => engine.playImpact(surface, at ?? AHEAD),
  })),

  ...STEP_SURFACES.flatMap((surface): CatalogSound[] => [
    { id: `step:${surface}:walk`, label: `Walk on ${surface === 'glass' ? 'broken glass' : surface}`, group: 'Footsteps', where: 'both', seconds: 0.6, play: (engine, at) => engine.playFootstep(surface, 'walk', at) },
    { id: `step:${surface}:run`, label: `Run on ${surface === 'glass' ? 'broken glass' : surface}`, group: 'Footsteps', where: 'both', seconds: 0.6, play: (engine, at) => engine.playFootstep(surface, 'run', at) },
  ]),
  { id: 'step:enemy', label: 'Enemy boot (earth, run)', group: 'Footsteps', where: 'world', seconds: 0.6, play: (engine, at) => engine.playFootstep('earth', 'run', at ?? AHEAD, true) },

  { id: 'glassHit', label: 'Round through a window', group: 'Glass and world', where: 'world', seconds: 0.9, play: (engine, at) => engine.playGlassHit(at ?? AHEAD) },
  { id: 'glassBreak', label: 'Window breaks', group: 'Glass and world', where: 'world', seconds: 2.4, play: (engine, at) => engine.playGlassBreak(at ?? AHEAD) },
  { id: 'lampBreak', label: 'Lamp shot out', group: 'Glass and world', where: 'world', seconds: 1.4, play: (engine, at) => engine.playLampBreak(at ?? AHEAD) },
  { id: 'door:open', label: 'Door opens', group: 'Glass and world', where: 'world', seconds: 1.6, play: (engine, at) => engine.playDoorSlide(false, at ?? AHEAD) },
  { id: 'door:close', label: 'Door closes', group: 'Glass and world', where: 'world', seconds: 1.6, play: (engine, at) => engine.playDoorSlide(true, at ?? AHEAD) },
  { id: 'breaker:on', label: 'Breaker on', group: 'Glass and world', where: 'world', seconds: 1.8, play: (engine, at) => engine.playBreakerSwitch(true, at ?? AHEAD) },
  { id: 'breaker:off', label: 'Breaker off', group: 'Glass and world', where: 'world', seconds: 2.4, play: (engine, at) => engine.playBreakerSwitch(false, at ?? AHEAD) },

  { id: 'explosion', label: 'Goose explodes', group: 'Explosions and grenades', where: 'world', seconds: 3.6, play: (engine, at) => engine.playExplosion(at ?? AHEAD) },
  { id: 'frag', label: 'Frag grenade', group: 'Explosions and grenades', where: 'world', seconds: 4, play: (engine, at) => engine.playFragExplosion(at ?? AHEAD) },
  { id: 'flash', label: 'Flash grenade', group: 'Explosions and grenades', where: 'world', seconds: 3.6, play: (engine, at) => engine.playFlashBang(at ?? AHEAD) },
  { id: 'grenadePin', label: 'Grenade pin', group: 'Explosions and grenades', where: 'own', seconds: 0.4, play: (engine) => engine.playGrenadePin() },
  { id: 'grenadeThrow', label: 'Grenade throw', group: 'Explosions and grenades', where: 'both', seconds: 0.6, play: (engine, at) => engine.playGrenadeThrow(at) },
  { id: 'grenadeBounce', label: 'Grenade bounce', group: 'Explosions and grenades', where: 'world', seconds: 0.5, play: (engine, at) => engine.playGrenadeBounce(1, at ?? AHEAD) },
  { id: 'grenadeBounce:glass', label: 'Grenade off a window', group: 'Explosions and grenades', where: 'world', seconds: 0.5, play: (engine, at) => engine.playGrenadeBounce(1, at ?? AHEAD, true) },

  { id: 'callout:spotted', label: 'Enemy callout: spotted', group: 'Voices', where: 'world', seconds: 0.9, play: (engine, at) => engine.playCallout('spotted', at ?? AHEAD) },
  { id: 'callout:flanking', label: 'Enemy callout: flanking', group: 'Voices', where: 'world', seconds: 0.9, play: (engine, at) => engine.playCallout('flanking', at ?? AHEAD) },
  { id: 'callout:lostThem', label: 'Enemy callout: lost them', group: 'Voices', where: 'world', seconds: 0.9, play: (engine, at) => engine.playCallout('lostThem', at ?? AHEAD) },
  { id: 'glint', label: 'Scope glint warning', group: 'Voices', where: 'world', seconds: 0.5, play: (engine, at) => engine.playGlint(at ?? AHEAD) },

  { id: 'hitConfirm', label: 'Hit confirm', group: 'Interface', where: 'own', seconds: 0.3, play: (engine) => engine.playHitConfirm() },
  { id: 'hurt', label: 'Player hurt', group: 'Interface', where: 'own', seconds: 0.5, play: (engine) => engine.playPlayerHurt() },
  { id: 'ping', label: 'Teammate ping', group: 'Interface', where: 'own', seconds: 0.5, play: (engine) => engine.playPing() },
  { id: 'cue:gain', label: 'Objective gained', group: 'Interface', where: 'own', seconds: 0.7, play: (engine) => engine.playObjectiveCue('gain') },
  { id: 'cue:lose', label: 'Objective lost', group: 'Interface', where: 'own', seconds: 0.7, play: (engine) => engine.playObjectiveCue('lose') },
  { id: 'cue:alert', label: 'Objective alert', group: 'Interface', where: 'own', seconds: 0.8, play: (engine) => engine.playObjectiveCue('alert') },
  { id: 'pickup:health', label: 'Pickup: health', group: 'Interface', where: 'own', seconds: 0.5, play: (engine) => engine.playPickup('health') },
  { id: 'pickup:ammo', label: 'Pickup: ammo', group: 'Interface', where: 'own', seconds: 0.4, play: (engine) => engine.playPickup('ammo') },
  { id: 'pickup:grenade', label: 'Pickup: grenades', group: 'Interface', where: 'own', seconds: 0.5, play: (engine) => engine.playPickup('grenade') },
  { id: 'torch:on', label: 'Torch on', group: 'Interface', where: 'own', seconds: 0.3, play: (engine) => engine.playTorchClick(true) },
  { id: 'torch:off', label: 'Torch off', group: 'Interface', where: 'own', seconds: 0.3, play: (engine) => engine.playTorchClick(false) },
];
