import { describe, expect, it } from 'vitest';
import { GraphEngine } from '../../src/-private/engine/engine.ts';
import { routeEdges } from '../../src/-private/engine/layout.ts';
import type {
  ConnectionInput,
  GraphInput,
} from '../../src/-private/engine/types.ts';
import { fan, link, loop } from './fixtures.ts';

const seeded = (seed: number) => () =>
  (seed = (seed * 16807) % 2147483647) / 2147483647;

/** What a set of pipes says, ignoring object identity and array order. */
const describePipes = (gedges: ReturnType<GraphEngine['gedges']['slice']>) =>
  gedges
    .map(
      (ge) =>
        `${ge.a.key}@${ge.a.comp.nodes[0]!.id} ${ge.back ? '<' : '>'} ${ge.b.key} x${ge.edges.length} ${ge.skip ? 'skip' : ''} ${ge.laneY === undefined ? 'straight' : 'laned'}`,
    )
    .sort();

/** No two pipes whose spans overlap may share a lane. */
function lanesDoNotOverlap(gedges: GraphEngine['gedges']): boolean {
  const laned = gedges.filter((g) => g.laneY !== undefined);
  for (let i = 0; i < laned.length; i++)
    for (let j = i + 1; j < laned.length; j++) {
      const p = laned[i]!;
      const q = laned[j]!;
      if (p.a.comp !== q.a.comp || p.back !== q.back) continue;
      const overlap =
        Math.max(
          Math.min(p.a.layer, p.b.layer),
          Math.min(q.a.layer, q.b.layer),
        ) <=
        Math.min(
          Math.max(p.a.layer, p.b.layer),
          Math.max(q.a.layer, q.b.layer),
        );
      if (overlap && p.laneY === q.laneY) return false;
    }
  return true;
}

function check(e: GraphEngine, label: string) {
  for (const edge of e.store.edgeList) {
    expect(edge.ge, `${label}: ${edge.id} has a pipe`).not.toBeNull();
    expect(
      edge.ge!.edges.includes(edge),
      `${label}: pipe lists ${edge.id}`,
    ).toBe(true);
    expect(e.gedges.includes(edge.ge!), `${label}: pipe is live`).toBe(true);
  }
  expect(lanesDoNotOverlap(e.gedges), `${label}: lanes`).toBe(true);
  // a from-scratch rebuild re-points every edge at its own new pipes, so put the engine's back afterwards
  const saved = e.store.edgeList.map((x) => x.ge);
  const fresh = routeEdges(e.store.edgeList, e.groups, e.comps);
  const freshPipes = describePipes(fresh);
  e.store.edgeList.forEach((x, i) => (x.ge = saved[i]!));
  expect(describePipes(e.gedges), label).toEqual(freshPipes);
}

describe('incremental routing', () => {
  it('stays identical to a from-scratch rebuild through a long random mix of connects, deletes and syncs', () => {
    const rnd = seeded(42);
    const base: GraphInput = {
      assets: [...loop(6).assets, ...fan(25, 'f-').assets],
      connections: [...loop(6).connections, ...fan(25, 'f-').connections],
    };
    const e = new GraphEngine();
    e.sync(base);
    check(e, 'start');
    let data: GraphInput = base;
    let ops = 0;
    for (let step = 0; step < 120; step++) {
      const nodes = e.store.nodes;
      const pick = rnd();
      if (pick < 0.4) {
        // the user draws a connection between two random ports
        const a = nodes[Math.floor(rnd() * nodes.length)]!;
        const b = nodes[Math.floor(rnd() * nodes.length)]!;
        if (
          a.outs.length &&
          b.ins.length &&
          e.requestConnectPorts(
            a,
            Math.floor(rnd() * a.outs.length),
            b,
            Math.floor(rnd() * b.ins.length),
          )
        )
          ops++;
      } else if (pick < 0.7) {
        // the user deletes a random connection
        const edges = e.store.edgeList;
        if (edges.length > 10)
          ops += e.requestDisconnect(
            [edges[Math.floor(rnd() * edges.length)]!],
            'edge',
          )
            ? 1
            : 0;
      } else if (pick < 0.85) {
        // the host's data gains a connection
        const a = nodes[Math.floor(rnd() * nodes.length)]!;
        const b = nodes[Math.floor(rnd() * nodes.length)]!;
        if (a !== b && a.outs.length && b.ins.length) {
          const raw: ConnectionInput = link(
            `h${step}`,
            a.id,
            a.outs[0]!.name,
            b.id,
            b.ins[0]!.name,
          );
          data = { ...data, connections: [...data.connections, raw] };
          e.sync(data);
          ops++;
        }
      } else if (data.connections.length > 10) {
        // ...or loses one
        const drop =
          data.connections[Math.floor(rnd() * data.connections.length)]!;
        data = {
          ...data,
          connections: data.connections.filter((c) => c !== drop),
        };
        e.sync(data);
        ops++;
      }
      check(e, `step ${step}`);
    }
    expect(ops).toBeGreaterThan(50);
  });

  it('a new pipe that is a loop gets a lane, and removing the last connection of it takes the lane away', () => {
    const e = new GraphEngine();
    e.sync(loop());
    const a8 = e.store.assets.get('a8')!;
    const a1 = e.store.assets.get('a1')!;
    const before = e.gedges.filter((g) => g.back).length;
    const wire = e.requestConnectPorts(a8, 0, a1, 1)!; // a8 -> a1 closes another loop
    expect(wire.back).toBe(true);
    expect(e.gedges.filter((g) => g.back)).toHaveLength(before + 1);
    expect(e.gedges.every((g) => !g.back || g.laneY !== undefined)).toBe(true);
    check(e, 'with loop');
    e.requestDisconnect([wire], 'edge');
    expect(e.gedges.filter((g) => g.back)).toHaveLength(before);
    check(e, 'without loop');
  });

  it('a connection that joins groups that already have a pipe only changes its count, and keeps the pipe object', () => {
    const e = new GraphEngine();
    e.sync(fan(10));
    const pipe = e.gedges.find(
      (g) => g.a.type === 'aggregator' && g.b.type === 'sink',
    )!;
    const n = pipe.edges.length;
    const count = e.gedges.length;
    const agg = e.store.assets.get('agg')!;
    const sink0 = e.store.assets.get('sink0')!;
    expect(e.requestConnectPorts(agg, 1, sink0, 0)).not.toBeNull(); // agg.B -> sink0.1: existing ports, existing pipe
    expect(
      e.gedges.find((g) => g.a.type === 'aggregator' && g.b.type === 'sink'),
    ).toBe(pipe);
    expect(pipe.edges.length).toBe(n + 1);
    expect(e.gedges.length).toBe(count);
    check(e, 'one more connection');
  });
});
