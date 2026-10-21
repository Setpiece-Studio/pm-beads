// ABOUTME: The rail's Pull request row — the bead's pr_url rendered Linear "Diffs" style with
// ABOUTME: live gh state, an external link and an unlink control, or an inline "Link PR…" input.

import { ExternalLink, GitPullRequest, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isPossiblePrRef, parsePrUrl, shortPrLabel } from '@/lib/beads/pr-link'
import type { PrState, PrStatus } from '@/lib/beads/pr-state'
import { cn } from '@/lib/utils'

export interface PullRequestRowProps {
  /** The bead's pr_url metadata value; undefined when no PR is linked. */
  prUrl?: string
  /** Disable controls while a mutation is in flight. */
  saving: boolean
  /** Save what was typed — a url, "#N", or "N". Resolution of a bare number against the
   * project's origin remote happens server-side, so the raw text goes through as-is. */
  onLink: (ref: string) => void
  onUnlink: () => void
  /** Injected PR-state reader (server fn in the app, a stub in tests). Fails soft to
   * `unknown` itself, so this component never has to handle a rejection. */
  getPrState: (url: string) => Promise<PrStatus>
}

/** Badge wording and color per state. Colors come from the palette the rail's status and label
 * glyphs already use (issue-meta), so a PR reads as one more property, not a foreign widget. */
const STATE_META: Record<PrState, { label: string; dot: string }> = {
  open: { label: 'Open', dot: 'bg-green-500' },
  draft: { label: 'Draft', dot: 'bg-muted-foreground' },
  merged: { label: 'Merged', dot: 'bg-purple-500' },
  closed: { label: 'Closed', dot: 'bg-red-500' },
  unknown: { label: 'Unknown', dot: 'bg-muted-foreground' },
}

export function PullRequestRow({
  prUrl,
  saving,
  onLink,
  onUnlink,
  getPrState,
}: PullRequestRowProps) {
  if (prUrl === undefined) {
    return <PrLinker disabled={saving} onLink={onLink} />
  }
  return (
    <LinkedPr
      // Remount on a re-link so the state fetch restarts from a clean slate.
      key={prUrl}
      prUrl={prUrl}
      saving={saving}
      onUnlink={onUnlink}
      getPrState={getPrState}
    />
  )
}

function LinkedPr({
  prUrl,
  saving,
  onUnlink,
  getPrState,
}: {
  prUrl: string
  saving: boolean
  onUnlink: () => void
  getPrState: (url: string) => Promise<PrStatus>
}) {
  const [status, setStatus] = useState<PrStatus | null>(null)

  // One read per linked url. getPrState degrades to `unknown` server-side, but the CALL itself
  // can still fail (the server fn is an HTTP round trip), so the same fallback applies here. The
  // cancelled flag keeps a late response from setting state on an unmounted row.
  useEffect(() => {
    let cancelled = false
    getPrState(prUrl)
      .catch((): PrStatus => ({ url: prUrl, state: 'unknown' }))
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
    return () => {
      cancelled = true
    }
  }, [prUrl, getPrState])

  const number = status?.number ?? parsePrUrl(prUrl)?.number
  const meta = STATE_META[status?.state ?? 'unknown']

  // Bordered and hover-highlighted like the rail's dependency member rows, so a PR reads as one
  // more linked thing. The badge sits on its own line rather than beside the title: the rail is
  // 288px wide, and a state pill on the title line truncates every real PR title to a stub.
  return (
    <div className="group flex w-full flex-col gap-1 rounded-md border px-2.5 py-1.5 hover:bg-accent/50">
      <div className="flex w-full items-center gap-2">
        <a
          href={prUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Pull request ${shortPrLabel(prUrl)}`}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" />
          {number !== undefined && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              #{number}
            </span>
          )}
          {/* title= so a truncated PR title is still readable on hover. */}
          <span
            title={status?.title ?? shortPrLabel(prUrl)}
            className="min-w-0 flex-1 truncate text-[13px]"
          >
            {status?.title ?? shortPrLabel(prUrl)}
          </span>
          <ExternalLink
            className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        </a>
        <button
          type="button"
          aria-label="Unlink pull request"
          disabled={saving}
          onClick={onUnlink}
          className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {/* Indented to line up under the title, past the PR glyph. */}
      <Badge
        variant="outline"
        className="ml-5.5 gap-1.5 border-border/70 font-normal text-muted-foreground"
      >
        <span
          className={cn('size-2 rounded-full', meta.dot)}
          aria-hidden="true"
        />
        {meta.label}
      </Badge>
    </div>
  )
}

function PrLinker({
  disabled,
  onLink,
}: {
  disabled: boolean
  onLink: (ref: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!editing) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="h-7 justify-start gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3.5" />
        Link PR…
      </Button>
    )
  }

  // The shape check is local so obvious junk never costs a server round trip; the SERVER still
  // resolves what a bare number means, and reports its own failure through the rail's error line.
  const commit = () => {
    const value = draft.trim()
    if (!isPossiblePrRef(value)) {
      setError('Enter a GitHub pull request url or number (e.g. #42)')
      return
    }
    onLink(value)
    setEditing(false)
    setDraft('')
    setError(null)
  }

  const cancel = () => {
    setEditing(false)
    setDraft('')
    setError(null)
  }

  return (
    <div className="flex w-full flex-col gap-1">
      {/* autoFocus is deliberate: the input only exists after an explicit click on Link PR. */}
      <Input
        autoFocus
        aria-label="Pull request url or number"
        value={draft}
        disabled={disabled}
        placeholder="PR url or #42"
        onChange={(e) => {
          setDraft(e.target.value)
          if (error !== null && isPossiblePrRef(e.target.value)) setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') cancel()
        }}
        onBlur={cancel}
        className="h-7 px-2 text-sm"
      />
      {error !== null && (
        <p role="alert" className="px-0.5 text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  )
}
