import { MONO_FONT, LABEL_CSS } from './theme.ts';
import {
  createOverlay,
  createPanel,
  createPanelTitle,
  createEyebrow,
  createButton,
  attachScanSweep,
  ACCENT,
  TEXT,
  STEEL,
  HAIRLINE,
  BG_RAISED,
  BODY_FONT,
} from './menu/menuStyles.ts';
import type { ModeExplanationIcon, ModeExplanationStep } from '../core/modeExplanations.ts';

/** Small, reusable geometric icon set - stroke-based, single color (recolored via `currentColor`
 * to the panel's accent), matching this project's existing "no sourced assets for non-hero
 * elements" precedent (crates/ladders/the knife weapon/the procedural goose mesh) rather than
 * trying to source or generate real screenshots of in-game moments. */
const ICONS: Record<ModeExplanationIcon, string> = {
  pistol:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 28h20l4-6h10v8h-6l-2 6H14l-2-4H6z"/><path d="M18 28v-8h8v8"/></svg>',
  scope:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
    '<circle cx="24" cy="24" r="14"/><path d="M24 4v8M24 36v8M4 24h8M36 24h8"/><circle cx="24" cy="24" r="3" fill="currentColor" stroke="none"/></svg>',
  ladder:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M10 38V22M24 38V14M38 38V6"/><path d="M6 26l4-4 4 4M20 18l4-4 4 4M34 10l4-4 4 4"/></svg>',
  knife:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M8 40 30 18"/><path d="M22 10l16 16-6 6-16-16z"/><path d="M8 40l4-10 6 6z" fill="currentColor" stroke="none"/></svg>',
  goose:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<ellipse cx="20" cy="30" rx="12" ry="9"/><path d="M26 24C30 16 34 12 40 10c-2 5-4 8-8 11"/>' +
    '<circle cx="39" cy="10" r="1.6" fill="currentColor" stroke="none"/><path d="M14 39l-4 4M26 39l4 4"/></svg>',
  explosion:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M24 4l4 12 12-6-6 12 12 4-12 4 6 12-12-6-4 12-4-12-12 6 6-12-12-4 12-4-6-12 12 6z"/></svg>',
  crown:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 36h36l-2-16-10 8-6-14-6 14-10-8z"/><path d="M6 36v4h36v-4"/></svg>',
  lock:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="10" y="22" width="28" height="18" rx="2"/><path d="M16 22v-6a8 8 0 0116 0v6"/>' +
    '<circle cx="24" cy="31" r="2.4" fill="currentColor" stroke="none"/></svg>',
  shield:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M24 5l16 6v11c0 11-7 18-16 21-9-3-16-10-16-21V11z"/><path d="M17 24l5 5 10-11"/></svg>',
  wave:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 30c4-6 8-6 12 0s8 6 12 0 8-6 12 0 8 6 4 0"/><path d="M4 18c4-6 8-6 12 0s8 6 12 0 8-6 12 0 8 6 4 0"/></svg>',
  heart:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M24 40S6 28 6 15a9 9 0 0118-3 9 9 0 0118 3c0 13-18 25-18 25z"/></svg>',
  skull:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M24 6c-9 0-16 7-16 16 0 6 3 10 6 12v6h6v-5h8v5h6v-6c3-2 6-6 6-12 0-9-7-16-16-16z"/>' +
    '<circle cx="18" cy="22" r="2.6" fill="currentColor" stroke="none"/><circle cx="30" cy="22" r="2.6" fill="currentColor" stroke="none"/>' +
    '<path d="M22 30h4"/></svg>',
  trophy:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 8h20v10c0 7-4 12-10 12S14 25 14 18z"/><path d="M14 10H6v4c0 5 4 8 8 8M34 10h8v4c0 5-4 8-8 8"/>' +
    '<path d="M24 30v6M16 42h16l-2-6H18z"/></svg>',
};

/** Shown once at the start of every non-default-mode match (single-player Goose Horde, and every
 * multiplayer mode) - per explicit user request: explain the mode's rules in a few steps before
 * the world actually goes live. Solo has nobody to wait on (the Skip button dismisses it the
 * instant it's clicked); multiplayer requires every connected player to click it, tracked by a
 * live "N/M" count shown right on the button, so one player can't miss the briefing or start
 * fighting before the rest of the room has even read it (see Game.ts's worldBriefingActive gate,
 * which freezes all simulation - enemies, wave spawners, everything - until this closes). */
