// ABOUTME: Global object search route — URL-backed query and kind filters over the selected
// ABOUTME: project's cached issues, epics, and persistent memories.

import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { SearchIcon } from 'lucide-react'
import { z } from 'zod'
import {
  type SearchKind,
  searchKinds,
  searchObjects,
} from '@/components/search/search-model'
import { listIssuesFn, listMemoriesFn } from '@/lib/beads/server-fns'
import { cn } from '@/lib/utils'

const searchSchema = z.object({
  project: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  kind: z.enum(searchKinds).default('all').catch('all'),
})

export const Route = createFileRoute('/search')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ project: search.project }),
  loader: async ({ deps }) => {
    // Sequential because embedded Dolt projects permit only one opener. Both reads use the
    // app's shared caches, so typing never spawns a bd process.
    const issues = await listIssuesFn({
      data: { all: true, projectDir: deps.project },
    })
    const memories = await listMemoriesFn({
      data: { projectDir: deps.project },
    })
    return { issues, memories }
  },
  component: SearchRoute,
})

const KIND_LABELS: Record<SearchKind, string> = {
  all: 'All',
  issues: 'Issues',
  projects: 'Projects',
  memories: 'Memories',
}

function SearchRoute() {
  const { issues, memories } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const query = search.q ?? ''
  const results = searchObjects(issues, memories, query, search.kind)

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 py-8">
      <label className="flex items-center gap-3 border-b pb-4">
        <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
        <span className="sr-only">Search objects</span>
        <input
          value={query}
          onChange={(event) =>
            navigate({
              search: (prev) => ({
                ...prev,
                q: event.target.value || undefined,
              }),
              replace: true,
            })
          }
          placeholder="Search issues, projects, and memories…"
          className="min-w-0 flex-1 bg-transparent text-xl outline-none placeholder:text-muted-foreground/65"
        />
      </label>

      <div className="flex items-center gap-2 border-b py-4">
        {searchKinds.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() =>
              navigate({
                search: (prev) => ({ ...prev, kind }),
                replace: true,
              })
            }
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              search.kind === kind
                ? 'border-foreground/10 bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {KIND_LABELS[kind]}
          </button>
        ))}
        {query.trim() !== '' && (
          <span className="ml-auto text-xs text-muted-foreground">
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </span>
        )}
      </div>

      {query.trim() === '' ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Search the current project’s objects.
        </p>
      ) : results.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No objects match “{query.trim()}”.
        </p>
      ) : (
        <ul className="divide-y">
          {results.map((result) => (
            <li key={`${result.kind}:${result.id}`}>
              <Link
                to={resultPath(result.kind)}
                params={resultParams(result.kind, result.id)}
                search={{ project: search.project }}
                className="group flex gap-3 px-2 py-3 hover:bg-muted/40"
              >
                <span className="mt-0.5 w-16 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {KIND_LABELS[result.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium group-hover:underline">
                      {result.title}
                    </span>
                    {result.kind !== 'memories' && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {result.id}
                      </span>
                    )}
                  </span>
                  {result.description.trim() !== '' && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {result.description}
                    </span>
                  )}
                </span>
                {result.status && (
                  <span className="shrink-0 text-xs capitalize text-muted-foreground">
                    {result.status.replaceAll('_', ' ')}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function resultPath(kind: 'issues' | 'projects' | 'memories') {
  if (kind === 'projects') return '/projects/$projectId' as const
  if (kind === 'memories') return '/memories/$memoryKey' as const
  return '/issues/$issueId' as const
}

function resultParams(
  kind: 'issues' | 'projects' | 'memories',
  id: string,
): { issueId: string } | { projectId: string } | { memoryKey: string } {
  if (kind === 'projects') return { projectId: id }
  if (kind === 'memories') return { memoryKey: id }
  return { issueId: id }
}
