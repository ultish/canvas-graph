import type { Point } from './types.ts';
export declare const MIN_SCALE = 0.012;
export declare const MAX_SCALE = 2.2;
/**
 * Camera: world <-> screen, eased zoom that keeps the world point under the cursor fixed, panning,
 * and jump-to-box. Pure maths, no DOM.
 */
export declare class Viewport {
    x: number;
    y: number;
    s: number;
    width: number;
    height: number;
    private targetS;
    private ax;
    private ay;
    private wx;
    private wy;
    private dragging;
    get targetScale(): number;
    setSize(width: number, height: number): void;
    toWorld(px: number, py: number): Point;
    toScreen(x: number, y: number): Point;
    /** World-space rectangle currently on screen. */
    bounds(): {
        x0: number;
        y0: number;
        x1: number;
        y1: number;
    };
    private anchor;
    /** Wheel zoom about a screen point. `delta` is the wheel's deltaY (pinch passes a larger gain). */
    zoomBy(px: number, py: number, delta: number, gain?: number): void;
    /** Zoom to fit a world box, centred. Eases there. */
    focus(box: {
        x: number;
        y: number;
        w: number;
        h: number;
    }, margin?: number): void;
    /** Jump (no easing): used for the first frame. */
    jumpTo(box: {
        x: number;
        y: number;
        w: number;
        h: number;
    }, margin?: number): void;
    /** Centre on a world point at a scale (used by tests and "reveal"). */
    centerOn(wx: number, wy: number, scale?: number): void;
    beginDrag(px: number, py: number): void;
    dragTo(px: number, py: number): void;
    endDrag(): void;
    get isDragging(): boolean;
    /** Advance the zoom easing one frame. Returns true while still moving. */
    step(): boolean;
}
//# sourceMappingURL=viewport.d.ts.map