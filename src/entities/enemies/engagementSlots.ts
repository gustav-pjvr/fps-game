/**
 * Caps how many enemies can be actively firing on the player at once (enemy AI overhaul, Phase C -
 * "a cap on how many enemies can be actively engaging at once" from the design doc). Without this,
 * every enemy that spots the player opens fire simultaneously the instant it's in range, which
 * reads as an unfair dogpile rather than a fight the player can react to piece by piece. One shared
 * instance per match, held by every `Enemy` - an enemy that can't acquire a slot still tracks/faces
 * the player but doesn't shoot until a slot frees up (another engager dies, leashes off, or loses
 * line of sight).
 */
export class EngagementSlots {
  private readonly holders = new Set<number>();

  constructor(private readonly capacity: number) {}

  tryAcquire(id: number): boolean {
    if (this.holders.has(id)) return true;
    if (this.holders.size >= this.capacity) return false;
    this.holders.add(id);
    return true;
  }

  release(id: number): void {
    this.holders.delete(id);
  }
}
