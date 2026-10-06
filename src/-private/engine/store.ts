import { layoutGraph, cardHeight, NODE_W } from './layout.ts';
import type {
  AssetInput,
  AssetNode,
  ConnectionInput,
  Edge,
  GraphInput,
  Port,
  PortInput,
} from './types.ts';
import { byName } from './util.ts';

export interface SyncResult {
  assets: { added: number; changed: number; removed: number };
  connections: {
    added: number;
    changed: number;
    removed: number;
    promoted: number;
    /** Same wire, new id (an optimistic response swapping its temporary id for the real one). */
    renamed: number;
    dangling: number;
  };
  /** Added/removed assets, a changed type, or a card that outgrew its cell: positions must be recomputed. */
  structural: boolean;
  /** Connections appeared or disappeared: group pipes and lanes must be rebuilt. */
  routing: boolean;
  /** Anything visible changed (names, status, enabled/pending): a redraw is worth it. */
  visual: boolean;
  /** Assets and connections whose object identity differed from last time (the cost of this sync). */
  visited: number;
  /** Local (gesture-created) connections that the host's data now echoes back: [local id, real id]. */
  promoted: Array<[string, string]>;
  /** Connections the host's data just stopped marking pending (saved): they get the settle pulse. */
  settled: string[];
}

const edgeKey = (aId: string, fpId: string, bId: string, tpId: string) =>
  `${aId}\0${fpId}\0${bId}\0${tpId}`;

/**
 * The engine's model, keyed by the host's ids. `sync` folds a GraphQL-shaped payload into it by
 * identity: an object that is `===` to last time's costs nothing (Apollo only allocates when
 * something changed), and the model's own objects keep their identity across syncs.
 */
export class GraphStore {
  assets = new Map<string, AssetNode>();
  edgesById = new Map<string, Edge>();
  nodes: AssetNode[] = []; // insertion order, kept in step with `assets`
  edgeList: Edge[] = [];
  private localByKey = new Map<string, Edge>();
  private localSeq = 0;

  private makePort(raw: PortInput): Port {
    return { id: raw.id, name: raw.name };
  }

  private makeNode(raw: AssetInput): AssetNode {
    const ins = raw.inputPorts.map((p) => this.makePort(p)).sort(byName);
    const outs = raw.outputPorts.map((p) => this.makePort(p)).sort(byName);
    return {
      id: raw.id,
      name: raw.name,
      type: raw.type,
      status: raw.status ?? 'ready',
      raw,
      ins,
      outs,
      in: [],
      out: [],
      x: 0,
      y: 0,
      w: NODE_W,
      h: cardHeight({ ins, outs }),
      layer: 0,
      g: null,
      ord: 0,
      gl: 0,
      bt: null,
      bside: -1,
      bpush: 0,
      x0: undefined,
      hiP: [],
      hoP: [],
      hiC: [],
    };
  }

  /** Reconcile one side's ports by id. Returns the edges that pointed at a port that no longer exists. */
  private reconcilePorts(
    n: AssetNode,
    side: 'in' | 'out',
    raws: readonly PortInput[],
    r: { changed: boolean },
  ): Edge[] {
    const list = side === 'in' ? n.ins : n.outs;
    const byId = new Map(list.map((p) => [p.id, p]));
    const next: Port[] = [];
    const seen = new Set<string>();
    for (const raw of raws) {
      seen.add(raw.id);
      const p = byId.get(raw.id);
      if (p) {
        if (p.name !== raw.name) {
          p.name = raw.name;
          r.changed = true;
        }
        next.push(p);
      } else {
        next.push(this.makePort(raw));
        r.changed = true;
      }
    }
    const orphans: Edge[] = [];
    for (const p of list) {
      if (seen.has(p.id)) continue;
      r.changed = true;
      for (const e of side === 'in' ? n.in : n.out)
        if ((side === 'in' ? e.tp : e.fp) === p) orphans.push(e);
    }
    next.sort(byName);
    if (side === 'in') n.ins = next;
    else n.outs = next;
    return orphans;
  }

  private reindex(n: AssetNode): void {
    for (const e of n.out) e.ai = n.outs.indexOf(e.fp);
    for (const e of n.in) e.bi = n.ins.indexOf(e.tp);
  }

