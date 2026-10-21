// ABOUTME: Component tests for the dependency editor — add/remove routing through dependency-meta
// ABOUTME: (verb + argument order), inline error on cycle, group hiding, and picker exclusion.

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'
import type { Issue, LinkedIssue, ShowIssue } from '@/lib/beads/types'
import { DependencyEditor } from '../dependency-editor'
import { type IssueEditDeps, useIssueEdits } from '../use-issue-edits'

// jsdom lacks scrollTo (router), scrollIntoView (cmdk option focus), and ResizeObserver (Radix
// popover positioning); stub all three so the picker popover can be driven without a crash.
beforeAll(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Element.prototype.scrollIntoView = vi.fn()
})

function makeIssue(overrides: Partial<ShowIssue> = {}): ShowIssue {
  return {
    id: 'pm-1',
    title: 'Current issue',
    status: 'open',
    priority: 1,
    issue_type: 'task',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
    ...overrides,
  }
}

function makeLinked(
  id: string,
  dependency_type: string,
  title = `Linked ${id}`,
): LinkedIssue {
  return {
    id,
    title,
    status: 'open',
    priority: 1,
    issue_type: 'task',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
    dependency_type,
  }
}

function makeCandidate(id: string, title = `Candidate ${id}`): Issue {
  return {
    id,
    title,
    status: 'open',
    priority: 1,
    issue_type: 'task',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
  }
}

type MockedDeps = { [K in keyof IssueEditDeps]: Mock<IssueEditDeps[K]> }

// Every write returns the fresh ShowIssue so the rail applies it directly (one bd read, KTD8).
// The mocks default to returning the seed issue; tests that change the group override per-action.
function makeDeps(issue: ShowIssue, candidates: Issue[] = []): MockedDeps {
  return {
    getIssue: vi.fn().mockResolvedValue(issue),
    answerAsk: vi.fn().mockResolvedValue(issue),
    updateIssue: vi.fn().mockResolvedValue(issue),
    saveTextField: vi.fn().mockResolvedValue({ ok: true, issue }),
    closeIssue: vi.fn().mockResolvedValue(issue),
    addLabel: vi.fn().mockResolvedValue(issue),
    removeLabel: vi.fn().mockResolvedValue(issue),
    addDependency: vi.fn().mockResolvedValue(issue),
    removeDependency: vi.fn().mockResolvedValue(issue),
    relate: vi.fn().mockResolvedValue(issue),
    unrelate: vi.fn().mockResolvedValue(issue),
    getActivity: vi.fn().mockResolvedValue({
      events: [],
      comments: issue.comments ?? [],
      messages: [],
      historyUnavailable: false,
    }),
    addComment: vi.fn().mockResolvedValue({
      events: [],
      comments: issue.comments ?? [],
      messages: [],
      historyUnavailable: false,
    }),
    listCandidates: vi.fn().mockResolvedValue(candidates),
    createSubIssue: vi.fn().mockResolvedValue(issue),
    setPrUrl: vi.fn().mockResolvedValue(issue),
    clearPrUrl: vi.fn().mockResolvedValue(issue),
    getPrState: vi
      .fn()
      .mockImplementation(async (url: string) => ({ url, state: 'unknown' })),
  }
}

// Wire the real useIssueEdits hook so add/remove flow through mutate → the right dep, and the
// error/groups state reflects the bd result — the seam this unit must keep coherent. The hook's
// single `error` is surfaced by the properties rail (not the dependency editor); this harness
// mirrors that placement so a failed add still asserts an alert AND unchanged groups. A tiny
// memory router satisfies the member-row <Link>s without an app route tree.
function Harness({ issue, deps }: { issue: ShowIssue; deps: IssueEditDeps }) {
  const edits = useIssueEdits(issue, deps)
  return (
    <div>
      {edits.error && (
        <p role="alert" className="text-xs text-red-500">
          {edits.error}
        </p>
      )}
      <DependencyEditor
        issue={edits.issue}
        saving={edits.saving}
        actions={edits.actions}
        listCandidates={edits.listCandidates}
        search={{ project: '/tmp/proj' }}
      />
    </div>
  )
}

