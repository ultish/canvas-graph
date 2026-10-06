import { ringR, smooth } from './constants.ts';
import type { GraphEngine } from './engine.ts';
import { PAD, portY } from './layout.ts';
import { Palette } from './palette.ts';
import { edgeSegs, groupEdgeSegs, pipePx } from './routes.ts';
import type { AssetNode, Cubic, Edge } from './types.ts';

const FONT = '-apple-system,system-ui,sans-serif';
const EMPTY: ReadonlySet<AssetNode> = new Set();

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
  background?: string;
  onFrame?: (stats: FrameStats) => void;
}

function strokeSegs(ctx: CanvasRenderingContext2D, sg: readonly Cubic[]): void {
  ctx.moveTo(sg[0]![0].x, sg[0]![0].y);
  for (const q of sg)
    ctx.bezierCurveTo(q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y);
}

/**
 * Draws the engine's state onto a 2D canvas (no GPU needed). Frames are requested on demand: nothing runs while the
 * picture is still, and frames keep coming only while the camera or an animation is moving. Which layer is drawn
 * depends on zoom: group blocks and fat pipes (far), member tiles (mid), full cards and wires (near).
 */
export class Renderer {
  readonly palette: Palette;
  /** Called after the camera and animations have advanced, before drawing, with the visible assets. */
  beforeDraw: ((visible: ReadonlySet<AssetNode>) => void) | null = null;
  lastVisible: ReadonlySet<AssetNode> = EMPTY;
  stats: FrameStats | null = null;

