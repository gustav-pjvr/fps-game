import { describe, expect, it } from 'vitest';
import { NETWORK_BLOCKED_MESSAGE, classifyPeerError } from './PeerConnection.ts';

describe('classifyPeerError', () => {
  it('maps an unknown room code to roomNotFound', () => {
    expect(classifyPeerError('peer-unavailable', 'Could not connect to peer fpsgame-ABCDEF')).toEqual({
      kind: 'roomNotFound',
      message: 'No room found with that code.',
    });
  });

  it('maps an ICE negotiation failure to networkBlocked with a player-facing explanation', () => {
    const result = classifyPeerError('negotiation-failed', 'Negotiation of connection to fpsgame-ABCDEF failed.');
    expect(result.kind).toBe('networkBlocked');
    expect(result.message).toBe(NETWORK_BLOCKED_MESSAGE);
  });

  it.each(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'])(
    'treats broker-level error %s as brokerLost, never as a dead data channel',
    (type) => {
      expect(classifyPeerError(type, 'Lost connection to server.').kind).toBe('brokerLost');
    },
  );

  it('keeps a code collision distinct so the host can retry', () => {
    expect(classifyPeerError('unavailable-id', 'ID "fpsgame-ABCDEF" is taken').kind).toBe('roomCodeTaken');
  });

  it('passes other errors through with their own text, or a fallback when empty', () => {
    expect(classifyPeerError('webrtc', 'ICE failed')).toEqual({ kind: 'other', message: 'ICE failed' });
    expect(classifyPeerError('webrtc', '')).toEqual({ kind: 'other', message: 'Connection error.' });
  });
});
