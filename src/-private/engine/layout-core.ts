// The layout algorithm on typed arrays: no objects, no imports, no references outside the function. That is on purpose:
//   - it is fast and allocation-light, so it is worth having even without a worker;
//   - `computeLayout.toString()` is the whole program, so a Web Worker can run exactly this code (see layout-worker.ts);
//   - results come back as typed arrays whose buffers are transferred, not copied.
// `layoutGraph` (layout.ts) turns assets and connections into this input and the output back into groups and positions.
// Nodes are indexed 0..n-1 in their model order and connections 0..m-1 in edge-list order.

export interface LayoutConfig {
  PAD: number; // frame padding around a group
  GAP_CARD: number; // clear space between cards in a group's grid (rows)
  CW: number; // grid cell width inside a group
  NODE_W: number;
  GAP_LAYER: number; // frame-to-frame distance between columns
  GAP_GROUP: number; // frame-to-frame distance between groups stacked in a layer
  GAP_COMP: number; // between rows of pipelines
  GAP_COMP_X: number; // between pipelines side by side
}

export interface LayoutInput {
  n: number;
  m: number;
  /** Card heights. */
  h: Float64Array;
  /** Asset type, as a small integer (equal types, equal numbers). */
  type: Int32Array;
  /** Each connection's source and target asset. */
  ea: Int32Array;
  eb: Int32Array;
  cfg: LayoutConfig;
}

export interface LayoutOutput {
  layer: Int32Array;
  /** 1 for the connection that closes a cycle. */
  back: Uint8Array;
  x: Float64Array;
  y: Float64Array;
  /** Which group / pipeline each asset belongs to. */
  groupOf: Int32Array;
  compOf: Int32Array;
  groupCount: number;
  gLayer: Int32Array;
  gType: Int32Array;
  gComp: Int32Array;
  gx: Float64Array;
  gy: Float64Array;
  gw: Float64Array;
  gh: Float64Array;
  gRows: Int32Array;
  gMh: Float64Array;
  gRh: Float64Array;
  compCount: number;
  /** 0: a pipeline, 1: the block of assets with no connections. */
  compKind: Uint8Array;
  cx: Float64Array;
  cy: Float64Array;
  cw: Float64Array;
  ch: Float64Array;
}

