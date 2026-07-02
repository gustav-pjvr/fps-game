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
  | 'weaponNext'
  | 'weaponPrev';

export const KEY_BINDINGS: Record<string, Action> = {
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
};
