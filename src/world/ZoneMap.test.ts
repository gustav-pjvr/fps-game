import { describe, expect, it } from 'vitest';
import { setWorldSeedForTesting } from '../core/worldSeed.ts';
import {
  getFlatZoneSite,
  getGuaranteedFlatSites,
  getGuaranteedForestSites,
  isSiteClear,
  sampleFlatZone,
  sampleForestZone,
} from './ZoneMap.ts';
import { FLAT_ZONE_RADIUS_MIN, FOREST_ZONE_RADIUS_MIN, GUARANTEED_ZONE_COUNT } from '../core/config.ts';

/** The guaranteed-sites mechanism's own docstring records two prior approaches that failed and two
 * numeric subtleties caught only by hand-run sampling (a spawn-offset worst case shrinking ~11% of
 * sites below radiusMin, and a ~0.1% same-cell collision silently dropping the guarantee from 2
 * sites to 1). These tests lock the invariant in across a wide seed sweep instead. */
const SEED_SWEEP = 1000;

describe('guaranteed zone sites', () => {
  it('every seed yields exactly GUARANTEED_ZONE_COUNT flat and forest sites, all clear and full-size', () => {
    for (let seed = 1; seed <= SEED_SWEEP; seed++) {
      setWorldSeedForTesting(seed);

      for (const [sites, radiusMin] of [
        [getGuaranteedFlatSites(), FLAT_ZONE_RADIUS_MIN],
        [getGuaranteedForestSites(), FOREST_ZONE_RADIUS_MIN],
      ] as const) {
        expect(sites.length).toBe(GUARANTEED_ZONE_COUNT);
        for (const site of sites) {
          // Full-size: the distance band construction promises at least radiusMin regardless of
          // angle (the spawn-offset subtlety) - a shrunken site means that promise regressed.
          expect(site.radius).toBeGreaterThanOrEqual(radiusMin);
          // Clear of both the world-edge mountain ring and the spawn/combat ring.
          expect(isSiteClear(site.siteX, site.siteZ, site.radius)).toBe(true);
          // The site actually lives in the cell it claims (findGuaranteedSite matches by exact cell).
          expect(Number.isInteger(site.gx)).toBe(true);
          expect(Number.isInteger(site.gz)).toBe(true);
        }
        // Distinct cells - the same-cell collision silently halves the guarantee (the dedup pass
        // exists precisely because this happened).
        const cellKeys = new Set(sites.map((s) => `${s.gx},${s.gz}`));
        expect(cellKeys.size).toBe(GUARANTEED_ZONE_COUNT);
      }
    }
  });

  it('guaranteed flat sites are visible through the public sampling API at full membership', () => {
    for (let seed = 1; seed <= 200; seed++) {
      setWorldSeedForTesting(seed);
      for (const site of getGuaranteedFlatSites()) {
        const sample = sampleFlatZone(site.siteX, site.siteZ);
        expect(sample.type).toBe('flat');
        expect(sample.membership).toBe(1);
        // Nearest-site-wins must resolve the site's own center to itself, so terrain flattening
        // and building placement agree on ownership (the town-on-unflattened-ground bug class).
        expect(sample.siteX).toBeCloseTo(site.siteX, 6);
        expect(sample.siteZ).toBeCloseTo(site.siteZ, 6);
      }
    }
  });

  it('guaranteed forest sites are visible through the public sampling API at full membership', () => {
    for (let seed = 1; seed <= 200; seed++) {
      setWorldSeedForTesting(seed);
      for (const site of getGuaranteedForestSites()) {
        const sample = sampleForestZone(site.siteX, site.siteZ);
        expect(sample.type).toBe('forest');
        expect(sample.membership).toBe(1);
      }
    }
  });

  it('is deterministic - the same seed always yields the same sites', () => {
    setWorldSeedForTesting(777);
    const first = getGuaranteedFlatSites().map((s) => ({ ...s }));
    setWorldSeedForTesting(12345); // force a cache invalidation in between
    getGuaranteedFlatSites();
    setWorldSeedForTesting(777);
    expect(getGuaranteedFlatSites()).toEqual(first);
  });
});

describe('getFlatZoneSite consistency', () => {
  it('any site it returns wins the nearest-site contest at its own center', () => {
    for (let seed = 1; seed <= 100; seed++) {
      setWorldSeedForTesting(seed);
      // Scan the cells covering the playable world (cell size 230, world radius 400).
      for (let gx = -3; gx <= 3; gx++) {
        for (let gz = -3; gz <= 3; gz++) {
          const site = getFlatZoneSite(gx, gz);
          if (!site) continue;
          const sample = sampleFlatZone(site.siteX, site.siteZ);
          expect(sample.type).toBe('flat');
          expect(sample.gx).toBe(gx);
          expect(sample.gz).toBe(gz);
        }
      }
    }
  });
});
