import * as THREE from 'three';

// Rendered larger than the 72px slot the old inventory card used, since the card was enlarged to
// 112px so players can actually make out each weapon's shape/details, not just its silhouette.
const THUMBNAIL_SIZE = 192;

/**
 * Renders one static PNG data URL of a weapon model at a flattering 3/4 angle, for the inventory
 * panel's read-only showcase. Deliberately a single offscreen render (not a live rotating
 * viewport): the inventory is a rarely-shown menu, so there's no reason to hold a second WebGL
 * context (and its GPU memory) open for the whole session alongside the main game renderer -
 * render once, extract the bitmap, then dispose the renderer immediately.
 *
 * Takes any THREE.Object3D, not just a loaded GLTF's scene - the knife has no sourced .glb (see
 * viewModel.ts's createProceduralMeleeViewModel) and needs the exact same thumbnail treatment for
 * its procedurally-built mesh.
 */
export function renderWeaponThumbnail(source: THREE.Object3D): string {
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
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(1.5, 2, 2);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(1.4, 0.9, 1.6);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.render(scene, camera);

  const dataUrl = renderer.domElement.toDataURL('image/png');

  // Only dispose the renderer/GL context - `model` is a clone() of the cached GLTF's scene, which
  // shares its geometry/material objects by reference (clone() doesn't deep-clone those). Disposing
  // them here would destroy the assets a real weapon view model still needs during a match.
  renderer.dispose();

  return dataUrl;
}
