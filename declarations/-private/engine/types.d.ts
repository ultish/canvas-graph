export interface PortInput {
    id: string;
    name: string;
}
export interface AssetInput {
    id: string;
    name: string;
    type: string;
    status?: string;
    inputPorts: readonly PortInput[];
    outputPorts: readonly PortInput[];
}
export interface ConnectionInput {
    id: string;
    from: {
        assetId: string;
        portId: string;
    };
    to: {
        assetId: string;
        portId: string;
    };
    enabled?: boolean;
    pending?: boolean;
}
export interface GraphInput {
    assets: readonly AssetInput[];
    connections: readonly ConnectionInput[];
}
export interface Port {
    id: string;
    name: string;
}
export interface Edge {
    id: string;
    a: AssetNode;
    b: AssetNode;
    fp: Port;
    tp: Port;
    ai: number;
    bi: number;
    back: boolean;
    enabled: boolean;
    pending: boolean;
    deleting: boolean;
    local: boolean;
    raw: ConnectionInput | null;
    ge: GroupEdge | null;
    stamp: number;
    pstamp: number;
    ct: number | undefined;
}
export interface AssetNode {
    id: string;
    name: string;
    type: string;
    status: string;
    raw: AssetInput | null;
    ins: Port[];
    outs: Port[];
    in: Edge[];
    out: Edge[];
    x: number;
    y: number;
    w: number;
    h: number;
    layer: number;
    g: Group | null;
    /** Only during a relayout: the group this asset belonged to before it. */
    og: Group | null;
    ord: number;
    /** When the host's data last changed this asset (seconds): a short highlight ring while it is recent. */
    pulse: number | undefined;
    gl: number;
    bt: number | null;
    bside: -1 | 1;
    bpush: number;
    x0: number | undefined;
    hiP: number[];
    hoP: number[];
    hiC: string[];
}
export interface Group {
    id: number;
    key: string;
    comp: Comp;
    layer: number;
    type: string;
    nodes: AssetNode[];
    x: number;
    y: number;
    w: number;
    h: number;
    rows: number;
    mh: number;
    rh: number;
}
export interface GroupEdge {
    a: Group;
    b: Group;
    count: number;
    back: boolean;
    skip: boolean;
    laneY: number | undefined;
    edges: Edge[];
}
export interface Comp {
    /** 'pipeline': assets connected to each other. 'unconnected': every asset with no connections, gathered into one block. */
    kind: 'pipeline' | 'unconnected';
    nodes: AssetNode[];
    groups: Group[];
    bbox: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    bbox0: {
        y: number;
        h: number;
    };
}
export interface Point {
    x: number;
    y: number;
}
/** One cubic bezier: start, two controls, end. */
export type Cubic = readonly [Point, Point, Point, Point];
//# sourceMappingURL=types.d.ts.map