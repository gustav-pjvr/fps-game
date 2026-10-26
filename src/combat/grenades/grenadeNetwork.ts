import type { ActiveMultiplayer } from '../../network/multiplayerMatchTypes.ts';
import type { GrenadeNetwork, GrenadeOpponent } from './GrenadeSystem.ts';

/** GrenadeSystem's view of a running multiplayer match: this client's slot, the connection (the
 * host relays grenadeThrown and grenadeDetonated on to everyone), and the other players a frag can
 * damage. A Goose Horde player out of lives counts as dead. */
export function grenadeNetworkFor(multiplayer: ActiveMultiplayer): GrenadeNetwork {
  return {
    ownSlot: multiplayer.session.ownSlot,
    send: (message) => multiplayer.session.connection.send(message),
    opponents: () =>
      Array.from(multiplayer.opponents.values(), (opponent): GrenadeOpponent => ({
        slot: opponent.slot,
        position: opponent.remotePlayer.position,
        entity: opponent.remotePlayer,
        isDead: opponent.isDead || multiplayer.hordeEliminatedSlots.has(opponent.slot),
      })),
  };
}
