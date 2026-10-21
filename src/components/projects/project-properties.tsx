// ABOUTME: Shared project metadata rendering and URL display vocabulary for all three views.
import { createContext, useContext } from 'react'
import type { EpicStatus } from '@/lib/beads/types'
import {
  BeadId,
  LabelPill,
  PriorityIcon,
  StatusIcon,
  shortDate,
} from '@/lib/issue-meta'
import { EpicProgress } from './epic-progress'

export const PROJECT_PROPERTIES = [
  'priority',
  'id',
  'status',
  'labels',
  'project',
  'created',
  'updated',
  'progress',
  'child-count',
] as const
export type ProjectProperty = (typeof PROJECT_PROPERTIES)[number]
export const DEFAULT_PROJECT_PROPERTIES = new Set<ProjectProperty>([
  'priority',
  'id',
  'status',
  'labels',
  'updated',
  'progress',
  'child-count',
])
export function parseProjectProperties(
  raw?: string,
): ReadonlySet<ProjectProperty> {
  return raw === undefined
    ? DEFAULT_PROJECT_PROPERTIES
    : new Set(
        raw
          .split(',')
          .filter((key): key is ProjectProperty =>
            (PROJECT_PROPERTIES as readonly string[]).includes(key),
          ),
      )
}
export function serializeProjectProperties(
  properties: ReadonlySet<ProjectProperty>,
): string | undefined {
  return properties.size === DEFAULT_PROJECT_PROPERTIES.size &&
    [...properties].every((key) => DEFAULT_PROJECT_PROPERTIES.has(key))
    ? undefined
    : PROJECT_PROPERTIES.filter((key) => properties.has(key)).join(',')
}
export const ProjectPropertiesContext = createContext<{
  properties: ReadonlySet<ProjectProperty>
  names: Record<string, string>
}>({ properties: DEFAULT_PROJECT_PROPERTIES, names: {} })
export function ProjectFields({ epic }: { epic: EpicStatus }) {
  const { properties: show, names } = useContext(ProjectPropertiesContext)
  const issue = epic.epic
  return (
    <>
      {show.has('priority') && <PriorityIcon priority={issue.priority} />}
      {show.has('status') && <StatusIcon status={issue.status} />}
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        {issue.title}
      </span>
      {show.has('id') && <BeadId id={issue.id} className="max-w-28 truncate" />}
      {show.has('labels') &&
        issue.labels?.map((label) => <LabelPill key={label} label={label} />)}
      {show.has('project') && issue.parent && (
        <span
          className="max-w-32 truncate text-xs text-muted-foreground"
          title={issue.parent}
        >
          {names[issue.parent] ?? issue.parent}
        </span>
      )}
      {show.has('child-count') && (
        <span
          className="text-xs tabular-nums text-muted-foreground"
          title="Child count"
        >
          {epic.total_children}
        </span>
      )}
      {show.has('progress') && (
        <span className="w-16">
          <EpicProgress
            closed={epic.closed_children}
            total={epic.total_children}
          />
        </span>
      )}
      {show.has('created') && (
        <span className="text-xs text-muted-foreground" title="Created">
          {shortDate(issue.created_at)}
        </span>
      )}
      {show.has('updated') && (
        <span className="text-xs text-muted-foreground" title="Updated">
          {shortDate(issue.updated_at)}
        </span>
      )}
    </>
  )
}
