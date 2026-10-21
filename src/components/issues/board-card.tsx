// ABOUTME: Presentational board card — Linear anatomy: clamped title with status icon on the
// ABOUTME: top row, then a metadata row of muted id, priority, labels, project. No DnD here.

import type { Issue } from '@/lib/beads/types'
import {
  BeadId,
  BlockedIndicator,
  beadRefTitle,
  EpicChip,
  LabelPill,
  PriorityIcon,
  StatusIcon,
  statusLabel,
} from '@/lib/issue-meta'
import { cn } from '@/lib/utils'
import type { BoardCardProperties } from './board-logic'

interface BoardCardProps {
  issue: Issue
  epicNames: Record<string, string>
  properties: BoardCardProperties
  /** True when the issue has an unresolved blocking dependency (edge-derived, R11). */
  blocked?: boolean
  /** True while a drag-initiated status write for this card is in flight. */
  saving?: boolean
  onClick: () => void
}

export function BoardCard({
  issue,
  epicNames,
  properties,
  blocked = false,
  saving = false,
  onClick,
}: BoardCardProps) {
  return (
    <button
      type="button"
      data-board-card={issue.id}
      onClick={onClick}
      disabled={saving}
      title={beadRefTitle(issue.id, issue.title)}
      className={cn(
        'flex w-full flex-col gap-1.5 rounded-lg border bg-card p-3 text-left text-[13px] transition-shadow hover:shadow-sm',
        saving && 'pointer-events-none opacity-50',
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 min-w-0 flex-1 font-medium leading-snug">
          {issue.title}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {blocked ? <BlockedIndicator /> : null}
          <span role="img" aria-label={statusLabel(issue.status)}>
            <StatusIcon status={issue.status} />
          </span>
        </span>
      </span>
      {/* The id is metadata under the name, on the same line as the other chips — it stays
          scannable down a column without being what the card announces. */}
      <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <BeadId id={issue.id} />
        {properties.priority ? (
          <PriorityIcon priority={issue.priority} />
        ) : null}
        {properties.labels
          ? issue.labels?.map((label) => (
              <LabelPill key={label} label={label} />
            ))
          : null}
        {properties.project && issue.parent ? (
          <EpicChip name={epicNames[issue.parent] ?? issue.parent} />
        ) : null}
      </span>
    </button>
  )
}
