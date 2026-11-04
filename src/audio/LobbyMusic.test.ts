import { describe, expect, it } from 'vitest';
import { LOBBY_FADE_IN, LOBBY_FADE_OUT, LOBBY_MUSIC_LEVEL, lobbyMusicVolume, stepFade } from './LobbyMusic.ts';

describe('stepFade', () => {
  it('rises to full over the fade-in time and no further', () => {
    let fade = 0;
    for (let t = 0; t < LOBBY_FADE_IN; t += 0.1) fade = stepFade(fade, true, 0.1);
    expect(fade).toBeCloseTo(1, 1);
    expect(stepFade(1, true, 5)).toBe(1);
  });

  it('falls to silence over the fade-out time and no further', () => {
    expect(stepFade(1, false, LOBBY_FADE_OUT)).toBe(0);
    expect(stepFade(0.2, false, 5)).toBe(0);
  });
});

describe('lobbyMusicVolume', () => {
  it('follows the master and music settings and the fade', () => {
    expect(lobbyMusicVolume(1, 1, 1)).toBeCloseTo(LOBBY_MUSIC_LEVEL);
    expect(lobbyMusicVolume(0.5, 0.6, 1)).toBeCloseTo(0.3 * LOBBY_MUSIC_LEVEL);
    expect(lobbyMusicVolume(1, 1, 0.5)).toBeCloseTo(0.5 * LOBBY_MUSIC_LEVEL);
  });

  it('is silent when either volume is zero and never leaves 0 to 1', () => {
    expect(lobbyMusicVolume(0, 1, 1)).toBe(0);
    expect(lobbyMusicVolume(1, 0, 1)).toBe(0);
    expect(lobbyMusicVolume(9, 9, 9)).toBe(1);
  });
});
