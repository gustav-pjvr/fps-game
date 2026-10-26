import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_WEATHER, MATCH_WEATHERS, MATCH_WEATHER_LABELS } from './config.ts';
import { lookFor } from '../render/look.ts';
import { torchAvailable } from '../render/Flashlight.ts';

// The solo setup (ui/menu/PlaySetupModal.ts) lists MATCH_WEATHERS with MATCH_WEATHER_LABELS, so
// every choice it offers needs a label, a look and a defined torch rule.
describe('the weather a solo player can pick', () => {
  it('offers the three weathers a Create Room host has, Dusk first', () => {
    expect(MATCH_WEATHERS.map((weather) => MATCH_WEATHER_LABELS[weather])).toEqual(['Dusk', 'Night', 'Fog']);
    expect(MATCH_WEATHERS[0]).toBe(DEFAULT_MATCH_WEATHER);
  });

  it('gives every choice a look', () => {
    for (const weather of MATCH_WEATHERS) expect(lookFor(weather)).toBeDefined();
  });

  it('puts the torch in the Valley at Night and in Fog, not at Dusk', () => {
    expect(MATCH_WEATHERS.filter((weather) => torchAvailable('valley', weather))).toEqual(['night', 'fog']);
  });
});
