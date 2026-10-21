/**
 * Ask Claude (this copy's own addition): a document written from a description, or the open document changed as
 * asked, by Claude through Anthropic's Messages API, straight from the browser with the person's own key. Nothing
 * goes anywhere until they press Write it; then what goes is what they asked, the open document's text when they
 * ask for a change, and the key (kit/core/network.ts `claude`).
 *
 * Claude is taught the format the way any agent is: the site's own /llms-full.txt (the whole description of TLO, the
 * apps and their shapes), fetched from the site once and cached by the API (prompt caching), so a second ask costs
 * a tenth. What comes back is checked by the site's own lint (src/lint.ts, the same checks `npx tinylittleoffice lint`
 * makes); when it finds something (a connection to nothing, bullets under a chart, a formula that errs), Claude is
 * asked once more with the findings, and the second answer is the one used.
 *
 * The key and the model are kept as one device preference (kit/core/store.ts DEVICE), never in a link, a document
 * or the library.
 */
import { origin } from '../core/network.ts';
import { store } from '../core/store.ts';
import { siteRoot } from '../core/apps.ts';

const KEY = 'tinyoffice.claude';

/** The models offered, the first the default: quick and good at this, then the strongest for a long or hard ask. */
export const MODELS = [
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
] as const;

interface Settings {
  key: string;
  model: string;
}

/** The key and the model this device keeps; an empty key when none was given. */
export function settings(): Settings {
  try {
    const s = JSON.parse(store.get(KEY) ?? '{}') as Partial<Settings>;
    return { key: typeof s.key === 'string' ? s.key : '', model: MODELS.some((m) => m.id === s.model) ? s.model! : MODELS[0].id };
  } catch {
    return { key: '', model: MODELS[0].id };
  }
}
export function saveSettings(s: Partial<Settings>) {
  const next = { ...settings(), ...s };
  if (!next.key) store.remove(KEY);
  else store.set(KEY, JSON.stringify(next));
}
/** Whether a key looks like an Anthropic API key, before one is spent on it. */
export const looksLikeKey = (key: string) => /^sk-ant-[\w-]{20,}$/.test(key.trim());

/** What Claude wrote: the app, its name, the document's text, and what the lint still found after a second try. */
export interface Written {
  app: string;
  title: string;
  text: string;
  left: string[];
}

/** The apps Claude may choose among when none is chosen. */
const APPS = ['write', 'outline', 'deck', 'sheet', 'calc', 'draw', 'diagram', 'anim', 'cal', 'trip'];

let guide: Promise<string> | null = null;
/** The site's own description of TLO for agents, fetched once a visit. */
function teaching(): Promise<string> {
  guide ??= fetch(`${siteRoot()}llms-full.txt`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`llms-full.txt: ${r.status}`))));
  guide.catch(() => (guide = null));
  return guide;
}

const RULES = `You write documents for Tiny Little Office, whose format (TLO) is described below. Reply with exactly three parts and nothing else:
<app>one of ${APPS.join(', ')}</app>
<title>the document's name, a few words</title>
<tlo>
the whole document's TLO text, exactly as it should be, with no head keys for title or by (the title goes above)
</tlo>
Write real, specific, useful content, not placeholders, unless the person asks for a template. Keep every rule the description gives, above all the three rules agents break first. Prefer putting a chart, diagram or calendar inside a page or slide as a fenced document over describing it. Keep the TLO under about 6000 characters so the link stays shareable. Today is ${new Date().toISOString().slice(0, 10)}.`;

/** The failure a person is told about: its kind (which the dialog words, kit/ui/ask.ts) and what the API said, if anything. */
export class AskError extends Error {
  constructor(
    readonly kind: 'key' | 'refused' | 'network' | 'limit' | 'answer' | 'other',
    readonly detail = '',
  ) {
    super(`${kind}${detail ? `: ${detail}` : ''}`);
  }
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

async function call(messages: Message[], signal?: AbortSignal): Promise<string> {
  const { key, model } = settings();
  if (!key) throw new AskError('key');
  const system = [
    { type: 'text', text: RULES },
    { type: 'text', text: await teaching(), cache_control: { type: 'ephemeral' } },
  ];
  let res: Response;
  try {
    res = await fetch(`${origin('claude')}/v1/messages`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // The API answers a page's own request only when it says so: the key is the person's, in their own browser.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: 16000, system, messages }),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AskError('network');
  }
  if (!res.ok) {
    const said = await res.json().catch(() => null);
    const why = (said as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
    if (res.status === 401 || res.status === 403) throw new AskError('refused', why);
    if (res.status === 429 || res.status === 529) throw new AskError('limit', why);
    throw new AskError('other', why);
  }
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (body.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('');
}

/** The three parts of an answer; null when it holds no document. */
export function parseAnswer(answer: string, fallbackApp: string): { app: string; title: string; text: string } | null {
  const part = (tag: string) => new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`).exec(answer)?.[1] ?? null;
  let text = part('tlo');
  if (text === null) {
    // An answer that forgot the tags but fenced the document: the fence's body.
    const fence = /```(?:tlo|markdown|md)?\n([\s\S]*?)\n```/.exec(answer);
    text = fence ? fence[1] : null;
  }
  if (!text?.trim()) return null;
  const said = (part('app') ?? '').trim();
  return { app: APPS.includes(said) ? said : fallbackApp, title: (part('title') ?? '').trim().slice(0, 120), text: text.replace(/\s+$/, '') + '\n' };
}

/** The lint's findings for a document, as lines; nothing when the lint cannot be loaded. */
async function findings(app: string, text: string): Promise<string[]> {
  try {
    const { lint, findingLine } = await import('../../lint.ts');
    return lint(app, text)
      .filter((f) => f.kind !== 'length')
      .map(findingLine);
  } catch {
    return [];
  }
}

/**
 * A new document from a description, or (with `current`) the open document changed as asked. `app` is the app to
 * write in, or '' for Claude to choose. `progress` hears each step, for the dialog to say.
 */
export async function ask(
  { prompt, app, current }: { prompt: string; app: string; current?: { app: string; text: string } },
  progress: (step: 'writing' | 'checking' | 'fixing') => void = () => {},
  signal?: AbortSignal,
): Promise<Written> {
  const request = current
    ? `Here is the open ${current.app} document:\n<tlo>\n${current.text}\n</tlo>\n\nChange it as asked, keeping everything else as it is, and reply with the whole changed document in the same app (${current.app}). What to change:\n${prompt}`
    : `${app ? `Write this as a ${app} document.` : 'Choose the app that fits best.'} What I want:\n${prompt}`;
  const messages: Message[] = [{ role: 'user', content: request }];
  progress('writing');
  const first = await call(messages, signal);
  const fallback = current?.app ?? (app || 'write');
  const got = parseAnswer(first, fallback);
  if (!got) throw new AskError('answer');
  if (current) got.app = current.app;
  progress('checking');
  const found = await findings(got.app, got.text);
  if (!found.length) return { ...got, left: [] };
  // One more try, with what the lint found: the second answer is used whatever it holds.
  progress('fixing');
  messages.push({ role: 'assistant', content: first }, { role: 'user', content: `The site's lint found these problems. Fix them and reply again with all three parts:\n${found.join('\n')}` });
  const second = parseAnswer(await call(messages, signal), got.app);
  if (!second) return { ...got, left: found };
  if (current) second.app = current.app;
  return { ...second, title: second.title || got.title, left: await findings(second.app, second.text) };
}
