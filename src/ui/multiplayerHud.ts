import type { PlayerSlot } from '../network/protocol.ts';

const HEALTH_BAR_WIDTH = 140;

function healthColor(ratio: number): string {
  return ratio > 0.5 ? '#3ecf5f' : ratio > 0.25 ? '#e0a930' : '#e03b30';
}

const MAX_LABEL_LENGTH = 10;

/** The health row's label column is a fixed 64px, sized for "You"/"Opponent" - a longer real
 * username needs a hard cap or it wraps/overflows onto the health bar next to it. */
function truncateForLabel(name: string): string {
  return name.length > MAX_LABEL_LENGTH ? `${name.slice(0, MAX_LABEL_LENGTH - 1)}…` : name;
}

interface HealthRow {
  readonly row: HTMLDivElement;
  readonly fill: HTMLDivElement;
  readonly text: HTMLDivElement;
}

function createHealthRow(label: string): HealthRow {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:6px;';

  const labelElement = document.createElement('div');
  labelElement.textContent = label;
  labelElement.style.cssText =
    'width:64px; font-size:0.7rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase;' +
    ' text-shadow:0 1px 3px #000; opacity:0.85;';
  row.appendChild(labelElement);

  const track = document.createElement('div');
  track.style.cssText =
    `width:${HEALTH_BAR_WIDTH}px; height:12px; background:rgba(0,0,0,0.4);` +
    ' border:1px solid rgba(255,255,255,0.3); border-radius:3px; overflow:hidden;';
  const fill = document.createElement('div');
  fill.style.cssText = 'height:100%; width:100%; background:#3ecf5f; transition:width 0.15s, background 0.15s;';
  track.appendChild(fill);
  row.appendChild(track);

  const text = document.createElement('div');
  text.style.cssText = 'width:34px; font-size:0.75rem; text-shadow:0 1px 3px #000; font-variant-numeric:tabular-nums;';
  row.appendChild(text);

  return { row, fill, text };
}

/** Multiplayer-only HUD replacement for the single-player Hud's score text and health bar (see
 * Game.ts - Hud.setScoreVisible/setHealthVisible hide those in multiplayer so this doesn't
 * duplicate them): a top-left stack of health bars (own + up to 3 opponents, added/removed live as
 * players join/leave a match) and a top-center scoreboard listing everyone's score sorted
 * descending, plus a small always-visible room-code label (per user request: the code should stay
 * on screen throughout the match, not just on the pre-match room screen, so it's always available
 * to invite someone or read back to a player who dropped). */
export class MultiplayerHud {
  private readonly healthContainer: HTMLDivElement;
  private readonly ownHealthRow: HealthRow;
  private readonly opponentHealthRows = new Map<PlayerSlot, HealthRow>();
  private readonly scoreboard: HTMLDivElement;
  private readonly roomCodeLabel: HTMLDivElement;
  private readonly ownSlot: PlayerSlot;
  private ownName: string;
  private readonly opponentNames = new Map<PlayerSlot, string>();

  constructor(root: HTMLElement, ownSlot: PlayerSlot, ownName: string, roomCode: string) {
    this.ownSlot = ownSlot;
    this.ownName = ownName;

    this.healthContainer = document.createElement('div');
    this.healthContainer.style.cssText = 'position:absolute; top:24px; left:32px;';
    root.appendChild(this.healthContainer);

    this.ownHealthRow = createHealthRow(truncateForLabel(ownName));
    this.healthContainer.appendChild(this.ownHealthRow.row);

    this.scoreboard = document.createElement('div');
    this.scoreboard.style.cssText =
      'position:absolute; top:16px; left:50%; transform:translateX(-50%); display:flex;' +
      ' align-items:center; gap:14px; padding:6px 18px; background:rgba(10,10,10,0.55);' +
      ' border:1px solid rgba(255,255,255,0.15); border-radius:6px; font-weight:700;' +
      ' font-size:1.05rem; text-shadow:0 1px 3px #000; font-variant-numeric:tabular-nums;';
    root.appendChild(this.scoreboard);

    this.roomCodeLabel = document.createElement('div');
    this.roomCodeLabel.textContent = `Room: ${roomCode}`;
    this.roomCodeLabel.style.cssText =
      'position:absolute; top:16px; right:16px; padding:5px 12px; background:rgba(10,10,10,0.55);' +
      ' border:1px solid rgba(255,255,255,0.15); border-radius:6px; font-size:0.8rem; font-weight:600;' +
      ' letter-spacing:0.05em; text-shadow:0 1px 3px #000; font-variant-numeric:tabular-nums; opacity:0.85;';
    root.appendChild(this.roomCodeLabel);
  }

  /** Called once per opponent when they're added to the match (initial roster, a rejoin, or a
   * brand-new player joining mid-match) - see Game.ts's onMessage handling of
   * playerJoinedMatch/playerLeft. */
  addOpponentRow(slot: PlayerSlot, username: string): void {
    this.opponentNames.set(slot, username);
    if (this.opponentHealthRows.has(slot)) return;
    const row = createHealthRow(truncateForLabel(username));
    this.opponentHealthRows.set(slot, row);
    this.healthContainer.appendChild(row.row);
  }

  removeOpponentRow(slot: PlayerSlot): void {
    this.opponentHealthRows.get(slot)?.row.remove();
    this.opponentHealthRows.delete(slot);
    this.opponentNames.delete(slot);
  }

  update(ownHealth: number, ownMaxHealth: number, opponentHealths: ReadonlyMap<PlayerSlot, number>, scoreboard: ReadonlyMap<PlayerSlot, number>): void {
    this.setHealthRow(this.ownHealthRow, ownHealth, ownMaxHealth);
    for (const [slot, row] of this.opponentHealthRows) {
      this.setHealthRow(row, opponentHealths.get(slot) ?? ownMaxHealth, ownMaxHealth);
    }
    this.renderScoreboard(scoreboard);
  }

  private renderScoreboard(scoreboard: ReadonlyMap<PlayerSlot, number>): void {
    const entries = Array.from(scoreboard, ([slot, score]) => ({
      slot,
      score,
      name: slot === this.ownSlot ? this.ownName : this.opponentNames.get(slot) ?? 'Player',
      isYou: slot === this.ownSlot,
    })).sort((a, b) => b.score - a.score);

    this.scoreboard.replaceChildren(
      ...entries.map((entry) => {
        const element = document.createElement('div');
        element.textContent = `${truncateForLabel(entry.name)} ${entry.score}`;
        element.style.color = entry.isYou ? '#3ecf5f' : '#e0625a';
        return element;
      }),
    );
  }

  private setHealthRow(row: HealthRow, current: number, max: number): void {
    const ratio = Math.max(0, Math.min(1, current / max));
    row.fill.style.width = `${ratio * 100}%`;
    row.fill.style.background = healthColor(ratio);
    row.text.textContent = `${Math.ceil(Math.max(0, current))}`;
  }

  dispose(): void {
    this.healthContainer.remove();
    this.scoreboard.remove();
    this.roomCodeLabel.remove();
  }
}
