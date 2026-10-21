// ABOUTME: Tests for the pure projects-view logic — epic filtering, ordering (derived sorts and
// ABOUTME: the blocking topo-sort), grouping into buckets, edge-building, and progress percentages.

import { describe, expect, it } from 'vitest'
import { NONE_VALUE } from '@/components/filters/filters'
import type { EpicStatus, Issue } from '@/lib/beads/types'
import {
  buildEpicBlockingEdges,
  buildEpicGroups,
  buildEpicTree,
  buildEpicTreeEdges,
  type EpicBlockingEdges,
  type EpicTreeNode,
  filterEpics,
  groupEpics,
  joinEpicProgress,
  orderEpics,
  progressPercent,
  selectTaskChildren,
  selectVisibleEpics,
} from '../projects-model'

function makeEpic(
  id: string,
  status: string,
  priority: number,
  counts: { total?: number; closed?: number } = {},
  fields: Partial<Issue> = {},
): EpicStatus {
  return {
    epic: {
      id,
      title: `Epic ${id}`,
      status,
      priority,
      issue_type: 'epic',
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-10T00:00:00Z',
      ...fields,
    },
    total_children: counts.total ?? 0,
    closed_children: counts.closed ?? 0,
    eligible_for_close: false,
  }
}

/** An epic Issue with `blocks` edges to the given blocker ids (it is blocked by them). */
function makeEpicIssue(id: string, blockedBy: string[] = []): Issue {
  return {
    id,
    title: `Epic ${id}`,
    status: 'open',
    priority: 2,
    issue_type: 'epic',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
    dependencies: blockedBy.map((blocker) => ({
      issue_id: id,
      depends_on_id: blocker,
      type: 'blocks',
    })),
  }
}

const ids = (epics: EpicStatus[]) => epics.map((e) => e.epic.id)

describe('groupEpics', () => {
  it('groups epics by status in STATUS_ORDER, skipping empty groups', () => {
    const epics = [
      makeEpic('a', 'closed', 1),
      makeEpic('b', 'open', 1),
      makeEpic('c', 'in_progress', 1),
    ]
    const groups = groupEpics(epics)
    expect(groups.map((g) => g.status)).toEqual([
      'in_progress',
      'open',
      'closed',
    ])
    expect(groups.map((g) => ids(g.epics))).toEqual([['c'], ['b'], ['a']])
  })

  it('preserves the incoming order within a group (ordering is orderEpics job)', () => {
    const epics = [
      makeEpic('low', 'open', 3),
      makeEpic('urgent', 'open', 0),
      makeEpic('high', 'open', 1),
    ]
    const [group] = groupEpics(epics)
    expect(ids(group?.epics ?? [])).toEqual(['low', 'urgent', 'high'])
  })

  it('places unknown statuses after the known ones', () => {
    const epics = [makeEpic('weird', 'someday', 1), makeEpic('b', 'closed', 1)]
    const groups = groupEpics(epics)
    expect(groups.map((g) => g.status)).toEqual(['closed', 'someday'])
  })

  it('returns a single bucket with no status when grouping is none', () => {
    const epics = [makeEpic('a', 'open', 1), makeEpic('b', 'closed', 1)]
    const groups = groupEpics(epics, 'none')
    expect(groups).toHaveLength(1)
    expect(groups[0]?.status).toBeUndefined()
    expect(ids(groups[0]?.epics ?? [])).toEqual(['a', 'b'])
  })

  it('returns no groups for an empty list', () => {
    expect(groupEpics([])).toEqual([])
    expect(groupEpics([], 'none')).toEqual([])
  })
})

