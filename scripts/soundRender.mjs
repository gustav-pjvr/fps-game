// Renders every sound in the game offline, through the game's own SoundEngine, and checks the
// numbers (docs/sound.md, "Evidence"). Nobody on the build side can hear: this measures what can be
// measured (levels, clipping, left and right, how dull a far or walled-off sound is, when it
// arrives) and leaves the judgement of how it sounds to a person on the sound test page.
//
//   npx vite --port 5193 --strictPort        (in another terminal, from this checkout)
//   node scripts/soundRender.mjs [--port 5193] [--wav out-dir] [--json out.json]
//
// Exit code 1 when any check fails. --wav also saves a few renders as WAV files for a listening tool.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const port = flag('--port', '5193');
const wavDir = flag('--wav', null);
const jsonPath = flag('--json', null);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (error) => console.error('page error:', error.message));
await page.goto(`http://localhost:${port}/soundlab.html`);
await page.waitForFunction(() => window.__soundLab !== undefined);

const sounds = await page.evaluate(() => window.__soundLab.sounds);
const measure = (id, options) => page.evaluate(([i, o]) => window.__soundLab.measure(i, o), [id, options]);

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};
const fmt = (value, digits = 3) => (Number.isFinite(value) ? value.toFixed(digits) : String(value));
const rms = (m) => Math.hypot(m.left, m.right);
const rows = [];
const AHEAD_8 = { x: 0, y: 0, z: -8 };
const SILENT = 0.0015;

for (const sound of sounds) {
  const row = { id: sound.id, label: sound.label, group: sound.group };
  if (sound.where !== 'world') {
    const own = await measure(sound.id, { placement: 'own' });
    row.own = own;
    check(own.peak > 0.004, `${sound.id}: the player's own copy is silent (peak ${fmt(own.peak)})`);
    check(own.peak <= 1, `${sound.id}: the player's own copy clips (peak ${fmt(own.peak)})`);
  }
  if (sound.where !== 'own') {
    const near = await measure(sound.id, { placement: 'near' });
    const left = await measure(sound.id, { placement: 'left' });
    const right = await measure(sound.id, { placement: 'right' });
    const far = await measure(sound.id, { placement: 'far' });
    const clear = await measure(sound.id, { at: AHEAD_8 });
    const wall = await measure(sound.id, { placement: 'wall' });
    const glass = await measure(sound.id, { placement: 'glass' });
    const behind = await measure(sound.id, { placement: 'behind', spatial: false });
    const front = await measure(sound.id, { at: { x: 0, y: 0, z: -8 }, spatial: false });
    const leftPlain = await measure(sound.id, { placement: 'left', spatial: false });
    Object.assign(row, { near, left, right, far, clear, wall, glass, behindPlain: behind, frontPlain: front, leftPlain });

    check(near.peak > 0.004, `${sound.id}: silent three metres away (peak ${fmt(near.peak)})`);
    check(near.peak <= 1, `${sound.id}: clips three metres away (peak ${fmt(near.peak)})`);
    // With HRTF a low sound is hardly louder in the nearer ear: it is earlier there instead.
    check(left.left > left.right * 1.15 || left.leftLeadMs > 0.08, `${sound.id}: a source on the left is neither louder nor earlier in the left ear (L ${fmt(left.left, 4)} R ${fmt(left.right, 4)}, left leads by ${fmt(left.leftLeadMs, 2)} ms)`);
    check(right.right > right.left * 1.15 || right.leftLeadMs < -0.08, `${sound.id}: a source on the right is neither louder nor earlier in the right ear (L ${fmt(right.left, 4)} R ${fmt(right.right, 4)}, left leads by ${fmt(right.leftLeadMs, 2)} ms)`);
    check(leftPlain.left > leftPlain.right * 2, `${sound.id}: with 3D audio off, a source on the left is not clearly in the left ear (L ${fmt(leftPlain.left, 4)} R ${fmt(leftPlain.right, 4)})`);
    check(rms(far) < rms(near) * 0.5, `${sound.id}: 120 m away is not much quieter than 3 m (${fmt(rms(far), 4)} against ${fmt(rms(near), 4)})`);
    if (far.peak > SILENT) check(far.brightness < near.brightness * 0.98, `${sound.id}: 120 m away is not duller than 3 m (${fmt(far.brightness)} against ${fmt(near.brightness)})`);
    if (clear.peak > SILENT) {
      check(rms(wall) < rms(clear) * 0.6, `${sound.id}: behind a wall is not much quieter than in the open (${fmt(rms(wall), 4)} against ${fmt(rms(clear), 4)})`);
      check(wall.brightness < clear.brightness, `${sound.id}: behind a wall is not duller than in the open (${fmt(wall.brightness)} against ${fmt(clear.brightness)})`);
      check(rms(glass) < rms(clear) && rms(glass) > rms(wall), `${sound.id}: through a window is not between open and walled (${fmt(rms(wall), 4)} < ${fmt(rms(glass), 4)} < ${fmt(rms(clear), 4)} expected)`);
      // A sound with no highs to lose (a body thud) cannot get duller: it is not asked to.
      if (front.brightness > 0.05) check(behind.brightness < front.brightness * 0.99, `${sound.id}: with 3D audio off, behind is not duller than in front (${fmt(behind.brightness)} against ${fmt(front.brightness)})`);
    }
  }
  rows.push(row);
  process.stdout.write('.');
}
process.stdout.write('\n');

