import Modifier from 'ember-modifier';
import type { ChangeEvent, ConnectRequest, DisconnectRequest } from '../-private/engine/engine.ts';
import type { SelectionPayload } from '../-private/engine/payloads.ts';
import { type FrameStats } from '../-private/engine/renderer.ts';
import type { SyncResult } from '../-private/engine/store.ts';
import type { GraphInput } from '../-private/engine/types.ts';
import { GraphHandle } from '../graph-handle.ts';
export interface GraphCanvasNamed {
    /** Your assets, ports and connections. Folded in by identity, so a payload where unchanged entities keep their object costs nothing. */
    data?: GraphInput | null;
    /** Pin colours for asset types ('#rrggbb'); other types get a stable colour of their own. */
    colors?: Record<string, string>;
    /** Highlight the whole upstream/downstream path of a selected asset. */
    fullPath?: boolean;
    /**
     * The densest pixel ratio the canvas will draw at (default 1.5). A 2x or 3x screen means 4-9x the pixels to fill, which
     * is what hurts a client with no GPU. Pass a higher number, or Infinity, to draw at the screen's full density.
     */
    maxPixelRatio?: number;
    /**
     * Draw at most this many frames a second (default 60, uncapped). 30 halves the drawing work on a weak client, at the
     * cost of choppier animation.
     */
    maxFps?: number;
    /**
     * Apply at most one data payload per this many ms (the newest; the ones in between are skipped, which is safe because each
     * is the whole truth). A number, or 'auto' (100 ms above 5,000 assets, none below). Default: off. For a very busy feed on
     * a big graph.
     */
    syncThrottle?: number | 'auto';
    /** Ring the assets your data changes, briefly (default true): a live feed's updates become visible. */
    highlightUpdates?: boolean;
    /** Glide cards to their new positions when the layout changes (default true). Off: they jump. */
    animateLayout?: boolean;
    onReady?: (handle: GraphHandle) => void;
    onSelect?: (selection: SelectionPayload | null) => void;
    onChange?: (change: ChangeEvent) => void;
    onSync?: (result: SyncResult) => void;
    onLayout?: (info: {
        reason: string;
    }) => void;
    onFrame?: (stats: FrameStats) => void;
    /** The user wants to connect. May return a Promise: resolved = saved, rejected = refused. */
    onConnectRequest?: (request: ConnectRequest) => unknown;
    /** The user wants to delete connections. May return a Promise. */
    onDisconnectRequest?: (request: DisconnectRequest) => unknown;
}
interface Signature {
    Element: HTMLElement;
    Args: {
        Named: GraphCanvasNamed;
    };
}
/**
 * Mounts the graph canvas in an element. Reading `@data` here puts it in Ember's tracking frame (the same rule your
 * grid's `recordsSource` follows), so a new payload re-runs `modify` and the canvas syncs by identity.
 */
export default class GraphCanvasModifier extends Modifier<Signature> {
    private engine;
    private renderer;
    private handle;
    private args;
    private lastData;
    private lastFull;
    private lastRatio;
    private refit;
    private inModify;
    private bound;
    modify(element: HTMLElement, _positional: [], named: GraphCanvasNamed): void;
    private mount;
    /** Writes to the host's tracked state must not happen during this modifier's own run (backtracking). */
    private later;
    private apply;
    /** The newest payload wins; with `@syncThrottle` set, at most one is applied per window. */
    private syncer;
    /** (Re)register a host callback only while it exists, so "no handler" really means no handler. */
    private bind;
}
export {};
//# sourceMappingURL=graph-canvas.d.ts.map