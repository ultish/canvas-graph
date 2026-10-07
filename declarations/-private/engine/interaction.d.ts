import type { GraphEngine } from './engine.ts';
import type { Renderer } from './renderer.ts';
/**
 * Pointer and keyboard input for a canvas: pan, wheel zoom, click to select, drag from a port (zoomed in) or a
 * group handle (zoomed out) to connect, Delete to remove the selected wire, Cmd/Ctrl+Z to undo, Esc to cancel.
 * It only talks to the engine (select / requestConnectPorts / requestGroupConnect / requestDisconnect / undo).
 */
export declare class Interaction {
    private readonly canvas;
    private readonly engine;
    private readonly renderer;
    private mouse;
    private down;
    private cleanup;
    private cursor;
    constructor(canvas: HTMLCanvasElement, engine: GraphEngine, renderer: Renderer);
    destroy(): void;
    private local;
    private setCursor;
    private onWheel;
    private onDown;
    private onMove;
    /** The group handle nearest the cursor on the opposite side: the ring and arc show within reach, and a release there connects (the same rule as ports). */
    private nearGroup;
    private onUp;
    private onCancel;
    private onKey;
    /** What a click selects depends on what the zoom level shows: a card, a wire, a group pipe, or a group. */
    private clickAt;
    private pick;
    /**
     * The wire under the cursor. This is the costliest hit-test (every wire of every visible card), so it is rate-limited by
     * what it costs: after a slow one it waits four times as long before the next, and between runs the last answer stands.
     */
    private hoverWire;
    private nextWirePick;
    private update;
}
//# sourceMappingURL=interaction.d.ts.map