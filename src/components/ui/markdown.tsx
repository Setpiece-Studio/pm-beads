// ABOUTME: Read-only markdown renderer for bd long-text fields, using react-markdown + remark-gfm,
// ABOUTME: with bead references autolinked to chips. Raw HTML stays disabled (react-markdown default).

import type { AnchorHTMLAttributes } from 'react'
import { useMemo } from 'react'
import ReactMarkdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { BeadChip } from '@/components/ui/bead-chip'
import { useBeadLookup } from '@/lib/bead-lookup'
import {
  BEAD_EPIC_ATTRIBUTE,
  BEAD_ID_ATTRIBUTE,
  remarkBeadLinks,
} from '@/lib/remark-bead-links'
import { cn } from '@/lib/utils'

function Markdown({
  children,
  className,
}: {
  children: string | null | undefined
  className?: string
}) {
  // The prefix is the only thing the tokenizer needs from the lookup; the chips read the rest
  // themselves, so re-parsing is tied to the project rather than to every status change.
  const prefix = useBeadLookup()?.prefix ?? null
  const remarkPlugins = useMemo<Options['remarkPlugins']>(
    () => [remarkGfm, [remarkBeadLinks, { prefix }]],
    [prefix],
  )

  if (!children || children.trim() === '') return null

  return (
    <div
      data-slot="markdown"
      className={cn('prose prose-sm dark:prose-invert max-w-none', className)}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

/** Anchors carrying the bead marker are references the remark plugin found; everything else is
 * a link the author wrote, rendered as react-markdown would have. */
function MarkdownAnchor({
  node: _node,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const attributes = props as Record<string, unknown>
  const beadId = attributes[BEAD_ID_ATTRIBUTE]
  if (typeof beadId === 'string') {
    return (
      <BeadChip id={beadId} epic={attributes[BEAD_EPIC_ATTRIBUTE] === 'true'} />
    )
  }
  return <a {...props}>{children}</a>
}

const COMPONENTS: Components = { a: MarkdownAnchor }

export { Markdown }
