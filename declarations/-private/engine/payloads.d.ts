import type { AssetNode, Edge, Group, GroupEdge, Port } from './types.ts';
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
export declare const LINKS_SHOWN = 20;
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
    outgoing: Array<GroupSummary & {
        edges: number;
    }>;
    incoming: Array<GroupSummary & {
        edges: number;
    }>;
}
export type SelectionPayload = NodePayload | EdgePayload | GroupEdgePayload | GroupPayload;
export declare const portRef: (p: Port) => PortRef;
export declare const groupSummary: (g: Group) => GroupSummary;
export declare function routeOf(a: {
    layer: number;
}, b: {
    layer: number;
}, back: boolean, skip: boolean): string;
export declare function describeNode(n: AssetNode): NodePayload;
export declare function describeEdge(e: Edge): EdgePayload;
export declare function describeGroupEdge(ge: GroupEdge): GroupEdgePayload;
export declare function describeGroup(g: Group, gedges: readonly GroupEdge[]): GroupPayload;
//# sourceMappingURL=payloads.d.ts.map