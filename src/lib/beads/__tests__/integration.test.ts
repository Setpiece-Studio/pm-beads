// ABOUTME: Integration tests that exercise queries and mutations against a real throwaway
// ABOUTME: beads project created with `bd init` in a temp dir, cleaned up after the run.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// bd writes wait on the embedded dolt exclusive lock; a too-small timeout kills a
// test mid-write and the orphaned bd process cascades lock failures into later tests.
vi.setConfig({ testTimeout: 60_000 })

import { parseAsks, serializeAsk } from '../asks'
import { runBd, runBdJson } from '../cli'
import {
  addDependency,
  addLabel,
  answerAsk,
  clearPrUrl,
  closeIssue,
  createIssue,
  createSubIssue,
  deleteMemory,
  relateIssues,
  removeDependency,
  removeLabel,
  saveTextField,
  setPrUrl,
  unrelateIssues,
  updateIssue,
} from '../mutations'
import { PR_URL_METADATA_KEY, prUrlOf } from '../pr-link'
import { bdOptionsFor } from '../projects'
import {
  getIssue,
  getMemory,
  listEpics,
  listIssueComments,
  listIssues,
  listMemories,
} from '../queries'

let dir: string
let epicId: string
let childAId: string
let childBId: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pm-beads-itest-'))
  await runBd(['init', '--prefix', 'tst'], {
    cwd: dir,
    env: { BD_NON_INTERACTIVE: '1' },
  })

  const epic = await createIssue(
    { title: 'Test epic', type: 'epic', priority: 1 },
    { cwd: dir },
  )
  epicId = epic.id
  const childA = await createIssue(
    { title: 'Child A', type: 'task', priority: 2, description: 'first child' },
    { cwd: dir },
  )
  childAId = childA.id
  const childB = await createIssue(
    { title: 'Child B', type: 'bug', priority: 3 },
    { cwd: dir },
  )
  childBId = childB.id
  await runBd(['dep', 'add', childAId, epicId, '--type', 'parent-child'], {
    cwd: dir,
  })
  await runBd(['dep', 'add', childBId, epicId, '--type', 'parent-child'], {
    cwd: dir,
  })
  await runBd(['comment', childAId, 'an integration comment'], { cwd: dir })
  await runBd(['remember', 'zebra memory body', '--key', 'zebra-memory'], {
    cwd: dir,
  })
  await runBd(['remember', 'alpha memory body', '--key', 'alpha-memory'], {
    cwd: dir,
  })
}, 120_000)

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('queries against a real bd project', () => {
  it('listIssues returns all open issues by default', async () => {
    const issues = await listIssues({}, { cwd: dir })
    const ids = issues.map((i) => i.id)
    expect(ids).toEqual(expect.arrayContaining([epicId, childAId, childBId]))
  })

  it('listIssues filters by status and type', async () => {
    const epics = await listIssues({ types: ['epic'] }, { cwd: dir })
    expect(epics.map((i) => i.id)).toEqual([epicId])
    const none = await listIssues({ statuses: ['deferred'] }, { cwd: dir })
    expect(none).toEqual([])
  })

  it('listIssues --parent returns the epic children', async () => {
    const children = await listIssues({ parent: epicId }, { cwd: dir })
    expect(children.map((i) => i.id).sort()).toEqual(
      [childAId, childBId].sort(),
    )
    for (const child of children) {
      expect(child.parent).toBe(epicId)
    }
  })

  it('getIssue unwraps the single-element show array and includes linked issues', async () => {
    const issue = await getIssue(childAId, { cwd: dir })
    expect(issue.id).toBe(childAId)
    expect(issue.description).toBe('first child')
    expect(issue.parent).toBe(epicId)
    const parentLink = issue.dependencies?.find((d) => d.id === epicId)
    expect(parentLink?.dependency_type).toBe('parent-child')
  })

  it('getIssue rejects for a nonexistent id', async () => {
    await expect(getIssue('tst-doesnotexist', { cwd: dir })).rejects.toThrow()
  })

  it('listEpics reports child progress', async () => {
    const epics = await listEpics({ cwd: dir })
    expect(epics).toHaveLength(1)
    expect(epics[0].epic.id).toBe(epicId)
    expect(epics[0].total_children).toBe(2)
    expect(epics[0].closed_children).toBe(0)
    expect(epics[0].eligible_for_close).toBe(false)
  })

  it('serializes concurrent reads (embedded dolt allows one process at a time)', async () => {
    const results = await Promise.all([
      listIssues({}, { cwd: dir }),
      listEpics({ cwd: dir }),
      listIssues({ parent: epicId, all: true }, { cwd: dir }),
      listIssues({ types: ['epic'] }, { cwd: dir }),
    ])
    expect(results[0].length).toBeGreaterThan(0)
    expect(results[1]).toHaveLength(1)
  })

  it('listIssueComments returns comments and [] when there are none', async () => {
    const comments = await listIssueComments(childAId, { cwd: dir })
    expect(comments).toHaveLength(1)
    expect(comments[0].text).toBe('an integration comment')
    const empty = await listIssueComments(childBId, { cwd: dir })
    expect(empty).toEqual([])
  })

  it('listMemories returns alphabetically sorted memory rows', async () => {
    const memories = await listMemories({ cwd: dir })
    expect(memories).toEqual([
      { key: 'alpha-memory', value: 'alpha memory body' },
      { key: 'zebra-memory', value: 'zebra memory body' },
    ])
  })

  it('getMemory returns one memory and rejects for a nonexistent key', async () => {
    await expect(getMemory('alpha-memory', { cwd: dir })).resolves.toEqual({
      key: 'alpha-memory',
      value: 'alpha memory body',
    })
    await expect(getMemory('missing-memory', { cwd: dir })).rejects.toThrow(
      /Memory not found: missing-memory/,
    )
  })
})

