import { createAnimState } from './anim.ts';
import { Emitter } from './emitter.ts';
import { GroupRouter, layoutGraph } from './layout.ts';
import {
  describeEdge,
  describeGroup,
  describeGroupEdge,
  describeNode,
  portRef,
  type PortRef,
  type SelectionPayload,
} from './payloads.ts';
import { edgeSegs } from './routes.ts';
import { SpatialGrid } from './spatial.ts';
import { deepEqual } from './util.ts';
import { GraphStore, type SyncResult } from './store.ts';
import type {
  AssetNode,
  Comp,
  Edge,
  Group,
  GraphInput,
  GroupEdge,
  PortInput,
} from './types.ts';
import { Viewport } from './viewport.ts';

export type Cardinality =
  'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

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
    from: { assetId: string; portId: string };
    to: { assetId: string; portId: string };
  }>;
}

export interface DisconnectRequest {
  source: 'edge' | 'group-pipe' | 'undo' | 'api';
  edges: Array<{
    id: string;
    from: { assetId: string; portId: string };
    to: { assetId: string; portId: string };
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
  layout: { reason: string };
  connectRequest: ConnectRequest;
  disconnectRequest: DisconnectRequest;
  invalidate: undefined;
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

interface Ends {
  a: string;
  fp: string;
  b: string;
  tp: string;
}
type UndoEntry = { kind: 'connected' | 'disconnected'; ends: Ends[] };

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  !!v && typeof (v as PromiseLike<unknown>).then === 'function';
const endsOf = (e: Edge): Ends => ({
  a: e.a.id,
  fp: e.fp.id,
  b: e.b.id,
  tp: e.tp.id,
});
const cardinality = (n: number, m: number): Cardinality =>
  n === 1 && m === 1
    ? 'one-to-one'
    : n === 1
      ? 'one-to-many'
      : m === 1
        ? 'many-to-one'
        : 'many-to-many';
const groupSide = (g: Group): ConnectSide => ({
  type: g.type,
  layer: g.layer,
  count: g.nodes.length,
  assetIds: g.nodes.map((n) => n.id),
});

/**
 * Everything except pixels: the model, layout, selection, and the connect / disconnect flows. The host's data is
 * the source of truth; gestures are intents. A new connection is drawn at once but pending, the host is asked
 * (connectRequest), and the wire settles when the host says yes (or the data echoes it) or fades when it says no.
 */
export class GraphEngine {
  readonly store = new GraphStore();
  readonly grid = new SpatialGrid();
  readonly viewport = new Viewport();
  readonly anim = createAnimState();
  private readonly emitter = new Emitter<EngineEvents>();

  groups: Group[] = [];
  comps: Comp[] = [];
  private router = new GroupRouter();
  /** The group-to-group pipes. One array, updated in place. */
  get gedges(): GroupEdge[] {
    return this.router.gedges;
  }
  /** Seconds. The renderer sets this at the start of every frame; animations are timed against it. */
  time = 0;
  fullPath = false;
  /** Ring the assets the host's data changes (a live feed's updates become visible). Off here, on in the component. */
  highlightUpdates = false;

  selected: AssetNode | null = null;
  selEdge: Edge | null = null;
  selGE: GroupEdge | null = null;
  selGroup: Group | null = null;
  readonly selNodes = new Set<AssetNode>();
  readonly selGroups = new Set<Group>();
  readonly selEdges = new Set<Edge>();
  readonly pending = new Set<Edge>();
  readonly deleting = new Set<Edge>();

  /** Glide cards and group frames to their new positions after a relayout, instead of jumping. */
  animateLayout = false;
  layoutTweenMs = 280;
  private tweenNodes: AssetNode[] = [];
  private tweenData = new Float64Array(0); // per node: fromX, fromY, toX, toY
  private tweenGroups: Group[] = [];
  private tweenGData = new Float64Array(0); // per group: from x,y,w,h then to x,y,w,h
  private tweenStart = 0;

  private undoStack: UndoEntry[] = [];
  private laidOut = false;
  private stamp = 0;

  on = this.emitter.on.bind(this.emitter);

  nextPickStamp(): number {
    return ++this.stamp;
  }

  /** Bumped whenever the model, the layout or the selection changes: cached hit-test results are stale after it. */
  epoch = 0;

  invalidate(): void {
    this.epoch++;
    this.emitter.emit('invalidate', undefined);
  }

  // ---------------------------------------------------------------- camera

  /** Zoom to show every pipeline. `jump` skips the easing (first paint). */
  fitAll(jump = false): void {
    if (!this.comps.length) return;
    const x0 = Math.min(...this.comps.map((c) => c.bbox.x));
    const y0 = Math.min(...this.comps.map((c) => c.bbox.y));
    const x1 = Math.max(...this.comps.map((c) => c.bbox.x + c.bbox.w));
    const y1 = Math.max(...this.comps.map((c) => c.bbox.y + c.bbox.h));
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    if (jump) this.viewport.jumpTo(box);
    else this.viewport.focus(box);
    this.invalidate();
  }

  /** Zoom to one pipeline (by its index in layout order). */
  focusPipeline(index: number): void {
    const c = this.comps[index];
    if (!c) return;
    this.viewport.focus(c.bbox);
    this.invalidate();
  }

  /** Centre on an asset, zooming in far enough to read its card. */
  focusAsset(id: string): boolean {
    const n = this.store.assets.get(id);
    if (!n) return false;
    this.viewport.centerOn(
      n.x + n.w / 2,
      n.y + n.h / 2,
      Math.max(this.viewport.targetScale, 0.8),
    );
    this.invalidate();
    return true;
  }

  // ---------------------------------------------------------------- data in

  sync(input: GraphInput): SyncResult {
    const res = this.store.sync(input);
    if (!this.laidOut || res.structural) this.relayout('sync');
    else if (res.routing)
      this.reroute({ added: res.addedEdges, removed: res.removedEdges });
    for (const [localId, realId] of res.promoted) {
      for (const e of this.pending)
        if (e.id === localId) this.pending.delete(e);
      const real = this.store.edgesById.get(realId);
      if (real) {
        real.ct = this.time;
        this.anim.pulseUntil = Math.max(this.anim.pulseUntil, this.time + 0.5);
      }
    }
    if (
      this.highlightUpdates &&
      res.changedAssets.length &&
      res.changedAssets.length <= 200
    ) {
      // a bulk change would only be noise; individual updates are what a live feed is for
      for (const n of res.changedAssets) {
        n.pulse = this.time;
        this.anim.pulsing.add(n);
      }
    }
    for (const id of res.settled) {
      const e = this.store.edgesById.get(id);
      if (e) e.ct = this.time; // the host's data says it is saved: settle pulse
    }
    if (res.settled.length)
      this.anim.pulseUntil = Math.max(this.anim.pulseUntil, this.time + 0.5);
    for (const set of [this.pending, this.deleting])
      for (const e of set)
        if (this.store.edgesById.get(e.id) !== e) set.delete(e);
    this.remapSelection();
    this.emitter.emit('sync', res);
    if (res.visual || res.routing || res.structural) {
      this.emitSelect();
      this.invalidate();
    }
    return res;
  }

  /**
   * Recompute layers, groups and positions. With `animateLayout` on, cards and group frames glide from where they were to
   * where they now belong (a new asset arriving does not make everything teleport); otherwise they jump.
   */
  relayout(reason = 'manual'): void {
    const animate = this.animateLayout && this.laidOut;
    this.stopTween(false);
    let before: AssetNode[] = [];
    let fromPos: Float64Array | null = null;
    if (animate) {
      before = this.store.nodes.filter((n) => n.g !== null);
      fromPos = new Float64Array(before.length * 2);
      before.forEach((n, i) => {
        fromPos![2 * i] = n.x;
        fromPos![2 * i + 1] = n.y;
        n.og = n.g;
      });
    }
    const oldGeom = animate
      ? new Map(this.groups.map((g) => [g, [g.x, g.y, g.w, g.h] as const]))
      : null;
    const r = layoutGraph(this.store.nodes, this.store.edgeList);
    this.groups = r.groups;
    this.comps = r.comps;
    this.router.rebuild(this.store.edgeList, this.comps);
    this.grid.rebuild(this.store.nodes); // at the final positions
    for (const n of this.store.nodes) {
      n.x0 = undefined;
      n.bt = null;
    }
    this.anim.bumping.clear();
    if (animate && fromPos && oldGeom)
      this.startTween(before, fromPos, oldGeom);
    this.laidOut = true;
    this.remapSelection();
    this.emitter.emit('layout', { reason });
    this.invalidate();
  }

  /** Put every moving card back at its start and queue the glide to its final position. */
  private startTween(
    before: AssetNode[],
    fromPos: Float64Array,
    oldGeom: Map<Group, readonly [number, number, number, number]>,
  ): void {
    // group frames first: they find their old geometry through the members' remembered old group
    const groups: Group[] = [];
    const gdata: number[] = [];
    for (const g of this.groups) {
      let old: readonly [number, number, number, number] | undefined;
      for (let i = 0; i < g.nodes.length && i < 8 && !old; i++) {
        const og = g.nodes[i]!.og;
        if (og) old = oldGeom.get(og);
      }
      if (!old) continue;
      if (
        Math.abs(old[0] - g.x) +
          Math.abs(old[1] - g.y) +
          Math.abs(old[2] - g.w) +
          Math.abs(old[3] - g.h) <
        0.5
      )
        continue;
      groups.push(g);
      gdata.push(old[0], old[1], old[2], old[3], g.x, g.y, g.w, g.h);
    }
    const nodes: AssetNode[] = [];
    const data: number[] = [];
    before.forEach((n, i) => {
      n.og = null;
      if (this.store.assets.get(n.id) !== n) return; // removed since
      const fx = fromPos[2 * i]!;
      const fy = fromPos[2 * i + 1]!;
      if (Math.abs(fx - n.x) + Math.abs(fy - n.y) < 0.5) return;
      nodes.push(n);
      data.push(fx, fy, n.x, n.y);
    });
    if (!nodes.length && !groups.length) return;
    this.tweenNodes = nodes;
    this.tweenData = Float64Array.from(data);
    this.tweenGroups = groups;
    this.tweenGData = Float64Array.from(gdata);
    this.tweenStart = this.time;
    // the grid has the final positions; add the starting ones too, so a card gliding into view is not culled
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      n.x = this.tweenData[4 * i]!;
      n.y = this.tweenData[4 * i + 1]!;
      this.grid.add(n);
    }
    groups.forEach((g, i) => {
      g.x = this.tweenGData[8 * i]!;
      g.y = this.tweenGData[8 * i + 1]!;
      g.w = this.tweenGData[8 * i + 2]!;
      g.h = this.tweenGData[8 * i + 3]!;
    });
  }

  /** Finish (or abandon) a glide: cards stay wherever they are unless `snap` puts them at their destination. */
  private stopTween(snap: boolean): void {
    if (!this.tweenNodes.length && !this.tweenGroups.length) return;
    if (snap) {
      this.tweenNodes.forEach((n, i) => {
        n.x = this.tweenData[4 * i + 2]!;
        n.y = this.tweenData[4 * i + 3]!;
      });
      this.tweenGroups.forEach((g, i) => {
        g.x = this.tweenGData[8 * i + 4]!;
        g.y = this.tweenGData[8 * i + 5]!;
        g.w = this.tweenGData[8 * i + 6]!;
        g.h = this.tweenGData[8 * i + 7]!;
      });
      this.grid.rebuild(this.store.nodes);
    }
    this.tweenNodes = [];
    this.tweenGroups = [];
  }

  /** Connections changed but assets did not move: rebuild group pipes and lanes only. */
  reroute(delta?: { added: readonly Edge[]; removed: readonly Edge[] }): void {
    if (delta) {
      // update the pipes in place: a connection joining two groups that already have a pipe just changes its count
      this.router.remove(delta.removed);
      this.router.add(delta.added);
    } else this.router.rebuild(this.store.edgeList, this.comps);
    this.remapSelection();
    this.invalidate();
  }

  // ---------------------------------------------------------------- selection

  select(sel: SelectionInput): void {
    this.selected = sel?.node ?? null;
    this.selEdge = sel?.edge ?? null;
    this.selGE = sel?.ge ?? null;
    this.selGroup = sel?.group ?? null;
    this.computeSel();
    this.emitSelect();
    this.invalidate();
  }

  setFullPath(on: boolean): void {
    this.fullPath = on;
    this.computeSel();
    this.invalidate();
  }

  payload(): SelectionPayload | null {
    if (this.selEdge) return describeEdge(this.selEdge);
    if (this.selGE) return describeGroupEdge(this.selGE);
    if (this.selGroup) return describeGroup(this.selGroup, this.gedges);
    if (this.selected) return describeNode(this.selected);
    return null;
  }

  /** The payload last sent to listeners; an update that would send the same data again is dropped. */
  private lastPayload: SelectionPayload | null = null;

  private emitSelect(): void {
    const p = this.payload();
    if (deepEqual(p, this.lastPayload)) return; // a tick that did not touch what is selected must not re-render your inspector
    this.lastPayload = p;
    this.emitter.emit('select', p);
  }

  /** Highlight sets for the selected asset: direct neighbours, or the full upstream/downstream path. */
  private computeSel(): void {
    this.selNodes.clear();
    this.selGroups.clear();
    this.selEdges.clear();
    const n = this.selected;
    if (!n) return;
    for (const dir of ['out', 'in'] as const) {
      const seen = new Set<AssetNode>([n]);
      const q: Array<[AssetNode, number]> = [[n, this.fullPath ? Infinity : 1]];
      while (q.length) {
        const [m, left] = q.pop()!;
        if (left <= 0) continue;
        for (const e of m[dir]) {
          this.selEdges.add(e);
          const o = dir === 'out' ? e.b : e.a;
          if (!seen.has(o)) {
            seen.add(o);
            q.push([o, left - 1]);
          }
        }
      }
      for (const m of seen) this.selNodes.add(m);
    }
    for (const m of this.selNodes) if (m.g) this.selGroups.add(m.g);
  }

  /** After the model changed: re-point selection and hover at the live objects, drop what no longer exists. */
  private remapSelection(): void {
    const alive = (n: AssetNode) => this.store.assets.get(n.id) === n;
    if (this.selected && !alive(this.selected)) this.selected = null;
    if (
      this.selEdge &&
      this.store.edgesById.get(this.selEdge.id) !== this.selEdge
    )
      this.selEdge = null;
    const gOf = (g: Group | null): Group | null => {
      const n = g?.nodes.find(alive);
      return n?.g ?? null;
    };
    const geOf = (ge: GroupEdge | null): GroupEdge | null => {
      if (!ge) return null;
      const a = gOf(ge.a);
      const b = gOf(ge.b);
      return (
        this.gedges.find((x) => x.a === a && x.b === b && x.back === ge.back) ??
        null
      );
    };
    this.selGroup = gOf(this.selGroup);
    this.selGE = geOf(this.selGE);
    this.anim.hoverGE = geOf(this.anim.hoverGE);
    if (this.anim.hover && !alive(this.anim.hover)) this.anim.hover = null;
    this.anim.hoverEdge = null;
    this.remapDrags(alive, gOf);
    this.computeSel();
  }

  /** A sync or relayout can remove assets and replace group objects under a drag in progress: repoint it, or cancel it. */
  private remapDrags(
    alive: (n: AssetNode) => boolean,
    gOf: (g: Group | null) => Group | null,
  ): void {
    const A = this.anim;
    const c = A.conn;
    if (c) {
      const ports = c.dir > 0 ? c.from.outs : c.from.ins;
      if (!alive(c.from) || !ports[c.idx])
        A.conn = null; // the asset (or the port it was dragged from) is gone
      else {
        if (c.near && !alive(c.near.node)) c.near = null;
        if (c.target && !alive(c.target.node)) c.target = null;
      }
    }
    const r = A.retract;
    if (r && !alive(r.from)) A.retract = null;
    const g = A.gconn;
    if (g) {
      const from = gOf(g.from);
      if (!from) A.gconn = null;
      else {
        g.from = from;
        g.target = g.target ? gOf(g.target) : null;
      }
    }
    if (A.flash && this.store.edgesById.get(A.flash.e.id) !== A.flash.e)
      A.flash = null;
  }

  // ---------------------------------------------------------------- connect

  /** Zoomed in: the user joined two ports. Draw it now (pending), ask the host to save it. */
  requestConnectPorts(
    a: AssetNode,
    ai: number,
    b: AssetNode,
    bi: number,
    record = true,
  ): Edge | null {
    const fp = a.outs[ai];
    const tp = b.ins[bi];
    if (!fp || !tp) return null;
    const e = this.store.addLocalEdge(a, fp, b, tp, { pending: true });
    if (!e) return null;
    this.pending.add(e);
    this.reroute({ added: [e], removed: [] });
    if (record) this.undoStack.push({ kind: 'connected', ends: [endsOf(e)] });
    this.anim.flash = { e, t0: this.time, node: b, dir: 1, idx: bi };
    this.bump(b, -1, 7);
    this.emitter.emit('change', {
      reason: 'connect',
      added: [e.id],
      removed: [],
    });
    this.emitSelect();
    this.askConnect([e], {
      source: 'port-drag',
      from: {
        type: a.type,
        layer: a.layer,
        count: 1,
        assetIds: [a.id],
        port: portRef(fp),
      },
      to: {
        type: b.type,
        layer: b.layer,
        count: 1,
        assetIds: [b.id],
        port: portRef(tp),
      },
      cardinality: 'one-to-one',
      existingLinks: 0,
      edgeIds: [e.id],
    });
    return e;
  }

  /** Zoomed out: the user dragged one group onto another. Nothing is drawn; the host decides the pairings. */
  requestGroupConnect(src: Group, dst: Group): void {
    const ge = this.gedges.find((x) => x.a === src && x.b === dst);
    this.emitter.emit('connectRequest', {
      source: 'group-drag',
      from: groupSide(src),
      to: groupSide(dst),
      cardinality: cardinality(src.nodes.length, dst.nodes.length),
      existingLinks: ge ? ge.edges.length : 0,
    });
  }

  private askConnect(edges: Edge[], req: ConnectRequest): void {
    const hosts = this.emitter.handlers('connectRequest');
    const results = this.emitter.emit('connectRequest', req);
    if (!hosts) {
      for (const e of edges) this.settle(e, true); // nobody to ask (standalone): nothing to wait for
      return;
    }
    const waits = results.filter(isThenable);
    if (waits.length) {
      Promise.all(waits).then(
        () => edges.forEach((e) => this.settle(e, true)),
        () => edges.forEach((e) => this.settle(e, false)),
      );
    } // else the host answers later with confirm() / revert()
  }

  private settle(e: Edge, ok: boolean): void {
    if (!this.pending.has(e)) return;
    this.pending.delete(e);
    if (ok) {
      e.pending = false;
      e.ct = this.time;
      this.anim.pulseUntil = Math.max(this.anim.pulseUntil, this.time + 0.5);
      this.emitter.emit('change', {
        reason: 'confirm',
        added: [],
        removed: [],
      });
      this.emitSelect();
      this.invalidate();
      return;
    }
    const key = JSON.stringify(endsOf(e));
    this.undoStack = this.undoStack.filter(
      (u) =>
        !(
          u.kind === 'connected' &&
          u.ends.length === 1 &&
          JSON.stringify(u.ends[0]) === key
        ),
    );
    this.drop([e], 'revert');
  }

  /**
   * The host-driven way to add connections in bulk (standalone use, or to show them at once while a mutation runs).
   * Ports are named by the host: an unseen port id is created on its card. One change event, one undo step.
   */
  connectMany(
    specs: readonly ConnectSpec[],
    opts: { pending?: boolean } = {},
  ): { created: string[]; skipped: number[] } {
    const made: Edge[] = [];
    const skipped: number[] = [];
    let overflow = false;
    specs.forEach((sp, i) => {
      const a = this.store.assets.get(sp.from);
      const b = this.store.assets.get(sp.to);
      if (!a || !b || sp.fromPort == null || sp.toPort == null)
        return void skipped.push(i);
      const f = this.store.ensurePort(a, 'out', sp.fromPort);
      const t = this.store.ensurePort(b, 'in', sp.toPort);
      overflow ||= f.overflow || t.overflow;
      const e = this.store.addLocalEdge(a, f.port, b, t.port, {
        pending: opts.pending,
        enabled: sp.enabled,
      });
      if (e) made.push(e);
      else skipped.push(i);
    });
    if (!made.length) return { created: [], skipped };
    if (opts.pending) for (const e of made) this.pending.add(e);
    if (overflow) this.relayout('ports');
    else this.reroute({ added: made, removed: [] });
    this.undoStack.push({ kind: 'connected', ends: made.map(endsOf) });
    this.emitter.emit('change', {
      reason: 'add',
      added: made.map((e) => e.id),
      removed: [],
    });
    this.emitSelect();
    return { created: made.map((e) => e.id), skipped };
  }

  // ---------------------------------------------------------------- disconnect

  /**
   * Delete connections. A wire the host never saw is dropped at once. Others fade (pending delete) while the host is
   * asked (disconnectRequest); they go when the host agrees (or its data stops containing them) and spring back if not.
   */
  requestDisconnect(
    list: readonly Edge[],
    source: DisconnectRequest['source'] = 'api',
    record = true,
  ): number {
    const live = list.filter(
      (e) => this.store.edgesById.get(e.id) === e && !e.deleting,
    );
    if (!live.length) return 0;
    for (const e of live.filter((x) => this.pending.has(x)))
      this.settle(e, false); // never saved: cancel
    const ask = live.filter(
      (e) => !this.pending.has(e) && this.store.edgesById.get(e.id) === e,
    );
    if (!ask.length) return live.length;
    if (record)
      this.undoStack.push({ kind: 'disconnected', ends: ask.map(endsOf) });
    const hosts = this.emitter.handlers('disconnectRequest');
    const results = this.emitter.emit('disconnectRequest', {
      source,
      edges: ask.map((e) => ({
        id: e.id,
        from: { assetId: e.a.id, portId: e.fp.id },
        to: { assetId: e.b.id, portId: e.tp.id },
      })),
    });
    if (!hosts) {
      this.drop(ask, 'disconnect');
      return live.length;
    }
    for (const e of ask) {
      e.deleting = true;
      this.deleting.add(e);
    }
    this.emitSelect();
    this.invalidate();
    const waits = results.filter(isThenable);
    if (waits.length) {
      Promise.all(waits).then(
        () => this.finishDelete(ask, true),
        () => this.finishDelete(ask, false),
      );
    }
    return live.length;
  }

  private finishDelete(list: readonly Edge[], ok: boolean): void {
    const mine = list.filter((e) => this.deleting.has(e));
    for (const e of mine) this.deleting.delete(e);
    if (ok) {
      this.drop(
        mine.filter((e) => this.store.edgesById.get(e.id) === e),
        'disconnect',
      );
      return;
    }
    for (const e of mine) {
      e.deleting = false;
      e.ct = this.time;
    }
    this.anim.pulseUntil = Math.max(this.anim.pulseUntil, this.time + 0.5);
    this.undoStack.pop();
    this.emitter.emit('change', { reason: 'revert', added: [], removed: [] });
    this.emitSelect();
    this.invalidate();
  }

  /** Remove edges from the model now (the host agreed, or there is no host), with the fade for a single wire. */
  private drop(list: readonly Edge[], reason: ChangeEvent['reason']): void {
    if (!list.length) return;
    if (list.length === 1)
      this.anim.ghost = {
        segs: edgeSegs(list[0]!),
        type: list[0]!.a.type,
        t0: this.time,
      };
    for (const e of list) {
      this.pending.delete(e);
      this.deleting.delete(e);
    }
    this.store.removeEdges(list);
    this.reroute({ added: [], removed: list });
    this.emitter.emit('change', {
      reason,
      added: [],
      removed: list.map((e) => e.id),
    });
    this.emitSelect();
  }

  /** The host's answer when a handler returned nothing: it worked (pending connect settles, pending delete completes). */
  confirm(ids: string | readonly string[]): void {
    for (const e of this.byIds(ids)) {
      if (this.pending.has(e)) this.settle(e, true);
      else if (this.deleting.has(e)) this.finishDelete([e], true);
    }
  }

  /** The host's answer when it failed: a pending connect fades away, a pending delete springs back. */
  revert(ids: string | readonly string[]): void {
    for (const e of this.byIds(ids)) {
      if (this.pending.has(e)) this.settle(e, false);
      else if (this.deleting.has(e)) this.finishDelete([e], false);
    }
  }

  private byIds(ids: string | readonly string[]): Edge[] {
    return ([] as string[])
      .concat(ids)
      .map((id) => this.store.edgesById.get(id))
      .filter((e): e is Edge => !!e);
  }

  // ---------------------------------------------------------------- undo

  /** Does this undo entry still mean something? (Its wires may have been rolled back or removed by the host since.) */
  private actionable(u: UndoEntry): boolean {
    if (u.kind === 'connected') return u.ends.some((en) => !!this.findEdge(en));
    return u.ends.some((en) => {
      const a = this.store.assets.get(en.a);
      const b = this.store.assets.get(en.b);
      return (
        !!a &&
        !!b &&
        !this.findEdge(en) &&
        !!this.store.findPort(a, 'out', en.fp) &&
        !!this.store.findPort(b, 'in', en.tp)
      );
    });
  }

  /** Undo the last gesture by asking the host for the inverse (a delete is undone by a connect request and vice versa). */
  undo(): boolean {
    let u = this.undoStack.pop();
    while (u && !this.actionable(u)) u = this.undoStack.pop(); // skip entries the host's data has already made moot
    if (!u) return false;
    if (u.kind === 'connected') {
      const edges = u.ends
        .map((en) => this.findEdge(en))
        .filter((e): e is Edge => !!e);
      this.requestDisconnect(edges, 'undo', false);
      return true;
    }
    const made: Edge[] = [];
    for (const en of u.ends) {
      const a = this.store.assets.get(en.a);
      const b = this.store.assets.get(en.b);
      const fp = a && this.store.findPort(a, 'out', en.fp);
      const tp = b && this.store.findPort(b, 'in', en.tp);
      if (!a || !b || !fp || !tp) continue;
      const e = this.store.addLocalEdge(a, fp, b, tp, { pending: true });
      if (e) made.push(e);
    }
    if (!made.length) return true;
    for (const e of made) this.pending.add(e);
    this.reroute({ added: made, removed: [] });
    this.emitter.emit('change', {
      reason: 'connect',
      added: made.map((e) => e.id),
      removed: [],
    });
    this.emitSelect();
    const as = [...new Set(made.map((e) => e.a))];
    const bs = [...new Set(made.map((e) => e.b))];
    const side = (nodes: AssetNode[]): ConnectSide => ({
      type: nodes[0]!.type,
      layer: nodes[0]!.layer,
      count: nodes.length,
      assetIds: nodes.map((n) => n.id),
    });
    this.askConnect(made, {
      source: 'undo',
      from: side(as),
      to: side(bs),
      cardinality: cardinality(as.length, bs.length),
      existingLinks: 0,
      edgeIds: made.map((e) => e.id),
      pairs: made.map((e) => ({
        from: { assetId: e.a.id, portId: e.fp.id },
        to: { assetId: e.b.id, portId: e.tp.id },
      })),
    });
    return true;
  }

  private findEdge(en: Ends): Edge | undefined {
    return this.store.assets
      .get(en.a)
      ?.out.find(
        (e) => e.fp.id === en.fp && e.b.id === en.b && e.tp.id === en.tp,
      );
  }

  get canUndo(): boolean {
    return this.undoStack.some((u) => this.actionable(u));
  }

  // ---------------------------------------------------------------- animation clock

  bump(n: AssetNode, side: -1 | 1, push: number): void {
    if (n.x0 === undefined) n.x0 = n.x;
    n.bt = this.time;
    n.bside = side;
    n.bpush = push;
    this.anim.bumping.add(n);
  }

  /** Advance time-based state (card shoves, glow easing). Returns true while anything still needs frames. */
  /** Are cards currently gliding? (Hit-test results can't be reused while they move.) */
  get isMoving(): boolean {
    return this.tweenNodes.length > 0 || this.anim.bumping.size > 0;
  }

  stepAnim(): boolean {
    let busy = false;
    const A = this.anim;
    for (const n of A.bumping) {
      const age = this.time - (n.bt ?? 0);
      if (age > 1.3 || n.x0 === undefined) {
        if (n.x0 !== undefined) n.x = n.x0;
        n.bt = null;
        A.bumping.delete(n);
      } else {
        n.x = n.x0 + n.bpush * (age / 0.13) * Math.exp(1 - age / 0.13);
        busy = true;
      }
    }
    for (const n of A.pulsing) {
      if (n.pulse === undefined || this.time - n.pulse > 0.9) {
        n.pulse = undefined;
        A.pulsing.delete(n);
      } else busy = true;
    }
    if (this.tweenNodes.length || this.tweenGroups.length) {
      const t = Math.min(
        1,
        (this.time - this.tweenStart) / (this.layoutTweenMs / 1000),
      );
      const k = 1 - Math.pow(1 - t, 3); // ease out
      const d = this.tweenData;
      for (let i = 0; i < this.tweenNodes.length; i++) {
        const n = this.tweenNodes[i]!;
        n.x = d[4 * i]! + (d[4 * i + 2]! - d[4 * i]!) * k;
        n.y = d[4 * i + 1]! + (d[4 * i + 3]! - d[4 * i + 1]!) * k;
      }
      const g = this.tweenGData;
      for (let i = 0; i < this.tweenGroups.length; i++) {
        const gr = this.tweenGroups[i]!;
        gr.x = g[8 * i]! + (g[8 * i + 4]! - g[8 * i]!) * k;
        gr.y = g[8 * i + 1]! + (g[8 * i + 5]! - g[8 * i + 1]!) * k;
        gr.w = g[8 * i + 2]! + (g[8 * i + 6]! - g[8 * i + 2]!) * k;
        gr.h = g[8 * i + 3]! + (g[8 * i + 7]! - g[8 * i + 3]!) * k;
      }
      if (t >= 1) this.stopTween(true);
      busy = true;
    }
    if (A.hover) A.glowing.add(A.hover);
    if (this.selected) A.glowing.add(this.selected);
    for (const n of A.glowing) {
      const tgt = n === A.hover || n === this.selected ? 1 : 0;
      n.gl += (tgt - n.gl) * 0.25;
      if (Math.abs(tgt - n.gl) > 0.01) busy = true;
      else {
        n.gl = tgt;
        if (!tgt) A.glowing.delete(n);
      }
    }
    return (
      busy ||
      this.selNodes.size > 0 ||
      this.pending.size > 0 ||
      A.pulseUntil > this.time ||
      !!(A.conn || A.gconn || A.retract || A.flash || A.ghost)
    );
  }
}
