import type { Cubic, Edge, GroupEdge } from './types.ts';
/** The curve a connection is drawn along: port to port, or via its lane if it loops back / skips layers. */
export declare function edgeSegs(e: Edge): Cubic[];
/** The curve of a group-to-group pipe, between the groups' frame handles. */
export declare function groupEdgeSegs(ge: GroupEdge): Cubic[];
/** Screen-space width of a pipe carrying n connections (log scale, capped). */
export declare const pipePx: (n: number) => number;
//# sourceMappingURL=routes.d.ts.map