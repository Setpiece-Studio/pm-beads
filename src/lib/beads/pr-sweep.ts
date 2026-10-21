// ABOUTME: The merged-PR sweep's PURE half — turns beads carrying pr_url plus a set of merged
// ABOUTME: PRs into a plan (close / comment-only / skip), and derives the gh search window.

import { hasOpenAsk } from './asks'
import { parsePrUrl, prRefUrl, prUrlOf } from './pr-link'
import type { Issue } from './types'

/** Who the sweep acts as. Every comment and close it writes is stamped with this so the audit
 * trail separates automation from a human closing a bead by hand. */
export const SWEEP_ACTOR = 'pm-beads'

/**
 * The retired `human` label.
 *
 * It used to opt a bead out of auto-closing here; that reading is now derived from the bead's
 * own ask metadata (`hasOpenAsk`), so nothing in the sweep reads the label any more. The
 * constant survives only for the code that has not moved off it yet — the inbox model's
 * "Reply & resolve" prep (pm-beads-y0j) — and for the migration in pm-beads-r8l.6, which takes
 * the label off the beads still wearing it. Matched case-insensitively: bd stores labels
 * verbatim.
 */
export const HUMAN_LABEL = 'human'

/** Statuses the sweep will act on. Everything else — closed above all — is left alone. */
const ACTIONABLE_STATUSES = new Set(['open', 'in_progress'])

/** How far back the FIRST sweep of a project looks. Also the ceiling on every later window:
 * a very old lastRunAt would otherwise ask GitHub for years of merged PRs. */
export const SWEEP_FIRST_RUN_LOOKBACK_DAYS = 30

/** Slack subtracted from the last successful run before searching. A PR merged moments before
 * the previous sweep read its repo would otherwise fall through the gap between the two runs. */
export const SWEEP_SAFETY_MARGIN_DAYS = 1

const DAY_MS = 24 * 60 * 60 * 1000

/** One bead the sweep might act on: the fields that decide its fate, plus the linked PR. */
export interface SweepCandidate {
  id: string
  /** Carried for the summary panel; nothing in the plan depends on it. */
  title?: string
  issue_type: string
  status: string
  labels?: string[]
  /** The bead's whole metadata map: `prUrl` below is one value out of it, and its `ask.*` keys
   * are what say whether a person still owes this bead an answer. */
  metadata?: Record<string, unknown>
  /** The bead's pr_url metadata value, exactly as stored. */
  prUrl: string
}

/** A merged pull request as `gh pr list --json number,url,mergedAt` reports it. */
export interface MergedPr {
  url: string
  number: number
  mergedAt: string
}

/** What the sweep will do to one bead. `close` comments then closes; `comment-only` leaves the
 * bead open — epics and beads with an open ask are never auto-closed (CONCEPTS.md). */
export interface SweepAction {
  id: string
  /** Canonical url (prRefUrl), not necessarily the shape stored on the bead. */
  prUrl: string
  prNumber: number
  mergedAt: string
  kind: 'close' | 'comment-only'
  comment: string
  /** bd close --reason text. Present only on a `close` action. */
  closeReason?: string
}

export type SweepSkipReason =
  /** Already closed — the sweep never touches a closed bead. */
  | 'closed'
  /** Neither open nor in_progress (blocked, deferred, a custom status). */
  | 'not-open'
  /** Its PR is not in the merged set for this window. */
  | 'not-merged'
  /** pr_url does not parse as a GitHub pull request url. */
  | 'invalid-pr-url'

export interface SweepSkip {
  id: string
  prUrl: string
  reason: SweepSkipReason
}

export interface SweepPlan {
  actions: SweepAction[]
  skipped: SweepSkip[]
}

/** The sweep candidate a bd issue makes, or null when it carries no pr_url. */
export function candidateFromIssue(issue: Issue): SweepCandidate | null {
  const prUrl = prUrlOf(issue)
  if (prUrl === undefined) return null
  const candidate: SweepCandidate = {
    id: issue.id,
    title: issue.title,
    issue_type: issue.issue_type,
    status: issue.status,
    prUrl,
  }
  if (issue.labels !== undefined) candidate.labels = issue.labels
  if (issue.metadata !== undefined) candidate.metadata = issue.metadata
  return candidate
}

/**
 * Decide what to do with each candidate given the PRs known to have merged.
 *
 * Pure and total: every candidate lands in exactly one of `actions` or `skipped`, and both
 * lists come back ordered by issue id so two runs over the same inputs produce the same plan
 * (the summary panel and the tests both read it positionally).
 */
