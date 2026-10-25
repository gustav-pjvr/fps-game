import { describe, expect, it } from 'vitest';
import { soloWeatherFromUrl } from './devWeather.ts';

describe('solo weather from the URL', () => {
  it('reads a known weather and ignores anything else', () => {
    expect(soloWeatherFromUrl('?weather=night')).toBe('night');
    expect(soloWeatherFromUrl('?perflog&weather=fog')).toBe('fog');
    expect(soloWeatherFromUrl('?weather=storm')).toBeNull();
    expect(soloWeatherFromUrl('')).toBeNull();
  });
});
