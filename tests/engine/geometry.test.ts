import { describe, expect, it } from 'vitest';
import {
  displace,
  fwdSegs,
  loopSegs,
  sampleSegs,
  segDist,
} from '../../src/-private/engine/geometry.ts';

describe('geometry', () => {
  it('a forward curve starts and ends exactly on its ports', () => {
    const pts = sampleSegs(fwdSegs(10, 20, 500, 220), 40);
    expect(pts[0]).toEqual({ x: 10, y: 20 });
    expect(pts[40]!.x).toBeCloseTo(500);
    expect(pts[40]!.y).toBeCloseTo(220);
  });

  it('a loop is continuous, hits its lane, and ends on the left port', () => {
    const segs = loopSegs(3740, 142, 1180, 132, -140, 60, 50);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i]![0].x).toBeCloseTo(segs[i - 1]![3].x);
      expect(segs[i]![0].y).toBeCloseTo(segs[i - 1]![3].y);
    }
    const pts = sampleSegs(segs, 200);
    expect(pts[0]).toEqual({ x: 3740, y: 142 });
    expect(pts[200]!.x).toBeCloseTo(1180);
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(-140);
    expect(pts.some((p) => Number.isNaN(p.x) || Number.isNaN(p.y))).toBe(false);
  });

  it('a skip lane below peaks at its lane', () => {
    const pts = sampleSegs(loopSegs(100, 50, 2000, 60, 900, 60, 50), 200);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(900);
  });

  it('segDist measures to the segment, not the infinite line', () => {
    expect(segDist(5, 3, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(segDist(20, 0, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(10);
  });

  it('displace moves samples sideways and leaves a zero offset alone', () => {
    const pts = sampleSegs(fwdSegs(0, 0, 100, 0), 10);
    const moved = displace(pts, (i) => (i === 5 ? 10 : 0));
    expect(Math.abs(moved[5]!.y - pts[5]!.y)).toBeCloseTo(10);
    expect(moved[4]).toEqual(pts[4]);
  });
});
