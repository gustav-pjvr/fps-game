import { createButton, MOTION_EASE } from './menuStyles.ts';
import { ACCENT, HAIRLINE, INK, INK_DIM, LABEL_CSS, MONO_FONT, SANS_FONT, TEXT_SHADOW, VOID } from '../theme.ts';
import { DEFAULT_ENEMY_COUNT, DEFAULT_TARGET_COUNT } from '../../core/config.ts';
import { GAME_VERSION } from '../../core/version.ts';
import { getWorldSeed } from '../../core/worldSeed.ts';
import { setDeviceHint } from '../../input/GamepadInput.ts';
import { lookFor } from '../../render/look.ts';

export interface MainMenuCallbacks {
  onPlay: () => void;
  onMultiplayer: () => void;
  onSettings: () => void;
  onLoadout: () => void;
}

/** Compass bearing (0 = north, clockwise) of the dusk sun, the same number the in-match compass
 * marks (docs/visual-overhaul-ui.md, "The sun is a bearing"). World north is -Z, east +X. */
function sunBearingDegrees(): number {
  const sun = lookFor('day').sunDirection;
  return Math.round((((Math.atan2(sun.x, -sun.z) * 180) / Math.PI) % 360) + 360) % 360;
}

/**
 * The title screen's chrome (docs/visual-overhaul-ui.md, "Menus"): left-aligned over the drifting
 * valley in LobbyScene.ts, like a caption rather than a box. A scrim darkens only the left side, the
 * tower stays clear in the right third of the frame. The label line reads the actual valley seed
 * and the sun's bearing, so it states something true about the match about to be played.
 */
export class MainMenu {
  private readonly element: HTMLDivElement;
  private readonly seedLabel: HTMLSpanElement;

