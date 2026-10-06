import type { Cubic, Point } from './types.ts';

const P = (x: number, y: number): Point => ({ x, y });

/** A plain port-to-port curve, leaving right and entering left. */
export function fwdSegs(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Cubic[] {
  const d = Math.max(60, Math.abs(x1 - x0) * 0.5);
  return [[P(x0, y0), P(x0 + d, y0), P(x1 - d, y1), P(x1, y1)]];
}

/**
 * Out of the right port, straight to a lane, along it, straight back to the left port, with big
 * rounded corners. Used for loop-backs (lane above) and layer-skipping edges (lane below).
 */
export function loopSegs(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ly: number,
  stub: number,
  R: number,
): Cubic[] {
  const sx = x0 + stub;
  const ex = x1 - stub;
  const v = Math.sign(ly - y0) || -1;
  const u = Math.sign(y1 - ly) || 1;
  const w = Math.sign(ex - sx) || -1;
  const K = 0.5523;
  const r = Math.max(
    2,
    Math.min(
      R,
      stub,
      Math.abs(ly - y0) / 2,
      Math.abs(ly - y1) / 2,
      Math.abs(ex - sx) / 2,
    ),
  );
  const line = (a: Point, b: Point): Cubic => [
    a,
    P(a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3),
    P(a.x + (2 * (b.x - a.x)) / 3, a.y + (2 * (b.y - a.y)) / 3),
    b,
  ];
  const corner = (
    a: Point,
    din: readonly [number, number],
    b: Point,
    dout: readonly [number, number],
  ): Cubic => [
    a,
    P(a.x + din[0] * K * r, a.y + din[1] * K * r),
    P(b.x - dout[0] * K * r, b.y - dout[1] * K * r),
    b,
  ];
  const A = [
    P(x0, y0),
    P(sx - r, y0),
    P(sx, y0 + v * r),
    P(sx, ly - v * r),
    P(sx + w * r, ly),
    P(ex - w * r, ly),
    P(ex, ly + u * r),
    P(ex, y1 - u * r),
    P(ex + r, y1),
    P(x1, y1),
  ] as const;
  return [
    line(A[0], A[1]),
    corner(A[1], [1, 0], A[2], [0, v]),
    line(A[2], A[3]),
    corner(A[3], [0, v], A[4], [w, 0]),
    line(A[4], A[5]),
    corner(A[5], [w, 0], A[6], [0, u]),
    line(A[6], A[7]),
    corner(A[7], [0, u], A[8], [1, 0]),
    line(A[8], A[9]),
  ];
}

export function bezierAt(q: Cubic, t: number): Point {
  const m = 1 - t;
  const a = m * m * m;
  const b = 3 * m * m * t;
  const c = 3 * m * t * t;
  const d = t * t * t;
  return P(
    a * q[0].x + b * q[1].x + c * q[2].x + d * q[3].x,
    a * q[0].y + b * q[1].y + c * q[2].y + d * q[3].y,
  );
}

/** n+1 points along a chain of cubics. */
export function sampleSegs(segs: readonly Cubic[], n: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * segs.length;
    const k = Math.min(segs.length - 1, Math.floor(u));
    pts.push(bezierAt(segs[k]!, u - k));
  }
  return pts;
}

/** Push each sample sideways along its normal by off(index, lastIndex). */
export function displace(
  pts: readonly Point[],
  off: (i: number, last: number) => number,
): Point[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    const o = off(i, pts.length - 1);
    return P(p.x - (ty / l) * o, p.y + (tx / l) * o);
  });
}

/** Distance from (x, y) to the segment a-b. */
export function segDist(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2
    ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2))
    : 0;
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

/**
 * Distance from (px, py) to the cubic through (x0,y0) (x1,y1) (x2,y2) (x3,y3), or Infinity if it is plainly more than
 * `limit` away. No allocation: this runs for thousands of wires on every pointer move. It samples coarsely first (a wire
 * nowhere near the cursor is rejected after twelve steps) and only refines around the closest part.
 */
export function distToCubic(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  limit: number,
): number {
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
    const t = t0 + ((t1 - t0) * i) / M;
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

function pointSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
