export const ACCENT = '#3ecf5f';

export function createButton(label: string, variant: 'primary' | 'secondary' = 'secondary'): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = label;
  const base =
    'font-family:system-ui, sans-serif; font-size:0.95rem; font-weight:600; letter-spacing:0.02em;' +
    ' padding:12px 28px; border-radius:6px; cursor:pointer; transition:transform 0.12s ease-out;' +
    ' border:1px solid rgba(255,255,255,0.15);';
  const primary = `background:${ACCENT}; color:#08130a; border-color:${ACCENT};`;
  const secondary = 'background:rgba(255,255,255,0.06); color:#eee;';
  button.style.cssText = base + (variant === 'primary' ? primary : secondary);
  button.addEventListener('mouseenter', () => (button.style.transform = 'translateY(-1px)'));
  button.addEventListener('mouseleave', () => (button.style.transform = 'translateY(0)'));
  return button;
}

export function createPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.style.cssText =
    'background:rgba(15,17,20,0.94); border:1px solid rgba(255,255,255,0.12); border-radius:12px;' +
    ' padding:28px 32px; box-shadow:0 20px 60px rgba(0,0,0,0.5); color:#eee;' +
    ' font-family:system-ui, sans-serif; max-height:80vh; overflow-y:auto; box-sizing:border-box;';
  return panel;
}

export function createOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:absolute; inset:0; display:none; align-items:center; justify-content:center;' +
    ' background:rgba(0,0,0,0.55); z-index:30; pointer-events:auto;';
  return overlay;
}

export function createPanelTitle(text: string): HTMLDivElement {
  const title = document.createElement('div');
  title.textContent = text;
  title.style.cssText = 'font-size:1.3rem; font-weight:700; letter-spacing:0.1em; margin-bottom:20px;';
  return title;
}
