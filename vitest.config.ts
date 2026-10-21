// ABOUTME: Vitest configuration — deliberately separate from vite.config.ts so tests don't load
// ABOUTME: the nitro/devtools plugins, which hold open handles and stall vitest's teardown.

import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [viteReact()],
  test: {
    environment: 'jsdom',
    // Playwright specs are e2e/*.spec.ts and must never run under vitest; the e2e harness's
    // own helpers (isolation, locking, teardown sweeps) are plain units and live in
    // e2e/support/*.test.ts, which playwright's testMatch excludes in turn.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'e2e/support/**/*.test.ts'],
  },
})
