import { WeaponPreview, type PreviewView } from '../ui/menu/WeaponPreview.ts';
import { resolveSkinId } from '../weapons/models/skins.ts';

/** Dev-only page (weaponlab.html, served by `npm run dev`, never built into the site): one weapon
 * in one skin, for judging a model by eye.
 *   /weaponlab.html?w=rifle&k=service&view=display|hip|aim&spin=0.6&cross=0 */
const params = new URLSearchParams(location.search);
const weaponId = params.get('w') ?? 'rifle';
const skinId = resolveSkinId(params.get('k'));
const view = (params.get('view') ?? 'display') as PreviewView;

const canvas = document.getElementById('lab') as HTMLCanvasElement;
const preview = new WeaponPreview(canvas);
preview.resize();
preview.show(weaponId, skinId, view);
if (params.has('spin')) preview.freeze(Number(params.get('spin')));
else preview.start();
if (view === 'display' || view === 'held' || params.get('cross') === '0') document.getElementById('cross')!.style.display = 'none';
document.getElementById('label')!.textContent = `${weaponId} | ${skinId} | ${view}`;
window.addEventListener('resize', () => preview.resize());
(window as unknown as { __weaponLab: WeaponPreview }).__weaponLab = preview;
document.body.dataset.ready = '1';
