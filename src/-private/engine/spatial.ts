import type { AssetNode } from './types.ts';

/** Uniform grid over card rectangles: viewport culling and point picking without scanning every asset. */
export class SpatialGrid {
  private cells = new Map<number, AssetNode[]>();
  constructor(private readonly size = 800) {}

  private key(cx: number, cy: number): number {
    return cx * 100003 + cy;
  }

  rebuild(nodes: readonly AssetNode[]): void {
    this.cells.clear();
    for (const n of nodes) this.add(n);
  }

  /** Index a card at its current position, in addition to whatever is already indexed (used while cards are moving). */
  add(n: AssetNode): void {
    const S = this.size;
    for (
      let cx = Math.floor(n.x / S);
      cx <= Math.floor((n.x + n.w) / S);
      cx++
    ) {
      for (
        let cy = Math.floor(n.y / S);
        cy <= Math.floor((n.y + n.h) / S);
        cy++
      ) {
        const k = this.key(cx, cy);
        let cell = this.cells.get(k);
        if (!cell) this.cells.set(k, (cell = []));
        cell.push(n);
      }
    }
  }

  /**
   * The cards in the cells the rectangle touches. Pass `into` to reuse one set from frame to frame instead of
   * allocating a new one every time (it is cleared first).
   */
  query(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    into?: Set<AssetNode>,
  ): Set<AssetNode> {
    const out = into ?? new Set<AssetNode>();
    out.clear();
    const S = this.size;
    for (let cx = Math.floor(x0 / S); cx <= Math.floor(x1 / S); cx++) {
      for (let cy = Math.floor(y0 / S); cy <= Math.floor(y1 / S); cy++) {
        const cell = this.cells.get(this.key(cx, cy));
        if (cell) for (const n of cell) out.add(n);
      }
    }
    return out;
  }

  /** The card under (x, y), if any. */
  pick(x: number, y: number): AssetNode | null {
    const cell = this.cells.get(
      this.key(Math.floor(x / this.size), Math.floor(y / this.size)),
    );
    if (cell)
      for (const n of cell)
        if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) return n;
    return null;
  }
}
