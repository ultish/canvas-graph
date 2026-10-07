import { describe, expect, it } from 'vitest';
import {
  describeEdge,
  describeGroup,
  describeGroupEdge,
  describeNode,
  LINKS_SHOWN,
} from '../../src/-private/engine/payloads.ts';
import { fan, loop } from './fixtures.ts';
import { laidOut } from './support.ts';

describe('payloads', () => {
  const { store, groups, gedges } = laidOut(loop(), fan(40, 'f-'));

  it('describes an asset with its ports and how many connections each carries', () => {
    const p = describeNode(store.assets.get('f-sw')!);
    expect(p).toMatchObject({
      kind: 'node',
      id: 'f-sw',
      type: 'switch',
      inCount: 10,
      outCount: 40,
    });
    expect(p.ingressPorts).toHaveLength(10);
    expect(p.egressPorts).toEqual([{ id: 'f-sw:out:A', name: 'A', count: 40 }]);
  });

  it('lists who an asset is connected to, port to port, capped but with exact counts', () => {
    const p = describeNode(store.assets.get('f-sw')!);
    expect(p.incoming).toHaveLength(10);
    expect(p.outgoing).toHaveLength(LINKS_SHOWN);
    expect(p.outCount).toBe(40);
    const first = p.outgoing[0]!;
    expect(first.own).toEqual({ id: 'f-sw:out:A', name: 'A' });
    expect(first.other).toMatchObject({
      id: store.edgesById.get(first.id)!.b.id,
      name: store.edgesById.get(first.id)!.b.name,
    });
  });

  it('describes a connection by asset id and port object, with its route', () => {
    expect(describeEdge(store.edgesById.get('l23')!)).toMatchObject({
      kind: 'edge',
      id: 'l23',
      route: 'forward',
      enabled: true,
      pending: false,
      deleting: false,
      from: { id: 'a2', port: { id: 'a2:out:A', name: 'A' } },
      to: { id: 'a3', port: { id: 'a3:in:1', name: '1' } },
    });
    expect(describeEdge(store.edgesById.get('l52')!).route).toBe('loop back');
    expect(describeEdge(store.edgesById.get('l14')!).route).toBe(
      'skips 3 layer(s)',
    );
  });

  it('describes a group pipe: counts and ports aggregated by name, plus every connection id', () => {
    const ge = gedges.find(
      (x) => x.a.type === 'switch' && x.b.type === 'process',
    )!;
    const p = describeGroupEdge(ge);
    expect(p).toMatchObject({
      kind: 'groupEdge',
      count: ge.edges.length,
      route: 'forward',
      enabled: ge.edges.length,
    });
    expect(p.egressPorts).toEqual([{ name: 'A', count: ge.edges.length }]);
    expect(p.ingressPorts).toEqual([{ name: '1', count: ge.edges.length }]);
    expect(p.edgeIds).toHaveLength(ge.edges.length);
    expect(p.from).toMatchObject({ type: 'switch', count: 1 });
  });

  it('describes a group with the assets in it and where it connects', () => {
    const g = groups.find(
      (x) => x.type === 'process' && x.nodes.some((n) => n.id.startsWith('f-')),
    )!;
    const p = describeGroup(g, gedges);
    expect(p.assetIds).toHaveLength(g.nodes.length);
    expect(p.incoming.map((x) => x.type)).toEqual(['switch']);
    expect(p.outgoing.map((x) => x.type)).toEqual(['aggregator']);
  });
});
