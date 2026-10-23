// Packs the Quaternius Ultimate Modular Men glTF characters (CC0) into GLBs for the game: keeps
// only the clips the game plays, prunes what they leave unused, and prints the bind-pose bounds.
// Usage: node pack-characters.mjs <in.gltf> <out.glb>
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, getBounds } from '@gltf-transform/functions';

const KEEP = new Set(['Idle_Gun', 'Idle_Gun_Pointing', 'Gun_Shoot', 'Idle_Gun_Shoot', 'Walk', 'Run', 'Run_Shoot', 'HitRecieve', 'Death', 'Idle']);
const [input, output] = process.argv.slice(2);
const io = new NodeIO();
const document = await io.read(input);
const root = document.getRoot();
for (const animation of root.listAnimations()) {
  if (!KEEP.has(animation.getName())) animation.dispose();
}
await document.transform(prune(), dedup());
const bounds = getBounds(root.listScenes()[0]);
await io.write(output, document);
console.log(output, 'clips', root.listAnimations().map((a) => a.getName()).join(','), 'bounds', JSON.stringify(bounds));
