import MarkdownIt from 'markdown-it';
import mermaid from 'mermaid';
import type * as Y from 'yjs';
import type { ViewMode } from './url-state';

/**
 * View-mode layout + live markdown preview. The header's Edit|Both|Read
 * segmented control drives this: Edit shows the editor only, Both splits the
 * editor and the rendered preview (divider draggable, ratio persisted), Read
 * shows the full-width preview alone.
 * The preview renders the shared text with markdown-it (debounced, so typing
 * and remote edits don't thrash it) and turns ```mermaid fences into rendered
 * diagrams. Raw HTML stays escaped — the preview shows markdown, it doesn't
 * execute it.
 */

const RENDER_DEBOUNCE_MS = 300;

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

const md = new MarkdownIt({ html: false, linkify: true });

const defaultFence =
  md.renderer.rules.fence ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  if (token.info.trim() === 'mermaid') {
    return `<pre class="mermaid">${md.utils.escapeHtml(token.content)}</pre>`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

const workspace = document.querySelector('#workspace')! as HTMLElement;
const splitPane = document.querySelector('#split-pane')! as HTMLElement;
const editorHost = document.querySelector('#editor')! as HTMLElement;
const splitHandle = document.querySelector('#split-handle')! as HTMLElement;
const pane = document.querySelector('#preview')! as HTMLElement;
const modeButtons: Record<ViewMode, HTMLButtonElement> = {
  edit: document.querySelector('#mode-edit')! as HTMLButtonElement,
  both: document.querySelector('#mode-both')! as HTMLButtonElement,
  read: document.querySelector('#mode-read')! as HTMLButtonElement,
};

let mode: ViewMode = 'edit'; // sticky across document switches
let renderSeq = 0;
let currentApply: (() => void) | null = null;
let notifyChange: ((mode: ViewMode) => void) | null = null;

/** Whether the preview pane is showing (Both or Read). */
function previewShown(): boolean {
  return mode !== 'edit';
}

// Both-mode splitter: dragging the handle sets the editor's share of the
// split pane (editor+preview only — side panels are unaffected; clamped so
// neither pane collapses); the ratio persists across sessions and
// double-click resets to an even split.
const SPLIT_KEY = 'mdio-split';
const SPLIT_MIN = 20;
const SPLIT_MAX = 80;

{
  const stored = Number(localStorage.getItem(SPLIT_KEY));
  if (stored >= SPLIT_MIN && stored <= SPLIT_MAX) {
    splitPane.style.setProperty('--split', `${stored}%`);
  }
}

splitHandle.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  splitHandle.setPointerCapture(event.pointerId);
  splitHandle.classList.add('dragging');
  const onMove = (move: PointerEvent) => {
    const rect = splitPane.getBoundingClientRect();
    const pct = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ((move.clientX - rect.left) / rect.width) * 100));
    splitPane.style.setProperty('--split', `${pct}%`);
  };
  const onUp = (up: PointerEvent) => {
    splitHandle.releasePointerCapture(up.pointerId);
    splitHandle.classList.remove('dragging');
    splitHandle.removeEventListener('pointermove', onMove);
    splitHandle.removeEventListener('pointerup', onUp);
    splitHandle.removeEventListener('pointercancel', onUp);
    const pct = parseFloat(splitPane.style.getPropertyValue('--split'));
    if (Number.isFinite(pct)) {
      localStorage.setItem(SPLIT_KEY, pct.toFixed(1));
    }
  };
  splitHandle.addEventListener('pointermove', onMove);
  splitHandle.addEventListener('pointerup', onUp);
  splitHandle.addEventListener('pointercancel', onUp);
});

splitHandle.addEventListener('dblclick', () => {
  splitPane.style.removeProperty('--split');
  localStorage.removeItem(SPLIT_KEY);
});

/** Apply externally-driven mode (URL/boot) — applies without notifying back. */
export function setMode(next: ViewMode): void {
  if (mode === next) {
    return;
  }
  mode = next;
  currentApply?.();
}

async function renderInto(host: HTMLElement, text: string): Promise<void> {
  const seq = ++renderSeq;
  // Rendered blocks live in a column wrapper so the reading width caps and
  // centers them as one unit (see .preview-column in styles.css).
  const column = document.createElement('div');
  column.className = 'preview-column';
  column.innerHTML = md.render(text);
  host.replaceChildren(column);
  const diagrams = [...column.querySelectorAll<HTMLElement>('pre.mermaid')];
  if (diagrams.length === 0) {
    return;
  }
  // Validate each diagram up front: a broken one is marked in place and must
  // never take down the preview or its valid siblings.
  const valid: HTMLElement[] = [];
  for (const diagram of diagrams) {
    if (await mermaid.parse(diagram.textContent ?? '', { suppressErrors: true })) {
      valid.push(diagram);
    } else {
      diagram.classList.add('mermaid-error');
      diagram.setAttribute('title', 'Invalid mermaid diagram');
    }
  }
  if (seq !== renderSeq) {
    return; // a newer render already replaced this content
  }
  try {
    await mermaid.run({ nodes: valid, suppressErrors: true });
  } catch {
    // Defensive: rendering bugs in mermaid itself must not break the pane.
  }
}

export function wirePreview(ytext: Y.Text, onChange?: (mode: ViewMode) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  notifyChange = onChange ?? null;

  const render = () => {
    if (!previewShown()) {
      return;
    }
    void renderInto(pane, ytext.toString());
  };

  const scheduleRender = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      render();
    }, RENDER_DEBOUNCE_MS);
  };

  const applyState = () => {
    pane.hidden = !previewShown();
    editorHost.hidden = mode === 'read';
    splitHandle.hidden = mode !== 'both';
    workspace.classList.toggle('split', mode === 'both');
    for (const [name, button] of Object.entries(modeButtons)) {
      button.classList.toggle('active', name === mode);
    }
    if (previewShown()) {
      render();
    } else {
      pane.innerHTML = '';
    }
  };

  const select = (next: ViewMode) => {
    if (mode === next) {
      return;
    }
    mode = next;
    applyState();
    notifyChange?.(mode);
  };

  const listeners = (Object.keys(modeButtons) as ViewMode[]).map((name) => {
    const handler = () => select(name);
    modeButtons[name].addEventListener('click', handler);
    return [name, handler] as const;
  });

  ytext.observe(scheduleRender);
  currentApply = applyState;
  applyState(); // respect the sticky mode when switching documents

  return () => {
    ytext.unobserve(scheduleRender);
    for (const [name, handler] of listeners) {
      modeButtons[name].removeEventListener('click', handler);
    }
    if (timer) {
      clearTimeout(timer);
    }
    currentApply = null;
    notifyChange = null;
    pane.innerHTML = '';
    pane.hidden = true;
    editorHost.hidden = false;
    splitHandle.hidden = true;
    workspace.classList.remove('split');
  };
}
