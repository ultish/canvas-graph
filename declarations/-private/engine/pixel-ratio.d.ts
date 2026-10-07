/** The default cap on canvas pixel density. A 2x or 3x screen means 4-9x the pixels to fill, which is what hurts a CPU-only client. */
export declare const DEFAULT_MAX_PIXEL_RATIO = 1.5;
/** The pixel ratio to draw at: the device's, never below 1, never above the cap. */
export declare function effectivePixelRatio(device: number, max?: number): number;
//# sourceMappingURL=pixel-ratio.d.ts.map