  private readonly ctx: CanvasRenderingContext2D;
  private raf = 0;
  private dirty = true;
  private dpr = 1;
  private stamp = 0;
  private wires = 0;
  private off: () => void;
  private readonly background: string;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly engine: GraphEngine,
    private readonly opts: RendererOptions = {},
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas-graph: 2D canvas is not available');
    this.ctx = ctx;
    this.palette = new Palette(opts.colors);
    this.background = opts.background ?? '#0b0b0e';
    this.off = engine.on('invalidate', () => this.invalidate(), {
      passive: true,
    });
  }

  /** Size the backing store. `width`/`height` are CSS pixels. */
  resize(width: number, height: number, dpr = 1): void {
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.engine.viewport.setSize(width, height);
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
    this.request();
  }

  private request(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.off();
  }

  private c(type: string): string {
    return this.palette.color(type);
  }

  // ------------------------------------------------------------------ frame

  private frame = (t: number): void => {
    this.raf = 0;
    const eng = this.engine;
    eng.time = t / 1000;
    const vp = eng.viewport;
    const moving = vp.step();
    const busy = eng.stepAnim();
    if (!this.dirty && !moving && !busy) return;
    this.dirty = false;
    const t0 = performance.now();
    const ctx = this.ctx;
    const s = vp.s;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, vp.width, vp.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, -vp.x * s * dpr, -vp.y * s * dpr);

    const nearA = smooth(0.4, 0.6, s);
    const midA = smooth(0.07, 0.12, s) * (1 - nearA);
    const b = vp.bounds();
    const vis = s >= 0.07 ? eng.grid.query(b.x0, b.y0, b.x1, b.y1) : EMPTY;
    this.lastVisible = vis;
    this.beforeDraw?.(vis);

    this.drawGroups(1 - 0.75 * smooth(0.4, 0.8, s), 1 - smooth(0.35, 0.6, s));
    if (eng.anim.gconn) this.drawGroupDrag();
    this.wires = 0;
    if (midA > 0.01) this.drawMembers(vis, midA);
    if (eng.selNodes.size && nearA < 0.99) this.drawSelectedPath(1 - nearA);
    if (nearA > 0.01) {
      this.drawNear(vis, nearA);
      this.drawTransients();
    }
    this.stats = {
      mode: nearA > 0.5 ? 'NEAR' : s >= 0.07 ? 'MID' : 'FAR',
      scale: s,
      assetsDrawn: vis.size,
      wiresDrawn: nearA > 0.01 ? this.wires : 0,
      ms: performance.now() - t0,
      assets: eng.store.nodes.length,
      connections: eng.store.edgeList.length,
      groups: eng.groups.length,
    };
    this.opts.onFrame?.(this.stats);
    if (moving || busy) this.request();
  };

  // ------------------------------------------------------------------ far: group blocks and fat pipes

  private drawGroups(frameA: number, pipeA: number): void {
    const { ctx, engine: eng } = this;
    const s = eng.viewport.s;
    const b = eng.viewport.bounds();
    const dim = eng.selNodes.size > 0;
    const { gconn, hoverGE } = eng.anim;
    ctx.lineCap = 'round';
    for (const ge of eng.gedges) {
      const A = ge.a;
      const B = ge.b;
      const on = !dim || (eng.selGroups.has(A) && eng.selGroups.has(B));
      ctx.globalAlpha = pipeA * (on ? 1 : 0.12);
      const wpx = pipePx(ge.edges.length);
      ctx.lineWidth = Math.min(wpx / s, 0.9 * Math.min(A.h, B.h) + 2 * PAD);
      ctx.strokeStyle = this.c(A.type) + 'aa';
      ctx.beginPath();
      strokeSegs(ctx, groupEdgeSegs(ge));
      ctx.stroke();
      if (ge === eng.selGE || ge === hoverGE) {
        const sel = ge === eng.selGE;
        const pw = ctx.lineWidth;
        ctx.globalAlpha = pipeA * (sel ? 0.4 : 0.25);
        ctx.lineWidth = pw * 1.8 + 5 / s;
        ctx.stroke();
        ctx.globalAlpha = pipeA;
        ctx.strokeStyle = sel ? '#fff' : this.c(A.type);
        ctx.lineWidth = Math.max(2 / s, pw * 0.35);
        ctx.stroke();
      }
      if (ge.edges.length > 1 && wpx > 3.5 && ge.laneY === undefined) {
        ctx.globalAlpha = pipeA;
        ctx.fillStyle = '#e6e6ee';
        ctx.font = `600 ${13 / s}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(
          `×${ge.edges.length}`,
          (A.x + A.w + PAD + B.x - PAD) / 2,
          (A.y + A.h / 2 + B.y + B.h / 2) / 2 - wpx / s,
        );
      }
    }
    ctx.textAlign = 'left';
    for (const g of eng.groups) {
      let x = g.x - PAD;
      let y = g.y - PAD;
      let w = g.w + 2 * PAD;
      let h = g.h + 2 * PAD;
      if (x > b.x1 || y > b.y1 || x + w < b.x0 || y + h < b.y0) continue;
      const mn = 10 / s;
      if (w < mn) {
        x -= (mn - w) / 2;
        w = mn;
      }
      if (h < mn) {
        y -= (mn - h) / 2;
        h = mn;
      }
      const on = !dim || eng.selGroups.has(g);
      const col = this.c(g.type);
      ctx.globalAlpha = frameA * (on ? 1 : 0.25);
      ctx.fillStyle = col + '1f';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 40);
      ctx.fill();
      ctx.strokeStyle = col + (on && dim ? 'ff' : '88');
      ctx.lineWidth = 2 / s;
      ctx.stroke();
      if (
        g === eng.selGroup ||
        (eng.selGE && (g === eng.selGE.a || g === eng.selGE.b))
      ) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 4 / s;
        ctx.stroke();
        ctx.globalAlpha = frameA * 0.3;
        ctx.lineWidth = 12 / s;
        ctx.stroke();
      }
      const fs = Math.max(18, 13 / s);
      ctx.globalAlpha = frameA * (on ? 1 : 0.25);
      ctx.fillStyle = '#e6e6ee';
      ctx.font = `600 ${fs}px ${FONT}`;
      ctx.fillText(`${g.type} ×${g.nodes.length}`, x + 10, y - fs * 0.35);
    }
    const ha = frameA * (1 - smooth(0.45, 0.6, s)); // drag handles: egress on the right edge, ingress on the left
    if (ha > 0.02) {
      for (const g of eng.groups) {
        if (
          g.x - PAD > b.x1 ||
          g.y - PAD > b.y1 ||
          g.x + g.w + PAD < b.x0 ||
          g.y + g.h + PAD < b.y0
        )
          continue;
        const r = Math.max(4, 7 / s);
        const hy = g.y + g.h / 2;
        const hot = gconn?.from === g;
        const tgt = gconn?.target === g;
        for (const [hx, dir] of [
          [g.x + g.w + PAD, 1],
          [g.x - PAD, -1],
        ] as const) {
          ctx.globalAlpha =
            ha * ((hot && gconn?.dir === dir) || tgt ? 1 : 0.75);
          ctx.fillStyle = this.c(g.type);
          ctx.beginPath();
          ctx.arc(hx, hy, r, 0, 6.3);
          ctx.fill();
          ctx.globalAlpha = ha * 0.5;
          ctx.strokeStyle = this.background;
          ctx.lineWidth = 1.5 / s;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** The fat pipe following the cursor from a group handle; locks onto the target group's facing handle. */
  private drawGroupDrag(): void {
    const { ctx, engine: eng } = this;
    const c = eng.anim.gconn!;
    const s = eng.viewport.s;
    const g = c.from;
    const col = this.c(g.type);
    const hx = c.dir > 0 ? g.x + g.w + PAD : g.x - PAD;
    const hy = g.y + g.h / 2;
    let ex = c.x;
    let ey = c.y;
    if (c.target) {
      const t = c.target;
      const tx = c.dir > 0 ? t.x - PAD : t.x + t.w + PAD;
      const ty = t.y + t.h / 2;
      ex += (tx - ex) * c.pull;
      ey += (ty - ey) * c.pull;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3 / s;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.roundRect(t.x - PAD, t.y - PAD, t.w + 2 * PAD, t.h + 2 * PAD, 40);
      ctx.stroke();
      ctx.lineWidth = 2 / s;
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(eng.time * 8);
      ctx.beginPath();
      ctx.arc(tx, ty, 13 / s, 0, 6.3);
      ctx.stroke();
    }
    const lw = pipePx(g.nodes.length) / s;
    const lock = !!c.target;
    ctx.lineCap = 'round';
    ctx.beginPath();
    this.curve(
      c.dir > 0 ? hx : ex,
      c.dir > 0 ? hy : ey,
      c.dir > 0 ? ex : hx,
      c.dir > 0 ? ey : hy,
    );
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = lock ? col : '#fff';
    ctx.lineWidth = lw * 1.9;
    ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = lw;
    ctx.setLineDash(lock ? [] : [14 / s, 10 / s]);
    ctx.lineDashOffset = (-eng.time * 60) / s;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = lock ? col : '#fff';
    ctx.beginPath();
    ctx.arc(ex, ey, 7 / s, 0, 6.3);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private curve(x0: number, y0: number, x1: number, y1: number): void {
    const d = Math.max(60, Math.abs(x1 - x0) * 0.5);
    this.ctx.moveTo(x0, y0);
    this.ctx.bezierCurveTo(x0 + d, y0, x1 - d, y1, x1, y1);
  }

  // ------------------------------------------------------------------ mid: member tiles

  private drawMembers(vis: ReadonlySet<AssetNode>, alpha: number): void {
    if (vis.size > 6000) return;
    const { ctx, engine: eng } = this;
    const dim = eng.selNodes.size > 0;
    const buckets = new Map<string, AssetNode[]>();
    for (const n of vis) {
      const on = !dim || eng.selNodes.has(n);
      const k =
        (n.status === 'degraded' ? '#ff5a5a' : this.c(n.type)) +
        (on ? '' : '|d');
      let arr = buckets.get(k);
      if (!arr) buckets.set(k, (arr = []));
      arr.push(n);
    }
    for (const [k, arr] of buckets) {
      const [c, d] = k.split('|') as [string, string | undefined];
      ctx.globalAlpha = alpha * (d ? 0.2 : 1);
      ctx.fillStyle = c;
      ctx.beginPath();
      for (const n of arr) ctx.rect(n.x, n.y, n.w, n.h);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** The selected path as individual wires (zoomed out), batched into one path and culled to the viewport. */
  private drawSelectedPath(alpha: number): void {
    const { ctx, engine: eng } = this;
    const s = eng.viewport.s;
    const b = eng.viewport.bounds();
    let n = 0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const pass of [0, 1]) {
      ctx.beginPath();
      for (const e of eng.selEdges) {
        const A = e.a;
        const B = e.b;
        if (Math.max(A.x + A.w, B.x + B.w) < b.x0 || Math.min(A.x, B.x) > b.x1)
          continue;
        if (
          e.ge?.laneY === undefined &&
          (Math.max(A.y, B.y) < b.y0 || Math.min(A.y, B.y) > b.y1)
        )
          continue;
        if (pass === 0 && ++n > 4000) break;
        strokeSegs(ctx, edgeSegs(e));
      }
      ctx.globalAlpha = alpha * (pass ? 0.95 : 0.25);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = (pass ? 1.6 : 6) / s;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ near: cards, ports and wires

  private drawNear(vis: ReadonlySet<AssetNode>, alpha: number): void {
    const { ctx, engine: eng } = this;
    const s = eng.viewport.s;
    const time = eng.time;
    const dim = eng.selNodes.size > 0;
    const lw = 2.4 / Math.min(1, s);
    const stamp = ++this.stamp;
    let drawn = 0;
    ctx.lineCap = 'round';
    for (const n of vis) {
      n.hiP.length = n.ins.length;
      n.hiP.fill(0);
      n.hiC.length = n.ins.length;
      n.hiC.fill('');
      n.hoP.length = n.outs.length;
      n.hoP.fill(0);
    }
    const glowEdges: Edge[] = [];
    for (const n of vis) {
      for (let pass = 0; pass < 2; pass++) {
        for (const e of pass ? n.in : n.out) {
          if (e.stamp === stamp) continue;
          e.stamp = stamp;
          const A = e.a;
          const B = e.b;
          const va = vis.has(A);
          const vb = vis.has(B);
          const picked = eng.selEdges.has(e);
          if (!(va && vb) && !picked) {
            if (va)
              A.hoP[e.ai] = (A.hoP[e.ai] ?? 0) + 1; // off-screen: one stub per port, with a count
            else {
              B.hiP[e.bi] = (B.hiP[e.bi] ?? 0) + 1;
              B.hiC[e.bi] = this.c(A.type);
            }
            continue;
          }
          if (!picked && drawn++ > 1500) continue;
          const on = !dim || picked;
          const fade = e.deleting
            ? 0.35 + 0.1 * Math.sin(time * 4)
            : e.pending
              ? 0.6 + 0.22 * Math.sin(time * 5)
              : 1;
          ctx.globalAlpha = alpha * (on ? 1 : 0.08) * fade;
          ctx.strokeStyle = e.deleting ? '#ff6b6b' : this.c(A.type);
          ctx.lineWidth = lw;
          ctx.setLineDash(e.enabled ? [] : [14, 10]);
          ctx.beginPath();
          strokeSegs(ctx, edgeSegs(e));
          ctx.stroke();
          if (e.ct !== undefined) {
            const k = (time - e.ct) / 0.5;
            if (k >= 1) e.ct = undefined;
            else {
              ctx.globalAlpha = alpha * 0.4 * (1 - k);
              ctx.lineWidth = lw * 5;
              ctx.stroke();
              ctx.lineWidth = lw;
            }
          }
          if (dim && on && glowEdges.length < 500) glowEdges.push(e);
        }
      }
    }
    this.wires = drawn;
    ctx.setLineDash([]);
    for (const e of glowEdges) {
      // selected path: wide glow + flowing dashes
      ctx.beginPath();
      strokeSegs(ctx, edgeSegs(e));
      ctx.globalAlpha = alpha * 0.18;
      ctx.strokeStyle = this.c(e.a.type);
      ctx.lineWidth = lw * 4;
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = lw * 0.5;
      ctx.setLineDash([10, 26]);
      ctx.lineDashOffset = -time * 90;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const e of [eng.anim.hoverEdge, eng.selEdge]) {
      // hovered / selected wire sits above the rest
      if (!e) continue;
      const sel = e === eng.selEdge;
      ctx.beginPath();
      strokeSegs(ctx, edgeSegs(e));
      ctx.globalAlpha = alpha * (sel ? 0.4 : 0.22);
      ctx.strokeStyle = this.c(e.a.type);
      ctx.lineWidth = lw * (sel ? 7 : 5);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = sel ? '#fff' : this.c(e.a.type);
      ctx.lineWidth = lw * (sel ? 1.8 : 1.5);
      ctx.stroke();
    }
    for (const n of vis) this.drawCard(n, alpha, dim, s, time);
    if (eng.selEdge) {
      // ring both ends of the selected wire
      const e = eng.selEdge;
      ctx.strokeStyle = this.c(e.a.type);
      ctx.lineWidth = 2.5 / Math.min(1, s);
      ctx.globalAlpha = alpha;
      for (const [x, y] of [
        [e.a.x + e.a.w, portY(e.a, e.ai)],
        [e.b.x, portY(e.b, e.bi)],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x, y, 12 / Math.min(1, s), 0, 6.3);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawCard(
    n: AssetNode,
    alpha: number,
    dim: boolean,
    s: number,
    time: number,
  ): void {
    const { ctx, engine: eng } = this;
    const col = this.c(n.type);
    ctx.globalAlpha = alpha * (!dim || eng.selNodes.has(n) ? 1 : 0.3);
    const ca = ctx.globalAlpha;
    const pg = n.bt != null ? Math.max(0, 1 - (time - n.bt) / 1.3) : 0;
    const gg = Math.max(n.gl, pg);
    if (gg > 0.02) {
      ctx.shadowColor = col;
      ctx.shadowBlur = 50 * gg * Math.min(1, s * 2);
    }
    ctx.fillStyle = '#17171d';
    ctx.beginPath();
    ctx.roundRect(n.x, n.y, n.w, n.h, 14);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = gg > 0.02 ? col : '#262630';
    ctx.lineWidth = 1.5 + 1.5 * gg;
    ctx.stroke();
    if (pg > 0.02 && n.bt !== null) {
      // light washes in from the connected side, with a bright bar running down that edge
      const sx = n.bside < 0 ? n.x : n.x + n.w;
      const gr = ctx.createLinearGradient(sx, 0, sx - n.bside * 100, 0);
      gr.addColorStop(0, col);
      gr.addColorStop(1, col + '00');
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(n.x, n.y, n.w, n.h, 14);
      ctx.clip();
      ctx.globalAlpha = ca * pg * 0.55;
      ctx.fillStyle = gr;
      ctx.fillRect(n.x, n.y, n.w, n.h);
      ctx.globalAlpha = ca * Math.min(1, pg * 1.5);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      const run = Math.min(1, (time - n.bt) / 0.55);
      const cy = n.y + 14 + (n.h - 28) * run * (2 - run);
      const half = Math.min(34, n.h * 0.3);
      ctx.beginPath();
      ctx.moveTo(sx - n.bside * 2, Math.max(n.y + 8, cy - half));
      ctx.lineTo(sx - n.bside * 2, Math.min(n.y + n.h - 8, cy + half));
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(n.x + 20, n.y + 26, 5, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = '#f1f1f6';
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(n.name, n.x + 34, n.y + 31);
    ctx.fillStyle = '#6d6d7a';
    ctx.font = `12px ${FONT}`;
    ctx.fillText(
      `${n.type} · in ${n.in.length} out ${n.out.length}`,
      n.x + 18,
      n.y + 52,
    );
    const ok = n.status === 'ready';
    ctx.fillStyle = ok ? '#7de08a' : '#ff6b6b';
    ctx.beginPath();
    ctx.arc(n.x + 22, n.y + n.h - 14, 3.5, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = '#8f8f9c';
    ctx.fillText(
      ok ? 'All inputs ready' : n.status === 'degraded' ? 'Degraded' : n.status,
      n.x + 34,
      n.y + n.h - 10,
    );
    n.ins.forEach((p, k) =>
      this.drawPort(
        n.x,
        portY(n, k),
        col,
        n.gl,
        -1,
        n.hiP[k] ?? 0,
        p.name,
        n.hiC[k] || col,
        time,
      ),
    );
    n.outs.forEach((p, k) =>
      this.drawPort(
        n.x + n.w,
        portY(n, k),
        col,
        n.gl,
        1,
        n.hoP[k] ?? 0,
        p.name,
        col,
        time,
      ),
    );
  }

  private drawPort(
    x: number,
    y: number,
    color: string,
    gl: number,
    dir: 1 | -1,
    hidden: number,
    label: string,
    stub: string,
    time: number,
  ): void {
    const ctx = this.ctx;
    if (gl > 0.02) {
      ctx.strokeStyle = color + '88';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 10 + 4 * Math.sin(time * 5) * gl, 0, 6.3);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = '#b4b4c2';
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = dir > 0 ? 'right' : 'left';
    ctx.fillText(label, x - dir * 14, y + 4);
    ctx.textAlign = 'left';
    if (hidden) {
      // off-screen connections: one stub with a count, not N overlapping wires
      ctx.strokeStyle = stub + '99';
      ctx.lineWidth = Math.min(14, 2 + Math.log2(hidden + 1) * 1.2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + dir * 90, y);
      ctx.stroke();
      if (hidden > 1) {
        ctx.fillStyle = '#e6e6ee';
        ctx.font = `600 12px ${FONT}`;
        ctx.textAlign = dir > 0 ? 'left' : 'right';
        ctx.fillText(`+${hidden}`, x + dir * 98, y + 4);
        ctx.textAlign = 'left';
      }
    }
  }

  // ------------------------------------------------------------------ drag, connect and delete feedback

  private drawTransients(): void {
    const { ctx, engine: eng } = this;
    const A = eng.anim;
    const s = eng.viewport.s;
    const time = eng.time;
    const lw = 2.4 / Math.min(1, s);
    if (A.flash) {
      // a new wire: glow, port springs, a ring at the target
      const f = A.flash;
      const age = time - f.t0;
      const k = 1 - age / 0.9;
      if (k <= 0) A.flash = null;
      else {
        const e = f.e;
        ctx.lineCap = 'round';
        ctx.beginPath();
        strokeSegs(ctx, edgeSegs(e));
        ctx.globalAlpha = k * 0.35;
        ctx.strokeStyle = this.c(e.a.type);
        ctx.lineWidth = lw * 6;
        ctx.stroke();
        ctx.globalAlpha = k;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = lw * 1.4;
        ctx.stroke();
        const spring = 1 + 0.9 * Math.exp(-age * 5) * Math.cos(age * 20);
        for (const [n, x, y] of [
          [e.a, e.a.x + e.a.w, portY(e.a, e.ai)],
          [e.b, e.b.x, portY(e.b, e.bi)],
        ] as const) {
          ctx.globalAlpha = Math.min(1, k * 2);
          ctx.fillStyle = this.c(n.type);
          ctx.beginPath();
          ctx.arc(x, y, 6 * spring, 0, 6.3);
          ctx.fill();
        }
        const t = f.node;
        ctx.globalAlpha = k;
        ctx.strokeStyle = this.c(t.type);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(t.x, portY(t, f.idx), 10 + age * 70, 0, 6.3);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (A.ghost) {
      // a deleted wire thins out and fades
      const k = (time - A.ghost.t0) / 0.35;
      if (k >= 1) A.ghost = null;
      else {
        ctx.lineCap = 'round';
        ctx.beginPath();
        strokeSegs(ctx, A.ghost.segs);
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = this.c(A.ghost.type);
        ctx.lineWidth = lw * (1 - 0.8 * k);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    const conn = A.conn;
    const c = conn ?? A.retract;
    if (!c) return;
    const n = c.from;
    const col = this.c(n.type);
    const px = n.x + (c.dir > 0 ? n.w : 0);
    const py = portY(n, c.idx);
    let ex = c.x;
    let ey = c.y;
    let fade = 1;
    if (conn) {
      // valid ports pulse; the one in range gets a bigger ring
      ctx.lineWidth = 2 / Math.min(1, s);
      ctx.strokeStyle = col;
      for (const o of this.lastVisible) {
        if (o === n) continue;
        const arr = c.dir > 0 ? o.ins : o.outs;
        const ox = c.dir > 0 ? o.x : o.x + o.w;
        for (let k = 0; k < arr.length; k++) {
          const hot = conn.near?.node === o && conn.near.idx === k;
          ctx.globalAlpha = hot ? 1 : 0.3 + 0.25 * Math.sin(time * 6);
          ctx.beginPath();
          ctx.arc(
            ox,
            portY(o, k),
            hot
              ? ringR(s) + (2 / s) * Math.sin(time * 10)
              : Math.max(11, 13 / s),
            0,
            6.3,
          );
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      if (conn.pull > 0.003 && conn.pt) {
        ex += (conn.pt.x - ex) * conn.pull;
        ey += (conn.pt.y - ey) * conn.pull;
      }
    } else {
      const k = Math.min(1, (time - (A.retract?.t0 ?? 0)) / 0.22);
      if (k >= 1) {
        A.retract = null;
        return;
      }
      ex = c.x + (px - c.x) * k * k;
      ey = c.y + (py - c.y) * k * k;
      fade = 1 - k;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.curve(
      c.dir > 0 ? px : ex,
      c.dir > 0 ? py : ey,
      c.dir > 0 ? ex : px,
      c.dir > 0 ? ey : py,
    );
    const wc = conn?.snap ? col : '#fff';
    ctx.globalAlpha = 0.22 * fade;
    ctx.strokeStyle = wc;
    ctx.lineWidth = lw * 5;
    ctx.stroke();
    ctx.globalAlpha = fade;
    ctx.lineWidth = lw * 1.2;
    ctx.stroke();
    ctx.fillStyle = wc;
    ctx.beginPath();
    ctx.arc(ex, ey, 5, 0, 6.3);
    ctx.fill();
    if (conn?.near && !conn.snap) {
      // electricity: a jagged arc bridges the gap from the wire's tip to the port
      const t = conn.near;
      const tx = t.node.x + (c.dir > 0 ? 0 : t.node.w);
      const ty = portY(t.node, t.idx);
      const dx = tx - ex;
      const dy = ty - ey;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const segs = Math.max(6, Math.min(40, Math.round((len * s) / 5)));
      const amp = (3 + 6 * conn.elec) / s;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      for (let i = 1; i < segs; i++) {
        const u = i / segs;
        const o = (Math.random() * 2 - 1) * amp * Math.sin(Math.PI * u) * 1.4;
        ctx.lineTo(ex + dx * u + nx * o, ey + dy * u + ny * o);
      }
      ctx.lineTo(tx, ty);
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = col;
      ctx.lineWidth = lw * 4;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = lw * 1.1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
