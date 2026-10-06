import { GraphStore } from '../../src/-private/engine/store.ts';
import { layoutGraph, routeEdges } from '../../src/-private/engine/layout.ts';
import type { GraphInput } from '../../src/-private/engine/types.ts';

export function laidOut(...inputs: GraphInput[]) {
  const store = new GraphStore();
  store.sync({
    assets: inputs.flatMap((i) => i.assets),
    connections: inputs.flatMap((i) => i.connections),
  });
  const { groups, comps } = layoutGraph(store.nodes, store.edgeList);
  const gedges = routeEdges(store.edgeList, groups, comps);
  return { store, groups, comps, gedges };
}
