// ABOUTME: Shared detail-route chrome — Back button plus pending/error/not-found states for the
// ABOUTME: issue and project detail routes, parameterized by noun so wording stays per-route exact.

import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type DetailNoun = 'issue' | 'project' | 'memory'

/** The shared uppercase section label used by the detail body and the dependency editor. Rendered
 * as an <h3>: it sits semantically beneath the body's <h2> section groupings and the page <h1>. */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  )
}

export function BackButton() {
  const router = useRouter()
  return (
    <Button variant="outline" size="sm" onClick={() => router.history.back()}>
      Back
    </Button>
  )
}

export function PendingDetail() {
  return (
    <div className="flex flex-col gap-5 px-6 py-5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  )
}

export function ErrorDetail({
  error,
  noun,
}: {
  error: Error
  noun: DetailNoun
}) {
  return (
    <div className="flex flex-col items-start gap-4 px-6 py-12">
      <h1 className="text-lg font-semibold">Couldn’t load this {noun}</h1>
      <p className="text-sm text-red-500">{error.message}</p>
      <BackButton />
    </div>
  )
}

export function NotFoundDetail({ noun }: { noun: DetailNoun }) {
  const title =
    noun === 'issue'
      ? 'Issue not found'
      : noun === 'project'
        ? 'Project not found'
        : 'Memory not found'
  const home = noun === 'project' ? 'current workspace' : 'current project'
  return (
    <div className="flex flex-col items-start gap-4 px-6 py-12">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">
        This {noun} doesn’t exist in the {home}.
      </p>
      <BackButton />
    </div>
  )
}
