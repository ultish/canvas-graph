import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import type { ConnectRequest } from '../-private/engine/engine.ts';
import type { GraphHandle } from '../graph-handle.ts';

export interface GraphConnectDialogSignature {
  Element: HTMLElement;
  Args: { handle: GraphHandle | undefined };
}

type Mode = 'fan' | 'zip';
const natural = (p: string, q: string): number =>
  Number.isNaN(Number(p)) || Number.isNaN(Number(q))
    ? p.localeCompare(q)
    : Number(p) - Number(q);

/**
 * A stand-in for your own bulk-connect UI: it shows when a group is dragged onto another, offers port and pairing
 * choices, and calls `handle.connectMany`. It listens passively, so it never counts as your request handler.
 * Leave it out and handle `@onConnectRequest` (source 'group-drag') yourself.
 */
export default class GraphConnectDialog extends Component<GraphConnectDialogSignature> {
  @tracked request: ConnectRequest | null = null;
  @tracked egress = '';
  @tracked ingress = '';
  @tracked mode: Mode = 'fan';

  listen = modifier((_el: HTMLElement, [handle]: [GraphHandle | undefined]) => {
    if (!handle) return undefined;
    return handle.on(
      'connectRequest',
      (r) => {
        if (r.source !== 'group-drag') return;
        this.request = r;
        this.egress = this.egressNames[0] ?? '';
        this.ingress = this.ingressNames[0] ?? '';
      },
      { passive: true },
    );
  });

  private assets(ids: readonly string[]) {
    return ids.map((id) => this.args.handle?.asset(id)).filter((a) => !!a);
  }

  get from() {
    return this.request ? this.assets(this.request.from.assetIds) : [];
  }

  get to() {
    return this.request ? this.assets(this.request.to.assetIds) : [];
  }

  get egressNames(): string[] {
    return [
      ...new Set(this.from.flatMap((a) => a.outputPorts.map((p) => p.name))),
    ].sort(natural);
  }

  get ingressNames(): string[] {
    return [
      ...new Set(this.to.flatMap((a) => a.inputPorts.map((p) => p.name))),
    ].sort(natural);
  }

  /** The concrete (asset, port) pairs this choice would create, minus ones that already exist. */
  get plan() {
    const handle = this.args.handle;
    if (!handle || !this.request) return { specs: [], total: 0 };
    const A = this.from;
    const B = this.to;
    const pairs =
      this.mode === 'zip'
        ? A.slice(0, Math.min(A.length, B.length)).map(
            (a, i) => [a, B[i]!] as const,
          )
        : A.flatMap((a) => B.map((b) => [a, b] as const));
    if (pairs.length > 50000) return { specs: [], total: pairs.length };
    const specs = [];
    for (const [a, b] of pairs) {
      const f = a.outputPorts.find((p) => p.name === this.egress);
      const t = b.inputPorts.find((p) => p.name === this.ingress);
      if (!f || !t || a.id === b.id || handle.connected(a.id, f.id, b.id, t.id))
        continue;
      specs.push({ from: a.id, fromPort: f.id, to: b.id, toPort: t.id });
    }
    return { specs, total: pairs.length };
  }

  get summary(): string {
    const { specs, total } = this.plan;
    if (total > 50000) return 'too many pairs (max 50,000)';
    const skipped = total - specs.length;
    return `${specs.length} new connections${skipped ? ` (${skipped} skipped: missing port or already linked)` : ''}`;
  }

  get canConnect(): boolean {
    return this.plan.specs.length > 0;
  }

  setEgress = (e: Event): void =>
    void (this.egress = (e.target as HTMLSelectElement).value);
  setIngress = (e: Event): void =>
    void (this.ingress = (e.target as HTMLSelectElement).value);
  setMode = (e: Event): void =>
    void (this.mode = (e.target as HTMLSelectElement).value as Mode);
  close = (): void => void (this.request = null);
  connect = (): void => {
    this.args.handle?.connectMany(this.plan.specs);
    this.request = null;
  };

  <template>
    <span hidden {{this.listen @handle}}></span>
    {{#if this.request}}
      <aside class="cg-panel cg-connect" ...attributes>
        <div class="cg-panel__title">Connect groups</div>
        <div class="cg-panel__row"><span>From</span><b
          >{{this.request.from.type}} ×{{this.request.from.count}}</b></div>
        <div class="cg-panel__row"><span>To</span><b>{{this.request.to.type}}
            ×{{this.request.to.count}}</b></div>
        <div class="cg-panel__row"><span>Egress port</span>
          <select {{on "change" this.setEgress}}>
            {{#each this.egressNames as |n|}}<option
                value={{n}}
              >{{n}}</option>{{/each}}
          </select>
        </div>
        <div class="cg-panel__row"><span>Ingress port</span>
          <select {{on "change" this.setIngress}}>
            {{#each this.ingressNames as |n|}}<option
                value={{n}}
              >{{n}}</option>{{/each}}
          </select>
        </div>
        <div class="cg-panel__row"><span>Pairing</span>
          <select {{on "change" this.setMode}}>
            <option value="fan">every source → every target</option>
            <option value="zip">pair one-to-one, in order</option>
          </select>
        </div>
        <div class="cg-panel__row"><span>Result</span><b
          >{{this.summary}}</b></div>
        <div class="cg-panel__actions">
          <button
            type="button"
            class="cg-ok"
            disabled={{if this.canConnect false true}}
            {{on "click" this.connect}}
          >Connect</button>
          <button type="button" {{on "click" this.close}}>Cancel</button>
        </div>
      </aside>
    {{/if}}
  </template>
}
