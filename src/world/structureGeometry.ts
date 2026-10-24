import * as THREE from 'three';

export function worldBox(width: number, height: number, depth: number, tileMetres: number): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uv = geometry.getAttribute('uv');
  // BoxGeometry stores four vertices per face in +x, -x, +y, -y, +z, -z order.
  const spans = [[depth, height], [depth, height], [width, depth], [width, depth], [width, height], [width, height]];
  spans.forEach(([u, v], face) => {
    for (let vertex = face * 4; vertex < face * 4 + 4; vertex++) {
      uv.setXY(vertex, uv.getX(vertex) * u! / tileMetres, uv.getY(vertex) * v! / tileMetres);
    }
  });
  uv.needsUpdate = true;
  return geometry;
}
