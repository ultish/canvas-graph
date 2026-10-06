import { describe, expect, it } from 'vitest';
import { layoutGraph } from '../../src/-private/engine/layout.ts';
import { computeLayout } from '../../src/-private/engine/layout-core.ts';
import { buildLayoutInput } from '../../src/-private/engine/layout.ts';
import { GraphStore } from '../../src/-private/engine/store.ts';
import type {
  AssetInput,
  ConnectionInput,
  GraphInput,
} from '../../src/-private/engine/types.ts';
import { fan, loop } from './fixtures.ts';
import { layoutGraph as referenceLayout } from './reference-layout.ts';

const seeded = (seed: number) => () =>
  (seed = (seed * 16807) % 2147483647) / 2147483647;

/** A random graph with cycles, layer-skipping connections, stragglers, several pipelines, and cards of different heights. */
function randomGraph(seed: number): GraphInput {
  const r = seeded(seed);
  const n = 8 + Math.floor(r() * 140);
  const types = ['a', 'b', 'c', 'd', 'e'].slice(0, 2 + Math.floor(r() * 4));
  const assets: AssetInput[] = Array.from({ length: n }, (_, i) => {
    const ins = 1 + Math.floor(r() * (r() < 0.15 ? 7 : 2)); // a few tall cards
    const outs = 1 + Math.floor(r() * (r() < 0.15 ? 7 : 2));
    return {
      id: `n${i}`,
      name: `n${i}`,
      type: types[Math.floor(r() * types.length)]!,
      inputPorts: Array.from({ length: ins }, (_, k) => ({
        id: `n${i}:in:${k}`,
        name: String(k),
      })),
      outputPorts: Array.from({ length: outs }, (_, k) => ({
        id: `n${i}:out:${k}`,
        name: String(k),
      })),
    };
  });
  const connections: ConnectionInput[] = [];
  const m = Math.floor(n * (0.4 + r() * 1.6)); // sparse enough to leave stragglers and separate pipelines
  for (let e = 0; e < m; e++) {
    const a = Math.floor(r() * n);
    const b =
      r() < 0.7
        ? Math.min(n - 1, a + 1 + Math.floor(r() * 4))
        : Math.floor(r() * n); // mostly forward, some back
    const A = assets[a]!;
    const B = assets[b]!;
    connections.push({
      id: `e${e}`,
      from: {
        assetId: A.id,
        portId: A.outputPorts[Math.floor(r() * A.outputPorts.length)]!.id,
      },
      to: {
        assetId: B.id,
        portId: B.inputPorts[Math.floor(r() * B.inputPorts.length)]!.id,
      },
    });
  }
  return { assets, connections };
}

/** Everything a layout decides, as plain data, so two layouts can be compared. */
function snapshot(store: GraphStore, r: ReturnType<typeof layoutGraph>) {
  const gi = new Map(r.groups.map((g, i) => [g, i]));
  return {
    nodes: store.nodes.map((n) => [
      n.id,
      n.layer,
      n.x,
      n.y,
      n.g ? gi.get(n.g) : -1,
    ]),
    back: store.edgeList.map((e) => [e.id, e.back]),
    groups: r.groups.map((g) => [
      g.id,
      g.key,
      g.layer,
      g.type,
      g.nodes.map((n) => n.id),
      g.x,
      g.y,
      g.w,
      g.h,
      g.rows,
      g.mh,
      g.rh,
      r.comps.indexOf(g.comp),
    ]),
    comps: r.comps.map((c) => [
      c.kind,
      c.nodes.map((n) => n.id),
      c.groups.map((g) => g.id),
      c.bbox,
      c.bbox0,
    ]),
  };
}

describe('the typed-array layout core', () => {
  it('produces exactly what the original object-based layout did, on 300 random graphs', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const input = randomGraph(seed);
      const store = new GraphStore();
      store.sync(input);
      const expected = snapshot(
        store,
        referenceLayout(store.nodes, store.edgeList),
      );
      const got = snapshot(store, layoutGraph(store.nodes, store.edgeList));
      expect(got, `graph ${seed}`).toEqual(expected);
    }
  });

  it('agrees on the shapes the cookbook uses: fans, loops, and a mix with stragglers', () => {
    for (const input of [
      fan(60),
      loop(),
      {
        assets: [...loop().assets, ...fan(30, 'f-').assets],
        connections: [...loop().connections, ...fan(30, 'f-').connections],
      },
    ]) {
      const store = new GraphStore();
      store.sync(input);
      const expected = snapshot(
        store,
        referenceLayout(store.nodes, store.edgeList),
      );
      expect(snapshot(store, layoutGraph(store.nodes, store.edgeList))).toEqual(
        expected,
      );
    }
  });

  it('handles nothing, one asset, and a self-loop', () => {
    const empty = new GraphStore();
    empty.sync({ assets: [], connections: [] });
    expect(layoutGraph(empty.nodes, empty.edgeList)).toEqual({
      groups: [],
      comps: [],
    });
    const one = new GraphStore();
    one.sync({
      assets: [
        {
          id: 'x',
          name: 'x',
          type: 't',
          inputPorts: [{ id: 'x:i', name: 'i' }],
          outputPorts: [{ id: 'x:o', name: 'o' }],
        },
      ],
      connections: [],
    });
    expect(
      layoutGraph(one.nodes, one.edgeList).comps.map((c) => c.kind),
    ).toEqual(['unconnected']);
    const loopy = new GraphStore();
    loopy.sync({
      assets: [
        {
          id: 'x',
          name: 'x',
          type: 't',
          inputPorts: [{ id: 'x:i', name: 'i' }],
          outputPorts: [{ id: 'x:o', name: 'o' }],
        },
      ],
      connections: [
        {
          id: 'c',
          from: { assetId: 'x', portId: 'x:o' },
          to: { assetId: 'x', portId: 'x:i' },
        },
      ],
    });
    const r = layoutGraph(loopy.nodes, loopy.edgeList);
    expect(r.comps.map((c) => c.kind)).toEqual(['pipeline']);
    expect(loopy.edgeList[0]!.back).toBe(true);
  });

  it('is a pure function of its input: running it twice gives the same arrays, and it never touches the model', () => {
    const store = new GraphStore();
    store.sync(randomGraph(7));
    const input = buildLayoutInput(store.nodes, store.edgeList);
    const before = store.nodes.map((n) => [n.x, n.y, n.layer]);
    const a = computeLayout(input);
    const b = computeLayout(input);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.groupOf)).toEqual(Array.from(b.groupOf));
    expect(store.nodes.map((n) => [n.x, n.y, n.layer])).toEqual(before);
  });
});
