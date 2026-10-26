import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AmmoDropManager } from './AmmoDropManager.ts';

describe('AmmoDropManager.listForSync', () => {
  it('lists every live crate for a late joiner and leaves out collected ones', () => {
    const manager = new AmmoDropManager(new THREE.Scene(), {});
    manager.applyRemoteSpawn('a1', 1, 2, 3);
    manager.applyRemoteSpawn('a2', 4, 5, 6);
    manager.removeById('a1');
    expect(manager.listForSync()).toEqual([{ id: 'a2', x: 4, y: 5, z: 6 }]);
  });
});
