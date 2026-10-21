// ABOUTME: Issue detail route (/issues/$issueId) — loads one issue (deps + comments) server-side,
// ABOUTME: redirects epics to the project route, and renders the top bar plus the IssueDetail shell.

import {
  createFileRoute,
  notFound,
  redirect,
  useLoaderData,
  useLocation,
  useRouter,
} from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { z } from 'zod'
import { DeferredReadStatus } from '@/components/deferred-read-status'
import { parseFilters } from '@/components/filters/filters'
import {
  ErrorDetail,
  NotFoundDetail,
  PendingDetail,
} from '@/components/issue-detail/detail-chrome'
import {
  orderedIssueIds,
  projectDisplayName,
  siblingNav,
} from '@/components/issue-detail/detail-nav'
import { DetailTopBar } from '@/components/issue-detail/detail-top-bar'
import { IssueDetail } from '@/components/issue-detail/issue-detail'
import { makeIssueEditServerDeps } from '@/components/issue-detail/server-deps'
import type { ViewMode } from '@/components/issues/board-logic'
import type { GroupingKey, OrderingKey } from '@/components/issues/grouping'
import { BeadLookupProvider, beadLookupIssues } from '@/lib/bead-lookup'
import { isIssueNotFoundError } from '@/lib/beads/not-found'
import {
  getIssueFn,
  listIssuesFn,
  readStatusPipelineFn,
} from '@/lib/beads/server-fns'
import { commentIdFromHash } from '@/lib/comment-refs'
import { refreshAfterWrite } from '@/lib/refresh-after-write'
import { useDeferredRead } from '@/lib/use-deferred-read'

// The issues list's own view shape, carried onto the detail URL so the top bar's n/N walks the
// very list the user clicked from. Every key is optional here (unlike the list route, which
// defaults them): their absence is how a deep link says "no list behind this".
const listContextSchema = z.object({
  view: z.enum(['list', 'board']).optional().catch(undefined),
  grouping: z
    .enum(['status', 'project', 'label', 'none'])
    .optional()
    .catch(undefined),
  ordering: z
    .enum(['priority', 'status', 'updated'])
    .optional()
    .catch(undefined),
  filter: z.string().optional().catch(undefined),
  display: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/issues_/$issueId')({
  validateSearch: listContextSchema,
  // Opt out of hover-preload: getIssueFn runs through bd's single-writer mutex,
  // so scrubbing a dense list must not queue serialized bd spawns ahead of a click.
  preloadStaleTime: 30_000,
  loaderDeps: ({ search }) => ({
    project: search.project,
    grouping: search.grouping,
    ordering: search.ordering,
    filter: search.filter,
    view: search.view,
  }),
  loader: async ({ params, deps }) => {
    let issue: Awaited<ReturnType<typeof getIssueFn>>
    try {
      issue = await getIssueFn({
        data: { id: params.issueId, projectDir: deps.project },
      })
    } catch (error) {
      // A missing id renders this route's notFoundComponent rather than the generic error one.
      if (isIssueNotFoundError(error)) {
        throw notFound({ routeId: '/issues_/$issueId' })
      }
      throw error
    }
    // An epic's canonical home is the project route; render one chrome, not two (KTD12).
    if (issue.issue_type === 'epic') {
      throw redirect({
        to: '/projects/$projectId',
        params: { projectId: issue.id },
        search: { project: deps.project },
      })
    }
    return { issue }
  },
  pendingComponent: PendingDetail,
  errorComponent: ({ error }) => <ErrorDetail error={error} noun="issue" />,
  notFoundComponent: () => <NotFoundDetail noun="issue" />,
  component: IssueDetailRoute,
})

/**
 * The issues list's reading order, or null when this detail wasn't opened from a list. The bead
 * reads go through the bd read-through cache the list route just warmed. The status pipeline is
 * read here too rather than borrowed from the root loader: the list groups by the selected
 * project's own status order, so a sequence derived from the built-in defaults would have the
 * top bar counting a different list than the one on screen (pm-beads-r8l.3).
 */
