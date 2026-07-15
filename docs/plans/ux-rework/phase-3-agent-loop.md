# Phase 3 — Make the agent loop visible

**Goal:** the human⇄agent collaboration loop becomes tangible: act on
suggestions where the text is, see what agents did, move anywhere with ⌘K,
and get pulled back when you're needed. Requires phases 1–2.

Read `docs/plans/ux-rework/README.md` first.

---

## 3.1 Inline suggestion popovers (Google-Docs pattern)

Today: suggestion marks render inline (`src/client/suggestions.ts`) but
accept/reject only exists in the right rail.

- Clicking a marked range (or ghost insert widget) opens an anchored popover
  at the mark: author chip, kind, − old / + new preview (short), `✓ Accept`
  (primary) / `✕ Reject`, and `Withdraw` when it's yours. Reuse
  `acceptSuggestion`/`rejectSuggestion` from `src/shared/suggestions.ts` —
  no model changes.
- Positioning: `view.coordsAtPos(range.from)` + absolutely-positioned element
  in the editor's scroll container; close on scroll (reposition is fine too,
  choose simpler), outside click, Escape.
- The right rail stays as **bulk review** (this becomes its explicit title:
  "Review N suggestions"), and gains `Accept all` / `Reject all` with a
  danger-styled confirm (sequential accepts must re-resolve ranges between
  applications — accept in anchor order, skipping ones that orphan mid-pass;
  report the outcome in a toast).
- Same treatment for comments: clicking a comment-highlighted range focuses
  the thread in the panel (verify this already works; if not, wire it).

Known limitation to preserve in a code comment: concurrent double-accept from
two browsers can double-apply (documented v1 trade-off from PR #9 review).

## 3.2 Agent activity feed

Answer "what did my agent do while I was away?" per project.

**Server:** an in-memory ring buffer per project (e.g. 500 events), exposed as
`GET /api/projects/:p/activity → { events: [{ts, actor, role, kind, doc,
detail?}] }`. Emit from existing chokepoints — no new persistence, explicitly
documented as ephemeral (resets on restart):

- room `connect`/`disconnect` with a registered identity → `joined` / `left`
  (identity from the `authors` map entry or awareness user at that moment),
- awareness status transitions `composing↔idle` → `started writing in §X` /
  `finished writing` (the section already travels in awareness),
- suggestions map observer on the server room doc → `suggested`, `accepted`,
  `rejected` (actor = `resolvedBy` / suggestion author),
- comments map observer → `commented`, `replied`, `resolved thread`,
- snapshot save/restore (in `api.ts` handlers) → `saved version "v1"`,
  `restored version "v1"`.

Wire the observers in `Room.open` (they die with the room). Keep each event
one line; drop events with no resolvable actor rather than guessing.

**Client:** an `Activity` block on the project's Agents page (and a compact
"last 3 events" strip on Home project cards if cheap). Relative timestamps,
actor avatar, doc link.

**Tests:** API test — agent joins, edits, suggests; feed contains the expected
kinds in order; unknown project 404. Keep timing-tolerant (poll with
`waitFor`).

## 3.3 ⌘K palette

- One overlay component (`src/client/palette.ts`): input + result list,
  keyboard-first (arrows / Enter / Escape), opened with `⌘K` / `Ctrl+K` and
  via the sidebar Search item.
- Sources, in rank order:
  1. documents across all projects (from the phase-2 docs-metadata lists,
     fetched lazily on first open, cached per palette session) — matches on
     title + path,
  2. full-text hits via the existing `GET /api/projects/:p/search` for the
     current project when the query is ≥3 chars (debounced, section-labeled
     "In text"),
  3. actions: `New document`, `New project`, `Connect an agent`, `Settings`,
     `Toggle mode`, `Copy MCP config` — with their shortcuts displayed.
- The sidebar per-project search input from today is absorbed by the palette
  (remove it, keep the sidebar Search item that opens ⌘K).

## 3.4 Badges & attention

- Poll `GET /api/mentions?who=<me>` on a slow interval (60s) + on focus;
  update the sidebar Inbox badge and the document `<title>` (`(2) mdio`).
- In-app nudge: when a new unhandled mention arrives while the app is open,
  show a toast with the author + doc, clicking it deep-links to the thread.
- Explicit non-goals for now (note in code): web push, sounds, per-thread
  read-state beyond the handled semantics.

## 3.5 Polish sweep (fit-and-finish backlog, do last, timebox it)

- History and Versions merge into one drawer with two tabs (both are
  "the document over time"); ⋯ menu gets a single `History & versions` entry.
- Agent avatar in the presence stack pulses subtly while `composing`.
- Empty inbox: "Nothing needs you — mention @<agent> in a comment to hand off
  work" (teaches the core loop).
- Keyboard shortcuts dialog (`?`) listing palette, mode toggle, comment.

## Definition of done

- [ ] Click a suggestion mark → anchored accept/reject popover; rail = bulk review with accept/reject-all.
- [ ] `/api/projects/:p/activity` streams join/leave, writing, suggestion, comment, and version events; Agents page renders the feed.
- [ ] ⌘K opens everywhere; finds docs by title/path, text in current project, and actions; sidebar search input removed.
- [ ] Inbox badge + tab title update on focus/interval; new-mention toast deep-links.
- [ ] `bun test` green (new: popover e2e, activity API, palette e2e — palette keyboard nav included).
- [ ] CHANGELOG + CLAUDE.md updated (activity endpoint documented as ephemeral).
