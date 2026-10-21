// ABOUTME: Flat creation followed by recoverable updates. Partial failures always return the ID.
import { type BdOptions, beadsProjectDir } from './cli'
import type { CreateDraft } from './create-draft'
import { addDependency, createIssue, updateIssue } from './mutations'
import { resolvePrRef } from './pr-remote'
import { getIssue } from './queries'

export async function createWorkspaceIssue(
  input: CreateDraft,
  opts: BdOptions = {},
) {
  // Resolve invalid PR references before creating anything.
  const prUrl =
    !input.createdId && input.prLink?.trim()
      ? await resolvePrRef(input.prLink, opts.cwd ?? beadsProjectDir())
      : undefined
  const id =
    input.createdId ?? (await createIssue({ ...input, prUrl }, opts)).id
  const completedSteps = new Set(input.createdId ? input.completedSteps : [])
  const step = async (name: string, action: () => Promise<unknown>) => {
    if (completedSteps.has(name)) return
    await action()
    completedSteps.add(name)
  }
  try {
    const { status, parent } = input
    const fields = Object.fromEntries(
      Object.entries({
        status,
        parent,
      }).filter(([, value]) => value !== undefined),
    )
    if (Object.keys(fields).length)
      await step('fields', () => updateIssue(id, fields, opts))
    const current = await getIssue(id, opts)
    for (const dependency of input.dependencies ?? []) {
      if (
        !current.dependencies?.some(
          (edge) => edge.id === dependency && edge.dependency_type === 'blocks',
        )
      )
        await step(`dependency:${dependency}`, () =>
          addDependency(id, dependency, 'blocks', opts),
        )
    }
    return {
      id,
      complete: true,
      error: null,
      completedSteps: [...completedSteps],
    }
  } catch (error) {
    return {
      id,
      complete: false,
      completedSteps: [...completedSteps],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
