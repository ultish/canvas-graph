import {
  computeLayout,
  type LayoutConfig,
  type LayoutInput,
  type LayoutOutput,
} from './layout-core.ts';
import type { AssetNode, Comp, Edge, Group, GroupEdge } from './types.ts';

export const GAP_CARD = 64; // clear space between cards in a group's grid, both ways, and between the grid and its frame
export const PAD = GAP_CARD; // frame padding around a group
export const NODE_W = 200;
export const CW = NODE_W + GAP_CARD; // grid cell width inside a group
export const GAP_LAYER = 420; // frame-to-frame distance between columns
export const GAP_GROUP = 80; // frame-to-frame distance between groups stacked in a layer
export const GAP_COMP = 1600; // between rows of pipelines (loop lanes live in this gap)
export const GAP_COMP_X = 800; // between pipelines side by side
export const PORT_Y0 = 52; // the first port's height, and its distance from the card's bottom edge to the last port
export const PORT_DY = 20;

export const cardHeight = (n: Pick<AssetNode, 'ins' | 'outs'>): number =>
  2 * PORT_Y0 + PORT_DY * (Math.max(1, n.ins.length, n.outs.length) - 1);

export const portY = (n: AssetNode, k: number): number =>
  n.y + PORT_Y0 + k * PORT_DY;

export interface LayoutResult {
  groups: Group[];
  comps: Comp[];
}

export const LAYOUT_CONFIG: LayoutConfig = {
  PAD,
  GAP_CARD,
  CW,
  NODE_W,
  GAP_LAYER,
  GAP_GROUP,
  GAP_COMP,
  GAP_COMP_X,
};

/** Assets and connections as the typed arrays the layout core works on (and numbers assets 0..n-1 in `ord`). */
export function buildLayoutInput(
  nodes: readonly AssetNode[],
  edges: readonly Edge[],
): LayoutInput {
  const n = nodes.length;
  const m = edges.length;
  const h = new Float64Array(n);
  const type = new Int32Array(n);
  const types = new Map<string, number>();
  nodes.forEach((node, i) => {
    node.ord = i;
    h[i] = node.h;
    let t = types.get(node.type);
    if (t === undefined) types.set(node.type, (t = types.size));
    type[i] = t;
  });
  const ea = new Int32Array(m);
  const eb = new Int32Array(m);
  edges.forEach((e, i) => {
    ea[i] = e.a.ord;
    eb[i] = e.b.ord;
  });
  return { n, m, h, type, ea, eb, cfg: LAYOUT_CONFIG };
}

/** Put a layout result onto the model: layers, positions, back connections, and fresh group and pipeline objects. */
export function applyLayout(
  nodes: readonly AssetNode[],
  edges: readonly Edge[],
  out: LayoutOutput,
): LayoutResult {
  edges.forEach((e, i) => (e.back = out.back[i] === 1));
  const comps: Comp[] = [];
  for (let c = 0; c < out.compCount; c++) {
    comps.push({
      kind: out.compKind[c] === 1 ? 'unconnected' : 'pipeline',
      nodes: [],
      groups: [],
      bbox: { x: out.cx[c]!, y: out.cy[c]!, w: out.cw[c]!, h: out.ch[c]! },
      bbox0: { y: out.cy[c]!, h: out.ch[c]! },
    });
  }
  const groups: Group[] = [];
  for (let g = 0; g < out.groupCount; g++) {
    const comp = comps[out.gComp[g]!]!;
    const grp: Group = {
      id: g,
      key: '',
      comp,
      layer: out.gLayer[g]!,
      type: '',
      nodes: [],
      x: out.gx[g]!,
      y: out.gy[g]!,
      w: out.gw[g]!,
      h: out.gh[g]!,
      rows: out.gRows[g]!,
      mh: out.gMh[g]!,
      rh: out.gRh[g]!,
    };
    groups.push(grp);
    comp.groups.push(grp);
  }
  nodes.forEach((node, i) => {
    const g = groups[out.groupOf[i]!]!;
    if (!g.nodes.length) {
      g.type = node.type;
      g.key = `${g.comp.kind === 'unconnected' ? 'unconnected' : g.layer}|${node.type}`;
    }
    g.nodes.push(node);
    g.comp.nodes.push(node);
    node.g = g;
    node.layer = out.layer[i]!;
    node.x = out.x[i]!;
    node.y = out.y[i]!;
  });
  return { groups, comps };
}

/**
 * Lay the whole graph out: break cycles (the closing connection becomes a "back" connection), layer by longest path, group
 * by (layer, type), place layers left to right with the largest group of each layer on the baseline, and shelf-pack
 * pipelines and the block of unconnected assets. The algorithm is `computeLayout` (layout-core.ts), on typed arrays.
 * Idempotent: it derives everything from the model, so it can run again after the data changes.
 */
