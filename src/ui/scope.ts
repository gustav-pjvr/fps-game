/**
 * Static vignette + reticle overlay standing in for a magnified scope, per the plan's v1 guidance
 * (a real magnified sight picture would need a second render-target camera - deferred as v1.1 polish).
 */
export class ScopeOverlay {
  private readonly element: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText =
      'position:absolute; inset:0; display:none;' +
      ' background: radial-gradient(circle at center, transparent 0, transparent 38vh, #000 38.3vh);';

    const reticleV = document.createElement('div');
    reticleV.style.cssText = 'position:absolute; left:50%; top:0; bottom:0; width:1px; background:#000;';

    const reticleH = document.createElement('div');
    reticleH.style.cssText = 'position:absolute; top:50%; left:0; right:0; height:1px; background:#000;';

    this.element.appendChild(reticleV);
    this.element.appendChild(reticleH);
    root.appendChild(this.element);
  }

  setVisible(visible: boolean): void {
    this.element.style.display = visible ? 'block' : 'none';
  }

  dispose(): void {
    this.element.remove();
  }
}
