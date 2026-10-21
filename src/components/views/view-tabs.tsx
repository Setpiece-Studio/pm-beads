// ABOUTME: Linear-style saved-view tabs row — an All tab, one tab per saved view for the
// ABOUTME: current route with hover-delete, and a save popover that names the current params.

import { Bookmark, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  type RawViewParams,
  type SavedView,
  type SavedViewParams,
  type ViewRoute,
  viewParamsEqual,
} from './view-params'

export interface ViewTabsProps {
  route: ViewRoute
  views: SavedView[]
  /** Raw current search params (view-shape keys); normalized for comparison. */
  currentParams: RawViewParams
  /** Apply a view's params ({} for the All tab). */
  onApply: (params: SavedViewParams) => void
  onSave: (name: string) => void
  onDelete: (id: string) => void
}

const tabClass = (active: boolean) =>
  cn(
    'rounded-md border px-2 py-0.5 text-xs whitespace-nowrap',
    active
      ? 'border-border bg-accent text-foreground'
      : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground',
  )

export function ViewTabs({
  route,
  views,
  currentParams,
  onApply,
  onSave,
  onDelete,
}: ViewTabsProps) {
  const [saveOpen, setSaveOpen] = useState(false)
  const [name, setName] = useState('')

  const routeViews = views.filter((view) => view.route === route)
  const allLabel = route === 'issues' ? 'All issues' : 'All projects'
  const allActive = viewParamsEqual(route, currentParams, {})

  function submitSave(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '') return
    onSave(trimmed)
    setName('')
    setSaveOpen(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-4 py-1.5">
      <button
        type="button"
        aria-current={allActive ? 'page' : undefined}
        className={tabClass(allActive)}
        onClick={() => onApply({})}
      >
        {allLabel}
      </button>
      {routeViews.map((view) => {
        const active =
          !allActive && viewParamsEqual(route, currentParams, view.params)
        return (
          // The delete control overlays the tab's right edge as a sibling so the
          // tab button keeps a clean accessible name (buttons cannot nest).
          <div key={view.id} className="group relative flex items-center">
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              className={cn(tabClass(active), 'pr-6')}
              onClick={() => onApply(view.params)}
            >
              {view.name}
            </button>
            <button
              type="button"
              aria-label={`Delete view ${view.name}`}
              className="absolute right-1.5 rounded-sm p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
              onClick={() => onDelete(view.id)}
            >
              <X className="size-3" />
            </button>
          </div>
        )
      })}
      <Popover open={saveOpen} onOpenChange={setSaveOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Save current view"
            className="ml-1 rounded-md p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            <Bookmark className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <form className="flex flex-col gap-2" onSubmit={submitSave}>
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="View name"
              aria-label="View name"
              className="h-7 text-xs"
            />
            <Button
              type="submit"
              size="sm"
              className="h-7 self-end text-xs"
              disabled={name.trim() === ''}
            >
              Save view
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  )
}
