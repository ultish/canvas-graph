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
  /** The nearest opposite-side handle in range (the ring and arc show), and how close: 0 far, 1 touching. */
  near: Group | null;
  elec: number;
  snap: boolean;
  pt: Point | null;
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
  /** Assets the user is searching for: ringed and named on the canvas, wherever they are. */
  found: Set<AssetNode>;
  /** A group-to-group link the user has drawn but not yet answered: shown until the dialog is cancelled or data arrives. */
  groupDraft: { a: Group; b: Group } | null;
  ghost: { segs: Cubic[]; type: string; t0: number } | null;
  bumping: Set<AssetNode>;
  /** Assets the host's data just changed: they wear a fading ring for a moment. */
  pulsing: Set<AssetNode>;
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
  found: new Set(),
  groupDraft: null,
  ghost: null,
  bumping: new Set(),
  pulsing: new Set(),
  glowing: new Set(),
  pulseUntil: 0,
  hover: null,
  hoverEdge: null,
  hoverGE: null,
});
