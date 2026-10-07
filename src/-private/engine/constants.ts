// Interaction distances are in screen pixels, so they feel the same at every zoom.
export const ELEC_PX = 160; // the arc crackles and the port ring shows from here...
export const REACH_WORLD = 45; // ...but never further than this in the graph itself: ports in a grid sit about 100 apart, and the arc must be able to switch off between them
export const REACH_MIN_PX = 24; // ...yet never less than this on screen, or a zoomed-out handle could not be hit

/** How close (in world units) the cursor must be to a port or group handle for the ring and arc to show and a release to connect. */
export const reachAt = (scale: number): number =>
  Math.max(Math.min(ELEC_PX / scale, REACH_WORLD), REACH_MIN_PX / scale);
export const RING_PX = 18; // inside the port ring the wire is snapped
export const NEAR_SCALE = 0.5; // ports are grabbable from here up
export const GROUP_SCALE = 0.6; // group handles are grabbable below here

export const ringR = (scale: number): number => Math.max(15, RING_PX / scale);

export const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
