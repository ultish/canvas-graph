# canvas-graph

A topology canvas for Ember, for graphs of thousands of assets where a single switch may fan out to hundreds. It draws on a plain 2D canvas (no GPU needed) and only draws what the current zoom level can show: group blocks and fat pipes zoomed out, member tiles in the middle, full cards with named ports and individual wires zoomed in.

**Demo:** https://ultish.github.io/canvas-graph/ (a fake Apollo cache with 1,494 assets and 2,832 connections: live updates, optimistic connects, failures).

## Compatibility

- Ember.js 6 or above, `.gts` components, TypeScript declarations included
- Styling-agnostic: themeable with Tailwind/DaisyUI (the demo does), or plain CSS custom properties
- Embroider v2 addon (Vite)

## Installation

```
pnpm add canvas-graph
```

## Usage

```gts
import GraphCanvas from 'canvas-graph/components/graph-canvas';
import GraphInspector from 'canvas-graph/components/graph-inspector';

<template>
  <div style="height: 100vh">
    <GraphCanvas
      @data={{this.graph}}
      @onReady={{this.ready}}
      @onConnectRequest={{this.connect}}
      @onDisconnectRequest={{this.disconnect}}
    />
    <GraphInspector @handle={{this.handle}} />
  </div>
</template>
```

The canvas fills its parent, so give the parent a size. The components bring their own small stylesheet (`canvas-graph/styles/canvas-graph.css`); it is headless otherwise, and the canvas colours come from the asset `type`.

### Your data

Shaped like the GraphQL model: assets own input and output ports (objects with an `id` and a `name`), and connections point at port ids.

```ts
interface GraphInput {
  assets: Array<{
    id: string;
    name: string;
    type: string; // groups assets, picks the colour
    status?: string; // 'degraded' shows red
    inputPorts: Array<{ id: string; name: string }>;
    outputPorts: Array<{ id: string; name: string }>;
  }>;
  connections: Array<{
    id: string;
    from: { assetId: string; portId: string };
    to: { assetId: string; portId: string };
    enabled?: boolean; // false draws dashed
    pending?: boolean; // true draws faded: saving
  }>;
}
```

Layout is automatic: layers left to right by longest path, grouped by `type`, a roughly square grid of cards for large groups, loops (cycles) routed over the top and layer-skipping connections underneath. Assets with no connections are gathered into one block, and small separate pipelines are packed next to each other instead of stacking.

### How updates work

`@data` is read inside Ember's tracking frame, so a new payload re-runs the canvas's `modify`, which calls `sync()`. `sync()` folds the payload in **by object identity**: an entity that is `===` to last time costs nothing, and Apollo only allocates a new object for an entity that changed. So a subscription tick that flips one field on one asset visits one entity out of thousands (the demo shows the number). Every `sync` is classified so only the necessary work happens:

| What changed | Work |
| --- | --- |
| a name, status, `enabled` or `pending` flag | a redraw |
| connections added or removed | group pipes and loop lanes are rebuilt |
| assets added or removed, a type changed, a card outgrew its cell, or an unconnected asset got its first connection | a relayout (the camera stays put) |

An optimistic response that swaps a temporary connection id for the real one is a **rename of the same wire**, not a remove and add: no flicker, no re-route.

Culling does the rest: assets outside the viewport, or at a zoom that doesn't draw them, cost a lookup and no drawing.

### Gestures are intents; your data is the truth

The canvas never edits your data. It asks, through callbacks on `<GraphCanvas>`:

- **`@onConnectRequest`**: the user joined two ports (`source: 'port-drag'`), or dragged one group onto another (`source: 'group-drag'`), or undid a delete (`source: 'undo'`). The request carries asset ids and a `cardinality` (`one-to-one`, `one-to-many`, `many-to-one`, `many-to-many`); a `port` only when the user picked a specific one. Return a Promise: resolved means saved, rejected means refused.
  - A port drag is drawn **at once, faded** (pending), with the snap, flash and shove. When your data contains the connection, the canvas swaps in your copy. If the Promise rejects, it fades away.
  - A group drag draws nothing: it hands you every asset on each side so you can build the pairings (the optional `<GraphConnectDialog>`, or your own table), then you write them with a mutation.
- **`@onDisconnectRequest`**: the user deleted one connection (Delete key, or the inspector), or a whole group pipe. The wires fade (deleting) until your handler's Promise resolves or your data stops containing them; if it rejects they spring back.

If a handler returns nothing, the wire stays pending until you call `handle.confirm(ids)` or `handle.revert(ids)`. If **no** handler is registered at all (a standalone demo), there is nothing to wait for and everything settles at once.

Cmd/Ctrl+Z undoes by asking you for the inverse: undoing a connect is a disconnect request, undoing a delete is a connect request carrying the exact pairs.

### The handle (`@onReady`)

