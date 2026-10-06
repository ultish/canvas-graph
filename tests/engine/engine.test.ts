import { describe, expect, it } from 'vitest';
import {
  GraphEngine,
  type ConnectRequest,
  type DisconnectRequest,
} from '../../src/-private/engine/engine.ts';
import type { GraphInput } from '../../src/-private/engine/types.ts';
import { asset, fan, link, loop } from './fixtures.ts';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function boot(input: GraphInput = loop()) {
  const engine = new GraphEngine();
  engine.sync(input);
  return engine;
}
const node = (e: GraphEngine, id: string) => e.store.assets.get(id)!;

describe('selection', () => {
  it('describes what is selected and announces it', () => {
    const e = boot();
    const seen: unknown[] = [];
    e.on('select', (p) => seen.push(p && p.kind));
    e.select({ node: node(e, 'a3') });
    e.select({ edge: e.store.edgesById.get('l23')! });
    e.select(null);
    expect(seen).toEqual(['node', 'edge', null]);
    e.select({ node: node(e, 'a3') });
    expect(e.payload()).toMatchObject({ kind: 'node', id: 'a3' });
  });

  it('highlights direct neighbours by default and the whole path in full-path mode', () => {
    const e = boot();
    e.select({ node: node(e, 'a3') });
    expect([...e.selNodes].map((n) => n.id).sort()).toEqual([
      'a2',
      'a3',
      'par0',
      'par1',
      'par2',
    ]);
    e.setFullPath(true);
    expect(e.selNodes.has(node(e, 'a8'))).toBe(true); // a3 -> par -> a4 -> a5 -> a2 -> a6 -> a7 -> a8, round the loop
    expect(e.selNodes.size).toBeGreaterThan(6);
    e.setFullPath(false);
    expect(e.selNodes.has(node(e, 'a8'))).toBe(false);
  });

  it('survives a relayout (new group objects) and is cleared when the asset goes away', () => {
    const input = fan(30);
    const e = boot(input);
    e.select({ group: node(e, 'p4').g! });
    const before = e.selGroup!;
    e.sync({
      ...input,
      assets: [...input.assets, asset('extra', 'sink', ['1'], [])],
    }); // structural: groups are rebuilt
    expect(e.selGroup).not.toBeNull();
    expect(e.selGroup).not.toBe(before);
    expect(e.selGroup!.nodes.some((n) => n.id === 'p4')).toBe(true);
    e.select({ node: node(e, 'p9') });
    e.sync({
      assets: input.assets.filter((a) => a.id !== 'p9'),
      connections: input.connections,
    });
    expect(e.selected).toBeNull();
    expect(e.selNodes.size).toBe(0);
  });

  it('keeps a selected group pipe pointing at the live pipe after connections change', () => {
    const input = fan(30);
    const e = boot(input);
    const ge = e.gedges.find(
      (x) => x.a.type === 'switch' && x.b.type === 'process',
    )!;
    e.select({ ge });
    e.sync({
      ...input,
      connections: input.connections.filter((c) => c.id !== 'c-sw-p1'),
    });
    expect(e.selGE).not.toBeNull();
    expect(e.payload()).toMatchObject({ kind: 'groupEdge' });
    expect(e.selGE!.edges.length).toBe(ge.edges.length - 1);
  });
});

