// ABOUTME: Saved-views sidecar store — reads/writes .beads/pm-beads-views.json in a beads
// ABOUTME: project dir with lenient zod validation and atomic writes under the process mutex.

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  generateViewId,
  normalizeViewParams,
  type RawViewParams,
  type SavedView,
  VIEW_ROUTES,
  type ViewRoute,
} from '@/components/views/view-params'
import { withProcessLock } from './cli'

const savedViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  route: z.enum(VIEW_ROUTES),
  // Same shape normalizeViewParams produces; hand-edited entries with values
  // outside it are skipped by the lenient read.
  params: z.object({
    view: z.enum(['board', 'tree', 'gantt']).optional(),
    grouping: z.enum(['status', 'project', 'label', 'none']).optional(),
    ordering: z.enum(['priority', 'status', 'updated']).optional(),
    display: z.string().optional(),
    filter: z.string().optional(),
  }),
})

const sidecarSchema = z.object({
  version: z.number(),
  views: z.array(z.unknown()),
})

export function viewsFilePath(projectDir: string): string {
  return join(projectDir, '.beads', 'pm-beads-views.json')
}

/** Lenient read: missing/corrupt file or wrapper means no views; invalid
 * individual entries are skipped rather than failing the whole list. */
export function readViews(projectDir: string): SavedView[] {
  let raw: string
  try {
    raw = readFileSync(viewsFilePath(projectDir), 'utf8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const wrapper = sidecarSchema.safeParse(parsed)
  if (!wrapper.success) return []
  return wrapper.data.views.flatMap((entry) => {
    const view = savedViewSchema.safeParse(entry)
    return view.success ? [view.data] : []
  })
}

/** Atomic write: tmp file in the same directory, then rename over the target. */
function writeViews(projectDir: string, views: SavedView[]): void {
  const path = viewsFilePath(projectDir)
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify({ version: 1, views }, null, 2)}\n`)
  renameSync(tmp, path)
}

export interface SaveViewInput {
  name: string
  route: ViewRoute
  params: RawViewParams
}

/** Save a view (normalized params, generated id). A view with the same name on
 * the same route is replaced in place so tabs never duplicate a name. */
export function saveView(
  projectDir: string,
  input: SaveViewInput,
): Promise<SavedView> {
  return withProcessLock(async () => {
    const view: SavedView = {
      id: generateViewId(),
      name: input.name,
      route: input.route,
      params: normalizeViewParams(input.route, input.params),
    }
    const existing = readViews(projectDir)
    const kept = existing.filter(
      (v) => !(v.route === view.route && v.name === view.name),
    )
    writeViews(projectDir, [...kept, view])
    return view
  })
}

/** Delete a view by id. Deleting an unknown id is a no-op. */
export function deleteView(projectDir: string, id: string): Promise<void> {
  return withProcessLock(async () => {
    const existing = readViews(projectDir)
    const kept = existing.filter((v) => v.id !== id)
    if (kept.length !== existing.length) writeViews(projectDir, kept)
  })
}
