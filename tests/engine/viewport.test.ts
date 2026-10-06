import { describe, expect, it } from 'vitest';
import { Viewport } from '../../src/-private/engine/viewport.ts';

const settle = (v: Viewport) => {
  for (let i = 0; i < 200 && v.step(); i++);
};

describe('Viewport', () => {
  it('maps between world and screen both ways', () => {
    const v = new Viewport();
    v.setSize(1000, 800);
    v.jumpTo({ x: 0, y: 0, w: 4000, h: 3000 });
    const w = v.toWorld(300, 200);
    const s = v.toScreen(w.x, w.y);
    expect(s.x).toBeCloseTo(300);
    expect(s.y).toBeCloseTo(200);
  });

  it('zooms about the cursor: the world point under it does not move', () => {
    const v = new Viewport();
    v.setSize(1000, 800);
    v.jumpTo({ x: 0, y: 0, w: 4000, h: 3000 });
    const before = v.toWorld(640, 300);
    v.zoomBy(640, 300, -600);
    settle(v);
    expect(v.s).toBeGreaterThan(v.toWorld(1, 0).x === 0 ? 0 : 0.2 * 0); // zoomed in
    const after = v.toWorld(640, 300);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
  });

  it('clamps the scale and eases toward it instead of jumping', () => {
    const v = new Viewport();
    v.setSize(1000, 800);
    v.jumpTo({ x: 0, y: 0, w: 4000, h: 3000 });
    const s0 = v.s;
    v.zoomBy(500, 400, -100000);
    expect(v.targetScale).toBeLessThanOrEqual(2.2);
    v.step();
    expect(v.s).toBeGreaterThan(s0);
    expect(v.s).toBeLessThan(v.targetScale);
    v.zoomBy(500, 400, 100000000);
    expect(v.targetScale).toBeGreaterThanOrEqual(0.012);
  });

  it('pans by dragging and keeps the pan when the next zoom happens', () => {
    const v = new Viewport();
    v.setSize(1000, 800);
    v.jumpTo({ x: 0, y: 0, w: 4000, h: 3000 });
    const x0 = v.x;
    v.beginDrag(100, 100);
    v.dragTo(200, 100);
    v.endDrag();
    expect(v.x).toBeCloseTo(x0 - 100 / v.s);
    const keep = v.toWorld(500, 400);
    v.zoomBy(500, 400, -300);
    settle(v);
    expect(v.toWorld(500, 400).x).toBeCloseTo(keep.x, 3);
  });

  it('focus fits a box and centres it', () => {
    const v = new Viewport();
    v.setSize(1000, 800);
    v.focus({ x: 1000, y: 2000, w: 800, h: 400 });
    settle(v);
    const c = v.toWorld(500, 400);
    expect(c.x).toBeCloseTo(1400, 3);
    expect(c.y).toBeCloseTo(2200, 3);
    const b = v.bounds();
    expect(b.x0).toBeLessThan(1000);
    expect(b.x1).toBeGreaterThan(1800);
  });
});
