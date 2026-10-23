import { DAMAGE_VIGNETTE_DURATION } from '../core/config.ts';
import { THREAT } from './theme.ts';

/** Faded red ring around the screen edges, briefly visible every time the player takes damage -
 * an at-a-glance "you got hit" acknowledgment alongside the health bar (HitMarker is the mirror
 * image of this: confirming *you* landed a hit on something else, not that you were hit). Wired to
 * Player's onDamaged hook, which already fires on every non-fatal takeDamage call regardless of
 * source (enemy fire in single-player, a network damageEvent in multiplayer) - one injection point
 * covers both. */
export class DamageVignette {
  private readonly element: HTMLDivElement;
  private timeRemaining = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText =
      'position:absolute; inset:0; opacity:0; pointer-events:none; z-index:15;' +
      ` background:radial-gradient(ellipse at center, transparent 55%, ${THREAT} 100%);`;
    root.appendChild(this.element);
  }

  trigger(): void {
    this.timeRemaining = DAMAGE_VIGNETTE_DURATION;
    this.element.style.transition = this.reducedMotion.matches ? 'none' : 'opacity 0.08s ease-out';
    this.element.style.opacity = '0.275';
  }

  update(dt: number): void {
    if (this.timeRemaining <= 0) return;
    this.timeRemaining -= dt;
    if (this.timeRemaining <= 0) this.element.style.opacity = '0';
  }

  dispose(): void {
    this.element.remove();
  }
}
