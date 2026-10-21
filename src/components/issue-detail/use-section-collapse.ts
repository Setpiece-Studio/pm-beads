// ABOUTME: Collapse state for a detail-body section, remembered for the browser session so
// ABOUTME: collapsing it on one issue keeps it collapsed while navigating between issues.

import { useCallback, useEffect, useState } from 'react'

/** sessionStorage — the preference should survive navigation but not outlive the tab. */
const STORAGE_PREFIX = 'pm-beads:collapsed:'

function readCollapsed(key: string, fallback: boolean): boolean {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_PREFIX + key)
    return stored === null ? fallback : stored === '1'
  } catch {
    // Private-mode / disabled storage: fall back to the section's default.
    return fallback
  }
}

function writeCollapsed(key: string, collapsed: boolean): void {
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + key, collapsed ? '1' : '0')
  } catch {
    // Nothing to do — the toggle still works for this page view.
  }
}

/**
 * Expanded/collapsed state for `key`, seeded from sessionStorage AFTER mount. The first render
 * always reports the section's default so the server-rendered markup and the hydrated markup
 * agree; a remembered preference then applies in the mount effect.
 *
 * `defaultCollapsed` is what a section shows before the viewer has ever toggled it — expanded
 * for a section that IS the content (sub-issues), collapsed for one that is side context.
 */
export function useSectionCollapse(
  key: string,
  { defaultCollapsed = false }: { defaultCollapsed?: boolean } = {},
): {
  expanded: boolean
  toggle: () => void
  expand: () => void
} {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  useEffect(() => {
    setCollapsed(readCollapsed(key, defaultCollapsed))
  }, [key, defaultCollapsed])

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      writeCollapsed(key, !prev)
      return !prev
    })
  }, [key])

  // Used when an action needs the section's contents visible (opening the inline composer).
  const expand = useCallback(() => {
    setCollapsed((prev) => {
      if (prev) writeCollapsed(key, false)
      return false
    })
  }, [key])

  return { expanded: !collapsed, toggle, expand }
}
