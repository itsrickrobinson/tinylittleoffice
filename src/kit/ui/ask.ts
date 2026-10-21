/**
 * <to-ask>: Ask Claude (this copy's own addition), a dialog of its own. On the home page it writes a new document from
 * a description, in the app chosen or the one Claude thinks fits, and opens it; on a document it changes that
 * document as asked, as one edit that Undo takes back (kit/core/element.ts becomeText, by the shell on
 * `to-ask-change`). The work is kit/share/claude.ts's.
 *
 * The first time, it asks for the person's own Claude API key and says plainly where it goes: it is kept in this
 * browser, and what is asked (with the document, for a change) goes to Anthropic and nowhere else. The key, the model
 * and Forget key are behind Settings after that.
 */
import { LitElement, html, nothing } from 'lit';
import type { AppDef } from '../core/app.ts';
import { apps, appOf } from '../core/apps.ts';
import { encodeDoc } from '../core/codec.ts';
import { t } from '../core/i18n.ts';
import { go, routeHash } from '../core/route.ts';
import { origin } from '../core/network.ts';
import { toast } from '../core/say.ts';
import { icon, UI } from '../draw/icons.ts';
import { ask, AskError, looksLikeKey, MODELS, saveSettings, settings } from '../share/claude.ts';
import type { ToDialog } from './dialog.ts';
import './dialog.ts';

type Step = 'writing' | 'checking' | 'fixing';
/** What each step and each failure is called (their ids written out, so the strings check finds every one). */
const STEPS: Record<Step, () => string> = { writing: () => t('ask-step-writing'), checking: () => t('ask-step-checking'), fixing: () => t('ask-step-fixing') };
const FAILURES: Record<AskError['kind'], () => string> = {
  key: () => t('ask-error-key'),
  refused: () => t('ask-error-refused'),
  network: () => t('ask-error-network'),
  limit: () => t('ask-error-limit'),
  answer: () => t('ask-error-answer'),
  other: () => t('ask-error-other'),
};

export class ToAsk extends LitElement {
  static properties = { def: { attribute: false }, doc: { attribute: false }, setup: { state: true }, step: { state: true }, failed: { state: true } };
  /** The open document's app, or null on the home page (a new document). */
  declare def: AppDef | null;
  /** The open document's text. */
  declare doc: string;
  /** The key and model form shown in place of the ask. */
  declare setup: boolean;
  /** What Claude is doing, while it works. */
  declare step: Step | null;
  /** What went wrong, said. */
  declare failed: string;
  private prompt = '';
  private app = '';
  private running: AbortController | null = null;

  constructor() {
    super();
    this.def = null;
    this.doc = '';
    this.setup = false;
    this.step = null;
    this.failed = '';
  }
  createRenderRoot() {
    return this;
  }
  private get dialog() {
    return this.querySelector<ToDialog>('to-dialog');
  }
  async show() {
    this.setup = !settings().key;
    this.failed = '';
    await this.updateComplete;
    await this.dialog?.show();
    this.querySelector<HTMLElement>(this.setup ? '.to-ask-key' : '.to-ask-prompt')?.focus();
  }

  private saveKey = (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const key = (form.querySelector<HTMLInputElement>('.to-ask-key')?.value ?? '').trim();
    const model = form.querySelector<HTMLSelectElement>('.to-ask-model')?.value ?? MODELS[0].id;
    if (key && !looksLikeKey(key)) return void (this.failed = t('ask-that-does-not-look-like-key'));
    saveSettings({ key: key || settings().key, model });
    this.failed = '';
    this.setup = !settings().key;
    void this.updateComplete.then(() => this.querySelector<HTMLElement>('.to-ask-prompt')?.focus());
  };
  private forget = () => {
    saveSettings({ key: '' });
    this.setup = true;
    toast(t('ask-key-forgotten'));
  };

