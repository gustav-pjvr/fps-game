/// <reference types="vite/client" />
import type { TransportKind } from './transport.ts';

/** The relay's WebSocket URL. Production stays empty until the server is deployed, which hides every
 * game server control; dev builds use the local relay (npm run relay:dev). Kept here rather than in
 * config.ts because config.ts is shared with the relay's Node process, where Vite's env is absent. */
export const RELAY_URL = import.meta.env.DEV ? 'ws://127.0.0.1:8080/ws' : '';
/** The transport a new room uses until the host picks another (design section 10.1: opt-in until stage 2). */
export const DEFAULT_NETWORK_TRANSPORT: TransportKind = 'p2p';

const ACCESS_CODE_KEY = 'fps-game-relay-access-code';
const TRANSPORT_KEY = 'fps-game-network-transport';

export function loadAccessCode(): string {
  try {
    return localStorage.getItem(ACCESS_CODE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function saveAccessCode(accessCode: string): void {
  try {
    localStorage.setItem(ACCESS_CODE_KEY, accessCode.trim());
  } catch {
    // Storage may be unavailable in private browsing or a sandboxed frame.
  }
}

export function loadPreferredTransport(): TransportKind {
  try {
    const stored = localStorage.getItem(TRANSPORT_KEY);
    if (stored === 'p2p' || stored === 'server') return stored;
  } catch {
    // Keep the default when storage is unavailable.
  }
  return DEFAULT_NETWORK_TRANSPORT;
}

export function savePreferredTransport(transport: TransportKind): void {
  try {
    localStorage.setItem(TRANSPORT_KEY, transport);
  } catch {
    // The current room can still use the chosen transport without persistence.
  }
}

export function relayUrl(): string {
  if (import.meta.env.DEV) {
    try {
      const override = new URLSearchParams(location.search).get('relay')?.trim();
      if (override) return override;
    } catch {
      // No browser location in Node, or access to it is restricted.
    }
  }
  return RELAY_URL;
}

export function serverAvailable(): boolean {
  return relayUrl().length > 0 && loadAccessCode().length > 0;
}
