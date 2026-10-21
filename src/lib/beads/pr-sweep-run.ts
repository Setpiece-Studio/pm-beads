// ABOUTME: The merged-PR sweep's orchestration — read the beads carrying pr_url, ask gh which
// ABOUTME: of their PRs merged, apply the plan (comment, then close), and stamp the sidecar.

import { z } from 'zod'
import { invalidateBdCache } from './cache'
import { type BdOptions, runBdJson, runBdWrite } from './cli'
import { PR_URL_METADATA_KEY } from './pr-link'
import {
  candidateFromIssue,
  groupPrUrlsByRepo,
  planSweep,
  SWEEP_ACTOR,
  type SweepAction,
  type SweepCandidate,
  type SweepSkip,
  sweepSince,
} from './pr-sweep'
import { readMergedPrs } from './pr-sweep-source'
import { readSweepConfig, recordSweepRun } from './pr-sweep-store'
import { issueSchema } from './types'

/** One bead the sweep acted on, in the shape the summary panel renders. */
export interface SweepOutcome {
  id: string
  title?: string
  prUrl: string
  prNumber: number
}

export interface SweepResult {
  /** Beads commented on and closed. */
  closed: SweepOutcome[]
  /** Beads commented on but deliberately left open (epics, `human`-labeled). */
  commented: SweepOutcome[]
  skipped: SweepSkip[]
  /** Repos gh could not read, and beads bd refused to write. Never fatal. */
  warnings: string[]
  /** ISO instant the gh search started from. */
  since: string
  /** ISO instant this run started. */
  ranAt: string
  /** True when nothing was written — the plan only. */
  dryRun: boolean
}

export interface SweepOptions {
  /** Absolute beads project dir. Already .beads-guarded by the caller (bdOptionsFor). */
  projectDir: string
  /** Return the plan without commenting, closing, or stamping the sidecar. */
  dryRun?: boolean
  /** Injectable clock, so the since-window is deterministic in tests. */
  now?: Date
}

/**
 * Sweep one project: close the open beads whose linked PR has merged.
 *
 * Guardrails, in order of how much they matter: a closed bead is never touched; an epic or a
 * `human`-labeled bead gets the comment and keeps its status; every write is stamped
 * `--actor pm-beads`. Nothing here throws for a partial failure — a repo gh could not read and
 * a bead bd refused to write both become warnings, and `sweep.lastRunAt` only advances after a
 * run with no warnings at all, so whatever was missed is re-covered by the next sweep.
 */
export async function sweepMergedPrs(
  options: SweepOptions,
): Promise<SweepResult> {
  const { projectDir, dryRun = false } = options
  const now = options.now ?? new Date()
  const ranAt = now.toISOString()
  const opts: BdOptions = { cwd: projectDir }

  const since = sweepSince(readSweepConfig(projectDir).lastRunAt, now)
  const candidates = await readSweepCandidates(opts)

  // Ask gh only about the repos a bead could actually be closed for: a repo reached solely by
  // closed or blocked beads costs a network round trip and can only produce a warning.
  const repos = groupPrUrlsByRepo(
    candidates
      .filter((c) => c.status === 'open' || c.status === 'in_progress')
      .map((c) => c.prUrl),
  )
  const { merged, warnings } = await readMergedPrs(repos, since, projectDir)

  const plan = planSweep(candidates, merged)
  const titles = new Map(candidates.map((c) => [c.id, c.title]))
  const result: SweepResult = {
    closed: [],
    commented: [],
    skipped: plan.skipped,
    warnings: [...warnings],
    since: since.toISOString(),
    ranAt,
    dryRun,
  }

  for (const action of plan.actions) {
    const outcome = toOutcome(action, titles.get(action.id))
    if (dryRun) {
      bucketFor(result, action).push(outcome)
      continue
    }
    const failure = await applySweepAction(action, opts)
    if (failure !== null) {
      result.warnings.push(failure)
      continue
    }
    bucketFor(result, action).push(outcome)
  }

  if (!dryRun && plan.actions.length > 0) invalidateBdCache(opts)

  // A clean run is what earns a new window. Any warning at all — an unreadable repo, a bead
  // that would not close — leaves lastRunAt where it was so the next sweep looks at the same
  // span again rather than stepping over what it could not see.
  if (!dryRun && result.warnings.length === 0) {
    try {
      await recordSweepRun(projectDir, ranAt)
    } catch (error) {
      result.warnings.push(message(error))
    }
  }

  return result
}

/** Every bead carrying a pr_url, closed ones included: the plan reports them as skipped, which
 * is how "we saw it and left it alone" is distinguished from "we never looked". `--limit 0`
 * lifts bd's default 50-row cap. Runs through the cli.ts mutex like every other bd call. */
async function readSweepCandidates(opts: BdOptions): Promise<SweepCandidate[]> {
  const raw = await runBdJson(
    [
      'list',
      '--json',
      '--all',
      '--limit',
      '0',
      '--has-metadata-key',
      PR_URL_METADATA_KEY,
    ],
    opts,
  )
  const issues = z.array(issueSchema).parse(raw ?? [])
  return issues.flatMap((issue) => {
    const candidate = candidateFromIssue(issue)
    return candidate === null ? [] : [candidate]
  })
}

/** Apply one action: comment first, then close. Returns a warning line on failure, null on
 * success. Comment-before-close is deliberate — a bead that fails to close still carries the
 * note saying why someone thought it should.
 *
 * Exported because the PR-history backfill applies its approved proposals through this very
 * path: one place decides how an automated close is written and signed. */
export async function applySweepAction(
  action: SweepAction,
  opts: BdOptions,
): Promise<string | null> {
  try {
    // `--` guards a comment body that starts with a dash from cobra's flag parsing.
    await runBdWrite(
      ['comment', action.id, '--actor', SWEEP_ACTOR, '--', action.comment],
      opts,
    )
  } catch (error) {
    return `${action.id}: bd comment failed — ${message(error)}`
  }
  if (action.kind !== 'close') return null
  try {
    await runBdWrite(
      [
        'close',
        action.id,
        '--actor',
        SWEEP_ACTOR,
        '--reason',
        action.closeReason ?? `PR #${action.prNumber} merged`,
      ],
      opts,
    )
  } catch (error) {
    return `${action.id}: commented, but bd close failed — ${message(error)}`
  }
  return null
}

function bucketFor(result: SweepResult, action: SweepAction): SweepOutcome[] {
  return action.kind === 'close' ? result.closed : result.commented
}

function toOutcome(
  action: SweepAction,
  title: string | undefined,
): SweepOutcome {
  const outcome: SweepOutcome = {
    id: action.id,
    prUrl: action.prUrl,
    prNumber: action.prNumber,
  }
  if (title !== undefined) outcome.title = title
  return outcome
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
