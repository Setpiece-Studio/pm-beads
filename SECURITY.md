# Security

## Supported Versions

pm-beads is pre-1.0. Security fixes are handled on `main` until release branches exist.

## Local-Only Trust Model

pm-beads is intended to run on your own machine against repositories you trust.

- There is no authentication or multi-user authorization.
- The server functions shell out to the local `bd` executable.
- The app can read and mutate the Beads database for the selected project.
- Read-only `/api/check` and `/api/sync` expose local diagnostics under the same unauthenticated trust model.
- Opt-in sync uses local Dolt credentials and project environment commands. Trust sidecar/mise configuration before opening a project. Conflict snapshots can contain complete issue text and remain in the ignored local `.beads` directory.
- Do not expose the dev server directly to the public internet.

By default, the app runs at `http://localhost:8345`. Treat anyone with access to that local server as having access to operate `bd` for the selected project.

## Reporting a Vulnerability

Please [report vulnerabilities privately on GitHub](https://github.com/Setpiece-Studio/pm-beads/security/advisories/new). Do not include exploit details in a public issue.

Include:

- Affected version or commit
- Reproduction steps
- Impact
- Any suggested fix

Please do not publish exploit details until there has been time to assess and patch the issue.
