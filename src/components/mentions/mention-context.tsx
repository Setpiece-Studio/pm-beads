// ABOUTME: Selected project's configured agent personas, shared by every text composer.

import { createContext, useContext } from 'react'
import type { PersonaConfig } from '@/lib/beads/notifier-store'

export interface MentionCandidate extends PersonaConfig {
  key: string
  isCurrentUser?: boolean
}

const MentionContext = createContext<readonly MentionCandidate[]>([])

export function MentionProvider({
  personas,
  currentUser,
  children,
}: {
  personas: Record<string, PersonaConfig>
  currentUser: { key: string; aliases: string[] }
  children: React.ReactNode
}) {
  const agents = Object.entries(personas)
    .filter(([key]) => key.toLowerCase() !== currentUser.key.toLowerCase())
    .map(([key, config]) => ({ key, ...config }))
  const candidates: MentionCandidate[] = [
    { ...currentUser, isCurrentUser: true },
    ...agents.sort((a, b) => a.key.localeCompare(b.key)),
  ]
  return (
    <MentionContext.Provider value={candidates}>
      {children}
    </MentionContext.Provider>
  )
}

export function useMentionCandidates(): readonly MentionCandidate[] {
  return useContext(MentionContext)
}
