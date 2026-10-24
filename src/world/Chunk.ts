import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { generateHeightfield, groundWear, sampleHeight } from './TerrainGenerator.ts';
import { shadeTerrain } from './terrainShading.ts';

export interface ChunkOptions {
  originX: number;
  originZ: number;
  size: number;
  resolution: number;
}

export class Chunk {
  readonly mesh: THREE.Mesh;
  private readonly rigidBody: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;

  constructor(physics: PhysicsWorld, material: THREE.Material, options: ChunkOptions) {
    const { originX, originZ, size, resolution } = options;
    const verticesPerSide = resolution + 1;
    const heights = generateHeightfield(resolution, size, originX, originZ);

    this.mesh = new THREE.Mesh(buildGeometry(heights, resolution, size, originX, originZ), material);
    this.mesh.position.set(originX, 0, originZ);
    this.mesh.receiveShadow = true;

    const half = size / 2;
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(originX + half, 0, originZ + half);
    this.rigidBody = physics.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.heightfield(
      resolution,
      resolution,
      toColumnMajor(heights, verticesPerSide),
      { x: size, y: 1, z: size },
    );
    this.collider = physics.world.createCollider(colliderDesc, this.rigidBody);
  }

  dispose(physics: PhysicsWorld): void {
    this.mesh.geometry.dispose();
    physics.unregisterCollider(this.collider);
    physics.world.removeCollider(this.collider, true);
    physics.world.removeRigidBody(this.rigidBody);
  }
}

/** Vertices/UVs are in chunk-local space (0..size); the mesh's own position carries the world offset. */
function buildGeometry(heights: Float32Array, resolution: number, size: number, originX: number, originZ: number): THREE.BufferGeometry {
  const verticesPerSide = resolution + 1;
  const positions = new Float32Array(verticesPerSide * verticesPerSide * 3);
  const uvs = new Float32Array(verticesPerSide * verticesPerSide * 2);
  const surface = new Float32Array(verticesPerSide * verticesPerSide);
  const step = size / resolution;

  for (let row = 0; row < verticesPerSide; row++) {
    for (let col = 0; col < verticesPerSide; col++) {
      const index = row * verticesPerSide + col;
      positions[index * 3] = col * step;
      positions[index * 3 + 1] = heights[index] ?? 0;
      positions[index * 3 + 2] = row * step;

      uvs[index * 2] = col / resolution;
      uvs[index * 2 + 1] = row / resolution;
      surface[index] = groundWear(originX + col * step, originZ + row * step);
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      const a = row * verticesPerSide + col;
      const b = a + 1;
      const c = a + verticesPerSide;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  // aoMap reads uv2, not uv (three.js convention - a separate unwrap for baked lighting/AO,
  // distinct from the tiled material uv) - a duplicate of the same coordinates is fine here since
  // the AO map is meant to tile with the rest of the terrain material, not use a unique unwrap.
  geometry.setAttribute('uv2', new THREE.BufferAttribute(uvs.slice(), 2));
  // How worn the ground is (town pads, tower aprons), which the ground shader turns to gravel.
  geometry.setAttribute('surface', new THREE.BufferAttribute(surface, 1));
  geometry.setIndex(indices);
  // Normals from the terrain's own height function across the chunk border (so neighbouring chunks
  // shade seamlessly, which computeVertexNormals could not), and baked horizon AO in the vertex
  // colour that the ground material multiplies in (see terrainShading.ts).
  const shading = shadeTerrain(sampleHeight, originX, originZ, resolution, size);
  geometry.setAttribute('normal', new THREE.BufferAttribute(shading.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(shading.colors, 3));
  return geometry;
}

/** Rapier heightfield expects heights[row + col * verticesPerSide] (column-major); our source array is row-major. */
function toColumnMajor(heightsRowMajor: Float32Array, verticesPerSide: number): Float32Array {
  const out = new Float32Array(heightsRowMajor.length);
  for (let row = 0; row < verticesPerSide; row++) {
    for (let col = 0; col < verticesPerSide; col++) {
      out[row + col * verticesPerSide] = heightsRowMajor[row * verticesPerSide + col] ?? 0;
    }
  }
  return out;
}
