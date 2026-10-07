import type { Port } from './types.ts';
/** Numeric-aware name compare: 2 before 10, A before B. */
export declare const natural: (p: string, q: string) => number;
export declare const byName: (p: Port, q: Port) => number;
/** Structural equality for plain JSON-like data (what selection payloads are made of). */
export declare function deepEqual(a: unknown, b: unknown): boolean;
//# sourceMappingURL=util.d.ts.map