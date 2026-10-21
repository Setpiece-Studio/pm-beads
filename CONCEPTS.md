# Concepts

Shared vocabulary for the application. See [CONTRIBUTING.md](CONTRIBUTING.md) for implementation conventions and API examples.

## Workspace

A local repository with a Beads database. The workspace picker selects which repository the application reads and edits. Settings, saved views, agent routes, and sync configuration belong to that workspace. A workspace can contain many epics, shown as projects in the interface.

## Epics

### Epic
A bead (issue) of the epic type: a container that groups related child issues and is followed by its overall completion rather than worked directly. Epics are what the Projects view organizes around.

An item's type routes it between views, so changing a bead to or from the epic type relocates it between the Projects view and the Issues view on the next load.

### Epic progress
An epic's completion rollup: how many children are closed versus the total, plus whether Beads reports it eligible for closure. Progress is separate from the epic's own status, which controls grouping and Board placement. An epic can have no children and still appear in Projects. Progress comes from `bd epic status`; epics absent from that result display zero counts rather than inferred historical progress.

## Projects view

### Hierarchy
The Projects view that nests epics under their immediate `parent-child` parent and can reveal their direct task children. Blocking dependencies do not create hierarchy edges. List, Board, and Hierarchy offer different presentations of the same projects.

Hierarchy rendering guards against cycles and keeps disconnected epics visible. Parent attachment is a relationship; it does not require changing a bead's ID.

### Board
Projects arranged in columns following the workspace's status pipeline. Dragging a project to a column updates its status. Progress and child counts remain independent display properties.

## Pull requests

### Linked PR
The pull request a bead's work landed in, recorded as flat issue metadata under the `pr_url` key: `bd update <id> --set-metadata pr_url=<github pr url>`. The value is a single URL, always the **latest** PR for that bead — re-linking overwrites it, and earlier PRs survive only in the bead's comments. Unlinking unsets the key rather than blanking it, so `bd list --has-metadata-key pr_url` is an exact census of beads that have one.

The convention is deliberately one-directional: the bead points at the PR. The PR points back with a `Closes <id>` line in its body, which is prose for reviewers rather than data.

### PR state
How a linked PR currently stands on GitHub — Open, Draft, Merged, or Closed — read live from `gh pr view`, never stored on the bead. A read that cannot be completed (no `gh`, not authenticated, offline, a URL GitHub does not recognize) resolves to *Unknown* rather than failing: the link is the durable fact, the state is a decoration on it.

### Merged-PR sweep
The pass that closes beads their pull request already finished: read every bead carrying a `pr_url`, ask GitHub which of those PRs merged in the window, then comment and close. It runs on a 5-minute server timer and on demand from the issues toolbar, and has a dry-run mode that produces the same plan without writing.

Only beads whose status is `open` or `in_progress` are eligible. Among those, an epic or a bead with an open ask receives a comment and keeps its status. Malformed ask metadata also prevents automatic closure. Every write is stamped `--actor pm-beads`, so the audit trail distinguishes the sweep from a person closing a bead by hand.

Failure is partial, never fatal: a repo GitHub would not answer for becomes a warning and the rest of the sweep proceeds.

### Sweep window
The span of merge history one sweep asks GitHub about: from the project's last *successful* sweep minus a one-day safety margin, up to now — or the last 30 days when there is no previous run. The margin exists because a PR merged moments before the previous sweep read its repo would otherwise fall through the gap between two runs.

What makes a run "successful" is that it produced **no warnings at all**. Anything less leaves the stored timestamp where it was, so the next sweep looks at the same span again rather than stepping over what it could not see. The stored timestamp lives in the project's `.beads/pm-beads.json` sidecar under `sweep.lastRunAt`.

### PR-history backfill
The pass that runs the sweep's logic backwards, for the beads that predate it: instead of asking GitHub about the PRs beads already point at, it reads the repo's merged pull requests and finds the bead ids *in them*. Its output is a **review list** of proposals — link this bead to that PR, and close it or merely comment — and it applies nothing a person has not checked.

Re-runnable rather than one-shot: a scan writes nothing at all, so running it again is free and always current. What makes it safe to repeat is that it drops what it has nothing to say about — a closed bead, a bead already pointing at that very PR, or one a person dismissed.

Every write it does make goes through the merged-PR sweep's own apply path, so a backfilled close is stamped `--actor pm-beads` and reads like a swept one; its comment adds *backfilled from PR history* and the confidence tier that produced it.

