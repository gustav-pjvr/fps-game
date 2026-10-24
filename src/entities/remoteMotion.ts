import type * as THREE from 'three';

// Cap extrapolation so prediction errors stay small when movement changes.
export const MAX_LEAD_SECONDS = 0.12;
// Stop extrapolating after silence so disconnected players stay at their last real spot.
export const STALE_MS = 250;
// Treat implausible horizontal speeds as teleports instead of predicting across the map.
export const MAX_PREDICT_SPEED = 20;
// Below this a fast jump is a small correction, not a teleport worth snapping for.
export const TELEPORT_MIN_DISTANCE = 2;

export class RemoteMotion {
  private velocityX = 0;
  private velocityZ = 0;
  private sentAtMs: number | undefined;
  private receivedAtMs: number | undefined;
  private leadSeconds = 0;

  constructor(private x: number, private y: number, private z: number) {}

  /** Returns true when the sample jumped further than anyone can run (a respawn whose message has
   * not arrived yet): the caller snaps there instead of sliding across the map. */
  push(x: number, y: number, z: number, sentAtMs: number | undefined, receivedAtMs: number): boolean {
    let teleported = false;
    if (this.receivedAtMs !== undefined) {
      const dtMs = typeof sentAtMs === 'number' && typeof this.sentAtMs === 'number'
        ? sentAtMs - this.sentAtMs
        : receivedAtMs - this.receivedAtMs;
      const rawX = (x - this.x) / (dtMs / 1000);
      const rawZ = (z - this.z) / (dtMs / 1000);
      const distance = Math.hypot(x - this.x, z - this.z);
      teleported = distance > TELEPORT_MIN_DISTANCE && distance / Math.max(dtMs / 1000, 0.001) > MAX_PREDICT_SPEED;
      // Under 5 ms apart (a browser with a coarse clock, see createSendClock) says nothing about
      // speed: keep the last estimate rather than averaging it toward zero.
      if (dtMs < 5) {
        // velocity unchanged
      } else if (dtMs > 250 || Math.hypot(rawX, rawZ) > MAX_PREDICT_SPEED) {
        this.velocityX = 0;
        this.velocityZ = 0;
      } else {
        this.velocityX = (this.velocityX + rawX) / 2;
        this.velocityZ = (this.velocityZ + rawZ) / 2;
      }
    }
    this.x = x;
    this.y = y;
    this.z = z;
    this.sentAtMs = sentAtMs;
    this.receivedAtMs = receivedAtMs;
    return teleported;
  }

  /** Stops predicting ahead (a player who just died stays where they fell). */
  stop(): void {
    this.velocityX = 0;
    this.velocityZ = 0;
  }

  reset(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.velocityX = 0;
    this.velocityZ = 0;
    this.sentAtMs = undefined;
    this.receivedAtMs = undefined;
  }

  setLeadSeconds(seconds: number): void {
    this.leadSeconds = Math.max(0, Math.min(MAX_LEAD_SECONDS, seconds));
  }

  predict(nowMs: number, out: THREE.Vector3): THREE.Vector3 {
    const ageMs = this.receivedAtMs === undefined ? 0 : nowMs - this.receivedAtMs;
    const lead = ageMs > STALE_MS ? 0 : Math.min(MAX_LEAD_SECONDS, ageMs / 1000 + this.leadSeconds);
    return out.set(this.x + this.velocityX * lead, this.y, this.z + this.velocityZ * lead);
  }
}
