import { describe, expect, it } from 'vitest';
import { floatingPieces } from './floatingGeometry.ts';
import { WEAPON_MODEL_BUILDERS } from './registry.ts';
import { SKIN_IDS } from './skins.ts';
import { getWeaponBlueprint } from './weaponModels.ts';

const round = (values: readonly number[]): string => values.map((value) => value.toFixed(3)).join(', ');

describe('no weapon has a piece floating free of it', () => {
  for (const id of Object.keys(WEAPON_MODEL_BUILDERS)) {
    it(`${id}, in every skin`, () => {
      const found: string[] = [];
      for (const skinId of SKIN_IDS) {
        for (const piece of floatingPieces(getWeaponBlueprint(id, skinId))) {
          found.push(`${skinId}: ${piece.slot} on ${piece.part} at [${round(piece.centre)}] size [${round(piece.size)}], ${(piece.distance * 1000).toFixed(1)} mm clear`);
        }
      }
      expect(found, `\n${found.join('\n')}\n`).toEqual([]);
    });
  }
});
