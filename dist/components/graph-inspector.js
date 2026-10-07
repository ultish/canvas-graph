import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import '../canvas-graph-DfcbKwQG.js';
import { precompileTemplate } from '@ember/template-compilation';
import { setComponentTemplate } from '@ember/component';
import { g, i } from 'decorator-transforms/runtime-esm';

const ports = list => list.length ? list.slice(0, 4).map(x => `${x.name} ×${x.count}`).join(', ') + (list.length > 4 ? ` +${list.length - 4}` : '') : 'none';
/** One connection per line ("none" if there are none), with how many more there are than are listed. */
const links = (lines, total) => lines.length ? lines.join('\n') + (total > lines.length ? `\n+${total - lines.length} more` : '') : 'none';
const group = g => `${g.type} ×${g.count} · layer ${g.layer}`;
/**
 * A ready-made detail panel for whatever is selected. Optional: it only reads `handle.selection`, so replace it with
 * your own component (or a table) and the canvas does not care.
 */
class GraphInspector extends Component {
  static {
    g(this.prototype, "armedFor", [tracked], function () {
      return null;
    });
  }
  #armedFor = (i(this, "armedFor"), void 0);
  get selection() {
    return this.args.handle?.selection ?? null;
  }
  get title() {
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
  get rows() {
    const p = this.selection;
    if (!p) return [];
    switch (p.kind) {
      case 'edge':
        return [{
          label: 'From',
          value: `${p.from.name} · ${p.from.type}`
        }, {
          label: 'Egress port',
          value: p.from.port.name
        }, {
          label: 'To',
          value: `${p.to.name} · ${p.to.type}`
        }, {
          label: 'Ingress port',
          value: p.to.port.name
        }, {
          label: 'Route',
          value: p.route
        }, {
          label: 'State',
          value: p.deleting ? 'deleting…' : p.pending ? 'pending (saving…)' : p.enabled ? 'enabled' : 'disabled'
        }];
      case 'groupEdge':
        return [{
          label: 'From',
          value: group(p.from)
        }, {
          label: 'To',
          value: group(p.to)
        }, {
          label: 'Connections',
          value: String(p.count)
        }, {
          label: 'Route',
          value: p.route
        }, {
          label: 'Egress ports',
          value: ports(p.egressPorts)
        }, {
          label: 'Ingress ports',
          value: ports(p.ingressPorts)
        }, {
          label: 'State',
          value: `${p.enabled} enabled, ${p.count - p.enabled} disabled`
        }];
      case 'group':
        return [{
          label: 'Type',
          value: p.type
        }, {
          label: 'Layer',
          value: String(p.layer)
        }, {
          label: 'Assets',
          value: String(p.count)
        }, {
          label: 'Degraded',
          value: String(p.degraded)
        }, {
          label: 'Outgoing',
          value: p.outgoing.length ? p.outgoing.map(o => `${o.type} ×${o.count} (${o.edges})`).join(', ') : 'none'
        }, {
          label: 'Incoming',
          value: p.incoming.length ? p.incoming.map(o => `${o.type} ×${o.count} (${o.edges})`).join(', ') : 'none'
        }];
      default:
        return [{
          label: 'Asset',
          value: p.name
        }, {
          label: 'Type',
          value: p.type
        }, {
          label: 'Layer',
          value: String(p.layer)
        }, {
          label: 'Status',
          value: p.status
        }, {
          label: 'Group',
          value: `${p.group.type} ×${p.group.count}`
        }, {
          label: 'Ingress',
          value: links(p.incoming.map(l => `${l.other.name} · ${l.other.port.name} → ${l.own.name}`), p.inCount)
        }, {
          label: 'Egress',
          value: links(p.outgoing.map(l => `${l.own.name} → ${l.other.port.name} · ${l.other.name}`), p.outCount)
        }];
    }
  }
  get action() {
    const p = this.selection;
    if (p?.kind === 'edge') return {
      label: 'Delete connection'
    };
    if (p?.kind === 'groupEdge') return {
      label: this.armedFor === p ? `Click again to confirm: delete all ${p.count}` : `Delete all ${p.count} connections`
    };
    return null;
  }
  runAction = () => {
    const p = this.selection;
    const handle = this.args.handle;
    if (!p || !handle) return;
    if (p.kind === 'edge') handle.disconnect([p.id]);else if (p.kind === 'groupEdge') {
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
  /** On a group's panel: limit the name search in the top bar to this group (or lift the limit). */
  get searchScopeButton() {
    const p = this.selection;
    if (p?.kind !== 'group') return null;
    const on = this.args.handle?.searchScope === p.key;
    return {
      label: on ? 'Searching in this group · clear' : 'Search in this group',
      on
    };
  }
  toggleSearchScope = () => {
    const p = this.selection;
    const handle = this.args.handle;
    if (p?.kind !== 'group' || !handle) return;
    handle.searchInGroup(handle.searchScope === p.key ? null : p.key);
  };
  static {
    setComponentTemplate(precompileTemplate("{{#if this.selection}}\n  <aside class=\"cg-panel cg-inspector\" ...attributes>\n    <div class=\"cg-panel__title\">{{this.title}}</div>\n    {{#each this.rows as |row|}}\n      <div class=\"cg-panel__row\"><span>{{row.label}}</span><b>{{row.value}}</b></div>\n    {{/each}}\n    {{#if this.searchScopeButton}}\n      <div class=\"cg-panel__actions\">\n        <button type=\"button\" class={{if this.searchScopeButton.on \"cg-ok\"}} {{on \"click\" this.toggleSearchScope}}>{{this.searchScopeButton.label}}</button>\n      </div>\n    {{/if}}\n    {{#if this.action}}\n      <div class=\"cg-panel__actions\">\n        <button type=\"button\" class=\"cg-danger\" {{on \"click\" this.runAction}}>{{this.action.label}}</button>\n      </div>\n    {{/if}}\n  </aside>\n{{/if}}", {
      strictMode: true,
      scope: () => ({
        on
      })
    }), this);
  }
}

export { GraphInspector as default };
//# sourceMappingURL=graph-inspector.js.map
