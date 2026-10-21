# This fork: Ask Claude and live sessions

This is a fork of [aboard-io/tinylittleoffice](https://github.com/aboard-io/tinylittleoffice) (MIT License, by
Paul Ford and Aboard). Everything Tiny Little Office does, it still does: the document lives in its link, there is no
account, and nothing is kept on a server. This fork adds two things on top, built into the same code rather than
beside it.

| | What it does | Where the code is |
| --- | --- | --- |
| **Ask Claude** | Describe a document and Claude writes it, in any of the ten apps. Or, on an open document, ask for a change ("add a risks slide", "turn this into a table with totals") and Claude makes it as one edit that Undo takes back. | `src/kit/share/claude.ts`, `src/kit/ui/ask.ts` |
| **Live sessions** | Share a live link and everyone who opens it edits the same document at the same time, browser to browser. When the session ends, each person still has the document in their own link. | `src/kit/share/live.ts`, `src/kit/share/live-session.ts` |

The published site is **https://itsrickrobinson.github.io/tinylittleoffice/**, rebuilt on every push to `main`
(`.github/workflows/team-pages.yml`).

## For the team: how to use it

### Ask Claude

1. Each person needs their own Claude API key, from [console.anthropic.com](https://console.anthropic.com/settings/keys).
2. On the home page press **Describe a document, and Claude writes it**, or on any open document press the
   sparkle button next to Share. The first time, paste your key. It is kept in your browser only; it never goes into a
   link or a document.
3. Say what you want. Pick an app, or let Claude choose. Press **Write it**.

Claude is taught the document format from the site's own `/llms-full.txt`. What comes back is checked by the site's
own linter (the same checks as `npx tinylittleoffice lint`); if it finds a problem, such as bullets hidden under a chart
or a formula that errors, Claude is asked once more to fix it before the document opens.

Model: Claude Sonnet 5.5 by default (fast, inexpensive), or Claude Opus 5.5 under Settings for harder asks. The long
format guide is prompt-cached, so asks after the first in a few minutes cost much less.

What leaves your browser: what you typed, and the open document's text when you ask for a change. It goes to
Anthropic's API and nowhere else.

### Live sessions

1. Open the document, press **Share**, then **Start a live session**. The live link is copied for you.
2. Send that link to the people you want to work with. Everyone who opens it joins.
3. A pill at the bottom of the page says who else is there, with **Copy live link** and **Leave**.

How it behaves:

- Two people typing at once both land, merged where each typed, even in the same paragraph. Your cursor stays put
  when someone else adds or removes text above you.
- Undo only undoes your own edits.
- Everyone's own link keeps updating as the document changes, so when you leave, your link holds the latest version.
- If everyone leaves and someone opens the live link again later, the session restarts from that person's copy.
- A live session is only live while people are in it. Nothing waits on a server for someone to come back.

## Rules of thumb for AARP work

- **A link is the whole document.** It ends up in browser history, in chat logs, and in link previews in Slack and
  Teams. Do not put member data, personal information, or anything confidential in a document unless you use
  Share, **Password** (the link then holds only ciphertext; send the password separately).
- **Live sessions travel browser to browser, encrypted.** The relays that introduce browsers only see an encrypted
  handshake. Even so, treat a live link like the document itself: anyone who has it can join.
- **Ask Claude sends your words, and the open document for a change, to Anthropic** under your own API key and your
  organization's terms for it. Check that fits the material before using it on sensitive documents.
- **A document with a password cannot be shared live.** Take the password off first, or keep the conversation in
  the regular link-as-a-copy mode.

## Known limits

- **Corporate networks.** Live sessions use WebRTC. On most home and office networks two browsers connect directly
  (with Google's and Cloudflare's public STUN servers). On strict corporate networks that block peer-to-peer traffic
  they may never connect, and the pill will stay on "finding the others". The fix is a TURN relay server; Trystero
  takes one in `turnConfig` (`src/kit/share/live-session.ts`).
- **Public relays.** The four Nostr relays in `src/kit/core/network.ts` (`liveRelay1` to `liveRelay4`) are public and
  run by others. If they become unreliable, change the list there, or build with `VITE_LIVE_RELAYS` naming relays of
  your own. The page's security policy follows either automatically.
- **Short links.** The Share dialog's short links use Aboard's shortener, which only shortens links to their own
  site. On this fork they will be refused. Everything else in Share works. Running your own shortener is described in
  [self-host.md](self-host.md).
- **Languages.** The new strings are English in every language for now (they fall back to English automatically).
  `scripts/i18n-extract.ts` `ENGLISH_ONLY` lets the checks pass until someone translates them.
- **Apps that keep a place by number.** The Word Processor, Outliner and Presentation Builder keep your cursor or slide
  when someone else edits above you. In the other apps a teammate's edit can occasionally move your selection.

## Setting it up (once)

1. In the fork on GitHub: **Settings, Pages, Source: GitHub Actions**.
2. **Actions** tab: enable workflows for the fork if GitHub asks.
3. Push to `main` (or run **Team site** by hand in Actions). The site appears at
   `https://<owner>.github.io/tinylittleoffice/` in a few minutes.

The workflow works out the address from the repository's owner and name, so a fork of this fork publishes at its own
address with no edits.

## Working on it

```sh
npm ci                     # Node 24 or later
npm run dev                # http://localhost:4178
npm run lint               # types, Prettier, dead code and the lints the build runs
npx vitest run --project unit
```

To try live sessions on one machine without the public relays, run the little relay in `dev/` and point the dev
server at it, then open the live link in two different browsers (or one normal and one private window):

```sh
node dev/nostr-relay.mjs                                # ws://localhost:7777
VITE_LIVE_RELAYS=ws://localhost:7777 npm run dev
```

How the pieces fit:

- **Ask Claude** calls the Messages API straight from the browser (`anthropic-dangerous-direct-browser-access`),
  with the key from the device's storage (`src/kit/core/store.ts`, `tinyoffice.claude`). A change to the open
  document reaches the editor through `becomeText` in `src/kit/core/element.ts`, which turns any new text into the
  fewest block operations, so it is one undo step.
- **Live sessions** keep the document's text in a Yjs CRDT and connect browsers with Trystero over Nostr. A teammate's
  change also goes through `becomeText`, marked remote: it is left out of your undo history, the words boxes keep
  your caret by the block it is in (`keepPlace` in `src/kit/text/text.ts`), and an app that keeps a place by number
  moves it (`shifted`, in the Outliner and the Presentation Builder). The live code is its own file in the build,
  fetched only when a session starts.
- The network list, the security policy, the dependency ledger and the budgets all name the additions, so the
  project's own checks hold them to the same standard as the rest.

## Keeping up with Aboard's version

```sh
git remote add upstream https://github.com/aboard-io/tinylittleoffice.git
git fetch upstream
git merge upstream/main     # most of this fork's changes are in their own files, so merges stay small
```

## Ideas for next iterations

- AARP templates (status update, project brief, roadmap) and an AARP theme for decks.
- A shared team key behind a small proxy, so teammates do not each need an API key.
- Names and colored cursors in live sessions, so you can see who is where.
- A TURN server for live sessions on locked-down networks.
- Ask Claude streaming its answer into the page as it writes.
