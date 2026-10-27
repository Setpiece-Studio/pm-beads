// ABOUTME: Project/epic detail route (/projects/$projectId) — loads the epic, its progress,
// ABOUTME: and recursive children server-side, then renders the top bar and IssueDetail shell.

import {
  createFileRoute,
  notFound,
  redirect,
  useLoaderData,
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
  orderedEpicIds,
  projectDisplayName,
  siblingNav,
} from '@/components/issue-detail/detail-nav'
import { DetailTopBar } from '@/components/issue-detail/detail-top-bar'
import { IssueDetail } from '@/components/issue-detail/issue-detail'
import { makeIssueEditServerDeps } from '@/components/issue-detail/server-deps'
import {
  buildEpicBlockingEdges,
  joinEpicProgress,
  type ProjectGroupingKey,
  type ProjectOrderingKey,
  type ProjectViewMode,
} from '@/components/projects/projects-model'
import { BeadLookupProvider, beadLookupIssues } from '@/lib/bead-lookup'
import { isIssueNotFoundError } from '@/lib/beads/not-found'
import {
  getIssueFn,
  listEpicsFn,
  listIssuesFn,
  readStatusPipelineFn,
} from '@/lib/beads/server-fns'
import { refreshAfterWrite } from '@/lib/refresh-after-write'
import { useDeferredRead } from '@/lib/use-deferred-read'

// The projects list's own view shape, carried onto the detail URL so the top bar's n/N walks
// the very list the user clicked from. Every key is optional here (unlike the list route, which
// defaults them): their absence is how a deep link says "no list behind this".
const listContextSchema = z.object({
  view: z.enum(['list', 'board', 'tree', 'gantt']).optional().catch(undefined),
  display: z.string().optional().catch(undefined),
  grouping: z.enum(['status', 'none']).optional().catch(undefined),
  ordering: z
    .enum([
      'priority',
      'updated',
      'created',
      'progress',
      'child-count',
      'title',
      'blocking',
    ])
    .optional()
    .catch(undefined),
  filter: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/projects_/$projectId')({
  validateSearch: listContextSchema,
  // Opt out of hover-preload (KTD11): the loader runs through bd's single-writer mutex, so
  // scrubbing the projects list must not queue serialized bd spawns ahead of a real click.
  preloadStaleTime: 30_000,
  loaderDeps: ({ search }) => ({
    project: search.project,
    grouping: search.grouping,
    ordering: search.ordering,
    filter: search.filter,
    view: search.view,
  }),
  loader: async ({ params, deps }) => {
    // Sequential on purpose: bd's embedded dolt backend is single-writer/single-opener,
    // so these reads can't parallelize (KTD2/R12).
    let issue: Awaited<ReturnType<typeof getIssueFn>>
    try {
      issue = await getIssueFn({
        data: { id: params.projectId, projectDir: deps.project },
      })
    } catch (error) {
      // A missing id renders notFoundComponent rather than the generic error one.
      if (isIssueNotFoundError(error)) {
        throw notFound({ routeId: '/projects_/$projectId' })
      }
      throw error
    }

    // Symmetric guard to the issues route's epic redirect: a non-epic's canonical home is the
    // issue route, so render one chrome, not project chrome for a plain issue (KTD12).
    if (issue.issue_type !== 'epic') {
      throw redirect({
        to: '/issues/$issueId',
        params: { issueId: issue.id },
        search: { project: deps.project },
      })
    }

    return { issue }
  },
  pendingComponent: PendingDetail,
  errorComponent: ({ error }) => <ErrorDetail error={error} noun="project" />,
  notFoundComponent: () => <NotFoundDetail noun="project" />,
  component: ProjectDetailRoute,
})

/**
 * The projects list's reading order, or null when this detail wasn't opened from one. Tree
 * mode is excluded on purpose: its reading order depends on which nodes the user has expanded,
 * which lives in the view's client state and has no server-side truth to re-derive. Both reads
 * go through the bd read-through cache the list route just warmed.
 */
async function loadSiblingIds(deps: {
  project?: string
  grouping?: ProjectGroupingKey
  ordering?: ProjectOrderingKey
  filter?: string
  view?: ProjectViewMode
}): Promise<string[] | null> {
  if (deps.grouping === undefined && deps.ordering === undefined) return null
  if (deps.view === 'tree' || deps.view === 'gantt') return null
  const statuses = await listEpicsFn({ data: { projectDir: deps.project } })
  const epicIssues = await listIssuesFn({
    data: { types: ['epic'], all: true, projectDir: deps.project },
  })
  // The projects list groups by the selected project's own status order, so the top bar has to
  // read the same pipeline or it counts a list nobody is looking at (pm-beads-r8l.3).
  const statusPipeline = await readStatusPipelineFn({
    data: { projectDir: deps.project },
  })
  return orderedEpicIds(
    joinEpicProgress(epicIssues, statuses),
    {
      grouping: deps.grouping ?? 'status',
      ordering: deps.ordering ?? 'priority',
      filters: parseFilters(deps.filter),
    },
    buildEpicBlockingEdges(epicIssues),
    statusPipeline,
  )
}

function ProjectDetailRoute() {
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
  const completion = useDeferredRead(
    scope,
    useCallback(async () => {
      const epics = await listEpicsFn({ data: { projectDir: search.project } })
      const match = epics.find((epic) => epic.epic.id === issue.id)
      return match
        ? { closed: match.closed_children, total: match.total_children }
        : undefined
    }, [issue.id, search.project]),
    rootData,
  )
  const progress = completion.value

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
    (projectId: string) =>
      navigate({
        to: '/projects/$projectId',
        params: { projectId },
        search: (p) => p,
      }),
    [navigate],
  )

  return (
    <BeadLookupProvider issues={beads} project={search.project}>
      <div className="flex h-full min-h-0 flex-col">
        <DetailTopBar
          projectName={projectDisplayName(search.project, defaultProject.name)}
          section="projects"
          project={search.project}
          id={issue.id}
          title={issue.title}
          nav={nav}
          onNavigate={onNavigate}
        />
        <DeferredReadStatus {...related} label="related issues" />
        <DeferredReadStatus {...navigation} label="issue navigation" />
        <DeferredReadStatus {...completion} label="project progress" />
        <div className="min-h-0 flex-1">
          <IssueDetail
            issue={issue}
            deps={deps}
            onMutated={() => refreshAfterWrite(router)}
            revision={revision}
            search={{ project: search.project }}
            progress={progress}
            childIssues={children}
          />
        </div>
      </div>
    </BeadLookupProvider>
  )
}
