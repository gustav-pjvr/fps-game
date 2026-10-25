import { MATCH_WEATHERS, type MatchWeather } from './config.ts';

/** Single-player always plays in Day; `?weather=night` (or fog) in the URL picks another weather for
 * testing a solo match (the Valley houses' lamps, docs/enterable-buildings.md). Null when absent or
 * not a weather. */
export function soloWeatherFromUrl(search: string = typeof window === 'undefined' ? '' : window.location.search): MatchWeather | null {
  const value = new URLSearchParams(search).get('weather');
  return (MATCH_WEATHERS as readonly string[]).includes(value ?? '') ? (value as MatchWeather) : null;
}
