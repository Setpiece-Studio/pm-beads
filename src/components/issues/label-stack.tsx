// ABOUTME: Overlapping label stack for the issues table — the leading pill is fully readable
// ABOUTME: and the rest peek out as color dots, expanding to every pill on hover or focus.

import { useState } from 'react'
import { LabelPill, labelColorClass } from '@/lib/issue-meta'
import { cn } from '@/lib/utils'

/** Labels represented in the collapsed stack; anything beyond becomes the +N chip. */
export const LABEL_STACK_VISIBLE = 3

interface LabelStackProps {
  labels: string[]
  /** How many labels the collapsed stack shows before the +N chip takes over. */
  visibleCount?: number
  className?: string
}

export function LabelStack({
  labels,
  visibleCount = LABEL_STACK_VISIBLE,
  className,
}: LabelStackProps) {
  // Pointer and keyboard reveal the same way, so expansion is derived rather than toggled:
  // a click both focuses and fires onClick, and a toggle would collapse what focus opened.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const expanded = hovered || focused
  if (labels.length === 0) return null

  const stacked = labels.slice(0, visibleCount)
  const overflow = labels.length - stacked.length
  const shown = expanded ? labels : stacked
  const summary = labels.join(', ')

  return (
    // The stack itself is absolutely positioned so the expanded row floats over the
    // neighbouring cells instead of reflowing the table; the wrapper holds the row height.
    <span className={cn('relative flex h-5 justify-end', className)}>
      <button
        type="button"
        data-label-stack=""
        data-expanded={expanded ? 'true' : 'false'}
        // Deliberately not aria-expanded: the collapsed stack already names every label
        // here, so nothing is hidden from assistive tech and only the visuals change.
        aria-label={`Labels: ${summary}`}
        title={summary}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Reading the labels is not a request to open the issue the row points at.
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'absolute top-1/2 right-0 flex -translate-y-1/2 items-center rounded-full',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          expanded &&
            'z-20 gap-1 border border-border/70 bg-popover px-1 py-0.5 shadow-md',
        )}
      >
        {shown.map((label, index) => (
          <span
            key={label}
            data-label-stack-item=""
            // Earlier pills paint over later ones, so the leading pill stays fully legible.
            style={{ zIndex: labels.length - index }}
            className={cn(
              'relative min-w-0',
              !expanded && index > 0 && '-ml-2',
            )}
          >
            {expanded || index === 0 ? (
              // Collapsed, the leading pill is the one thing allowed to shrink: a long label
              // truncates inside the fixed column rather than spilling over the title.
              <LabelPill
                label={label}
                className={expanded ? undefined : 'max-w-full bg-background'}
              />
            ) : (
              <LabelDot label={label} />
            )}
          </span>
        ))}
        {expanded || overflow === 0 ? null : (
          <span className="relative ml-1 shrink-0 rounded-full border border-border/70 bg-background px-1.5 py-px text-xs leading-4 text-muted-foreground">
            +{overflow}
          </span>
        )}
      </button>
    </span>
  )
}

// The peeking layer of the stack: a label reduced to its palette dot in a chip the same
// height as a LabelPill, so overlapping rounds cleanly like an avatar stack.
function LabelDot({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-[1.125rem] shrink-0 items-center justify-center rounded-full border border-border/70 bg-background"
    >
      <span className={cn('size-2 rounded-full', labelColorClass(label))} />
    </span>
  )
}