describe('connect (port to port)', () => {
  const join = (e: GraphEngine) =>
    e.requestConnectPorts(node(e, 'a3'), 1, node(e, 'a5'), 1); // a3.B -> a5.2 : a new, layer-skipping wire

  it('with nobody listening there is nothing to wait for: the wire is confirmed at once', () => {
    const e = boot();
    const wire = join(e)!;
    expect(wire.local).toBe(true);
    expect(wire.pending).toBe(false);
    expect(e.pending.size).toBe(0);
    expect(e.store.edgesById.get(wire.id)).toBe(wire);
  });

  it('draws it pending and asks the host; a resolved promise settles it', async () => {
    const e = boot();
    const reqs: ConnectRequest[] = [];
    let done!: () => void;
    e.on('connectRequest', (r) => {
      reqs.push(r);
      return new Promise<void>((res) => (done = res));
    });
    const wire = join(e)!;
    expect(wire.pending).toBe(true);
    expect(e.pending.has(wire)).toBe(true);
    expect(reqs[0]).toMatchObject({
      source: 'port-drag',
      cardinality: 'one-to-one',
      existingLinks: 0,
      edgeIds: [wire.id],
      from: { assetIds: ['a3'], port: { id: 'a3:out:B', name: 'B' } },
      to: { assetIds: ['a5'], port: { id: 'a5:in:2', name: '2' } },
    });
    e.time = 5;
    done();
    await tick();
    expect(wire.pending).toBe(false);
    expect(wire.ct).toBe(5); // settle pulse
    expect(e.pending.size).toBe(0);
  });

  it('a rejected promise fades the wire away and forgets the undo step', async () => {
    const e = boot();
    e.on('connectRequest', () => Promise.reject(new Error('no')));
    const wire = join(e)!;
    await tick();
    expect(e.store.edgesById.has(wire.id)).toBe(false);
    expect(node(e, 'a3').out.includes(wire)).toBe(false);
    expect(e.anim.ghost).not.toBeNull();
    expect(e.canUndo).toBe(false);
  });

  it('a handler that returns nothing leaves it pending until confirm() or revert()', () => {
    const e = boot();
    let req!: ConnectRequest;
    e.on('connectRequest', (r) => void (req = r));
    const wire = join(e)!;
    expect(wire.pending).toBe(true);
    e.confirm(req.edgeIds!);
    expect(wire.pending).toBe(false);
    const w2 = e.requestConnectPorts(node(e, 'a3'), 0, node(e, 'a6'), 1)!;
    expect(w2.pending).toBe(true);
    e.revert(w2.id);
    expect(e.store.edgesById.has(w2.id)).toBe(false);
  });

  it('a passive listener (an inspector, a dialog) does not count as the host', () => {
    const e = boot();
    const seen: string[] = [];
    e.on('connectRequest', (r) => void seen.push(r.source), { passive: true });
    const wire = join(e)!;
    expect(seen).toEqual(['port-drag']);
    expect(wire.pending).toBe(false);
  });

  it('refuses a duplicate or a self-link and says nothing', () => {
    const e = boot();
    const seen: unknown[] = [];
    e.on('connectRequest', (r) => void seen.push(r));
    expect(
      e.requestConnectPorts(node(e, 'a1'), 0, node(e, 'a2'), 0),
    ).toBeNull(); // l12 exists
    expect(
      e.requestConnectPorts(node(e, 'a1'), 0, node(e, 'a1'), 0),
    ).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it("is replaced by the host's own connection once the data echoes it back", () => {
    const input = loop();
    const e = boot(input);
    e.on('connectRequest', () => undefined);
    const wire = join(e)!;
    e.time = 9;
    e.sync({
      ...input,
      connections: [
        ...input.connections,
        link('server-1', 'a3', 'B', 'a5', '2'),
      ],
    });
    expect(e.store.edgesById.has(wire.id)).toBe(false);
    const real = e.store.edgesById.get('server-1')!;
    expect(real.local).toBe(false);
    expect(real.ct).toBe(9);
    expect(e.pending.size).toBe(0);
    expect(node(e, 'a3').out.filter((x) => x.tp === real.tp)).toHaveLength(1);
  });
});

describe('disconnect', () => {
  const l23 = (e: GraphEngine) => e.store.edgesById.get('l23')!;

  it('with nobody listening it goes at once, and undo asks to bring it back', () => {
    const e = boot();
    const reqs: ConnectRequest[] = [];
    e.on('connectRequest', (r) => void reqs.push(r), { passive: true });
    e.requestDisconnect([l23(e)], 'edge');
    expect(e.store.edgesById.has('l23')).toBe(false);
    expect(e.anim.ghost).not.toBeNull();
    expect(e.undo()).toBe(true);
    expect(reqs[0]).toMatchObject({
      source: 'undo',
      from: { assetIds: ['a2'] },
      to: { assetIds: ['a3'] },
      pairs: [{ from: { portId: 'a2:out:A' }, to: { portId: 'a3:in:1' } }],
    });
    const back = node(e, 'a2').out.find((x) => x.tp.id === 'a3:in:1')!;
    expect(back.local).toBe(true);
  });

  it('with a host the wire fades (deleting) until a resolved promise removes it', async () => {
    const e = boot();
    const reqs: DisconnectRequest[] = [];
    let done!: () => void;
    e.on('disconnectRequest', (r) => {
      reqs.push(r);
      return new Promise<void>((res) => (done = res));
    });
    e.requestDisconnect([l23(e)], 'edge');
    expect(l23(e).deleting).toBe(true);
    expect(e.deleting.size).toBe(1);
    expect(reqs[0]).toEqual({
      source: 'edge',
      edges: [
        {
          id: 'l23',
          from: { assetId: 'a2', portId: 'a2:out:A' },
          to: { assetId: 'a3', portId: 'a3:in:1' },
        },
      ],
    });
    done();
    await tick();
    expect(e.store.edgesById.has('l23')).toBe(false);
    expect(e.deleting.size).toBe(0);
  });

  it('a failed delete springs back: the wire stays, no longer deleting', async () => {
    const e = boot();
    e.on('disconnectRequest', () => Promise.reject(new Error('forbidden')));
    e.time = 3;
    e.requestDisconnect([l23(e)], 'edge');
    await tick();
    expect(e.store.edgesById.has('l23')).toBe(true);
    expect(l23(e).deleting).toBe(false);
    expect(l23(e).ct).toBe(3);
    expect(e.canUndo).toBe(false);
  });

  it('a handler that returns nothing waits for the data to drop the wire, or for confirm()/revert()', () => {
    const input = loop();
    const e = boot(input);
    e.on('disconnectRequest', () => undefined);
    e.requestDisconnect([l23(e)], 'edge');
    expect(l23(e).deleting).toBe(true);
    e.sync({
      ...input,
      connections: input.connections.filter((c) => c.id !== 'l23'),
    }); // the host's data no longer has it
    expect(e.store.edgesById.has('l23')).toBe(false);
    expect(e.deleting.size).toBe(0);
    const w = e.store.edgesById.get('l45')!;
    e.requestDisconnect([w], 'edge');
    e.revert('l45');
    expect(w.deleting).toBe(false);
    e.requestDisconnect([w], 'edge');
    e.confirm('l45');
    expect(e.store.edgesById.has('l45')).toBe(false);
  });

  it('cancelling a wire the host has not saved yet never bothers the host', () => {
    const e = boot();
    const asked: unknown[] = [];
    e.on('connectRequest', () => undefined);
    const wire = e.requestConnectPorts(node(e, 'a3'), 1, node(e, 'a5'), 1)!;
    e.on('disconnectRequest', (r) => void asked.push(r));
    e.requestDisconnect([wire], 'edge');
    expect(e.store.edgesById.has(wire.id)).toBe(false);
    expect(asked).toHaveLength(0);
  });

  it('deleting a whole group pipe is one request, and one undo that restores every pair in one request', async () => {
    const input = fan(60);
    const e = boot(input);
    const ge = e.gedges.find(
      (x) => x.a.type === 'switch' && x.b.type === 'process',
    )!;
    const n = ge.edges.length;
    const out: DisconnectRequest[] = [];
    const back: ConnectRequest[] = [];
    e.on('disconnectRequest', (r) => {
      out.push(r);
      return Promise.resolve();
    });
    e.requestDisconnect(ge.edges, 'group-pipe');
    expect(out).toHaveLength(1);
    expect(out[0]!.edges).toHaveLength(n);
    await tick();
    expect(
      e.gedges.find((x) => x.a.type === 'switch' && x.b.type === 'process'),
    ).toBeUndefined();
    e.on('connectRequest', (r) => void back.push(r), { passive: true });
    e.undo();
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({
      source: 'undo',
      cardinality: 'one-to-many',
    });
    expect(back[0]!.pairs).toHaveLength(n);
    expect(
      e.gedges.find((x) => x.a.type === 'switch' && x.b.type === 'process')!
        .edges,
    ).toHaveLength(n);
  });
});

describe('group connect and bulk add', () => {
  it('a group drag asks the host with every asset on each side and the cardinality, and creates nothing', () => {
    const e = boot(fan(30));
    const g = (type: string) => e.groups.find((x) => x.type === type)!;
    const reqs: ConnectRequest[] = [];
    e.on('connectRequest', (r) => void reqs.push(r), { passive: true });
    const edges = e.store.edgeList.length;
    e.requestGroupConnect(g('source'), g('switch'));
    e.requestGroupConnect(g('switch'), g('process'));
    e.requestGroupConnect(g('process'), g('aggregator'));
    e.requestGroupConnect(g('process'), g('storage'));
    expect(reqs.map((r) => r.cardinality)).toEqual([
      'many-to-one',
      'one-to-many',
      'many-to-one',
      'many-to-many',
    ]);
    expect(reqs[1]).toMatchObject({
      source: 'group-drag',
      from: { type: 'switch', count: 1, assetIds: ['sw'] },
      existingLinks: 20,
    });
    expect(reqs[1]!.to.assetIds).toHaveLength(20);
    expect(reqs[1]!.from.port).toBeUndefined();
    expect(e.store.edgeList.length).toBe(edges);
  });

  it('connectMany takes host-named ports, creates them, relayouts if cards outgrew their cells, and is one change + one undo', () => {
    const e = boot(fan(30));
    const events: string[] = [];
    e.on('layout', (l) => void events.push('layout:' + l.reason));
    e.on(
      'change',
      (c) => void events.push(`change:${c.reason}+${c.added.length}`),
    );
    const sinks = [0, 1, 2].map((i) => `sink${i}`);
    const r = e.connectMany([
      ...sinks.map((s, i) => ({
        from: 'p5',
        fromPort: { id: `host-${i}`, name: `X${i}` },
        to: s,
        toPort: { id: `in-${i}`, name: `in-${i}` },
      })),
      { from: 'nope', fromPort: 'x', to: 'sink0', toPort: 'y' },
    ]);
    expect(r.created).toHaveLength(3);
    expect(r.skipped).toEqual([3]);
    expect(node(e, 'p5').outs.map((p) => p.name)).toEqual([
      'A',
      'X0',
      'X1',
      'X2',
    ]);
    expect(events).toEqual(['layout:ports', 'change:add+3']);
    for (const ed of e.store.edgeList) {
      expect(ed.a.outs[ed.ai]).toBe(ed.fp);
      expect(ed.b.ins[ed.bi]).toBe(ed.tp);
    }
    const again = e.connectMany([
      {
        from: 'p5',
        fromPort: 'host-0',
        to: 'sink3',
        toPort: { id: 'in-9', name: 'in-9' },
      },
    ]);
    expect(again.created).toHaveLength(1);
    expect(node(e, 'p5').outs).toHaveLength(4); // same port id: reused
    e.undo();
    e.undo();
    expect(e.store.edgesById.size).toBe(e.store.edgeList.length);
    expect(node(e, 'p5').out).toHaveLength(1);
  });
});

describe('animation clock', () => {
  it('shoves a card and settles it back exactly, then reports idle', () => {
    const e = boot();
    const b = node(e, 'a5');
    const x = b.x;
    e.time = 1;
    e.bump(b, -1, 7);
    e.time = 1.13;
    expect(e.stepAnim()).toBe(true);
    expect(b.x).toBeGreaterThan(x + 6);
    e.time = 3;
    e.stepAnim();
    expect(b.x).toBe(x);
    expect(e.anim.bumping.size).toBe(0);
    e.time = 4;
    for (let i = 0; i < 80; i++) e.stepAnim();
    expect(e.stepAnim()).toBe(false);
  });

  it('eases glow up for a selected card and back down when it is deselected', () => {
    const e = boot();
    const n = node(e, 'a3');
    e.select({ node: n });
    for (let i = 0; i < 40; i++) e.stepAnim();
    expect(n.gl).toBe(1);
    e.select(null);
    for (let i = 0; i < 40; i++) e.stepAnim();
    expect(n.gl).toBe(0);
    expect(e.anim.glowing.size).toBe(0);
  });
});
