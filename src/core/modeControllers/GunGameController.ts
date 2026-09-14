import type { Player } from '../../entities/Player.ts';
import type { WeaponManager } from '../../weapons/WeaponManager.ts';
import type { GooseAnnouncement } from '../../ui/gooseAnnouncement.ts';
import type { MultiplayerSession } from '../../network/MultiplayerSession.ts';
import type { MultiplayerMatchState } from '../../network/MultiplayerMatchState.ts';

/** Gun Game's own golden-goose variant (per explicit user request, replacing the ambient bonus
 * goose disabled for every non-default mode - see the old create()'s isBonusGooseEnabled comment):
 * whoever is exactly one kill from the win threshold must be carrying the Goose Launcher and land
 * the winning kill with it. Purely self-authoritative - each client only ever watches and grants
 * its own weapon, same trust model as every other per-client-authoritative piece of this protocol.
 * Split out of Game.ts's updateMultiplayer(), which previously kept `gunGameFinisherPending` as a
 * separate Game field alongside this same check.
 *
 * The complementary half of Gun Game - "landing a kill upgrades your weapon" - lives in
 * MatchMessageRouter's 'playerDied' case (pickGunGameUpgrade), not here: that reacts to a kill
 * message arriving, this reacts to the local scoreboard every tick. Multiplayer-only mode (see
 * gameModes.ts) - Game.create() only constructs this when multiplayer.gameMode === 'gunGame'. */
export class GunGameController {
  /** Guards the grant below from re-firing every tick while the async weapon swap
   * (WeaponManager.grantBonusWeapon) is still in flight - without it, several overlapping grants
   * would fire before the first one resolves and activeWeaponId actually flips to 'gooseLauncher'. */
  private finisherPending = false;

  constructor(
    private readonly session: MultiplayerSession,
    private readonly matchState: MultiplayerMatchState,
    private readonly gooseAnnouncement: GooseAnnouncement,
  ) {}

  /** Checked every tick rather than only at the moment of the second-to-last kill so that missing
   * all 4 shots and falling back to the previous gun (see WeaponManager.grantBonusWeapon's own
   * auto-revert once the disableReload magazine empties) just re-triggers the grant next tick
   * instead of letting the finishing kill land with anything else. `weaponManager` is passed in
   * fresh each call (not captured) since a mid-match Loadout change can rebuild Game's own
   * WeaponManager instance between ticks. */
  checkFinisherGrant(player: Player, weaponManager: WeaponManager, killLimit: number): void {
    // A kill limit of 1 (allowed by the room screen) made "one kill from winning" true at score 0,
    // forcing every player onto the launcher from spawn. There is no finisher round in that match.
    if (killLimit <= 1 || player.isDead || this.finisherPending) return;

    const ownScore = this.matchState.scoreboard.get(this.session.ownSlot) ?? 0;
    const oneKillFromWin = ownScore === killLimit - 1;
    if (!oneKillFromWin || weaponManager.activeWeaponId === 'gooseLauncher') return;

    this.finisherPending = true;
    const previousWeaponId = weaponManager.activeWeaponId;
    this.gooseAnnouncement.show('One kill from victory - finish it with the Goose Launcher!');
    void weaponManager.grantBonusWeapon('gooseLauncher', previousWeaponId).then(() => {
      this.finisherPending = false;
    });
  }
}
