import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { effectivePixelRatio } from '#src/-private/engine/pixel-ratio.ts';
import ThemeSelect from './components/theme-select.gts';
import { runBench, type BenchRow } from './bench/run.ts';

const SIZES = [1000, 5000, 20000, 60000];

export default class Bench extends Component {
  sizes = SIZES;
  @tracked size = 5000;
  @tracked running = false;
  @tracked status = '';
  @tracked rows: BenchRow[] = [];
  @tracked entities = 0;
  @tracked ranFor = 0;

  get env(): string {
    const dpr = window.devicePixelRatio || 1;
    return `${navigator.hardwareConcurrency ?? '?'} logical cores · screen ${dpr}× → canvas drawn at ${effectivePixelRatio(dpr)}× · ${navigator.userAgent.replace(/^Mozilla\/5.0 /, '').slice(0, 80)}`;
  }

  get report(): string {
    return [
      `canvas-graph bench: ${this.ranFor.toLocaleString()} assets, ${this.entities.toLocaleString()} entities`,
      this.env,
      ...this.rows.map(
        (r) =>
          `${r.name.padEnd(46)} median ${r.median.toFixed(2).padStart(8)} ms   p95 ${r.p95.toFixed(2).padStart(8)} ms${r.note ? `   (${r.note})` : ''}`,
      ),
    ].join('\n');
  }

  setSize = (e: Event): void =>
    void (this.size = Number((e.target as HTMLSelectElement).value));

  run = async (): Promise<void> => {
    this.running = true;
    this.rows = [];
    try {
      const out = await runBench(
        this.size,
        (s) => (this.status = `running: ${s}…`),
      );
      this.rows = out.rows;
      this.entities = out.entities;
      this.ranFor = this.size;
      this.status = 'done';
    } catch (e) {
      this.status = `failed: ${String(e)}`;
    } finally {
      this.running = false;
    }
  };

  copy = (): void =>
    void navigator.clipboard?.writeText(this.report).catch(() => undefined);

  <template>
    <div class="cb">
      <header class="cb__header">
        <div>
          <p class="cb__eyebrow">Benchmark</p>
          <LinkTo @route="index" class="cb__home">canvas-graph</LinkTo>
        </div>
        <div class="cb__tools">
          <ThemeSelect />
          <LinkTo @route="cookbook" class="cb__back">Cookbook</LinkTo>
          <LinkTo @route="index" class="cb__back">← the full demo</LinkTo>
        </div>
      </header>

      <main class="cb__main">
        <section class="cb-intro">
          <h1>How fast is it on this machine?</h1>
          <p>
            This times the whole pipeline on a graph of the size you pick:
            syncing data in, the layout, connection changes, and drawing frames
            at each zoom level on a real canvas. Frames are drawn one after
            another in code (not on the display's schedule), so it measures the
            cost of drawing itself.
          </p>
          <p>
            <strong>To approximate a slower client:</strong>
            open DevTools → Performance → the gear →
            <em>CPU: 4× slowdown</em>
            (or 6×), then press Run. A frame has about 16 ms to stay at 60 fps,
            33 ms for 30 fps.
          </p>
        </section>

        <div class="cb-row">
          <label class="cb-field">Assets
            <select {{on "change" this.setSize}}>
              {{#each this.sizes as |n|}}<option
                  value={{n}}
                  selected={{if (this.isSize n) true}}
                >{{n}}</option>{{/each}}
            </select>
          </label>
          <button
            type="button"
            disabled={{this.running}}
            {{on "click" this.run}}
          >{{if this.running "Running…" "Run"}}</button>
          <button
            type="button"
            disabled={{this.running}}
            {{on "click" this.copy}}
          >Copy results</button>
          <span class="cb-stat">{{this.status}}</span>
        </div>
        <p class="cb-hint">{{this.env}}</p>

        {{#if this.rows.length}}
          <table class="bench">
            <thead><tr><th>What</th><th>median</th><th>95th pct</th><th
                >runs</th><th></th></tr></thead>
            <tbody>
              {{#each this.rows as |r|}}
                <tr class={{if (this.slow r) "bench__slow"}}>
                  <td>{{r.name}}</td>
                  <td>{{this.ms r.median}}</td>
                  <td>{{this.ms r.p95}}</td>
                  <td>{{r.runs}}</td>
                  <td class="bench__note">{{r.note}}</td>
                </tr>
              {{/each}}
            </tbody>
          </table>
        {{/if}}
      </main>
    </div>
  </template>

  isSize = (n: number): boolean => n === this.size;
  ms = (v: number): string => `${v < 10 ? v.toFixed(2) : v.toFixed(1)} ms`;
  slow = (r: BenchRow): boolean => r.group === 'draw' && r.median > 16;
}
