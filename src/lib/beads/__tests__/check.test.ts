// ABOUTME: API diagnostics include malformed/closed asks and never report failed inspections clean.
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('../cli', () => ({
  runBdJson: vi.fn(),
  beadsProjectDir: () => '/test',
}))
vi.mock('../projects', () => ({ bdOptionsFor: () => ({ cwd: '/test' }) }))
vi.mock('../remote-sync', () => ({
  readSyncStatus: vi.fn(() => ({ conflicts: [] })),
}))

import { checkAsks, handleCheck } from '../check'
import { runBdJson } from '../cli'
import { readSyncStatus } from '../remote-sync'

const valid = {
  kind: 'decision',
  q: 'Proceed?',
  by: 'agent',
  at: '2026-10-21T00:00:00Z',
}
beforeEach(() => {
  vi.mocked(runBdJson).mockReset()
  vi.mocked(readSyncStatus).mockReturnValue({ conflicts: [] })
})
it('reports keys, JSON, every invalid field, and incomplete answer attribution', () => {
  const errors = checkAsks('test-1', {
    'ask.bad-key': valid,
    'ask.json': '{',
    'ask.schema': { ...valid, answer: 'yes', done: true },
  })
  expect(errors.map((error) => error.code)).toEqual(
    expect.arrayContaining([
      'ASK_KEY_INVALID',
      'ASK_JSON_INVALID',
      'ASK_SCHEMA_INVALID',
    ]),
  )
  expect(errors.map((error) => error.field)).toEqual(
    expect.arrayContaining(['done', 'answered_by', 'answered_at']),
  )
  expect(checkAsks('test-1', { 'ask.valid': JSON.stringify(valid) })).toEqual(
    [],
  )
})
it('reads all fresh CLI rows including closed ones and returns diagnostics with HTTP 200', async () => {
  vi.mocked(runBdJson)
    .mockResolvedValueOnce([
      { id: 'closed-1', status: 'closed', metadata: { 'ask.a': '{' } },
    ])
    .mockResolvedValueOnce([])
  const response = await handleCheck(new Request('http://localhost/api/check'))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    version: 1,
    ok: false,
    completeness: { complete: true },
    issues: [{ issueId: 'closed-1', code: 'ASK_JSON_INVALID' }],
  })
  expect(runBdJson).toHaveBeenCalledWith(
    expect.arrayContaining(['--all', '--limit', '0', '--readonly']),
    expect.anything(),
  )
})
it('filters a single bead and reports a successful empty result', async () => {
  vi.mocked(readSyncStatus).mockReturnValue({
    conflicts: [
      {
        table: 'issues',
        record: 'other',
        token: 'other',
        values: { their_id: 'two' },
      },
    ],
  })
  vi.mocked(runBdJson)
    .mockResolvedValueOnce([
      { id: 'one', metadata: {} },
      { id: 'two', metadata: { 'ask.a': '{' } },
    ])
    .mockResolvedValueOnce([])
  const response = await handleCheck(
    new Request('http://localhost/api/check?issueId=one'),
  )
  expect(await response.json()).toMatchObject({ ok: true, issues: [] })
})
it('distinguishes invalid parameters, missing beads, and incomplete checks', async () => {
  expect(
    (await handleCheck(new Request('http://localhost/api/check?issueId=')))
      .status,
  ).toBe(400)
  vi.mocked(runBdJson).mockResolvedValue([])
  expect(
    (
      await handleCheck(
        new Request('http://localhost/api/check?issueId=missing'),
      )
    ).status,
  ).toBe(404)
  vi.mocked(runBdJson).mockRejectedValue(new Error('offline'))
  const response = await handleCheck(new Request('http://localhost/api/check'))
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({
    ok: false,
    completeness: { complete: false },
  })
})
it('includes live and persisted conflicts with freshness information', async () => {
  vi.mocked(runBdJson)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ table: 'issues', num_conflicts: 1 }])
    .mockResolvedValueOnce([{ dolt_conflict_id: 'record', our_id: 'one' }])
  vi.mocked(readSyncStatus).mockReturnValue({
    inspectedAt: '2026-10-20T00:00:00Z',
    conflicts: [
      {
        table: 'issues',
        record: 'record',
        token: 'token',
        values: { our_id: 'one' },
      },
    ],
  })
  const response = await handleCheck(new Request('http://localhost/api/check'))
  const body = await response.json()
  expect(body.issues).toHaveLength(2)
  expect(body.conflictSnapshot).toMatchObject({
    source: 'live',
    pendingSource: 'cached',
    pendingSnapshotAt: '2026-10-20T00:00:00Z',
  })
})
