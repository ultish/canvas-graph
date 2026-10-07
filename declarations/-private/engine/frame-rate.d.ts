/** The frame-rate cap: a client with no GPU can ask for 30 fps and halve its drawing work. */
export declare const DEFAULT_MAX_FPS = 60;
/** Is it too soon after the last drawn frame to draw another? (Half a millisecond of slack, so 60 fps never skips.) */
export declare function tooSoon(now: number, lastDrawn: number, maxFps: number): boolean;
//# sourceMappingURL=frame-rate.d.ts.map