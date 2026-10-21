// ABOUTME: Initials avatar for a message sender — a circle holding up to two letters, tinted
// ABOUTME: deterministically from the address so each correspondent keeps the same color.

import { cn } from '@/lib/utils'
import { initials } from './inbox-model'

// Muted, theme-safe tints. Kept as whole utility strings so Tailwind's scanner keeps them.
const TINTS = [
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
]

/** Stable index from the address: same correspondent, same tint across renders and reloads. */
function tintFor(name: string): string {
  let hash = 0
  for (const char of name.toLowerCase())
    hash = (hash * 31 + char.charCodeAt(0)) % 4093
  return TINTS[hash % TINTS.length]
}

export function InitialsAvatar({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="initials-avatar"
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
        tintFor(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
