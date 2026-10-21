# Structured asks

An ask is a flat bead metadata entry `ask.<key>` containing a JSON object (bd may return it as a JSON string). The key suffix contains letters, numbers, underscores, or dot-separated segments; no hyphens, spaces, or empty segments. Use a stable key for one question and a new key for a new question. Read the existing metadata before replacing it.

## Fields

Required: `kind` (`action`, `decision`, `check`, or `review`), nonempty `q`, nonempty `by`, and ISO-8601 `at` with a timezone.

Optional: `options` (nonempty array of nonempty strings), `default`, `default_at` (timestamp), `note`, and `steps` (array of nonempty strings). Text fields must be nonempty when supplied. Unknown fields are rejected. Defaults describe a proposed course of action; pm-beads does not execute them automatically.

Answered asks contain **all three** of `answer`, `answered_by`, and `answered_at`, or none. `done` is allowed only for an action. A completed action has `answer: "done"`, `done: true`, and full answer attribution. Do not invent a human's answer.

## Create

Run from the intended workspace. Replace the example ID, author, question, and timestamp with real values. The CLI does not automatically couple metadata to status, so set both together:

```bash
bd update demo-123 --actor coordinator --status blocked \
  --set-metadata 'ask.storage={"kind":"decision","q":"Use SQLite or Postgres?","options":["SQLite","Postgres"],"by":"coordinator","at":"2026-10-21T17:00:00Z"}'
```

The Inbox shows unfinished beads with unanswered or malformed asks, one row per bead. Closed beads are excluded from the Inbox, but still checked by `/api/check`. A malformed ask remains visible for repair; removing it just to clear the badge loses the question.

## Request spec review

Write the epic's current goal, scope, requirements, and completion criteria in its description first. Then ask the human to review that spec rather than embedding a second copy in the question:

```bash
bd update demo-200 --actor coordinator --status blocked \
  --set-metadata 'ask.spec={"kind":"review","q":"Approve the CSV export scope and completion criteria in this epic, or identify what needs to change?","by":"coordinator","at":"2026-10-21T17:00:00Z"}'
```

Use the actual bead ID and current timestamp. A spec review has no default or timeout-based approval. Incorporate the human's substantive decisions into the description; comments can hold the discussion and rationale. Request renewed review if a material change alters the agreed scope. This is a pattern for projects that use spec approval, not a required role hierarchy for every workspace.

## Answer or reopen

Prefer the Actions controls in pm-beads when the human is answering. For an authorized CLI answer, read the latest complete value, preserve its original question and creation fields, and replace the whole value with the answer and attribution added. Avoid overwriting someone else's intervening answer. Reopening removes `answer`, `answered_by`, `answered_at`, and `done` together and sets `blocked`.

The app moves a blocked bead to open when its last open ask is answered and no malformed asks remain. If working through the CLI, inspect **all** asks and other blockers before changing status; do not mark a bead complete merely because an ask was answered.

## Validate immediately

```bash
# One bead, read fresh after a CLI write.
curl --fail-with-body --get 'http://localhost:8345/api/check' \
  --data-urlencode "project=$PWD" --data-urlencode 'issueId=demo-123'

# Whole project, including closed beads.
curl --fail-with-body --get 'http://localhost:8345/api/check' \
  --data-urlencode "project=$PWD"
```

Version 1 responses include `ok`, `checkedAt`, `issues`, check completeness, and conflict freshness. Inspect the body even on HTTP 200:

| Result | Meaning |
| --- | --- |
| 200, `ok: true`, `issues: []` | Completed and clean for these checks |
| 200 with diagnostics | Completed; fix or report the findings |
| 400 | Invalid parameters |
| 404 | Explicitly requested bead does not exist |
| 503 or connection failure | Incomplete/unavailable; never claim clean |

`ASK_KEY_INVALID`, `ASK_JSON_INVALID`, and `ASK_SCHEMA_INVALID` identify the bead, metadata key, invalid field, and explanation. `DOLT_CONFLICT` reports live conflicts or persisted pending sync conflicts; inspect freshness and completeness to distinguish the two. `CHECK_UNAVAILABLE` identifies a check that could not finish. Do not initiate sync or choose conflict sides without authorization.
