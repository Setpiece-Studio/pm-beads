// ABOUTME: Issues-toolbar control that runs the merged-PR sweep for the selected project and
// ABOUTME: renders what it did — beads closed, beads only commented on, and any repo gh missed.

import { GitMerge, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import type { SweepOutcome, SweepResult } from '@/lib/beads/pr-sweep-run'

export interface SweepMergedPrsProps {
  /** Runs the sweep server-side. `dryRun` returns the same shape with nothing written. */
  sweep: (dryRun: boolean) => Promise<SweepResult>
  /** Open one of the swept beads. Its rows are plain text when this is absent. */
  onSelectIssue?: (id: string) => void
  /** A real (non-dry) sweep finished and wrote to bd — the list behind this is now stale. */
  onSwept?: () => void
  /** Open the PR-history backfill review list. Absent hides the link to it. */
  onBackfill?: () => void
}

/**
 * The sweep is a WRITE, so opening the panel runs nothing: Preview and Sweep now are two
 * separate, explicit clicks. The result stays on screen until the panel is reopened, because
 * "which beads did that close?" is the whole reason to press the button.
 */
export function SweepMergedPrs({
  sweep,
  onSelectIssue,
  onSwept,
  onBackfill,
}: SweepMergedPrsProps) {
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SweepResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(dryRun: boolean) {
    setRunning(true)
    setError(null)
    try {
      const next = await sweep(dryRun)
      setResult(next)
      if (!next.dryRun) onSwept?.()
    } catch (caught) {
      setResult(null)
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setRunning(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Reopening starts clean: a summary from ten minutes ago is not this sweep's answer.
        if (next) {
          setResult(null)
          setError(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <GitMerge className="size-3.5" />
          Sweep merged PRs
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-88 p-0 text-[13px]">
        <div className="flex flex-col gap-2 p-3">
          <p className="text-xs text-muted-foreground">
            Closes open beads whose linked pull request has merged. Epics and{' '}
            <code className="rounded bg-muted px-1 py-px font-mono">human</code>{' '}
            beads only get a comment.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={running}
              onClick={() => run(true)}
              className="h-7 px-2 text-xs"
            >
              Preview
            </Button>
            <Button
              size="sm"
              disabled={running}
              onClick={() => run(false)}
              className="h-7 px-2 text-xs"
            >
              Sweep now
            </Button>
            {running && (
              <Loader2
                className="size-3.5 animate-spin text-muted-foreground"
                aria-label="Sweeping"
              />
            )}
          </div>
          {/* The sweep only sees beads that already carry a pr_url. The backfill is how the
              beads that predate the convention get one, so it belongs next to it. */}
          {onBackfill !== undefined && (
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                setOpen(false)
                onBackfill()
              }}
              className="h-auto justify-start p-0 text-xs font-normal text-muted-foreground"
            >
              Backfill from PR history…
            </Button>
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
        {result !== null && (
          <>
            <Separator />
            <SweepSummary result={result} onSelectIssue={onSelectIssue} />
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

function SweepSummary({
  result,
  onSelectIssue,
}: {
  result: SweepResult
  onSelectIssue?: (id: string) => void
}) {
  const acted = result.closed.length + result.commented.length

  return (
    <div
      data-testid="sweep-summary"
      data-sweep-summary=""
      className="flex max-h-96 flex-col gap-3 overflow-auto p-3"
    >
      {result.dryRun && (
        <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
          Dry run — nothing was written.
        </p>
      )}
      {acted === 0 && result.warnings.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing to close — no linked pull request merged in this window.
        </p>
      )}
      <OutcomeSection
        label="Closed"
        outcomes={result.closed}
        onSelectIssue={onSelectIssue}
      />
      <OutcomeSection
        label="Commented only"
        outcomes={result.commented}
        note="Epics and human-labeled beads are never auto-closed."
        onSelectIssue={onSelectIssue}
      />
      {result.warnings.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-amber-600 dark:text-amber-400">
            Warnings {result.warnings.length}
          </h3>
          <ul className="flex flex-col gap-0.5">
            {result.warnings.map((warning) => (
              <li key={warning} className="text-xs text-muted-foreground">
                {warning}
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* The window is the one thing a surprising result is usually explained by. */}
      <p className="text-[11px] text-muted-foreground">
        Merges since {result.since.slice(0, 10)} · {result.skipped.length} bead
        {result.skipped.length === 1 ? '' : 's'} left alone
      </p>
    </div>
  )
}

function OutcomeSection({
  label,
  outcomes,
  note,
  onSelectIssue,
}: {
  label: string
  outcomes: SweepOutcome[]
  note?: string
  onSelectIssue?: (id: string) => void
}) {
  if (outcomes.length === 0) return null
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-medium">
        {label} {outcomes.length}
      </h3>
      {note !== undefined && (
        <p className="text-[11px] text-muted-foreground">{note}</p>
      )}
      <ul className="flex flex-col gap-0.5">
        {outcomes.map((outcome) => (
          <li key={outcome.id}>
            <OutcomeRow outcome={outcome} onSelectIssue={onSelectIssue} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One swept bead: id, title, and the PR number, linked back to the bead when the caller
 * can navigate. Rendered as a button rather than an anchor so the panel stays route-agnostic. */
function OutcomeRow({
  outcome,
  onSelectIssue,
}: {
  outcome: SweepOutcome
  onSelectIssue?: (id: string) => void
}) {
  const content = (
    <>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {outcome.id}
      </span>
      <span className="min-w-0 flex-1 truncate" title={outcome.title}>
        {outcome.title ?? ''}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        #{outcome.prNumber}
      </span>
    </>
  )
  const className =
    'flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs'

  if (onSelectIssue === undefined) {
    return <div className={className}>{content}</div>
  }
  return (
    <button
      type="button"
      onClick={() => onSelectIssue(outcome.id)}
      className={`${className} hover:bg-accent/60`}
    >
      {content}
    </button>
  )
}
