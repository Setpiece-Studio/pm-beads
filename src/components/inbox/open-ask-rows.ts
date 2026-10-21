// ABOUTME: One inbox row per unfinished bead with open asks, derived from metadata alone.
import { isAskOpen, issuesWithOpenAsks, parseAsks } from '@/lib/beads/asks'
import type { Issue } from '@/lib/beads/types'
import type { InboxSort } from './inbox-model'
import type { NotificationRow } from './notification-list'

export function openAskRows(
  issues: readonly Issue[],
  sort: InboxSort,
): NotificationRow[] {
  return issuesWithOpenAsks(issues)
    .map((issue): NotificationRow => {
      const { asks, invalidKeys } = parseAsks(issue.metadata)
      const open = asks
        .filter(isAskOpen)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      return {
        key: `bead:${issue.id}`,
        issueId: issue.id,
        title: issue.title,
        actor: open[0]?.by ?? issue.created_by ?? 'Someone',
        latestAt: open[0]?.at ?? issue.updated_at,
        reasonKind: 'ask',
        unread: false,
        snippet:
          open.map((ask) => ask.q).join(' · ') ||
          `Ask metadata needs repair: ${invalidKeys.join(', ')}`,
        threadIds: [],
        activityIds: [],
      }
    })
    .sort((a, b) => {
      const delta = Date.parse(a.latestAt) - Date.parse(b.latestAt)
      return (sort === 'oldest' ? delta : -delta) || a.key.localeCompare(b.key)
    })
}
