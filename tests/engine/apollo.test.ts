import { describe, expect, it } from 'vitest';
import {
  FakeGraphCache,
  startStatusTicker,
} from '../../demo-app/apollo-fake.ts';
import { GraphEngine } from '../../src/-private/engine/engine.ts';
import type { ConnectionInput } from '../../src/-private/engine/types.ts';
import { fan, link, loop } from './fixtures.ts';

describe('FakeGraphCache (the Apollo semantics the engine relies on)', () => {
  it('a one-field write makes one new asset object and new arrays, and every other entity keeps its identity', () => {
    const cache = new FakeGraphCache(fan(200));
    const before = cache.data;
    expect(cache.writeAsset('p5', { status: 'degraded' })).toBe(true);
    const after = cache.data;
    expect(after).not.toBe(before);
    expect(after.assets).not.toBe(before.assets);
    const r = cache.lastReport!;
    expect(r.assetsChanged).toBe(1);
    expect(r.assetsSame).toBe(before.assets.length - 1);
    expect(r.connectionsChanged).toBe(0);
    expect(after.assets.find((a) => a.id === 'p6')).toBe(
      before.assets.find((a) => a.id === 'p6'),
    );
  });

  it('writing the value a field already has is a no-op and notifies nobody', () => {
    const cache = new FakeGraphCache(fan(5));
    let calls = 0;
    cache.subscribe(() => calls++);
    expect(cache.writeAsset('p1', { status: 'degraded' })).toBe(true);
    expect(calls).toBe(1);
    const written = cache.data;
    expect(cache.writeAsset('p1', { status: 'degraded' })).toBe(false); // the value it already has
    expect(cache.writeAsset('nope', { status: 'x' })).toBe(false);
    expect(cache.data).toBe(written);
    expect(calls).toBe(1);
  });

  it('batch sends one notification for many writes', () => {
    const cache = new FakeGraphCache(fan(5));
    const seen: number[] = [];
    cache.subscribe((d) => seen.push(d.assets.length));
    cache.batch(() => {
      cache.writeAsset('p1', { status: 'degraded' });
      cache.writeAsset('p2', { status: 'degraded' });
      cache.evictConnections(['c-sw-p1']);
    });
    expect(seen).toHaveLength(1);
    expect(cache.writes).toBe(1);
  });

  it('the status ticker changes exactly one field on one entity per tick', async () => {
    const cache = new FakeGraphCache(fan(50));
    const stop = startStatusTicker(cache, 5);
    await new Promise((r) => setTimeout(r, 40));
    stop();
    expect(cache.writes).toBeGreaterThan(2);
    const r = cache.lastReport!;
    expect(r.assetsChanged).toBe(1);
    expect(r.connectionsChanged).toBe(0);
  });
});

