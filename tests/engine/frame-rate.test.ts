import { describe, expect, it } from 'vitest';
import { tooSoon } from '../../src/-private/engine/frame-rate.ts';

describe('tooSoon', () => {
  it('never throttles at 60 fps or more, or with a nonsense cap', () => {
    expect(tooSoon(1, 0, 60)).toBe(false);
    expect(tooSoon(1, 0, 144)).toBe(false);
    expect(tooSoon(1, 0, 0)).toBe(false);
    expect(tooSoon(1, 0, NaN)).toBe(false);
  });

  it('at 30 fps, holds frames back until about 33 ms have passed since the last drawn one', () => {
    expect(tooSoon(16, 0, 30)).toBe(true);
    expect(tooSoon(32, 0, 30)).toBe(true);
    expect(tooSoon(33, 0, 30)).toBe(false); // the 16.7 ms display tick after 16 ms is skipped, the next draws
    expect(tooSoon(50, 0, 30)).toBe(false);
  });

  it('a 60 Hz display with a 30 fps cap draws every other tick', () => {
    let last = -Infinity;
    let drawn = 0;
    for (let tick = 0; tick < 60; tick++) {
      const now = tick * (1000 / 60);
      if (tooSoon(now, last, 30)) continue;
      last = now;
      drawn++;
    }
    expect(drawn).toBe(30);
  });
});
