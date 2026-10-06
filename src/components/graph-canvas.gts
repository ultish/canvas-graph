import type { TOC } from '@ember/component/template-only';
import graphCanvas, {
  type GraphCanvasNamed,
} from '../modifiers/graph-canvas.ts';
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
const GraphCanvas: TOC<GraphCanvasSignature> = <template>
  <div
    class="cg-root"
    ...attributes
    {{graphCanvas
      data=@data
      colors=@colors
      fullPath=@fullPath
      onReady=@onReady
      onSelect=@onSelect
      onChange=@onChange
      onSync=@onSync
      onLayout=@onLayout
      onFrame=@onFrame
      onConnectRequest=@onConnectRequest
      onDisconnectRequest=@onDisconnectRequest
    }}
  ></div>
</template>;

export default GraphCanvas;
