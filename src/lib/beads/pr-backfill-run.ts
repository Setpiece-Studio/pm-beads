// ABOUTME: The PR-history backfill's orchestration — scan merged PRs into review proposals,
// ABOUTME: and apply the ones a person approved through the sweep's own comment/close path.

import { z } from 'zod'
import { invalidateBdCache } from './cache'
import { type BdOptions, runBdJson } from './cli'
import { setPrUrl } from './mutations'
import {
  type BackfillIssue,
  type BackfillProposal,
  backfillAction,
  backfillSince,
  beadIdPrefix,
  planBackfill,
} from './pr-backfill'
import { backfillReposFor, readMergedPrHistory } from './pr-backfill-source'
import { readBackfillConfig, recordBackfillSkips } from './pr-backfill-store'
import { prUrlOf } from './pr-link'
import { applySweepAction } from './pr-sweep-run'
import { issueSchema } from './types'

export interface BackfillScanResult {
  /** The review list, strongest claims first. NEVER applied without an explicit approval. */
  proposals: BackfillProposal[]
  /** The bead-id prefix the scan matched on, or null when the project has no readable ids. */
  prefix: string | null
  /** The repos actually asked, so an empty list is explicable. */
  repos: string[]
  /** Repos gh could not read, and projects with no GitHub origin. Never fatal. */
  warnings: string[]
  /** The window the user asked for, after clamping. */
  daysBack: number
  /** ISO instant the gh search started from. */
  since: string
  /** ISO instant this scan started. */
  ranAt: string
  /** How many merged PRs were read — the denominator behind a short review list. */
  scannedPrs: number
}

export interface BackfillScanOptions {
  /** Absolute beads project dir. Already .beads-guarded by the caller (bdOptionsFor). */
  projectDir: string
  /** Days of merge history to read. Clamped by backfillSince; defaults to 180. */
  daysBack?: number
  /** Injectable clock, so the window is deterministic in tests. */
  now?: Date
}

/** One bead the backfill wrote to, in the shape the review panel renders afterwards. */
export interface BackfillOutcome {
  id: string
  title: string
  prUrl: string
  prNumber: number
  /** `close` commented then closed; `comment-only` left the bead open. */
  kind: 'close' | 'comment-only'
}

export interface BackfillApplyResult {
  applied: BackfillOutcome[]
  /** Beads bd refused to write. The rest of the selection is still applied. */
  warnings: string[]
}

export interface BackfillApplyOptions {
  projectDir: string
  /** Exactly the proposals a person checked. Nothing else is touched. */
  proposals: readonly BackfillProposal[]
}

/**
 * Scan the project's merged PR history and propose what to backfill.
 *
 * Read-only end to end: it runs one `bd list` and one `gh pr list` per repo, and writes
 * nothing at all. The result is a proposal list for a person to approve — the whole point of
 * the backfill being separate from the sweep is that a six-month window of guesses about
 * which PR closed which bead is not something to apply unattended.
 */
export async function scanPrBackfill(
  options: BackfillScanOptions,
): Promise<BackfillScanResult> {
  const { projectDir } = options
  const now = options.now ?? new Date()
  const opts: BdOptions = { cwd: projectDir }

  const since = backfillSince(options.daysBack, now)
  const daysBack = Math.round((now.getTime() - since.getTime()) / 86_400_000)

  const issues = await readBackfillIssues(opts)
  const prefix = beadIdPrefix(issues.map((issue) => issue.id))

  const { repos, warnings: repoWarnings } = await backfillReposFor(projectDir)
  const result: BackfillScanResult = {
    proposals: [],
    prefix,
    repos,
    warnings: [...repoWarnings],
    daysBack,
    since: since.toISOString(),
    ranAt: now.toISOString(),
    scannedPrs: 0,
  }

  // No prefix means no ids to match on — an empty project, or one whose ids this app cannot
  // read. Asking GitHub for months of history to match nothing against would be pure cost.
  if (prefix === null) {
    result.warnings.push(
      'No bead ids to read a project prefix from; nothing to match merged pull requests against.',
    )
    return result
  }
  if (repos.length === 0) return result

  const { prs, warnings } = await readMergedPrHistory(repos, since, projectDir)
  result.warnings.push(...warnings)
  result.scannedPrs = prs.length
  result.proposals = planBackfill({
    issues,
    prs,
    prefix,
    skippedIds: readBackfillConfig(projectDir).skipped,
  })
  return result
}

/**
 * Apply the approved proposals: record the link, then comment and (unless the bead is an epic,
 * `human`-labeled, or being re-pointed at a different PR) close it.
 *
 * Every write goes through the merged-PR sweep's own path, so a backfilled close is stamped
 * `--actor pm-beads` and reads like any other automated close. A bead bd refuses to write
 * becomes a warning; the rest of the selection is still applied.
 */
export async function applyPrBackfill(
  options: BackfillApplyOptions,
): Promise<BackfillApplyResult> {
  const opts: BdOptions = { cwd: options.projectDir }
  const result: BackfillApplyResult = { applied: [], warnings: [] }

  for (const proposal of options.proposals) {
    // Link first: the comment quotes the PR, so a bead that carries the note must carry the
    // link that explains it — and a failure here means nothing was said about a wrong PR.
    try {
      await setPrUrl(proposal.id, proposal.prUrl, opts)
    } catch (error) {
      result.warnings.push(
        `${proposal.id}: setting pr_url failed — ${message(error)}`,
      )
      continue
    }
    const action = backfillAction(proposal)
    const failure = await applySweepAction(action, opts)
    if (failure !== null) {
      result.warnings.push(failure)
      continue
    }
    result.applied.push({
      id: proposal.id,
      title: proposal.title,
      prUrl: proposal.prUrl,
      prNumber: proposal.prNumber,
      kind: action.kind,
    })
  }

  if (result.applied.length > 0) invalidateBdCache(opts)
  return result
}

/** Dismiss beads from the review list for good — persisted in the project's sidecar so a
 * re-scan never puts the same rows back. */
export function skipPrBackfill(
  projectDir: string,
  ids: readonly string[],
): Promise<void> {
  return recordBackfillSkips(projectDir, ids)
}

/** Every bead in the project, closed ones included: the plan needs closed beads to recognize
 * a PR whose work is already done, and `--limit 0` lifts bd's default 50-row cap. Runs through
 * the cli.ts mutex like every other bd call. */
async function readBackfillIssues(opts: BdOptions): Promise<BackfillIssue[]> {
  const raw = await runBdJson(['list', '--json', '--all', '--limit', '0'], opts)
  const issues = z.array(issueSchema).parse(raw ?? [])
  return issues.map((issue) => {
    const candidate: BackfillIssue = {
      id: issue.id,
      title: issue.title,
      status: issue.status,
      issue_type: issue.issue_type,
    }
    if (issue.labels !== undefined) candidate.labels = issue.labels
    if (issue.metadata !== undefined) candidate.metadata = issue.metadata
    const prUrl = prUrlOf(issue)
    if (prUrl !== undefined) candidate.prUrl = prUrl
    return candidate
  })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
