import { type GroupSummary, type PortRef, type SelectionPayload } from './payloads.ts';
import { SpatialGrid } from './spatial.ts';
import { GraphStore, type SyncResult } from './store.ts';
import type { AssetNode, Comp, Edge, Group, GraphInput, GroupEdge, PortInput } from './types.ts';
import { Viewport } from './viewport.ts';
export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
export interface ConnectSide {
    type: string;
    layer: number;
    count: number;
    assetIds: string[];
    /** Only present when the user picked one specific port. */
    port?: PortRef;
}
export interface ConnectRequest {
    source: 'port-drag' | 'group-drag' | 'undo';
    from: ConnectSide;
    to: ConnectSide;
    cardinality: Cardinality;
    existingLinks: number;
    /** Ids of the pending (local) connections drawn for this request; pass them to confirm()/revert(). */
    edgeIds?: string[];
    /** Exact pairs, for requests that restore specific connections (undo). */
    pairs?: Array<{
        from: {
            assetId: string;
            portId: string;
        };
        to: {
            assetId: string;
            portId: string;
        };
    }>;
}
export interface DisconnectRequest {
    source: 'edge' | 'group-pipe' | 'undo' | 'api';
    edges: Array<{
        id: string;
        from: {
            assetId: string;
            portId: string;
        };
        to: {
            assetId: string;
            portId: string;
        };
    }>;
}
export interface ChangeEvent {
    reason: 'connect' | 'disconnect' | 'add' | 'remove' | 'confirm' | 'revert';
    added: string[];
    removed: string[];
}
export interface EngineEvents {
    select: SelectionPayload | null;
    change: ChangeEvent;
    sync: SyncResult;
    layout: {
        reason: string;
    };
    connectRequest: ConnectRequest;
    disconnectRequest: DisconnectRequest;
    invalidate: undefined;
    /** The group a name search is limited to changed (`null`: everything). */
    searchScope: {
        key: string | null;
        group: GroupSummary | null;
    };
    /** The user chose an asset in a search box. A handler that returns `false` takes over: nothing is selected or focused. */
    searchPick: {
        id: string;
        name: string;
        type: string;
    };
}
export interface ConnectSpec {
    from: string;
    fromPort: string | PortInput;
    to: string;
    toPort: string | PortInput;
    enabled?: boolean;
}
export type SelectionInput = {
    node?: AssetNode;
    edge?: Edge;
    ge?: GroupEdge;
    group?: Group;
} | null;
/**
 * Everything except pixels: the model, layout, selection, and the connect / disconnect flows. The host's data is
 * the source of truth; gestures are intents. A new connection is drawn at once but pending, the host is asked
 * (connectRequest), and the wire settles when the host says yes (or the data echoes it) or fades when it says no.
 */
