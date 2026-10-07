import type { Cubic, Point } from './types.ts';
/** A plain port-to-port curve, leaving right and entering left. */
export declare function fwdSegs(x0: number, y0: number, x1: number, y1: number): Cubic[];
/**
 * Out of the right port, straight to a lane, along it, straight back to the left port, with big
 * rounded corners. Used for loop-backs (lane above) and layer-skipping edges (lane below).
 */
export declare function loopSegs(x0: number, y0: number, x1: number, y1: number, ly: number, stub: number, R: number): Cubic[];
export declare function bezierAt(q: Cubic, t: number): Point;
/** n+1 points along a chain of cubics. */
export declare function sampleSegs(segs: readonly Cubic[], n: number): Point[];
/** Push each sample sideways along its normal by off(index, lastIndex). */
export declare function displace(pts: readonly Point[], off: (i: number, last: number) => number): Point[];
/** Distance from (x, y) to the segment a-b. */
export declare function segDist(x: number, y: number, a: Point, b: Point): number;
/**
 * Distance from (px, py) to the cubic through (x0,y0) (x1,y1) (x2,y2) (x3,y3), or Infinity if it is plainly more than
 * `limit` away. No allocation: this runs for thousands of wires on every pointer move. It samples coarsely first (a wire
 * nowhere near the cursor is rejected after twelve steps) and only refines around the closest part.
 */
export declare function distToCubic(px: number, py: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, limit: number): number;
//# sourceMappingURL=geometry.d.ts.map