/** User-supplied recorded SFX (extracted from downloaded reference clips), one shot + one reload
 * sample per weapon. Falls back to procedural synthesis in SoundEngine if a file fails to load. */
export const WEAPON_SOUND_PATHS: Record<string, { shot: string; reload: string }> = {
  pistol: {
    shot: '/assets/sounds/weapons/pistol_shot.mp3',
    reload: '/assets/sounds/weapons/pistol_reload.mp3',
  },
  rifle: {
    shot: '/assets/sounds/weapons/rifle_shot.mp3',
    reload: '/assets/sounds/weapons/rifle_reload.mp3',
  },
  shotgun: {
    shot: '/assets/sounds/weapons/shotgun_shot.mp3',
    reload: '/assets/sounds/weapons/shotgun_reload.mp3',
  },
  sniper: {
    shot: '/assets/sounds/weapons/sniper_shot.mp3',
    reload: '/assets/sounds/weapons/sniper_reload.mp3',
  },
};
