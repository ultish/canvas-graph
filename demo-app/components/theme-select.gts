import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

export const THEMES = [
  'light',
  'dark',
  'cupcake',
  'forest',
  'nord',
  'business',
  'dracula',
  'lemonade',
] as const;
const KEY = 'canvas-graph-theme';

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // private windows, blocked storage
  }
}

function apply(theme: string): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* the theme just does not persist */
  }
}

/** Call once at start: the saved theme, else dark. The canvases redraw by themselves when `data-theme` changes. */
export function initTheme(): void {
  const t = stored();
  document.documentElement.setAttribute(
    'data-theme',
    t && (THEMES as readonly string[]).includes(t) ? t : 'dark',
  );
}

/** A DaisyUI theme picker. Setting `data-theme` on <html> re-themes the page, and canvas-graph follows. */
export default class ThemeSelect extends Component {
  @tracked theme =
    document.documentElement.getAttribute('data-theme') ?? 'dark';

  change = (e: Event): void => {
    this.theme = (e.target as HTMLSelectElement).value;
    apply(this.theme);
  };

  <template>
    <label class="theme-select">
      <span>Theme</span>
      <select {{on "change" this.change}}>
        {{#each THEMES as |t|}}
          <option value={{t}} selected={{if (this.is t) true}}>{{t}}</option>
        {{/each}}
      </select>
    </label>
  </template>

  is = (t: string): boolean => t === this.theme;
}
