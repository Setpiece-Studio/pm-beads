// ABOUTME: Browser-local opt-in and deduplicated sync alerts across enrolled workspaces.
const preferencesKey = 'pm-beads:sync-alert-projects'
const lastKey = (project: string) => `pm-beads:sync-alert-last:${project}`

export function syncAlertProjects(): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(preferencesKey) ?? '[]',
    )
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

export function setSyncAlerts(project: string, enabled: boolean) {
  const projects = new Set(syncAlertProjects())
  if (enabled) projects.add(project)
  else projects.delete(project)
  localStorage.setItem(preferencesKey, JSON.stringify([...projects]))
  localStorage.removeItem(lastKey(project))
  window.dispatchEvent(new Event('pm-beads:sync-alerts'))
}

export interface SyncAlertStatus {
  error?: string
  conflicts?: { token: string }[]
}

export function notifySyncIssue(project: string, status: SyncAlertStatus) {
  if (!syncAlertProjects().includes(project)) return
  const conflicts = status.conflicts ?? []
  const signature =
    status.error || conflicts.length
      ? JSON.stringify([
          status.error ?? '',
          conflicts.map((item) => item.token).sort(),
        ])
      : null
  try {
    if (!signature) {
      localStorage.removeItem(lastKey(project))
      return
    }
    if (
      typeof Notification === 'undefined' ||
      Notification.permission !== 'granted' ||
      localStorage.getItem(lastKey(project)) === signature
    )
      return
    const name = project.split('/').filter(Boolean).at(-1) ?? 'Default project'
    const notification = new Notification(`Sync needs attention · ${name}`, {
      body: conflicts.length
        ? `${conflicts.length} unresolved conflict${conflicts.length === 1 ? '' : 's'}. Open Settings to resolve.`
        : 'Sync failed or its status is unavailable. Open Settings for details.',
      tag: `pm-beads-sync:${project}`,
    })
    localStorage.setItem(lastKey(project), signature)
    notification.onclick = () => {
      window.focus()
      window.location.assign(
        `/settings${project ? `?project=${encodeURIComponent(project)}` : ''}`,
      )
      notification.close()
    }
  } catch {
    // Browser notification/storage restrictions must not stop UI refresh.
  }
}
