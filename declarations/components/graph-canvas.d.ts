import type { TOC } from '@ember/component/template-only';
import { type GraphCanvasNamed } from '../modifiers/graph-canvas.ts';
import '../styles/canvas-graph.css';
export interface GraphCanvasSignature {
    Element: HTMLDivElement;
    Args: GraphCanvasNamed;
}
/**
 * The graph canvas. Give it a size (it fills its parent) and your data:
 *
 *   <GraphCanvas @data={{this.graph}} @onReady={{this.ready}} @onConnectRequest={{this.connect}} />
 */
declare const GraphCanvas: TOC<GraphCanvasSignature>;
export default GraphCanvas;
//# sourceMappingURL=graph-canvas.d.ts.map