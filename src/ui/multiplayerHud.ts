import type { PlayerSlot } from '../network/protocol.ts';
import { formatConnection, type ConnectionQuality } from '../network/connectionStats.ts';
import { ACCENT, AMBER, HAIRLINE, INK, INK_DIM, LABEL_CSS, MONO_FONT, SURFACE, TEXT_SHADOW, THREAT } from './theme.ts';

const HEALTH_BAR_WIDTH = 140;

function healthColor(ratio: number): string {
  return ratio < 0.25 ? THREAT : ratio < 0.5 ? AMBER : ACCENT;
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
  const row = document.createElement('div');
  row.style.cssText =
    `display:flex; align-items:center; gap:8px; margin-bottom:10px; color:${INK};`;

  const labelElement = document.createElement('div');
  labelElement.textContent = label;
  labelElement.style.cssText =
    `width:80px; ${LABEL_CSS} font-size:10px; letter-spacing:0.08em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`;
  row.appendChild(labelElement);

  const track = document.createElement('div');
  track.style.cssText =
    `width:${HEALTH_BAR_WIDTH}px; height:3px; background:${HAIRLINE}; overflow:hidden;`;
  const fill = document.createElement('div');
  fill.style.cssText = `height:100%; width:100%; background:${ACCENT};`;
  track.appendChild(fill);
  row.appendChild(track);

  const text = document.createElement('div');
  text.style.cssText = `width:34px; font-family:${MONO_FONT}; font-size:12px;`;
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
  private readonly connectionLabel: HTMLDivElement;
  private readonly ownSlot: PlayerSlot;
  private ownName: string;
  private readonly opponentNames = new Map<PlayerSlot, string>();

  constructor(root: HTMLElement, ownSlot: PlayerSlot, ownName: string, roomCode: string) {
    this.ownSlot = ownSlot;
    this.ownName = ownName;

    this.healthContainer = document.createElement('div');
    this.healthContainer.style.cssText = `position:absolute; top:32px; left:32px; pointer-events:none; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums;`;
    root.appendChild(this.healthContainer);

    this.ownHealthRow = createHealthRow(truncateForLabel(ownName));
    this.healthContainer.appendChild(this.ownHealthRow.row);

    this.scoreboard = document.createElement('div');
    this.scoreboard.style.cssText =
      `position:absolute; top:128px; left:50%; transform:translateX(-50%); display:flex; width:max-content; max-width:calc(100% - 64px); font-family:${MONO_FONT};` +
      ` align-items:center; gap:14px; padding:6px 12px; background:${SURFACE}; backdrop-filter:blur(10px);` +
      ` border:1px solid ${HAIRLINE}; border-radius:2px; font-weight:400;` +
      ` font-size:11px; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums; pointer-events:none;`;
    root.appendChild(this.scoreboard);

    this.roomCodeLabel = document.createElement('div');
    this.roomCodeLabel.textContent = `Room: ${roomCode}`;
    this.roomCodeLabel.style.cssText =
      `position:absolute; top:180px; right:24px; font-family:${MONO_FONT}; color:${INK_DIM};` +
      ` font-size:10px; letter-spacing:0.05em; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums; pointer-events:none;`;
    root.appendChild(this.roomCodeLabel);

    this.connectionLabel = document.createElement('div');
    this.connectionLabel.textContent = formatConnection({ rttMs: null, route: null });
    this.connectionLabel.style.cssText =
      `position:absolute; top:194px; right:24px; font-family:${MONO_FONT}; color:${INK_DIM};` +
      ` font-size:10px; letter-spacing:0.05em; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums; pointer-events:none;`;
    this.connectionLabel.setAttribute('aria-hidden', 'true');
    root.appendChild(this.connectionLabel);
  }

  /** The ping line as shown, for the e2e debug API. */
  get connectionText(): string {
    return this.connectionLabel.textContent ?? '';
  }

  setConnection(quality: ConnectionQuality): void {
    this.connectionLabel.textContent = formatConnection(quality);
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
        wrapper.style.cssText = `display:flex; align-items:center; gap:6px; white-space:nowrap; font-family:${MONO_FONT};`;
        wrapper.style.color = entry.isYou ? ACCENT : INK;

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
          track.style.cssText = `width:60px; height:3px; background:${HAIRLINE}; overflow:hidden;`;
          const fill = document.createElement('div');
          const ratio = Math.max(0, Math.min(1, entry.score / kingOfTheHill.pointsToWin));
          fill.style.cssText = `height:100%; width:${ratio * 100}%; background:currentColor;`;
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
    if (row.previousHealth >= 0 && current < row.previousHealth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      row.row.animate([{ color: THREAT }, { color: INK }], { duration: 180 });
    }
    row.previousHealth = current;
  }

  dispose(): void {
    this.healthContainer.remove();
    this.scoreboard.remove();
    this.roomCodeLabel.remove();
    this.connectionLabel.remove();
  }
}