export declare class GraphEngine {
    readonly store: GraphStore;
    readonly grid: SpatialGrid;
    readonly viewport: Viewport;
    readonly anim: import("./anim.ts").AnimState;
    private readonly emitter;
    groups: Group[];
    comps: Comp[];
    private router;
    /** The group-to-group pipes. One array, updated in place. */
    get gedges(): GroupEdge[];
    /** Seconds. The renderer sets this at the start of every frame; animations are timed against it. */
    time: number;
    fullPath: boolean;
    /** Ring the assets the host's data changes (a live feed's updates become visible). Off here, on in the component. */
    highlightUpdates: boolean;
    selected: AssetNode | null;
    selEdge: Edge | null;
    selGE: GroupEdge | null;
    selGroup: Group | null;
    readonly selNodes: Set<AssetNode>;
    readonly selGroups: Set<Group>;
    readonly selEdges: Set<Edge>;
    readonly pending: Set<Edge>;
    readonly deleting: Set<Edge>;
    /** Glide cards and group frames to their new positions after a relayout, instead of jumping. */
    animateLayout: boolean;
    layoutTweenMs: number;
    private tweenNodes;
    private tweenData;
    private tweenGroups;
    private tweenGData;
    private tweenStart;
    private undoStack;
    private laidOut;
    private stamp;
    on: <K extends keyof EngineEvents>(type: K, fn: (value: EngineEvents[K]) => unknown, opts?: {
        passive?: boolean;
    }) => () => void;
    /** Tell listeners about something the UI layer did (what they return is for the caller to read, e.g. a veto). */
    announce<K extends keyof EngineEvents>(type: K, value: EngineEvents[K]): unknown[];
    nextPickStamp(): number;
    /** Bumped whenever the model, the layout or the selection changes: cached hit-test results are stale after it. */
    epoch: number;
    invalidate(): void;
    /** Zoom to show every pipeline. `jump` skips the easing (first paint). */
    fitAll(jump?: boolean): void;
    /** Zoom to one pipeline (by its index in layout order). */
    focusPipeline(index: number): void;
    /** A group by its `key` (as selection payloads and `searchGroups` report it), or undefined once it is gone. */
    groupByKey(key: string): Group | undefined;
    /** Groups whose type contains the text (case-insensitive), as the same summaries selections use. */
    searchGroups(text: string, limit: number): GroupSummary[];
    /**
     * Assets whose name contains the text (case-insensitive), names that start with it first. `scope` is a group key:
     * only that group's assets are searched. `hits` is the first `limit`; `all` is every match's id, capped at 200,
     * for ringing them on the canvas.
     */
    searchAssets(text: string, limit: number, scope?: string | null): {
        total: number;
        hits: Array<{
            id: string;
            name: string;
            type: string;
        }>;
        all: string[];
    };
    /** Centre on an asset, zooming in far enough to read its card (`minScale`: how far in, at least). */
    focusAsset(id: string, minScale?: number): boolean;
    sync(input: GraphInput): SyncResult;
    /**
     * Recompute layers, groups and positions. With `animateLayout` on, cards and group frames glide from where they were to
     * where they now belong (a new asset arriving does not make everything teleport); otherwise they jump.
     */
    relayout(reason?: string): void;
    /** Put every moving card back at its start and queue the glide to its final position. */
    private startTween;
    /** Finish (or abandon) a glide: cards stay wherever they are unless `snap` puts them at their destination. */
    private stopTween;
    /** Connections changed but assets did not move: rebuild group pipes and lanes only. */
    reroute(delta?: {
        added: readonly Edge[];
        removed: readonly Edge[];
    }): void;
    /** Ring and name these assets on the canvas (a search result). Nothing moves or hides; an empty list clears it. */
    setFound(ids: readonly string[]): void;
    select(sel: SelectionInput): void;
    setFullPath(on: boolean): void;
    payload(): SelectionPayload | null;
    /** The payload last sent to listeners; an update that would send the same data again is dropped. */
    private lastPayload;
    private emitSelect;
    /** Highlight sets for the selected asset: direct neighbours, or the full upstream/downstream path. */
    private computeSel;
    /** After the model changed: re-point selection and hover at the live objects, drop what no longer exists. */
    private remapSelection;
    /** A sync or relayout can remove assets and replace group objects under a drag in progress: repoint it, or cancel it. */
    private remapDrags;
    /** Zoomed in: the user joined two ports. Draw it now (pending), ask the host to save it. */
    requestConnectPorts(a: AssetNode, ai: number, b: AssetNode, bi: number, record?: boolean): Edge | null;
    /** Zoomed out: the user dragged one group onto another. Nothing is drawn; the host decides the pairings. */
    requestGroupConnect(src: Group, dst: Group): void;
    /** Drop the temporary group link (the user cancelled the connect dialog). */
    cancelGroupConnect(): void;
    private askConnect;
    private settle;
    /**
     * The host-driven way to add connections in bulk (standalone use, or to show them at once while a mutation runs).
     * Ports are named by the host: an unseen port id is created on its card. One change event, one undo step.
     */
    connectMany(specs: readonly ConnectSpec[], opts?: {
        pending?: boolean;
    }): {
        created: string[];
        skipped: number[];
    };
    /**
     * Delete connections. A wire the host never saw is dropped at once. Others fade (pending delete) while the host is
     * asked (disconnectRequest); they go when the host agrees (or its data stops containing them) and spring back if not.
     */
    requestDisconnect(list: readonly Edge[], source?: DisconnectRequest['source'], record?: boolean): number;
    private finishDelete;
    /** Remove edges from the model now (the host agreed, or there is no host), with the fade for a single wire. */
    private drop;
    /** The host's answer when a handler returned nothing: it worked (pending connect settles, pending delete completes). */
    confirm(ids: string | readonly string[]): void;
    /** The host's answer when it failed: a pending connect fades away, a pending delete springs back. */
    revert(ids: string | readonly string[]): void;
    private byIds;
    /** Does this undo entry still mean something? (Its wires may have been rolled back or removed by the host since.) */
    private actionable;
    /** Undo the last gesture by asking the host for the inverse (a delete is undone by a connect request and vice versa). */
    undo(): boolean;
    private findEdge;
    get canUndo(): boolean;
    bump(n: AssetNode, side: -1 | 1, push: number): void;
    /** Advance time-based state (card shoves, glow easing). Returns true while anything still needs frames. */
    /** Are cards currently gliding? (Hit-test results can't be reused while they move.) */
    get isMoving(): boolean;
    stepAnim(): boolean;
}
//# sourceMappingURL=engine.d.ts.map