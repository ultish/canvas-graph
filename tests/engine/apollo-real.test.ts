import {
  gql,
  InMemoryCache,
  type ApolloCache,
  type Reference,
} from '@apollo/client';
import { describe, expect, it } from 'vitest';
import { GraphEngine } from '../../src/-private/engine/engine.ts';
import type { GraphInput } from '../../src/-private/engine/types.ts';
import { fan } from './fixtures.ts';

// The same claims as apollo.test.ts, but against Apollo Client's real InMemoryCache (and its real result caching),
// not the fake the demo uses.

const TOPOLOGY = gql`
  query Topology {
    assets {
      __typename
      id
      name
      type
      status
      inputPorts {
        __typename
        id
        name
      }
      outputPorts {
        __typename
        id
        name
      }
    }
    connections {
      __typename
      id
      from {
        __typename
        assetId
        portId
      }
      to {
        __typename
        assetId
        portId
      }
      enabled
      pending
    }
  }
`;

/** The demo's fixture data, shaped as the GraphQL response would be. */
function response(n: number) {
  const g = fan(n);
  return {
    assets: g.assets.map((a) => ({
      __typename: 'Asset',
      status: 'ready',
      ...a,
      inputPorts: a.inputPorts.map((p) => ({ __typename: 'Port', ...p })),
      outputPorts: a.outputPorts.map((p) => ({ __typename: 'Port', ...p })),
    })),
    connections: g.connections.map((c) => ({
      __typename: 'Connection',
      enabled: true,
      pending: false,
      ...c,
      from: { __typename: 'Endpoint', ...c.from },
      to: { __typename: 'Endpoint', ...c.to },
    })),
  };
}

function setup(n = 200) {
  const cache = new InMemoryCache();
  cache.writeQuery({ query: TOPOLOGY, data: response(n) });
  const read = (optimistic = false) =>
    cache.readQuery<GraphInput>({ query: TOPOLOGY, optimistic })!;
  const engine = new GraphEngine();
  const first = read();
  engine.sync(first);
  return { cache, read, engine, first };
}

describe('against Apollo Client’s real cache', () => {
  it('a one-field write makes new arrays and one new asset object; every other entity keeps its identity', () => {
    const { cache, read, first } = setup();
    cache.modify({
      id: cache.identify({ __typename: 'Asset', id: 'p50' }),
      fields: { status: () => 'degraded' },
    });
    const next = read();
    expect(next).not.toBe(first);
    expect(next.assets).not.toBe(first.assets);
    const same = next.assets.filter((a, i) => a === first.assets[i]).length;
    expect(same).toBe(first.assets.length - 1);
    expect(next.connections.every((c, i) => c === first.connections[i])).toBe(
      true,
    );
  });

  it('so the canvas visits exactly one entity for it, and no layout or routing work', () => {
    const { cache, read, engine } = setup();
    const total = engine.store.nodes.length + engine.store.edgeList.length;
    cache.modify({
      id: cache.identify({ __typename: 'Asset', id: 'p50' }),
      fields: { status: () => 'degraded' },
    });
    const res = engine.sync(read());
    expect(total).toBeGreaterThan(500);
    expect(res.visited).toBe(1);
    expect(res.visual).toBe(true);
    expect(res.structural || res.routing).toBe(false);
    expect(engine.store.assets.get('p50')!.status).toBe('degraded');
  });

  it('a burst of writes in one transaction is one payload costing as many entities as changed', () => {
    const { cache, read, engine } = setup();
    cache.batch({
      update: (c) => {
        for (const id of ['p1', 'p2', 'p3'])
          c.modify({
            id: c.identify({ __typename: 'Asset', id }),
            fields: { status: () => 'degraded' },
          });
      },
    });
    expect(engine.sync(read()).visited).toBe(3);
  });

  it('writing the value a field already has changes nothing', () => {
    const { cache, read, engine, first } = setup();
    cache.modify({
      id: cache.identify({ __typename: 'Asset', id: 'p50' }),
      fields: { status: () => 'ready' },
    });
    const next = read();
    expect(next.assets.every((a, i) => a === first.assets[i])).toBe(true);
    expect(engine.sync(next).visited).toBe(0);
  });

  it('an optimistic connection, then the real one under a new id, is an add then a rename of the same wire', () => {
    const { cache, read, engine, first } = setup();
    const endpoints = {
      from: { __typename: 'Endpoint', assetId: 'src0', portId: 'src0:out:A' },
      to: { __typename: 'Endpoint', assetId: 'sink0', portId: 'sink0:in:1' },
    };
    const connection = (id: string, pending: boolean) => ({
      __typename: 'Connection',
      id,
      enabled: true,
      pending,
      ...endpoints,
    });
    const append = (
      c: Pick<ApolloCache, 'modify'>,
      conn: ReturnType<typeof connection>,
    ) =>
      c.modify({
        fields: {
          connections: (existing: readonly Reference[], { toReference }) => [
            ...existing,
            toReference(conn, true)!,
          ],
        },
      });

    cache.recordOptimisticTransaction(
      (c) => append(c, connection('temp-1', true)),
      'optimistic-1',
    );
    const optimistic = engine.sync(read(true));
    expect(optimistic.connections.added).toBe(1);
    expect(optimistic.structural).toBe(false);
    const wire = engine.store.edgesById.get('temp-1')!;
    expect(wire.pending).toBe(true);

    cache.removeOptimistic('optimistic-1');
    append(cache, connection('real-1', false));
    const done = engine.sync(read());
    expect(done.connections.renamed).toBe(1);
    expect(done.connections.added).toBe(0);
    expect(done.routing).toBe(false);
    expect(engine.store.edgesById.get('real-1')).toBe(wire);
    expect(wire.pending).toBe(false);
    expect(first.assets.length).toBeGreaterThan(0);
  });

  it('Apollo freezes what it returns in development: the canvas never writes to it', () => {
    const { read, engine } = setup(50);
    const data = read();
    expect(Object.isFrozen(data.assets[0])).toBe(true);
    expect(() => engine.sync(data)).not.toThrow();
    expect(() =>
      engine.sync({
        assets: [...data.assets],
        connections: [...data.connections],
      }),
    ).not.toThrow();
  });
});
