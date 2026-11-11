import { describe, expect, it } from 'vitest';
import { WEAPON_DEFINITIONS, weaponIdsIn } from './definitions.ts';
import { BLOOM_HOLD_SECONDS, BLOOM_SETTLE_SECONDS, MOA, recoilForShot, SPRAY_RESET_SECONDS, spreadForShot, SprayState, type GunRecoil, type GunSpread } from './gunHandling.ts';

const GUN_IDS = [...weaponIdsIn('primary'), ...weaponIdsIn('secondary')];
const gun = (id: string): { spread: GunSpread; recoil: GunRecoil; fireRate: number; automatic: boolean } => {
  const definition = WEAPON_DEFINITIONS[id]!;
  return { spread: definition.spread!, recoil: definition.recoil!, fireRate: definition.fireRate, automatic: definition.automatic };
};

/** The view's total climb and its widest sideways swing over a burst of `shots`, with no random
 * part and nothing settling between shots: the shape of the pattern itself. */
function burst(recoil: GunRecoil, shots: number, aim = 1): { climb: number; sides: number[] } {
  let climb = 0;
  const sides: number[] = [];
  for (let i = 0; i < shots; i++) {
    const step = recoilForShot(recoil, i, aim, 0);
    climb += step.kick;
    sides.push(step.side);
  }
  return { climb, sides };
}

describe('spreadForShot', () => {
  const spread: GunSpread = { aimed: 0.001, hip: 0.02, moving: 0.01, bloomPerShot: 0.001, bloomMax: 0.005 };

  it('is the gun\'s own error when aimed and still, and the hip\'s when not', () => {
    expect(spreadForShot(spread, 1, 0, 0)).toBeCloseTo(0.001);
    expect(spreadForShot(spread, 0, 0, 0)).toBeCloseTo(0.02);
    expect(spreadForShot(spread, 0.5, 0, 0)).toBeCloseTo(0.0105);
  });

  it('opens with movement, four times as much from the hip as aimed', () => {
    expect(spreadForShot(spread, 0, 0, 1) - spreadForShot(spread, 0, 0, 0)).toBeCloseTo(0.01);
    expect(spreadForShot(spread, 1, 0, 1) - spreadForShot(spread, 1, 0, 0)).toBeCloseTo(0.0025);
    expect(spreadForShot(spread, 0, 0, 5)).toBeCloseTo(spreadForShot(spread, 0, 0, 1));
  });

  it('adds a burst\'s bloom, twice as much from the hip', () => {
    expect(spreadForShot(spread, 1, 0.004, 0)).toBeCloseTo(0.005);
    expect(spreadForShot(spread, 0, 0.004, 0)).toBeCloseTo(0.028);
  });
});

describe('recoilForShot', () => {
  const recoil: GunRecoil = { kick: 0.01, side: 0.004, climbShots: 5, sustain: 0.4, drift: 0.25, aimed: 0.8 };

  it('climbs at full strength for the first shots, then at the sustained share', () => {
    expect(recoilForShot(recoil, 0, 0, 0).kick).toBeCloseTo(0.01);
    expect(recoilForShot(recoil, 4, 0, 0).kick).toBeCloseTo(0.01);
    expect(recoilForShot(recoil, 5, 0, 0).kick).toBeCloseTo(0.004);
    expect(recoilForShot(recoil, 40, 0, 0).kick).toBeCloseTo(0.004);
  });

  it('kicks less when aimed and shouldered', () => {
    expect(recoilForShot(recoil, 0, 1, 0).kick).toBeCloseTo(0.008);
    expect(recoilForShot(recoil, 0, 0.5, 0).kick).toBeCloseTo(0.009);
  });

  it('pulls one way while it climbs, then weaves to both sides', () => {
    const { sides } = burst(recoil, 30, 0);
    const climbing = sides.slice(0, 5);
    expect(climbing.every((side) => side > 0)).toBe(true);
    const weaving = sides.slice(5);
    expect(Math.max(...weaving)).toBeGreaterThan(0);
    expect(Math.min(...weaving)).toBeLessThan(0);
    // Never past the gun's own sideways kick.
    for (const side of sides) expect(Math.abs(side)).toBeLessThanOrEqual(recoil.side * 1.0001);
  });

  it('keeps most of the sideways kick as the gun\'s pattern, the rest random', () => {
    const left = recoilForShot(recoil, 0, 0, 1).side;
    const right = recoilForShot(recoil, 0, 0, -1).side;
    const centre = recoilForShot(recoil, 0, 0, 0).side;
    expect(left).toBeGreaterThan(centre);
    expect(right).toBeLessThan(centre);
    expect(left - right).toBeCloseTo(recoil.side * 0.7);
  });
});

