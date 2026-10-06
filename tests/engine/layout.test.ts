import { describe, expect, it } from 'vitest';
import { GraphStore } from '../../src/-private/engine/store.ts';
import {
  layoutGraph,
  routeEdges,
  portY,
} from '../../src/-private/engine/layout.ts';
import { fan, loop } from './fixtures.ts';

function build(...inputs: ReturnType<typeof fan>[]) {
  const store = new GraphStore();
  store.sync({
    assets: inputs.flatMap((i) => i.assets),
    connections: inputs.flatMap((i) => i.connections),
  });
  const { groups, comps } = layoutGraph(store.nodes, store.edgeList);
  const gedges = routeEdges(store.edgeList, groups, comps);
  return { store, groups, comps, gedges };
}

const overlaps = (groups: ReturnType<typeof build>['groups']) => {
  let bad = 0;
  for (const g of groups) {
    const cols = new Map<number, typeof g.nodes>();
    for (const n of g.nodes)
      (
        cols.get(Math.round(n.x)) ??
        cols.set(Math.round(n.x), []).get(Math.round(n.x))!
      ).push(n);
    for (const L of cols.values()) {
      L.sort((p, q) => p.y - q.y);
      for (let i = 1; i < L.length; i++)
        if (L[i]!.y < L[i - 1]!.y + L[i - 1]!.h - 0.5) bad++;
    }
  }
  return bad;
};

describe('layout', () => {
  it('layers a fan left to right and groups each layer by type', () => {
    const { store, groups } = build(fan(30));
    const layer = (id: string) => store.assets.get(id)!.layer;
    expect([
      layer('src0'),
      layer('sw'),
      layer('p0'),
      layer('agg'),
      layer('sink0'),
    ]).toEqual([0, 1, 2, 3, 4]);
    const l2 = groups.filter((g) => g.layer === 2);
    expect(l2.map((g) => g.type).sort()).toEqual(['process', 'storage']);
    expect(l2.reduce((s, g) => s + g.nodes.length, 0)).toBe(30);
  });

  it('puts the largest group of each layer on the shared baseline', () => {
    const { groups } = build(fan(30));
    const mid = (g: (typeof groups)[number]) => g.y + g.h / 2;
    const biggest = groups.filter((g) =>
      ['source', 'switch', 'process', 'aggregator', 'sink'].includes(g.type),
    );
    const ref = mid(biggest[0]!);
    for (const g of biggest) expect(mid(g)).toBeCloseTo(ref, 0);
  });

  it('lays big groups out as a roughly square grid with no overlapping cards', () => {
    const { groups } = build(fan(500));
    const big = groups.find((g) => g.type === 'process')!;
    expect(big.w / big.h).toBeGreaterThan(0.5);
    expect(big.w / big.h).toBeLessThan(2);
    expect(overlaps(groups)).toBe(0);
  });

  it('breaks a cycle into a back edge and routes it above, with a lane', () => {
    const { store, gedges } = build(loop());
    const back = store.edgeList.filter((e) => e.back);
    expect(back.map((e) => e.id)).toEqual(['l52']);
    const ge = gedges.find((x) => x.back)!;
    expect(ge.laneY).toBeLessThan(Math.min(...store.nodes.map((n) => n.y)));
  });

  it('routes layer-skipping edges under the chain', () => {
    const { store, gedges } = build(loop());
    const skip = gedges.find((x) => x.skip)!;
    expect(skip.edges.map((e) => e.id)).toEqual(['l14']);
    expect(skip.laneY).toBeGreaterThan(
      Math.max(...store.nodes.map((n) => n.y + n.h)),
    );
  });

  it('keeps separate pipelines apart as components', () => {
    const { comps } = build(fan(5, 'x-'), loop());
    expect(comps).toHaveLength(2);
    expect(comps[1]!.bbox.y).toBeGreaterThan(
      comps[0]!.bbox.y + comps[0]!.bbox.h,
    );
  });

  it('is idempotent: laying out twice gives the same positions', () => {
    const { store, groups, comps } = build(loop(), fan(20, 'f-'));
    const before = store.nodes.map((n) => [n.id, n.x, n.y, n.layer] as const);
    layoutGraph(store.nodes, store.edgeList);
    routeEdges(store.edgeList, groups, comps);
    expect(store.nodes.map((n) => [n.id, n.x, n.y, n.layer] as const)).toEqual(
      before,
    );
  });

  it('places each port on its own row of the card', () => {
    const { store } = build(fan(3));
    const sw = store.assets.get('sw')!;
    expect(sw.ins).toHaveLength(10);
    const ys = sw.ins.map((_, k) => portY(sw, k));
    expect(new Set(ys).size).toBe(10);
    expect(sw.h).toBeGreaterThan(portY(sw, 9) - sw.y);
  });

  it('aggregates a fan into one pipe per group pair', () => {
    const { gedges, store } = build(fan(30));
    const out = gedges.filter((ge) =>
      ge.a.nodes.includes(store.assets.get('sw')!),
    );
    expect(out.reduce((s, ge) => s + ge.count, 0)).toBe(30);
    expect(out.every((ge) => ge.laneY === undefined)).toBe(true);
  });
});
