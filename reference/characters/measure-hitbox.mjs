// Measures a character GLB in the poses the game plays (Idle_Gun, Walk, Run) at its game height,
// for fitting the hit shapes in src/entities/characterHitbox.ts: the head's centre and 95th
// percentile radius, and how far the torso and legs reach from the centre line.
// Needs a copy of the GLB with its textures stripped (three's GLTFLoader cannot decode images in
// Node); `node measure-hitbox.mjs strip <in.glb> <out.glb>` makes one with @gltf-transform.
// Usage: node measure-hitbox.mjs <stripped.glb> <height> [mesh name prefix to leave out, e.g. the rifle]
// Measuring finds three in this repo; the strip step needs @gltf-transform/core installed beside
// the script (it is not a repo dependency). Run 2026-10-23: the SWAT at 1.7 m with `Cube204` (its
// rifle) left out, the spacesuit (which carries no rifle mesh) at 1.8 m.
import { readFileSync } from 'node:fs';

if (process.argv[2] === 'strip') {
  const { NodeIO } = await import('@gltf-transform/core');
  const io = new NodeIO();
  const document = await io.read(process.argv[3]);
  for (const texture of document.getRoot().listTextures()) texture.dispose();
  await io.write(process.argv[4], document);
  process.exit(0);
}

const THREE = await import('three');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
const [file, heightArg, leaveOut] = process.argv.slice(2);
const height = Number(heightArg);
/** Both Quaternius rigs stand 1.852 m in their bind pose (characterModels.ts BIND_HEIGHT). */
const BIND_HEIGHT = 1.852;
const bytes = readFileSync(file);
const gltf = await new Promise((resolve, reject) =>
  new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', resolve, reject),
);
const percentile = (values, fraction) => {
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(fraction * values.length))];
};
for (const clipName of ['Idle_Gun', 'Walk', 'Run']) {
  const model = clone(gltf.scene);
  model.scale.setScalar(height / BIND_HEIGHT);
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(gltf.animations.find((clip) => clip.name === clipName)).play();
  for (const time of [0.05, 0.3, 0.55]) {
    mixer.setTime(time);
    model.updateMatrixWorld(true);
    const points = [];
    const point = new THREE.Vector3();
    model.traverse((object) => {
      if (!object.isMesh || (leaveOut && object.name.startsWith(leaveOut))) return;
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        if (object.isSkinnedMesh) object.getVertexPosition(i, point);
        else point.fromBufferAttribute(positions, i);
        point.applyMatrix4(object.matrixWorld);
        points.push([point.x, point.y, point.z]);
      }
    });
    const top = Math.max(...points.map((p) => p[1]));
    // The head is the top 31 cm at 1.7 m, scaled with height.
    const neck = top - (0.31 * height) / 1.7;
    const head = points.filter((p) => p[1] > neck);
    const centre = head.reduce((sum, p) => sum.map((v, k) => v + p[k] / head.length), [0, 0, 0]);
    const headRadius = percentile(head.map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2])), 0.95);
    const torso = points.filter((p) => p[1] > 0.44 * height && p[1] <= neck);
    const legs = points.filter((p) => p[1] <= 0.44 * height);
    const reach = (list, fraction) => percentile(list.map((p) => Math.hypot(p[0], p[2])), fraction).toFixed(2);
    const torsoForward = torso.reduce((sum, p) => sum + p[2] / torso.length, 0);
    console.log(
      clipName, time,
      'crown', top.toFixed(2),
      'head centre (x,y,z)', centre.map((v) => v.toFixed(2)).join(','),
      'head r95', headRadius.toFixed(2),
      'torso forward', torsoForward.toFixed(2),
      'torso r90/r98', reach(torso, 0.9), reach(torso, 0.98),
      'legs r90', reach(legs, 0.9),
    );
  }
}
