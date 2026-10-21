// ABOUTME: Server-side half of the pr_url convention — resolves a bare "#N"/"N" against the
// ABOUTME: project's `git remote get-url origin`. Split from pr-link.ts, which the rail imports.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parsePrUrl, prRefUrl, resolvePrRefWith } from './pr-link'

const execFileAsync = promisify(execFile)

/** Wall-clock cap on the git read. It runs off the bd mutex, so a hung git only stalls the
 * one link attempt — but it must still end. */
const GIT_TIMEOUT_MS = 10_000

/** Resolve what the rail's input took — a url, "#N", or "N" — to the canonical url stored in
 * pr_url. Reads the project's origin remote ONLY for a bare number: a full url already names
 * its repo, so linking a PR from another repo needs no git at all. Throws (with a message meant
 * for the rail's error line) when the input can't be resolved. */
export async function resolvePrRef(
  input: string,
  projectDir: string,
): Promise<string> {
  const trimmed = input.trim()
  const fromUrl = parsePrUrl(trimmed)
  if (fromUrl) return prRefUrl(fromUrl)
  return prRefUrl(resolvePrRefWith(trimmed, await readOriginRemote(projectDir)))
}

/** The project's origin remote url, or null when the dir is not a git repo or has no origin.
 * Exported for the PR-history backfill, which asks the same question to find the repo to scan. */
export async function readOriginRemote(
  projectDir: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['remote', 'get-url', 'origin'],
      { cwd: projectDir, timeout: GIT_TIMEOUT_MS },
    )
    const trimmed = stdout.trim()
    return trimmed === '' ? null : trimmed
  } catch {
    return null
  }
}
