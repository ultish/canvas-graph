import { describe, expect, it } from 'vitest';
import {
  ELEC_PX,
  MAG_PULL,
  MAG_PX,
  RING_PX,
  SNAP_PX,
} from '../../src/-private/engine/constants.ts';

// The drag-to-connect contract (from the plumbing.gif): the magnet reaches further than the electricity,
// and wherever the electricity is showing, letting go connects.
describe('drag-to-connect ranges', () => {
  it('the magnet starts pulling from further out than the arc appears', () => {
    expect(MAG_PX).toBeGreaterThan(ELEC_PX);
  });

  it('letting go anywhere the arc is showing connects', () => {
    expect(SNAP_PX).toBeGreaterThanOrEqual(ELEC_PX);
  });

  it('the locked-on ring is inside the arc, and the magnet never closes the whole gap', () => {
    expect(RING_PX).toBeLessThan(ELEC_PX);
    expect(MAG_PULL).toBeGreaterThan(0);
    expect(MAG_PULL).toBeLessThan(1);
  });
});
