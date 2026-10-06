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
  private inModify = false;
  private bound = new Map<string, { off: () => void; passive: boolean }>();

  modify(element: HTMLElement, _positional: [], named: GraphCanvasNamed): void {
    // read every named arg: that is what makes this modifier re-run when one changes
    this.args = {
      data: named.data,
      colors: named.colors,
      fullPath: named.fullPath,
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
        window.devicePixelRatio || 1,
      );
    };
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
    if (a.fullPath !== undefined && a.fullPath !== this.lastFull) {
      this.lastFull = a.fullPath;
      engine.setFullPath(a.fullPath);
    }
    if (a.data && a.data !== this.lastData) {
      const first =
        this.lastData === undefined || engine.store.nodes.length === 0;
      this.lastData = a.data;
      engine.sync(a.data);
      if (first) engine.fitAll(true);
    }
  }

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
