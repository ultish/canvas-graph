import type {
  AssetInput,
  ConnectionInput,
  GraphInput,
} from '../../src/-private/engine/types.ts';

export const asset = (
  id: string,
  type: string,
  ins: string[] = ['1'],
  outs: string[] = ['A'],
  extra: Partial<AssetInput> = {},
): AssetInput => ({
  id,
  name: id,
  type,
  inputPorts: ins.map((n) => ({ id: `${id}:in:${n}`, name: n })),
  outputPorts: outs.map((n) => ({ id: `${id}:out:${n}`, name: n })),
  ...extra,
});

export const link = (
  id: string,
  a: string,
  ap: string,
  b: string,
  bp: string,
  extra: Partial<ConnectionInput> = {},
): ConnectionInput => ({
  id,
  from: { assetId: a, portId: `${a}:out:${ap}` },
  to: { assetId: b, portId: `${b}:in:${bp}` },
  ...extra,
});

/** 10 sources -> switch -> N assets -> aggregator -> 5 sinks */
export function fan(n: number, prefix = ''): GraphInput {
  const assets: AssetInput[] = [];
  const connections: ConnectionInput[] = [];
  const id = (s: string) => `${prefix}${s}`;
  for (let i = 0; i < 10; i++)
    assets.push(asset(id(`src${i}`), 'source', [], ['A']));
  assets.push(
    asset(
      id('sw'),
      'switch',
      Array.from({ length: 10 }, (_, i) => String(i + 1)),
      ['A'],
    ),
  );
  assets.push(asset(id('agg'), 'aggregator', ['1'], ['A', 'B', 'C', 'D', 'E']));
  for (let i = 0; i < 5; i++)
    assets.push(asset(id(`sink${i}`), 'sink', ['1'], []));
  for (let i = 0; i < 10; i++)
    connections.push(
      link(id(`c-src${i}`), id(`src${i}`), 'A', id('sw'), String(i + 1)),
    );
  for (let i = 0; i < n; i++) {
    const t = i % 3 === 0 ? 'storage' : 'process';
    assets.push(asset(id(`p${i}`), t));
    connections.push(link(id(`c-sw-p${i}`), id('sw'), 'A', id(`p${i}`), '1'));
    connections.push(link(id(`c-p${i}-agg`), id(`p${i}`), 'A', id('agg'), '1'));
  }
  for (let i = 0; i < 5; i++)
    connections.push(
      link(id(`c-agg-s${i}`), id('agg'), 'ABCDE'[i]!, id(`sink${i}`), '1'),
    );
  return { assets, connections };
}

/** a1 -> a2 -> a3 -> (fan of N) -> a4 -> a5 -> a2 (loop back), a2 -> a6 -> a7 -> a8, plus a1 -> a4 (skips layers) */
export function loop(n = 3): GraphInput {
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
  const assets = names.map((nm, i) =>
    asset(nm, types[i]!, ['1', '2'], ['A', 'B']),
  );
  const connections: ConnectionInput[] = [
    link('l12', 'a1', 'A', 'a2', '1'),
    link('l23', 'a2', 'A', 'a3', '1'),
    link('l45', 'a4', 'A', 'a5', '1'),
    link('l52', 'a5', 'A', 'a2', '2'), // closes the loop
    link('l26', 'a2', 'B', 'a6', '1'),
    link('l67', 'a6', 'A', 'a7', '1'),
    link('l78', 'a7', 'A', 'a8', '1'),
    link('l14', 'a1', 'B', 'a4', '2'), // skips a2 and a3
  ];
  for (let i = 0; i < n; i++) {
    assets.push(asset(`par${i}`, 'enrich'));
    connections.push(
      link(`l3p${i}`, 'a3', 'A', `par${i}`, '1'),
      link(`lp${i}4`, `par${i}`, 'A', 'a4', '1'),
    );
  }
  return { assets, connections };
}
