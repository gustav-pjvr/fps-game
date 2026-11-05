import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('DEV', true);
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.stubGlobal('location', { search: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('relaySettings', () => {
  it('defaults to P2P and requires a stored, nonblank access code for the server', async () => {
    const settings = await import('./relaySettings.ts');
    expect(settings.loadPreferredTransport()).toBe('p2p');
    expect(settings.loadAccessCode()).toBe('');
    expect(settings.serverAvailable()).toBe(false);
    settings.saveAccessCode('   ');
    expect(settings.serverAvailable()).toBe(false);
    settings.saveAccessCode('  test-only-value  ');
    expect(settings.loadAccessCode()).toBe('test-only-value');
    expect(settings.serverAvailable()).toBe(true);
    settings.saveAccessCode('');
    expect(settings.serverAvailable()).toBe(false);
  });

  it('persists both transport choices and rejects unrecognized stored values', async () => {
    const settings = await import('./relaySettings.ts');
    settings.savePreferredTransport('server');
    expect(settings.loadPreferredTransport()).toBe('server');
    settings.savePreferredTransport('p2p');
    expect(settings.loadPreferredTransport()).toBe('p2p');
    vi.stubGlobal('localStorage', { getItem: () => 'unknown' });
    expect(settings.loadPreferredTransport()).toBe('p2p');
  });

  it('works without browser storage or location', async () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('location', undefined);
    const settings = await import('./relaySettings.ts');
    expect(settings.loadAccessCode()).toBe('');
    expect(settings.loadPreferredTransport()).toBe('p2p');
    expect(settings.serverAvailable()).toBe(false);
    expect(settings.relayUrl()).toBe('ws://127.0.0.1:8080/ws');
    expect(() => settings.saveAccessCode('test-only-value')).not.toThrow();
    expect(() => settings.savePreferredTransport('server')).not.toThrow();
  });

  it('guards storage method failures', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('Storage blocked'); },
      setItem: () => { throw new Error('Storage full'); },
    });
    const settings = await import('./relaySettings.ts');
    expect(settings.loadAccessCode()).toBe('');
    expect(settings.loadPreferredTransport()).toBe('p2p');
    expect(settings.serverAvailable()).toBe(false);
    expect(() => settings.saveAccessCode('test-only-value')).not.toThrow();
    expect(() => settings.savePreferredTransport('server')).not.toThrow();
  });

  it('guards access to the storage and location globals themselves', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('Storage blocked'); },
    });
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      get: () => { throw new Error('Location blocked'); },
    });
    const settings = await import('./relaySettings.ts');
    expect(settings.loadAccessCode()).toBe('');
    expect(settings.loadPreferredTransport()).toBe('p2p');
    expect(settings.serverAvailable()).toBe(false);
    expect(settings.relayUrl()).toBe('ws://127.0.0.1:8080/ws');
    expect(() => settings.saveAccessCode('test-only-value')).not.toThrow();
    expect(() => settings.savePreferredTransport('server')).not.toThrow();
  });

  it('allows a relay query override only in development', async () => {
    vi.stubGlobal('location', { search: '?relay=wss%3A%2F%2Frelay.example%2Fws' });
    const settings = await import('./relaySettings.ts');
    expect(settings.relayUrl()).toBe('wss://relay.example/ws');
  });

  it('ignores an empty development override', async () => {
    vi.stubGlobal('location', { search: '?relay=%20' });
    const settings = await import('./relaySettings.ts');
    expect(settings.relayUrl()).toBe('ws://127.0.0.1:8080/ws');
  });

  it('allows a stored relay override only in development, below the query override', async () => {
    const settings = await import('./relaySettings.ts');
    localStorage.setItem(settings.DEV_RELAY_URL_KEY, 'ws://127.0.0.1:9173/ws');
    expect(settings.relayUrl()).toBe('ws://127.0.0.1:9173/ws');
    vi.stubGlobal('location', { search: '?relay=wss%3A%2F%2Frelay.example%2Fws' });
    expect(settings.relayUrl()).toBe('wss://relay.example/ws');
  });

  it('keeps production unavailable even with a query override, a stored override and a stored code', async () => {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('location', { search: '?relay=wss%3A%2F%2Frelay.example%2Fws' });
    const settings = await import('./relaySettings.ts');
    localStorage.setItem(settings.DEV_RELAY_URL_KEY, 'ws://127.0.0.1:9173/ws');
    settings.saveAccessCode('test-only-value');
    settings.savePreferredTransport('server');
    expect(settings.relayUrl()).toBe('');
    expect(settings.serverAvailable()).toBe(false);
  });
});
