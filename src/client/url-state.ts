/**
 * Navigation state. The path names a *surface*: `/` is Home, `/settings` is
 * Settings, `/<project>/agents` is the Agents page, `/<project>` is a project
 * page, and `/<project>/<doc>.md` is a document — so links are stable, shareable
 * paths. Within a document, view state (edit/both/read mode, focused comment,
 * resolved filter) stays in the hash as query-style params (#mode=both&comment=…).
 *
 * Surface switches push a history entry (back/forward navigates surfaces);
 * doc-view-state changes replace the current entry so they survive reload and
 * sharing without polluting history. pushState/replaceState don't fire popstate,
 * so only real user navigation (back/forward, hash edits) triggers the listener.
 */

import { getDefaultMode } from './prefs';

/** Editor layout: editor only, editor + preview split, or preview only. */
export type ViewMode = 'edit' | 'both' | 'read';

/** The surface a URL resolves to. Documents always end in an editable extension,
 *  which is what makes the trailing `agents` segment and `/settings` unambiguous. */
export type View =
  | { kind: 'home' }
  | { kind: 'settings' }
  | { kind: 'agents'; project: string }
  | { kind: 'project'; project: string }
  | { kind: 'doc'; project: string; doc: string };

/** Hash-borne state that only applies inside a document view. */
export interface DocViewState {
  mode: ViewMode;
  comment: string | null;
  resolved: boolean;
}

const DOC_EXTENSION = /\.(md|markdown|txt)$/i;

/** Decode a pathname into its slash-separated segments (empty for `/`). */
function pathSegments(pathname: string): string[] {
  const raw = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  return raw ? raw.split('/').map(decodeURIComponent) : [];
}

function encodePath(path: string): string {
  return `/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function readView(): View {
  const segments = pathSegments(location.pathname);
  if (segments.length === 0) {
    return { kind: 'home' };
  }
  if (segments.length === 1 && segments[0] === 'settings') {
    return { kind: 'settings' };
  }
  const path = segments.join('/');
  if (DOC_EXTENSION.test(path)) {
    return { kind: 'doc', project: segments[0]!, doc: path };
  }
  if (segments.length === 2 && segments[1] === 'agents') {
    return { kind: 'agents', project: segments[0]! };
  }
  // Any other extension-less path is a project page (its first segment).
  return { kind: 'project', project: segments[0]! };
}

/** The URL path for a view — use for links and navigation. */
export function viewPath(view: View): string {
  switch (view.kind) {
    case 'home':
      return '/';
    case 'settings':
      return '/settings';
    case 'agents':
      return encodePath(`${view.project}/agents`);
    case 'project':
      return encodePath(view.project);
    case 'doc':
      return encodePath(view.doc);
  }
}

function readMode(raw: string | null): ViewMode {
  // An explicit mode wins; otherwise the URL is showing the user's default,
  // which is why serialize omits the mode when it equals the default.
  if (raw === 'both' || raw === 'read' || raw === 'edit') {
    return raw;
  }
  return getDefaultMode();
}

export function readDocViewState(): DocViewState {
  const params = new URLSearchParams(location.hash.slice(1));
  return {
    mode: readMode(params.get('mode')),
    comment: params.get('comment'),
    resolved: params.get('resolved') === '1',
  };
}

function serializeDocViewState(state: DocViewState): string {
  const params = new URLSearchParams();
  // Omit the mode when it equals the user's default — the URL stays clean and
  // still restores to what they expect (readMode fills the default back in).
  if (state.mode !== getDefaultMode()) {
    params.set('mode', state.mode);
  }
  if (state.comment) {
    params.set('comment', state.comment);
  }
  if (state.resolved) {
    params.set('resolved', '1');
  }
  return params.toString();
}

/**
 * Navigate to a surface. Only `doc` views carry hash state: by default a doc
 * navigation preserves the sticky mode/resolved but clears comment focus; pass
 * `doc` to override. Non-doc surfaces drop the hash entirely.
 */
export function writeView(
  view: View,
  { push = false, doc }: { push?: boolean; doc?: Partial<DocViewState> } = {},
): void {
  let hash = '';
  if (view.kind === 'doc') {
    const next: DocViewState = { ...readDocViewState(), comment: null, ...doc };
    hash = serializeDocViewState(next);
  }
  const url = `${viewPath(view)}${location.search}${hash ? `#${hash}` : ''}`;
  if (push) {
    history.pushState(null, '', url);
  } else {
    history.replaceState(null, '', url);
  }
}

/** Replace only the hash doc-view-state (mode/comment/resolved); path unchanged. */
export function writeDocViewState(partial: Partial<DocViewState>): void {
  const next = { ...readDocViewState(), ...partial };
  const hash = serializeDocViewState(next);
  const url = `${location.pathname}${location.search}${hash ? `#${hash}` : ''}`;
  history.replaceState(null, '', url);
}

export function onUrlChange(handler: () => void): void {
  window.addEventListener('popstate', () => handler());
}
