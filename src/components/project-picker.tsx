// ABOUTME: Sidebar project switcher — shows the current beads project as a button that
// ABOUTME: opens a searchable command dialog of projects discovered on disk.

import { Check, ChevronsUpDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'

export interface PickerProject {
  path: string
  name: string
  isDefault: boolean
}

export interface ProjectPickerProps {
  /** Display name of the active project. */
  currentName: string
  /** Selected project path, or null when the env default is active. */
  currentPath: string | null
  /** Fetches the discoverable projects; called each time the dialog opens. */
  discoverProjects: () => Promise<PickerProject[]>
  /** Called with the chosen project path, or null for the env default. */
  onSelect: (path: string | null) => void
}

export function ProjectPicker({
  currentName,
  currentPath,
  discoverProjects,
  onSelect,
}: ProjectPickerProps) {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<PickerProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    discoverProjects().then(
      (list) => {
        if (!cancelled) setProjects(list)
      },
      () => {
        if (!cancelled) {
          setProjects([])
          setError('Could not discover projects.')
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, discoverProjects])

  const isCurrent = (project: PickerProject) =>
    currentPath === null ? project.isDefault : project.path === currentPath

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 flex-1 items-center justify-between gap-1 rounded-md px-2 py-1 text-sm font-semibold hover:bg-sidebar-accent"
      >
        <span className="truncate">{currentName}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Switch project"
        description="Select a beads project to view"
      >
        <CommandInput placeholder="Search projects..." />
        <CommandList>
          <CommandEmpty>
            {error ?? (projects === null ? 'Scanning…' : 'No projects found.')}
          </CommandEmpty>
          <CommandGroup heading="Projects">
            {(projects ?? []).map((project) => (
              <CommandItem
                key={project.path}
                value={`${project.name} ${project.path}`}
                data-current={isCurrent(project) ? 'true' : undefined}
                onSelect={() => {
                  setOpen(false)
                  onSelect(project.isDefault ? null : project.path)
                }}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">
                    {project.isDefault
                      ? `${project.name} (default)`
                      : project.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {project.path}
                  </span>
                </div>
                <Check
                  className={cn(
                    'ml-auto',
                    isCurrent(project) ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
