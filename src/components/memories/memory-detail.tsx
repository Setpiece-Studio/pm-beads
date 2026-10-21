// ABOUTME: Memory detail view — renders a single persistent memory and confirms deletion.

import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { BackButton } from '@/components/issue-detail/detail-chrome'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Markdown } from '@/components/ui/markdown'
import type { Memory } from '@/lib/beads/types'

interface MemoryDetailProps {
  memory: Memory
  onDelete: () => Promise<void>
}

export function MemoryDetail({ memory, onDelete }: MemoryDetailProps) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function confirmDelete() {
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <BackButton />
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 />
              Delete
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete memory?</DialogTitle>
              <DialogDescription>
                This removes {memory.key} from the current beads project.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={deleting}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={deleting}
              >
                Delete memory
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>
      <article className="flex max-w-4xl flex-col gap-5 px-6 py-5">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Memory
          </p>
          <h1 className="break-words text-2xl font-semibold leading-tight">
            {memory.key}
          </h1>
        </div>
        <Markdown>{memory.value}</Markdown>
      </article>
    </div>
  )
}
