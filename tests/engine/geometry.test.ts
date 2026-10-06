import { describe, expect, it } from 'vitest';
import {
  displace,
  distToCubic,
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

describe('distToCubic', () => {
  const bez = (t: number, a: number, b: number, c: number, d: number) => {
    const m = 1 - t;
    return (
      m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d
    );
  };
  /** The slow, obviously-right answer: dense sampling. */
  const brute = (px: number, py: number, p: number[]) => {
    let best = Infinity;
    for (let i = 0; i <= 4000; i++) {
      const t = i / 4000;
      best = Math.min(
        best,
        Math.hypot(
          px - bez(t, p[0]!, p[2]!, p[4]!, p[6]!),
          py - bez(t, p[1]!, p[3]!, p[5]!, p[7]!),
        ),
      );
    }
    return best;
  };

  it('agrees with dense sampling for points near the curve, on many random port-to-port curves', () => {
    let seed = 5;
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 400; k++) {
      const x0 = r() * 500;
      const y0 = r() * 500;
      const x1 = x0 + 100 + r() * 1500;
      const y1 = r() * 500;
      const d = Math.max(60, Math.abs(x1 - x0) * 0.5);
      const p = [x0, y0, x0 + d, y0, x1 - d, y1, x1, y1];
      const t = r();
      const px = bez(t, p[0]!, p[2]!, p[4]!, p[6]!) + (r() - 0.5) * 20; // within ~10 of a point on the curve
      const py = bez(t, p[1]!, p[3]!, p[5]!, p[7]!) + (r() - 0.5) * 20;
      const want = brute(px, py, p);
      const got = distToCubic(
        px,
        py,
        p[0]!,
        p[1]!,
        p[2]!,
        p[3]!,
        p[4]!,
        p[5]!,
        p[6]!,
        p[7]!,
        50,
      );
      expect(Math.abs(got - want), `curve ${k}`).toBeLessThan(0.75);
    }
  });

  it('rejects a curve that is nowhere near, without refining', () => {
    expect(distToCubic(0, 5000, 0, 0, 100, 0, 300, 100, 400, 100, 9)).toBe(
      Infinity,
    );
    expect(
      distToCubic(200, 50, 0, 0, 100, 0, 300, 100, 400, 100, 9),
    ).toBeLessThan(2); // the midpoint is on it
  });
});
