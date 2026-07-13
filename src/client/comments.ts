import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type * as Y from 'yjs';
import {
  addComment,
  COMMENTS_KEY,
  deleteComment,
  editComment,
  listThreads,
  replyToComment,
  setResolved,
  type CommentThread,
  type CommentView,
} from '../shared/comments';
import { AUTHORS_KEY, TEXT_KEY, type AuthorInfo } from '../shared/blame';

/**
 * Google-Docs-style comments UI: commented ranges highlight in the editor,
 * threads live in a right-hand panel (reply, edit/delete own, resolve), and a
 * header button turns the current selection into a new thread. All state is
 * the shared `comments` map in the Y.Doc — remote changes re-render live.
 */

// ── editor highlights ────────────────────────────────────────────────────

interface HighlightRange {
  id: string;
  from: number;
  to: number;
  focused: boolean;
}

const setCommentRanges = StateEffect.define<HighlightRange[]>();

const commentField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setCommentRanges)) {
        next = Decoration.set(
          effect.value
            .filter((range) => range.to > range.from)
            .map((range) =>
              Decoration.mark({
                class: range.focused ? 'sharemd-comment sharemd-comment-focused' : 'sharemd-comment',
                attributes: { 'data-comment-id': range.id },
              }).range(range.from, range.to),
            ),
          true,
        );
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function commentHighlightExtension() {
  return [commentField];
}

// ── panel ────────────────────────────────────────────────────────────────

const panel = document.querySelector('#comments-panel')! as HTMLElement;
const listEl = document.querySelector('#comments-list')!;
const showResolvedEl = document.querySelector('#comments-show-resolved')! as HTMLInputElement;
const addButton = document.querySelector('#comment-add')! as HTMLButtonElement;

interface Wiring {
  view: EditorView;
  doc: Y.Doc;
  user: { name: string; color: string };
  focusedId: string | null;
  composerRange: { from: number; to: number } | null;
}

let wiring: Wiring | null = null;
let notifyState: ((state: { comment: string | null; resolved: boolean }) => void) | null = null;

function notify(): void {
  if (wiring) {
    notifyState?.({ comment: wiring.focusedId, resolved: showResolvedEl.checked });
  }
}

/** Apply externally-driven state (URL/boot) — applies without notifying back. */
export function focusThread(id: string | null): void {
  if (!wiring || wiring.focusedId === id) {
    return;
  }
  wiring.focusedId = id;
  render();
}

export function setShowResolved(on: boolean): void {
  if (showResolvedEl.checked === on) {
    return;
  }
  showResolvedEl.checked = on;
  render();
}

function knownNames(doc: Y.Doc): string[] {
  const names = new Set<string>();
  for (const info of doc.getMap<AuthorInfo>(AUTHORS_KEY).values()) {
    if (info.name && info.name !== 'disk') {
      names.add(info.name);
    }
  }
  return [...names].sort();
}

function authorColor(doc: Y.Doc, name: string): string {
  for (const info of doc.getMap<AuthorInfo>(AUTHORS_KEY).values()) {
    if (info.name === name && info.color) {
      return info.color;
    }
  }
  return '#7a7a7a';
}

/** Body text with @mentions wrapped in styled spans (DOM-built, no innerHTML). */
function renderBody(body: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of body.matchAll(/@[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?/g)) {
    fragment.append(body.slice(last, match.index));
    const mention = document.createElement('span');
    mention.className = 'comment-mention';
    mention.textContent = match[0];
    fragment.append(mention);
    last = match.index! + match[0].length;
  }
  fragment.append(body.slice(last));
  return fragment;
}

// ── @mention autocomplete ────────────────────────────────────────────────

function attachMentions(textarea: HTMLTextAreaElement, names: () => string[]): void {
  const dropdown = document.createElement('div');
  dropdown.className = 'mention-dropdown';
  dropdown.hidden = true;
  textarea.insertAdjacentElement('afterend', dropdown);
  let selected = 0;

  const currentToken = (): { at: number; prefix: string } | null => {
    const upToCaret = textarea.value.slice(0, textarea.selectionStart ?? 0);
    const match = upToCaret.match(/@([A-Za-z0-9_.\/-]*)$/);
    return match ? { at: upToCaret.length - match[0].length, prefix: match[1]! } : null;
  };

  const candidates = (): string[] => {
    const token = currentToken();
    if (!token) {
      return [];
    }
    return names().filter((name) => name.toLowerCase().startsWith(token.prefix.toLowerCase()));
  };

  const renderDropdown = () => {
    const options = candidates();
    dropdown.hidden = options.length === 0;
    dropdown.innerHTML = '';
    selected = Math.min(selected, Math.max(0, options.length - 1));
    options.forEach((name, index) => {
      const item = document.createElement('div');
      item.className = index === selected ? 'mention-option selected' : 'mention-option';
      item.textContent = `@${name}`;
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        pick(name);
      });
      dropdown.appendChild(item);
    });
  };

  const pick = (name: string) => {
    const token = currentToken();
    if (!token) {
      return;
    }
    const caret = textarea.selectionStart ?? 0;
    textarea.value = `${textarea.value.slice(0, token.at)}@${name} ${textarea.value.slice(caret)}`;
    const after = token.at + name.length + 2;
    textarea.setSelectionRange(after, after);
    dropdown.hidden = true;
    textarea.focus();
  };

  textarea.addEventListener('input', () => {
    selected = 0;
    renderDropdown();
  });
  textarea.addEventListener('keydown', (event) => {
    if (dropdown.hidden) {
      return;
    }
    const options = candidates();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      selected = (selected + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
      renderDropdown();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      pick(options[selected]!);
    } else if (event.key === 'Escape') {
      dropdown.hidden = true;
    }
  });
  textarea.addEventListener('blur', () => {
    setTimeout(() => {
      dropdown.hidden = true;
    }, 150);
  });
}

