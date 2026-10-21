// ABOUTME: Rendering + interaction tests for the Activity section — the interleaved timeline,
// ABOUTME: the history-unavailable degradation note, and the comment composer.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IssueActivity } from '@/lib/beads/queries'
import type { Comment, Message, ShowIssue } from '@/lib/beads/types'
import { initials } from '../activity-items'
import { ActivitySection } from '../activity-section'

function makeIssue(overrides: Partial<ShowIssue> = {}): ShowIssue {
  return {
    id: 'pm-1',
    title: 'Fix the flux capacitor',
    status: 'in_progress',
    priority: 1,
    issue_type: 'task',
    created_at: '2026-06-01T00:00:00Z',
    created_by: 'Doc Brown',
    updated_at: '2026-06-10T00:00:00Z',
    ...overrides,
  }
}

function comment(id: string, created_at: string, text = `body ${id}`): Comment {
  return { id, issue_id: 'pm-1', author: 'Marty McFly', text, created_at }
}

function activity(overrides: Partial<IssueActivity> = {}): IssueActivity {
  return {
    events: [
      {
        kind: 'created',
        id: 'h0:created',
        at: '2026-06-01T00:00:00Z',
        actor: 'Doc Brown',
      },
      {
        kind: 'status',
        id: 'h1:status',
        at: '2026-06-02T00:00:00Z',
        from: 'open',
        to: 'in_progress',
      },
    ],
    comments: [comment('c1', '2026-06-03T00:00:00Z', 'Great **Scott**!')],
    messages: [],
    historyUnavailable: false,
    ...overrides,
  }
}

function ackMessage(): Message {
  return {
    id: 'pm-wisp-ack',
    title: 'Acknowledged response',
    description: 'Acknowledged comment:c1',
    status: 'open',
    priority: 2,
    issue_type: 'message',
    ephemeral: true,
    created_at: '2026-06-03T01:00:00Z',
    created_by: 'agent-a',
    updated_at: '2026-06-03T01:00:00Z',
    metadata: { message_kind: 'ack', comment_id: 'c1' },
  }
}

function renderSection(
  feed: IssueActivity = activity(),
  overrides: {
    issue?: ShowIssue
    addComment?: (id: string, text: string) => Promise<IssueActivity>
    onCommented?: () => void
    commentAnchor?: string
  } = {},
) {
  const deps = {
    getActivity: vi.fn().mockResolvedValue(feed),
    addComment: vi.fn(overrides.addComment ?? (async () => feed)),
  }
  const view = render(
    <ActivitySection
      issue={overrides.issue ?? makeIssue()}
      deps={deps}
      onCommented={overrides.onCommented}
      commentAnchor={overrides.commentAnchor}
    />,
  )
  if (overrides.commentAnchor === undefined) {
    fireEvent.click(screen.getByRole('button', { name: 'Load comments' }))
  }
  return { deps, view }
}

