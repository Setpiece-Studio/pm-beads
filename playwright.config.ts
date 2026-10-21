// ABOUTME: Playwright e2e configuration — boots vite dev on a per-checkout port against a
// ABOUTME: throwaway seeded beads project (global-setup) so e2e never touches real data.

import { defineConfig, devices } from '@playwright/test'
import {
  E2E_BASE_URL,
  E2E_GH_SHIM_DIR,
  E2E_PORT,
  E2E_PR_HISTORY_FILE,
  E2E_PROJECT_DIR,
  E2E_SCAN_ROOT,
} from './e2e/support/bd'

export default defineConfig({
  testDir: './e2e',
  // Only the specs: e2e/support/*.test.ts are vitest units covering the harness itself.
  testMatch: '*.spec.ts',
  globalSetup: './e2e/support/global-setup.ts',
  globalTeardown: './e2e/support/global-teardown.ts',
  // bd's embedded dolt backend is single-writer/single-opener and every test shares
  // the one seeded project, so specs run serially in file order (mutations last).
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Preflight first: webServer starts before globalSetup, so this is the only place that
    // can refuse a busy port before vite fails on it with a bare EADDRINUSE.
    command: `bun run ./e2e/support/preflight.ts && bunx vite dev --port ${E2E_PORT} --strictPort`,
    // Probe a static vite endpoint: app routes SSR through bd, and the seeded
    // project may not exist yet when the readiness probe starts polling.
    url: `${E2E_BASE_URL}/@vite/client`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PM_BEADS_PROJECT_DIR: E2E_PROJECT_DIR,
      PM_BEADS_SCAN_DIRS: E2E_SCAN_ROOT,
      // Tells the server this is the e2e harness. The merged-PR sweep's interval poll refuses
      // to start here: a background timer closing beads under a spec that asserts on them
      // would be a flake generator. The sweep spec drives the toolbar action instead.
      PM_BEADS_E2E: '1',
      // The PR row shells to `gh`; the shim answers with canned payloads so the badge is
      // deterministic and the suite needs neither network nor a GitHub login. bd still
      // resolves off the inherited PATH, which stays behind the shim dir.
      PATH: `${E2E_GH_SHIM_DIR}:${process.env.PATH ?? ''}`,
      // The backfill's `gh pr list` payload has to quote bead ids bd mints at run time, so the
      // shim reads it from here instead of carrying it inline. Absent file = no merged PRs.
      PM_BEADS_E2E_PR_HISTORY: E2E_PR_HISTORY_FILE,
    },
  },
})
