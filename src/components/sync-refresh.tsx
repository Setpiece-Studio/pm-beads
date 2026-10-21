// ABOUTME: Refresh active loaders after background sync changes the selected workspace.
import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { refreshAfterWrite } from '@/lib/refresh-after-write'
import { notifySyncIssue, syncAlertProjects } from '@/lib/sync-notifications'

export function SyncRefresh({ project }: { project?: string }) {
  const router = useRouter()
  useEffect(() => {
    let active = true
    let previous: string | undefined
    let pending = false
    const poll = async () => {
      if (pending) return
      pending = true
      for (const workspace of new Set([
        project ?? '',
        ...syncAlertProjects(),
      ])) {
        try {
          const response = await fetch(
            `/api/sync${workspace ? `?project=${encodeURIComponent(workspace)}` : ''}`,
            { cache: 'no-store', signal: AbortSignal.timeout(10_000) },
          )
          if (!active) break
          if (!response.ok) {
            notifySyncIssue(workspace, { error: 'Sync status unavailable' })
            continue
          }
          const status = await response.json()
          if (!active) break
          notifySyncIssue(workspace, status)
          if (workspace !== (project ?? '')) continue
          const signature = JSON.stringify([
            status.lastAttempt,
            status.inspectedAt,
            status.lastSuccess,
          ])
          if (previous !== undefined && previous !== signature && active)
            await refreshAfterWrite(router)
          previous = signature
        } catch {
          if (active)
            notifySyncIssue(workspace, { error: 'Sync status unavailable' })
        }
      }
      pending = false
    }
    void poll()
    const timer = setInterval(() => {
      void poll()
    }, 15_000)
    window.addEventListener('pm-beads:sync-alerts', poll)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('pm-beads:sync-alerts', poll)
    }
  }, [project, router])
  return null
}
