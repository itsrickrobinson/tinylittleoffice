/**
 * DocElement: what every app's editor extends (docs/kernel.md §3). The shell hands it the document's text
 * as `value`; it parses once, keeps the kernel's Doc, and draws a view of it (`read`, pure). Every edit is
 * a list of the kernel's operations through `edit()`: applied, re-read, written back as text in a
 * "docchange" event. Undo is an op log (§8, decision 2): each entry holds the ops and their inverses, a
 * burst of typing into one place within 700 ms is one entry, and the shell's "docundo"/"docredo" events
 * are answered here. An edit may carry a `mark` (the host's selection, whatever shape it has), handed back
 * with the entry to `undone()` so the selection comes back with the change; `firstAt()` says where the
 * change begins when there is no mark. `undoTools()` is the bar's last two buttons, the same in every app.
 * `focusFirst()` is where a person starts (docs/editing.md §1): the shell calls it once a document is first
 * drawn, and each app puts the focus in its own place with its own helper, never scrolling the page.
 */
import { LitElement, type PropertyDeclarations, type PropertyValues } from 'lit';
import { applyAll, invertAll, parse, write, type Doc, type Op } from '../../doc/index.ts';
import { cmdTool } from '../ui/bar.ts';
import { REDO, UNDO } from './keys.ts';

/** A change, as the shell and a host hear it: the text in `detail`, and the edit's burst key (none for an undo, a redo or an edit that stands alone), so a host that holds this editor inside it (the Animator holds the Drawing Tool) keeps the same bursts in its own log. */
export type DocChange = CustomEvent<string> & { key?: string };

export interface Entry {
  ops: Op[];
  inverse: Op[];
  /** What the edit was, for coalescing ("cell:2:3"); undefined edits stand alone. */
  key?: string;
  at: number;
  /** The host's own note of where the selection was when the edit began (a burst keeps its first). */
  mark?: unknown;
}

/** The lowest block index an entry's ops touch (a move's either end); -1 when they touch only the head. */
export function firstAt(entry: Pick<Entry, 'ops'>): number {
  let low = Infinity;
  for (const op of entry.ops) {
    if (op.op === 'head') continue;
    low = Math.min(low, op.at, op.op === 'move' ? op.to : Infinity);
  }
  return low === Infinity ? -1 : low;
}

const BURST = 700;

export abstract class DocElement<V> extends LitElement {
  static properties: PropertyDeclarations = { value: {} };
  declare value: string;
  /** The document as the kernel reads it (public: an app's commands read it, kit/core/commands.ts). */
  doc: Doc = { head: {}, blocks: [] };
  view!: V;
  /** The text as last read or written: a `value` that is this text is ours, not a new document. */
  private seen: string | null = null;
  private undo: Entry[] = [];
  private redo: Entry[] = [];

