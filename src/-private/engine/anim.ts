import type {
  AssetNode,
  Edge,
  Cubic,
  Group,
  GroupEdge,
  Point,
} from './types.ts';

/** A wire being dragged from a port (zoomed in). */
export interface PortDrag {
  from: AssetNode;
  dir: 1 | -1;
  idx: number;
  x: number;
  y: number;
  near: { node: AssetNode; idx: number } | null; // nearest port in range: the arc and the ring
  target: { node: AssetNode; idx: number } | null; // within release range: letting go connects
  elec: number; // 0..1 how close, drives the arc
  pull: number; // eased 0..1 magnet pull toward `pt`
  snap: boolean; // inside the ring: locked on
  pt: Point | null;
}

/** A fat pipe being dragged from a group handle (zoomed out). */
export interface GroupDrag {
  from: Group;
  dir: 1 | -1;
  x: number;
  y: number;
  target: Group | null;
  pull: number;
}

/** Transient, purely visual state that the engine, the interaction layer and the renderer share. */
export interface AnimState {
  conn: PortDrag | null;
  gconn: GroupDrag | null;
  retract: (PortDrag & { t0: number }) | null;
  flash: {
    e: Edge;
    t0: number;
    node: AssetNode;
    dir: 1 | -1;
    idx: number;
  } | null;
  ghost: { segs: Cubic[]; type: string; t0: number } | null;
  bumping: Set<AssetNode>;
  glowing: Set<AssetNode>;
  pulseUntil: number;
  hover: AssetNode | null;
  hoverEdge: Edge | null;
  hoverGE: GroupEdge | null;
}

export const createAnimState = (): AnimState => ({
  conn: null,
  gconn: null,
  retract: null,
  flash: null,
  ghost: null,
  bumping: new Set(),
  glowing: new Set(),
  pulseUntil: 0,
  hover: null,
  hoverEdge: null,
  hoverGE: null,
});
