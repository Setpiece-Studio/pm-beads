// ABOUTME: The PR-history backfill's review panel — scans merged PRs into proposals, lets a
// ABOUTME: person check the ones to apply or skip for good, and reports what the apply wrote.

import { ExternalLink, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  BACKFILL_DEFAULT_DAYS,
  type BackfillConfidence,
  type BackfillProposal,
} from '@/lib/beads/pr-backfill'
import type {
  BackfillApplyResult,
  BackfillScanResult,
} from '@/lib/beads/pr-backfill-run'
import { shortPrLabel } from '@/lib/beads/pr-link'

export interface BackfillPrsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Scans the project's merged PR history server-side. Writes nothing. */
  scan: (daysBack: number) => Promise<BackfillScanResult>
  /** Applies exactly these proposals — pr_url, then comment and (maybe) close. */
  apply: (proposals: BackfillProposal[]) => Promise<BackfillApplyResult>
  /** Dismisses these beads for good, persisted in the project's sidecar. */
  skip: (ids: string[]) => Promise<void>
  /** Open one of the proposed beads. Its id is plain text when this is absent. */
  onSelectIssue?: (id: string) => void
  /** An apply wrote to bd — the list behind this panel is now stale. */
  onApplied?: () => void
}

/** Tier styling. High is the tier the panel pre-checks, so it reads as the confident one. */
const CONFIDENCE_STYLE: Record<BackfillConfidence, string> = {
  high: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  low: 'bg-muted text-muted-foreground',
}

/**
 * A one-time (re-runnable) catch-up for the beads that piled up before the merged-PR sweep
 * existed. Unlike the sweep it is a REVIEW list: it scans on open because scanning writes
 * nothing, but it never applies a row that a person did not check.
 */
