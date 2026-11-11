import { describe, expect, it } from 'vitest';
import { keepWindowBoundsVisible, parseWindowBounds, type WindowBounds } from '../../src/electron/windowState';

const displays = [
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: 1920, y: 0, width: 2560, height: 1440 }
];
const fallback: WindowBounds = { x: 460, y: 190, width: 1000, height: 700 };

describe('window state', () => {
  it('parses valid saved window bounds and rejects invalid dimensions', () => {
    expect(parseWindowBounds({ x: 2050, y: 120, width: 1200, height: 800 }))
      .toEqual({ x: 2050, y: 120, width: 1200, height: 800 });
    expect(parseWindowBounds({ x: 2050, y: 120, width: 200, height: 800 })).toBeNull();
    expect(parseWindowBounds(null)).toBeNull();
  });

  it('preserves window size and coordinates on a still-connected secondary display', () => {
    const savedBounds = { x: 2200, y: 160, width: 1360, height: 900 };
    expect(keepWindowBoundsVisible(savedBounds, displays, fallback)).toBe(savedBounds);
  });

  it('moves an off-screen saved window to the primary-display fallback', () => {
    expect(
      keepWindowBoundsVisible({ x: 6000, y: 3000, width: 1200, height: 800 }, displays, fallback)
    ).toBe(fallback);
  });
});
