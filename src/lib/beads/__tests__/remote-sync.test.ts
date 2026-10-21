// ABOUTME: Conservative conflict classification and SQL encoding contracts.
import { expect, it } from 'vitest'
import { duplicateConflict, parseSqlRows, sqlValue } from '../remote-sync'

it('only classifies identical sides as automatic resolutions', () => {
  expect(
    duplicateConflict({
      our_id: 'a',
      their_id: 'a',
      our_value: 'same',
      their_value: 'same',
    }),
  ).toBe(true)
  expect(
    duplicateConflict({
      our_id: 'a',
      their_id: 'a',
      our_value: 'short',
      their_value: 'short plus more',
    }),
  ).toBe(false)
  expect(duplicateConflict({})).toBe(false)
})
it('parses installed Dolt multi-result and empty JSON shapes', () => {
  expect(
    parseSqlRows(
      '{"rows":[{"status":0}]}\n{"rows":[{"table":"issues","num_conflicts":2}]}',
    ),
  ).toEqual([{ table: 'issues', num_conflicts: 2 }])
  expect(parseSqlRows('{}')).toEqual([])
  expect(() => parseSqlRows('not json')).toThrow()
})
it('encodes SQL values without quote or backslash interpolation', () => {
  expect(sqlValue("a'\\b")).toBe('CONVERT(0x61275c62 USING utf8mb4)')
  expect(sqlValue(null)).toBe('NULL')
})
