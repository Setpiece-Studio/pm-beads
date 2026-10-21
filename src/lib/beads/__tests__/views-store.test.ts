// ABOUTME: Unit tests for the saved-views sidecar store — round-trip save/list/delete in
// ABOUTME: temp dirs, lenient handling of missing/corrupt files, and atomic write hygiene.

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteView, readViews, saveView, viewsFilePath } from '../views-store'

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'pm-beads-views-'))
  mkdirSync(join(projectDir, '.beads'))
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

describe('readViews', () => {
  it('returns an empty list when the file is missing', () => {
    expect(readViews(projectDir)).toEqual([])
  })

  it('returns an empty list for corrupt JSON', () => {
    writeFileSync(viewsFilePath(projectDir), '{not json')
    expect(readViews(projectDir)).toEqual([])
  })

  it('returns an empty list for a wrong wrapper shape', () => {
    writeFileSync(viewsFilePath(projectDir), JSON.stringify({ foo: 1 }))
    expect(readViews(projectDir)).toEqual([])
  })

  it('skips invalid entries but keeps valid ones', () => {
    writeFileSync(
      viewsFilePath(projectDir),
      JSON.stringify({
        version: 1,
        views: [
          { id: 'ok', name: 'Good', route: 'issues', params: {} },
          { id: '', name: 'Bad id', route: 'issues', params: {} },
          { id: 'x', name: 'Bad route', route: 'nope', params: {} },
          'not even an object',
        ],
      }),
    )
    expect(readViews(projectDir).map((v) => v.id)).toEqual(['ok'])
  })
})

describe('saveView / deleteView', () => {
  it('round-trips a saved view with normalized params', async () => {
    const saved = await saveView(projectDir, {
      name: 'Bug board',
      route: 'issues',
      params: {
        view: 'board',
        grouping: 'status',
        filter: 'type:is:bug',
      },
    })
    // Default grouping is stripped at save time.
    expect(saved.params).toEqual({ view: 'board', filter: 'type:is:bug' })
    expect(readViews(projectDir)).toEqual([saved])
  })

  it('replaces a view with the same name and route', async () => {
    await saveView(projectDir, {
      name: 'Mine',
      route: 'issues',
      params: { filter: 'status:is:open' },
    })
    const updated = await saveView(projectDir, {
      name: 'Mine',
      route: 'issues',
      params: { filter: 'status:is:closed' },
    })
    const views = readViews(projectDir)
    expect(views).toEqual([updated])
    expect(views[0].params.filter).toBe('status:is:closed')
  })

  it('keeps same-named views on different routes distinct', async () => {
    await saveView(projectDir, { name: 'Mine', route: 'issues', params: {} })
    await saveView(projectDir, { name: 'Mine', route: 'projects', params: {} })
    expect(readViews(projectDir)).toHaveLength(2)
  })

  it('deletes a view by id and ignores unknown ids', async () => {
    const a = await saveView(projectDir, {
      name: 'A',
      route: 'issues',
      params: {},
    })
    const b = await saveView(projectDir, {
      name: 'B',
      route: 'projects',
      params: {},
    })
    await deleteView(projectDir, a.id)
    expect(readViews(projectDir).map((v) => v.id)).toEqual([b.id])
    await deleteView(projectDir, 'does-not-exist')
    expect(readViews(projectDir).map((v) => v.id)).toEqual([b.id])
  })

  it('leaves no tmp files behind after writing', async () => {
    await saveView(projectDir, { name: 'A', route: 'issues', params: {} })
    const entries = readdirSync(join(projectDir, '.beads'))
    expect(entries).toEqual(['pm-beads-views.json'])
  })
})
