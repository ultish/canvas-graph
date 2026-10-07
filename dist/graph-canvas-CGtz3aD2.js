import { registerDestructor } from '@ember/destroyable';
import Modifier from 'ember-modifier';
import { tracked } from '@glimmer/tracking';
import { g, i } from 'decorator-transforms/runtime-esm';

/** A wire being dragged from a port (zoomed in). */

/** A fat pipe being dragged from a group handle (zoomed out). */

/** Transient, purely visual state that the engine, the interaction layer and the renderer share. */

const createAnimState = () => ({
  conn: null,
  gconn: null,
  retract: null,
  flash: null,
  found: new Set(),
  groupDraft: null,
  ghost: null,
  bumping: new Set(),
  pulsing: new Set(),
  glowing: new Set(),
  pulseUntil: 0,
  hover: null,
  hoverEdge: null,
  hoverGE: null
});

// A tiny typed event emitter. "Passive" listeners (an inspector, a built-in dialog) see every event but do not
// count as the host: a request nobody but a passive listener is watching is treated as unhandled.

class Emitter {
  map = new Map();
  on(type, fn, opts = {}) {
    let set = this.map.get(type);
    if (!set) this.map.set(type, set = new Set());
    const l = {
      fn,
      passive: !!opts.passive
    };
    set.add(l);
    return () => void set.delete(l);
  }

  /** Number of non-passive listeners. */
  handlers(type) {
    let n = 0;
    for (const l of this.map.get(type) ?? []) if (!l.passive) n++;
    return n;
  }

  /** Call every listener; return what the non-passive ones returned (a request handler may return a Promise). */
  emit(type, value) {
    const out = [];
    for (const l of [...(this.map.get(type) ?? [])]) {
      const r = l.fn(value);
      if (!l.passive) out.push(r);
    }
    return out;
  }
}

// The layout algorithm on typed arrays: no objects, no imports, no references outside the function. That is on purpose:
//   - it is fast and allocation-light, so it is worth having even without a worker;
//   - `computeLayout.toString()` is the whole program, so a Web Worker can run exactly this code (see layout-worker.ts);
//   - results come back as typed arrays whose buffers are transferred, not copied.
// `layoutGraph` (layout.ts) turns assets and connections into this input and the output back into groups and positions.
// Nodes are indexed 0..n-1 in their model order and connections 0..m-1 in edge-list order.

function computeLayout(input) {
  const {
    n,
    m,
    h,
    type,
    ea,
    eb,
    cfg
  } = input;
  const PAD = cfg.PAD;
  const GAP_CARD = cfg.GAP_CARD;
  const CW = cfg.CW;
  const NODE_W = cfg.NODE_W;
  const GAP_LAYER = cfg.GAP_LAYER;
  const GAP_GROUP = cfg.GAP_GROUP;
  const GAP_COMP = cfg.GAP_COMP;
  const GAP_COMP_X = cfg.GAP_COMP_X;

  // --- adjacency, in connection order (this is also each asset's outgoing order)
  const outStart = new Int32Array(n + 1);
  const inDeg = new Int32Array(n);
  for (let e = 0; e < m; e++) {
    outStart[ea[e] + 1]++;
    inDeg[eb[e]]++;
  }
  for (let i = 0; i < n; i++) outStart[i + 1] += outStart[i];
  const outEdge = new Int32Array(m);
  const fill = outStart.slice(0, n);
  for (let e = 0; e < m; e++) outEdge[fill[ea[e]]++] = e;

  // --- weakly connected components, numbered by their first asset
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = a => {
    let r = a;
    while (parent[r] !== r) {
      parent[r] = parent[parent[r]];
      r = parent[r];
    }
    return r;
  };
  for (let e = 0; e < m; e++) parent[find(eb[e])] = find(ea[e]);
  const rawOf = new Int32Array(n).fill(-1);
  const rootRaw = new Int32Array(n).fill(-1);
  let raw = 0;
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (rootRaw[r] < 0) rootRaw[r] = raw++;
    rawOf[i] = rootRaw[r];
  }
  const rawSize = new Int32Array(raw);
  for (let i = 0; i < n; i++) rawSize[rawOf[i]]++;
  // a component of one asset with no connections is a straggler; the rest are pipelines, in discovery order
  const compId = new Int32Array(raw).fill(-1);
  let pipelines = 0;
  for (let i = 0; i < n; i++) {
    const rc = rawOf[i];
    const lone = rawSize[rc] === 1 && inDeg[i] === 0 && outStart[i + 1] === outStart[i];
    if (!lone && compId[rc] < 0) compId[rc] = pipelines++;
  }
  let loneCount = 0;
  for (let i = 0; i < n; i++) if (compId[rawOf[i]] < 0) loneCount++;
  const compCount = pipelines + (loneCount ? 1 : 0);
  const compOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const c = compId[rawOf[i]];
    compOf[i] = c < 0 ? pipelines : c;
  }
  // members of each component, ascending
  const compStart = new Int32Array(compCount + 1);
  for (let i = 0; i < n; i++) compStart[compOf[i] + 1]++;
  for (let c = 0; c < compCount; c++) compStart[c + 1] += compStart[c];
  const members = new Int32Array(n);
  const cfill = compStart.slice(0, compCount);
  for (let i = 0; i < n; i++) members[cfill[compOf[i]]++] = i;
  const layer = new Int32Array(n);
  const back = new Uint8Array(m);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const groupOf = new Int32Array(n).fill(-1);
  // there are never more groups than assets
  const gLayer = new Int32Array(n);
  const gType = new Int32Array(n);
  const gComp = new Int32Array(n);
  const gx = new Float64Array(n);
  const gy = new Float64Array(n);
  const gw = new Float64Array(n);
  const gh = new Float64Array(n);
  const gRows = new Int32Array(n);
  const gMh = new Float64Array(n);
  const gRh = new Float64Array(n);
  const gCnt = new Int32Array(n);
  const rank = new Int32Array(n); // an asset's index within its group
  let groupCount = 0;
  const cx = new Float64Array(compCount);
  const cy = new Float64Array(compCount);
  const cw = new Float64Array(compCount);
  const ch = new Float64Array(compCount);
  const compKind = new Uint8Array(compCount);
  const state = new Int8Array(n); // 0 unseen, 1 on the DFS stack, 2 done
  const deg = new Int32Array(n);
  const newGroup = (c, lay, ty) => {
    const g = groupCount++;
    gLayer[g] = lay;
    gType[g] = ty;
    gComp[g] = c;
    return g;
  };
  /** A group as a roughly square grid of cards. */
  const sizeGroup = g => {
    const cnt = gCnt[g];
    gRh[g] = gMh[g] + GAP_CARD;
    const rows = Math.max(1, Math.ceil(Math.sqrt(cnt * CW / gRh[g])));
    gRows[g] = rows;
    const cols = Math.ceil(cnt / rows);
    gw[g] = (cols - 1) * CW + NODE_W;
    gh[g] = (Math.min(cnt, rows) - 1) * gRh[g] + gMh[g];
  };
  for (let c = 0; c < compCount; c++) {
    const lo = compStart[c];
    const hi = compStart[c + 1];
    const size = hi - lo;
    if (!size) continue;
    if (c === pipelines && loneCount) {
      // --- the block of assets with no connections: a group per type, side by side
      compKind[c] = 1;
      const byType = new Map();
      const mine = [];
      for (let k = lo; k < hi; k++) {
        const i = members[k];
        let g = byType.get(type[i]);
        if (g === undefined) {
          g = newGroup(c, 0, type[i]);
          byType.set(type[i], g);
          mine.push(g);
        }
        groupOf[i] = g;
        rank[i] = gCnt[g]++;
        if (h[i] > gMh[g]) gMh[g] = h[i];
      }
      for (const g of mine) sizeGroup(g);
      const order = mine.slice().sort((p, q) => gCnt[q] - gCnt[p] || p - q);
      let base = 0;
      for (const g of order) base = Math.max(base, gh[g] / 2 + PAD);
      let xx = 0;
      let top = 0;
      for (const g of order) {
        gx[g] = xx;
        gy[g] = base - gh[g] / 2;
        xx += gw[g] + 2 * PAD + GAP_GROUP;
        top = Math.max(top, gh[g] / 2 + PAD);
      }
      cx[c] = -PAD;
      cy[c] = 0;
      cw[c] = xx - GAP_GROUP;
      ch[c] = top + base;
      continue;
    }

    // --- a pipeline: break cycles (the closing connection becomes a "back" connection)
    const stackNode = new Int32Array(size + 1);
    const stackPos = new Int32Array(size + 1);
    const dfs = r => {
      if (state[r]) return;
      state[r] = 1;
      let sp = 0;
      stackNode[0] = r;
      stackPos[0] = outStart[r];
      while (sp >= 0) {
        const u = stackNode[sp];
        const pos = stackPos[sp];
        if (pos < outStart[u + 1]) {
          stackPos[sp]++;
          const e = outEdge[pos];
          const v = eb[e];
          if (state[v] === 1) back[e] = 1;else if (!state[v]) {
            state[v] = 1;
            sp++;
            stackNode[sp] = v;
            stackPos[sp] = outStart[v];
          }
        } else {
          state[u] = 2;
          sp--;
        }
      }
    };
    for (let k = lo; k < hi; k++) if (inDeg[members[k]] === 0) dfs(members[k]); // sources first
    for (let k = lo; k < hi; k++) dfs(members[k]);

    // --- layers: longest path over the connections that are not back connections
    const queue = [];
    for (let k = lo; k < hi; k++) {
      const u = members[k];
      for (let p = outStart[u]; p < outStart[u + 1]; p++) {
        const e = outEdge[p];
        if (!back[e]) deg[eb[e]]++;
      }
    }
    for (let k = lo; k < hi; k++) if (deg[members[k]] === 0) queue.push(members[k]);
    while (queue.length) {
      const u = queue.pop();
      for (let p = outStart[u]; p < outStart[u + 1]; p++) {
        const e = outEdge[p];
        if (back[e]) continue;
        const v = eb[e];
        if (layer[u] + 1 > layer[v]) layer[v] = layer[u] + 1;
        if (--deg[v] === 0) queue.push(v);
      }
    }

    // --- groups: by (layer, type), in the order first met
    const byKey = new Map();
    const layers = [];
    const mine = [];
    for (let k = lo; k < hi; k++) {
      const i = members[k];
      const key = layer[i] * 4194304 + type[i];
      let g = byKey.get(key);
      if (g === undefined) {
        g = newGroup(c, layer[i], type[i]);
        byKey.set(key, g);
        mine.push(g);
        (layers[layer[i]] ||= []).push(g);
      }
      groupOf[i] = g;
      rank[i] = gCnt[g]++;
      if (h[i] > gMh[g]) gMh[g] = h[i];
    }
    for (const g of mine) sizeGroup(g);
    for (const L of layers) L.sort((p, q) => gCnt[q] - gCnt[p] || p - q); // the largest group of a layer sits on the baseline
    let base = 0;
    let below = 0;
    for (const L of layers) {
      base = Math.max(base, gh[L[0]] / 2 + PAD);
      let b = gh[L[0]] / 2 + PAD;
      for (let j = 1; j < L.length; j++) b += gh[L[j]] + 2 * PAD + GAP_GROUP;
      below = Math.max(below, b);
    }
    const compH = base + below;
    let xx = 0;
    for (const L of layers) {
      let lw = 0;
      for (const g of L) lw = Math.max(lw, gw[g]);
      let yy = base - gh[L[0]] / 2;
      for (const g of L) {
        gx[g] = xx + (lw - gw[g]) / 2;
        gy[g] = yy;
        yy += gh[g] + 2 * PAD + GAP_GROUP;
      }
      xx += lw + 2 * PAD + GAP_LAYER;
    }
    cx[c] = -PAD;
    cy[c] = 0;
    cw[c] = xx - GAP_LAYER;
    ch[c] = compH;
  }

  // --- cards within their groups
  for (let i = 0; i < n; i++) {
    const g = groupOf[i];
    const r = rank[i];
    const rows = gRows[g];
    x[i] = gx[g] + Math.floor(r / rows) * CW;
    y[i] = gy[g] + r % rows * gRh[g];
  }

  // --- pack the blocks into rows: widest area first, each row as wide as the widest block (+25%)
  let widest = 0;
  for (let c = 0; c < compCount; c++) widest = Math.max(widest, cw[c]);
  const rowW = Math.max(widest * 1.25, 1);
  const order = Array.from({
    length: compCount
  }, (_, c) => c).sort((p, q) => cw[q] * ch[q] - cw[p] * ch[p]);
  const dx = new Float64Array(compCount);
  const dy = new Float64Array(compCount);
  let px = 0;
  let py = 0;
  let rowH = 0;
  for (const c of order) {
    if (px > 0 && px + cw[c] > rowW) {
      py += rowH + GAP_COMP;
      px = 0;
      rowH = 0;
    }
    dx[c] = px - cx[c];
    dy[c] = py - cy[c];
    cx[c] = px;
    cy[c] = py;
    px += cw[c] + GAP_COMP_X;
    rowH = Math.max(rowH, ch[c]);
  }
  for (let i = 0; i < n; i++) {
    x[i] += dx[compOf[i]];
    y[i] += dy[compOf[i]];
  }
  for (let g = 0; g < groupCount; g++) {
    gx[g] += dx[gComp[g]];
    gy[g] += dy[gComp[g]];
  }
  return {
    layer,
    back,
    x,
    y,
    groupOf,
    compOf,
    groupCount,
    gLayer: gLayer.slice(0, groupCount),
    gType: gType.slice(0, groupCount),
    gComp: gComp.slice(0, groupCount),
    gx: gx.slice(0, groupCount),
    gy: gy.slice(0, groupCount),
    gw: gw.slice(0, groupCount),
    gh: gh.slice(0, groupCount),
    gRows: gRows.slice(0, groupCount),
    gMh: gMh.slice(0, groupCount),
    gRh: gRh.slice(0, groupCount),
    compCount,
    compKind,
    cx,
    cy,
    cw,
    ch
  };
}

const GAP_CARD = 64; // clear space between cards in a group's grid, both ways, and between the grid and its frame
const PAD = GAP_CARD; // frame padding around a group
const NODE_W = 200;
const CW = NODE_W + GAP_CARD; // grid cell width inside a group
const GAP_LAYER = 420; // frame-to-frame distance between columns
const GAP_GROUP = 80; // frame-to-frame distance between groups stacked in a layer
const GAP_COMP = 1600; // between rows of pipelines (loop lanes live in this gap)
const GAP_COMP_X = 800; // between pipelines side by side
const PORT_Y0 = 52; // the first port's height, and its distance from the card's bottom edge to the last port
const PORT_DY = 20;
const cardHeight = n => 2 * PORT_Y0 + PORT_DY * (Math.max(1, n.ins.length, n.outs.length) - 1);
const portY = (n, k) => n.y + PORT_Y0 + k * PORT_DY;
const LAYOUT_CONFIG = {
  PAD,
  GAP_CARD,
  CW,
  NODE_W,
  GAP_LAYER,
  GAP_GROUP,
  GAP_COMP,
  GAP_COMP_X
};

/** Assets and connections as the typed arrays the layout core works on (and numbers assets 0..n-1 in `ord`). */
function buildLayoutInput(nodes, edges) {
  const n = nodes.length;
  const m = edges.length;
  const h = new Float64Array(n);
  const type = new Int32Array(n);
  const types = new Map();
  nodes.forEach((node, i) => {
    node.ord = i;
    h[i] = node.h;
    let t = types.get(node.type);
    if (t === undefined) types.set(node.type, t = types.size);
    type[i] = t;
  });
  const ea = new Int32Array(m);
  const eb = new Int32Array(m);
  edges.forEach((e, i) => {
    ea[i] = e.a.ord;
    eb[i] = e.b.ord;
  });
  return {
    n,
    m,
    h,
    type,
    ea,
    eb,
    cfg: LAYOUT_CONFIG
  };
}

/** Put a layout result onto the model: layers, positions, back connections, and fresh group and pipeline objects. */
function applyLayout(nodes, edges, out) {
  edges.forEach((e, i) => e.back = out.back[i] === 1);
  const comps = [];
  for (let c = 0; c < out.compCount; c++) {
    comps.push({
      kind: out.compKind[c] === 1 ? 'unconnected' : 'pipeline',
      nodes: [],
      groups: [],
      bbox: {
        x: out.cx[c],
        y: out.cy[c],
        w: out.cw[c],
        h: out.ch[c]
      },
      bbox0: {
        y: out.cy[c],
        h: out.ch[c]
      }
    });
  }
  const groups = [];
  for (let g = 0; g < out.groupCount; g++) {
    const comp = comps[out.gComp[g]];
    const grp = {
      id: g,
      key: '',
      comp,
      layer: out.gLayer[g],
      type: '',
      nodes: [],
      x: out.gx[g],
      y: out.gy[g],
      w: out.gw[g],
      h: out.gh[g],
      rows: out.gRows[g],
      mh: out.gMh[g],
      rh: out.gRh[g]
    };
    groups.push(grp);
    comp.groups.push(grp);
  }
  nodes.forEach((node, i) => {
    const g = groups[out.groupOf[i]];
    if (!g.nodes.length) {
      g.type = node.type;
      g.key = `${g.comp.kind === 'unconnected' ? 'unconnected' : g.layer}|${node.type}`;
    }
    g.nodes.push(node);
    g.comp.nodes.push(node);
    node.g = g;
    node.layer = out.layer[i];
    node.x = out.x[i];
    node.y = out.y[i];
  });
  return {
    groups,
    comps
  };
}

