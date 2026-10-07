import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
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
  id: string; // an asset id, or a group key
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
  @tracked query = '';
  @tracked items: Item[] = [];
  @tracked total = 0;
  @tracked active = 0;
  @tracked open = false;

  get scope(): GroupSummary | undefined {
    return this.args.handle?.scopeGroup;
  }

  get more(): number {
    const shown = this.items.filter((i) => i.kind === 'asset').length;
    return Math.max(0, this.total - shown);
  }

  get showList(): boolean {
    return this.open && this.query.trim() !== '';
  }

  get placeholder(): string {
    return this.scope ? 'Find an asset in this group' : 'Find an asset by name';
  }

  private run(text: string): void {
    const handle = this.args.handle;
    this.query = text;
    this.active = 0;
    this.open = true;
    if (!handle) return;
    const groups = this.scope ? [] : handle.searchGroups(text);
    const r = handle.searchAssets(text, this.args.limit ?? 8);
    this.total = r.total;
    this.items = [
      ...groups.map((g) => ({
        kind: 'group' as const,
        id: g.key,
        label: `${g.type} ×${g.count}`,
        note: 'search in this group',
      })),
      ...r.hits.map((h) => ({
        kind: 'asset' as const,
        id: h.id,
        label: h.name,
        note: h.type,
      })),
    ];
    handle.highlightAssets(r.all);
  }

  private choose(item: Item | undefined): void {
    const handle = this.args.handle;
    if (!handle || !item) return;
    if (item.kind === 'group') {
      handle.searchInGroup(item.id);
      this.run(''); // the box starts over, inside the group
      this.open = false;
      return;
    }
    this.query = item.label;
    handle.chooseAsset(
      { id: item.id, name: item.label, type: item.note },
      this.args.zoom ?? 0.55,
    );
    this.open = false;
  }

  input = (e: Event): void => this.run((e.target as HTMLInputElement).value);
  focus = (): void => {
    if (this.query) this.run(this.query); // the text may have been set by a pick: list what it matches now
  };

  pick = (e: Event): void => {
    const id = (e.currentTarget as HTMLElement).dataset['id'];
    const kind = (e.currentTarget as HTMLElement).dataset['kind'];
    const item = this.items.find((i) => i.id === id && i.kind === kind);
    this.choose(item);
    // a group pick starts a search inside it: keep typing
    if (item?.kind === 'group') this.focusBox(e.currentTarget as HTMLElement);
  };

  private focusBox(from: HTMLElement): void {
    from.closest('.cg-search')?.querySelector('input')?.focus();
  }

  clearScope = (e: Event): void => {
    this.args.handle?.searchInGroup(null);
    this.run(this.query);
    this.focusBox(e.currentTarget as HTMLElement);
  };

  isActive = (i: number): boolean => i === this.active;

  key = (e: KeyboardEvent): void => {
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
      (e.target as HTMLInputElement).blur();
    } else if (
      e.key === 'Backspace' &&
      this.scope &&
      (e.target as HTMLInputElement).value === ''
    ) {
      this.args.handle?.searchInGroup(null);
      this.run('');
    }
  };

  /** Close the list when a press lands anywhere outside the search box. */
  dismissOutside = modifier((el: HTMLElement) => {
    const away = (e: Event): void => {
      if (!el.contains(e.target as Node)) this.open = false;
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  });

  <template>
    <div class="cg-search" {{this.dismissOutside}} ...attributes>
      <div class="cg-search__box">
        {{#if this.scope}}
          <span class="cg-search__chip">in:
            {{this.scope.type}}
            ×{{this.scope.count}}
            <button
              type="button"
              aria-label="Search everywhere"
              {{on "click" this.clearScope}}
            >✕</button></span>
        {{/if}}
        <input
          type="search"
          class="cg-search__input"
          placeholder={{this.placeholder}}
          aria-label={{this.placeholder}}
          autocomplete="off"
          value={{this.query}}
          {{on "input" this.input}}
          {{on "focus" this.focus}}
          {{on "keydown" this.key}}
        />
      </div>
      {{#if this.showList}}
        <ul class="cg-search__list">
          {{#each this.items as |h i|}}
            <li>
              <button
                type="button"
                data-id={{h.id}}
                data-kind={{h.kind}}
                class={{if
                  (this.isActive i)
                  "cg-search__item is-active"
                  "cg-search__item"
                }}
                {{on "click" this.pick}}
              ><span>{{h.label}}</span><small>{{h.note}}</small></button>
            </li>
          {{else}}
            <li class="cg-search__none">No match</li>
          {{/each}}
          {{#if this.more}}<li class="cg-search__none">+{{this.more}}
              more, all ringed on the canvas: keep typing</li>{{/if}}
        </ul>
      {{/if}}
    </div>
  </template>
}
