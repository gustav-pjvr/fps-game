import { INK } from '../theme.ts';
import * as THREE from 'three';

// Rendered larger than the 72px slot the old inventory card used, since the card was enlarged to
// 112px so players can actually make out each weapon's shape/details, not just its silhouette.
const THUMBNAIL_SIZE = 192;

/** Every thumbnail rendered so far this session, keyed by weapon id. A weapon's model never
 * changes at runtime, so the lobby's LoadoutScreen (App.ts) and every per-match one (Game.ts builds
 * a fresh one each match) all reuse the first render instead of each re-rendering the whole
 * catalog. Module-level on purpose: it has to outlive any single LoadoutScreen. */
const thumbnailCache = new Map<string, string>();

/** The one offscreen renderer every thumbnail render shares, created on first need and released
 * by releaseThumbnailRenderer once a batch is done. Replaces the old throwaway renderer per
 * thumbnail: seven fresh WebGL contexts per LoadoutScreen, none of them ever actually lost (three's
 * dispose() frees its caches but leaves the context alive until the canvas is garbage collected),
 * which pushed repeated lobby/match cycles toward Chrome's ~16 live-context cap, past which the
 * browser silently kills the oldest context and a canvas goes blank. */
let sharedRenderer: THREE.WebGLRenderer | null = null;

/** The cached thumbnail for `weaponId`, or null if it hasn't been rendered yet this session - lets
 * a caller skip loading the model at all when there's nothing left to render. */
export function getCachedWeaponThumbnail(weaponId: string): string | null {
  return thumbnailCache.get(weaponId) ?? null;
}

/**
 * Renders one static PNG data URL of a weapon model at a flattering 3/4 angle, for the Loadout
 * page's weapon cards, and caches it under `weaponId` (see thumbnailCache). Deliberately a single
 * offscreen render (not a live rotating viewport): there's no reason to hold an extra WebGL context
 * (and its GPU memory) open for the whole session alongside the main game renderer - the shared
 * renderer only lives until the caller's batch finishes (see releaseThumbnailRenderer).
 *
 * Takes any THREE.Object3D, not just a loaded GLTF's scene - the knife has no sourced .glb (see
 * viewModel.ts's createProceduralMeleeViewModel) and needs the exact same thumbnail treatment for
 * its procedurally-built mesh.
 */
export function renderWeaponThumbnail(weaponId: string, source: THREE.Object3D): string {
  const model = source.clone(true);

  // Center the model at the origin and scale it to fill the frame, regardless of each weapon
  // model's own arbitrary export scale/pivot (already known to vary - see viewModel.ts).
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  model.position.sub(center);

  const largestDimension = Math.max(size.x, size.y, size.z) || 1;
  const targetSize = 1.4;
  model.scale.multiplyScalar(targetSize / largestDimension);

  const scene = new THREE.Scene();
  scene.add(model);
  scene.add(new THREE.AmbientLight(INK, 0.7));
  const key = new THREE.DirectionalLight(INK, 1.1);
  key.position.set(1.5, 2, 2);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(1.4, 0.9, 1.6);
  camera.lookAt(0, 0, 0);

  const renderer = getSharedRenderer();
  renderer.render(scene, camera);
  // Read back in the same task as the render (autoClear wipes the previous thumbnail first), so no
  // preserveDrawingBuffer is needed - same as when every thumbnail had its own renderer.
  const dataUrl = renderer.domElement.toDataURL('image/png');
  thumbnailCache.set(weaponId, dataUrl);
  return dataUrl;
}

function getSharedRenderer(): THREE.WebGLRenderer {
  if (!sharedRenderer) {
    sharedRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    sharedRenderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    sharedRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }
  return sharedRenderer;
}

/** Releases the shared renderer once a batch of thumbnails is done (LoadoutScreen.create calls
 * this after its whole catalog resolves). Safe at any moment: every render above runs start to
 * finish synchronously, so there's never one in flight to interrupt, and a later render just
 * lazily creates a fresh renderer. Loses the context explicitly before dispose() for the reason on
 * sharedRenderer.
 *
 * Only the renderer/GL context is released - each rendered `model` was a clone() of the cached
 * GLTF's scene, which shares its geometry/material objects by reference (clone() doesn't
 * deep-clone those). Disposing them here would destroy the assets a real weapon view model still
 * needs during a match. */
export function releaseThumbnailRenderer(): void {
  if (!sharedRenderer) return;
  sharedRenderer.forceContextLoss();
  sharedRenderer.dispose();
  sharedRenderer = null;
}