```ts
handle.selection; // tracked: the selected asset / connection / group pipe / group, as plain data
handle.on('select' | 'change' | 'sync' | 'layout' | 'connectRequest' | ..., fn, { passive })
handle.connectMany(specs); // show connections now; ports you name that the canvas hasn't seen are created
handle.disconnect(ids);
handle.confirm(ids); handle.revert(ids); handle.undo();
handle.selectAsset(id); handle.selectConnection(id); handle.clearSelection(); handle.setFullPath(true);
handle.fit(); handle.focusAsset(id); handle.focusPipeline(i); handle.relayout();
handle.asset(id); // the asset and its ports as the canvas knows them
```

`<GraphInspector>` and `<GraphConnectDialog>` are optional and replaceable: they only read `handle.selection` and listen passively to requests (a passive listener is never counted as "the host"). Pass `@onConnect={{this.save}}` to the dialog to receive the chosen pairings and persist them yourself.

### Theming (Tailwind / DaisyUI / anything)

The addon is headless: it ships no Tailwind and no DaisyUI. The canvas draws its own pixels, so instead of selectors it reads a small set of CSS custom properties from its own element (they inherit, so set them on `:root`, on `[data-theme]`, or on a wrapper) and falls back to a dark theme for anything you leave unset. Any CSS colour works, `oklch()` included. It redraws by itself when `data-theme` / `class` / `style` change on `<html>` or the OS colour scheme flips (`handle.refreshTheme()` if you switch themes some other way).

| Token | What it colours |
| --- | --- |
| `--cg-bg` | the canvas background |
| `--cg-card`, `--cg-card-border` | a card's fill and outline |
| `--cg-text` | card titles |
| `--cg-text-muted`, `--cg-text-soft` | subtitles; port names and footers |
| `--cg-label` | pipe counts and group names |
| `--cg-ok`, `--cg-bad` | healthy / degraded status (degraded assets, wires being deleted) |
| `--cg-highlight` | the selected wire and the wire you are dragging (white on dark, dark on light) |

Asset types get their own colours (stable per type name, never red, since red means degraded); pin some with `@colors`. The optional inspector and dialog read `--cg-panel-*`, `--cg-control-*`, `--cg-danger*` and `--cg-ok-*` (listed at the top of `canvas-graph.css`).

With DaisyUI, mapping its variables is all it takes for every theme to apply to the canvas, the inspector and the dialog at once (this is what the demo does; see `demo-app/styles.css`, and use the theme picker in its header):

```css
:root {
  --cg-bg: var(--color-base-100);
  --cg-card: var(--color-base-200);
  --cg-card-border: var(--color-base-300);
  --cg-text: var(--color-base-content);
  --cg-ok: var(--color-success);
  --cg-bad: var(--color-error);
  --cg-highlight: var(--color-base-content);
  --cg-panel-bg: var(--color-base-100);
  /* ... */
}
```

### Interaction

Scroll to zoom (about the cursor), drag to pan, click to select an asset, a wire, a group pipe or a group (what is selectable depends on what the zoom level shows). Drag from a port (zoomed in) or a group's edge handle (zoomed out) to connect. Delete removes the selected wire.

## With Apollo

Treat the canvas as a pure projection of the cache. A recipe (the same shape as your `glimmer-apollo` data grids):

```gts
graph = useQuery(this, () => [GRAPH_QUERY]);

connect = async (req: ConnectRequest) => {
  await this.createConnections.mutate({
    variables: { pairs: req.pairs ?? [{ from: ..., to: ... }] },
    optimisticResponse: /* the same pairs, with temporary ids and pending: true */,
  });
};

<template>
  <GraphCanvas @data={{this.graph.data}} @onConnectRequest={{this.connect}} ... />
</template>
```

The demo (`demo-app/`) uses a small hand-written fake of Apollo's cache semantics (`apollo-fake.ts`: immutable entities, new arrays on every write, no-op writes, `batch`, optimistic layers) so the update cost is a number on screen. `@apollo/client` is not a dependency of this addon.

## Development

```
pnpm install
pnpm start            # the demo on a local dev server
pnpm test:engine      # the engine's tests (Vitest, no browser)
pnpm lint             # eslint, ember-template-lint, prettier, types
pnpm build            # the addon (dist/ + declarations/)
pnpm build:demo       # the demo, as deployed to GitHub Pages
```

The engine (`src/-private/engine/`) is plain TypeScript with no Ember or DOM in it except the renderer and interaction layer, so almost all of it is tested in Node. `ref/index.html` is the single-file spike the engine was ported from.

## Not yet

- Selecting a wire is only possible zoomed in; zoomed out you select the group pipe.
- `routeEdges` rebuilds all group pipes when connections change. It is about a millisecond at 2,800 connections but is O(connections); it is the first thing to make incremental for much larger graphs.
- Edits are intents only: there is no built-in persistence, by design.

## License

This project is licensed under the [MIT License](LICENSE.md).
