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

/** Multiplayer-only HUD replacement for the single-player Hud's score text and health bar
 * (see Game.ts - Hud.setScoreVisible/setHealthVisible hide those in multiplayer so this doesn't
 * duplicate them): a top-left pair of health bars (both players, always visible to each other -
 * this is 1v1 PvP, not a stealth game) and a top-center scoreboard, both updated every tick from
 * data already flowing over the network (opponent health piggybacks on their playerSnapshot - see
 * protocol.ts; score already drives KillFeed the same way). */
export class MultiplayerHud {
  private readonly healthContainer: HTMLDivElement;
  private readonly ownHealthRow: HealthRow;
  private readonly opponentHealthRow: HealthRow;
  private readonly scoreboard: HTMLDivElement;
  private readonly ownScoreElement: HTMLDivElement;
  private readonly opponentScoreElement: HTMLDivElement;
  private readonly ownName: string;
  private readonly opponentName: string;

  constructor(root: HTMLElement, ownName: string, opponentName: string) {
    this.healthContainer = document.createElement('div');
    this.healthContainer.style.cssText = 'position:absolute; top:24px; left:32px;';
    root.appendChild(this.healthContainer);

    // The row label doubles as this HUD's live player list - with only two players ever in a
    // match, "who's connected" is already fully shown by these two names, so there's no need for
    // a separate list panel once real usernames exist (see MULTIPLAYER_PLAN.md follow-up: revisit
    // if/when 4-player lobbies make the roster bigger than these two rows can show).
    this.ownHealthRow = createHealthRow(truncateForLabel(ownName));
    this.opponentHealthRow = createHealthRow(truncateForLabel(opponentName));
    this.healthContainer.append(this.ownHealthRow.row, this.opponentHealthRow.row);
    this.ownName = ownName;
    this.opponentName = opponentName;

    this.scoreboard = document.createElement('div');
    this.scoreboard.style.cssText =
      'position:absolute; top:16px; left:50%; transform:translateX(-50%); display:flex;' +
      ' align-items:center; gap:14px; padding:6px 18px; background:rgba(10,10,10,0.55);' +
      ' border:1px solid rgba(255,255,255,0.15); border-radius:6px; font-weight:700;' +
      ' font-size:1.05rem; text-shadow:0 1px 3px #000; font-variant-numeric:tabular-nums;';

    this.ownScoreElement = document.createElement('div');
    this.ownScoreElement.style.color = '#3ecf5f';
    const divider = document.createElement('div');
    divider.textContent = '—';
    divider.style.opacity = '0.6';
    this.opponentScoreElement = document.createElement('div');
    this.opponentScoreElement.style.color = '#e0625a';

    this.scoreboard.append(this.ownScoreElement, divider, this.opponentScoreElement);
    root.appendChild(this.scoreboard);
  }

  update(ownHealth: number, ownMaxHealth: number, opponentHealth: number, ownScore: number, opponentScore: number): void {
    this.setHealthRow(this.ownHealthRow, ownHealth, ownMaxHealth);
    this.setHealthRow(this.opponentHealthRow, opponentHealth, ownMaxHealth);
    this.ownScoreElement.textContent = `${truncateForLabel(this.ownName)} ${ownScore}`;
    this.opponentScoreElement.textContent = `${opponentScore} ${truncateForLabel(this.opponentName)}`;
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
  }
}
