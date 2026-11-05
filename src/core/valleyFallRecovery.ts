interface Position { readonly x: number; readonly y: number; readonly z: number }
interface TowerFloor { readonly x: number; readonly z: number; readonly floorY: number }

/** Pure check for the local Valley player's emergency return, independent of match authority. */
export function valleyFallRecovery(position: Position, terrainHeight: number, towers: readonly TowerFloor[]): { x: number; z: number } | null {
  let nearest: TowerFloor | undefined, distance = Infinity;
  for (const tower of towers) {
    const next = Math.hypot(position.x - tower.x, position.z - tower.z);
    if (next < distance) { nearest = tower; distance = next; }
  }
  const belowLab = nearest !== undefined && position.y < nearest.floorY - 25;
  if (!belowLab && position.y >= terrainHeight - 60) return null;
  // East is the doorway face. Stand clear of its leaves, on the flat apron.
  return nearest ? { x: nearest.x + 4.5, z: nearest.z } : { x: position.x, z: position.z };
}
