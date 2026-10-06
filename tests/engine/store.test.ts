import { describe, expect, it } from 'vitest';
import { GraphStore } from '../../src/-private/engine/store.ts';
import { layoutGraph, routeEdges } from '../../src/-private/engine/layout.ts';
import type { GraphInput } from '../../src/-private/engine/types.ts';
import { asset, fan, link, loop } from './fixtures.ts';

const laidOut = (input: GraphInput) => {
  const store = new GraphStore();
  store.sync(input);
  const { groups, comps } = layoutGraph(store.nodes, store.edgeList);
  routeEdges(store.edgeList, groups, comps);
  return store;
};

/** Apollo-style: a fresh payload array, but unchanged entities keep their identity. */
const withAsset = (
  input: GraphInput,
  id: string,
  patch: object,
): GraphInput => ({
  ...input,
  assets: input.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)),
});

describe('sync', () => {
  it('builds assets, ports and connections from a GraphQL-shaped payload', () => {
    const store = new GraphStore();
    const r = store.sync(fan(20));
    expect(store.nodes).toHaveLength(10 + 1 + 1 + 5 + 20);
    expect(store.edgeList).toHaveLength(10 + 20 * 2 + 5);
    expect(r.assets.added).toBe(store.nodes.length);
    expect(r.structural).toBe(true);
    const sw = store.assets.get('sw')!;
    expect(sw.ins.map((p) => p.name)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]); // numeric-aware order
    expect(sw.in).toHaveLength(10);
  });

  it('costs nothing when nothing changed, and keeps object identity', () => {
    const input = fan(200);
    const store = new GraphStore();
    store.sync(input);
    const node = store.assets.get('p5')!;
    const edge = store.edgesById.get('c-sw-p5')!;
    const again = store.sync({
      assets: [...input.assets],
      connections: [...input.connections],
    }); // new arrays, same entities
    expect(again.visited).toBe(0);
    expect(again.structural || again.routing || again.visual).toBe(false);
    expect(store.assets.get('p5')).toBe(node);
    expect(store.edgesById.get('c-sw-p5')).toBe(edge);
  });

  it('a one-field update touches exactly one asset', () => {
    const input = fan(1000);
    const store = laidOut(input);
    const total = store.nodes.length + store.edgeList.length;
    const r = store.sync(withAsset(input, 'p500', { status: 'degraded' }));
    expect(r.visited).toBe(1);
    expect(r.assets.changed).toBe(1);
    expect(r.visual).toBe(true);
    expect(r.structural || r.routing).toBe(false);
    expect(store.assets.get('p500')!.status).toBe('degraded');
    expect(total).toBeGreaterThan(3000);
  });

  it('a new asset is structural; a removed one takes its connections with it', () => {
    const input = fan(10);
    const store = laidOut(input);
    const added = store.sync({
      ...input,
      assets: [...input.assets, asset('new', 'process')],
    });
    expect(added.assets.added).toBe(1);
    expect(added.structural).toBe(true);
    const edges = store.edgeList.length;
    const removed = store.sync({
      assets: input.assets.filter((a) => a.id !== 'p3'),
      connections: input.connections,
    });
    expect(removed.assets.removed + 1).toBeGreaterThan(0);
    expect(store.assets.has('p3')).toBe(false);
    expect(store.edgeList.length).toBeLessThan(edges);
    expect(store.edgeList.some((e) => e.a.id === 'p3' || e.b.id === 'p3')).toBe(
      false,
    );
    expect(store.assets.get('sw')!.out.some((e) => e.b.id === 'p3')).toBe(
      false,
    );
  });

  it('adding or removing a connection is routing work, not layout work', () => {
    const input = loop();
    const store = laidOut(input);
    const extra = link('x', 'a6', 'B', 'a8', '2');
    const add = store.sync({
      ...input,
      connections: [...input.connections, extra],
    });
    expect(add.connections.added).toBe(1);
    expect(add.routing).toBe(true);
    expect(add.structural).toBe(false);
    const del = store.sync(input);
    expect(del.connections.removed).toBe(1);
    expect(store.edgesById.has('x')).toBe(false);
    expect(store.assets.get('a6')!.out.some((e) => e.id === 'x')).toBe(false);
  });

  it('flipping enabled/pending is a visual change only', () => {
    const input = loop();
    const store = laidOut(input);
    const r = store.sync({
      ...input,
      connections: input.connections.map((c) =>
        c.id === 'l12' ? { ...c, enabled: false } : c,
      ),
    });
    expect(r.connections.changed).toBe(1);
    expect(r.visual).toBe(true);
    expect(r.routing || r.structural).toBe(false);
    expect(store.edgesById.get('l12')!.enabled).toBe(false);
    const p = store.sync({
      ...input,
      connections: input.connections.map((c) =>
        c.id === 'l12' ? { ...c, pending: true } : c,
      ),
    });
    expect(store.edgesById.get('l12')!.pending).toBe(true);
    expect(p.routing).toBe(false);
  });

  it('renames a port in place and keeps the connection pointing at the same port object', () => {
    const input = loop();
    const store = laidOut(input);
    const port = store.assets.get('a2')!.outs.find((p) => p.id === 'a2:out:A')!;
    store.sync(
      withAsset(input, 'a2', {
        outputPorts: [
          { id: 'a2:out:A', name: 'primary' },
          { id: 'a2:out:B', name: 'B' },
        ],
      }),
    );
    expect(port.name).toBe('primary');
    expect(store.edgesById.get('l23')!.fp).toBe(port);
  });

  it('drops connections whose port was removed, and reindexes the rest', () => {
    const input = loop();
    const store = laidOut(input);
    const r = store.sync(
      withAsset(input, 'a2', { outputPorts: [{ id: 'a2:out:B', name: 'B' }] }),
    );
    expect(store.edgesById.has('l23')).toBe(false);
    expect(r.routing).toBe(true);
    const l26 = store.edgesById.get('l26')!;
    expect(l26.a.outs[l26.ai]).toBe(l26.fp);
  });

  it('a port that makes a card taller than its cell is structural', () => {
    const input = fan(40);
    const store = laidOut(input);
    const p = input.assets.find((a) => a.id === 'p7')!;
    const r = store.sync(
      withAsset(input, 'p7', {
        outputPorts: [
          ...p.outputPorts,
          { id: 'x1', name: 'X1' },
          { id: 'x2', name: 'X2' },
          { id: 'x3', name: 'X3' },
        ],
      }),
    );
    expect(r.structural).toBe(true);
    expect(store.assets.get('p7')!.h).toBeGreaterThan(
      store.assets.get('p8')!.h,
    );
  });

  it('counts a connection to something that does not exist as dangling, and skips it', () => {
    const input = loop();
    const store = laidOut(input);
    const r = store.sync({
      ...input,
      connections: [...input.connections, link('bad', 'a1', 'A', 'ghost', '1')],
    });
    expect(r.connections.dangling).toBe(1);
    expect(store.edgesById.has('bad')).toBe(false);
  });

  it('moving a connection to another port replaces it', () => {
    const input = loop();
    const store = laidOut(input);
    const r = store.sync({
      ...input,
      connections: input.connections.map((c) =>
        c.id === 'l23' ? link('l23', 'a2', 'A', 'a3', '2') : c,
      ),
    });
    expect(r.routing).toBe(true);
    const e = store.edgesById.get('l23')!;
    expect(e.tp.name).toBe('2');
    expect(
      store.assets.get('a3')!.in.filter((x) => x.id === 'l23'),
    ).toHaveLength(1);
  });
});

