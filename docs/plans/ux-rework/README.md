# UX rework — master plan

Full proposal (audit, reference analysis, wireframes):
https://claude.ai/code/artifact/9b5266ef-de34-4896-8947-f76c5bcdeb6b

This directory turns that proposal into three independently shippable phases.
Each phase file is self-contained: a fresh session should be able to implement
it with only that file, this README, and the repo's `CLAUDE.md`.

## Why (one paragraph of context)

mdio's engine (CRDT sync, blame, comments, suggestions, versions, project-scoped
agents) is ahead of its interface. Today the app has one surface — the document
view — with a cramped sidebar, seven identical header buttons, unlabeled icon
buttons for project CRUD and MCP config, dead-end empty states, and no home,
no inbox, no settings, and no visible agent story. The rework adds the missing
surfaces and gives the doc view real hierarchy, following patterns from Google
Docs (inline accept/reject), Notion (Home + Inbox above the content tree),
HackMD (Edit/Both/Read as the primary mode), Liveblocks (agents reuse human
presence primitives), Tailscale ("add a device" as a first-class flow), and
Linear/GitHub (mentions inbox that empties as you work, ⌘K).

## Phases

| Phase | File | Theme | Size |
|---|---|---|---|
| 1 | [phase-1-hierarchy-and-trust.md](phase-1-hierarchy-and-trust.md) | Doc-view hierarchy, prose ergonomics, empty states, in-app dialogs/toasts | days, mostly client |
| 2 | [phase-2-surfaces.md](phase-2-surfaces.md) | Home, Inbox, Agents page, Settings — the missing surfaces | ~1–2 weeks, new routes + small APIs |
| 3 | [phase-3-agent-loop.md](phase-3-agent-loop.md) | Inline suggestion popovers, activity feed, ⌘K, badges | ~1–2 weeks |

Phases must land in order (2 builds on 1's components; 3 builds on 2's routes),
but each is a complete, mergeable improvement on its own.

## Target information architecture (end state, after phase 3)

```
/                       Home: project cards, mentions inbox, recents, first-run welcome
/<project>              Project page: doc list, empty-state CTAs
/<project>/<doc>.md     Document view (Edit / Both / Read)
/<project>/agents       Connect-an-agent flow + connected agents list
/settings               Identity, editor prefs, server & CLI info
⌘K                      Palette: jump to doc/project, create, actions
```

URL rules (extends the existing scheme, does not replace it):
- Doc paths keep ending in an editable extension — that is what makes trailing
  route segments (`agents`) and the SPA fallback unambiguous.
- `settings` and `agents` must be added to `RESERVED_PROJECT_NAMES` in
  `src/server/vault.ts` (a doc *folder* named `agents` stays legal — only the
  exact path `/<project>/agents` is claimed).
- The server SPA fallback in `src/server/index.ts` must also serve the shell
  for `/<project>/agents` and `/settings`.

## Design tokens (use everywhere, replace ad-hoc values as you touch files)

Defined once at the top of `src/client/styles.css` as CSS custom properties:

```css
:root {
  --ink: #1c1b22;        /* text */
  --ink-soft: #55525e;   /* secondary text */
  --ink-faint: #8b8794;  /* captions, placeholders */
  --paper: #fbfaf8;      /* app background */
  --panel: #ffffff;      /* cards, editor surface */
  --line: #e4e1dc;       /* borders */
  --accent: #6a53d0;     /* agent violet — already the suggestion/search color */
  --accent-soft: #efebfb;
  --human: #177e5b;      /* human presence green */
  --danger: #b3261e;
  --danger-soft: #fbeae8;
}
```

Notes:
- `--accent` (violet) means "agent/product accent"; `--human` green stays for
  human presence chips; `--danger` is reserved for destructive actions.
- No dark mode in this rework (out of scope; tokens make it cheap later).

## Codebase orientation (what a fresh session must know)

- No build step: `Bun.build` bundles `src/client/main.ts` when the server
  starts. Restart `bun run start` to see client changes. There is a single
  `src/client/index.html` shell.
- Client modules: `main.ts` (shell, nav, CRUD), `url-state.ts` (path URLs +
  hash view-state), `api.ts` (REST bindings), `comments.ts`, `suggestions.ts`,
  `versions.ts`, `history.ts`, `preview.ts`, `remote-edits.ts`,
  `mcp-config.ts`, `styles.css`.
- Server: `src/server/api.ts` (REST router — see its header comment for the
  route table), `index.ts` (ws + static + SPA fallback), `rooms.ts`,
  `vault.ts`, `cli-routes.ts` (`publicOrigin()` for reverse-proxy-aware URLs).
- Invariants live in `CLAUDE.md` — especially: rooms exist only for documents
  on disk; document/project CRUD is human-only REST (the MCP is edit-only);
  room name = vault-relative path = URL path.
- Tests: `bun test` runs everything including Playwright e2e
  (`tests/e2e.test.ts`) and the compiled-CLI suite. All suites must stay green.
- The e2e suite currently drives CRUD through **native** `prompt()/confirm()`
  dialogs (`page.on('dialog')`). Phase 1 replaces those with in-app dialogs,
  so those tests must be rewritten to DOM interactions in the same PR.

## Per-phase working agreement

1. Branch from `main` (`ux-phase-1`, `ux-phase-2`, `ux-phase-3`).
2. Implement, keeping `bun test` green at each step; extend/adjust tests in
   the same commit as the behavior they cover.
3. Verify visually: `bun run start ./vault`, open the browser, exercise the
   changed flows (or script a Playwright screenshot pass).
4. Update `CHANGELOG.md` (Unreleased section) and, if any shared contract or
   invariant changed, `CLAUDE.md`.
5. PR to `main`, merge with a merge commit (not squash).
