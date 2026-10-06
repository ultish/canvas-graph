import type { AssetNode, Comp, Edge, Group, GroupEdge } from './types.ts';

export const PAD = 40; // frame padding around a group
export const CW = 230; // grid cell width inside a group
export const NODE_W = 200;
export const GAP_LAYER = 420; // frame-to-frame distance between columns
export const GAP_GROUP = 80; // frame-to-frame distance between groups stacked in a layer
export const GAP_COMP = 1600; // between separate pipelines
export const PORT_Y0 = 62;
export const PORT_DY = 20;

export const cardHeight = (n: Pick<AssetNode, 'ins' | 'outs'>): number =>
  PORT_Y0 + PORT_DY * Math.max(1, n.ins.length, n.outs.length) + 22;

export const portY = (n: AssetNode, k: number): number =>
  n.y + PORT_Y0 + k * PORT_DY;

/** Separate pipelines: weakly connected components, in first-asset order. */
function findComps(nodes: readonly AssetNode[]): Comp[] {
  const parent = new Map<AssetNode, AssetNode>();
  const find = (n: AssetNode): AssetNode => {
    let r = n;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = n;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  for (const n of nodes) parent.set(n, n);
  for (const n of nodes) for (const e of n.out) parent.set(find(e.b), find(n));
  const byRoot = new Map<AssetNode, Comp>();
  const comps: Comp[] = [];
  for (const n of nodes) {
    const root = find(n);
    let c = byRoot.get(root);
    if (!c) {
      c = {
        nodes: [],
        bbox: { x: 0, y: 0, w: 0, h: 0 },
        bbox0: { y: 0, h: 0 },
      };
      byRoot.set(root, c);
      comps.push(c);
    }
    c.nodes.push(n);
  }
  return comps;
}

export interface LayoutResult {
  groups: Group[];
  comps: Comp[];
}

/**
 * Break cycles (the closing edge becomes a "back" edge), layer by longest path, group by
 * (layer, type), then place: layers left to right, the largest group of each layer on the
 * baseline and its siblings stacked below, each group a roughly square grid of cards.
 * Idempotent: it resets everything it derives, so it can run again after the data changes.
 */
export function layoutGraph(
  nodes: readonly AssetNode[],
  edges: readonly Edge[],
): LayoutResult {
  nodes.forEach((n, i) => {
    n.layer = 0;
    n.g = null;
    n.ord = i;
  });
  for (const e of edges) e.back = false;
  const groups: Group[] = [];
  const comps = findComps(nodes);
  const state = new Int8Array(nodes.length); // 0 unseen, 1 on stack, 2 done
  let compTop = 0;

  for (const c of comps) {
    const roots = c.nodes.filter((n) => !n.in.length).concat(c.nodes);
    for (const r of roots) {
      if (state[r.ord]) continue;
      state[r.ord] = 1;
      const stack: Array<[AssetNode, number]> = [[r, 0]];
      while (stack.length) {
        const top = stack[stack.length - 1]!;
        const n = top[0];
        if (top[1] < n.out.length) {
          const e = n.out[top[1]++]!;
          const m = e.b;
          if (state[m.ord] === 1) e.back = true;
          else if (!state[m.ord]) {
            state[m.ord] = 1;
            stack.push([m, 0]);
          }
        } else {
          state[n.ord] = 2;
          stack.pop();
        }
      }
    }

    const deg = new Map(
      c.nodes.map((n) => [n, n.in.filter((e) => !e.back).length]),
    );
    const q = c.nodes.filter((n) => deg.get(n) === 0);
    while (q.length) {
      const n = q.pop()!;
      for (const e of n.out) {
        if (e.back) continue;
        const m = e.b;
        m.layer = Math.max(m.layer, n.layer + 1);
        deg.set(m, deg.get(m)! - 1);
        if (!deg.get(m)) q.push(m);
      }
    }

    const byKey = new Map<string, Group>();
    const layers: Group[][] = [];
    const compGroups: Group[] = [];
    for (const n of c.nodes) {
      const key = `${n.layer}|${n.type}`;
      let g = byKey.get(key);
      if (!g) {
        g = {
          id: groups.length,
          key,
          comp: c,
          layer: n.layer,
          type: n.type,
          nodes: [],
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          rows: 1,
          mh: 0,
          rh: 0,
        };
        groups.push(g);
        compGroups.push(g);
        byKey.set(key, g);
        (layers[n.layer] ||= []).push(g);
      }
      g.nodes.push(n);
      n.g = g;
    }
    for (const g of compGroups) {
      const cnt = g.nodes.length;
      g.mh = g.nodes.reduce((m, n) => Math.max(m, n.h), 0);
      g.rh = g.mh + 30;
      g.rows = Math.max(1, Math.ceil(Math.sqrt((cnt * CW) / g.rh)));
      const cols = Math.ceil(cnt / g.rows);
      g.w = (cols - 1) * CW + NODE_W;
      g.h = (Math.min(cnt, g.rows) - 1) * g.rh + g.mh;
    }

    for (const L of layers)
      L.sort((p, q2) => q2.nodes.length - p.nodes.length || p.id - q2.id);
    const base = Math.max(...layers.map((L) => L[0]!.h / 2 + PAD));
    const below = Math.max(
      ...layers.map(
        (L) =>
          L[0]!.h / 2 +
          PAD +
          L.slice(1).reduce((s, g) => s + g.h + 2 * PAD + GAP_GROUP, 0),
      ),
    );
    const compH = base + below;
    let x = 0;
    for (const L of layers) {
      const lw = Math.max(...L.map((g) => g.w));
      let y = compTop + base - L[0]!.h / 2;
      for (const g of L) {
        g.x = x + (lw - g.w) / 2;
        g.y = y;
        g.nodes.forEach((n, i) => {
          n.x = g.x + Math.floor(i / g.rows) * CW;
          n.y = g.y + (i % g.rows) * g.rh;
        });
        y += g.h + 2 * PAD + GAP_GROUP;
      }
      x += lw + 2 * PAD + GAP_LAYER;
    }
    c.bbox = { x: -PAD, y: compTop, w: x - GAP_LAYER, h: compH };
    c.bbox0 = { y: compTop, h: compH };
    compTop += compH + GAP_COMP;
  }
  return { groups, comps };
}

/**
 * Aggregate edges into group-to-group pipes and give loops (above) and layer-skippers (below)
 * their own non-overlapping lanes. Cheap enough to rerun whenever connections change.
 */
export function routeEdges(
  edges: readonly Edge[],
  groups: readonly Group[],
  comps: readonly Comp[],
): GroupEdge[] {
  const gedges: GroupEdge[] = [];
  const byKey = new Map<string, GroupEdge>();
  for (const e of edges) {
    const a = e.a.g!;
    const b = e.b.g!;
    const key = a.id + (e.back ? '<' : '>') + b.id;
    let ge = byKey.get(key);
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
      byKey.set(key, ge);
      gedges.push(ge);
    }
    ge.count++;
    ge.edges.push(e);
    e.ge = ge;
  }
  for (const c of comps) {
    const cg = groups.filter((g) => g.comp === c);
    let top = c.bbox0.y;
    let bot = c.bbox0.y + c.bbox0.h;
    for (const side of ['back', 'skip'] as const) {
      const list = gedges
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
  return gedges;
}