// ── rendering ────────────────────────────────────────────────────────────

function textareaCard(options: {
  placeholder: string;
  initial?: string;
  draftKey: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}): HTMLElement {
  const container = document.createElement('div');
  container.className = 'comment-compose';
  const textarea = document.createElement('textarea');
  textarea.placeholder = options.placeholder;
  textarea.value = options.initial ?? '';
  textarea.dataset.draft = options.draftKey;
  container.appendChild(textarea);
  if (wiring) {
    const doc = wiring.doc;
    attachMentions(textarea, () => knownNames(doc));
  }
  const row = document.createElement('div');
  row.className = 'comment-actions';
  const save = document.createElement('button');
  save.textContent = 'Save';
  save.className = 'comment-btn primary';
  save.addEventListener('click', () => {
    const text = textarea.value.trim();
    if (text) {
      textarea.value = ''; // empty before re-render so draft capture doesn't resurrect it
      options.onSave(text);
    }
  });
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.className = 'comment-btn';
  cancel.addEventListener('click', options.onCancel);
  row.append(save, cancel);
  container.appendChild(row);
  return container;
}

function commentBlock(comment: CommentView, isReply: boolean): HTMLElement {
  const w = wiring!;
  const block = document.createElement('div');
  block.className = isReply ? 'comment-entry reply' : 'comment-entry';

  const head = document.createElement('div');
  head.className = 'comment-head';
  const chip = document.createElement('span');
  chip.className = 'peer';
  chip.style.background = authorColor(w.doc, comment.author);
  chip.textContent = comment.author;
  const time = document.createElement('span');
  time.className = 'comment-time';
  time.textContent =
    new Date(comment.createdAt).toLocaleString() + (comment.editedAt ? ' (edited)' : '');
  head.append(chip, time);

  if (comment.author === w.user.name) {
    const edit = document.createElement('button');
    edit.className = 'comment-btn subtle';
    edit.textContent = 'edit';
    edit.addEventListener('click', (event) => {
      event.stopPropagation();
      const editor = textareaCard({
        placeholder: 'Edit comment…',
        initial: comment.body,
        draftKey: `edit:${comment.id}`,
        onSave: (text) => {
          editComment(w.doc, comment.id, text);
        },
        onCancel: () => render(),
      });
      body.replaceWith(editor);
      (editor.querySelector('textarea') as HTMLTextAreaElement).focus();
    });
    const del = document.createElement('button');
    del.className = 'comment-btn subtle';
    del.textContent = 'delete';
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteComment(w.doc, comment.id);
    });
    head.append(edit, del);
  }

  const body = document.createElement('div');
  body.className = 'comment-body';
  body.appendChild(renderBody(comment.body));

  block.append(head, body);
  return block;
}