export function computeLayout(input: LayoutInput): LayoutOutput {
  const { n, m, h, type, ea, eb, cfg } = input;
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
    outStart[ea[e]! + 1]!++;
    inDeg[eb[e]!]!++;
  }
  for (let i = 0; i < n; i++) outStart[i + 1]! += outStart[i]!;
  const outEdge = new Int32Array(m);
  const fill = outStart.slice(0, n);
  for (let e = 0; e < m; e++) outEdge[fill[ea[e]!]!++] = e;

  // --- weakly connected components, numbered by their first asset
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) {
      parent[r] = parent[parent[r]!]!;
      r = parent[r]!;
    }
    return r;
  };
  for (let e = 0; e < m; e++) parent[find(eb[e]!)] = find(ea[e]!);
  const rawOf = new Int32Array(n).fill(-1);
  const rootRaw = new Int32Array(n).fill(-1);
  let raw = 0;
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (rootRaw[r]! < 0) rootRaw[r] = raw++;
    rawOf[i] = rootRaw[r]!;
  }
  const rawSize = new Int32Array(raw);
  for (let i = 0; i < n; i++) rawSize[rawOf[i]!]!++;
  // a component of one asset with no connections is a straggler; the rest are pipelines, in discovery order
  const compId = new Int32Array(raw).fill(-1);
  let pipelines = 0;
  for (let i = 0; i < n; i++) {
    const rc = rawOf[i]!;
    const lone =
      rawSize[rc] === 1 && inDeg[i] === 0 && outStart[i + 1] === outStart[i];
    if (!lone && compId[rc]! < 0) compId[rc] = pipelines++;
  }
  let loneCount = 0;
  for (let i = 0; i < n; i++) if (compId[rawOf[i]!]! < 0) loneCount++;
  const compCount = pipelines + (loneCount ? 1 : 0);
  const compOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const c = compId[rawOf[i]!]!;
    compOf[i] = c < 0 ? pipelines : c;
  }
  // members of each component, ascending
  const compStart = new Int32Array(compCount + 1);
  for (let i = 0; i < n; i++) compStart[compOf[i]! + 1]!++;
  for (let c = 0; c < compCount; c++) compStart[c + 1]! += compStart[c]!;
  const members = new Int32Array(n);
  const cfill = compStart.slice(0, compCount);
  for (let i = 0; i < n; i++) members[cfill[compOf[i]!]!++] = i;

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

  const newGroup = (c: number, lay: number, ty: number): number => {
    const g = groupCount++;
    gLayer[g] = lay;
    gType[g] = ty;
    gComp[g] = c;
    return g;
  };
  /** A group as a roughly square grid of cards. */
  const sizeGroup = (g: number): void => {
    const cnt = gCnt[g]!;
    gRh[g] = gMh[g]! + GAP_CARD;
    const rows = Math.max(1, Math.ceil(Math.sqrt((cnt * CW) / gRh[g])));
    gRows[g] = rows;
    const cols = Math.ceil(cnt / rows);
    gw[g] = (cols - 1) * CW + NODE_W;
    gh[g] = (Math.min(cnt, rows) - 1) * gRh[g] + gMh[g]!;
  };

  for (let c = 0; c < compCount; c++) {
    const lo = compStart[c]!;
    const hi = compStart[c + 1]!;
    const size = hi - lo;
    if (!size) continue;

    if (c === pipelines && loneCount) {
      // --- the block of assets with no connections: a group per type, side by side
      compKind[c] = 1;
      const byType = new Map<number, number>();
      const mine: number[] = [];
      for (let k = lo; k < hi; k++) {
        const i = members[k]!;
        let g = byType.get(type[i]!);
        if (g === undefined) {
          g = newGroup(c, 0, type[i]!);
          byType.set(type[i]!, g);
          mine.push(g);
        }
        groupOf[i] = g;
        rank[i] = gCnt[g]!++;
        if (h[i]! > gMh[g]!) gMh[g] = h[i]!;
      }
      for (const g of mine) sizeGroup(g);
      const order = mine.slice().sort((p, q) => gCnt[q]! - gCnt[p]! || p - q);
      let base = 0;
      for (const g of order) base = Math.max(base, gh[g]! / 2 + PAD);
      let xx = 0;
      let top = 0;
      for (const g of order) {
        gx[g] = xx;
        gy[g] = base - gh[g]! / 2;
        xx += gw[g]! + 2 * PAD + GAP_GROUP;
        top = Math.max(top, gh[g]! / 2 + PAD);
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
    const dfs = (r: number): void => {
      if (state[r]) return;
      state[r] = 1;
      let sp = 0;
      stackNode[0] = r;
      stackPos[0] = outStart[r]!;
      while (sp >= 0) {
        const u = stackNode[sp]!;
        const pos = stackPos[sp]!;
        if (pos < outStart[u + 1]!) {
          stackPos[sp]!++;
          const e = outEdge[pos]!;
          const v = eb[e]!;
          if (state[v] === 1) back[e] = 1;
          else if (!state[v]) {
            state[v] = 1;
            sp++;
            stackNode[sp] = v;
            stackPos[sp] = outStart[v]!;
          }
        } else {
          state[u] = 2;
          sp--;
        }
      }
    };
    for (let k = lo; k < hi; k++)
      if (inDeg[members[k]!] === 0) dfs(members[k]!); // sources first
    for (let k = lo; k < hi; k++) dfs(members[k]!);

    // --- layers: longest path over the connections that are not back connections
    const queue: number[] = [];
    for (let k = lo; k < hi; k++) {
      const u = members[k]!;
      for (let p = outStart[u]!; p < outStart[u + 1]!; p++) {
        const e = outEdge[p]!;
        if (!back[e]) deg[eb[e]!]!++;
      }
    }
    for (let k = lo; k < hi; k++)
      if (deg[members[k]!] === 0) queue.push(members[k]!);
    while (queue.length) {
      const u = queue.pop()!;
      for (let p = outStart[u]!; p < outStart[u + 1]!; p++) {
        const e = outEdge[p]!;
        if (back[e]) continue;
        const v = eb[e]!;
        if (layer[u]! + 1 > layer[v]!) layer[v] = layer[u]! + 1;
        if (--deg[v]! === 0) queue.push(v);
      }
    }

    // --- groups: by (layer, type), in the order first met
    const byKey = new Map<number, number>();
    const layers: number[][] = [];
    const mine: number[] = [];
    for (let k = lo; k < hi; k++) {
      const i = members[k]!;
      const key = layer[i]! * 4194304 + type[i]!;
      let g = byKey.get(key);
      if (g === undefined) {
        g = newGroup(c, layer[i]!, type[i]!);
        byKey.set(key, g);
        mine.push(g);
        (layers[layer[i]!] ||= []).push(g);
      }
      groupOf[i] = g;
      rank[i] = gCnt[g]!++;
      if (h[i]! > gMh[g]!) gMh[g] = h[i]!;
    }
    for (const g of mine) sizeGroup(g);
    for (const L of layers) L.sort((p, q) => gCnt[q]! - gCnt[p]! || p - q); // the largest group of a layer sits on the baseline
    let base = 0;
    let below = 0;
    for (const L of layers) {
      base = Math.max(base, gh[L[0]!]! / 2 + PAD);
      let b = gh[L[0]!]! / 2 + PAD;
      for (let j = 1; j < L.length; j++) b += gh[L[j]!]! + 2 * PAD + GAP_GROUP;
      below = Math.max(below, b);
    }
    const compH = base + below;
    let xx = 0;
    for (const L of layers) {
      let lw = 0;
      for (const g of L) lw = Math.max(lw, gw[g]!);
      let yy = base - gh[L[0]!]! / 2;
      for (const g of L) {
        gx[g] = xx + (lw - gw[g]!) / 2;
        gy[g] = yy;
        yy += gh[g]! + 2 * PAD + GAP_GROUP;
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
    const g = groupOf[i]!;
    const r = rank[i]!;
    const rows = gRows[g]!;
    x[i] = gx[g]! + Math.floor(r / rows) * CW;
    y[i] = gy[g]! + (r % rows) * gRh[g]!;
  }

  // --- pack the blocks into rows: widest area first, each row as wide as the widest block (+25%)
  let widest = 0;
  for (let c = 0; c < compCount; c++) widest = Math.max(widest, cw[c]!);
  const rowW = Math.max(widest * 1.25, 1);
  const order = Array.from({ length: compCount }, (_, c) => c).sort(
    (p, q) => cw[q]! * ch[q]! - cw[p]! * ch[p]!,
  );
  const dx = new Float64Array(compCount);
  const dy = new Float64Array(compCount);
  let px = 0;
  let py = 0;
  let rowH = 0;
  for (const c of order) {
    if (px > 0 && px + cw[c]! > rowW) {
      py += rowH + GAP_COMP;
      px = 0;
      rowH = 0;
    }
    dx[c] = px - cx[c]!;
    dy[c] = py - cy[c]!;
    cx[c] = px;
    cy[c] = py;
    px += cw[c]! + GAP_COMP_X;
    rowH = Math.max(rowH, ch[c]!);
  }
  for (let i = 0; i < n; i++) {
    x[i]! += dx[compOf[i]!]!;
    y[i]! += dy[compOf[i]!]!;
  }
  for (let g = 0; g < groupCount; g++) {
    gx[g]! += dx[gComp[g]!]!;
    gy[g]! += dy[gComp[g]!]!;
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
    ch,
  };
}

/** Every buffer in a result, for postMessage's transfer list (moved, not copied). */
export function layoutBuffers(o: LayoutOutput): ArrayBuffer[] {
  return [
    o.layer,
    o.back,
    o.x,
    o.y,
    o.groupOf,
    o.compOf,
    o.gLayer,
    o.gType,
    o.gComp,
    o.gx,
    o.gy,
    o.gw,
    o.gh,
    o.gRows,
    o.gMh,
    o.gRh,
    o.compKind,
    o.cx,
    o.cy,
    o.cw,
    o.ch,
  ].map((a) => a.buffer);
}
