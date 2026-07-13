import * as Y from 'yjs';
import { TEXT_KEY } from './blame';

/**
 * Google-Docs-style comments stored inside the document's own Y.Doc, so they
 * sync, merge, and persist through the same machinery as the text. The shared
 * key is `comments`: a Y.Map of commentId → Y.Map of fields (field-level
 * last-write-wins, so a concurrent resolve and body edit both survive).
 *
 * Anchors are encoded Yjs relative positions into the `content` text — start
 * attaches to the first commented character, end to the last — so the range
 * follows the text under concurrent edits. When the commented text is deleted
 * the range collapses and the comment reports itself as orphaned; `quotedText`
 * (a snapshot from creation time) remains for display.
 *
 * Replies are flat, one level deep (like Google Docs): a reply carries the
 * root's id in `parentId` and inherits its anchor. Resolution is a property of
 * the thread, i.e. the root comment.
 */

export const COMMENTS_KEY = 'comments';

export interface CommentView {
  id: string;
  author: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  mentions: string[];
}

export interface CommentThread {
  root: CommentView;
  replies: CommentView[];
  resolved: boolean;
  quotedText: string;
  /** Current anchor range, or null when the commented text was deleted. */
  range: { from: number; to: number } | null;
}

type CommentFields = Y.Map<unknown>;

function commentsMap(doc: Y.Doc): Y.Map<CommentFields> {
  return doc.getMap<CommentFields>(COMMENTS_KEY);
}

let idSeq = 0;

function newCommentId(): string {
  return `c-${Date.now().toString(36)}-${(++idSeq).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** `@name` and `@owner/agent` tokens, deduplicated, in order of appearance. */
export function parseMentions(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(/@([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)/g)) {
    seen.add(match[1]!);
  }
  return [...seen];
}

function encodeAnchor(position: Y.RelativePosition): string {
  const bytes = Y.encodeRelativePosition(position);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeAnchor(encoded: string): Y.RelativePosition {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return Y.decodeRelativePosition(bytes);
}

function requireComment(doc: Y.Doc, id: string): CommentFields {
  const fields = commentsMap(doc).get(id);
  if (!fields) {
    throw new Error(`Unknown comment: ${id}`);
  }
  return fields;
}

export function addComment(
  doc: Y.Doc,
  input: { author: string; body: string; from: number; to: number },
): string {
  const ytext = doc.getText(TEXT_KEY);
  const from = Math.max(0, Math.min(input.from, ytext.length));
  const to = Math.max(from, Math.min(input.to, ytext.length));
  if (to === from) {
    throw new Error('A comment needs a non-empty text selection to anchor to.');
  }
  const id = newCommentId();
  doc.transact(() => {
    const fields = new Y.Map<unknown>();
    fields.set('author', input.author);
    fields.set('body', input.body);
    fields.set('createdAt', Date.now());
    fields.set('resolved', false);
    fields.set('parentId', null);
    // start sticks to the first commented char, end to the last, so edits on
    // either side of the range stay outside it.
    fields.set('anchorStart', encodeAnchor(Y.createRelativePositionFromTypeIndex(ytext, from)));
    fields.set('anchorEnd', encodeAnchor(Y.createRelativePositionFromTypeIndex(ytext, to, -1)));
    fields.set('quotedText', ytext.toString().slice(from, to));
    fields.set('mentions', parseMentions(input.body));
    commentsMap(doc).set(id, fields);
  });
  return id;
}

export function replyToComment(
  doc: Y.Doc,
  input: { author: string; body: string; parentId: string },
): string {
  const parent = requireComment(doc, input.parentId);
  if (parent.get('parentId') !== null) {
    throw new Error(`Comment ${input.parentId} is a reply — reply to the thread root instead.`);
  }
  const id = newCommentId();
  doc.transact(() => {
    const fields = new Y.Map<unknown>();
    fields.set('author', input.author);
    fields.set('body', input.body);
    fields.set('createdAt', Date.now());
    fields.set('parentId', input.parentId);
    fields.set('mentions', parseMentions(input.body));
    commentsMap(doc).set(id, fields);
  });
  return id;
}

export function editComment(doc: Y.Doc, id: string, body: string): void {
  const fields = requireComment(doc, id);
  doc.transact(() => {
    fields.set('body', body);
    fields.set('editedAt', Date.now());
    fields.set('mentions', parseMentions(body));
  });
}

/** Resolve or reopen a thread; `id` must be the thread root. */
export function setResolved(doc: Y.Doc, id: string, resolved: boolean): void {
  const fields = requireComment(doc, id);
  if (fields.get('parentId') !== null) {
    throw new Error(`Comment ${id} is a reply — resolve the thread root instead.`);
  }
  doc.transact(() => {
    fields.set('resolved', resolved);
  });
}

/** Delete a comment; deleting a thread root deletes its replies too. */
export function deleteComment(doc: Y.Doc, id: string): void {
  const map = commentsMap(doc);
  requireComment(doc, id);
  doc.transact(() => {
    for (const [otherId, fields] of map.entries()) {
      if (fields.get('parentId') === id) {
        map.delete(otherId);
      }
    }
    map.delete(id);
  });
}

export function commentAuthor(doc: Y.Doc, id: string): string {
  return requireComment(doc, id).get('author') as string;
}

function viewOf(id: string, fields: CommentFields): CommentView {
  return {
    id,
    author: (fields.get('author') as string) ?? 'unknown',
    body: (fields.get('body') as string) ?? '',
    createdAt: (fields.get('createdAt') as number) ?? 0,
    editedAt: (fields.get('editedAt') as number) ?? null,
    mentions: (fields.get('mentions') as string[]) ?? [],
  };
}

/** All threads, sorted by current anchor position (orphaned threads last). */
export function listThreads(doc: Y.Doc): CommentThread[] {
  const map = commentsMap(doc);
  const threads: CommentThread[] = [];
  const repliesByParent = new Map<string, CommentView[]>();

  for (const [id, fields] of map.entries()) {
    const parentId = fields.get('parentId') as string | null;
    if (parentId !== null) {
      const list = repliesByParent.get(parentId) ?? [];
      list.push(viewOf(id, fields));
      repliesByParent.set(parentId, list);
    }
  }

  for (const [id, fields] of map.entries()) {
    if (fields.get('parentId') !== null) {
      continue;
    }
    const start = Y.createAbsolutePositionFromRelativePosition(
      decodeAnchor(fields.get('anchorStart') as string),
      doc,
    );
    const end = Y.createAbsolutePositionFromRelativePosition(
      decodeAnchor(fields.get('anchorEnd') as string),
      doc,
    );
    const range =
      start !== null && end !== null && end.index > start.index
        ? { from: start.index, to: end.index }
        : null;
    threads.push({
      root: viewOf(id, fields),
      replies: (repliesByParent.get(id) ?? []).sort((a, b) => a.createdAt - b.createdAt),
      resolved: (fields.get('resolved') as boolean) ?? false,
      quotedText: (fields.get('quotedText') as string) ?? '',
      range,
    });
  }

  return threads.sort((a, b) => {
    if (a.range && b.range) {
      return a.range.from - b.range.from || a.root.createdAt - b.root.createdAt;
    }
    if (a.range !== null || b.range !== null) {
      return a.range ? -1 : 1;
    }
    return a.root.createdAt - b.root.createdAt;
  });
}
