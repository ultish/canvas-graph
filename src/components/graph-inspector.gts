import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { SelectionPayload } from '../-private/engine/payloads.ts';
import type { GraphHandle } from '../graph-handle.ts';
import '../styles/canvas-graph.css';

export interface GraphInspectorSignature {
  Element: HTMLElement;
  Args: { handle: GraphHandle | undefined };
}

interface Row {
  label: string;
  value: string;
}

const ports = (list: ReadonlyArray<{ name: string; count: number }>): string =>
  list.length
    ? list
        .slice(0, 4)
        .map((x) => `${x.name} ×${x.count}`)
        .join(', ') + (list.length > 4 ? ` +${list.length - 4}` : '')
    : 'none';
const group = (g: { type: string; count: number; layer: number }): string =>
  `${g.type} ×${g.count} · layer ${g.layer}`;

/**
 * A ready-made detail panel for whatever is selected. Optional: it only reads `handle.selection`, so replace it with
 * your own component (or a table) and the canvas does not care.
 */
export default class GraphInspector extends Component<GraphInspectorSignature> {
  @tracked armedFor: SelectionPayload | null = null;
  @tracked query = '';
  @tracked matches: string[] = [];
  private queryKey = '';

  get selection(): SelectionPayload | null {
    return this.args.handle?.selection ?? null;
  }

  get title(): string {
    switch (this.selection?.kind) {
      case 'edge':
        return 'Connection';
      case 'groupEdge':
        return 'Group connections';
      case 'group':
        return 'Group';
      default:
        return 'Asset';
    }
  }

  get rows(): Row[] {
    const p = this.selection;
    if (!p) return [];
    switch (p.kind) {
      case 'edge':
        return [
          { label: 'From', value: `${p.from.name} · ${p.from.type}` },
          { label: 'Egress port', value: p.from.port.name },
          { label: 'To', value: `${p.to.name} · ${p.to.type}` },
          { label: 'Ingress port', value: p.to.port.name },
          { label: 'Route', value: p.route },
          {
            label: 'State',
            value: p.deleting
              ? 'deleting…'
              : p.pending
                ? 'pending (saving…)'
                : p.enabled
                  ? 'enabled'
                  : 'disabled',
          },
        ];
      case 'groupEdge':
        return [
          { label: 'From', value: group(p.from) },
          { label: 'To', value: group(p.to) },
          { label: 'Connections', value: String(p.count) },
          { label: 'Route', value: p.route },
          { label: 'Egress ports', value: ports(p.egressPorts) },
          { label: 'Ingress ports', value: ports(p.ingressPorts) },
          {
            label: 'State',
            value: `${p.enabled} enabled, ${p.count - p.enabled} disabled`,
          },
        ];
      case 'group':
        return [
          { label: 'Type', value: p.type },
          { label: 'Layer', value: String(p.layer) },
          { label: 'Assets', value: String(p.count) },
          { label: 'Degraded', value: String(p.degraded) },
          {
            label: 'Outgoing',
            value: p.outgoing.length
              ? p.outgoing
                  .map((o) => `${o.type} ×${o.count} (${o.edges})`)
                  .join(', ')
              : 'none',
          },
          {
            label: 'Incoming',
            value: p.incoming.length
              ? p.incoming
                  .map((o) => `${o.type} ×${o.count} (${o.edges})`)
                  .join(', ')
              : 'none',
          },
        ];
      default:
        return [
          { label: 'Asset', value: p.name },
          { label: 'Type', value: p.type },
          { label: 'Layer', value: String(p.layer) },
          { label: 'Status', value: p.status },
          { label: 'Group', value: `${p.group.type} ×${p.group.count}` },
          {
            label: 'Ingress',
            value: `${p.inCount} on ${ports(p.ingressPorts)}`,
          },
          {
            label: 'Egress',
            value: `${p.outCount} on ${ports(p.egressPorts)}`,
          },
        ];
    }
  }

  get action(): { label: string } | null {
    const p = this.selection;
    if (p?.kind === 'edge') return { label: 'Delete connection' };
    if (p?.kind === 'groupEdge')
      return {
        label:
          this.armedFor === p
            ? `Click again to confirm: delete all ${p.count}`
            : `Delete all ${p.count} connections`,
      };
    return null;
  }

  runAction = (): void => {
    const p = this.selection;
    const handle = this.args.handle;
    if (!p || !handle) return;
    if (p.kind === 'edge') handle.disconnect([p.id]);
    else if (p.kind === 'groupEdge') {
      if (this.armedFor !== p) {
        // a bulk delete needs a second click
        this.armedFor = p;
        setTimeout(() => {
          if (this.armedFor === p) this.armedFor = null;
        }, 3000);
        return;
      }
      this.armedFor = null;
      handle.disconnect(p.edgeIds);
    }
  };

  /** The search box on a group's panel: ring and name the matching assets on the canvas, hiding nothing. */
  get groupSearch(): { key: string; ids: readonly string[] } | null {
    const p = this.selection;
    return p?.kind === 'group' ? { key: p.key, ids: p.assetIds } : null;
  }

  get queryText(): string {
    return this.queryKey === this.groupSearch?.key ? this.query : '';
  }

  get found(): Array<{ id: string; name: string }> {
    if (this.queryKey !== this.groupSearch?.key) return [];
    const handle = this.args.handle;
    return this.matches
      .slice(0, 8)
      .map((id) => ({ id, name: handle?.asset(id)?.name ?? id }));
  }

  get foundMore(): number {
    return this.queryKey === this.groupSearch?.key
      ? Math.max(0, this.matches.length - 8)
      : 0;
  }

  search = (e: Event): void => {
    const s = this.groupSearch;
    const handle = this.args.handle;
    if (!s || !handle) return;
    this.queryKey = s.key;
    this.query = (e.target as HTMLInputElement).value;
    this.matches = handle.findAssets(s.ids, this.query);
    handle.highlightAssets(this.matches);
  };

  goTo = (e: Event): void => {
    const id = (e.currentTarget as HTMLElement).dataset['id'];
    if (id) this.args.handle?.focusAsset(id);
  };

  <template>
    {{#if this.selection}}
      <aside class="cg-panel cg-inspector" ...attributes>
        <div class="cg-panel__title">{{this.title}}</div>
        {{#each this.rows as |row|}}
          <div class="cg-panel__row"><span>{{row.label}}</span><b
            >{{row.value}}</b></div>
        {{/each}}
        {{#if this.groupSearch}}
          <div class="cg-panel__search">
            <input
              type="search"
              placeholder="Find an asset in this group"
              aria-label="Find an asset in this group"
              value={{this.queryText}}
              {{on "input" this.search}}
            />
            {{#if this.found.length}}
              <ul>
                {{#each this.found as |f|}}
                  <li><button
                      type="button"
                      data-id={{f.id}}
                      {{on "click" this.goTo}}
                    >{{f.name}}</button></li>
                {{/each}}
                {{#if this.foundMore}}<li
                    class="cg-panel__more"
                  >+{{this.foundMore}}
                    more, highlighted on the canvas</li>{{/if}}
              </ul>
            {{else if this.queryText}}
              <div class="cg-panel__more">No match</div>
            {{/if}}
          </div>
        {{/if}}
        {{#if this.action}}
          <div class="cg-panel__actions">
            <button
              type="button"
              class="cg-danger"
              {{on "click" this.runAction}}
            >{{this.action.label}}</button>
          </div>
        {{/if}}
      </aside>
    {{/if}}
  </template>
}
