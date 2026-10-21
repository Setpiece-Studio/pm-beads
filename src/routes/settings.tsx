// ABOUTME: Per-project agent settings — edit persona handles, aliases, and tmux routes.

import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { RemoteSyncSettings } from '@/components/remote-sync-settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  currentUserFn,
  readPersonasFn,
  replacePersonasFn,
} from '@/lib/beads/server-fns'
import { refreshAfterWrite } from '@/lib/refresh-after-write'

interface PersonaRow {
  id: string
  key: string
  tmux: string
  aliases: string
}

export const Route = createFileRoute('/settings')({
  loaderDeps: ({ search }) => ({ project: search.project }),
  loader: async ({ deps }) => ({
    currentUser: await currentUserFn(),
    personas: await readPersonasFn({ data: { projectDir: deps.project } }),
  }),
  component: SettingsRoute,
})

function rowsFrom(
  personas: Awaited<ReturnType<typeof readPersonasFn>>,
  currentUserKey: string,
): PersonaRow[] {
  return Object.entries(personas)
    .filter(([key]) => key.toLowerCase() !== currentUserKey.toLowerCase())
    .map(([key, persona]) => ({
      id: key,
      key,
      tmux: persona.tmux ?? '',
      aliases: (persona.aliases ?? []).join(', '),
    }))
}

function SettingsRoute() {
  const loaded = Route.useLoaderData()
  const search = Route.useSearch()
  const router = useRouter()
  const [rows, setRows] = useState(() =>
    rowsFrom(loaded.personas, loaded.currentUser.key),
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  function patch(id: string, fields: Partial<PersonaRow>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...fields } : row)),
    )
  }

  async function save() {
    const normalized = rows.map((row) => ({
      ...row,
      key: row.key.trim(),
      tmux: row.tmux.trim(),
      aliases: row.aliases
        .split(',')
        .map((alias) => alias.trim())
        .filter(Boolean),
    }))
    if (normalized.some((row) => row.key === '')) {
      setMessage('Every agent needs a handle.')
      return
    }
    if (new Set(normalized.map((row) => row.key)).size !== normalized.length) {
      setMessage('Agent handles must be unique.')
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      await replacePersonasFn({
        data: {
          projectDir: search.project,
          personas: Object.fromEntries(
            normalized.map((row) => [
              row.key,
              {
                ...(row.tmux !== '' && { tmux: row.tmux }),
                ...(row.aliases.length > 0 && { aliases: row.aliases }),
              },
            ]),
          ),
        },
      })
      await refreshAfterWrite(router)
      setRows(
        rowsFrom(
          await readPersonasFn({ data: { projectDir: search.project } }),
          loaded.currentUser.key,
        ),
      )
      setMessage('Saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-6 py-4">
        <h1 className="text-base font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Agent handles power @mentions; tmux sessions receive notifier
          wake-ups.
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <section className="mx-auto flex max-w-4xl flex-col gap-4">
          <RemoteSyncSettings
            key={search.project ?? ''}
            project={search.project}
          />
          <div className="rounded-md border bg-muted/20 px-4 py-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">You</h2>
              <span className="font-mono text-sm">
                @{loaded.currentUser.key}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Current pm-beads identity
              {loaded.currentUser.aliases.length > 0 &&
                ` · aliases: ${loaded.currentUser.aliases.join(', ')}`}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Agents</h2>
              <p className="text-xs text-muted-foreground">
                Aliases are comma-separated. Comments insert the stable handle.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((current) => [
                  ...current,
                  { id: crypto.randomUUID(), key: '', tmux: '', aliases: '' },
                ])
              }
            >
              <Plus className="size-4" /> Add agent
            </Button>
          </div>

          <div className="overflow-hidden rounded-md border">
            <div className="grid grid-cols-[1fr_1fr_1.4fr_2.5rem] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>Handle</span>
              <span>Tmux session (optional)</span>
              <span>Aliases</span>
              <span />
            </div>
            {rows.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No agents configured yet.
              </p>
            ) : (
              rows.map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[1fr_1fr_1.4fr_2.5rem] gap-3 border-b px-3 py-2 last:border-b-0"
                >
                  <Input
                    aria-label="Agent handle"
                    value={row.key}
                    placeholder="data-engineer"
                    onChange={(event) =>
                      patch(row.id, { key: event.target.value })
                    }
                  />
                  <Input
                    aria-label="Tmux session"
                    value={row.tmux}
                    placeholder="daryl"
                    onChange={(event) =>
                      patch(row.id, { tmux: event.target.value })
                    }
                  />
                  <Input
                    aria-label="Aliases"
                    value={row.aliases}
                    placeholder="Daryl"
                    onChange={(event) =>
                      patch(row.id, { aliases: event.target.value })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${row.key || 'agent'}`}
                    onClick={() =>
                      setRows((current) =>
                        current.filter((candidate) => candidate.id !== row.id),
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            {message && (
              <p role="status" className="text-sm text-muted-foreground">
                {message}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
