import type { PlayerSlot } from '../network/protocol.ts';
import { ACCENT, DISPLAY_FONT, HAIRLINE, MOTION_EASE, chamferClipPath, ensureMotionKeyframesInjected } from './menu/menuStyles.ts';

const HEALTH_BAR_WIDTH = 140;

function healthColor(ratio: number): string {
  return ratio > 0.5 ? ACCENT : ratio > 0.25 ? '#e0a930' : '#e03b30';
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
  /** Last-seen health value - lets setHealthRow detect an actual decrease (a hit) to flash on,
   * rather than flashing on every update() tick regardless of whether anything changed. */
  previousHealth: number;
}

function createHealthRow(label: string): HealthRow {
  ensureMotionKeyframesInjected();
  const row = document.createElement('div');
  row.style.cssText =
    'display:flex; align-items:center; gap:8px; margin-bottom:6px; border-radius:3px;' +
    ` animation:rowSlideIn 0.3s ${MOTION_EASE} both;`;

  const labelElement = document.createElement('div');
  labelElement.textContent = label;
  labelElement.style.cssText =
    `width:64px; font-family:${DISPLAY_FONT}; font-size:0.7rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase;` +
    ' text-shadow:0 1px 3px #000; opacity:0.85;';
  row.appendChild(labelElement);

  const track = document.createElement('div');
  track.style.cssText =
    `width:${HEALTH_BAR_WIDTH}px; height:12px; background:rgba(0,0,0,0.4);` +
    ' border:1px solid rgba(255,255,255,0.3); border-radius:3px; overflow:hidden;';
  const fill = document.createElement('div');
  fill.style.cssText = `height:100%; width:100%; background:${ACCENT}; transition:width 0.15s, background 0.15s;`;
  track.appendChild(fill);
  row.appendChild(track);

  const text = document.createElement('div');
  text.style.cssText = `width:34px; font-family:${DISPLAY_FONT}; font-size:0.75rem; text-shadow:0 1px 3px #000; font-variant-numeric:tabular-nums;`;
  row.appendChild(text);

  // -1 is a sentinel "no baseline yet" - health can't actually be negative, so the very first
  // setHealthRow call never misreads "went from nothing to something" as a hit.
  return { row, fill, text, previousHealth: -1 };
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
      `position:absolute; top:16px; left:50%; transform:translateX(-50%); display:flex; font-family:${DISPLAY_FONT};` +
      ` align-items:center; gap:14px; padding:6px 18px; background:rgba(10,10,10,0.55);` +
      ` border:1px solid ${HAIRLINE}; clip-path:${chamferClipPath('top-right', 8)}; font-weight:700;` +
      ' font-size:1.05rem; text-shadow:0 1px 3px #000; font-variant-numeric:tabular-nums;';
    root.appendChild(this.scoreboard);

    this.roomCodeLabel = document.createElement('div');
    this.roomCodeLabel.textContent = `Room: ${roomCode}`;
    this.roomCodeLabel.style.cssText =
      `position:absolute; top:16px; right:16px; padding:5px 12px; background:rgba(10,10,10,0.55); font-family:${DISPLAY_FONT};` +
      ` border:1px solid ${HAIRLINE}; clip-path:${chamferClipPath('top-right', 6)}; font-size:0.8rem; font-weight:600;` +
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

  update(
    ownHealth: number,
    ownMaxHealth: number,
    opponentHealths: ReadonlyMap<PlayerSlot, number>,
    scoreboard: ReadonlyMap<PlayerSlot, number>,
    /** King of the Hill only - when present, the scoreboard renders as "name score/pointsToWin"
     * with a crown marker on whoever's currently carrying the golden goose, instead of the plain
     * kill-count list every other mode uses. */
    kingOfTheHill?: { pointsToWin: number; carrierSlot: PlayerSlot | null },
  ): void {
    this.setHealthRow(this.ownHealthRow, ownHealth, ownMaxHealth);
    for (const [slot, row] of this.opponentHealthRows) {
      this.setHealthRow(row, opponentHealths.get(slot) ?? ownMaxHealth, ownMaxHealth);
    }
    this.renderScoreboard(scoreboard, kingOfTheHill);
  }

  private renderScoreboard(scoreboard: ReadonlyMap<PlayerSlot, number>, kingOfTheHill?: { pointsToWin: number; carrierSlot: PlayerSlot | null }): void {
    const entries = Array.from(scoreboard, ([slot, score]) => ({
      slot,
      score,
      name: slot === this.ownSlot ? this.ownName : this.opponentNames.get(slot) ?? 'Player',
      isYou: slot === this.ownSlot,
    })).sort((a, b) => b.score - a.score);

    this.scoreboard.replaceChildren(
      ...entries.map((entry) => {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `display:flex; align-items:center; gap:6px; font-family:${DISPLAY_FONT};`;
        wrapper.style.color = entry.isYou ? ACCENT : '#e0625a';

        // A text affix, not just color, marks "this row is you" (per accessibility review - a
        // colorblind player, or anyone glancing quickly, couldn't otherwise tell their own row
        // apart from an opponent's at this size). Kept short ("(you)") so it doesn't crowd out the
        // King of the Hill progress bar this row can also carry.
        const youSuffix = entry.isYou ? ' (you)' : '';

        if (kingOfTheHill) {
          const label = document.createElement('div');
          const crown = entry.slot === kingOfTheHill.carrierSlot ? '👑 ' : '';
          label.textContent = `${crown}${truncateForLabel(entry.name)}${youSuffix}`;
          wrapper.appendChild(label);

          const track = document.createElement('div');
          track.style.cssText = 'width:60px; height:8px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.3); border-radius:3px; overflow:hidden;';
          const fill = document.createElement('div');
          const ratio = Math.max(0, Math.min(1, entry.score / kingOfTheHill.pointsToWin));
          fill.style.cssText = `height:100%; width:${ratio * 100}%; background:currentColor; transition:width 0.2s;`;
          track.appendChild(fill);
          wrapper.appendChild(track);

          const fraction = document.createElement('div');
          fraction.textContent = `${entry.score}/${kingOfTheHill.pointsToWin}`;
          fraction.style.cssText = 'font-size:0.8rem;';
          wrapper.appendChild(fraction);
        } else {
          wrapper.textContent = `${truncateForLabel(entry.name)}${youSuffix} ${entry.score}`;
        }

        return wrapper;
      }),
    );
  }

  private setHealthRow(row: HealthRow, current: number, max: number): void {
    const ratio = Math.max(0, Math.min(1, current / max));
    row.fill.style.width = `${ratio * 100}%`;
    row.fill.style.background = healthColor(ratio);
    row.text.textContent = `${Math.ceil(Math.max(0, current))}`;

    // A brief red flash on a real health drop - a "hit landed" cue on the HUD itself, distinct
    // from the screen-edge DamageVignette (own player only) and legible for opponent rows too.
    if (row.previousHealth >= 0 && current < row.previousHealth) {
      row.row.style.animation = 'none';
      // Reflow before re-adding the animation, or a second hit within the first one's duration
      // wouldn't restart it (the browser sees "same animation, already running" and no-ops).
      void row.row.offsetWidth;
      row.row.style.animation = `hitFlash 0.35s ${MOTION_EASE}`;
    }
    row.previousHealth = current;
  }

  dispose(): void {
    this.healthContainer.remove();
    this.scoreboard.remove();
    this.roomCodeLabel.remove();
  }
}
