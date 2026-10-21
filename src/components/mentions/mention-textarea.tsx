// ABOUTME: Textarea with keyboard-accessible @agent autocomplete from configured personas.

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useMentionCandidates } from './mention-context'

type Props = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'onChange'
> & {
  value: string
  onChange: (value: string) => void
}

interface MentionQuery {
  start: number
  end: number
  query: string
}

export function activeMentionQuery(
  value: string,
  caret: number,
): MentionQuery | null {
  const before = value.slice(0, caret)
  const match = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u.exec(before)
  if (match === null) return null
  const at = before.lastIndexOf('@')
  return { start: at, end: caret, query: match[1] ?? '' }
}

export function insertMention(
  value: string,
  mention: MentionQuery,
  key: string,
): { value: string; caret: number } {
  const inserted = `@${key} `
  const next = `${value.slice(0, mention.start)}${inserted}${value.slice(mention.end)}`
  return { value: next, caret: mention.start + inserted.length }
}

export function MentionTextarea({
  value,
  onChange,
  onKeyDown,
  className,
  ...props
}: Props) {
  const candidates = useMentionCandidates()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [mention, setMention] = useState<MentionQuery | null>(null)
  const [active, setActive] = useState(0)
  const matches = mention
    ? candidates.filter((candidate) => {
        const needle = mention.query.toLowerCase()
        return [candidate.key, ...(candidate.aliases ?? [])].some((address) =>
          address.toLowerCase().includes(needle),
        )
      })
    : []

  function refresh(next: string, caret: number) {
    setMention(activeMentionQuery(next, caret))
    setActive(0)
  }

  function choose(key: string) {
    if (mention === null) return
    const next = insertMention(value, mention, key)
    onChange(next.value)
    setMention(null)
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  return (
    <div className="relative">
      <textarea
        {...props}
        ref={ref}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          refresh(event.target.value, event.target.selectionStart)
        }}
        onClick={(event) =>
          refresh(event.currentTarget.value, event.currentTarget.selectionStart)
        }
        onKeyDown={(event) => {
          if (matches.length > 0) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const delta = event.key === 'ArrowDown' ? 1 : -1
              setActive(
                (index) => (index + delta + matches.length) % matches.length,
              )
              return
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              choose(matches[active]?.key ?? matches[0].key)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setMention(null)
              return
            }
          }
          onKeyDown?.(event)
        }}
        onBlur={() => setMention(null)}
        className={className}
      />
      {matches.length > 0 && (
        <div
          role="listbox"
          aria-label="Mention an agent"
          className="absolute bottom-full z-50 mb-1 max-h-52 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {matches.map((candidate, index) => (
            <button
              key={candidate.key}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(candidate.key)}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                index === active && 'bg-accent text-accent-foreground',
              )}
            >
              <span className="font-medium">@{candidate.key}</span>
              {candidate.isCurrentUser && (
                <span className="text-xs text-muted-foreground">You</span>
              )}
              {candidate.aliases && candidate.aliases.length > 0 && (
                <span className="truncate text-xs text-muted-foreground">
                  {candidate.aliases.join(', ')}
                </span>
              )}
              {candidate.tmux && (
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {candidate.tmux}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
