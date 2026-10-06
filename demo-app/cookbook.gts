import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';
import CookbookSection from './components/cookbook-section.gts';
import * as recipes from './cookbook/recipes.ts';
import {
  ApolloUpdates,
  Colours,
  Connect,
  DeleteUndo,
  GroupConnect,
  HandleApi,
  LayoutRules,
  QuickStart,
  Selection,
} from './cookbook/examples.gts';

const TOC = [
  { id: 'quick-start', label: 'Quick start' },
  { id: 'colours', label: 'Colours' },
  { id: 'layout', label: 'Layout' },
  { id: 'selection', label: 'Selecting' },
  { id: 'connect', label: 'Connecting' },
  { id: 'apollo', label: 'Apollo updates' },
  { id: 'group-connect', label: 'Bulk connect' },
  { id: 'delete', label: 'Delete & undo' },
  { id: 'handle', label: 'The handle' },
];

export default class Cookbook extends Component {
  toc = TOC;
  recipes = recipes;

  <template>
    <div class="cb">
      <header class="cb__header">
        <div>
          <p class="cb__eyebrow">Cookbook</p>
          <LinkTo @route="index" class="cb__home">canvas-graph</LinkTo>
        </div>
        <LinkTo @route="index" class="cb__back">← the full demo</LinkTo>
      </header>

      <main class="cb__main">
        <section class="cb-intro">
          <h1>A topology canvas that asks, and your data answers.</h1>
          <p>
            <code>canvas-graph</code>
            draws thousands of assets on a plain 2D canvas, so it needs no GPU:
            group blocks and fat pipes zoomed out, full cards with named ports
            and individual wires zoomed in. It never edits your data. A gesture
            is an
            <strong>intent</strong>: the canvas draws it faded, asks your
            handler (a Promise), and settles when your data contains it, or
            fades it away if you say no.
          </p>
          <p>
            Every example below is live and runs on a
            <strong>fake Apollo cache</strong>
            (<code>demo-app/apollo-fake.ts</code>): immutable entities,
            optimistic responses, a subscription, mutations that take a moment
            and can fail.
          </p>
          <nav class="cb__toc">
            {{#each this.toc as |item|}}<a
                href="#{{item.id}}"
              >{{item.label}}</a>{{/each}}
          </nav>
        </section>

        <CookbookSection
          @id="quick-start"
          @title="Quick start"
          @blurb="Give it data and a parent with a height. Layout, colours, ports, zoom levels and culling are automatic."
          @code={{this.recipes.quickStart}}
        >
          <QuickStart />
        </CookbookSection>

        <CookbookSection
          @id="colours"
          @title="Colours"
          @blurb="An asset's colour comes from its type. Pin the ones you care about; every other type gets a stable colour."
          @code={{this.recipes.colours}}
        >
          <Colours />
        </CookbookSection>

        <CookbookSection
          @id="layout"
          @title="Layout: loops, skips, side pipelines, stragglers"
          @blurb="Layers run left to right. Cycles loop over the top, layer-skipping connections run underneath, unconnected assets are gathered, and small pipelines pack together."
          @code={{this.recipes.layoutRules}}
        >
          <LayoutRules />
        </CookbookSection>

        <CookbookSection
          @id="selection"
          @title="Selecting, and the inspector"
          @blurb="Selection is plain data in a tracked property. Use the ready-made panel, or render your own."
          @code={{this.recipes.selection}}
        >
          <Selection />
        </CookbookSection>

        <CookbookSection
          @id="connect"
          @title="Connecting two ports"
          @blurb="Draw it now, ask the host, settle or fade. The request carries asset ids and the two ports."
          @code={{this.recipes.connect}}
        >
          <Connect />
        </CookbookSection>

        <CookbookSection
          @id="apollo"
          @title="Apollo updates: a tick costs one entity"
          @blurb="The payload is folded in by object identity, so a one-field subscription message visits one entity out of the whole graph."
          @code={{this.recipes.apollo}}
        >
          <ApolloUpdates />
        </CookbookSection>

        <CookbookSection
          @id="group-connect"
          @title="Bulk connect: drag one group onto another"
          @blurb="Zoomed out, groups have handles. The request hands you every asset on each side and the cardinality; you build the pairings."
          @code={{this.recipes.groupConnect}}
        >
          <GroupConnect />
        </CookbookSection>

        <CookbookSection
          @id="delete"
          @title="Delete and undo"
          @blurb="A delete is an intent too: the wire fades while your handler works, and springs back if it fails. Undo asks for the inverse."
          @code={{this.recipes.deleteUndo}}
        >
          <DeleteUndo />
        </CookbookSection>

        <CookbookSection
          @id="handle"
          @title="The handle"
          @blurb="Everything you can ask the canvas to do, from @onReady."
          @code={{this.recipes.handleApi}}
        >
          <HandleApi />
        </CookbookSection>
      </main>
    </div>
  </template>
}
