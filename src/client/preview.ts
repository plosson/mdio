import MarkdownIt from 'markdown-it';
import mermaid from 'mermaid';
import type * as Y from 'yjs';

/**
 * Live markdown preview pane: renders the shared text with markdown-it
 * (debounced, so typing and remote edits don't thrash it) and turns
 * ```mermaid fences into rendered diagrams. Raw HTML in documents stays
 * escaped — the preview shows markdown, it doesn't execute it.
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

const pane = document.querySelector('#preview')! as HTMLElement;
const toggleButton = document.querySelector('#preview-toggle')! as HTMLButtonElement;

let enabled = false; // sticky across document switches
let renderSeq = 0;
let currentApply: (() => void) | null = null;
let notifyChange: ((enabled: boolean) => void) | null = null;

/** Apply externally-driven state (URL/boot) — applies without notifying back. */
export function setPreviewEnabled(on: boolean): void {
  if (enabled === on) {
    return;
  }
  enabled = on;
  currentApply?.();
}

async function renderInto(host: HTMLElement, text: string): Promise<void> {
  const seq = ++renderSeq;
  host.innerHTML = md.render(text);
  const diagrams = [...host.querySelectorAll<HTMLElement>('pre.mermaid')];
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

export function wirePreview(ytext: Y.Text, onChange?: (enabled: boolean) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  notifyChange = onChange ?? null;

  const render = () => {
    if (!enabled) {
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
    pane.hidden = !enabled;
    toggleButton.classList.toggle('active', enabled);
    if (enabled) {
      render();
    } else {
      pane.innerHTML = '';
    }
  };

  const onToggle = () => {
    enabled = !enabled;
    applyState();
    notifyChange?.(enabled);
  };

  ytext.observe(scheduleRender);
  toggleButton.addEventListener('click', onToggle);
  currentApply = applyState;
  applyState(); // respect the sticky toggle when switching documents

  return () => {
    ytext.unobserve(scheduleRender);
    toggleButton.removeEventListener('click', onToggle);
    if (timer) {
      clearTimeout(timer);
    }
    currentApply = null;
    notifyChange = null;
    pane.innerHTML = '';
    pane.hidden = true;
  };
}