/**
 * Lay the whole graph out: break cycles (the closing connection becomes a "back" connection), layer by longest path, group
 * by (layer, type), place layers left to right with the largest group of each layer on the baseline, and shelf-pack
 * pipelines and the block of unconnected assets. The algorithm is `computeLayout` (layout-core.ts), on typed arrays.
 * Idempotent: it derives everything from the model, so it can run again after the data changes.
 */
function layoutGraph(nodes, edges) {
  return applyLayout(nodes, edges, computeLayout(buildLayoutInput(nodes, edges)));
}

/**
 * Group-to-group pipes, kept up to date as connections come and go. A connection joining two groups that already have a
 * pipe just changes its count; a pipe that appears or disappears and is a loop (above) or a layer-skipper (below)
 * re-runs the lane assignment for its one pipeline. `rebuild` is the from-scratch version (after a relayout).
 * `gedges` is one array that is updated in place, so holding a reference to it is safe.
 */
class GroupRouter {
  gedges = [];
  byKey = new Map();
  key(e) {
    return e.a.g.id + (e.back ? '<' : '>') + e.b.g.id;
  }
  rebuild(edges, comps) {
    this.gedges.length = 0;
    this.byKey.clear();
    for (const e of edges) {
      e.ge = null;
      this.attach(e);
    }
    for (const c of comps) this.lanes(c);
  }

  /** Add connections (both ends must be laid out). */
  add(edges) {
    const touched = new Set();
    for (const e of edges) {
      if (!e.a.g || !e.b.g || e.ge) continue;
      const ge = this.attach(e);
      if (ge && ge.edges.length === 1 && (ge.back || ge.skip)) touched.add(ge.a.comp);
    }
    for (const c of touched) this.lanes(c);
  }

  /** Remove connections. A pipe left with none is dropped. */
  remove(edges) {
    const gone = new Set(edges);
    const hit = new Set();
    for (const e of edges) if (e.ge) hit.add(e.ge);
    const touched = new Set();
    for (const ge of hit) {
      ge.edges = ge.edges.filter(e => !gone.has(e));
      ge.count = ge.edges.length;
      if (ge.edges.length) continue;
      this.byKey.delete(ge.a.id + (ge.back ? '<' : '>') + ge.b.id);
      this.gedges.splice(this.gedges.indexOf(ge), 1);
      if (ge.back || ge.skip) touched.add(ge.a.comp);
    }
    for (const e of edges) e.ge = null;
    for (const c of touched) this.lanes(c);
  }
  attach(e) {
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
        edges: []
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
  lanes(c) {
    const cg = c.groups;
    let top = c.bbox0.y;
    let bot = c.bbox0.y + c.bbox0.h;
    for (const ge of this.gedges) if (ge.a.comp === c) ge.laneY = undefined;
    for (const side of ['back', 'skip']) {
      const list = this.gedges.filter(ge => ge.a.comp === c && ge[side]).map(ge => ({
        ge,
        lo: Math.min(ge.a.layer, ge.b.layer),
        hi: Math.max(ge.a.layer, ge.b.layer)
      })).sort((p, q) => p.hi - p.lo - (q.hi - q.lo));
      const lanes = [];
      for (const it of list) {
        let k = lanes.findIndex(L => L.every(o => o.hi < it.lo || o.lo > it.hi));
        if (k < 0) {
          k = lanes.length;
          lanes.push([]);
        }
        lanes[k].push(it);
        const span = cg.filter(g => g.layer >= it.lo && g.layer <= it.hi);
        it.ge.laneY = side === 'back' ? Math.min(...span.map(g => g.y - PAD)) - 140 - k * 140 : Math.max(...span.map(g => g.y + g.h + PAD)) + 140 + k * 140;
        top = Math.min(top, it.ge.laneY - 60);
        bot = Math.max(bot, it.ge.laneY + 60);
      }
    }
    c.bbox.y = top;
    c.bbox.h = bot - top;
  }
}

// Plain, serialisable descriptions of what is selected. This is what the host's inspector/table renders.

/** One connection of an asset, from its point of view: its own port, and the asset and port at the other end. */

/** How many of an asset's connections a node payload lists (the counts are always exact). */
const LINKS_SHOWN = 20;
const portRef = p => ({
  id: p.id,
  name: p.name
});
const groupSummary = g => ({
  key: g.key,
  type: g.type,
  layer: g.layer,
  count: g.nodes.length
});
function routeOf(a, b, back, skip) {
  return back ? 'loop back' : skip ? `skips ${b.layer - a.layer - 1} layer(s)` : 'forward';
}
const endpoint = (n, port) => ({
  id: n.id,
  name: n.name,
  type: n.type,
  port: portRef(port)
});
function byName$1(list, pick) {
  const m = new Map();
  for (const e of list) m.set(pick(e).name, (m.get(pick(e).name) ?? 0) + 1);
  return [...m].map(([name, count]) => ({
    name,
    count
  })).sort((p, q) => q.count - p.count);
}
function describeNode(n) {
  return {
    kind: 'node',
    id: n.id,
    name: n.name,
    type: n.type,
    layer: n.layer,
    status: n.status,
    group: groupSummary(n.g),
    inCount: n.in.length,
    outCount: n.out.length,
    ingressPorts: n.ins.map(p => ({
      ...portRef(p),
      count: n.in.filter(e => e.tp === p).length
    })),
    egressPorts: n.outs.map(p => ({
      ...portRef(p),
      count: n.out.filter(e => e.fp === p).length
    })),
    incoming: n.in.slice(0, LINKS_SHOWN).map(e => ({
      id: e.id,
      own: portRef(e.tp),
      other: endpoint(e.a, e.fp)
    })),
    outgoing: n.out.slice(0, LINKS_SHOWN).map(e => ({
      id: e.id,
      own: portRef(e.fp),
      other: endpoint(e.b, e.tp)
    }))
  };
}
function describeEdge(e) {
  return {
    kind: 'edge',
    id: e.id,
    from: endpoint(e.a, e.fp),
    to: endpoint(e.b, e.tp),
    route: routeOf(e.a, e.b, e.back, !!e.ge?.skip),
    enabled: e.enabled,
    pending: e.pending,
    deleting: e.deleting,
    fromGroup: groupSummary(e.a.g),
    toGroup: groupSummary(e.b.g)
  };
}
function describeGroupEdge(ge) {
  return {
    kind: 'groupEdge',
    from: groupSummary(ge.a),
    to: groupSummary(ge.b),
    count: ge.edges.length,
    route: routeOf(ge.a, ge.b, ge.back, ge.skip),
    egressPorts: byName$1(ge.edges, e => e.fp),
    ingressPorts: byName$1(ge.edges, e => e.tp),
    enabled: ge.edges.filter(e => e.enabled).length,
    edgeIds: ge.edges.map(e => e.id)
  };
}
function describeGroup(g, gedges) {
  return {
    kind: 'group',
    ...groupSummary(g),
    degraded: g.nodes.filter(n => n.status === 'degraded').length,
    assetIds: g.nodes.map(n => n.id),
    outgoing: gedges.filter(x => x.a === g).map(x => ({
      ...groupSummary(x.b),
      edges: x.edges.length
    })),
    incoming: gedges.filter(x => x.b === g).map(x => ({
      ...groupSummary(x.a),
      edges: x.edges.length
    }))
  };
}

const P = (x, y) => ({
  x,
  y
});

/** A plain port-to-port curve, leaving right and entering left. */
function fwdSegs(x0, y0, x1, y1) {
  const d = Math.max(60, Math.abs(x1 - x0) * 0.5);
  return [[P(x0, y0), P(x0 + d, y0), P(x1 - d, y1), P(x1, y1)]];
}

/**
 * Out of the right port, straight to a lane, along it, straight back to the left port, with big
 * rounded corners. Used for loop-backs (lane above) and layer-skipping edges (lane below).
 */
function loopSegs(x0, y0, x1, y1, ly, stub, R) {
  const sx = x0 + stub;
  const ex = x1 - stub;
  const v = Math.sign(ly - y0) || -1;
  const u = Math.sign(y1 - ly) || 1;
  const w = Math.sign(ex - sx) || -1;
  const K = 0.5523;
  const r = Math.max(2, Math.min(R, stub, Math.abs(ly - y0) / 2, Math.abs(ly - y1) / 2, Math.abs(ex - sx) / 2));
  const line = (a, b) => [a, P(a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3), P(a.x + 2 * (b.x - a.x) / 3, a.y + 2 * (b.y - a.y) / 3), b];
  const corner = (a, din, b, dout) => [a, P(a.x + din[0] * K * r, a.y + din[1] * K * r), P(b.x - dout[0] * K * r, b.y - dout[1] * K * r), b];
  const A = [P(x0, y0), P(sx - r, y0), P(sx, y0 + v * r), P(sx, ly - v * r), P(sx + w * r, ly), P(ex - w * r, ly), P(ex, ly + u * r), P(ex, y1 - u * r), P(ex + r, y1), P(x1, y1)];
  return [line(A[0], A[1]), corner(A[1], [1, 0], A[2], [0, v]), line(A[2], A[3]), corner(A[3], [0, v], A[4], [w, 0]), line(A[4], A[5]), corner(A[5], [w, 0], A[6], [0, u]), line(A[6], A[7]), corner(A[7], [0, u], A[8], [1, 0]), line(A[8], A[9])];
}
function bezierAt(q, t) {
  const m = 1 - t;
  const a = m * m * m;
  const b = 3 * m * m * t;
  const c = 3 * m * t * t;
  const d = t * t * t;
  return P(a * q[0].x + b * q[1].x + c * q[2].x + d * q[3].x, a * q[0].y + b * q[1].y + c * q[2].y + d * q[3].y);
}

/** n+1 points along a chain of cubics. */
function sampleSegs(segs, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n * segs.length;
    const k = Math.min(segs.length - 1, Math.floor(u));
    pts.push(bezierAt(segs[k], u - k));
  }
  return pts;
}

/** Distance from (x, y) to the segment a-b. */
function segDist(x, y, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

/**
 * Distance from (px, py) to the cubic through (x0,y0) (x1,y1) (x2,y2) (x3,y3), or Infinity if it is plainly more than
 * `limit` away. No allocation: this runs for thousands of wires on every pointer move. It samples coarsely first (a wire
 * nowhere near the cursor is rejected after twelve steps) and only refines around the closest part.
 */
function distToCubic(px, py, x0, y0, x1, y1, x2, y2, x3, y3, limit) {
  const N = 12;
  let best = Infinity;
  let bestI = 0;
  let longest = 0;
  let ax = x0;
  let ay = y0;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const m = 1 - t;
    const a = m * m * m;
    const b = 3 * m * m * t;
    const c = 3 * m * t * t;
    const d = t * t * t;
    const bx = a * x0 + b * x1 + c * x2 + d * x3;
    const by = a * y0 + b * y1 + c * y2 + d * y3;
    const dist = pointSegment(px, py, ax, ay, bx, by);
    if (dist < best) {
      best = dist;
      bestI = i;
    }
    const len = Math.hypot(bx - ax, by - ay);
    if (len > longest) longest = len;
    ax = bx;
    ay = by;
  }
  if (best > limit + longest * 0.5) return Infinity; // even allowing for the curve bowing away from its chords
  // refine: twenty steps across the two coarse segments around the closest one
  const t0 = Math.max(0, (bestI - 2) / N);
  const t1 = Math.min(1, bestI / N);
  const M = 20;
  let fine = Infinity;
  ax = x0;
  ay = y0;
  for (let i = 0; i <= M; i++) {
    const t = t0 + (t1 - t0) * i / M;
    const m = 1 - t;
    const a = m * m * m;
    const b = 3 * m * m * t;
    const c = 3 * m * t * t;
    const d = t * t * t;
    const bx = a * x0 + b * x1 + c * x2 + d * x3;
    const by = a * y0 + b * y1 + c * y2 + d * y3;
    if (i > 0) {
      const dist = pointSegment(px, py, ax, ay, bx, by);
      if (dist < fine) fine = dist;
    }
    ax = bx;
    ay = by;
  }
  return fine;
}
function pointSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The curve a connection is drawn along: port to port, or via its lane if it loops back / skips layers. */
function edgeSegs(e) {
  const ay = portY(e.a, e.ai);
  const by = portY(e.b, e.bi);
  const ly = e.ge?.laneY;
  return ly === undefined ? fwdSegs(e.a.x + e.a.w, ay, e.b.x, by) : loopSegs(e.a.x + e.a.w, ay, e.b.x, by, ly, 60, 50);
}

/** The curve of a group-to-group pipe, between the groups' frame handles. */
function groupEdgeSegs(ge) {
  const A = ge.a;
  const B = ge.b;
  const y0 = A.y + A.h / 2;
  const y1 = B.y + B.h / 2;
  const x0 = A.x + A.w + PAD;
  const x1 = B.x - PAD;
  return ge.laneY === undefined ? fwdSegs(x0, y0, x1, y1) : loopSegs(x0, y0, x1, y1, ge.laneY, 190, 100);
}

/** Screen-space width of a pipe carrying n connections (log scale, capped). */
const pipePx = n => Math.min(16, 1.5 + Math.log2(n + 1) * 1.3);

/** Uniform grid over card rectangles: viewport culling and point picking without scanning every asset. */
class SpatialGrid {
  cells = new Map();
  constructor(size = 800) {
    this.size = size;
  }
  key(cx, cy) {
    return cx * 100003 + cy;
  }
  rebuild(nodes) {
    this.cells.clear();
    for (const n of nodes) this.add(n);
  }

  /** Index a card at its current position, in addition to whatever is already indexed (used while cards are moving). */
  add(n) {
    const S = this.size;
    for (let cx = Math.floor(n.x / S); cx <= Math.floor((n.x + n.w) / S); cx++) {
      for (let cy = Math.floor(n.y / S); cy <= Math.floor((n.y + n.h) / S); cy++) {
        const k = this.key(cx, cy);
        let cell = this.cells.get(k);
        if (!cell) this.cells.set(k, cell = []);
        cell.push(n);
      }
    }
  }

  /**
   * The cards in the cells the rectangle touches. Pass `into` to reuse one set from frame to frame instead of
   * allocating a new one every time (it is cleared first).
   */
  query(x0, y0, x1, y1, into) {
    const out = into ?? new Set();
    out.clear();
    const S = this.size;
    for (let cx = Math.floor(x0 / S); cx <= Math.floor(x1 / S); cx++) {
      for (let cy = Math.floor(y0 / S); cy <= Math.floor(y1 / S); cy++) {
        const cell = this.cells.get(this.key(cx, cy));
        if (cell) for (const n of cell) out.add(n);
      }
    }
    return out;
  }

  /** The card under (x, y), if any. */
  pick(x, y) {
    const cell = this.cells.get(this.key(Math.floor(x / this.size), Math.floor(y / this.size)));
    if (cell) for (const n of cell) if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) return n;
    return null;
  }
}

/** Numeric-aware name compare: 2 before 10, A before B. */
const natural = (p, q) => {
  const a = Number(p);
  const b = Number(q);
  return Number.isNaN(a) || Number.isNaN(b) ? p.localeCompare(q) : a - b;
};
const byName = (p, q) => natural(p.name, q.name) || p.id.localeCompare(q.id);

/** Structural equality for plain JSON-like data (what selection payloads are made of). */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

const edgeKey = (aId, fpId, bId, tpId) => `${aId}\0${fpId}\0${bId}\0${tpId}`;

/**
 * The engine's model, keyed by the host's ids. `sync` folds a GraphQL-shaped payload into it by
 * identity: an object that is `===` to last time's costs nothing (Apollo only allocates when
 * something changed), and the model's own objects keep their identity across syncs.
 */
