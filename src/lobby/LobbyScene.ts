import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { SPAWN_X, SPAWN_Z, TERRAIN_CHUNK_SIZE } from '../core/config.ts';
import { loadGLTF } from '../core/AssetLoader.ts';
import { getWorldSeed } from '../core/worldSeed.ts';
import { lookFor } from '../render/look.ts';
import { installLookFog, StylizedSky } from '../render/StylizedSky.ts';
import { PostStack } from '../render/PostStack.ts';
import { GRAPHICS_QUALITY_PRESETS } from '../settings/graphicsQuality.ts';
import { Settings } from '../settings/Settings.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import { createGroundMaterial } from '../world/ChunkManager.ts';
import { createDecorativeTowerVisual, getWatchTowerPositions } from '../world/WatchTowerManager.ts';
import { extractBakedPrimitives, VEGETATION_TYPES, type VegetationTypeId } from '../world/VegetationManager.ts';
import { mulberry32 } from '../utils/rng.ts';

/** Half-width of the terrain patch around the tower. Wide enough that the patch edge sits inside
 * the fog (FOG_FAR below) from anywhere on the drift path. */
const PATCH_HALF_SIZE = 420;
const PATCH_SEGMENTS = 210;
/** The title screen hazes out sooner than a match, so the patch edge never shows. */
const FOG_FAR = 300;
const DRIFT_RADIUS = 54;
const DRIFT_HEIGHT = 11;
/** Seconds per full circle around the tower: slow enough to read as drifting, not orbiting. */
const DRIFT_PERIOD_SECONDS = 240;
/** The camera aims this far to the tower's left, so the tower sits in the right third of the frame
 * and the left stays clear for the menu (see MainMenu.ts). */
const AIM_OFFSET_LEFT = 11;
const CLEAR_RADIUS_AROUND_TOWER = 12;

const SCATTER: { type: VegetationTypeId; attempts: number; radius: number; density: number }[] = [
  { type: 'treeDefault', attempts: 900, radius: 170, density: -0.15 },
  { type: 'treePine', attempts: 700, radius: 170, density: 0.05 },
  { type: 'bush', attempts: 260, radius: 90, density: -0.3 },
  { type: 'rock', attempts: 90, radius: 80, density: -1 },
];

/** The title screen (docs/visual-overhaul-ui.md, "The valley is the menu"): a real slice of the
 * current world seed's valley around its first watch tower, under the match's dusk look, drifting
 * slowly past. After a match the seed is that match's, so the title shows the valley just played.
 * No physics or streaming: one terrain patch from the same height function, instanced vegetation
 * from the same models and grades, the tower's own visual. Owns its own WebGL context, disposed
 * once a match starts so the gameplay Renderer can take over. */
export class LobbyScene {
  private readonly webgl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sky: StylizedSky;
  private readonly post: PostStack | null;
  private readonly timer = new THREE.Timer();
  private readonly towerCenter: THREE.Vector3;
  private readonly startAngle: number;
  private readonly driftSpeed: number;
  private readonly disposables: { dispose(): void }[] = [];
  private environment: THREE.Texture | null = null;
  private elapsed = 0;
  private frameHandle = 0;

