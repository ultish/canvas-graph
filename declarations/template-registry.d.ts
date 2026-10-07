import type GraphCanvas from './components/graph-canvas';
import type GraphConnectDialog from './components/graph-connect-dialog';
import type GraphInspector from './components/graph-inspector';
import type GraphSearch from './components/graph-search';
import type graphCanvas from './modifiers/graph-canvas.ts';
export default interface Registry {
    GraphCanvas: typeof GraphCanvas;
    GraphInspector: typeof GraphInspector;
    GraphConnectDialog: typeof GraphConnectDialog;
    GraphSearch: typeof GraphSearch;
    'graph-canvas': typeof graphCanvas;
}
//# sourceMappingURL=template-registry.d.ts.map