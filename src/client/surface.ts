import type { DocViewState, View } from './url-state';

/** The signed-in identity (name + presence colors). */
export interface Me {
  name: string;
  color: string;
  colorLight: string;
}

/**
 * What a full-pane surface renderer (Home, Agents, Settings) can call back into
 * the app shell for. The shell owns navigation, the project list, and the shared
 * CRUD dialogs; surfaces render into a container and drive the app through this.
 */
export interface SurfaceContext {
  me: Me;
  /** The projects the shell currently knows about. */
  projects: string[];
  /** Navigate to a view — pushes a history entry by default. */
  go(view: View, opts?: { push?: boolean; doc?: Partial<DocViewState> }): void;
  /** Create a project via the shared dialog (with an optional welcome.md seed). */
  newProject(): Promise<void>;
  /** Rename / delete a project via the shared dialogs, then re-render the caller. */
  renameProject(project: string): Promise<void>;
  deleteProject(project: string): Promise<void>;
  /** Re-fetch the project list; returns the fresh list. */
  reloadProjects(): Promise<string[]>;
  /** Recompute the sidebar Inbox badge (after resolving/replying, or on focus). */
  refreshInboxBadge(): void;
  /** Change the signed-in display name live (re-joins awareness) — Settings only. */
  setName(name: string): void;
  /** Change the cursor color override live — Settings only. */
  setColor(color: string | null): void;
  /** Log out (forget the stored name). */
  logout(): void;
}
