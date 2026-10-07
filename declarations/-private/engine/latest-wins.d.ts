/**
 * Apply values at most once per `ms`, always the newest. The first value goes through at once (leading edge); values that
 * arrive inside the window replace each other, and the last one is applied when the window ends (trailing edge). Safe for
 * snapshots (each payload is the whole truth), which is what a data feed sends.
 */
export declare class LatestWins<T> {
    private readonly apply;
    private readonly ms;
    private readonly now;
    private readonly later;
    private readonly cancel;
    private pending;
    private last;
    private timer;
    constructor(apply: (value: T) => void, ms: () => number, now?: () => number, later?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>, cancel?: (t: ReturnType<typeof setTimeout>) => void);
    push(value: T): void;
    /** Apply the waiting value now, if there is one. */
    flush(): void;
    /** Forget anything waiting (when the canvas goes away). */
    destroy(): void;
    private drop;
}
//# sourceMappingURL=latest-wins.d.ts.map