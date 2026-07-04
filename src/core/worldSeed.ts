const DEFAULT_SEED = 1337;

let currentSeed = DEFAULT_SEED;

/** Current world seed - fixed for the lifetime of a match so streaming/reload stays deterministic,
 * but mutable so a fresh match can generate a different world (see randomizeWorldSeed). */
export function getWorldSeed(): number {
  return currentSeed;
}

/** Called once per match start (Game.create(), not the in-match practice-reset) so each new game
 * generates a different world. Terrain/vegetation/building/zone systems all read the seed via
 * getWorldSeed() rather than a frozen constant, so this takes effect for everything generated after
 * it's called. */
export function randomizeWorldSeed(): number {
  currentSeed = Math.floor(Math.random() * 0x7fffffff);
  return currentSeed;
}
