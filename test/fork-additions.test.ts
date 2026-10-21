// This copy's own additions: Ask Claude's reading of an answer (kit/share/claude.ts) and a live session's link
// (kit/share/live.ts). The flows themselves run in a browser (docs/fork.md says how they were tried).
import { test, expect } from 'vitest';
import { parseAnswer } from '../src/kit/share/claude.ts';
import { newRoom, roomOf, withLive } from '../src/kit/share/live.ts';
import { lint } from '../src/lint.ts';

test('an answer in three parts is read as its app, its name and its text', () => {
  const got = parseAnswer('<app>sheet</app>\n<title>Budget</title>\n<tlo>\nItem | Cost:money\n--- | ---\nRent | 1200\n</tlo>', 'write');
  expect(got).toEqual({ app: 'sheet', title: 'Budget', text: 'Item | Cost:money\n--- | ---\nRent | 1200\n' });
});

test('an answer that names no app it knows, or forgot the tags, still gives the document', () => {
  expect(parseAnswer('<app>slides</app><tlo>## Hi</tlo>', 'deck')?.app).toBe('deck');
  expect(parseAnswer('Here you go:\n```tlo\n# Notes\n\nHello\n```', 'write')).toEqual({ app: 'write', title: '', text: '# Notes\n\nHello\n' });
  expect(parseAnswer('I cannot help with that.', 'write')).toBeNull();
  expect(parseAnswer('<tlo>\n   \n</tlo>', 'write')).toBeNull();
});

test('what the lint finds is what Ask Claude sends back to be fixed: bullets under a chart', () => {
  const deck = '## Budget\n\n- a bullet\n\n```sheet\n---\nchart: bar\n---\nItem | Cost:money\n--- | ---\nTools | 1200\n```\n';
  expect(lint('deck', deck).map((f) => f.kind)).toContain('fence-bullets');
});

test('a live link carries its room in the query, after the "#", and keeps the rest', () => {
  const room = newRoom();
  expect(room.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(room.secret).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(room.secret).not.toBe(room.id);
  const hash = withLive('#/v1/write/yABC?lang=es', room);
  expect(hash).toBe(`#/v1/write/yABC?lang=es&live=${room.id}.${room.secret}`);
  expect(roomOf(hash)).toEqual(room);
  expect(withLive(hash, null)).toBe('#/v1/write/yABC?lang=es');
  expect(withLive('#/v1/write/yABC', null)).toBe('#/v1/write/yABC');
  // A second room replaces the first.
  const other = newRoom();
  expect(roomOf(withLive(hash, other))).toEqual(other);
});

test('an address with no room, or a mangled one, joins nothing', () => {
  expect(roomOf('#/v1/write/yABC')).toBeNull();
  expect(roomOf('#/v1/write/yABC?d')).toBeNull();
  expect(roomOf('#/v1/write/yABC?live=short.x')).toBeNull();
  expect(roomOf('#/v1/write/yABC?live=abcdefghijk')).toBeNull();
  expect(roomOf('#/v1/write/yABC?live=abc$defghijk.abcdefghijk')).toBeNull();
});