  private go = async (e: Event) => {
    e.preventDefault();
    const prompt = this.prompt.trim();
    if (!prompt || this.step) return;
    this.failed = '';
    this.running = new AbortController();
    const def = this.def;
    try {
      const got = await ask({ prompt, app: def ? def.id : this.app, current: def ? { app: def.id, text: this.doc } : undefined }, (s) => (this.step = s), this.running.signal);
      const into = appOf(got.app);
      if (!into) throw new AskError('answer');
      this.dialog?.close();
      this.prompt = '';
      if (got.left.length) toast(t('ask-done-with-n-to-check', { n: got.left.length }));
      if (def) {
        this.dispatchEvent(new CustomEvent('to-ask-change', { detail: got.text, bubbles: true }));
        if (!got.left.length) toast(t('ask-changed-undo-takes-it-back'));
      } else {
        const text = got.title ? into.retitle(got.text, got.title) : got.text;
        go(routeHash(into.id, encodeDoc(text)));
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const kind = err instanceof AskError ? err.kind : 'other';
      const detail = err instanceof AskError ? err.detail : String((err as Error).message ?? err);
      if (kind === 'key' || kind === 'refused') this.setup = true;
      this.failed = `${FAILURES[kind]()}${detail ? ` (${detail})` : ''}`;
    } finally {
      this.step = null;
      this.running = null;
    }
  };
  private stop = () => this.running?.abort();

  private renderSetup() {
    const s = settings();
    return html`<form class="to-ask-form" @submit=${this.saveKey}>
      <p>${t('ask-claude-writes-with-your-key')}</p>
      <label class="to-ask-label"
        ><span>${t('ask-your-claude-api-key')}</span>
        <input class="to-ask-key" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder=${s.key ? '••••••••' : 'sk-ant-…'} />
      </label>
      <p class="to-hint">${t('ask-get-a-key-at')} <a href=${`${origin('claudeConsole')}/settings/keys`} target="_blank" rel="noopener">${new URL(origin('claudeConsole')).host}</a>. ${t('ask-key-stays-in-this-browser')}</p>
      <label class="to-field to-ask-label"
        ><span>${t('ask-model')}</span>
        <select class="to-ask-model">
          ${MODELS.map((m) => html`<option value=${m.id} ?selected=${m.id === s.model}>${m.name}</option>`)}
        </select>
      </label>
      ${this.failed ? html`<p class="to-ask-failed" role="alert">${this.failed}</p>` : nothing}
      <div class="to-row to-ask-acts">
        <button type="submit" class="to-btn primary">${icon(UI.check, 16)}<span>${t('ask-save')}</span></button>
        ${s.key ? html`<button type="button" class="to-btn" @click=${() => ((this.setup = false), (this.failed = ''))}><span>${t('ask-back')}</span></button><button type="button" class="to-btn to-ask-forget" @click=${this.forget}>${icon(UI.trash, 16)}<span>${t('ask-forget-key')}</span></button>` : nothing}
      </div>
    </form>`;
  }

  private renderAsk() {
    const def = this.def;
    const working = !!this.step;
    return html`<form class="to-ask-form" @submit=${this.go}>
      <label class="to-ask-label"
        ><span>${def ? t('ask-what-should-change', { noun: def.noun }) : t('ask-what-should-claude-make')}</span>
        <textarea
          class="to-ask-prompt"
          rows="5"
          ?disabled=${working}
          placeholder=${def ? t('ask-change-example') : t('ask-make-example')}
          .value=${this.prompt}
          @input=${(e: Event) => (this.prompt = (e.target as HTMLTextAreaElement).value)}
          @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && void this.go(e)}
        ></textarea>
      </label>
      ${
        def
          ? nothing
          : html`<label class="to-field to-ask-label"
              ><span>${t('ask-make-it-in')}</span>
              <select class="to-ask-app" ?disabled=${working} @change=${(e: Event) => (this.app = (e.target as HTMLSelectElement).value)}>
                <option value="" ?selected=${!this.app}>${t('ask-let-claude-choose')}</option>
                ${apps().map((a) => html`<option value=${a.id} ?selected=${a.id === this.app}>${a.name}</option>`)}
              </select>
            </label>`
      }
      ${working ? html`<p class="to-ask-step" role="status" aria-live="polite"><span class="to-ask-spin" aria-hidden="true"></span>${STEPS[this.step!]()}</p>` : nothing}
      ${this.failed ? html`<p class="to-ask-failed" role="alert">${this.failed}</p>` : nothing}
      <p class="to-hint">${def ? t('ask-sends-this-document-to-anthropic') : t('ask-sends-your-words-to-anthropic')}</p>
      <div class="to-row to-ask-acts">
        ${working ? html`<button type="button" class="to-btn" @click=${this.stop}><span>${t('ask-stop')}</span></button>` : html`<button type="submit" class="to-btn primary to-ask-go">${icon(UI.ask, 16)}<span>${t('ask-write-it')}</span></button>`}
        <button type="button" class="to-btn to-ask-settings" ?disabled=${working} @click=${() => (this.setup = true)}><span>${t('ask-settings')}</span></button>
      </div>
    </form>`;
  }

  render() {
    return html`<to-dialog class="to-ask-dialog" heading=${t('ask-claude')} .body=${this.setup ? this.renderSetup() : this.renderAsk()} @to-close=${this.stop}></to-dialog>`;
  }
}
customElements.define('to-ask', ToAsk);
