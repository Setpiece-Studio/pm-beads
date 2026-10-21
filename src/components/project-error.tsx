// ABOUTME: Friendly panel for "this beads project can't be opened" — shown in place of the
// ABOUTME: route content so the sidebar's project picker stays available to switch away.

export function ProjectErrorPanel({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-start gap-4 px-6 py-12">
      <h1 className="text-lg font-semibold">
        Couldn’t open this beads project
      </h1>
      <p className="max-w-2xl whitespace-pre-wrap text-sm text-red-500">
        {message}
      </p>
      <p className="text-sm text-muted-foreground">
        Pick another project from the switcher at the top of the sidebar.
      </p>
    </div>
  )
}
