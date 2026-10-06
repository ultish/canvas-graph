// Lets apps that are not yet using strict-mode templates get Glint types for this addon: import this file once.
import type GraphCanvas from './components/graph-canvas.gts';
import type GraphConnectDialog from './components/graph-connect-dialog.gts';
import type GraphInspector from './components/graph-inspector.gts';
import type graphCanvas from './modifiers/graph-canvas.ts';

export default interface Registry {
  GraphCanvas: typeof GraphCanvas;
  GraphInspector: typeof GraphInspector;
  GraphConnectDialog: typeof GraphConnectDialog;
  'graph-canvas': typeof graphCanvas;
}