describe('orderEpics', () => {
  it('orders by priority ascending, then most-recently updated', () => {
    const epics = [
      makeEpic('low', 'open', 3),
      makeEpic('urgent', 'open', 0),
      makeEpic('high', 'open', 1),
    ]
    expect(ids(orderEpics(epics, 'priority'))).toEqual([
      'urgent',
      'high',
      'low',
    ])
  })

  it('orders by most-recently updated, then id', () => {
    const epics = [
      makeEpic('old', 'open', 1, {}, { updated_at: '2026-06-01T00:00:00Z' }),
      makeEpic('new', 'open', 1, {}, { updated_at: '2026-06-20T00:00:00Z' }),
    ]
    expect(ids(orderEpics(epics, 'updated'))).toEqual(['new', 'old'])
  })

  it('orders by most-recently created', () => {
    const epics = [
      makeEpic('old', 'open', 1, {}, { created_at: '2026-05-01T00:00:00Z' }),
      makeEpic('new', 'open', 1, {}, { created_at: '2026-06-01T00:00:00Z' }),
    ]
    expect(ids(orderEpics(epics, 'created'))).toEqual(['new', 'old'])
  })

  it('orders by progress (most complete first)', () => {
    const epics = [
      makeEpic('quarter', 'open', 1, { total: 4, closed: 1 }),
      makeEpic('done', 'open', 1, { total: 2, closed: 2 }),
      makeEpic('half', 'open', 1, { total: 2, closed: 1 }),
    ]
    expect(ids(orderEpics(epics, 'progress'))).toEqual([
      'done',
      'half',
      'quarter',
    ])
  })

  it('orders by child count (largest first)', () => {
    const epics = [
      makeEpic('small', 'open', 1, { total: 1 }),
      makeEpic('big', 'open', 1, { total: 9 }),
      makeEpic('mid', 'open', 1, { total: 4 }),
    ]
    expect(ids(orderEpics(epics, 'child-count'))).toEqual([
      'big',
      'mid',
      'small',
    ])
  })

  it('orders by title alphabetically', () => {
    const epics = [
      makeEpic('z', 'open', 1, {}, { title: 'Zebra' }),
      makeEpic('a', 'open', 1, {}, { title: 'Apple' }),
      makeEpic('m', 'open', 1, {}, { title: 'Mango' }),
    ]
    expect(ids(orderEpics(epics, 'title'))).toEqual(['a', 'm', 'z'])
  })

  it('does not mutate its input', () => {
    const epics = [makeEpic('b', 'open', 1), makeEpic('a', 'open', 0)]
    const before = ids(epics)
    orderEpics(epics, 'priority')
    expect(ids(epics)).toEqual(before)
  })

  describe('blocking topo-sort', () => {
    it('puts a blocker before the epic it blocks', () => {
      // b is blocked by a → a must come first, despite b's lower priority.
      const epics = [makeEpic('b', 'open', 0), makeEpic('a', 'open', 3)]
      const edges: EpicBlockingEdges = { b: ['a'] }
      expect(ids(orderEpics(epics, 'blocking', edges))).toEqual(['a', 'b'])
    })

    it('orders a chain blocker-first', () => {
      const epics = [
        makeEpic('c', 'open', 1),
        makeEpic('a', 'open', 1),
        makeEpic('b', 'open', 1),
      ]
      const edges: EpicBlockingEdges = { b: ['a'], c: ['b'] }
      expect(ids(orderEpics(epics, 'blocking', edges))).toEqual(['a', 'b', 'c'])
    })

    it('breaks ties between unblocked epics by priority then id', () => {
      const epics = [
        makeEpic('z', 'open', 2),
        makeEpic('y', 'open', 0),
        makeEpic('x', 'open', 2),
      ]
      expect(ids(orderEpics(epics, 'blocking', {}))).toEqual(['y', 'x', 'z'])
    })

    it('ignores edges to epics outside the set', () => {
      const epics = [makeEpic('b', 'open', 1), makeEpic('a', 'open', 0)]
      const edges: EpicBlockingEdges = { b: ['ghost'] }
      // The ghost blocker is not present, so normal priority tiebreak applies.
      expect(ids(orderEpics(epics, 'blocking', edges))).toEqual(['a', 'b'])
    })

    it('terminates and includes every epic when there is a cycle', () => {
      const epics = [makeEpic('a', 'open', 1), makeEpic('b', 'open', 1)]
      const edges: EpicBlockingEdges = { a: ['b'], b: ['a'] }
      const out = ids(orderEpics(epics, 'blocking', edges))
      expect(out.sort()).toEqual(['a', 'b'])
    })
  })
})

