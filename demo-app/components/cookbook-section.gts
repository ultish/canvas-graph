import type { TOC } from '@ember/component/template-only';

export interface CookbookSectionSignature {
  Element: HTMLElement;
  Args: {
    id: string;
    title: string;
    blurb?: string;
    code: string;
    codeOpen?: boolean;
  };
  Blocks: { default: [] };
}

/** One recipe: a live example above, the code that builds it below. */
const CookbookSection: TOC<CookbookSectionSignature> = <template>
  <section id={{@id}} class="cb-section" ...attributes>
    <header>
      <h2>{{@title}}</h2>
      {{#if @blurb}}<p class="cb-blurb">{{@blurb}}</p>{{/if}}
    </header>

    <div class="cb-live">
      <p class="cb-label">Live</p>
      {{yield}}
    </div>

    <details class="cb-code" open={{@codeOpen}}>
      <summary>How to build this</summary>
      <pre><code>{{@code}}</code></pre>
    </details>
  </section>
</template>;

export default CookbookSection;
