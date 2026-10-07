// Interaction distances are in screen pixels, so they feel the same at every zoom.
export const ELEC_PX = 160; // the arc crackles and the port ring shows from here...
export const REACH_WORLD = 140; // ...but never further than this in the graph itself: zoomed out, 160px would span whole columns
export const RING_PX = 18; // inside the port ring the wire is snapped
export const CARD_MARGIN_PX = 24; // dropping on a card (plus this margin) takes its nearest port
export const NEAR_SCALE = 0.5; // ports are grabbable from here up
export const GROUP_SCALE = 0.6; // group handles are grabbable below here

export const ringR = (scale: number): number => Math.max(15, RING_PX / scale);

export const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
