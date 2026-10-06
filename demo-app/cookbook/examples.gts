import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import type { TOC } from '@ember/component/template-only';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import GraphCanvas from '#src/components/graph-canvas.gts';
import GraphConnectDialog from '#src/components/graph-connect-dialog.gts';
import GraphInspector from '#src/components/graph-inspector.gts';
import type {
  ConnectRequest,
  FrameStats,
  GraphHandle,
  SyncResult,
} from '#src/index.ts';
import '#src/styles/canvas-graph.css';
import { FakeBackend, type SaveMode } from '../backend.ts';
import { bulk, chain, layoutRules, medium } from '../samples.ts';

const SAVE_MODES: Array<{ value: SaveMode; label: string }> = [
  { value: 'slow', label: 'slow (1.5s)' },
  { value: 'fail', label: 'slow, then fails' },
  { value: 'instant', label: 'instant' },
];

/** What the canvas asked the "backend" for, newest first. */
const EventLog: TOC<{ Args: { lines: string[] } }> = <template>
  <ol class="cb-log" aria-label="What the canvas asked for">
    {{#each @lines as |line|}}<li>{{line}}</li>{{else}}<li
        class="cb-log__empty"
      >nothing yet</li>{{/each}}
  </ol>
</template>;

const SaveMenu: TOC<{ Args: { backend: FakeBackend } }> = <template>
  <label class="cb-field">Save
    <select {{on "change" @backend.setSaveMode}}>
      {{#each SAVE_MODES as |m|}}<option
          value={{m.value}}
        >{{m.label}}</option>{{/each}}
    </select>
  </label>
</template>;

// ---------------------------------------------------------------------------------------------------------------

const CHAIN = chain();

export const QuickStart: TOC<{ Args: Record<string, never> }> = <template>
  <div class="cb-stage"><GraphCanvas @data={{CHAIN}} /></div>
  <p class="cb-hint">Scroll to zoom, drag to pan. Zoom in until the cards and
    their named ports appear.</p>
</template>;

export class Colours extends Component {
  data = layoutRules();
  @tracked pinned = false;
  toggle = (e: Event): void =>
    void (this.pinned = (e.target as HTMLInputElement).checked);
  get colors(): Record<string, string> | undefined {
    return this.pinned ? { ingest: '#ff4fa3', route: '#c3e86d' } : undefined;
  }

  <template>
    <label class="cb-field"><input
        type="checkbox"
        checked={{this.pinned}}
        {{on "change" this.toggle}}
      />
      Pin
      <code>ingest</code>
      to hot pink and
      <code>route</code>
      to lime</label>
    <div class="cb-stage"><GraphCanvas
        @data={{this.data}}
        @colors={{this.colors}}
      /></div>
  </template>
}

export class LayoutRules extends Component {
  data = layoutRules();
  @tracked handle: GraphHandle | undefined;
  ready = (h: GraphHandle): void => void (this.handle = h);
  fit = (): void => this.handle?.fit();
  loopBack = (): void => void this.handle?.focusAsset('a5');
  stragglers = (): void => void this.handle?.focusAsset('spare-0');
  side = (): void => void this.handle?.focusAsset('side-1');

  <template>
    <div class="cb-row">
      <button type="button" {{on "click" this.fit}}>Fit all</button>
      <button type="button" {{on "click" this.loopBack}}>The loop-back (a5 → a2)</button>
      <button type="button" {{on "click" this.side}}>A side pipeline</button>
      <button type="button" {{on "click" this.stragglers}}>The unconnected block</button>
    </div>
    <div class="cb-stage"><GraphCanvas
        @data={{this.data}}
        @onReady={{this.ready}}
      /></div>
    <p class="cb-hint">
      <code>a1</code>
      also has a direct connection to
      <code>a4</code>
      that skips the layers in between: it runs underneath. Ten assets with no
      connections sit in one labelled block instead of ten tall rows.
    </p>
  </template>
}

export class Selection extends Component {
  data = chain();
  @tracked handle: GraphHandle | undefined;
  ready = (h: GraphHandle): void => void (this.handle = h);
  get json(): string {
    return JSON.stringify(this.handle?.selection ?? null, null, 2);
  }

  <template>
    <div class="cb-stage">
      <GraphCanvas @data={{this.data}} @onReady={{this.ready}} />
      <div class="cb-overlay"><GraphInspector @handle={{this.handle}} /></div>
    </div>
    <p class="cb-hint">Click an asset, or zoom in and click a wire. This is the
      same data your own inspector would get:</p>
    <pre class="cb-json">{{this.json}}</pre>
  </template>
}

export class Connect extends Component {
  backend = new FakeBackend(chain());
  willDestroy(): void {
    super.willDestroy();
    this.backend.destroy();
  }

  <template>
    <SaveMenu @backend={{this.backend}} />
    <div class="cb-stage">
      <GraphCanvas
        @data={{this.backend.graph}}
        @onConnectRequest={{this.backend.connect}}
      />
    </div>
    <p class="cb-hint">
      Zoom in until port names show, then drag from a port to another asset (let
      go anywhere on the card, or where the electric arc shows). Try each save
      mode.
    </p>
    <EventLog @lines={{this.backend.lines}} />
  </template>
}

export class ApolloUpdates extends Component {
  backend = new FakeBackend(medium());
  @tracked live = false;
  @tracked line = 'nothing synced yet';
  @tracked report = '';
  private syncs = 0;

  willDestroy(): void {
    super.willDestroy();
    this.backend.destroy();
  }

  synced = (r: SyncResult): void => {
    const g = this.backend.graph;
    this.syncs++;
    this.line = `sync #${this.syncs}: visited ${r.visited} of ${g.assets.length + g.connections.length} entities`;
    const rep = this.backend.cache.lastReport;
    this.report = rep
      ? `Apollo's side of that write: a new assets array (${rep.assetsChanged} new entity, ${rep.assetsSame} kept their identity), connections ${rep.connectionsChanged} changed / ${rep.connectionsSame} same.`
      : '';
  };
  toggle = (e: Event): void => {
    this.live = (e.target as HTMLInputElement).checked;
    this.backend.setLive(this.live);
  };

  <template>
    <div class="cb-row">
      <button type="button" {{on "click" this.backend.updateOne}}>Update one
        asset</button>
      <label class="cb-field"><input
          type="checkbox"
          checked={{this.live}}
          {{on "change" this.toggle}}
        />
        Live updates (3 a second)</label>
    </div>
    <p class="cb-stat">{{this.line}}</p>
    <p class="cb-hint">{{this.report}}</p>
    <div class="cb-stage"><GraphCanvas
        @data={{this.backend.graph}}
        @onSync={{this.synced}}
      /></div>
  </template>
}

export class GroupConnect extends Component {
  backend = new FakeBackend(bulk());
  @tracked handle: GraphHandle | undefined;
  @tracked last = 'drag a group onto another';

  willDestroy(): void {
    super.willDestroy();
    this.backend.destroy();
  }

  ready = (h: GraphHandle): void => void (this.handle = h);
  connect = (req: ConnectRequest): Promise<void> | undefined => {
    if (req.source === 'group-drag') {
      this.last = JSON.stringify(
        {
          ...req,
          from: { ...req.from, assetIds: ids(req.from.assetIds) },
          to: { ...req.to, assetIds: ids(req.to.assetIds) },
        },
        null,
        2,
      );
    }
    return this.backend.connect(req);
  };

  <template>
    <div class="cb-stage">
      <GraphCanvas
        @data={{this.backend.graph}}
        @onReady={{this.ready}}
        @onConnectRequest={{this.connect}}
      />
      <div class="cb-overlay">
        <GraphConnectDialog
          @handle={{this.handle}}
          @onConnect={{this.backend.bulkConnect}}
        />
      </div>
    </div>
    <p class="cb-hint">
      Zoomed out, drag from the dot on a group's right edge onto another group
      (try the single switch onto the 24-asset group, or the sources onto the
      switch). This is the request your handler receives:
    </p>
    <pre class="cb-json">{{this.last}}</pre>
    <EventLog @lines={{this.backend.lines}} />
  </template>
}

/** Long id lists make the payload unreadable: show the first few. */
function ids(list: string[]): string[] | string {
  return list.length > 4
    ? [...list.slice(0, 3), `… ${list.length - 3} more`]
    : list;
}

export class DeleteUndo extends Component {
  backend = new FakeBackend(chain());
  @tracked handle: GraphHandle | undefined;
  willDestroy(): void {
    super.willDestroy();
    this.backend.destroy();
  }
  ready = (h: GraphHandle): void => void (this.handle = h);
  undo = (): void => void this.handle?.undo();

  <template>
    <div class="cb-row">
      <SaveMenu @backend={{this.backend}} />
      <button type="button" {{on "click" this.undo}}>Undo (Cmd/Ctrl+Z)</button>
    </div>
    <div class="cb-stage">
      <GraphCanvas
        @data={{this.backend.graph}}
        @onReady={{this.ready}}
        @onConnectRequest={{this.backend.connect}}
        @onDisconnectRequest={{this.backend.disconnect}}
      />
      <div class="cb-overlay"><GraphInspector @handle={{this.handle}} /></div>
    </div>
    <p class="cb-hint">
      Zoom in, click a wire, press Delete (or use the panel). It fades red while
      the "server" works, and with
      <em>slow, then fails</em>
      it springs back. Then try Undo.
    </p>
    <EventLog @lines={{this.backend.lines}} />
  </template>
}

export class HandleApi extends Component {
  data = chain();
  @tracked handle: GraphHandle | undefined;
  @tracked out = 'press a button';
  ready = (h: GraphHandle): void => void (this.handle = h);

  fit = (): void => this.say('handle.fit()', this.handle?.fit());
  focus = (): void =>
    this.say("handle.focusAsset('switch')", this.handle?.focusAsset('switch'));
  asset = (): void =>
    this.say(
      "handle.selectAsset('worker-2')",
      this.handle?.selectAsset('worker-2'),
    );
  wire = (): void =>
    this.say(
      "handle.selectConnection('c1')",
      this.handle?.selectConnection('c1'),
    );
  clear = (): void =>
    this.say('handle.clearSelection()', this.handle?.clearSelection());
  full = (): void =>
    this.say('handle.setFullPath(true)', this.handle?.setFullPath(true));
  look = (): void => {
    const a = this.handle?.asset('switch');
    this.say(
      "handle.asset('switch')",
      a && {
        inputPorts: a.inputPorts.map((p) => p.name),
        outputPorts: a.outputPorts.map((p) => p.name),
      },
    );
  };
  private say(call: string, result: unknown): void {
    this.out = `${call}  →  ${result === undefined ? 'ok' : JSON.stringify(result)}`;
  }

  <template>
    <div class="cb-row">
      <button type="button" {{on "click" this.fit}}>fit</button>
      <button type="button" {{on "click" this.focus}}>focusAsset</button>
      <button type="button" {{on "click" this.asset}}>selectAsset</button>
      <button type="button" {{on "click" this.wire}}>selectConnection</button>
      <button type="button" {{on "click" this.full}}>setFullPath</button>
      <button type="button" {{on "click" this.clear}}>clearSelection</button>
      <button type="button" {{on "click" this.look}}>asset</button>
    </div>
    <p class="cb-stat">{{this.out}}</p>
    <div class="cb-stage"><GraphCanvas
        @data={{this.data}}
        @onReady={{this.ready}}
      /></div>
  </template>
}

export class PerformanceKnobs extends Component {
  backend = new FakeBackend(medium());
  @tracked maxFps = 60;
  @tracked ratio = 1.5;
  @tracked live = false;
  @tracked hud = 'move the view to see frame times';
  private lastHud = 0;

  willDestroy(): void {
    super.willDestroy();
    this.backend.destroy();
  }

  frame = (s: FrameStats): void => {
    const now = performance.now();
    if (now - this.lastHud < 250) return;
    this.lastHud = now;
    this.hud = `${s.mode} · ${s.ms.toFixed(1)} ms for that frame · ${s.assetsDrawn} assets drawn · cap ${this.maxFps} fps · pixel ratio ${this.ratio === Infinity ? 'native' : this.ratio}`;
  };
  setFps = (e: Event): void =>
    void (this.maxFps = Number((e.target as HTMLSelectElement).value));
  setRatio = (e: Event): void => {
    const v = (e.target as HTMLSelectElement).value;
    this.ratio = v === 'native' ? Infinity : Number(v);
  };
  toggle = (e: Event): void => {
    this.live = (e.target as HTMLInputElement).checked;
    this.backend.setLive(this.live);
  };

  <template>
    <div class="cb-row">
      <label class="cb-field">Frame cap
        <select {{on "change" this.setFps}}>
          <option value="60">60 fps</option>
          <option value="30">30 fps</option>
          <option value="15">15 fps</option>
        </select>
      </label>
      <label class="cb-field">Pixel ratio
        <select {{on "change" this.setRatio}}>
          <option value="1.5">1.5 (default)</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="native">native</option>
        </select>
      </label>
      <label class="cb-field"><input
          type="checkbox"
          checked={{this.live}}
          {{on "change" this.toggle}}
        />
        Live updates (3 a second, each one ringed)</label>
    </div>
    <p class="cb-stat">{{this.hud}}</p>
    <div class="cb-stage">
      <GraphCanvas
        @data={{this.backend.graph}}
        @maxFps={{this.maxFps}}
        @maxPixelRatio={{this.ratio}}
        @onFrame={{this.frame}}
      />
    </div>
    <p class="cb-hint">
      Zoom in and pan, and watch the frame time. The full measurements, for any
      graph size on your machine, are on the
      <LinkTo @route="bench">benchmark page</LinkTo>.
    </p>
  </template>
}