  private constructor(container: HTMLElement) {
    const quality = GRAPHICS_QUALITY_PRESETS[Settings.getGraphicsQuality()];
    const look = lookFor('day');
    installLookFog(look);

    this.webgl = new THREE.WebGLRenderer({ antialias: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    this.webgl.shadowMap.enabled = quality.shadowsEnabled;
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    // The scene never changes, so the shadow map is drawn once after loading (see create()).
    this.webgl.shadowMap.autoUpdate = false;
    this.webgl.toneMapping = quality.postProcessing ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = look.exposure;
    container.appendChild(this.webgl.domElement);

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 2000);
    this.sky = new StylizedSky(look);
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(look.sky.haze, look.fog.near, FOG_FAR);

    const fill = new THREE.HemisphereLight(look.hemiSkyColor, look.hemiGroundColor, quality.environmentLighting ? 0 : look.hemiIntensity);
    this.scene.add(fill);

    const tower = getWatchTowerPositions()[0] ?? { x: SPAWN_X + 70, z: SPAWN_Z };
    this.towerCenter = new THREE.Vector3(tower.x, sampleHeight(tower.x, tower.z), tower.z);

    const sun = new THREE.DirectionalLight(look.sunColor, look.sunIntensity);
    sun.position.copy(this.towerCenter).addScaledVector(look.sunDirection, 120);
    sun.target.position.copy(this.towerCenter);
    sun.castShadow = quality.shadowsEnabled;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const extent = 80;
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 260 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.06;
    this.scene.add(sun, sun.target);

    if (quality.environmentLighting) {
      const envScene = new THREE.Scene();
      const envSky = new StylizedSky(look);
      envScene.add(envSky);
      const pmrem = new THREE.PMREMGenerator(this.webgl);
      this.environment = pmrem.fromScene(envScene, 0, 0.1, 2000).texture;
      pmrem.dispose();
      envSky.geometry.dispose();
      envSky.material.dispose();
      this.scene.environment = this.environment;
      this.scene.environmentIntensity = look.environmentIntensity;
    }

    this.post = quality.postProcessing
      ? new PostStack(this.webgl, this.scene, this.camera, null, look, { ambientOcclusion: quality.ambientOcclusion })
      : null;
    this.post?.setSize(window.innerWidth, window.innerHeight);

    // Start beside the sun so the opening frame is side-lit, and drift toward it.
    this.startAngle = Math.atan2(look.sunDirection.z, look.sunDirection.x) + Math.PI * 0.55;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.driftSpeed = ((2 * Math.PI) / DRIFT_PERIOD_SECONDS) * (reducedMotion ? 0.15 : 1);
    this.placeCamera();

    window.addEventListener('resize', this.onResize);
  }

  static async create(container: HTMLElement): Promise<LobbyScene> {
    const lobby = new LobbyScene(container);
    lobby.buildTerrain();
    lobby.buildTower();
    await lobby.buildVegetation();
    lobby.webgl.shadowMap.needsUpdate = true;
    return lobby;
  }

  private buildTerrain(): void {
    const size = PATCH_HALF_SIZE * 2;
    const geometry = new THREE.PlaneGeometry(size, size, PATCH_SEGMENTS, PATCH_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i) + this.towerCenter.x;
      const z = position.getZ(i) + this.towerCenter.z;
      position.setXYZ(i, x, sampleHeight(x, z), z);
      // The ground textures repeat GROUND_TEXTURE_REPEAT times per chunk (see ChunkManager), so a
      // UV of one chunk length gives the same texel density as in a match.
      uv.setXY(i, x / TERRAIN_CHUNK_SIZE, z / TERRAIN_CHUNK_SIZE);
    }
    geometry.computeVertexNormals();
    // The ground material multiplies in baked AO from the vertex colour (terrainShading.ts). The
    // patch is one big mesh rather than chunks, so its AO is approximated here from the same
    // horizon idea at the patch's own spacing.
    geometry.setAttribute('color', new THREE.BufferAttribute(patchAo(position), 3));
    const material = createGroundMaterial();
    const ground = new THREE.Mesh(geometry, material);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.disposables.push(geometry, material);
  }

  private buildTower(): void {
    const tower = createDecorativeTowerVisual();
    tower.position.copy(this.towerCenter);
    tower.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    this.scene.add(tower);
  }

