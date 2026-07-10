import { describe, expect, it } from 'vitest';
import { Weapon } from './Weapon.ts';
import { WEAPON_DEFINITIONS } from './definitions.ts';

// Real weapon definitions, not ad-hoc fixtures - matches archetypes.test.ts's approach of testing
// against the actual configured data rather than a stand-in shape that could drift from it.
const PISTOL = WEAPON_DEFINITIONS.pistol!;
const MP5 = WEAPON_DEFINITIONS.mp5!;

describe('Weapon ammo/reload (unlimited reserve - every mode except Goose Horde multiplayer)', () => {
  it('starts with a full magazine', () => {
    const weapon = new Weapon(PISTOL);
    expect(weapon.ammo).toBe(PISTOL.magazineSize);
    expect(weapon.reserve).toBeNull();
  });

  it('tryFire decrements ammo by one and starts the fire-rate cooldown', () => {
    const weapon = new Weapon(PISTOL);
    expect(weapon.tryFire()).toBe(true);
    expect(weapon.ammo).toBe(PISTOL.magazineSize - 1);
  });

  it('tryFire fails while the fire-rate cooldown is still active', () => {
    const weapon = new Weapon(PISTOL);
    weapon.tryFire();
    expect(weapon.tryFire()).toBe(false);
    expect(weapon.ammo).toBe(PISTOL.magazineSize - 1);
  });

  it('tryFire succeeds again once the cooldown elapses', () => {
    const weapon = new Weapon(PISTOL);
    weapon.tryFire();
    weapon.update(1 / PISTOL.fireRate + 0.001);
    expect(weapon.tryFire()).toBe(true);
    expect(weapon.ammo).toBe(PISTOL.magazineSize - 2);
  });

  it('tryFire fails outright once the magazine is empty', () => {
    const weapon = new Weapon(PISTOL);
    for (let i = 0; i < PISTOL.magazineSize; i++) {
      weapon.tryFire();
      weapon.update(1 / PISTOL.fireRate + 0.001);
    }
    expect(weapon.ammo).toBe(0);
    expect(weapon.tryFire()).toBe(false);
  });

  it('startReload begins a reload and blocks firing until it completes', () => {
    const weapon = new Weapon(PISTOL);
    weapon.tryFire();
    expect(weapon.startReload()).toBe(true);
    expect(weapon.isReloading).toBe(true);
    expect(weapon.tryFire()).toBe(false);
  });

  it('startReload refuses to start when the magazine is already full', () => {
    const weapon = new Weapon(PISTOL);
    expect(weapon.startReload()).toBe(false);
  });

  it('startReload refuses to start a second reload while one is already in progress', () => {
    const weapon = new Weapon(PISTOL);
    weapon.tryFire();
    weapon.startReload();
    expect(weapon.startReload()).toBe(false);
  });

  it('update() refills the magazine to full once reloadTime elapses (unlimited reserve)', () => {
    const weapon = new Weapon(PISTOL);
    weapon.tryFire();
    weapon.update(1 / PISTOL.fireRate + 0.001); // clear the fire-rate cooldown before the 2nd shot
    weapon.tryFire();
    weapon.startReload();
    weapon.update(PISTOL.reloadTime - 0.001);
    expect(weapon.isReloading).toBe(true);
    expect(weapon.ammo).toBe(PISTOL.magazineSize - 2);

    weapon.update(0.002);
    expect(weapon.isReloading).toBe(false);
    expect(weapon.ammo).toBe(PISTOL.magazineSize);
  });

  it('reloadProgress rises from 0 to 1 across the reload and reports 0 outside of one', () => {
    const weapon = new Weapon(PISTOL);
    expect(weapon.reloadProgress).toBe(0);
    weapon.tryFire();
    weapon.startReload();
    expect(weapon.reloadProgress).toBe(0);
    weapon.update(PISTOL.reloadTime / 2);
    expect(weapon.reloadProgress).toBeCloseTo(0.5, 5);
  });

  it('a melee weapon (Infinity magazine) never runs out and never reloads', () => {
    const knife = WEAPON_DEFINITIONS.knife!;
    const weapon = new Weapon(knife);
    for (let i = 0; i < 50; i++) {
      expect(weapon.tryFire()).toBe(true);
      weapon.update(1 / knife.fireRate + 0.001);
    }
    expect(weapon.ammo).toBe(Infinity);
  });

  it('a disableReload weapon (Goose Launcher) can never start a reload', () => {
    const launcher = WEAPON_DEFINITIONS.gooseLauncher!;
    const weapon = new Weapon(launcher);
    weapon.tryFire();
    expect(weapon.startReload()).toBe(false);
  });
});

