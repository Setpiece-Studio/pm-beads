// ABOUTME: Projects route — loads epics with progress server-side and renders the Linear-style
// ABOUTME: projects view. Epic rows navigate to the project detail; child rows to the issue detail.

import {
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { z } from 'zod'
import { DeferredReadStatus } from '@/components/deferred-read-status'
import {
  type ActiveFilter,
  EPIC_FILTER_PROPERTIES,
  type FilterProperty,
  type FilterValueOption,
  filterValueOptions,
  parseFilters,
  serializeFilters,
} from '@/components/filters/filters'
import {
  ProjectPropertiesContext,
  parseProjectProperties,
} from '@/components/projects/project-properties'
import type { ProjectsDisplayOptionsPatch } from '@/components/projects/projects-display-options'
import {
  buildEpicBlockingEdges,
  buildEpicTreeEdges,
  joinEpicProgress,
  type ProjectGroupingKey,
  type ProjectOrderingKey,
  type ProjectViewMode,
  selectVisibleEpics,
} from '@/components/projects/projects-model'
import { ProjectsView } from '@/components/projects/projects-view'
import {
  StatusPipelineProvider,
  useStatusPipeline,
} from '@/components/status-pipeline-context'
import type { SavedViewParams } from '@/components/views/view-params'
import {
  hasExplicitProjectViewParams,
  projectViewPreferenceKey,
  readProjectViewPreference,
  writeProjectViewPreference,
} from '@/components/views/view-preferences'
import { ViewTabs } from '@/components/views/view-tabs'
import {
  deleteViewFn,
  listEpicsFn,
  listIssuesFn,
  listViewsFn,
  readStatusPipelineFn,
  saveViewFn,
  updateIssueFn,
} from '@/lib/beads/server-fns'
import { listStatusOrder } from '@/lib/beads/status-model'
import { refreshAfterWrite } from '@/lib/refresh-after-write'
import { useDeferredRead } from '@/lib/use-deferred-read'

const projectsSearchSchema = z.object({
  // Legacy drawer param: tolerated on input so beforeLoad can redirect old links.
  issue: z.string().optional().catch(undefined),
  filter: z.string().optional().catch(undefined),
  view: z
    .enum(['list', 'board', 'tree', 'gantt'])
    .default('list')
    .catch('list'),
  display: z.string().optional().catch(undefined),
  grouping: z.enum(['status', 'none']).default('status').catch('status'),
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
    .default('priority')
    .catch('priority'),
})

export const Route = createFileRoute('/projects')({
  validateSearch: projectsSearchSchema,
  // A legacy `?issue=<id>` URL (the removed drawer) redirects to the issue detail route,
  // carrying only the project (the detail route doesn't share the list's search shape).
  beforeLoad: ({ search }) => {
    if (search.issue) {
      throw redirect({
        to: '/issues/$issueId',
        params: { issueId: search.issue },
        search: { project: search.project },
      })
    }
  },
  loaderDeps: ({ search }) => ({
    project: search.project,
    gantt: search.view === 'gantt',
  }),
  loader: async ({ deps }) => {
    // Sequential on purpose: bd's embedded dolt backend is single-writer/single-opener,
    // so concurrent bd processes fail to open the database.
    // bd epic status only reports OPEN epics that have children; it's the progress source.
    const statuses = await listEpicsFn({ data: { projectDir: deps.project } })
    // The complete epic set (closed + childless included), which also carries the dependency
    // edges epic status omits. It's the row source; epic status is left-joined for progress.
    const issues = await listIssuesFn({
      data: {
        types: deps.gantt ? undefined : ['epic'],
        all: true,
        projectDir: deps.project,
      },
    })
    const epicIssues = issues.filter((issue) => issue.issue_type === 'epic')
    const epics = joinEpicProgress(epicIssues, statuses)
    const edges = buildEpicBlockingEdges(epicIssues)
    // Canonical parent-child links the hierarchy view nests on.
    const treeEdges = buildEpicTreeEdges(epicIssues)
    const statusPipeline = await readStatusPipelineFn({
      data: { projectDir: deps.project },
    })
    return {
      epics,
      edges,
      treeEdges,
      statusPipeline,
      ganttIssues: deps.gantt ? issues : [],
    }
  },
  component: ProjectsRoute,
})

function ProjectsRoute() {
  const { statusPipeline } = Route.useLoaderData()
  return (
    <StatusPipelineProvider value={statusPipeline}>
      <ProjectsRouteContent />
    </StatusPipelineProvider>
  )
}

function ProjectsRouteContent() {
  const loaded = Route.useLoaderData()
  const { epics, edges, treeEdges } = loaded
  const search = Route.useSearch()
  const savedViews = useDeferredRead(
    search.project ?? '',
    useCallback(
      () => listViewsFn({ data: { projectDir: search.project } }),
      [search.project],
    ),
    loaded,
  )
  const views = savedViews.value ?? []
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const statusPipeline = useStatusPipeline()
  // The projects view is a grouped list, so it reads in triage order unless the project
  // authored a pipeline of its own.
  const listOrder = useMemo(
    () => listStatusOrder(statusPipeline),
    [statusPipeline],
  )
  const preferenceKey = projectViewPreferenceKey(search.project)
  const previousPreferenceKey = useRef(preferenceKey)
  const {
    filter: searchFilter,
    grouping: searchGrouping,
    ordering: searchOrdering,
    project: searchProject,
    view: searchView,
    display: searchDisplay,
  } = search

  // Explicit URLs become the current state; ordinary navigation to `/projects` restores it.
  useEffect(() => {
    const projectChanged = previousPreferenceKey.current !== preferenceKey
    previousPreferenceKey.current = preferenceKey
    if (projectChanged) {
      const preference = readProjectViewPreference(preferenceKey)
      navigate({
        search: () => ({
          project: searchProject,
          view: preference?.view,
          display: preference?.display,
          grouping: preference?.grouping,
          ordering: preference?.ordering,
          filter: preference?.filter,
        }),
        replace: true,
      })
      return
    }
    const activeView = {
      filter: searchFilter,
      grouping: searchGrouping,
      ordering: searchOrdering,
      view: searchView,
      display: searchDisplay,
    }
    if (hasExplicitProjectViewParams(activeView)) {
      writeProjectViewPreference(preferenceKey, activeView)
      return
    }
    const preference = readProjectViewPreference(preferenceKey)
    if (!preference) return
    navigate({
      search: (prev) => ({
        ...prev,
        view: preference.view as ProjectViewMode | undefined,
        display: preference.display,
        grouping: preference.grouping as ProjectGroupingKey | undefined,
        ordering: preference.ordering as ProjectOrderingKey | undefined,
        filter: preference.filter,
      }),
      replace: true,
    })
  }, [
    navigate,
    preferenceKey,
    searchFilter,
    searchGrouping,
    searchOrdering,
    searchProject,
    searchView,
    searchDisplay,
  ])

  const filters = useMemo(() => parseFilters(search.filter), [search.filter])
  const view = search.view as ProjectViewMode
  const grouping = search.grouping as ProjectGroupingKey
  const ordering = search.ordering as ProjectOrderingKey

  // The header count matches what the view renders: closed epics are hidden unless a status
  // filter reveals them, so count the same visible set (the view groups this identical set).
  const visibleCount = useMemo(
    () => selectVisibleEpics(epics, filters).length,
    [epics, filters],
  )

  // Value options come from the loaded epics themselves; the project property
  // is not in the epic set, so no epic list is needed for derivation.
  const valueOptions = useMemo(() => {
    const epicIssues = epics.map((e) => e.epic)
    return Object.fromEntries(
      EPIC_FILTER_PROPERTIES.map((property) => [
        property,
        filterValueOptions(property, epicIssues, [], listOrder),
      ]),
    ) as Partial<Record<FilterProperty, FilterValueOption[]>>
  }, [epics, listOrder])

  const onFiltersChange = useCallback(
    (next: ActiveFilter[]) =>
      navigate({
        search: (prev) => {
          const nextSearch = { ...prev, filter: serializeFilters(next) }
          writeProjectViewPreference(preferenceKey, nextSearch)
          return nextSearch
        },
        replace: true,
      }),
    [navigate, preferenceKey],
  )

  const onViewOptionsChange = useCallback(
    (patch: ProjectsDisplayOptionsPatch) =>
      navigate({
        search: (prev) => {
          const next = { ...prev, ...patch }
          writeProjectViewPreference(preferenceKey, next)
          return next
        },
        replace: true,
      }),
    [navigate, preferenceKey],
  )

  const fetchChildren = useCallback(
    (epicId: string) =>
      listIssuesFn({
        // The containment tree renders each item exactly once, beneath its immediate parent.
        // Project detail deliberately uses the recursive `parent` query instead.
        data: { directParent: epicId, all: true, projectDir: search.project },
      }),
    [search.project],
  )

  // Epic rows go to the project detail route, carrying this list's view shape so the detail
  // top bar's n/N walks the very list the row was clicked in. Child rows go to the issue
  // detail with only `project` — they belong to no issues list, so that detail shows no
  // position. Browser-history Back restores the full projects-view state either way.
  const onSelectEpic = useCallback(
    (id: string) =>
      navigate({
        to: '/projects/$projectId',
        params: { projectId: id },
        search: (prev) => ({
          project: prev.project,
          view: prev.view,
          display: prev.display,
          grouping: prev.grouping,
          ordering: prev.ordering,
          filter: prev.filter,
        }),
      }),
    [navigate],
  )

  const onSelectIssue = useCallback(
    (id: string) =>
      navigate({
        to: '/issues/$issueId',
        params: { issueId: id },
        search: (prev) => ({ project: prev.project }),
      }),
    [navigate],
  )

  // Raw view-shape params from the URL; ViewTabs and saveViewFn normalize them.
  const currentViewParams = {
    view: search.view,
    display: search.display,
    grouping: search.grouping,
    ordering: search.ordering,
    filter: search.filter,
  }

  // Applying a view replaces the view shape: keep the project and let route
  // defaults fill any param the view omits. Only the projects-valid keys are
  // mapped (the shared SavedViewParams is wider than this route's search), and
  // normalization guarantees the stored values are valid for this route.
  const applyView = useCallback(
    (params: SavedViewParams) => {
      const next = {
        project: search.project,
        view: params.view as ProjectViewMode | undefined,
        display: params.display,
        grouping: params.grouping as ProjectGroupingKey | undefined,
        ordering: params.ordering as ProjectOrderingKey | undefined,
        filter: params.filter,
      }
      writeProjectViewPreference(preferenceKey, next)
      navigate({
        search: () => next,
      })
    },
    [navigate, preferenceKey, search.project],
  )

  const saveCurrentView = useCallback(
    async (name: string) => {
      await saveViewFn({
        data: {
          name,
          route: 'projects',
          params: {
            view: search.view,
            display: search.display,
            grouping: search.grouping,
            ordering: search.ordering,
            filter: search.filter,
          },
          projectDir: search.project,
        },
      })
      await refreshAfterWrite(router)
    },
    [
      search.view,
      search.display,
      search.grouping,
      search.ordering,
      search.filter,
      search.project,
      router,
    ],
  )

  const deleteSavedView = useCallback(
    async (id: string) => {
      await deleteViewFn({ data: { id, projectDir: search.project } })
      await refreshAfterWrite(router)
    },
    [search.project, router],
  )

  return (
    <div className="flex flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <h1 className="text-sm font-semibold">Projects</h1>
        <span className="text-xs text-muted-foreground">{visibleCount}</span>
      </header>
      <DeferredReadStatus {...savedViews} label="saved views" />
      <ViewTabs
        route="projects"
        views={views}
        currentParams={currentViewParams}
        onApply={applyView}
        onSave={saveCurrentView}
        onDelete={deleteSavedView}
      />
      <ProjectPropertiesContext.Provider
        value={{
          properties: parseProjectProperties(search.display),
          names: Object.fromEntries(
            epics.map((epic) => [epic.epic.id, epic.epic.title]),
          ),
        }}
      >
        <ProjectsView
          epics={epics}
          ganttIssues={loaded.ganttIssues}
          filters={filters}
          view={view}
          grouping={grouping}
          ordering={ordering}
          statusOrder={listOrder}
          boardStatuses={statusPipeline.statuses}
          onStatusChange={async (id, status) => {
            await updateIssueFn({
              data: { id, fields: { status }, projectDir: search.project },
            })
            await refreshAfterWrite(router)
          }}
          edges={edges}
          treeEdges={treeEdges}
          valueOptions={valueOptions}
          onFiltersChange={onFiltersChange}
          onViewOptionsChange={onViewOptionsChange}
          fetchChildren={fetchChildren}
          onSelectEpic={onSelectEpic}
          onSelectIssue={onSelectIssue}
        />
      </ProjectPropertiesContext.Provider>
    </div>
  )
}