export function layoutGraph(
  nodes: readonly AssetNode[],
  edges: readonly Edge[],
): LayoutResult {
  return applyLayout(
    nodes,
    edges,
    computeLayout(buildLayoutInput(nodes, edges)),
  );
}

/**
 * Group-to-group pipes, kept up to date as connections come and go. A connection joining two groups that already have a
 * pipe just changes its count; a pipe that appears or disappears and is a loop (above) or a layer-skipper (below)
 * re-runs the lane assignment for its one pipeline. `rebuild` is the from-scratch version (after a relayout).
 * `gedges` is one array that is updated in place, so holding a reference to it is safe.
 */
export class GroupRouter {
  readonly gedges: GroupEdge[] = [];
  private byKey = new Map<string, GroupEdge>();

  private key(e: Edge): string {
    return e.a.g!.id + (e.back ? '<' : '>') + e.b.g!.id;
  }

  rebuild(edges: readonly Edge[], comps: readonly Comp[]): void {
    this.gedges.length = 0;
    this.byKey.clear();
    for (const e of edges) {
      e.ge = null;
      this.attach(e);
    }
    for (const c of comps) this.lanes(c);
  }

  /** Add connections (both ends must be laid out). */
  add(edges: readonly Edge[]): void {
    const touched = new Set<Comp>();
    for (const e of edges) {
      if (!e.a.g || !e.b.g || e.ge) continue;
      const ge = this.attach(e);
      if (ge && ge.edges.length === 1 && (ge.back || ge.skip))
        touched.add(ge.a.comp);
    }
    for (const c of touched) this.lanes(c);
  }

  /** Remove connections. A pipe left with none is dropped. */
  remove(edges: readonly Edge[]): void {
    const gone = new Set(edges);
    const hit = new Set<GroupEdge>();
    for (const e of edges) if (e.ge) hit.add(e.ge);
    const touched = new Set<Comp>();
    for (const ge of hit) {
      ge.edges = ge.edges.filter((e) => !gone.has(e));
      ge.count = ge.edges.length;
      if (ge.edges.length) continue;
      this.byKey.delete(ge.a.id + (ge.back ? '<' : '>') + ge.b.id);
      this.gedges.splice(this.gedges.indexOf(ge), 1);
      if (ge.back || ge.skip) touched.add(ge.a.comp);
    }
    for (const e of edges) e.ge = null;
    for (const c of touched) this.lanes(c);
  }

  private attach(e: Edge): GroupEdge | null {
    if (!e.a.g || !e.b.g) return null;
    const a = e.a.g;
    const b = e.b.g;
    const key = this.key(e);
    let ge = this.byKey.get(key);
    if (!ge) {
      ge = {
        a,
        b,
        count: 0,
        back: e.back,
        skip: !e.back && e.b.layer - e.a.layer > 1,
        laneY: undefined,
        edges: [],
      };
      this.byKey.set(key, ge);
      this.gedges.push(ge);
    }
    ge.count++;
    ge.edges.push(e);
    e.ge = ge;
    return ge;
  }

  /** Loops over the top and layer-skippers underneath, each in the first lane that does not overlap another in its span. */
  private lanes(c: Comp): void {
    const cg = c.groups;
    let top = c.bbox0.y;
    let bot = c.bbox0.y + c.bbox0.h;
    for (const ge of this.gedges) if (ge.a.comp === c) ge.laneY = undefined;
    for (const side of ['back', 'skip'] as const) {
      const list = this.gedges
        .filter((ge) => ge.a.comp === c && ge[side])
        .map((ge) => ({
          ge,
          lo: Math.min(ge.a.layer, ge.b.layer),
          hi: Math.max(ge.a.layer, ge.b.layer),
        }))
        .sort((p, q) => p.hi - p.lo - (q.hi - q.lo));
      const lanes: Array<typeof list> = [];
      for (const it of list) {
        let k = lanes.findIndex((L) =>
          L.every((o) => o.hi < it.lo || o.lo > it.hi),
        );
        if (k < 0) {
          k = lanes.length;
          lanes.push([]);
        }
        lanes[k]!.push(it);
        const span = cg.filter((g) => g.layer >= it.lo && g.layer <= it.hi);
        it.ge.laneY =
          side === 'back'
            ? Math.min(...span.map((g) => g.y - PAD)) - 140 - k * 140
            : Math.max(...span.map((g) => g.y + g.h + PAD)) + 140 + k * 140;
        top = Math.min(top, it.ge.laneY - 60);
        bot = Math.max(bot, it.ge.laneY + 60);
      }
    }
    c.bbox.y = top;
    c.bbox.h = bot - top;
  }
}

/** From-scratch routing: group pipes and lanes for every connection. */
export function routeEdges(
  edges: readonly Edge[],
  groups: readonly Group[],
  comps: readonly Comp[],
): GroupEdge[] {
  void groups;
  const router = new GroupRouter();
  router.rebuild(edges, comps);
  return router.gedges;
}
