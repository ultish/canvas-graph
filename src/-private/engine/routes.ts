import { fwdSegs, loopSegs } from './geometry.ts';
import { PAD, portY } from './layout.ts';
import type { Cubic, Edge, GroupEdge } from './types.ts';

/** The curve a connection is drawn along: port to port, or via its lane if it loops back / skips layers. */
export function edgeSegs(e: Edge): Cubic[] {
  const ay = portY(e.a, e.ai);
  const by = portY(e.b, e.bi);
  const ly = e.ge?.laneY;
  return ly === undefined
    ? fwdSegs(e.a.x + e.a.w, ay, e.b.x, by)
    : loopSegs(e.a.x + e.a.w, ay, e.b.x, by, ly, 60, 50);
}

/** The curve of a group-to-group pipe, between the groups' frame handles. */
export function groupEdgeSegs(ge: GroupEdge): Cubic[] {
  const A = ge.a;
  const B = ge.b;
  const y0 = A.y + A.h / 2;
  const y1 = B.y + B.h / 2;
  const x0 = A.x + A.w + PAD;
  const x1 = B.x - PAD;
  return ge.laneY === undefined
    ? fwdSegs(x0, y0, x1, y1)
    : loopSegs(x0, y0, x1, y1, ge.laneY, 190, 100);
}

/** Screen-space width of a pipe carrying n connections (log scale, capped). */
export const pipePx = (n: number): number =>
  Math.min(16, 1.5 + Math.log2(n + 1) * 1.3);
