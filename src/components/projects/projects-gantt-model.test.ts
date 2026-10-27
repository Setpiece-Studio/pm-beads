// ABOUTME: Tests owner sequencing, recursive leaf progress, and Gantt dependency diagnostics.
// ABOUTME: Fixtures include malformed metadata and containment cycles to protect read-only layout.

import { describe, expect, it } from 'vitest'
import type { Issue } from '@/lib/beads/types'
import { buildGantt } from './projects-gantt-model'

const issue = (id: string, fields: Partial<Issue> = {}): Issue => ({
  id,
  title: id,
  issue_type: 'epic',
  status: 'open',
  priority: 2,
  created_at: '',
  updated_at: '',
  owner: 'account@example.com',
  ...fields,
})

describe('buildGantt', () => {
  it('groups by owner, sequences explicit ranks first, and falls back deterministically', () => {
    const projects = [
      issue('z', { assignee: 'Ben', metadata: { gantt_order: '200' } }),
      issue('a', { assignee: 'Ben', metadata: { gantt_order: 100 } }),
      issue('b', { assignee: 'Ben', metadata: { gantt_order: false } }),
      issue('k', { assignee: 'Kim' }),
      issue('u', { assignee: ' ' }),
    ]
    const result = buildGantt(projects, projects, {})
    expect(result.lanes.map((lane) => lane.owner)).toEqual([
      'Ben',
      'Kim',
      'Unassigned',
    ])
    expect(
      result.lanes[0].bars.map((bar) => [bar.issue.id, bar.start, bar.end]),
    ).toEqual([
      ['a', 0, 1],
      ['z', 1, 2],
      ['b', 2, 3],
    ])
    expect(buildGantt([...projects].reverse(), projects, {}).lanes).toEqual(
      result.lanes,
    )
  })

  it('counts closed and open leaf descendants without counting intermediate containers', () => {
    const root = issue('root')
    const all = [
      root,
      issue('empty-container', { parent: 'root' }),
      issue('nested', { parent: 'root' }),
      issue('done', { parent: 'nested', issue_type: 'task', status: 'closed' }),
      issue('todo', { parent: 'root', issue_type: 'task' }),
    ]
    const bar = buildGantt([root], all, {}).lanes[0].bars[0]
    expect(bar).toMatchObject({
      total: 2,
      closed: 1,
      start: 0,
      end: 2,
      cyclic: false,
    })
    const todo = all.find((item) => item.id === 'todo')
    if (todo) todo.status = 'closed'
    expect(buildGantt([root], all, {}).lanes[0].bars[0]).toMatchObject({
      total: 2,
      closed: 2,
      end: 2,
    })
  })

  it('keeps empty projects visible and handles cycles without inventing leaf work', () => {
    const root = issue('root', { parent: 'nested' })
    const nested = issue('nested', { parent: 'root' })
    const empty = issue('empty')
    const bars = buildGantt([root, empty], [root, nested, empty], {}).lanes[0]
      .bars
    expect(bars.find((bar) => bar.issue.id === 'root')).toMatchObject({
      total: 0,
      cyclic: true,
    })
    expect(bars.find((bar) => bar.issue.id === 'empty')).toMatchObject({
      total: 0,
      cyclic: false,
    })
    expect(bars.every((bar) => bar.end - bar.start === 1)).toBe(true)
  })

  it('reports reversed and cross-owner prerequisites without reordering, including hidden blockers', () => {
    const a = issue('a', { assignee: 'Ben', metadata: { gantt_order: 1 } })
    const b = issue('b', { assignee: 'Kim' })
    const c = issue('c', { assignee: 'Ben', metadata: { gantt_order: 2 } })
    const result = buildGantt([a, b, c], [a, b, c], {
      a: ['c', 'hidden'],
      b: ['a'],
      c: ['a'],
    })
    expect(
      result.links.map(({ from, to, conflict }) => [from, to, conflict]),
    ).toEqual([
      ['c', 'a', true],
      ['a', 'c', false],
      ['a', 'b', true],
    ])
    expect(result.hiddenBlockers).toBe(1)
    expect(result.lanes[0].bars.map((bar) => bar.issue.id)).toEqual(['a', 'c'])
  })
})
