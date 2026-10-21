/**
 * Live sessions (this copy's own addition): the few things the page needs before a session is joined. A live link is
 * the document's own link with `live=<room>.<secret>` in its query, after the "#", so like the document it never
 * reaches a server; the room names the session and the secret encrypts the handshake by which its browsers find each
 * other (kit/share/live-session.ts, loaded only when a session starts). Opening a live link joins the session; the
 * address keeps the parameter while the person stays in it, so a reload joins again, and Leave takes it out.
 *
 * A link is still a copy: everyone in the session holds the document in their own link as it changes, and keeps it
 * when they leave. What a session adds is that, while it lasts, every change anyone makes reaches everyone else.
 */
export interface Room {
  id: string;
  secret: string;
}

const PART = /^[A-Za-z0-9_-]{8,64}$/;

/** A new session's room: a name and a secret, each 16 random bytes in base64url. */
export function newRoom(): Room {
  const part = () =>
    btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return { id: part(), secret: part() };
}

/** The room an address names in its query (`?live=<room>.<secret>`), or null. */
export function roomOf(hash: string): Room | null {
  const at = hash.indexOf('?');
  if (at < 0) return null;
  for (const p of hash.slice(at + 1).split(/[?&]/)) {
    if (!p.startsWith('live=')) continue;
    const [id, secret] = p.slice(5).split('.');
    return PART.test(id ?? '') && PART.test(secret ?? '') ? { id, secret } : null;
  }
  return null;
}

/** An address with its room put in, or taken out (null), the rest of its query as it was. */
export function withLive(hash: string, room: Room | null): string {
  const at = hash.indexOf('?');
  const base = at < 0 ? hash : hash.slice(0, at);
  const params = (at < 0 ? '' : hash.slice(at + 1)).split(/[?&]/).filter((p) => p && !p.startsWith('live='));
  if (room) params.push(`live=${room.id}.${room.secret}`);
  return params.length ? `${base}?${params.join('&')}` : base;
}
