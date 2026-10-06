import { describe, expect, it } from 'vitest';
import {
  pickEdge,
  pickGroup,
  pickGroupEdge,
  pickGroupHandle,
  pickPort,
} from '../../src/-private/engine/picking.ts';
import { sampleSegs } from '../../src/-private/engine/geometry.ts';
import { edgeSegs, groupEdgeSegs } from '../../src/-private/engine/routes.ts';
import { PAD, portY } from '../../src/-private/engine/layout.ts';
import { fan, loop } from './fixtures.ts';
import { laidOut } from './support.ts';

let stamp = 0;

describe('picking', () => {
  const { store, groups, gedges } = laidOut(loop(), fan(50, 'f-'));
  const pointOn = (e: Parameters<typeof edgeSegs>[0], u: number) =>
    sampleSegs(edgeSegs(e), 100)[Math.round(u * 100)]!;

  it('picks a wire from a point on it, and not from a point well off it', () => {
    const e = store.edgesById.get('l23')!;
    const p = pointOn(e, 0.5);
    expect(pickEdge(p.x, p.y + 3, 1, store.nodes, ++stamp)).toBe(e);
    expect(pickEdge(p.x, p.y + 80, 1, store.nodes, ++stamp)).toBeNull();
  });

  it('picks a loop-back along its lane, far from either port', () => {
    const e = store.edgesById.get('l52')!;
    const lane = e.ge!.laneY!;
    const mid = sampleSegs(edgeSegs(e), 200).find(
      (p) => Math.abs(p.y - lane) < 0.5,
    )!;
    expect(pickEdge(mid.x, mid.y, 1, store.nodes, ++stamp)).toBe(e);
  });

  it('the pick radius is screen pixels, so zooming out makes it wider in world units', () => {
    const e = store.edgesById.get('l23')!;
    const p = pointOn(e, 0.5);
    expect(pickEdge(p.x, p.y + 15, 1, store.nodes, ++stamp)).toBeNull();
    expect(pickEdge(p.x, p.y + 15, 0.5, store.nodes, ++stamp)).toBe(e);
  });

  it('picks a group pipe along its path, preferring the nearer when pipes are close', () => {
    const ge = gedges.find(
      (x) => x.a.type === 'switch' && x.b.type === 'process',
    )!;
    const p = sampleSegs(groupEdgeSegs(ge), 100)[50]!;
    expect(pickGroupEdge(p.x, p.y, 0.05, gedges)).toBe(ge);
    expect(pickGroupEdge(p.x, p.y - 4000, 0.05, gedges)).toBeNull();
  });

  it('picks the smallest group containing a point, and gives tiny groups a minimum hit area', () => {
    const g = groups.find((x) => x.type === 'process')!;
    expect(pickGroup(g.x + g.w / 2, g.y + g.h / 2, 0.05, groups)).toBe(g);
    expect(pickGroup(g.x + g.w + PAD - 1, g.y + g.h / 2, 0.05, groups)).toBe(g);
    expect(pickGroup(g.x + g.w + PAD + 5000, g.y, 0.05, groups)).not.toBe(g);
    const one = groups.find((x) => x.type === 'sink')!;
    expect(
      pickGroup(one.x + one.w / 2 + 90, one.y + one.h / 2, 0.02, groups),
    ).toBe(one); // 10px min at this zoom
  });

  it('finds a port dot on either side of a card', () => {
    const sw = store.assets.get('f-sw')!;
    const hit = pickPort(sw.x + sw.w + 2, portY(sw, 0) + 1, 1, [sw]);
    expect(hit).toMatchObject({ dir: 1, idx: 0 });
    const hit2 = pickPort(sw.x - 3, portY(sw, 4), 1, [sw]);
    expect(hit2).toMatchObject({ dir: -1, idx: 4 });
    expect(pickPort(sw.x + sw.w / 2, portY(sw, 0), 1, [sw])).toBeNull();
  });

  it('finds a group handle on the frame edge', () => {
    const g = groups.find((x) => x.type === 'process')!;
    expect(
      pickGroupHandle(g.x + g.w + PAD, g.y + g.h / 2, 0.05, groups),
    ).toMatchObject({ group: g, dir: 1 });
    expect(
      pickGroupHandle(g.x - PAD, g.y + g.h / 2 + 3, 0.05, groups),
    ).toMatchObject({ group: g, dir: -1 });
    expect(pickGroupHandle(g.x + g.w / 2, g.y + g.h / 2, 1, groups)).toBeNull(); // 14px at this zoom is nowhere near the middle
  });
});