// Front, behind and above with HRTF: the three must differ from each other (the ear's own filter).
const hrtf = {};
for (const [name, at] of [['front', { x: 0, y: 0, z: -8 }], ['behind', { x: 0, y: 0, z: 8 }], ['above', { x: 0, y: 8, z: 0 }], ['below', { x: 0, y: -8, z: 0 }]]) {
  hrtf[name] = await measure('gunshot:rifle', { at, spatial: true });
}
// The same shot from the same noise, rendered in two places at the same distance: how unlike the
// two signals are (0 identical). With HRTF, behind, above and below must each differ from in front.
const differ = (a, b, spatial) => page.evaluate(([x, y, s]) => window.__soundLab.difference('gunshot:rifle', { at: x, spatial: s }, { at: y, spatial: s }), [a, b, spatial]);
const FRONT = { x: 0, y: 0, z: -8 }, BEHIND = { x: 0, y: 0, z: 8 }, ABOVE = { x: 0, y: 8, z: 0 }, BELOW = { x: 0, y: -8, z: 0 };
hrtf.differs = {
  same: await differ(FRONT, FRONT, true),
  behind: await differ(FRONT, BEHIND, true),
  above: await differ(FRONT, ABOVE, true),
  below: await differ(FRONT, BELOW, true),
  aboveBelow: await differ(ABOVE, BELOW, true),
  behindPlain: await differ(FRONT, BEHIND, false),
};
check(hrtf.differs.same < 0.001, `Two renders of the same shot in the same place differ (${fmt(hrtf.differs.same)}): the comparison is not sound`);
check(hrtf.differs.behind > 0.2, `HRTF: a rifle behind is the same signal as in front (difference ${fmt(hrtf.differs.behind)})`);
check(hrtf.differs.above > 0.1, `HRTF: a rifle above is the same signal as in front (difference ${fmt(hrtf.differs.above)})`);
check(hrtf.differs.below > 0.1, `HRTF: a rifle below is the same signal as in front (difference ${fmt(hrtf.differs.below)})`);
check(hrtf.differs.aboveBelow > 0.1, `HRTF: a rifle above is the same signal as below (difference ${fmt(hrtf.differs.aboveBelow)})`);
check(hrtf.differs.behindPlain > 0.05, `3D audio off: a rifle behind is the same signal as in front (difference ${fmt(hrtf.differs.behindPlain)})`);

// A far shot arrives late: 120 m is (120 - 20) / 343 = 0.29 s.
const farShot = rows.find((row) => row.id === 'gunshot:rifle').far;
check(farShot.onset > 0.25 && farShot.onset < 0.36, `A rifle at 120 m should arrive about 0.29 s late, arrived at ${fmt(farShot.onset)}`);

// What fired it: no two guns' own reports may measure the same.
const guns = rows.filter((row) => row.id.startsWith('gunshot:') && row.own);
for (let a = 0; a < guns.length; a++) {
  for (let b = a + 1; b < guns.length; b++) {
    const same = Math.abs(guns[a].own.brightness - guns[b].own.brightness) / guns[a].own.brightness < 0.02
      && Math.abs(guns[a].own.rmsDb - guns[b].own.rmsDb) < 0.3;
    check(!same, `${guns[a].id} and ${guns[b].id} measure the same (brightness and level)`);
  }
}

// The limiter: a firefight in one render must not clip. Night mode: quiet comes up, loud comes down.
const firefight = ['gunshot:sniper', 'gunshot:shotgun', 'gunshot:lmg', 'gunshot:battleRifle', 'gunshot:revolver', 'frag', 'explosion', 'glassBreak', 'gunshot:enemy-rifle'];
const stack = await page.evaluate((ids) => window.__soundLab.stack(ids), firefight);
check(stack.peak <= 1, `A firefight clips: peak ${fmt(stack.peak)}`);
const quietFull = await measure('step:earth:run', { at: { x: 0, y: 0, z: -10 } });
const quietNight = await measure('step:earth:run', { at: { x: 0, y: 0, z: -10 }, night: true });
const stackNight = await page.evaluate((ids) => window.__soundLab.stack(ids, true), firefight);
check(rms(quietNight) > rms(quietFull) * 1.5, `Night mode does not bring a quiet footstep up (${fmt(rms(quietNight), 5)} against ${fmt(rms(quietFull), 5)})`);
check(stackNight.peak <= 1, `A firefight in night mode clips: peak ${fmt(stackNight.peak)}`);
const nightRange = rms(stackNight) / rms(quietNight), fullRange = rms(stack) / rms(quietFull);
check(nightRange < fullRange * 0.7, `Night mode does not narrow the range between loud and quiet (${fmt(nightRange, 1)} against ${fmt(fullRange, 1)})`);

