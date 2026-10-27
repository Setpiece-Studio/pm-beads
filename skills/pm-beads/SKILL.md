---
name: pm-beads
description: Write clear, current Beads descriptions for humans reading pm-beads. Use when drafting or refining epics and issues, organizing their relationships, or requesting human review through structured asks.
---

# Write work for humans in pm-beads

pm-beads is the human-facing view of a Beads workspace. Agents work through `bd`; use the basic `beads` skill supplied by Beads setup and `bd prime` for CLI usage and the project's workflow. This skill adds guidance for the work a human reads and reviews. Agents mainly use pm-beads to check their writes and observe synchronization with a remote, rather than operate the UI.

## Write for the next person

**The bead description is always the current description of the work.** A reader should understand what is intended now without reconstructing a conversation or comparing versions. When scope or a decision changes, rewrite the affected description in place. Remove superseded requirements and resolved questions; retain prior context only when it is necessary to understand the current choice.

Beads data is versioned in Dolt. Let that history carry earlier versions; do not append dated updates, revision summaries, or “we originally planned X, but now Y” commentary to the description. Comments are for substantive decisions, questions, evidence, and conversations—not a second changelog. When a discussion changes the work, incorporate its conclusion into the description.

Match the detail to the work:

- **Small task:** a few sentences describing what, where, and how to tell it is done.
- **Feature or bug:** the behavior to deliver or reproduce, relevant context, scope, and observable completion criteria.
- **Epic:** a coherent outcome, who benefits, why it matters, testable requirements, explicit exclusions, real dependencies, and how the whole outcome will be verified. Describe what and why before prescribing implementation. Call out resource changes and human steps when they are part of the work.

Read [epic and issue examples](references/writing-beads.md) when drafting a spec or deciding how much detail it needs. An epic should be clear enough for a human to judge its scope and for agents to derive bounded child work. Do not turn it into a transcript, an exhaustive implementation plan, or a manually maintained table of child beads.

Use Markdown, code spans for paths and commands, and **bare bead IDs in prose** so pm-beads renders links. Identify agent-authored comments and creates with `--actor <agent-handle>`.

## Keep the structure readable

- An epic is an outcome that can finish; a feature is a shippable slice; a task is a concrete unit. Split sprawling epics and separately track trailing cleanup that can ship later.
- Prefer shallow containment and one parent per bead. Labels group cross-cutting releases and topics; the assignee field records ownership. Follow the project's conventions when they differ.
- A blocking edge means work genuinely cannot proceed: `bd dep add A B` means A depends on B. Use priority for importance and an epic's numeric `gantt_order` metadata for planned Gantt sequencing; never add blockers just to arrange bars. Containment and blocking are separate; pm-beads Hierarchy uses only containment.
- To preserve a flat ID, create first, then attach with `bd update <child> --parent <epic>`. Existing dotted IDs work too; do not recreate issues just to change their ID shape.
- Rehome children before retiring an epic. Keep a pointer to the replacement and close the old epic so existing references remain useful.

### Maintain the Gantt roadmap

The epic's **Assignee** controls its lane; Beads' separate `owner` account field and child assignees do not. Set a planned position with `bd update <epic-id> --assignee <handle> --set-metadata gantt_order=100`. Lower ranks come first within each lane; use spaced values such as 100, 200, and 300. Unranked projects follow in priority, title, then ID order.

Attach work through parent-child relationships. Bar width counts leaf work, including closed work; closing a leaf increases completion without shrinking the bar. Epic containers do not count as work units. This is a read-only work-unit roadmap, not a calendar or a readiness calculation. Real blocking edges appear as arrows; inspect sequence warnings in **Projects → Display**.

### Respect the workspace's statuses

Inspect `bd config get status.custom` before assigning a custom status. Beads owns the valid names and their behavior; pm-beads reads those names and separately controls display order and icons through `statuses.pipeline` and `statuses.icons` in `.beads/pm-beads.json`. Do not invent a new status merely to describe progress in prose, or assume changing display order changes readiness. See the [Beads custom-status documentation](https://github.com/gastownhall/beads/blob/main/docs/reference/configuration.md#custom-statuses-and-types). This version of pm-beads expects plain custom names and uses `closed` for completion; it does not interpret category annotations in the display configuration reader.

## Pick up and finish work

```bash
bd ready
bd show <id> --json
bd comments <id>
bd update <id> --claim --actor <agent-handle>
```

Claim work you will do. Read the current description and relevant discussion, and keep the description current as you learn. Before closing, verify its completion criteria and record the result and evidence in the appropriate verification field or close reason. Use a comment when a finding or decision needs explanation, not to narrate routine status changes. Track remaining work separately and follow the repository's quality gates and session protocol.

## Ask a human

Make the current description ready to review before requesting a decision. Put the specific question in structured `ask.<key>` metadata on that bead. **Comments, @mentions, messages, and the old `human` label do not create current pm-beads Inbox entries.** The [ask reference](references/asks.md) includes decision and spec-review examples, schema, status rules, and validation commands.

After creating or changing an ask, use the running app's read-only **`GET /api/check`** endpoint to validate it immediately against fresh local data:

```bash
curl --fail-with-body --get 'http://localhost:8345/api/check' \
  --data-urlencode "project=$PWD" --data-urlencode 'issueId=<id>'
```

Replace `<id>` with the bead you changed. Inspect the response body: HTTP 200 can contain validation failures. A clean check has `ok: true` and `issues: []`; ask diagnostics identify the key and invalid field. HTTP 503 or a connection failure means validation was unavailable. The check also reports unresolved Dolt conflicts, but does not sync, repair, answer, or approve the ask.

When a project requires spec approval, request review of the goal, scope, and completion criteria before dependent implementation starts. Keep unresolved choices visible. After the human responds, update the description to reflect the decision. A material scope change warrants renewed review of that change, not a new running history in the description. Spec-review asks have no automatic default; silence is not an answer.

## Link pull requests

When a PR completes a bead, set its latest PR link and include `Closes <id>` in the PR body:

```bash
bd update <id> --set-metadata pr_url=https://github.com/owner/repo/pull/123
```

Use `Closes` only for work the PR completes. `pr_url` is the current link; previous values belong to version history. A comment is useful if a superseding PR changes a decision or needs explanation. Unlink with `--unset-metadata pr_url`. The optional merged-PR sweep leaves epics and beads with open asks for explicit completion.

## Confirm writes and remote sync

Use `bd show <id> --json` to confirm the fields you wrote. When pm-beads is running, validate fresh ask metadata and conflicts without waiting for its issue snapshot cache:

```bash
curl --fail-with-body --get 'http://localhost:8345/api/check' \
  --data-urlencode "project=$PWD" --data-urlencode 'issueId=<id>'
```

Use the configured local URL if different. Inspect the JSON: HTTP 200 can contain problems. A clean result has `ok: true` and `issues: []`; 503 or an unreachable server means the check was unavailable. Omit `issueId` to include the whole workspace, including closed beads. This checks asks and conflicts, not all written fields or whether the work itself is correct.

If app-managed remote sync is enabled for the workspace, pm-beads runs the configured pull/push cycle while its server is running. Agents can inspect its read-only status:

```bash
curl --fail-with-body --get 'http://localhost:8345/api/sync' \
  --data-urlencode "project=$PWD"
```

Check the last success, errors, and unresolved conflicts before reporting that work has synced. A successful local write or `/api/check` response does not establish that it reached the remote. `/api/check` and `/api/sync` only inspect; they do not start a cycle or repair data.
