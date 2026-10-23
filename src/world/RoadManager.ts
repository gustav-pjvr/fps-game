import * as THREE from 'three';
import { gradeMaterial } from '../render/materialGrade.ts';
import type { BuildingManager } from './BuildingManager.ts';
import { chunkKey } from './chunkSeed.ts';
import { sampleHeight } from './TerrainGenerator.ts';
import { getFlatZoneSite } from './ZoneMap.ts';
import { FLAT_ZONE_CELL_SIZE, FLAT_ZONE_RADIUS_MAX, ROAD_COLOR, ROAD_SURFACE_OFFSET, ROAD_WIDTH } from '../core/config.ts';

interface RoadSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

interface TownRoadLayout {
  segments: RoadSegment[];
}

/** Prim's algorithm over building centers - O(n^2) is trivial at town scale (n <= 45) and always
 * produces a tree connecting every building with the least total road length, which reads as an
 * intentional street layout rather than a web of redundant connections. Exported for the unit-test
 * layer (2026-07-10 review, Phase 6 test-coverage pass) - a pure function of a point list, testable
 * directly without needing real per-town building placement. */
export function computeMinimumSpanningTree(points: readonly { x: number; z: number }[]): [number, number][] {
  const n = points.length;
  if (n < 2) return [];

  const inTree = new Array<boolean>(n).fill(false);
  const bestDistance = new Array<number>(n).fill(Infinity);
  const parent = new Array<number>(n).fill(-1);
  bestDistance[0] = 0;

  const edges: [number, number][] = [];

  for (let iteration = 0; iteration < n; iteration++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!inTree[i]! && (u === -1 || bestDistance[i]! < bestDistance[u]!)) u = i;
    }
    if (u === -1) break;
    inTree[u] = true;
    const parentOfU = parent[u]!;
    if (parentOfU !== -1) edges.push([u, parentOfU]);

    const pointU = points[u]!;
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const pointV = points[v]!;
      const dx = pointU.x - pointV.x;
      const dz = pointU.z - pointV.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance < bestDistance[v]!) {
        bestDistance[v] = distance;
        parent[v] = u;
      }
    }
  }

  return edges;
}

/**
 * Streams flat road-strip meshes connecting a town's buildings, mirroring BuildingManager's
 * per-chunk lifecycle (WORLD_PLAN.md §9 follow-up). A town's road layout - a minimum spanning tree
 * over its (already-memoized) building positions - is a pure function of its flat-zone cell, so
 * every chunk that asks for it gets an identical result. Each segment is owned by whichever chunk
 * contains its midpoint, the same point-ownership convention BuildingManager uses for buildings, so
 * a town's road network streams in/out correctly regardless of load order even though individual
 * segments can be much longer than a single chunk.
 */
export class RoadManager {
  private readonly townLayoutCache = new Map<string, TownRoadLayout>();
  private readonly activeSegments = new Map<string, THREE.Mesh>();
  private readonly chunkOwnedSegmentIds = new Map<string, string[]>();
  private readonly material: THREE.Material;

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly buildings: BuildingManager,
  ) {
    this.material = new THREE.MeshStandardMaterial({ color: ROAD_COLOR, roughness: 1 });
    gradeMaterial(this.material, 'road');
  }

  static create(scene: THREE.Scene, buildings: BuildingManager): RoadManager {
    return new RoadManager(scene, buildings);
  }

  /** Called by ChunkManager's onChunkLoaded hook. */
  placeForChunk(cx: number, cz: number, originX: number, originZ: number, size: number): void {
    const gxMin = Math.floor((originX - FLAT_ZONE_RADIUS_MAX) / FLAT_ZONE_CELL_SIZE);
    const gxMax = Math.floor((originX + size + FLAT_ZONE_RADIUS_MAX) / FLAT_ZONE_CELL_SIZE);
    const gzMin = Math.floor((originZ - FLAT_ZONE_RADIUS_MAX) / FLAT_ZONE_CELL_SIZE);
    const gzMax = Math.floor((originZ + size + FLAT_ZONE_RADIUS_MAX) / FLAT_ZONE_CELL_SIZE);

    const ownedIds: string[] = [];

    for (let gz = gzMin; gz <= gzMax; gz++) {
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const site = getFlatZoneSite(gx, gz);
        if (!site) continue;

        const layout = this.getTownRoadLayout(gx, gz);
        layout.segments.forEach((segment, index) => {
          const midX = (segment.ax + segment.bx) / 2;
          const midZ = (segment.az + segment.bz) / 2;
          const inThisChunk = midX >= originX && midX < originX + size && midZ >= originZ && midZ < originZ + size;
          if (!inThisChunk) return;

          const id = `${chunkKey(gx, gz)}:${index}`;
          const groundY = sampleHeight(site.siteX, site.siteZ) + ROAD_SURFACE_OFFSET;
          const mesh = this.createSegmentMesh(segment, groundY);
          this.scene.add(mesh);
          this.activeSegments.set(id, mesh);
          ownedIds.push(id);
        });
      }
    }

    this.chunkOwnedSegmentIds.set(chunkKey(cx, cz), ownedIds);
  }

  /** Called by ChunkManager's onChunkUnloaded hook. */
  removeChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const ownedIds = this.chunkOwnedSegmentIds.get(key);
    if (!ownedIds) return;

    for (const id of ownedIds) {
      const mesh = this.activeSegments.get(id);
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this.activeSegments.delete(id);
    }

    this.chunkOwnedSegmentIds.delete(key);
  }

  private getTownRoadLayout(gx: number, gz: number): TownRoadLayout {
    const key = chunkKey(gx, gz);
    const cached = this.townLayoutCache.get(key);
    if (cached) return cached;

    const positions = this.buildings.getTownBuildingPositions(gx, gz) ?? [];
    const edges = computeMinimumSpanningTree(positions);
    const segments: RoadSegment[] = edges.map(([i, j]) => {
      const a = positions[i]!;
      const b = positions[j]!;
      return { ax: a.x, az: a.z, bx: b.x, bz: b.z };
    });

    const layout: TownRoadLayout = { segments };
    this.townLayoutCache.set(key, layout);
    return layout;
  }

  private createSegmentMesh(segment: RoadSegment, groundY: number): THREE.Mesh {
    const dx = segment.bx - segment.ax;
    const dz = segment.bz - segment.az;
    const length = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dz, dx);

    // Bake the "lie flat" rotation into the geometry itself (local X becomes the segment's length
    // axis, local Z its width) so the mesh only needs a single yaw rotation to align with the
    // actual edge direction, rather than composing two Euler rotations on the mesh.
    const geometry = new THREE.PlaneGeometry(length, ROAD_WIDTH);
    geometry.rotateX(-Math.PI / 2);

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.rotation.y = -angle;
    mesh.position.set((segment.ax + segment.bx) / 2, groundY, (segment.az + segment.bz) / 2);
    mesh.receiveShadow = true;
    return mesh;
  }
}
