import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import '../canvas-graph-DfcbKwQG.js';
import { precompileTemplate } from '@ember/template-compilation';
import { setComponentTemplate } from '@ember/component';
import { g, i } from 'decorator-transforms/runtime-esm';

const natural = (p, q) => Number.isNaN(Number(p)) || Number.isNaN(Number(q)) ? p.localeCompare(q) : Number(p) - Number(q);
/**
 * A stand-in for your own bulk-connect UI: it shows when a group is dragged onto another, offers port and pairing
 * choices, and calls `handle.connectMany`. It listens passively, so it never counts as your request handler.
 * Leave it out and handle `@onConnectRequest` (source 'group-drag') yourself.
 */
class GraphConnectDialog extends Component {
  static {
    g(this.prototype, "request", [tracked], function () {
      return null;
    });
  }
  #request = (i(this, "request"), void 0);
  static {
    g(this.prototype, "egress", [tracked], function () {
      return '';
    });
  }
  #egress = (i(this, "egress"), void 0);
  static {
    g(this.prototype, "ingress", [tracked], function () {
      return '';
    });
  }
  #ingress = (i(this, "ingress"), void 0);
  static {
    g(this.prototype, "mode", [tracked], function () {
      return 'fan';
    });
  }
  #mode = (i(this, "mode"), void 0);
  listen = modifier((_el, [handle]) => {
    if (!handle) return undefined;
    return handle.on('connectRequest', r => {
      if (r.source !== 'group-drag') return;
      this.request = r;
      this.egress = this.egressNames[0] ?? '';
      this.ingress = this.ingressNames[0] ?? '';
    }, {
      passive: true
    });
  });
  assets(ids) {
    return ids.map(id => this.args.handle?.asset(id)).filter(a => !!a);
  }
  get from() {
    return this.request ? this.assets(this.request.from.assetIds) : [];
  }
  get to() {
    return this.request ? this.assets(this.request.to.assetIds) : [];
  }
  get egressNames() {
    return [...new Set(this.from.flatMap(a => a.outputPorts.map(p => p.name)))].sort(natural);
  }
  get ingressNames() {
    return [...new Set(this.to.flatMap(a => a.inputPorts.map(p => p.name)))].sort(natural);
  }
  /** The concrete (asset, port) pairs this choice would create, minus ones that already exist. */
  get plan() {
    const handle = this.args.handle;
    if (!handle || !this.request) return {
      specs: [],
      total: 0
    };
    const A = this.from;
    const B = this.to;
    const pairs = this.mode === 'zip' ? A.slice(0, Math.min(A.length, B.length)).map((a, i) => [a, B[i]]) : A.flatMap(a => B.map(b => [a, b]));
    if (pairs.length > 50000) return {
      specs: [],
      total: pairs.length
    };
    const specs = [];
    for (const [a, b] of pairs) {
      const f = a.outputPorts.find(p => p.name === this.egress);
      const t = b.inputPorts.find(p => p.name === this.ingress);
      if (!f || !t || a.id === b.id || handle.connected(a.id, f.id, b.id, t.id)) continue;
      specs.push({
        from: a.id,
        fromPort: f.id,
        to: b.id,
        toPort: t.id
      });
    }
    return {
      specs,
      total: pairs.length
    };
  }
  get summary() {
    const {
      specs,
      total
    } = this.plan;
    if (total > 50000) return 'too many pairs (max 50,000)';
    const skipped = total - specs.length;
    return `${specs.length} new connections${skipped ? ` (${skipped} skipped: missing port or already linked)` : ''}`;
  }
  get canConnect() {
    return this.plan.specs.length > 0;
  }
  setEgress = e => void (this.egress = e.target.value);
  setIngress = e => void (this.ingress = e.target.value);
  setMode = e => void (this.mode = e.target.value);
  close = () => {
    this.args.handle?.cancelGroupConnect();
    this.request = null;
  };
  connect = () => {
    const specs = this.plan.specs;
    if (this.args.onConnect) this.args.onConnect(specs);else this.args.handle?.connectMany(specs);
    this.request = null;
  };
  static {
    setComponentTemplate(precompileTemplate("<span hidden {{this.listen @handle}}></span>\n{{#if this.request}}\n  <aside class=\"cg-panel cg-connect\" ...attributes>\n    <div class=\"cg-panel__title\">Connect groups</div>\n    <div class=\"cg-panel__row\"><span>From</span><b>{{this.request.from.type}} \xD7{{this.request.from.count}}</b></div>\n    <div class=\"cg-panel__row\"><span>To</span><b>{{this.request.to.type}}\n        \xD7{{this.request.to.count}}</b></div>\n    <div class=\"cg-panel__row\"><span>Egress port</span>\n      <select aria-label=\"Egress port\" {{on \"change\" this.setEgress}}>\n        {{#each this.egressNames as |n|}}<option value={{n}}>{{n}}</option>{{/each}}\n      </select>\n    </div>\n    <div class=\"cg-panel__row\"><span>Ingress port</span>\n      <select aria-label=\"Ingress port\" {{on \"change\" this.setIngress}}>\n        {{#each this.ingressNames as |n|}}<option value={{n}}>{{n}}</option>{{/each}}\n      </select>\n    </div>\n    <div class=\"cg-panel__row\"><span>Pairing</span>\n      <select aria-label=\"Pairing\" {{on \"change\" this.setMode}}>\n        <option value=\"fan\">every source \u2192 every target</option>\n        <option value=\"zip\">pair one-to-one, in order</option>\n      </select>\n    </div>\n    <div class=\"cg-panel__row\"><span>Result</span><b>{{this.summary}}</b></div>\n    <div class=\"cg-panel__actions\">\n      <button type=\"button\" class=\"cg-ok\" disabled={{if this.canConnect false true}} {{on \"click\" this.connect}}>Connect</button>\n      <button type=\"button\" {{on \"click\" this.close}}>Cancel</button>\n    </div>\n  </aside>\n{{/if}}", {
      strictMode: true,
      scope: () => ({
        on
      })
    }), this);
  }
}

export { GraphConnectDialog as default };
//# sourceMappingURL=graph-connect-dialog.js.map
