export type Action =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'jump'
  | 'sprint'
  | 'fire'
  | 'aim'
  | 'reload'
  | 'weaponSlot1'
  | 'weaponSlot2'
  | 'weaponSlot3'
  | 'weaponSlot4'
  | 'weaponSlot5'
  | 'weaponNext'
  | 'weaponPrev'
  | 'resetPlay'
  | 'interact'
  | 'flashlight'
  | 'grenadeFrag'
  | 'grenadeFlash';

export const DEFAULT_KEY_BINDINGS: Record<string, Action> = {
  KeyW: 'moveForward',
  KeyS: 'moveBackward',
  KeyA: 'moveLeft',
  KeyD: 'moveRight',
  Space: 'jump',
  ShiftLeft: 'sprint',
  KeyR: 'reload',
  Digit1: 'weaponSlot1',
  Digit2: 'weaponSlot2',
  Digit3: 'weaponSlot3',
  Digit4: 'weaponSlot4',
  Digit5: 'weaponSlot5',
  KeyT: 'resetPlay',
  KeyE: 'interact',
  KeyF: 'flashlight',
  KeyG: 'grenadeFrag',
  KeyQ: 'grenadeFlash',
};

/** Actions a player can rebind in the settings panel - excludes number keys/mouse, which stay fixed. */
export const REBINDABLE_ACTIONS: Action[] = [
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'jump',
  'sprint',
  'reload',
  'resetPlay',
  'flashlight',
  'grenadeFrag',
  'grenadeFlash',
];

export const ACTION_LABELS: Record<Action, string> = {
  moveForward: 'Move Forward',
  moveBackward: 'Move Backward',
  moveLeft: 'Move Left',
  moveRight: 'Move Right',
  jump: 'Jump',
  sprint: 'Sprint',
  fire: 'Fire',
  aim: 'Aim',
  reload: 'Reload',
  weaponSlot1: 'Weapon Slot 1',
  weaponSlot2: 'Weapon Slot 2',
  weaponSlot3: 'Weapon Slot 3',
  weaponSlot4: 'Weapon Slot 4',
  weaponSlot5: 'Weapon Slot 5',
  weaponNext: 'Next Weapon',
  weaponPrev: 'Previous Weapon',
  resetPlay: 'Reset Match',
  interact: 'Interact',
  flashlight: 'Torch',
  grenadeFrag: 'Frag Grenade',
  grenadeFlash: 'Flash Grenade',
};

/** Human-readable key names for the few codes that don't read well as-is (KeyW -> W is fine; Space -> "Space" needed). */
export function formatKeyCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'Space';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
  return code;
}
