# Contributing

For installation and everyday use, start with [README.md](README.md) and the [usage guide](docs/USAGE.md). The [agent skill](skills/pm-beads/SKILL.md) covers writing and organizing beads, structured asks, and fresh local checks.

## Agent checks and remote sync

The read-only check endpoint bypasses the app's issue snapshot cache and includes closed beads:

```bash
curl --fail-with-body 'http://localhost:8345/api/check'
curl --fail-with-body --get 'http://localhost:8345/api/check' --data-urlencode 'project=/path/to/repo' --data-urlencode 'issueId=demo-123'
curl --fail-with-body --get 'http://localhost:8345/api/sync' --data-urlencode 'project=/path/to/repo'
```

`/api/check` returns version 1, `ok`, `checkedAt`, `issues`, completeness flags, and conflict freshness. Completed checks return 200 even when diagnostics exist; invalid parameters return 400, an explicitly requested missing bead returns 404, and unavailable/incomplete checks return 503. A clean result has `ok: true` and `issues: []`. Stable codes are `ASK_KEY_INVALID`, `ASK_JSON_INVALID`, `ASK_SCHEMA_INVALID`, `DOLT_CONFLICT`, and `CHECK_UNAVAILABLE`. Ask diagnostics identify the metadata key and invalid field. Conflict diagnostics distinguish live database inspection from persisted sync snapshots. The endpoint does not sync or repair data.

Remote sync is disabled by default. Enable it in Settings for each project. The five-minute scheduler discovers the running server port, database, remote, and active branch, and uses the project's environment resolution. Optional `sync.remote` and `sync.branch` in `.beads/pm-beads.json` select a remote/branch; the branch must be active. `PM_BEADS_SYNC_POLL=0` disables background cycles. Test harnesses never start the scheduler.

Cycles share the app write mutex, commit staged and unstaged pending writes without resetting them, pull then push, and retry non-fast-forward push races up to three times. A cycle has a four-minute SQL deadline and each SQL subprocess has a one-minute cap. Conflict rows are persisted in ignored `.beads/pm-beads-sync.json`; corrupt snapshots cause an error rather than being discarded. Dolt 2.5.0 is tested: `dolt_allow_commit_conflicts=1` retains rows that an ordinary conflicting SQL pull rolls back. Identical sides may resolve automatically. Other changes require an explicit Keep ours/theirs selection; stale tokens and changed local rows are rejected. Resolutions are pushed only through the normal cycle. The UI refreshes after writes and observes background sync status every 15 seconds.

Before replacing an external timer, observe a successful app-managed cycle for that project. Retain the old timer configuration for rollback. Do not disable timers on other machines.

Settings also offers **Enable sync notifications** for each workspace. This explicitly requests browser permission and stores the opt-in only in that browser. While a pm-beads tab is open, it checks all opted-in workspaces, including ones not currently selected, and alerts on sync errors, unavailable status, or unresolved conflicts. Identical failures alert once until the problem changes or a healthy check rearms alerts. Clicking an alert opens that workspace's Settings. These are browser notifications, not push notifications when the browser is closed.

pm-beads is a local-first web UI for the Beads (`bd`) issue tracker. Contributions should preserve that model: the app runs on a developer machine, talks to the local `bd` CLI, and does not introduce a hosted backend or authentication layer.

## Setup

Prerequisites:

- Node 24 or newer
- Bun 1.3.14
- `bd` 1.2.2 and Dolt 2.5.0 on `PATH` (tested versions)
- Authenticated `gh` for optional pull-request features

Recommended setup:

```bash
git clone https://github.com/Setpiece-Studio/pm-beads.git
cd pm-beads
mise trust
mise install
bun install --frozen-lockfile
PM_BEADS_PROJECT_DIR=/absolute/path/to/your/project PM_BEADS_USER=your-handle mise exec -- bun run dev
```

Without mise:

```bash
bun install --frozen-lockfile
PM_BEADS_PROJECT_DIR=/absolute/path/to/your/project PM_BEADS_USER=your-handle bun run dev
```

The dev server listens on `http://localhost:8345`.

The public checkout contains no Beads database. Use an existing Dolt-backed workspace or initialize a separate project with `bd init`. Set `PM_BEADS_USER` to the identity you want on comments and answers; comma-separated aliases are supported and the first is used for writes. The legacy fallback is `ben`.

### Working in a git worktree

A worktree is a fresh checkout with no `node_modules` of its own. Bun then resolves imports upward to the parent checkout, which is close enough for `vitest`, `biome`, `tsc`, and `build` — but **not** for `vite dev`, so `bun run test:e2e` fails every spec with `Failed to load url .../nitro/dist/runtime/internal/vite/dev-entry.mjs`.

