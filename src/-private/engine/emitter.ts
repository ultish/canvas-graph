// A tiny typed event emitter. "Passive" listeners (an inspector, a built-in dialog) see every event but do not
// count as the host: a request nobody but a passive listener is watching is treated as unhandled.

type Fn = (value: never) => unknown;
interface Listener {
  fn: Fn;
  passive: boolean;
}

export class Emitter<Events extends object> {
  private map = new Map<keyof Events, Set<Listener>>();

  on<K extends keyof Events>(
    type: K,
    fn: (value: Events[K]) => unknown,
    opts: { passive?: boolean } = {},
  ): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    const l: Listener = { fn, passive: !!opts.passive };
    set.add(l);
    return () => void set.delete(l);
  }

  /** Number of non-passive listeners. */
  handlers<K extends keyof Events>(type: K): number {
    let n = 0;
    for (const l of this.map.get(type) ?? []) if (!l.passive) n++;
    return n;
  }

  /** Call every listener; return what the non-passive ones returned (a request handler may return a Promise). */
  emit<K extends keyof Events>(type: K, value: Events[K]): unknown[] {
    const out: unknown[] = [];
    for (const l of [...(this.map.get(type) ?? [])]) {
      const r = (l.fn as (v: Events[K]) => unknown)(value);
      if (!l.passive) out.push(r);
    }
    return out;
  }
}