describe('buildEpicBlockingEdges', () => {
  it('maps each epic to the epics that block it via blocks edges', () => {
    const epicIssues = [
      makeEpicIssue('a'),
      makeEpicIssue('b', ['a']),
      makeEpicIssue('c', ['a', 'b']),
    ]
    expect(buildEpicBlockingEdges(epicIssues)).toEqual({
      b: ['a'],
      c: ['a', 'b'],
    })
  })

  it('ignores parent-child edges and edges to non-epics', () => {
    const a = makeEpicIssue('a')
    const b: Issue = {
      ...makeEpicIssue('b', ['a']),
      dependencies: [
        { issue_id: 'b', depends_on_id: 'a', type: 'blocks' },
        { issue_id: 'b', depends_on_id: 'task-1', type: 'blocks' },
        { issue_id: 'b', depends_on_id: 'parent', type: 'parent-child' },
      ],
    }
    expect(buildEpicBlockingEdges([a, b])).toEqual({ b: ['a'] })
  })

  it('returns an empty map when there are no blocks edges', () => {
    expect(
      buildEpicBlockingEdges([makeEpicIssue('a'), makeEpicIssue('b')]),
    ).toEqual({})
  })
})

describe('buildEpicGroups', () => {
  it('filters, orders, then groups in one pass', () => {
    const epics = [
      makeEpic('a', 'open', 3),
      makeEpic('b', 'open', 0),
      makeEpic('c', 'in_progress', 1),
    ]
    const groups = buildEpicGroups(
      epics,
      { grouping: 'status', ordering: 'priority', filters: [] },
      {},
    )
    expect(groups.map((g) => g.status)).toEqual(['in_progress', 'open'])
    expect(ids(groups[1]?.epics ?? [])).toEqual(['b', 'a'])
  })

  it('groups custom statuses in the configured pipeline order', () => {
    const epics = [
      makeEpic('a', 'qa', 1),
      makeEpic('b', 'open', 1),
      makeEpic('c', 'in_review', 1),
    ]
    const groups = buildEpicGroups(
      epics,
      {
        grouping: 'status',
        ordering: 'priority',
        filters: [],
        statusOrder: ['open', 'in_review', 'qa'],
      },
      {},
    )
    expect(groups.map((group) => group.key)).toEqual([
      'open',
      'in_review',
      'qa',
    ])
  })

  it('applies a flat blocking sequence when grouping is none', () => {
    const epics = [makeEpic('b', 'open', 0), makeEpic('a', 'open', 3)]
    const groups = buildEpicGroups(
      epics,
      { grouping: 'none', ordering: 'blocking', filters: [] },
      { b: ['a'] },
    )
    expect(groups).toHaveLength(1)
    expect(ids(groups[0]?.epics ?? [])).toEqual(['a', 'b'])
  })

  it('hides closed epics by default (no status filter)', () => {
    const epics = [makeEpic('a', 'open', 1), makeEpic('c', 'closed', 1)]
    const groups = buildEpicGroups(
      epics,
      { grouping: 'status', ordering: 'priority', filters: [] },
      {},
    )
    expect(groups.map((g) => g.status)).toEqual(['open'])
    expect(ids(groups.flatMap((g) => g.epics))).toEqual(['a'])
  })

  it('reveals closed epics when the status filter includes closed', () => {
    const epics = [makeEpic('a', 'open', 1), makeEpic('c', 'closed', 1)]
    const groups = buildEpicGroups(
      epics,
      {
        grouping: 'status',
        ordering: 'priority',
        filters: [
          { property: 'status', operator: 'is', values: ['open', 'closed'] },
        ],
      },
      {},
    )
    expect(groups.map((g) => g.status)).toEqual(['open', 'closed'])
  })
})