class GraphStore {
  assets = new Map();
  edgesById = new Map();
  nodes = []; // insertion order, kept in step with `assets`
  edgeList = [];
  localByKey = new Map();
  // a copy of last sync's arrays: Apollo hands back new arrays whose unchanged entities sit at the same index
  prevAssets = [];
  prevConns = [];
  localSeq = 0;
  makePort(raw) {
    return {
      id: raw.id,
      name: raw.name
    };
  }
  makeNode(raw) {
    const ins = raw.inputPorts.map(p => this.makePort(p)).sort(byName);
    const outs = raw.outputPorts.map(p => this.makePort(p)).sort(byName);
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
      h: cardHeight({
        ins,
        outs
      }),
      layer: 0,
      g: null,
      og: null,
      ord: 0,
      pulse: undefined,
      gl: 0,
      bt: null,
      bside: -1,
      bpush: 0,
      x0: undefined,
      hiP: [],
      hoP: [],
      hiC: []
    };
  }

  /** Reconcile one side's ports by id. Returns the edges that pointed at a port that no longer exists. */
  reconcilePorts(n, side, raws, r) {
    const list = side === 'in' ? n.ins : n.outs;
    const byId = new Map(list.map(p => [p.id, p]));
    const next = [];
    const seen = new Set();
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
    const orphans = [];
    for (const p of list) {
      if (seen.has(p.id)) continue;
      r.changed = true;
      for (const e of side === 'in' ? n.in : n.out) if ((side === 'in' ? e.tp : e.fp) === p) orphans.push(e);
    }
    next.sort(byName);
    if (side === 'in') n.ins = next;else n.outs = next;
    return orphans;
  }
  reindex(n) {
    for (const e of n.out) e.ai = n.outs.indexOf(e.fp);
    for (const e of n.in) e.bi = n.ins.indexOf(e.tp);
  }
  makeEdge(id, a, fp, b, tp, raw, local) {
    const e = {
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
      ct: undefined
    };
    this.edgesById.set(id, e);
    this.edgeList.push(e);
    a.out.push(e);
    b.in.push(e);
    if (local) this.localByKey.set(edgeKey(a.id, fp.id, b.id, tp.id), e);
    return e;
  }

  /** Remove edges in one pass (one array compaction, not one per edge). */
  removeEdges(list) {
    const gone = new Set(list);
    if (!gone.size) return;
    const touched = new Set();
    for (const e of gone) {
      if (!e.local) this.prevConns = []; // the model no longer matches the last payload: the next sync takes the full path
      this.edgesById.delete(e.id);
      if (e.local) this.localByKey.delete(edgeKey(e.a.id, e.fp.id, e.b.id, e.tp.id));
      touched.add(e.a);
      touched.add(e.b);
    }
    let w = 0;
    for (const e of this.edgeList) if (!gone.has(e)) this.edgeList[w++] = e;
    this.edgeList.length = w;
    for (const n of touched) {
      n.out = n.out.filter(e => !gone.has(e));
      n.in = n.in.filter(e => !gone.has(e));
    }
  }

  /** Add a connection made by a gesture or a bulk command; the host's data replaces it once it echoes it back. */
  addLocalEdge(a, fp, b, tp, opts = {}) {
    if (a === b || a.out.some(e => e.b === b && e.fp === fp && e.tp === tp)) return null;
    const e = this.makeEdge(`local:${++this.localSeq}`, a, fp, b, tp, null, true);
    e.enabled = opts.enabled !== false;
    e.pending = !!opts.pending;
    return e;
  }

  /** The host owns port names; an unseen port id is added to the card. Returns true if the card outgrew its cell. */
  ensurePort(n, side, spec) {
    const want = typeof spec === 'object' ? spec : {
      id: spec,
      name: spec
    };
    const list = side === 'out' ? n.outs : n.ins;
    const found = list.find(p => p.id === want.id);
    if (found) return {
      port: found,
      overflow: false
    };
    const port = this.makePort(want);
    list.push(port);
    list.sort(byName);
    this.reindex(n);
    const h = cardHeight(n);
    const grew = h > n.h;
    n.h = Math.max(n.h, h);
    return {
      port,
      overflow: grew && n.g !== null && h > n.g.mh
    };
  }
  findPort(n, side, id) {
    return (side === 'out' ? n.outs : n.ins).find(p => p.id === id);
  }
  sync(input) {
    const res = {
      assets: {
        added: 0,
        changed: 0,
        removed: 0
      },
      connections: {
        added: 0,
        changed: 0,
        removed: 0,
        promoted: 0,
        renamed: 0,
        dangling: 0
      },
      structural: false,
      routing: false,
      visual: false,
      visited: 0,
      promoted: [],
      settled: [],
      addedEdges: [],
      removedEdges: [],
      changedAssets: []
    };
    const doomed = new Set();

    // ---- assets
    const fastA = this.syncAssetsFast(input.assets, res, doomed);
    const seenA = new Set();
    for (const raw of fastA ? [] : input.assets) {
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
      this.updateAsset(n, raw, res, doomed);
    }
    const goneAssets = fastA ? [] : this.nodes.filter(n => !seenA.has(n.id));
    if (goneAssets.length) {
      for (const n of goneAssets) {
        this.assets.delete(n.id);
        for (const e of n.out) doomed.add(e);
        for (const e of n.in) doomed.add(e);
      }
      const set = new Set(goneAssets);
      this.nodes = this.nodes.filter(n => !set.has(n));
      res.assets.removed = goneAssets.length;
      res.structural = res.visual = true;
    }

    // ---- connections
    const fastE = this.syncConnectionsFast(input.connections, res);
    const seenE = new Set();
    for (const raw of fastE ? [] : input.connections) {
      seenE.add(raw.id);
      const e = this.edgesById.get(raw.id);
      if (e && e.raw === raw) continue;
      res.visited++;
      if (e && e.a.id === raw.from.assetId && e.fp.id === raw.from.portId && e.b.id === raw.to.assetId && e.tp.id === raw.to.portId) {
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
      this.pendingNew.push({
        raw,
        a,
        fp,
        b,
        tp
      });
      res.connections.added++;
    }
    const missing = [];
    if (!fastE) for (const e of this.edgeList) if (!e.local && !seenE.has(e.id)) missing.push(e);
    if (missing.length && this.pendingNew.length) {
      // an optimistic response swaps a temporary id for the real one: the same wire under a new id is a rename
      const byKey = new Map(missing.map(e => [edgeKey(e.a.id, e.fp.id, e.b.id, e.tp.id), e]));
      this.pendingNew = this.pendingNew.filter(p => {
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
        if (old.enabled !== enabled || old.pending !== pending) res.visual = true;
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
      for (const e of doomed) res.removedEdges.push(e);
      res.routing = res.visual = true;
    }
    for (const p of this.pendingNew) {
      // an asset getting its first connection leaves the unconnected block (and may join a pipeline): positions change
      if (!p.a.in.length && !p.a.out.length || !p.b.in.length && !p.b.out.length) res.structural = true;
      res.addedEdges.push(this.makeEdge(p.raw.id, p.a, p.fp, p.b, p.tp, p.raw, false));
    }
    this.pendingNew.length = 0;
    this.prevAssets = input.assets.slice();
    this.prevConns = input.connections.slice();
    return res;
  }
  updateAsset(n, raw, res, doomed) {
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
    const pr = {
      changed: false
    };
    for (const e of this.reconcilePorts(n, 'in', raw.inputPorts, pr)) doomed.add(e);
    for (const e of this.reconcilePorts(n, 'out', raw.outputPorts, pr)) doomed.add(e);
    if (pr.changed) {
      changed = true;
      this.reindex(n);
      const h = cardHeight(n);
      if (n.g && h > n.g.mh) res.structural = true;
      n.h = h;
    }
    if (changed) {
      res.assets.changed++;
      res.changedAssets.push(n);
      res.visual = true;
    }
  }

  /**
   * Steady state: the same entities in the same order, some replaced by changed copies. Compares position by position
   * (no lookups, no sets) and only touches what differs. Returns false, having changed nothing, if membership or order
   * differs, so the full path decides.
   */
  syncAssetsFast(list, res, doomed) {
    const prev = this.prevAssets;
    if (prev.length !== list.length) return false;
    let changed = null;
    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      if (raw === prev[i]) continue;
      if (raw.id !== prev[i].id || !this.assets.has(raw.id)) return false;
      (changed ??= []).push(i);
    }
    if (changed) for (const i of changed) {
      const raw = list[i];
      const n = this.assets.get(raw.id);
      if (n.raw === raw) continue;
      res.visited++;
      this.updateAsset(n, raw, res, doomed);
    }
    return true;
  }

  /** The same, for connections: only a flag change (enabled / pending) in place qualifies; anything else takes the full path. */
  syncConnectionsFast(list, res) {
    const prev = this.prevConns;
    if (prev.length !== list.length) return false;
    let changed = null;
    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      if (raw === prev[i]) continue;
      const e = this.edgesById.get(raw.id);
      if (raw.id !== prev[i].id || !e || e.a.id !== raw.from.assetId || e.fp.id !== raw.from.portId || e.b.id !== raw.to.assetId || e.tp.id !== raw.to.portId) return false;
      (changed ??= []).push(i);
    }
    if (changed) for (const i of changed) {
      const raw = list[i];
      const e = this.edgesById.get(raw.id);
      res.visited++;
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
    }
    return true;
  }
  pendingNew = [];

  /** Positions and groups for the current model. */
  layout() {
    return layoutGraph(this.nodes, this.edgeList);
  }
}

const MIN_SCALE = 0.012;
const MAX_SCALE = 2.2;

/**
 * Camera: world <-> screen, eased zoom that keeps the world point under the cursor fixed, panning,
 * and jump-to-box. Pure maths, no DOM.
 */
class Viewport {
  x = 0;
  y = 0;
  s = 0.04;
  width = 800;
  height = 600;
  targetS = 0.04;
  // the world point (wx, wy) that must stay under the screen point (ax, ay) while the scale eases
  ax = 0;
  ay = 0;
  wx = 0;
  wy = 0;
  dragging = null;
  get targetScale() {
    return this.targetS;
  }
  setSize(width, height) {
    this.width = width;
    this.height = height;
  }
  toWorld(px, py) {
    return {
      x: px / this.s + this.x,
      y: py / this.s + this.y
    };
  }
  toScreen(x, y) {
    return {
      x: (x - this.x) * this.s,
      y: (y - this.y) * this.s
    };
  }

  /** World-space rectangle currently on screen. */
  bounds() {
    const a = this.toWorld(0, 0);
    const b = this.toWorld(this.width, this.height);
    return {
      x0: a.x,
      y0: a.y,
      x1: b.x,
      y1: b.y
    };
  }
  anchor(px, py) {
    const p = this.toWorld(px, py);
    this.ax = px;
    this.ay = py;
    this.wx = p.x;
    this.wy = p.y;
  }

  /** Wheel zoom about a screen point. `delta` is the wheel's deltaY (pinch passes a larger gain). */
  zoomBy(px, py, delta, gain = 0.0018) {
    this.anchor(px, py);
    this.targetS = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.targetS * Math.exp(-delta * gain)));
  }

  /** Zoom to fit a world box, centred. Eases there. */
  focus(box, margin = 400) {
    this.targetS = Math.min(MAX_SCALE, Math.min(this.width / (box.w + margin), this.height / (box.h + margin)));
    this.ax = this.width / 2;
    this.ay = this.height / 2;
    this.wx = box.x + box.w / 2;
    this.wy = box.y + box.h / 2;
  }

  /** Jump (no easing): used for the first frame. */
  jumpTo(box, margin = 400) {
    this.focus(box, margin);
    this.s = this.targetS;
    this.x = this.wx - this.ax / this.s;
    this.y = this.wy - this.ay / this.s;
  }

  /** Centre on a world point at a scale (used by tests and "reveal"). */
  centerOn(wx, wy, scale = this.targetS) {
    this.targetS = scale;
    this.ax = this.width / 2;
    this.ay = this.height / 2;
    this.wx = wx;
    this.wy = wy;
  }
  beginDrag(px, py) {
    this.dragging = {
      x: px,
      y: py,
      vx: this.x,
      vy: this.y
    };
  }
  dragTo(px, py) {
    const d = this.dragging;
    if (!d) return;
    this.x = d.vx - (px - d.x) / this.s;
    this.y = d.vy - (py - d.y) / this.s;
    this.anchor(this.ax, this.ay);
  }
  endDrag() {
    this.dragging = null;
  }
  get isDragging() {
    return this.dragging !== null;
  }

  /** Advance the zoom easing one frame. Returns true while still moving. */
  step() {
    let moving = false;
    if (Math.abs(this.targetS - this.s) > this.targetS * 0.002) {
      this.s += (this.targetS - this.s) * 0.22;
      moving = true;
    } else this.s = this.targetS;
    if (!this.dragging) {
      this.x = this.wx - this.ax / this.s;
      this.y = this.wy - this.ay / this.s;
    }
    return moving;
  }
}

const isThenable = v => !!v && typeof v.then === 'function';
const endsOf = e => ({
  a: e.a.id,
  fp: e.fp.id,
  b: e.b.id,
  tp: e.tp.id
});
const cardinality = (n, m) => n === 1 && m === 1 ? 'one-to-one' : n === 1 ? 'one-to-many' : m === 1 ? 'many-to-one' : 'many-to-many';
const groupSide = g => ({
  type: g.type,
  layer: g.layer,
  count: g.nodes.length,
  assetIds: g.nodes.map(n => n.id)
});

/**
 * Everything except pixels: the model, layout, selection, and the connect / disconnect flows. The host's data is
 * the source of truth; gestures are intents. A new connection is drawn at once but pending, the host is asked
 * (connectRequest), and the wire settles when the host says yes (or the data echoes it) or fades when it says no.
 */
class GraphEngine {
  store = new GraphStore();
  grid = new SpatialGrid();
  viewport = new Viewport();
  anim = createAnimState();
  emitter = new Emitter();
  groups = [];
  comps = [];
  router = new GroupRouter();
  /** The group-to-group pipes. One array, updated in place. */
  get gedges() {
    return this.router.gedges;
  }
  /** Seconds. The renderer sets this at the start of every frame; animations are timed against it. */
  time = 0;
  fullPath = false;
  /** Ring the assets the host's data changes (a live feed's updates become visible). Off here, on in the component. */
  highlightUpdates = false;
  selected = null;
  selEdge = null;
  selGE = null;
  selGroup = null;
  selNodes = new Set();
  selGroups = new Set();
  selEdges = new Set();
  pending = new Set();
  deleting = new Set();

  /** Glide cards and group frames to their new positions after a relayout, instead of jumping. */
  animateLayout = false;
  layoutTweenMs = 280;
  tweenNodes = [];
  tweenData = new Float64Array(0); // per node: fromX, fromY, toX, toY
  tweenGroups = [];
  tweenGData = new Float64Array(0); // per group: from x,y,w,h then to x,y,w,h
  tweenStart = 0;
  undoStack = [];
  laidOut = false;
  stamp = 0;
  on = this.emitter.on.bind(this.emitter);

  /** Tell listeners about something the UI layer did (what they return is for the caller to read, e.g. a veto). */
  announce(type, value) {
    return this.emitter.emit(type, value);
  }
  nextPickStamp() {
    return ++this.stamp;
  }

  /** Bumped whenever the model, the layout or the selection changes: cached hit-test results are stale after it. */
  epoch = 0;
  invalidate() {
    this.epoch++;
    this.emitter.emit('invalidate', undefined);
  }

  // ---------------------------------------------------------------- camera

  /** Zoom to show every pipeline. `jump` skips the easing (first paint). */
  fitAll(jump = false) {
    if (!this.comps.length) return;
    const x0 = Math.min(...this.comps.map(c => c.bbox.x));
    const y0 = Math.min(...this.comps.map(c => c.bbox.y));
    const x1 = Math.max(...this.comps.map(c => c.bbox.x + c.bbox.w));
    const y1 = Math.max(...this.comps.map(c => c.bbox.y + c.bbox.h));
    const box = {
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0
    };
    if (jump) this.viewport.jumpTo(box);else this.viewport.focus(box);
    this.invalidate();
  }

  /** Zoom to one pipeline (by its index in layout order). */
  focusPipeline(index) {
    const c = this.comps[index];
    if (!c) return;
    this.viewport.focus(c.bbox);
    this.invalidate();
  }

  /** A group by its `key` (as selection payloads and `searchGroups` report it), or undefined once it is gone. */
  groupByKey(key) {
    return this.groups.find(g => g.key === key);
  }

  /** Groups whose type contains the text (case-insensitive), as the same summaries selections use. */
  searchGroups(text, limit) {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return this.groups.filter(g => g.type.toLowerCase().includes(q)).slice(0, limit).map(groupSummary);
  }

  /**
   * Assets whose name contains the text (case-insensitive), names that start with it first. `scope` is a group key:
   * only that group's assets are searched. `hits` is the first `limit`; `all` is every match's id, capped at 200,
   * for ringing them on the canvas.
   */
  searchAssets(text, limit, scope) {
    const q = text.trim().toLowerCase();
    const pool = scope ? this.groupByKey(scope)?.nodes ?? [] : this.store.nodes;
    if (!q) return {
      total: 0,
      hits: [],
      all: []
    };
    const starts = [];
    const inside = [];
    for (const n of pool) {
      const at = n.name.toLowerCase().indexOf(q);
      if (at === 0) starts.push(n);else if (at > 0) inside.push(n);
    }
    const all = starts.concat(inside);
    return {
      total: all.length,
      hits: all.slice(0, limit).map(n => ({
        id: n.id,
        name: n.name,
        type: n.type
      })),
      all: all.slice(0, 200).map(n => n.id)
    };
  }

  /** Centre on an asset, zooming in far enough to read its card (`minScale`: how far in, at least). */
  focusAsset(id, minScale = 0.8) {
    const n = this.store.assets.get(id);
    if (!n) return false;
    this.viewport.centerOn(n.x + n.w / 2, n.y + n.h / 2, Math.max(this.viewport.targetScale, minScale));
    this.invalidate();
    return true;
  }

  // ---------------------------------------------------------------- data in

