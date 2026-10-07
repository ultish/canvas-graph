export interface LayoutConfig {
    PAD: number;
    GAP_CARD: number;
    CW: number;
    NODE_W: number;
    GAP_LAYER: number;
    GAP_GROUP: number;
    GAP_COMP: number;
    GAP_COMP_X: number;
}
export interface LayoutInput {
    n: number;
    m: number;
    /** Card heights. */
    h: Float64Array;
    /** Asset type, as a small integer (equal types, equal numbers). */
    type: Int32Array;
    /** Each connection's source and target asset. */
    ea: Int32Array;
    eb: Int32Array;
    cfg: LayoutConfig;
}
export interface LayoutOutput {
    layer: Int32Array;
    /** 1 for the connection that closes a cycle. */
    back: Uint8Array;
    x: Float64Array;
    y: Float64Array;
    /** Which group / pipeline each asset belongs to. */
    groupOf: Int32Array;
    compOf: Int32Array;
    groupCount: number;
    gLayer: Int32Array;
    gType: Int32Array;
    gComp: Int32Array;
    gx: Float64Array;
    gy: Float64Array;
    gw: Float64Array;
    gh: Float64Array;
    gRows: Int32Array;
    gMh: Float64Array;
    gRh: Float64Array;
    compCount: number;
    /** 0: a pipeline, 1: the block of assets with no connections. */
    compKind: Uint8Array;
    cx: Float64Array;
    cy: Float64Array;
    cw: Float64Array;
    ch: Float64Array;
}
export declare function computeLayout(input: LayoutInput): LayoutOutput;
/** Every buffer in a result, for postMessage's transfer list (moved, not copied). */
export declare function layoutBuffers(o: LayoutOutput): ArrayBuffer[];
//# sourceMappingURL=layout-core.d.ts.map