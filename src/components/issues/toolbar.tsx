// ABOUTME: Issues view toolbar — Linear-style filter bar (add-filter menu + compound chips)
// ABOUTME: on the left, and the merged-PR sweep, overflow menu, and display options on the right.

import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { FilterBar } from '@/components/filters/filter-bar'
import {
  type ActiveFilter,
  type FilterProperty,
  type FilterValueOption,
  ISSUE_FILTER_PROPERTIES,
} from '@/components/filters/filters'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { BackfillProposal } from '@/lib/beads/pr-backfill'
import type {
  BackfillApplyResult,
  BackfillScanResult,
} from '@/lib/beads/pr-backfill-run'
import type { SweepResult } from '@/lib/beads/pr-sweep-run'
import { BackfillPrs } from './backfill-prs'
import type { ViewMode } from './board-logic'
import { DisplayOptions, type DisplayOptionsPatch } from './display-options'
import type { DisplayProperty, GroupingKey, OrderingKey } from './grouping'
import { SweepMergedPrs } from './sweep-merged-prs'

export interface ToolbarPatch {
  view?: ViewMode
  grouping?: GroupingKey
  ordering?: OrderingKey
  displayProperties?: ReadonlySet<DisplayProperty>
  filters?: ActiveFilter[]
}

/** The PR-history backfill's three server calls. Absent hides both ways into the panel. */
export interface BackfillHandlers {
  scan: (daysBack: number) => Promise<BackfillScanResult>
  apply: (proposals: BackfillProposal[]) => Promise<BackfillApplyResult>
  skip: (ids: string[]) => Promise<void>
}

interface IssuesToolbarProps {
  view: ViewMode
  grouping: GroupingKey
  ordering: OrderingKey
  displayProperties: ReadonlySet<DisplayProperty>
  filters: ActiveFilter[]
  valueOptions: Record<FilterProperty, FilterValueOption[]>
  onChange: (patch: ToolbarPatch) => void
  /** Runs the merged-PR sweep for the selected project; absent hides the control. */
  sweep?: (dryRun: boolean) => Promise<SweepResult>
  /** Runs the PR-history backfill for the selected project; absent hides it. */
  backfill?: BackfillHandlers
  /** Open one of the swept or proposed beads. */
  onSelectIssue?: (id: string) => void
  /** A real sweep or an applied backfill wrote to bd — the list below is now stale. */
  onSwept?: () => void
}

export function IssuesToolbar({
  view,
  grouping,
  ordering,
  displayProperties,
  filters,
  valueOptions,
  onChange,
  sweep,
  backfill,
  onSelectIssue,
  onSwept,
}: IssuesToolbarProps) {
  // The backfill panel is a dialog with two ways in — the sweep popover and the overflow menu
  // — so the toolbar, not either trigger, owns whether it is open.
  const [backfillOpen, setBackfillOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-1.5">
      <FilterBar
        properties={ISSUE_FILTER_PROPERTIES}
        filters={filters}
        valueOptions={valueOptions}
        onChange={(next) => onChange({ filters: next })}
      />
      <div className="ml-auto flex items-center gap-1">
        {sweep !== undefined && (
          <SweepMergedPrs
            sweep={sweep}
            onSelectIssue={onSelectIssue}
            onSwept={onSwept}
            {...(backfill !== undefined && {
              onBackfill: () => setBackfillOpen(true),
            })}
          />
        )}
        {backfill !== undefined && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="More issue actions"
                className="h-7 px-1.5 text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setBackfillOpen(true)}>
                Backfill from PR history…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DisplayOptions
          view={view}
          grouping={grouping}
          ordering={ordering}
          displayProperties={displayProperties}
          onChange={(patch: DisplayOptionsPatch) => onChange(patch)}
        />
      </div>
      {backfill !== undefined && (
        <BackfillPrs
          open={backfillOpen}
          onOpenChange={setBackfillOpen}
          scan={backfill.scan}
          apply={backfill.apply}
          skip={backfill.skip}
          onSelectIssue={onSelectIssue}
          onApplied={onSwept}
        />
      )}
    </div>
  )
}
