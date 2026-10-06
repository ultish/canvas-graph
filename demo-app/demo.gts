import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import GraphCanvas from '#src/components/graph-canvas.gts';
import GraphConnectDialog from '#src/components/graph-connect-dialog.gts';
import GraphInspector from '#src/components/graph-inspector.gts';
import type {
  ConnectRequest,
  DisconnectRequest,
  FrameStats,
  GraphHandle,
  GraphInput,
  SyncResult,
} from '#src/index.ts';
import '#src/styles/canvas-graph.css';
import { buildDemo } from './data.ts';

type SaveMode = 'slow' | 'fail' | 'instant';
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default class Demo extends Component {
  @tracked graph: GraphInput = buildDemo();
  @tracked handle: GraphHandle | undefined;
  @tracked fullPath = false;
  @tracked saveMode: SaveMode = 'slow';
  @tracked hud = '';
  @tracked lastSync = '';
  private lastHud = 0;
  private seq = 0;

  ready = (h: GraphHandle): void => {
    this.handle = h;
    (window as unknown as { graph: GraphHandle }).graph = h; // handy in the console
  };

  frame = (s: FrameStats): void => {
    const now = performance.now();
    if (now - this.lastHud < 250) return;
    this.lastHud = now;
    this.hud = `${s.mode}  zoom ${s.scale.toFixed(3)}  |  ${s.assets} assets, ${s.connections} connections, ${s.groups} groups  |  drawn ${s.assetsDrawn} assets, ${s.wiresDrawn} wires  |  ${s.ms.toFixed(1)} ms`;
  };

  synced = (r: SyncResult): void => {
    this.lastSync = `last sync: visited ${r.visited}, assets +${r.assets.added} ~${r.assets.changed} -${r.assets.removed}, connections +${r.connections.added} ~${r.connections.changed} -${r.connections.removed}${r.connections.promoted ? `, ${r.connections.promoted} promoted` : ''}`;
  };

  /** A pretend backend: it saves after a delay, then (like an Apollo cache write) puts the connection into the data. */
  connectRequest = async (req: ConnectRequest): Promise<void> => {
    if (req.source === 'group-drag') return; // the connect dialog (or your own table) handles these
    await this.latency('connect');
    const pairs = req.pairs ?? [
      {
        from: { assetId: req.from.assetIds[0]!, portId: req.from.port!.id },
        to: { assetId: req.to.assetIds[0]!, portId: req.to.port!.id },
      },
    ];
    this.graph = {
      ...this.graph,
      connections: [
        ...this.graph.connections,
        ...pairs.map((p) => ({
          id: `server-${++this.seq}`,
          from: p.from,
          to: p.to,
        })),
      ],
    };
  };

  disconnectRequest = async (req: DisconnectRequest): Promise<void> => {
    await this.latency('disconnect');
    const gone = new Set(req.edges.map((e) => e.id));
    this.graph = {
      ...this.graph,
      connections: this.graph.connections.filter((c) => !gone.has(c.id)),
    };
  };

  private async latency(what: string): Promise<void> {
    if (this.saveMode === 'instant') return;
    await wait(1500);
    if (this.saveMode === 'fail') throw new Error(`${what} failed (demo)`);
  }

  /** Like an Apollo subscription: a new payload in which only one asset is a new object. */
  degradeOne = (): void => {
    const i = Math.floor(Math.random() * this.graph.assets.length);
    const a = this.graph.assets[i]!;
    const status = a.status === 'degraded' ? 'ready' : 'degraded';
    this.graph = {
      ...this.graph,
      assets: this.graph.assets.map((x, k) => (k === i ? { ...x, status } : x)),
    };
  };

  toggleFull = (e: Event): void =>
    void (this.fullPath = (e.target as HTMLInputElement).checked);
  setSave = (e: Event): void =>
    void (this.saveMode = (e.target as HTMLSelectElement).value as SaveMode);
  fit = (): void => this.handle?.fit();
  undo = (): void => void this.handle?.undo();
  pipeline = (i: number): void => this.handle?.focusPipeline(i);

  <template>
    <div class="demo">
      <header class="demo__bar">
        <strong>canvas-graph</strong>
        <button type="button" {{on "click" this.fit}}>Fit all</button>
        <button type="button" {{on "click" (fn this.pipeline 0)}}>Pipeline 1</button>
        <button type="button" {{on "click" (fn this.pipeline 1)}}>2</button>
        <button type="button" {{on "click" (fn this.pipeline 2)}}>3</button>
        <button type="button" {{on "click" (fn this.pipeline 3)}}>4</button>
        <button type="button" {{on "click" this.degradeOne}}>Update one asset</button>
        <button type="button" {{on "click" this.undo}}>Undo</button>
        <label><input
            type="checkbox"
            checked={{this.fullPath}}
            {{on "change" this.toggleFull}}
          />
          Full path</label>
        <label>Save
          <select {{on "change" this.setSave}}>
            <option value="slow">slow (1.5s)</option>
            <option value="fail">slow, then fails</option>
            <option value="instant">instant</option>
          </select>
        </label>
        <span class="demo__hud">{{this.hud}}</span>
        <span class="demo__hud">{{this.lastSync}}</span>
      </header>
      <main class="demo__stage">
        <GraphCanvas
          @data={{this.graph}}
          @fullPath={{this.fullPath}}
          @onReady={{this.ready}}
          @onFrame={{this.frame}}
          @onSync={{this.synced}}
          @onConnectRequest={{this.connectRequest}}
          @onDisconnectRequest={{this.disconnectRequest}}
        />
        <div class="demo__side">
          <GraphInspector @handle={{this.handle}} />
          <GraphConnectDialog @handle={{this.handle}} />
        </div>
      </main>
    </div>
  </template>
}