  sync(input) {
    const res = this.store.sync(input);
    for (const [localId, realId] of res.promoted) {
      const real = this.store.edgesById.get(realId);
      if (real && this.anim.flash?.e.id === localId) this.anim.flash.e = real;
    }
    if (!this.laidOut || res.structural) this.relayout('sync');else if (res.routing) this.reroute({
      added: res.addedEdges,
      removed: res.removedEdges
    });
    for (const [localId, realId] of res.promoted) {
      for (const e of this.pending) if (e.id === localId) this.pending.delete(e);
      const real = this.store.edgesById.get(realId);
      if (real) {
        real.ct = this.time;
        this.anim.pulseUntil = Math.max(this.anim.pulseUntil, this.time + 0.5);
      }
    }
    if (this.highlightUpdates && res.changedAssets.length && res.changedAssets.length <= 200) {
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
    if (res.settled.length) this.anim.pulseUntil = Math.max(this.anim.pulseUntil, this.time + 0.5);
    for (const set of [this.pending, this.deleting]) for (const e of set) if (this.store.edgesById.get(e.id) !== e) set.delete(e);
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
  relayout(reason = 'manual') {
    const animate = this.animateLayout && this.laidOut;
    this.stopTween(false);
    let before = [];
    let fromPos = null;
    if (animate) {
      before = this.store.nodes.filter(n => n.g !== null);
      fromPos = new Float64Array(before.length * 2);
      before.forEach((n, i) => {
        fromPos[2 * i] = n.x;
        fromPos[2 * i + 1] = n.y;
        n.og = n.g;
      });
    }
    const oldGeom = animate ? new Map(this.groups.map(g => [g, [g.x, g.y, g.w, g.h]])) : null;
    const r = layoutGraph(this.store.nodes, this.store.edgeList);
    this.groups = r.groups;
    this.comps = r.comps;
    this.router.rebuild(this.store.edgeList, this.comps);
    this.grid.rebuild(this.store.nodes); // at the final positions
    const bumps = [...this.anim.bumping].map(n => [n, n.bt, n.bside, n.bpush]);
    for (const n of this.store.nodes) {
      n.x0 = undefined;
      n.bt = null;
    }
    this.anim.bumping.clear();
    for (const [n, bt, side, push] of bumps) {
      if (!this.store.nodes.includes(n) || bt == null) continue;
      n.x0 = n.x;
      n.bt = bt;
      n.bside = side;
      n.bpush = push;
      this.anim.bumping.add(n);
    }
    if (animate && fromPos && oldGeom) this.startTween(before, fromPos, oldGeom);
    this.laidOut = true;
    this.remapSelection();
    this.emitter.emit('layout', {
      reason
    });
    this.invalidate();
  }

  /** Put every moving card back at its start and queue the glide to its final position. */
  startTween(before, fromPos, oldGeom) {
    // group frames first: they find their old geometry through the members' remembered old group
    const groups = [];
    const gdata = [];
    for (const g of this.groups) {
      let old;
      for (let i = 0; i < g.nodes.length && i < 8 && !old; i++) {
        const og = g.nodes[i].og;
        if (og) old = oldGeom.get(og);
      }
      if (!old) continue;
      if (Math.abs(old[0] - g.x) + Math.abs(old[1] - g.y) + Math.abs(old[2] - g.w) + Math.abs(old[3] - g.h) < 0.5) continue;
      groups.push(g);
      gdata.push(old[0], old[1], old[2], old[3], g.x, g.y, g.w, g.h);
    }
    const nodes = [];
    const data = [];
    before.forEach((n, i) => {
      n.og = null;
      if (this.store.assets.get(n.id) !== n) return; // removed since
      const fx = fromPos[2 * i];
      const fy = fromPos[2 * i + 1];
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
      const n = nodes[i];
      n.x = this.tweenData[4 * i];
      n.y = this.tweenData[4 * i + 1];
      this.grid.add(n);
    }
    groups.forEach((g, i) => {
      g.x = this.tweenGData[8 * i];
      g.y = this.tweenGData[8 * i + 1];
      g.w = this.tweenGData[8 * i + 2];
      g.h = this.tweenGData[8 * i + 3];
    });
  }

  /** Finish (or abandon) a glide: cards stay wherever they are unless `snap` puts them at their destination. */
  stopTween(snap) {
    if (!this.tweenNodes.length && !this.tweenGroups.length) return;
    if (snap) {
      this.tweenNodes.forEach((n, i) => {
        n.x = this.tweenData[4 * i + 2];
        n.y = this.tweenData[4 * i + 3];
      });
      this.tweenGroups.forEach((g, i) => {
        g.x = this.tweenGData[8 * i + 4];
        g.y = this.tweenGData[8 * i + 5];
        g.w = this.tweenGData[8 * i + 6];
        g.h = this.tweenGData[8 * i + 7];
      });
      this.grid.rebuild(this.store.nodes);
    }
    this.tweenNodes = [];
    this.tweenGroups = [];
  }

  /** Connections changed but assets did not move: rebuild group pipes and lanes only. */
  reroute(delta) {
    if (delta) {
      // update the pipes in place: a connection joining two groups that already have a pipe just changes its count
      this.router.remove(delta.removed);
      this.router.add(delta.added);
    } else this.router.rebuild(this.store.edgeList, this.comps);
    this.remapSelection();
    this.invalidate();
  }

  // ---------------------------------------------------------------- selection

  /** Ring and name these assets on the canvas (a search result). Nothing moves or hides; an empty list clears it. */
  setFound(ids) {
    const f = this.anim.found;
    f.clear();
    for (const id of ids) {
      const n = this.store.assets.get(id);
      if (n) f.add(n);
    }
    this.invalidate();
  }
  select(sel) {
    this.anim.found.clear();
    this.selected = sel?.node ?? null;
    this.selEdge = sel?.edge ?? null;
    this.selGE = sel?.ge ?? null;
    this.selGroup = sel?.group ?? null;
    this.computeSel();
    this.emitSelect();
    this.invalidate();
  }
  setFullPath(on) {
    this.fullPath = on;
    this.computeSel();
    this.invalidate();
  }
  payload() {
    if (this.selEdge) return describeEdge(this.selEdge);
    if (this.selGE) return describeGroupEdge(this.selGE);
    if (this.selGroup) return describeGroup(this.selGroup, this.gedges);
    if (this.selected) return describeNode(this.selected);
    return null;
  }

  /** The payload last sent to listeners; an update that would send the same data again is dropped. */
  lastPayload = null;
  emitSelect() {
    const p = this.payload();
    if (deepEqual(p, this.lastPayload)) return; // a tick that did not touch what is selected must not re-render your inspector
    this.lastPayload = p;
    this.emitter.emit('select', p);
  }

  /** Highlight sets for the selected asset: direct neighbours, or the full upstream/downstream path. */
  computeSel() {
    this.selNodes.clear();
    this.selGroups.clear();
    this.selEdges.clear();
    const n = this.selected;
    if (!n) return;
    for (const dir of ['out', 'in']) {
      const seen = new Set([n]);
      const q = [[n, this.fullPath ? Infinity : 1]];
      while (q.length) {
        const [m, left] = q.pop();
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
  remapSelection() {
    const alive = n => this.store.assets.get(n.id) === n;
    if (this.selected && !alive(this.selected)) this.selected = null;
    if (this.selEdge && this.store.edgesById.get(this.selEdge.id) !== this.selEdge) this.selEdge = null;
    const gOf = g => {
      const n = g?.nodes.find(alive);
      return n?.g ?? null;
    };
    const geOf = ge => {
      if (!ge) return null;
      const a = gOf(ge.a);
      const b = gOf(ge.b);
      return this.gedges.find(x => x.a === a && x.b === b && x.back === ge.back) ?? null;
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
  remapDrags(alive, gOf) {
    const A = this.anim;
    const c = A.conn;
    if (c) {
      const ports = c.dir > 0 ? c.from.outs : c.from.ins;
      if (!alive(c.from) || !ports[c.idx]) A.conn = null; // the asset (or the port it was dragged from) is gone
      else {
        if (c.near && !alive(c.near.node)) c.near = null;
        if (c.target && !alive(c.target.node)) c.target = null;
      }
    }
    for (const n of A.found) if (!alive(n)) A.found.delete(n);
    const d = A.groupDraft;
    if (d) {
      const a = gOf(d.a);
      const b = gOf(d.b);
      if (!a || !b || this.gedges.some(x => x.a === a && x.b === b)) A.groupDraft = null; // a group is gone, or the real link has arrived and takes over
      else {
        d.a = a;
        d.b = b;
      }
    }
    const r = A.retract;
    if (r && !alive(r.from)) A.retract = null;
    const g = A.gconn;
    if (g) {
      const from = gOf(g.from);
      if (!from) A.gconn = null;else {
        g.from = from;
        g.target = g.target ? gOf(g.target) : null;
      }
    }
    if (A.flash && this.store.edgesById.get(A.flash.e.id) !== A.flash.e) A.flash = null;
  }

  // ---------------------------------------------------------------- connect

  /** Zoomed in: the user joined two ports. Draw it now (pending), ask the host to save it. */
  requestConnectPorts(a, ai, b, bi, record = true) {
    const fp = a.outs[ai];
    const tp = b.ins[bi];
    if (!fp || !tp) return null;
    const e = this.store.addLocalEdge(a, fp, b, tp, {
      pending: true
    });
    if (!e) return null;
    this.pending.add(e);
    this.reroute({
      added: [e],
      removed: []
    });
    if (record) this.undoStack.push({
      kind: 'connected',
      ends: [endsOf(e)]
    });
    this.anim.flash = {
      e,
      t0: this.time,
      node: b,
      dir: 1,
      idx: bi
    };
    this.bump(b, -1, 7);
    this.emitter.emit('change', {
      reason: 'connect',
      added: [e.id],
      removed: []
    });
    this.emitSelect();
    this.askConnect([e], {
      source: 'port-drag',
      from: {
        type: a.type,
        layer: a.layer,
        count: 1,
        assetIds: [a.id],
        port: portRef(fp)
      },
      to: {
        type: b.type,
        layer: b.layer,
        count: 1,
        assetIds: [b.id],
        port: portRef(tp)
      },
      cardinality: 'one-to-one',
      existingLinks: 0,
      edgeIds: [e.id]
    });
    return e;
  }

  /** Zoomed out: the user dragged one group onto another. Nothing is drawn; the host decides the pairings. */
  requestGroupConnect(src, dst) {
    const ge = this.gedges.find(x => x.a === src && x.b === dst);
    this.anim.groupDraft = ge ? null : {
      a: src,
      b: dst
    };
    this.invalidate();
    this.emitter.emit('connectRequest', {
      source: 'group-drag',
      from: groupSide(src),
      to: groupSide(dst),
      cardinality: cardinality(src.nodes.length, dst.nodes.length),
      existingLinks: ge ? ge.edges.length : 0
    });
  }

  /** Drop the temporary group link (the user cancelled the connect dialog). */
  cancelGroupConnect() {
    if (!this.anim.groupDraft) return;
    this.anim.groupDraft = null;
    this.invalidate();
  }
  askConnect(edges, req) {
    const hosts = this.emitter.handlers('connectRequest');
    const results = this.emitter.emit('connectRequest', req);
    if (!hosts) {
      for (const e of edges) this.settle(e, true); // nobody to ask (standalone): nothing to wait for
      return;
    }
    const waits = results.filter(isThenable);
    if (waits.length) {
      Promise.all(waits).then(() => edges.forEach(e => this.settle(e, true)), () => edges.forEach(e => this.settle(e, false)));
    } // else the host answers later with confirm() / revert()
  }
  settle(e, ok) {
    if (!this.pending.has(e)) return;
    this.pending.delete(e);
    if (ok) {
      e.pending = false;
      e.ct = this.time;
      this.anim.pulseUntil = Math.max(this.anim.pulseUntil, this.time + 0.5);
      this.emitter.emit('change', {
        reason: 'confirm',
        added: [],
        removed: []
      });
      this.emitSelect();
      this.invalidate();
      return;
    }
    const key = JSON.stringify(endsOf(e));
    this.undoStack = this.undoStack.filter(u => !(u.kind === 'connected' && u.ends.length === 1 && JSON.stringify(u.ends[0]) === key));
    this.drop([e], 'revert');
  }

  /**
   * The host-driven way to add connections in bulk (standalone use, or to show them at once while a mutation runs).
   * Ports are named by the host: an unseen port id is created on its card. One change event, one undo step.
   */
  connectMany(specs, opts = {}) {
    const made = [];
    const skipped = [];
    let overflow = false;
    specs.forEach((sp, i) => {
      const a = this.store.assets.get(sp.from);
      const b = this.store.assets.get(sp.to);
      if (!a || !b || sp.fromPort == null || sp.toPort == null) return void skipped.push(i);
      const f = this.store.ensurePort(a, 'out', sp.fromPort);
      const t = this.store.ensurePort(b, 'in', sp.toPort);
      overflow ||= f.overflow || t.overflow;
      const e = this.store.addLocalEdge(a, f.port, b, t.port, {
        pending: opts.pending,
        enabled: sp.enabled
      });
      if (e) made.push(e);else skipped.push(i);
    });
    if (!made.length) return {
      created: [],
      skipped
    };
    if (opts.pending) for (const e of made) this.pending.add(e);
    if (overflow) this.relayout('ports');else this.reroute({
      added: made,
      removed: []
    });
    this.undoStack.push({
      kind: 'connected',
      ends: made.map(endsOf)
    });
    this.emitter.emit('change', {
      reason: 'add',
      added: made.map(e => e.id),
      removed: []
    });
    this.emitSelect();
    return {
      created: made.map(e => e.id),
      skipped
    };
  }

  // ---------------------------------------------------------------- disconnect

  /**
   * Delete connections. A wire the host never saw is dropped at once. Others fade (pending delete) while the host is
   * asked (disconnectRequest); they go when the host agrees (or its data stops containing them) and spring back if not.
   */
  requestDisconnect(list, source = 'api', record = true) {
    const live = list.filter(e => this.store.edgesById.get(e.id) === e && !e.deleting);
    if (!live.length) return 0;
    for (const e of live.filter(x => this.pending.has(x))) this.settle(e, false); // never saved: cancel
    const ask = live.filter(e => !this.pending.has(e) && this.store.edgesById.get(e.id) === e);
    if (!ask.length) return live.length;
    if (record) this.undoStack.push({
      kind: 'disconnected',
      ends: ask.map(endsOf)
    });
    const hosts = this.emitter.handlers('disconnectRequest');
    const results = this.emitter.emit('disconnectRequest', {
      source,
      edges: ask.map(e => ({
        id: e.id,
        from: {
          assetId: e.a.id,
          portId: e.fp.id
        },
        to: {
          assetId: e.b.id,
          portId: e.tp.id
        }
      }))
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
      Promise.all(waits).then(() => this.finishDelete(ask, true), () => this.finishDelete(ask, false));
    }
    return live.length;
  }
  finishDelete(list, ok) {
    const mine = list.filter(e => this.deleting.has(e));
    for (const e of mine) this.deleting.delete(e);
    if (ok) {
      this.drop(mine.filter(e => this.store.edgesById.get(e.id) === e), 'disconnect');
      return;
    }
    for (const e of mine) {
      e.deleting = false;
      e.ct = this.time;
    }
    this.anim.pulseUntil = Math.max(this.anim.pulseUntil, this.time + 0.5);
    this.undoStack.pop();
    this.emitter.emit('change', {
      reason: 'revert',
      added: [],
      removed: []
    });
    this.emitSelect();
    this.invalidate();
  }

  /** Remove edges from the model now (the host agreed, or there is no host), with the fade for a single wire. */
  drop(list, reason) {
    if (!list.length) return;
    if (list.length === 1) this.anim.ghost = {
      segs: edgeSegs(list[0]),
      type: list[0].a.type,
      t0: this.time
    };
    for (const e of list) {
      this.pending.delete(e);
      this.deleting.delete(e);
    }
    this.store.removeEdges(list);
    this.reroute({
      added: [],
      removed: list
    });
    this.emitter.emit('change', {
      reason,
      added: [],
      removed: list.map(e => e.id)
    });
    this.emitSelect();
  }

  /** The host's answer when a handler returned nothing: it worked (pending connect settles, pending delete completes). */
  confirm(ids) {
    for (const e of this.byIds(ids)) {
      if (this.pending.has(e)) this.settle(e, true);else if (this.deleting.has(e)) this.finishDelete([e], true);
    }
  }

  /** The host's answer when it failed: a pending connect fades away, a pending delete springs back. */
  revert(ids) {
    for (const e of this.byIds(ids)) {
      if (this.pending.has(e)) this.settle(e, false);else if (this.deleting.has(e)) this.finishDelete([e], false);
    }
  }
  byIds(ids) {
    return [].concat(ids).map(id => this.store.edgesById.get(id)).filter(e => !!e);
  }

  // ---------------------------------------------------------------- undo

  /** Does this undo entry still mean something? (Its wires may have been rolled back or removed by the host since.) */
  actionable(u) {
    if (u.kind === 'connected') return u.ends.some(en => !!this.findEdge(en));
    return u.ends.some(en => {
      const a = this.store.assets.get(en.a);
      const b = this.store.assets.get(en.b);
      return !!a && !!b && !this.findEdge(en) && !!this.store.findPort(a, 'out', en.fp) && !!this.store.findPort(b, 'in', en.tp);
    });
  }

  /** Undo the last gesture by asking the host for the inverse (a delete is undone by a connect request and vice versa). */
  undo() {
    let u = this.undoStack.pop();
    while (u && !this.actionable(u)) u = this.undoStack.pop(); // skip entries the host's data has already made moot
    if (!u) return false;
    if (u.kind === 'connected') {
      const edges = u.ends.map(en => this.findEdge(en)).filter(e => !!e);
      this.requestDisconnect(edges, 'undo', false);
      return true;
    }
    const made = [];
    for (const en of u.ends) {
      const a = this.store.assets.get(en.a);
      const b = this.store.assets.get(en.b);
      const fp = a && this.store.findPort(a, 'out', en.fp);
      const tp = b && this.store.findPort(b, 'in', en.tp);
      if (!a || !b || !fp || !tp) continue;
      const e = this.store.addLocalEdge(a, fp, b, tp, {
        pending: true
      });
      if (e) made.push(e);
    }
    if (!made.length) return true;
    for (const e of made) this.pending.add(e);
    this.reroute({
      added: made,
      removed: []
    });
    this.emitter.emit('change', {
      reason: 'connect',
      added: made.map(e => e.id),
      removed: []
    });
    this.emitSelect();
    const as = [...new Set(made.map(e => e.a))];
    const bs = [...new Set(made.map(e => e.b))];
    const side = nodes => ({
      type: nodes[0].type,
      layer: nodes[0].layer,
      count: nodes.length,
      assetIds: nodes.map(n => n.id)
    });
    this.askConnect(made, {
      source: 'undo',
      from: side(as),
      to: side(bs),
      cardinality: cardinality(as.length, bs.length),
      existingLinks: 0,
      edgeIds: made.map(e => e.id),
      pairs: made.map(e => ({
        from: {
          assetId: e.a.id,
          portId: e.fp.id
        },
        to: {
          assetId: e.b.id,
          portId: e.tp.id
        }
      }))
    });
    return true;
  }
  findEdge(en) {
    return this.store.assets.get(en.a)?.out.find(e => e.fp.id === en.fp && e.b.id === en.b && e.tp.id === en.tp);
  }
  get canUndo() {
    return this.undoStack.some(u => this.actionable(u));
  }

  // ---------------------------------------------------------------- animation clock

  bump(n, side, push) {
    if (n.x0 === undefined) n.x0 = n.x;
    n.bt = this.time;
    n.bside = side;
    n.bpush = push;
    this.anim.bumping.add(n);
  }

  /** Advance time-based state (card shoves, glow easing). Returns true while anything still needs frames. */
  /** Are cards currently gliding? (Hit-test results can't be reused while they move.) */
  get isMoving() {
    return this.tweenNodes.length > 0 || this.anim.bumping.size > 0;
  }
  stepAnim() {
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
      const t = Math.min(1, (this.time - this.tweenStart) / (this.layoutTweenMs / 1000));
      const k = 1 - Math.pow(1 - t, 3); // ease out
      const d = this.tweenData;
      for (let i = 0; i < this.tweenNodes.length; i++) {
        const n = this.tweenNodes[i];
        n.x = d[4 * i] + (d[4 * i + 2] - d[4 * i]) * k;
        n.y = d[4 * i + 1] + (d[4 * i + 3] - d[4 * i + 1]) * k;
      }
      const g = this.tweenGData;
      for (let i = 0; i < this.tweenGroups.length; i++) {
        const gr = this.tweenGroups[i];
        gr.x = g[8 * i] + (g[8 * i + 4] - g[8 * i]) * k;
        gr.y = g[8 * i + 1] + (g[8 * i + 5] - g[8 * i + 1]) * k;
        gr.w = g[8 * i + 2] + (g[8 * i + 6] - g[8 * i + 2]) * k;
        gr.h = g[8 * i + 3] + (g[8 * i + 7] - g[8 * i + 3]) * k;
      }
      if (t >= 1) this.stopTween(true);
      busy = true;
    }
    if (A.hover) A.glowing.add(A.hover);
    if (this.selected) A.glowing.add(this.selected);
    for (const n of A.glowing) {
      const tgt = n === A.hover || n === this.selected ? 1 : 0;
      n.gl += (tgt - n.gl) * 0.25;
      if (Math.abs(tgt - n.gl) > 0.01) busy = true;else {
        n.gl = tgt;
        if (!tgt) A.glowing.delete(n);
      }
    }
    return busy || this.selNodes.size > 0 || this.pending.size > 0 || A.pulseUntil > this.time || !!(A.conn || A.gconn || A.retract || A.flash || A.ghost);
  }
}

// Interaction distances are in screen pixels, so they feel the same at every zoom.
const ELEC_PX = 160; // the arc crackles and the port ring shows from here...
const REACH_WORLD = 45; // ...but never further than this in the graph itself: ports in a grid sit about 100 apart, and the arc must be able to switch off between them
const REACH_MIN_PX = 24; // ...yet never less than this on screen, or a zoomed-out handle could not be hit

/** How close (in world units) the cursor must be to a port or group handle for the ring and arc to show and a release to connect. */
const reachAt = scale => Math.max(Math.min(ELEC_PX / scale, REACH_WORLD), REACH_MIN_PX / scale);
const RING_PX = 18; // inside the port ring the wire is snapped
const NEAR_SCALE = 0.5; // ports are grabbable from here up
const GROUP_SCALE = 0.6; // group handles are grabbable below here

const ringR = scale => Math.max(15, RING_PX / scale);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The wire nearest the cursor, within 9px, among wires touching the given (visible) cards. */
function pickEdge(x, y, scale, vis, stamp) {
  const tol = 9 / scale;
  let best = null;
  let bd = tol;
  for (const n of vis) {
    for (const list of [n.out, n.in]) {
      for (const e of list) {
        if (e.pstamp === stamp) continue;
        e.pstamp = stamp;
        const x0 = e.a.x + e.a.w;
        const x1 = e.b.x;
        const y0 = portY(e.a, e.ai);
        const y1 = portY(e.b, e.bi);
        const ly = e.ge?.laneY;
        let lo = Math.min(y0, y1);
        let hi = Math.max(y0, y1);
        if (ly !== undefined) {
          lo = Math.min(lo, ly);
          hi = Math.max(hi, ly);
        }
        if (x < Math.min(x0, x1) - 80 - tol || x > Math.max(x0, x1) + 80 + tol || y < lo - tol || y > hi + tol) continue;
        if (ly === undefined) {
          // a plain port-to-port curve: measure without allocating
          const d = Math.max(60, Math.abs(x1 - x0) * 0.5);
          const dist = distToCubic(x, y, x0, y0, x0 + d, y0, x1 - d, y1, x1, y1, bd);
          if (dist < bd) {
            bd = dist;
            best = e;
          }
          continue;
        }
        const pts = sampleSegs(edgeSegs(e), 32); // loops and skips: rare, an odd shape
        for (let i = 1; i < pts.length; i++) {
          const d = segDist(x, y, pts[i - 1], pts[i]);
          if (d < bd) {
            bd = d;
            best = e;
          }
        }
      }
    }
  }
  return best;
}

/** The group pipe under the cursor; tolerance grows with the pipe's drawn width. */
function pickGroupEdge(x, y, scale, gedges) {
  let best = null;
  let bd = Infinity;
  for (const ge of gedges) {
    const tol = Math.max(10, pipePx(ge.edges.length) / 2 + 4) / scale;
    const pts = sampleSegs(groupEdgeSegs(ge), 40);
    for (let i = 1; i < pts.length; i++) {
      const d = segDist(x, y, pts[i - 1], pts[i]);
      if (d < tol && d < bd) {
        bd = d;
        best = ge;
      }
    }
  }
  return best;
}

/** The smallest group frame containing the point (tiny groups get a 10px minimum hit area). */
function pickGroup(x, y, scale, groups) {
  let best = null;
  let ba = Infinity;
  const mn = 10 / scale;
  for (const g of groups) {
    const w = Math.max(g.w + 2 * PAD, mn);
    const h = Math.max(g.h + 2 * PAD, mn);
    const x0 = g.x + g.w / 2 - w / 2;
    const y0 = g.y + g.h / 2 - h / 2;
    if (x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h && w * h < ba) {
      ba = w * h;
      best = g;
    }
  }
  return best;
}

/** A port dot on a card: egress on the right edge (dir 1), ingress on the left (dir -1). */
function pickPort(x, y, scale, nodes) {
  const r = Math.max(10, 14 / scale);
  for (const n of nodes) {
    for (const dir of [1, -1]) {
      const arr = dir > 0 ? n.outs : n.ins;
      const px = dir > 0 ? n.x + n.w : n.x;
      for (let k = 0; k < arr.length; k++) if (Math.hypot(px - x, portY(n, k) - y) <= r) return {
        node: n,
        dir,
        idx: k
      };
    }
  }
  return null;
}

/** A group's drag handle: egress at the right edge's middle, ingress at the left's. */
function pickGroupHandle(x, y, scale, groups) {
  const r = 14 / scale;
  let best = null;
  let bd = r;
  for (const g of groups) {
    const hy = g.y + g.h / 2;
    for (const [hx, dir] of [[g.x + g.w + PAD, 1], [g.x - PAD, -1]]) {
      const d = Math.hypot(hx - x, hy - y);
      if (d < bd) {
        bd = d;
        best = {
          group: g,
          dir
        };
      }
    }
  }
  return best;
}

/**
 * Pointer and keyboard input for a canvas: pan, wheel zoom, click to select, drag from a port (zoomed in) or a
 * group handle (zoomed out) to connect, Delete to remove the selected wire, Cmd/Ctrl+Z to undo, Esc to cancel.
 * It only talks to the engine (select / requestConnectPorts / requestGroupConnect / requestDisconnect / undo).
 */
class Interaction {
  mouse = {
    x: 0,
    y: 0,
    inside: false
  };
  down = null;
  cleanup = [];
  cursor = '';
  constructor(canvas, engine, renderer) {
    this.canvas = canvas;
    this.engine = engine;
    this.renderer = renderer;
    canvas.tabIndex = 0;
    canvas.style.outline = 'none';
    canvas.style.touchAction = 'none';
    const on = (type, fn, opts) => {
      canvas.addEventListener(type, fn, opts);
      this.cleanup.push(() => canvas.removeEventListener(type, fn, opts));
    };
    on('wheel', this.onWheel, {
      passive: false
    });
    on('pointerdown', this.onDown);
    on('pointermove', this.onMove);
    on('pointerup', this.onUp);
    on('pointercancel', this.onCancel);
    on('pointerleave', () => {
      this.mouse.inside = false;
      this.renderer.invalidate();
    });
    on('keydown', this.onKey);
    renderer.beforeDraw = vis => this.update(vis);
  }
  destroy() {
    for (const f of this.cleanup) f();
    this.cleanup = [];
    this.renderer.beforeDraw = null;
    this.setCursor('');
  }
  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top
    };
  }
  setCursor(c) {
    if (c === this.cursor) return;
    this.cursor = c;
    this.canvas.style.cursor = c;
  }

  // ------------------------------------------------------------------ input

  onWheel = e => {
    e.preventDefault();
    const p = this.local(e);
    this.engine.viewport.zoomBy(p.x, p.y, e.deltaY, e.ctrlKey ? 0.01 : 0.0018);
    this.renderer.invalidate();
  };
  onDown = e => {
    this.canvas.focus({
      preventScroll: true
    });
    const eng = this.engine;
    const vp = eng.viewport;
    const p = this.local(e);
    const w = vp.toWorld(p.x, p.y);
    const s = vp.s;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable (synthetic events, some browsers): the drag still works while the pointer stays over the canvas */
    }
    if (s >= NEAR_SCALE) {
      const r = Math.max(10, 14 / s);
      const hit = pickPort(w.x, w.y, s, eng.grid.query(w.x - r - 1, w.y - r - 1, w.x + r + 1, w.y + r + 1));
      if (hit) {
        eng.anim.retract = null;
        eng.anim.conn = {
          from: hit.node,
          dir: hit.dir,
          idx: hit.idx,
          x: w.x,
          y: w.y,
          near: null,
          target: null,
          elec: 0,
          pull: 0,
          snap: false,
          pt: null
        };
        this.setCursor('crosshair');
        this.renderer.invalidate();
        return;
      }
    }
    if (s < GROUP_SCALE) {
      const h = pickGroupHandle(w.x, w.y, s, eng.groups);
      if (h) {
        eng.anim.gconn = {
          from: h.group,
          dir: h.dir,
          x: w.x,
          y: w.y,
          target: null,
          pull: 0,
          near: null,
          elec: 0,
          snap: false,
          pt: null
        };
        this.setCursor('crosshair');
        this.renderer.invalidate();
        return;
      }
    }
    this.down = {
      x: p.x,
      y: p.y
    };
    vp.beginDrag(p.x, p.y);
    this.setCursor('grabbing');
  };
  onMove = e => {
    const p = this.local(e);
    this.mouse = {
      x: p.x,
      y: p.y,
      inside: true
    };
    const eng = this.engine;
    const vp = eng.viewport;
    const w = vp.toWorld(p.x, p.y);
    const {
      conn,
      gconn
    } = eng.anim;
    if (gconn) {
      gconn.x = w.x;
      gconn.y = w.y;
      this.nearGroup(gconn, vp.s);
    } else if (conn) {
      conn.x = w.x;
      conn.y = w.y;
    } else if (vp.isDragging) vp.dragTo(p.x, p.y);
    this.renderer.invalidate();
  };

  /** The group handle nearest the cursor on the opposite side: the ring and arc show within reach, and a release there connects (the same rule as ports). */
  nearGroup(c, s) {
    const eng = this.engine;
    let best = null;
    const reach = reachAt(s);
    let bd = reach;
    for (const g of eng.groups) {
      // only the handle counts, not the (possibly huge) box behind it: the arc dies once you leave its radius
      if (g === c.from) continue;
      const d = Math.hypot((c.dir > 0 ? g.x - PAD : g.x + g.w + PAD) - c.x, g.y + g.h / 2 - c.y);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    c.near = best;
    c.elec = best ? 1 - bd / reach : 0;
    c.target = best;
    c.pt = best ? {
      x: c.dir > 0 ? best.x - PAD : best.x + best.w + PAD,
      y: best.y + best.h / 2
    } : null;
    c.snap = false; // no lock-on either: the arc keeps crackling until you release
  }
  onUp = e => {
    const eng = this.engine;
    const vp = eng.viewport;
    const A = eng.anim;
    if (A.gconn) {
      const c = A.gconn;
      const rp = this.local(e);
      const rw = vp.toWorld(rp.x, rp.y);
      c.x = rw.x; // resolve the target at the release point, as a port drag does
      c.y = rw.y;
      this.nearGroup(c, vp.s);
      A.gconn = null;
      this.setCursor('');
      if (c.target) {
        const [src, dst] = c.dir > 0 ? [c.from, c.target] : [c.target, c.from];
        eng.requestGroupConnect(src, dst);
      }
      this.renderer.invalidate();
      return;
    }
    if (A.conn) {
      const c = A.conn;
      const rp = this.local(e);
      const rw = vp.toWorld(rp.x, rp.y);
      c.x = rw.x; // a quick flick can release before the next frame: resolve the target at the release point
      c.y = rw.y;
      this.mouse = {
        x: rp.x,
        y: rp.y,
        inside: true
      };
      this.update(this.renderer.lastVisible);
      A.conn = null;
      this.setCursor('');
      const t = c.target;
      const made = t ? c.dir > 0 ? eng.requestConnectPorts(c.from, c.idx, t.node, t.idx) : eng.requestConnectPorts(t.node, t.idx, c.from, c.idx) : null;
      if (!made) A.retract = {
        ...c,
        target: null,
        t0: eng.time
      };
      this.renderer.invalidate();
      return;
    }
    const wasDrag = vp.isDragging;
    vp.endDrag();
    this.setCursor('');
    const p = this.local(e);
    if (wasDrag && this.down && Math.hypot(p.x - this.down.x, p.y - this.down.y) < 4) this.clickAt(vp.toWorld(p.x, p.y));
    this.down = null;
    this.renderer.invalidate();
  };
  onCancel = () => {
    const A = this.engine.anim;
    A.conn = null;
    A.gconn = null;
    this.engine.viewport.endDrag();
    this.down = null;
    this.setCursor('');
    this.renderer.invalidate();
  };
  onKey = e => {
    const eng = this.engine;
    if ((e.key === 'Delete' || e.key === 'Backspace') && eng.selEdge) {
      e.preventDefault();
      eng.requestDisconnect([eng.selEdge], 'edge');
    } else if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      eng.undo();
    } else if (e.key === 'Escape') {
      const A = eng.anim;
      if (A.conn) A.retract = {
        ...A.conn,
        target: null,
        t0: eng.time
      };
      A.conn = null;
      A.gconn = null;
      this.setCursor('');
      eng.select(null);
    }
    this.renderer.invalidate();
  };

  /** What a click selects depends on what the zoom level shows: a card, a wire, a group pipe, or a group. */
  clickAt(w) {
    const eng = this.engine;
    const s = eng.viewport.s;
    const n = s >= 0.1 ? eng.grid.pick(w.x, w.y) : null;
    if (n) return eng.select({
      node: n
    });
    const e = s >= 0.45 ? pickEdge(w.x, w.y, s, this.renderer.lastVisible, eng.nextPickStamp()) : null;
    if (e) return eng.select({
      edge: e
    });
    if (s < GROUP_SCALE) {
      const ge = pickGroupEdge(w.x, w.y, s, eng.gedges);
      if (ge) return eng.select({
        ge
      });
      const g = pickGroup(w.x, w.y, s, eng.groups);
      if (g) return eng.select({
        group: g
      });
    }
    eng.select(null);
  }

  // ------------------------------------------------------------------ per-frame state (called by the renderer before drawing)

  // what the last hover hit-test was done against; if none of it changed, its answer still stands
  pick = {
    mx: NaN,
    my: NaN,
    x: NaN,
    y: NaN,
    s: NaN,
    epoch: -1,
    inside: false,
    busy: false
  };

  /**
   * The wire under the cursor. This is the costliest hit-test (every wire of every visible card), so it is rate-limited by
   * what it costs: after a slow one it waits four times as long before the next, and between runs the last answer stands.
   */
  hoverWire(w, s, vis) {
    const now = performance.now();
    if (now < this.nextWirePick) return this.engine.anim.hoverEdge;
    const e = pickEdge(w.x, w.y, s, vis, this.engine.nextPickStamp());
    this.nextWirePick = now + (performance.now() - now) * 4;
    return e;
  }
  nextWirePick = 0;
  update(vis) {
    const eng = this.engine;
    const A = eng.anim;
    const vp = eng.viewport;
    const s = vp.s;
    const k = this.pick;
    const moving = eng.isMoving;
    const same = !moving && !A.conn && !A.gconn && k.mx === this.mouse.x && k.my === this.mouse.y && k.x === vp.x && k.y === vp.y && k.s === s && k.epoch === eng.epoch && k.inside === this.mouse.inside && !k.busy;
    k.mx = this.mouse.x;
    k.my = this.mouse.y;
    k.x = vp.x;
    k.y = vp.y;
    k.s = s;
    k.epoch = eng.epoch;
    k.inside = this.mouse.inside;
    k.busy = moving;
    if (same) return; // an animation frame, not a pointer move: hover, cursor and highlights are as they were
    const w = vp.toWorld(this.mouse.x, this.mouse.y);
    const idle = !A.conn && !A.gconn && !vp.isDragging && this.mouse.inside;
    A.hover = idle && s >= 0.1 ? eng.grid.pick(w.x, w.y) : null;
    A.hoverEdge = idle && !A.hover && s >= 0.45 ? this.hoverWire(w, s, vis) : null;
    A.hoverGE = idle && s < GROUP_SCALE && !A.hoverEdge ? pickGroupEdge(w.x, w.y, s, eng.gedges) : null;
    if (idle) {
      let port = false;
      if (s >= NEAR_SCALE) {
        const r = Math.max(10, 14 / s);
        port = !!pickPort(w.x, w.y, s, eng.grid.query(w.x - r - 1, w.y - r - 1, w.x + r + 1, w.y + r + 1));
      }
      if (!port && s < GROUP_SCALE) port = !!pickGroupHandle(w.x, w.y, s, eng.groups);
      this.setCursor(port ? 'crosshair' : A.hoverEdge || A.hoverGE ? 'pointer' : '');
    }
    if (A.gconn) {
      const g = A.gconn;
      g.pull += (0 - g.pull) * 0.3; // no magnet: the tip stays under the cursor
    }
    const c = A.conn;
    if (!c) return;
    // the nearest opposite-side port in range: the ring and arc show within reach, and a release there connects
    let best = null;
    const reach = reachAt(s);
    let bd = reach;
    for (const o of vis) {
      if (o === c.from) continue;
      const arr = c.dir > 0 ? o.ins : o.outs;
      const ox = c.dir > 0 ? o.x : o.x + o.w;
      // only a port's own radius counts, not the card around it: the arc dies once you leave it
      for (let k = 0; k < arr.length; k++) {
        const d = Math.hypot(ox - c.x, portY(o, k) - c.y);
        if (d < bd) {
          bd = d;
          best = {
            node: o,
            idx: k
          };
        }
      }
    }
    c.near = best;
    c.elec = best ? 1 - bd / reach : 0;
    c.target = best; // anywhere the arc shows, letting go connects
    if (best) c.pt = {
      x: best.node.x + (c.dir > 0 ? 0 : best.node.w),
      y: portY(best.node, best.idx)
    };
    c.snap = false; // no magnet and no lock-on: the tip stays under the cursor and the arc keeps crackling
    c.pull += (0 - c.pull) * 0.3;
  }
}

/**
 * Apply values at most once per `ms`, always the newest. The first value goes through at once (leading edge); values that
 * arrive inside the window replace each other, and the last one is applied when the window ends (trailing edge). Safe for
 * snapshots (each payload is the whole truth), which is what a data feed sends.
 */
class LatestWins {
  pending = null;
  last = -Infinity;
  timer;
  constructor(apply, ms, now = () => performance.now(), later = setTimeout, cancel = clearTimeout) {
    this.apply = apply;
    this.ms = ms;
    this.now = now;
    this.later = later;
    this.cancel = cancel;
  }
  push(value) {
    const ms = this.ms();
    const t = this.now();
    if (ms <= 0 || t - this.last >= ms) {
      this.drop();
      this.last = t;
      this.apply(value);
      return;
    }
    this.pending = {
      value
    };
    if (this.timer === undefined) this.timer = this.later(() => this.flush(), Math.max(0, ms - (t - this.last)));
  }

  /** Apply the waiting value now, if there is one. */
  flush() {
    const p = this.pending;
    this.drop();
    if (!p) return;
    this.last = this.now();
    this.apply(p.value);
  }

  /** Forget anything waiting (when the canvas goes away). */
  destroy() {
    this.drop();
  }
  drop() {
    this.pending = null;
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
  }
}

/** The default cap on canvas pixel density. A 2x or 3x screen means 4-9x the pixels to fill, which is what hurts a CPU-only client. */
const DEFAULT_MAX_PIXEL_RATIO = 1.5;

/** The pixel ratio to draw at: the device's, never below 1, never above the cap. */
function effectivePixelRatio(device, max = DEFAULT_MAX_PIXEL_RATIO) {
  const d = Number.isFinite(device) && device > 0 ? device : 1;
  const cap = Number.isFinite(max) || max === Infinity ? Math.max(1, max) : DEFAULT_MAX_PIXEL_RATIO;
  return Math.min(Math.max(1, d), cap);
}

// Asset type -> colour. Stable (a hash of the type name), so a type keeps its colour across sessions, with
// overrides for the types you want to pin. No reds: red means degraded. Always '#rrggbb': the renderer appends alpha as two hex digits.
const PALETTE = ['#ffd24a', '#ffa040', '#b05cff', '#2fe6e6', '#ff4fa3', '#6ee7a0', '#5aa9ff', '#f2a65a', '#c3e86d', '#7c8cff', '#d4a5ff', '#4dd0b8'];
const isHex = c => /^#[0-9a-f]{6}$/i.test(c);
class Palette {
  cache = new Map();
  constructor(overrides = {}) {
    this.overrides = overrides;
  }
  color(type) {
    let c = this.cache.get(type);
    if (c) return c;
    const o = this.overrides[type];
    if (o && isHex(o)) c = o;else {
      let h = 2166136261;
      for (let i = 0; i < type.length; i++) h = Math.imul(h ^ type.charCodeAt(i), 16777619);
      c = PALETTE[(h >>> 0) % PALETTE.length];
    }
    this.cache.set(type, c);
    return c;
  }
  setOverrides(o) {
    this.overrides = o;
    this.cache.clear();
  }
}

/** The frame-rate cap: a client with no GPU can ask for 30 fps and halve its drawing work. */
const DEFAULT_MAX_FPS = 60;

/** Is it too soon after the last drawn frame to draw another? (Half a millisecond of slack, so 60 fps never skips.) */
function tooSoon(now, lastDrawn, maxFps) {
  if (!(maxFps > 0) || maxFps >= 60) return false;
  return now - lastDrawn < 1000 / maxFps - 0.5;
}

// The canvas draws its own pixels, so it cannot be styled with CSS selectors. Instead it reads a handful of CSS custom
// properties from its own element (they inherit, so set them on `:root`, on `[data-theme]`, or on a wrapper) and falls
// back to a dark theme. Any CSS colour works, including oklch(): that is what DaisyUI's variables hold.

const DARK = {
  background: '#0b0b0e',
  card: '#17171d',
  cardBorder: '#262630',
  text: '#f1f1f6',
  textMuted: '#6d6d7a',
  textSoft: '#b4b4c2',
  label: '#e6e6ee',
  ok: '#7de08a',
  bad: '#ff4d4d',
  highlight: '#ffffff'
};

/** The CSS custom property that sets each part of the theme. */
const THEME_TOKENS = {
  background: '--cg-bg',
  card: '--cg-card',
  cardBorder: '--cg-card-border',
  text: '--cg-text',
  textMuted: '--cg-text-muted',
  textSoft: '--cg-text-soft',
  label: '--cg-label',
  ok: '--cg-ok',
  bad: '--cg-bad',
  highlight: '--cg-highlight'
};

/**
 * Build a theme from whatever the page defines. `read` returns a token's computed value ('' if unset); `valid` says
 * whether the canvas accepts a colour string. Anything unset or invalid keeps its dark default.
 */
function resolveTheme(read, valid) {
  const theme = {
    ...DARK
  };
  for (const key of Object.keys(THEME_TOKENS)) {
    const v = read(THEME_TOKENS[key]).trim();
    if (v && valid(v)) theme[key] = v;
  }
  return theme;
}

// under half the gap between cards in a grid (GAP_CARD), so two facing stubs never meet
const STUB_LEN = 24;
const FONT = '-apple-system,system-ui,sans-serif';
function strokeSegs(ctx, sg) {
  ctx.moveTo(sg[0][0].x, sg[0][0].y);
  for (const q of sg) ctx.bezierCurveTo(q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y);
}

/**
 * Draws the engine's state onto a 2D canvas (no GPU needed). Frames are requested on demand: nothing runs while the
 * picture is still, and frames keep coming only while the camera or an animation is moving. Which layer is drawn
 * depends on zoom: group blocks and fat pipes (far), member tiles (mid), full cards and wires (near).
 */
class Renderer {
  palette;
  visible = new Set();
  /** Called after the camera and animations have advanced, before drawing, with the visible assets. */
  beforeDraw = null;
  lastVisible = this.visible;
  stats = null;
  ctx;
  raf = 0;
  dirty = true;
  dpr = 1;
  stamp = 0;
  wires = 0;
  off;
  theme = DARK;
  maxFps = DEFAULT_MAX_FPS;
  lastDrawn = -Infinity;
  // reused every frame, so drawing allocates as little as possible
  glow = [];
  glowByType = new Map();
  wireBuckets = [new Map(), new Map()];
  buckets = new Map();
  constructor(canvas, engine, opts = {}) {
    this.canvas = canvas;
    this.engine = engine;
    this.opts = opts;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas-graph: 2D canvas is not available');
    this.ctx = ctx;
    this.palette = new Palette(opts.colors);
    this.refreshTheme();
    this.maxFps = opts.maxFps ?? DEFAULT_MAX_FPS;
    this.off = engine.on('invalidate', () => this.invalidate(), {
      passive: true
    });
  }

  /** Size the backing store. `width`/`height` are CSS pixels. */
  resize(width, height, dpr = 1) {
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.engine.viewport.setSize(width, height);
    this.invalidate();
  }
  invalidate() {
    this.dirty = true;
    this.request();
  }

  /**
   * Re-read the theme from CSS (the `--cg-*` custom properties on the canvas element) and redraw. Called once at
   * start, and by the modifier when the page's theme changes (`data-theme` on <html>, or the OS colour scheme).
   */
  refreshTheme() {
    const style = getComputedStyle(this.canvas);
    const probe = '#010203';
    const valid = c => {
      const prev = this.ctx.fillStyle;
      this.ctx.fillStyle = probe; // an invalid colour string is ignored, so the probe survives
      this.ctx.fillStyle = c;
      const ok = this.ctx.fillStyle !== probe;
      this.ctx.fillStyle = prev;
      return ok;
    };
    this.theme = resolveTheme(token => style.getPropertyValue(token), valid);
    this.invalidate();
  }
  request() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }
  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.off();
  }
  c(type) {
    return this.palette.color(type);
  }

  // ------------------------------------------------------------------ frame

  frame = t => {
    this.raf = 0;
    if (tooSoon(t, this.lastDrawn, this.maxFps)) {
      this.request(); // the work is still pending: try again on the next display tick
      return;
    }
    const eng = this.engine;
    eng.time = t / 1000;
    const vp = eng.viewport;
    const moving = vp.step();
    const busy = eng.stepAnim();
    if (!this.dirty && !moving && !busy) return;
    this.dirty = false;
    this.lastDrawn = t;
    this.paint();
    if (moving || busy) this.request();
  };

  /**
   * Advance the camera and animations to `t` (ms) and draw one frame right now, ignoring the frame cap and the
   * display's schedule. For benchmarks and tests; the normal path is `invalidate()`.
   */
  renderOnce(t = performance.now()) {
    const eng = this.engine;
    eng.time = t / 1000;
    eng.viewport.step();
    eng.stepAnim();
    this.dirty = false;
    this.lastDrawn = t;
    return this.paint();
  }
  paint() {
    const eng = this.engine;
    const vp = eng.viewport;
    const t0 = performance.now();
    const ctx = this.ctx;
    const s = vp.s;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.opts.background ?? this.theme.background;
    ctx.fillRect(0, 0, vp.width, vp.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, -vp.x * s * dpr, -vp.y * s * dpr);
    const nearA = smooth(0.4, 0.6, s);
    const midA = smooth(0.07, 0.12, s) * (1 - nearA);
    const b = vp.bounds();
    const vis = s >= 0.07 ? eng.grid.query(b.x0, b.y0, b.x1, b.y1, this.visible) : (this.visible.clear(), this.visible);
    this.lastVisible = vis;
    this.beforeDraw?.(vis);
    this.drawGroups(1 - 0.75 * smooth(0.4, 0.8, s), 1 - smooth(0.35, 0.6, s));
    if (eng.anim.groupDraft) this.drawGroupDraft(1 - smooth(0.35, 0.6, s));
    if (eng.anim.gconn) this.drawGroupDrag();
    this.wires = 0;
    if (midA > 0.01) this.drawMembers(vis, midA);
    if (eng.selNodes.size && nearA < 0.99) this.drawSelectedPath(1 - nearA);
    if (nearA > 0.01) {
      this.drawNear(vis, nearA);
      this.drawTransients();
    }
    if (eng.anim.pulsing.size) this.drawPulses(vis, Math.max(midA, nearA));
    if (eng.anim.found.size) this.drawFound();
    this.stats = {
      mode: nearA > 0.5 ? 'NEAR' : s >= 0.07 ? 'MID' : 'FAR',
      scale: s,
      assetsDrawn: vis.size,
      wiresDrawn: nearA > 0.01 ? this.wires : 0,
      ms: performance.now() - t0,
      assets: eng.store.nodes.length,
      connections: eng.store.edgeList.length,
      groups: eng.groups.length
    };
    this.opts.onFrame?.(this.stats);
    return this.stats;
  }

  // ------------------------------------------------------------------ far: group blocks and fat pipes

  drawGroups(frameA, pipeA) {
    const {
      ctx,
      engine: eng
    } = this;
    const s = eng.viewport.s;
    const b = eng.viewport.bounds();
    const dim = eng.selNodes.size > 0;
    const {
      gconn,
      hoverGE
    } = eng.anim;
    ctx.lineCap = 'round';
    for (const ge of eng.gedges) {
      const A = ge.a;
      const B = ge.b;
      const on = !dim || eng.selGroups.has(A) && eng.selGroups.has(B);
      ctx.globalAlpha = pipeA * (on ? 1 : 0.12);
      const wpx = pipePx(ge.edges.length);
      ctx.lineWidth = Math.min(wpx / s, 0.9 * Math.min(A.h, B.h) + 2 * PAD);
      ctx.strokeStyle = this.c(A.type) + 'aa';
      ctx.beginPath();
      strokeSegs(ctx, groupEdgeSegs(ge));
      ctx.stroke();
      if (ge === eng.selGE || ge === hoverGE) {
        const sel = ge === eng.selGE;
        const pw = ctx.lineWidth;
        ctx.globalAlpha = pipeA * (sel ? 0.4 : 0.25);
        ctx.lineWidth = pw * 1.8 + 5 / s;
        ctx.stroke();
        ctx.globalAlpha = pipeA;
        ctx.strokeStyle = sel ? this.theme.highlight : this.c(A.type);
        ctx.lineWidth = Math.max(2 / s, pw * 0.35);
        ctx.stroke();
      }
      if (ge.edges.length > 1 && wpx > 3.5 && ge.laneY === undefined) {
        ctx.globalAlpha = pipeA;
        ctx.fillStyle = this.theme.label;
        ctx.font = `600 ${13 / s}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(`×${ge.edges.length}`, (A.x + A.w + PAD + B.x - PAD) / 2, (A.y + A.h / 2 + B.y + B.h / 2) / 2 - wpx / s);
      }
    }
    ctx.textAlign = 'left';
    for (const g of eng.groups) {
      let x = g.x - PAD;
      let y = g.y - PAD;
      let w = g.w + 2 * PAD;
      let h = g.h + 2 * PAD;
      if (x > b.x1 || y > b.y1 || x + w < b.x0 || y + h < b.y0) continue;
      const mn = 10 / s;
      if (w < mn) {
        x -= (mn - w) / 2;
        w = mn;
      }
      if (h < mn) {
        y -= (mn - h) / 2;
        h = mn;
      }
      const on = !dim || eng.selGroups.has(g);
      const col = this.c(g.type);
      ctx.globalAlpha = frameA * (on ? 1 : 0.25);
      ctx.fillStyle = col + '1f';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 40);
      ctx.fill();
      ctx.strokeStyle = col + (on && dim ? 'ff' : '88');
      ctx.lineWidth = 2 / s;
      ctx.stroke();
      if (g === eng.selGroup || eng.selGE && (g === eng.selGE.a || g === eng.selGE.b)) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 4 / s;
        ctx.stroke();
        ctx.globalAlpha = frameA * 0.3;
        ctx.lineWidth = 12 / s;
        ctx.stroke();
      }
      const fs = Math.max(18, 13 / s);
      ctx.globalAlpha = frameA * (on ? 1 : 0.25);
      ctx.fillStyle = this.theme.label;
      ctx.font = `600 ${fs}px ${FONT}`;
      ctx.fillText(`${g.type} ×${g.nodes.length}`, x + 10, y - fs * 0.35);
    }
    for (const c of eng.comps) {
      // the block of assets that have no connections gets a heading
      if (c.kind !== 'unconnected') continue;
      if (c.bbox.x > b.x1 || c.bbox.y > b.y1 || c.bbox.x + c.bbox.w < b.x0 || c.bbox.y + c.bbox.h < b.y0) continue;
      const fs = Math.max(18, 13 / s);
      ctx.globalAlpha = frameA * 0.7;
      ctx.fillStyle = this.theme.textMuted;
      ctx.font = `600 ${fs}px ${FONT}`;
      ctx.fillText(`unconnected assets ×${c.nodes.length}`, c.bbox.x + PAD, c.bbox.y - fs * 1.5);
    }
    const ha = frameA * (1 - smooth(0.45, 0.6, s)); // drag handles: egress on the right edge, ingress on the left
    if (ha > 0.02) {
      for (const g of eng.groups) {
        if (g.x - PAD > b.x1 || g.y - PAD > b.y1 || g.x + g.w + PAD < b.x0 || g.y + g.h + PAD < b.y0) continue;
        const r = Math.max(4, 7 / s);
        const hy = g.y + g.h / 2;
        const hot = gconn?.from === g;
        const tgt = gconn?.target === g;
        for (const [hx, dir] of [[g.x + g.w + PAD, 1], [g.x - PAD, -1]]) {
          ctx.globalAlpha = ha * (hot && gconn?.dir === dir || tgt ? 1 : 0.75);
          ctx.fillStyle = this.c(g.type);
          ctx.beginPath();
          ctx.arc(hx, hy, r, 0, 6.3);
          ctx.fill();
          ctx.globalAlpha = ha * 0.5;
          ctx.strokeStyle = this.opts.background ?? this.theme.background;
          ctx.lineWidth = 1.5 / s;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Electricity: a jagged arc bridges the gap from a wire's tip to the handle it is reaching for. */
  drawArc(ex, ey, tx, ty, elec, col, lw) {
    const {
      ctx,
      engine: eng
    } = this;
    const s = eng.viewport.s;
    const dx = tx - ex;
    const dy = ty - ey;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const segs = Math.max(6, Math.min(40, Math.round(len * s / 5)));
    const amp = (3 + 6 * elec) / s;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    for (let i = 1; i < segs; i++) {
      const u = i / segs;
      const o = (Math.random() * 2 - 1) * amp * Math.sin(Math.PI * u) * 1.4;
      ctx.lineTo(ex + dx * u + nx * o, ey + dy * u + ny * o);
    }
    ctx.lineTo(tx, ty);
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = col;
    ctx.lineWidth = lw * 4;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = lw * 1.1;
    ctx.stroke();
  }

  /** The dotted pipe left behind by a group drag while its connect dialog is open. */
  drawGroupDraft(alpha) {
    const {
      ctx,
      engine: eng
    } = this;
    const {
      a,
      b
    } = eng.anim.groupDraft;
    const s = eng.viewport.s;
    ctx.lineCap = 'round';
    const lw = pipePx(a.nodes.length) / s;
    ctx.setLineDash([0.01, lw * 1.8]); // round dots: disabled wires are long dashes
    ctx.globalAlpha = alpha * 0.9;
    ctx.strokeStyle = this.c(a.type);
    ctx.lineWidth = lw;
    ctx.beginPath();
    strokeSegs(ctx, groupEdgeSegs({
      a,
      b,
      laneY: undefined}));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** The fat pipe following the cursor from a group handle; locks onto the target group's facing handle. */
  drawGroupDrag() {
    const {
      ctx,
      engine: eng
    } = this;
    const c = eng.anim.gconn;
    const s = eng.viewport.s;
    const g = c.from;
    const col = this.c(g.type);
    const hx = c.dir > 0 ? g.x + g.w + PAD : g.x - PAD;
    const hy = g.y + g.h / 2;
    let ex = c.x;
    let ey = c.y;
    ctx.lineWidth = 2 / s;
    ctx.strokeStyle = col;
    for (const o of eng.groups) {
      if (o === g) continue;
      const hot = c.near === o;
      ctx.globalAlpha = hot ? 1 : 0.3 + 0.25 * Math.sin(eng.time * 6);
      ctx.beginPath();
      ctx.arc(c.dir > 0 ? o.x - PAD : o.x + o.w + PAD, o.y + o.h / 2, hot ? ringR(s) + 2 / s * Math.sin(eng.time * 10) : Math.max(11, 13 / s), 0, 6.3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (c.pull > 0.003 && c.pt) {
      ex += (c.pt.x - ex) * c.pull;
      ey += (c.pt.y - ey) * c.pull;
    }
    if (c.target) {
      const t = c.target;
      const tx = c.dir > 0 ? t.x - PAD : t.x + t.w + PAD;
      const ty = t.y + t.h / 2;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3 / s;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.roundRect(t.x - PAD, t.y - PAD, t.w + 2 * PAD, t.h + 2 * PAD, 40);
      ctx.stroke();
      ctx.lineWidth = 2 / s;
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(eng.time * 8);
      ctx.beginPath();
      ctx.arc(tx, ty, 13 / s, 0, 6.3);
      ctx.stroke();
    }
    const lw = pipePx(g.nodes.length) / s;
    const lock = !!c.target;
    ctx.lineCap = 'round';
    ctx.beginPath();
    this.curve(c.dir > 0 ? hx : ex, c.dir > 0 ? hy : ey, c.dir > 0 ? ex : hx, c.dir > 0 ? ey : hy);
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = lock ? col : this.theme.highlight;
    ctx.lineWidth = lw * 1.9;
    ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = lw;
    ctx.setLineDash(lock ? [] : [14 / s, 10 / s]);
    ctx.lineDashOffset = -eng.time * 60 / s;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = lock ? col : this.theme.highlight;
    ctx.beginPath();
    ctx.arc(ex, ey, 7 / s, 0, 6.3);
    ctx.fill();
    if (c.near && c.pt && !c.snap) this.drawArc(ex, ey, c.pt.x, c.pt.y, c.elec, col, lw);
    ctx.globalAlpha = 1;
  }

  /** A connection's path, without allocating in the common case (a plain port-to-port curve). */
  strokeEdge(e) {
    if (e.ge?.laneY === undefined) {
      const x0 = e.a.x + e.a.w;
      const y0 = portY(e.a, e.ai);
      const x1 = e.b.x;
      const y1 = portY(e.b, e.bi);
      this.curve(x0, y0, x1, y1);
    } else strokeSegs(this.ctx, edgeSegs(e)); // loops and skips: rare, and a more complex shape
  }
  curve(x0, y0, x1, y1) {
    const d = Math.max(60, Math.abs(x1 - x0) * 0.5);
    this.ctx.moveTo(x0, y0);
    this.ctx.bezierCurveTo(x0 + d, y0, x1 - d, y1, x1, y1);
  }

  /** A ring that opens out and fades around each asset the host's data just changed. Visible at mid and near zoom. */
  drawPulses(vis, alpha) {
    const {
      ctx,
      engine: eng
    } = this;
    const s = eng.viewport.s;
    ctx.strokeStyle = this.theme.highlight;
    for (const n of eng.anim.pulsing) {
      if (!vis.has(n) || n.pulse === undefined) continue;
      const k = 1 - (eng.time - n.pulse) / 0.9;
      if (k <= 0) continue;
      const grow = (1 - k) * 16 + 3;
      ctx.globalAlpha = alpha * k * 0.9;
      ctx.lineWidth = Math.max(2 / s, 3);
      ctx.beginPath();
      ctx.roundRect(n.x - grow, n.y - grow, n.w + 2 * grow, n.h + 2 * grow, 14 + grow);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Search hits: a steady ring (bigger when zoomed out so it stays visible) and, for a handful, the name. */
  drawFound() {
    const {
      ctx,
      engine: eng
    } = this;
    const s = eng.viewport.s;
    const b = eng.viewport.bounds();
    const named = eng.anim.found.size <= 40;
    const pulse = 0.75 + 0.25 * Math.sin(eng.time * 5);
    const grow = 5 / s;
    ctx.strokeStyle = this.theme.highlight;
    ctx.fillStyle = this.theme.highlight;
    ctx.lineWidth = Math.max(2.5 / s, 3);
    ctx.font = `600 ${13 / s}px ${FONT}`;
    ctx.textAlign = 'center';
    for (const n of eng.anim.found) {
      if (n.x > b.x1 || n.y > b.y1 || n.x + n.w < b.x0 || n.y + n.h < b.y0) continue;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.roundRect(n.x - grow, n.y - grow, n.w + 2 * grow, n.h + 2 * grow, 14 + grow);
      ctx.stroke();
      if (named) {
        ctx.globalAlpha = 1;
        ctx.fillText(n.name, n.x + n.w / 2, n.y - grow - 6 / s);
      }
    }
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ mid: member tiles

  drawMembers(vis, alpha) {
    if (vis.size > 6000) return;
    const {
      ctx,
      engine: eng
    } = this;
    const dim = eng.selNodes.size > 0;
    const buckets = this.buckets;
    for (const bk of buckets.values()) {
      bk.on.length = 0;
      bk.off.length = 0;
    }
    for (const n of vis) {
      const key = n.status === 'degraded' ? '\0degraded' : n.type; // no string building per asset
      let bk = buckets.get(key);
      if (!bk) buckets.set(key, bk = {
        on: [],
        off: []
      });
      (!dim || eng.selNodes.has(n) ? bk.on : bk.off).push(n);
    }
    for (const [key, bk] of buckets) {
      const color = key === '\0degraded' ? this.theme.bad : this.c(key);
      for (const [list, a] of [[bk.on, alpha], [bk.off, alpha * 0.2]]) {
        if (!list.length) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = color;
        ctx.beginPath();
        for (const n of list) ctx.rect(n.x, n.y, n.w, n.h);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** The selected path as individual wires (zoomed out), batched into one path and culled to the viewport. */
  drawSelectedPath(alpha) {
    const {
      ctx,
      engine: eng
    } = this;
    const s = eng.viewport.s;
    const b = eng.viewport.bounds();
    let n = 0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const pass of [0, 1]) {
      ctx.beginPath();
      for (const e of eng.selEdges) {
        const A = e.a;
        const B = e.b;
        if (Math.max(A.x + A.w, B.x + B.w) < b.x0 || Math.min(A.x, B.x) > b.x1) continue;
        if (e.ge?.laneY === undefined && (Math.max(A.y, B.y) < b.y0 || Math.min(A.y, B.y) > b.y1)) continue;
        if (pass === 0 && ++n > 4000) break;
        this.strokeEdge(e);
      }
      ctx.globalAlpha = alpha * (pass ? 0.95 : 0.25);
      ctx.strokeStyle = this.theme.highlight;
      ctx.lineWidth = (pass ? 1.6 : 6) / s;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ near: cards, ports and wires

  drawNear(vis, alpha) {
    const {
      ctx,
      engine: eng
    } = this;
    const s = eng.viewport.s;
    const time = eng.time;
    const dim = eng.selNodes.size > 0;
    const lw = 2.4 / Math.min(1, s);
    const stamp = ++this.stamp;
    let drawn = 0;
    ctx.lineCap = 'round';
    for (const n of vis) {
      n.hiP.length = n.ins.length;
      n.hiP.fill(0);
      n.hiC.length = n.ins.length;
      n.hiC.fill('');
      n.hoP.length = n.outs.length;
      n.hoP.fill(0);
    }
    const glowEdges = this.glow;
    glowEdges.length = 0;
    for (const n of vis) {
      for (let pass = 0; pass < 2; pass++) {
        for (const e of pass ? n.in : n.out) {
          if (e.stamp === stamp) continue;
          e.stamp = stamp;
          const A = e.a;
          const B = e.b;
          const va = vis.has(A);
          const vb = vis.has(B);
          const picked = eng.selEdges.has(e);
          if (!(va && vb) && !picked) {
            if (va) A.hoP[e.ai] = (A.hoP[e.ai] ?? 0) + 1; // off-screen: one stub per port, with a count
            else {
              B.hiP[e.bi] = (B.hiP[e.bi] ?? 0) + 1;
              B.hiC[e.bi] = this.c(A.type);
            }
            continue;
          }
          if (!picked && drawn++ > 1500) continue;
          const on = !dim || picked;
          if (e.deleting || e.pending || !e.enabled || e.ct !== undefined) {
            // the unusual ones carry their own look: draw them one at a time
            const fade = e.deleting ? 0.35 + 0.1 * Math.sin(time * 4) : e.pending ? 0.6 + 0.22 * Math.sin(time * 5) : 1;
            ctx.globalAlpha = alpha * (on ? 1 : 0.08) * fade;
            ctx.strokeStyle = e.deleting ? this.theme.bad : this.c(A.type);
            ctx.lineWidth = lw;
            ctx.setLineDash(e.enabled ? [] : [14, 10]);
            ctx.beginPath();
            this.strokeEdge(e);
            ctx.stroke();
            ctx.setLineDash([]);
            if (e.ct !== undefined) {
              const k = (time - e.ct) / 0.5;
              if (k >= 1) e.ct = undefined;else {
                ctx.globalAlpha = alpha * 0.4 * (1 - k);
                ctx.lineWidth = lw * 5;
                ctx.stroke();
              }
            }
          } else {
            // the ordinary ones are collected by colour and stroked together: one path, one stroke call
            let bucket = this.wireBuckets[on ? 0 : 1].get(A.type);
            if (!bucket) this.wireBuckets[on ? 0 : 1].set(A.type, bucket = []);
            bucket.push(e);
          }
          if (dim && on && glowEdges.length < 500) glowEdges.push(e);
        }
      }
    }
    this.wires = drawn;
    ctx.setLineDash([]);
    ctx.lineWidth = lw;
    for (const on of [0, 1]) {
      // dimmed ones first, so the highlighted path is above them
      const buckets = this.wireBuckets[1 - on];
      for (const [type, list] of buckets) {
        if (!list.length) continue;
        ctx.globalAlpha = alpha * (on ? 1 : 0.08);
        ctx.strokeStyle = this.c(type);
        ctx.beginPath();
        for (const e of list) this.strokeEdge(e);
        ctx.stroke();
        list.length = 0;
      }
    }
    if (glowEdges.length) {
      // the selected path: a wide glow (one stroke per colour), then flowing dashes (one stroke in all)
      const byType = this.glowByType;
      for (const l of byType.values()) l.length = 0;
      for (const e of glowEdges) {
        let l = byType.get(e.a.type);
        if (!l) byType.set(e.a.type, l = []);
        l.push(e);
      }
      ctx.globalAlpha = alpha * 0.18;
      ctx.lineWidth = lw * 4;
      for (const [type, list] of byType) {
        if (!list.length) continue;
        ctx.strokeStyle = this.c(type);
        ctx.beginPath();
        for (const e of list) this.strokeEdge(e);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = this.theme.highlight;
      ctx.lineWidth = lw * 0.5;
      ctx.setLineDash([10, 26]);
      ctx.lineDashOffset = -time * 90;
      ctx.beginPath();
      for (const e of glowEdges) this.strokeEdge(e);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const e of [eng.anim.hoverEdge, eng.selEdge]) {
      // hovered / selected wire sits above the rest
      if (!e) continue;
      const sel = e === eng.selEdge;
      ctx.beginPath();
      this.strokeEdge(e);
      ctx.globalAlpha = alpha * (sel ? 0.4 : 0.22);
      ctx.strokeStyle = this.c(e.a.type);
      ctx.lineWidth = lw * (sel ? 7 : 5);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = sel ? this.theme.highlight : this.c(e.a.type);
      ctx.lineWidth = lw * (sel ? 1.8 : 1.5);
      ctx.stroke();
    }
    this.drawStubs(vis, alpha);
    for (const n of vis) this.drawCard(n, alpha, dim, s, time);
    if (eng.selEdge) {
      // ring both ends of the selected wire
      const e = eng.selEdge;
      ctx.strokeStyle = this.c(e.a.type);
      ctx.lineWidth = 2.5 / Math.min(1, s);
      ctx.globalAlpha = alpha;
      for (const [x, y] of [[e.a.x + e.a.w, portY(e.a, e.ai)], [e.b.x, portY(e.b, e.bi)]]) {
        ctx.beginPath();
        ctx.arc(x, y, 12 / Math.min(1, s), 0, 6.3);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Off-screen connections: one stub per port with a count, not N overlapping wires. Drawn before every card, like the
   * wires, so a stub never lands on top of one neighbour and under another; it fades out so it reads as "continues".
   */
  drawStubs(vis, alpha) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    for (const n of vis) {
      for (let k = 0; k < n.ins.length; k++) this.stub(n.x, portY(n, k), -1, n.hiP[k] ?? 0);
      for (let k = 0; k < n.outs.length; k++) this.stub(n.x + n.w, portY(n, k), 1, n.hoP[k] ?? 0);
    }
    ctx.globalAlpha = 1;
  }
  stub(x, y, dir, hidden) {
    if (!hidden) return;
    const ctx = this.ctx;
    const w = Math.min(14, 2 + Math.log2(hidden + 1) * 1.2);
    const c = 3 + w / 2;
    // both ends point the way the data flows (out of an output, into an input), so two facing stubs read as a flow
    // and not as a collision; neutral, not the wire's colour, so they never read as a link to the card there
    const tip = dir > 0 ? x + STUB_LEN : x - 8;
    ctx.strokeStyle = this.theme.textMuted;
    ctx.lineWidth = Math.max(2, w * 0.6);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x + dir * STUB_LEN, y);
    ctx.lineTo(x, y);
    ctx.moveTo(tip - c, y - c);
    ctx.lineTo(tip, y);
    ctx.lineTo(tip - c, y + c);
    ctx.stroke();
  }
  drawCard(n, alpha, dim, s, time) {
    const {
      ctx,
      engine: eng
    } = this;
    const col = this.c(n.type);
    ctx.globalAlpha = alpha * (!dim || eng.selNodes.has(n) ? 1 : 0.3);
    const ca = ctx.globalAlpha;
    const pg = n.bt != null ? Math.max(0, 1 - (time - n.bt) / 1.3) : 0;
    const gg = Math.max(n.gl, pg);
    if (gg > 0.02) {
      ctx.shadowColor = col;
      ctx.shadowBlur = 50 * gg * Math.min(1, s * 2);
    }
    ctx.fillStyle = this.theme.card;
    ctx.beginPath();
    ctx.roundRect(n.x, n.y, n.w, n.h, 14);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = gg > 0.02 ? col : this.theme.cardBorder;
    ctx.lineWidth = 1.5 + 1.5 * gg;
    ctx.stroke();
    if (pg > 0.02 && n.bt !== null) {
      // light washes in from the connected side, with a bright bar running down that edge
      const sx = n.bside < 0 ? n.x : n.x + n.w;
      const gr = ctx.createLinearGradient(sx, 0, sx - n.bside * 100, 0);
      gr.addColorStop(0, col);
      gr.addColorStop(1, col + '00');
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(n.x, n.y, n.w, n.h, 14);
      ctx.clip();
      ctx.globalAlpha = ca * pg * 0.55;
      ctx.fillStyle = gr;
      ctx.fillRect(n.x, n.y, n.w, n.h);
      ctx.globalAlpha = ca * Math.min(1, pg * 1.5);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      const run = Math.min(1, (time - n.bt) / 0.55);
      const cy = n.y + 14 + (n.h - 28) * run * (2 - run);
      const half = Math.min(34, n.h * 0.3);
      ctx.beginPath();
      ctx.moveTo(sx - n.bside * 2, Math.max(n.y + 8, cy - half));
      ctx.lineTo(sx - n.bside * 2, Math.min(n.y + n.h - 8, cy + half));
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(n.x + 20, n.y + 26, 5, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = this.theme.text;
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(n.name, n.x + 34, n.y + 31);
    ctx.fillStyle = this.theme.textMuted;
    ctx.font = `12px ${FONT}`;
    ctx.fillText(`${n.type} · in ${n.in.length} out ${n.out.length}`, n.x + 34, n.y + 52);
    const ok = n.status === 'ready';
    ctx.fillStyle = ok ? this.theme.ok : this.theme.bad;
    ctx.beginPath();
    ctx.arc(n.x + 22, n.y + n.h - 14, 3.5, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = this.theme.textSoft;
    ctx.fillText(ok ? 'All inputs ready' : n.status === 'degraded' ? 'Degraded' : n.status, n.x + 34, n.y + n.h - 10);
    n.ins.forEach((p, k) => this.drawPort(n.x, portY(n, k), col, n.gl, -1, n.hiP[k] ?? 0, p.name, time));
    n.outs.forEach((p, k) => this.drawPort(n.x + n.w, portY(n, k), col, n.gl, 1, n.hoP[k] ?? 0, p.name, time));
  }
  drawPort(x, y, color, gl, dir, hidden, label, time) {
    const ctx = this.ctx;
    if (gl > 0.02) {
      ctx.strokeStyle = color + '88';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 10 + 4 * Math.sin(time * 5) * gl, 0, 6.3);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = this.theme.textSoft;
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = dir > 0 ? 'right' : 'left';
    ctx.fillText(label, x - dir * 14, y + 4);
    ctx.textAlign = 'left';
    if (hidden) {
      if (hidden > 1) {
        ctx.fillStyle = this.theme.label;
        ctx.font = `600 12px ${FONT}`;
        ctx.textAlign = dir > 0 ? 'left' : 'right';
        ctx.fillText(`+${hidden}`, x + dir * 6, y - 9);
        ctx.textAlign = 'left';
      }
    }
  }

  // ------------------------------------------------------------------ drag, connect and delete feedback

  drawTransients() {
    const {
      ctx,
      engine: eng
    } = this;
    const A = eng.anim;
    const s = eng.viewport.s;
    const time = eng.time;
    const lw = 2.4 / Math.min(1, s);
    if (A.flash) {
      // a new wire: glow, port springs, a ring at the target
      const f = A.flash;
      const age = time - f.t0;
      const k = 1 - age / 0.9;
      if (k <= 0) A.flash = null;else {
        const e = f.e;
        ctx.lineCap = 'round';
        ctx.beginPath();
        this.strokeEdge(e);
        ctx.globalAlpha = k * 0.35;
        ctx.strokeStyle = this.c(e.a.type);
        ctx.lineWidth = lw * 6;
        ctx.stroke();
        ctx.globalAlpha = k;
        ctx.strokeStyle = this.theme.highlight;
        ctx.lineWidth = lw * 1.4;
        ctx.stroke();
        const spring = 1 + 0.9 * Math.exp(-age * 5) * Math.cos(age * 20);
        for (const [n, x, y] of [[e.a, e.a.x + e.a.w, portY(e.a, e.ai)], [e.b, e.b.x, portY(e.b, e.bi)]]) {
          ctx.globalAlpha = Math.min(1, k * 2);
          ctx.fillStyle = this.c(n.type);
          ctx.beginPath();
          ctx.arc(x, y, 6 * spring, 0, 6.3);
          ctx.fill();
        }
        const t = f.node;
        ctx.globalAlpha = k;
        ctx.strokeStyle = this.c(t.type);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(t.x, portY(t, f.idx), 10 + age * 70, 0, 6.3);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (A.ghost) {
      // a deleted wire thins out and fades
      const k = (time - A.ghost.t0) / 0.35;
      if (k >= 1) A.ghost = null;else {
        ctx.lineCap = 'round';
        ctx.beginPath();
        strokeSegs(ctx, A.ghost.segs);
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = this.c(A.ghost.type);
        ctx.lineWidth = lw * (1 - 0.8 * k);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    const conn = A.conn;
    const c = conn ?? A.retract;
    if (!c) return;
    const n = c.from;
    const col = this.c(n.type);
    const px = n.x + (c.dir > 0 ? n.w : 0);
    const py = portY(n, c.idx);
    let ex = c.x;
    let ey = c.y;
    let fade = 1;
    if (conn) {
      // valid ports pulse; the one in range gets a bigger ring
      ctx.lineWidth = 2 / Math.min(1, s);
      ctx.strokeStyle = col;
      for (const o of this.lastVisible) {
        if (o === n) continue;
        const arr = c.dir > 0 ? o.ins : o.outs;
        const ox = c.dir > 0 ? o.x : o.x + o.w;
        for (let k = 0; k < arr.length; k++) {
          const hot = conn.near?.node === o && conn.near.idx === k;
          ctx.globalAlpha = hot ? 1 : 0.3 + 0.25 * Math.sin(time * 6);
          ctx.beginPath();
          ctx.arc(ox, portY(o, k), hot ? ringR(s) + 2 / s * Math.sin(time * 10) : Math.max(11, 13 / s), 0, 6.3);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      if (conn.pull > 0.003 && conn.pt) {
        ex += (conn.pt.x - ex) * conn.pull;
        ey += (conn.pt.y - ey) * conn.pull;
      }
    } else {
      const k = Math.min(1, (time - (A.retract?.t0 ?? 0)) / 0.22);
      if (k >= 1) {
        A.retract = null;
        return;
      }
      ex = c.x + (px - c.x) * k * k;
      ey = c.y + (py - c.y) * k * k;
      fade = 1 - k;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.curve(c.dir > 0 ? px : ex, c.dir > 0 ? py : ey, c.dir > 0 ? ex : px, c.dir > 0 ? ey : py);
    const wc = conn?.snap ? col : this.theme.highlight;
    ctx.globalAlpha = 0.22 * fade;
    ctx.strokeStyle = wc;
    ctx.lineWidth = lw * 5;
    ctx.stroke();
    ctx.globalAlpha = fade;
    ctx.lineWidth = lw * 1.2;
    ctx.stroke();
    ctx.fillStyle = wc;
    ctx.beginPath();
    ctx.arc(ex, ey, 5, 0, 6.3);
    ctx.fill();
    if (conn?.near && !conn.snap) {
      const t = conn.near;
      this.drawArc(ex, ey, t.node.x + (c.dir > 0 ? 0 : t.node.w), portY(t.node, t.idx), conn.elec, col, lw);
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * What the host holds on to (via `@onReady`). Selection is tracked, so an inspector can read it in a template.
 * Everything else is a command; the canvas never changes your data, it asks (see `connectRequest` / `disconnectRequest`).
 */
class GraphHandle {
  static {
    g(this.prototype, "selection", [tracked], function () {
      return null;
    });
  }
  #selection = (i(this, "selection"), void 0);
  /** What is selected right now, as plain data (or null). */
  static {
    g(this.prototype, "searchScope", [tracked], function () {
      return null;
    });
  }
  #searchScope = (i(this, "searchScope"), void 0);
  /** The group (its `key`) a name search is limited to, or null for all assets. Shared by the search box and the inspector. */
  constructor(engine, onRefreshTheme = () => undefined) {
    this.engine = engine;
    this.onRefreshTheme = onRefreshTheme;
  }

  /** Subscribe to engine events. `passive` listeners (inspectors, dialogs) are not counted as the host's request handler. */
  on(type, fn, opts) {
    return this.engine.on(type, fn, opts);
  }
  get canUndo() {
    return this.engine.canUndo;
  }

  /** An asset as the canvas currently knows it (ports included). */
  asset(id) {
    const n = this.engine.store.assets.get(id);
    return n && {
      id: n.id,
      name: n.name,
      type: n.type,
      status: n.status,
      inputPorts: n.ins,
      outputPorts: n.outs
    };
  }

  /** Is there already a connection from this egress port to that ingress port? */
  connected(fromAssetId, fromPortId, toAssetId, toPortId) {
    const a = this.engine.store.assets.get(fromAssetId);
    return !!a?.out.some(e => e.fp.id === fromPortId && e.b.id === toAssetId && e.tp.id === toPortId);
  }

  /**
   * Show connections at once, in bulk. Ports are named by you; one the canvas has not seen is created on its card.
   * One `change` event, one undo step. When your data later contains them, the canvas swaps in your copies.
   */
  connectMany(specs, opts) {
    return this.engine.connectMany(specs, opts);
  }

  /** Ask to delete connections (the same flow as the Delete key): they fade until your handler answers. */
  disconnect(ids) {
    const edges = ids.map(id => this.engine.store.edgesById.get(id)).filter(e => !!e);
    return this.engine.requestDisconnect(edges, 'api');
  }

  /** Ring and name these assets on the canvas without moving or hiding anything; `[]` clears it. */
  highlightAssets(ids) {
    this.engine.setFound(ids);
  }

  /** Limit name searches to one group (by its `key`), or pass null to search everything. */
  searchInGroup(key) {
    if (this.searchScope === key) return;
    this.searchScope = key;
    this.engine.announce('searchScope', {
      key,
      group: this.scopeGroup ?? null
    });
  }

  /**
   * The user chose this asset in a search box: tell `searchPick` listeners, then (unless one returned `false`) select
   * it and move the camera to it. Returns whether the default happened.
   */
  chooseAsset(hit, zoom = 0.55) {
    if (this.engine.announce('searchPick', hit).includes(false)) return false;
    this.selectAsset(hit.id);
    this.focusAsset(hit.id, zoom);
    return true;
  }

  /** The group a search is limited to, if it still exists. */
  get scopeGroup() {
    const g = this.searchScope ? this.engine.groupByKey(this.searchScope) : undefined;
    return g && {
      key: g.key,
      type: g.type,
      layer: g.layer,
      count: g.nodes.length
    };
  }

  /** Groups whose type contains `text`. */
  searchGroups(text, limit = 3) {
    return this.engine.searchGroups(text, limit);
  }

  /** Remove the temporary link shown after a group drag (call it if you cancel your own connect UI). */
  cancelGroupConnect() {
    this.engine.cancelGroupConnect();
  }

  /** Your answer when a request handler returned nothing: it worked. */
  confirm(ids) {
    this.engine.confirm(ids);
  }

  /** Your answer when it failed: a pending connect fades away, a pending delete springs back. */
  revert(ids) {
    this.engine.revert(ids);
  }
  undo() {
    return this.engine.undo();
  }
  selectAsset(id) {
    const node = this.engine.store.assets.get(id);
    if (node) this.engine.select({
      node
    });
    return !!node;
  }
  selectConnection(id) {
    const edge = this.engine.store.edgesById.get(id);
    if (edge) this.engine.select({
      edge
    });
    return !!edge;
  }
  clearSelection() {
    this.engine.select(null);
  }

  /** Highlight the whole upstream/downstream path of the selected asset, not just its direct connections. */
  setFullPath(on) {
    this.engine.setFullPath(on);
  }

  /** Re-read the `--cg-*` theme tokens. Automatic when `data-theme` on <html> or the OS colour scheme changes; call it if you switch themes some other way. */
  refreshTheme() {
    this.onRefreshTheme();
  }
  fit() {
    this.engine.fitAll();
  }

  /** Centre on an asset. `minScale` is the least zoom to end at (default 0.8: card details are readable from 0.5). */
  focusAsset(id, minScale) {
    return this.engine.focusAsset(id, minScale);
  }

  /**
   * Assets whose name contains `text` (case-insensitive), names that start with it first. Limited to the group in
   * `searchScope` if there is one. `hits` is the first `limit`; `all` is every match's id (up to 200), for `highlightAssets`.
   */
  searchAssets(text, limit = 10) {
    const scope = this.scopeGroup ? this.searchScope : null;
    return this.engine.searchAssets(text, limit, scope);
  }
  focusPipeline(index) {
    this.engine.focusPipeline(index);
  }

  /** Recompute layers and positions (after many connections changed). The camera stays put. */
  relayout() {
    this.engine.relayout('manual');
  }
}

/**
 * Mounts the graph canvas in an element. Reading `@data` here puts it in Ember's tracking frame (the same rule your
 * grid's `recordsSource` follows), so a new payload re-runs `modify` and the canvas syncs by identity.
 */
class GraphCanvasModifier extends Modifier {
  engine;
  renderer;
  handle;
  args = {};
  lastData;
  lastFull;
  lastRatio;
  refit;
  inModify = false;
  bound = new Map();
  modify(element, _positional, named) {
    // read every named arg: that is what makes this modifier re-run when one changes
    this.args = {
      data: named.data,
      colors: named.colors,
      fullPath: named.fullPath,
      maxPixelRatio: named.maxPixelRatio,
      animateLayout: named.animateLayout,
      maxFps: named.maxFps,
      highlightUpdates: named.highlightUpdates,
      syncThrottle: named.syncThrottle,
      onReady: named.onReady,
      onSelect: named.onSelect,
      onChange: named.onChange,
      onSync: named.onSync,
      onLayout: named.onLayout,
      onFrame: named.onFrame,
      onConnectRequest: named.onConnectRequest,
      onDisconnectRequest: named.onDisconnectRequest
    };
    this.inModify = true;
    try {
      if (!this.engine) this.mount(element);
      this.apply();
    } finally {
      this.inModify = false;
    }
  }
  mount(element) {
    const canvas = document.createElement('canvas');
    canvas.className = 'cg-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    element.append(canvas);
    const engine = new GraphEngine();
    const renderer = new Renderer(canvas, engine, {
      colors: this.args.colors,
      onFrame: s => this.args.onFrame?.(s)
    });
    const interaction = new Interaction(canvas, engine, renderer);
    const handle = new GraphHandle(engine, () => renderer.refreshTheme());
    this.engine = engine;
    this.renderer = renderer;
    this.handle = handle;
    const fit = () => {
      const r = element.getBoundingClientRect();
      renderer.resize(Math.max(1, r.width), Math.max(1, r.height), effectivePixelRatio(window.devicePixelRatio, this.args.maxPixelRatio));
    };
    this.refit = fit;
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(element);

    // the canvas reads its colours from CSS custom properties: redraw when the page's theme changes
    const retheme = () => renderer.refreshTheme();
    const mo = new MutationObserver(retheme);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'style']
    });
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', retheme);

    // Always-on listeners keep the handle's tracked selection current; the host's callbacks are bound in apply().
    engine.on('select', p => this.later(() => handle.selection = p), {
      passive: true
    });
    registerDestructor(this, () => {
      ro.disconnect();
      mo.disconnect();
      this.syncer.destroy();
      scheme.removeEventListener('change', retheme);
      interaction.destroy();
      renderer.destroy();
      for (const b of this.bound.values()) b.off();
      this.bound.clear();
      canvas.remove();
    });
    this.later(() => this.args.onReady?.(handle));
  }

  /** Writes to the host's tracked state must not happen during this modifier's own run (backtracking). */
  later(fn) {
    if (this.inModify) queueMicrotask(fn);else fn();
  }
  apply() {
    const engine = this.engine;
    const a = this.args;
    this.renderer.palette.setOverrides(a.colors ?? {});
    this.renderer.invalidate();
    this.bind('select', a.onSelect, true);
    this.bind('change', a.onChange, true);
    this.bind('sync', a.onSync, true);
    this.bind('layout', a.onLayout, true);
    this.bind('connectRequest', a.onConnectRequest, false); // a real host handler: its Promise decides the outcome
    this.bind('disconnectRequest', a.onDisconnectRequest, false);
    engine.animateLayout = a.animateLayout !== false;
    engine.highlightUpdates = a.highlightUpdates !== false;
    this.renderer.maxFps = a.maxFps ?? 60;
    if (a.maxPixelRatio !== this.lastRatio) {
      this.lastRatio = a.maxPixelRatio;
      this.refit?.();
    }
    if (a.fullPath !== undefined && a.fullPath !== this.lastFull) {
      this.lastFull = a.fullPath;
      engine.setFullPath(a.fullPath);
    }
    if (a.data && a.data !== this.lastData) {
      this.lastData = a.data;
      this.syncer.push(a.data);
    }
  }

  /** The newest payload wins; with `@syncThrottle` set, at most one is applied per window. */
  syncer = new LatestWins(data => {
    const engine = this.engine;
    const first = engine.store.nodes.length === 0;
    engine.sync(data);
    if (first) engine.fitAll(true);
  }, () => {
    const t = this.args.syncThrottle;
    if (typeof t === 'number') return t;
    return t === 'auto' && (this.engine?.store.nodes.length ?? 0) > 5000 ? 100 : 0;
  });

  /** (Re)register a host callback only while it exists, so "no handler" really means no handler. */
  bind(type, cb, defer) {
    const have = this.bound.get(type);
    if (!cb) {
      have?.off();
      this.bound.delete(type);
      return;
    }
    if (have) return; // the wrapper below always calls the latest callback
    const off = this.engine.on(type, v => {
      const fn = this.args[callbackName(type)];
      if (!fn) return undefined;
      if (defer) return void this.later(() => fn(v));
      return fn(v);
    }, {
      passive: defer
    });
    this.bound.set(type, {
      off,
      passive: defer
    });
  }
}
function callbackName(type) {
  switch (type) {
    case 'select':
      return 'onSelect';
    case 'change':
      return 'onChange';
    case 'sync':
      return 'onSync';
    case 'layout':
      return 'onLayout';
    case 'connectRequest':
      return 'onConnectRequest';
    case 'disconnectRequest':
      return 'onDisconnectRequest';
    default:
      return 'onChange';
  }
}

export { GraphHandle as G, GraphCanvasModifier as a };
//# sourceMappingURL=graph-canvas-CGtz3aD2.js.map
