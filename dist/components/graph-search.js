import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import '../canvas-graph-DfcbKwQG.js';
import { precompileTemplate } from '@ember/template-compilation';
import { setComponentTemplate } from '@ember/component';
import { g, i } from 'decorator-transforms/runtime-esm';

/**
 * One search box over every asset's name. Typing lists matching groups (pick one to search only inside it) and
 * assets (pick one to select it and move the camera to it); every match is ringed on the canvas meanwhile. The group
 * a search is limited to is `handle.searchScope`, shared with the inspector's "Search in this group" button, and
 * shown as a chip you can clear (✕, or Backspace in an empty box). Optional: it only uses the handle's search methods.
 */
class GraphSearch extends Component {
  static {
    g(this.prototype, "query", [tracked], function () {
      return '';
    });
  }
  #query = (i(this, "query"), void 0);
  static {
    g(this.prototype, "items", [tracked], function () {
      return [];
    });
  }
  #items = (i(this, "items"), void 0);
  static {
    g(this.prototype, "total", [tracked], function () {
      return 0;
    });
  }
  #total = (i(this, "total"), void 0);
  static {
    g(this.prototype, "active", [tracked], function () {
      return 0;
    });
  }
  #active = (i(this, "active"), void 0);
  static {
    g(this.prototype, "open", [tracked], function () {
      return false;
    });
  }
  #open = (i(this, "open"), void 0);
  get scope() {
    return this.args.handle?.scopeGroup;
  }
  get more() {
    const shown = this.items.filter(i => i.kind === 'asset').length;
    return Math.max(0, this.total - shown);
  }
  get showList() {
    return this.open && this.query.trim() !== '';
  }
  get placeholder() {
    return this.scope ? 'Find an asset in this group' : 'Find an asset by name';
  }
  run(text) {
    const handle = this.args.handle;
    this.query = text;
    this.active = 0;
    this.open = true;
    if (!handle) return;
    const groups = this.scope ? [] : handle.searchGroups(text);
    const r = handle.searchAssets(text, this.args.limit ?? 8);
    this.total = r.total;
    this.items = [...groups.map(g => ({
      kind: 'group',
      id: g.key,
      label: `${g.type} ×${g.count}`,
      note: 'search in this group'
    })), ...r.hits.map(h => ({
      kind: 'asset',
      id: h.id,
      label: h.name,
      note: h.type
    }))];
    handle.highlightAssets(r.all);
  }
  choose(item) {
    const handle = this.args.handle;
    if (!handle || !item) return;
    if (item.kind === 'group') {
      handle.searchInGroup(item.id);
      this.run(''); // the box starts over, inside the group
      this.open = false;
      return;
    }
    this.query = item.label;
    handle.chooseAsset({
      id: item.id,
      name: item.label,
      type: item.note
    }, this.args.zoom ?? 0.55);
    this.open = false;
  }
  input = e => this.run(e.target.value);
  focus = () => {
    if (this.query) this.run(this.query); // the text may have been set by a pick: list what it matches now
  };
  pick = e => {
    const id = e.currentTarget.dataset['id'];
    const kind = e.currentTarget.dataset['kind'];
    const item = this.items.find(i => i.id === id && i.kind === kind);
    this.choose(item);
    // a group pick starts a search inside it: keep typing
    if (item?.kind === 'group') this.focusBox(e.currentTarget);
  };
  focusBox(from) {
    from.closest('.cg-search')?.querySelector('input')?.focus();
  }
  clearScope = e => {
    this.args.handle?.searchInGroup(null);
    this.run(this.query);
    this.focusBox(e.currentTarget);
  };
  isActive = i => i === this.active;
  key = e => {
    const n = this.items.length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      this.active = (this.active + 1) % n;
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      this.active = (this.active - 1 + n) % n;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.choose(this.items[this.active]);
    } else if (e.key === 'Escape') {
      this.open = false;
      e.target.blur();
    } else if (e.key === 'Backspace' && this.scope && e.target.value === '') {
      this.args.handle?.searchInGroup(null);
      this.run('');
    }
  };
  /** Close the list when a press lands anywhere outside the search box. */
  dismissOutside = modifier(el => {
    const away = e => {
      if (!el.contains(e.target)) this.open = false;
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  });
  static {
    setComponentTemplate(precompileTemplate("<div class=\"cg-search\" {{this.dismissOutside}} ...attributes>\n  <div class=\"cg-search__box\">\n    {{#if this.scope}}\n      <span class=\"cg-search__chip\">in:\n        {{this.scope.type}}\n        \xD7{{this.scope.count}}\n        <button type=\"button\" aria-label=\"Search everywhere\" {{on \"click\" this.clearScope}}>\u2715</button></span>\n    {{/if}}\n    <input type=\"search\" class=\"cg-search__input\" placeholder={{this.placeholder}} aria-label={{this.placeholder}} autocomplete=\"off\" value={{this.query}} {{on \"input\" this.input}} {{on \"focus\" this.focus}} {{on \"keydown\" this.key}} />\n  </div>\n  {{#if this.showList}}\n    <ul class=\"cg-search__list\">\n      {{#each this.items as |h i|}}\n        <li>\n          <button type=\"button\" data-id={{h.id}} data-kind={{h.kind}} class={{if (this.isActive i) \"cg-search__item is-active\" \"cg-search__item\"}} {{on \"click\" this.pick}}><span>{{h.label}}</span><small>{{h.note}}</small></button>\n        </li>\n      {{else}}\n        <li class=\"cg-search__none\">No match</li>\n      {{/each}}\n      {{#if this.more}}<li class=\"cg-search__none\">+{{this.more}}\n          more, all ringed on the canvas: keep typing</li>{{/if}}\n    </ul>\n  {{/if}}\n</div>", {
      strictMode: true,
      scope: () => ({
        on
      })
    }), this);
  }
}

export { GraphSearch as default };
//# sourceMappingURL=graph-search.js.map