  constructor() {
    super();
    this.value = '';
  }
  createRenderRoot() {
    return this;
  }
  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('docundo', this.onUndo);
    this.addEventListener('docredo', this.onRedo);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('docundo', this.onUndo);
    this.removeEventListener('docredo', this.onRedo);
  }

  /** The pure function from the document to what the app draws. */
  protected abstract read(doc: Doc): V;
  /** The focus where a person starts in this document (the first words, A1, the canvas): the shell calls it after the first draw. */
  focusFirst(): void | Promise<void> {}
  /** After an undo or a redo: a chance to move the selection to what changed. */
  protected undone(_entry: Entry, _redo: boolean): void {}

  /**
   * Whether `text` is this editor's own, the text it last read or wrote: the shell's echo of a change, which a host
   * compares by identity and never parses again (a keystroke costs what it changed, not the whole document).
   */
  protected ours(text: string): boolean {
    return text === this.seen;
  }

  /**
   * Whether what the bar shows of the selection, as one key (the box, the block's kind, the marks at the caret), has
   * changed since a host last asked. A <to-text> says where its selection is after every draw; a host draws again for
   * that only when its bar would show something else, so a letter typed draws the words and not the bar twice.
   */
  protected selectionMoved(key: string): boolean {
    if (key === this.barSel) return false;
    this.barSel = key;
    return true;
  }
  private barSel = '';

  protected willUpdate(changed: PropertyValues) {
    super.willUpdate(changed);
    if (this.seen === null || (changed.has('value') && this.value !== this.seen)) {
      // A new document from the shell: read afresh, and the history starts over.
      this.doc = parse(this.value);
      this.view = this.read(this.doc);
      this.seen = this.value;
      this.undo = [];
      this.redo = [];
    }
  }

  /** The document with these operations applied; the shell is told. `key` names a burst of typing that undoes as one; `mark` is handed back to `undone()`. */
  edit(ops: Op[], key?: string, mark?: unknown) {
    if (!ops.length) return;
    const inverse = invertAll(this.doc, ops);
    this.doc = applyAll(this.doc, ops);
    const now = Date.now();
    const last = this.undo[this.undo.length - 1];
    if (key && last && last.key === key && now - last.at < BURST) {
      last.ops = [...last.ops, ...ops];
      last.inverse = [...inverse, ...last.inverse];
      last.at = now;
    } else this.undo.push({ ops, inverse, key, at: now, ...(mark === undefined ? {} : { mark }) });
    if (this.undo.length > 500) this.undo.shift();
    this.redo = [];
    this.emit(key);
  }
  /**
   * The document made `text` by the fewest operations: the head's keys that differ, and one splice of the blocks between
   * the first and the last that differ, so the blocks before and after are the same objects and keep their place on the
   * screen (and the caret in them). Undone in one step like any edit (Ask Claude's change, kit/ui/ask.ts). With
   * `remote`, an edit someone else made in a live session (kit/share/live.ts): applied without a place in this undo
   * history and without a docchange (the shell writes the link itself), and the history kept where the edit leaves it
   * meaning what it meant (`rebase`). True when anything changed.
   */
  becomeText(text: string, { remote = false, key }: { remote?: boolean; key?: string } = {}): boolean {
    const next = parse(text);
    const ops: Op[] = [];
    for (const k of new Set([...Object.keys(this.doc.head), ...Object.keys(next.head)]))
      if (this.doc.head[k] !== next.head[k]) ops.push({ op: 'head', key: k, ...(next.head[k] === undefined ? {} : { value: next.head[k] }) });
    const a = this.doc.blocks;
    const b = next.blocks;
    const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
    let lo = 0;
    while (lo < a.length && lo < b.length && same(a[lo], b[lo])) lo++;
    let hi = 0;
    while (hi < a.length - lo && hi < b.length - lo && same(a[a.length - 1 - hi], b[b.length - 1 - hi])) hi++;
    const n = a.length - lo - hi;
    const blocks = b.slice(lo, b.length - hi);
    if (n || blocks.length) ops.push({ op: 'splice', at: lo, n, blocks });
    if (!ops.length) return false;
    if (!remote) {
      this.edit(ops, key);
      return true;
    }
    this.rebase(lo, n, blocks.length);
    // Every words box here keeps its caret by the blocks it is in, not their numbers (kit/text/text.ts keepPlace), for
    // the draw this change brings and no later one: a box this change did not reach lets its place go once drawn.
    const boxes = [...this.querySelectorAll<HTMLElement & { keepPlace?: () => void; dropPlace?: () => void; updateComplete?: Promise<unknown> }>('to-text')];
    for (const box of boxes) box.keepPlace?.();
    void this.updateComplete.then(() => Promise.all(boxes.map((b) => b.updateComplete))).then(() => boxes.forEach((b) => b.dropPlace?.()));
    const before = this.doc;
    this.doc = applyAll(this.doc, ops);
    this.view = this.read(this.doc);
    // An app that moved its own place (the Outliner's row) puts the caret back itself: the words boxes let theirs go.
    if ((n || blocks.length) && this.shifted(lo, n, blocks.length, before)) boxes.forEach((b) => b.dropPlace?.());
    this.seen = write(this.doc);
    this.value = this.seen;
    this.requestUpdate();
    return true;
  }
  /**
   * Someone else replaced blocks [at, at + n) with m blocks (a live session), the document now as it is and `before` as
   * it was: an app that keeps a place by its number (the Outliner's chosen row, the Presentation Builder's slide) moves
   * it with the blocks, so the person stays where they were. True when it put the caret back itself.
   */
  protected shifted(_at: number, _n: number, _m: number, _before: Doc): boolean {
    return false;
  }
  /**
   * The undo history after someone else replaced blocks [at, at + n) with m blocks: an entry wholly after them is moved
   * by m − n, one wholly before is left as it is, and one that touches them can no longer be undone safely, so the
   * history is let go (an undo must never undo someone else's words).
   */
  private rebase(at: number, n: number, m: number) {
    const spots = (ops: Op[]) =>
      ops.flatMap((op) => (op.op === 'head' ? [] : op.op === 'move' ? [op.at, op.at + op.n, op.to] : op.op === 'splice' ? [op.at, op.at + Math.max(op.n, op.blocks.length)] : [op.at]));
    const shift = (ops: Op[], d: number): Op[] => ops.map((op) => (op.op === 'head' ? op : op.op === 'move' ? { ...op, at: op.at + d, to: op.to + d } : { ...op, at: op.at + d }));
    const all = [...this.undo, ...this.redo];
    const touched = (e: Entry) => [...spots(e.ops), ...spots(e.inverse)];
    if (all.every((e) => touched(e).every((i) => i < at))) return;
    if (all.every((e) => touched(e).every((i) => i >= at + n)) && n !== m) {
      for (const e of all) ((e.ops = shift(e.ops, m - n)), (e.inverse = shift(e.inverse, m - n)));
      return;
    }
    if (all.every((e) => touched(e).every((i) => i >= at + n))) return;
    this.undo = [];
    this.redo = [];
  }
  /** The view read again and the text written out; the shell hears of the change. */
  private emit(key?: string) {
    this.view = this.read(this.doc);
    const text = write(this.doc);
    this.seen = text;
    this.value = text;
    this.requestUpdate();
    const change = new CustomEvent<string>('docchange', { detail: text, bubbles: true }) as DocChange;
    change.key = key;
    this.dispatchEvent(change);
  }
  private onUndo = (e: Event) => {
    const entry = this.undo.pop();
    if (!entry) return;
    e.preventDefault();
    this.doc = applyAll(this.doc, entry.inverse);
    this.redo.push(entry);
    this.emit();
    this.undone(entry, false);
  };
  private onRedo = (e: Event) => {
    const entry = this.redo.pop();
    if (!entry) return;
    e.preventDefault();
    this.doc = applyAll(this.doc, entry.ops);
    this.undo.push(entry);
    this.emit();
    this.undone(entry, true);
  };
  get canUndo(): boolean {
    return this.undo.length > 0;
  }
  get canRedo(): boolean {
    return this.redo.length > 0;
  }
  /** Undo and Redo, the last two tools of every app's bar (the page's commands, kit/core/keys.ts): they never take the focus, are off with nothing to do, and under a finger are pinned at the bar's end, always on screen (bar.ts, responsive.css). */
  protected undoTools(): unknown[] {
    const here = { editor: this };
    return [cmdTool(UNDO, here, { disabled: !this.canUndo }), cmdTool(REDO, here, { disabled: !this.canRedo })];
  }
}
