/**
 * A live session (this copy's own addition; kit/share/live.ts says what one is): the browsers in a room keep one
 * document between them while they are in it. Loaded only when a session starts, so the app file carries none of it.
 *
 * How the browsers meet: Trystero's Nostr strategy posts an encrypted offer to a few public Nostr relays
 * (kit/core/network.ts `liveRelay…`; a build may name its own, VITE_LIVE_RELAYS), the room's secret as the key, so a
 * relay passes the handshake and cannot read it. After that each pair talks over a WebRTC data channel, browser to
 * browser: the edits never touch a relay or any server of ours.
 *
 * How the document stays one: its TLO text is a Yjs text (a CRDT), so two people typing at once both land, merged
 * where they typed, and every browser ends with the same text. A browser's own change is the difference between the
 * text it had and the text its editor gives (`local`); another's arrives as a Yjs update and is handed to the editor
 * as text (`onRemote`), which applies it as the fewest block operations (kit/core/element.ts becomeText).
 *
 * Where the shared text starts (its genesis): the browser that starts a session starts it from its own document. One
 * that joins starts empty and is sent the whole state by a browser already in it. If nobody in the room has it (all
 * left, then someone opens the live link again), the joiners wait a moment, then the one whose id sorts first starts
 * it from the document in its own link and the rest are sent that. Two groups that started apart and then meet keep
 * the older genesis; the other group's browsers take it and put their own text on top as one change, so nothing typed
 * is lost twice over.
 */
import * as Y from 'yjs';
import { joinRoom, selfId } from 'trystero/nostr';
import { reaches } from '../core/network.ts';
import type { Room } from './live.ts';

/** How long a browser that joined waits for someone in the room to send the document before it may start it itself. */
const WAIT = 4000;

