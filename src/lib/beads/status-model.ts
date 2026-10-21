// ABOUTME: Client-safe status-pipeline schema and normalization shared by config readers and UI.
// ABOUTME: Project config controls ordering/icons; configured and observed Beads statuses are merged safely.

import { z } from 'zod'

export const statusIconNames = [
  'circle',
  'circle-dot',
  'circle-dashed',
  'ban',
  'check-circle',
  'moon',
  'clock',
  'eye',
  'flask',
  'rocket',
  'shield-check',
] as const

export type StatusIconName = (typeof statusIconNames)[number]

export const statusConfigBlockSchema = z.object({
  pipeline: z.array(z.string().trim().min(1)).optional(),
  icons: z.record(z.string(), z.enum(statusIconNames)).optional(),
})

export interface StatusPipeline {
  statuses: string[]
  icons: Record<string, StatusIconName>
  /** True when the project declared its own `pipeline`. An authored order is an intention, so
   * it governs every view; a derived one leaves each view its own default reading order. */
  authored: boolean
}

export const DEFAULT_STATUS_PIPELINE: StatusPipeline = {
  statuses: ['deferred', 'open', 'in_progress', 'blocked', 'closed'],
  icons: {},
  authored: false,
}

/** Reading order for grouped lists: work in flight first, then what is stuck, then what can be
 * picked up, then what is parked, then what is finished. Deliberately not the pipeline order,
 * which reads left-to-right as a workflow — that is what board columns want. */
export const DEFAULT_LIST_STATUS_ORDER = [
  'in_progress',
  'blocked',
  'open',
  'deferred',
  'closed',
] as const

/** The status every ordering ends on — bd's terminal state, and the one position a project
 * should not be able to lose by inventing a status. */
export const TERMINAL_STATUS = 'closed'

/**
 * Place the statuses an ordering does not name. They land immediately before the terminal
 * status rather than after it: an ordering is a claim about how work flows, and a status it
 * never mentions is somewhere mid-flight, not past Done. Appending instead put a board's
 * "Done" column in the middle and sank a custom status below the closed group in a list
 * (pm-beads-r8l.3). An ordering with no terminal status simply takes the rest at the end.
 */
function placeUnordered(
  ordering: readonly string[],
  rest: readonly string[],
): string[] {
  const order = unique(ordering)
  const named = new Set(order)
  const unplaced = unique(rest).filter((status) => !named.has(status))
  if (unplaced.length === 0) return order
  const terminal = order.indexOf(TERMINAL_STATUS)
  if (terminal === -1) return [...order, ...unplaced]
  return [...order.slice(0, terminal), ...unplaced, ...order.slice(terminal)]
}

export function buildStatusPipeline({
  observed = [],
  configured = [],
  block,
}: {
  observed?: readonly string[]
  configured?: readonly string[]
  block?: unknown
}): StatusPipeline {
  const parsed = statusConfigBlockSchema.safeParse(block)
  const project = parsed.success ? parsed.data : {}
  // `observed` arrives in whatever order bd listed the beads, which bd promises nothing about.
  // A built-in seen on a bead is already placed by the built-in order, so only the statuses
  // nothing else knows about are contributed — sorted, so the same project always reads the
  // same way (pm-beads-7i1.1).
  const builtIn = new Set<string>(DEFAULT_STATUS_PIPELINE.statuses)
  const discovered = unique(
    observed.filter((status) => !builtIn.has(status.trim())),
  ).sort()
  // The project's own pipeline is the skeleton when it authored one, the built-in order when it
  // did not; everything else — bd's `status.custom`, the statuses beads are actually wearing,
  // and any built-in the skeleton left out — fills in around it, ahead of the terminal status.
  const statuses = placeUnordered(
    project.pipeline ?? DEFAULT_STATUS_PIPELINE.statuses,
    [...configured, ...discovered, ...DEFAULT_STATUS_PIPELINE.statuses],
  )
  return {
    statuses,
    icons: project.icons ?? {},
    authored: project.pipeline !== undefined,
  }
}

/**
 * The order a grouped list reads in. A project that authored a pipeline has said how its work
 * flows, so that order governs the lists too; otherwise the list keeps its triage order and
 * only borrows the statuses the pipeline discovered.
 */
export function listStatusOrder(pipeline: StatusPipeline): readonly string[] {
  if (pipeline.authored) return pipeline.statuses
  return placeUnordered(DEFAULT_LIST_STATUS_ORDER, pipeline.statuses)
}

export function parseConfiguredStatuses(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return unique(value.split(/[\s,]+/).filter(Boolean))
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
