// ABOUTME: Shared issue presentation primitives — status/priority icons, labels, sort orders,
// ABOUTME: and time formatting used by the issues view, projects view, and detail panel.

import {
  Ban,
  Box,
  Bug,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  Clock3,
  Eye,
  FlaskConical,
  ListTodo,
  Moon,
  Rocket,
  Scale,
  ShieldCheck,
  Sparkles,
  Tag,
  Wrench,
} from 'lucide-react'
import { useStatusPipeline } from '@/components/status-pipeline-context'
import {
  DEFAULT_LIST_STATUS_ORDER,
  type StatusIconName,
} from '@/lib/beads/status-model'
import { cn } from '@/lib/utils'

/** The list reading order, re-exported under the name every view already asks for. It lives in
 * status-model beside the pipeline order so the two defaults stay declared together. */
export const STATUS_ORDER = DEFAULT_LIST_STATUS_ORDER

export const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  deferred: 'Deferred',
  closed: 'Done',
}

/**
 * A status's display name. The built-ins are named above (bd's `closed` reads as "Done"); a
 * project's custom status has no name anywhere to read, so its bd key is title-cased —
 * `awaiting_deploy` becomes "Awaiting Deploy". Showing the raw key made a board column and a
 * group heading read as code next to the built-ins beside them (pm-beads-r8l.3).
 */
export function statusLabel(status: string): string {
  const known = STATUS_LABELS[status]
  if (known !== undefined) return known
  const words = status.split(/[\s_-]+/).filter(Boolean)
  if (words.length === 0) return status
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function statusRank(
  status: string,
  order: readonly string[] = STATUS_ORDER,
): number {
  const i = order.indexOf(status)
  return i === -1 ? order.length : i
}

function defaultStatusIcon(status: string): StatusIconName {
  switch (status) {
    case 'in_progress':
      return 'circle-dot'
    case 'blocked':
      return 'ban'
    case 'closed':
      return 'check-circle'
    case 'deferred':
      return 'moon'
    case 'open':
      return 'circle'
    default:
      return 'circle-dashed'
  }
}

export function StatusIcon({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const { icons } = useStatusPipeline()
  const cls = cn('size-3.5 shrink-0', className)
  const icon = icons[status] ?? defaultStatusIcon(status)
  switch (icon) {
    case 'circle-dot':
      return <CircleDot className={cn(cls, 'text-yellow-500')} />
    case 'ban':
      return <Ban className={cn(cls, 'text-red-500')} />
    case 'check-circle':
      return <CheckCircle2 className={cn(cls, 'text-indigo-500')} />
    case 'moon':
      return <Moon className={cn(cls, 'text-muted-foreground')} />
    case 'circle':
      return <Circle className={cn(cls, 'text-muted-foreground')} />
    case 'clock':
      return <Clock3 className={cn(cls, 'text-muted-foreground')} />
    case 'eye':
      return <Eye className={cn(cls, 'text-blue-500')} />
    case 'flask':
      return <FlaskConical className={cn(cls, 'text-purple-500')} />
    case 'rocket':
      return <Rocket className={cn(cls, 'text-orange-500')} />
    case 'shield-check':
      return <ShieldCheck className={cn(cls, 'text-green-500')} />
    case 'circle-dashed':
      return <CircleDashed className={cn(cls, 'text-muted-foreground')} />
  }
}

// A small filled red dot flagging an issue with an unresolved blocking dependency. Deliberately
// distinct from the `blocked` STATUS's red Ban icon (above): this is edge-derived (a blocks edge to
// a non-closed issue), so the two can co-occur without being confused. Renders an accessible label.
export function BlockedIndicator({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Has an unresolved blocker"
      title="Has an unresolved blocker"
      className={cn(
        'inline-block size-2 shrink-0 rounded-full bg-red-500',
        className,
      )}
    />
  )
}

export const PRIORITY_LABELS = ['Urgent', 'High', 'Medium', 'Low', 'Backlog']

export function priorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority] ?? `P${priority}`
}