### Match confidence
How strongly a merged pull request claims a bead, and the only thing that decides what the review list pre-checks. `high` means the PR body said `Closes`/`Fixes`/`Resolves <id>` — the convention this repo asks for, and the tier the panel checks by default. `medium` means the id was in the title or the branch name: a strong habit, not a promise. `low` means a bare mention in the body, which is as often "see also" as it is "this closed it".

The tier is a property of *where* the id was found, not of the bead — the same bead named two ways in one PR takes the strongest tier, and the same bead claimed by two PRs keeps the strongest, then most recent, claim.

### Bead-id prefix
The leading string shared by bead IDs in a workspace, such as `demo-`. Read from the workspace's live IDs (the most common answer wins) rather than from configuration. It makes ID extraction from PR prose possible: without it, `10` in a PR body is a number.

## Naming

### Bead reference
Any place the interface points at a bead it is not itself displaying: a chip in prose, a rail row, a dependency row, a breadcrumb crumb, a card. Every one of them **reads as the bead's title**. The id is secondary — hover text (the `title` attribute, which is also where a truncated title becomes readable in full), plus a small muted suffix after the title where the row is wide enough to carry both. A bead whose title the caller does not hold falls back to the id, set in mono, because an identifier is then the only name there is.

For example, `demo-123` identifies a bead, while "Design pass: wider rails" describes its work. The ID stays reachable everywhere and remains an optional column in the Issues table.

`beadRefTitle(id, title)` composes the hover text (`Title · id`) and `BeadId` renders the muted suffix; both live in `src/lib/issue-meta.tsx`.

## Markdown

### Bead chip
A bead reference inside rendered markdown, drawn as a small pill: the bead's title, its status glyph, its id on hover, and a link to the bead. What a person writes as prose — a bare id, `[[id]]`, or a pasted pm-beads URL — is what the reader gets as navigation, so a description that mentions another bead is a way through to it rather than a string to copy — and it reads as a sentence, because the chip carries the bead's name and not its id.

