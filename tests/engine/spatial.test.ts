import { describe, expect, it } from 'vitest';
import { SpatialGrid } from '../../src/-private/engine/spatial.ts';
import { fan } from './fixtures.ts';
import { laidOut } from './support.ts';

describe('SpatialGrid', () => {
  const { store, comps } = laidOut(fan(400));
  const grid = new SpatialGrid();
  grid.rebuild(store.nodes);

  it('returns exactly the cards that overlap the rectangle, and no more of the world than it needs to', () => {
    const b = comps[0]!.bbox;
    const n = store.assets.get('p17')!;
    const small = grid.query(n.x - 100, n.y - 100, n.x + 300, n.y + 300);
    expect(small).toContain(n);
    expect(small.size).toBeLessThan(store.nodes.length / 2);
    const all = grid.query(b.x - 10, b.y - 10, b.x + b.w + 10, b.y + b.h + 10);
    expect(all.size).toBe(store.nodes.length);
    for (const m of small)
      expect(Math.abs(m.x - n.x) < 1600 && Math.abs(m.y - n.y) < 1600).toBe(
        true,
      ); // within a cell or two
  });

  it('picks the card under a point and nothing in the gaps', () => {
    const n = store.assets.get('p17')!;
    expect(grid.pick(n.x + n.w / 2, n.y + n.h / 2)).toBe(n);
    expect(grid.pick(n.x - 5000, n.y - 5000)).toBeNull();
    expect(grid.pick(n.x + n.w + 10, n.y + n.h / 2)).not.toBe(n);
  });

  it('can be rebuilt after the layout changes', () => {
    const n = store.assets.get('p3')!;
    const old = { x: n.x, y: n.y };
    n.x += 100000;
    grid.rebuild(store.nodes);
    expect(grid.pick(old.x + 5, old.y + 5)).not.toBe(n);
    expect(grid.pick(n.x + 5, n.y + 5)).toBe(n);
    n.x -= 100000;
    grid.rebuild(store.nodes);
  });
});
