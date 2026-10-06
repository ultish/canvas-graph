// The code shown in each cookbook section. Kept as strings (not run) so they can show imports and your-app details
// (glimmer-apollo, GraphQL documents) that the demo itself does not depend on.

export const quickStart = `import Component from '@glimmer/component';
import GraphCanvas from 'canvas-graph/components/graph-canvas';

export default class Topology extends Component {
  // shaped like your GraphQL model: assets own ports (objects with an id and a name),
  // connections point at port ids
  graph = {
    assets: [
      { id: 'source', name: 'source', type: 'source', inputPorts: [], outputPorts: [{ id: 'source:out:A', name: 'A' }] },
      { id: 'switch', name: 'switch', type: 'switch', inputPorts: [{ id: 'switch:in:1', name: '1' }], outputPorts: [{ id: 'switch:out:A', name: 'A' }] },
      // ...
    ],
    connections: [
      { id: 'c1', from: { assetId: 'source', portId: 'source:out:A' }, to: { assetId: 'switch', portId: 'switch:in:1' } },
      // ...
    ],
  };

  <template>
    {{! the canvas fills its parent, so give the parent a size }}
    <div style="height: 360px">
      <GraphCanvas @data={{this.graph}} />
    </div>
  </template>
}`;

export const colours = `import { hash } from '@ember/helper';

// Colour comes from the asset's \`type\`: stable (a hash of the name), so a type keeps its colour.
// Pin the types you care about with '#rrggbb' values.
<template>
  <GraphCanvas
    @data={{this.graph}}
    @colors={{hash ingest="#ff4fa3" route="#c3e86d"}}
  />
</template>`;

export const layoutRules = `// You do not position anything. The layout is:
//
//   - layers left to right, by longest path (a connection always points right...)
//   - ...except the one that closes a cycle: it is routed over the top as a loop-back
//   - a connection that skips layers runs underneath, in its own lane
//   - assets in a layer are grouped by \`type\`; big groups become a roughly square grid
//   - the largest group of each layer sits on the baseline, siblings stack below it
//   - assets connected to nothing are gathered into one "unconnected" block
//   - small separate pipelines are packed beside each other instead of in a tall column
//
// After many connections change you can recompute it (the camera stays put):
handle.relayout();`;

export const selection = `import GraphCanvas from 'canvas-graph/components/graph-canvas';
import GraphInspector from 'canvas-graph/components/graph-inspector';

export default class Topology extends Component {
  @tracked handle?: GraphHandle;
  ready = (h: GraphHandle) => (this.handle = h);

  <template>
    <GraphCanvas @data={{this.graph}} @onReady={{this.ready}} />

    {{! ready-made panel: optional, replaceable }}
    <GraphInspector @handle={{this.handle}} />

    {{! or render it yourself: selection is tracked plain data }}
    {{#if this.handle.selection}}
      {{this.handle.selection.kind}}   {{! 'node' | 'edge' | 'groupEdge' | 'group' }}
    {{/if}}
  </template>
}

// What you get, by kind (all plain, serialisable data):
//   node       { id, name, type, status, group, ingressPorts: [{ id, name, count }], egressPorts }
//   edge       { id, from: { id, name, type, port: { id, name } }, to, route, enabled, pending, deleting }
//   groupEdge  { from, to, count, route, egressPorts: [{ name, count }], ingressPorts, edgeIds }
//   group      { type, layer, count, degraded, assetIds, incoming, outgoing }
//
// Zoomed in you select assets and wires; zoomed out, group pipes and groups.
// Highlight the whole upstream/downstream path with @fullPath={{true}}.`;

export const connect = `connect = async (req: ConnectRequest) => {
  if (req.source === 'group-drag') return; // see "Bulk connect"

  // req.from.assetIds = ['switch'], req.from.port = { id: 'switch:out:A', name: 'A' }
  // req.to.assetIds   = ['worker-2'], req.to.port = { id: 'worker-2:in:1', name: '1' }
  await this.createConnection.mutate({
    variables: { from: req.from.port.id, to: req.to.port.id },
    // show it at once: the same wire under a temporary id, marked pending
    optimisticResponse: { createConnection: { id: 'temp-1', pending: true, /* ... */ } },
  });
};

<template>
  <GraphCanvas @data={{this.graph.data}} @onConnectRequest={{this.connect}} />
</template>

// What the user sees:
//   1. drag from a port: a white wire follows the cursor; near a valid port it is pulled toward it,
//      then an electric arc bridges the gap; let go anywhere the arc shows and it connects
//   2. the wire is drawn at once, faded and pulsing (pending), and the target card glows and shoves
//   3. your Promise resolves and your data contains the connection: it brightens and settles
//      (if it rejects, the wire fades away; if your handler returns nothing, call
//      handle.confirm(ids) or handle.revert(ids) yourself)
//
// With no handler registered at all there is nothing to wait for, and it settles at once.`;

export const apollo = `import { gql, useQuery, useSubscription } from 'glimmer-apollo';

export default class Topology extends Component {
  graph = useQuery(this, () => [gql\`
    query Topology {
      assets { id name type status inputPorts { id name } outputPorts { id name } }
      connections { id from { assetId portId } to { assetId portId } enabled pending }
    }
  \`]);

  // its data is not read: the point is the CACHE WRITE it causes, which re-emits the query
  updates = useSubscription(this, () => [gql\`subscription { assetUpdated { id status } }\`]);

  <template>
    {{! @data is read inside Ember's tracking frame: a new payload re-runs the canvas's sync }}
    <GraphCanvas @data={{this.graph.data}} />
  </template>
}

// Why a tick is cheap: sync() folds the payload in BY IDENTITY.
//   - Apollo's cache is immutable: a changed field makes a new entity object and new arrays, and every
//     unchanged entity keeps its object. An entity that is === to last time costs nothing.
//   - Each sync is classified, so only the needed work happens:
//        a name / status / enabled / pending change     -> a redraw
//        connections added or removed                   -> group pipes and loop lanes rebuilt
//        assets added or removed, a type change, a card
//        that outgrew its cell, an unconnected asset
//        getting its first connection                   -> a relayout (the camera stays put)
//   - An optimistic response that swaps a temporary id for the real one is a RENAME of the same wire:
//     no flicker, no re-route.
//   - Culling does the rest: assets outside the viewport cost a lookup and no drawing.`;

