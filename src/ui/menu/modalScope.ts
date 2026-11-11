/**
 * Keyboard scope for a full-page overlay shown over other menus (the Loadout page over the pause
 * menu). While it is open its siblings are inert, so Tab cannot walk into hidden buttons behind it
 * (Return to Lobby among them); focus moves into the overlay on entry and returns to where it was
 * on exit. Scopes nest: an overlay opened from inside another (Skins from the Loadout page) was made
 * inert by the outer one, so it lifts that from itself while it is open and puts it back when it closes.
 */
export class ModalScope {
  private inerted: HTMLElement[] = [];
  private returnTo: HTMLElement | null = null;
  /** The overlay itself, when an outer scope had made it inert: inert again on leaving. */
  private lifted: HTMLElement | null = null;
  private active = false;

  enter(overlay: HTMLElement, focusTarget: HTMLElement | null): void {
    if (!this.active) {
      this.active = true;
      const active = document.activeElement;
      this.returnTo = active && active !== document.body && !overlay.contains(active) ? active as HTMLElement : null;
      if (overlay.inert) {
        overlay.inert = false;
        this.lifted = overlay;
      }
      for (const sibling of Array.from(overlay.parentElement?.children ?? []) as HTMLElement[]) {
        if (sibling === overlay || sibling.inert) continue;
        sibling.inert = true;
        this.inerted.push(sibling);
      }
    }
    focusTarget?.focus();
  }

  leave(): void {
    if (!this.active) return;
    this.active = false;
    for (const element of this.inerted) element.inert = false;
    this.inerted = [];
    if (this.lifted) this.lifted.inert = true;
    this.lifted = null;
    const target = this.returnTo;
    this.returnTo = null;
    if (target?.isConnected) target.focus();
  }
}
