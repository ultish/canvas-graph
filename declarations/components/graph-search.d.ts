import Component from '@glimmer/component';
import type { GroupSummary } from '../-private/engine/payloads.ts';
import type { GraphHandle } from '../graph-handle.ts';
import '../styles/canvas-graph.css';
export interface GraphSearchSignature {
    Element: HTMLElement;
    Args: {
        handle: GraphHandle | undefined;
        /** How far in to zoom on the chosen asset, at least. Default 0.55: its card is readable, with its neighbours around it. */
        zoom?: number;
        /** How many assets to list. Default 8. */
        limit?: number;
    };
}
interface Item {
    kind: 'asset' | 'group';
    id: string;
    label: string;
    note: string;
}
/**
 * One search box over every asset's name. Typing lists matching groups (pick one to search only inside it) and
 * assets (pick one to select it and move the camera to it); every match is ringed on the canvas meanwhile. The group
 * a search is limited to is `handle.searchScope`, shared with the inspector's "Search in this group" button, and
 * shown as a chip you can clear (✕, or Backspace in an empty box). Optional: it only uses the handle's search methods.
 */
export default class GraphSearch extends Component<GraphSearchSignature> {
    query: string;
    items: Item[];
    total: number;
    active: number;
    open: boolean;
    get scope(): GroupSummary | undefined;
    get more(): number;
    get showList(): boolean;
    get placeholder(): string;
    private run;
    private choose;
    input: (e: Event) => void;
    focus: () => void;
    pick: (e: Event) => void;
    private focusBox;
    clearScope: (e: Event) => void;
    isActive: (i: number) => boolean;
    key: (e: KeyboardEvent) => void;
    /** Close the list when a press lands anywhere outside the search box. */
    dismissOutside: import("ember-modifier").FunctionBasedModifier<{
        Args: {
            Positional: unknown[];
            Named: import("ember-modifier/-private/signature").EmptyObject;
        };
        Element: HTMLElement;
    }>;
}
export {};
//# sourceMappingURL=graph-search.d.ts.map