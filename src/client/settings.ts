/**
 * Settings (`/settings`): identity, editor preferences, server/CLI info, and
 * project management. A left nav switches between sections. Identity edits are
 * live (the name re-joins awareness, the color override applies immediately);
 * editor prefs persist and are applied through prefs.ts; project rename/delete
 * reuse the shared danger-styled dialogs (also available from the ⋯ menu).
 */

import * as api from './api';
import {
  getDefaultMode,
  getFont,
  getReadingWidth,
  setDefaultMode,
  setFont,
  setReadingWidth,
  type EditorFont,
  type ReadingWidth,
} from './prefs';
import type { SurfaceContext } from './surface';
import type { ViewMode } from './url-state';
import { commandBlock, el } from './ui';

/** A group of exclusive buttons (segmented control); calls `onPick` with the chosen value. */
function segmented<T extends string>(
  values: Array<{ value: T; label: string }>,
  current: T,
  onPick: (value: T) => void,
): HTMLElement {
  const group = el('div', { class: 'seg' });
  for (const { value, label } of values) {
    const button = el('button', {
      class: value === current ? 'seg-btn active' : 'seg-btn',
      type: 'button',
      text: label,
      onClick: () => {
        for (const other of group.querySelectorAll('.seg-btn')) other.classList.remove('active');
        button.classList.add('active');
        onPick(value);
      },
    });
    group.append(button);
  }
  return group;
}

function field(label: string, ...controls: (Node | string)[]): HTMLElement {
  return el('div', { class: 'settings-field' }, el('label', { class: 'settings-label', text: label }), ...controls);
}

function identitySection(ctx: SurfaceContext): HTMLElement {
  const section = el('section', { class: 'settings-section' }, el('h2', { text: 'Identity' }));

  const nameInput = el('input', { class: 'settings-input', type: 'text' }) as HTMLInputElement;
  nameInput.value = ctx.me.name;
  nameInput.spellcheck = false;
  const agentPreview = el('code', { class: 'settings-agent-id', text: `${ctx.me.name}/claude` });
  const nameErr = el('p', { class: 'settings-error', hidden: true });
  nameInput.addEventListener('change', () => {
    const value = nameInput.value.trim();
    if (!value || value.includes('/') || /\s/.test(value)) {
      nameErr.hidden = false;
      nameErr.textContent = 'A display name is a single word with no "/".';
      return;
    }
    nameErr.hidden = true;
    ctx.setName(value);
    agentPreview.textContent = `${value}/claude`;
  });

  const colorInput = el('input', { class: 'settings-color', type: 'color' }) as HTMLInputElement;
  colorInput.value = ctx.me.color;
  colorInput.addEventListener('input', () => ctx.setColor(colorInput.value));
  const resetColor = el('button', {
    class: 'settings-link-btn',
    type: 'button',
    text: 'reset',
    onClick: () => ctx.setColor(null),
  });

  section.append(
    field('Display name', nameInput, nameErr),
    field('Cursor color', el('div', { class: 'settings-row' }, colorInput, resetColor)),
    field('Suggested agent identity', el('div', { class: 'settings-hint' }, 'Agents you invite join as ', agentPreview, '.')),
  );
  return section;
}

function editorSection(): HTMLElement {
  const section = el('section', { class: 'settings-section' }, el('h2', { text: 'Editor' }));
  section.append(
    field(
      'Default view mode',
      segmented<ViewMode>(
        [
          { value: 'edit', label: 'Edit' },
          { value: 'both', label: 'Both' },
          { value: 'read', label: 'Read' },
        ],
        getDefaultMode(),
        setDefaultMode,
      ),
    ),
    field(
      'Editor font',
      segmented<EditorFont>(
        [
          { value: 'prose', label: 'Prose' },
          { value: 'mono', label: 'Monospace' },
        ],
        getFont(),
        setFont,
      ),
    ),
    field(
      'Reading width',
      segmented<ReadingWidth>(
        [
          { value: '68', label: '68' },
          { value: '72', label: '72' },
          { value: '80', label: '80' },
        ],
        getReadingWidth(),
        setReadingWidth,
      ),
    ),
  );
  return section;
}

