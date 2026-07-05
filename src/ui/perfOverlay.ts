import type { FrameStats } from '../core/FpsMeter.ts';

/** Debug-only, off by default - toggled with F3 (see Game.ts's raw keydown listener; this is a
 * dev tool, not a rebindable gameplay action, so it deliberately doesn't go through the
 * Action/InputManager system). Exists because this project's automated test environment runs on a
 * software-rendered GPU (SwiftShader) and can't produce a meaningful FPS number - this gives the
 * user a real one, in their own browser, on their own hardware, with zero setup. */
export class PerfOverlay {
  private readonly element: HTMLDivElement;
  private visible = false;

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.dataset.testid = 'perf-overlay';
    this.element.style.cssText =
      'position:absolute; top:8px; left:8px; padding:6px 10px; background:rgba(0,0,0,0.6);' +
      ' color:#3ecf5f; font:12px/1.4 monospace; white-space:pre; z-index:50; pointer-events:none; display:none;';
    root.appendChild(this.element);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.element.style.display = this.visible ? 'block' : 'none';
  }

  get isVisible(): boolean {
    return this.visible;
  }

  update(stats: FrameStats, entityCount: number): void {
    if (!this.visible) return;
    this.element.textContent =
      `FPS ${stats.fps.toFixed(0)}  frame ${stats.avgMs.toFixed(1)}ms avg / ${stats.p95Ms.toFixed(1)}ms p95\n` +
      `entities ${entityCount}`;
  }

  dispose(): void {
    this.element.remove();
  }
}
