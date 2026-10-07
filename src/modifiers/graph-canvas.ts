import { registerDestructor } from '@ember/destroyable';
import Modifier from 'ember-modifier';
import { GraphEngine } from '../-private/engine/engine.ts';
import type {
  ChangeEvent,
  ConnectRequest,
  DisconnectRequest,
  EngineEvents,
} from '../-private/engine/engine.ts';
import { Interaction } from '../-private/engine/interaction.ts';
import { LatestWins } from '../-private/engine/latest-wins.ts';
import { effectivePixelRatio } from '../-private/engine/pixel-ratio.ts';
import type { SelectionPayload } from '../-private/engine/payloads.ts';
import { Renderer, type FrameStats } from '../-private/engine/renderer.ts';
import type { SyncResult } from '../-private/engine/store.ts';
import type { GraphInput } from '../-private/engine/types.ts';
import { GraphHandle } from '../graph-handle.ts';

export interface GraphCanvasNamed {
  /** Your assets, ports and connections. Folded in by identity, so a payload where unchanged entities keep their object costs nothing. */
  data?: GraphInput | null;
  /** Pin colours for asset types ('#rrggbb'); other types get a stable colour of their own. */
  colors?: Record<string, string>;
  /** Highlight the whole upstream/downstream path of a selected asset. */
  fullPath?: boolean;
  /**
   * The densest pixel ratio the canvas will draw at (default 1.5). A 2x or 3x screen means 4-9x the pixels to fill, which
   * is what hurts a client with no GPU. Pass a higher number, or Infinity, to draw at the screen's full density.
   */
  maxPixelRatio?: number;
  /**
   * Draw at most this many frames a second (default 60, uncapped). 30 halves the drawing work on a weak client, at the
   * cost of choppier animation.
   */
  maxFps?: number;
  /**
   * Apply at most one data payload per this many ms (the newest; the ones in between are skipped, which is safe because each
   * is the whole truth). A number, or 'auto' (100 ms above 5,000 assets, none below). Default: off. For a very busy feed on
   * a big graph.
   */
  syncThrottle?: number | 'auto';
  /** Ring the assets your data changes, briefly (default true): a live feed's updates become visible. */
  highlightUpdates?: boolean;
  /** Glide cards to their new positions when the layout changes (default true). Off: they jump. */
  animateLayout?: boolean;
  onReady?: (handle: GraphHandle) => void;
  onSelect?: (selection: SelectionPayload | null) => void;
  onChange?: (change: ChangeEvent) => void;
  onSync?: (result: SyncResult) => void;
  onLayout?: (info: { reason: string }) => void;
  onFrame?: (stats: FrameStats) => void;
  /** The user wants to connect. May return a Promise: resolved = saved, rejected = refused. */
  onConnectRequest?: (request: ConnectRequest) => unknown;
  /** The user wants to delete connections. May return a Promise. */
  onDisconnectRequest?: (request: DisconnectRequest) => unknown;
}

interface Signature {
  Element: HTMLElement;
  Args: { Named: GraphCanvasNamed };
}

/**
 * Mounts the graph canvas in an element. Reading `@data` here puts it in Ember's tracking frame (the same rule your
 * grid's `recordsSource` follows), so a new payload re-runs `modify` and the canvas syncs by identity.
 */
export default class GraphCanvasModifier extends Modifier<Signature> {
  private engine: GraphEngine | undefined;
  private renderer: Renderer | undefined;
  private handle: GraphHandle | undefined;
  private args: GraphCanvasNamed = {};
  private lastData: GraphInput | null | undefined;
  private lastFull: boolean | undefined;
  private lastRatio: number | undefined;
  private refit: (() => void) | undefined;
  private inModify = false;
  private bound = new Map<string, { off: () => void; passive: boolean }>();

  modify(element: HTMLElement, _positional: [], named: GraphCanvasNamed): void {
    // read every named arg: that is what makes this modifier re-run when one changes
    this.args = {
      data: named.data,
      colors: named.colors,
      fullPath: named.fullPath,
      maxPixelRatio: named.maxPixelRatio,
      animateLayout: named.animateLayout,
      maxFps: named.maxFps,
      highlightUpdates: named.highlightUpdates,
      syncThrottle: named.syncThrottle,
      onReady: named.onReady,
      onSelect: named.onSelect,
      onChange: named.onChange,
      onSync: named.onSync,
      onLayout: named.onLayout,
      onFrame: named.onFrame,
      onConnectRequest: named.onConnectRequest,
      onDisconnectRequest: named.onDisconnectRequest,
    };
    this.inModify = true;
    try {
      if (!this.engine) this.mount(element);
      this.apply();
    } finally {
      this.inModify = false;
    }
  }

