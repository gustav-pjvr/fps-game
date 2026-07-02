import { FIXED_TIMESTEP, MAX_FRAME_TIME } from './config.ts';

export type UpdateFn = (fixedDt: number) => void;
export type RenderFn = (alpha: number) => void;

export class Loop {
  private accumulator = 0;
  private lastTime = 0;
  private rafHandle = 0;
  private running = false;

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

  private readonly tick = (now: number): void => {
    if (!this.running) return;

    const frameTime = Math.min((now - this.lastTime) / 1000, MAX_FRAME_TIME);
    this.lastTime = now;
    this.accumulator += frameTime;

    while (this.accumulator >= FIXED_TIMESTEP) {
      this.update(FIXED_TIMESTEP);
      this.accumulator -= FIXED_TIMESTEP;
    }

    const alpha = this.accumulator / FIXED_TIMESTEP;
    this.render(alpha);

    this.rafHandle = requestAnimationFrame(this.tick);
  };
}