describe('ActivitySection', () => {
  afterEach(cleanup)

  it('does not read or render comments until requested, and resets for another issue', async () => {
    const deps = {
      getActivity: vi.fn().mockResolvedValue(activity()),
      addComment: vi.fn(),
    }
    const view = render(
      <ActivitySection
        issue={makeIssue({ comments: [comment('seed', '', 'hidden comment')] })}
        deps={deps}
      />,
    )
    expect(deps.getActivity).not.toHaveBeenCalled()
    expect(screen.queryByText('hidden comment')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Load comments' }))
    await waitFor(() => expect(screen.getByText('Marty McFly')).toBeDefined())
    expect(deps.getActivity).toHaveBeenCalledTimes(1)
    view.rerender(
      <ActivitySection issue={makeIssue({ id: 'pm-2' })} deps={deps} />,
    )
    expect(screen.getByRole('button', { name: 'Load comments' })).toBeDefined()
    expect(screen.queryByText('Marty McFly')).toBeNull()
    expect(deps.getActivity).toHaveBeenCalledTimes(1)
  })

  it('renders events and comments interleaved oldest-first', async () => {
    renderSection()
    await waitFor(() =>
      expect(screen.getByText('Doc Brown created the issue')).toBeDefined(),
    )
    expect(
      screen.getByText('Status changed from Open to In Progress'),
    ).toBeDefined()

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.textContent).toContain('created the issue')
    expect(rows[1]?.textContent).toContain('Status changed')
    expect(rows[2]?.textContent).toContain('Marty McFly')
  })

  it('renders a comment body as markdown with an initials avatar', async () => {
    renderSection()
    await waitFor(() => expect(screen.getByText('Marty McFly')).toBeDefined())
    // The comment body goes through Markdown: the bold span proves it isn't plain text.
    expect(
      document.querySelector('[data-slot="markdown"] strong')?.textContent,
    ).toBe('Scott')
    expect(screen.getByTitle('Marty McFly').textContent).toBe('MM')
  })

  it('renders a typed acknowledgment message in the chronological stream', async () => {
    renderSection(activity({ messages: [ackMessage()] }))
    await waitFor(() => expect(screen.getByText('Acknowledged')).toBeDefined())
    expect(screen.getByText('agent-a')).toBeDefined()
    expect(
      screen.getByText('View acknowledged comment').getAttribute('href'),
    ).toBe('#comment-c1')
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('seeds the stream from the issue comments before the activity read lands', () => {
    // No await: the effect's promise has not resolved yet, so only the seed is on screen.
    renderSection(activity(), {
      issue: makeIssue({
        comments: [comment('seed', '2026-06-03T00:00:00Z', 'seeded body')],
      }),
    })
    expect(screen.getByText('seeded body')).toBeDefined()
  })

  it('shows a muted note and comments only when bd history is unavailable', async () => {
    renderSection(activity({ events: [], historyUnavailable: true }))
    await waitFor(() =>
      expect(
        screen.getByText(/History unavailable for this issue/),
      ).toBeDefined(),
    )
    // The stream still renders the comment; no event rows accompany it.
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText(/created the issue/)).toBeNull()
    // The composer is still usable in the degraded state.
    expect(screen.getByLabelText('Leave a comment')).toBeDefined()
  })

  it('posts a comment through the send button and renders the returned stream', async () => {
    const posted = activity({
      comments: [
        comment('c1', '2026-06-03T00:00:00Z', 'Great **Scott**!'),
        comment('c2', '2026-06-04T00:00:00Z', 'roads? where we are going'),
      ],
    })
    const onCommented = vi.fn()
    const { deps } = renderSection(activity(), {
      addComment: async () => posted,
      onCommented,
    })
    await waitFor(() => expect(deps.getActivity).toHaveBeenCalledWith('pm-1'))

    const box = screen.getByLabelText('Leave a comment')
    fireEvent.change(box, {
      target: { value: '  roads? where we are going  ' },
    })
    fireEvent.click(screen.getByLabelText('Send comment'))

    // The text is trimmed before it reaches bd.
    await waitFor(() =>
      expect(deps.addComment).toHaveBeenCalledWith(
        'pm-1',
        'roads? where we are going',
      ),
    )
    await waitFor(() =>
      expect(screen.getByText('roads? where we are going')).toBeDefined(),
    )
    // The draft is cleared and the host is told to invalidate its lists.
    expect((box as HTMLTextAreaElement).value).toBe('')
    expect(onCommented).toHaveBeenCalled()
  })

  it('submits on Ctrl/Cmd+Enter but leaves a bare Enter as a newline', async () => {
    const { deps } = renderSection()
    const box = screen.getByLabelText('Leave a comment')

    fireEvent.change(box, { target: { value: 'first line' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(deps.addComment).not.toHaveBeenCalled()

    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    await waitFor(() =>
      expect(deps.addComment).toHaveBeenCalledWith('pm-1', 'first line'),
    )
  })

  it('refuses to send an empty or whitespace-only draft', async () => {
    const { deps } = renderSection()
    const box = screen.getByLabelText('Leave a comment')

    expect(
      (screen.getByLabelText('Send comment') as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.change(box, { target: { value: '   ' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(deps.addComment).not.toHaveBeenCalled())
  })

  it('keeps the draft and surfaces the error when the post fails', async () => {
    renderSection(activity(), {
      addComment: async () => {
        throw new Error('bd: database locked')
      },
    })
    const box = screen.getByLabelText('Leave a comment')
    fireEvent.change(box, { target: { value: 'retry me' } })
    fireEvent.click(screen.getByLabelText('Send comment'))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'bd: database locked',
      ),
    )
    expect((box as HTMLTextAreaElement).value).toBe('retry me')
  })

  it('re-reads activity when an inline edit bumps the issue updated_at', async () => {
    const { deps, view } = renderSection()
    await waitFor(() => expect(deps.getActivity).toHaveBeenCalledTimes(1))

    view.rerender(
      <ActivitySection
        issue={makeIssue({ updated_at: '2026-06-11T00:00:00Z' })}
        deps={deps}
      />,
    )
    await waitFor(() => expect(deps.getActivity).toHaveBeenCalledTimes(2))
  })

  it('surfaces a failed activity read without losing the composer', async () => {
    const deps = {
      getActivity: vi.fn().mockRejectedValue(new Error('bd: timed out')),
      addComment: vi.fn(),
    }
    render(<ActivitySection issue={makeIssue()} deps={deps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load comments' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('bd: timed out'),
    )
    expect(screen.getByLabelText('Leave a comment')).toBeDefined()
    deps.getActivity.mockResolvedValue(activity())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('Marty McFly')).toBeDefined())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('anchors every comment row so a #comment-<id> link can land on it', async () => {
    renderSection()
    await waitFor(() =>
      expect(document.getElementById('comment-c1')).not.toBeNull(),
    )
    // History events carry no id anyone could link to.
    const rows = screen.getAllByRole('listitem')
    expect(rows.filter((row) => row.id !== '')).toHaveLength(1)
  })

  it('scrolls the anchored comment into view once the stream holds it', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    renderSection(activity(), { commentAnchor: 'c1' })

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
  })

  it('highlights the anchored comment row', async () => {
    renderSection(activity(), { commentAnchor: 'c1' })
    await waitFor(() =>
      expect(document.getElementById('comment-c1')?.className).toContain(
        'ring-2',
      ),
    )
  })

  it('leaves every row unhighlighted without an anchor', async () => {
    renderSection()
    await waitFor(() =>
      expect(document.getElementById('comment-c1')).not.toBeNull(),
    )
    expect(document.getElementById('comment-c1')?.className).not.toContain(
      'ring-2',
    )
  })
})

describe('ActivitySection timeline rail', () => {
  afterEach(cleanup)

  /** The rail segment a row draws down to the row beneath it. */
  function rail(row: HTMLElement | undefined) {
    return row?.querySelector('[data-timeline-rail]') ?? null
  }

  it('joins consecutive events and breaks where a comment card starts', async () => {
    // created → status → comment: the rail belongs between the first pair only.
    renderSection()
    await waitFor(() =>
      expect(screen.getByText('Doc Brown created the issue')).toBeDefined(),
    )
    const rows = screen.getAllByRole('listitem')
    expect(rail(rows[0])).not.toBeNull()
    expect(rail(rows[1])).toBeNull()
    expect(rail(rows[2])).toBeNull()
  })

  it('draws no rail at all when nothing but comments is in the stream', async () => {
    renderSection(activity({ events: [], historyUnavailable: true }))
    await waitFor(() => expect(screen.getByText('Marty McFly')).toBeDefined())
    expect(document.querySelector('[data-timeline-rail]')).toBeNull()
  })

  it('puts the comment author’s avatar inside the card, off the timeline column', async () => {
    renderSection()
    await waitFor(() => expect(screen.getByText('Marty McFly')).toBeDefined())
    const avatar = screen.getByTitle('Marty McFly')
    expect(avatar.textContent).toBe('MM')
    expect(avatar.closest('article')).not.toBeNull()
  })

  it('keeps the inert comment menu out of sight until the card is hovered', async () => {
    renderSection()
    await waitFor(() => expect(screen.getByText('Marty McFly')).toBeDefined())
    const menu = screen.getByLabelText('Comment actions') as HTMLButtonElement
    // Still disabled — bd exposes no comment mutations beyond add — but no longer permanent
    // noise on every card in the feed.
    expect(menu.disabled).toBe(true)
    expect(menu.className).toContain('opacity-0')
    expect(menu.className).toContain('group-hover:opacity-100')
    expect(menu.className).toContain('group-focus-within:opacity-100')
  })
})

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Ben Harper')).toBe('BH')
    expect(initials('doc emmett brown')).toBe('DE')
  })

  it('falls back to one letter for a single word or an email', () => {
    expect(initials('marty')).toBe('M')
    expect(initials('marty@hillvalley.example')).toBe('M')
  })

  it('renders a placeholder rather than an empty disc for a blank name', () => {
    expect(initials('   ')).toBe('?')
  })
})