function threadCard(thread: CommentThread): HTMLElement {
  const w = wiring!;
  const card = document.createElement('div');
  card.className = 'comment-card';
  if (thread.root.id === w.focusedId) {
    card.classList.add('focused');
  }
  if (thread.resolved) {
    card.classList.add('resolved');
  }
  card.dataset.commentId = thread.root.id;

  const quote = document.createElement('div');
  quote.className = 'comment-quote';
  quote.textContent = thread.range
    ? shorten(thread.quotedText)
    : `${shorten(thread.quotedText)} (original text deleted)`;
  card.appendChild(quote);

  card.appendChild(commentBlock(thread.root, false));
  for (const reply of thread.replies) {
    card.appendChild(commentBlock(reply, true));
  }

  const actions = document.createElement('div');
  actions.className = 'comment-actions';
  const resolve = document.createElement('button');
  resolve.className = 'comment-btn';
  resolve.textContent = thread.resolved ? 'Reopen' : 'Resolve';
  resolve.addEventListener('click', (event) => {
    event.stopPropagation();
    setResolved(w.doc, thread.root.id, !thread.resolved);
  });
  actions.appendChild(resolve);
  card.appendChild(actions);

  const reply = textareaCard({
    placeholder: 'Reply… (@ to mention)',
    draftKey: `reply:${thread.root.id}`,
    onSave: (text) => {
      replyToComment(w.doc, { author: w.user.name, body: text, parentId: thread.root.id });
    },
    onCancel: () => render(),
  });
  reply.classList.add('comment-reply');
  card.appendChild(reply);

  card.addEventListener('click', () => {
    w.focusedId = thread.root.id;
    if (thread.range) {
      w.view.dispatch({
        selection: { anchor: thread.range.from, head: thread.range.to },
        effects: EditorView.scrollIntoView(thread.range.from, { y: 'center' }),
      });
    }
    render();
    notify();
  });

  return card;
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

/** Preserve in-progress textarea drafts (and focus) across re-renders. */
function captureDrafts(): { values: Map<string, string>; focused: string | null } {
  const values = new Map<string, string>();
  let focused: string | null = null;
  for (const textarea of listEl.querySelectorAll('textarea[data-draft]')) {
    const area = textarea as HTMLTextAreaElement;
    if (area.value) {
      values.set(area.dataset.draft!, area.value);
    }
    if (document.activeElement === area) {
      focused = area.dataset.draft!;
    }
  }
  return { values, focused };
}

function restoreDrafts(drafts: { values: Map<string, string>; focused: string | null }): void {
  for (const textarea of listEl.querySelectorAll('textarea[data-draft]')) {
    const area = textarea as HTMLTextAreaElement;
    const value = drafts.values.get(area.dataset.draft!);
    if (value !== undefined && !area.value) {
      area.value = value;
    }
    if (drafts.focused === area.dataset.draft) {
      area.focus();
    }
  }
}

function render(): void {
  if (!wiring) {
    return;
  }
  const w = wiring;
  const drafts = captureDrafts();
  const threads = listThreads(w.doc);
  const visible = showResolvedEl.checked ? threads : threads.filter((thread) => !thread.resolved);

  listEl.innerHTML = '';

  if (w.composerRange) {
    const range = w.composerRange;
    const composer = textareaCard({
      placeholder: 'Comment… (@ to mention)',
      draftKey: 'new-comment',
      onSave: (text) => {
        w.composerRange = null;
        const id = addComment(w.doc, { author: w.user.name, body: text, from: range.from, to: range.to });
        w.focusedId = id;
        render();
        notify();
      },
      onCancel: () => {
        w.composerRange = null;
        render();
      },
    });
    composer.classList.add('comment-card');
    listEl.appendChild(composer);
  }

  for (const thread of visible) {
    listEl.appendChild(threadCard(thread));
  }
  restoreDrafts(drafts);

  // Hide only when there are no threads at all — if everything is resolved the
  // panel must stay up so the "show resolved" toggle remains reachable.
  panel.hidden = threads.length === 0 && !w.composerRange;
  if (visible.length === 0 && threads.length > 0) {
    const note = document.createElement('div');
    note.className = 'comments-empty';
    note.textContent = `${threads.length} resolved ${threads.length === 1 ? 'thread' : 'threads'} hidden`;
    listEl.appendChild(note);
  }

  // Editor highlights for open (unresolved) threads that still have a range.
  const ranges: HighlightRange[] = threads
    .filter((thread) => !thread.resolved && thread.range)
    .map((thread) => ({
      id: thread.root.id,
      from: thread.range!.from,
      to: thread.range!.to,
      focused: thread.root.id === w.focusedId,
    }));
  w.view.dispatch({ effects: setCommentRanges.of(ranges) });

  const focusedCard = listEl.querySelector('.comment-card.focused');
  focusedCard?.scrollIntoView({ block: 'nearest' });
}

// ── wiring ───────────────────────────────────────────────────────────────

export function wireComments(
  view: EditorView,
  doc: Y.Doc,
  user: { name: string; color: string },
  onStateChange?: (state: { comment: string | null; resolved: boolean }) => void,
): () => void {
  const comments = doc.getMap(COMMENTS_KEY);
  wiring = { view, doc, user, focusedId: null, composerRange: null };
  notifyState = onStateChange ?? null;

  const observer = () => render();
  comments.observeDeep(observer);

  // Text edits move/orphan anchors and reorder threads, so the panel must
  // follow them too — debounced, and outside the CM update cycle.
  const ytext = doc.getText(TEXT_KEY);
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRender = () => {
    if (renderTimer) {
      clearTimeout(renderTimer);
    }
    renderTimer = setTimeout(() => {
      renderTimer = null;
      render();
    }, 150);
  };
  ytext.observe(scheduleRender);

  const onAdd = () => {
    if (!wiring) {
      return;
    }
    const selection = view.state.selection.main;
    if (selection.empty) {
      addButton.classList.add('nudge');
      setTimeout(() => addButton.classList.remove('nudge'), 800);
      return;
    }
    wiring.composerRange = { from: selection.from, to: selection.to };
    render();
    (listEl.querySelector('textarea[data-draft="new-comment"]') as HTMLTextAreaElement | null)?.focus();
  };
  addButton.addEventListener('click', onAdd);

  // Click a highlight in the editor → focus its thread in the panel.
  const onEditorClick = (event: Event) => {
    const marked = (event.target as HTMLElement).closest('[data-comment-id]');
    if (marked && wiring) {
      wiring.focusedId = (marked as HTMLElement).dataset.commentId!;
      render();
      notify();
    }
  };
  view.dom.addEventListener('click', onEditorClick);
  const onFilterChange = () => {
    render();
    notify();
  };
  showResolvedEl.addEventListener('change', onFilterChange);

  render();

  return () => {
    comments.unobserveDeep(observer);
    ytext.unobserve(scheduleRender);
    if (renderTimer) {
      clearTimeout(renderTimer);
    }
    addButton.removeEventListener('click', onAdd);
    view.dom.removeEventListener('click', onEditorClick);
    showResolvedEl.removeEventListener('change', onFilterChange);
    listEl.innerHTML = '';
    panel.hidden = true;
    wiring = null;
    notifyState = null;
  };
}