export class ModeExplanationScreen {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly skipButton: HTMLButtonElement;
  private readonly waitingNote: HTMLDivElement;
  private localSkipped = false;

  constructor(root: HTMLElement, onSkipClicked: () => void) {
    this.overlay = createOverlay();
    this.overlay.dataset.testid = 'mode-explanation-screen';

    this.panel = createPanel();
    this.panel.style.width = 'min(520px, 90vw)';

    this.skipButton = createButton('Skip', 'primary');
    this.skipButton.style.cssText += 'width:100%; box-sizing:border-box; margin-top:4px;';
    this.skipButton.addEventListener('click', () => {
      if (this.localSkipped) return;
      this.localSkipped = true;
      this.skipButton.disabled = true;
      this.skipButton.style.opacity = '0.55';
      this.skipButton.style.cursor = 'default';
      onSkipClicked();
    });

    this.waitingNote = document.createElement('div');
    this.waitingNote.style.cssText = `font-family:${MONO_FONT}; font-size:0.78rem; color:${STEEL}; margin-top:10px; text-align:center;`;

    this.overlay.appendChild(this.panel);
    root.appendChild(this.overlay);
  }

  /** `totalPlayers` is 1 in single-player (or a multiplayer room this client hasn't populated
   * opponents for yet - never actually reachable, but kept honest) - the button then just reads
   * "Skip" with no counter and dismisses on the first click, no waiting involved. */
  show(title: string, steps: readonly ModeExplanationStep[], totalPlayers: number): void {
    this.localSkipped = false;
    this.skipButton.disabled = false;
    this.skipButton.style.opacity = '1';
    this.skipButton.style.cursor = 'pointer';

    this.panel.innerHTML = '';
    this.panel.append(createEyebrow('Mode Briefing'), createPanelTitle(title));

    const stepsContainer = document.createElement('div');
    stepsContainer.style.cssText = 'display:flex; flex-direction:column; gap:16px; margin:22px 0 24px;';
    steps.forEach((step, index) => stepsContainer.appendChild(this.buildStepRow(step, index + 1)));
    this.panel.appendChild(stepsContainer);

    this.panel.append(this.skipButton, this.waitingNote);
    this.setReadyCount(0, totalPlayers);

    this.overlay.style.display = 'flex';
    attachScanSweep(this.panel);
  }

  /** Updates the live "N/M" readout, both on the Skip button itself (per explicit user request -
   * "fill the 2/2, 3/3 or 4/4 fill on the skip button") and the note underneath explaining what
   * it means. `total <= 1` (single-player) skips the counter entirely - there's no one else to
   * wait on. */
  setReadyCount(ready: number, total: number): void {
    if (total <= 1) {
      this.skipButton.textContent = 'Skip';
      this.waitingNote.textContent = '';
      return;
    }
    this.skipButton.textContent = `Skip (${ready}/${total})`;
    this.waitingNote.textContent =
      ready >= total ? 'Everyone is ready - starting now...' : `Waiting on the rest of your squad to skip (${ready}/${total} ready)`;
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  dispose(): void {
    this.overlay.remove();
  }

  private buildStepRow(step: ModeExplanationStep, index: number): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:flex-start; gap:14px;';

    const iconBox = document.createElement('div');
    iconBox.style.cssText =
      `flex:0 0 auto; width:44px; height:44px; padding:9px; box-sizing:border-box; display:flex; align-items:center;` +
      ` justify-content:center; background:${BG_RAISED}; border:1px solid ${HAIRLINE}; color:${ACCENT};` +
      ` border-radius:2px;`;
    iconBox.innerHTML = ICONS[step.icon];

    const textWrap = document.createElement('div');
    textWrap.style.cssText = 'flex:1; padding-top:3px;';

    const stepLabel = document.createElement('div');
    stepLabel.textContent = `STEP ${index}`;
    stepLabel.style.cssText =
      `${LABEL_CSS} margin-bottom:4px;`;

    const text = document.createElement('div');
    text.textContent = step.text;
    text.style.cssText = `font-family:${BODY_FONT}; font-size:0.92rem; line-height:1.42; color:${TEXT};`;

    textWrap.append(stepLabel, text);
    row.append(iconBox, textWrap);
    return row;
  }
}
