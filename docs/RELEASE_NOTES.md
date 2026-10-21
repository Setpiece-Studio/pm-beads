# v0.1.0 — First public source release

pm-beads gives people and coding agents a shared local interface to Beads workspaces.

- Issues and projects with List, Board, and containment Hierarchy views, filters, and saved views.
- A workspace composer and inline editing for task details, ownership, dependencies, and PR links.
- An Inbox for structured agent asks, plus a portable `pm-beads` agent skill.
- Opt-in five-minute Dolt remote sync with explicit conflict review and browser alerts.
- Fresh, read-only `/api/check` diagnostics for ask metadata and unresolved conflicts.
- Optional GitHub PR state, merged-PR sweeps, and historical link backfill.

## Install

Clone the source and follow the [README](../README.md#quick-start). Tested tools: Node 24, Bun 1.3.14, bd 1.2.2, and Dolt 2.5.0. The source includes no Beads database; select your own workspace and set your user identity.

Install the agent skill from your work project:

```bash
npx skills add Setpiece-Studio/pm-beads --skill pm-beads
```

## Limits

- Local-only, with no authentication. Do not expose the server to the public internet.
- Source distribution only; no npm application package.
- Browser sync alerts require permission and an open pm-beads tab.
- Only identical conflict sides resolve automatically; other conflicts require review.
- Custom statuses use plain names; category annotations such as `in_review:wip` are not yet interpreted by pm-beads. Completion and Inbox filtering use `closed`.
- `/api/check` checks ask metadata and conflicts, not general task correctness or workflow quality.

See [SECURITY](../SECURITY.md) and the [usage guide](USAGE.md).