describe('filterEpics', () => {
  const epics = [
    makeEpic('a', 'open', 1, {}, { labels: ['ui'], assignee: 'ben' }),
    makeEpic('b', 'in_progress', 0, {}, { labels: ['perf'] }),
    makeEpic('c', 'closed', 2),
  ]

  it('returns all epics when no filters are active', () => {
    expect(filterEpics(epics, [])).toEqual(epics)
  })

  it('filters on the epic issue status', () => {
    const out = filterEpics(epics, [
      { property: 'status', operator: 'is', values: ['open'] },
    ])
    expect(out.map((e) => e.epic.id)).toEqual(['a'])
  })

  it('filters on priority and supports is-not', () => {
    const out = filterEpics(epics, [
      { property: 'priority', operator: 'is-not', values: ['0'] },
    ])
    expect(out.map((e) => e.epic.id)).toEqual(['a', 'c'])
  })

  it('filters on labels including the no-label pseudo-value', () => {
    expect(
      filterEpics(epics, [
        { property: 'label', operator: 'is', values: ['ui'] },
      ]).map((e) => e.epic.id),
    ).toEqual(['a'])
    expect(
      filterEpics(epics, [
        { property: 'label', operator: 'is', values: [NONE_VALUE] },
      ]).map((e) => e.epic.id),
    ).toEqual(['c'])
  })

  it('filters on assignee and ANDs multiple filters', () => {
    expect(
      filterEpics(epics, [
        { property: 'assignee', operator: 'is', values: ['ben'] },
        { property: 'status', operator: 'is', values: ['open'] },
      ]).map((e) => e.epic.id),
    ).toEqual(['a'])
    expect(
      filterEpics(epics, [
        { property: 'assignee', operator: 'is', values: ['ben'] },
        { property: 'status', operator: 'is', values: ['closed'] },
      ]),
    ).toEqual([])
  })
})

describe('joinEpicProgress', () => {
  it('joins progress from the epic-status list onto the complete epic set', () => {
    const epicIssues = [makeEpicIssue('a'), makeEpicIssue('b')]
    const statuses = [makeEpic('a', 'open', 1, { total: 4, closed: 2 })]
    const joined = joinEpicProgress(epicIssues, statuses)
    expect(joined.map((e) => e.epic.id)).toEqual(['a', 'b'])
    expect(joined[0]).toMatchObject({ total_children: 4, closed_children: 2 })
  })

  it('defaults epics absent from epic status to 0/0 (childless and closed)', () => {
    const epicIssues = [
      { ...makeEpicIssue('lonely'), status: 'open' },
      { ...makeEpicIssue('done'), status: 'closed' },
    ]
    const joined = joinEpicProgress(epicIssues, [])
    expect(joined).toHaveLength(2)
    for (const e of joined) {
      expect(e.total_children).toBe(0)
      expect(e.closed_children).toBe(0)
    }
  })

  it('keeps the list issue as the canonical epic record (labels, edges)', () => {
    const listEpic: Issue = {
      ...makeEpicIssue('a', ['b']),
      labels: ['ui'],
    }
    // A stale status record for the same id must not override the list issue's fields.
    const statuses = [makeEpic('a', 'open', 1, { total: 1 }, { labels: [] })]
    const [joined] = joinEpicProgress([listEpic], statuses)
    expect(joined?.epic.labels).toEqual(['ui'])
    expect(joined?.epic.dependencies?.[0]?.depends_on_id).toBe('b')
    expect(joined?.total_children).toBe(1)
  })
})