Three things define it. It is derived, never stored: the chip is a rendering of the text, and the bead's own record has no idea it was mentioned. It is **project-scoped** — the ids it recognizes are the ones carrying this project's [Bead-id prefix](#bead-id-prefix), so `10` stays a number and another project's ids stay words. And it is *decorated* only as far as the loaded issue set allows: a bead the route did not load still links, and falls back to its id as the label, because a link that might 404 is more useful than no link.

IDs inside code spans and fenced blocks stay literal, so `bd show demo-123` remains a command that can be copied.

Where a chip is clicked is the host's call: a host may intercept the click (`onOpenBead`) instead of letting it navigate. None does today — every chip navigates to the bead.

### Source editing
The rule pm-beads follows when a person edits bead prose: what they type is what `bd` stores, character for character. The editor is a textarea over the markdown itself, not a rich-text surface that parses the field into a document and writes it back out.

The reason is who else writes these fields. Bead prose is mostly agent-authored, and a WYSIWYG editor re-serializes the **whole** field on save — so fixing one typo rewrites bullet markers, emphasis delimiters and escaping across the entire description, and lands in Dolt history as a full-field diff no one asked for. It also has to know every construct in the field: an editor that throws on the one it has no plugin for is a worse failure, on text an agent chose, than simply showing the source.

So the trade is deliberate. No live formatting while typing — a *Write* / *Preview* toggle instead, where the preview is the same renderer the read-only body uses, [bead chips](#bead-chip) and all. Trailing spaces survive, because in markdown they are a line break. An empty description is a value, not an absence: it clears the field.

### Edit baseline
The text an editor **opened on** — the version of a field its reader demonstrably read before typing over it. Every save of a whole-field text edit (title, description, design, acceptance criteria, notes) carries one, and lands only while `bd` still holds exactly that text.

It is deliberately not the rail's current copy of the field. A concurrent write can move that copy underneath an open editor without the reader ever seeing the new text, and a save measured against text nobody read is the very thing the baseline exists to catch.

### Save conflict
What a save becomes when the baseline no longer matches what `bd` holds: somebody — nearly always an agent working the same bead — rewrote the field while the editor was open. Nothing is written.

A conflict is a refusal that can say what it refused. The editor keeps the draft, shows the text now stored, and offers one deliberate *Overwrite with my version* that re-sends the same draft against the text the reader was just shown. Walking away resolves nothing and writes nothing; `Esc` discards the draft and leaves the other author's text standing.

Not a lock, and not a merge. The guard is a compare-and-set around one `bd update`, so two writes racing inside the gap between its read and its write still resolve last-write-wins — it converts the minutes an editor sits open back into the milliseconds between two adjacent bd calls.

## Asks and inbox

### Structured ask
A typed action, decision, check, or review attached directly to a bead. Each ask occupies one flat metadata entry named `ask.<key>`. The reader accepts a JSON object or a JSON string matching the canonical schema in `src/lib/beads/asks.ts`; app writes store a JSON string. The whole value is replaced when an answer changes, so answer text and attribution stay together.

Every ask records `kind`, its prompt in `q`, creator identity in `by`, and creation time in `at`. Optional presentation fields are `note`, `steps`, and `options`; defaults use `default` and `default_at`. A closed ask carries `answer`, `answered_by`, and `answered_at` together. Completed actions additionally carry `done: true` and the canonical answer `done`.

For example:

```json
{"kind":"decision","q":"Choose storage","by":"agent","at":"2026-09-10T20:00:00.000Z","answer":"one JSON string","answered_by":"maintainer","answered_at":"2026-09-10T21:00:00.000Z"}
```

When answering or reopening an ask through pm-beads, the app updates its value and bead status in one `bd update`: remaining open asks make the bead `blocked`, and answering the last ask moves a blocked bead to `open`. Agents creating asks directly through the CLI must also set the appropriate status; a metadata write alone does not invoke app behavior. Malformed asks remain visible as needing repair and prevent automatic unblocking. They cannot be answered until repaired.

### Inbox row

One unfinished bead with one or more open asks, including malformed ask metadata that needs repair. Reading a row does not dismiss it. Answering the final open ask removes it from the queue; closed beads are excluded. The sidebar badge counts beads, not individual questions.

Rows can be ordered newest or oldest by their latest open ask's creation time, falling back to the bead's update time when only malformed asks remain. Messages, mentions, read state, and labels do not create inbox rows. Ask defaults are metadata, not a promise that the app will answer automatically at a deadline.

## Agent messaging

### Message
A bead of the `message` type carrying one note between a person and an agent, or between agents: subject in the title, body in the description, recipient in the assignee, sender in `created_by`. Beads creates these as ephemeral wisps. The durable record belongs in the related work bead. Ordinary issue reads exclude these infrastructure beads. Message delivery supports agent notifications independently of the ask-only inbox.

Read and unread are not separate fields: an unread message is open, and reading one closes it.

### Thread
A message and the chain of replies beneath it, oldest first. bd stores no thread object — only a per-reply edge back to the message it answers — so a thread is reconstructed by walking each message to the head of its chain and grouping. A reply whose parent is missing heads its own thread rather than disappearing.

### Linked issue

The work bead a message is about, carried as a `relates-to` dependency. Replies inherit the linked issue. These links support activity and notification delivery; they do not add rows to the inbox.

## Status pipeline

A workspace's ordered status vocabulary. Beads supplies built-in statuses, configured custom statuses, and statuses observed on its beads. The workspace's `.beads/pm-beads.json` controls presentation order and glyphs. Selectors, filters, grouped lists, Boards, and detail headers use that shared pipeline.

Unknown statuses stay visible and are placed before `closed`; unknown icons fall back to a neutral glyph. Boards follow workflow order, while grouped lists use triage order by default. An explicitly configured pipeline governs both.

## Remote sync

An opt-in, per-workspace pull/push cycle that runs while the app server is running. Settings shows its last attempt, last success, errors, and conflicts. It uses local credentials and the workspace's environment configuration.

### Sync conflict

A database row with competing changes. Settings shows base, ours, and theirs for explicit resolution. Identical sides may resolve automatically; other changes require a choice. A stale resolution is rejected, and accepted resolutions are pushed through the normal sync cycle. Browser alerts are separately enabled per workspace and require an open pm-beads tab.

### Agent check

A read-only inspection through `GET /api/check`. It reads fresh local data, including closed beads, validates ask metadata, and reports unresolved database conflicts. It does not sync or repair data. A successful HTTP request can still report diagnostics; agents must inspect `ok` and completeness. An unavailable check is never a clean result. See [CONTRIBUTING.md](CONTRIBUTING.md) for parameters and response codes.