export function BackfillPrs({
  open,
  onOpenChange,
  scan,
  apply,
  skip,
  onSelectIssue,
  onApplied,
}: BackfillPrsProps) {
  const [daysInput, setDaysInput] = useState(String(BACKFILL_DEFAULT_DAYS))
  const [result, setResult] = useState<BackfillScanResult | null>(null)
  const [proposals, setProposals] = useState<BackfillProposal[]>([])
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [applied, setApplied] = useState<BackfillApplyResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runScan = useCallback(
    async (daysBack: number) => {
      setBusy(true)
      setError(null)
      setApplied(null)
      try {
        const next = await scan(daysBack)
        setResult(next)
        setProposals(next.proposals)
        // High confidence means the PR body said `Closes <id>` — the convention this repo
        // asks for. Weaker tiers are guesses, and a guess is not a default.
        setSelected(
          new Set(
            next.proposals
              .filter((proposal) => proposal.confidence === 'high')
              .map((proposal) => proposal.id),
          ),
        )
      } catch (caught) {
        setResult(null)
        setProposals([])
        setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        setBusy(false)
      }
    },
    [scan],
  )

  // Scanning is read-only, so opening the panel to an empty box and a button would be a step
  // with nothing behind it. Re-opening rescans: the answer is only as good as its moment.
  // biome-ignore lint/correctness/useExhaustiveDependencies: daysInput is READ here but must not trigger a scan on every keystroke — Rescan and reopening are the only triggers.
  useEffect(() => {
    if (open) void runScan(parseDays(daysInput))
  }, [open, runScan])

  async function applySelected() {
    const approved = proposals.filter((proposal) => selected.has(proposal.id))
    if (approved.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const outcome = await apply(approved)
      setApplied(outcome)
      const done = new Set(outcome.applied.map((row) => row.id))
      setProposals((prev) => prev.filter((row) => !done.has(row.id)))
      setSelected((prev) => new Set([...prev].filter((id) => !done.has(id))))
      if (outcome.applied.length > 0) onApplied?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function skipRow(id: string) {
    setError(null)
    try {
      await skip([id])
      setProposals((prev) => prev.filter((row) => row.id !== id))
      setSelected((prev) => new Set([...prev].filter((each) => each !== id)))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedCount = proposals.filter((row) => selected.has(row.id)).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="backfill-panel"
        className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-4xl"
      >
        <DialogHeader className="p-4 pb-3">
          <DialogTitle className="text-sm font-semibold">
            Backfill from PR history
          </DialogTitle>
          <DialogDescription className="text-xs">
            Merged pull requests that name a bead, for beads still open. Nothing
            is written until you apply a row.
          </DialogDescription>
        </DialogHeader>
        <Separator />

        <div className="flex flex-wrap items-center gap-2 p-3">
          <label
            htmlFor="backfill-days"
            className="text-xs text-muted-foreground"
          >
            Days of history
          </label>
          <Input
            id="backfill-days"
            type="number"
            min={1}
            max={3650}
            value={daysInput}
            disabled={busy}
            onChange={(event) => setDaysInput(event.target.value)}
            className="h-7 w-20 text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void runScan(parseDays(daysInput))}
            className="h-7 px-2 text-xs"
          >
            Rescan
          </Button>
          {busy && (
            <Loader2
              className="size-3.5 animate-spin text-muted-foreground"
              aria-label="Working"
            />
          )}
          {result !== null && (
            <span className="ml-auto text-[11px] text-muted-foreground">
              {result.scannedPrs} merged PR
              {result.scannedPrs === 1 ? '' : 's'} since{' '}
              {result.since.slice(0, 10)}
              {result.repos.length > 0 && ` · ${result.repos.join(', ')}`}
            </span>
          )}
        </div>

        {error !== null && (
          <>
            <Separator />
            <p role="alert" className="p-3 text-xs text-red-500">
              {error}
            </p>
          </>
        )}

        {result !== null && result.warnings.length > 0 && (
          <>
            <Separator />
            <ul className="flex flex-col gap-0.5 p-3">
              {result.warnings.map((warning) => (
                <li
                  key={warning}
                  className="text-xs text-amber-600 dark:text-amber-400"
                >
                  {warning}
                </li>
              ))}
            </ul>
          </>
        )}

        <Separator />
        <div className="min-h-0 flex-1 overflow-auto">
          {proposals.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              {result === null && busy
                ? 'Scanning merged pull requests…'
                : 'No beads to backfill — every merged pull request in this window either names no open bead or is already linked.'}
            </p>
          ) : (
            <ul className="flex flex-col">
              {proposals.map((proposal) => (
                <ProposalRow
                  key={proposal.id}
                  proposal={proposal}
                  checked={selected.has(proposal.id)}
                  onToggle={() => toggle(proposal.id)}
                  onSkip={() => void skipRow(proposal.id)}
                  onSelectIssue={onSelectIssue}
                />
              ))}
            </ul>
          )}
        </div>

        {applied !== null && (
          <>
            <Separator />
            <AppliedSummary result={applied} />
          </>
        )}

        <Separator />
        <div className="flex items-center gap-2 p-3">
          <p className="text-[11px] text-muted-foreground">
            {selectedCount} of {proposals.length} selected
          </p>
          <Button
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            disabled={busy || selectedCount === 0}
            onClick={() => void applySelected()}
          >
            Apply selected {selectedCount > 0 && `(${selectedCount})`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ProposalRow({
  proposal,
  checked,
  onToggle,
  onSkip,
  onSelectIssue,
}: {
  proposal: BackfillProposal
  checked: boolean
  onToggle: () => void
  onSkip: () => void
  onSelectIssue?: (id: string) => void
}) {
  const closes = proposal.actions[1] === 'close'
  return (
    <li
      data-testid="backfill-row"
      data-bead-id={proposal.id}
      className="flex items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={`Backfill ${proposal.id}`}
        className="size-3.5 shrink-0 accent-primary"
      />
      <span
        className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${CONFIDENCE_STYLE[proposal.confidence]}`}
      >
        {proposal.confidence}
      </span>
      {onSelectIssue === undefined ? (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {proposal.id}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onSelectIssue(proposal.id)}
          className="shrink-0 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          {proposal.id}
        </button>
      )}
      <span className="min-w-0 flex-1 truncate" title={proposal.title}>
        {proposal.title}
      </span>
      {/* What applying this row does, in the panel's own words — the actions array is the
          contract, but "Link + close" is what a person is actually approving. */}
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {closes ? 'Link + close' : 'Link + comment'}
      </span>
      <a
        href={proposal.prUrl}
        target="_blank"
        rel="noreferrer"
        title={proposal.prTitle}
        className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
      >
        {shortPrLabel(proposal.prUrl)}
        <ExternalLink className="size-3" />
      </a>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {proposal.mergedAt.slice(0, 10)}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onSkip}
        className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground"
      >
        Skip
      </Button>
    </li>
  )
}

function AppliedSummary({ result }: { result: BackfillApplyResult }) {
  return (
    <div
      data-testid="backfill-results"
      className="flex max-h-40 flex-col gap-1 overflow-auto p-3"
    >
      <h3 className="text-xs font-medium">Applied {result.applied.length}</h3>
      <ul className="flex flex-col gap-0.5">
        {result.applied.map((outcome) => (
          <li key={outcome.id} className="flex items-center gap-2 text-xs">
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {outcome.id}
            </span>
            <span className="min-w-0 flex-1 truncate">{outcome.title}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {outcome.kind === 'close' ? 'closed' : 'commented'} · #
              {outcome.prNumber}
            </span>
          </li>
        ))}
      </ul>
      {result.warnings.map((warning) => (
        <p key={warning} className="text-xs text-amber-600 dark:text-amber-400">
          {warning}
        </p>
      ))}
    </div>
  )
}

/** The typed window, or the default when the box is empty or junk. Server-side clamping is
 * what actually bounds the query (pr-backfill's backfillSince); this only avoids sending NaN. */
function parseDays(input: string): number {
  const parsed = Number.parseInt(input, 10)
  return Number.isFinite(parsed) ? parsed : BACKFILL_DEFAULT_DAYS
}
