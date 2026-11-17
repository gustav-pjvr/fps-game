import { WeaponPreview, type PreviewView } from '../ui/menu/WeaponPreview.ts';
import { allowedAttachments, isAttachmentId } from '../weapons/models/attachments.ts';
import { resolveSkinId } from '../weapons/models/skins.ts';

/** Dev-only page (weaponlab.html, served by `npm run dev`, never built into the site): one weapon
 * in one skin, for judging a model by eye.
 *   /weaponlab.html?w=rifle&k=service&view=display|hip|aim&spin=0.6&cross=0
 *   &a=laser,torch (or a=all) fits attachments; &pitch=0.3&zoom=1.5 set the rack view's tilt and size. */
const params = new URLSearchParams(location.search);
const weaponId = params.get('w') ?? 'rifle';
const skinId = resolveSkinId(params.get('k'));
const view = (params.get('view') ?? 'display') as PreviewView;

const canvas = document.getElementById('lab') as HTMLCanvasElement;
const preview = new WeaponPreview(canvas);
preview.resize();
const asked = params.get('a') ?? '';
const attachments = asked === 'all' ? allowedAttachments(weaponId) : asked.split(',').filter(isAttachmentId);
preview.show(weaponId, skinId, view, attachments);
// &reload=0.4 poses the in-hand view that far through the reload.
if (params.has('reload')) preview.poseReload(Number(params.get('reload')));
if (params.has('spin')) preview.freeze(Number(params.get('spin')), Number(params.get('pitch') ?? 0), Number(params.get('zoom') ?? 1));
else preview.start();
if (view === 'display' || view === 'held' || params.get('cross') === '0') document.getElementById('cross')!.style.display = 'none';
document.getElementById('label')!.textContent = `${weaponId} | ${skinId} | ${view}`;
window.addEventListener('resize', () => preview.resize());
(window as unknown as { __weaponLab: WeaponPreview }).__weaponLab = preview;
document.body.dataset.ready = '1';
