// ABOUTME: Persona-to-tmux routing and the delivery ledger in .beads/pm-beads.json.
// ABOUTME: Reads are lenient; delivery writes preserve every unrelated sidecar key.

import { z } from 'zod'
import { ACTIVITY_ITEM_CAP } from './inbox-activity'
import { readSidecarObject, updateSidecar } from './sidecar'

export const personaSchema = z.object({
  tmux: z.string().trim().min(1).optional().catch(undefined),
  aliases: z.array(z.string().trim().min(1)).optional().catch(undefined),
})

export const personasSchema = z.record(z.string().trim().min(1), personaSchema)
const notifierSchema = z.object({
  deliveredActivityIds: z.array(z.string()).optional().catch(undefined),
})

export type PersonaConfig = z.infer<typeof personaSchema>

export interface NotifierConfig {
  personas: Record<string, PersonaConfig>
  deliveredActivityIds: string[]
}

export function readNotifierConfig(projectDir: string): NotifierConfig {
  const sidecar = readSidecarObject(projectDir)
  if (sidecar === null) return { personas: {}, deliveredActivityIds: [] }

  const personas: Record<string, PersonaConfig> = {}
  if (
    typeof sidecar.personas === 'object' &&
    sidecar.personas !== null &&
    !Array.isArray(sidecar.personas)
  ) {
    for (const [key, value] of Object.entries(sidecar.personas)) {
      if (key.trim() === '') continue
      const parsed = personaSchema.safeParse(value)
      if (parsed.success) personas[key] = parsed.data
    }
  }
  const notifier = notifierSchema.safeParse(sidecar.notifier)
  return {
    personas,
    deliveredActivityIds: notifier.success
      ? (notifier.data.deliveredActivityIds ?? [])
      : [],
  }
}

export async function recordDeliveredActivity(
  projectDir: string,
  activityId: string,
): Promise<void> {
  await updateSidecar(projectDir, (sidecar) => {
    const parsed = notifierSchema.safeParse(sidecar.notifier)
    const delivered = parsed.success
      ? (parsed.data.deliveredActivityIds ?? [])
      : []
    sidecar.notifier = {
      deliveredActivityIds: [
        activityId,
        ...delivered.filter((id) => id !== activityId),
      ].slice(0, ACTIVITY_ITEM_CAP),
    }
  })
}

/** Replace the hand-editable persona map without touching env, notifier delivery state, or
 * any other feature's sidecar block. The server boundary validates this same schema first. */
export async function replacePersonas(
  projectDir: string,
  personas: Record<string, PersonaConfig>,
): Promise<void> {
  const validated = personasSchema.parse(personas)
  await updateSidecar(projectDir, (sidecar) => {
    sidecar.personas = validated
  })
}
