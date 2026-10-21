// ABOUTME: A secondary section reports failures and retries without replacing primary content.
export function DeferredReadStatus({
  error,
  retry,
  label,
}: {
  error?: string
  retry: () => void
  label: string
}) {
  if (!error) return null
  return (
    <div role="alert" className="px-4 py-2 text-xs text-muted-foreground">
      Couldn’t load {label}.{' '}
      <button type="button" className="underline" onClick={retry}>
        Retry {label}
      </button>
    </div>
  )
}