  private makeEdge(
    id: string,
    a: AssetNode,
    fp: Port,
    b: AssetNode,
    tp: Port,
    raw: ConnectionInput | null,
    local: boolean,
  ): Edge {
    const e: Edge = {
      id,
      a,
      b,
      fp,
      tp,
      ai: a.outs.indexOf(fp),
      bi: b.ins.indexOf(tp),
      back: b.layer <= a.layer && a.g !== null,
      enabled: raw ? raw.enabled !== false : true,
      pending: raw ? !!raw.pending : false,
      deleting: false,
      local,
      raw,
      ge: null,
      stamp: 0,
      pstamp: 0,
      ct: undefined,
    };
    this.edgesById.set(id, e);
    this.edgeList.push(e);
    a.out.push(e);
    b.in.push(e);
    if (local) this.localByKey.set(edgeKey(a.id, fp.id, b.id, tp.id), e);
    return e;
  }

  /** Remove edges in one pass (one array compaction, not one per edge). */
  removeEdges(list: Iterable<Edge>): void {
    const gone = new Set(list);
    if (!gone.size) return;
    const touched = new Set<AssetNode>();
    for (const e of gone) {
      this.edgesById.delete(e.id);
      if (e.local)
        this.localByKey.delete(edgeKey(e.a.id, e.fp.id, e.b.id, e.tp.id));
      touched.add(e.a);
      touched.add(e.b);
    }
    let w = 0;
    for (const e of this.edgeList) if (!gone.has(e)) this.edgeList[w++] = e;
    this.edgeList.length = w;
    for (const n of touched) {
      n.out = n.out.filter((e) => !gone.has(e));
      n.in = n.in.filter((e) => !gone.has(e));
    }
  }

  /** Add a connection made by a gesture or a bulk command; the host's data replaces it once it echoes it back. */
  addLocalEdge(
    a: AssetNode,
    fp: Port,
    b: AssetNode,
    tp: Port,
    opts: { enabled?: boolean; pending?: boolean } = {},
  ): Edge | null {
    if (a === b || a.out.some((e) => e.b === b && e.fp === fp && e.tp === tp))
      return null;
    const e = this.makeEdge(
      `local:${++this.localSeq}`,
      a,
      fp,
      b,
      tp,
      null,
      true,
    );
    e.enabled = opts.enabled !== false;
    e.pending = !!opts.pending;
    return e;
  }

  /** The host owns port names; an unseen port id is added to the card. Returns true if the card outgrew its cell. */
  ensurePort(
    n: AssetNode,
    side: 'in' | 'out',
    spec: string | PortInput,
  ): { port: Port; overflow: boolean } {
    const want = typeof spec === 'object' ? spec : { id: spec, name: spec };
    const list = side === 'out' ? n.outs : n.ins;
    const found = list.find((p) => p.id === want.id);
    if (found) return { port: found, overflow: false };
    const port = this.makePort(want);
    list.push(port);
    list.sort(byName);
    this.reindex(n);
    const h = cardHeight(n);
    const grew = h > n.h;
    n.h = Math.max(n.h, h);
    return { port, overflow: grew && n.g !== null && h > n.g.mh };
  }

  findPort(n: AssetNode, side: 'in' | 'out', id: string): Port | undefined {
    return (side === 'out' ? n.outs : n.ins).find((p) => p.id === id);
  }

