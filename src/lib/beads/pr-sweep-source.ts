// ABOUTME: The sweep's merged-PR source — one `gh pr list --state merged` per repo, run under
// ABOUTME: the project's env, OUTSIDE the bd mutex, failing soft per repo with a warning.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import {
  type MergedPr,
  mergedSearchDate,
  type SweepRepoQuery,
} from './pr-sweep'
import { resolveProjectEnv } from './project-env'

const execFileAsync = promisify(execFile)

/** Wall-clock cap on one gh call. Longer than the rail's `gh pr view` (10s) because a repo
 * with a busy merge history is a heavier query, short enough that a wedged gh cannot stall
 * an interval poll into the next one. */
const GH_TIMEOUT_MS = 15_000

/** Upper bound on merged PRs read per repo. The window is days wide, not months, so 200 is
 * far past what a real repo merges in it — and a repo that DOES exceed it simply carries the
 * rest into the next sweep, since lastRunAt only advances on a clean run. */
const GH_PR_LIMIT = 200

/** gh's own field names for one merged PR. Every field is validated because the plan keys on
 * the url and quotes the number; a malformed row must be dropped, not rendered. */
const mergedPrSchema = z.object({
  number: z.number().int(),
  url: z.string().min(1),
  mergedAt: z.string().min(1),
})

/** Injected gh runner, so the argv and the soft-failure paths are testable without GitHub. */
export type GhPrListReader = (args: string[], cwd: string) => Promise<string>

export interface MergedPrsResult {
  merged: MergedPr[]
  /** One line per repo that could not be read. The sweep still applies what it did learn. */
  warnings: string[]
}

/** The exact `gh` argv for one repo's merged PRs since a date. Exported so the command in
 * CONTRIBUTING is checked by a test rather than by eye. */
export function ghPrListArgs(repo: string, sinceDate: string): string[] {
  return [
    'pr',
    'list',
    '--repo',
    repo,
    '--state',
    'merged',
    '--json',
    'number,url,mergedAt',
    '--search',
    `merged:>=${sinceDate}`,
    '--limit',
    String(GH_PR_LIMIT),
  ]
}

/**
 * Every PR merged in the window across the repos the candidate beads point at.
 *
 * Sequential on purpose: repos come in ones and twos, and a serial walk keeps warnings in a
 * stable order. A repo that fails — gh missing, unauthenticated, offline, a repo the token
 * cannot see — contributes a warning and nothing else; the sweep is still worth running for
 * the repos that answered.
 */
export async function readMergedPrs(
  repos: readonly SweepRepoQuery[],
  since: Date,
  cwd: string,
  reader: GhPrListReader = runGhPrList,
): Promise<MergedPrsResult> {
  const sinceDate = mergedSearchDate(since)
  const merged: MergedPr[] = []
  const warnings: string[] = []

  for (const { repo } of repos) {
    let stdout: string
    try {
      stdout = await reader(ghPrListArgs(repo, sinceDate), cwd)
    } catch (error) {
      warnings.push(`${repo}: gh pr list failed — ${message(error)}`)
      continue
    }
    let raw: unknown
    try {
      raw = JSON.parse(stdout)
    } catch {
      warnings.push(`${repo}: gh pr list did not return JSON`)
      continue
    }
    const parsed = z.array(z.unknown()).safeParse(raw)
    if (!parsed.success) {
      warnings.push(
        `${repo}: gh pr list did not return a list of pull requests`,
      )
      continue
    }
    // Per-entry parse: one row gh shaped unexpectedly (a null mergedAt on a PR closed by a
    // merge commit it no longer owns) drops that row, not the whole repo.
    for (const entry of parsed.data) {
      const pr = mergedPrSchema.safeParse(entry)
      if (pr.success) merged.push(pr.data)
    }
  }

  return { merged, warnings }
}

/** Run gh in the project dir under that project's own environment — the same layering bd gets
 * (project-env.ts), so a repo whose gh token lives in mise resolves it. Deliberately NOT under
 * the bd process lock: this is a GitHub call and must not queue behind serialized bd spawns. */
async function runGhPrList(args: string[], cwd: string): Promise<string> {
  const projectEnv = await resolveProjectEnv(cwd)
  const { stdout } = await execFileAsync('gh', args, {
    cwd,
    env: { ...process.env, ...projectEnv },
    timeout: GH_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
