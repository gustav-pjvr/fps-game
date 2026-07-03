import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

/** Loads a .glb once per path and caches the promise - callers clone gltf.scene per instance. */
export function loadGLTF(path: string): Promise<GLTF> {
  let pending = cache.get(path);
  if (!pending) {
    pending = loader.loadAsync(path);
    cache.set(path, pending);
  }
  return pending;
}

export async function preloadGLTFs(paths: string[]): Promise<Map<string, GLTF>> {
  const entries = await Promise.all(paths.map(async (path) => [path, await loadGLTF(path)] as const));
  return new Map(entries);
}
