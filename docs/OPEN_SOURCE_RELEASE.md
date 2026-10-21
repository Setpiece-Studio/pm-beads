# Open-Source Release Checklist

Use this checklist before making the repository public or cutting the first release.

## Release source

The public destination is `Setpiece-Studio/pm-beads`. The initial release uses an audited tree with one fresh root commit and no private Git history or Beads database. The existing private repository is preserved. After publication, release from the public repository's reviewed history; do not rewrite public refs.

Review the release diff, documentation links, screenshots, and agent skill. Pattern scanning is not a substitute for reviewing new files or visible image contents. Test a clean checkout with Node 24, Bun 1.3.14, bd 1.2.2, and Dolt 2.5.0. Select an external Beads project when running the app; no private database ships in the source tree.

Preparation does not create a public GitHub repository, change visibility, publish a release, or publish an npm package. These remain separate actions.

## Repository Readiness

- Confirm `LICENSE`, `README.md`, `CONTRIBUTING.md`, and `SECURITY.md` are current.
- Confirm `package.json` metadata points at the intended GitHub repository.
- Confirm the repository intentionally remains `"private": true` for npm until a package distribution is designed.
- Confirm no tracked file contains private local paths, credentials, customer data, or internal-only operating notes.
- Confirm `.beads/backup/`, `.beads/interactions.jsonl`, `.beads/embeddeddolt/`, `.beads/dolt/`, `.beads/dolt-server.*`, `.beads/dolt-backup*.json`, `.beads/pm-beads.json`, `mise.local.toml`, `.claude/worktrees/`, `.output/`, and `test-results/` remain ignored.

## Identity and History

- Confirm all repository URLs point at `Setpiece-Studio/pm-beads`.
- Decide the license copyright holder. The current license uses `pm-beads contributors` so the public source does not name a personal owner.
- Review Git authors before making the repository public:

  ```bash
  git log --all --format='%an <%ae>' | sort -u
  ```

- If the repository should not publish personal author metadata, create a fresh public history or rewrite author metadata before the first public push. Do not rewrite public refs after outside contributors may have cloned the repository.
- If preserving the existing branch lineage matters less than privacy, prefer a fresh public repository initialized from the audited tree so old commit messages, branch names, and author emails never become public.

## Dependency Notes

`THIRD_PARTY_NOTICES.md` inventories the installed dependency manifests; retain each dependency's own license and copyright text when redistributing bundles. Licenses to keep visible before a public release:

- `caniuse-lite`: CC-BY-4.0
- `lightningcss` and `lightningcss-darwin-arm64`: MPL-2.0

The frozen Bun lockfile is required for reproducible installs. Nitro's nightly alias is pinned to the verified version instead of `latest`.

## Verification

Run:

```bash
bun run typecheck
bun run test
bun run lint
bun run build
bun run test:e2e
```

From a throwaway project directory, test skill discovery and installation:

```bash
npx skills add /absolute/path/to/release-checkout --list
npx skills add /absolute/path/to/release-checkout --skill pm-beads -a codex -y
```

Confirm that the installed skill includes `references/asks.md` and `references/writing-beads.md`. Also verify installation using `Setpiece-Studio/pm-beads` as the source.

## GitHub Settings

- Set repository description: `Local Linear-style web UI for the Beads issue tracker`.
- Add topics: `beads`, `issue-tracker`, `local-first`, `tanstack-start`, `bun`.
- Enable GitHub Issues for public reports; maintainers can track their own implementation work in Beads.
- Enable Dependabot or another dependency update path if accepting outside users.
- Enable private vulnerability reporting if available.
- Add branch protection once CI exists.

## Release

- Tag the first public source release after the checklist passes.
- Include the supported Node, Bun, and `bd` expectations in release notes.
- Call out the local-only/no-auth security model prominently.
