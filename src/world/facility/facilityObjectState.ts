/**
 * The state of the Facility's doors and breaker switches (docs/facility-map.md, section 12) and its
 * wire form, pure. The host (or a solo game) owns it; guests mirror the host's `worldObjectState`.
 */

export type WorldObjectKind = 'door' | 'breaker';

/** On the wire: one character per door ('1' open) and per breaker ('1' on), in id order. */
export interface WorldObjectWire {
  doors: string;
  breakers: string;
}

/** What changed when a state was applied, by id. */
export interface WorldObjectChanges {
  doors: number[];
  breakers: number[];
}

const bits = (values: readonly boolean[]): string => values.map(value => (value ? '1' : '0')).join('');

/** A received wire state, or null unless both strings are exactly the expected length of 0s and
 * 1s (a build with another layout, or a malformed message, is ignored whole). */
export function parseWorldObjectWire(value: unknown, doorCount: number, breakerCount: number): WorldObjectWire | null {
  if (typeof value !== 'object' || value === null) return null;
  const { doors, breakers } = value as { doors?: unknown; breakers?: unknown };
  const valid = (text: unknown, count: number): text is string =>
    typeof text === 'string' && text.length === count && /^[01]*$/.test(text);
  return valid(doors, doorCount) && valid(breakers, breakerCount) ? { doors, breakers } : null;
}

/** The interaction prompt for an object in its current state. */
export function interactPrompt(kind: WorldObjectKind, active: boolean): string {
  if (kind === 'door') return active ? 'Close door' : 'Open door';
  return active ? 'Power off' : 'Power on';
}

export class FacilityObjectState {
  private readonly doorsOpen: boolean[];
  private readonly breakersOn: boolean[];

  /** `doorsStartOpen[id]` is each door's state at the start of a match; breakers all start on. */
  constructor(private readonly doorsStartOpen: readonly boolean[], private readonly breakerCount: number) {
    this.doorsOpen = [...doorsStartOpen];
    this.breakersOn = Array.from({ length: breakerCount }, () => true);
  }

  get doorCount(): number { return this.doorsOpen.length; }

  get breakers(): number { return this.breakerCount; }

  has(kind: WorldObjectKind, id: number): boolean {
    return Number.isInteger(id) && id >= 0 && id < (kind === 'door' ? this.doorsOpen.length : this.breakerCount);
  }

  /** A door open, a breaker on. False for an unknown id. */
  isActive(kind: WorldObjectKind, id: number): boolean {
    if (!this.has(kind, id)) return false;
    return kind === 'door' ? this.doorsOpen[id]! : this.breakersOn[id]!;
  }

  /** Sets one object. True when it changed. */
  set(kind: WorldObjectKind, id: number, active: boolean): boolean {
    if (!this.has(kind, id) || this.isActive(kind, id) === active) return false;
    (kind === 'door' ? this.doorsOpen : this.breakersOn)[id] = active;
    return true;
  }

  /** Flips one object. Its new state, or null for an unknown id. */
  toggle(kind: WorldObjectKind, id: number): boolean | null {
    if (!this.has(kind, id)) return null;
    const active = !this.isActive(kind, id);
    this.set(kind, id, active);
    return active;
  }

  encode(): WorldObjectWire {
    return { doors: bits(this.doorsOpen), breakers: bits(this.breakersOn) };
  }

  /** Adopts a parsed wire state (parseWorldObjectWire) whole. Returns what changed. */
  apply(wire: WorldObjectWire): WorldObjectChanges {
    const changes: WorldObjectChanges = { doors: [], breakers: [] };
    for (let id = 0; id < this.doorsOpen.length; id++) if (this.set('door', id, wire.doors[id] === '1')) changes.doors.push(id);
    for (let id = 0; id < this.breakerCount; id++) if (this.set('breaker', id, wire.breakers[id] === '1')) changes.breakers.push(id);
    return changes;
  }

  /** Back to the start of the match. Returns what changed. */
  reset(): WorldObjectChanges {
    return this.apply({ doors: bits(this.doorsStartOpen), breakers: '1'.repeat(this.breakerCount) });
  }
}
