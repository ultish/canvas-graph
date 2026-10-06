import type { AssetInput, ConnectionInput, GraphInput } from '#src/index.ts';

// Demo data in the shape your GraphQL model has: assets own input and output ports (objects with an id and a name),
// connections point at port ids.

export interface Draft {
  assets: AssetInput[];
  connections: ConnectionInput[];
}

let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

export const asset = (
  id: string,
  type: string,
  ins: string[],
  outs: string[],
): AssetInput => ({
  id,
  name: id,
  type,
  status: rnd() < 0.05 ? 'degraded' : 'ready',
  inputPorts: ins.map((n) => ({ id: `${id}:in:${n}`, name: n })),
  outputPorts: outs.map((n) => ({ id: `${id}:out:${n}`, name: n })),
});

export const link = (
  id: string,
  a: string,
  ap: string,
  b: string,
  bp: string,
): ConnectionInput => ({
  id,
  from: { assetId: a, portId: `${a}:out:${ap}` },
  to: { assetId: b, portId: `${b}:in:${bp}` },
});

/** 10 sources -> 1 switch -> N assets (three types) -> 1 aggregator -> 5 sinks */
export function fan(prefix: string, n: number, out: Draft): void {
  const id = (s: string) => `${prefix}${s}`;
  for (let i = 0; i < 10; i++)
    out.assets.push(asset(id(`src${i}`), 'source', [], ['A']));
  out.assets.push(
    asset(
      id('switch'),
      'switch',
      Array.from({ length: 10 }, (_, i) => String(i + 1)),
      ['A'],
    ),
  );
  out.assets.push(
    asset(id('aggregator'), 'aggregator', ['1'], ['A', 'B', 'C', 'D', 'E']),
  );
  for (let i = 0; i < 5; i++)
    out.assets.push(asset(id(`sink${i}`), 'sink', ['1'], []));
  for (let i = 0; i < 10; i++)
    out.connections.push(
      link(id(`c-src${i}`), id(`src${i}`), 'A', id('switch'), String(i + 1)),
    );
  for (let i = 0; i < n; i++) {
    const type = rnd() < 0.6 ? 'process' : rnd() < 0.6 ? 'storage' : 'gpu';
    out.assets.push(asset(id(`asset${i}`), type, ['1'], ['A']));
    out.connections.push(
      link(id(`c-sw-${i}`), id('switch'), 'A', id(`asset${i}`), '1'),
    );
    out.connections.push(
      link(id(`c-agg-${i}`), id(`asset${i}`), 'A', id('aggregator'), '1'),
    );
  }
  for (let i = 0; i < 5; i++)
    out.connections.push(
      link(
        id(`c-sink${i}`),
        id('aggregator'),
        'ABCDE'[i]!,
        id(`sink${i}`),
        '1',
      ),
    );
}

/** a1 -> a2 -> a3 -> (fan of N) -> a4 -> a5 -> a2 (loop back); a2 -> a6 -> a7 -> a8; a1 -> a4 skips layers */
export function loop(prefix: string, n: number, out: Draft): void {
  const names = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];
  const types = [
    'source',
    'ingest',
    'route',
    'relay',
    'store',
    'aggregator',
    'process',
    'sink',
  ];
  const id = (s: string) => `${prefix}${s}`;
  names.forEach((nm, i) =>
    out.assets.push(asset(id(nm), types[i]!, ['1', '2'], ['A', 'B', 'C'])),
  );
  out.connections.push(
    link(id('l12'), id('a1'), 'A', id('a2'), '1'),
    link(id('l23'), id('a2'), 'A', id('a3'), '1'),
    link(id('l45'), id('a4'), 'A', id('a5'), '1'),
    link(id('l52'), id('a5'), 'A', id('a2'), '2'),
    link(id('l26'), id('a2'), 'B', id('a6'), '1'),
    link(id('l67'), id('a6'), 'A', id('a7'), '1'),
    link(id('l78'), id('a7'), 'A', id('a8'), '1'),
    link(id('l14'), id('a1'), 'B', id('a4'), '2'),
  );
  for (let i = 0; i < n; i++) {
    out.assets.push(asset(id(`par${i}`), 'enrich', ['1'], ['A']));
    out.connections.push(
      link(id(`l3p${i}`), id('a3'), 'A', id(`par${i}`), '1'),
      link(id(`lp${i}4`), id(`par${i}`), 'A', id('a4'), '1'),
    );
  }
}

/** A small pipeline that sits to the side: connected to each other, not to the rest. */
export function side(prefix: string, types: string[], out: Draft): void {
  types.forEach((t, i) =>
    out.assets.push(asset(`${prefix}${i}`, t, ['1'], ['A'])),
  );
  for (let i = 0; i + 1 < types.length; i++)
    out.connections.push(
      link(`${prefix}l${i}`, `${prefix}${i}`, 'A', `${prefix}${i + 1}`, '1'),
    );
}

/** Assets nothing is connected to yet. */
export function stragglers(n: number, out: Draft): void {
  const types = ['process', 'storage', 'sink', 'spare'];
  for (let i = 0; i < n; i++)
    out.assets.push(
      asset(`spare-${i}`, types[i % types.length]!, ['1'], ['A']),
    );
}

/** The landing page's graph. `?assets=N` in the URL sets the size of the big fan (default 800; try 5000 or 20000). */
export function buildDemo(big = 800): GraphInput {
  const out: Draft = { assets: [], connections: [] };
  fan('fan1-', big, out);
  loop('loop1-', 40, out);
  fan('fan2-', Math.round(big / 2), out);
  loop('loop2-', 150, out);
  side('side1-', ['source', 'ingest', 'store'], out);
  side('side2-', ['source', 'route', 'enrich', 'sink'], out);
  side('side3-', ['ingest', 'store'], out);
  stragglers(45, out);
  return out;
}