describe('explicit projectDir through the .beads guard', () => {
  it('listIssues works with bdOptionsFor on a real beads project dir', async () => {
    const issues = await listIssues({}, bdOptionsFor(dir))
    expect(issues.map((i) => i.id)).toEqual(expect.arrayContaining([epicId]))
  })

  it('bdOptionsFor rejects a dir without a .beads directory', () => {
    expect(() => bdOptionsFor(join(dir, 'no-such-subdir'))).toThrow(
      /not a dolt-backed beads project/i,
    )
  })
})

describe('mutations against a real bd project', () => {
  it('persists action and decision answers and transitions status with open asks', async () => {
    const created = await createIssue(
      { title: 'Structured asks', type: 'task', priority: 2 },
      { cwd: dir },
    )
    const action = serializeAsk({
      kind: 'action',
      q: 'Verify the UI',
      by: 'agent',
      at: '2026-09-10T20:00:00.000Z',
      steps: ['Open the bead', 'Check the action'],
    })
    const decision = serializeAsk({
      kind: 'decision',
      q: 'Choose storage',
      by: 'agent',
      at: '2026-09-10T20:00:00.000Z',
    })
    await runBd(
      [
        'update',
        created.id,
        '--status',
        'blocked',
        '--set-metadata',
        `ask.verify=${action}`,
        '--set-metadata',
        `ask.storage=${decision}`,
      ],
      { cwd: dir },
    )

    let updated = await answerAsk(
      created.id,
      'verify',
      'done',
      'integration-test',
      { cwd: dir },
    )
    expect(updated.status).toBe('blocked')
    let asks = parseAsks(updated.metadata).asks
    expect(asks.find((ask) => ask.key === 'verify')).toMatchObject({
      answer: 'done',
      done: true,
      answered_by: 'integration-test',
    })

    updated = await answerAsk(
      created.id,
      'storage',
      'one JSON string',
      'integration-test',
      { cwd: dir },
    )
    expect(updated.status).toBe('open')
    asks = parseAsks(updated.metadata).asks
    expect(asks.find((ask) => ask.key === 'storage')).toMatchObject({
      answer: 'one JSON string',
      answered_by: 'integration-test',
    })

    updated = await answerAsk(created.id, 'storage', null, 'integration-test', {
      cwd: dir,
    })
    expect(updated.status).toBe('blocked')
    expect(
      parseAsks(updated.metadata).asks.find((ask) => ask.key === 'storage')
        ?.answer,
    ).toBeUndefined()

    await runBd(['update', created.id, '--set-metadata', 'ask.malformed={'], {
      cwd: dir,
    })
    updated = await answerAsk(
      created.id,
      'storage',
      'one JSON string',
      'integration-test',
      { cwd: dir },
    )
    expect(updated.status).toBe('blocked')
    expect(parseAsks(updated.metadata).invalidKeys).toEqual(['ask.malformed'])
  })

  it('updateIssue updates fields and returns the fresh issue', async () => {
    const updated = await updateIssue(
      childAId,
      {
        status: 'in_progress',
        assignee: 'Dr. Zo',
        priority: 1,
        notes: 'some notes',
      },
      { cwd: dir },
    )
    expect(updated.status).toBe('in_progress')
    expect(updated.assignee).toBe('Dr. Zo')
    expect(updated.priority).toBe(1)
  })

  it('updateIssue writes design and acceptance criteria', async () => {
    const updated = await updateIssue(
      childAId,
      {
        design: '## Shape\n\nA `<pre>` mirrored under the textarea.',
        acceptance_criteria: '- [ ] Reads correctly in both themes',
      },
      { cwd: dir },
    )
    expect(updated.design).toContain('A `<pre>` mirrored under the textarea.')
    expect(updated.acceptance_criteria).toContain(
      'Reads correctly in both themes',
    )
  })

  it('updateIssue clears a long-text field with an empty string', async () => {
    await updateIssue(childAId, { notes: 'transient' }, { cwd: dir })
    const cleared = await updateIssue(childAId, { notes: '' }, { cwd: dir })
    expect(cleared.notes ?? '').toBe('')
  })

  it('saveTextField writes when the stored value still matches the baseline', async () => {
    await updateIssue(childAId, { notes: 'baseline notes' }, { cwd: dir })

    const result = await saveTextField(
      childAId,
      'notes',
      'edited notes',
      'baseline notes',
      { cwd: dir },
    )

    expect(result.ok).toBe(true)
    expect(result.issue.notes).toBe('edited notes')
  })

  it('saveTextField refuses the write when the stored value moved underneath it', async () => {
    await updateIssue(childAId, { notes: 'agent rewrote this' }, { cwd: dir })

    const result = await saveTextField(
      childAId,
      'notes',
      'human draft',
      'what the editor opened with',
      { cwd: dir },
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a conflict')
    expect(result.conflict).toEqual({
      field: 'notes',
      current: 'agent rewrote this',
    })
    // The refusal is total: bd still holds the other author's text, unread and unharmed.
    expect(result.issue.notes).toBe('agent rewrote this')
    const stored = await getIssue(childAId, { cwd: dir })
    expect(stored.notes).toBe('agent rewrote this')
  })

  it('saveTextField reads an absent field as an empty baseline', async () => {
    await updateIssue(childAId, { notes: '' }, { cwd: dir })

    const result = await saveTextField(childAId, 'notes', 'first notes', '', {
      cwd: dir,
    })

    expect(result.ok).toBe(true)
    expect(result.issue.notes).toBe('first notes')
  })

  it('saveTextField guards the title on the same terms', async () => {
    const created = await createIssue(
      { title: 'Original name', type: 'task', priority: 3 },
      { cwd: dir },
    )

    const stale = await saveTextField(
      created.id,
      'title',
      'Renamed',
      'Something else entirely',
      { cwd: dir },
    )
    expect(stale.ok).toBe(false)
    expect(stale.issue.title).toBe('Original name')

    const fresh = await saveTextField(
      created.id,
      'title',
      'Renamed',
      'Original name',
      { cwd: dir },
    )
    expect(fresh.ok).toBe(true)
    expect(fresh.issue.title).toBe('Renamed')
  })

  it('updateIssue changes the issue type via bd update --type', async () => {
    const created = await createIssue(
      { title: 'Type flip', type: 'task', priority: 3 },
      { cwd: dir },
    )
    const updated = await updateIssue(
      created.id,
      { issue_type: 'bug' },
      { cwd: dir },
    )
    expect(updated.issue_type).toBe('bug')
  })

  it('addLabel and removeLabel go through bd label', async () => {
    await addLabel(childAId, 'urgent', { cwd: dir })
    await addLabel(childAId, 'backend', { cwd: dir })
    let issue = await getIssue(childAId, { cwd: dir })
    expect(issue.labels).toEqual(expect.arrayContaining(['urgent', 'backend']))
    await removeLabel(childAId, 'urgent', { cwd: dir })
    issue = await getIssue(childAId, { cwd: dir })
    expect(issue.labels ?? []).not.toContain('urgent')
    expect(issue.labels).toContain('backend')
  })

  it('serializes concurrent writes through the write lock', async () => {
    const titles = ['Concurrent 1', 'Concurrent 2', 'Concurrent 3']
    const created = await Promise.all(
      titles.map((title) =>
        createIssue({ title, type: 'chore', priority: 4 }, { cwd: dir }),
      ),
    )
    expect(new Set(created.map((i) => i.id)).size).toBe(3)
    for (const issue of created) {
      await closeIssue(issue.id, 'cleanup', { cwd: dir })
    }
  })

  it('closeIssue closes with a reason', async () => {
    const closed = await closeIssue(childBId, 'not reproducible', { cwd: dir })
    expect(closed.status).toBe('closed')
    expect(closed.close_reason).toBe('not reproducible')
    const epics = await listEpics({ cwd: dir })
    expect(epics[0].closed_children).toBe(1)
  })

  it('createIssue parses the single-object bd create --json output', async () => {
    const created = await createIssue(
      {
        title: 'Created via data layer',
        type: 'feature',
        priority: 2,
        description: 'hi',
      },
      { cwd: dir },
    )
    expect(created.id).toMatch(/^tst-/)
    expect(created.title).toBe('Created via data layer')
    expect(created.issue_type).toBe('feature')
    expect(created.description).toBe('hi')
  })

  it('createSubIssue files a FLAT child under the parent, with assignee and labels', async () => {
    const child = await createSubIssue(
      {
        parentId: epicId,
        title: 'Composed child',
        type: 'task',
        priority: 1,
        description: 'from the composer',
        assignee: 'marty',
        labels: ['frontend'],
      },
      { cwd: dir },
    )
    // Flat id: `bd create --parent` would have minted a dotted `<parent>.N` id instead.
    expect(child.id).toMatch(/^tst-/)
    expect(child.id).not.toContain('.')
    expect(child.parent).toBe(epicId)
    expect(child.assignee).toBe('marty')
    expect(child.labels).toContain('frontend')
    expect(child.description).toBe('from the composer')

    // bd agrees the child is under the epic: the recursive parent filter finds it.
    const children = await listIssues(
      { parent: epicId, all: true },
      { cwd: dir },
    )
    expect(children.map((issue) => issue.id)).toContain(child.id)
  })

  it('setPrUrl/clearPrUrl round-trip pr_url through bd show --json metadata', async () => {
    const issue = await createIssue(
      { title: 'PR link round trip', type: 'task', priority: 2 },
      { cwd: dir },
    )
    const url = 'https://github.com/example-owner/pm-beads/pull/9'

    const linked = await setPrUrl(issue.id, url, { cwd: dir })
    expect(prUrlOf(linked)).toBe(url)
    // Read it back independently: the returned issue must match what bd actually stored.
    expect(prUrlOf(await getIssue(issue.id, { cwd: dir }))).toBe(url)
    // bd's metadata filters are server-side, which is what the later merge sweep will use.
    const filtered = (await runBdJson(
      ['list', '--json', '--all', '--has-metadata-key', PR_URL_METADATA_KEY],
      { cwd: dir },
    )) as { id: string }[]
    expect(filtered.map((i) => i.id)).toContain(issue.id)

    // Re-linking replaces rather than appends: pr_url is the LATEST PR, by convention.
    const relinked = await setPrUrl(
      issue.id,
      'https://github.com/example-owner/pm-beads/pull/10',
      { cwd: dir },
    )
    expect(prUrlOf(relinked)).toBe(
      'https://github.com/example-owner/pm-beads/pull/10',
    )

    // Unlink drops the key entirely, so --has-metadata-key stops matching.
    const cleared = await clearPrUrl(issue.id, { cwd: dir })
    expect(prUrlOf(cleared)).toBeUndefined()
    expect(prUrlOf(await getIssue(issue.id, { cwd: dir }))).toBeUndefined()
  })

  it('deleteMemory removes a memory by key', async () => {
    await runBd(['remember', 'temporary memory body', '--key', 'temp-memory'], {
      cwd: dir,
    })
    await expect(getMemory('temp-memory', { cwd: dir })).resolves.toEqual({
      key: 'temp-memory',
      value: 'temporary memory body',
    })
    await deleteMemory('temp-memory', { cwd: dir })
    await expect(getMemory('temp-memory', { cwd: dir })).rejects.toThrow(
      /Memory not found: temp-memory/,
    )
  })
})

describe('dependency mutations against a real bd project', () => {
  // Each test makes its own pair of issues so edge state never bleeds across tests.
  async function pair(): Promise<[string, string]> {
    const a = await createIssue(
      { title: 'Dep A', type: 'task', priority: 2 },
      {
        cwd: dir,
      },
    )
    const b = await createIssue(
      { title: 'Dep B', type: 'task', priority: 2 },
      {
        cwd: dir,
      },
    )
    return [a.id, b.id]
  }

  it('addDependency adds a blocks edge visible under dependencies[]', async () => {
    const [a, b] = await pair()
    await addDependency(a, b, 'blocks', { cwd: dir })
    const issue = await getIssue(a, { cwd: dir })
    const edge = issue.dependencies?.find((d) => d.id === b)
    expect(edge?.dependency_type).toBe('blocks')
    expect(issue.dependents ?? []).toHaveLength(0)
  })

  it('removeDependency clears the edge; reversed argument order also succeeds', async () => {
    const [a, b] = await pair()
    await addDependency(a, b, 'blocks', { cwd: dir })

    // Reversed order resolves as a (no-op) command in bd v1.0.0 — it must not throw, and now
    // returns the fresh edge-owner issue (arg1 = b) read back after the write.
    const reversed = await removeDependency(b, a, { cwd: dir })
    expect(reversed.id).toBe(b)

    // The directed edge clears when removed in the order it was added.
    await removeDependency(a, b, { cwd: dir })
    const issue = await getIssue(a, { cwd: dir })
    expect(issue.dependencies?.some((d) => d.id === b) ?? false).toBe(false)
  })

  it('relateIssues makes each endpoint show the other as relates-to', async () => {
    const [a, b] = await pair()
    await relateIssues(a, b, { cwd: dir })
    const issueA = await getIssue(a, { cwd: dir })
    const issueB = await getIssue(b, { cwd: dir })
    const edgeFromA = issueA.dependencies?.find((d) => d.id === b)
    const edgeFromB = issueB.dependencies?.find((d) => d.id === a)
    expect(edgeFromA?.dependency_type).toBe('relates-to')
    expect(edgeFromB?.dependency_type).toBe('relates-to')

    await unrelateIssues(a, b, { cwd: dir })
    const clearedA = await getIssue(a, { cwd: dir })
    const clearedB = await getIssue(b, { cwd: dir })
    expect(clearedA.dependencies?.some((d) => d.id === b) ?? false).toBe(false)
    expect(clearedB.dependencies?.some((d) => d.id === a) ?? false).toBe(false)
  })

  it('a cycle-creating add throws an Error carrying bd message', async () => {
    const [a, b] = await pair()
    await addDependency(a, b, 'blocks', { cwd: dir })
    await expect(addDependency(b, a, 'blocks', { cwd: dir })).rejects.toThrow(
      /cycle/i,
    )
  })

  it('a duplicate add resolves idempotently — no second edge, no error (bd v1.0.0)', async () => {
    const [a, b] = await pair()
    await addDependency(a, b, 'blocks', { cwd: dir })
    // bd re-affirms an existing edge rather than rejecting; the contract is idempotent.
    await expect(
      addDependency(a, b, 'blocks', { cwd: dir }),
    ).resolves.toBeDefined()
    const issue = await getIssue(a, { cwd: dir })
    const edges = (issue.dependencies ?? []).filter((d) => d.id === b)
    expect(edges).toHaveLength(1)
  })

  it('a self-dependency (issueId === dependsOnId) is rejected by bd', async () => {
    const [a] = await pair()
    // bd v1.0.0 refuses a self-edge: "cannot add self-dependency: <id> cannot depend on itself".
    await expect(addDependency(a, a, 'blocks', { cwd: dir })).rejects.toThrow(
      /self-dependency|depend on itself/i,
    )
  })

  it('an external: blocker shows in bd list edges but not in bd show relationships (KTD14)', async () => {
    const [a] = await pair()
    await addDependency(a, 'external:beads:some-cap', 'blocks', { cwd: dir })

    // bd show omits external edges entirely — getIssue must not see it (and must not crash).
    const shown = await getIssue(a, { cwd: dir })
    expect(
      shown.dependencies?.some((d) => d.id.startsWith('external:')) ?? false,
    ).toBe(false)

    // bd list embeds the edge record, so it is recoverable there.
    const issues = await listIssues({ all: true }, { cwd: dir })
    const owner = issues.find((i) => i.id === a)
    const edge = owner?.dependencies?.find(
      (d) => d.depends_on_id === 'external:beads:some-cap',
    )
    expect(edge?.type).toBe('blocks')
  })
})