function serverSection(ctx: SurfaceContext): HTMLElement {
  const section = el('section', { class: 'settings-section' }, el('h2', { text: 'Server & CLI' }));
  const version = el('code', { class: 'settings-agent-id', text: '…' });
  void fetch('/api/cli/version')
    .then((response) => (response.ok ? response.text() : '?'))
    .then((text) => {
      version.textContent = text.trim() || '?';
    })
    .catch(() => {
      version.textContent = '?';
    });
  const agentsLinks = el('div', { class: 'settings-agents-links' });
  for (const project of ctx.projects) {
    agentsLinks.append(
      el('button', {
        class: 'settings-link-btn',
        type: 'button',
        text: `${project} →`,
        onClick: () => ctx.go({ kind: 'agents', project }),
      }),
    );
  }
  section.append(
    field('Server URL', el('code', { class: 'settings-agent-id', text: location.origin })),
    field('Server version', version),
    commandBlock('Install the CLI', `curl -fsSL ${location.origin}/install.sh | sh`),
    ctx.projects.length > 0 ? field('Agents pages', agentsLinks) : null,
  );
  return section;
}

function projectsSection(ctx: SurfaceContext, rerender: () => void): HTMLElement {
  const section = el('section', { class: 'settings-section' }, el('h2', { text: 'Projects' }));
  if (ctx.projects.length === 0) {
    section.append(el('p', { class: 'settings-hint', text: 'No projects yet.' }));
  }
  for (const project of ctx.projects) {
    section.append(
      el(
        'div',
        { class: 'settings-project-row' },
        el('span', { class: 'settings-project-name', text: project }),
        el('button', {
          class: 'settings-link-btn',
          type: 'button',
          text: 'Open',
          onClick: () => ctx.go({ kind: 'project', project }),
        }),
        el('button', {
          class: 'settings-link-btn',
          type: 'button',
          text: 'Rename',
          onClick: async () => {
            await ctx.renameProject(project);
            await ctx.reloadProjects();
            rerender();
          },
        }),
        el('button', {
          class: 'settings-link-btn danger',
          type: 'button',
          text: 'Delete',
          onClick: async () => {
            await ctx.deleteProject(project);
            await ctx.reloadProjects();
            rerender();
          },
        }),
      ),
    );
  }
  return section;
}

export function renderSettings(host: HTMLElement, ctx: SurfaceContext): void {
  const root = el('div', { class: 'settings' });
  host.append(root);

  const sections: Record<string, () => HTMLElement> = {
    Identity: () => identitySection(ctx),
    Editor: () => editorSection(),
    'Server & CLI': () => serverSection(ctx),
    Projects: () => projectsSection(ctx, () => show(active)),
  };

  const nav = el('nav', { class: 'settings-nav' });
  const panel = el('div', { class: 'settings-panel' });
  let active = 'Identity';

  const show = (name: string) => {
    active = name;
    for (const button of nav.querySelectorAll('.settings-nav-item')) {
      button.classList.toggle('active', button.textContent === name);
    }
    panel.replaceChildren(sections[name]!());
  };

  for (const name of Object.keys(sections)) {
    nav.append(
      el('button', { class: 'settings-nav-item', type: 'button', text: name, onClick: () => show(name) }),
    );
  }
  nav.append(
    el('div', { class: 'settings-nav-spacer' }),
    el('button', { class: 'settings-nav-item danger', type: 'button', text: 'Log out', onClick: () => ctx.logout() }),
  );

  root.append(
    el('div', { class: 'surface-head' }, el('h1', { text: 'Settings' })),
    el('div', { class: 'settings-body' }, nav, panel),
  );
  show(active);
}
