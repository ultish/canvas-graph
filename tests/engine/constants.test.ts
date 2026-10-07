import { describe, expect, it } from 'vitest';
import {
  ELEC_PX,
  REACH_WORLD,
  reachAt,
  RING_PX,
  REACH_MIN_PX,
} from '../../src/-private/engine/constants.ts';

// Ports and group handles share one rule: wherever the arc is showing, letting go connects.
// Reach is capped in world units so a zoomed-out drag cannot span whole columns.
describe('drag-to-connect ranges', () => {
  it('the locked-on ring is inside the arc', () => {
    expect(RING_PX).toBeLessThan(ELEC_PX);
  });

  it('the world cap is shorter than the gap between columns', () => {
    expect(REACH_WORLD).toBeLessThan(420);
  });

  it('reach is capped in the graph when zoomed in, and never smaller than a few pixels when zoomed out', () => {
    expect(reachAt(1)).toBe(REACH_WORLD);
    expect(reachAt(0.04) * 0.04).toBeCloseTo(REACH_MIN_PX);
  });
});