describe('selectVisibleEpics', () => {
  const epics = [
    makeEpic('a', 'open', 1, {}, { labels: ['ui'] }),
    makeEpic('c', 'closed', 1),
  ]

  it('hides closed epics when there is no status filter', () => {
    expect(selectVisibleEpics(epics, []).map((e) => e.epic.id)).toEqual(['a'])
  })

  it('shows closed epics when a status filter includes closed', () => {
    expect(
      selectVisibleEpics(epics, [
        { property: 'status', operator: 'is', values: ['closed'] },
      ]).map((e) => e.epic.id),
    ).toEqual(['c'])
  })

  it('still applies non-status filters while hiding closed by default', () => {
    expect(
      selectVisibleEpics(epics, [
        { property: 'label', operator: 'is', values: ['ui'] },
      ]).map((e) => e.epic.id),
    ).toEqual(['a'])
  })
})

describe('progressPercent', () => {
  it('computes a rounded percentage of closed children', () => {
    expect(progressPercent(1, 3)).toBe(33)
    expect(progressPercent(2, 3)).toBe(67)
    expect(progressPercent(6, 6)).toBe(100)
  })

  it('returns 0 when the epic has no children', () => {
    expect(progressPercent(0, 0)).toBe(0)
  })

  it('clamps to the 0-100 range on odd inputs', () => {
    expect(progressPercent(5, 3)).toBe(100)
    expect(progressPercent(-1, 3)).toBe(0)
  })
})

type EdgeType = 'blocks' | 'parent-child' | 'relates-to'

/**
 * An epic Issue carrying arbitrary typed dependency edges. Each [id, type] pair
 * is an edge {issue_id: this, depends_on_id: id, type} — i.e. this epic depends
 * on `id` (its parent for parent-child, its blocker for blocks).
 */
function epicIssue(
  id: string,
  deps: Array<[string, EdgeType]> = [],
  priority = 2,
): Issue {
  const parent = deps.find(([, type]) => type === 'parent-child')?.[0]
  return {
    id,
    title: `Epic ${id}`,
    status: 'open',
    priority,
    issue_type: 'epic',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
    parent,
    dependencies: deps.map(([dependsOn, type]) => ({
      issue_id: id,
      depends_on_id: dependsOn,
      type,
    })),
  }
}

const asStatus = (issue: Issue): EpicStatus => ({
  epic: issue,
  total_children: 0,
  closed_children: 0,
  eligible_for_close: false,
})

interface TreeShape {
  id: string
  cyclic: boolean
  children: TreeShape[]
}

const shape = (nodes: EpicTreeNode[]): TreeShape[] =>
  nodes.map((n) => ({
    id: n.epic.epic.id,
    cyclic: n.cyclic,
    children: shape(n.children),
  }))

/** Build the tree directly from epic Issues (edges derived from their deps). */
function tree(issues: Issue[]): EpicTreeNode[] {
  return buildEpicTree(issues.map(asStatus), buildEpicTreeEdges(issues))
}

describe('buildEpicTreeEdges', () => {
  it('keeps only the canonical parent-child parent', () => {
    const issues = [
      epicIssue('a'),
      epicIssue('b', [['a', 'blocks']]),
      epicIssue('c', [['a', 'parent-child']]),
    ]
    expect(buildEpicTreeEdges(issues)).toEqual({ c: ['a'] })
  })

  it('ignores blocks, relates-to, and edges leaving the epic set', () => {
    const issues = [
      epicIssue('a'),
      epicIssue('b', [
        ['a', 'relates-to'],
        ['ghost', 'blocks'],
      ]),
    ]
    expect(buildEpicTreeEdges(issues)).toEqual({})
  })

  it('keeps one containment parent when another relationship shares the endpoint', () => {
    const issues = [
      epicIssue('a'),
      epicIssue('b', [
        ['a', 'blocks'],
        ['a', 'parent-child'],
      ]),
    ]
    expect(buildEpicTreeEdges(issues)).toEqual({ b: ['a'] })
  })
})

