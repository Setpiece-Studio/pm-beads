// ABOUTME: The one action set an inbox pane or row carries for the bead it is about — read
// ABOUTME: toggle, open bead, copy id — as data, so every menu that offers them agrees.

import {
  Copy,
  type LucideIcon,
  Mail,
  MailOpen,
  SquareArrowOutUpRight,
} from 'lucide-react'
export interface InboxAction {
  /** Stable react key; also what a test names the action by. */
  key: string
  label: string
  icon: LucideIcon
  disabled?: boolean
  run: () => void
}

export interface InboxActionOptions {
  /** The bead the pane or row is about. Absent for a thread related to no bead at all, and
   * then the actions that need an id are simply not offered. */
  issueId?: string
  /** Opens the bead — the drawer in the messages half, the issue route everywhere else.
   * Absent where the host has nowhere to send you, and then the action is simply not offered. */
  openBead?: () => void
  /** The live half of the read toggle, already chosen by the host against the read state. */
  readToggle?: { label: string; action: () => void }
  /** True while a bd write is in flight; the writes grey out, the reads stay live. */
  busy?: boolean
}

/**
 * Every action a notification carries, in menu order. The read toggle leads because it is the
 * one you reach for most; the two that only navigate sit at the bottom, past the writes.
 */
export function inboxActions({
  issueId,
  openBead,
  readToggle,
  busy = false,
}: InboxActionOptions): InboxAction[] {
  const actions: InboxAction[] = []
  if (readToggle) {
    actions.push({
      key: 'read-toggle',
      label: readToggle.label,
      icon: readToggle.label === 'Mark read' ? MailOpen : Mail,
      disabled: busy,
      run: readToggle.action,
    })
  }
  if (openBead) {
    actions.push({
      key: 'open',
      label: 'Open bead',
      icon: SquareArrowOutUpRight,
      run: openBead,
    })
  }
  if (issueId !== undefined) {
    actions.push({
      key: 'copy',
      label: 'Copy bead id',
      icon: Copy,
      run: () => copyBeadId(issueId),
    })
  }
  return actions
}

/** Best-effort copy. The clipboard API is absent outside a secure context, and there is no
 * fallback worth the complexity here — the id is on screen either way. */
function copyBeadId(id: string): void {
  void navigator.clipboard?.writeText(id).catch(() => undefined)
}
