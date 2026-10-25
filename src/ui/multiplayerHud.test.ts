import { describe, expect, it } from 'vitest';
import type { PlayerSlot } from '../network/protocol.ts';
import { scoreboardRows } from './multiplayerHud.ts';

const names = new Map<PlayerSlot, string>([
  [0, 'Host'],
  [2, 'Dee'],
  [3, 'Eli'],
]);

describe('scoreboardRows', () => {
  it('lists every player in the match at zero before anyone has a kill', () => {
    const rows = scoreboardRows(1, 'Me', [0, 2, 3], names, new Map());
    expect(rows.map((row) => [row.slot, row.name, row.score])).toEqual([
      [0, 'Host', 0],
      [1, 'Me', 0],
      [2, 'Dee', 0],
      [3, 'Eli', 0],
    ]);
    expect(rows.filter((row) => row.isYou).map((row) => row.slot)).toEqual([1]);
  });

  it('orders by score, highest first, then by slot so ties never swap', () => {
    const rows = scoreboardRows(
      1,
      'Me',
      [0, 2, 3],
      names,
      new Map<PlayerSlot, number>([
        [0, 2],
        [1, 5],
        [2, 2],
        [3, 0],
      ]),
    );
    expect(rows.map((row) => row.slot)).toEqual([1, 0, 2, 3]);
  });

  it('keeps a departed player with a score, under the name they played as', () => {
    // Slot 3 left: no longer an opponent, but its kept score and remembered name remain.
    const rows = scoreboardRows(
      1,
      'Me',
      [0, 2],
      names,
      new Map<PlayerSlot, number>([
        [1, 1],
        [3, 4],
      ]),
    );
    expect(rows.map((row) => [row.slot, row.name, row.score])).toEqual([
      [3, 'Eli', 4],
      [1, 'Me', 1],
      [0, 'Host', 0],
      [2, 'Dee', 0],
    ]);
  });

  it('falls back to a generic name for a slot whose name was never known', () => {
    const rows = scoreboardRows(0, 'Me', [], new Map(), new Map<PlayerSlot, number>([[2, 3]]));
    expect(rows.find((row) => row.slot === 2)?.name).toBe('Player');
  });

  it('uses the current own name, and lists the player once even if listed twice', () => {
    const rows = scoreboardRows(
      1,
      'New name',
      [1, 2],
      new Map<PlayerSlot, string>([
        [1, 'Old name'],
        [2, 'Dee'],
      ]),
      new Map<PlayerSlot, number>([[1, 2]]),
    );
    expect(rows.filter((row) => row.slot === 1)).toEqual([{ slot: 1, name: 'New name', score: 2, isYou: true }]);
    expect(rows).toHaveLength(2);
  });
});
