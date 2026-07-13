/**
 * Navigation state in the URL hash, as query-style params:
 *   #doc=notes%2Fplan.md&preview=1&comment=c-xyz&resolved=1
 *
 * Document switches push a history entry (back/forward navigates documents);
 * view-state changes (preview, comment focus, filters) replace the current
 * entry so they survive reload and sharing without polluting history.
 * pushState/replaceState don't fire hashchange, so only user navigation
 * (back/forward, manual edits) triggers the listener — no self-echo guard needed.
 */

export interface UrlState {
  doc: string | null;
  preview: boolean;
  comment: string | null;
  resolved: boolean;
}

export function readUrlState(): UrlState {
  const params = new URLSearchParams(location.hash.slice(1));
  return {
    doc: params.get('doc'),
    preview: params.get('preview') === '1',
    comment: params.get('comment'),
    resolved: params.get('resolved') === '1',
  };
}

export function writeUrlState(partial: Partial<UrlState>, { push = false } = {}): void {
  const next = { ...readUrlState(), ...partial };
  const params = new URLSearchParams();
  if (next.doc) {
    params.set('doc', next.doc);
  }
  if (next.preview) {
    params.set('preview', '1');
  }
  if (next.comment) {
    params.set('comment', next.comment);
  }
  if (next.resolved) {
    params.set('resolved', '1');
  }
  const serialized = params.toString();
  const url = `${location.pathname}${location.search}${serialized ? `#${serialized}` : ''}`;
  if (push) {
    history.pushState(null, '', url);
  } else {
    history.replaceState(null, '', url);
  }
}

export function onUrlChange(handler: (state: UrlState) => void): void {
  window.addEventListener('hashchange', () => handler(readUrlState()));
}
