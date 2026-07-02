export type EntityId = number;

let nextId: EntityId = 0;

export function allocateEntityId(): EntityId {
  return nextId++;
}

export interface Entity {
  readonly id: EntityId;
}
