import Component from '@glimmer/component';
import type { ConnectRequest, ConnectSpec } from '../-private/engine/engine.ts';
import type { GraphHandle } from '../graph-handle.ts';
import '../styles/canvas-graph.css';
export interface GraphConnectDialogSignature {
    Element: HTMLElement;
    Args: {
        handle: GraphHandle | undefined;
        /**
         * Called with the pairings the user chose. Give it to persist them yourself (a GraphQL mutation); without it the
         * dialog draws them locally through `handle.connectMany`.
         */
        onConnect?: (specs: ConnectSpec[]) => void;
    };
}
type Mode = 'fan' | 'zip';
/**
 * A stand-in for your own bulk-connect UI: it shows when a group is dragged onto another, offers port and pairing
 * choices, and calls `handle.connectMany`. It listens passively, so it never counts as your request handler.
 * Leave it out and handle `@onConnectRequest` (source 'group-drag') yourself.
 */
export default class GraphConnectDialog extends Component<GraphConnectDialogSignature> {
    request: ConnectRequest | null;
    egress: string;
    ingress: string;
    mode: Mode;
    listen: import("ember-modifier").FunctionBasedModifier<{
        Args: {
            Positional: [GraphHandle | undefined];
            Named: import("ember-modifier/-private/signature").EmptyObject;
        };
        Element: HTMLElement;
    }>;
    private assets;
    get from(): import("../graph-handle.ts").AssetView[];
    get to(): import("../graph-handle.ts").AssetView[];
    get egressNames(): string[];
    get ingressNames(): string[];
    /** The concrete (asset, port) pairs this choice would create, minus ones that already exist. */
    get plan(): {
        specs: {
            from: string;
            fromPort: string;
            to: string;
            toPort: string;
        }[];
        total: number;
    };
    get summary(): string;
    get canConnect(): boolean;
    setEgress: (e: Event) => void;
    setIngress: (e: Event) => void;
    setMode: (e: Event) => void;
    close: () => void;
    connect: () => void;
}
export {};
//# sourceMappingURL=graph-connect-dialog.d.ts.map