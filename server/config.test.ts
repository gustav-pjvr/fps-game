import { describe, expect, it } from 'vitest';
import { ACCESS_CODE_MIN_LENGTH, ConfigError, DEFAULT_ALLOWED_ORIGINS, isOriginAllowed, loadConfig, parseAllowedOrigins } from './config.ts';

const CODE = 'correct-horse-battery';

const thrownBy = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a throw');
};

describe('config: HNG_ACCESS_CODES', () => {
  it('is required: missing, empty or only commas stops the start with a message naming the variable', () => {
    for (const raw of [undefined, '', '  ', ' , ,']) {
      const error = thrownBy(() => loadConfig({ HNG_ACCESS_CODES: raw }));
      expect(error).toBeInstanceOf(ConfigError);
      expect(error.message).toContain('HNG_ACCESS_CODES is required');
    }
  });

  it('keeps the codes only as digests: the config never prints them', () => {
    const config = loadConfig({ HNG_ACCESS_CODES: `${CODE}, second-code-for-friends ` });
    expect(config.access.count).toBe(2);
    expect(config.access.check(CODE)).toBe(true);
    expect(config.access.check('second-code-for-friends')).toBe(true);
    expect(JSON.stringify(config)).not.toContain(CODE);
    expect(String(config.access)).not.toContain(CODE);
  });

  it('refuses a code no client could send (over 128 characters) without repeating it', () => {
    const long = 'k'.repeat(129);
    const error = thrownBy(() => loadConfig({ HNG_ACCESS_CODES: long }));
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.message).not.toContain(long);
  });

  it('refuses any code under 16 characters, naming the rule and never the code', () => {
    expect(ACCESS_CODE_MIN_LENGTH).toBe(16);
    for (const weak of ['goose', 'k'.repeat(15), '123456']) {
      for (const raw of [weak, `${CODE},${weak}`, `${weak} , ${CODE}`]) {
        const error = thrownBy(() => loadConfig({ HNG_ACCESS_CODES: raw }));
        expect(error, raw).toBeInstanceOf(ConfigError);
        expect(error.message).toContain('at least 16 characters');
        expect(error.message).not.toContain(weak);
      }
    }
    expect(loadConfig({ HNG_ACCESS_CODES: 'k'.repeat(16) }).access.count).toBe(1);
  });
});

describe('config: the other variables', () => {
  it('defaults: 127.0.0.1:8080, 50 rooms, 4 players, info, the Pages site and its previews', () => {
    const config = loadConfig({ HNG_ACCESS_CODES: CODE });
    expect(config).toMatchObject({ host: '127.0.0.1', port: 8080, maxRooms: 50, maxPlayersPerRoom: 4, logLevel: 'info' });
    expect(config.allowedOrigins).toEqual(DEFAULT_ALLOWED_ORIGINS);
  });

  it('reads every variable', () => {
    const config = loadConfig({
      HNG_ACCESS_CODES: CODE,
      HNG_ALLOWED_ORIGINS: 'http://localhost:5173, https://Example.com',
      HNG_PORT: '9000',
      HNG_HOST: '0.0.0.0',
      HNG_MAX_ROOMS: '7',
      HNG_MAX_PLAYERS_PER_ROOM: '3',
      HNG_LOG_LEVEL: 'DEBUG',
    });
    expect(config).toMatchObject({ host: '0.0.0.0', port: 9000, maxRooms: 7, maxPlayersPerRoom: 3, logLevel: 'debug' });
    expect(config.allowedOrigins).toEqual(['http://localhost:5173', 'https://example.com']);
  });

  it('fails fast on a malformed value, naming the variable', () => {
    const bad: Record<string, string>[] = [
      { HNG_PORT: '0' },
      { HNG_PORT: '65536' },
      { HNG_PORT: '80a' },
      { HNG_PORT: '-1' },
      { HNG_PORT: '1e3' },
      { HNG_MAX_ROOMS: '0' },
      { HNG_MAX_ROOMS: '2.5' },
      { HNG_MAX_PLAYERS_PER_ROOM: '1' },
      { HNG_HOST: 'not a host' },
      { HNG_LOG_LEVEL: 'verbose' },
      { HNG_ALLOWED_ORIGINS: 'https://example.com/' },
      { HNG_ALLOWED_ORIGINS: 'example.com' },
      { HNG_ALLOWED_ORIGINS: 'ftp://example.com' },
      { HNG_ALLOWED_ORIGINS: 'https://*' },
    ];
    for (const env of bad) {
      const name = Object.keys(env)[0] as string;
      const error = thrownBy(() => loadConfig({ HNG_ACCESS_CODES: CODE, ...env }));
      expect(error, name).toBeInstanceOf(ConfigError);
      expect(error.message).toContain(name);
    }
  });
});

describe('config: Origin checks', () => {
  const allowed = parseAllowedOrigins('https://hunter-n-goose.pages.dev,https://*.hunter-n-goose.pages.dev,http://localhost:5173');

  it('allows the listed origins and one preview label under a wildcard', () => {
    for (const origin of ['https://hunter-n-goose.pages.dev', 'https://abc123.hunter-n-goose.pages.dev', 'https://feature-x.hunter-n-goose.pages.dev', 'http://localhost:5173', 'HTTPS://HUNTER-N-GOOSE.PAGES.DEV']) {
      expect(isOriginAllowed(origin, allowed), origin).toBe(true);
    }
  });

  it('refuses everything else, including a missing Origin', () => {
    for (const origin of [
      undefined,
      '',
      'null',
      'https://evil.example',
      'http://hunter-n-goose.pages.dev',
      'https://hunter-n-goose.pages.dev.evil.example',
      'https://evil.example/https://hunter-n-goose.pages.dev',
      'https://a.b.hunter-n-goose.pages.dev',
      'https://.hunter-n-goose.pages.dev',
      'https://evilhunter-n-goose.pages.dev',
      'https://x.hunter-n-goose.pages.dev:444',
      'http://localhost:5174',
      'http://localhost',
    ]) {
      expect(isOriginAllowed(origin, allowed), String(origin)).toBe(false);
    }
  });
});
