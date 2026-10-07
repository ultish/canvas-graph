/** The frame-rate cap: a client with no GPU can ask for 30 fps and halve its drawing work. */
export const DEFAULT_MAX_FPS = 60;

/** Is it too soon after the last drawn frame to draw another? (Half a millisecond of slack, so 60 fps never skips.) */
export function tooSoon(
  now: number,
  lastDrawn: number,
  maxFps: number,
): boolean {
  if (!(maxFps > 0) || maxFps >= 60) return false;
  return now - lastDrawn < 1000 / maxFps - 0.5;
}