export const groupConnect = `<GraphCanvas @data={{this.graph.data}} @onConnectRequest={{this.connect}} />
<GraphConnectDialog @handle={{this.handle}} @onConnect={{this.saveChosenPairings}} />

// Zoomed out, every group has a handle on its right (egress) and left (ingress) edge.
// Drag one group onto another and \`connectRequest\` fires with source 'group-drag'. Nothing is drawn:
// you decide the pairings.
//
//   {
//     source: 'group-drag',
//     from: { type: 'switch',  layer: 1, count: 1,  assetIds: ['switch'] },
//     to:   { type: 'process', layer: 2, count: 24, assetIds: ['worker-1', ...] },
//     cardinality: 'one-to-many',   // 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'
//     existingLinks: 24,
//   }
//
// There are no ports in it on purpose. You look the ports up yourself (and apply your own rules:
// hide ports already connected, allow several per port by type...). \`port\` appears only when the
// user picked one specific port.
//
// <GraphConnectDialog> is a stand-in for your own table. It offers an egress port, an ingress port and a
// pairing (every source -> every target, or one-to-one in order) and hands you the specs:
//
//   saveChosenPairings = (specs: ConnectSpec[]) => {
//     // [{ from: assetId, fromPort: portId, to: assetId, toPort: portId }, ...]
//     this.createConnections.mutate({ variables: { pairs: specs }, optimisticResponse: /* ... */ });
//   };
//
// Without @onConnect the dialog draws the connections locally with handle.connectMany(specs).`;

export const deleteUndo = `disconnect = async (req: DisconnectRequest) => {
  // req.source: 'edge' | 'group-pipe' | 'undo' | 'api'
  // req.edges: [{ id, from: { assetId, portId }, to: { assetId, portId } }]
  await this.deleteConnections.mutate({ variables: { ids: req.edges.map((e) => e.id) } });
  // resolve = it is gone (or your data stops containing it); reject = it springs back
};

<template>
  <GraphCanvas @data={{this.graph.data}} @onDisconnectRequest={{this.disconnect}} />
</template>

// Select a wire (zoomed in) and press Delete, or use the inspector's button. Delete a whole group
// pipe from the inspector (it asks twice). The wire fades red while your handler works.
//
// Cmd/Ctrl+Z asks you for the inverse: undoing a connect is a disconnect request, undoing a delete is a
// connect request (source 'undo') carrying the exact pairs. Entries your data has already made moot are
// skipped, so Cmd+Z never silently does nothing.`;

export const handleApi = `ready = (h: GraphHandle) => (this.handle = h);

handle.selection;                    // tracked: what is selected, as plain data
handle.on('select' | 'change' | 'sync' | 'layout' | 'connectRequest' | 'disconnectRequest', fn, { passive });

handle.connectMany(specs, { pending }); // show connections now; ports you name that the canvas has not seen are created
handle.disconnect(ids);              // same flow as the Delete key
handle.confirm(ids); handle.revert(ids); // your answer when a request handler returned nothing
handle.undo();

handle.selectAsset(id); handle.selectConnection(id); handle.clearSelection();
handle.setFullPath(true);

handle.fit(); handle.focusAsset(id); handle.focusPipeline(index);
handle.relayout();
handle.asset(id);                    // the asset and its ports as the canvas knows them`;

export const performance = `<GraphCanvas
  @data={{this.graph.data}}
  @maxPixelRatio={{1.5}}      {{! the default: a 2x or 3x screen draws at 1.5x. Infinity = the screen's full density }}
  @maxFps={{30}}              {{! default 60 (uncapped). 30 halves the drawing work on a weak client }}
  @syncThrottle="auto"        {{! apply at most one payload per 100 ms above 5,000 assets (a number sets it); default off }}
  @animateLayout={{true}}     {{! cards glide when the layout changes; default true }}
  @highlightUpdates={{true}}  {{! a ring on assets your data changes; default true }}
/>

// Measure it on the machine that matters: /bench times the whole pipeline on a graph of the size you pick. Open it in
// the client you are worried about (or Chrome with DevTools > Performance > CPU 4x or 6x slowdown) and press Run.
//
// What to expect (a fast laptop, real Chrome, 20,000 assets = 60,000 entities):
//   a subscription tick (one field)      0.1 ms        add a connection        2.6 ms
//   first sync + layout                  76 ms         relayout                9 ms
//   a frame, zoomed out / middle / in    0 / 0.1 / 1.6 ms (2.8 ms with a hub selected)
//
// Why it is cheap:
//   - sync() folds a payload in by identity, comparing position by position: unchanged entities cost a comparison
//   - culling: only assets in the viewport are drawn, and wires are stroked in one batch per colour
//   - layout is a typed-array program: 60,000 assets in about 4 ms, so it needs no Web Worker (copying the data to a
//     worker and back would cost more than the layout)
//   - connection changes update the group pipes in place instead of rebuilding them
//   - the hover hit-test does not allocate and rate-limits itself by its own cost`;