describe('buildEpicTree', () => {
  it('nests only a parent-child child, leaving a blocks dependent at the root', () => {
    const t = tree([
      epicIssue('a'),
      epicIssue('member', [['a', 'parent-child']]),
      epicIssue('next', [['a', 'blocks']]),
    ])
    expect(shape(t)).toEqual([
      {
        id: 'a',
        cyclic: false,
        children: [{ id: 'member', cyclic: false, children: [] }],
      },
      { id: 'next', cyclic: false, children: [] },
    ])
  })

  it('treats only epics with no in-set parent as roots', () => {
    const t = tree([
      epicIssue('a'),
      epicIssue('b', [['a', 'parent-child']]),
      epicIssue('c', [['b', 'parent-child']]),
    ])
    // Single root a → b → c, a transitive chain, no top-level b or c.
    expect(t.map((n) => n.epic.epic.id)).toEqual(['a'])
    expect(shape(t)[0].children[0].id).toBe('b')
    expect(shape(t)[0].children[0].children[0].id).toBe('c')
  })

  it('does not use blocks edges as additional parents', () => {
    const t = tree([
      epicIssue('a'),
      epicIssue('p1', [['a', 'parent-child']]),
      epicIssue('p2', [['a', 'parent-child']]),
      epicIssue('shared', [['p1', 'parent-child']]),
    ])
    const a = shape(t)[0]
    const [p1, p2] = a.children
    expect(p1.id).toBe('p1')
    expect(p2.id).toBe('p2')
    expect(p1.children.map((c) => c.id)).toEqual(['shared'])
    expect(p2.children).toEqual([])
  })

  it('orders children by priority then id', () => {
    const t = tree([
      epicIssue('root'),
      epicIssue('z-low', [['root', 'parent-child']], 1),
      epicIssue('a-high', [['root', 'parent-child']], 3),
      epicIssue('m-mid', [['root', 'parent-child']], 1),
    ])
    // priority 1 before 3; within priority 1, id order m-mid before z-low.
    expect(shape(t)[0].children.map((c) => c.id)).toEqual([
      'm-mid',
      'z-low',
      'a-high',
    ])
  })

  it('does not treat a blocks edge as a containment cycle', () => {
    const t = tree([
      epicIssue('x', [['y', 'blocks']]),
      epicIssue('y', [['x', 'parent-child']]),
    ])
    // x is the containment root; y is nested below it.
    expect(t).toHaveLength(1)
    const x = shape(t)[0]
    expect(x.id).toBe('x')
    expect(x.cyclic).toBe(false)
    const y = x.children[0]
    expect(y.id).toBe('y')
    expect(y.children).toEqual([])
  })

  it('covers a fully-parented component disconnected from the natural roots', () => {
    const t = tree([
      epicIssue('root'),
      epicIssue('child', [['root', 'parent-child']]),
      // c1 ↔ c2 containment cycle, unreachable from root
      epicIssue('c1', [['c2', 'parent-child']]),
      epicIssue('c2', [['c1', 'parent-child']]),
    ])
    const rootIds = t.map((n) => n.epic.epic.id)
    expect(rootIds).toContain('root')
    expect(rootIds).toContain('c1')
  })
})

describe('selectTaskChildren', () => {
  const task = (id: string): Issue => ({ ...epicIssue(id), issue_type: 'task' })
  const bug = (id: string): Issue => ({ ...epicIssue(id), issue_type: 'bug' })

  it('keeps only direct non-epic children', () => {
    const children = [
      epicIssue('e1'),
      { ...task('t1'), parent: 'root' },
      { ...bug('b1'), parent: 'root' },
      { ...task('nested'), parent: 'e1' },
    ]
    expect(selectTaskChildren(children, 'root').map((i) => i.id)).toEqual([
      't1',
      'b1',
    ])
  })

  it('returns empty when every child is itself an epic', () => {
    expect(
      selectTaskChildren([epicIssue('e1'), epicIssue('e2')], 'root'),
    ).toEqual([])
  })
})
