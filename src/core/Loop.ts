import { FIXED_TIMESTEP, MAX_FRAME_TIME } from './config.ts';

export type UpdateFn = (fixedDt: number) => void;
export type RenderFn = (alpha: number) => void;

export class Loop {
  private accumulator = 0;
  private lastTime = 0;
  private rafHandle = 0;
  private running = false;
  /** Test-only (window.__gameDebug.holdTime): while held, frames draw but the game does not
   * advance, except by `step`. Never set by gameplay code. */
  private held = false;

  constructor(
    private readonly update: UpdateFn,
    private readonly render: RenderFn,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
  }

  /** Test-only: stops (or restarts) the game's clock while the frames keep drawing. */
  setHeld(held: boolean): void {
    this.held = held;
    this.accumulator = 0;
  }

  /** Test-only: advances a held game by `seconds` (whole fixed steps) and draws it, so a frame
   * capture can photograph an animation at exact moments however slow the machine is. */
  step(seconds: number): void {
    const steps = Math.max(0, Math.round(seconds / FIXED_TIMESTEP));
    for (let i = 0; i < steps; i++) this.update(FIXED_TIMESTEP);
    this.render(0);
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;

    const frameTime = Math.min((now - this.lastTime) / 1000, MAX_FRAME_TIME);
    this.lastTime = now;
    if (!this.held) this.accumulator += frameTime;

    while (this.accumulator >= FIXED_TIMESTEP) {
      this.update(FIXED_TIMESTEP);
      this.accumulator -= FIXED_TIMESTEP;
    }

    const alpha = this.accumulator / FIXED_TIMESTEP;
    this.render(alpha);

    this.rafHandle = requestAnimationFrame(this.tick);
  };
}
