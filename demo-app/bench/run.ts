import { GraphEngine } from '#src/-private/engine/engine.ts';
import { pickEdge } from '#src/-private/engine/picking.ts';
import { effectivePixelRatio } from '#src/-private/engine/pixel-ratio.ts';
import { Renderer } from '#src/-private/engine/renderer.ts';
import type { GraphInput } from '#src/index.ts';
import { fan, type Draft } from '../data.ts';

export interface BenchRow {
  group: 'data' | 'draw';
  name: string;
  median: number;
  p95: number;
  runs: number;
  note?: string;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0)); // let the page paint progress between phases

function stats(samples: number[]): { median: number; p95: number } {
  const v = [...samples].sort((a, b) => a - b);
  return {
    median: v[Math.floor(v.length / 2)]!,
    p95: v[Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1)]!,
  };
}

function time(f: () => void): number {
  const t = performance.now();
  f();
  return performance.now() - t;
}

/** Jump the camera to a scale and a point, with no easing. */
function snap(engine: GraphEngine, x: number, y: number, scale: number): void {
  const vp = engine.viewport;
  vp.centerOn(x, y, scale);
  for (let i = 0; i < 400 && vp.step(); i++);
}

/**
 * Times the whole pipeline on one graph: the model (sync, layout, connection changes), then drawing frames at each zoom
 * level on a real canvas. Frames are drawn synchronously with `renderOnce`, so this measures drawing, not the display's
 * schedule, and works in a background tab.
 */
export async function runBench(
  assets: number,
  progress: (what: string) => void,
): Promise<{ rows: BenchRow[]; entities: number }> {
  const rows: BenchRow[] = [];
  const add = (
    group: BenchRow['group'],
    name: string,
    samples: number[],
    note?: string,
  ) =>
    rows.push({ group, name, ...stats(samples), runs: samples.length, note });

  const draft: Draft = { assets: [], connections: [] };
  fan('b-', assets, draft);
  let data: GraphInput = draft;
  const entities = draft.assets.length + draft.connections.length;

  const engine = new GraphEngine();
  progress('first sync + layout');
  await tick();
  add(
    'data',
    'First sync + layout',
    [time(() => engine.sync(data))],
    `${entities.toLocaleString()} entities`,
  );

  progress('one-field updates');
  await tick();
  const idx = Math.floor(data.assets.length / 2);
  let flip = false;
  const oneField: number[] = [];
  const unchanged: number[] = [];
  for (let i = 0; i < 25; i++) {
    flip = !flip;
    data = {
      ...data,
      assets: data.assets.map((a, k) =>
        k === idx ? { ...a, status: flip ? 'degraded' : 'ready' } : a,
      ),
    };
    const d = data;
    oneField.push(time(() => engine.sync(d)));
    data = { assets: [...data.assets], connections: [...data.connections] };
    const d2 = data;
    unchanged.push(time(() => engine.sync(d2)));
  }
  add(
    'data',
    'Sync: one field changed',
    oneField,
    'what a subscription tick costs',
  );
  add('data', 'Sync: nothing changed', unchanged);

  progress('adding connections');
  await tick();
  const added: number[] = [];
  for (let i = 0; i < 9; i++) {
    data = {
      assets: data.assets,
      connections: [
        ...data.connections,
        {
          id: `x${i}`,
          from: { assetId: 'b-src0', portId: 'b-src0:out:A' },
          to: { assetId: 'b-sink0', portId: 'b-sink0:in:1' },
        },
      ],
    };
    const d = data;
    added.push(time(() => engine.sync(d)));
  }
  add('data', 'Sync: one connection added', added);

  progress('relayout');
  await tick();
  add(
    'data',
    'Relayout (everything)',
    Array.from({ length: 7 }, () => time(() => engine.relayout('bench'))),
  );

  // ---- drawing, on a real canvas
  const canvas = document.createElement('canvas');
  const renderer = new Renderer(canvas, engine, {});
  const ratio = effectivePixelRatio(window.devicePixelRatio);
  renderer.resize(1400, 800, ratio);
  const frames = (n: number): number[] =>
    Array.from({ length: n }, (_, i) => renderer.renderOnce(1000 + i * 16).ms);
  const main = engine.comps.reduce(
    (a, c) => (c.bbox.w * c.bbox.h > a.bbox.w * a.bbox.h ? c : a),
    engine.comps[0]!,
  );
  const mid = {
    x: main.bbox.x + main.bbox.w / 2,
    y: main.bbox.y + main.bbox.h / 2,
  };
  const sw = engine.store.assets.get('b-switch')!;

  progress('drawing: all groups');
  await tick();
  engine.fitAll(true);
  engine.viewport.setSize(1400, 800);
  snap(engine, mid.x, mid.y, engine.viewport.targetScale);
  frames(3);
  add(
    'draw',
    'Frame: zoomed out (group blocks, fat pipes)',
    frames(40),
    `canvas 1400×800 at ${ratio}×`,
  );

  progress('drawing: tiles');
  await tick();
  snap(engine, sw.x, sw.y, 0.12);
  frames(3);
  const tiles = frames(40);
  add(
    'draw',
    'Frame: middle (member tiles)',
    tiles,
    `${renderer.stats?.assetsDrawn ?? 0} assets in view`,
  );

  progress('drawing: cards');
  await tick();
  snap(engine, sw.x + 600, sw.y, 0.8);
  frames(3);
  const cards = frames(40);
  add(
    'draw',
    'Frame: zoomed in (cards, ports, wires)',
    cards,
    `${renderer.stats?.assetsDrawn ?? 0} assets, ${renderer.stats?.wiresDrawn ?? 0} wires in view`,
  );

  progress('drawing: a selection');
  await tick();
  engine.select({ node: sw });
  frames(3);
  add(
    'draw',
    'Frame: zoomed in, with a selected hub',
    frames(40),
    'the selected path animates every frame',
  );
  snap(engine, sw.x, sw.y, 0.12);
  frames(3);
  add(
    'draw',
    'Frame: middle, with a selected hub',
    frames(40),
    `${engine.selEdges.size.toLocaleString()} wires highlighted`,
  );
  engine.select(null);

  progress('hit testing');
  await tick();
  snap(engine, sw.x + 600, sw.y, 0.8);
  renderer.renderOnce(5000);
  const vis = renderer.lastVisible;
  const w = engine.viewport.toWorld(700, 400);
  add(
    'draw',
    'Hover: find the wire under the cursor',
    Array.from({ length: 40 }, () =>
      time(() =>
        pickEdge(w.x, w.y, engine.viewport.s, vis, engine.nextPickStamp()),
      ),
    ),
    'runs on every pointer move',
  );

  renderer.destroy();
  return { rows, entities };
}