describe('SprayState', () => {
  const spread: GunSpread = { aimed: 0.001, hip: 0.02, moving: 0.01, bloomPerShot: 0.002, bloomMax: 0.005 };

  it('counts the shots of a burst and starts again after a pause', () => {
    const spray = new SprayState();
    for (let i = 0; i < 4; i++) {
      expect(spray.shotIndex).toBe(i);
      spray.shot(spread);
      spray.update(0.1, spread);
    }
    expect(spray.firing).toBe(true);
    spray.update(SPRAY_RESET_SECONDS, spread);
    expect(spray.firing).toBe(false);
    expect(spray.shotIndex).toBe(0);
  });

  it('builds bloom up to its cap and settles it once the firing stops', () => {
    const spray = new SprayState();
    for (let i = 0; i < 10; i++) spray.shot(spread);
    expect(spray.bloom).toBeCloseTo(spread.bloomMax);
    // Nothing settles for a moment after a shot, so shots in quick succession stack.
    spray.update(BLOOM_HOLD_SECONDS, spread);
    expect(spray.bloom).toBeCloseTo(spread.bloomMax);
    spray.update(BLOOM_SETTLE_SECONDS / 2, spread);
    expect(spray.bloom).toBeCloseTo(spread.bloomMax / 2);
    spray.update(BLOOM_SETTLE_SECONDS, spread);
    expect(spray.bloom).toBe(0);
  });

  it('keeps the bloom of automatic fire through the gaps between its shots, and lets slow aimed fire recover', () => {
    const rifle = WEAPON_DEFINITIONS['rifle']!;
    const spray = new SprayState();
    for (let i = 0; i < 8; i++) {
      spray.shot(rifle.spread!);
      spray.update(1 / rifle.fireRate, rifle.spread!);
    }
    expect(spray.bloom).toBeCloseTo(Math.min(rifle.spread!.bloomMax, 8 * rifle.spread!.bloomPerShot));

    const revolver = WEAPON_DEFINITIONS['revolver']!;
    const slow = new SprayState();
    slow.shot(revolver.spread!);
    // One long frame covering the whole gap between two revolver shots still only settles the part past the hold.
    slow.update(1 / revolver.fireRate, revolver.spread!);
    expect(slow.bloom).toBeLessThan(revolver.spread!.bloomPerShot * 0.5);
  });

  it('starts fresh for another weapon', () => {
    const spray = new SprayState();
    spray.shot(spread);
    spray.reset();
    expect(spray.shotIndex).toBe(0);
    expect(spray.bloom).toBe(0);
    expect(spray.firing).toBe(false);
  });
});

