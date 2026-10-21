// ABOUTME: Small circular assignee avatar — initials on a stable per-name color, with a dashed
// ABOUTME: empty state for unassigned rows. Beads stores a plain name, so there is no image to load.

import { LABEL_PALETTE } from '@/lib/issue-meta'
import { cn } from '@/lib/utils'

/** "ben harper" → "BH"; "ben" → "BE". Punctuation-separated handles split too ("a.b" → "AB"). */
export function initialsOf(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

// Same hash-into-a-fixed-palette trick label dots use, so a given assignee is always one color.
function avatarColorClass(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return LABEL_PALETTE[hash % LABEL_PALETTE.length]
}

export function AssigneeAvatar({
  assignee,
  className,
}: {
  assignee?: string
  className?: string
}) {
  const name = assignee?.trim()
  if (!name) {
    return (
      <span
        role="img"
        aria-label="Unassigned"
        title="Unassigned"
        className={cn(
          'size-5 shrink-0 rounded-full border border-dashed border-border',
          className,
        )}
      />
    )
  }
  return (
    <span
      role="img"
      aria-label={`Assigned to ${name}`}
      title={name}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium leading-none text-white',
        avatarColorClass(name),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  )
}
