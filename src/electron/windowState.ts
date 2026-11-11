export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DisplayWorkArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function parseWindowBounds(value: unknown): WindowBounds | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const bounds = value as Record<string, unknown>;
  if (
    typeof bounds.x !== 'number' || !Number.isFinite(bounds.x) ||
    typeof bounds.y !== 'number' || !Number.isFinite(bounds.y) ||
    typeof bounds.width !== 'number' || !Number.isFinite(bounds.width) ||
    typeof bounds.height !== 'number' || !Number.isFinite(bounds.height) ||
    bounds.width < 320 || bounds.width > 10000 ||
    bounds.height < 240 || bounds.height > 10000
  ) {
    return null;
  }
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

export function keepWindowBoundsVisible(
  bounds: WindowBounds | null,
  displays: readonly DisplayWorkArea[],
  fallback: WindowBounds
): WindowBounds {
  if (!bounds) return fallback;

  const isVisible = displays.some(display => {
    const intersectionWidth = Math.max(
      0,
      Math.min(bounds.x + bounds.width, display.x + display.width) - Math.max(bounds.x, display.x)
    );
    const intersectionHeight = Math.max(
      0,
      Math.min(bounds.y + bounds.height, display.y + display.height) - Math.max(bounds.y, display.y)
    );
    return intersectionWidth >= Math.min(100, bounds.width) &&
      intersectionHeight >= Math.min(100, bounds.height);
  });
  return isVisible ? bounds : fallback;
}
