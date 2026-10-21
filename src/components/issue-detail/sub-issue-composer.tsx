// ABOUTME: Inline "add sub-issue" composer for the issue detail — title, description, and a chip
// ABOUTME: row of type/priority/assignee/label pickers mirroring the properties rail's editors.

import { X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { knownIssueTypes } from '@/lib/beads/types'
import {
  labelColorClass,
  PriorityIcon,
  priorityLabel,
  StatusIcon,
  TypeIcon,
  typeLabel,
} from '@/lib/issue-meta'

/** What the composer collects. Mirrors createSubIssue's input minus the parent id, which the
 * section owns. */
export interface SubIssueDraft {
  title: string
  type: string
  priority: number
  description?: string
  assignee?: string
  labels?: string[]
}

export interface SubIssueComposerProps {
  /** Disables the form while the create round-trip is in flight. */
  saving: boolean
  /** Create failure, rendered above the buttons. Null when there's nothing to show. */
  error: string | null
  onCancel: () => void
  onCreate: (draft: SubIssueDraft) => void
}

const DEFAULT_TYPE = 'task'
const DEFAULT_PRIORITY = 2

// The chip row's shared shape: a rounded-full outline pill, matching the label/epic chips.
const CHIP_CLASS =
  'h-7 w-auto gap-1.5 rounded-full border-border/70 px-2.5 text-xs font-normal text-muted-foreground shadow-none'

export function SubIssueComposer({
  saving,
  error,
  onCancel,
  onCreate,
}: SubIssueComposerProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState(DEFAULT_TYPE)
  const [priority, setPriority] = useState(DEFAULT_PRIORITY)
  const [assignee, setAssignee] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const [labelDraft, setLabelDraft] = useState('')

  const trimmedTitle = title.trim()

  const submit = () => {
    if (trimmedTitle === '' || saving) return
    onCreate({
      title: trimmedTitle,
      type,
      priority,
      description: description.trim() === '' ? undefined : description.trim(),
      assignee: assignee.trim() === '' ? undefined : assignee.trim(),
      labels: labels.length > 0 ? labels : undefined,
    })
  }

  const addLabel = () => {
    const next = labelDraft.trim()
    if (next === '' || labels.includes(next)) return
    setLabels([...labels, next])
    setLabelDraft('')
  }

  return (
    <form
      aria-label="New sub-issue"
      className="flex flex-col gap-2 rounded-md border bg-background p-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="flex items-center gap-2">
        {/* New issues start open; the circle anchors the row to the sub-issue rows above it. */}
        <StatusIcon status="open" />
        {/* autoFocus: the composer only mounts on an explicit "add sub-issue" click, where
            focus landing in the title field is the expected next step. */}
        <Input
          autoFocus
          aria-label="Issue title"
          placeholder="Issue title"
          value={title}
          disabled={saving}
          onChange={(e) => setTitle(e.target.value)}
          className="h-7 border-none bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
      </div>

      <textarea
        aria-label="Add description"
        placeholder="Add description…"
        value={description}
        disabled={saving}
        rows={2}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full resize-y bg-transparent px-6 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-50"
      />

      <div className="flex flex-wrap items-center gap-1.5 pl-6">
        <Select value={type} onValueChange={setType} disabled={saving}>
          <SelectTrigger
            size="sm"
            aria-label="Sub-issue type"
            className={CHIP_CLASS}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {knownIssueTypes.map((t) => (
              <SelectItem key={t} value={t}>
                <TypeIcon type={t} />
                {typeLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={String(priority)}
          onValueChange={(v) => setPriority(Number(v))}
          disabled={saving}
        >
          <SelectTrigger
            size="sm"
            aria-label="Sub-issue priority"
            className={CHIP_CLASS}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[0, 1, 2, 3, 4].map((p) => (
              <SelectItem key={p} value={String(p)}>
                <PriorityIcon priority={p} />
                {priorityLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          aria-label="Sub-issue assignee"
          placeholder="Assignee"
          value={assignee}
          disabled={saving}
          onChange={(e) => setAssignee(e.target.value)}
          className="h-7 w-28 rounded-full border-border/70 px-2.5 text-xs shadow-none"
        />

        {labels.map((label) => (
          <span
            key={label}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 px-2 py-px text-xs leading-4 text-muted-foreground"
          >
            <span
              className={`size-2 rounded-full ${labelColorClass(label)}`}
              aria-hidden="true"
            />
            {label}
            <button
              type="button"
              aria-label={`Remove sub-issue label ${label}`}
              disabled={saving}
              onClick={() => setLabels(labels.filter((l) => l !== label))}
              className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}

        <Input
          aria-label="Add sub-issue label"
          placeholder="+ Label"
          value={labelDraft}
          disabled={saving}
          onChange={(e) => setLabelDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter commits the label chip rather than submitting the whole composer.
            if (e.key !== 'Enter') return
            e.preventDefault()
            addLabel()
          }}
          onBlur={addLabel}
          className="h-7 w-24 rounded-full border-border/70 px-2.5 text-xs shadow-none"
        />
      </div>

      {error && (
        <p role="alert" className="pl-6 text-xs text-red-500">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={saving || trimmedTitle === ''}
        >
          {saving ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </form>
  )
}
