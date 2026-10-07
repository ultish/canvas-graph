import type { GraphEngine } from './engine.ts';
import { Palette } from './palette.ts';
import type { AssetNode } from './types.ts';
export interface FrameStats {
    mode: 'FAR' | 'MID' | 'NEAR';
    scale: number;
    assetsDrawn: number;
    wiresDrawn: number;
    ms: number;
    assets: number;
    connections: number;
    groups: number;
}
export interface RendererOptions {
    /** Pin colours for specific asset types ('#rrggbb'); every other type gets a stable colour. */
    colors?: Record<string, string>;
    /** Overrides the theme's background colour. */
    background?: string;
    onFrame?: (stats: FrameStats) => void;
    /** Draw at most this many frames a second (default 60 = uncapped). 30 halves the work on a weak client. */
    maxFps?: number;
}
/**
 * Draws the engine's state onto a 2D canvas (no GPU needed). Frames are requested on demand: nothing runs while the
 * picture is still, and frames keep coming only while the camera or an animation is moving. Which layer is drawn
 * depends on zoom: group blocks and fat pipes (far), member tiles (mid), full cards and wires (near).
 */
export declare class Renderer {
    private readonly canvas;
    private readonly engine;
    private readonly opts;
    readonly palette: Palette;
    private readonly visible;
    /** Called after the camera and animations have advanced, before drawing, with the visible assets. */
    beforeDraw: ((visible: ReadonlySet<AssetNode>) => void) | null;
    lastVisible: ReadonlySet<AssetNode>;
    stats: FrameStats | null;
    private readonly ctx;
    private raf;
    private dirty;
    private dpr;
    private stamp;
    private wires;
    private off;
    private theme;
    maxFps: number;
    private lastDrawn;
    private readonly glow;
    private readonly glowByType;
    private readonly wireBuckets;
    private readonly buckets;
    constructor(canvas: HTMLCanvasElement, engine: GraphEngine, opts?: RendererOptions);
    /** Size the backing store. `width`/`height` are CSS pixels. */
    resize(width: number, height: number, dpr?: number): void;
    invalidate(): void;
    /**
     * Re-read the theme from CSS (the `--cg-*` custom properties on the canvas element) and redraw. Called once at
     * start, and by the modifier when the page's theme changes (`data-theme` on <html>, or the OS colour scheme).
     */
    refreshTheme(): void;
    private request;
    destroy(): void;
    private c;
    private frame;
    /**
     * Advance the camera and animations to `t` (ms) and draw one frame right now, ignoring the frame cap and the
     * display's schedule. For benchmarks and tests; the normal path is `invalidate()`.
     */
    renderOnce(t?: number): FrameStats;
    private paint;
    private drawGroups;
    /** Electricity: a jagged arc bridges the gap from a wire's tip to the handle it is reaching for. */
    private drawArc;
    /** The dotted pipe left behind by a group drag while its connect dialog is open. */
    private drawGroupDraft;
    /** The fat pipe following the cursor from a group handle; locks onto the target group's facing handle. */
    private drawGroupDrag;
    /** A connection's path, without allocating in the common case (a plain port-to-port curve). */
    private strokeEdge;
    private curve;
    /** A ring that opens out and fades around each asset the host's data just changed. Visible at mid and near zoom. */
    private drawPulses;
    /** Search hits: a steady ring (bigger when zoomed out so it stays visible) and, for a handful, the name. */
    private drawFound;
    private drawMembers;
    /** The selected path as individual wires (zoomed out), batched into one path and culled to the viewport. */
    private drawSelectedPath;
    private drawNear;
    /**
     * Off-screen connections: one stub per port with a count, not N overlapping wires. Drawn before every card, like the
     * wires, so a stub never lands on top of one neighbour and under another; it fades out so it reads as "continues".
     */
    private drawStubs;
    private stub;
    private drawCard;
    private drawPort;
    private drawTransients;
}
//# sourceMappingURL=renderer.d.ts.map