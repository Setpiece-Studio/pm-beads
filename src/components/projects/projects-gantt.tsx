// ABOUTME: Owner-grouped project roadmap with leaf-work sizing and completion fill.
// ABOUTME: Navigation-only bars and dependency arrows never mutate scheduling or issue state.

import { useId } from 'react'
import { beadRefTitle, StatusIcon } from '@/lib/issue-meta'
import type { GanttModel } from './projects-gantt-model'

const LABEL_WIDTH = 280
const ROW_HEIGHT = 36
const GROUP_HEIGHT = 28
const AXIS_HEIGHT = 32
const BAR_HEIGHT = 20
const BAR_INSET = (ROW_HEIGHT - BAR_HEIGHT) / 2
const UNIT_WIDTH = 28

export function ProjectsGantt({
  model,
  onSelect,
}: {
  model: GanttModel
  onSelect: (id: string) => void
}) {
  const marker = useId().replace(/:/g, '')
  const { lanes, links } = model
  if (!lanes.length)
    return (
      <p className="p-6 text-muted-foreground">
        No projects match the current filters
      </p>
    )

  let height = AXIS_HEIGHT
  const positioned = lanes.map((lane) => {
    const heading = height
    height += GROUP_HEIGHT
    const bars = lane.bars.map((bar) => {
      const top = height
      height += ROW_HEIGHT
      return { ...bar, top }
    })
    return { ...lane, heading, bars }
  })
  const bars = positioned.flatMap((lane) => lane.bars)
  const byId = new Map(bars.map((bar) => [bar.issue.id, bar]))
  const units = Math.max(10, ...bars.map((bar) => bar.end))
  const width = LABEL_WIDTH + units * UNIT_WIDTH + 40
  const tickStep = Math.max(1, Math.ceil(units / 30))

  return (
    <section aria-label="Project Gantt" className="min-w-0">
      <section
        className="overflow-x-auto"
        aria-label="Scrollable owner roadmap"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Enables keyboard scrolling of the roadmap.
        tabIndex={0}
      >
        <div
          className="relative isolate"
          style={{ width, minWidth: '100%', height }}
        >
          <div
            className="sticky left-0 z-20 border-r bg-background"
            style={{ width: LABEL_WIDTH, height }}
            data-testid="gantt-project-column"
          >
            <div
              className="flex items-center justify-between px-3 text-[11px] text-muted-foreground"
              style={{ height: AXIS_HEIGHT }}
            >
              <span>Project</span>
              <span>Completed</span>
            </div>
            {positioned.map((lane) => (
              <div key={lane.key}>
                <div
                  className="absolute inset-x-0 flex items-center gap-2 bg-muted px-3 text-xs font-medium"
                  style={{ top: lane.heading, height: GROUP_HEIGHT }}
                >
                  <span className="truncate">{lane.owner}</span>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    {lane.bars.length}
                  </span>
                </div>
                {lane.bars.map((bar) => (
                  <button
                    key={bar.issue.id}
                    type="button"
                    onClick={() => onSelect(bar.issue.id)}
                    title={`${beadRefTitle(bar.issue.id, bar.issue.title)} · ${bar.closed}/${bar.total} subissues complete`}
                    className="absolute inset-x-0 flex items-center gap-2 px-3 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    style={{ top: bar.top, height: ROW_HEIGHT }}
                  >
                    <StatusIcon status={bar.issue.status} />
                    <span className="min-w-0 flex-1 truncate">
                      {bar.issue.title}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {bar.closed}/{bar.total}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          {Array.from(
            { length: Math.floor(units / tickStep) + 1 },
            (_, i) => i * tickStep,
          ).map((tick) => (
            <div
              key={tick}
              className="pointer-events-none absolute bottom-0 top-0 border-l border-border/30"
              style={{ left: LABEL_WIDTH + tick * UNIT_WIDTH }}
            >
              <span className="absolute left-1 top-2 text-[10px] text-muted-foreground">
                {tick}
              </span>
            </div>
          ))}
          {positioned.map((lane) => (
            <div key={lane.key}>
              <div
                className="absolute right-0 bg-muted"
                style={{
                  left: LABEL_WIDTH,
                  top: lane.heading,
                  height: GROUP_HEIGHT,
                }}
              />
              {lane.bars.map((bar) => {
                const summary = `${bar.closed}/${bar.total} subissues complete`
                return (
                  <div key={bar.issue.id}>
                    <button
                      type="button"
                      aria-label={`${bar.issue.title}: ${summary}`}
                      title={`${beadRefTitle(bar.issue.id, bar.issue.title)} · ${summary}`}
                      onClick={() => onSelect(bar.issue.id)}
                      className="absolute overflow-hidden rounded border border-border bg-background shadow-xs hover:ring-2 hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-ring"
                      style={{
                        left: LABEL_WIDTH + bar.start * UNIT_WIDTH,
                        top: bar.top + BAR_INSET,
                        width: (bar.end - bar.start) * UNIT_WIDTH,
                        height: BAR_HEIGHT,
                      }}
                    >
                      <span
                        className="absolute inset-y-0 left-0 bg-primary/15"
                        style={{
                          width: `${bar.total ? (bar.closed / bar.total) * 100 : 0}%`,
                        }}
                      />
                      <span className="relative px-1 text-[11px] font-medium">
                        {bar.total}
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
          <svg
            className="pointer-events-none absolute inset-0"
            width={width}
            height={height}
            role="img"
            aria-label="Project prerequisite arrows"
          >
            <title>
              Project prerequisite arrows; amber indicates a sequence conflict
            </title>
            <defs>
              {['normal', 'conflict'].map((kind) => (
                <marker
                  key={kind}
                  id={`${marker}-${kind}`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M 0 0 L 10 5 L 0 10 z"
                    fill={kind === 'conflict' ? '#d97706' : '#64748b'}
                  />
                </marker>
              ))}
            </defs>
            {links.map((link) => {
              const from = byId.get(link.from)
              const to = byId.get(link.to)
              if (!from || !to) return null
              const x1 = LABEL_WIDTH + from.end * UNIT_WIDTH
              const x2 = LABEL_WIDTH + to.start * UNIT_WIDTH
              const y1 = from.top + ROW_HEIGHT / 2
              const y2 = to.top + BAR_INSET
              return (
                <path
                  key={`${link.from}-${link.to}`}
                  style={{ pointerEvents: 'stroke' }}
                  d={`M ${x1} ${y1} C ${x1 + 12} ${y1}, ${x1 + 12} ${y1 + 15}, ${x1} ${y1 + 15} L ${x2 + 8} ${y1 + 15} L ${x2 + 8} ${y2}`}
                  fill="none"
                  stroke={link.conflict ? '#d97706' : '#64748b'}
                  strokeWidth="1.5"
                  strokeDasharray={link.conflict ? '4 3' : undefined}
                  markerEnd={`url(#${marker}-${link.conflict ? 'conflict' : 'normal'})`}
                >
                  <title>
                    {`${from.issue.title} → ${to.issue.title}${link.conflict ? ' · Sequence conflict' : ''}`}
                  </title>
                </path>
              )
            })}
          </svg>
        </div>
      </section>
    </section>
  )
}
