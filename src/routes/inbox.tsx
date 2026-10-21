// ABOUTME: Inbox queue of beads with open asks and an editable compact detail pane.
// ABOUTME: Reading never dismisses an ask; answering the final ask removes its row.

import { createFileRoute, useLocation, useRouter } from '@tanstack/react-router'
import { useMemo } from 'react'
import { z } from 'zod'
import { inboxActions } from '@/components/inbox/inbox-actions'
import { inboxSorts } from '@/components/inbox/inbox-model'
import { InboxToolbar } from '@/components/inbox/inbox-toolbar'
import { NotificationList } from '@/components/inbox/notification-list'
import { openAskRows } from '@/components/inbox/open-ask-rows'
import { IssueDetail } from '@/components/issue-detail/issue-detail'
import { IssueHeaderBar } from '@/components/issue-detail/issue-header-bar'
import { makeIssueEditServerDeps } from '@/components/issue-detail/server-deps'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { BeadLookupProvider, beadLookupIssues } from '@/lib/bead-lookup'
import { isIssueNotFoundError } from '@/lib/beads/not-found'
import {
  commentAsViewerFn,
  getIssueFn,
  listIssuesFn,
} from '@/lib/beads/server-fns'
import type { ShowIssue } from '@/lib/beads/types'
import { commentIdFromHash } from '@/lib/comment-refs'
import { refreshAfterWrite } from '@/lib/refresh-after-write'

export const Route = createFileRoute('/inbox')({
  // Retired tab/scope/read filters are ignored, including on bookmarked URLs.
  validateSearch: z.object({
    sort: z.enum(inboxSorts).default('newest').catch('newest'),
    bead: z.string().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ project: search.project, bead: search.bead }),
  loader: async ({ deps }) => {
    const issues = await listIssuesFn({
      data: { all: true, projectDir: deps.project },
    })
    let bead: ShowIssue | null = null
    if (deps.bead) {
      try {
        bead = await getIssueFn({
          data: { id: deps.bead, projectDir: deps.project },
        })
      } catch (error) {
        if (!isIssueNotFoundError(error)) throw error
      }
    }
    return { issues, bead }
  },
  component: InboxPage,
})

function InboxPage() {
  const { issues, bead } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const revision = Route.useMatch({ select: (match) => match.updatedAt })
  const commentAnchor = commentIdFromHash(useLocation().hash)
  const rows = useMemo(
    () => openAskRows(issues, search.sort),
    [issues, search.sort],
  )
  const beadDeps = useMemo(
    () => ({
      ...makeIssueEditServerDeps(search.project),
      addComment: (id: string, text: string) =>
        commentAsViewerFn({ data: { id, text, projectDir: search.project } }),
    }),
    [search.project],
  )
  const openBead = (id: string) =>
    navigate({
      to: '/issues/$issueId',
      params: { issueId: id },
      search: { project: search.project },
    })

  return (
    <BeadLookupProvider
      issues={beadLookupIssues(issues)}
      project={search.project}
    >
      <div className="flex h-full min-h-0">
        <div className="flex w-80 shrink-0 flex-col border-r">
          <InboxToolbar
            count={rows.length}
            sort={search.sort}
            onChange={({ sort }) => {
              void navigate({
                search: (prev) => ({ ...prev, sort }),
                replace: true,
              })
            }}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NotificationList
              rows={rows}
              label="Open asks"
              emptyLabel="No open asks."
              selectedKey={bead ? `bead:${bead.id}` : undefined}
              onSelect={(row) =>
                void navigate({
                  search: (prev) => ({ ...prev, bead: row.issueId }),
                })
              }
              onOpenBead={(row) => {
                if (row.issueId) void openBead(row.issueId)
              }}
            />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          {bead ? (
            <div className="flex h-full min-h-0 flex-col">
              <IssueHeaderBar
                id={bead.id}
                title={bead.title}
                noun="bead"
                overflow={inboxActions({
                  issueId: bead.id,
                  openBead: () => void openBead(bead.id),
                }).map((action) => (
                  <DropdownMenuItem
                    key={action.key}
                    disabled={action.disabled}
                    onSelect={action.run}
                  >
                    <action.icon />
                    {action.label}
                  </DropdownMenuItem>
                ))}
              />
              <div className="min-h-0 flex-1">
                <IssueDetail
                  key={bead.id}
                  issue={bead}
                  deps={beadDeps}
                  compactProperties
                  onMutated={() => refreshAfterWrite(router)}
                  revision={revision}
                  search={{ project: search.project }}
                  commentAnchor={commentAnchor}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-[13px] text-muted-foreground">
              {rows.length
                ? 'Select a bead to answer its asks.'
                : 'No open asks. You’re all caught up.'}
            </div>
          )}
        </div>
      </div>
    </BeadLookupProvider>
  )
}
