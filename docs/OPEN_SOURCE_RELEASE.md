# Open-Source Release Checklist

Use this checklist before making the repository public or publishing a source release. For subsequent releases, follow the point-release workflow below; initial-publication steps do not require rebuilding public history.

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

### Point releases

1. Start a branch from current `main` in the public repository. If changes originate in a private checkout, transfer only the reviewed diff onto public history; never merge private ancestry or push private refs. Preserve sanitized fixtures and review new text, images, and commit author metadata.
2. Bump the patch version in `package.json`, keeping `"private": true`, and add the user-facing changes to `docs/RELEASE_NOTES.md`. Update usage documentation and the agent skill when behavior changes.
3. Install with `bun install --frozen-lockfile` in a clean public checkout and run all five verification gates above. Inspect failures before retrying; record unresolved follow-up work rather than weakening checks.
4. Push the branch and open a pull request against public `main`. Wait for all required GitHub checks, then merge through the protected-branch workflow. Do not bypass branch protection.
5. Fetch the merged commit and verify its tree matches the validated candidate. If merging changed the contents, validate the resulting changes before tagging. Create an annotated version tag on that exact merged commit and push only that tag; do not move an existing release tag.
6. Publish the GitHub source release from the pushed tag, using the release notes and identifying the supported tooling and local-only/no-auth model. Do not publish to npm.
7. Verify that the published release is not a draft or prerelease, that its tag resolves to the intended merged commit, and that the checkout is clean and up to date. Record the release URL and verification in the tracking issue, then close and sync it under the workspace's workflow.

For an authorized release, after substituting the new version and verified merged commit:

```bash
git tag -a v0.1.2 <merged-commit> -m 'pm-beads v0.1.2'
git push origin refs/tags/v0.1.2
gh release create v0.1.2 --repo Setpiece-Studio/pm-beads \
  --verify-tag --title 'v0.1.2' --notes-file /path/to/release-notes.md --latest
```
