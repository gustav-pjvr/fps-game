/**
 * Keyboard scope for a full-page overlay shown over other menus (the Loadout page over the pause
 * menu). While it is open its siblings are inert, so Tab cannot walk into hidden buttons behind it
 * (Return to Lobby among them); focus moves into the overlay on entry and returns to where it was
 * on exit.
 */
export class ModalScope {
  private inerted: HTMLElement[] = [];
  private returnTo: HTMLElement | null = null;
  private active = false;

  enter(overlay: HTMLElement, focusTarget: HTMLElement | null): void {
    if (!this.active) {
      this.active = true;
      const active = document.activeElement;
      this.returnTo = active && active !== document.body && !overlay.contains(active) ? active as HTMLElement : null;
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
    const target = this.returnTo;
    this.returnTo = null;
    if (target?.isConnected) target.focus();
  }
}
