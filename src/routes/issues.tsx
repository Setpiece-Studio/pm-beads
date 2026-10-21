// ABOUTME: Issues view route — Linear-style issues table with grouping, ordering, and filters
// ABOUTME: held in URL search params; data loads via the beads server fns for SSR.

import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { z } from 'zod'
import { DeferredReadStatus } from '@/components/deferred-read-status'
import {
  type FilterProperty,
  type FilterValueOption,
  filterValueOptions,
  ISSUE_FILTER_PROPERTIES,
  parseFilters,
  serializeFilters,
} from '@/components/filters/filters'
import { IssuesBoard } from '@/components/issues/board'
import { serializeViewMode } from '@/components/issues/board-logic'
import {
  type GroupingKey,
  type OrderingKey,
  parseDisplayProperties,
  serializeDisplayProperties,
  type ViewOptions,
} from '@/components/issues/grouping'
import { IssuesTable } from '@/components/issues/issues-table'
import { IssuesToolbar, type ToolbarPatch } from '@/components/issues/toolbar'
import {
  StatusPipelineProvider,
  useStatusPipeline,
} from '@/components/status-pipeline-context'
import type { SavedViewParams } from '@/components/views/view-params'
import {
  hasExplicitIssueViewParams,
  issueViewPreferenceKey,
  readIssueViewPreference,
  writeIssueViewPreference,
} from '@/components/views/view-preferences'
import { ViewTabs } from '@/components/views/view-tabs'
import type { BackfillProposal } from '@/lib/beads/pr-backfill'
import {
  applyPrBackfillFn,
  deleteViewFn,
  listIssuesFn,
  listViewsFn,
  readStatusPipelineFn,
  saveViewFn,
  scanPrBackfillFn,
  skipPrBackfillFn,
  sweepMergedPrsFn,
  updateIssueFn,
} from '@/lib/beads/server-fns'
import { listStatusOrder } from '@/lib/beads/status-model'
import { refreshAfterWrite } from '@/lib/refresh-after-write'
import { useDeferredRead } from '@/lib/use-deferred-read'

const issuesSearchSchema = z.object({
  // Absent means the default list view, keeping URLs clean at the default.
  view: z.enum(['list', 'board']).optional().catch(undefined),
  grouping: z
    .enum(['status', 'project', 'label', 'none'])
    .default('status')
    .catch('status'),
  ordering: z
    .enum(['priority', 'status', 'updated'])
    .default('priority')
    .catch('priority'),
  filter: z.string().optional().catch(undefined),
  // Legacy drawer param: tolerated on input so beforeLoad can redirect old links.
  issue: z.string().optional().catch(undefined),
  display: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/issues')({
  validateSearch: issuesSearchSchema,
  // A legacy `?issue=<id>` URL (the removed drawer) redirects to the detail route,
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
  loaderDeps: ({ search }) => ({ project: search.project }),
  loader: async ({ deps }) => {
    // Sequential on purpose: bd's embedded dolt backend is single-writer/single-opener,
    // so concurrent bd processes fail to open the database.
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
    return { issues, epicNames, statusPipeline }
  },
  component: IssuesPage,
})

function IssuesPage() {
  const { statusPipeline } = Route.useLoaderData()
  return (
    <StatusPipelineProvider value={statusPipeline}>
      <IssuesPageContent />
    </StatusPipelineProvider>
  )
}

