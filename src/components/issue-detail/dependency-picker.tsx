// ABOUTME: Two-step "+ Add relationship" picker — choose a relationship (type + direction,
// ABOUTME: labeled via dependency-meta) then search/select a target issue from listCandidates.

import { ChevronRight, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  type DependencyDirection,
  dependencyGroupLabel,
  GROUP_ORDER,
} from '@/lib/beads/dependency-meta'
import type { Issue } from '@/lib/beads/types'
import { beadRefTitle, StatusIcon } from '@/lib/issue-meta'

// The relationships offered in step 1, ordered to match the rail's group display. Derived from
// dependency-meta's GROUP_ORDER so picker order and rail grouping share one source and can't drift.
const RELATIONSHIP_CHOICES: ReadonlyArray<{
  type: string
  direction: DependencyDirection
}> = GROUP_ORDER.map(([type, direction]) => ({ type, direction }))

export interface RelationshipChoice {
  type: string
  direction: DependencyDirection
}

export interface DependencyPickerProps {
  /** Fetches candidate issues each time the picker opens. */
  listCandidates: () => Promise<Issue[]>
  /** Ids excluded from candidates for the chosen relationship (current issue + already linked). */
  excludedIds: (choice: RelationshipChoice) => Set<string>
  /** Disable the trigger while a mutation is in flight. */
  disabled?: boolean
  /** Called with the chosen relationship and target issue id. */
  onConfirm: (choice: RelationshipChoice, targetId: string) => void
}

export function DependencyPicker({
  listCandidates,
  excludedIds,
  disabled,
  onConfirm,
}: DependencyPickerProps) {
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<RelationshipChoice | null>(null)
  const [candidates, setCandidates] = useState<Issue[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Reset to step 1 whenever the popover closes so reopening starts fresh. Clearing candidates
  // back to null is what makes each open re-fetch: a stale list never persists across opens, and a
  // prior fetch error is dropped so reopening retries instead of staying broken for the session.
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setChoice(null)
      setError(null)
      setCandidates(null)
    }
  }

  // Load candidates once per open. Candidates are relationship-independent (exclusions are computed
  // client-side per choice), so the fetch doesn't re-fire on choice change — only `open` and the
  // load-once guard drive it. handleOpenChange resets candidates to null on close, so each reopen
  // re-fetches fresh and clears any prior error.
  useEffect(() => {
    if (!open || candidates !== null) return
    let cancelled = false
    setError(null)
    listCandidates().then(
      (list) => {
        if (!cancelled) setCandidates(list)
      },
      () => {
        if (!cancelled) {
          setCandidates([])
          setError('Could not load issues.')
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, candidates, listCandidates])

  const excluded = choice ? excludedIds(choice) : new Set<string>()
  const targets = (candidates ?? []).filter((issue) => !excluded.has(issue.id))

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-7 justify-start gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3.5" />
          Add relationship
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0 text-[13px]">
        {choice === null ? (
          <Command>
            <CommandInput placeholder="Relationship..." />
            <CommandList>
              <CommandEmpty>No matches</CommandEmpty>
              {RELATIONSHIP_CHOICES.map((rel) => {
                const label = dependencyGroupLabel(rel.type, rel.direction)
                return (
                  <CommandItem
                    key={`${rel.type}:${rel.direction}`}
                    value={label}
                    onSelect={() => setChoice(rel)}
                  >
                    {label}
                    <ChevronRight className="ml-auto size-3.5 text-muted-foreground/60" />
                  </CommandItem>
                )
              })}
            </CommandList>
          </Command>
        ) : (
          <Command>
            <CommandInput
              placeholder={`${dependencyGroupLabel(choice.type, choice.direction)}…`}
            />
            <CommandList>
              <CommandEmpty>
                {error ??
                  (candidates === null ? 'Loading…' : 'No matching issues.')}
              </CommandEmpty>
              {targets.map((issue) => (
                <CommandItem
                  key={issue.id}
                  // Typing an id still finds the bead — the value carries both; only the
                  // rendered row is title-first.
                  value={`${issue.id} ${issue.title}`}
                  onSelect={() => {
                    handleOpenChange(false)
                    onConfirm(choice, issue.id)
                  }}
                  title={beadRefTitle(issue.id, issue.title)}
                >
                  <StatusIcon status={issue.status} />
                  <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}
