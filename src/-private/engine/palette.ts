// Asset type -> colour. Stable (a hash of the type name), so a type keeps its colour across sessions, with
// overrides for the types you want to pin. No reds: red means degraded. Always '#rrggbb': the renderer appends alpha as two hex digits.
const PALETTE = [
  '#ffd24a',
  '#ffa040',
  '#b05cff',
  '#2fe6e6',
  '#ff4fa3',
  '#6ee7a0',
  '#5aa9ff',
  '#f2a65a',
  '#c3e86d',
  '#7c8cff',
  '#d4a5ff',
  '#4dd0b8',
] as const;

const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

export class Palette {
  private cache = new Map<string, string>();
  constructor(private overrides: Record<string, string> = {}) {}

  color(type: string): string {
    let c = this.cache.get(type);
    if (c) return c;
    const o = this.overrides[type];
    if (o && isHex(o)) c = o;
    else {
      let h = 2166136261;
      for (let i = 0; i < type.length; i++)
        h = Math.imul(h ^ type.charCodeAt(i), 16777619);
      c = PALETTE[(h >>> 0) % PALETTE.length]!;
    }
    this.cache.set(type, c);
    return c;
  }

  setOverrides(o: Record<string, string>): void {
    this.overrides = o;
    this.cache.clear();
  }
}
