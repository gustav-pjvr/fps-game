import { Settings } from '../settings/Settings.ts';
import { LOBBY_TRACK_IDS, loadPlaylistState, markPlayed, pickNextTrack, savePlaylistState, type PlaylistState } from './lobbyPlaylist.ts';

/** The lobby tracks, played in a shuffle that favours the unheard (docs/music.md). It lives outside
 * Game and SoundEngine: those exist only for a match, and the lobby has no audio engine. */

/** Level before the master and music volume settings: music sits under the menu clicks. */
export const LOBBY_MUSIC_LEVEL = 0.5;
/** Seconds to fade in on start and out on stop. */
export const LOBBY_FADE_IN = 2.5;
export const LOBBY_FADE_OUT = 1;
/** A track counts as heard once this much of it has played; a quick skip leaves it unheard. */
const HEARD_AFTER_SECONDS = 20;
const TICK_MS = 100;
/** Tracks in a row that may fail to load (a checkout without the music files) before giving up. */
const MAX_FAILURES = 3;

/** The fade (0 to 1) after `dt` seconds of moving toward fully in or fully out. */
export function stepFade(fade: number, wanted: boolean, dt: number): number {
  const next = fade + (wanted ? dt / LOBBY_FADE_IN : -dt / LOBBY_FADE_OUT);
  return Math.max(0, Math.min(1, next));
}

/** The element volume (0 to 1) for the current settings and fade. */
export function lobbyMusicVolume(master: number, music: number, fade: number): number {
  return Math.max(0, Math.min(1, master * music * LOBBY_MUSIC_LEVEL * fade));
}

export class LobbyMusic {
  private audio: HTMLAudioElement | null = null;
  private currentId: string | null = null;
  private playlist: PlaylistState = loadPlaylistState(LOBBY_TRACK_IDS);
  private wanted = false;
  private fade = 0;
  private heard = false;
  private failures = 0;
  private timer: number | null = null;
  private waitingForGesture = false;

  /** Begins or resumes the lobby music. Safe to call again while it is already playing. */
  start(): void {
    this.wanted = true;
    this.failures = 0;
    this.timer ??= window.setInterval(() => this.tick(TICK_MS / 1000), TICK_MS);
    if (!this.audio) this.playNext();
  }

  /** Fades the music out, then stops it; the next start picks a fresh track. */
  stop(): void {
    this.wanted = false;
  }

  dispose(): void {
    this.wanted = false;
    this.release();
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private playNext(): void {
    const id = pickNextTrack(LOBBY_TRACK_IDS, this.playlist, Math.random);
    const audio = new Audio(`/assets/music/${id}.mp3`);
    audio.preload = 'auto';
    audio.volume = 0;
    audio.addEventListener('ended', () => this.onEnded(audio));
    audio.addEventListener('error', () => this.onError(audio));
    this.audio = audio;
    this.currentId = id;
    this.heard = false;
    this.tryPlay(audio);
  }

  private tryPlay(audio: HTMLAudioElement): void {
    audio.play().catch((error: unknown) => {
      // Browsers refuse sound before the first click or key press: wait for one and try again.
      if (error instanceof DOMException && error.name === 'NotAllowedError') this.waitForGesture(audio);
      else this.onError(audio);
    });
  }

  private waitForGesture(audio: HTMLAudioElement): void {
    if (this.waitingForGesture) return;
    this.waitingForGesture = true;
    const retry = (): void => {
      window.removeEventListener('pointerdown', retry, true);
      window.removeEventListener('keydown', retry, true);
      this.waitingForGesture = false;
      if (this.wanted && this.audio === audio) this.tryPlay(audio);
    };
    window.addEventListener('pointerdown', retry, true);
    window.addEventListener('keydown', retry, true);
  }

  private onEnded(audio: HTMLAudioElement): void {
    if (this.audio !== audio) return;
    this.markHeard();
    this.release();
    if (this.wanted) this.playNext();
  }

  private onError(audio: HTMLAudioElement): void {
    if (this.audio !== audio) return;
    this.release();
    this.failures++;
    if (this.wanted && this.failures < MAX_FAILURES) this.playNext();
  }

  private markHeard(): void {
    if (this.heard || !this.currentId) return;
    this.heard = true;
    this.playlist = markPlayed(LOBBY_TRACK_IDS, this.playlist, this.currentId);
    savePlaylistState(this.playlist);
  }

  private release(): void {
    const audio = this.audio;
    this.audio = null;
    this.currentId = null;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  private tick(dt: number): void {
    this.fade = stepFade(this.fade, this.wanted, dt);
    const audio = this.audio;
    if (!audio) return;
    audio.volume = lobbyMusicVolume(Settings.getMasterVolume(), Settings.getMusicVolume(), this.fade);
    if (!this.heard && audio.currentTime >= HEARD_AFTER_SECONDS) this.markHeard();
    if (!this.wanted && this.fade === 0) this.release();
  }
}
