import type { GraphInput } from '#src/index.ts';
import {
  asset,
  fan,
  link,
  loop,
  side,
  stragglers,
  type Draft,
} from './data.ts';

// Small graphs for the cookbook's live examples.

/** The demo data marks ~5% of assets degraded at random; the samples are deterministic (nothing degraded unless a sample says so). */
const done = (d: Draft, degraded: readonly string[] = []): GraphInput => {
  d.assets = d.assets.map((a) => ({
    ...a,
    status: degraded.includes(a.id) ? 'degraded' : 'ready',
  }));
  return d;
};

/** Five assets in a row, one of them fanning out: the smallest graph that shows layers, ports and a fan. */
export function chain(): GraphInput {
  const d: Draft = { assets: [], connections: [] };
  d.assets.push(
    asset('source', 'source', [], ['A']),
    asset('switch', 'switch', ['1'], ['A', 'B']),
    asset('worker-1', 'process', ['1'], ['A']),
    asset('worker-2', 'process', ['1'], ['A']),
    asset('worker-3', 'process', ['1'], ['A']),
    asset('sink', 'sink', ['1', '2', '3'], []),
  );
  d.connections.push(link('c1', 'source', 'A', 'switch', '1'));
  for (let i = 1; i <= 3; i++) {
    d.connections.push(
      link(`c-sw-${i}`, 'switch', 'A', `worker-${i}`, '1'),
      link(`c-w-${i}`, `worker-${i}`, 'A', 'sink', String(i)),
    );
  }
  return done(d, ['worker-2']); // one degraded asset, so you can see what that looks like
}

/** A loop, a layer-skipping connection, a side pipeline and some assets nothing is connected to. */
export function layoutRules(): GraphInput {
  const d: Draft = { assets: [], connections: [] };
  loop('', 5, d);
  side('side-', ['source', 'ingest', 'store'], d);
  stragglers(10, d);
  return done(d);
}

/** 1 switch -> 24 assets -> 1 aggregator, with the sources and sinks around them: for group-level work. */
export function bulk(): GraphInput {
  const d: Draft = { assets: [], connections: [] };
  fan('', 24, d);
  return done(d);
}

/** Enough to watch a subscription: 150 assets, ~300 connections. */
export function medium(): GraphInput {
  const d: Draft = { assets: [], connections: [] };
  fan('', 150, d);
  return done(d);
}
