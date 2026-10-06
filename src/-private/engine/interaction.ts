import {
  CARD_MARGIN_PX,
  ELEC_PX,
  GROUP_SCALE,
  MAG_PULL,
  MAG_PX,
  NEAR_SCALE,
  ringR,
  SNAP_PX,
} from './constants.ts';
import type { GraphEngine } from './engine.ts';
import { portY } from './layout.ts';
import {
  pickEdge,
  pickGroup,
  pickGroupEdge,
  pickGroupHandle,
  pickPort,
} from './picking.ts';
import type { Renderer } from './renderer.ts';
import type { AssetNode } from './types.ts';

/**
 * Pointer and keyboard input for a canvas: pan, wheel zoom, click to select, drag from a port (zoomed in) or a
 * group handle (zoomed out) to connect, Delete to remove the selected wire, Cmd/Ctrl+Z to undo, Esc to cancel.
 * It only talks to the engine (select / requestConnectPorts / requestGroupConnect / requestDisconnect / undo).
 */
export class Interaction {
  private mouse = { x: 0, y: 0, inside: false };
  private down: { x: number; y: number } | null = null;
  private cleanup: Array<() => void> = [];
  private cursor = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly engine: GraphEngine,
    private readonly renderer: Renderer,
  ) {
    canvas.tabIndex = 0;
    canvas.style.outline = 'none';
    canvas.style.touchAction = 'none';
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      canvas.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() =>
        canvas.removeEventListener(type, fn as EventListener, opts),
      );
    };
    on('wheel', this.onWheel, { passive: false });
    on('pointerdown', this.onDown);
    on('pointermove', this.onMove);
    on('pointerup', this.onUp);
    on('pointercancel', this.onCancel);
    on('pointerleave', () => {
      this.mouse.inside = false;
      this.renderer.invalidate();
    });
    on('keydown', this.onKey);
    renderer.beforeDraw = (vis) => this.update(vis);
  }

  destroy(): void {
    for (const f of this.cleanup) f();
    this.cleanup = [];
    this.renderer.beforeDraw = null;
    this.setCursor('');
  }

  private local(e: { clientX: number; clientY: number }): {
    x: number;
    y: number;
  } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private setCursor(c: string): void {
    if (c === this.cursor) return;
    this.cursor = c;
    this.canvas.style.cursor = c;
  }

  // ------------------------------------------------------------------ input

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    this.engine.viewport.zoomBy(p.x, p.y, e.deltaY, e.ctrlKey ? 0.01 : 0.0018);
    this.renderer.invalidate();
  };

  private onDown = (e: PointerEvent): void => {
    this.canvas.focus({ preventScroll: true });
    const eng = this.engine;
    const vp = eng.viewport;
    const p = this.local(e);
    const w = vp.toWorld(p.x, p.y);
    const s = vp.s;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable (synthetic events, some browsers): the drag still works while the pointer stays over the canvas */
    }
    if (s >= NEAR_SCALE) {
      const r = Math.max(10, 14 / s);
      const hit = pickPort(
        w.x,
        w.y,
        s,
        eng.grid.query(w.x - r - 1, w.y - r - 1, w.x + r + 1, w.y + r + 1),
      );
      if (hit) {
        eng.anim.retract = null;
        eng.anim.conn = {
          from: hit.node,
          dir: hit.dir,
          idx: hit.idx,
          x: w.x,
          y: w.y,
          near: null,
          target: null,
          elec: 0,
          pull: 0,
          snap: false,
          pt: null,
        };
        this.setCursor('crosshair');
        this.renderer.invalidate();
        return;
      }
    }
    if (s < GROUP_SCALE) {
      const h = pickGroupHandle(w.x, w.y, s, eng.groups);
      if (h) {
        eng.anim.gconn = {
          from: h.group,
          dir: h.dir,
          x: w.x,
          y: w.y,
          target: null,
          pull: 0,
        };
        this.setCursor('crosshair');
        this.renderer.invalidate();
        return;
      }
    }
    this.down = { x: p.x, y: p.y };
    vp.beginDrag(p.x, p.y);
    this.setCursor('grabbing');
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.local(e);
    this.mouse = { x: p.x, y: p.y, inside: true };
    const eng = this.engine;
    const vp = eng.viewport;
    const w = vp.toWorld(p.x, p.y);
    const { conn, gconn } = eng.anim;
    if (gconn) {
      gconn.x = w.x;
      gconn.y = w.y;
      const t = pickGroup(w.x, w.y, vp.s, eng.groups);
      gconn.target = t && t !== gconn.from ? t : null;
    } else if (conn) {
      conn.x = w.x;
      conn.y = w.y;
    } else if (vp.isDragging) vp.dragTo(p.x, p.y);
    this.renderer.invalidate();
  };

  private onUp = (e: PointerEvent): void => {
    const eng = this.engine;
    const vp = eng.viewport;
    const A = eng.anim;
    if (A.gconn) {
      const c = A.gconn;
      const rp = this.local(e);
      const rw = vp.toWorld(rp.x, rp.y);
      const t = pickGroup(rw.x, rw.y, vp.s, eng.groups);
      c.target = t && t !== c.from ? t : null;
      A.gconn = null;
      this.setCursor('');
      if (c.target) {
        const [src, dst] = c.dir > 0 ? [c.from, c.target] : [c.target, c.from];
        eng.requestGroupConnect(src, dst);
      }
      this.renderer.invalidate();
      return;
    }
    if (A.conn) {
      const c = A.conn;
      const rp = this.local(e);
      const rw = vp.toWorld(rp.x, rp.y);
      c.x = rw.x; // a quick flick can release before the next frame: resolve the target at the release point
      c.y = rw.y;
      this.mouse = { x: rp.x, y: rp.y, inside: true };
      this.update(this.renderer.lastVisible);
      A.conn = null;
      this.setCursor('');
      const t = c.target;
      const made = t
        ? c.dir > 0
          ? eng.requestConnectPorts(c.from, c.idx, t.node, t.idx)
          : eng.requestConnectPorts(t.node, t.idx, c.from, c.idx)
        : null;
      if (!made) A.retract = { ...c, target: null, t0: eng.time };
      this.renderer.invalidate();
      return;
    }
    const wasDrag = vp.isDragging;
    vp.endDrag();
    this.setCursor('');
    const p = this.local(e);
    if (
      wasDrag &&
      this.down &&
      Math.hypot(p.x - this.down.x, p.y - this.down.y) < 4
    )
      this.clickAt(vp.toWorld(p.x, p.y));
    this.down = null;
    this.renderer.invalidate();
  };

  private onCancel = (): void => {
    const A = this.engine.anim;
    A.conn = null;
    A.gconn = null;
    this.engine.viewport.endDrag();
    this.down = null;
    this.setCursor('');
    this.renderer.invalidate();
  };

  private onKey = (e: KeyboardEvent): void => {
    const eng = this.engine;
    if ((e.key === 'Delete' || e.key === 'Backspace') && eng.selEdge) {
      e.preventDefault();
      eng.requestDisconnect([eng.selEdge], 'edge');
    } else if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      eng.undo();
    } else if (e.key === 'Escape') {
      const A = eng.anim;
      if (A.conn) A.retract = { ...A.conn, target: null, t0: eng.time };
      A.conn = null;
      A.gconn = null;
      this.setCursor('');
      eng.select(null);
    }
    this.renderer.invalidate();
  };

  /** What a click selects depends on what the zoom level shows: a card, a wire, a group pipe, or a group. */
  private clickAt(w: { x: number; y: number }): void {
    const eng = this.engine;
    const s = eng.viewport.s;
    const n = s >= 0.1 ? eng.grid.pick(w.x, w.y) : null;
    if (n) return eng.select({ node: n });
    const e =
      s >= 0.45
        ? pickEdge(w.x, w.y, s, this.renderer.lastVisible, eng.nextPickStamp())
        : null;
    if (e) return eng.select({ edge: e });
    if (s < GROUP_SCALE) {
      const ge = pickGroupEdge(w.x, w.y, s, eng.gedges);
      if (ge) return eng.select({ ge });
      const g = pickGroup(w.x, w.y, s, eng.groups);
      if (g) return eng.select({ group: g });
    }
    eng.select(null);
  }

  // ------------------------------------------------------------------ per-frame state (called by the renderer before drawing)

  private update(vis: ReadonlySet<AssetNode>): void {
    const eng = this.engine;
    const A = eng.anim;
    const vp = eng.viewport;
    const s = vp.s;
    const w = vp.toWorld(this.mouse.x, this.mouse.y);
    const idle = !A.conn && !A.gconn && !vp.isDragging && this.mouse.inside;
    A.hover = idle && s >= 0.1 ? eng.grid.pick(w.x, w.y) : null;
    A.hoverEdge =
      idle && !A.hover && s >= 0.45
        ? pickEdge(w.x, w.y, s, vis, eng.nextPickStamp())
        : null;
    A.hoverGE =
      idle && s < GROUP_SCALE && !A.hoverEdge
        ? pickGroupEdge(w.x, w.y, s, eng.gedges)
        : null;
    if (idle) {
      let port = false;
      if (s >= NEAR_SCALE) {
        const r = Math.max(10, 14 / s);
        port = !!pickPort(
          w.x,
          w.y,
          s,
          eng.grid.query(w.x - r - 1, w.y - r - 1, w.x + r + 1, w.y + r + 1),
        );
      }
      if (!port && s < GROUP_SCALE)
        port = !!pickGroupHandle(w.x, w.y, s, eng.groups);
      this.setCursor(
        port ? 'crosshair' : A.hoverEdge || A.hoverGE ? 'pointer' : '',
      );
    }
    if (A.gconn)
      A.gconn.pull += ((A.gconn.target ? 1 : 0) - A.gconn.pull) * 0.3;
    const c = A.conn;
    if (!c) return;
    // the nearest opposite-side port in range: the ring and arc show from ELEC_PX, a release connects within SNAP_PX
    let best: { node: AssetNode; idx: number } | null = null;
    let bd = ELEC_PX / s;
    for (const o of vis) {
      if (o === c.from) continue;
      const arr = c.dir > 0 ? o.ins : o.outs;
      const ox = c.dir > 0 ? o.x : o.x + o.w;
      const m = CARD_MARGIN_PX / s;
      const inCard =
        c.x >= o.x - m &&
        c.x <= o.x + o.w + m &&
        c.y >= o.y - m &&
        c.y <= o.y + o.h + m;
      let nk = -1;
      let nd = Infinity;
      for (let k = 0; k < arr.length; k++) {
        const d = Math.hypot(ox - c.x, portY(o, k) - c.y);
        if (d < nd) {
          nd = d;
          nk = k;
        }
      }
      if (nk < 0) continue;
      if (inCard) {
        // dropped on a card: it takes the nearest port
        best = { node: o, idx: nk };
        bd = 0;
        break;
      }
      if (nd < bd) {
        bd = nd;
        best = { node: o, idx: nk };
      }
    }
    c.near = best;
    c.elec = best ? 1 - (bd * s) / ELEC_PX : 0;
    c.target = best && bd * s <= SNAP_PX ? best : null;
    const m = best ? Math.max(0, 1 - (bd * s) / MAG_PX) : 0; // magnet: the tip is drawn toward the port, easing in
    if (best)
      c.pt = {
        x: best.node.x + (c.dir > 0 ? 0 : best.node.w),
        y: portY(best.node, best.idx),
      };
    c.snap = !!best && bd <= ringR(s);
    c.pull += ((c.snap ? 1 : MAG_PULL * m * m * (3 - 2 * m)) - c.pull) * 0.3;
  }
}