describe('Weapon reserve ammo (Goose Horde multiplayer only)', () => {
  it('reload draws from the reserve instead of refilling for free', () => {
    const weapon = new Weapon(PISTOL, undefined, 5); // 5 rounds of reserve beyond the starting magazine
    for (let i = 0; i < PISTOL.magazineSize; i++) {
      weapon.tryFire();
      weapon.update(1 / PISTOL.fireRate + 0.001);
    }
    expect(weapon.ammo).toBe(0);

    weapon.startReload();
    weapon.update(PISTOL.reloadTime + 0.001);

    // Only 5 reserve rounds were available, so the magazine refills to 5, not a full magazineSize.
    expect(weapon.ammo).toBe(5);
    expect(weapon.reserve).toBe(0);
  });

  it('a reload only draws exactly what the magazine needs, leaving the rest in reserve', () => {
    const weapon = new Weapon(PISTOL, undefined, 50);
    weapon.tryFire(); // magazine now down by 1
    weapon.startReload();
    weapon.update(PISTOL.reloadTime + 0.001);

    expect(weapon.ammo).toBe(PISTOL.magazineSize);
    expect(weapon.reserve).toBe(49); // only the 1 round actually needed was drawn
  });

  it('startReload refuses to start once the reserve itself is exhausted', () => {
    const weapon = new Weapon(PISTOL, undefined, 0);
    weapon.tryFire();
    expect(weapon.startReload()).toBe(false);
  });

  it('addReserveAmmo tops up the reserve pool (ammo-drop pickup)', () => {
    const weapon = new Weapon(PISTOL, undefined, 2);
    weapon.addReserveAmmo(10);
    expect(weapon.reserve).toBe(12);
  });

  it('addReserveAmmo is a no-op for a weapon with unlimited reserve', () => {
    const weapon = new Weapon(PISTOL);
    weapon.addReserveAmmo(10);
    expect(weapon.reserve).toBeNull();
  });

  it('refillAmmo restores the reserve back to its starting value, not to unlimited', () => {
    const weapon = new Weapon(PISTOL, undefined, 5);
    weapon.addReserveAmmo(10); // reserve now 15
    weapon.tryFire();
    weapon.refillAmmo();
    expect(weapon.ammo).toBe(PISTOL.magazineSize);
    expect(weapon.reserve).toBe(5); // back to the starting reserve, not the topped-up 15
  });
});

describe('Weapon effectiveDamage', () => {
  it('uses the definition damage when no override is set', () => {
    const weapon = new Weapon(PISTOL);
    expect(weapon.effectiveDamage).toBe(PISTOL.damage);
  });

  it('uses the override when a per-match damage override is set (e.g. 1 Shot 1 Kill)', () => {
    const weapon = new Weapon(PISTOL, 999);
    expect(weapon.effectiveDamage).toBe(999);
  });
});

describe('Weapon burst-fire round accounting (MP5, WeaponDefinition.burstCount) - the v3.8.1 bug class', () => {
  it('consumeBurstRound decrements ammo exactly like tryFire, independent of the fire-rate cooldown', () => {
    const weapon = new Weapon(MP5);
    // tryFire's own cooldown (1/fireRate) is set the moment the burst's opening shot fires - the
    // bug this locks in: consumeBurstRound() (used for the burst's 2nd/3rd round) must NOT be
    // gated by that same cooldown, or every follow-up round in the burst silently fails and the
    // gun fires exactly one round instead of MP5's configured burstCount of 3.
    expect(weapon.tryFire()).toBe(true); // round 1 of the burst - sets the cooldown
    expect(weapon.consumeBurstRound()).toBe(true); // round 2 - must succeed despite the cooldown
    expect(weapon.consumeBurstRound()).toBe(true); // round 3
    expect(weapon.ammo).toBe(MP5.magazineSize - 3);
  });

  it('consumeBurstRound fails once the magazine actually runs dry mid-burst, ending the burst early', () => {
    const weapon = new Weapon(PISTOL); // magazineSize 12, so 3 fires away from empty is easy to reach
    for (let i = 0; i < 11; i++) weapon.consumeBurstRound();
    expect(weapon.ammo).toBe(1);
    expect(weapon.consumeBurstRound()).toBe(true);
    expect(weapon.ammo).toBe(0);
    expect(weapon.consumeBurstRound()).toBe(false);
  });

  it('consumeBurstRound refuses to fire while a reload is in progress', () => {
    const weapon = new Weapon(MP5);
    weapon.tryFire();
    weapon.startReload();
    expect(weapon.consumeBurstRound()).toBe(false);
  });
});
