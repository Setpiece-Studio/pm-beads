// ABOUTME: Rendering + inline-edit tests for the IssueDetail shell — title, markdown body, the
// ABOUTME: editable property groups, dependency rows, and edits calling the injected deps.

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
import { StatusPipelineProvider } from '@/components/status-pipeline-context'
import {
  buildStatusPipeline,
  DEFAULT_STATUS_PIPELINE,
  type StatusPipeline,
} from '@/lib/beads/status-model'
import type { Issue, LinkedIssue, ShowIssue } from '@/lib/beads/types'
import { IssueDetail } from '../issue-detail'
import type { IssueEditDeps } from '../use-issue-edits'

// jsdom doesn't implement scrollTo (router) or Element.scrollIntoView (Radix Select
// option focus); stub both so the editors can be driven without a "not a function" crash.
beforeAll(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
})

function makeIssue(overrides: Partial<ShowIssue> = {}): ShowIssue {
  return {
    id: 'pm-1',
    title: 'Fix the flux capacitor',
    status: 'in_progress',
    priority: 1,
    issue_type: 'task',
    assignee: 'ben',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
    description: 'It needs **1.21 gigawatts**.',
    labels: ['web', 'urgent'],
    comments: [
      {
        id: 'cm-1',
        issue_id: 'pm-1',
        author: 'Doc Brown',
        text: 'Great Scott!',
        created_at: '2026-06-09T00:00:00Z',
      },
    ],
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

function makeChild(id: string, title = `Child ${id}`): Issue {
  return {
    id,
    title,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
  }
}

type MockedDeps = { [K in keyof IssueEditDeps]: Mock<IssueEditDeps[K]> }

// Every write returns the fresh ShowIssue so the rail applies it directly (one bd read, KTD8).
function makeDeps(issue: ShowIssue): MockedDeps {
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
    listCandidates: vi.fn().mockResolvedValue([]),
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
    createSubIssue: vi.fn().mockResolvedValue(issue),
    setPrUrl: vi.fn().mockResolvedValue(issue),
    clearPrUrl: vi.fn().mockResolvedValue(issue),
    getPrState: vi
      .fn()
      .mockImplementation(async (url: string) => ({ url, state: 'unknown' })),
  }
}

// The shell renders TanStack <Link>s, so it needs a router context. A tiny memory
// router with a catch-all route satisfies the Link without an app route tree. The status
// pipeline wraps the router rather than living inside it, so a test can swap it the way the
// root loader does when the selected project changes (`selectProject` below).
function renderDetail(
  issue: ShowIssue,
  overrides: {
    deps?: IssueEditDeps
    onMutated?: () => void
    project?: string
    progress?: { closed: number; total: number }
    children?: Issue[]
    pipeline?: StatusPipeline
  } = {},
) {
  const deps = overrides.deps ?? makeDeps(issue)
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <IssueDetail
        issue={issue}
        deps={deps}
        onMutated={overrides.onMutated}
        search={{ project: overrides.project }}
        progress={overrides.progress}
        childIssues={overrides.children}
      />
    ),
  })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/issues/$issueId',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    // jsdom has no scrollTo; disabling restoration keeps test output pristine.
    scrollRestoration: false,
  })
  const tree = (pipeline: StatusPipeline) => (
    <StatusPipelineProvider value={pipeline}>
      {/* biome-ignore lint/suspicious/noExplicitAny: test router is not the registered app router. */}
      <RouterProvider router={router as any} />
    </StatusPipelineProvider>
  )
  const result = render(tree(overrides.pipeline ?? DEFAULT_STATUS_PIPELINE))
  return {
    ...result,
    /** Re-render under another project's pipeline, as the root loader does on a project switch. */
    selectProject: (pipeline: StatusPipeline) =>
      result.rerender(tree(pipeline)),
  }
}

/** The Status listbox's options, top to bottom, as the selector renders them. */
function statusOptionNames(): string[] {
  return screen
    .getAllByRole('option')
    .map((option) => option.textContent?.trim() ?? '')
}

