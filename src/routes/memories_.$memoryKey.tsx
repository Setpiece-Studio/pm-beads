// ABOUTME: Memory detail route — loads a single bd memory and allows confirmed deletion.

import {
  createFileRoute,
  notFound,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import {
  ErrorDetail,
  NotFoundDetail,
  PendingDetail,
} from '@/components/issue-detail/detail-chrome'
import { MemoryDetail } from '@/components/memories/memory-detail'
import { BeadLookupProvider, beadLookupIssues } from '@/lib/bead-lookup'
import { isMemoryNotFoundError } from '@/lib/beads/not-found'
import {
  deleteMemoryFn,
  getMemoryFn,
  listIssuesFn,
} from '@/lib/beads/server-fns'
import { refreshAfterWrite } from '@/lib/refresh-after-write'

export const Route = createFileRoute('/memories_/$memoryKey')({
  preloadStaleTime: 30_000,
  loaderDeps: ({ search }) => ({ project: search.project }),
  loader: async ({ params, deps }) => {
    let memory: Awaited<ReturnType<typeof getMemoryFn>>
    try {
      memory = await getMemoryFn({
        data: { key: params.memoryKey, projectDir: deps.project },
      })
    } catch (error) {
      if (isMemoryNotFoundError(error)) {
        throw notFound({ routeId: '/memories_/$memoryKey' })
      }
      throw error
    }
    // A memory's body is markdown and routinely names the beads it came out of. Reads through
    // the bd cache, trimmed to the four fields a chip needs.
    const beads = beadLookupIssues(
      await listIssuesFn({ data: { all: true, projectDir: deps.project } }),
    )
    return { memory, beads }
  },
  pendingComponent: PendingDetail,
  errorComponent: ({ error }) => <ErrorDetail error={error} noun="memory" />,
  notFoundComponent: () => <NotFoundDetail noun="memory" />,
  component: MemoryDetailRoute,
})

function MemoryDetailRoute() {
  const { memory, beads } = Route.useLoaderData()
  const search = Route.useSearch()
  const router = useRouter()
  const navigate = useNavigate({ from: Route.fullPath })

  async function deleteMemory() {
    await deleteMemoryFn({
      data: { key: memory.key, projectDir: search.project },
    })
    await refreshAfterWrite(router)
    navigate({ to: '/memories', search: { project: search.project } })
  }

  return (
    <BeadLookupProvider issues={beads} project={search.project}>
      <MemoryDetail memory={memory} onDelete={deleteMemory} />
    </BeadLookupProvider>
  )
}