function IssuesPageContent() {
  const loaded = Route.useLoaderData()
  const { issues, epicNames } = loaded
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
  const navigate = Route.useNavigate()
  const router = useRouter()
  const statusPipeline = useStatusPipeline()
  const preferenceKey = issueViewPreferenceKey(search.project)
  const previousPreferenceKey = useRef(preferenceKey)
  const {
    display: searchDisplay,
    filter: searchFilter,
    grouping: searchGrouping,
    ordering: searchOrdering,
    project: searchProject,
    view: searchView,
  } = search

  // Explicit URLs become the current state; ordinary navigation to `/issues` restores it.
  useEffect(() => {
    const projectChanged = previousPreferenceKey.current !== preferenceKey
    previousPreferenceKey.current = preferenceKey
    if (projectChanged) {
      const preference = readIssueViewPreference(preferenceKey)
      navigate({
        search: () => ({
          project: searchProject,
          view: preference?.view,
          grouping: preference?.grouping,
          ordering: preference?.ordering,
          display: preference?.display,
          filter: preference?.filter,
        }),
        replace: true,
      })
      return
    }
    const activeView = {
      display: searchDisplay,
      filter: searchFilter,
      grouping: searchGrouping,
      ordering: searchOrdering,
      view: searchView,
    }
    if (hasExplicitIssueViewParams(activeView)) {
      writeIssueViewPreference(preferenceKey, activeView)
      return
    }
    const preference = readIssueViewPreference(preferenceKey)
    if (!preference) return
    navigate({
      search: (prev) => ({ ...prev, ...preference }),
      replace: true,
    })
  }, [
    navigate,
    preferenceKey,
    searchDisplay,
    searchFilter,
    searchGrouping,
    searchOrdering,
    searchProject,
    searchView,
  ])

  // Grouped rows read in triage order, board columns in workflow order — two deliberate
  // defaults, both of which an authored project pipeline overrides.
  const listOrder = useMemo(
    () => listStatusOrder(statusPipeline),
    [statusPipeline],
  )

  const options: ViewOptions = useMemo(
    () => ({
      grouping: search.grouping as GroupingKey,
      ordering: search.ordering as OrderingKey,
      filters: parseFilters(search.filter),
      statusOrder: listOrder,
    }),
    [search, listOrder],
  )

  const boardOptions: ViewOptions = useMemo(
    () => ({ ...options, statusOrder: statusPipeline.statuses }),
    [options, statusPipeline.statuses],
  )

  const displayProperties = useMemo(
    () => parseDisplayProperties(search.display),
    [search.display],
  )

  const valueOptions = useMemo(() => {
    const epics = Object.entries(epicNames).map(([id, title]) => ({
      id,
      title,
    }))
    return Object.fromEntries(
      ISSUE_FILTER_PROPERTIES.map((property) => [
        property,
        filterValueOptions(property, issues, epics, listOrder),
      ]),
    ) as Record<FilterProperty, FilterValueOption[]>
  }, [issues, epicNames, listOrder])

  function applyPatch(patch: ToolbarPatch) {
    const {
      view: nextView,
      displayProperties: nextDisplay,
      filters: nextFilters,
      ...rest
    } = patch
    navigate({
      search: (prev) => {
        const next = {
          ...prev,
          ...rest,
          ...(nextView !== undefined && { view: serializeViewMode(nextView) }),
          ...(nextDisplay !== undefined && {
            display: serializeDisplayProperties(nextDisplay),
          }),
          ...(nextFilters !== undefined && {
            filter: serializeFilters(nextFilters),
          }),
        }
        writeIssueViewPreference(preferenceKey, next)
        return next
      },
      replace: true,
    })
  }

  const view = search.view ?? 'list'

  // Search carried onto a row/card click. The detail route re-derives this list's reading
  // order from it, so the top bar's n/N walks the very list the row was clicked in; browser
  // history still restores the full list URL on Back.
  const detailSearch = {
    project: search.project,
    view: search.view,
    grouping: search.grouping,
    ordering: search.ordering,
    filter: search.filter,
    display: search.display,
  }

  // Raw view-shape params from the URL; ViewTabs and saveViewFn normalize them.
  const currentViewParams = {
    view: search.view,
    grouping: search.grouping,
    ordering: search.ordering,
    display: search.display,
    filter: search.filter,
  }

  // Applying a view replaces the view shape wholesale: keep the project, drop
  // the open issue, and let route defaults fill anything the view omits. Saved
  // views are normalized per route, so the shared (wider) SavedViewParams.ordering
  // only ever holds an issues-valid value here.
  function applyView(params: SavedViewParams) {
    const next = {
      project: search.project,
      ...params,
      // SavedViewParams.view is the union across routes; an issues view never
      // carries the projects-only 'tree', so narrow it to this route's shape.
      view: params.view as 'list' | 'board' | undefined,
      ordering: params.ordering as OrderingKey | undefined,
    }
    writeIssueViewPreference(preferenceKey, next)
    navigate({
      search: () => next,
    })
  }

  async function saveCurrentView(name: string) {
    await saveViewFn({
      data: {
        name,
        route: 'issues',
        params: currentViewParams,
        projectDir: search.project,
      },
    })
    await refreshAfterWrite(router)
  }

  async function deleteSavedView(id: string) {
    await deleteViewFn({ data: { id, projectDir: search.project } })
    await refreshAfterWrite(router)
  }

  /** Run the merged-PR sweep for the selected project. The toolbar owns the confirm step and
   * the summary; this only supplies the project and the dry-run flag. */
  function sweepMergedPrs(dryRun: boolean) {
    return sweepMergedPrsFn({ data: { projectDir: search.project, dryRun } })
  }

  /** The PR-history backfill's three calls. The review panel owns the selection and the
   * confirm step; these only supply the project. */
  const backfill = {
    scan: (daysBack: number) =>
      scanPrBackfillFn({ data: { projectDir: search.project, daysBack } }),
    apply: (proposals: BackfillProposal[]) =>
      applyPrBackfillFn({ data: { proposals, projectDir: search.project } }),
    skip: (ids: string[]) =>
      skipPrBackfillFn({ data: { ids, projectDir: search.project } }),
  }

  async function changeStatus(id: string, status: string) {
    await updateIssueFn({
      data: { id, fields: { status }, projectDir: search.project },
    })
    await refreshAfterWrite(router)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center border-b px-4 py-2.5">
        <h1 className="text-sm font-semibold">Issues</h1>
      </header>
      <DeferredReadStatus {...savedViews} label="saved views" />
      <ViewTabs
        route="issues"
        views={views}
        currentParams={currentViewParams}
        onApply={applyView}
        onSave={saveCurrentView}
        onDelete={deleteSavedView}
      />
      <IssuesToolbar
        view={view}
        grouping={options.grouping}
        ordering={options.ordering}
        displayProperties={displayProperties}
        filters={options.filters}
        valueOptions={valueOptions}
        onChange={applyPatch}
        sweep={sweepMergedPrs}
        backfill={backfill}
        onSelectIssue={(id) =>
          navigate({
            to: '/issues/$issueId',
            params: { issueId: id },
            search: detailSearch,
          })
        }
        // A sweep or an applied backfill closes beads; the list behind the panel has to be
        // re-read to show it.
        onSwept={() => refreshAfterWrite(router)}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {view === 'board' ? (
          <IssuesBoard
            issues={issues}
            epicNames={epicNames}
            options={boardOptions}
            displayProperties={displayProperties}
            onCardClick={(id) =>
              navigate({
                to: '/issues/$issueId',
                params: { issueId: id },
                search: detailSearch,
              })
            }
            onStatusChange={changeStatus}
          />
        ) : (
          <IssuesTable
            issues={issues}
            epicNames={epicNames}
            options={options}
            displayProperties={displayProperties}
            onRowClick={(id) =>
              navigate({
                to: '/issues/$issueId',
                params: { issueId: id },
                search: detailSearch,
              })
            }
          />
        )}
      </div>
    </div>
  )
}
