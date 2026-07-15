# Phase 2 — The missing surfaces: Home, Inbox, Agents, Settings

**Goal:** mdio gets the four surfaces every reference product has. New client
routes + three small server additions. Requires phase 1 (dialogs, toasts,
tokens, header layout).

Read `docs/plans/ux-rework/README.md` first.

---

## 2.0 Routing groundwork

- `src/server/vault.ts`: add `'settings'` and `'agents'` to
  `RESERVED_PROJECT_NAMES` (with a comment: claimed by client routes). Add a
  vault migration note only if a real vault already has such a project
  (unlikely — skip migration, just reserve).
- `src/server/index.ts`: SPA fallback also serves the shell for `/settings`
  and `/<segment>/agents` (two extension-less segments where the second is
  exactly `agents`).
- `src/client/url-state.ts`: today's state is `{doc, project, mode, comment,
  resolved}`. Generalize to a `view` discriminator:
  `{kind: 'home'} | {kind: 'project', project} | {kind: 'doc', project, doc, …} |
  {kind: 'agents', project} | {kind: 'settings'}`.
  `/` no longer redirects into the first document — it renders Home.
- `src/client/main.ts`: `navigate()` becomes a small router that mounts one of
  the surface renderers. Keep it plain DOM (no framework): each surface is a
  `render<Surface>(container)` function; the doc view keeps its current
  open/teardown lifecycle.

The sidebar becomes global chrome across all surfaces:

```
mdio                      ⚙   ← settings link (⚙ routes to /settings)
⌕ Search            ⌘K        ← phase 3 palette; plain project search until then
⌂ Home
☰ Inbox               (2)
— PROJECTS / current project —
<doc list when inside a project>
+ new document
[avatar] Pierre
```

## 2.1 Server additions (all in `src/server/api.ts` + `vault.ts`)

1. **Doc metadata for lists.** `GET /api/projects/:p/docs` gains
   `{ docs: [{ path, title, modified }] }`:
   - `title`: first `# ` heading line of the file (read the file, first match
     within the first 50 lines; fall back to null → client shows filename).
   - `modified`: file mtime (ms).
   Update `vault.listDocs` accordingly. **Breaking for clients/tests** that
   expect `docs: string[]` — update `src/client/api.ts`, `src/mcp/runtime.ts`
   (`listDocuments` keeps returning plain paths to agents: map `.path`), and
   every test asserting the old shape (`grep -rn "docs)" tests/`).
2. **Cross-project mentions.** `GET /api/mentions?who=<name>` — same entry
   shape as the per-project route but with a `project` field added, aggregated
   over all projects (reuse `collectMentions` in a loop). This powers the
   Inbox and its badge.