  private async buildVegetation(): Promise<void> {
    const rng = mulberry32(getWorldSeed() + 7919);
    const density = createNoise2D(mulberry32(getWorldSeed() + 2));
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3();
    const point = new THREE.Vector3();

    for (const scatter of SCATTER) {
      const def = VEGETATION_TYPES.find((type) => type.id === scatter.type);
      if (!def) continue;
      const gltf = await loadGLTF(def.modelPath);
      const primitives = extractBakedPrimitives(gltf.scene.clone());
      const rawHeight = (primitives[0]?.geometry.userData.rawHeight as number | undefined) ?? def.targetHeight;
      const baseScale = def.targetHeight / rawHeight;

      const matrices: THREE.Matrix4[] = [];
      for (let i = 0; i < scatter.attempts; i++) {
        const angle = rng() * Math.PI * 2;
        const distance = CLEAR_RADIUS_AROUND_TOWER + Math.sqrt(rng()) * scatter.radius;
        const x = this.towerCenter.x + Math.cos(angle) * distance;
        const z = this.towerCenter.z + Math.sin(angle) * distance;
        if (density(x * 0.012, z * 0.012) < scatter.density) continue;
        point.set(x, sampleHeight(x, z), z);
        rotation.setFromAxisAngle(up, rng() * Math.PI * 2);
        scale.setScalar(baseScale * (0.8 + rng() * 0.45));
        matrices.push(matrix.compose(point, rotation, scale).clone());
      }

      for (const { geometry, material } of primitives) {
        const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
        matrices.forEach((m, index) => mesh.setMatrixAt(index, m));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.disposables.push(geometry);
      }
    }
  }

  private placeCamera(): void {
    const angle = this.startAngle + this.elapsed * this.driftSpeed;
    const x = this.towerCenter.x + Math.cos(angle) * DRIFT_RADIUS;
    const z = this.towerCenter.z + Math.sin(angle) * DRIFT_RADIUS;
    const ground = Math.max(sampleHeight(x, z), this.towerCenter.y);
    this.camera.position.set(x, ground + DRIFT_HEIGHT, z);

    const toTowerX = this.towerCenter.x - x;
    const toTowerZ = this.towerCenter.z - z;
    const length = Math.hypot(toTowerX, toTowerZ) || 1;
    // Right of the view direction is (-dz, dx); aiming left of the tower pushes it right in frame.
    const rightX = -toTowerZ / length;
    const rightZ = toTowerX / length;
    this.camera.lookAt(this.towerCenter.x - rightX * AIM_OFFSET_LEFT, this.towerCenter.y + 7, this.towerCenter.z - rightZ * AIM_OFFSET_LEFT);
    this.sky.follow(this.camera);
  }

  start(): void {
    const tick = (time: number): void => {
      this.timer.update(time);
      this.elapsed += Math.min(this.timer.getDelta(), 0.1);
      this.placeCamera();
      if (this.post) this.post.render();
      else this.webgl.render(this.scene, this.camera);
      this.frameHandle = requestAnimationFrame(tick);
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('resize', this.onResize);
    this.post?.dispose();
    this.environment?.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    for (const item of this.disposables) item.dispose();
    // Explicit context loss before dispose (after the last frame: the rAF loop was just cancelled
    // above) - see Renderer.dispose's comment. The lobby is rebuilt on every return from a match, so
    // an un-lost context here leaks one live context per lobby/match cycle.
    this.webgl.forceContextLoss();
    this.webgl.dispose();
    this.webgl.domElement.remove();
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    this.post?.setSize(window.innerWidth, window.innerHeight);
  };
}

/** Grey AO per vertex of the title patch, from how far the neighbouring vertices rise above each
 * one (the patch's own grid, PATCH_SEGMENTS + 1 per side). Coarser than a match chunk's, which is
 * fine at title-screen distances. */
function patchAo(position: THREE.BufferAttribute): Float32Array {
  const side = PATCH_SEGMENTS + 1;
  const spacing = (PATCH_HALF_SIZE * 2) / PATCH_SEGMENTS;
  const colors = new Float32Array(position.count * 3);
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const index = row * side + col;
      const h = position.getY(index);
      let occlusion = 0;
      let samples = 0;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-2, -2], [2, 2], [-2, 2], [2, -2]] as const) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || c < 0 || r >= side || c >= side) continue;
        const rise = position.getY(r * side + c) - h;
        occlusion += Math.atan(Math.max(0, rise) / (Math.hypot(dr, dc) * spacing)) / (Math.PI / 2);
        samples++;
      }
      const ao = Math.max(0.4, 1 - 0.75 * Math.sqrt(occlusion / Math.max(samples, 1)));
      colors.fill(ao, index * 3, index * 3 + 3);
    }
  }
  return colors;
}
