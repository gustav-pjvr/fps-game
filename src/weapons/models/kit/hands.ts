import { BODY, type GunBuilder } from './GunBuilder.ts';
import type { P3 } from './geometry.ts';

/** The shooter's arms. They are parts of their own (`arm-trigger`, `arm-support`) so a reload or
 * inspect clip can move a hand, and so thumbnails and other players' copies can leave them out.
 * Both wear the player's suit (weaponMaterials.ts: `glove`, `sleeve`), whatever the skin. */
export const ARM_TRIGGER = 'arm-trigger';
export const ARM_SUPPORT = 'arm-support';

export interface GripHandSpec {
  /** Centre of the grip the hand wraps, gun space. */
  grip: P3;
  /** How far the grip leans, in radians: positive puts its bottom further back, as on most guns. */
  rake?: number;
  /** The grip's cross-section: [across, front to back]. */
  size?: readonly [across: number, depth: number];
  /** Where the forearm leaves the screen (defaults down, back and to the right). */
  elbow?: P3;
  parent?: string;
}

/** The trigger hand round a pistol grip (or any upright handle, such as a reverse-grip blade). */
export function triggerHand(b: GunBuilder, spec: GripHandSpec): string {
  const [gx, gy, gf] = spec.grip;
  const rake = spec.rake ?? 0.25;
  const [across, depth] = spec.size ?? [0.034, 0.05];
  const c = Math.cos(rake), s = Math.sin(rake);
  /** Grip frame to gun space: `u` runs up the grip, `v` out of its front. */
  const at = (x: number, u: number, v: number): P3 => [gx + x, gy + u * c - v * s, gf + u * s + v * c];
  const tilt = { rotate: [-rake, 0, 0] as const };
  const wrist = at(0.012, -0.014, -(depth / 2 + 0.042));
  const part = b.part(ARM_TRIGGER, wrist, spec.parent ?? BODY);

  // Web of the hand behind the grip, and the back of the hand down its right side.
  b.box(part, 'glove', [across + 0.03, 0.078, 0.04], at(0.004, 0.012, -(depth / 2 + 0.012)), { ...tilt, bevel: 0.014 });
  b.box(part, 'glove', [0.024, 0.08, depth + 0.034], at(across / 2 + 0.009, 0.008, -0.004), { ...tilt, bevel: 0.009 });
  // Three fingers round the front strap, their tips showing on the left.
  for (let i = 0; i < 3; i++) {
    const u = 0.014 - i * 0.0215;
    b.box(part, 'glove', [across + 0.03, 0.0195, 0.027], at(0.002, u, depth / 2 + 0.008), { ...tilt, bevel: 0.0085 });
    b.box(part, 'glove', [0.017, 0.0195, 0.032], at(-(across / 2 + 0.0065), u, depth / 2 - 0.014), { ...tilt, bevel: 0.007 });
  }
  // Thumb along the left of the frame, index finger along the right, off the trigger.
  b.box(part, 'glove', [0.02, 0.022, 0.07], at(-(across / 2 + 0.009), 0.047, 0.014), { rotate: [-rake * 0.4, 0.05, 0], bevel: 0.009 });
  b.box(part, 'glove', [0.017, 0.018, 0.068], at(across / 2 + 0.006, 0.052, 0.036), { rotate: [-rake * 0.3, -0.04, 0], bevel: 0.008 });
  forearm(b, part, wrist, spec.elbow ?? [gx + 0.13, gy - 0.26, gf - 0.4]);
  return part;
}

export interface SupportHandSpec {
  /** Centre of the underside of what the hand holds (a handguard, a pump), gun space. */
  at: P3;
  /** Width of the held part. */
  width?: number;
  elbow?: P3;
  parent?: string;
}

/** The support hand cupping a handguard from below: thumb and heel on the near (left) side,
 * fingers round the far side. */
export function supportHand(b: GunBuilder, spec: SupportHandSpec): string {
  const [x, y, f] = spec.at;
  const w = spec.width ?? 0.044;
  const wrist: P3 = [x - (w / 2 + 0.012), y - 0.024, f - 0.058];
  const part = b.part(ARM_SUPPORT, wrist, spec.parent ?? BODY);
  b.box(part, 'glove', [w + 0.026, 0.032, 0.098], [x, y - 0.015, f], { bevel: 0.013 });
  b.box(part, 'glove', [0.022, 0.05, 0.062], [x - (w / 2 + 0.007), y + 0.004, f - 0.012], { bevel: 0.009 });
  b.box(part, 'glove', [0.019, 0.021, 0.072], [x - (w / 2 + 0.009), y + 0.026, f + 0.014], { rotate: [0.12, 0.06, 0], bevel: 0.009 });
  for (let i = 0; i < 4; i++) {
    b.box(part, 'glove', [0.017, 0.052, 0.0195], [x + w / 2 + 0.0065, y + 0.013, f - 0.032 + i * 0.0215], { bevel: 0.007 });
  }
  forearm(b, part, wrist, spec.elbow ?? [x - 0.24, y - 0.3, f - 0.4]);
  return part;
}