function renderEditor(issue: ShowIssue, deps: IssueEditDeps) {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Harness issue={issue} deps={deps} />,
  })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/issues/$issueId',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    scrollRestoration: false,
  })
  // biome-ignore lint/suspicious/noExplicitAny: test router is not the registered app router.
  return render(<RouterProvider router={router as any} />)
}

// The memory router renders asynchronously; wait for the always-present "+" before interacting.
async function waitForMount() {
  return screen.findByRole('button', { name: /Add relationship/ })
}

// Drive the picker: open it, choose a relationship by its label, then pick a target by title.
// Picker entries are cmdk options (role="option"), distinct from group headings/member rows that
// share the same text, so target options to avoid ambiguous matches.
async function addRelationship(relationship: string, targetTitle: string) {
  fireEvent.click(await waitForMount())
  fireEvent.click(await screen.findByRole('option', { name: relationship }))
  fireEvent.click(
    await screen.findByRole('option', { name: new RegExp(targetTitle) }),
  )
}

describe('DependencyEditor', () => {
  afterEach(cleanup)

  it('adding "Blocked by" calls addDependency(this, target, blocks)', async () => {
    const deps = makeDeps(makeIssue(), [makeCandidate('pm-9', 'Blocker')])
    renderEditor(makeIssue(), deps)
    await addRelationship('Blocked by', 'Blocker')
    await waitFor(() =>
      expect(deps.addDependency).toHaveBeenCalledWith('pm-1', 'pm-9', 'blocks'),
    )
  })

  it('adding "Blocking" reverses the argument order to addDependency(target, this, blocks)', async () => {
    const deps = makeDeps(makeIssue(), [makeCandidate('pm-9', 'Downstream')])
    renderEditor(makeIssue(), deps)
    await addRelationship('Blocking', 'Downstream')
    await waitFor(() =>
      expect(deps.addDependency).toHaveBeenCalledWith('pm-9', 'pm-1', 'blocks'),
    )
  })

  it('adding "Related" calls relate (symmetric), not addDependency', async () => {
    const deps = makeDeps(makeIssue(), [makeCandidate('pm-9', 'Sibling')])
    renderEditor(makeIssue(), deps)
    await addRelationship('Related', 'Sibling')
    await waitFor(() =>
      expect(deps.relate).toHaveBeenCalledWith('pm-1', 'pm-9'),
    )
    expect(deps.addDependency).not.toHaveBeenCalled()
  })

  it('removing a non-related member calls removeDependency with dependency-meta order', async () => {
    // Beta (pm-9) blocks the current issue → it's a Blocked by (blocks/down) member, so the
    // directed remove must mirror add: removeDependency(thisId, otherId).
    const issue = makeIssue({
      dependencies: [makeLinked('pm-9', 'blocks', 'Beta blocker')],
    })
    const deps = makeDeps(issue)
    renderEditor(issue, deps)
    await waitForMount()
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Blocked by pm-9' }),
    )
    await waitFor(() =>
      expect(deps.removeDependency).toHaveBeenCalledWith('pm-1', 'pm-9'),
    )
    expect(deps.unrelate).not.toHaveBeenCalled()
  })

  it('removing an "up" member reverses the order, mirroring how it was added', async () => {
    // A Blocking (blocks/up) member: this issue blocks pm-2, added as (pm-2, pm-1).
    const issue = makeIssue({
      dependents: [makeLinked('pm-2', 'blocks', 'Downstream')],
    })
    const deps = makeDeps(issue)
    renderEditor(issue, deps)
    await waitForMount()
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Blocking pm-2' }),
    )
    await waitFor(() =>
      expect(deps.removeDependency).toHaveBeenCalledWith('pm-2', 'pm-1'),
    )
  })

  it('removing a related member calls unrelate, not removeDependency', async () => {
    const issue = makeIssue({
      dependencies: [makeLinked('pm-9', 'relates-to', 'Sibling')],
    })
    const deps = makeDeps(issue)
    renderEditor(issue, deps)
    await waitForMount()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Related pm-9' }))
    await waitFor(() =>
      expect(deps.unrelate).toHaveBeenCalledWith('pm-1', 'pm-9'),
    )
    expect(deps.removeDependency).not.toHaveBeenCalled()
  })

  it('shows a cycle error inline and leaves groups unchanged on a failed add', async () => {
    const issue = makeIssue({
      dependencies: [makeLinked('pm-9', 'blocks', 'Beta blocker')],
    })
    const deps = makeDeps(issue, [makeCandidate('pm-3', 'Cyclic target')])
    deps.addDependency.mockRejectedValue(
      new Error('bd: adding this dependency would create a cycle'),
    )
    renderEditor(issue, deps)
    await addRelationship('Blocked by', 'Cyclic target')

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'would create a cycle',
      ),
    )
    // The existing group and its member stay rendered: no optimistic removal/mutation.
    expect(screen.getByText('Blocked by')).toBeDefined()
    expect(screen.getByText('Beta blocker')).toBeDefined()
  })

  it('the picker excludes the current issue and issues already linked in the relationship', async () => {
    // pm-9 is already a Blocked by member; the current issue is pm-1. Both must be absent from
    // the Blocked by candidate list, leaving only pm-3.
    const issue = makeIssue({
      dependencies: [makeLinked('pm-9', 'blocks', 'Already blocking')],
    })
    const candidates = [
      makeCandidate('pm-1', 'Current issue'),
      makeCandidate('pm-9', 'Already blocking'),
      makeCandidate('pm-3', 'Open target'),
    ]
    const deps = makeDeps(issue, candidates)
    renderEditor(issue, deps)

    fireEvent.click(await waitForMount())
    fireEvent.click(await screen.findByRole('option', { name: 'Blocked by' }))

    // pm-3 is selectable as a candidate option; the self and the already-linked neighbor are not.
    await screen.findByRole('option', { name: /Open target/ })
    expect(screen.queryByRole('option', { name: /Current issue/ })).toBeNull()
    expect(
      screen.queryByRole('option', { name: /Already blocking/ }),
    ).toBeNull()
    // "Already blocking" still appears once — as the existing group member row, not a candidate.
    expect(screen.getAllByText('Already blocking')).toHaveLength(1)
  })

  it('retries the candidate fetch on reopen after an error (no stale broken cache)', async () => {
    // First fetch rejects: opening the picker and choosing a relationship must surface the error
    // message in step 2. Reopening must re-fetch (candidates reset to null on close), so once the
    // dep resolves the candidates load — proving the error path doesn't permanently break the
    // picker for the session.
    const deps = makeDeps(makeIssue())
    deps.listCandidates.mockRejectedValueOnce(new Error('bd list failed'))
    renderEditor(makeIssue(), deps)

    // Open, choose Blocked by → the failed fetch renders the inline error in the empty state.
    fireEvent.click(await waitForMount())
    fireEvent.click(await screen.findByRole('option', { name: 'Blocked by' }))
    await screen.findByText('Could not load issues.')

    // Close the picker (Escape dismisses the Radix popover), then reopen — the fetch retries.
    deps.listCandidates.mockResolvedValue([makeCandidate('pm-7', 'Now loads')])
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: 'Blocked by' })).toBeNull(),
    )

    fireEvent.click(screen.getByRole('button', { name: /Add relationship/ }))
    fireEvent.click(await screen.findByRole('option', { name: 'Blocked by' }))
    // The retried fetch resolved: the candidate is now offered and the error is gone.
    await screen.findByRole('option', { name: /Now loads/ })
    expect(screen.queryByText('Could not load issues.')).toBeNull()
  })

  it('removing the last member of a group hides the group while the "+" remains', async () => {
    const issue = makeIssue({
      dependencies: [makeLinked('pm-9', 'blocks', 'Sole blocker')],
    })
    const deps = makeDeps(issue)
    // removeDependency returns the fresh rail issue with no dependencies left.
    deps.removeDependency.mockResolvedValue(makeIssue())
    renderEditor(issue, deps)
    await waitForMount()

    expect(screen.getByText('Blocked by')).toBeDefined()
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Blocked by pm-9' }),
    )
    await waitFor(() => expect(screen.queryByText('Blocked by')).toBeNull())
    // The "+ Add relationship" affordance is always present.
    expect(
      screen.getByRole('button', { name: /Add relationship/ }),
    ).toBeDefined()
  })
})
