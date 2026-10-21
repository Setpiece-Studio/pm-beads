// ABOUTME: Unit tests for the per-checkout e2e isolation derivation — the checkout hash, the
// ABOUTME: port it maps to, the scan root it names, and the E2E_PORT/E2E_SCAN_ROOT overrides.

import { describe, expect, it } from 'vitest'
import {
  E2E_PORT_RANGE_END,
  E2E_PORT_RANGE_START,
  checkoutHash,
  derivePort,
  deriveScanRoot,
  resolvePort,
  resolveScanRoot,
} from './isolation'

const CHECKOUT = '/Users/dev/pm-beads'
const WORKTREE = '/Users/dev/pm-beads/.claude/worktrees/agent-abc'

describe('checkoutHash', () => {
  it('is eight lowercase hex characters', () => {
    expect(checkoutHash(CHECKOUT)).toMatch(/^[0-9a-f]{8}$/)
  })

  it('is stable for the same path', () => {
    expect(checkoutHash(CHECKOUT)).toBe(checkoutHash(CHECKOUT))
  })

  it('differs between a checkout and its worktree', () => {
    expect(checkoutHash(CHECKOUT)).not.toBe(checkoutHash(WORKTREE))
  })
})

describe('derivePort', () => {
  it('lands inside the reserved range', () => {
    for (const path of [CHECKOUT, WORKTREE, '/tmp/x', '/a', '']) {
      const port = derivePort(path)
      expect(port).toBeGreaterThanOrEqual(E2E_PORT_RANGE_START)
      expect(port).toBeLessThanOrEqual(E2E_PORT_RANGE_END)
      expect(Number.isInteger(port)).toBe(true)
    }
  })

  it('is stable for the same path and differs across checkouts', () => {
    expect(derivePort(CHECKOUT)).toBe(derivePort(CHECKOUT))
    expect(derivePort(CHECKOUT)).not.toBe(derivePort(WORKTREE))
  })

  it('never lands on the dev server port', () => {
    expect(E2E_PORT_RANGE_START).toBeGreaterThan(8345)
  })
})

describe('deriveScanRoot', () => {
  it('names the scan root after the checkout hash, under the temp dir', () => {
    expect(deriveScanRoot(CHECKOUT, '/var/tmp')).toBe(
      `/var/tmp/pm-beads-e2e-${checkoutHash(CHECKOUT)}`,
    )
  })

  it('differs between a checkout and its worktree', () => {
    expect(deriveScanRoot(CHECKOUT, '/var/tmp')).not.toBe(
      deriveScanRoot(WORKTREE, '/var/tmp'),
    )
  })
})

describe('resolvePort', () => {
  it('derives from the checkout when E2E_PORT is unset', () => {
    expect(resolvePort({}, CHECKOUT)).toBe(derivePort(CHECKOUT))
  })

  it('honours an E2E_PORT override', () => {
    expect(resolvePort({ E2E_PORT: '9111' }, CHECKOUT)).toBe(9111)
  })

  it('ignores an empty E2E_PORT', () => {
    expect(resolvePort({ E2E_PORT: '' }, CHECKOUT)).toBe(derivePort(CHECKOUT))
  })

  it('rejects an unusable E2E_PORT', () => {
    expect(() => resolvePort({ E2E_PORT: 'http' }, CHECKOUT)).toThrow(/E2E_PORT/)
    expect(() => resolvePort({ E2E_PORT: '0' }, CHECKOUT)).toThrow(/E2E_PORT/)
    expect(() => resolvePort({ E2E_PORT: '70000' }, CHECKOUT)).toThrow(/E2E_PORT/)
  })
})

describe('resolveScanRoot', () => {
  it('derives from the checkout when E2E_SCAN_ROOT is unset', () => {
    expect(resolveScanRoot({}, CHECKOUT, '/var/tmp')).toBe(
      deriveScanRoot(CHECKOUT, '/var/tmp'),
    )
  })

  it('honours an E2E_SCAN_ROOT override', () => {
    expect(
      resolveScanRoot({ E2E_SCAN_ROOT: '/var/tmp/mine' }, CHECKOUT, '/var/tmp'),
    ).toBe('/var/tmp/mine')
  })

  it('ignores an empty E2E_SCAN_ROOT', () => {
    expect(resolveScanRoot({ E2E_SCAN_ROOT: '' }, CHECKOUT, '/var/tmp')).toBe(
      deriveScanRoot(CHECKOUT, '/var/tmp'),
    )
  })
})