describe('IssueDetail', () => {
  afterEach(cleanup)

  it('renders the title and markdown-rendered description', async () => {
    renderDetail(makeIssue())
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )
    // Description renders through Markdown: the bold span proves it's not plain text.
    const strong = document.querySelector('[data-slot="markdown"] strong')
    expect(strong?.textContent).toBe('1.21 gigawatts')
  })

  it('renders Actions directly beneath the title, before the description', async () => {
    renderDetail(
      makeIssue({
        metadata: {
          'ask.one': JSON.stringify({
            kind: 'decision',
            q: 'Choose a path',
            note: 'Pick one.',
            by: 'agent',
            at: '2026-09-10T20:00:00.000Z',
          }),
        },
      }),
    )

    const title = await screen.findByRole('heading', {
      name: 'Fix the flux capacitor',
    })
    const actions = screen.getByRole('heading', { name: 'Actions' })
    const description = document.querySelector('[data-slot="markdown"]')
    if (!description) throw new Error('Expected the issue description')

    expect(
      title.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      actions.compareDocumentPosition(description) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('renders editable type, status, priority, assignee, and labels', async () => {
    renderDetail(makeIssue())
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )
    // Type, status + priority are Select comboboxes; assignee is an input.
    expect(screen.getByLabelText('Type').textContent).toContain('Task')
    expect(screen.getByLabelText('Status')).toBeDefined()
    expect(screen.getByLabelText('Priority')).toBeDefined()
    expect((screen.getByLabelText('Assignee') as HTMLInputElement).value).toBe(
      'ben',
    )
    expect(screen.getByText('web')).toBeDefined()
    expect(screen.getByText('urgent')).toBeDefined()
  })

  it('renders the Pull request section, empty, when the bead carries no pr_url', async () => {
    renderDetail(makeIssue())
    await waitFor(() => expect(screen.getByText('Pull request')).toBeDefined())
    expect(screen.getByRole('button', { name: /link pr/i })).toBeDefined()
  })

  it('links a PR from the rail through the injected setPrUrl dep', async () => {
    const issue = makeIssue()
    const deps = makeDeps(issue)
    renderDetail(issue, { deps })
    await waitFor(() => expect(screen.getByText('Pull request')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /link pr/i }))
    const input = screen.getByLabelText(/pull request url or number/i)
    fireEvent.change(input, {
      target: { value: 'https://github.com/o/r/pull/42' },
    })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(deps.setPrUrl).toHaveBeenCalledWith(
        'pm-1',
        'https://github.com/o/r/pull/42',
      ),
    )
  })

  it('renders the linked PR with its gh title and state badge', async () => {
    const issue = makeIssue({
      metadata: { pr_url: 'https://github.com/o/r/pull/42' },
    })
    const deps = makeDeps(issue)
    ;(deps.getPrState as Mock<IssueEditDeps['getPrState']>).mockResolvedValue({
      url: 'https://github.com/o/r/pull/42',
      number: 42,
      title: 'Link PRs to beads',
      state: 'merged',
    })
    renderDetail(issue, { deps })

    expect(await screen.findByText('#42')).toBeDefined()
    expect(screen.getByText('Link PRs to beads')).toBeDefined()
    expect(screen.getByText('Merged')).toBeDefined()

    fireEvent.click(
      screen.getByRole('button', { name: /unlink pull request/i }),
    )
    await waitFor(() => expect(deps.clearPrUrl).toHaveBeenCalledWith('pm-1'))
  })

  it('shows the empty assignee placeholder and an empty labels editor when unset', async () => {
    renderDetail(makeIssue({ assignee: undefined, labels: [] }))
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )
    const assignee = screen.getByLabelText('Assignee') as HTMLInputElement
    expect(assignee.value).toBe('')
    expect(assignee.placeholder).toBe('Assign')
    expect(screen.getByLabelText('Add label')).toBeDefined()
  })

  it('renders grouped dependency rows in both directions', async () => {
    const issue = makeIssue({
      dependencies: [makeLinked('pm-9', 'blocks', 'Beta blocker')],
      dependents: [makeLinked('pm-2', 'blocks', 'Downstream task')],
    })
    renderDetail(issue, { project: '/tmp/proj' })
    await waitFor(() => expect(screen.getByText('Blocked by')).toBeDefined())

    // Group headings for both directions of a blocks edge.
    expect(screen.getByText('Blocked by')).toBeDefined()
    expect(screen.getByText('Blocking')).toBeDefined()
    expect(screen.getByText('Beta blocker')).toBeDefined()
    expect(screen.getByText('Downstream task')).toBeDefined()

    // Dependency rows are links to the neighbor's detail route, carrying project.
    const blockerLink = screen.getByText('Beta blocker').closest('a')
    expect(blockerLink?.getAttribute('href')).toContain('/issues/pm-9')
    expect(blockerLink?.getAttribute('href')).toContain('project=')
  })

  it('omits empty long-text sections and the comments section when absent', async () => {
    renderDetail(
      makeIssue({
        design: undefined,
        acceptance_criteria: undefined,
        notes: undefined,
        comments: [],
      }),
    )
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )
    expect(screen.queryByText('Design')).toBeNull()
    expect(screen.queryByText('Acceptance criteria')).toBeNull()
    expect(screen.queryByText('Notes')).toBeNull()
    expect(screen.queryByText('Comments')).toBeNull()
  })

  it('renders comments inside the activity stream with author and relative time', async () => {
    renderDetail(makeIssue())
    fireEvent.click(
      await screen.findByRole('button', { name: 'Load comments' }),
    )
    await waitFor(() => expect(screen.getByText('Activity')).toBeDefined())
    expect(screen.getByText('Doc Brown')).toBeDefined()
    expect(screen.getByText('Great Scott!')).toBeDefined()
  })

  it('changing status calls updateIssue and reflects the returned issue', async () => {
    const deps = makeDeps(makeIssue())
    const onMutated = vi.fn()
    deps.updateIssue.mockResolvedValue(makeIssue({ status: 'blocked' }))
    renderDetail(makeIssue(), { deps, onMutated })
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )

    // Radix Select can't be driven via keyboard reliably in jsdom; the hook's
    // status action is exercised directly through the trigger's change wiring by
    // opening the listbox and clicking the option.
    fireEvent.click(screen.getByLabelText('Status'))
    fireEvent.click(await screen.findByRole('option', { name: /Blocked/ }))

    await waitFor(() =>
      expect(deps.updateIssue).toHaveBeenCalledWith('pm-1', {
        status: 'blocked',
      }),
    )
    await waitFor(() => expect(onMutated).toHaveBeenCalled())
    // The returned fresh issue is applied to local state: the trigger now reads Blocked.
    expect(screen.getByLabelText('Status').textContent).toContain('Blocked')
  })

  // The selector's options are the selected project's pipeline, in the project's own order —
  // the same sequence the lists group by — and switching projects replaces them wholesale.
  it('offers the selected project’s statuses, and swaps them when the project changes', async () => {
    const shipping = buildStatusPipeline({
      block: {
        pipeline: [
          'deferred',
          'open',
          'in_progress',
          'blocked',
          'awaiting_deploy',
          'closed',
        ],
        icons: { awaiting_deploy: 'rocket' },
      },
    })
    const reviewing = buildStatusPipeline({
      block: {
        pipeline: [
          'open',
          'in_progress',
          'qa',
          'blocked',
          'deferred',
          'closed',
        ],
      },
    })
    const { selectProject } = renderDetail(makeIssue(), {
      pipeline: shipping,
    })
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )

    fireEvent.click(screen.getByLabelText('Status'))
    await screen.findByRole('option', { name: /Awaiting Deploy/ })
    expect(statusOptionNames()).toEqual([
      'Deferred',
      'Open',
      'In Progress',
      'Blocked',
      'Awaiting Deploy',
      'Done',
    ])
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })

    selectProject(reviewing)
    fireEvent.click(screen.getByLabelText('Status'))
    await screen.findByRole('option', { name: /Qa/ })
    expect(statusOptionNames()).toEqual([
      'Open',
      'In Progress',
      'Qa',
      'Blocked',
      'Deferred',
      'Done',
    ])
  })

  // A status the project's pipeline has not caught up with must stay selectable, or saving any
  // other field from this bead would silently propose moving it off its own status.
  it('keeps a status the pipeline does not know at the head of the options', async () => {
    renderDetail(makeIssue({ status: 'verification' }), {
      pipeline: buildStatusPipeline({
        block: {
          pipeline: ['deferred', 'open', 'in_progress', 'blocked', 'closed'],
        },
      }),
    })
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )

    fireEvent.click(screen.getByLabelText('Status'))
    await screen.findByRole('option', { name: /Verification/ })
    expect(statusOptionNames()).toEqual([
      'Verification',
      'Deferred',
      'Open',
      'In Progress',
      'Blocked',
      'Done',
    ])
  })

  it('changing priority calls updateIssue with the chosen priority', async () => {
    const deps = makeDeps(makeIssue())
    deps.updateIssue.mockResolvedValue(makeIssue({ priority: 0 }))
    renderDetail(makeIssue(), { deps })
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )

    fireEvent.click(screen.getByLabelText('Priority'))
    fireEvent.click(await screen.findByRole('option', { name: /Urgent/ }))

    await waitFor(() =>
      expect(deps.updateIssue).toHaveBeenCalledWith('pm-1', { priority: 0 }),
    )
  })

  it('changing type calls updateIssue and reflects the returned issue', async () => {
    const deps = makeDeps(makeIssue())
    deps.updateIssue.mockResolvedValue(makeIssue({ issue_type: 'bug' }))
    renderDetail(makeIssue(), { deps })
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )

    fireEvent.click(screen.getByLabelText('Type'))
    fireEvent.click(await screen.findByRole('option', { name: /Bug/ }))

    await waitFor(() =>
      expect(deps.updateIssue).toHaveBeenCalledWith('pm-1', {
        issue_type: 'bug',
      }),
    )
    // The returned fresh issue is applied: the trigger now reads Bug.
    expect(screen.getByLabelText('Type').textContent).toContain('Bug')
  })

  it('commits an assignee edit on Enter', async () => {
    const deps = makeDeps(makeIssue())
    renderDetail(makeIssue(), { deps })
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )

    const input = screen.getByLabelText('Assignee')
    fireEvent.change(input, { target: { value: 'marty' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(deps.updateIssue).toHaveBeenCalledWith('pm-1', {
        assignee: 'marty',
      }),
    )
  })

  it('commits an assignee edit on blur', async () => {
    const deps = makeDeps(makeIssue())
    renderDetail(makeIssue(), { deps })
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )

    const input = screen.getByLabelText('Assignee')
    fireEvent.change(input, { target: { value: 'jennifer' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(deps.updateIssue).toHaveBeenCalledWith('pm-1', {
        assignee: 'jennifer',
      }),
    )
  })

  it('adds a label by typing and pressing Enter, then applies the returned issue', async () => {
    const deps = makeDeps(makeIssue())
    deps.addLabel.mockResolvedValue(
      makeIssue({ labels: ['web', 'urgent', 'rail'] }),
    )
    renderDetail(makeIssue(), { deps })
    await waitFor(() => expect(screen.getByText('web')).toBeDefined())

    const input = screen.getByLabelText('Add label')
    fireEvent.change(input, { target: { value: 'rail' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(deps.addLabel).toHaveBeenCalledWith('pm-1', 'rail'),
    )
    // The returned fresh issue is applied directly and the new label appears.
    await waitFor(() => expect(screen.getByText('rail')).toBeDefined())
  })

  it('removes a label via its badge button', async () => {
    const deps = makeDeps(makeIssue())
    deps.removeLabel.mockResolvedValue(makeIssue({ labels: ['urgent'] }))
    renderDetail(makeIssue(), { deps })
    await waitFor(() => expect(screen.getByText('web')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Remove label web' }))
    await waitFor(() =>
      expect(deps.removeLabel).toHaveBeenCalledWith('pm-1', 'web'),
    )
  })

  it('surfaces a mutation error inline and keeps the issue rendered', async () => {
    const deps = makeDeps(makeIssue())
    deps.updateIssue.mockRejectedValue(new Error('bd: cycle detected'))
    renderDetail(makeIssue(), { deps })
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )

    const input = screen.getByLabelText('Assignee')
    fireEvent.change(input, { target: { value: 'biff' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'bd: cycle detected',
      ),
    )
    // The issue stays rendered; the edit did not break the view.
    expect(screen.getByText('Fix the flux capacitor')).toBeDefined()
  })

  it('surfaces a failed field edit at the top of the rail, not near the dependency editor (4tf)', async () => {
    // A failed status edit must not be misattributed to dependencies: the single hook error is
    // rendered once at the top of the rail, ahead of the Status control and the dependency picker.
    const issue = makeIssue({
      dependencies: [makeLinked('pm-9', 'blocks', 'Beta blocker')],
    })
    const deps = makeDeps(issue)
    deps.updateIssue.mockRejectedValue(new Error('bd: status update failed'))
    renderDetail(issue, { deps })
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )

    fireEvent.click(screen.getByLabelText('Status'))
    fireEvent.click(await screen.findByRole('option', { name: /Blocked/ }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('bd: status update failed')
    // Placement check: the alert precedes the Status control in document order — it sits at the
    // top of the rail, not down inside the dependency editor (which renders after the controls).
    const statusTrigger = screen.getByLabelText('Status')
    expect(
      alert.compareDocumentPosition(statusTrigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // Exactly one error is visible at a time.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('renders epic progress and a children list when supplied', async () => {
    const epic = makeIssue({
      id: 'pm-epic',
      issue_type: 'epic',
      // bd show returns an epic's children under dependents[] as parent-child edges.
      dependents: [makeLinked('pm-c1', 'parent-child', 'Alpha child')],
    })
    renderDetail(epic, {
      progress: { closed: 1, total: 3 },
      children: [makeChild('pm-c1', 'Alpha child'), makeChild('pm-c2')],
    })
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )

    // Progress shows the epic's own closed/total fraction; the sub-issues header carries its
    // own ring counting the children actually listed.
    expect(screen.getByText('Progress')).toBeDefined()
    expect(screen.getByText('1/3')).toBeDefined()
    expect(screen.getByText('0/2')).toBeDefined()

    // Children render once, in the dedicated body section (not duplicated by the rail's
    // parent-child group, which is suppressed for epics). One "Sub-issues" heading, one row.
    expect(screen.getAllByText('Sub-issues')).toHaveLength(1)
    expect(screen.getAllByText('Alpha child')).toHaveLength(1)
    const childLink = screen.getByText('Alpha child').closest('a')
    expect(childLink?.getAttribute('href')).toContain('/issues/pm-c1')
  })

  it('offers the add-sub-issues affordance when there are no children', async () => {
    const epic = makeIssue({ id: 'pm-epic', issue_type: 'epic' })
    renderDetail(epic, { progress: { closed: 0, total: 0 }, children: [] })
    await waitFor(() => expect(screen.getByText('Sub-issues')).toBeDefined())
    expect(screen.getByRole('button', { name: 'Add sub-issues' })).toBeDefined()
  })

  it('saves a description edit through the injected saveTextField', async () => {
    const deps = makeDeps(makeIssue())
    deps.saveTextField.mockResolvedValue({
      ok: true,
      issue: makeIssue({ description: 'Rewritten.' }),
    })
    renderDetail(makeIssue(), { deps })
    await waitFor(() =>
      expect(screen.getByTestId('description-display')).toBeDefined(),
    )

    fireEvent.click(screen.getByTestId('description-display'))
    // The editor arrives on a dynamic import.
    const textarea = await screen.findByLabelText('Description', undefined, {
      timeout: 15000,
    })
    fireEvent.change(textarea, { target: { value: 'Rewritten.' } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', metaKey: true })

    // The baseline is the source the editor opened on, so the write can be refused rather
    // than land on top of a rewrite this editor never saw (pm-beads-6d5).
    await waitFor(() =>
      expect(deps.saveTextField).toHaveBeenCalledWith(
        'pm-1',
        'description',
        'Rewritten.',
        'It needs **1.21 gigawatts**.',
      ),
    )
    // The returned fresh issue is applied: the body re-renders as markdown.
    await waitFor(() =>
      expect(screen.getByTestId('description-display').textContent).toContain(
        'Rewritten.',
      ),
    )
  })

  it('saves a title edit through the injected saveTextField', async () => {
    const deps = makeDeps(makeIssue())
    deps.saveTextField.mockResolvedValue({
      ok: true,
      issue: makeIssue({ title: 'Renamed issue' }),
    })
    renderDetail(makeIssue(), { deps })
    await waitFor(() => expect(screen.getByTestId('issue-title')).toBeDefined())

    fireEvent.click(screen.getByTestId('issue-title'))
    const input = screen.getByLabelText('Issue title')
    fireEvent.change(input, { target: { value: 'Renamed issue' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(deps.saveTextField).toHaveBeenCalledWith(
        'pm-1',
        'title',
        'Renamed issue',
        'Fix the flux capacitor',
      ),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Renamed issue' }),
      ).toBeDefined(),
    )
  })

  it('offers the add-description affordance when the body is empty', async () => {
    renderDetail(makeIssue({ description: undefined }))
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )
    // An empty description used to render nothing at all.
    expect(screen.getByTestId('description-add')).toBeDefined()
  })

  it('renders neither progress nor children for a non-epic issue', async () => {
    renderDetail(makeIssue())
    await waitFor(() =>
      expect(screen.getByText('Fix the flux capacitor')).toBeDefined(),
    )
    expect(screen.queryByText('Progress')).toBeNull()
    expect(screen.queryByText('Sub-issues')).toBeNull()
  })
})