export function planSweep(
  candidates: readonly SweepCandidate[],
  mergedPrs: readonly MergedPr[],
): SweepPlan {
  const mergedByUrl = new Map<string, MergedPr>()
  for (const pr of mergedPrs) {
    const canonical = canonicalPrUrl(pr.url)
    if (canonical !== null) mergedByUrl.set(canonical, pr)
  }

  const actions: SweepAction[] = []
  const skipped: SweepSkip[] = []

  for (const candidate of candidates) {
    const skip = (reason: SweepSkipReason) => {
      skipped.push({ id: candidate.id, prUrl: candidate.prUrl, reason })
    }

    // Status first: a closed bead is off limits regardless of what its PR did.
    if (candidate.status === 'closed') {
      skip('closed')
      continue
    }
    if (!ACTIONABLE_STATUSES.has(candidate.status)) {
      skip('not-open')
      continue
    }
    const canonical = canonicalPrUrl(candidate.prUrl)
    if (canonical === null) {
      skip('invalid-pr-url')
      continue
    }
    const merged = mergedByUrl.get(canonical)
    if (merged === undefined) {
      skip('not-merged')
      continue
    }

    const number = merged.number
    if (awaitsPerson(candidate)) {
      actions.push({
        id: candidate.id,
        prUrl: canonical,
        prNumber: number,
        mergedAt: merged.mergedAt,
        kind: 'comment-only',
        comment: `PR #${number} merged ${canonical} — not auto-closed (epic / open ask)`,
      })
      continue
    }
    actions.push({
      id: candidate.id,
      prUrl: canonical,
      prNumber: number,
      mergedAt: merged.mergedAt,
      kind: 'close',
      comment: `Closed: PR #${number} merged ${canonical}`,
      closeReason: `PR #${number} merged`,
    })
  }

  return { actions: actions.sort(byId), skipped: skipped.sort(byId) }
}

/**
 * Epics roll up children rather than being worked directly, and an unanswered `ask.*` says a
 * person still owes this bead something a merged PR does not settle. Both get the comment and
 * keep their status.
 *
 * Derived from the bead's metadata rather than from the retired `human` label: a bead whose
 * asks have all been answered is closable again the moment the last answer lands, with no label
 * left over to remember to remove.
 */
function awaitsPerson(candidate: SweepCandidate): boolean {
  if (candidate.issue_type === 'epic') return true
  return hasOpenAsk(candidate.metadata)
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id)
}

/** A pr_url reduced to the one string form two urls for the same PR always share — so a stored
 * `/pull/42/files` or a `www.GitHub.com` host still matches what gh reports. */
function canonicalPrUrl(url: string): string | null {
  const ref = parsePrUrl(url)
  if (ref === null) return null
  return prRefUrl({
    owner: ref.owner.toLowerCase(),
    repo: ref.repo.toLowerCase(),
    number: ref.number,
  })
}

/** One repo to ask gh about, with the PR numbers the beads point at (kept for logging and for
 * the caller to size its query — gh is asked by date range, not by number). */
export interface SweepRepoQuery {
  /** owner/repo, lowercased — GitHub is case-insensitive here and we must not query twice. */
  repo: string
  numbers: number[]
}

/** Group candidate pr_urls into one query per repo, deduped, ordered by repo then number, so a
 * sweep spends exactly one gh call per distinct repo. Urls that are not PRs are dropped. */
export function groupPrUrlsByRepo(urls: readonly string[]): SweepRepoQuery[] {
  const byRepo = new Map<string, Set<number>>()
  for (const url of urls) {
    const ref = parsePrUrl(url)
    if (ref === null) continue
    const repo = `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}`
    const numbers = byRepo.get(repo) ?? new Set<number>()
    numbers.add(ref.number)
    byRepo.set(repo, numbers)
  }
  return [...byRepo.entries()]
    .map(([repo, numbers]) => ({
      repo,
      numbers: [...numbers].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.repo.localeCompare(b.repo))
}

/**
 * The instant this sweep should search from: the project's last SUCCESSFUL sweep minus the
 * safety margin, or the first-run lookback when there is none (or the stored value is junk).
 *
 * Bounded at both ends — never further back than the first-run window, never later than `now`,
 * so neither a stale sidecar nor a skewed clock can make a run search years of history or
 * search forward into a range with nothing in it.
 */
export function sweepSince(lastRunAt: string | undefined, now: Date): Date {
  const floor = new Date(now.getTime() - SWEEP_FIRST_RUN_LOOKBACK_DAYS * DAY_MS)
  if (lastRunAt === undefined) return floor
  const last = new Date(lastRunAt)
  if (Number.isNaN(last.getTime())) return floor
  const since = new Date(last.getTime() - SWEEP_SAFETY_MARGIN_DAYS * DAY_MS)
  if (since.getTime() < floor.getTime()) return floor
  if (since.getTime() > now.getTime()) return now
  return since
}

/** The `merged:>=` operand for gh's search. GitHub's issue search takes a UTC calendar date;
 * the one-day safety margin is what makes date granularity safe. */
export function mergedSearchDate(since: Date): string {
  return since.toISOString().slice(0, 10)
}
