import type { AssetNode, Edge, Group, GroupEdge } from './types.ts';
/** The wire nearest the cursor, within 9px, among wires touching the given (visible) cards. */
export declare function pickEdge(x: number, y: number, scale: number, vis: Iterable<AssetNode>, stamp: number): Edge | null;
/** The group pipe under the cursor; tolerance grows with the pipe's drawn width. */
export declare function pickGroupEdge(x: number, y: number, scale: number, gedges: readonly GroupEdge[]): GroupEdge | null;
/** The smallest group frame containing the point (tiny groups get a 10px minimum hit area). */
export declare function pickGroup(x: number, y: number, scale: number, groups: readonly Group[]): Group | null;
/** A port dot on a card: egress on the right edge (dir 1), ingress on the left (dir -1). */
export declare function pickPort(x: number, y: number, scale: number, nodes: Iterable<AssetNode>): {
    node: AssetNode;
    dir: 1 | -1;
    idx: number;
} | null;
/** A group's drag handle: egress at the right edge's middle, ingress at the left's. */
export declare function pickGroupHandle(x: number, y: number, scale: number, groups: readonly Group[]): {
    group: Group;
    dir: 1 | -1;
} | null;
//# sourceMappingURL=picking.d.ts.map