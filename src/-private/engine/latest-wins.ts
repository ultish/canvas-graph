/**
 * Apply values at most once per `ms`, always the newest. The first value goes through at once (leading edge); values that
 * arrive inside the window replace each other, and the last one is applied when the window ends (trailing edge). Safe for
 * snapshots (each payload is the whole truth), which is what a data feed sends.
 */
export class LatestWins<T> {
  private pending: { value: T } | null = null;
  private last = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly apply: (value: T) => void,
    private readonly ms: () => number,
    private readonly now: () => number = () => performance.now(),
    private readonly later: (
      fn: () => void,
      ms: number,
    ) => ReturnType<typeof setTimeout> = setTimeout,
    private readonly cancel: (
      t: ReturnType<typeof setTimeout>,
    ) => void = clearTimeout,
  ) {}

  push(value: T): void {
    const ms = this.ms();
    const t = this.now();
    if (ms <= 0 || t - this.last >= ms) {
      this.drop();
      this.last = t;
      this.apply(value);
      return;
    }
    this.pending = { value };
    if (this.timer === undefined)
      this.timer = this.later(
        () => this.flush(),
        Math.max(0, ms - (t - this.last)),
      );
  }

  /** Apply the waiting value now, if there is one. */
  flush(): void {
    const p = this.pending;
    this.drop();
    if (!p) return;
    this.last = this.now();
    this.apply(p.value);
  }

  /** Forget anything waiting (when the canvas goes away). */
  destroy(): void {
    this.drop();
  }

  private drop(): void {
    this.pending = null;
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
  }
}
