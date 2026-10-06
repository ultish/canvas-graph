// The canvas draws its own pixels, so it cannot be styled with CSS selectors. Instead it reads a handful of CSS custom
// properties from its own element (they inherit, so set them on `:root`, on `[data-theme]`, or on a wrapper) and falls
// back to a dark theme. Any CSS colour works, including oklch(): that is what DaisyUI's variables hold.

export interface Theme {
  /** The canvas background. */
  background: string;
  /** A card's fill and outline. */
  card: string;
  cardBorder: string;
  /** Card titles. */
  text: string;
  /** Quiet text: card subtitles, the "unconnected" heading. */
  textMuted: string;
  /** Port names and card footers. */
  textSoft: string;
  /** High-contrast labels: pipe counts, group names. */
  label: string;
  /** Healthy status dot. */
  ok: string;
  /** Degraded status, and wires waiting to be deleted. Types never use red, so it always means this. */
  bad: string;
  /** What stands out against the background: the selected wire, the wire you are dragging. White on dark, dark on light. */
  highlight: string;
}

export const DARK: Theme = {
  background: '#0b0b0e',
  card: '#17171d',
  cardBorder: '#262630',
  text: '#f1f1f6',
  textMuted: '#6d6d7a',
  textSoft: '#b4b4c2',
  label: '#e6e6ee',
  ok: '#7de08a',
  bad: '#ff4d4d',
  highlight: '#ffffff',
};

/** The CSS custom property that sets each part of the theme. */
export const THEME_TOKENS: Record<keyof Theme, string> = {
  background: '--cg-bg',
  card: '--cg-card',
  cardBorder: '--cg-card-border',
  text: '--cg-text',
  textMuted: '--cg-text-muted',
  textSoft: '--cg-text-soft',
  label: '--cg-label',
  ok: '--cg-ok',
  bad: '--cg-bad',
  highlight: '--cg-highlight',
};

/**
 * Build a theme from whatever the page defines. `read` returns a token's computed value ('' if unset); `valid` says
 * whether the canvas accepts a colour string. Anything unset or invalid keeps its dark default.
 */
export function resolveTheme(
  read: (token: string) => string,
  valid: (colour: string) => boolean,
): Theme {
  const theme = { ...DARK };
  for (const key of Object.keys(THEME_TOKENS) as Array<keyof Theme>) {
    const v = read(THEME_TOKENS[key]).trim();
    if (v && valid(v)) theme[key] = v;
  }
  return theme;
}
