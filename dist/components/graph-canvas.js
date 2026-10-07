import { a as GraphCanvasModifier } from '../graph-canvas-CGtz3aD2.js';
import '../canvas-graph-DfcbKwQG.js';
import { precompileTemplate } from '@ember/template-compilation';
import { setComponentTemplate } from '@ember/component';
import templateOnly from '@ember/component/template-only';

/**
 * The graph canvas. Give it a size (it fills its parent) and your data:
 *
 *   <GraphCanvas @data={{this.graph}} @onReady={{this.ready}} @onConnectRequest={{this.connect}} />
 */
const GraphCanvas = setComponentTemplate(precompileTemplate("<div class=\"cg-root\" ...attributes {{graphCanvas data=@data colors=@colors fullPath=@fullPath maxPixelRatio=@maxPixelRatio animateLayout=@animateLayout maxFps=@maxFps highlightUpdates=@highlightUpdates syncThrottle=@syncThrottle onReady=@onReady onSelect=@onSelect onChange=@onChange onSync=@onSync onLayout=@onLayout onFrame=@onFrame onConnectRequest=@onConnectRequest onDisconnectRequest=@onDisconnectRequest}}></div>", {
  strictMode: true,
  scope: () => ({
    graphCanvas: GraphCanvasModifier
  })
}), templateOnly());

export { GraphCanvas as default };
//# sourceMappingURL=graph-canvas.js.map