Run `bun install` in the worktree before running any gate there:

```bash
cd /path/to/worktree
bun install --frozen-lockfile
```

Use the frozen lockfile so setup cannot introduce unrelated dependency changes.

## View design conventions

Keep project and issue views compact: use concise rows, restrained padding, and inline properties so people can scan many items together. Match neighboring views instead of adding a large explanatory header above the content.

In the Gantt view, keep the project title and properties column fixed while the chart scrolls horizontally. Labels and bars must remain aligned vertically; verify that horizontal scrolling moves bars while leaving project labels in place, including at narrow viewport widths.

Put view explanations and chart warnings in the **Display** popover. Keep them available alongside the controls they explain, and avoid duplicating them as a page preamble. Errors that prevent an action from completing still belong at the affected action.

## Working With Beads

The maintainers track work with Beads; that private database is not distributed. Use the public repository's GitHub Issues for contributions, or your own Beads workspace for local tracking. Useful commands in a configured workspace:

```bash
bd ready
bd show <id>
bd update <id> --claim
bd close <id>
```

The app shells out to `bd`. Code that invokes `bd` must go through the serialized CLI helper in `src/lib/beads/cli.ts`: parallel `bd` processes are measurably slower than serialized ones and each costs ~115 MB.

The project picker only lists directories whose `.beads/metadata.json` declares `backend: dolt` **and** that have the database on disk (`.beads/embeddeddolt/`, `.beads/dolt/`, or a `.beads/redirect` file). Pre-Dolt workspaces and half-initialized `.beads` dirs are skipped: `bd` fails on them with "no beads database found". The same rule guards a hand-typed `?project=` URL — see `src/lib/beads/projects.ts`.

The app supports Dolt-backed projects in server and embedded modes. In server mode, bd can auto-start a per-project `dolt sql-server` on demand, with runtime pid, port, and log files under `.beads/`. For a cloud Dolt remote, start that server under the project's environment (`mise exec -- bd dolt start`) so it inherits the required credentials. Use the migration instructions for your installed Beads version when changing modes; `bd init` is for initializing a workspace, not a shortcut for migrating an existing database.

### Naming a bead in the UI

Anywhere the interface points at a bead — chip, rail row, dependency row, breadcrumb, card — show the **title**, and keep the id secondary: `title={beadRefTitle(id, title)}` for the hover, plus `<BeadId id={id} />` after the title where the row has room (both in `src/lib/issue-meta.tsx`). Fall back to the id where the title isn't loaded. See [Bead reference](CONCEPTS.md#bead-reference).

### Bead links in markdown

Every markdown body the app renders — descriptions, design/acceptance/notes fields, comments, message bodies, memories — autolinks bead references to **bead chips**:

| Written | Renders as |
|---|---|
| `pm-beads-gnj` — a bare id of the project's prefix | a chip |
| `[[pm-beads-gnj]]` | a chip, brackets dropped |
| `http://localhost:8345/issues/pm-beads-gnj` — any host, optional `?project=` | a chip, not a raw URL |

Ids inside code spans and fenced blocks are left alone, and so is a link that carries its own label (`[the cache bead](…/issues/x)`). An epic chip links to `/projects/$id` and everything else to `/issues/$id`, carrying `?project=` like the rest of the app.

A chip reads as the bead's title (with its status glyph, and its id on hover) only where a route provided a `BeadLookupProvider` (`src/lib/bead-lookup.tsx`), which routes build from `listIssuesFn({ all: true })` trimmed by `beadLookupIssues`:

```tsx
// in the loader
beads: beadLookupIssues(await listIssuesFn({ data: { all: true, projectDir: deps.project } }))

// around whatever renders markdown
<BeadLookupProvider issues={beads} project={search.project}>…</BeadLookupProvider>
```

The provider is also where the id prefix comes from, so **without one** bare ids and `[[id]]` stay plain text and only URLs — which name their bead outright — still render a chip. Passing `onOpenBead` makes chips call it on a plain left click instead of navigating; the href stays, so middle-click still opens the bead. No route passes it today — the inbox used to, for its drawer.

The tokenizer is `src/lib/bead-links.ts`. It shares its id pattern with the PR-history backfill's extractor (`beadIdPattern`, `src/lib/beads/pr-backfill.ts`), so a mention the backfill would find in a PR body is exactly the one the UI turns into a chip.

### Editing bead prose

Title and description are editable from the issue detail page. Both write through
`useIssueEdits` (`actions.setTitle` / `actions.setDescription`) and land as one `bd update`.

