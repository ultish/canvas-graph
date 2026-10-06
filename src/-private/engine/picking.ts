import { portY, PAD } from './layout.ts';
import { edgeSegs, groupEdgeSegs, pipePx } from './routes.ts';
import { sampleSegs, segDist } from './geometry.ts';
import type { AssetNode, Edge, Group, GroupEdge } from './types.ts';

/** The wire nearest the cursor, within 9px, among wires touching the given (visible) cards. */
export function pickEdge(
  x: number,
  y: number,
  scale: number,
  vis: Iterable<AssetNode>,
  stamp: number,
): Edge | null {
  const tol = 9 / scale;
  let best: Edge | null = null;
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
        if (
          x < Math.min(x0, x1) - 80 - tol ||
          x > Math.max(x0, x1) + 80 + tol ||
          y < lo - tol ||
          y > hi + tol
        )
          continue;
        const pts = sampleSegs(edgeSegs(e), 32);
        for (let i = 1; i < pts.length; i++) {
          const d = segDist(x, y, pts[i - 1]!, pts[i]!);
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
export function pickGroupEdge(
  x: number,
  y: number,
  scale: number,
  gedges: readonly GroupEdge[],
): GroupEdge | null {
  let best: GroupEdge | null = null;
  let bd = Infinity;
  for (const ge of gedges) {
    const tol = Math.max(10, pipePx(ge.edges.length) / 2 + 4) / scale;
    const pts = sampleSegs(groupEdgeSegs(ge), 40);
    for (let i = 1; i < pts.length; i++) {
      const d = segDist(x, y, pts[i - 1]!, pts[i]!);
      if (d < tol && d < bd) {
        bd = d;
        best = ge;
      }
    }
  }
  return best;
}

/** The smallest group frame containing the point (tiny groups get a 10px minimum hit area). */
export function pickGroup(
  x: number,
  y: number,
  scale: number,
  groups: readonly Group[],
): Group | null {
  let best: Group | null = null;
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
export function pickPort(
  x: number,
  y: number,
  scale: number,
  nodes: Iterable<AssetNode>,
): { node: AssetNode; dir: 1 | -1; idx: number } | null {
  const r = Math.max(10, 14 / scale);
  for (const n of nodes) {
    for (const dir of [1, -1] as const) {
      const arr = dir > 0 ? n.outs : n.ins;
      const px = dir > 0 ? n.x + n.w : n.x;
      for (let k = 0; k < arr.length; k++)
        if (Math.hypot(px - x, portY(n, k) - y) <= r)
          return { node: n, dir, idx: k };
    }
  }
  return null;
}

/** A group's drag handle: egress at the right edge's middle, ingress at the left's. */
export function pickGroupHandle(
  x: number,
  y: number,
  scale: number,
  groups: readonly Group[],
): { group: Group; dir: 1 | -1 } | null {
  const r = 14 / scale;
  let best: { group: Group; dir: 1 | -1 } | null = null;
  let bd = r;
  for (const g of groups) {
    const hy = g.y + g.h / 2;
    for (const [hx, dir] of [
      [g.x + g.w + PAD, 1],
      [g.x - PAD, -1],
    ] as const) {
      const d = Math.hypot(hx - x, hy - y);
      if (d < bd) {
        bd = d;
        best = { group: g, dir };
      }
    }
  }
  return best;
}
