# mdio

Collaborative markdown over Yjs: a Bun server that turns a folder of markdown files into
live collaborative documents, a CodeMirror web UI for humans, and a stdio MCP server that
lets AI agents join the same documents as first-class CRDT peers (named presence, visible
cursor, anchored edits).

## Commands

- `bun run start [vaultDir] [--port N]` — serve a vault (default `./vault`, port 4321)
- `bun test` — server + MCP tests (fast, no browser)
- `bun run test:e2e` — Playwright e2e: two MCP agents + a browser editing concurrently
- `bun run test:all` — everything
- `bun run mcp` — the stdio MCP entrypoint (normally launched by an MCP host, not by hand)
- `bun run cli` — the `mdio` client CLI in dev (`version`, `help`, `mcp`, `mcp install`,
  `skill install`, `update`)
- `bun run build:cli` — cross-compile standalone `mdio` binaries for every entry in
  `src/cli/platforms.ts` into `dist/cli/` (one host builds all platforms; no native deps)

Tests are self-contained: each spawns its own server on an ephemeral port with a temp vault.

## Architecture

- `src/server/` — Bun HTTP + WebSocket server speaking the standard y-websocket wire
  protocol (`/ws/<vault-relative-path>`, one Yjs room per file). Rooms hydrate from disk
  and persist back debounced (400ms); every update is also appended to an NDJSON history
  log. `vault.ts` guards path traversal and file types, and owns the project model:
  top-level vault directories are projects, every document lives inside one. `api.ts`
  is the REST CRUD surface (`/api/projects[/:p[/docs[/*doc[/history|/blame]]]]` — see
  its header comment for the route table); create/rename/move/delete coordinate with
  `rooms.ts` (flush-and-close or discard-and-close) so no straggling persist can
  resurrect a deleted file. `api.ts` also serves read-only surface data: docs list
  metadata (`{path, title, modified}`), the cross-project inbox (`GET /api/mentions`
  — open @mentions + per-doc pending-suggestion counts) and connected peers
  (`GET /api/projects/:p/peers`, reads only already-open rooms via
  `RoomRegistry.openRooms()`). The server serves the app shell for `/<project>/<doc-path>`,
  bare `/<project>` pages, `/settings`, and `/<project>/agents` (view state stays in
  the URL hash).
- `src/client/` — web UI, bundled (minified) by `Bun.build` at server startup (no build
  step). Five surfaces behind a plain-DOM router in `main.ts`: Home (`home.ts` + the
  shared `inbox.ts` block), a project's doc view, the Agents connect page (`agents.ts`),
  and Settings (`settings.ts`); `url-state.ts` resolves the path to a `view` discriminator
  (`home|project|doc|agents|settings`) and keeps doc-view state (mode/comment/resolved)
  in the hash. `surface.ts` is the shell↔surface contract, `ui.ts` the shared DOM helpers,
  `prefs.ts` the persisted editor preferences (default mode, font, reading width).
  CodeMirror 6 + `y-codemirror.next` for remote cursors; `remote-edits.ts` flashes
  transient author-attributed highlights on remote inserts; `comments.ts` (thread panel +
  range highlights), `preview.ts` (markdown-it + mermaid pane), `history.ts` (replay
  slider).
- `src/shared/` — contracts both sides import: `blame.ts` (authorship), `comments.ts`
  (comment threads, anchors, mentions), `suggestions.ts` (proposed edits with
  relative-position anchors: agents propose, humans accept/reject).
- `src/mcp/` — stdio MCP (`@modelcontextprotocol/sdk`). `runtime.ts` is the editing
  runtime: search matches and the cursor are stored as **Yjs relative positions** so they
  survive concurrent edits (exact-text re-find as fallback). Stepwise writing via
  `begin_edit` / `append_text` / `commit_edit` / `abort_edit`; `replace_text` for one-shot
  search+replace; comment tools (`add_comment` … `delete_comment`, `list_comments` with a
  `mentioning` filter).
- `src/cli/` — the `mdio` client CLI compiled to standalone binaries. Its editing
  surface IS the MCP (`mdio mcp` runs `runMcp()`; the MCP host keeps the process
  alive); the rest are one-shot installers: `mcp install` merge-writes the mdio entry
  into `./.mcp.json`, `skill install` writes the bundled skill (inlined from
  `skills/mdio/SKILL.md` at compile time) to `.claude/skills/mdio/`, `update`
  self-updates by re-running the server's install script. `platforms.ts` is the registry
  driving the build script, download routes, and install scripts.
