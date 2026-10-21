// ABOUTME: Linear-style detail top bar — the shared issue header bar fronted by a breadcrumb
// ABOUTME: (project › section) and followed by n/N prev/next navigation over its originating list.

import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import type { SiblingNav } from './detail-nav'
import { IssueHeaderBar } from './issue-header-bar'

/** The list route this detail hangs off — the breadcrumb's middle crumb. */
export type DetailSection = 'issues' | 'projects'

const SECTION_LABELS: Record<DetailSection, string> = {
  issues: 'Issues',
  projects: 'Projects',
}

const SECTION_NOUNS: Record<DetailSection, string> = {
  issues: 'issue',
  projects: 'project',
}

export interface DetailTopBarProps {
  /** Leading crumb: the active beads project's name. */
  projectName: string
  section: DetailSection
  /** Carried onto the section crumb's link so it lands in the same beads project. */
  project?: string
  id: string
  title: string
  /** Position in the originating list, or null when this item isn't in one. */
  nav: SiblingNav | null
  /** Navigate to a sibling id; the route decides how (it owns the search params). */
  onNavigate: (id: string) => void
}

export function DetailTopBar({
  projectName,
  section,
  project,
  id,
  title,
  nav,
  onNavigate,
}: DetailTopBarProps) {
  const noun = SECTION_NOUNS[section]
  const previousId = nav?.previousId
  const nextId = nav?.nextId

  // Linear's j/k walk the same sequence as the arrows. Typing in a field wins, and a modifier
  // means the chord belongs to the browser or the OS, not to us.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (event.key === 'j' && nextId) {
        event.preventDefault()
        onNavigate(nextId)
      } else if (event.key === 'k' && previousId) {
        event.preventDefault()
        onNavigate(previousId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [previousId, nextId, onNavigate])

  return (
    // The shared bar carries the title, id, star and overflow; the breadcrumb ahead of them
    // and the n/N walk after them are what make this the issue detail's bar in particular.
    <IssueHeaderBar
      id={id}
      title={title}
      noun={noun}
      navLabel="Breadcrumb"
      leading={
        <>
          <span className="shrink-0 font-medium">{projectName}</span>
          <Crumb />
          <Link
            to={section === 'issues' ? '/issues' : '/projects'}
            search={{ project }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {SECTION_LABELS[section]}
          </Link>
          <Crumb />
        </>
      }
    >
      <span
        data-detail-nav-position
        className="font-mono text-xs tabular-nums text-muted-foreground"
      >
        {nav ? `${nav.index} / ${nav.total}` : '—'}
      </span>
      {nav && (
        <>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Previous ${noun}`}
            disabled={previousId === undefined}
            onClick={() => previousId && onNavigate(previousId)}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Next ${noun}`}
            disabled={nextId === undefined}
            onClick={() => nextId && onNavigate(nextId)}
          >
            <ArrowDown />
          </Button>
        </>
      )}
    </IssueHeaderBar>
  )
}

function Crumb() {
  return (
    <ChevronRight
      aria-hidden="true"
      className="size-3.5 shrink-0 text-muted-foreground/60"
    />
  )
}

/** True for the editable controls the detail body carries, where j/k are literal characters. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
