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
export declare const DARK: Theme;
/** The CSS custom property that sets each part of the theme. */
export declare const THEME_TOKENS: Record<keyof Theme, string>;
/**
 * Build a theme from whatever the page defines. `read` returns a token's computed value ('' if unset); `valid` says
 * whether the canvas accepts a colour string. Anything unset or invalid keeps its dark default.
 */
export declare function resolveTheme(read: (token: string) => string, valid: (colour: string) => boolean): Theme;
//# sourceMappingURL=theme.d.ts.map