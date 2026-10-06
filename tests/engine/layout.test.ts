import { describe, expect, it } from 'vitest';
import { GraphStore } from '../../src/-private/engine/store.ts';
import {
  layoutGraph,
  routeEdges,
  portY,
} from '../../src/-private/engine/layout.ts';
import { asset, fan, link, loop } from './fixtures.ts';

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

describe('stragglers and side pipelines', () => {
  const tiny = (p: string) => ({
    assets: [asset(`${p}a`, 'x'), asset(`${p}b`, 'y'), asset(`${p}c`, 'z')],
    connections: [
      link(`${p}1`, `${p}a`, 'A', `${p}b`, '1'),
      link(`${p}2`, `${p}b`, 'A', `${p}c`, '1'),
    ],
  });
  const loose = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      asset(
        `lone${i}`,
        i % 3 === 0 ? 'process' : i % 3 === 1 ? 'sink' : 'spare',
        [],
        [],
      ),
    );
  const boxOverlap = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it('gathers every asset with no connections into one block, a group per type, side by side', () => {
    const input = fan(20);
    const store = new GraphStore();
    store.sync({
      assets: [...input.assets, ...loose(60)],
      connections: input.connections,
    });
    const { comps, groups } = layoutGraph(store.nodes, store.edgeList);
    const lone = comps.filter((c) => c.kind === 'unconnected');
    expect(lone).toHaveLength(1);
    expect(lone[0]!.nodes).toHaveLength(60);
    const g = groups.filter((x) => x.comp === lone[0]);
    expect(g.map((x) => x.type).sort()).toEqual(['process', 'sink', 'spare']);
    expect(new Set(g.map((x) => Math.round(x.y + x.h / 2))).size).toBe(1); // one row, centred on a shared baseline
    expect(comps.filter((c) => c.kind === 'pipeline')).toHaveLength(1);
  });

  it('60 stragglers take a compact block, not 60 tall rows', () => {
    const store = new GraphStore();
    store.sync({
      assets: [...fan(20).assets, ...loose(60)],
      connections: fan(20).connections,
    });
    const { comps } = layoutGraph(store.nodes, store.edgeList);
    const lone = comps.find((c) => c.kind === 'unconnected')!;
    const main = comps.find((c) => c.kind === 'pipeline')!;
    expect(lone.bbox.h).toBeLessThan(main.bbox.h * 2);
    expect(lone.bbox.w).toBeLessThan(main.bbox.w * 2);
  });

  it('packs small side pipelines next to each other, and keeps big ones in their own row', () => {
    const big = fan(300, 'big-');
    const t1 = tiny('t1');
    const t2 = tiny('t2');
    const t3 = tiny('t3');
    const store = new GraphStore();
    store.sync({
      assets: [...big.assets, ...t1.assets, ...t2.assets, ...t3.assets],
      connections: [
        ...big.connections,
        ...t1.connections,
        ...t2.connections,
        ...t3.connections,
      ],
    });
    const { comps } = layoutGraph(store.nodes, store.edgeList);
    expect(comps).toHaveLength(4);
    const [bigC, ...smalls] = comps;
    const rows = new Set(smalls.map((c) => Math.round(c.bbox.y)));
    expect(rows.size).toBe(1); // the three tiny pipelines share a row
    expect(smalls[0]!.bbox.y).toBeGreaterThan(bigC!.bbox.y + bigC!.bbox.h - 1); // below the big pipeline, not on top of it
    for (let i = 0; i < comps.length; i++)
      for (let j = i + 1; j < comps.length; j++)
        expect(boxOverlap(comps[i]!.bbox, comps[j]!.bbox)).toBe(false);
  });

  it('a group of assets connected to each other but not to the rest is its own pipeline beside the main one', () => {
    const store = new GraphStore();
    const side = tiny('side-');
    store.sync({
      assets: [...fan(40).assets, ...side.assets],
      connections: [...fan(40).connections, ...side.connections],
    });
    const { comps } = layoutGraph(store.nodes, store.edgeList);
    expect(comps.map((c) => c.kind)).toEqual(['pipeline', 'pipeline']);
    expect(boxOverlap(comps[0]!.bbox, comps[1]!.bbox)).toBe(false);
    const sideC = comps.find((c) => c.nodes.some((n) => n.id === 'side-a'))!;
    expect(sideC.nodes).toHaveLength(3);
    expect(sideC.bbox.w).toBeLessThan(comps[0]!.bbox.w);
  });

  it('is idempotent with stragglers and packed pipelines in the mix', () => {
    const store = new GraphStore();
    store.sync({
      assets: [...fan(30).assets, ...tiny('t').assets, ...loose(12)],
      connections: [...fan(30).connections, ...tiny('t').connections],
    });
    const first = layoutGraph(store.nodes, store.edgeList);
    const pos = store.nodes.map((n) => [n.id, n.x, n.y, n.layer] as const);
    layoutGraph(store.nodes, store.edgeList);
    expect(store.nodes.map((n) => [n.id, n.x, n.y, n.layer] as const)).toEqual(
      pos,
    );
    expect(first.comps.length).toBe(3);
    expect(overlaps(first.groups)).toBe(0);
  });
});
