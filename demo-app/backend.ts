import { tracked } from '@glimmer/tracking';
import type {
  ConnectRequest,
  ConnectSpec,
  DisconnectRequest,
  GraphInput,
} from '#src/index.ts';
import { FakeGraphCache, startStatusTicker } from './apollo-fake.ts';

export type SaveMode = 'slow' | 'fail' | 'instant';
type Pair = {
  from: { assetId: string; portId: string };
  to: { assetId: string; portId: string };
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A pretend backend for the demo and the cookbook: a fake Apollo cache holding the data, mutations that take a
 * moment and can fail, optimistic responses, and a subscription that ticks. `graph` is what you would bind
 * `@data` to (`useQuery(...).data`); `lines` is a log of what the canvas asked for.
 */
export class FakeBackend {
  readonly cache: FakeGraphCache;
  @tracked graph: GraphInput;
  @tracked saveMode: SaveMode = 'slow';
  @tracked lines: string[] = [];
  private seq = 0;
  private stop: (() => void) | undefined;

  constructor(initial: GraphInput) {
    this.cache = new FakeGraphCache(initial);
    this.graph = this.cache.data;
    this.cache.subscribe((data) => (this.graph = data)); // a cache write is a new `data`, exactly like useQuery
  }

  setSaveMode = (e: Event): void =>
    void (this.saveMode = (e.target as HTMLSelectElement).value as SaveMode);

  destroy(): void {
    this.stop?.();
  }

  note(line: string): void {
    const t = new Date().toLocaleTimeString([], { hour12: false });
    this.lines = [`${t}  ${line}`, ...this.lines].slice(0, 8);
  }

  private async latency(what: string): Promise<void> {
    if (this.saveMode === 'instant') return;
    await wait(1500);
    if (this.saveMode === 'fail') throw new Error(`${what} failed (demo)`);
  }

  /** Show the pairings at once (an optimistic response), save them, then swap in the real ids in one cache write. */
  async saveConnections(pairs: readonly Pair[], what: string): Promise<void> {
    const layer = `optimistic-${++this.seq}`;
    this.cache.addOptimistic(
      layer,
      pairs.map((p) => ({
        id: `${layer}:${++this.seq}`,
        from: p.from,
        to: p.to,
      })),
    );
    try {
      await this.latency(what);
    } catch (e) {
      this.cache.removeOptimistic(layer); // Apollo rolls the optimistic layer back when the mutation fails
      this.note(`${what}: server said no, rolled back`);
      throw e;
    }
    this.cache.batch(() => {
      this.cache.removeOptimistic(layer);
      for (const p of pairs)
        this.cache.writeConnection({
          id: `srv-${++this.seq}`,
          from: p.from,
          to: p.to,
        });
    });
    this.note(`${what}: saved ${pairs.length}`);
  }

  /** `@onConnectRequest` */
  connect = (req: ConnectRequest): Promise<void> | undefined => {
    this.note(
      `connectRequest (${req.source}): ${req.from.count} → ${req.to.count}, ${req.cardinality}`,
    );
    if (req.source === 'group-drag') return undefined; // the connect dialog (or your own table) handles these
    const pairs: readonly Pair[] = req.pairs ?? [
      {
        from: { assetId: req.from.assetIds[0]!, portId: req.from.port!.id },
        to: { assetId: req.to.assetIds[0]!, portId: req.to.port!.id },
      },
    ];
    return this.saveConnections(pairs, 'connect');
  };

  /** `@onDisconnectRequest` */
  disconnect = async (req: DisconnectRequest): Promise<void> => {
    this.note(
      `disconnectRequest (${req.source}): ${req.edges.length} connection(s)`,
    );
    try {
      await this.latency('delete');
    } catch (e) {
      this.note('delete: server said no, wire springs back');
      throw e;
    }
    this.cache.evictConnections(req.edges.map((e) => e.id));
    this.note(`delete: removed ${req.edges.length}`);
  };

  /** The connect dialog's `@onConnect`: the pairings the user chose, to persist. */
  bulkConnect = (specs: ConnectSpec[]): void => {
    const pairs = specs.map((s) => ({
      from: {
        assetId: s.from,
        portId: typeof s.fromPort === 'string' ? s.fromPort : s.fromPort.id,
      },
      to: {
        assetId: s.to,
        portId: typeof s.toPort === 'string' ? s.toPort : s.toPort.id,
      },
    }));
    this.note(`dialog: ${pairs.length} pairings chosen`);
    this.saveConnections(pairs, 'bulk connect').catch(() => undefined);
  };

  /** One field on one entity, like a subscription message. */
  updateOne = (): void => {
    const a =
      this.graph.assets[Math.floor(Math.random() * this.graph.assets.length)]!;
    this.cache.writeAsset(a.id, {
      status: a.status === 'degraded' ? 'ready' : 'degraded',
    });
  };

  setLive(on: boolean): void {
    this.stop?.();
    this.stop = on ? startStatusTicker(this.cache, 300) : undefined;
  }
}
