import type { ConnectSpec, EngineEvents, GraphEngine } from './-private/engine/engine.ts';
import type { GroupSummary, SelectionPayload } from './-private/engine/payloads.ts';
import type { Port } from './-private/engine/types.ts';
export interface AssetView {
    id: string;
    name: string;
    type: string;
    status: string;
    inputPorts: readonly Port[];
    outputPorts: readonly Port[];
}
/**
 * What the host holds on to (via `@onReady`). Selection is tracked, so an inspector can read it in a template.
 * Everything else is a command; the canvas never changes your data, it asks (see `connectRequest` / `disconnectRequest`).
 */
export declare class GraphHandle {
    private readonly engine;
    private readonly onRefreshTheme;
    /** What is selected right now, as plain data (or null). */
    selection: SelectionPayload | null;
    /** The group (its `key`) a name search is limited to, or null for all assets. Shared by the search box and the inspector. */
    searchScope: string | null;
    constructor(engine: GraphEngine, onRefreshTheme?: () => void);
    /** Subscribe to engine events. `passive` listeners (inspectors, dialogs) are not counted as the host's request handler. */
    on<K extends keyof EngineEvents>(type: K, fn: (value: EngineEvents[K]) => unknown, opts?: {
        passive?: boolean;
    }): () => void;
    get canUndo(): boolean;
    /** An asset as the canvas currently knows it (ports included). */
    asset(id: string): AssetView | undefined;
    /** Is there already a connection from this egress port to that ingress port? */
    connected(fromAssetId: string, fromPortId: string, toAssetId: string, toPortId: string): boolean;
    /**
     * Show connections at once, in bulk. Ports are named by you; one the canvas has not seen is created on its card.
     * One `change` event, one undo step. When your data later contains them, the canvas swaps in your copies.
     */
    connectMany(specs: readonly ConnectSpec[], opts?: {
        pending?: boolean;
    }): {
        created: string[];
        skipped: number[];
    };
    /** Ask to delete connections (the same flow as the Delete key): they fade until your handler answers. */
    disconnect(ids: readonly string[]): number;
    /** Ring and name these assets on the canvas without moving or hiding anything; `[]` clears it. */
    highlightAssets(ids: readonly string[]): void;
    /** Limit name searches to one group (by its `key`), or pass null to search everything. */
    searchInGroup(key: string | null): void;
    /**
     * The user chose this asset in a search box: tell `searchPick` listeners, then (unless one returned `false`) select
     * it and move the camera to it. Returns whether the default happened.
     */
    chooseAsset(hit: {
        id: string;
        name: string;
        type: string;
    }, zoom?: number): boolean;
    /** The group a search is limited to, if it still exists. */
    get scopeGroup(): GroupSummary | undefined;
    /** Groups whose type contains `text`. */
    searchGroups(text: string, limit?: number): GroupSummary[];
    /** Remove the temporary link shown after a group drag (call it if you cancel your own connect UI). */
    cancelGroupConnect(): void;
    /** Your answer when a request handler returned nothing: it worked. */
    confirm(ids: string | readonly string[]): void;
    /** Your answer when it failed: a pending connect fades away, a pending delete springs back. */
    revert(ids: string | readonly string[]): void;
    undo(): boolean;
    selectAsset(id: string): boolean;
    selectConnection(id: string): boolean;
    clearSelection(): void;
    /** Highlight the whole upstream/downstream path of the selected asset, not just its direct connections. */
    setFullPath(on: boolean): void;
    /** Re-read the `--cg-*` theme tokens. Automatic when `data-theme` on <html> or the OS colour scheme changes; call it if you switch themes some other way. */
    refreshTheme(): void;
    fit(): void;
    /** Centre on an asset. `minScale` is the least zoom to end at (default 0.8: card details are readable from 0.5). */
    focusAsset(id: string, minScale?: number): boolean;
    /**
     * Assets whose name contains `text` (case-insensitive), names that start with it first. Limited to the group in
     * `searchScope` if there is one. `hits` is the first `limit`; `all` is every match's id (up to 200), for `highlightAssets`.
     */
    searchAssets(text: string, limit?: number): {
        total: number;
        hits: Array<{
            id: string;
            name: string;
            type: string;
        }>;
        all: string[];
    };
    focusPipeline(index: number): void;
    /** Recompute layers and positions (after many connections changed). The camera stays put. */
    relayout(): void;
}
//# sourceMappingURL=graph-handle.d.ts.map