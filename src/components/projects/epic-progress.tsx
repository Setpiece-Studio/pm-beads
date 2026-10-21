// ABOUTME: Small circular progress indicator for an epic, Linear-style: a pie ring filled
// ABOUTME: proportionally to closed/total children, with a closed/total fraction label.

import { progressPercent } from './projects-model'

const RADIUS = 6
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function EpicProgress({
  closed,
  total,
}: {
  closed: number
  total: number
}) {
  const percent = progressPercent(closed, total)
  return (
    <span
      className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground"
      title={`${percent}% done`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        className="shrink-0 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="8"
          cy="8"
          r={RADIUS}
          fill="none"
          strokeWidth="2"
          className="stroke-border"
        />
        <circle
          cx="8"
          cy="8"
          r={RADIUS}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          className="stroke-indigo-500"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
        />
      </svg>
      {closed}/{total}
    </span>
  )
}
