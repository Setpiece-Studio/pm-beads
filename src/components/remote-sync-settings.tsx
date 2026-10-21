// ABOUTME: Per-project sync opt-in, persisted status, and explicit side-by-side conflict resolution.

import { useRouter } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import {
  configureRemoteSyncFn,
  readRemoteSyncFn,
  resolveRemoteConflictFn,
  runRemoteSyncFn,
} from '@/lib/beads/server-fns'
import { refreshAfterWrite } from '@/lib/refresh-after-write'
import { useDeferredRead } from '@/lib/use-deferred-read'
import { DeferredReadStatus } from './deferred-read-status'
import { SyncAlertSettings } from './sync-alert-settings'
import { Button } from './ui/button'

export function RemoteSyncSettings({ project }: { project?: string }) {
  const router = useRouter()
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const read = useDeferredRead(
    project ?? '',
    useCallback(
      () => readRemoteSyncFn({ data: { projectDir: project } }),
      [project],
    ),
    revision,
  )
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setRevision((value) => value + 1)
      await refreshAfterWrite(router)
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="mb-6 space-y-3 rounded-md border p-4">
      <h2 className="text-sm font-semibold">Remote sync</h2>
      <SyncAlertSettings project={project} />
      <DeferredReadStatus {...read} label="sync status" />
      {error && <p role="alert">{error}</p>}
      {read.value && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={read.value.config.enabled}
              disabled={busy}
              onChange={(event) => {
                void run(() =>
                  configureRemoteSyncFn({
                    data: {
                      projectDir: project,
                      enabled: event.target.checked,
                    },
                  }),
                )
              }}
            />
            Sync this project every five minutes
          </label>
          <p className="text-xs text-muted-foreground">
            Last attempt: {read.value.status.lastAttempt ?? 'Never'} · Last
            success: {read.value.status.lastSuccess ?? 'Never'}
          </p>
          {read.value.status.error && (
            <p role="alert" className="text-sm text-destructive">
              {read.value.status.error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy || !read.value.config.enabled}
              onClick={() => {
                void run(() =>
                  runRemoteSyncFn({ data: { projectDir: project } }),
                )
              }}
            >
              Sync now
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setRevision((value) => value + 1)}
            >
              Refresh status
            </Button>
          </div>
          {read.value.status.conflicts.map((conflict) => (
            <div key={conflict.token} className="space-y-2 rounded border p-3">
              <h3 className="text-sm font-medium">
                {conflict.table} ·{' '}
                {String(
                  conflict.values.our_id ??
                    conflict.values.their_id ??
                    conflict.record,
                )}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Base</th>
                      <th>Ours</th>
                      <th>Theirs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(conflict.values)
                      .filter(
                        (key) =>
                          key.startsWith('our_') && key !== 'our_diff_type',
                      )
                      .map((key) => (
                        <tr key={key}>
                          <th>{key.slice(4)}</th>
                          {['base_', 'our_', 'their_'].map((prefix) => (
                            <td
                              key={prefix}
                              className="max-w-64 whitespace-pre-wrap break-words border p-2"
                            >
                              {JSON.stringify(
                                conflict.values[`${prefix}${key.slice(4)}`],
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {(['ours', 'theirs'] as const).map((side) => (
                <Button
                  key={side}
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    void run(() =>
                      resolveRemoteConflictFn({
                        data: {
                          projectDir: project,
                          token: conflict.token,
                          side,
                        },
                      }),
                    )
                  }}
                >
                  Keep {side}
                </Button>
              ))}
            </div>
          ))}
        </>
      )}
    </section>
  )
}
