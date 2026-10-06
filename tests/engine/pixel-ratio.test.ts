import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_PIXEL_RATIO,
  effectivePixelRatio,
} from '../../src/-private/engine/pixel-ratio.ts';

describe('effectivePixelRatio', () => {
  it('caps a dense screen at the default, so a CPU-only client fills fewer pixels', () => {
    expect(DEFAULT_MAX_PIXEL_RATIO).toBe(1.5);
    expect(effectivePixelRatio(2)).toBe(1.5);
    expect(effectivePixelRatio(3)).toBe(1.5);
  });

  it('leaves a normal screen alone, and never goes below 1', () => {
    expect(effectivePixelRatio(1)).toBe(1);
    expect(effectivePixelRatio(1.25)).toBe(1.25);
    expect(effectivePixelRatio(0.75)).toBe(1);
  });

  it('honours the host: a higher cap, or none at all', () => {
    expect(effectivePixelRatio(2, 2)).toBe(2);
    expect(effectivePixelRatio(3, Infinity)).toBe(3);
    expect(effectivePixelRatio(2, 1)).toBe(1);
  });

  it('survives nonsense', () => {
    expect(effectivePixelRatio(NaN)).toBe(1);
    expect(effectivePixelRatio(0)).toBe(1);
    expect(effectivePixelRatio(2, NaN)).toBe(1.5);
  });
});
