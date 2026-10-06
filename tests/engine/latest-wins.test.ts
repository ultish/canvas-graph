import { describe, expect, it } from 'vitest';
import { LatestWins } from '../../src/-private/engine/latest-wins.ts';

/** A clock and timers the test controls. */
function harness(ms: number) {
  let t = 0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  const applied: number[] = [];
  const lw = new LatestWins<number>(
    (v) => void applied.push(v),
    () => ms,
    () => t,
    (fn: () => void, delay: number) => {
      const id = nextId++;
      timers.push({ at: t + delay, fn, id });
      return id;
    },
    (id: number) => {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  );
  const advance = (to: number) => {
    t = to;
    for (const x of timers
      .filter((x) => x.at <= t)
      .sort((a, b) => a.at - b.at)) {
      timers.splice(timers.indexOf(x), 1);
      x.fn();
    }
  };
  return { lw, applied, advance, timers: () => timers.length };
}

describe('LatestWins', () => {
  it('applies the first value at once, and with a window of 0 applies everything', () => {
    const h = harness(0);
    h.lw.push(1);
    h.lw.push(2);
    expect(h.applied).toEqual([1, 2]);
    const h2 = harness(100);
    h2.lw.push(1);
    expect(h2.applied).toEqual([1]);
  });

  it('inside the window only the newest value survives, applied when the window ends', () => {
    const h = harness(100);
    h.lw.push(1); // t=0: leading
    h.advance(10);
    h.lw.push(2);
    h.advance(40);
    h.lw.push(3);
    h.advance(70);
    h.lw.push(4);
    expect(h.applied).toEqual([1]);
    h.advance(100);
    expect(h.applied).toEqual([1, 4]); // 2 and 3 were never applied: 4 is the whole truth
    expect(h.timers()).toBe(0);
  });

  it('a value after a quiet period goes straight through again', () => {
    const h = harness(100);
    h.lw.push(1);
    h.advance(500);
    h.lw.push(2);
    expect(h.applied).toEqual([1, 2]);
  });

  it('destroy drops what is waiting and cancels the timer', () => {
    const h = harness(100);
    h.lw.push(1);
    h.advance(10);
    h.lw.push(2);
    expect(h.timers()).toBe(1);
    h.lw.destroy();
    h.advance(1000);
    expect(h.applied).toEqual([1]);
    expect(h.timers()).toBe(0);
  });
});