// Linear-style priority glyph: stacked bars for P1-P3, alert square for P0, dashes for backlog.
export function PriorityIcon({
  priority,
  className,
}: {
  priority: number
  className?: string
}) {
  if (priority === 0) {
    return (
      <span
        title="Urgent"
        className={cn(
          'flex size-3.5 shrink-0 items-center justify-center rounded-[3px] bg-orange-500 text-[9px] font-bold leading-none text-white',
          className,
        )}
      >
        !
      </span>
    )
  }
  if (priority >= 4) {
    return (
      <span
        title="Backlog"
        className={cn(
          'flex size-3.5 shrink-0 items-end justify-center gap-px pb-0.5 text-muted-foreground',
          className,
        )}
      >
        <span className="size-0.5 rounded-full bg-current" />
        <span className="size-0.5 rounded-full bg-current" />
        <span className="size-0.5 rounded-full bg-current" />
      </span>
    )
  }
  const active = 4 - priority // P1 → 3 bars, P2 → 2, P3 → 1
  return (
    <span
      title={priorityLabel(priority)}
      className={cn('flex size-3.5 shrink-0 items-end gap-px pb-px', className)}
    >
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className={cn(
            'w-1 rounded-[1px]',
            bar === 1 && 'h-1.5',
            bar === 2 && 'h-2.5',
            bar === 3 && 'h-3.5',
            bar <= active ? 'bg-foreground/70' : 'bg-foreground/20',
          )}
        />
      ))}
    </span>
  )
}

export const TYPE_LABELS: Record<string, string> = {
  task: 'Task',
  bug: 'Bug',
  feature: 'Feature',
  epic: 'Epic',
  chore: 'Chore',
  decision: 'Decision',
}

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

// Per-type glyph for the detail rail's Type selector. Epic reuses the Box icon that already
// marks projects/epics elsewhere (EpicChip) so the two stay visually consistent. An unknown
// custom type falls back to a neutral tag.
export function TypeIcon({
  type,
  className,
}: {
  type: string
  className?: string
}) {
  const cls = cn('size-3.5 shrink-0', className)
  switch (type) {
    case 'bug':
      return <Bug className={cn(cls, 'text-red-500')} />
    case 'feature':
      return <Sparkles className={cn(cls, 'text-purple-500')} />
    case 'epic':
      return <Box className={cn(cls, 'text-indigo-500')} />
    case 'chore':
      return <Wrench className={cn(cls, 'text-muted-foreground')} />
    case 'decision':
      return <Scale className={cn(cls, 'text-blue-500')} />
    case 'task':
      return <ListTodo className={cn(cls, 'text-muted-foreground')} />
    default:
      return <Tag className={cn(cls, 'text-muted-foreground')} />
  }
}

// Stable per-label colors: hash the label name into a pleasant 8-color palette so the
// same label always renders the same dot color, Linear-style.
export const LABEL_PALETTE = [
  'bg-red-500',
  'bg-orange-500',
  'bg-yellow-500',
  'bg-green-500',
  'bg-blue-500',
  'bg-indigo-500',
  'bg-purple-500',
  'bg-pink-500',
] as const

export function labelColorClass(label: string): string {
  let hash = 0
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0
  }
  return LABEL_PALETTE[hash % LABEL_PALETTE.length]
}

// Rounded-full outline pill with a colored dot — Linear's label chip.
export function LabelPill({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 px-2 py-px text-xs leading-4 text-muted-foreground',
        className,
      )}
    >
      <span
        className={cn('size-2 rounded-full', labelColorClass(label))}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
    </span>
  )
}

// Muted rounded pill with a tiny box icon — Linear's project/epic chip.
export function EpicChip({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-48 shrink-0 items-center gap-1 rounded-full border border-border/70 px-2 py-px text-xs leading-4 text-muted-foreground',
        className,
      )}
    >
      <Box className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  )
}

/**
 * The hover text for a bead reference. A reference reads as its title, so the id lives in the
 * `title` attribute — which is also where a truncated title becomes readable in full. A bead
 * whose title the caller does not hold (not in the loaded set) falls back to the bare id.
 */
export function beadRefTitle(id: string, title?: string): string {
  const trimmed = title?.trim() ?? ''
  return trimmed === '' ? id : `${trimmed} · ${id}`
}

// The id as secondary text after a bead's title, where the row is wide enough to carry both.
// Narrow places (chips, rails, popovers) leave it to `beadRefTitle` and the hover instead.
export function BeadId({ id, className }: { id: string; className?: string }) {
  return (
    <span
      className={cn(
        'shrink-0 font-mono text-xs text-muted-foreground',
        className,
      )}
    >
      {id}
    </span>
  )
}

// Short calendar date for row metadata: "Jun 12" this year, "Jun 12, 2025" otherwise.
export function shortDate(iso: string): string {
  const date = new Date(iso)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric'
  return date.toLocaleDateString('en-US', opts)
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round(months / 12)}y`
}
