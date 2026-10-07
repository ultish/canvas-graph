import { describe, expect, it } from 'vitest';
import {
  ELEC_PX,
  REACH_WORLD,
  RING_PX,
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
});
