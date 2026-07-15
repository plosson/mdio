# Phase 1 — Hierarchy & trust in the document view

**Goal:** the existing single surface stops feeling like a demo. No new routes,
no new server APIs (one optional exception noted in 1.6). Mostly
`src/client/*` + `tests/e2e.test.ts`.

Read `docs/plans/ux-rework/README.md` first (tokens, orientation, agreement).

---

## 1.1 Header rework: three zones instead of seven identical pills

Current header (left→right): doc path, "connected" chip, presence chips,
`+ comment | preview | history | versions | rename | move | delete` — all the
same pill style.

Target:

```
[ main / Welcome to mdio ]        [presence avatars] [Edit|Both|Read] [⋯]
```

- **Doc identity (left):** breadcrumb `<project> / <title>`. Title = text of
  the document's first `# ` heading (derive live from the Y.Text, update on
  change, debounced); fall back to the filename. The raw path moves to the
  breadcrumb's tooltip. Keep the connection state but demote it: a small
  colored dot on the breadcrumb (green connected / grey connecting / red
  disconnected) with a tooltip, not a chip that reads as a button.
- **Presence (middle-right):** overlapping avatar stack instead of loose
  chips. Humans = round avatar with initial, `--human`-derived colors; agents
  = squared avatar (border-radius ~5px) in `--accent`, with `owner/agent`
  tooltip. Reuse the existing awareness data in `renderPresence`
  (`src/client/main.ts`).
- **Mode toggle:** segmented control `Edit | Both | Read` replacing the
  `preview` button. Edit = editor only (today's default). Both = editor +
  preview split (today's preview-on state). Read = preview only, full width,
  editor hidden. Persist the mode in the URL hash (extend `url-state.ts`:
  replace the boolean `preview` param with `mode=edit|both|read`, default
  `edit`; no back-compat needed).
- **⋯ menu (far right):** a small dropdown containing `+ comment`, `history`,
  `versions`, divider, `rename`, `move`, divider, `delete` (styled with
  `--danger`). Plain DOM dropdown (button + positioned `<ul>`, closes on
  outside click and Escape) — no library.

Files: `src/client/index.html`, `main.ts`, `url-state.ts`, `preview.ts`
(read/both modes), `styles.css`.

## 1.2 Prose ergonomics in the editor

- Cap the content column: editor and preview content at `max-width: 72ch`,
  centered in their pane, comfortable padding.
- Type: default the editor to a proportional font for prose with an
  editor-settings escape hatch later (phase 2 settings); meanwhile ship
  proportional as the default. Keep `ui-monospace` inside fenced code blocks.
- Dim markdown syntax: a CodeMirror `HighlightStyle` for the markdown tags —
  heading `#` marks, list bullets, emphasis markers, link syntax in
  `--ink-faint`; heading text larger/bold; code spans on `--accent-soft`-style
  background. (See `@codemirror/language` `HighlightStyle.define` +
  `syntaxHighlighting`; markdown tags come from `@lezer/highlight` standard
  tags — already available transitively.)
- Hide CodeMirror line numbers for markdown (keep the gutter off; blame/e2e do
  not depend on it — verify by grepping tests for `cm-gutter`).

Files: `src/client/main.ts` (editor extensions), `styles.css`.

## 1.3 In-app dialogs and toasts (kill `prompt()` / `confirm()` / `alert()`)

Build one tiny module `src/client/dialogs.ts`:

- `askText({ title, hint?, initial?, confirmLabel }) → Promise<string|null>`
- `askConfirm({ title, body, confirmLabel, danger? }) → Promise<boolean>`
- `toast(message, { tone: 'ok'|'error' })` — bottom-center, auto-dismiss ~3s.

One overlay element in `index.html` (pattern: the existing `#versions`
overlay). Focus the input on open; Enter confirms, Escape cancels; `danger`
styles the confirm button with `--danger`. Replace every call site in
`main.ts` (project new/rename/delete, doc new/rename/move/delete) and the
`alert()` in `versions.ts` / CRUD error paths — errors become `toast(…,
{tone:'error'})`, successes get a brief ok toast ("Deleted meeting-notes.md").

For **move doc**, replace the free-text project prompt with a dialog listing
the other projects as clickable options (the data is already in `projects`).

**Tests:** `tests/e2e.test.ts` currently drives CRUD via `page.on('dialog')`
handlers (see the test `humans CRUD projects and documents from the UI…`).
Rewrite those interactions against the new DOM (`#dialog input`, confirm
button, etc.). The `versions` restore test also uses a native confirm.

Files: new `src/client/dialogs.ts`, `index.html`, `main.ts`, `versions.ts`,
`styles.css`, `tests/e2e.test.ts`.

## 1.4 Label the project bar; give destructive actions distance

- Replace the icon row `＋ ✎ 🗑 🤖` with: project switcher (keep the
  `<select>` for now), a `+ new` text button, and an `⋯` project menu
  containing `rename`, `connect an agent…` (opens the existing MCP dialog),
  and `delete project` (danger-styled, at the bottom).
- The MCP-config dialog itself is unchanged in this phase (phase 2 turns it
  into a page); fix its one visual bug: the `configure` command line clips —
  let the `<pre>` wrap (`white-space: pre-wrap; word-break: break-all`) or
  keep `overflow-x: auto` with a visible scrollbar.

Files: `index.html`, `main.ts`, `styles.css`.

## 1.5 Empty states that lead somewhere

- **Empty project:** the main pane shows a centered empty state instead of the
  dead editor chrome: project name, "No documents yet", two buttons —
  `+ Create a document` (opens the new-doc dialog) and `Connect an agent`
  (opens the MCP dialog). Hide the doc-action header (⋯ menu, mode toggle)
  when no doc is open.
- **Empty vault (no projects):** same pattern one level up: "Create your first
  project" CTA in the main pane; the sidebar shows only the `+ new` button.
- **Login modal:** add product context — the wordmark, one sentence: "Live
  markdown for humans and AI agents. Your name is what collaborators see."
  Render it over the `--paper` background, not over the ghosted dead app
  (hide `#app` until joined, or blur it deliberately).

Files: `index.html`, `main.ts`, `styles.css`.

## 1.6 Small trust fixes

- **Live project list:** refetch `/api/projects` (and the current project's
  docs) on `window` `focus` and after every own CRUD mutation, re-rendering
  the switcher. (Known bug: a project created in another tab never appears.)
- **Versions dialog feedback:** after a successful restore, show an ok toast
  and refresh the list; disable the save button while a save is in flight.
- **Doc list titles (optional, small):** if trivial, show first-heading titles
  in the sidebar by fetching doc first-lines — this needs an API change
  (`GET /api/projects/:p/docs` returning `{path, title}` objects). If it
  grows, defer to phase 2's recents work which needs the same metadata.

## Definition of done

- [ ] Header shows breadcrumb+status dot, avatar stack, `Edit|Both|Read`, `⋯` menu; `delete` is red and behind the menu.
- [ ] `mode=` replaces `preview=` in the URL hash; Read mode exists.
- [ ] Prose column ≤72ch, proportional font, dimmed markdown syntax, no line numbers.
- [ ] Zero native `prompt/confirm/alert` calls left in `src/client/` (grep).
- [ ] Empty project / empty vault / login states match 1.5.
- [ ] Project list refreshes on focus and after mutations.
- [ ] `bun test` fully green (e2e rewritten for in-app dialogs).
- [ ] CHANGELOG updated; screenshots taken before/after for the PR description.