- `src/server/cli-routes.ts` — the server ships its own client: `GET /install.sh` (and
  `.ps1`) render an installer templated with the caller-visible origin (reverse-proxy
  aware), `/api/cli` lists platforms, `/api/cli/version` backs update checks, and
  `/api/cli/<platform>` streams binaries from `dist/cli` (baked in by the Dockerfile's
  `cli` stage; `MDIO_CLI_DIST` overrides the directory).
- `skills/mdio/SKILL.md` — the canonical Claude skill teaching when/how to use the
  MCP tools (routing rule, workflows, concurrency discipline); versioned with the tool
  surface it documents.
- `tests/` — `helpers.ts` (test server + raw Yjs peers), `mcp-client.ts` (scripted MCP
  host over real stdio), plus server/MCP/model/CLI/e2e suites. `cli.test.ts` compiles a
  real binary and runs the full install → update → MCP-peer loop against a live server
  (use async `Bun.spawn` there — `spawnSync` deadlocks children talking to the
  in-process server).

## Invariants

- The Y.Doc text key is `content`; the authorship map key is `authors` (clientID →
  identity, see `src/shared/blame.ts`); the comments map key is `comments` (threads with
  relative-position anchors, see `src/shared/comments.ts`); the suggestions map key is
  `suggestions` (proposed edits, anchored the same way, see `src/shared/suggestions.ts`);
  the room name is the vault-relative file path. All are shared contracts between server,
  client, and MCP — change them everywhere or nowhere.
- Every document lives inside a project: `vault/<project>/<doc-path>`, so the room name,
  the vault-relative path, and the web URL `/<project>/<doc-path>` are the same string.
  Project names cannot shadow server routes (`api`, `ws`, `app.js`, `styles.css`,
  `install.sh`, `install.ps1`) or start with a dot. Pre-projects vaults are migrated once
  at startup: root documents (and their `.mdio/` sidecars) move into `main/`.
- Rooms exist only for documents already on disk — connecting never creates anything.
  All lifecycle (create/rename/move/delete of projects and documents) is explicit REST,
  done by humans through the web UI. Agents are deliberately edit-only: the MCP exposes
  no CRUD tools, and `open_document` refuses paths that don't exist. That split is the
  point of the tool — humans own the document set, agents work inside it.
- An MCP peer is scoped to exactly one project (`MDIO_PROJECT`, required): tool paths are
  project-relative (`notes.md`, not `main/notes.md`), `list_documents` sees nothing else,
  and the runtime prefixes the project onto room names. Like identity, this is
  convention/trust, not auth — enforced in the MCP runtime, not the server.
- Docs that compute blame (server rooms, MCP sessions) are created with `gc: false` so
  deleted items survive for snapshot diffs; peers must register in the `authors` map on
  connect, before their first edit.
- The server is the **sole writer** of vault files. There is deliberately no file watcher:
  external disk edits while the server runs are unsupported (decision, not an oversight).
  The markdown file stays the source of truth for content; the `.mdio/` sidecars only
  add metadata (`<path>.yjs` CRDT state incl. authorship and comments, `<path>.log`
  append-only update history, `<path>.snapshots.json` named versions), and any divergence
  is reconciled as a "disk"-authored edit on hydrate.
- Editing tools must anchor with relative positions, never raw character offsets held
  across await points — other peers edit between tool calls.
- Peer identity comes from the MCP config env (`MDIO_USERNAME`, optional
  `MDIO_AGENT_COLOR`, `MDIO_SERVER`), not from tool arguments. Convention (trust,
  not auth): `owner/agent` (e.g. `plosson/claude`) means role `agent` linked to that human;
  a plain name means role `human` — so an MCP peer can act as a human. The web UI asks for
  a username (localStorage, logout clears it) and rejects `/` in it.
- The MCP process must keep stdout clean (protocol channel) — diagnostics go to stderr.

## MCP config for an agent

`GET /api/projects/<p>/mcp-config?username=<owner/agent>` returns all of the below
ready-made (install one-liner, `mcp install` command, `.mcp.json` entry) with the
caller-visible server URL; the web UI's Agents page (`/<project>/agents`, reached
from the sidebar's Agents item) renders it as a Tailscale-style connect flow with
copy buttons and a live "waiting → connected" status.

Easiest — install the binary from a running server, then wire the project:

```sh
curl -fsSL http://localhost:4321/install.sh | sh
mdio mcp install --server http://localhost:4321 --username plosson/claude --project main
mdio skill install
```

Or by hand (e.g. from a checkout, without the binary):

```json
{
  "mcpServers": {
    "mdio": {
      "command": "bun",
      "args": ["run", "<repo>/src/mcp/index.ts"],
      "env": {
        "MDIO_SERVER": "http://localhost:4321",
        "MDIO_USERNAME": "plosson/claude",
        "MDIO_PROJECT": "main"
      }
    }
  }
}
```