3. **Connected peers.** `GET /api/projects/:p/peers` — for every *open* room
   under the project, read `room.awareness.getStates()` and return
   `{ peers: [{ name, role, color, doc, status }] }` (deduplicate by name;
   `doc` = project-relative path they're in). Requires a small accessor on
   `RoomRegistry` to enumerate open rooms with their names (e.g.
   `openRooms(): Array<[name, Room]>` for settled entries only — don't await
   pending opens). No auth (consistent with the trust model).

## 2.2 Home (`/`)

Layout (see wireframe 4.1 in the proposal artifact):

- Greeting line + counts (`N projects · M documents · K agents connected` —
  derive from `/api/projects` + doc metadata + `/api/projects/:p/peers`).
- **Project cards** grid: name, doc count, "edited <relative time>" (max doc
  mtime), presence faces of current peers. Click → `/<project>` (which opens
  its first doc, as the switcher does today). Ghost cards: `+ New project`,
  `Connect an agent` (routes to `/<project>/agents` of the first project, or
  project picker dialog when several).
- **"Needs your attention" inbox block** (see 2.3 — same component, capped at
  ~5 rows with a "view all" link to the Inbox).
- **Recents**: last ~8 docs across projects by `modified`, `project/title`,
  click to open.
- **First-run state** (no projects): welcome card — wordmark, the one-liner,
  `Create your first project` and `Connect an agent` CTAs. On project
  creation, offer to seed `welcome.md` with starter content demonstrating a
  comment and a suggestion (plain markdown seed is enough; do not fake CRDT
  metadata).

## 2.3 Inbox

A surface (`#inbox` hash route or sidebar-expanded panel — keep it simple:
a full main-pane surface reachable from the sidebar, URL `/` + sidebar state
is acceptable; if a URL is wanted use `/#inbox` on Home) — decision: **make it
part of Home's URL space**: `/` shows Home with the inbox block; the sidebar
Inbox item scrolls to / expands it. Do not invent a sixth URL.

- Data: `GET /api/mentions?who=<my name>`.
- Row: author avatar, one-line body excerpt, quoted text, `project/doc` link →
  opens the doc **and focuses the thread** (the comment-focus deep link
  already exists: hash `comment=<threadId>`).
- Handled semantics identical to the agents' queue: resolved or replied-by-me
  threads drop out; a "show handled" toggle mirrors `includeHandled`.
- Badge: sidebar Inbox count = unhandled entries; refresh on focus and after
  resolving/replying (no polling loop yet — phase 3 adds badges/notifications).
- Suggestions awaiting review: append pending-suggestion counts per doc to the
  inbox list (data source: this needs per-doc suggestion counts — reuse the
  mentions scan? No: add them in the same `/api/mentions` response as a second
  array `suggestions: [{project, doc, pending}]` computed in the same
  document sweep, since the sidecar/doc is already open there).

## 2.4 Agents page (`/<project>/agents`)

Tailscale-style connect flow (wireframe 4.3) — replaces the MCP-config modal:

- Step 1: install CLI (copyable, from `GET /api/projects/:p/mcp-config`).
- Step 2: identity input (default `<me>/claude`, editable, validated like the
  server does) + the `mdio mcp install …` command re-rendered live as the
  identity changes (client-side string build from the same config response).
- Raw `.mcp.json` block behind a "paste it yourself" disclosure.
- Step 3: live wait — poll `GET /api/projects/:p/peers` every ~3s while the
  page is open; when a peer matching the chosen identity appears, flip to
  "✓ connected" with a toast.
- Below: **Connected agents** list from the same endpoint: avatar, name,
  online dot, current doc, status (`composing` → "writing in <doc>").
- Sidebar: an `Agents` item inside the project section. Remove the MCP entry
  from the project ⋯ menu (or keep as a link to this page).
- Delete `src/client/mcp-config.ts` + its overlay once the page covers it,
  including the e2e test that exercised the dialog (rewrite against the page).

## 2.5 Settings (`/settings`)

Sections (left nav within the page, wireframe 4.4):

- **Identity**: display name (edits `localStorage` `mdio-name` and re-joins
  awareness live — reconnect providers with the new identity), cursor color
  picker (persist a `mdio-color` localStorage override; today color is
  hash-derived — respect the override in `withColors`), suggested agent
  identity preview (`<name>/claude`).
- **Editor**: default mode (edit/both/read), prose vs monospace font toggle,
  line-width (68/72/80ch). Persist in localStorage; read where relevant.
- **Server & CLI**: server URL, server version (`GET /api/cli/version`),
  install command, link to each project's agents page.
- **Projects**: list with rename/delete (moves the destructive action here,
  with the danger-styled confirm; keep them also in the project ⋯ menu).
- Log out stays in the sidebar footer AND here.

## Definition of done

- [ ] `/` is Home (projects, inbox block, recents, first-run welcome); nothing auto-teleports.
- [ ] Inbox shows unhandled mentions + pending suggestions across projects; rows deep-link to the focused thread; handled items drop out.
- [ ] `/<project>/agents` replaces the MCP modal, with live "waiting → connected" and the connected-agents list.
- [ ] `/settings` covers identity (live rename), editor prefs (applied), server info, project management.
- [ ] `settings`/`agents` reserved as project names; SPA fallback serves the new routes; deep-linking each surface works (reload on every URL).
- [ ] New/changed APIs documented in the `src/server/api.ts` header table; MCP `list_documents` still returns plain relative paths.
- [ ] `bun test` green — new API tests (docs metadata shape, /api/mentions, /api/peers incl. empty/unknown-project cases) and e2e for each surface.
- [ ] CHANGELOG + CLAUDE.md (architecture section: five surfaces) updated.
