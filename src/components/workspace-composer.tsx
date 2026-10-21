// ABOUTME: Workspace-scoped issue composer; retains created IDs when follow-up writes fail.

import { useRouter } from '@tanstack/react-router'
import { SquarePen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type CreateDraft, createDraftSchema } from '@/lib/beads/create-draft'
import { createWorkspaceIssueFn } from '@/lib/beads/server-fns'
import { knownIssueTypes, knownStatuses } from '@/lib/beads/types'
import { refreshAfterWrite } from '@/lib/refresh-after-write'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { Input } from './ui/input'
import { MarkdownEditor } from './ui/markdown-editor'

export function WorkspaceComposer({ project }: { project?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CreateDraft>({
    title: '',
    type: 'task',
    priority: 2,
    status: 'open',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recoveryKey = `pm-beads:creation-recovery:${project ?? 'default'}`
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(recoveryKey)
      if (!saved) return
      const recovered = createDraftSchema.parse(JSON.parse(saved))
      if (recovered.createdId) {
        setDraft(recovered)
        setError(`Created ${recovered.createdId}. Retry unfinished updates.`)
      }
    } catch {
      /* Browser storage may be unavailable. */
    }
  }, [recoveryKey])
  const change = (patch: Partial<CreateDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }))
  const submit = async () => {
    if (saving || !draft.title.trim()) return
    setSaving(true)
    setError(null)
    try {
      const result = await createWorkspaceIssueFn({
        data: {
          ...draft,
          labels: draft.labels?.map((value) => value.trim()).filter(Boolean),
          dependencies: draft.dependencies
            ?.map((value) => value.trim())
            .filter(Boolean),
          projectDir: project,
        },
      })
      change({ createdId: result.id, completedSteps: result.completedSteps })
      try {
        sessionStorage.setItem(
          recoveryKey,
          JSON.stringify({
            ...draft,
            createdId: result.id,
            completedSteps: result.completedSteps,
          }),
        )
      } catch {
        /* The in-memory ID still supports retry. */
      }
      await refreshAfterWrite(router)
      if (result.complete) {
        try {
          sessionStorage.removeItem(recoveryKey)
        } catch {
          /* Storage is optional. */
        }
        setDraft({ title: '', type: 'task', priority: 2, status: 'open' })
        setOpen(false)
      } else
        setError(
          `Created ${result.id}. ${result.error}. Retry to finish this issue.`,
        )
    } catch (error) {
      setError(String(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!saving) setOpen(value)
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label="Create issue"
          title="Create issue"
        >
          <SquarePen className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>Create issue</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          Workspace: {project?.split('/').pop() ?? 'Default project'}
        </DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="space-y-4"
        >
          <fieldset
            disabled={saving || !!draft.createdId}
            className="space-y-3"
          >
            <Input
              aria-label="Title"
              placeholder="Issue title"
              required
              value={draft.title}
              onChange={(e) => change({ title: e.target.value })}
            />
            <p className="text-sm text-muted-foreground">Description</p>
            <MarkdownEditor
              label="Description"
              value={draft.description ?? ''}
              onChange={(description) => change({ description })}
            />
            <div className="grid grid-cols-3 gap-3">
              <label htmlFor="composer-type">
                Type
                <Input
                  id="composer-type"
                  list="composer-types"
                  value={draft.type}
                  onChange={(e) => change({ type: e.target.value })}
                  required
                />
              </label>
              <label htmlFor="composer-status">
                Status
                <Input
                  id="composer-status"
                  list="composer-statuses"
                  value={draft.status}
                  onChange={(e) => change({ status: e.target.value })}
                  required
                />
              </label>
              <label htmlFor="composer-priority">
                Priority
                <Input
                  id="composer-priority"
                  type="number"
                  min={0}
                  max={4}
                  value={draft.priority}
                  onChange={(e) => change({ priority: Number(e.target.value) })}
                />
              </label>
            </div>
            <datalist id="composer-types">
              {knownIssueTypes.map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
            <datalist id="composer-statuses">
              {knownStatuses.map((status) => (
                <option key={status} value={status} />
              ))}
            </datalist>
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                More properties
              </summary>
              <div className="space-y-3 pt-3">
                <label className="block" htmlFor="composer-assignee">
                  Assignee
                  <Input
                    id="composer-assignee"
                    value={draft.assignee ?? ''}
                    onChange={(e) => change({ assignee: e.target.value })}
                  />
                </label>
                <label className="block" htmlFor="composer-labels">
                  Labels (comma separated)
                  <Input
                    id="composer-labels"
                    value={draft.labels?.join(',') ?? ''}
                    onChange={(e) =>
                      change({ labels: e.target.value.split(',') })
                    }
                  />
                </label>
                <label className="block" htmlFor="composer-parent">
                  Parent
                  <Input
                    id="composer-parent"
                    value={draft.parent ?? ''}
                    onChange={(e) =>
                      change({ parent: e.target.value || undefined })
                    }
                  />
                </label>
                <label className="block" htmlFor="composer-dependencies">
                  Blocked by (comma separated IDs)
                  <Input
                    id="composer-dependencies"
                    value={draft.dependencies?.join(',') ?? ''}
                    onChange={(e) =>
                      change({ dependencies: e.target.value.split(',') })
                    }
                  />
                </label>
                <label className="block" htmlFor="composer-pr">
                  Pull request
                  <Input
                    id="composer-pr"
                    value={draft.prLink ?? ''}
                    onChange={(e) => change({ prLink: e.target.value })}
                  />
                </label>
                {(['design', 'acceptance_criteria', 'notes'] as const).map(
                  (field) => (
                    <div key={field} className="space-y-1">
                      <p className="text-sm text-muted-foreground">
                        {field === 'acceptance_criteria'
                          ? 'Acceptance criteria'
                          : field === 'design'
                            ? 'Design'
                            : 'Notes'}
                      </p>
                      <MarkdownEditor
                        label={
                          field === 'acceptance_criteria'
                            ? 'Acceptance criteria'
                            : field === 'design'
                              ? 'Design'
                              : 'Notes'
                        }
                        value={draft[field] ?? ''}
                        onChange={(value) => change({ [field]: value })}
                      />
                    </div>
                  ),
                )}
              </div>
            </details>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={saving || !draft.title.trim()}>
            {saving
              ? 'Saving…'
              : draft.createdId
                ? 'Retry unfinished updates'
                : 'Create issue'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