// Inside a house the same shot rings shorter than outdoors: less energy late in the render.
const roomShot = await measure('gunshot:rifle', { placement: 'own', space: 'room' });
const openShot = await measure('gunshot:rifle', { placement: 'own', space: 'outdoor' });
const hallShot = await measure('gunshot:rifle', { placement: 'own', space: 'hall' });
check(roomShot.tailDb < openShot.tailDb - 6, `A shot in a house does not ring shorter than outdoors (tail ${fmt(roomShot.tailDb, 1)} dB against ${fmt(openShot.tailDb, 1)} dB)`);
check(hallShot.tailDb < openShot.tailDb && hallShot.tailDb > roomShot.tailDb, `The Facility's ring is not between a house's and the valley's (tails ${fmt(roomShot.tailDb, 1)}, ${fmt(hallShot.tailDb, 1)}, ${fmt(openShot.tailDb, 1)} dB)`);

const summary = { stack, stackNight, quietFull, quietNight, hrtf, roomShot, hallShot, openShot, farShotOnset: farShot.onset };
console.log(`\n${rows.length} sounds measured.`);
console.log(`Firefight peak ${fmt(stack.peak)} (night ${fmt(stackNight.peak)}); footstep at 10 m rms ${fmt(rms(quietFull), 5)} (night ${fmt(rms(quietNight), 5)}).`);
console.log(`Rifle with HRTF, brightness: front ${fmt(hrtf.front.brightness)}, behind ${fmt(hrtf.behind.brightness)}, above ${fmt(hrtf.above.brightness)}, below ${fmt(hrtf.below.brightness)}.`);
console.log(`Rifle with HRTF, how unlike in front (0 the same): behind ${fmt(hrtf.differs.behind, 2)}, above ${fmt(hrtf.differs.above, 2)}, below ${fmt(hrtf.differs.below, 2)}; above against below ${fmt(hrtf.differs.aboveBelow, 2)}; 3D audio off, behind ${fmt(hrtf.differs.behindPlain, 2)}.`);
console.log(`Rifle own, ring 0.4 s after the shot: in a house ${fmt(roomShot.tailDb, 1)} dB, Facility ${fmt(hallShot.tailDb, 1)} dB, outdoors ${fmt(openShot.tailDb, 1)} dB. Far rifle arrives after ${fmt(farShot.onset, 2)} s.`);
console.log('\nid'.padEnd(26) + 'own pk  near pk  near dB  far dB   wall dB  glass dB  L/R, lead (left)  bright near>far');
for (const row of rows) {
  const db = (m) => (m ? fmt(m.rmsDb, 1).padStart(7) : '      -');
  const pk = (m) => (m ? fmt(m.peak, 2).padStart(6) : '     -');
  const balance = row.left ? `${fmt(row.left.left / Math.max(1e-9, row.left.right), 1)}/${fmt(row.left.leftLeadMs, 2)}ms`.padStart(11) : '          -';
  const bright = row.near ? `${fmt(row.near.brightness, 2)} > ${fmt(row.far.brightness, 2)}` : '';
  console.log(row.id.padEnd(25) + pk(row.own) + '  ' + pk(row.near) + '  ' + db(row.near) + '  ' + db(row.far) + '  ' + db(row.wall) + '  ' + db(row.glass) + '   ' + balance + '   ' + bright);
}

if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ rows, summary, failures }, null, 1));
if (wavDir) {
  mkdirSync(wavDir, { recursive: true });
  const save = async (name, id, options) => {
    const base64 = await page.evaluate(([i, o]) => window.__soundLab.wav(i, o), [id, options]);
    writeFileSync(join(wavDir, `${name}.wav`), Buffer.from(base64, 'base64'));
  };
  for (const [name, id, options] of [
    ['rifle-own', 'gunshot:rifle', { placement: 'own' }],
    ['rifle-near', 'gunshot:rifle', { placement: 'near' }],
    ['rifle-far', 'gunshot:rifle', { placement: 'far' }],
    ['rifle-wall', 'gunshot:rifle', { placement: 'wall' }],
    ['rifle-left', 'gunshot:rifle', { placement: 'left' }],
    ['rifle-behind', 'gunshot:rifle', { placement: 'behind' }],
    ['sniper-own', 'gunshot:sniper', { placement: 'own' }],
    ['shotgun-own', 'gunshot:shotgun', { placement: 'own' }],
    ['pistol-own', 'gunshot:pistol', { placement: 'own' }],
    ['glass-hit', 'glassHit', { placement: 'near' }],
    ['glass-break', 'glassBreak', { placement: 'near' }],
    ['frag-near', 'frag', { placement: 'near' }],
    ['step-wood', 'step:wood:run', { placement: 'own' }],
    ['step-earth', 'step:earth:run', { placement: 'own' }],
    ['impact-metal', 'impact:metal', { placement: 'near' }],
  ]) await save(name, id, options);
  console.log(`WAV files written to ${wavDir}`);
}

await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.error('  ' + failure);
  process.exit(1);
}
console.log('\nAll checks passed.');