describe('local (gesture) connections', () => {
  it('are kept across syncs until the host echoes them back, then promoted', () => {
    const input = loop();
    const store = laidOut(input);
    const a3 = store.assets.get('a3')!;
    const a5 = store.assets.get('a5')!;
    const local = store.addLocalEdge(a3, a3.outs[1]!, a5, a5.ins[1]!, {
      pending: true,
    })!;
    expect(local.local && local.pending).toBe(true);
    const r1 = store.sync({
      assets: [...input.assets],
      connections: [...input.connections],
    });
    expect(store.edgesById.has(local.id)).toBe(true); // not the host's yet: leave it alone
    expect(r1.visited).toBe(0);
    const echoed = link('real-1', 'a3', 'B', 'a5', '2');
    const r2 = store.sync({
      ...input,
      connections: [...input.connections, echoed],
    });
    expect(r2.promoted).toEqual([[local.id, 'real-1']]);
    expect(store.edgesById.has(local.id)).toBe(false);
    expect(store.edgesById.get('real-1')!.local).toBe(false);
    expect(a3.out.filter((e) => e.tp === a5.ins[1])).toHaveLength(1);
  });

  it('refuse duplicates and self-links', () => {
    const store = laidOut(loop());
    const a1 = store.assets.get('a1')!;
    const a2 = store.assets.get('a2')!;
    expect(store.addLocalEdge(a1, a1.outs[0]!, a2, a2.ins[0]!)).toBeNull(); // l12 already exists
    expect(store.addLocalEdge(a1, a1.outs[0]!, a1, a1.ins[0]!)).toBeNull();
  });

  it('ensurePort adds a host-named port, reuses it by id, and reports when the card outgrows its cell', () => {
    const input: GraphInput = {
      assets: [
        asset('root', 'source', [], ['A', 'B']),
        asset('tall', 'x', ['1'], ['A', 'B', 'C']),
        asset('short', 'x', ['1'], ['A']),
      ],
      connections: [
        link('c1', 'root', 'A', 'tall', '1'),
        link('c2', 'root', 'B', 'short', '1'),
      ],
    };
    const store = laidOut(input);
    const short = store.assets.get('short')!;
    const before = short.h;
    const fits = store.ensurePort(short, 'out', { id: 'n1', name: 'N1' });
    expect(fits.overflow).toBe(false); // the group's cell is already as tall as `tall`
    expect(short.h).toBeGreaterThan(before);
    expect(store.ensurePort(short, 'out', 'n1').port).toBe(fits.port); // same id: reused, not duplicated
    expect(short.outs.filter((x) => x.id === 'n1')).toHaveLength(1);
    store.ensurePort(short, 'out', 'n2');
    expect(store.ensurePort(short, 'out', 'n3').overflow).toBe(true); // now taller than any card in the cell grid
    const e = store.edgesById.get('c2')!;
    expect(short.ins[e.bi]).toBe(e.tp); // existing connections keep pointing at the right row
  });
});

