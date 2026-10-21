// ABOUTME: Compact Linear-inspired Actions UI backed by parsed ask.* issue metadata.
// ABOUTME: Actions are checkable; decisions, checks, and reviews accept persisted free text.

import {
  Check,
  ChevronRight,
  CircleCheckBig,
  Eye,
  ListChecks,
  Scale,
} from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Ask, AskKind } from '@/lib/beads/asks'
import { isAskOpen } from '@/lib/beads/asks'
import { cn } from '@/lib/utils'
import { SectionHeading } from './detail-chrome'

export function orderAsks(asks: readonly Ask[]): Ask[] {
  return asks
    .map((ask, index) => ({ ask, index }))
    .sort(
      (a, b) =>
        Number(!isAskOpen(a.ask)) - Number(!isAskOpen(b.ask)) ||
        a.index - b.index,
    )
    .map(({ ask }) => ask)
}

export function MilestonesSection({
  asks,
  invalidKeys = [],
  saving = false,
  onAnswer,
}: {
  asks: readonly Ask[]
  invalidKeys?: readonly string[]
  saving?: boolean
  // The rail's actions resolve to whether the write landed; this section ignores the outcome,
  // so the return type only has to be wide enough to accept it.
  onAnswer: (key: string, answer: string | null) => unknown
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(asks.filter(isAskOpen).map((ask) => ask.key)),
  )
  const ordered = useMemo(() => orderAsks(asks), [asks])

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <section className="flex flex-col gap-1" aria-labelledby="actions-title">
      <SectionHeading>
        <span id="actions-title">Actions</span>
      </SectionHeading>

      <div className="flex flex-col gap-0.5">
        {ordered.map((ask) => {
          const isExpanded = expanded.has(ask.key)
          const isCompleted = !isAskOpen(ask)
          const panelId = `ask-${ask.key}`

          return (
            <article
              key={ask.key}
              data-testid="ask-row"
              data-ask-key={ask.key}
              data-completed={isCompleted ? 'true' : 'false'}
              className={cn(isCompleted && 'text-muted-foreground')}
            >
              <div
                className={cn(
                  'flex items-start gap-2 rounded-md px-1 py-1 transition-colors hover:bg-accent/50',
                  isCompleted && 'opacity-65',
                )}
              >
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={panelId}
                  onClick={() => toggleExpanded(ask.key)}
                  className="flex min-w-0 flex-1 items-start gap-2 rounded text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <AskIcon kind={ask.kind} completed={isCompleted} />
                  <span
                    className={cn(
                      'min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere text-[13px] font-medium leading-5',
                      isCompleted &&
                        'line-through decoration-muted-foreground/50',
                    )}
                  >
                    {ask.q}
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform',
                      isExpanded && 'rotate-90',
                    )}
                  />
                </button>

                {ask.kind === 'action' && (
                  <label className="flex size-5 shrink-0 cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      checked={isCompleted}
                      disabled={saving}
                      onChange={() =>
                        onAnswer(ask.key, isCompleted ? null : 'done')
                      }
                      aria-label={`${isCompleted ? 'Reopen' : 'Complete'} ${ask.q}`}
                      className="peer sr-only"
                    />
                    <span className="flex size-4 items-center justify-center rounded border border-input bg-background text-transparent transition-colors peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
                      <Check
                        aria-hidden="true"
                        className="size-3"
                        strokeWidth={3}
                      />
                    </span>
                  </label>
                )}
              </div>

              {isExpanded && (
                <div
                  id={panelId}
                  className="flex flex-col gap-2 pb-2 pl-8 pr-6"
                >
                  {ask.note && (
                    <p className="whitespace-pre-wrap wrap-anywhere text-[13px] leading-5 text-muted-foreground">
                      {ask.note}
                    </p>
                  )}
                  {ask.kind === 'action' ? (
                    ask.steps && ask.steps.length > 0 ? (
                      <ol className="flex flex-col gap-1.5 text-[13px]">
                        {ask.steps.map((step, index) => (
                          <li key={step} className="flex items-start gap-2">
                            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                              {index + 1}
                            </span>
                            <span className="min-w-0 whitespace-pre-wrap wrap-anywhere leading-5">
                              {step}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : null
                  ) : (
                    <AskAnswer ask={ask} saving={saving} onSubmit={onAnswer} />
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>

      {invalidKeys.length > 0 && (
        <p role="alert" className="text-[11px] text-destructive">
          {invalidKeys.length} malformed ask{' '}
          {invalidKeys.length === 1 ? 'entry was' : 'entries were'} skipped.
        </p>
      )}
    </section>
  )
}

function AskIcon({ kind, completed }: { kind: AskKind; completed: boolean }) {
  const Icon = {
    action: ListChecks,
    decision: Scale,
    check: CircleCheckBig,
    review: Eye,
  }[kind]
  const colors = {
    action: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
    decision: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
    check: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
    review: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  }[kind]

  return (
    <span
      role="img"
      aria-label={kind[0]?.toUpperCase() + kind.slice(1)}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-[5px]',
        colors,
        completed && 'bg-muted text-muted-foreground',
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2} />
    </span>
  )
}

function AskAnswer({
  ask,
  saving,
  onSubmit,
}: {
  ask: Ask
  saving: boolean
  onSubmit: (key: string, answer: string | null) => unknown
}) {
  const [draft, setDraft] = useState(ask.answer ?? '')
  const placeholder = {
    decision: 'Write an answer…',
    check: 'Record what you verified…',
    review: 'Leave review feedback…',
    action: 'Write an answer…',
  }[ask.kind]

  useEffect(() => setDraft(ask.answer ?? ''), [ask.answer])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const answer = draft.trim()
    if (answer !== '') onSubmit(ask.key, answer)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={`Answer ${ask.q}`}
          placeholder={placeholder}
          className="h-8 text-[13px]"
        />
        <Button
          type="submit"
          size="sm"
          disabled={
            saving || draft.trim() === '' || draft.trim() === ask.answer
          }
        >
          Submit
        </Button>
      </div>
      {ask.answer && (
        <p role="status" className="text-[11px] text-muted-foreground">
          Answered by {ask.answered_by}.
        </p>
      )}
    </form>
  )
}
