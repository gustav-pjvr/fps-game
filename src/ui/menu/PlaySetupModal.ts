import { createButton, createOverlay, createPanel, createPanelTitle } from './menuStyles.ts';

export interface MatchSetupConfig {
  enemyCount: number;
  targetCount: number;
}

/** Shown after clicking Play: lets the player choose how many enemies/targets spawn this match. */
export class PlaySetupModal {
  private readonly overlay: HTMLDivElement;
  private readonly enemyInput: HTMLInputElement;
  private readonly targetInput: HTMLInputElement;

  constructor(
    root: HTMLElement,
    defaults: MatchSetupConfig,
    maxCount: number,
    onStart: (config: MatchSetupConfig) => void,
    onCancel: () => void,
  ) {
    this.overlay = createOverlay();

    const panel = createPanel();
    panel.style.width = '360px';
    panel.appendChild(createPanelTitle('MATCH SETUP'));

    this.enemyInput = this.buildCountRow(panel, 'Enemies', defaults.enemyCount, maxCount);
    this.targetInput = this.buildCountRow(panel, 'Targets', defaults.targetCount, maxCount);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:flex-end; gap:10px; margin-top:24px;';

    const cancelButton = createButton('Cancel');
    cancelButton.addEventListener('click', onCancel);

    const startButton = createButton('Start Match', 'primary');
    startButton.addEventListener('click', () => {
      onStart({
        enemyCount: this.clampInput(this.enemyInput, maxCount),
        targetCount: this.clampInput(this.targetInput, maxCount),
      });
    });

    footer.append(cancelButton, startButton);
    panel.appendChild(footer);

    this.overlay.appendChild(panel);
    root.appendChild(this.overlay);
  }

  private buildCountRow(panel: HTMLDivElement, label: string, defaultValue: number, max: number): HTMLInputElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:16px;';

    const labelEl = document.createElement('label');
    labelEl.textContent = `${label} (0-${max})`;
    labelEl.style.cssText = 'display:block; font-size:0.85rem; opacity:0.8; margin-bottom:6px;';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = String(max);
    input.value = String(defaultValue);
    input.style.cssText =
      'width:100%; box-sizing:border-box; padding:8px 10px; border-radius:6px; font-size:0.95rem;' +
      ' border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.06); color:#eee;';

    row.append(labelEl, input);
    panel.appendChild(row);
    return input;
  }

  private clampInput(input: HTMLInputElement, max: number): number {
    const raw = Math.round(parseFloat(input.value));
    if (Number.isNaN(raw)) return 0;
    return Math.max(0, Math.min(max, raw));
  }

  show(): void {
    this.overlay.style.display = 'flex';
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  dispose(): void {
    this.overlay.remove();
  }
}
