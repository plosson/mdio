import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  addComment,
  commentAuthor,
  deleteComment,
  editComment,
  listThreads,
  parseMentions,
  replyToComment,
  setResolved,
} from '../src/shared/comments';
import { TEXT_KEY } from '../src/shared/blame';

/** Two live-syncing peers, like two clients in one room. */
function pair(initialText: string): [Y.Doc, Y.Doc] {
  const a = new Y.Doc({ gc: false });
  const b = new Y.Doc({ gc: false });
  a.getText(TEXT_KEY).insert(0, initialText);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(b, update, 'relay');
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(a, update, 'relay');
  });
  return [a, b];
}

const TEXT = 'alpha bravo charlie delta echo\n';

describe('comment model', () => {
  test('add + listThreads roundtrip with mentions', () => {
    const [a, b] = pair(TEXT);
    const from = TEXT.indexOf('bravo');
    const id = addComment(a, {
      author: 'plosson',
      body: 'hey @plosson/claude and @dana, thoughts?',
      from,
      to: from + 'bravo'.length,
    });

    const threads = listThreads(b); // read on the OTHER peer
    expect(threads).toHaveLength(1);
    const thread = threads[0]!;
    expect(thread.root.id).toBe(id);
    expect(thread.root.author).toBe('plosson');
    expect(thread.root.mentions).toEqual(['plosson/claude', 'dana']);
    expect(thread.quotedText).toBe('bravo');
    expect(thread.resolved).toBe(false);
    expect(thread.range).toEqual({ from, to: from + 5 });
  });

  test('rejects an empty selection', () => {
    const [a] = pair(TEXT);
    expect(() => addComment(a, { author: 'x', body: 'hi', from: 3, to: 3 })).toThrow('non-empty');
  });

  test('anchors follow the text under concurrent edits around and inside the range', () => {
    const [a, b] = pair(TEXT);
    const from = TEXT.indexOf('charlie');
    addComment(a, { author: 'plosson', body: 'this word', from, to: from + 'charlie'.length });

    // Peer B inserts before the range: range shifts, same text.
    b.getText(TEXT_KEY).insert(0, 'PREFIX ');
    let range = listThreads(a)[0]!.range!;
    expect(a.getText(TEXT_KEY).toString().slice(range.from, range.to)).toBe('charlie');

    // Peer B inserts inside the range: range grows.
    b.getText(TEXT_KEY).insert(range.from + 4, 'XX');
    range = listThreads(a)[0]!.range!;
    expect(a.getText(TEXT_KEY).toString().slice(range.from, range.to)).toBe('charXXlie');

    // Insertions immediately before and immediately after stay outside.
    b.getText(TEXT_KEY).insert(range.from, '<<');
    b.getText(TEXT_KEY).insert(listThreads(b)[0]!.range!.to, '>>');
    range = listThreads(a)[0]!.range!;
    expect(a.getText(TEXT_KEY).toString().slice(range.from, range.to)).toBe('charXXlie');
  });

  test('deleting the commented text orphans the thread but keeps the quote', () => {
    const [a, b] = pair(TEXT);
    const from = TEXT.indexOf('delta');
    addComment(a, { author: 'plosson', body: 'gone soon', from, to: from + 'delta'.length });
    b.getText(TEXT_KEY).delete(from - 1, 'delta'.length + 1);

    const thread = listThreads(a)[0]!;
    expect(thread.range).toBeNull();
    expect(thread.quotedText).toBe('delta');
  });

  test('replies are flat, sorted, and inherit the thread', () => {
    const [a, b] = pair(TEXT);
    const rootId = addComment(a, { author: 'plosson', body: 'root', from: 0, to: 5 });
    const r1 = replyToComment(b, { author: 'plosson/claude', body: 'reply one', parentId: rootId });
    const r2 = replyToComment(a, { author: 'plosson', body: 'reply two', parentId: rootId });

    const thread = listThreads(b)[0]!;
    expect(thread.replies.map((reply) => reply.id)).toEqual([r1, r2]);
    expect(thread.replies[0]!.author).toBe('plosson/claude');

    expect(() => replyToComment(a, { author: 'x', body: 'nested', parentId: r1 })).toThrow(
      'thread root',
    );
  });

  test('edit updates body, editedAt, and mentions', () => {
    const [a, b] = pair(TEXT);
    const id = addComment(a, { author: 'plosson', body: 'v1', from: 0, to: 5 });
    editComment(b, id, 'v2 ping @grace');

    const root = listThreads(a)[0]!.root;
    expect(root.body).toBe('v2 ping @grace');
    expect(root.editedAt).toBeGreaterThan(0);
    expect(root.mentions).toEqual(['grace']);
  });

  test('resolve is thread-level and reopenable; replies cannot be resolved', () => {
    const [a, b] = pair(TEXT);
    const id = addComment(a, { author: 'plosson', body: 'root', from: 0, to: 5 });
    const replyId = replyToComment(a, { author: 'x', body: 'r', parentId: id });

    setResolved(b, id, true);
    expect(listThreads(a)[0]!.resolved).toBe(true);
    setResolved(a, id, false);
    expect(listThreads(b)[0]!.resolved).toBe(false);
    expect(() => setResolved(a, replyId, true)).toThrow('thread root');
  });

  test('deleting a root cascades to replies; deleting a reply keeps the thread', () => {
    const [a, b] = pair(TEXT);
    const id = addComment(a, { author: 'plosson', body: 'root', from: 0, to: 5 });
    const replyId = replyToComment(a, { author: 'x', body: 'r', parentId: id });

    deleteComment(b, replyId);
    expect(listThreads(a)[0]!.replies).toHaveLength(0);

    replyToComment(a, { author: 'x', body: 'r2', parentId: id });
    deleteComment(b, id);
    expect(listThreads(a)).toHaveLength(0);
    expect(listThreads(b)).toHaveLength(0);
  });

  test('concurrent resolve and body edit both survive the merge', () => {
    const a = new Y.Doc({ gc: false });
    a.getText(TEXT_KEY).insert(0, TEXT);
    const id = addComment(a, { author: 'plosson', body: 'v1', from: 0, to: 5 });
    const b = new Y.Doc({ gc: false });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // Offline divergence: A resolves while B edits the body.
    setResolved(a, id, true);
    editComment(b, id, 'v2');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    for (const doc of [a, b]) {
      const thread = listThreads(doc)[0]!;
      expect(thread.resolved).toBe(true);
      expect(thread.root.body).toBe('v2');
    }
  });

  test('threads sort by anchor position, orphans last', () => {
    const [a] = pair(TEXT);
    const late = addComment(a, { author: 'x', body: 'later in text', from: 20, to: 24 });
    const orphan = addComment(a, { author: 'x', body: 'orphaned', from: 6, to: 11 });
    const early = addComment(a, { author: 'x', body: 'early in text', from: 0, to: 5 });
    a.getText(TEXT_KEY).delete(6, 5); // kill the middle one's text

    expect(listThreads(a).map((thread) => thread.root.id)).toEqual([early, late, orphan]);
  });

  test('commentAuthor exposes ownership for permission checks', () => {
    const [a] = pair(TEXT);
    const id = addComment(a, { author: 'plosson/ada', body: 'mine', from: 0, to: 5 });
    expect(commentAuthor(a, id)).toBe('plosson/ada');
    expect(() => commentAuthor(a, 'c-nope')).toThrow('Unknown comment');
  });

  test('parseMentions handles plain and owner-scoped names', () => {
    expect(parseMentions('cc @plosson and @plosson/claude, also @plosson again')).toEqual([
      'plosson',
      'plosson/claude',
    ]);
    expect(parseMentions('no mentions here')).toEqual([]);
    expect(parseMentions('email a@b.com is not a mention... but @b.com matches')).toEqual(['b.com']);
  });
});
