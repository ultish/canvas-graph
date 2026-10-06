// A local fake of Apollo Client's cache semantics, backing the demo (and the sync tests).
//
// WHY THIS EXISTS
// ---------------------------------------------------------------------------------------------
// The canvas claims that a one-field update from a subscription costs one asset, not a pass over the whole
// graph, because `sync()` folds a payload in by object identity and Apollo only allocates a new object for an
// entity that changed. This makes that a number you can read, next to the payload sizes.
//
// `@apollo/client` and `glimmer-apollo` are deliberately not dependencies of this addon (it depends on no data
// layer). This is a small stand-in, a sibling of the one in the glide-data-grid-ember test app.
//
// WHAT IT REPRODUCES
// ---------------------------------------------------------------------------------------------
//   1. An immutable cache. A write produces a NEW entity object, leaves every unchanged entity referentially
//      identical, and produces NEW containing arrays and a NEW result object. `lastReport` measures that
//      element by element instead of claiming it.
//   2. Result caching: writing a field the value it already has is a no-op, with no notification.
//   3. `cache.batch`: many writes, one notification (one render).
//   4. Optimistic responses: a mutation shows its result at once under a temporary id (marked pending), and when the
//      server answers, the optimistic layer is removed and the real entity is written in the same batch, so the host
//      sees the same wire under a new id, which `sync()` treats as a rename.
//
// WHAT IT DOES NOT MODEL: GraphQL documents, normalisation by `__typename:id`, field policies, fetch policies,
// refetching, errors, or a network. If a demo needs those, add real Apollo rather than growing this file.
import type { AssetInput, ConnectionInput, GraphInput } from '#src/index.ts';

export interface IdentityReport {
  assetsChanged: number;
  assetsSame: number;
  connectionsChanged: number;
  connectionsSame: number;
  /** Apollo hands back a new array whenever anything inside changed. */
  newAssetsArray: boolean;
  newConnectionsArray: boolean;
}

type AssetPatch = Partial<Omit<AssetInput, 'id'>>;

export class FakeGraphCache {
  private assets = new Map<string, AssetInput>();
  private connections = new Map<string, ConnectionInput>();
  private layers = new Map<string, ConnectionInput[]>();
  private listeners = new Set<(data: GraphInput) => void>();
  private snapshot: GraphInput;
  private previous: GraphInput | null = null;
  private depth = 0;
  private dirty = false;
  /** How many notifications have gone out. */
  writes = 0;

  constructor(initial: GraphInput) {
    for (const a of initial.assets) this.assets.set(a.id, a);
    for (const c of initial.connections) this.connections.set(c.id, c);
    this.snapshot = this.build();
  }

  /** The current result: what `useQuery(...).data` would hold. A new object after every write. */
  get data(): GraphInput {
    return this.snapshot;
  }

  subscribe(fn: (data: GraphInput) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** One notification for any number of writes (Apollo's cache.batch). */
  batch(fn: () => void): void {
    this.depth++;
    try {
      fn();
    } finally {
      this.depth--;
      this.flush();
    }
  }

  /** Merge fields into an asset. Returns false (and notifies nobody) when nothing would change. */
  writeAsset(id: string, patch: AssetPatch): boolean {
    const cur = this.assets.get(id);
    if (!cur) return false;
    const next = { ...cur, ...patch };
    if (
      (Object.keys(patch) as Array<keyof AssetPatch>).every(
        (k) => cur[k] === next[k],
      )
    )
      return false;
    this.assets.set(id, next);
    this.touch();
    return true;
  }

  /** Add a connection, or replace the one with that id. */
  writeConnection(c: ConnectionInput): void {
    this.connections.set(c.id, c);
    this.touch();
  }

  evictConnections(ids: Iterable<string>): void {
    let any = false;
    for (const id of ids) any = this.connections.delete(id) || any;
    if (any) this.touch();
  }

  /** Show connections now, under temporary ids and marked pending, until `removeOptimistic`. */
  addOptimistic(
    layerId: string,
    connections: readonly ConnectionInput[],
  ): void {
    this.layers.set(
      layerId,
      connections.map((c) => ({ ...c, pending: true })),
    );
    this.touch();
  }

  removeOptimistic(layerId: string): void {
    if (this.layers.delete(layerId)) this.touch();
  }

  /** How the last write changed identities, element by element. */
  get lastReport(): IdentityReport | null {
    const prev = this.previous;
    if (!prev) return null;
    const cur = this.snapshot;
    const same = <T extends { id: string }>(
      a: readonly T[],
      b: readonly T[],
    ) => {
      const before = new Map(a.map((x) => [x.id, x]));
      let same = 0;
      let changed = 0;
      for (const x of b) {
        if (before.get(x.id) === x) same++;
        else changed++;
      }
      return { same, changed };
    };
    const a = same(prev.assets, cur.assets);
    const c = same(prev.connections, cur.connections);
    return {
      assetsChanged: a.changed,
      assetsSame: a.same,
      connectionsChanged: c.changed,
      connectionsSame: c.same,
      newAssetsArray: prev.assets !== cur.assets,
      newConnectionsArray: prev.connections !== cur.connections,
    };
  }

  private build(): GraphInput {
    return {
      assets: [...this.assets.values()],
      connections: [
        ...this.connections.values(),
        ...[...this.layers.values()].flat(),
      ],
    };
  }

  private touch(): void {
    this.dirty = true;
    if (this.depth === 0) this.flush();
  }

  private flush(): void {
    if (this.depth > 0 || !this.dirty) return;
    this.dirty = false;
    this.previous = this.snapshot;
    this.snapshot = this.build();
    this.writes++;
    for (const fn of [...this.listeners]) fn(this.snapshot);
  }
}

/** A subscription: every `ms`, one asset's status flips (one field on one entity: the smallest real change). */
export function startStatusTicker(cache: FakeGraphCache, ms = 300): () => void {
  const timer = setInterval(() => {
    const assets = cache.data.assets;
    const a = assets[Math.floor(Math.random() * assets.length)];
    if (a)
      cache.writeAsset(a.id, {
        status: a.status === 'degraded' ? 'ready' : 'degraded',
      });
  }, ms);
  return () => clearInterval(timer);
}
