import type { AssetNode } from './types.ts';
/** Uniform grid over card rectangles: viewport culling and point picking without scanning every asset. */
export declare class SpatialGrid {
    private readonly size;
    private cells;
    constructor(size?: number);
    private key;
    rebuild(nodes: readonly AssetNode[]): void;
    /** Index a card at its current position, in addition to whatever is already indexed (used while cards are moving). */
    add(n: AssetNode): void;
    /**
     * The cards in the cells the rectangle touches. Pass `into` to reuse one set from frame to frame instead of
     * allocating a new one every time (it is cleared first).
     */
    query(x0: number, y0: number, x1: number, y1: number, into?: Set<AssetNode>): Set<AssetNode>;
    /** The card under (x, y), if any. */
    pick(x: number, y: number): AssetNode | null;
}
//# sourceMappingURL=spatial.d.ts.map