| Field | Affordance | Saves on | Cancels on |
|---|---|---|---|
| Title | click the heading | `Enter`, or leaving the input | `Esc` |
| Description | click the rendered body, or the pencil that appears on hover | `⌘/Ctrl+Enter`, or leaving the editor | `Esc` |

Rules both share: an unchanged draft spends no `bd` call, and a **refused save keeps the draft on
screen** — the actions resolve to whether the write landed, the same bargain `CommentComposer`
makes with a failed post. The failure itself shows on the rail's single error line; neither
editor adds an alert of its own.

#### The concurrent-edit guard

The same five fields the editors write — title, description, design, acceptance criteria, notes —
are the ones `bd update` replaces **whole**. An agent editing a bead while a person has the editor
open used to lose its text silently: the person's save simply won. So every one of those writes
goes through `saveTextField` (`src/lib/beads/mutations.ts`) rather than `updateIssue`, and carries
a **baseline** — the text the editor opened on:

```
saveTextField(id, field, value, baseline)
  bd show   → is the stored text still `baseline`?
    no  → refuse, and return the issue as it stands
    yes → bd update, then the usual read-back
```

The baseline is the text the reader *demonstrably read*, captured when the editor opened — not
the rail's current copy, which can move underneath an open editor without the reader ever seeing
it. The five setters on `useIssueEdits` all require it; there is no unguarded way to write these
fields from the rail. They resolve to a [`TextSaveOutcome`](src/components/issue-detail/use-issue-edits.ts)
rather than a boolean, so a refusal can carry the incoming text.

What the reader gets is a notice above the editor — what the field says now, rendered — plus
**Overwrite with my version**, which re-sends the same draft against the text it was just shown.
The draft is never touched. Leaving the editor while a conflict stands saves nothing: the
baseline is stale by definition, so another attempt could only be refused again.

Two honest limits. It costs **one extra `bd show` per prose save** — human-paced, never per
keystroke — and that read cannot be avoided, because the read-back `updateIssue` already does
happens *after* the write and so only ever reports our own text. And bd has no conditional write,
so a `bd update` landing between the guard's read and its write still wins; the window shrinks
from however long the editor was open to the gap between two adjacent bd calls.

A blank title is refused twice over — the hook will not send it and `bd` would reject it
(`title cannot be empty`). An **empty description is a real value**: `bd update <id>
--description ""` clears the field (verified on bd 1.2.2; `--allow-empty-description` only gates
the stdin/file read path), and a cleared description renders the *Add description…* affordance
rather than collapsing to nothing.

