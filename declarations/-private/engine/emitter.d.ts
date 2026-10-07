export declare class Emitter<Events extends object> {
    private map;
    on<K extends keyof Events>(type: K, fn: (value: Events[K]) => unknown, opts?: {
        passive?: boolean;
    }): () => void;
    /** Number of non-passive listeners. */
    handlers<K extends keyof Events>(type: K): number;
    /** Call every listener; return what the non-passive ones returned (a request handler may return a Promise). */
    emit<K extends keyof Events>(type: K, value: Events[K]): unknown[];
}
//# sourceMappingURL=emitter.d.ts.map