import { describe, expect, it } from 'vitest';
import {
  DARK,
  resolveTheme,
  THEME_TOKENS,
} from '../../src/-private/engine/theme.ts';
import { Palette } from '../../src/-private/engine/palette.ts';

const anything = () => true;

describe('theme', () => {
  it('falls back to the dark theme for anything the page does not define', () => {
    expect(resolveTheme(() => '', anything)).toEqual(DARK);
  });

  it('takes whatever colours the page sets, oklch included, and trims them', () => {
    const css: Record<string, string> = {
      '--cg-bg': ' oklch(98% 0.01 90) ',
      '--cg-card': '#ffffff',
      '--cg-highlight': 'oklch(25% 0.02 260)',
    };
    const t = resolveTheme((tok) => css[tok] ?? '', anything);
    expect(t.background).toBe('oklch(98% 0.01 90)');
    expect(t.card).toBe('#ffffff');
    expect(t.highlight).toBe('oklch(25% 0.02 260)');
    expect(t.text).toBe(DARK.text); // not set: default
  });

  it('ignores a value the canvas would not accept, instead of drawing nothing', () => {
    const t = resolveTheme(
      (tok) =>
        tok === '--cg-bg'
          ? 'not-a-colour'
          : tok === '--cg-card'
            ? '#123456'
            : '',
      (c) => c.startsWith('#'),
    );
    expect(t.background).toBe(DARK.background);
    expect(t.card).toBe('#123456');
  });

  it('every part of the theme has its own token, and they are all --cg- prefixed and distinct', () => {
    const tokens = Object.values(THEME_TOKENS);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens.every((t) => t.startsWith('--cg-'))).toBe(true);
    expect(Object.keys(THEME_TOKENS).sort()).toEqual(Object.keys(DARK).sort());
  });
});

describe('palette', () => {
  it('gives a type the same colour every time, as #rrggbb', () => {
    const p = new Palette();
    for (const t of [
      'source',
      'sink',
      'switch',
      'process',
      'storage',
      'gpu',
      'aggregator',
      'ingest',
      'route',
      'enrich',
      'relay',
      'store',
      'parse',
      'x',
      'y',
      'z',
    ]) {
      const c = p.color(t);
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      expect(new Palette().color(t)).toBe(c);
    }
  });

  it('no type colour can be mistaken for the degraded colour', () => {
    const rgb = (c: string) =>
      [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
      ];
    const bad = rgb(DARK.bad);
    // every colour the palette can hand out: probe many type names
    const seen = new Set<string>();
    const p = new Palette();
    for (let i = 0; i < 400; i++) seen.add(p.color(`type-${i}`));
    expect(seen.size).toBeGreaterThan(8);
    for (const c of seen) {
      const d = Math.hypot(...rgb(c).map((v, k) => v - bad[k]!));
      expect(d, `${c} is too close to the degraded colour`).toBeGreaterThan(70);
    }
  });

  it('honours overrides, and ignores an override that is not #rrggbb', () => {
    const p = new Palette({ source: '#112233', sink: 'red' });
    expect(p.color('source')).toBe('#112233');
    expect(p.color('sink')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(p.color('sink')).not.toBe('red');
  });
});
