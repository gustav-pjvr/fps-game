import { createButton, createCornerBracket, createEyebrow, ACCENT, BODY_FONT, DISPLAY_FONT, MOTION_EASE } from './menuStyles.ts';
import { DEFAULT_ENEMY_COUNT, DEFAULT_TARGET_COUNT } from '../../core/config.ts';
import { GAME_VERSION } from '../../core/version.ts';

export interface MainMenuCallbacks {
  onPlay: () => void;
  onMultiplayer: () => void;
  onSettings: () => void;
  onLoadout: () => void;
}

/**
 * Lobby's persistent chrome (WORLD_PLAN.md follow-up: lobby redesign, grounded in shipped tactical
 * shooter lobbies - Valorant, Apex Legends, CS2 - rather than a generic dark web-app overlay).
 * Deliberately asymmetric: the character render (LobbyScene.ts) sits left-of-center, so the title
 * lives top-left near it, a real deployment-data readout anchors bottom-left, and the action rail
 * stays bottom-right where a player's eye already expects a primary CTA.
 */
export class MainMenu {
  private readonly element: HTMLDivElement;

  constructor(root: HTMLElement, callbacks: MainMenuCallbacks) {
    this.element = document.createElement('div');
    this.element.style.cssText = 'position:absolute; inset:0; display:none; pointer-events:none; z-index:15;';

    // Staggered, not simultaneous - reads as a HUD calibrating corner by corner rather than all
    // four popping in at once.
    ['top-left', 'top-right', 'bottom-left', 'bottom-right'].forEach((corner, i) => {
      this.element.appendChild(createCornerBracket(corner as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right', i * 60));
    });

    const titleBlock = document.createElement('div');
    titleBlock.style.cssText = 'position:absolute; top:52px; left:56px; pointer-events:none;';

    const eyebrow = createEyebrow('BROWSER TACTICAL OPS');
    eyebrow.style.marginBottom = '10px';

    const title = document.createElement('div');
    title.textContent = "HUNTER 'N GOOSE";
    title.style.cssText =
      `font-family:${DISPLAY_FONT}; font-size:2.4rem; font-weight:700; letter-spacing:0.1em;` +
      ` color:#fff; text-shadow:0 2px 20px rgba(0,0,0,0.7); animation:titleReveal 0.5s ${MOTION_EASE} 0.1s both;`;

    const rule = document.createElement('div');
    rule.style.cssText =
      `width:56px; height:3px; background:${ACCENT}; margin-top:14px; transform-origin:left;` +
      ` animation:ruleGrow 0.4s ${MOTION_EASE} 0.4s both;`;

    titleBlock.append(eyebrow, title, rule);
    this.element.appendChild(titleBlock);

    // Real deployment data (the actual DEFAULT_ENEMY_COUNT/DEFAULT_TARGET_COUNT a match will spawn
    // with, editable in PlaySetupModal) rather than a decorative stat - a small honest readout of
    // what's about to happen, in the same spirit as a HUD ammo counter.
    const readout = document.createElement('div');
    readout.style.cssText =
      `position:absolute; bottom:52px; left:56px; pointer-events:none; font-family:${BODY_FONT};` +
      ` border-left:2px solid ${ACCENT}; padding-left:16px;`;

    const readoutLabel = createEyebrow('DEFAULT DEPLOYMENT');
    readoutLabel.style.marginBottom = '6px';

    const readoutValue = document.createElement('div');
    readoutValue.style.cssText = `font-size:0.95rem; color:#dfe3e6; letter-spacing:0.02em;`;
    readoutValue.innerHTML =
      `<span style="color:${ACCENT}; font-weight:600;">${DEFAULT_ENEMY_COUNT}</span> hostiles &nbsp;/&nbsp; ` +
      `<span style="color:${ACCENT}; font-weight:600;">${DEFAULT_TARGET_COUNT}</span> targets`;

    readout.append(readoutLabel, readoutValue);
    this.element.appendChild(readout);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText =
      'position:absolute; bottom:48px; right:48px; display:flex; flex-direction:column; gap:10px;' +
      ' align-items:stretch; pointer-events:auto;';

    const playButton = createButton('PLAY', 'primary');
    playButton.style.minWidth = '200px';
    playButton.addEventListener('click', callbacks.onPlay);

    const multiplayerButton = createButton('MULTIPLAYER');
    multiplayerButton.style.minWidth = '200px';
    multiplayerButton.addEventListener('click', callbacks.onMultiplayer);

    const settingsButton = createButton('SETTINGS');
    settingsButton.style.minWidth = '200px';
    settingsButton.addEventListener('click', callbacks.onSettings);

    const loadoutButton = createButton('LOADOUT');
    loadoutButton.style.minWidth = '200px';
    loadoutButton.addEventListener('click', callbacks.onLoadout);

    buttonRow.append(playButton, multiplayerButton, settingsButton, loadoutButton);
    this.element.appendChild(buttonRow);

    // Small, unobtrusive - a version tag belongs in a corner, not competing with the actual UI.
    // See docs/CHANGELOG.md for what changed at each version.
    const versionTag = document.createElement('div');
    versionTag.textContent = `v${GAME_VERSION}`;
    versionTag.style.cssText =
      `position:absolute; bottom:14px; right:20px; pointer-events:none; font-family:${BODY_FONT};` +
      ' font-size:0.7rem; color:rgba(255,255,255,0.35); letter-spacing:0.05em;';
    this.element.appendChild(versionTag);

    root.appendChild(this.element);
  }

  show(): void {
    this.element.style.display = 'block';
  }

  hide(): void {
    this.element.style.display = 'none';
  }

  dispose(): void {
    this.element.remove();
  }
}
