// ABOUTME: Component tests for bead chips in markdown — the status glyph and title from the
// ABOUTME: lookup, epic vs issue hrefs, the ?project= carry, onOpenBead, and code-span safety.

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
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Markdown } from '@/components/ui/markdown'
import { type BeadLookupIssue, BeadLookupProvider } from '@/lib/bead-lookup'

// jsdom has no scrollTo; the router calls it on mount.
beforeAll(() => {
  vi.stubGlobal('scrollTo', vi.fn())
})

afterEach(cleanup)

const ISSUES: BeadLookupIssue[] = [
  {
    id: 'pm-beads-1',
    title: 'Cache read is slow',
    status: 'in_progress',
    issue_type: 'task',
  },
  {
    id: 'pm-beads-6wt',
    title: 'Messages as a review channel',
    status: 'open',
    issue_type: 'epic',
  },
  {
    id: 'pm-beads-10',
    title: 'Tenth bead',
    status: 'closed',
    issue_type: 'task',
  },
]

async function renderMarkdown(
  source: string,
  options: {
    issues?: BeadLookupIssue[] | null
    project?: string
    onOpenBead?: (id: string) => void
  } = {},
) {
  const { issues = ISSUES, project, onOpenBead } = options
  const body =
    issues === null ? (
      <Markdown>{source}</Markdown>
    ) : (
      <BeadLookupProvider
        issues={issues}
        project={project}
        onOpenBead={onOpenBead}
      >
        <Markdown>{source}</Markdown>
      </BeadLookupProvider>
    )

  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => body,
  })
  const issueRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/issues/$issueId',
    component: () => null,
  })
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/projects/$projectId',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, issueRoute, projectRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    scrollRestoration: false,
  })
  // biome-ignore lint/suspicious/noExplicitAny: test router isn't the app's typed route tree.
  const result = render(<RouterProvider router={router as any} />)
  // The router resolves its first match asynchronously; wait for the body to be on screen.
  await waitFor(() =>
    expect(
      result.container.querySelector('[data-slot="markdown"]'),
    ).not.toBeNull(),
  )
  return result
}

function chip(id: string): HTMLAnchorElement {
  const found = document.querySelector<HTMLAnchorElement>(
    `a[data-bead-chip="${id}"]`,
  )
  if (found === null) throw new Error(`no chip for ${id}`)
  return found
}

describe('bead chips in markdown', () => {
  it('turns a bare id into a chip reading as the bead title, id on hover', async () => {
    await renderMarkdown('Blocked by pm-beads-1 until Friday')

    const link = chip('pm-beads-1')
    // The chip is prose: the title carries it, and the id lives in the hover text.
    expect(link.textContent).toContain('Cache read is slow')
    expect(link.textContent).not.toContain('pm-beads-1')
    expect(link.getAttribute('title')).toBe('Cache read is slow · pm-beads-1')
    expect(link.getAttribute('href')).toBe('/issues/pm-beads-1')
    // The status glyph renders its accessible label beside the title.
    expect(link.textContent).toContain('In Progress')
  })

  it('links an epic to its project route', async () => {
    await renderMarkdown('rolls up to pm-beads-6wt')
    expect(chip('pm-beads-6wt').getAttribute('href')).toBe(
      '/projects/pm-beads-6wt',
    )
  })

  it('carries ?project= onto the link like the rest of the app', async () => {
    await renderMarkdown('see pm-beads-1', { project: '/tmp/beads' })
    expect(chip('pm-beads-1').getAttribute('href')).toBe(
      '/issues/pm-beads-1?project=%2Ftmp%2Fbeads',
    )
  })

  it('renders an explicit [[id]] as a chip and drops the brackets', async () => {
    const { container } = await renderMarkdown('as in [[pm-beads-1]] here')
    expect(chip('pm-beads-1')).toBeDefined()
    expect(container.textContent).not.toContain('[[')
  })

  it('renders a pm-beads url as a chip instead of the raw url', async () => {
    const { container } = await renderMarkdown(
      'http://localhost:8345/projects/pm-beads-6wt',
    )
    expect(chip('pm-beads-6wt').getAttribute('href')).toBe(
      '/projects/pm-beads-6wt',
    )
    expect(container.textContent).not.toContain('localhost:8345')
  })

  it('leaves ids inside code spans and fences alone', async () => {
    const { container } = await renderMarkdown(
      [
        'run `bd show pm-beads-1`',
        '',
        '```',
        'bd close pm-beads-10',
        '```',
      ].join('\n'),
    )
    expect(container.querySelector('a[data-bead-chip]')).toBeNull()
    expect(container.querySelector('code')?.textContent).toContain(
      'bd show pm-beads-1',
    )
  })

  it('does not link an unknown prefix', async () => {
    const { container } = await renderMarkdown('see other-project-4 today')
    expect(container.querySelector('a[data-bead-chip]')).toBeNull()
  })

  it('falls back to the id for a bead that is not in the loaded set', async () => {
    await renderMarkdown('see pm-beads-99 and pm-beads-1')
    const unknown = chip('pm-beads-99')
    // No title to lead with, so the id is the label — and the hover says the same thing.
    expect(unknown.textContent).toContain('pm-beads-99')
    expect(unknown.getAttribute('title')).toBe('pm-beads-99')
    expect(unknown.querySelector('svg')).toBeNull()
    expect(chip('pm-beads-1').querySelector('svg')).not.toBeNull()
  })

  it('leaves ordinary links and text untouched', async () => {
    const { container } = await renderMarkdown(
      '[docs](https://example.test/guide) and plain words',
    )
    expect(container.querySelector('a[data-bead-chip]')).toBeNull()
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.test/guide')
    expect(link?.textContent).toBe('docs')
  })

  it('calls onOpenBead instead of navigating when the host provides one', async () => {
    const onOpenBead = vi.fn()
    await renderMarkdown('see pm-beads-1', { onOpenBead })

    const link = chip('pm-beads-1')
    // Still a real href, so middle-click and "open in new tab" keep working.
    expect(link.getAttribute('href')).toBe('/issues/pm-beads-1')

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(link, event)

    expect(onOpenBead).toHaveBeenCalledWith('pm-beads-1')
    expect(event.defaultPrevented).toBe(true)
  })

  it('lets a modified click through to the browser', async () => {
    const onOpenBead = vi.fn()
    await renderMarkdown('see pm-beads-1', { onOpenBead })

    // The chip deliberately does NOT preventDefault here, and jsdom cannot navigate; swallow
    // the default action after the chip has had the event so the run stays quiet.
    document.addEventListener('click', (event) => event.preventDefault(), {
      once: true,
    })
    fireEvent.click(chip('pm-beads-1'), { metaKey: true })
    expect(onOpenBead).not.toHaveBeenCalled()
  })

  it('renders no chips at all without a lookup, apart from explicit urls', async () => {
    const { container } = await renderMarkdown(
      'pm-beads-1 and http://localhost:8345/issues/pm-beads-1',
      { issues: null },
    )
    const chips = container.querySelectorAll('a[data-bead-chip]')
    expect(chips).toHaveLength(1)
    expect(chips[0].getAttribute('href')).toBe('/issues/pm-beads-1')
    expect(screen.getByText(/pm-beads-1 and/)).toBeDefined()
  })
})
