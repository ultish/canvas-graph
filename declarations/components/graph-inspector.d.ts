import Component from '@glimmer/component';
import type { SelectionPayload } from '../-private/engine/payloads.ts';
import type { GraphHandle } from '../graph-handle.ts';
import '../styles/canvas-graph.css';
export interface GraphInspectorSignature {
    Element: HTMLElement;
    Args: {
        handle: GraphHandle | undefined;
    };
}
interface Row {
    label: string;
    value: string;
}
/**
 * A ready-made detail panel for whatever is selected. Optional: it only reads `handle.selection`, so replace it with
 * your own component (or a table) and the canvas does not care.
 */
export default class GraphInspector extends Component<GraphInspectorSignature> {
    armedFor: SelectionPayload | null;
    get selection(): SelectionPayload | null;
    get title(): string;
    get rows(): Row[];
    get action(): {
        label: string;
    } | null;
    runAction: () => void;
    /** On a group's panel: limit the name search in the top bar to this group (or lift the limit). */
    get searchScopeButton(): {
        label: string;
        on: boolean;
    } | null;
    toggleSearchScope: () => void;
}
export {};
//# sourceMappingURL=graph-inspector.d.ts.map