/** The relays: the build's own (VITE_LIVE_RELAYS, comma-separated ws(s):// addresses), or the list in kit/core/network.ts. */
function relays(): string[] {
  const own = ((import.meta.env?.VITE_LIVE_RELAYS as string | undefined) ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter((r) => /^wss?:\/\//.test(r));
  return own.length
    ? own
    : reaches()
        .filter((r) => r.scheme === 'wss')
        .map((r) => `wss://${r.host}`);
}

/** Where the shared text started: an id, and when (the older wins when two meet). */
interface Genesis {
  id: string;
  t: number;
}
const older = (a: Genesis, b: Genesis) => a.t < b.t || (a.t === b.t && a.id < b.id);

export type LiveState = 'connecting' | 'live';

export interface LiveHooks {
  /** The document as the session now has it, after someone else's change. */
  onRemote(text: string): void;
  /** How many other browsers are in the session, and whether this one has the shared document yet. */
  onPeers(others: number, state: LiveState): void;
}

export class LiveSession {
  private doc = new Y.Doc();
  private genesis: Genesis | null = null;
  private room: ReturnType<typeof joinRoom>;
  private peers = new Map<string, { has: string | null }>();
  private timer = 0;
  private latest: string;
  private sendHello;
  private sendState;
  private sendUpdate;
  private gone = false;

  /** Joins `room`; `text` is this browser's document, the session's start when `starting` (or when nobody else has one). */
  constructor(
    room: Room,
    text: string,
    starting: boolean,
    private hooks: LiveHooks,
  ) {
    this.latest = text;
    this.room = joinRoom({ appId: 'tinylittleoffice-live-1', password: room.secret, relayConfig: { urls: relays() } }, room.id);
    const hello = this.room.makeAction<{ has: string | null }>('hello');
    const state = this.room.makeAction<Uint8Array>('state');
    const update = this.room.makeAction<Uint8Array>('update');
    this.sendHello = hello.send;
    this.sendState = state.send;
    this.sendUpdate = update.send;

    hello.onMessage = (msg, { peerId }) => {
      this.peers.set(peerId, { has: msg.has });
      this.told();
      // Someone without the document, or with another start: sent ours (they keep the older, `onState`).
      if (this.genesis && msg.has !== this.genesis.id) void this.sendState(Y.encodeStateAsUpdate(this.doc), { target: peerId, metadata: { ...this.genesis } });
      // Someone has it and this browser does not (it started while this one waited): asked for it.
      else if (!this.genesis && msg.has) void this.sendHello({ has: null }, { target: peerId });
    };
    state.onMessage = (bytes, { metadata }) => this.onState(new Uint8Array(bytes), metadata as unknown as Genesis);
    update.onMessage = (bytes, { metadata }) => {
      if (!this.genesis || (metadata as { id?: string } | undefined)?.id !== this.genesis.id) return;
      Y.applyUpdate(this.doc, new Uint8Array(bytes), 'remote');
    };
    this.room.onPeerJoin = (peerId) => {
      this.peers.set(peerId, { has: null });
      void this.sendHello({ has: this.genesis?.id ?? null }, { target: peerId });
      this.told();
    };
    this.room.onPeerLeave = (peerId) => {
      this.peers.delete(peerId);
      this.told();
      this.maybeStart();
    };
    this.watch();
    if (starting) this.start(text);
    else this.timer = window.setTimeout(() => this.maybeStart(), WAIT);
    this.told();
  }

  private get text() {
    return this.doc.getText('tlo');
  }
  /** Every change made here goes to everyone; someone else's reaches the editor. */
  private watch() {
    this.doc.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin !== 'remote' && this.genesis && !this.gone) void this.sendUpdate(u, { metadata: { id: this.genesis.id } });
    });
    this.text.observe((e) => {
      if (e.transaction.origin === 'remote' || e.transaction.origin === 'adopt') {
        this.latest = this.text.toString();
        this.hooks.onRemote(this.latest);
      }
    });
  }
  private told() {
    if (!this.gone) this.hooks.onPeers(this.peers.size, this.genesis ? 'live' : 'connecting');
  }
  /** This browser's document, as the session's start. */
  private start(text: string) {
    clearTimeout(this.timer);
    this.genesis = { id: crypto.randomUUID(), t: Date.now() };
    this.doc.transact(() => this.text.insert(0, text), 'local');
    this.announce();
  }
  private announce() {
    void this.sendHello({ has: this.genesis?.id ?? null });
    this.told();
  }
  /** Nobody has sent the document: the browser whose id sorts first among those waiting starts it. */
  private maybeStart() {
    if (this.genesis || this.gone) return;
    if ([...this.peers.values()].some((p) => p.has)) return;
    const waiting = [selfId, ...this.peers.keys()].sort();
    if (waiting[0] === selfId) this.start(this.latest);
    else this.timer = window.setTimeout(() => this.maybeStart(), WAIT);
  }
  /** The whole document from someone in the room: taken when this browser has none, or when theirs started first. */
  private onState(bytes: Uint8Array, from: Genesis) {
    if (!from?.id) return;
    if (this.genesis && (this.genesis.id === from.id || !older(from, this.genesis))) return;
    clearTimeout(this.timer);
    const mine = this.genesis ? this.text.toString() : null;
    if (this.genesis) {
      // Two groups met: this one's document is put on top of the older one's as one change, after taking it.
      this.doc.destroy();
      this.doc = new Y.Doc();
      this.watch();
    }
    this.genesis = from;
    Y.applyUpdate(this.doc, bytes, 'adopt');
    if (mine !== null && mine !== this.text.toString()) {
      this.local(mine);
      this.hooks.onRemote(this.text.toString());
    }
    this.announce();
  }
  /** This browser's document after an edit here: the difference goes to everyone. */
  local(next: string) {
    this.latest = next;
    if (!this.genesis || this.gone) return;
    const now = this.text.toString();
    if (now === next) return;
    let a = 0;
    while (a < now.length && a < next.length && now[a] === next[a]) a++;
    let b = 0;
    while (b < now.length - a && b < next.length - a && now[now.length - 1 - b] === next[next.length - 1 - b]) b++;
    this.doc.transact(() => {
      if (now.length - a - b > 0) this.text.delete(a, now.length - a - b);
      if (next.length - a - b > 0) this.text.insert(a, next.slice(a, next.length - b));
    }, 'local');
  }
  leave() {
    this.gone = true;
    clearTimeout(this.timer);
    void this.room.leave();
    this.doc.destroy();
  }
}