  private mount(element: HTMLElement): void {
    const canvas = document.createElement('canvas');
    canvas.className = 'cg-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    element.append(canvas);
    const engine = new GraphEngine();
    const renderer = new Renderer(canvas, engine, {
      colors: this.args.colors,
      onFrame: (s) => this.args.onFrame?.(s),
    });
    const interaction = new Interaction(canvas, engine, renderer);
    const handle = new GraphHandle(engine, () => renderer.refreshTheme());
    this.engine = engine;
    this.renderer = renderer;
    this.handle = handle;

    const fit = () => {
      const r = element.getBoundingClientRect();
      renderer.resize(
        Math.max(1, r.width),
        Math.max(1, r.height),
        effectivePixelRatio(window.devicePixelRatio, this.args.maxPixelRatio),
      );
    };
    this.refit = fit;
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(element);

    // the canvas reads its colours from CSS custom properties: redraw when the page's theme changes
    const retheme = () => renderer.refreshTheme();
    const mo = new MutationObserver(retheme);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'style'],
    });
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', retheme);

    // Always-on listeners keep the handle's tracked selection current; the host's callbacks are bound in apply().
    engine.on('select', (p) => this.later(() => (handle.selection = p)), {
      passive: true,
    });
    registerDestructor(this, () => {
      ro.disconnect();
      mo.disconnect();
      this.syncer.destroy();
      scheme.removeEventListener('change', retheme);
      interaction.destroy();
      renderer.destroy();
      for (const b of this.bound.values()) b.off();
      this.bound.clear();
      canvas.remove();
    });
    this.later(() => this.args.onReady?.(handle));
  }

  /** Writes to the host's tracked state must not happen during this modifier's own run (backtracking). */
  private later(fn: () => void): void {
    if (this.inModify) queueMicrotask(fn);
    else fn();
  }

  private apply(): void {
    const engine = this.engine!;
    const a = this.args;
    this.renderer!.palette.setOverrides(a.colors ?? {});
    this.renderer!.invalidate();
    this.bind('select', a.onSelect, true);
    this.bind('change', a.onChange, true);
    this.bind('sync', a.onSync, true);
    this.bind('layout', a.onLayout, true);
    this.bind('connectRequest', a.onConnectRequest, false); // a real host handler: its Promise decides the outcome
    this.bind('disconnectRequest', a.onDisconnectRequest, false);
    engine.animateLayout = a.animateLayout !== false;
    engine.highlightUpdates = a.highlightUpdates !== false;
    this.renderer!.maxFps = a.maxFps ?? 60;
    if (a.maxPixelRatio !== this.lastRatio) {
      this.lastRatio = a.maxPixelRatio;
      this.refit?.();
    }
    if (a.fullPath !== undefined && a.fullPath !== this.lastFull) {
      this.lastFull = a.fullPath;
      engine.setFullPath(a.fullPath);
    }
    if (a.data && a.data !== this.lastData) {
      this.lastData = a.data;
      this.syncer.push(a.data);
    }
  }

  /** The newest payload wins; with `@syncThrottle` set, at most one is applied per window. */
  private syncer = new LatestWins<GraphInput>(
    (data) => {
      const engine = this.engine!;
      const first = engine.store.nodes.length === 0;
      engine.sync(data);
      if (first) engine.fitAll(true);
    },
    () => {
      const t = this.args.syncThrottle;
      if (typeof t === 'number') return t;
      return t === 'auto' && (this.engine?.store.nodes.length ?? 0) > 5000
        ? 100
        : 0;
    },
  );

  /** (Re)register a host callback only while it exists, so "no handler" really means no handler. */
  private bind<K extends keyof EngineEvents>(
    type: K,
    cb: ((v: EngineEvents[K]) => unknown) | undefined,
    defer: boolean,
  ): void {
    const have = this.bound.get(type);
    if (!cb) {
      have?.off();
      this.bound.delete(type);
      return;
    }
    if (have) return; // the wrapper below always calls the latest callback
    const off = this.engine!.on(
      type,
      (v) => {
        const fn = this.args[callbackName(type)] as
          ((v: EngineEvents[K]) => unknown) | undefined;
        if (!fn) return undefined;
        if (defer) return void this.later(() => fn(v));
        return fn(v);
      },
      { passive: defer },
    );
    this.bound.set(type, { off, passive: defer });
  }
}

function callbackName(type: keyof EngineEvents): keyof GraphCanvasNamed {
  switch (type) {
    case 'select':
      return 'onSelect';
    case 'change':
      return 'onChange';
    case 'sync':
      return 'onSync';
    case 'layout':
      return 'onLayout';
    case 'connectRequest':
      return 'onConnectRequest';
    case 'disconnectRequest':
      return 'onDisconnectRequest';
    default:
      return 'onChange';
  }
}
