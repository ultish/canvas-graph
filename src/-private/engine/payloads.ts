import type { AssetNode, Edge, Group, GroupEdge, Port } from './types.ts';

// Plain, serialisable descriptions of what is selected. This is what the host's inspector/table renders.

export interface PortRef {
  id: string;
  name: string;
}
export interface GroupSummary {
  key: string;
  type: string;
  layer: number;
  count: number;
}
export interface PortCount extends PortRef {
  count: number;
}
export interface NamedCount {
  name: string;
  count: number;
}

/** One connection of an asset, from its point of view: its own port, and the asset and port at the other end. */
export interface Link {
  id: string;
  own: PortRef;
  other: Endpoint;
}
/** How many of an asset's connections a node payload lists (the counts are always exact). */
export const LINKS_SHOWN = 20;

export interface NodePayload {
  kind: 'node';
  id: string;
  name: string;
  type: string;
  layer: number;
  status: string;
  group: GroupSummary;
  inCount: number;
  outCount: number;
  ingressPorts: PortCount[];
  egressPorts: PortCount[];
  /** Connections into this asset (the first `LINKS_SHOWN`): `own` is its ingress port, `other` the sender's egress port. */
  incoming: Link[];
  /** Connections out of this asset: `own` is its egress port, `other` the receiver's ingress port. */
  outgoing: Link[];
}
export interface Endpoint {
  id: string;
  name: string;
  type: string;
  port: PortRef;
}
export interface EdgePayload {
  kind: 'edge';
  id: string;
  from: Endpoint;
  to: Endpoint;
  route: string;
  enabled: boolean;
  pending: boolean;
  deleting: boolean;
  fromGroup: GroupSummary;
  toGroup: GroupSummary;
}
export interface GroupEdgePayload {
  kind: 'groupEdge';
  from: GroupSummary;
  to: GroupSummary;
  count: number;
  route: string;
  /** Aggregated by port name: each asset has its own port ids, a group-wide id list would be useless. */
  egressPorts: NamedCount[];
  ingressPorts: NamedCount[];
  enabled: number;
  edgeIds: string[];
}
export interface GroupPayload extends GroupSummary {
  kind: 'group';
  degraded: number;
  assetIds: string[];
  outgoing: Array<GroupSummary & { edges: number }>;
  incoming: Array<GroupSummary & { edges: number }>;
}
export type SelectionPayload =
  NodePayload | EdgePayload | GroupEdgePayload | GroupPayload;

export const portRef = (p: Port): PortRef => ({ id: p.id, name: p.name });
export const groupSummary = (g: Group): GroupSummary => ({
  key: g.key,
  type: g.type,
  layer: g.layer,
  count: g.nodes.length,
});

export function routeOf(
  a: { layer: number },
  b: { layer: number },
  back: boolean,
  skip: boolean,
): string {
  return back
    ? 'loop back'
    : skip
      ? `skips ${b.layer - a.layer - 1} layer(s)`
      : 'forward';
}

const endpoint = (n: AssetNode, port: Port): Endpoint => ({
  id: n.id,
  name: n.name,
  type: n.type,
  port: portRef(port),
});

function byName(list: readonly Edge[], pick: (e: Edge) => Port): NamedCount[] {
  const m = new Map<string, number>();
  for (const e of list) m.set(pick(e).name, (m.get(pick(e).name) ?? 0) + 1);
  return [...m]
    .map(([name, count]) => ({ name, count }))
    .sort((p, q) => q.count - p.count);
}

export function describeNode(n: AssetNode): NodePayload {
  return {
    kind: 'node',
    id: n.id,
    name: n.name,
    type: n.type,
    layer: n.layer,
    status: n.status,
    group: groupSummary(n.g!),
    inCount: n.in.length,
    outCount: n.out.length,
    ingressPorts: n.ins.map((p) => ({
      ...portRef(p),
      count: n.in.filter((e) => e.tp === p).length,
    })),
    egressPorts: n.outs.map((p) => ({
      ...portRef(p),
      count: n.out.filter((e) => e.fp === p).length,
    })),
    incoming: n.in.slice(0, LINKS_SHOWN).map((e) => ({
      id: e.id,
      own: portRef(e.tp),
      other: endpoint(e.a, e.fp),
    })),
    outgoing: n.out.slice(0, LINKS_SHOWN).map((e) => ({
      id: e.id,
      own: portRef(e.fp),
      other: endpoint(e.b, e.tp),
    })),
  };
}

export function describeEdge(e: Edge): EdgePayload {
  return {
    kind: 'edge',
    id: e.id,
    from: endpoint(e.a, e.fp),
    to: endpoint(e.b, e.tp),
    route: routeOf(e.a, e.b, e.back, !!e.ge?.skip),
    enabled: e.enabled,
    pending: e.pending,
    deleting: e.deleting,
    fromGroup: groupSummary(e.a.g!),
    toGroup: groupSummary(e.b.g!),
  };
}

export function describeGroupEdge(ge: GroupEdge): GroupEdgePayload {
  return {
    kind: 'groupEdge',
    from: groupSummary(ge.a),
    to: groupSummary(ge.b),
    count: ge.edges.length,
    route: routeOf(ge.a, ge.b, ge.back, ge.skip),
    egressPorts: byName(ge.edges, (e) => e.fp),
    ingressPorts: byName(ge.edges, (e) => e.tp),
    enabled: ge.edges.filter((e) => e.enabled).length,
    edgeIds: ge.edges.map((e) => e.id),
  };
}

export function describeGroup(
  g: Group,
  gedges: readonly GroupEdge[],
): GroupPayload {
  return {
    kind: 'group',
    ...groupSummary(g),
    degraded: g.nodes.filter((n) => n.status === 'degraded').length,
    assetIds: g.nodes.map((n) => n.id),
    outgoing: gedges
      .filter((x) => x.a === g)
      .map((x) => ({ ...groupSummary(x.b), edges: x.edges.length })),
    incoming: gedges
      .filter((x) => x.b === g)
      .map((x) => ({ ...groupSummary(x.a), edges: x.edges.length })),
  };
}
