/**
 * Editor preferences (set in Settings, applied everywhere). All persist in
 * localStorage: the default view mode a document opens in, a prose/monospace
 * editor font, and the reading-column width. `applyEditorPrefs` reflects the
 * font and width into the DOM (a root class + a CSS variable the stylesheet
 * reads); the default mode is consumed by url-state when a URL omits `mode`.
 */

import type { ViewMode } from './url-state';

export const DEFAULT_MODE_KEY = 'mdio-default-mode';
export const FONT_KEY = 'mdio-editor-font';
export const WIDTH_KEY = 'mdio-reading-width';

export type EditorFont = 'prose' | 'mono';
export type ReadingWidth = '68' | '72' | '80';

const WIDTHS: ReadingWidth[] = ['68', '72', '80'];

export function getDefaultMode(): ViewMode {
  const raw = localStorage.getItem(DEFAULT_MODE_KEY);
  return raw === 'both' || raw === 'read' ? raw : 'edit';
}

export function getFont(): EditorFont {
  return localStorage.getItem(FONT_KEY) === 'mono' ? 'mono' : 'prose';
}

export function getReadingWidth(): ReadingWidth {
  const raw = localStorage.getItem(WIDTH_KEY);
  return WIDTHS.includes(raw as ReadingWidth) ? (raw as ReadingWidth) : '72';
}

export function setDefaultMode(mode: ViewMode): void {
  localStorage.setItem(DEFAULT_MODE_KEY, mode);
}

export function setFont(font: EditorFont): void {
  localStorage.setItem(FONT_KEY, font);
  applyEditorPrefs();
}

export function setReadingWidth(width: ReadingWidth): void {
  localStorage.setItem(WIDTH_KEY, width);
  applyEditorPrefs();
}

/** Reflect the font + width prefs into the DOM (idempotent; call at boot and on change). */
export function applyEditorPrefs(): void {
  document.documentElement.classList.toggle('editor-mono', getFont() === 'mono');
  document.documentElement.style.setProperty('--reading-width', `${getReadingWidth()}ch`);
}
