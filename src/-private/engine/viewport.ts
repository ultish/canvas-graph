import type { Point } from './types.ts';

export const MIN_SCALE = 0.012;
export const MAX_SCALE = 2.2;

/**
 * Camera: world <-> screen, eased zoom that keeps the world point under the cursor fixed, panning,
 * and jump-to-box. Pure maths, no DOM.
 */
export class Viewport {
  x = 0;
  y = 0;
  s = 0.04;
  width = 800;
  height = 600;
  private targetS = 0.04;
  // the world point (wx, wy) that must stay under the screen point (ax, ay) while the scale eases
  private ax = 0;
  private ay = 0;
  private wx = 0;
  private wy = 0;
  private dragging: { x: number; y: number; vx: number; vy: number } | null =
    null;

  get targetScale(): number {
    return this.targetS;
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  toWorld(px: number, py: number): Point {
    return { x: px / this.s + this.x, y: py / this.s + this.y };
  }

  toScreen(x: number, y: number): Point {
    return { x: (x - this.x) * this.s, y: (y - this.y) * this.s };
  }

  /** World-space rectangle currently on screen. */
  bounds(): { x0: number; y0: number; x1: number; y1: number } {
    const a = this.toWorld(0, 0);
    const b = this.toWorld(this.width, this.height);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }

  private anchor(px: number, py: number): void {
    const p = this.toWorld(px, py);
    this.ax = px;
    this.ay = py;
    this.wx = p.x;
    this.wy = p.y;
  }

  /** Wheel zoom about a screen point. `delta` is the wheel's deltaY (pinch passes a larger gain). */
  zoomBy(px: number, py: number, delta: number, gain = 0.0018): void {
    this.anchor(px, py);
    this.targetS = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, this.targetS * Math.exp(-delta * gain)),
    );
  }

  /** Zoom to fit a world box, centred. Eases there. */
  focus(
    box: { x: number; y: number; w: number; h: number },
    margin = 400,
  ): void {
    this.targetS = Math.min(
      MAX_SCALE,
      Math.min(this.width / (box.w + margin), this.height / (box.h + margin)),
    );
    this.ax = this.width / 2;
    this.ay = this.height / 2;
    this.wx = box.x + box.w / 2;
    this.wy = box.y + box.h / 2;
  }

  /** Jump (no easing): used for the first frame. */
  jumpTo(
    box: { x: number; y: number; w: number; h: number },
    margin = 400,
  ): void {
    this.focus(box, margin);
    this.s = this.targetS;
    this.x = this.wx - this.ax / this.s;
    this.y = this.wy - this.ay / this.s;
  }

  /** Centre on a world point at a scale (used by tests and "reveal"). */
  centerOn(wx: number, wy: number, scale = this.targetS): void {
    this.targetS = scale;
    this.ax = this.width / 2;
    this.ay = this.height / 2;
    this.wx = wx;
    this.wy = wy;
  }

  beginDrag(px: number, py: number): void {
    this.dragging = { x: px, y: py, vx: this.x, vy: this.y };
  }

  dragTo(px: number, py: number): void {
    const d = this.dragging;
    if (!d) return;
    this.x = d.vx - (px - d.x) / this.s;
    this.y = d.vy - (py - d.y) / this.s;
    this.anchor(this.ax, this.ay);
  }

  endDrag(): void {
    this.dragging = null;
  }

  get isDragging(): boolean {
    return this.dragging !== null;
  }

  /** Advance the zoom easing one frame. Returns true while still moving. */
  step(): boolean {
    let moving = false;
    if (Math.abs(this.targetS - this.s) > this.targetS * 0.002) {
      this.s += (this.targetS - this.s) * 0.22;
      moving = true;
    } else this.s = this.targetS;
    if (!this.dragging) {
      this.x = this.wx - this.ax / this.s;
      this.y = this.wy - this.ay / this.s;
    }
    return moving;
  }
}
