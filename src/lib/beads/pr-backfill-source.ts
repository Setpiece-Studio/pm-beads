// ABOUTME: The backfill's merged-PR-history source — the project's origin repo, then one
// ABOUTME: `gh pr list --state merged` per repo under the project env, OUTSIDE the bd mutex.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { HistoryPr } from './pr-backfill'
import { parseGitRemoteUrl } from './pr-link'
import { readOriginRemote } from './pr-remote'
import { mergedSearchDate } from './pr-sweep'
import { resolveProjectEnv } from './project-env'

const execFileAsync = promisify(execFile)

/** Wall-clock cap on one gh call. Twice the sweep's, because a backfill window is months
 * rather than days and asks for PR bodies as well as numbers. */
const GH_TIMEOUT_MS = 30_000

/** Upper bound on merged PRs read per repo. A backfill is a one-time catch-up over months, so
 * this is deliberately generous — and gh caps a single page at 1000 regardless. */
export const BACKFILL_PR_LIMIT = 500

/** The gh fields the extractor reads. `body` and `headRefName` are the whole reason this is a
 * separate query from the sweep's, which needs only the url. */
const HISTORY_FIELDS = 'number,url,title,body,headRefName,mergedAt'

/** gh's shape for one merged PR. The text fields are nullable — gh returns `body: null` for a
 * PR opened with an empty description — and normalize to '' so the extractor never guards. */
const historyPrSchema = z.object({
  number: z.number().int(),
  url: z.string().min(1),
  title: z
    .string()
    .nullish()
    .transform((v) => v ?? ''),
  body: z
    .string()
    .nullish()
    .transform((v) => v ?? ''),
  headRefName: z
    .string()
    .nullish()
    .transform((v) => v ?? ''),
  mergedAt: z.string().min(1),
})

/** Injected gh runner, so the argv and the soft-failure paths are testable without GitHub. */
export type GhPrHistoryReader = (args: string[], cwd: string) => Promise<string>

/** Injected `git remote get-url origin` reader, for the same reason. */
export type OriginReader = (projectDir: string) => Promise<string | null>

export interface MergedPrHistoryResult {
  prs: HistoryPr[]
  /** One line per repo that could not be read. The scan still shows what it did learn. */
  warnings: string[]
}

export interface BackfillReposResult {
  repos: string[]
  warnings: string[]
}

/** The exact `gh` argv for one repo's merged PR history since a date. Exported so the command
 * in CONTRIBUTING is checked by a test rather than by eye. */
export function ghPrHistoryArgs(repo: string, sinceDate: string): string[] {
  return [
    'pr',
    'list',
    '--repo',
    repo,
    '--state',
    'merged',
    '--json',
    HISTORY_FIELDS,
    '--search',
    `merged:>=${sinceDate}`,
    '--limit',
    String(BACKFILL_PR_LIMIT),
  ]
}

/**
 * The repos a backfill scans for this project: whatever `git remote get-url origin` points at.
 *
 * A beads project that is not a git repo, or whose origin is not GitHub, is not a failure —
 * it is simply a project with no PR history to read, and says so as a warning.
 */
export async function backfillReposFor(
  projectDir: string,
  origin: OriginReader = readOriginRemote,
): Promise<BackfillReposResult> {
  const remote = await origin(projectDir)
  if (remote === null) {
    return {
      repos: [],
      warnings: [
        `${projectDir}: no git origin remote to read merged pull requests from`,
      ],
    }
  }
  const repo = parseGitRemoteUrl(remote)
  if (repo === null) {
    return {
      repos: [],
      warnings: [`${remote}: origin remote is not a GitHub repository`],
    }
  }
  // Lowercased: GitHub is case-insensitive here and the sweep canonicalizes the same way.
  return {
    repos: [`${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`],
    warnings: [],
  }
}

/**
 * Every PR merged in the window, with the text the extractor reads.
 *
 * Sequential, failing soft per repo, for the same reasons the sweep's source is (pr-sweep-
 * source.ts): repos come in ones and twos, a serial walk keeps warnings in a stable order, and
 * a repo gh cannot answer for is worth a warning rather than an empty review list.
 */
export async function readMergedPrHistory(
  repos: readonly string[],
  since: Date,
  cwd: string,
  reader: GhPrHistoryReader = runGhPrHistory,
): Promise<MergedPrHistoryResult> {
  const sinceDate = mergedSearchDate(since)
  const prs: HistoryPr[] = []
  const warnings: string[] = []

  for (const repo of repos) {
    let stdout: string
    try {
      stdout = await reader(ghPrHistoryArgs(repo, sinceDate), cwd)
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
    // Per-entry parse: one row gh shaped unexpectedly drops that row, not the whole repo.
    for (const entry of parsed.data) {
      const pr = historyPrSchema.safeParse(entry)
      if (pr.success) prs.push(pr.data)
    }
  }

  return { prs, warnings }
}

/** Run gh in the project dir under that project's own environment — the same layering bd gets
 * (project-env.ts). Deliberately NOT under the bd process lock: this is a GitHub call and must
 * not queue behind serialized bd spawns. */
async function runGhPrHistory(args: string[], cwd: string): Promise<string> {
  const projectEnv = await resolveProjectEnv(cwd)
  const { stdout } = await execFileAsync('gh', args, {
    cwd,
    env: { ...process.env, ...projectEnv },
    timeout: GH_TIMEOUT_MS,
    // Bodies, not just numbers: 500 PRs of prose is a much bigger payload than the sweep's.
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
