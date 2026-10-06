/** The default cap on canvas pixel density. A 2x or 3x screen means 4-9x the pixels to fill, which is what hurts a CPU-only client. */
export const DEFAULT_MAX_PIXEL_RATIO = 1.5;

/** The pixel ratio to draw at: the device's, never below 1, never above the cap. */
export function effectivePixelRatio(
  device: number,
  max: number = DEFAULT_MAX_PIXEL_RATIO,
): number {
  const d = Number.isFinite(device) && device > 0 ? device : 1;
  const cap =
    Number.isFinite(max) || max === Infinity
      ? Math.max(1, max)
      : DEFAULT_MAX_PIXEL_RATIO;
  return Math.min(Math.max(1, d), cap);
}
