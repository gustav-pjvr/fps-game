import { describe, expect, it } from 'vitest';
import { nearestFocus, type FocusRect } from './gamepadFocus.ts';

const rect = (x: number, y: number, width = 20, height = 20): FocusRect => ({ x, y, width, height });

describe('spatial controller focus', () => {
  it('selects the nearest control in each direction', () => {
    const rects = [rect(100, 100), rect(40, 100), rect(140, 100), rect(100, 20), rect(100, 140), rect(200, 100)];
    expect(nearestFocus(rects, 0, 'left')).toBe(1);
    expect(nearestFocus(rects, 0, 'right')).toBe(2);
    expect(nearestFocus(rects, 0, 'up')).toBe(3);
    expect(nearestFocus(rects, 0, 'down')).toBe(4);
  });

  it('uses rectangle centers, handles offset layouts and never wraps off an edge', () => {
    const rects = [rect(0, 0, 100, 40), rect(20, 70), rect(300, 50)];
    expect(nearestFocus(rects, 0, 'down')).toBe(1);
    expect(nearestFocus(rects, 0, 'up')).toBe(0);
    expect(nearestFocus(rects, 2, 'right')).toBe(2);
  });

  it('starts on the first control and safely handles an empty screen', () => {
    expect(nearestFocus([rect(10, 10)], -1, 'down')).toBe(0);
    expect(nearestFocus([], -1, 'down')).toBe(-1);
  });
});
