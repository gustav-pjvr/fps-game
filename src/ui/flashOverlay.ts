/**
 * A flash grenade's white-out (docs/grenades.md): a full-screen white layer at the blind level
 * (GrenadeSystem.blindLevel, which holds then fades), over an afterimage: the frame seen at the
 * moment of the flash, frozen, washed out and blurred, that lingers a little longer than the white.
 *
 * Under prefers-reduced-motion (the game's reduced-motion setting, as damageArcs.ts) the white
 * comes in over a short ramp instead of at once, never goes fully opaque, and there is no
 * afterimage.
 */

/** The white's opacity under reduced motion never passes this. */
export const REDUCED_MOTION_WHITE_CAP = 0.8;
/** Seconds for the white to come in under reduced motion. */
export const REDUCED_MOTION_RAMP_SECONDS = 0.15;
const AFTERIMAGE_PEAK = 0.55;
/** The afterimage is captured at this fraction of the screen's size: it is blurred anyway. */
const AFTERIMAGE_SCALE = 0.25;

/** The white layer's opacity for a blind level, and the afterimage's. */
export function flashOverlayOpacity(level: number, reducedMotion: boolean): { white: number; afterimage: number } {
  const l = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  if (reducedMotion) return { white: Math.min(l, REDUCED_MOTION_WHITE_CAP), afterimage: 0 };
  // Mostly white at the peak, so the frozen frame shows through faintly, then more as the white
  // clears: the afterimage outlasts it.
  return { white: l * 0.94, afterimage: AFTERIMAGE_PEAK * Math.min(1, l * 2.2) };
}

export class FlashOverlay {
  private readonly white: HTMLDivElement;
  private readonly afterimage: HTMLCanvasElement;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private shownWhite = 0;
  private shownAfterimage = 0;
  private rampedWhite = 0;

  constructor(root: HTMLElement) {
    this.afterimage = document.createElement('canvas');
    this.afterimage.setAttribute('aria-hidden', 'true');
    this.afterimage.style.cssText =
      'position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:14; opacity:0; display:none;' +
      ' filter:blur(3px) grayscale(0.35) brightness(1.7) contrast(0.75);';
    this.white = document.createElement('div');
    this.white.setAttribute('aria-hidden', 'true');
    this.white.style.cssText = 'position:absolute; inset:0; pointer-events:none; z-index:14; background:#fff; opacity:0; display:none;';
    root.append(this.afterimage, this.white);
  }

  /** Freezes `source` (the game canvas, straight after it rendered) as the afterimage. */
  capture(source: HTMLCanvasElement): void {
    if (this.reducedMotion.matches) return;
    const width = Math.max(1, Math.round(source.width * AFTERIMAGE_SCALE));
    const height = Math.max(1, Math.round(source.height * AFTERIMAGE_SCALE));
    if (this.afterimage.width !== width) this.afterimage.width = width;
    if (this.afterimage.height !== height) this.afterimage.height = height;
    this.afterimage.getContext('2d')?.drawImage(source, 0, 0, width, height);
  }

  update(dt: number, level: number): void {
    const reduced = this.reducedMotion.matches;
    const target = flashOverlayOpacity(level, reduced);
    let white = target.white;
    if (reduced) {
      // Ramp up, but follow the fade down at once.
      white = Math.min(white, this.rampedWhite + dt / REDUCED_MOTION_RAMP_SECONDS);
      this.rampedWhite = white;
    }
    this.show(this.white, white, this.shownWhite);
    this.show(this.afterimage, target.afterimage, this.shownAfterimage);
    this.shownWhite = white;
    this.shownAfterimage = target.afterimage;
  }

  private show(element: HTMLElement, opacity: number, shown: number): void {
    if (opacity === shown) return;
    element.style.display = opacity > 0.002 ? 'block' : 'none';
    element.style.opacity = opacity.toFixed(3);
  }

  dispose(): void {
    this.white.remove();
    this.afterimage.remove();
  }
}
