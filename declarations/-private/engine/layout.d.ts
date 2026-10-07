import { type LayoutConfig, type LayoutInput, type LayoutOutput } from './layout-core.ts';
import type { AssetNode, Comp, Edge, Group, GroupEdge } from './types.ts';
export declare const GAP_CARD = 64;
export declare const PAD = 64;
export declare const NODE_W = 200;
export declare const CW: number;
export declare const GAP_LAYER = 420;
export declare const GAP_GROUP = 80;
export declare const GAP_COMP = 1600;
export declare const GAP_COMP_X = 800;
export declare const PORT_Y0 = 52;
export declare const PORT_DY = 20;
export declare const cardHeight: (n: Pick<AssetNode, "ins" | "outs">) => number;
export declare const portY: (n: AssetNode, k: number) => number;
export interface LayoutResult {
    groups: Group[];
    comps: Comp[];
}
export declare const LAYOUT_CONFIG: LayoutConfig;
/** Assets and connections as the typed arrays the layout core works on (and numbers assets 0..n-1 in `ord`). */
export declare function buildLayoutInput(nodes: readonly AssetNode[], edges: readonly Edge[]): LayoutInput;
/** Put a layout result onto the model: layers, positions, back connections, and fresh group and pipeline objects. */
export declare function applyLayout(nodes: readonly AssetNode[], edges: readonly Edge[], out: LayoutOutput): LayoutResult;
/**
 * Lay the whole graph out: break cycles (the closing connection becomes a "back" connection), layer by longest path, group
 * by (layer, type), place layers left to right with the largest group of each layer on the baseline, and shelf-pack
 * pipelines and the block of unconnected assets. The algorithm is `computeLayout` (layout-core.ts), on typed arrays.
 * Idempotent: it derives everything from the model, so it can run again after the data changes.
 */
export declare function layoutGraph(nodes: readonly AssetNode[], edges: readonly Edge[]): LayoutResult;
/**
 * Group-to-group pipes, kept up to date as connections come and go. A connection joining two groups that already have a
 * pipe just changes its count; a pipe that appears or disappears and is a loop (above) or a layer-skipper (below)
 * re-runs the lane assignment for its one pipeline. `rebuild` is the from-scratch version (after a relayout).
 * `gedges` is one array that is updated in place, so holding a reference to it is safe.
 */
export declare class GroupRouter {
    readonly gedges: GroupEdge[];
    private byKey;
    private key;
    rebuild(edges: readonly Edge[], comps: readonly Comp[]): void;
    /** Add connections (both ends must be laid out). */
    add(edges: readonly Edge[]): void;
    /** Remove connections. A pipe left with none is dropped. */
    remove(edges: readonly Edge[]): void;
    private attach;
    /** Loops over the top and layer-skippers underneath, each in the first lane that does not overlap another in its span. */
    private lanes;
}
/** From-scratch routing: group pipes and lanes for every connection. */
export declare function routeEdges(edges: readonly Edge[], groups: readonly Group[], comps: readonly Comp[]): GroupEdge[];
//# sourceMappingURL=layout.d.ts.map