  sync(input: GraphInput): SyncResult {
    const res: SyncResult = {
      assets: { added: 0, changed: 0, removed: 0 },
      connections: {
        added: 0,
        changed: 0,
        removed: 0,
        promoted: 0,
        renamed: 0,
        dangling: 0,
      },
      structural: false,
      routing: false,
      visual: false,
      visited: 0,
      promoted: [],
      settled: [],
    };
    const doomed = new Set<Edge>();

    // ---- assets
    const seenA = new Set<string>();
    for (const raw of input.assets) {
      seenA.add(raw.id);
      const n = this.assets.get(raw.id);
      if (!n) {
        const made = this.makeNode(raw);
        this.assets.set(raw.id, made);
        this.nodes.push(made);
        res.assets.added++;
        res.structural = res.visual = true;
        res.visited++;
        continue;
      }
      if (n.raw === raw) continue;
      res.visited++;
      n.raw = raw;
      let changed = false;
      if (n.name !== raw.name) {
        n.name = raw.name;
        changed = true;
      }
      const status = raw.status ?? 'ready';
      if (n.status !== status) {
        n.status = status;
        changed = true;
      }
      if (n.type !== raw.type) {
        n.type = raw.type;
        changed = true;
        res.structural = true;
      }
      const pr = { changed: false };
      for (const e of this.reconcilePorts(n, 'in', raw.inputPorts, pr))
        doomed.add(e);
      for (const e of this.reconcilePorts(n, 'out', raw.outputPorts, pr))
        doomed.add(e);
      if (pr.changed) {
        changed = true;
        this.reindex(n);
        const h = cardHeight(n);
        if (n.g && h > n.g.mh) res.structural = true;
        n.h = h;
      }
      if (changed) {
        res.assets.changed++;
        res.visual = true;
      }
    }
    const goneAssets = this.nodes.filter((n) => !seenA.has(n.id));
    if (goneAssets.length) {
      for (const n of goneAssets) {
        this.assets.delete(n.id);
        for (const e of n.out) doomed.add(e);
        for (const e of n.in) doomed.add(e);
      }
      const set = new Set(goneAssets);
      this.nodes = this.nodes.filter((n) => !set.has(n));
      res.assets.removed = goneAssets.length;
      res.structural = res.visual = true;
    }

    // ---- connections
    const seenE = new Set<string>();
    for (const raw of input.connections) {
      seenE.add(raw.id);
      const e = this.edgesById.get(raw.id);
      if (e && e.raw === raw) continue;
      res.visited++;
      if (
        e &&
        e.a.id === raw.from.assetId &&
        e.fp.id === raw.from.portId &&
        e.b.id === raw.to.assetId &&
        e.tp.id === raw.to.portId
      ) {
        e.raw = raw;
        const enabled = raw.enabled !== false;
        const pending = !!raw.pending;
        if (e.enabled !== enabled || e.pending !== pending) {
          if (e.pending && !pending) res.settled.push(e.id);
          e.enabled = enabled;
          e.pending = pending;
          res.connections.changed++;
          res.visual = true;
        }
        continue;
      }
      if (e) {
        doomed.add(e);
        res.connections.changed++;
      } // endpoints moved: treat as remove + add
      const a = this.assets.get(raw.from.assetId);
      const b = this.assets.get(raw.to.assetId);
      const fp = a && this.findPort(a, 'out', raw.from.portId);
      const tp = b && this.findPort(b, 'in', raw.to.portId);
      if (!a || !b || !fp || !tp) {
        res.connections.dangling++;
        continue;
      }
      const local = this.localByKey.get(edgeKey(a.id, fp.id, b.id, tp.id));
      if (local) {
        doomed.add(local);
        res.promoted.push([local.id, raw.id]);
        res.connections.promoted++;
      }
      if (e) this.edgesById.delete(e.id);
      this.pendingNew.push({ raw, a, fp, b, tp });
      res.connections.added++;
    }
    const missing: Edge[] = [];
    for (const e of this.edgeList)
      if (!e.local && !seenE.has(e.id)) missing.push(e);
    if (missing.length && this.pendingNew.length) {
      // an optimistic response swaps a temporary id for the real one: the same wire under a new id is a rename
      const byKey = new Map(
        missing.map((e) => [edgeKey(e.a.id, e.fp.id, e.b.id, e.tp.id), e]),
      );
      this.pendingNew = this.pendingNew.filter((p) => {
        const key = edgeKey(p.a.id, p.fp.id, p.b.id, p.tp.id);
        const old = byKey.get(key);
        if (!old) return true;
        byKey.delete(key);
        missing.splice(missing.indexOf(old), 1);
        this.edgesById.delete(old.id);
        old.id = p.raw.id;
        old.raw = p.raw;
        this.edgesById.set(old.id, old);
        const enabled = p.raw.enabled !== false;
        const pending = !!p.raw.pending;
        if (old.pending && !pending) res.settled.push(old.id);
        if (old.enabled !== enabled || old.pending !== pending)
          res.visual = true;
        old.enabled = enabled;
        old.pending = pending;
        res.connections.renamed++;
        res.connections.added--;
        return false;
      });
    }
    if (this.pendingNew.length) res.routing = res.visual = true;
    for (const e of missing) {
      doomed.add(e);
      res.connections.removed++;
      res.routing = res.visual = true;
    }
    if (doomed.size) {
      this.removeEdges(doomed);
      res.routing = res.visual = true;
    }
    for (const p of this.pendingNew) {
      // an asset getting its first connection leaves the unconnected block (and may join a pipeline): positions change
      if (
        (!p.a.in.length && !p.a.out.length) ||
        (!p.b.in.length && !p.b.out.length)
      )
        res.structural = true;
      this.makeEdge(p.raw.id, p.a, p.fp, p.b, p.tp, p.raw, false);
    }
    this.pendingNew.length = 0;
    return res;
  }

  private pendingNew: Array<{
    raw: ConnectionInput;
    a: AssetNode;
    fp: Port;
    b: AssetNode;
    tp: Port;
  }> = [];

  /** Positions and groups for the current model. */
  layout() {
    return layoutGraph(this.nodes, this.edgeList);
  }
}
