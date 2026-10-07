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
handle.on('select' | 'change' | 'sync' | 'layout' | 'connectRequest' | 'disconnectRequest' | 'searchScope' | 'searchPick', fn, { passive })
handle.connectMany(specs); // show connections now; ports you name that the canvas hasn't seen are created
handle.disconnect(ids);
handle.confirm(ids); handle.revert(ids); handle.undo();
handle.selectAsset(id); handle.selectConnection(id); handle.clearSelection(); handle.setFullPath(true);
handle.fit(); handle.focusAsset(id); handle.focusPipeline(i); handle.relayout();
handle.asset(id); // the asset and its ports as the canvas knows them
```

`<GraphSearch @handle={{this.handle}} />` is one search box over every asset's name: typing lists matching groups and assets, every match is ringed on the canvas, and choosing an asset selects it and moves the camera to it (`@zoom` sets how far in, 0.55 by default). Choosing a group (or the inspector's "Search in this group" button) limits the search to that group, shown as a chip you can clear. Build your own with `handle.searchAssets(text)`, `searchGroups(text)`, `highlightAssets(ids)`, `searchInGroup(key | null)`, `selectAsset(id)` and `focusAsset(id, minScale)`.

Everything the built-in panels do goes through the handle and fires an event, so you can do something else with it instead:

| event | when | what you get / can do |
| --- | --- | --- |
| `select` | the selection changed | the payload (asset, connection, group pipe, group), or `null` |
| `connectRequest` | a port or group drag, or the connect dialog, asks to connect | handle it (return a Promise to save), or call `handle.confirm` / `revert` later |
| `disconnectRequest` | the user deleted wires | same |
| `searchPick` | the user chose an asset in a search box | `{ id, name, type }`; return `false` to take over (nothing is selected or focused) |
| `searchScope` | the group a search is limited to changed | `{ key, group }`, `null` when cleared |
| `change` / `sync` / `layout` | the model, your data, or the layout changed | summaries of what changed |

`<GraphInspector>` and `<GraphConnectDialog>` are optional and replaceable: they only read `handle.selection` and listen passively to requests (a passive listener is never counted as "the host"). Pass `@onConnect={{this.save}}` to the dialog to receive the chosen pairings and persist them yourself.

### Performance (a client with no GPU)

Everything is drawn on a plain 2D canvas, and only what the current zoom can show. Measured in real Chrome on a fast laptop, at **20,000 assets (60,000 entities)**:

| | |
| --- | --- |
| a subscription tick (one field changed) | 0.1 ms |
| a payload where nothing changed | 0.1 ms |
| add a connection | 2.6 ms |
| first sync + layout / a full relayout | 76 ms / 9 ms |
| a frame: zoomed out / middle / zoomed in | 0.0 / 0.1 / 1.6 ms (2.8 ms with a hub selected) |

Those are a fast machine's numbers. **Measure on yours:** the demo's `/bench` page times the whole pipeline on a graph of the size you pick (up to 60,000 assets) and prints a table you can copy. Open it on the client you care about, or use Chrome's DevTools → Performance → CPU 4× or 6× slowdown.

How it stays cheap:

- **Sync is by identity.** The new payload is compared with a copy of the last one position by position; an entity that is `===` costs one comparison, so a tick costs about what it changes, not what the graph weighs. (Apollo returns new arrays whose unchanged entities sit at the same index.)
- **Layout is a typed-array program** (`layout-core.ts`): 60,000 assets in about 4 ms. That is why there is no Web Worker: copying the data to a worker and the answer back would cost more than the layout.
- **Connection changes update the group pipes in place;** only a loop or skip pipe appearing or disappearing re-runs lane assignment, for its one pipeline.
- **Drawing allocates almost nothing** (reused sets and buckets, wires stroked in one batch per colour, no per-wire allocation), and the hover hit-test rate-limits itself by its own cost.

**Where the envelope ends:** the target is thousands of assets, and 20,000 (60,000 entities) is comfortable. At 60,000 assets (180,000 entities) it still works but is past the design point: in the same browser, the first sync takes about 1.5 s, a full relayout about 180 ms, and finding the wire under the cursor about 100 ms (it rate-limits itself, so the pointer never waits on it). Run `/bench` at that size on your own hardware before relying on it.

Knobs, all optional:

| Argument | Default | |
| --- | --- | --- |
| `@maxPixelRatio` | `1.5` | A 2× or 3× screen means 4–9× the pixels to fill; the canvas draws at most this dense. `Infinity` = the screen's own density. |
| `@maxFps` | `60` (uncapped) | `30` halves the drawing work on a weak client. |
| `@syncThrottle` | off | Apply at most one data payload per N ms (the newest wins; safe, each payload is the whole truth). `'auto'` = 100 ms above 5,000 assets. |
| `@animateLayout` | `true` | Cards and group frames glide to their new positions when the layout changes, instead of jumping. |
| `@highlightUpdates` | `true` | A fading ring on each asset your data changes (skipped for bulk changes of 200+). |

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
- Edits are intents only: there is no built-in persistence, by design.

## License

This project is licensed under the [MIT License](LICENSE.md).
