const DEFAULT_SEED = 1337;

let currentSeed = DEFAULT_SEED;

/** Current world seed - fixed for the lifetime of a match so streaming/reload stays deterministic,
 * but mutable so a fresh match can generate a different world (see randomizeWorldSeed). */
export function getWorldSeed(): number {
  return currentSeed;
}

/** Test-only escape hatch (unit tests need to sweep many specific seeds deterministically) -
 * production code never sets a chosen seed, it only randomizes per match via randomizeWorldSeed. */
export function setWorldSeedForTesting(seed: number): void {
  currentSeed = seed >>> 0;
}

function generateRandomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/** Called once per match start (Game.create(), not the in-match practice-reset) so each new game
 * generates a different world. Terrain/vegetation/building/zone systems all read the seed via
 * getWorldSeed() rather than a frozen constant, so this takes effect for everything generated after
 * it's called. */
export function randomizeWorldSeed(): number {
  currentSeed = generateRandomSeed();
  return currentSeed;
}

/** Multiplayer only (MULTIPLAYER_PLAN.md §1): the host picks a seed via generateMultiplayerSeed()
 * before either side calls Game.create(), sends it to the guest over the DataChannel, and *both*
 * sides then call setWorldSeed() with that exact value - never randomizeWorldSeed() - so their
 * independently-generated worlds are byte-for-byte identical. Kept distinct from
 * setWorldSeedForTesting even though the mechanism is the same: that one's a test-only escape
 * hatch by convention, this one is a real production path with its own reason to exist. */
export function setWorldSeed(seed: number): void {
  currentSeed = seed >>> 0;
}

/** Host-side only - generates the one seed value both players will use, without applying it to
 * this client's own currentSeed yet (setWorldSeed does that, uniformly for both host and guest,
 * once the match is actually starting). */
export function generateMultiplayerSeed(): number {
  return generateRandomSeed();
}