describe('the engine fed by a cache', () => {
  const boot = (input = fan(300)) => {
    const cache = new FakeGraphCache(input);
    const engine = new GraphEngine();
    engine.sync(cache.data);
    return { cache, engine };
  };

  it('a subscription tick costs one visited entity out of thousands, and no relayout', () => {
    const { cache, engine } = boot();
    const total = cache.data.assets.length + cache.data.connections.length;
    const layouts: string[] = [];
    engine.on('layout', (l) => void layouts.push(l.reason));
    cache.writeAsset('p100', { status: 'degraded' });
    const r = engine.sync(cache.data);
    expect(total).toBeGreaterThan(900);
    expect(r.visited).toBe(1);
    expect(r.visual).toBe(true);
    expect(r.structural || r.routing).toBe(false);
    expect(layouts).toEqual([]);
    expect(engine.store.assets.get('p100')!.status).toBe('degraded');
  });

  it('a batch of ticks costs the number of entities that changed', () => {
    const { cache, engine } = boot();
    cache.batch(() => {
      for (const id of ['p1', 'p2', 'p3', 'p4'])
        cache.writeAsset(id, { status: 'degraded' });
    });
    expect(engine.sync(cache.data).visited).toBe(4);
  });

  it('an optimistic connection shows as pending, then the real one takes its place as the same wire (a rename, with a settle pulse)', () => {
    const { cache, engine } = boot(loop());
    const draft: ConnectionInput = link('temp-1', 'a3', 'B', 'a5', '2');
    cache.addOptimistic('temp-1', [draft]);
    const first = engine.sync(cache.data);
    expect(first.connections.added).toBe(1);
    expect(first.structural).toBe(false);
    const wire = engine.store.edgesById.get('temp-1')!;
    expect(wire.pending).toBe(true);

    engine.time = 7;
    cache.batch(() => {
      cache.removeOptimistic('temp-1');
      cache.writeConnection(link('conn-77', 'a3', 'B', 'a5', '2'));
    });
    const second = engine.sync(cache.data);
    expect(second.connections.renamed).toBe(1);
    expect(second.connections.added).toBe(0);
    expect(second.connections.removed).toBe(0);
    expect(second.routing).toBe(false);
    expect(engine.store.edgesById.get('conn-77')).toBe(wire); // the same Edge object: no flicker, no re-route
    expect(engine.store.edgesById.has('temp-1')).toBe(false);
    expect(wire.pending).toBe(false);
    expect(wire.ct).toBe(7);
  });

  it('a wire the user drew is replaced by the optimistic copy, then by the real one, and never doubled', async () => {
    const { cache, engine } = boot(loop());
    engine.on('connectRequest', async (req) => {
      const pair = {
        from: { assetId: req.from.assetIds[0]!, portId: req.from.port!.id },
        to: { assetId: req.to.assetIds[0]!, portId: req.to.port!.id },
      };
      cache.addOptimistic('t', [{ id: 't', ...pair }]);
      engine.sync(cache.data);
      await new Promise((r) => setTimeout(r, 5));
      cache.batch(() => {
        cache.removeOptimistic('t');
        cache.writeConnection({ id: 'real', ...pair });
      });
      engine.sync(cache.data);
    });
    const a3 = engine.store.assets.get('a3')!;
    const a5 = engine.store.assets.get('a5')!;
    const local = engine.requestConnectPorts(a3, 1, a5, 1)!;
    await new Promise((r) => setTimeout(r, 30));
    expect(engine.store.edgesById.has(local.id)).toBe(false); // the user's local wire was swapped for the host's
    const wires = a3.out.filter((e) => e.tp === a5.ins[1]);
    expect(wires).toHaveLength(1);
    expect(wires[0]!.id).toBe('real');
    expect(wires[0]!.pending).toBe(false);
    expect(engine.pending.size).toBe(0);
  });

  it('a failed mutation: the optimistic copy is rolled back and the wire fades away', async () => {
    const { cache, engine } = boot(loop());
    engine.on('connectRequest', async (req) => {
      cache.addOptimistic('t', [
        {
          id: 't',
          from: { assetId: req.from.assetIds[0]!, portId: req.from.port!.id },
          to: { assetId: req.to.assetIds[0]!, portId: req.to.port!.id },
        },
      ]);
      engine.sync(cache.data);
      await new Promise((r) => setTimeout(r, 5));
      cache.removeOptimistic('t');
      engine.sync(cache.data);
      throw new Error('server said no');
    });
    const a3 = engine.store.assets.get('a3')!;
    const a5 = engine.store.assets.get('a5')!;
    engine.requestConnectPorts(a3, 1, a5, 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(a3.out.filter((e) => e.tp === a5.ins[1])).toHaveLength(0);
    expect(engine.pending.size).toBe(0);
    expect(engine.canUndo).toBe(false);
  });

  it('a delete: the wire fades until the cache evicts it, then it is gone', async () => {
    const { cache, engine } = boot(loop());
    engine.on('disconnectRequest', async (req) => {
      await new Promise((r) => setTimeout(r, 5));
      cache.evictConnections(req.edges.map((e) => e.id));
      engine.sync(cache.data);
    });
    const wire = engine.store.edgesById.get('l23')!;
    engine.requestDisconnect([wire], 'edge');
    expect(wire.deleting).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(engine.store.edgesById.has('l23')).toBe(false);
    expect(engine.deleting.size).toBe(0);
  });

  it('a bulk optimistic add (a whole group pipe) is one sync, and the swap to real ids is renames only', () => {
    const { cache, engine } = boot(fan(100));
    const pairs = Array.from({ length: 100 }, (_, i) =>
      link(`t${i}`, `p${i}`, 'A', 'sink0', '1'),
    );
    cache.addOptimistic('bulk', pairs);
    const added = engine.sync(cache.data);
    expect(added.connections.added).toBe(100);
    expect(added.structural).toBe(false);
    cache.batch(() => {
      cache.removeOptimistic('bulk');
      pairs.forEach((p, i) =>
        cache.writeConnection({ id: `r${i}`, from: p.from, to: p.to }),
      );
    });
    const swapped = engine.sync(cache.data);
    expect(swapped.connections.renamed).toBe(100);
    expect(swapped.routing).toBe(false);
    expect(swapped.visual).toBe(true);
  });
});