describe('stragglers joining the graph', () => {
  it('an unconnected asset that gets its first connection needs a relayout; one more connection does not', () => {
    const input = loop();
    const lone = asset('lone', 'process');
    const withLone: GraphInput = {
      assets: [...input.assets, lone],
      connections: input.connections,
    };
    const store = laidOut(withLone);
    expect(store.assets.get('lone')!.g!.key.startsWith('unconnected')).toBe(
      true,
    );
    const first = store.sync({
      ...withLone,
      connections: [...input.connections, link('j1', 'a8', 'B', 'lone', '1')],
    });
    expect(first.structural).toBe(true);
    const second = store.sync({
      ...withLone,
      connections: [
        ...input.connections,
        link('j1', 'a8', 'B', 'lone', '1'),
        link('j2', 'a7', 'B', 'lone', '1'),
      ],
    });
    expect(second.structural).toBe(false);
    expect(second.routing).toBe(true);
  });
});

describe('the steady-state fast path', () => {
  it('still sees a payload array that was mutated in place and passed again', () => {
    const input = loop();
    const store = laidOut(input);
    const assets = [...input.assets];
    const connections = [...input.connections];
    store.sync({ assets, connections });
    assets.push(asset('late', 'process')); // same array object, new member
    const r = store.sync({ assets, connections });
    expect(r.assets.added).toBe(1);
    expect(store.assets.has('late')).toBe(true);
  });

  it('a reordered payload is still a no-op for the model, and a swapped-in changed entity is found at its new position', () => {
    const input = loop();
    const store = laidOut(input);
    const reversed = {
      assets: [...input.assets].reverse(),
      connections: [...input.connections].reverse(),
    };
    const r = store.sync(reversed);
    expect(r.visited).toBe(0);
    expect(r.structural || r.routing || r.visual).toBe(false);
    const changed = {
      ...reversed,
      assets: reversed.assets.map((a) =>
        a.id === 'a3' ? { ...a, status: 'degraded' } : a,
      ),
    };
    const r2 = store.sync(changed);
    expect(r2.visited).toBe(1);
    expect(store.assets.get('a3')!.status).toBe('degraded');
  });

  it('a server edge the model lost locally comes back when the host still has it (the host wins)', () => {
    const input = loop();
    const store = laidOut(input);
    store.sync({
      assets: [...input.assets],
      connections: [...input.connections],
    });
    store.removeEdges([store.edgesById.get('l23')!]); // e.g. a delete the host agreed to, before its data catches up
    expect(store.edgesById.has('l23')).toBe(false);
    const r = store.sync({
      assets: [...input.assets],
      connections: [...input.connections],
    });
    expect(r.connections.added).toBe(1);
    expect(store.edgesById.has('l23')).toBe(true);
  });

  it('a flag change in place is found without the full path, and moving an endpoint falls back to it', () => {
    const input = loop();
    const store = laidOut(input);
    store.sync({
      assets: [...input.assets],
      connections: [...input.connections],
    });
    const flag = {
      ...input,
      connections: input.connections.map((c) =>
        c.id === 'l12' ? { ...c, pending: true } : c,
      ),
    };
    const r = store.sync(flag);
    expect(r.visited).toBe(1);
    expect(r.connections.changed).toBe(1);
    expect(r.routing).toBe(false);
    const moved = {
      ...flag,
      connections: flag.connections.map((c) =>
        c.id === 'l12' ? link('l12', 'a1', 'A', 'a3', '2') : c,
      ),
    };
    const r2 = store.sync(moved);
    expect(r2.routing).toBe(true);
    expect(store.edgesById.get('l12')!.b.id).toBe('a3');
  });
});
