# Writing epics and issues

A description is a current specification. Earlier versions belong to Beads/Dolt history; substantive discussion and decision rationale belong in comments. Incorporate agreed conclusions into the description so nobody has to read the whole thread to understand the work.

## How much detail an epic needs

A human should be able to judge the outcome, its boundaries, and what completion means from the description. An agent should be able to derive child tasks without inventing product requirements. Explain the observable behavior; leave implementation choices open unless a real constraint settles them.

| Part | What a reader needs |
| --- | --- |
| Goal | Who benefits and what they can do or stop doing. |
| Problem | What fails or costs time today, with relevant evidence. |
| Requirements | A short set of testable behaviors. Number them when children or verification need to refer back to them. |
| Out of scope | The plausible adjacent work this epic deliberately excludes. |
| Dependencies | Real prerequisites represented as blocking edges; distinguish them from preferred sequencing. |
| Resource changes | Data, services, permissions, or other resources created, changed, or removed; say none when that matters to review. |
| Human steps / open decisions | What the human needs to decide or do. Where possible, group their steps before implementation or after verification instead of repeatedly interrupting the work. |
| Done when | Observable evidence covering every requirement, including failure behavior. |

Use the sections the work needs and the project's required template. A short epic can combine sections. Detail should resolve ambiguity, not fill a form. Link supporting research rather than copying it into the spec. Keep child lists in the graph, not in a second table in the description.

## Example: product epic

**Title:** Export the filtered issue list as CSV

```markdown
## Goal
Project leads can share the issue list they are looking at without rebuilding it in a spreadsheet.

## Problem
The list can be filtered in the app, but sharing its contents currently requires copying rows by hand.

## Requirements
- R1: Export includes every issue matching the current filters, in the selected order, with one row per issue.
- R2: Columns are ID, title, status, priority, assignee, and parent ID; unassigned values remain empty.
- R3: Commas, quotes, newlines, and Unicode round-trip through a CSV reader without changing cell contents.
- R4: An empty result produces a header-only file. A failed read shows an error and does not download a partial file.

## Out of scope
Spreadsheet formatting, attachments, scheduled exports, and importing edits.

## Resource changes
None. The export uses the selected local workspace and creates a downloaded file.

## Dependencies
The existing filtered-list query supplies the rows; no new prerequisite work is needed.

## Done when
- R1–R2: Compare an export with the same filtered list, including more rows than fit on screen.
- R3: Parse a fixture containing commas, quotes, newlines, and Unicode and compare every value.
- R4: Verify empty-result and failed-read behavior.
```

This is ready for scope review without dictating a CSV library or dividing the implementation into a predetermined number of children. Child beads can refer to R1–R4 instead of copying the whole epic.

## Example: operational epic

**Title:** Enable shared Beads sync for the team workspace

```markdown
## Goal
Team members see each other's Beads updates through the configured remote instead of exchanging manual exports.

## Problem
The workspace is currently local to one machine. We need to prove that two clients exchange updates and expose conflicts before relying on sync.

## Requirements
- R1: Two test clients can push and pull independent issue updates without losing either change.
- R2: Conflicting edits remain available for explicit review rather than silently choosing a side.
- R3: The maintainer can see the last successful sync and any current failure.

## Resource changes
One remote Beads database and credentials for the two clients. No application database changes.

## Human steps
Before shared-workspace activation: choose the remote destination and grant client access. Test the workflow using disposable databases first.

## Dependencies
demo-210 provisions the destination and access; record it as a blocking edge for activation.

## Out of scope
Changing application deployment, migrating other workspaces, or disabling another machine's timer.

## Done when
- R1: Read back both clients' updates from the remote.
- R2: Reproduce a conflict on disposable data, inspect both values, resolve it, and read back the result.
- R3: Verify success and failure status in the client; document how to restore the previous sync setup.
```

The human-facing spec names the resource change and activation decision. It does not need an agent-role roster or a transcript of how the destination was chosen.

## Example: child feature

**Title:** Serialize filtered issue rows as CSV

```markdown
## What
Implement the CSV output for demo-200 requirements R2–R3. Preserve the supplied row order and use the column order defined in the epic. Return the serialized text without starting a download.

## Done when
- A CSV reader reconstructs every field from fixtures with empty values, commas, quotes, newlines, and Unicode.
- The output column order matches R2 and no issue fields outside that list are included.
```

Set its parent relationship to demo-200. The child describes its deliverable and verification without restating the epic's motivation or claiming that serialization alone completes the whole export feature.

## Example: small bug

**Title:** Keep the issue draft when saving fails

```markdown
When an issue save fails, the composer currently clears the entered title and description. Keep both fields intact and show the error so the person can retry. Verify with a failed save followed by a successful retry; the saved content must match the original draft.
```

No extra headings are needed for a one-step fix whose behavior and completion check fit in three sentences.

## Updating a description after a decision

If the human selects CSV rather than a spreadsheet format, change the title, requirements, and exclusions to describe CSV. Remove the resolved format question. Do not append “Update: we switched from XLSX to CSV” or retain both competing specs. The earlier value is in version history. A substantive comment such as “CSV is sufficient because the receiving system imports plain rows” preserves rationale when it helps future decisions; a comment listing the fields you just edited does not.

If the project calls for spec approval, write the reviewable description first, then use the [spec-review ask example](asks.md#request-spec-review). Approval concerns the current scope. Revisit a material change with the human and update the spec to the resulting decision.
