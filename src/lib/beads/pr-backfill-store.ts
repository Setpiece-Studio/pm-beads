// ABOUTME: The backfill's half of the .beads/pm-beads.json sidecar — the bead ids a person
// ABOUTME: dismissed from the review list, so a re-scan never puts the same rows back.

import { z } from 'zod'
import { readSidecarObject, updateSidecar } from './sidecar'

/** The sidecar's `backfill` block. One key so far: the dismissed bead ids. */
export interface BackfillSidecarConfig {
  /** Bead ids a person skipped in the review list. Never proposed again. */
  skipped: string[]
}

// Entries are validated one by one so a hand-edited stray number costs that entry, not the
// whole list — the same leniency the sweep block applies to its own keys.
const backfillBlockSchema = z.object({
  skipped: z
    .array(z.unknown())
    .optional()
    .catch(undefined)
    .transform((entries) =>
      (entries ?? []).filter(
        (entry): entry is string => typeof entry === 'string' && entry !== '',
      ),
    ),
})

/** The project's skipped-bead list. Never throws: a missing, unreadable, or malformed sidecar
 * reads as nothing skipped, exactly like an absent one. */
export function readBackfillConfig(projectDir: string): BackfillSidecarConfig {
  const sidecar = readSidecarObject(projectDir)
  if (sidecar === null) return { skipped: [] }
  const parsed = backfillBlockSchema.safeParse(sidecar.backfill)
  if (!parsed.success) return { skipped: [] }
  return { skipped: parsed.data.skipped }
}

/**
 * Add bead ids to `backfill.skipped`, leaving every other key — `env` and `sweep` — as it was.
 * Rejects rather than rewriting a sidecar that does not parse (sidecar.ts).
 *
 * The union is sorted and deduped so the file stays readable by hand, which is also the only
 * way to UN-skip a bead: this is a dismissal, and dismissals are meant to stick.
 */
export function recordBackfillSkips(
  projectDir: string,
  ids: readonly string[],
): Promise<void> {
  // Nothing to record is not a reason to create (and re-mtime) the sidecar.
  if (ids.length === 0) return Promise.resolve()
  return updateSidecar(projectDir, (sidecar) => {
    const existing = backfillBlockSchema.safeParse(sidecar.backfill)
    const skipped = new Set(existing.success ? existing.data.skipped : [])
    for (const id of ids) {
      const trimmed = id.trim()
      if (trimmed !== '') skipped.add(trimmed)
    }
    sidecar.backfill = { skipped: [...skipped].sort() }
  })
}