The editor is `src/components/ui/markdown-editor.tsx`, wrapping
[`@uiw/react-md-editor`](https://uiwjs.github.io/react-md-editor/) — pinned to `4.1.2`, and a
plain textarea despite the name, so editing is lossless markdown **source** rather than a WYSIWYG
round trip that would re-serialize the whole field on every keystroke. Four things about it are
load-bearing:

- **It is mounted client-only**, behind a dynamic import gated on a `mounted` flag. It reads
  `document` on mount and does not server-render; SSR and the loading window both show the
  read-only `Markdown` body instead. That also keeps its ~270 kB off the initial bundle.
- **Its preview is overridden** (`components.preview`) to render our own `Markdown`, so the
  preview runs `remarkGfm` + `remarkBeadLinks` and draws [bead chips](CONCEPTS.md#bead-chip).
  Without the override the library renders bead references as dead text.
- **The `/common` entry** is imported, which mirrors the source into a `<pre>` beneath the
  transparent textarea to colour it, and builds its TextArea with `useMinHeight` — the hook that
  lets `height="auto"` size the editor to its content rather than to a fixed box. Its syntax
  palette is re-pointed at shadcn tokens in `styles.css`: the library swaps colours inside a
  `prefers-color-scheme` media query, which our stored `theme` preference is allowed to disagree
  with.
- **Save and cancel are bound in the capture phase**, on a native listener on the editor's
  wrapper. The library attaches its own native `keydown` handler to the textarea and stops
  propagation whenever it handles a key — `Enter` on a list line, for one — so a React
  `onKeyDown` would never see `⌘Enter` inside a list. Everything else is the library's keymap
  (`⌘B`/`⌘I`, Tab indent, list continuation, `⌘D`, `Alt+↑/↓`, a preserved native undo stack);
  do not reimplement any of it.

The editor's GitHub palette is re-pointed at the shadcn tokens in `src/styles.css`, under
`:root .w-md-editor` / `.dark .w-md-editor` — prefixed so they out-specify the library's own
stylesheet, which arrives later than ours with the dynamic import.

There is no `@agent` mention autocomplete in it. That is bespoke to `MentionTextarea`, which the
comment composer keeps.

### Linking PRs to Beads

A bead that has a pull request carries the PR's URL in flat issue metadata under `pr_url`. It is the bead's **latest** PR — re-linking replaces it; older PRs live in the bead's comments.

When you open a PR for a bead, do both halves:

```bash
bd update <id> --set-metadata pr_url=https://github.com/<owner>/<repo>/pull/<n>
```

and put `Closes <id>` in the PR body. The metadata is what tooling reads (`bd list --has-metadata-key pr_url --json`, and the merged-PR sweep); the `Closes` line is what a human reviewer reads.

In the app, the issue detail rail's **Pull request** row does the same write. It accepts a full PR URL, `#42`, or `42` — a bare number is resolved against the project's `git remote get-url origin`. The row shows the PR's live state (Open / Draft / Merged / Closed) by shelling to `gh pr view`, cached about 60 seconds per URL. That call runs **outside** the bd mutex — it is a GitHub call, not a bd one — and fails soft to an `Unknown` badge when `gh` is missing, unauthenticated, or offline, so the link still renders.

Unlinking removes the key entirely rather than blanking it, so `--has-metadata-key pr_url` stops matching the bead.

### Merged-PR sweep

Nothing in beads notices when a pull request merges, so pm-beads sweeps: it asks GitHub which of
the linked PRs have merged and closes the beads behind them.

What one sweep does, per project:

1. `bd list --json --all --limit 0 --has-metadata-key pr_url` — every bead carrying a linked PR,
   closed ones included, through the `cli.ts` mutex like any other `bd` call.
2. Groups the candidates' `pr_url`s by `owner/repo` and asks each repo once:

   ```bash
   gh pr list --repo <owner>/<repo> --state merged \
     --json number,url,mergedAt --search "merged:>=<since>" --limit 200
   ```

   That runs **outside** the bd mutex (it is a GitHub call), under the project's own environment,
   with a 15s cap. A repo `gh` cannot read — missing, unauthenticated, offline, not visible to the
   token — contributes a warning and nothing else; the other repos are still swept.
3. Applies the plan, every write stamped `--actor pm-beads`:

   | Bead | What happens |
   |---|---|
   | open / in_progress, plain | `bd comment <id> --actor pm-beads "Closed: PR #N merged <url>"` then `bd close <id> --actor pm-beads --reason "PR #N merged"` |
   | epic, or carrying an open ask | the comment only: `PR #N merged <url> — not auto-closed (epic / open ask)` |
   | closed | untouched, and reported as skipped |
   | any other status, or a `pr_url` that is not a GitHub PR url | untouched, and reported as skipped |

A sweep returns `{ closed, commented, skipped, warnings, since, ranAt, dryRun }`. `dryRun: true`
produces exactly that plan and writes nothing — no comments, no closes, no sidecar stamp.

**The window.** `since` is the project's last *successful* sweep minus a one-day safety margin,
and 30 days on a first run (also the ceiling, so a stale timestamp can never ask GitHub for years
of history). `lastRunAt` advances only after a run with **no warnings at all**: a repo that could
not be read is re-covered next time rather than stepped over.

**Sidecar keys** — in the app-owned `.beads/pm-beads.json`, beside `env`:

| Key | Meaning |
|---|---|
| `sweep.lastRunAt` | ISO instant of the last clean sweep. Written by the app; the next run searches from here minus the margin. |
| `sweep.enabled` | `true` opts a non-default project into the interval poll; `false` disables the poll for that project entirely. Absent means "polled only if this is the env-default project". |

```json
{ "version": 1, "sweep": { "enabled": true, "lastRunAt": "2026-08-27T12:00:00.000Z" } }
```

Writing `lastRunAt` bumps the sidecar's mtime, which invalidates that project's cached bd
environment — one extra `mise env --json` per sweep. A sidecar the app cannot parse is never
rewritten: a typo in `env` costs the timestamp, not the configuration.

**Triggers.**

- **Manual** — the issues toolbar's *Sweep merged PRs* popover. Opening it runs nothing; *Preview*
  is a dry run and *Sweep now* writes. The summary lists what closed, what was only commented on,
  and any repo `gh` missed.
- **Interval poll** — every 5 minutes in the server process (`src/server.ts` starts it; that is the
  only reason the custom server entry exists). It covers the env-default project plus any
  discovered project whose sidecar sets `sweep.enabled: true`, never overlaps itself, and refuses
  to run under `vitest` or the e2e harness (`PM_BEADS_E2E`). `PM_BEADS_SWEEP_POLL=1` forces it on,
  `=0` forces it off.

## Inbox

The inbox is a queue of unfinished beads with open `ask.*` metadata. There are no
message/activity tabs, mention rows, or read/unread actions. A bead stays in the queue until
its final ask is answered; malformed ask metadata stays visible for repair. Closed beads
are excluded. An ask's age, author, assignee, and previous read state do not hide it.

`issuesWithOpenAsks` in `src/lib/beads/asks.ts` supplies both queue membership and the
sidebar badge count (beads, not individual questions). `openAskRows` previews the unanswered
questions and sorts by the newest open ask's creation time, newest or oldest first.

The route and `projectShellStatusFn` share the cached `bd list --json --all --limit 0`
snapshot. They do not read messages or scan comments for notifications. The cache expires
after 10 seconds and is invalidated by app writes. Explicitly lifting bd's row limit keeps
asks in larger projects visible.

Selecting a row sets `?bead=<id>` and opens standard editable issue detail. The inbox passes
`compactProperties` so properties always reflow above the body, with related links below.
Other issue views retain their responsive 751px breakpoint. Answering the final ask removes
the row and updates the badge while keeping the selected detail visible for reviewing the
answer. Reloads and Back preserve the selected bead. Retired tab/scope/unread/activity/thread
params have no effect.

### Asking for a decision

Write a structured ask on each bead that needs an answer:

```bash
bd update <bead> --status blocked --set-metadata 'ask.rollout_order={"kind":"decision","q":"Renderer or exporter first?","options":["A: renderer","B: exporter"],"by":"coordinator","at":"2026-10-13T12:00:00Z"}'
```

The schema lives in `src/lib/beads/asks.ts`. The detail's Actions section writes the answer,
answering actor, and timestamp back into that metadata. Signed comments can add context;
messages, mentions, and the retired `human` label do not create inbox entries.

Use the current UTC time for `at`. Direct CLI metadata writes do not change status automatically: set `blocked` with a new ask, and only unblock after every ask is answered and no other blocker remains. A default is a proposal, not approval; pm-beads does not execute it on a timer. See the [portable ask reference](skills/pm-beads/references/asks.md) for schema, answer attribution, and validation examples.

The detail's comment composer still posts through `commentAsViewerFn`, signed as
`PM_BEADS_USER[0]`. Messages and mentions remain available in bead activity and agent
notification workflows. The background activity reader (`inbox-activity.ts`) and legacy
read-state sidecar fields remain supported by the data layer, independently of the inbox queue.

### Status pipeline

The status selector, filters, issue/project groups, board columns, and the detail top bar's n/N
all draw on one project-scoped pipeline (`readStatusPipeline`, re-read whenever the selected
project changes).

The sidecar's `pipeline` is the skeleton — the built-in order when a project has not written one.
Everything the skeleton does not name fills in around it: statuses from Beads' `status.custom`
config, then any **unknown** status observed on a bead, then the built-ins still missing. A new
status stays visible before the sidecar knows about it.

**The unnamed ones land immediately before `closed`, never after it.** An ordering is a claim
about how work flows, and a status it never mentions is somewhere mid-flight, not past Done —
appending put a board's "Done" column in the middle and sank a custom status below the closed
group in a list. A hand-written pipeline that never names `closed` simply takes the rest at the
end (`TERMINAL_STATUS` / `placeUnordered` in `status-model.ts`).

An observed status contributes its name and nothing else. It never reorders a built-in: `bd list`
makes no promise about the order it returns beads in, and an order derived from it changes between
reads — which took every grouped list and every board column with it, and is what made the e2e
suite report a different failing set per run (pm-beads-7i1.1).

A status the pipeline does not carry at all — the one on the open bead, ahead of the project
loader — stays at the head of the selector's options, so no other edit can quietly move the bead
off its own status. Built-in names come from `STATUS_LABELS` (bd's `closed` reads as "Done"); a
custom status has no name to read anywhere, so its bd key is title-cased: `awaiting_deploy`
renders as "Awaiting Deploy".

One pipeline, two reading orders:

| Surface | Default order |
|---|---|
| Board columns, status selector | the pipeline — `deferred → open → in_progress → blocked → closed` |
| Grouped issue and project lists, filter options | triage — `in_progress → blocked → open → deferred → closed` |

A board reads left-to-right as a workflow; a list leads with the work in flight. Both defaults
live in `src/lib/beads/status-model.ts` (`DEFAULT_STATUS_PIPELINE`, `DEFAULT_LIST_STATUS_ORDER`),
and a project that declares its own `pipeline` in the sidecar has said how its work flows — that
order then governs every surface, lists included (`listStatusOrder`).

Status icon names live beside the order in `.beads/pm-beads.json`:

```json
{
  "version": 1,
  "statuses": {
    "pipeline": ["open", "in_progress", "in_review", "closed"],
    "icons": {
      "open": "circle",
      "in_progress": "circle-dot",
      "in_review": "eye",
      "closed": "check-circle"
    }
  }
}
```

Supported icons are `circle`, `circle-dot`, `circle-dashed`, `ban`, `check-circle`, `moon`,
`clock`, `eye`, `flask`, `rocket`, and `shield-check`. Missing mappings use familiar built-in
icons or a dashed-circle fallback for an unknown status. A malformed `statuses` block is ignored
without preventing the selected project from loading.

#### Authoring a pipeline for a project

`bd config get status.custom` gives a **set**, not a sequence, and the real workflow interleaves
those names with the built-ins — a project can put `backlog` ahead of `open` and `in_review` after
`in_progress`, and no ordering derived from either list gets that right. That interleaving is the
whole reason `pipeline` is written by hand.

Three rules make one correct:

1. **Name every status the project uses**, built-in and custom, in one sequence. A status left out
   still appears, but only in the fallback position above.
2. **End on `closed`** — it is the terminal status everything unnamed sorts in front of.
3. **Give each one an icon**, so a custom status is not the only dashed circle on the board.

Read the project's own names first, then write the block:

```bash
cd <project> && bd config get status.custom
```

Declaring a `pipeline` also switches that project's grouped lists off the triage default and onto
the authored order, so write the sequence you want to *read*, not only the one you want to drag
across a board.

#### Backfill from PR history

The sweep only sees beads that already carry a `pr_url`. Everything that merged before the
convention existed is invisible to it, so the backfill goes the other way: read the repo's merged
pull requests, find the bead ids in them, and propose the links the sweep would then act on.

It is a **review list**, never an automatic pass. One scan, per project:

1. `bd list --json --all --limit 0` — every bead, closed ones included, through the `cli.ts`
   mutex. Their ids are also where the project's **bead-id prefix** comes from (`pm-beads-`,
   `sc-`, `sample_project-`): the most common prefix across the live ids wins.
2. `git remote get-url origin` names the repo to read. A project with no GitHub origin
   contributes a warning and no proposals.
3. ```bash
   gh pr list --repo <owner>/<repo> --state merged \
     --json number,url,title,body,headRefName,mergedAt \
     --search "merged:>=<since>" --limit 500
   ```
   **Outside** the bd mutex, under the project's own environment, with a 30s cap — the same
   rules the sweep's `gh` call follows. `<since>` is *N* days back, 180 by default and settable
   in the panel (clamped to 1–3650).
4. Bead ids are extracted from each PR and tiered:

   | Confidence | Where the id was found |
   |---|---|
   | `high` | the body closes it — `Closes` / `Fixes` / `Resolves <id>`, case-insensitive, optional colon |
   | `medium` | the PR title or the branch name (`headRefName`) |
   | `low` | anywhere else in the body — often a "see also" |

   Ids are matched as `<prefix><alnum>`, with dots allowed for legacy dotted ids (`x.1`). The
   match is greedy and prefix-bounded, so `pm-beads-10` is never read as `pm-beads-1`, and
   `old-pm-beads-1` is not a match at all.
5. Each surviving id becomes one proposal. Dropped without a row: an id that is not a bead in
   this project, a bead that is already **closed**, a bead already linked to *this very* PR, and
   a bead a person **skipped**. A bead linked to a *different* PR is proposed as an update, never
   a close. One row per bead — the strongest, then most recent, claim wins. Order is confidence
   descending, then newest merge, then id, so two scans of the same history read identically.

| Proposal | What applying it does |
|---|---|
| plain open bead | `setPrUrl`, then `bd comment` + `bd close`, both `--actor pm-beads` |
| epic, or carrying an open ask | `setPrUrl`, then the comment only — same rule as the sweep |
| bead already linked elsewhere | `setPrUrl`, then a comment naming the `pr_url` it replaced |

Applying goes through the sweep's own `applySweepAction`, so a backfilled close is written and
signed exactly like a swept one. Its comment says so: `— backfilled from PR history (high
confidence)`.

**Sidecar key** — in the same app-owned `.beads/pm-beads.json`, beside `env` and `sweep`:

| Key | Meaning |
|---|---|
| `backfill.skipped` | Bead ids dismissed from the review list. Never proposed again. Unskipping is a hand edit — a dismissal is meant to stick. |

```json
{ "version": 1, "backfill": { "skipped": ["pm-beads-a1"] } }
```

**Triggers.** The issues toolbar's overflow menu (**⋯ → Backfill from PR history…**) and a link
in the sweep popover. There is no timer and no CLI entry point: it writes only what a person
checked. The panel scans as soon as it opens — scanning writes nothing — pre-checks the `high`
rows and leaves the rest unchecked, and applies only the selection.

## Per-project Environment

Every `bd` the app spawns runs under the selected project's own environment, layered on top of the app's (`src/lib/beads/project-env.ts`). This matters most in **bd server mode**: `bd dolt push/pull` execute inside the per-project `dolt sql-server`, and that server inherits the environment of whichever `bd` call happened to auto-start it. A server started by the app without the project's credentials fails every push with an opaque OAuth error until someone runs `bd dolt stop && mise exec -- bd dolt start` by hand.

Resolution order, per project directory:

1. **App sidecar** — `.beads/pm-beads.json` (app-owned, like `pm-beads-views.json`). If it configures `env`, it wins outright and mise is not consulted. The same file also carries the merged-PR sweep's `sweep` block; the two are independent, and each reader ignores the other's keys.
2. **mise auto-detect** — no sidecar `env`, but `mise.toml`, `mise.local.toml`, or `.mise.toml` in the project dir: the app runs `mise env --json` there.
3. **Nothing** — `bd` gets the app's own environment, as before.

The sidecar is optional and both of its keys are optional. `command` is run in the project dir and must print a JSON object of strings on stdout; `vars` are static values layered on top of that output:

```json
{
  "version": 1,
  "env": {
    "command": "direnv exec . env-to-json",
    "vars": { "BEADS_ACTOR": "ben" }
  }
}
```

Notes:

- `command` is split on whitespace and run **without a shell** — no quoting, globbing, or `$VAR` expansion. Put anything that needs a shell in a script and point `command` at it.
- Resolution is cached per project and re-read only when the sidecar or a mise config file's mtime changes, so the per-call cost is a few `stat`s (~5 µs) against `bd`'s own ~65 ms. The first resolution costs one command run (`mise env --json` is ~20–45 ms).
- A `PATH` in the project env is the one that resolves `bd` itself, exactly as `mise exec -- bd` would. `mise env` prepends its tool dirs to the inherited `PATH`, so `bd` stays reachable; a hand-written sidecar that replaces `PATH` wholesale must keep `bd` on it.
- Failures never break the app: an unreadable sidecar, a schema mismatch, or a command that errors or prints non-JSON logs one warning and resolves to an empty env. A common cause is an untrusted mise config — run `mise trust` in the project.
- Concurrency is safe: `bd`'s dolt server is per project and guarded by `.beads/dolt-server.lock`, so several cold `bd` calls in the same project (app and agents together) start exactly one server — verified with four concurrent cold starts.

### Projects that manage their own dolt server

A project can opt out of `bd`'s auto-start with `dolt.auto-start: false` in `.beads/config.yaml` — an externally managed or agent-shared server. When that project's server is stopped, `bd` refuses every command, so the app checks `bd dolt status --json` first and renders the project-error panel with the command to start it (`mise exec -- bd dolt start` for a mise project, otherwise `bd dolt start`). See `src/lib/beads/dolt-server.ts`.

## Page Loading

Issue and project detail loaders await only the selected bead. After rendering,
`useDeferredRead` fetches related issues/link metadata, previous/next navigation, and
project progress independently. The shell also fetches its inbox count, status options,
and mention suggestions after rendering. Saved-view tabs load independently of list rows.

The detail activity stream and composer stay behind **Load comments**. Its comments,
history, and related-message query runs only after that click (or an explicit comment
permalink). Opening another bead resets the control; failed reads offer Retry.

Lists still await their status pipeline so grouping and ordering are correct on first
render; the project list also needs progress for its sorting/filtering modes. Status
configuration shares the 10-second per-project read cache and is invalidated by writes.
The issues list gets epic names from its existing issue snapshot, without an epic-status query.

Deferred reads hide old data immediately when their project/issue scope changes, discard
late responses, and retain same-scope data during refresh. Root/list loader refreshes after
mutations also refresh the secondary data. Failed secondary reads show a local retry action
while keeping primary content usable. This does not change bd's command serialization.

## Quality Gates

Run these before opening a pull request:

```bash
bun run typecheck
bun run test
bun run lint
bun run build
```

Run the browser suite when changing routes, server functions, persistence, or user flows:

```bash
bun run test:e2e
```

The e2e suite starts its own throwaway Beads project and should not mutate your normal `.beads` database.

### E2E isolation across checkouts

Every checkout gets its own dev-server port and its own seed directory, so two worktrees can run `bun run test:e2e` at the same time without clobbering each other's seeded projects.

Both values are derived from the first 8 hex characters of `sha256(git rev-parse --show-toplevel)`:

| Value | Derivation | Example |
|---|---|---|
| Port | `8400 + hash % 600` (range 8400–8999, clear of the 8345 dev server) | `8807` |
| Scan root | `$TMPDIR/pm-beads-e2e-<hash8>` | `.../T/pm-beads-e2e-38d352df` |

A linked worktree reports its own path, so it hashes differently from the main checkout. Nothing about the values is written down — `playwright.config.ts`, the support helpers, and the specs all read them from `e2e/support/isolation.ts` via `e2e/support/bd.ts`. Specs never hardcode a port, a path, or a seeded project name.

Two environment variables override the derivation, for a one-off run beside an existing one or for a debugging session on a known port:

| Variable | Effect |
|---|---|
| `E2E_PORT` | Port the e2e dev server binds. Must be an integer 1–65535; anything else is a hard error. |
| `E2E_SCAN_ROOT` | Directory the seeds live in. **Wiped on setup and removed on teardown** — point it only at a throwaway path. |

The harness refuses to share rather than colliding quietly:

- **Port** — `e2e/support/preflight.ts` runs ahead of `vite dev` (Playwright starts `webServer` before `globalSetup`) and fails with the pid and command name of whatever holds the port.
- **Scan root** — `global-setup` claims `<scan root>.lock`, a JSON record of pid, checkout, port, and start time, written with `O_EXCL`. A second run against the same scan root fails naming the run that holds it. Locks whose process is gone — or that are more than six hours old, in case of pid reuse — are treated as abandoned and taken over.

Teardown stops any `dolt sql-server` whose working directory is inside the scan root (the stopped-server fixture seeds one with `bd init --server`), removes the scan root, and releases the lock. It leaves servers rooted anywhere else alone, including the one serving this repo's own `.beads`. After a run, `ps -axo pid=,command= | grep 'dolt sql-server'` should show nothing new.

The seeded project is also a git repo with an `origin` pointing at `e2e-owner/e2e-repo` — nothing is ever committed there, but the PR-history backfill reads that remote to decide which repo to scan. `git init` runs *after* `bd init`, which auto-commits its collateral to any repo it finds. The gh shim answers the backfill's query from the file named by `PM_BEADS_E2E_PR_HISTORY`, because its payload has to quote bead ids bd mints at run time.

CI needs no configuration: the runner has a single checkout, so it derives one port and one scan root like any other.

## Pull Requests

Keep pull requests focused. Include:

- What changed
- How it was verified
- Any Beads behavior or CLI assumptions that changed

Generated route files may change when adding or removing routes. Keep those changes in the same pull request as the route change.

## Optional agent notifications

Settings can map agent handles and aliases to local tmux sessions. Typing `@` in comments offers these handles. While the server runs, its notifier checks every ten seconds for mentions, replies on an agent's beads, and direct messages. It wakes a configured tmux pane only when it recognizes an idle Codex or Claude Code prompt; missing or busy sessions are retried. Set `PM_BEADS_NOTIFIER_POLL=0` to disable this feature. This is separate from the ask Inbox and browser sync alerts.

The ignored `.beads/pm-beads.json` sidecar stores the configuration and delivery receipts. For example:

```json
{
  "version": 1,
  "personas": {
    "reviewer": { "tmux": "reviewer", "aliases": ["Code reviewer"] },
    "coordinator": { "tmux": "coord" }
  },
  "notifier": { "deliveredActivityIds": [] }
}
```

The identity from `PM_BEADS_USER` appears separately as **You**. A persona without a tmux session can still be mentioned. Use ordinary bead comments for durable findings; ephemeral messages and acknowledgments remain available to agent integrations but do not create Inbox rows.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No workspace / database not found | Set `PM_BEADS_PROJECT_DIR` to an existing Dolt-backed Beads repository, not the downloaded pm-beads source. |
| A workspace is missing from the picker | Set `PM_BEADS_SCAN_DIRS` to its parent directory; discovery scans two levels deep. |
| Comments use the wrong name | Set `PM_BEADS_USER` before starting the app; the first comma-separated entry is the write identity. |
| A deliberately managed Dolt server is stopped | Start it in that project's environment with `mise exec -- bd dolt start`, or `bd dolt start` without mise. |
| Sync fails | Inspect Settings; verify the remote and credentials in the project environment. Project environment changes may require restarting a previously started Dolt server. |
| No browser alerts | Check the per-workspace opt-in and site notification permission, and keep a pm-beads tab open. |
| A recent CLI write is not shown | Refresh the page. Agents can use `/api/check` immediately; it bypasses the issue snapshot cache. |

See [CONTRIBUTING](#agent-checks-and-remote-sync) for check responses and [SECURITY](SECURITY.md) for the local-only trust model.