describe('the arsenal\'s handling, by the kind of gun (docs/gun-handling.md)', () => {
  it('gives every hitscan gun a spread and a recoil that agree with its summary fields', () => {
    for (const id of GUN_IDS) {
      const definition = WEAPON_DEFINITIONS[id]!;
      expect(definition.spread, id).toBeDefined();
      expect(definition.recoil, id).toBeDefined();
      expect(definition.spreadRadians, id).toBe(definition.spread!.hip);
      expect(definition.recoilKick, id).toBe(definition.recoil!.kick);
      expect(definition.recoilSide, id).toBe(definition.recoil!.side);
      expect(definition.adsSpreadMultiplier, id).toBeCloseTo(definition.spread!.aimed / definition.spread!.hip, 3);
      // Aiming never makes a gun less accurate, and movement and bloom never make it more.
      expect(definition.spread!.aimed, id).toBeLessThanOrEqual(definition.spread!.hip);
      expect(definition.spread!.moving, id).toBeGreaterThanOrEqual(0);
      expect(definition.spread!.bloomMax, id).toBeGreaterThanOrEqual(definition.spread!.bloomPerShot);
      expect(definition.recoil!.sustain, id).toBeGreaterThan(0);
      expect(definition.recoil!.sustain, id).toBeLessThanOrEqual(1);
      expect(definition.recoil!.aimed, id).toBeLessThanOrEqual(1);
    }
    // The launcher throws a goose and the blades cut: neither has a gun's handling.
    expect(WEAPON_DEFINITIONS['gooseLauncher']!.spread).toBeUndefined();
    expect(WEAPON_DEFINITIONS['knife']!.recoil).toBeUndefined();
  });

  it('orders aimed precision as the real guns are: sniper, marksman, battle rifle, assault rifle, then the pistol calibres', () => {
    const aimed = (id: string): number => gun(id).spread.aimed;
    expect(aimed('sniper')).toBeLessThan(aimed('dmr'));
    expect(aimed('dmr')).toBeLessThan(aimed('battleRifle'));
    expect(aimed('battleRifle')).toBeLessThan(aimed('rifle'));
    expect(aimed('rifle')).toBeLessThan(aimed('smg'));
    expect(aimed('smg')).toBeLessThan(aimed('machinePistol'));
    // Half a minute of angle for the sniper, about four for the service rifle.
    expect(aimed('sniper') * 2).toBeCloseTo(0.5 * MOA, 6);
    expect(aimed('rifle') * 2).toBeCloseTo(4 * MOA, 6);
    // No bullet gun scatters more than a tenth of a degree when aimed and still.
    for (const id of GUN_IDS.filter((id) => WEAPON_DEFINITIONS[id]!.pelletCount === 1)) expect(aimed(id), id).toBeLessThan(0.0018);
  });

  it('gives the shotguns the gun\'s own pattern aimed or not, the sawn-off the wider one', () => {
    for (const id of ['shotgun', 'sawnOff']) {
      const { spread } = gun(id);
      // The pattern is the barrel's: aiming tightens it by a third at most.
      expect(spread.aimed / spread.hip, id).toBeGreaterThan(0.6);
      expect(spread.bloomPerShot, id).toBe(0);
    }
    // About 8 inches across at 10 yards for buckshot from an open barrel: 0.2 m at 9.1 m.
    const acrossAtTenYards = 2 * 9.144 * Math.tan(gun('shotgun').spread.aimed);
    expect(acrossAtTenYards).toBeGreaterThan(0.2);
    expect(acrossAtTenYards).toBeLessThan(0.45);
    expect(gun('sawnOff').spread.aimed).toBeGreaterThan(gun('shotgun').spread.aimed * 1.4);
  });

  it('makes the long guns poor from the hip and the sidearms handy', () => {
    const hip = (id: string): number => gun(id).spread.hip;
    expect(hip('pistol')).toBeLessThan(hip('rifle'));
    expect(hip('rifle')).toBeLessThan(hip('battleRifle'));
    expect(hip('battleRifle')).toBeLessThan(hip('lmg'));
    expect(hip('lmg')).toBeLessThan(hip('sniper'));
    // The scoped rifles lose the most by not being aimed.
    expect(hip('sniper') / gun('sniper').spread.aimed).toBeGreaterThan(hip('rifle') / gun('rifle').spread.aimed);
    // The heavy guns suffer most on the move.
    expect(gun('lmg').spread.moving).toBeGreaterThan(gun('rifle').spread.moving);
    expect(gun('rifle').spread.moving).toBeGreaterThan(gun('pistol').spread.moving);
  });

  it('sizes each kick to its cartridge and the weight behind it', () => {
    const kick = (id: string): number => gun(id).recoil.kick;
    // Shouldered guns: pistol calibre, intermediate, full power, magnum.
    expect(kick('smg')).toBeLessThan(kick('rifle'));
    expect(kick('rifle')).toBeLessThan(kick('battleRifle'));
    expect(kick('battleRifle')).toBeLessThan(kick('sniper'));
    // The same full power cartridge kicks about the same in the battle rifle and the marksman rifle.
    expect(kick('dmr') / kick('battleRifle')).toBeGreaterThan(0.8);
    expect(kick('dmr') / kick('battleRifle')).toBeLessThan(1.4);
    // The machine gun's weight soaks up more than the rifle's.
    expect(kick('lmg')).toBeLessThan(kick('rifle'));
    // In the hand: the 9 mm pistol kicks more than the same round in a shouldered gun, the magnum far more.
    expect(kick('pistol')).toBeGreaterThan(kick('smg'));
    expect(kick('revolver')).toBeGreaterThan(kick('pistol') * 3);
    // Twelve gauge: more than any rifle but the magnum, and the light sawn-off most of all.
    expect(kick('shotgun')).toBeGreaterThan(kick('battleRifle') * 2);
    expect(kick('sawnOff')).toBeGreaterThan(kick('shotgun'));
  });

  it('shapes a magazine of automatic fire by the gun: the rifle climbs then settles, the battle rifle fights, the machine gun steadies', () => {
    const climbOf = (id: string, shots: number): number => burst(gun(id).recoil, shots).climb;
    // A ten round burst lifts the battle rifle more than twice as far as the assault rifle.
    expect(climbOf('battleRifle', 10)).toBeGreaterThan(climbOf('rifle', 10) * 2);
    // The SMG is the easiest automatic to hold on target over ten rounds.
    expect(climbOf('smg', 10)).toBeLessThan(climbOf('rifle', 10));
    // The machine pistol, with no stock, lifts more than either shouldered 9 mm gun.
    expect(climbOf('machinePistol', 10)).toBeGreaterThan(climbOf('smg', 10) * 1.8);
    // Late in a long burst the machine gun climbs less per shot than the rifle does: it steadies.
    const late = (id: string): number => recoilForShot(gun(id).recoil, 25, 1, 0).kick;
    expect(late('lmg')).toBeLessThan(late('rifle'));
    // Every automatic settles: its sustained climb is under its first shots'.
    for (const id of GUN_IDS.filter((id) => gun(id).automatic)) expect(gun(id).recoil.sustain, id).toBeLessThan(1);
  });

  it('gives the single shot guns one kick and no spray', () => {
    for (const id of ['sniper', 'revolver', 'shotgun', 'sawnOff']) {
      expect(gun(id).recoil.climbShots, id).toBe(1);
      expect(gun(id).recoil.sustain, id).toBe(1);
    }
    for (const id of ['sniper', 'shotgun', 'sawnOff']) expect(gun(id).spread.bloomMax, id).toBe(0);
  });
});