async function loadSiblingIds(deps: {
  project?: string
  grouping?: GroupingKey
  ordering?: OrderingKey
  filter?: string
  view?: ViewMode
}): Promise<string[] | null> {
  if (deps.grouping === undefined && deps.ordering === undefined) return null
  const issues = await listIssuesFn({
    data: { all: true, projectDir: deps.project },
  })
  const epicNames = Object.fromEntries(
    issues
      .filter((issue) => issue.issue_type === 'epic')
      .map((issue) => [issue.id, issue.title]),
  )
  const statusPipeline = await readStatusPipelineFn({
    data: { projectDir: deps.project },
  })
  return orderedIssueIds(
    issues,
    {
      grouping: deps.grouping ?? 'status',
      ordering: deps.ordering ?? 'priority',
      filters: parseFilters(deps.filter),
      view: deps.view ?? 'list',
    },
    epicNames,
    statusPipeline,
  )
}

function IssueDetailRoute() {
  const { issue } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const rootData = useLoaderData({ from: '__root__' })
  const { defaultProject } = rootData
  const scope = JSON.stringify([search.project, issue.id])
  const related = useDeferredRead(
    scope,
    useCallback(async () => {
      const issues = await listIssuesFn({
        data: { all: true, projectDir: search.project },
      })
      const children = await listIssuesFn({
        data: { parent: issue.id, all: true, projectDir: search.project },
      })
      return { children, beads: beadLookupIssues(issues) }
    }, [issue.id, search.project]),
    rootData,
  )
  const navigation = useDeferredRead(
    JSON.stringify([
      scope,
      search.grouping,
      search.ordering,
      search.filter,
      search.view,
    ]),
    useCallback(
      () =>
        loadSiblingIds({
          project: search.project,
          grouping: search.grouping,
          ordering: search.ordering,
          filter: search.filter,
          view: search.view,
        }),
      [
        search.project,
        search.grouping,
        search.ordering,
        search.filter,
        search.view,
      ],
    ),
    rootData,
  )
  const children = related.value?.children
  const beads = related.value?.beads ?? beadLookupIssues([issue])
  const siblingIds = navigation.value

  // `/issues/<id>#comment-<cid>` is a shareable link to one comment — the same anchor the
  // inbox's quoted comments use, honoured here so the link works outside the drawer too.
  const commentAnchor = commentIdFromHash(useLocation().hash)
  // Refresh lists and the detail after writes; wait out pre-write route reads first.
  const revision = Route.useMatch({ select: (match) => match.updatedAt })
  const deps = useMemo(
    () => makeIssueEditServerDeps(search.project),
    [search.project],
  )

  const nav = useMemo(
    () => (siblingIds ? siblingNav(siblingIds, issue.id) : null),
    [siblingIds, issue.id],
  )

  // Sibling navigation keeps the list context in the URL, so n/N stays anchored to the
  // same list as the user walks it.
  const onNavigate = useCallback(
    (issueId: string) =>
      navigate({
        to: '/issues/$issueId',
        params: { issueId },
        search: (p) => p,
      }),
    [navigate],
  )

  return (
    <BeadLookupProvider issues={beads} project={search.project}>
      <div className="flex h-full min-h-0 flex-col">
        <DetailTopBar
          projectName={projectDisplayName(search.project, defaultProject.name)}
          section="issues"
          project={search.project}
          id={issue.id}
          title={issue.title}
          nav={nav}
          onNavigate={onNavigate}
        />
        <DeferredReadStatus {...related} label="related issues" />
        <DeferredReadStatus {...navigation} label="issue navigation" />

        <div className="min-h-0 flex-1">
          <IssueDetail
            issue={issue}
            deps={deps}
            onMutated={() => refreshAfterWrite(router)}
            revision={revision}
            search={{ project: search.project }}
            childIssues={children}
            commentAnchor={commentAnchor}
          />
        </div>
      </div>
    </BeadLookupProvider>
  )
}
