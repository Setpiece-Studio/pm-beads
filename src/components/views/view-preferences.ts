// ABOUTME: Browser-local route preferences — keeps each project's Issues and Projects views
// ABOUTME: exactly as the person left them while saved views remain explicit, shareable states.

import { normalizeViewParams, type RawViewParams } from './view-params'

/** The issues route's narrower view vocabulary, without projects-only tree/order values. */
export interface IssueViewPreference {
  view?: 'board'
  grouping?: 'status' | 'project' | 'label' | 'none'
  ordering?: 'priority' | 'status' | 'updated'
  display?: string
  filter?: string
}

export interface ProjectViewPreference {
  view?: 'tree' | 'board' | 'gantt'
  display?: string
  grouping?: 'status' | 'none'
  ordering?:
    | 'priority'
    | 'updated'
    | 'created'
    | 'progress'
    | 'child-count'
    | 'title'
    | 'blocking'
  filter?: string
}

/** Per-project keys keep one project's route state from affecting another. */
export function issueViewPreferenceKey(project: string | undefined): string {
  return `pm-beads:issues-view:${project ?? 'default'}`
}

export function projectViewPreferenceKey(project: string | undefined): string {
  return `pm-beads:projects-view:${project ?? 'default'}`
}

/** TanStack supplies the route's grouping/ordering defaults on an ordinary `/issues` link.
 * Only a non-default view shape means navigation intentionally overrides the preference. */
export function hasExplicitIssueViewParams(params: RawViewParams): boolean {
  return Object.keys(normalizeIssueViewPreference(params)).length > 0
}

export function normalizeIssueViewPreference(
  raw: RawViewParams,
): IssueViewPreference {
  return normalizeViewParams('issues', raw) as IssueViewPreference
}

export function hasExplicitProjectViewParams(params: RawViewParams): boolean {
  return Object.keys(normalizeProjectViewPreference(params)).length > 0
}

export function normalizeProjectViewPreference(
  raw: RawViewParams,
): ProjectViewPreference {
  return normalizeViewParams('projects', raw) as ProjectViewPreference
}

export function readIssueViewPreference(
  key: string,
): IssueViewPreference | undefined {
  try {
    const value = window.localStorage.getItem(key)
    return value === null
      ? undefined
      : normalizeIssueViewPreference(JSON.parse(value) as RawViewParams)
  } catch {
    return undefined
  }
}

export function writeIssueViewPreference(
  key: string,
  raw: RawViewParams,
): void {
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify(normalizeIssueViewPreference(raw)),
    )
  } catch {
    // Private browsing or a full storage quota should not break the issues view.
  }
}

export function readProjectViewPreference(
  key: string,
): ProjectViewPreference | undefined {
  try {
    const value = window.localStorage.getItem(key)
    return value === null
      ? undefined
      : normalizeProjectViewPreference(JSON.parse(value) as RawViewParams)
  } catch {
    return undefined
  }
}

export function writeProjectViewPreference(
  key: string,
  raw: RawViewParams,
): void {
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify(normalizeProjectViewPreference(raw)),
    )
  } catch {
    // Private browsing or a full storage quota should not break the projects view.
  }
}