  constructor(root: HTMLElement, callbacks: MainMenuCallbacks) {
    this.element = document.createElement('div');
    this.element.style.cssText =
      'position:absolute; inset:0; display:none; pointer-events:none; z-index:15;' +
      ` background:linear-gradient(90deg, ${VOID}e6 0%, ${VOID}b8 30%, ${VOID}26 62%, transparent 80%);` +
      ` color:${INK}; font-family:${SANS_FONT}; text-shadow:${TEXT_SHADOW};`;

    const column = document.createElement('div');
    column.style.cssText =
      'position:absolute; left:clamp(24px, 7vw, 120px); top:50%; transform:translateY(-54%);' +
      ' max-width:min(640px, calc(100vw - 48px)); display:flex; flex-direction:column; align-items:flex-start;' +
      ` animation:menuRise 0.6s ${MOTION_EASE} both;`;

    const labelLine = document.createElement('div');
    labelLine.style.cssText = `${LABEL_CSS} display:flex; align-items:center; gap:12px; color:${ACCENT};`;
    const dot = document.createElement('span');
    dot.style.cssText = `width:6px; height:6px; border-radius:50%; background:${ACCENT};`;
    this.seedLabel = document.createElement('span');
    const divider = document.createElement('span');
    divider.textContent = '/';
    divider.style.color = INK_DIM;
    const sunLabel = document.createElement('span');
    sunLabel.textContent = `SUN ${String(sunBearingDegrees()).padStart(3, '0')}°`;
    labelLine.append(dot, this.seedLabel, divider, sunLabel);

    const title = document.createElement('h1');
    title.style.cssText =
      'margin:22px 0 18px; font-size:clamp(52px, 7.4vw, 116px); line-height:0.92; letter-spacing:-0.045em;' +
      ' font-weight:300; text-wrap:balance;';
    const hunter = document.createElement('span');
    hunter.textContent = 'HUNTER ';
    const goose = document.createElement('span');
    goose.textContent = "'N GOOSE";
    goose.style.fontWeight = '700';
    title.append(hunter, goose);

    const tagline = document.createElement('p');
    tagline.textContent = 'Last light over the valley.';
    tagline.style.cssText = 'margin:0; font-size:clamp(16px, 1.4vw, 21px); font-weight:300; line-height:1.5; letter-spacing:0.01em; color:#c7d4ce;';

    const rule = document.createElement('div');
    rule.style.cssText = `width:32px; height:1px; background:${ACCENT}; margin:26px 0 26px;`;

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; flex-direction:column; gap:10px; width:288px; max-width:100%; pointer-events:auto;';
    const playButton = createButton('PLAY', 'primary');
    playButton.addEventListener('click', callbacks.onPlay);
    const multiplayerButton = createButton('MULTIPLAYER');
    multiplayerButton.addEventListener('click', callbacks.onMultiplayer);
    const loadoutButton = createButton('LOADOUT');
    loadoutButton.addEventListener('click', callbacks.onLoadout);
    const settingsButton = createButton('SETTINGS');
    settingsButton.addEventListener('click', callbacks.onSettings);
    actions.append(playButton, multiplayerButton, loadoutButton, settingsButton);

    const hints = document.createElement('div');
    hints.style.cssText = `display:flex; flex-wrap:wrap; gap:16px; margin-top:22px; ${LABEL_CSS} font-size:9.5px; letter-spacing:0.12em;`;
    for (const [key, action] of [['WASD', 'MOVE'], ['MOUSE', 'AIM / FIRE'], ['SHIFT', 'SPRINT'], ['R', 'RELOAD']] as const) {
      const hint = document.createElement('span');
      const kbd = document.createElement('kbd');
      setDeviceHint(kbd, key, { WASD: 'Left stick', MOUSE: 'LT / RT (L2 / R2)', SHIFT: 'L3', R: 'X (Square)' }[key]);
      kbd.style.cssText =
        `font-family:${MONO_FONT}; font-size:9px; font-weight:400; letter-spacing:0.04em; color:${INK};` +
        ` border:1px solid ${HAIRLINE}; border-radius:2px; padding:3px 5px; margin-right:6px;`;
      hint.append(kbd, action);
      hints.appendChild(hint);
    }

    column.append(labelLine, title, tagline, rule, actions, hints);
    this.element.appendChild(column);

    // Footer: the real deployment a quick PLAY starts with (editable in PlaySetupModal), and the
    // version (see docs/CHANGELOG.md).
    const footer = document.createElement('div');
    footer.style.cssText =
      'position:absolute; left:clamp(24px, 7vw, 120px); right:clamp(24px, 4vw, 64px); bottom:24px; display:flex;' +
      ` justify-content:space-between; gap:16px; padding-top:14px; border-top:1px solid ${HAIRLINE}; ${LABEL_CSS} font-size:9.5px;`;
    const deployment = document.createElement('span');
    deployment.textContent = `DEFAULT MATCH  ${DEFAULT_ENEMY_COUNT} HOSTILES / ${DEFAULT_TARGET_COUNT} TARGETS`;
    const version = document.createElement('span');
    version.textContent = `v${GAME_VERSION}`;
    version.style.cssText = `font-family:${MONO_FONT}; letter-spacing:0.08em; text-transform:none;`;
    footer.append(deployment, version);
    this.element.appendChild(footer);

    ensureMenuKeyframes();
    root.appendChild(this.element);
  }

  show(): void {
    // The seed can change between visits (each match picks a new valley), so it is read on show.
    this.seedLabel.textContent = `VALLEY ${String(getWorldSeed() % 10000).padStart(4, '0')}`;
    this.element.style.display = 'block';
  }

  hide(): void {
    this.element.style.display = 'none';
  }

  dispose(): void {
    this.element.remove();
  }
}

let keyframesInjected = false;
function ensureMenuKeyframes(): void {
  if (keyframesInjected) return;
  keyframesInjected = true;
  const style = document.createElement('style');
  style.textContent = '@keyframes menuRise { from { opacity: 0; transform: translateY(calc(-54% + 10px)); } to { opacity: 1; transform: translateY(-54%); } }';
  document.head.appendChild(style);
}
