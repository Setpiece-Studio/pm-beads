import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

export const BEADS_RUNTIME_WATCH_GLOB = '**/.beads/**'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // bd writes its runtime database and sidecars beneath .beads. Those writes are application
  // data, not source changes; letting Vite watch them can reload the page and discard drafts.
  server: { watch: { ignored: [BEADS_RUNTIME_WATCH_GLOB] } },
  plugins: [
    devtools(),
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
