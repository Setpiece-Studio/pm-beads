// ABOUTME: Notification permission is requested only from an explicit Settings click.
import { useEffect, useState } from 'react'
import { setSyncAlerts, syncAlertProjects } from '@/lib/sync-notifications'
import { Button } from './ui/button'

export function SyncAlertSettings({ project = '' }: { project?: string }) {
  const [enabled, setEnabled] = useState(false)
  const [permission, setPermission] = useState<
    NotificationPermission | 'unsupported'
  >('unsupported')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const refresh = () => {
      setEnabled(syncAlertProjects().includes(project))
      setPermission(
        typeof Notification === 'undefined'
          ? 'unsupported'
          : Notification.permission,
      )
    }
    refresh()
    window.addEventListener('storage', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [project])
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={
          !enabled && (permission === 'unsupported' || permission === 'denied')
        }
        onClick={async () => {
          setError(null)
          try {
            if (enabled) {
              setSyncAlerts(project, false)
              setEnabled(false)
              return
            }
            const next = await Notification.requestPermission()
            setPermission(next)
            if (next === 'granted') {
              setSyncAlerts(project, true)
              setEnabled(true)
            }
          } catch {
            setError('Could not enable notifications in this browser.')
          }
        }}
      >
        {enabled ? 'Disable sync notifications' : 'Enable sync notifications'}
      </Button>
      <p className="text-xs text-muted-foreground">
        {permission === 'unsupported'
          ? 'Browser notifications are unavailable here.'
          : permission === 'denied'
            ? 'Notifications are blocked. Allow them in your browser site settings.'
            : 'Alerts for this workspace while pm-beads is open, even when viewing another workspace. Repeated issues alert once until they change or recover.'}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
