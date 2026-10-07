import { tracked } from '@glimmer/tracking';
import type {
  ConnectSpec,
  EngineEvents,
  GraphEngine,
} from './-private/engine/engine.ts';
import type {
  GroupSummary,
  SelectionPayload,
} from './-private/engine/payloads.ts';
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
export class GraphHandle {
  /** What is selected right now, as plain data (or null). */
  @tracked selection: SelectionPayload | null = null;

  /** The group (its `key`) a name search is limited to, or null for all assets. Shared by the search box and the inspector. */
  @tracked searchScope: string | null = null;

  constructor(
    private readonly engine: GraphEngine,
    private readonly onRefreshTheme: () => void = () => undefined,
  ) {}

  /** Subscribe to engine events. `passive` listeners (inspectors, dialogs) are not counted as the host's request handler. */
  on<K extends keyof EngineEvents>(
    type: K,
    fn: (value: EngineEvents[K]) => unknown,
    opts?: { passive?: boolean },
  ): () => void {
    return this.engine.on(type, fn, opts);
  }

  get canUndo(): boolean {
    return this.engine.canUndo;
  }

  /** An asset as the canvas currently knows it (ports included). */
  asset(id: string): AssetView | undefined {
    const n = this.engine.store.assets.get(id);
    return (
      n && {
        id: n.id,
        name: n.name,
        type: n.type,
        status: n.status,
        inputPorts: n.ins,
        outputPorts: n.outs,
      }
    );
  }

  /** Is there already a connection from this egress port to that ingress port? */
  connected(
    fromAssetId: string,
    fromPortId: string,
    toAssetId: string,
    toPortId: string,
  ): boolean {
    const a = this.engine.store.assets.get(fromAssetId);
    return !!a?.out.some(
      (e) =>
        e.fp.id === fromPortId && e.b.id === toAssetId && e.tp.id === toPortId,
    );
  }

  /**
   * Show connections at once, in bulk. Ports are named by you; one the canvas has not seen is created on its card.
   * One `change` event, one undo step. When your data later contains them, the canvas swaps in your copies.
   */
  connectMany(
    specs: readonly ConnectSpec[],
    opts?: { pending?: boolean },
  ): { created: string[]; skipped: number[] } {
    return this.engine.connectMany(specs, opts);
  }

  /** Ask to delete connections (the same flow as the Delete key): they fade until your handler answers. */
  disconnect(ids: readonly string[]): number {
    const edges = ids
      .map((id) => this.engine.store.edgesById.get(id))
      .filter((e) => !!e);
    return this.engine.requestDisconnect(edges, 'api');
  }

  /** Ring and name these assets on the canvas without moving or hiding anything; `[]` clears it. */
  highlightAssets(ids: readonly string[]): void {
    this.engine.setFound(ids);
  }

  /** Limit name searches to one group (by its `key`), or pass null to search everything. */
  searchInGroup(key: string | null): void {
    if (this.searchScope === key) return;
    this.searchScope = key;
    this.engine.announce('searchScope', {
      key,
      group: this.scopeGroup ?? null,
    });
  }

  /**
   * The user chose this asset in a search box: tell `searchPick` listeners, then (unless one returned `false`) select
   * it and move the camera to it. Returns whether the default happened.
   */
  chooseAsset(
    hit: { id: string; name: string; type: string },
    zoom = 0.55,
  ): boolean {
    if (this.engine.announce('searchPick', hit).includes(false)) return false;
    this.selectAsset(hit.id);
    this.focusAsset(hit.id, zoom);
    return true;
  }

  /** The group a search is limited to, if it still exists. */
  get scopeGroup(): GroupSummary | undefined {
    const g = this.searchScope
      ? this.engine.groupByKey(this.searchScope)
      : undefined;
    return (
      g && { key: g.key, type: g.type, layer: g.layer, count: g.nodes.length }
    );
  }

  /** Groups whose type contains `text`. */
  searchGroups(text: string, limit = 3): GroupSummary[] {
    return this.engine.searchGroups(text, limit);
  }

  /** Remove the temporary link shown after a group drag (call it if you cancel your own connect UI). */
  cancelGroupConnect(): void {
    this.engine.cancelGroupConnect();
  }

  /** Your answer when a request handler returned nothing: it worked. */
  confirm(ids: string | readonly string[]): void {
    this.engine.confirm(ids);
  }

  /** Your answer when it failed: a pending connect fades away, a pending delete springs back. */
  revert(ids: string | readonly string[]): void {
    this.engine.revert(ids);
  }

  undo(): boolean {
    return this.engine.undo();
  }

  selectAsset(id: string): boolean {
    const node = this.engine.store.assets.get(id);
    if (node) this.engine.select({ node });
    return !!node;
  }

  selectConnection(id: string): boolean {
    const edge = this.engine.store.edgesById.get(id);
    if (edge) this.engine.select({ edge });
    return !!edge;
  }

  clearSelection(): void {
    this.engine.select(null);
  }

  /** Highlight the whole upstream/downstream path of the selected asset, not just its direct connections. */
  setFullPath(on: boolean): void {
    this.engine.setFullPath(on);
  }

  /** Re-read the `--cg-*` theme tokens. Automatic when `data-theme` on <html> or the OS colour scheme changes; call it if you switch themes some other way. */
  refreshTheme(): void {
    this.onRefreshTheme();
  }

  fit(): void {
    this.engine.fitAll();
  }

  /** Centre on an asset. `minScale` is the least zoom to end at (default 0.8: card details are readable from 0.5). */
  focusAsset(id: string, minScale?: number): boolean {
    return this.engine.focusAsset(id, minScale);
  }

  /**
   * Assets whose name contains `text` (case-insensitive), names that start with it first. Limited to the group in
   * `searchScope` if there is one. `hits` is the first `limit`; `all` is every match's id (up to 200), for `highlightAssets`.
   */
  searchAssets(
    text: string,
    limit = 10,
  ): {
    total: number;
    hits: Array<{ id: string; name: string; type: string }>;
    all: string[];
  } {
    const scope = this.scopeGroup ? this.searchScope : null;
    return this.engine.searchAssets(text, limit, scope);
  }

  focusPipeline(index: number): void {
    this.engine.focusPipeline(index);
  }

  /** Recompute layers and positions (after many connections changed). The camera stays put. */
  relayout(): void {
    this.engine.relayout('manual');
  }
}