/** The support hand wrapped over the trigger hand on a pistol: a two-handed grip. */
export function supportWrap(b: GunBuilder, spec: GripHandSpec): string {
  const [gx, gy, gf] = spec.grip;
  const rake = spec.rake ?? 0.25;
  const [across, depth] = spec.size ?? [0.034, 0.05];
  const c = Math.cos(rake), s = Math.sin(rake);
  const at = (x: number, u: number, v: number): P3 => [gx + x, gy + u * c - v * s, gf + u * s + v * c];
  const tilt = { rotate: [-rake, 0, 0] as const };
  const wrist = at(-(across / 2 + 0.03), -0.03, -(depth / 2 + 0.03));
  const part = b.part(ARM_SUPPORT, wrist, spec.parent ?? BODY);
  b.box(part, 'glove', [0.032, 0.084, depth + 0.04], at(-(across / 2 + 0.024), -0.004, 0.012), { ...tilt, bevel: 0.013 });
  for (let i = 0; i < 3; i++) {
    b.box(part, 'glove', [0.03, 0.0195, 0.03], at(-(across / 2 + 0.012), 0.012 - i * 0.0215, depth / 2 + 0.03), { ...tilt, bevel: 0.0085 });
  }
  b.box(part, 'glove', [0.019, 0.021, 0.078], at(-(across / 2 + 0.016), 0.05, 0.034), { rotate: [-rake * 0.3, 0.05, 0], bevel: 0.009 });
  forearm(b, part, wrist, spec.elbow ?? [gx - 0.2, gy - 0.3, gf - 0.36]);
  return part;
}

export interface ClampHandSpec {
  /** Centre of the handle, gun space; the handle runs fore and aft. */
  handle: P3;
  /** The handle's cross-section: [across, up]. */
  size?: readonly [across: number, up: number];
  elbow?: P3;
  parent?: string;
}

/** A fist closed round a fore-and-aft handle (a blade held point forward): knuckles outside,
 * fingers showing on the left, thumb on top. */
export function clampHand(b: GunBuilder, spec: ClampHandSpec): string {
  const [x, y, f] = spec.handle;
  const [across, up] = spec.size ?? [0.026, 0.032];
  const wrist: P3 = [x + 0.012, y - 0.012, f - 0.07];
  const part = b.part(ARM_TRIGGER, wrist, spec.parent ?? BODY);
  b.box(part, 'glove', [across + 0.034, up + 0.04, 0.094], [x + 0.004, y - 0.002, f], { bevel: 0.016 });
  for (let i = 0; i < 4; i++) {
    b.box(part, 'glove', [0.014, up + 0.026, 0.0195], [x - (across / 2 + 0.016), y - 0.004, f - 0.033 + i * 0.0218], { bevel: 0.007 });
  }
  b.box(part, 'glove', [0.021, 0.018, 0.064], [x - 0.006, y + up / 2 + 0.018, f + 0.03], { rotate: [0.08, 0.1, 0], bevel: 0.008 });
  forearm(b, part, wrist, spec.elbow ?? [x + 0.12, y - 0.24, f - 0.4]);
  return part;
}

function forearm(b: GunBuilder, part: string, wrist: P3, elbow: P3): void {
  const length = Math.hypot(elbow[0] - wrist[0], elbow[1] - wrist[1], elbow[2] - wrist[2]);
  const along = (t: number): P3 => [
    wrist[0] + (elbow[0] - wrist[0]) * t, wrist[1] + (elbow[1] - wrist[1]) * t, wrist[2] + (elbow[2] - wrist[2]) * t,
  ];
  // Glove cuff, a band of suit plate, then the sleeve widening toward the elbow.
  b.tube(part, 'glove', along(-0.012 / length), along(0.05 / length), 0.032, 0.035, 12);
  b.tube(part, 'sleeve', along(0.045 / length), elbow, 0.033, 0.046, 12);
}
