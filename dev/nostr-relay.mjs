// A tiny Nostr relay for trying live sessions on one machine (docs/fork.md, "Working on it"): the NIP-01 messages
// Trystero uses (REQ, EVENT, CLOSE), events matched by kind and by #x tag, nothing kept. Never for real use.
//
//   node dev/nostr-relay.mjs [port]                       a relay at ws://localhost:7777
//   VITE_LIVE_RELAYS=ws://localhost:7777 npm run dev      the dev server's live sessions meet through it
//
// `ws` comes with the dev dependencies (vitest's browser runner and wrangler bring it).
import { WebSocketServer } from 'ws';

const port = Number(process.argv[2] ?? 7777);
const server = new WebSocketServer({ port });
/** Each socket's subscriptions: its id, and the filters it asked with. */
const subs = new Map();
const matches = (event, filter) => (!filter.kinds || filter.kinds.includes(event.kind)) && (!filter['#x'] || event.tags.some((tag) => tag[0] === 'x' && filter['#x'].includes(tag[1])));

server.on('connection', (socket) => {
  subs.set(socket, new Map());
  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg[0] === 'REQ') {
      subs.get(socket).set(msg[1], msg.slice(2));
      socket.send(JSON.stringify(['EOSE', msg[1]]));
    } else if (msg[0] === 'CLOSE') subs.get(socket).delete(msg[1]);
    else if (msg[0] === 'EVENT') {
      const event = msg[1];
      socket.send(JSON.stringify(['OK', event.id, true, '']));
      for (const [other, mine] of subs) for (const [id, filters] of mine) if (filters.some((f) => matches(event, f))) other.send(JSON.stringify(['EVENT', id, event]));
    }
  });
  socket.on('close', () => subs.delete(socket));
});
console.log(`A Nostr relay for live sessions at ws://localhost:${port}`);
