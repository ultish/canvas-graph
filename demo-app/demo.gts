import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import GraphCanvas from '#src/components/graph-canvas.gts';
import GraphConnectDialog from '#src/components/graph-connect-dialog.gts';
import GraphInspector from '#src/components/graph-inspector.gts';
import ThemeSelect from './components/theme-select.gts';
import type { FrameStats, GraphHandle, SyncResult } from '#src/index.ts';
import '#src/styles/canvas-graph.css';
import { FakeBackend, type SaveMode } from './backend.ts';
import { buildDemo } from './data.ts';

/**
 * The landing page: the whole thing at scale. The canvas only ever reads `backend.graph`, which is what your
 * `useQuery(...).data` would be.
 */
export default class Demo extends Component {
  backend = new FakeBackend(
    buildDemo(
      Number(new URLSearchParams(location.search).get('assets')) || 800,
    ),
  );
  @tracked handle: GraphHandle | undefined;
  @tracked fullPath = false;
  @tracked live = false;
  @tracked hud = '';
  @tracked lastSync = '';
  private lastHud = 0;
  private syncs = 0;
  private visitedTotal = 0;

  willDestroy(): void {
    super.willDestroy();
    this.backend.destroy();
  }

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
    const g = this.backend.graph;
    const total = g.assets.length + g.connections.length;
    this.syncs++;
    this.visitedTotal += r.visited;
    const c = r.connections;
    const changes = [
      r.assets.added || r.assets.changed || r.assets.removed
        ? `assets +${r.assets.added} ~${r.assets.changed} -${r.assets.removed}`
        : '',
      c.added || c.changed || c.removed || c.renamed || c.promoted
        ? `connections +${c.added} ~${c.changed} -${c.removed}${c.renamed ? `, ${c.renamed} renamed` : ''}${c.promoted ? `, ${c.promoted} promoted` : ''}`
        : '',
    ]
      .filter(Boolean)
      .join(', ');
    this.lastSync = `sync #${this.syncs}: visited ${r.visited} of ${total} entities${changes ? ` (${changes})` : ''}  ·  avg ${(this.visitedTotal / this.syncs).toFixed(0)} per sync`;
  };

  toggleLive = (e: Event): void => {
    this.live = (e.target as HTMLInputElement).checked;
    this.backend.setLive(this.live);
  };
  toggleFull = (e: Event): void =>
    void (this.fullPath = (e.target as HTMLInputElement).checked);
  setSave = (e: Event): void =>
    void (this.backend.saveMode = (e.target as HTMLSelectElement)
      .value as SaveMode);
  fit = (): void => this.handle?.fit();
  undo = (): void => void this.handle?.undo();
  pipeline = (i: number): void => this.handle?.focusPipeline(i);

  <template>
    <div class="demo">
      <header class="demo__bar">
        <strong>canvas-graph</strong>
        <LinkTo @route="cookbook" class="demo__link">Cookbook →</LinkTo>
        <LinkTo @route="bench" class="demo__link">Benchmark →</LinkTo>
        <ThemeSelect />
        <button type="button" {{on "click" this.fit}}>Fit all</button>
        <button type="button" {{on "click" (fn this.pipeline 0)}}>Pipeline 1</button>
        <button type="button" {{on "click" (fn this.pipeline 1)}}>2</button>
        <button type="button" {{on "click" (fn this.pipeline 2)}}>3</button>
        <button type="button" {{on "click" (fn this.pipeline 3)}}>4</button>
        <button type="button" {{on "click" this.backend.updateOne}}>Update one
          asset</button>
        <label><input
            type="checkbox"
            checked={{this.live}}
            {{on "change" this.toggleLive}}
          />
          Live updates (3/s)</label>
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
          @data={{this.backend.graph}}
          @fullPath={{this.fullPath}}
          @onReady={{this.ready}}
          @onFrame={{this.frame}}
          @onSync={{this.synced}}
          @onConnectRequest={{this.backend.connect}}
          @onDisconnectRequest={{this.backend.disconnect}}
        />
        <div class="demo__side">
          <GraphInspector @handle={{this.handle}} />
          <GraphConnectDialog
            @handle={{this.handle}}
            @onConnect={{this.backend.bulkConnect}}
          />
        </div>
      </main>
    </div>
  </template>
}
