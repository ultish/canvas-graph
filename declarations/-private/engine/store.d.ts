import type { AssetNode, Edge, GraphInput, Port, PortInput } from './types.ts';
export interface SyncResult {
    assets: {
        added: number;
        changed: number;
        removed: number;
    };
    connections: {
        added: number;
        changed: number;
        removed: number;
        promoted: number;
        /** Same wire, new id (an optimistic response swapping its temporary id for the real one). */
        renamed: number;
        dangling: number;
    };
    /** Added/removed assets, a changed type, or a card that outgrew its cell: positions must be recomputed. */
    structural: boolean;
    /** Connections appeared or disappeared: group pipes and lanes must be rebuilt. */
    routing: boolean;
    /** Anything visible changed (names, status, enabled/pending): a redraw is worth it. */
    visual: boolean;
    /** Assets and connections whose object identity differed from last time (the cost of this sync). */
    visited: number;
    /** Local (gesture-created) connections that the host's data now echoes back: [local id, real id]. */
    promoted: Array<[string, string]>;
    /** Connections the host's data just stopped marking pending (saved): they get the settle pulse. */
    settled: string[];
    /** Assets whose name, status or ports changed in place (not new ones): what a live feed would highlight. */
    changedAssets: AssetNode[];
    /** Connections created and removed by this sync (so routing can be updated in place). */
    addedEdges: Edge[];
    removedEdges: Edge[];
}
/**
 * The engine's model, keyed by the host's ids. `sync` folds a GraphQL-shaped payload into it by
 * identity: an object that is `===` to last time's costs nothing (Apollo only allocates when
 * something changed), and the model's own objects keep their identity across syncs.
 */
export declare class GraphStore {
    assets: Map<string, AssetNode>;
    edgesById: Map<string, Edge>;
    nodes: AssetNode[];
    edgeList: Edge[];
    private localByKey;
    private prevAssets;
    private prevConns;
    private localSeq;
    private makePort;
    private makeNode;
    /** Reconcile one side's ports by id. Returns the edges that pointed at a port that no longer exists. */
    private reconcilePorts;
    private reindex;
    private makeEdge;
    /** Remove edges in one pass (one array compaction, not one per edge). */
    removeEdges(list: Iterable<Edge>): void;
    /** Add a connection made by a gesture or a bulk command; the host's data replaces it once it echoes it back. */
    addLocalEdge(a: AssetNode, fp: Port, b: AssetNode, tp: Port, opts?: {
        enabled?: boolean;
        pending?: boolean;
    }): Edge | null;
    /** The host owns port names; an unseen port id is added to the card. Returns true if the card outgrew its cell. */
    ensurePort(n: AssetNode, side: 'in' | 'out', spec: string | PortInput): {
        port: Port;
        overflow: boolean;
    };
    findPort(n: AssetNode, side: 'in' | 'out', id: string): Port | undefined;
    sync(input: GraphInput): SyncResult;
    private updateAsset;
    /**
     * Steady state: the same entities in the same order, some replaced by changed copies. Compares position by position
     * (no lookups, no sets) and only touches what differs. Returns false, having changed nothing, if membership or order
     * differs, so the full path decides.
     */
    private syncAssetsFast;
    /** The same, for connections: only a flag change (enabled / pending) in place qualifies; anything else takes the full path. */
    private syncConnectionsFast;
    private pendingNew;
    /** Positions and groups for the current model. */
    layout(): import("./layout.ts").LayoutResult;
}
//# sourceMappingURL=store.d.ts.map