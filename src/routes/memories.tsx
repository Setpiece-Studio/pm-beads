// ABOUTME: Memories route — read-only list of bd persistent memories for the selected project.

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { MemoriesTable } from '@/components/memories/memories-table'
import { listMemoriesFn } from '@/lib/beads/server-fns'

export const Route = createFileRoute('/memories')({
  loaderDeps: ({ search }) => ({ project: search.project }),
  loader: ({ deps }) => listMemoriesFn({ data: { projectDir: deps.project } }),
  component: MemoriesRoute,
})

function MemoriesRoute() {
  const memories = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <h1 className="text-sm font-semibold">Memories</h1>
        <span className="text-xs text-muted-foreground">{memories.length}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <MemoriesTable
          memories={memories}
          onRowClick={(key) =>
            navigate({
              to: '/memories/$memoryKey',
              params: { memoryKey: key },
              search: { project: search.project },
            })
          }
        />
      </div>
    </div>
  )
}
